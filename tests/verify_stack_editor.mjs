import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9235;

console.log('Starting Headless Edge for Stack Editor Verification...');
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

    if (!wsUrl) throw new Error('Could not connect to Edge debugger');

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
    await sleep(2500);

    // 1. Switch to Armory view and select Stackable tab
    console.log('Navigating to Armory -> Stackable Tab...');
    await call('Runtime.evaluate', {
      expression: `
        const armoryNav = Array.from(document.querySelectorAll('.nav-link, button')).find(el => el.textContent.includes('Armory'));
        if (armoryNav) armoryNav.click();
        if (window.switchD2RStashTab) window.switchD2RStashTab('stackable');
      `
    });
    await sleep(1500);

    // Capture screenshot of Stackable tab with Standard of Heroes (5)
    console.log('Capturing screenshot of Stackable tab...');
    const shot1 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_stackable_with_std.png', Buffer.from(shot1.result.data, 'base64'));
    console.log('Saved screenshot_stackable_with_std.png');

    // 2. Open the Edit Stack Modal for Standard of Heroes
    console.log('Opening Edit Stack Modal for std...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.openEditStackModalByCode) {
          window.openEditStackModalByCode('std', 'Standard of Heroes', 5, 5);
        }
      `
    });
    await sleep(800);

    // Capture screenshot of the Edit Stack Modal
    console.log('Capturing screenshot of Edit Stack Modal...');
    const shot2 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_edit_stack_modal.png', Buffer.from(shot2.result.data, 'base64'));
    console.log('Saved screenshot_edit_stack_modal.png');

    ws.close();
    edgeProcess.kill();
    console.log('Verification suite finished successfully.');
  } catch (err) {
    console.error('Error during verification:', err);
    edgeProcess.kill();
    process.exit(1);
  }
}

run();
