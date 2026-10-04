import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9226;

const edgeProcess = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1100',
  'http://127.0.0.1:5000/'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(1500);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const pageTarget = list.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const callbacks = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };
  await new Promise(r => ws.onopen = r);
  function call(method, params = {}) {
    return new Promise(r => {
      const msgId = id++;
      callbacks.set(msgId, r);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  await call('Page.enable');
  await call('Runtime.enable');
  await sleep(2500);

  // Click Runeword chip
  console.log('Filtering by Runeword...');
  await call('Runtime.evaluate', {
    expression: `document.querySelector('button[data-filter="quality"][data-value="Runeword"]')?.click()`
  });
  await sleep(1500);

  const scr = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/Games/d2sitems/screenshot_runewords.png', Buffer.from(scr.result.data, 'base64'));
  console.log('Saved screenshot_runewords.png');

  // Click Set chip
  console.log('Filtering by Set...');
  await call('Runtime.evaluate', {
    expression: `document.querySelector('button[data-filter="quality"][data-value="Set"]')?.click()`
  });
  await sleep(1500);

  const scrSet = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/Games/d2sitems/screenshot_sets.png', Buffer.from(scrSet.result.data, 'base64'));
  console.log('Saved screenshot_sets.png');

  ws.close();
  edgeProcess.kill();
}
run();
