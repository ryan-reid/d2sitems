import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9227;

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
  await sleep(2000);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const pageTarget = list.find(t => t.type === 'page' && t.url !== 'about:blank') || list[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  await new Promise(r => ws.onopen = r);
  let msgId = 1;
  const callbacks = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };
  function call(method, params = {}) {
    return new Promise(resolve => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await call('Page.enable');
  await sleep(1500);

  // Click mode-detail-btn
  await call('Runtime.evaluate', { expression: 'document.getElementById("mode-detail-btn")?.click()' });
  await sleep(1200);

  const screenshotRes = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/Games/d2sitems/screenshot_detailed_grid.png', Buffer.from(screenshotRes.result.data, 'base64'));
  console.log('Detailed grid screenshot saved!');
  ws.close();
  edgeProcess.kill();
}
run();
