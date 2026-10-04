import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9236;

console.log('Testing Crafting tab with std count 5...');
const edgeProcess = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1050',
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
        const pageTarget = list.find(t => t.type === 'page');
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        await sleep(300);
      }
    }

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
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
        const id = msgId++;
        callbacks.set(id, r);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await call('Page.enable');
    await call('Runtime.enable');
    await sleep(2000);

    // Switch to Armory -> Crafting tab
    await call('Runtime.evaluate', {
      expression: `
        const armoryNav = Array.from(document.querySelectorAll('.nav-link, button')).find(el => el.textContent.includes('Armory'));
        if (armoryNav) armoryNav.click();
        if (window.switchD2RStashTab) window.switchD2RStashTab('crafting');
      `
    });
    await sleep(1500);

    const shot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_crafting_with_std.png', Buffer.from(shot.result.data, 'base64'));
    console.log('Saved screenshot_crafting_with_std.png');

    ws.close();
    edgeProcess.kill();
  } catch (err) {
    console.error(err);
    edgeProcess.kill();
    process.exit(1);
  }
}

run();
