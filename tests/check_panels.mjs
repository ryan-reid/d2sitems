import { spawn } from 'child_process';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9230;

const p = spawn(edgePath, [
  '--headless',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,1100',
  'http://127.0.0.1:5000/'
]);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await sleep(2000);
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  await call('Runtime.evaluate', {
    expression: 'document.querySelector("button.nav-tab[data-tab=\'armory-view\']").click()'
  });
  await sleep(1500);

  // Switch to Tab 6
  await call('Runtime.evaluate', {
    expression: 'window.switchD2RStashTab("shared_5")'
  });
  await sleep(1000);

  const evalRes = await call('Runtime.evaluate', {
    expression: `(() => {
      const left = document.getElementById("d2r-left-panel");
      const right = document.getElementById("d2r-right-panel");
      const container = document.querySelector(".d2r-panels-container");
      return {
        container: container ? { w: container.offsetWidth, h: container.offsetHeight } : null,
        left: left ? { w: left.offsetWidth, h: left.offsetHeight, top: left.offsetTop, left: left.offsetLeft } : null,
        right: right ? { w: right.offsetWidth, h: right.offsetHeight, top: right.offsetTop, left: right.offsetLeft } : null,
        tabs: Array.from(document.querySelectorAll(".d2r-tab-btn")).map(b => b.textContent.trim())
      };
    })()`,
    returnByValue: true
  });

  console.log('PANEL INFO:', JSON.stringify(evalRes.result?.result?.value, null, 2));

  // Now click Cube tab and inspect
  await call('Runtime.evaluate', {
    expression: 'window.switchD2RStashTab("cube")'
  });
  await sleep(1000);

  const cubeEvalRes = await call('Runtime.evaluate', {
    expression: `(() => {
      const cubeGrid = document.getElementById("d2r-cube-grid");
      const cubeItems = cubeGrid ? cubeGrid.children.length : 0;
      const left = document.getElementById("d2r-left-panel");
      const right = document.getElementById("d2r-right-panel");
      return {
        cubeGrid: cubeGrid ? { w: cubeGrid.offsetWidth, h: cubeGrid.offsetHeight, itemsCount: cubeItems } : null,
        left: left ? { w: left.offsetWidth, h: left.offsetHeight, top: left.offsetTop } : null,
        right: right ? { w: right.offsetWidth, h: right.offsetHeight, top: right.offsetTop } : null
      };
    })()`,
    returnByValue: true
  });

  console.log('CUBE TAB INFO:', JSON.stringify(cubeEvalRes.result?.result?.value, null, 2));

  ws.close();
  p.kill();
}

run();
