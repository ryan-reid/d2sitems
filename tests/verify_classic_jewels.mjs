import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9250;

const proc = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1050',
  'http://127.0.0.1:5000/'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(2500);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const cbs = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (cbs.has(m.id)) {
      cbs.get(m.id)(m);
      cbs.delete(m.id);
    }
  };

  const call = (method, params = {}) => new Promise(r => {
    const i = id++;
    cbs.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await call('Page.enable');
  await call('Runtime.enable');
  await sleep(1500);

  // Click Shared 5
  await call('Runtime.evaluate', {
    expression: `
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Shared 5'));
      if (btn) btn.click();
    `
  });
  await sleep(1000);

  // Toggle to Classic mode
  await call('Runtime.evaluate', {
    expression: `
      const toggle = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('(G)'));
      if (toggle) toggle.click();
    `
  });
  await sleep(1000);

  const shotClassic = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('screenshot_colossal_jewels_classic.png', Buffer.from(shotClassic.result.data, 'base64'));
  console.log('Saved screenshot_colossal_jewels_classic.png');

  ws.close();
  proc.kill();
}

run();
