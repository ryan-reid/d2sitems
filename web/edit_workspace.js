/* Staged editing: no disk writes or downloads until Save. */
(() => {
  const workspace = window.EditWorkspace = { active: false, busy: false, token: null, changes: 0 };
  const bar = document.createElement('section');
  bar.className = 'edit-workspace-bar';
  bar.innerHTML = '<button id="edit-start" class="btn btn-primary">Edit mode</button><span id="edit-status" role="status">Browse mode · Turn on Edit mode to move items.</span><button id="edit-save" class="btn btn-primary" hidden>Save changes</button><button id="edit-discard" class="btn btn-secondary" hidden>Discard</button><button id="create-item" class="btn btn-secondary" hidden>Create item</button><button id="mule-organizer" class="btn btn-secondary">Mule assignments & bulk pack</button>';
  document.querySelector('.masthead').after(bar);
  const el = id => document.getElementById(id);
  const refresh = async () => {
    await window.refreshWasmDataset();
  };
  const update = () => {
    el('edit-start').hidden = workspace.active;
    el('edit-save').hidden = el('edit-discard').hidden = !workspace.active;
    el('create-item').hidden = !workspace.active;
    el('edit-status').textContent = workspace.active
      ? `Edit mode · ${workspace.changes} staged operation(s) · Save commits and downloads changed files`
      : 'Browse mode · Turn on Edit mode to move items.';
    for (const id of ['core-select', 'profile-select', 'wasm-pick-folder-btn', 'rescan-btn']) if (el(id)) el(id).disabled = workspace.active;
  };
  workspace.changed = () => { workspace.changes++; update(); };
  workspace.start = async () => {
    if (workspace.active) return;
    const selectedSource = el('character-filter')?.value || state.filters.source;
    const selectedChar = state.selectedChar || window._d2rState?.activeCharName || el('armory-char-select')?.value;
    if (window.D2Wasm) {
      await window.D2Wasm.init();
      window.D2Wasm.editOriginals = new Map(window.D2Wasm.loadedFiles);
    }
    try {
      workspace.chronicleOriginal = localStorage.getItem('bk-chronicle-manual');
    } catch (e) {
      workspace.chronicleOriginal = null;
    }
    workspace.chronicleDraft = workspace.chronicleOriginal;
    workspace.hasChronicleChanges = false;
    workspace.active = true; workspace.changes = 0; update();
    if (selectedChar) {
      state.selectedChar = selectedChar;
      if (window._d2rState) window._d2rState.activeCharName = selectedChar;
    }
    await refresh();
    if (selectedSource && selectedSource !== 'all' && [...(el('character-filter')?.options || [])].some(o => o.value === selectedSource)) {
      state.filters.source = selectedSource;
      el('character-filter').value = selectedSource;
      if (typeof window.executeSearch === 'function') window.executeSearch();
    }
    if (selectedChar && el('armory-char-select') && [...(el('armory-char-select')?.options || [])].some(o => o.value === selectedChar)) {
      el('armory-char-select').value = selectedChar;
      if (state.activeTab === 'armory-view' && window.reloadArmoryData) await window.reloadArmoryData();
    }
  };
  workspace.finish = async save => {
    if (!workspace.active) return;
    if (workspace.busy) throw new Error('Wait for the current move to finish.');
    workspace.busy = true;
    const selectedSource = el('character-filter')?.value || state.filters.source;
    const selectedChar = state.selectedChar || window._d2rState?.activeCharName || el('armory-char-select')?.value;
    try {
      if (window.D2Wasm) {
        const engine = window.D2Wasm;
        const originals = engine.editOriginals;
        const draft = engine.loadedFiles;
        const changes = [...draft].filter(([name, bytes]) => {
          const old = originals.get(name);
          return !old || old.length !== bytes.length || bytes.some((b, i) => b !== old[i]);
        });
        if (save) {
          engine.editOriginals = null; engine.loadedFiles = originals;
          try { await engine.commitFiles(changes); }
          catch (error) { engine.loadedFiles = draft; engine.editOriginals = originals; throw error; }
          if (changes.length > 3) {
            await engine.downloadModifiedSaves(changes.map(([name, bytes]) => ({ name, bytes })));
          } else {
            for (const [name, bytes] of changes) engine.downloadFile(name, bytes);
            await engine.markFilesAsExported(changes.map(([name]) => name));
          }
        } else { engine.loadedFiles = originals; engine.editOriginals = null; }
      }
      if (workspace.hasChronicleChanges) {
        if (save) {
          try {
            if (workspace.chronicleDraft !== null && workspace.chronicleDraft !== undefined) {
              localStorage.setItem('bk-chronicle-manual', workspace.chronicleDraft);
            } else {
              localStorage.removeItem('bk-chronicle-manual');
            }
          } catch (e) {
            console.warn('[EditWorkspace] Could not save chronicle completions:', e);
          }
        } else {
          try {
            if (workspace.chronicleOriginal !== null && workspace.chronicleOriginal !== undefined) {
              localStorage.setItem('bk-chronicle-manual', workspace.chronicleOriginal);
            } else {
              localStorage.removeItem('bk-chronicle-manual');
            }
          } catch (e) {
            console.warn('[EditWorkspace] Could not restore chronicle completions:', e);
          }
        }
      }
      const hadChronicleChanges = workspace.hasChronicleChanges;
      workspace.chronicleDraft = null;
      workspace.chronicleOriginal = null;
      workspace.hasChronicleChanges = false;
      workspace.active = false; workspace.token = null; workspace.changes = 0; update();
      if (hadChronicleChanges && typeof window.loadChronicleView === 'function') {
        await window.loadChronicleView();
      }
      if (typeof window.clearEditLog === 'function') window.clearEditLog();
      if (typeof window.updateExportButtonState === 'function') window.updateExportButtonState();
      if (selectedChar) {
        state.selectedChar = selectedChar;
        if (window._d2rState) window._d2rState.activeCharName = selectedChar;
      }
      await refresh();
      if (selectedSource && selectedSource !== 'all' && [...(el('character-filter')?.options || [])].some(o => o.value === selectedSource)) {
        state.filters.source = selectedSource;
        el('character-filter').value = selectedSource;
        if (typeof window.executeSearch === 'function') window.executeSearch();
      }
      if (selectedChar && el('armory-char-select') && [...(el('armory-char-select')?.options || [])].some(o => o.value === selectedChar)) {
        el('armory-char-select').value = selectedChar;
        if (state.activeTab === 'armory-view' && window.reloadArmoryData) await window.reloadArmoryData();
      }
      window.showToast(save ? 'Changes saved.' : 'Staged changes discarded.', 'success');
    } finally { workspace.busy = false; }
  };
  const run = action => async () => {
    try { await action(); } catch (error) { window.showToast(error.message, 'error'); }
  };
  el('edit-start').onclick = run(workspace.start);
  el('edit-save').onclick = run(() => workspace.finish(true));
  el('edit-discard').onclick = run(() => workspace.finish(false));
  let cachedUniqueCatalog = null;
  const loadUniqueCatalog = async () => {
    if (cachedUniqueCatalog) return cachedUniqueCatalog;
    try {
      const res = await fetch('unique_items_catalog.json');
      if (res.ok) {
        cachedUniqueCatalog = await res.json();
        return cachedUniqueCatalog;
      }
    } catch (e) {
      console.warn('[EditWorkspace] Could not load unique_items_catalog.json:', e);
    }
    return [];
  };

  const creator = document.createElement('dialog');
  creator.id = 'item-creator-dialog';
  creator.innerHTML = `
    <div class="creator-header">
      <h2>Create BKDiablo Item</h2>
      <p>Select a unique item to configure stats and stage into your save.</p>
    </div>
    <div class="creator-grid creator-top-row">
      <label>
        Target Save
        <select id="new-item-source"></select>
      </label>
      <label class="creator-combobox-label">
        Item / Unique Definition
        <div class="creator-combobox-wrap" id="creator-combobox-wrap">
          <div class="creator-combobox-control">
            <input
              type="text"
              id="new-item-search"
              class="creator-combobox-input"
              placeholder="Search or select unique item..."
              autocomplete="off"
              spellcheck="false"
              role="combobox"
              aria-expanded="false"
              aria-autocomplete="list"
              aria-controls="new-item-combobox-list"
            >
            <div class="creator-combobox-buttons">
              <button type="button" id="new-item-combobox-clear" class="creator-combobox-btn creator-combobox-clear" title="Clear selection" tabindex="-1" style="display:none;">✕</button>
              <button type="button" id="new-item-combobox-toggle" class="creator-combobox-btn creator-combobox-toggle" title="Toggle item list" tabindex="-1">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
          </div>
          <div id="new-item-combobox-list" class="creator-combobox-list" role="listbox" hidden></div>
          <select id="new-item-definition" style="display:none;" tabindex="-1"></select>
        </div>
      </label>
    </div>

    <div id="creator-empty-prompt" class="creator-empty-prompt">
      <div class="creator-empty-icon">⚔</div>
      <h3>Search or Select an Item Above</h3>
      <p>Type an item name, base type (e.g. Shako, Amulet), or rune code to preview properties and configure rolls.</p>
    </div>

    <div id="creator-item-card" class="creator-card" hidden>
      <div class="creator-card-header">
        <span id="card-item-name" class="creator-card-title"></span>
        <div class="creator-card-meta">
          <span id="card-base-name" class="creator-tag"></span>
          <span id="card-req-lvl" class="creator-tag req"></span>
          <span id="card-item-lvl" class="creator-tag"></span>
          <span id="card-ethereal-tag" class="creator-tag ethereal" style="color: #60a5fa; border-color: rgba(96,165,250,0.4); background: rgba(96,165,250,0.15);" hidden>Ethereal</span>
        </div>
      </div>
    </div>

    <div id="creator-custom-section" class="creator-card" hidden>
      <div class="creator-grid">
        <label>Item Code (3 chars) <input id="new-item-code" maxlength="3" placeholder="r01"></label>
        <label>Quality <select id="new-item-quality"><option value="Normal">Normal</option><option value="Magic">Magic</option><option value="Rare">Rare</option></select></label>
      </div>
    </div>

    <div id="creator-placement-section" class="creator-card" style="margin-top: -4px; margin-bottom: 12px; padding: 8px 12px;" hidden>
      <div class="creator-placement" style="margin-top: 0; justify-content: flex-start; flex-wrap: wrap;">
        <label>
          <input type="checkbox" id="new-item-autoplace" checked>
          Auto-place in first available inventory slot
        </label>
        <label class="creator-ethereal-opt" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
          <input type="checkbox" id="new-item-ethereal">
          Ethereal (Cannot be Repaired)
        </label>
        <span id="creator-coords-wrap" class="creator-coords" hidden>
          X: <input id="new-item-x" type="number" min="0" max="15" value="0">
          Y: <input id="new-item-y" type="number" min="0" max="15" value="0">
        </span>
      </div>
    </div>

    <div id="creator-stats-section" hidden>
      <div class="creator-toolbar">
        <span class="creator-toolbar-title">Item Properties & Rolls</span>
        <button type="button" id="preset-perfect" class="btn btn-sm btn-secondary">★ Perfect</button>
        <button type="button" id="preset-min" class="btn btn-sm btn-secondary">Min</button>
        <button type="button" id="preset-random" class="btn btn-sm btn-secondary">🎲 Random</button>
      </div>
      <div id="new-item-stats-container" class="creator-stats-list"></div>
    </div>

    <div class="creator-footer">
      <span id="new-item-status" class="creator-status-msg" role="status"></span>
      <button id="new-item-submit" class="btn btn-primary" disabled>Stage item</button>
      <button id="new-item-close" class="btn btn-secondary">Cancel</button>
    </div>
  `;
  document.body.append(creator);

  const autoplaceCb = el('new-item-autoplace');
  if (autoplaceCb) {
    autoplaceCb.onchange = () => {
      el('creator-coords-wrap').hidden = autoplaceCb.checked;
    };
  }

  const etherealCb = el('new-item-ethereal');
  if (etherealCb) {
    etherealCb.onchange = () => {
      const tag = el('card-ethereal-tag');
      if (tag) tag.hidden = !etherealCb.checked;
    };
  }

  let closeCombobox = () => {
    const comboboxWrap = el('creator-combobox-wrap');
    const listEl = el('new-item-combobox-list');
    const searchInput = el('new-item-search');
    if (comboboxWrap) comboboxWrap.classList.remove('is-open');
    if (listEl) listEl.hidden = true;
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
  };
  let onDocPointerDown = null;

  const closeItemCreatorDialog = () => {
    if (onDocPointerDown) {
      document.removeEventListener('pointerdown', onDocPointerDown);
      onDocPointerDown = null;
    }
    try {
      closeCombobox();
    } catch (_) {}
    if (creator.open) {
      creator.close();
    }
  };

  creator.addEventListener('close', () => {
    if (onDocPointerDown) {
      document.removeEventListener('pointerdown', onDocPointerDown);
      onDocPointerDown = null;
    }
    try {
      closeCombobox();
    } catch (_) {}
  });

  const validateCreatorForm = () => {
    const defVal = el('new-item-definition').value;
    const statusEl = el('new-item-status');
    const submitBtn = el('new-item-submit');
    statusEl.textContent = '';

    if (!defVal) {
      submitBtn.disabled = true;
      return false;
    }

    if (defVal === '__custom__') {
      const code = (el('new-item-code').value || '').trim();
      if (code.length !== 3) {
        statusEl.textContent = 'Item code must be exactly 3 characters.';
        submitBtn.disabled = true;
        return false;
      }
      submitBtn.disabled = false;
      return true;
    }

    let hasInvalid = false;
    const rows = creator.querySelectorAll('.creator-stat-row:not(.fixed)');
    for (const row of rows) {
      const numInput = row.querySelector('.creator-stat-num');
      if (!numInput) continue;
      const val = Number(numInput.value);
      const min = Number(numInput.min);
      const max = Number(numInput.max);
      if (isNaN(val) || val < min || val > max) {
        row.classList.add('invalid');
        hasInvalid = true;
      } else {
        row.classList.remove('invalid');
      }
    }

    if (hasInvalid) {
      statusEl.textContent = 'All stat rolls must be within their allowed min-max range.';
      submitBtn.disabled = true;
      return false;
    }

    submitBtn.disabled = false;
    return true;
  };

  const renderStats = item => {
    const container = el('new-item-stats-container');
    container.replaceChildren();

    (item.stats || []).forEach(s => {
      const row = document.createElement('div');
      row.className = 'creator-stat-row' + (s.isFixed ? ' fixed' : '');
      row.dataset.statId = s.statId;
      row.dataset.layer = s.layer || 0;
      row.dataset.fixedValue = s.defaultValue;

      const desc = document.createElement('span');
      desc.className = 'creator-stat-desc';
      desc.textContent = s.desc || s.name;
      row.append(desc);

      if (s.isFixed) {
        const badge = document.createElement('span');
        badge.className = 'creator-stat-badge';
        badge.textContent = `${s.defaultValue} (Fixed)`;
        row.append(badge);
      } else {
        const rangeLabel = document.createElement('span');
        rangeLabel.className = 'creator-stat-range-label';
        rangeLabel.textContent = `[${s.min} - ${s.max}]`;
        row.append(rangeLabel);

        const wrap = document.createElement('div');
        wrap.className = 'creator-stat-inputs';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'creator-stat-slider';
        slider.min = s.min;
        slider.max = s.max;
        slider.value = s.defaultValue;

        const num = document.createElement('input');
        num.type = 'number';
        num.className = 'creator-stat-num';
        num.min = s.min;
        num.max = s.max;
        num.value = s.defaultValue;

        slider.oninput = () => {
          num.value = slider.value;
          validateCreatorForm();
        };
        num.oninput = () => {
          slider.value = num.value;
          validateCreatorForm();
        };

        wrap.append(slider, num);
        row.append(wrap);
      }

      container.append(row);
    });

    validateCreatorForm();
  };

  el('preset-perfect').onclick = () => {
    creator.querySelectorAll('.creator-stat-row:not(.fixed)').forEach(row => {
      const num = row.querySelector('.creator-stat-num');
      const slider = row.querySelector('.creator-stat-slider');
      if (num && slider) {
        num.value = num.max;
        slider.value = num.max;
      }
    });
    validateCreatorForm();
  };

  el('preset-min').onclick = () => {
    creator.querySelectorAll('.creator-stat-row:not(.fixed)').forEach(row => {
      const num = row.querySelector('.creator-stat-num');
      const slider = row.querySelector('.creator-stat-slider');
      if (num && slider) {
        num.value = num.min;
        slider.value = num.min;
      }
    });
    validateCreatorForm();
  };

  el('preset-random').onclick = () => {
    creator.querySelectorAll('.creator-stat-row:not(.fixed)').forEach(row => {
      const num = row.querySelector('.creator-stat-num');
      const slider = row.querySelector('.creator-stat-slider');
      if (num && slider) {
        const min = Number(num.min);
        const max = Number(num.max);
        const rand = Math.floor(Math.random() * (max - min + 1)) + min;
        num.value = rand;
        slider.value = rand;
      }
    });
    validateCreatorForm();
  };

  el('new-item-code').oninput = validateCreatorForm;

  el('create-item').onclick = run(async () => {
    const catalog = await loadUniqueCatalog();
    const sourceSelect = el('new-item-source');
    sourceSelect.replaceChildren(...state.saves.map(s => new Option(s.name + (s.is_stash ? ' (Shared Stash)' : ''), s.file)));

    const activeChar = state.selectedChar || window._d2rState?.activeCharName || el('armory-char-select')?.value;
    const activeFilter = state.filters.source !== 'all' ? state.filters.source : (el('character-filter')?.value || '');
    let defaultSave = state.saves.find(s => !s.is_stash && activeChar && s.name.toLowerCase() === activeChar.toLowerCase());
    if (!defaultSave && activeFilter && activeFilter !== 'all') {
      defaultSave = state.saves.find(s => s.file.toLowerCase() === activeFilter.toLowerCase() || s.name.toLowerCase() === activeFilter.toLowerCase());
    }
    if (defaultSave && [...sourceSelect.options].some(o => o.value === defaultSave.file)) {
      sourceSelect.value = defaultSave.file;
    }

    const defSelect = el('new-item-definition');
    const searchInput = el('new-item-search');
    const clearBtn = el('new-item-combobox-clear');
    const toggleBtn = el('new-item-combobox-toggle');
    const comboboxWrap = el('creator-combobox-wrap');
    const listEl = el('new-item-combobox-list');

    const escapeHtml = str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const highlightMatch = (text, query) => {
      if (!query || !text) return escapeHtml(text || '');
      const str = String(text);
      const qLower = query.toLowerCase();
      const tLower = str.toLowerCase();
      const idx = tLower.indexOf(qLower);
      if (idx === -1) return escapeHtml(str);
      const before = escapeHtml(str.slice(0, idx));
      const match = escapeHtml(str.slice(idx, idx + query.length));
      const after = escapeHtml(str.slice(idx + query.length));
      return `${before}<mark class="combobox-hl">${match}</mark>${after}`;
    };

    let selectedItem = null;
    let focusedIndex = -1;
    let currentOptions = [];

    const populateComboboxOptions = filterText => {
      const query = (filterText || '').trim().toLowerCase();
      listEl.replaceChildren();

      // Populate hidden select for parity
      defSelect.replaceChildren();
      defSelect.add(new Option('-- Select a unique item --', ''));
      defSelect.add(new Option('Custom item code / rune (Normal quality)', '__custom__'));

      const matches = [];
      const matchCustom = !query || 'custom item code rune normal'.includes(query);
      if (matchCustom) {
        matches.push({
          id: '__custom__',
          isCustom: true,
          name: 'Custom item code / rune (Normal quality)',
          meta: 'Normal Quality'
        });
      }

      catalog.forEach(item => {
        defSelect.add(new Option(`${item.name} (${item.baseName}, Req Lvl ${item.lvlReq})`, item.id));
        const nameMatch = item.name.toLowerCase().includes(query);
        const baseMatch = (item.baseName || '').toLowerCase().includes(query);
        const codeMatch = (item.code || '').toLowerCase().includes(query);
        const reqMatch = String(item.lvlReq).includes(query);
        if (!query || nameMatch || baseMatch || codeMatch || reqMatch) {
          matches.push({
            id: String(item.id),
            isCustom: false,
            name: item.name,
            baseName: item.baseName,
            code: item.code,
            lvlReq: item.lvlReq,
            meta: `${item.baseName || ''}${item.code ? ` [${item.code}]` : ''} · Req ${item.lvlReq}`
          });
        }
      });

      if (matches.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'creator-combobox-empty';
        emptyDiv.textContent = `No items found matching "${filterText}"`;
        listEl.appendChild(emptyDiv);
        return [];
      }

      const optionEls = [];
      matches.forEach((m, idx) => {
        const opt = document.createElement('div');
        opt.className = 'creator-combobox-option' + (m.isCustom ? ' custom-entry' : '');
        opt.dataset.id = m.id;
        opt.dataset.index = idx;
        if (selectedItem && selectedItem.id === m.id) {
          opt.classList.add('is-selected');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'creator-combobox-name';
        nameSpan.innerHTML = highlightMatch(m.name, query);

        const metaSpan = document.createElement('span');
        metaSpan.className = 'creator-combobox-meta';
        metaSpan.innerHTML = highlightMatch(m.meta, query);

        opt.appendChild(nameSpan);
        opt.appendChild(metaSpan);

        opt.onpointerdown = (e) => {
          e.preventDefault();
          selectComboboxItem(m.id);
        };

        listEl.appendChild(opt);
        optionEls.push(opt);
      });

      return optionEls;
    };

    const updateFocusedOption = () => {
      currentOptions.forEach((opt, idx) => {
        if (idx === focusedIndex) {
          opt.classList.add('is-focused');
          opt.scrollIntoView({ block: 'nearest' });
        } else {
          opt.classList.remove('is-focused');
        }
      });
    };

    const openCombobox = (resetFilter = false) => {
      comboboxWrap.classList.add('is-open');
      listEl.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
      const filter = resetFilter ? '' : (selectedItem && searchInput.value === selectedItem.label ? '' : searchInput.value);
      currentOptions = populateComboboxOptions(filter);
      focusedIndex = -1;
      const selectedOpt = listEl.querySelector('.is-selected');
      if (selectedOpt) {
        selectedOpt.scrollIntoView({ block: 'nearest' });
      }
    };

    const closeCombobox = () => {
      comboboxWrap.classList.remove('is-open');
      listEl.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      focusedIndex = -1;
      if (selectedItem) {
        searchInput.value = selectedItem.label;
        clearBtn.style.display = 'flex';
      } else {
        searchInput.value = '';
        clearBtn.style.display = 'none';
      }
    };

    const selectComboboxItem = (id) => {
      if (!id) {
        selectedItem = null;
        searchInput.value = '';
        clearBtn.style.display = 'none';
        defSelect.value = '';
        closeCombobox();
        defSelect.dispatchEvent(new Event('change'));
        return;
      }

      if (id === '__custom__') {
        selectedItem = { id: '__custom__', label: 'Custom item code / rune (Normal quality)' };
      } else {
        const item = catalog.find(x => x.id === +id);
        if (item) {
          selectedItem = {
            id: String(item.id),
            label: `${item.name} (${item.baseName}, Req Lvl ${item.lvlReq})`
          };
        } else {
          selectedItem = null;
        }
      }

      if (selectedItem) {
        searchInput.value = selectedItem.label;
        clearBtn.style.display = 'flex';
        defSelect.value = selectedItem.id;
      } else {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        defSelect.value = '';
      }

      closeCombobox();
      defSelect.dispatchEvent(new Event('change'));
    };

    searchInput.onfocus = () => {
      openCombobox(false);
      searchInput.select();
    };

    searchInput.onclick = () => {
      if (listEl.hidden) {
        openCombobox(false);
      }
    };

    searchInput.oninput = () => {
      comboboxWrap.classList.add('is-open');
      listEl.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
      currentOptions = populateComboboxOptions(searchInput.value);
      focusedIndex = currentOptions.length > 0 ? 0 : -1;
      updateFocusedOption();
    };

    searchInput.onkeydown = (e) => {
      const listHidden = listEl.hidden;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (listHidden) {
          openCombobox(false);
        } else if (currentOptions.length > 0) {
          focusedIndex = Math.min(focusedIndex + 1, currentOptions.length - 1);
          updateFocusedOption();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!listHidden && currentOptions.length > 0) {
          focusedIndex = Math.max(focusedIndex - 1, 0);
          updateFocusedOption();
        }
      } else if (e.key === 'Enter') {
        if (!listHidden) {
          e.preventDefault();
          if (focusedIndex >= 0 && currentOptions[focusedIndex]) {
            selectComboboxItem(currentOptions[focusedIndex].dataset.id);
          } else if (currentOptions.length > 0) {
            selectComboboxItem(currentOptions[0].dataset.id);
          }
        }
      } else if (e.key === 'Escape') {
        if (!listHidden) {
          e.preventDefault();
          closeCombobox();
        }
      } else if (e.key === 'Tab') {
        if (!listHidden) {
          closeCombobox();
        }
      }
    };

    clearBtn.onclick = (e) => {
      e.stopPropagation();
      selectComboboxItem('');
      openCombobox(true);
      searchInput.focus();
    };

    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      if (listEl.hidden) {
        openCombobox(true);
        searchInput.focus();
      } else {
        closeCombobox();
      }
    };

    if (onDocPointerDown) {
      document.removeEventListener('pointerdown', onDocPointerDown);
    }
    onDocPointerDown = (e) => {
      if (!comboboxWrap.contains(e.target)) {
        closeCombobox();
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);

    defSelect.onchange = () => {
      const val = defSelect.value;
      const promptEl = el('creator-empty-prompt');
      if (!val) {
        if (promptEl) promptEl.hidden = false;
        el('creator-item-card').hidden = true;
        el('creator-custom-section').hidden = true;
        el('creator-placement-section').hidden = true;
        el('creator-stats-section').hidden = true;
        validateCreatorForm();
        return;
      }

      if (promptEl) promptEl.hidden = true;

      if (val === '__custom__') {
        el('creator-item-card').hidden = true;
        el('creator-custom-section').hidden = false;
        el('creator-placement-section').hidden = false;
        el('creator-stats-section').hidden = true;
        if (el('card-ethereal-tag')) el('card-ethereal-tag').hidden = true;
        if (el('new-item-ethereal')) el('new-item-ethereal').checked = false;
        validateCreatorForm();
        return;
      }

      const item = catalog.find(x => x.id === +val);
      if (!item) return;

      el('creator-custom-section').hidden = true;
      el('creator-item-card').hidden = false;
      el('creator-placement-section').hidden = false;
      el('creator-stats-section').hidden = false;

      el('card-item-name').textContent = item.name;
      el('card-base-name').textContent = `${item.baseName} [${item.code}]`;
      el('card-req-lvl').textContent = `Requires Level: ${item.lvlReq}`;
      el('card-item-lvl').textContent = `Item Level: ${item.lvl}`;

      const isEth = Boolean(item.isEthereal);
      if (el('new-item-ethereal')) el('new-item-ethereal').checked = isEth;
      if (el('card-ethereal-tag')) el('card-ethereal-tag').hidden = !isEth;

      renderStats(item);
    };

    selectComboboxItem('');
    if (el('creator-empty-prompt')) el('creator-empty-prompt').hidden = false;
    el('creator-item-card').hidden = true;
    el('creator-custom-section').hidden = true;
    el('creator-placement-section').hidden = true;
    el('creator-stats-section').hidden = true;
    if (el('card-ethereal-tag')) el('card-ethereal-tag').hidden = true;
    if (el('new-item-ethereal')) el('new-item-ethereal').checked = false;
    el('new-item-status').textContent = '';
    el('new-item-submit').disabled = true;

    creator.showModal();
  });

  el('new-item-close').onclick = () => {
    closeItemCreatorDialog();
  };

  el('new-item-submit').onclick = run(async () => {
    const defSelect = el('new-item-definition');
    const catalog = await loadUniqueCatalog();
    const sourceFile = el('new-item-source').value;
    const autoPlace = el('new-item-autoplace').checked;

    let payload;
    if (defSelect.value === '__custom__') {
      const code = el('new-item-code').value.trim();
      payload = {
        source: sourceFile,
        itemCode: code,
        quality: el('new-item-quality').value,
        itemLevel: 1,
        isEthereal: Boolean(el('new-item-ethereal')?.checked),
        x: autoPlace ? -1 : +el('new-item-x').value,
        y: autoPlace ? -1 : +el('new-item-y').value,
        stats: {},
        allowedRanges: {}
      };
    } else {
      const item = catalog.find(x => x.id === +defSelect.value);
      if (!item) throw new Error('Selected item definition not found.');

      const itemStats = [];
      creator.querySelectorAll('.creator-stat-row').forEach(row => {
        const statId = +row.dataset.statId;
        const layer = +row.dataset.layer;
        const numInput = row.querySelector('.creator-stat-num');
        const val = numInput ? +numInput.value : +row.dataset.fixedValue;
        itemStats.push({ statId, layer, value: val });
      });

      payload = {
        source: sourceFile,
        itemCode: item.code,
        quality: 'Unique',
        qualityIndex: item.id,
        itemLevel: item.lvl || 99,
        isEthereal: Boolean(el('new-item-ethereal')?.checked),
        x: autoPlace ? -1 : +el('new-item-x').value,
        y: autoPlace ? -1 : +el('new-item-y').value,
        itemStats: itemStats
      };
    }

    let result;
    if (window.D2Wasm) {
      result = await window.D2Wasm.createItem(sourceFile, payload);
    }

    workspace.changed();
    closeItemCreatorDialog();

    const stagedSave = state.saves.find(s => s.file === sourceFile);
    if (stagedSave && !stagedSave.is_stash) {
      state.selectedChar = stagedSave.name;
      if (window._d2rState) window._d2rState.activeCharName = stagedSave.name;
    }

    await refresh();

    if (stagedSave) {
      if (!stagedSave.is_stash) {
        state.selectedChar = stagedSave.name;
        if (window._d2rState) window._d2rState.activeCharName = stagedSave.name;
        if (el('armory-char-select')) el('armory-char-select').value = stagedSave.name;
      }
      if (state.filters.source && state.filters.source !== 'all') {
        const filterVal = stagedSave.is_stash ? stagedSave.file : stagedSave.name;
        state.filters.source = filterVal;
        if (el('character-filter')) el('character-filter').value = filterVal;
      }
      if (state.activeTab === 'armory-view' && window.reloadArmoryData) {
        await window.reloadArmoryData();
      } else if (state.activeTab === 'search-view' && window.executeSearch) {
        await window.executeSearch();
      }
    }

    window.showToast('New item staged.', 'success');
    return result;
  });
  window.addEventListener('beforeunload', event => {
    if (workspace.active && workspace.changes) { event.preventDefault(); event.returnValue = ''; }
  });

  const categories = ['jewelry','sets','uniques','runewords','crafted','bases','charms','other'];
  const organizer = document.createElement('dialog');
  organizer.className = 'mule-organizer-dialog';
  organizer.innerHTML = '<h2>Mule assignments & bulk pack</h2><p>Assign each mule a category. Matching mules fill first (inventory, cube, personal stash). Jewelry takes priority over set/unique quality. Only normal shared-stash tabs are packed; advanced banks stay unchanged.</p><div id="mule-assignments"></div><label>Shared stash <select id="organizer-stash"></select></label><label>Category <select id="organizer-category"><option value="all">All categories</option></select></label><label><input id="organizer-auto" type="checkbox"> Create matching Amazon mules when needed (up to 30 per plan)</label><p>New names use HC/SC + category + letters. Review the staged results before Save.</p><p id="organizer-result" role="status"></p><button id="organizer-plan">Stage bulk pack</button> <button id="organizer-close">Close</button>';
  document.body.append(organizer);
  categories.forEach(value => el('organizer-category').add(new Option(value, value)));
  const key = () => 'bk-mules:' + (window.D2Wasm?.sessionId || 'default') + ':' + state.core;
  let assignments = {};
  el('mule-organizer').onclick = run(async () => {
    try { assignments = JSON.parse(localStorage.getItem(key()) || '{}'); } catch { assignments = {}; }
    el('mule-assignments').replaceChildren();
    for (const save of state.saves.filter(s => !s.is_stash)) {
      const label = document.createElement('label'); label.textContent = save.name + ' ';
      const select = document.createElement('select'); select.add(new Option('Not a mule', ''));
      categories.forEach(category => select.add(new Option(category, category)));
      select.value = assignments[save.file] || '';
      select.onchange = () => { if (select.value) assignments[save.file] = select.value; else delete assignments[save.file]; localStorage.setItem(key(), JSON.stringify(assignments)); };
      label.append(select); el('mule-assignments').append(label);
    }
    el('organizer-stash').replaceChildren();
    state.saves.filter(s => s.is_stash).forEach(s => el('organizer-stash').add(new Option(s.file, s.file)));
    el('organizer-result').textContent = '';
    organizer.showModal();
  });
  el('organizer-close').onclick = () => organizer.close();
  el('organizer-plan').onclick = run(async () => {
    if (workspace.busy) return;
    el('organizer-plan').disabled = true;
    try {
      await workspace.start();
      workspace.busy = true;
      const available = new Set(state.saves.filter(s => !s.is_stash).map(s => s.file));
      const plan = {source:el('organizer-stash').value, category:el('organizer-category').value,
        assignments:Object.fromEntries(Object.entries(assignments).filter(([file]) => available.has(file))), autoCreate:el('organizer-auto').checked};
      let result;
      if (window.D2Wasm) {
        const files = Object.fromEntries([...window.D2Wasm.loadedFiles].map(([name, bytes]) => [name, btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))]));
        result = JSON.parse(window.D2Wasm.interop.PackWorkspace(JSON.stringify(files), JSON.stringify(plan)));
        if (!result.success) throw new Error(result.error);
        for (const [name, value] of Object.entries(result.files)) window.D2Wasm.loadedFiles.set(name, Uint8Array.from(atob(value), c => c.charCodeAt(0)));
      }
      if (result.moved) workspace.changed();
      for (const name of result.created) {
        const category = categories.find(c => name.toLowerCase().startsWith((state.core === 'hard' ? 'hc' : 'sc') + c));
        if (category) assignments[name] = category;
      }
      localStorage.setItem(key(), JSON.stringify(assignments));
      await refresh();
      el('organizer-result').textContent = `Staged ${result.moved} items; ${result.remaining} left unpacked. Created: ${result.created.join(', ') || 'none'}. Close this dialog to review, then Save or Discard.`;
    } finally { workspace.busy = false; el('organizer-plan').disabled = false; }
  });
  update();
})();
