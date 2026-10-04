import { spawn } from 'child_process';
import fs from 'fs';

const port = 9245;
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

    // TEST 1: Holy Grail Filters (Collected Only, Missing Only, and Modal opening)
    console.log('[Test 1] Testing Holy Grail...');
    await call('Runtime.evaluate', { expression: `document.querySelector('.nav-tab[data-tab="grail-view"]').click()` });
    await sleep(1500);

    // Click "Collected Only"
    await call('Runtime.evaluate', { expression: `document.querySelector('[data-grail-filter="collected"]').click()` });
    await sleep(800);
    const snapGrailCollected = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_grail_collected.png', Buffer.from(snapGrailCollected.result.data, 'base64'));
    console.log('Saved screenshot_grail_collected.png');

    // Click "Missing Only"
    await call('Runtime.evaluate', { expression: `document.querySelector('[data-grail-filter="missing"]').click()` });
    await sleep(800);
    const snapGrailMissing = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_grail_missing.png', Buffer.from(snapGrailMissing.result.data, 'base64'));
    console.log('Saved screenshot_grail_missing.png');

    // TEST 2: Item Verifier Filters
    console.log('[Test 2] Testing Item Verifier...');
    await call('Runtime.evaluate', { expression: `document.querySelector('.nav-tab[data-tab="verifier-view"]').click()` });
    await sleep(1500);

    // Click "Below Min Only"
    await call('Runtime.evaluate', { expression: `document.querySelector('[data-verifier-issue="below"]').click()` });
    await sleep(800);
    const snapVerBelow = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_verifier_below.png', Buffer.from(snapVerBelow.result.data, 'base64'));
    console.log('Saved screenshot_verifier_below.png');

    // TEST 3: Create Item Modal with Selected Item
    console.log('[Test 3] Testing Create Item Modal with selected definition...');
    await call('Runtime.evaluate', { expression: `document.getElementById('edit-start').click()` });
    await sleep(1000);
    await call('Runtime.evaluate', { expression: `document.getElementById('create-item').click()` });
    await sleep(800);
    // Select first option in definition dropdown
    await call('Runtime.evaluate', { expression: `
      const sel = document.getElementById('new-item-definition');
      if (sel && sel.options.length > 1) {
        sel.selectedIndex = 1;
        sel.dispatchEvent(new Event('change'));
      }
    ` });
    await sleep(1000);
    const snapModalPopulated = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_create_modal_populated.png', Buffer.from(snapModalPopulated.result.data, 'base64'));
    console.log('Saved screenshot_create_modal_populated.png');

    // TEST 4: Armory Weapon Swap Toggle
    console.log('[Test 4] Testing Armory Weapon Swap Toggle...');
    // Close modal
    await call('Runtime.evaluate', { expression: `
      const dlg = document.getElementById('item-creator-dialog');
      if (dlg) dlg.close();
      const cancelBtn = document.getElementById('edit-discard');
      if (cancelBtn) cancelBtn.click();
      document.querySelector('.nav-tab[data-tab="armory-view"]').click();
    ` });
    await sleep(1500);
    // Toggle weapon swap
    await call('Runtime.evaluate', { expression: `
      const swapBtns = document.querySelectorAll('.d2r-swap-btn');
      if (swapBtns.length > 1) swapBtns[1].click();
    ` });
    await sleep(800);
    const snapSwap = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshot_armory_swap2.png', Buffer.from(snapSwap.result.data, 'base64'));
    console.log('Saved screenshot_armory_swap2.png');

    ws.close();
  } catch (err) {
    console.error(err);
  } finally {
    p.kill();
  }
}
run();
