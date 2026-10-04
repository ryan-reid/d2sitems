import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9240;

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

    // Switch to in-game armory
    console.log('Switching to In-Game Armory...');
    await call('Runtime.evaluate', {
      expression: 'document.querySelector("button.nav-tab[data-tab=\'armory-view\']").click()'
    });
    await sleep(1500);

    // Select Sorceress
    console.log('Selecting Sorceress...');
    await call('Runtime.evaluate', {
      expression: `
        const sel = document.getElementById('armory-char-select');
        for (let opt of sel.options) {
          if (opt.text.includes('Sorceress')) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
            break;
          }
        }
      `
    });
    await sleep(2000);

    // 1. Capture Sorceress Primary Weapons (Swap I)
    const scrSorcSwap1 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_sorceress_swap1.png', Buffer.from(scrSorcSwap1.result.data, 'base64'));
    console.log('Saved screenshot_sorceress_swap1.png');

    // 2. Click Weapon Swap II
    console.log('Toggling Weapon Swap II...');
    await call('Runtime.evaluate', {
      expression: 'window.toggleD2RWeaponSwap(2)'
    });
    await sleep(1000);

    const scrSorcSwap2 = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_sorceress_swap2.png', Buffer.from(scrSorcSwap2.result.data, 'base64'));
    console.log('Saved screenshot_sorceress_swap2.png');

    // 3. Open Mercenary Modal
    console.log('Opening Mercenary Modal...');
    await call('Runtime.evaluate', {
      expression: 'window.toggleD2RMercModal()'
    });
    await sleep(1000);

    const scrSorcMerc = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_sorceress_merc.png', Buffer.from(scrSorcMerc.result.data, 'base64'));
    console.log('Saved screenshot_sorceress_merc.png');

    ws.close();
  } catch (err) {
    console.error('Error in capture:', err);
  } finally {
    p.kill();
    process.exit(0);
  }
}

run();
