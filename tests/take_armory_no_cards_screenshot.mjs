import { spawn } from 'child_process';
import fs from 'fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9238;

console.log('Starting Edge on port ' + port + '...');
const p = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1500,1100',
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

    // Select Sorceress if not selected
    await call('Runtime.evaluate', {
      expression: `(() => {
        const sel = document.getElementById('armory-char-select');
        if (sel) {
          for (let opt of sel.options) {
            if (opt.value === 'Sorceress' || opt.textContent.includes('Sorceress')) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change'));
              break;
            }
          }
        }
      })()`
    });
    await sleep(2000);

    // Check if card toggle exists in DOM
    const cardToggleCheck = await call('Runtime.evaluate', {
      expression: '({ hasToggleContainer: !!document.querySelector(".d2r-view-toggle"), hasCardBtn: !!document.getElementById("view-toggle-cards"), hasPanelsBtn: !!document.getElementById("view-toggle-panels") })',
      returnByValue: true
    });
    console.log('Card toggle check result:', cardToggleCheck.result.value);

    // Capture screenshot
    const scr = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_armory_no_cards.png', Buffer.from(scr.result.data, 'base64'));
    console.log('Saved screenshot_armory_no_cards.png');

    ws.close();
  } catch (err) {
    console.error('Error in capture:', err);
  } finally {
    p.kill();
    process.exit(0);
  }
}

run();
