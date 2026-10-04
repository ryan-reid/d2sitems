// Usage: node tests/run_browser_regressions.mjs [url]
// Serve the repository root first (python -m http.server 8765).
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:8765/tests/browser_regressions.html';
const port = 9333;
const profile = path.join(os.tmpdir(), 'bk-browser-regressions-' + Date.now());
const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(target => target.type === 'page');
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
  await call('Page.enable');
  await call('Page.navigate', { url });
  let text = '';
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const result = await call('Runtime.evaluate', { expression: "document.getElementById('results')?.textContent || ''", returnByValue: true });
    text = result.result?.result?.value || '';
    if (/FAIL|Error|ALL BROWSER CHECKS PASSED|All browser regression/i.test(text) && !/Starting/.test(text)) break;
  }
  console.log(text);
  exitCode = /FAIL|Error:/i.test(text) || !text.trim() ? 1 : 0;
  ws.close();
} catch (error) {
  console.error(error);
} finally {
  edge.kill();
  process.exit(exitCode);
}
