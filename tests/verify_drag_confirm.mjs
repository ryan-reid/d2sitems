// Usage: node tests/verify_drag_confirm.mjs   (serve the repo root first: python -m http.server 8765)
// Browser-mode only: imports golden fixtures into a throwaway Edge profile, then drives a real
// dragstart/drop with window.confirm stubbed. Never touches local saves.
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const base = process.env.BASE || 'http://127.0.0.1:8765';
const port = 9334;
const profile = path.join(os.tmpdir(), 'bk-drag-confirm-' + Date.now());
const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('Edge DevTools did not start');
}

let exitCode = 1;
try {
  const ws = new WebSocket(await pageSocket());
  await new Promise(resolve => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const call = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  const waitFor = async (expression, label, tries = 60) => {
    for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return; await sleep(500); }
    throw new Error('Timed out waiting for ' + label);
  };
  await call('Page.enable');
  await call('Page.navigate', { url: base + '/web/index.html' });
  await waitFor("!!window.D2Wasm && !!window.state", 'app boot');
  await sleep(2000);
  // Seed the browser session with the golden fixtures, then reload so the app loads them from IndexedDB.
  await evaluate(`(async () => {
    const e = window.D2Wasm; await e.clearDB(); e.downloadFile = () => {};
    const get = async n => new Uint8Array(await (await fetch('/tests/fixtures/baselines/' + n)).arrayBuffer());
    await e.ingestFiles([{name:'TestAmazon.d2s',bytes:await get('Amazon_L1.golden.d2s')},{name:'TestStash.d2i',bytes:await get('ModernSharedStashSoftCoreV2.golden.d2i')}]);
    return true; })()`);
  await call('Page.navigate', { url: base + '/web/index.html' });
  await waitFor("window.state?.isWasmMode && window.state.saves?.length >= 2", 'WASM saves loaded');
  await evaluate("window.D2Wasm.downloadFile = () => {}; document.querySelector('.nav-tab[data-tab=\"armory-view\"]').click(); true");
  await waitFor("document.querySelectorAll('.d2r-item-element').length > 0", 'armory items rendered', 90);
  const result = await evaluate(`(async () => {
    const out = { prompts: [] };
    window.confirm = message => { out.prompts.push(message); return out.answer; };
    const element = document.querySelector('.d2r-item-element[draggable="true"]') || document.querySelector('.d2r-item-element');
    const grids = [...document.querySelectorAll('.d2r-grid, .d2r-inventory-grid, [data-drop-target], .d2r-panel')];
    out.items = document.querySelectorAll('.d2r-item-element').length;
    out.draggable = !!element?.draggable;
    out.edits0 = (document.getElementById('save-mode-notice').textContent.match(/edits this session|Unexported edits this session: (\\d+)/) || [])[1] || '0';
    const targets = [...document.querySelectorAll('.d2r-grid-cell, .d2r-grid, .d2r-panel-grid')].filter(t => t !== element);
    out.targets = targets.length;
    const dt = new DataTransfer();
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    out.dragged = !!window._d2rState.draggedItem;
    out.answer = false;
    for (const target of targets) {
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 5, clientY: 5 }));
      if (out.prompts.length) break;
    }
    out.cancelledPrompt = out.prompts[0] || null;
    out.noteAfterCancel = document.getElementById('save-mode-notice').textContent.slice(-80);
    return out; })()`);
  console.log(JSON.stringify(result, null, 1));
  exitCode = result.cancelledPrompt && /Move .* to .*\?/.test(result.cancelledPrompt) && /browser/.test(result.cancelledPrompt) ? 0 : 1;
  console.log(exitCode === 0 ? 'DRAG CONFIRM PROMPT OK' : 'DRAG CONFIRM PROMPT NOT OBSERVED');
  ws.close();
} catch (error) {
  console.error(error);
} finally {
  edge.kill();
  process.exit(exitCode);
}
