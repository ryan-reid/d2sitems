import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9235;

console.log('Starting Edge on port ' + port + '...');
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
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {
        await sleep(250);
      }
    }

    if (!wsUrl) throw new Error('Could not connect to Edge debugger');

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
    await sleep(2000);

    // Switch to armory
    console.log('Switching to Armory...');
    await call('Runtime.evaluate', {
      expression: 'document.querySelector("button.nav-tab[data-tab=\'armory-view\']").click()'
    });
    await sleep(1500);

    // 1. Switch to Stackable Tab (authentic mod layout)
    console.log('Switching to Stackable Tab...');
    await call('Runtime.evaluate', {
      expression: 'window.switchD2RStashTab("stackable")'
    });
    await sleep(1200);

    const scrStackable = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_armory_stackable.png', Buffer.from(scrStackable.result.data, 'base64'));
    console.log('Saved screenshot_armory_stackable.png');

    // 2. Switch to Crafting Tab (authentic mod layout)
    console.log('Switching to Crafting Tab...');
    await call('Runtime.evaluate', {
      expression: 'window.switchD2RStashTab("crafting")'
    });
    await sleep(1200);

    const scrCrafting = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_armory_crafting_modlayout.png', Buffer.from(scrCrafting.result.data, 'base64'));
    console.log('Saved screenshot_armory_crafting_modlayout.png');

    // 3. Switch to Shared 1
    console.log('Switching to Shared 1...');
    await call('Runtime.evaluate', {
      expression: 'window.switchD2RStashTab("shared_0")'
    });
    await sleep(1000);

    const scr2 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_armory_shared1.png', Buffer.from(scr2.result.data, 'base64'));
    console.log('Saved screenshot_armory_shared1.png');

    // 4. Switch to Cube Tab
    console.log('Switching to Cube Tab...');
    await call('Runtime.evaluate', {
      expression: 'window.switchD2RStashTab("cube")'
    });
    await sleep(1000);

    const scr3 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_armory_cube.png', Buffer.from(scr3.result.data, 'base64'));
    console.log('Saved screenshot_armory_cube.png');

    ws.close();
  } catch (err) {
    console.error('Error in capture:', err);
  } finally {
    p.kill();
    process.exit(0);
  }
}

run();
