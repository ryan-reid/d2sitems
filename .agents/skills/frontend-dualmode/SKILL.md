---
name: frontend-dualmode
description: >-
  Frontend state and dual-mode client execution runbook for d2sitems. Use this skill when
  implementing UI features in web/app.js, web/d2_armory.js, or web/editor.js, handling state
  synchronization across Local Server and Offline WebAssembly modes.
---

# Frontend State & Dual-Mode Client Runbook

The `d2sitems` explorer frontend operates in two distinct modes:
1. **Local Server Mode**: Interacts with `web_ui.py` over REST (`/api/...`), writing mutations directly to disk with transactional backup safeguards.
2. **Offline Browser WASM Mode**: Interacts with in-memory WebAssembly (`window.D2Wasm`), storing saves in IndexedDB and downloading files upon user export.

## 1. Dual-Mode Implementation Pattern

Every stateful user operation (item transfer, stack editing, character creation, profile management) must implement clean branching:

```javascript
if (state.isWasmMode && window.D2Wasm) {
  // 1. In-Memory WASM Execution
  const result = await window.D2Wasm.transferItem(payload);
  if (!result.success) throw new Error(result.message);
  
  // 2. Feedback & Session Edit Logging
  window.recordEdit?.('item transfer');
  showToast(`Transferred ${item.displayName}! Stored in browser session.`, 'success');
  
  // 3. UI State Refresh
  await refreshWasmDataset();
  await reloadArmoryData();
  return;
}

// Local Server REST Execution
const res = await fetch('/api/item/transfer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const data = await res.json();
if (!data.Success) throw new Error(data.Message || 'Transfer failed');

window.recordEdit?.('item transfer');
showToast(`Transferred ${item.displayName}! Save file backed up.`, 'success');
await loadSavesAndItems();
```

## 2. Session Edit Logging (`window.recordEdit`)
- `web/editor.js` tracks session mutations and updates `#save-mode-notice`.
- Call `window.recordEdit(actionName)` upon every confirmed mutation so the masthead banner immediately reflects pending or written edits.

## 3. Pre-Mutation User Confirmations
- Drag-and-drop transfers in `web/d2_armory.js` must present a confirmation dialog detailing:
  - Item name and base.
  - Destination file, container, tab, and grid coordinates.
  - Save mode note (browser session vs. disk write with backup).
- Canceling the confirmation must abort the operation cleanly with zero mutations.

## 4. Modal Dialog Standards
- All modal dialogs must have `role="dialog"` and `aria-modal="true"`.
- Focus must be trapped inside active modals.
- Hitting `Escape` must close the top-most modal and restore focus to the triggering element.
- Icon-only close buttons (`✕`) must have explicit `aria-label="Close dialog"`.
