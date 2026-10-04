import { spawn } from 'child_process';
import fs from 'fs';

const port = 9237;
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const p = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1200',
  'http://127.0.0.1:5000/'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        const page = list.find(t => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch (e) { await sleep(250); }
    }
    if (!wsUrl) throw new Error('Could not connect to Edge');
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const cbs = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && cbs.has(m.id)) { cbs.get(m.id)(m); cbs.delete(m.id); }
    };
    await new Promise(r => ws.onopen = r);
    function call(method, params = {}) {
      return new Promise(r => {
        const mid = id++;
        cbs.set(mid, r);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    }
    await call('Page.enable');
    await call('Runtime.enable');
    await sleep(3500);

    // 0. Screenshot Armory
    await call('Runtime.evaluate', { expression: `document.querySelector('.nav-tab[data-tab="armory-view"]').click()` });
    await sleep(2000);
    await call('Runtime.evaluate', { expression: `if (window.switchD2RSharedSubTab) window.switchD2RSharedSubTab(0);` });
    await sleep(1000);
    const armorySnap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_armory_shared1.png', Buffer.from(armorySnap.result.data, 'base64'));
    console.log('Saved screenshot_armory_shared1.png');

    // 1. Screenshot Grail
    await call('Runtime.evaluate', { expression: `document.querySelector('.nav-tab[data-tab="grail-view"]').click()` });
    await sleep(1500);
    const grailSnap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_grail_current.png', Buffer.from(grailSnap.result.data, 'base64'));
    console.log('Saved screenshot_grail_current.png');

    // 2. Screenshot Verifier
    await call('Runtime.evaluate', { expression: `document.querySelector('.nav-tab[data-tab="verifier-view"]').click()` });
    await sleep(1500);
    const verSnap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_verifier_current.png', Buffer.from(verSnap.result.data, 'base64'));
    console.log('Saved screenshot_verifier_current.png');

    // 3. Screenshot Create Item Modal
    await call('Runtime.evaluate', { expression: `document.getElementById('edit-start').click()` });
    await sleep(1000);
    await call('Runtime.evaluate', { expression: `document.getElementById('create-item').click()` });
    await sleep(1000);
    const createSnap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_create_modal_current.png', Buffer.from(createSnap.result.data, 'base64'));
    console.log('Saved screenshot_create_modal_current.png');

    ws.close();
  } catch (err) {
    console.error(err);
  } finally {
    p.kill();
  }
}
run();
