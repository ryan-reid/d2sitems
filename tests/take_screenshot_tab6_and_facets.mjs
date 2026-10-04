import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9227;

console.log('Starting Headless Edge for Verification Screenshots...');
const edgeProcess = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1100',
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

    // 1. Search for Rainbow Facet
    console.log('Searching for Rainbow Facet...');
    await call('Runtime.evaluate', {
      expression: `
        const input = document.getElementById('search-input');
        if (input) {
          input.value = 'Rainbow Facet';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `
    });
    await sleep(1500);

    const scrFacet = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_rainbow_facets.png', Buffer.from(scrFacet.result.data, 'base64'));
    console.log('Saved screenshot_rainbow_facets.png');

    // 2. Search for Defender's Jewels
    console.log('Searching for Defender...');
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
    await sleep(1000);

    const scrDefender = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_defenders_jewels.png', Buffer.from(scrDefender.result.data, 'base64'));
    console.log('Saved screenshot_defenders_jewels.png');

    // 3. Switch to In-Game Armory tab
    console.log('Switching to In-Game Armory view...');
    await call('Runtime.evaluate', {
      expression: `
        const armoryBtn = document.querySelector('button.nav-tab[data-tab="armory-view"]');
        if (armoryBtn) armoryBtn.click();
      `
    });
    await sleep(1500);

    // 4. Switch to Shared Stash Tab 6
    console.log('Switching to Shared Stash Tab 6...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.switchD2RStashTab) {
          window.switchD2RStashTab('shared_5');
        }
      `
    });
    await sleep(1500);

    const scrTab6Cat = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_tab6_categorized.png', Buffer.from(scrTab6Cat.result.data, 'base64'));
    console.log('Saved screenshot_tab6_categorized.png');

    // 5. Switch to Grid Flow mode
    console.log('Switching to Grid Flow mode...');
    await call('Runtime.evaluate', {
      expression: `
        if (window.setD2RStackedViewMode) {
          window.setD2RStackedViewMode('grid');
        }
      `
    });
    await sleep(1500);

    const scrTab6Grid = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('E:/Games/d2sitems/screenshot_tab6_grid.png', Buffer.from(scrTab6Grid.result.data, 'base64'));
    console.log('Saved screenshot_tab6_grid.png');

    ws.close();
  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    edgeProcess.kill();
  }
}

run();
