import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9228;

console.log('Starting Headless Edge for Full Verification Suite...');
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

    // 1. Capture Items Grid (Wiki-style item cards)
    console.log('1. Capturing Items Grid...');
    const scrItems = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_items.png', Buffer.from(scrItems.result.data, 'base64'));
    console.log('Saved screenshot_verified_items.png');

    // 2. Search for Rainbow Facet
    console.log('2. Searching for Rainbow Facet...');
    await call('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          const input = document.getElementById('search-input');
          if (input) input.value = 'Rainbow Facet';
          state.filters.q = 'Rainbow Facet';
          await executeSearch();
        })()
      `
    });
    await sleep(1200);
    const scrFacet = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_rainbow_facet.png', Buffer.from(scrFacet.result.data, 'base64'));
    console.log('Saved screenshot_verified_rainbow_facet.png');

    // 3. Search for Defender's Jewels
    console.log('3. Searching for Defender...');
    await call('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          const input = document.getElementById('search-input');
          if (input) input.value = 'Defender';
          state.filters.q = 'Defender';
          await executeSearch();
        })()
      `
    });
    await sleep(1200);
    const scrDefender = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_defender.png', Buffer.from(scrDefender.result.data, 'base64'));
    console.log('Saved screenshot_verified_defender.png');

    // 4. Search for Gheed's Fortune
    console.log('4. Searching for Gheed...');
    await call('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          const input = document.getElementById('search-input');
          if (input) input.value = 'Gheed';
          state.filters.q = 'Gheed';
          await executeSearch();
        })()
      `
    });
    await sleep(1200);
    const scrGheed = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_gheed.png', Buffer.from(scrGheed.result.data, 'base64'));
    console.log('Saved screenshot_verified_gheed.png');

    // 5. Switch to In-Game Armory View
    console.log('5. Switching to In-Game Armory...');
    await call('Runtime.evaluate', {
      expression: `
        const armoryBtn = document.querySelector('button.nav-tab[data-tab="armory-view"]');
        if (armoryBtn) armoryBtn.click();
      `
    });
    await sleep(1500);

    // 6. View Shared Tab 1
    console.log('6. Viewing Shared Tab 1...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.switchD2RSharedSubTab) window.switchD2RSharedSubTab(0);
      `
    });
    await sleep(1200);
    const scrShared = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_shared.png', Buffer.from(scrShared.result.data, 'base64'));
    console.log('Saved screenshot_verified_shared.png');

    // 7. Switch to Crafting Tab
    console.log('7. Switching to Crafting Tab...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.switchD2RStashTab) window.switchD2RStashTab('crafting');
      `
    });
    await sleep(1200);
    const scrCrafting = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_crafting.png', Buffer.from(scrCrafting.result.data, 'base64'));
    console.log('Saved screenshot_verified_crafting.png');

    // 8. Switch to Stackable Tab
    console.log('8. Switching to Stackable Tab...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.switchD2RStashTab) window.switchD2RStashTab('stackable');
      `
    });
    await sleep(1200);
    const scrStackable = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_verified_stackable.png', Buffer.from(scrStackable.result.data, 'base64'));
    console.log('Saved screenshot_verified_stackable.png');

    ws.close();
    console.log('All verification screenshots captured successfully!');
  } catch (err) {
    console.error('Error during verification suite:', err);
  } finally {
    edgeProcess.kill();
  }
}

run();
