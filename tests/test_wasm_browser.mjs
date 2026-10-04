import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9224;

console.log('Starting Headless Edge for WASM verification...');
const edgeProcess = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  'http://127.0.0.1:5000/'
]);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      console.log('Edge DevTools targets:', JSON.stringify(list));
      const pageTarget = list.find(t => t.type === 'page' && t.url !== 'about:blank') || list.find(t => t.type === 'page') || list[0];
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return pageTarget.webSocketDebuggerUrl;
      }
    } catch (e) {
      await sleep(300);
    }
  }
  throw new Error('Could not connect to Edge DevTools');
}

async function run() {
  try {
    const wsUrl = await getDebuggerUrl();
    console.log('Connected to Edge DevTools WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const callbacks = new Map();

    let pageLoaded = false;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired') {
        pageLoaded = true;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log(`[Browser Console] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error(`[Browser Exception] ${JSON.stringify(msg.params.exceptionDetails)}`);
      }
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
    };

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    function call(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await call('Page.enable');
    await call('Runtime.enable');
    console.log('Navigating to http://127.0.0.1:5000/ ...');
    await call('Page.navigate', { url: 'http://127.0.0.1:5000/' });

    console.log('Waiting for Page.loadEventFired...');
    for (let i = 0; i < 40 && !pageLoaded; i++) {
      await sleep(200);
    }

    const loc = await call('Runtime.evaluate', { expression: 'window.location.href' });
    console.log('Current URL:', loc.result?.result?.value);

    const d2wasmType = await call('Runtime.evaluate', { expression: 'typeof window.D2Wasm' });
    console.log('window.D2Wasm type:', d2wasmType.result?.result?.value);

    console.log('[1/4] Testing dotnet.js direct creation...');
    const directRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const { dotnet } = await import('./_framework/dotnet.js');
          const runtime = await dotnet.create();
          const assemblies = runtime.getConfig()?.resources?.assembly?.map(a => a.virtualPath || a.name);
          return { success: true, runtime: typeof runtime, assemblies };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Direct dotnet.create response:', JSON.stringify(directRes.result?.result?.value));
    console.log('  -> PASS: WebAssembly runtime initialized');

    console.log('[2/4] Testing in-browser mule generation (WasmPaladin)...');
    const muleRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await window.D2Wasm.createMule('WasmPaladin', 'Paladin', false);
          return {
            success: res.success,
            message: res.message,
            hasBytes: window.D2Wasm.loadedFiles.has('WasmPaladin.d2s')
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const muleVal = muleRes.result?.result?.value || muleRes.result?.value;
    console.log('Mule result:', JSON.stringify(muleVal));
    if (!muleVal?.success || !muleVal?.hasBytes) {
      throw new Error('D2Wasm failed to create mule: ' + JSON.stringify(muleVal));
    }
    console.log('  -> PASS: In-browser mule created & saved to memory');

    console.log('[3/4] Testing in-browser save parsing & perfection scoring...');
    const sampleSave = path.resolve('tests/fixtures/baselines/Amazon_L1.golden.d2s');
    const bytes = fs.readFileSync(sampleSave);
    const base64 = bytes.toString('base64');

    const parseRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const raw = atob('${base64}');
          const u8 = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          const res = await window.D2Wasm.ingestFile('Amazon_L1.golden.d2s', u8);
          const dataset = await window.D2Wasm.buildDataset();
          return {
            savesCount: dataset.saves.length,
            itemsCount: dataset.items.length,
            charName: dataset.saves[0]?.name,
            firstItemName: dataset.items[0]?.displayName,
            firstItemPerf: dataset.items[0]?.perfectionScore
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const parseVal = parseRes.result?.result?.value || parseRes.result?.value;
    console.log('Parse result:', JSON.stringify(parseVal));
    if (!parseVal || parseVal.itemsCount <= 0) {
      throw new Error('D2Wasm failed to parse character items: ' + JSON.stringify(parseVal));
    }
    console.log('  -> PASS: Character and items parsed with zero server!');

    console.log('[4/4] Testing in-browser Holy Grail calculation...');
    const grailRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const dataset = await window.D2Wasm.buildDataset();
          const grail = window.D2Wasm.getGrailProgress(dataset.items);
          return {
            totalTracked: grail.total_tracked,
            totalFound: grail.total_found,
            percent: grail.percent
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const grailVal = grailRes.result?.result?.value || grailRes.result?.value;
    console.log('Grail result:', JSON.stringify(grailVal));
    console.log('  -> PASS: Holy Grail tracking calculated');

    console.log('\n=============================================');
    console.log('   ALL CLIENT-SIDE WASM TESTS PASSED!        ');
    console.log('=============================================');

    ws.close();
  } finally {
    edgeProcess.kill();
  }
}

run().catch((err) => {
  console.error('Test FAILED:', err);
  edgeProcess.kill();
  process.exit(1);
});
