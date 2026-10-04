import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9240;

console.log('Starting Headless Edge for Colossal Jewel Verification...');
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

    // 1. Switch to Armory view and select Shared Stash Tab 5 (index 4 or 5)
    console.log('Navigating to Armory -> Shared Tab 5...');
    await call('Runtime.evaluate', {
      expression: `
        const armoryNav = Array.from(document.querySelectorAll('.nav-link, button')).find(el => el.textContent.includes('Armory'));
        if (armoryNav) armoryNav.click();
      `
    });
    await sleep(1500);

    // Click on Shared Stash tab 5
    await call('Runtime.evaluate', {
      expression: `
        const tabBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Shared 5'));
        if (tabBtn) tabBtn.click();
      `
    });
    await sleep(1500);

    // Extract item data on the current stash tab
    const evalRes = await call('Runtime.evaluate', {
      expression: `
        (() => {
          const items = Array.from(document.querySelectorAll('#stash-tab-content img, .d2r-stash-grid img, .stash-grid img')).map(img => {
            const container = img.closest('[title], [data-name], [data-item-name]') || img;
            return {
              title: container.getAttribute('title') || container.getAttribute('data-name') || container.getAttribute('data-item-name') || img.alt || '',
              src: img.src,
              imgName: img.src.split('/').pop()
            };
          }).filter(it => it.title.toLowerCase().includes('jewel') || it.title.toLowerCase().includes('defender') || it.title.toLowerCase().includes('guardian') || it.title.toLowerCase().includes('protector') || it.imgName.includes('diamond') || it.imgName.includes('jewel') || it.imgName.includes('cjw') || it.imgName.includes('invgsw'));
          return JSON.stringify(items);
        })()
      `,
      returnByValue: true
    });

    console.log('Rendered Jewel Items on Tab:');
    console.log(evalRes.result ? evalRes.result.value : 'No result');

    // Capture screenshot
    console.log('Capturing screenshot of Shared Tab 5...');
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_colossal_jewels_tab5.png', Buffer.from(shot.result.data, 'base64'));
    console.log('Saved screenshot_colossal_jewels_tab5.png');

    ws.close();
    edgeProcess.kill();
    console.log('Colossal jewel verification finished successfully.');
  } catch (err) {
    console.error('Error during verification:', err);
    edgeProcess.kill();
    process.exit(1);
  }
}

run();
