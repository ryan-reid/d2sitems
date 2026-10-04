// Keyboard and modal behavior shared across search and inventory views.
(() => {
  const filters = document.querySelector('details.filter-sidebar');
  if (filters && matchMedia('(max-width: 900px)').matches) filters.open = false;
  document.querySelectorAll('.modal-close').forEach(btn => {
    if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Close dialog');
  });
  const navTabs = [...document.querySelectorAll('.mast-nav .nav-tab')];
  const syncNav = () => navTabs.forEach(tab => {
    if (tab.classList.contains('active')) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  navTabs.forEach(tab => new MutationObserver(syncNav).observe(tab, { attributes: true, attributeFilter: ['class'] }));
  syncNav();
  const notice = document.getElementById('save-mode-notice');
  const editLog = [];
  function updateMode() {
    if (window.EditWorkspace?.active) {
      notice.textContent = `Edit mode · ${window.EditWorkspace.changes} staged operation(s). Changes are not saved yet. Use Save changes or Discard above.`;
      return;
    }
    if (!notice) return;
    const wasm = !!window.state?.isWasmMode;
    const base = wasm
      ? 'Browser session · Edits are stored in this browser. Export saves to apply them in game. Each imported folder starts a separate session.'
      : 'Local saves · Edits write to the selected save folder and create backups. Close the game before editing.';
    const saves = window.state?.saves?.length;
    const d2r = window._d2rState;
    const activeTab = String(d2r?.activeStashTab || '');
    const tabLabel = activeTab.startsWith('shared_') ? `shared stash tab ${Number(activeTab.slice(7)) + 1}` : activeTab;
    const active = d2r?.activeCharName ? ` Active: ${d2r.activeCharName}${tabLabel ? ' · ' + tabLabel : ''}.` : '';
    const loaded = (saves ? ` Loaded saves: ${saves}.` : '') + active;
    const edits = editLog.length
      ? wasm
        ? ` Unexported edits this session: ${editLog.length} (latest: ${editLog.at(-1).text}).`
        : ` Written this session: ${editLog.length} (latest: ${editLog.at(-1).text}).`
      : ' No edits this session.';
    notice.textContent = base + loaded + edits;
  }
  // Called by edit flows after a confirmed success so the banner reflects pending/written changes.
  window.recordEdit = text => { editLog.push({ text, time: Date.now() }); updateMode(); };
  window.updateSaveModeNotice = updateMode;
  updateMode();
  document.addEventListener('click', updateMode);
  setInterval(updateMode, 1500);

  // Transfer dialog: spell out exactly where the item goes and where the result is saved.
  const transferModal = document.getElementById('transfer-item-modal');
  const summary = document.getElementById('transfer-destination-summary');
  function updateTransferSummary() {
    if (!summary) return;
    const fileSel = document.getElementById('transfer-target-file-select');
    const contSel = document.getElementById('transfer-target-container-select');
    const auto = document.getElementById('transfer-autoplace-check');
    const file = fileSel?.selectedOptions[0]?.textContent || '(none)';
    const cont = contSel?.selectedOptions[0]?.textContent || '(none)';
    const slot = auto?.checked === false
      ? `slot (${document.getElementById('transfer-target-x').value || '?'}, ${document.getElementById('transfer-target-y').value || '?'})`
      : 'first available slot';
    const where = window.state?.isWasmMode
      ? 'Result is kept in this browser session until you export.'
      : 'Result is written to disk with a backup of both files.';
    summary.textContent = `Destination: ${file} → ${cont}, ${slot}. ${where}`;
  }
  if (transferModal) {
    transferModal.addEventListener('change', updateTransferSummary);
    transferModal.addEventListener('input', updateTransferSummary);
    new MutationObserver(updateTransferSummary).observe(transferModal, { attributes: true, attributeFilter: ['style'] });
  }
  const previousFocus = new WeakMap();
  const visible = element => element && getComputedStyle(element).display !== 'none';
  const dialogs = [...document.querySelectorAll('.modal-overlay')];
  const modalOrder = [];
  dialogs.forEach(dialog => {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = dialog.querySelector('h2, h3, .modal-title');
    if (heading) {
      heading.id ||= dialog.id + '-heading';
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    let wasVisible = visible(dialog);
    new MutationObserver(() => {
      const isVisible = visible(dialog);
      if (isVisible && !wasVisible) {
        previousFocus.set(dialog, document.activeElement);
        modalOrder.push(dialog);
        const focus = dialog.querySelector('button, input, select, [tabindex="0"]');
        focus?.focus();
      } else if (!isVisible && wasVisible) {
        const index = modalOrder.indexOf(dialog);
        if (index >= 0) modalOrder.splice(index, 1);
        previousFocus.get(dialog)?.focus();
      }
      wasVisible = isVisible;
    }).observe(dialog, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  document.addEventListener('keydown', event => {
    const active = modalOrder.filter(visible).at(-1);
    if (active && event.key === 'Escape') {
      active.style.display = 'none'; event.preventDefault(); event.stopPropagation();
    } else if (active && event.key === 'Tab') {
      const focusable = [...active.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
        .filter(el => !el.disabled && el.getClientRects().length);
      const index = focusable.indexOf(document.activeElement);
      if (focusable.length && (index < 0 || (!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index === 0))) {
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus(); event.preventDefault();
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.item-card, .d2r-item-element')) {
      event.preventDefault(); event.target.click();
    }
  }, true);
})();
