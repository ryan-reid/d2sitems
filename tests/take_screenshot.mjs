import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9225;

console.log('Starting Headless Edge for Screenshot...');
const edgeProcess = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1100',
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

    let pageLoaded = false;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired') {
        pageLoaded = true;
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

    for (let i = 0; i < 40 && !pageLoaded; i++) {
      await sleep(200);
    }

    // Wait for items to be loaded
    console.log('Waiting for item cards to render...');
    for (let i = 0; i < 30; i++) {
      const cardCount = await call('Runtime.evaluate', {
        expression: 'document.querySelectorAll(".item-card").length'
      });
      const count = cardCount.result?.result?.value || 0;
      if (count > 0) {
        console.log(`Found ${count} item cards in DOM.`);
        break;
      }
      await sleep(300);
    }

    // Allow sprites to load
    await sleep(1500);

    const screenshotRes = await call('Page.captureScreenshot', { format: 'png' });
    const imgBuffer = Buffer.from(screenshotRes.result.data, 'base64');
    const outPath = path.resolve('E:/Games/d2sitems/screenshot_current.png');
    fs.writeFileSync(outPath, imgBuffer);
    console.log(`Screenshot saved to: ${outPath}`);

    // Click first item card to open modal and take screenshot of modal too
    await call('Runtime.evaluate', {
      expression: 'document.querySelector(".item-card")?.click()'
    });
    await sleep(600);

    const modalScreenshotRes = await call('Page.captureScreenshot', { format: 'png' });
    const modalImgBuffer = Buffer.from(modalScreenshotRes.result.data, 'base64');
    const modalOutPath = path.resolve('E:/Games/d2sitems/screenshot_modal_current.png');
    fs.writeFileSync(modalOutPath, modalImgBuffer);
    console.log(`Modal screenshot saved to: ${modalOutPath}`);

    ws.close();
  } catch (err) {
    console.error('Error taking screenshot:', err);
  } finally {
    edgeProcess.kill();
  }
}

run();
