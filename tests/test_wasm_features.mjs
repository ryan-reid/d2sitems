import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9235;

console.log('Starting Headless Edge for Advanced WASM Features...');
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
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log(`[Browser Console] ${text}`);
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
    await call('Page.navigate', { url: 'http://127.0.0.1:5000/' });
    await sleep(2000);

    console.log('[1/3] Testing Ingesting Character + Shared Stash...');
    const charBytes = fs.readFileSync('tests/fixtures/baselines/Amazon_L1.golden.d2s');
    const charB64 = charBytes.toString('base64');

    // Ingest character
    const ingestRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const raw = atob('${charB64}');
          const u8 = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          const res = await window.D2Wasm.ingestFile('AmazonTest.d2s', u8);
          return {
            success: !res.error,
            items: res.data?.items?.length
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const ingestVal = ingestRes.result?.result?.value;
    console.log('Ingest char result:', JSON.stringify(ingestVal));
    if (!ingestVal?.success) throw new Error('Failed to ingest char: ' + JSON.stringify(ingestVal));
    console.log('  -> PASS: Character ingested successfully');

    console.log('[2/3] Testing In-Memory Quest Completion...');
    const questRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await window.D2Wasm.completeQuests('AmazonTest.d2s', 'normal', -1, true, true);
          return {
            success: res.success,
            message: res.message,
            hasD2SBase64: Boolean(res.d2sBase64)
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const questVal = questRes.result?.result?.value;
    console.log('Quest result:', JSON.stringify(questVal));
    if (!questVal?.success || !questVal?.hasD2SBase64) {
      throw new Error('Quest completion failed: ' + JSON.stringify(questVal));
    }
    console.log('  -> PASS: Quests completed in-browser memory');

    console.log('[3/3] Testing In-Memory Mule Creation (Necromancer Hardcore)...');
    const necroRes = await call('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const res = await window.D2Wasm.createMule('GrimReaper', 'Necromancer', true);
          return {
            success: res.success,
            message: res.message
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const necroVal = necroRes.result?.result?.value;
    console.log('Necromancer mule result:', JSON.stringify(necroVal));
    if (!necroVal?.success) throw new Error('Necromancer mule failed: ' + JSON.stringify(necroVal));
    console.log('  -> PASS: Hardcore Necromancer mule created');

    console.log('\n=============================================');
    console.log('   ALL ADVANCED WASM FEATURES VERIFIED!      ');
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
