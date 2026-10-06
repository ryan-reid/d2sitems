/**
 * D2SItems Web Explorer - Frontend Application
 */

// Application State
try {
  if (localStorage.getItem('bk-chronicle-v2') !== 'true') {
    localStorage.removeItem('bk-chronicle-manual');
    localStorage.removeItem('bk-chronicle-rollback-done');
    localStorage.setItem('bk-chronicle-v2', 'true');
  }
} catch (e) {}

const state = {
  isWasmMode: true,
  core: localStorage.getItem('bk-save-core') === 'hard' ? 'hard' : 'soft',
  allWasmItems: [],
  activeTab: 'search-view',
  profiles: [],
  activeProfileId: null,
  saves: [],
  items: [],
  grail: null,
  verifier: null,
  selectedChar: null,
  viewMode: 'grid', // 'grid' or 'table'
  filters: {
    q: '',
    quality: 'all',
    source: 'all',
    type: 'all',
    tier: 'all',
    location: 'all',
    sockets: 'all',
    ethereal: 'all',
    out_of_date: 'all',
    perfect: 'all',
    min_perf: 0,
    stat: '',
    sort: 'perfection_desc'
  },
  grailFilter: 'all', // 'all', 'collected', 'missing'
  verifierFilter: 'all', // 'all', 'below', 'above', 'missing'
  verifierSearch: ''
};
window.state = state;
window.coreFetch = async function(url, options) {
  const core = state.core;
  const scoped = new URL(url, window.location.href);
  const isRead = !options?.method || options.method.toUpperCase() === 'GET';
  if (isRead && scoped.pathname.startsWith('/api/')) scoped.searchParams.set('core', core);
  const response = await fetch(scoped, options);
  if (isRead && state.core !== core) throw new Error('Save mode changed; previous request discarded.');
  return response;
};
const coreSelect = document.getElementById('core-select');
coreSelect.value = state.core;
coreSelect.addEventListener('change', async () => {
  state.core = coreSelect.value;
  localStorage.setItem('bk-save-core', state.core);
  state.selectedChar = null;
  state.filters.source = 'all';
  state.saves = []; state.items = []; state.allWasmItems = [];
  state.grail = null; state.verifier = null;
  document.querySelectorAll('.modal-overlay').forEach(modal => { modal.style.display = 'none'; });
  dom.armoryCharSelect.innerHTML = '';
  dom.armoryContent.innerHTML = '';
  if (window._d2rState) window._d2rState.activeCharName = null;
  renderItemsView();
  if (state.isWasmMode) await refreshWasmDataset();
  else await loadSavesAndItems();
  if (state.activeTab === 'chronicle-view') await loadChronicleView();
  if (state.activeTab === 'verifier-view') await loadVerifierView();
});

// DOM Elements
const dom = {
  rescanBtn: document.getElementById('rescan-btn'),
  rescanIcon: document.getElementById('rescan-icon'),
  rescanLabel: document.getElementById('rescan-label'),
  searchInput: document.getElementById('search-input'),
  searchClearBtn: document.getElementById('search-clear-btn'),
  resultsCountBadge: document.getElementById('results-count-badge'),
  sortSelect: document.getElementById('sort-select'),
  modeGridBtn: document.getElementById('mode-grid-btn'),
  modeDetailBtn: document.getElementById('mode-detail-btn'),
  modeTableBtn: document.getElementById('mode-table-btn'),
  itemsGrid: document.getElementById('items-grid'),
  itemsTableWrap: document.getElementById('items-table-wrap'),
  itemsTableBody: document.getElementById('items-table-body'),
  emptyState: document.getElementById('empty-state'),
  characterFilter: document.getElementById('character-filter'),
  typeFilter: document.getElementById('type-filter'),
  tierFilter: document.getElementById('tier-filter'),
  locationFilter: document.getElementById('location-filter'),
  socketsFilter: document.getElementById('sockets-filter'),
  perfMinSlider: document.getElementById('perf-min-slider'),
  perfValLabel: document.getElementById('perf-val-label'),
  perf90Btn: document.getElementById('perf-90-btn'),
  perf100Btn: document.getElementById('perf-100-btn'),
  perfectControl: document.getElementById('perfect-control'),
  statFilter: document.getElementById('stat-filter'),
  resetFiltersBtn: document.getElementById('reset-filters-btn'),
  charactersGrid: document.getElementById('characters-grid'),
  charactersSummaryStats: document.getElementById('characters-summary-stats'),
  armoryCharSelect: document.getElementById('armory-char-select'),
  armoryContent: document.getElementById('armory-content'),
  grailOverallScore: document.getElementById('grail-overall-score'),
  grailOverallBar: document.getElementById('grail-overall-bar'),
  grailCountText: document.getElementById('grail-count-text'),
  grailCategories: document.getElementById('grail-categories'),
  chronicleOverallScore: document.getElementById('chronicle-overall-score'),
  chronicleOverallBar: document.getElementById('chronicle-overall-bar'),
  chronicleCountText: document.getElementById('chronicle-count-text'),
  chronicleCategoryPills: document.getElementById('chronicle-category-pills'),
  chronicleCategories: document.getElementById('chronicle-categories'),
  chronicleSearchInput: document.getElementById('chronicle-search'),
  verifierRefreshBtn: document.getElementById('verifier-refresh-btn'),
  verifierTotalChecked: document.getElementById('verifier-total-checked'),
  verifierTotalUpToDate: document.getElementById('verifier-total-up-to-date'),
  verifierTotalOutOfDate: document.getElementById('verifier-total-out-of-date'),
  verifierPctOutOfDate: document.getElementById('verifier-pct-out-of-date'),
  verifierBelowMinTag: document.getElementById('verifier-below-min-tag'),
  verifierAboveMaxTag: document.getElementById('verifier-above-max-tag'),
  verifierMissingTag: document.getElementById('verifier-missing-tag'),
  verifierSearchInput: document.getElementById('verifier-search-input'),
  verifierItemsList: document.getElementById('verifier-items-list'),
  verifierAllClean: document.getElementById('verifier-all-clean'),
  itemModal: document.getElementById('item-modal'),
  itemModalTitle: document.getElementById('item-modal-title'),
  itemModalBody: document.getElementById('item-modal-body'),
  itemModalCloseBtn: document.getElementById('item-modal-close-btn'),
  itemModalDoneBtn: document.getElementById('item-modal-done-btn'),
  itemModalCopyBtn: document.getElementById('item-modal-copy-btn'),
  toastContainer: document.getElementById('toast-container')
};

// Global Error Handlers
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('UI Script Error:', msg, 'Line:', lineNo, error);
  showToast(`Script error: ${msg} (line ${lineNo})`, 'error');
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('Unhandled Promise Rejection:', event.reason);
  showToast(`Operation failed: ${event.reason}`, 'error');
};

// Utilities
function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getQualityKey(quality, isRuneword) {
  if (isRuneword) return 'runeword';
  switch ((quality || '').toLowerCase()) {
    case 'unique': return 'unique';
    case 'set': return 'set';
    case 'rare': return 'rare';
    case 'craft':
    case 'crafted': return 'crafted';
    case 'magic': return 'magic';
    case 'superior':
    case 'inferior':
    case 'normal': return 'normal';
    default: return 'normal';
  }
}

function getQualityClass(quality, isRuneword) {
  const k = getQualityKey(quality, isRuneword);
  return `q-${k} quality-${k}`;
}

function getQualityColorClass(quality, isRuneword) {
  const k = getQualityKey(quality, isRuneword);
  return `color-${k}`;
}

function formatItemTitle(name) {
  if (!name) return '';
  // Strip redundant trailing parenthesized base name, e.g. "The Rising Sun (Amulet)" -> "The Rising Sun"
  let cleaned = name.replace(/\s*\([^)]+\)$/, '').trim();
  if (!cleaned) cleaned = name;
  
  // If string is ALL CAPS and longer than 3 characters, convert to clean Title Case
  if (cleaned.length > 3 && cleaned === cleaned.toUpperCase() && cleaned.toLowerCase() !== cleaned.toUpperCase()) {
    cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    // Fix apostrophes like Nosferatu'S -> Nosferatu's
    cleaned = cleaned.replace(/'[A-Z]/g, m => m.toLowerCase());
  }
  return cleaned;
}

function getItemTypeIconHref(item) {
  const type = ((item.type || '') + ' ' + (item.baseName || '')).toLowerCase();
  if (type.includes('helm') || type.includes('circlet') || type.includes('coronet') || type.includes('tiara') || type.includes('diadem') || type.includes('mask') || type.includes('cap') || type.includes('crown')) return '#i-helm';
  if (type.includes('armor') || type.includes('plate') || type.includes('mail') || type.includes('robe') || type.includes('coat') || type.includes('cuirass')) return '#i-armor';
  if (type.includes('shield') || type.includes('targe') || type.includes('rondache') || type.includes('ward')) return '#i-armor';
  if (type.includes('rune')) return '#i-rune';
  if (type.includes('charm') || type.includes('cube')) return '#i-cube';
  if (type.includes('ring')) return '#i-ring';
  if (type.includes('gem') || type.includes('jewel')) return '#i-gem';
  if (type.includes('skull') || type.includes('bone') || type.includes('head')) return '#i-skull';
  return '#i-sword';
}

// Navigation Tabs
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tab.dataset.tab;
    const panel = document.getElementById(state.activeTab);
    if (panel) panel.classList.add('active');

    // Trigger tab specific loads
    if (state.activeTab === 'armory-view') {
      loadArmoryView();
    } else if (state.activeTab === 'chronicle-view') {
      loadChronicleView();
    } else if (state.activeTab === 'verifier-view') {
      loadVerifierView();
    }
  });
});

// Load application in 100% Client-Side WebAssembly Mode
async function loadProfiles() {
  await enableWasmMode();
}

// Enable 100% Client-Side WebAssembly Mode
async function enableWasmMode() {
  state.isWasmMode = true;
  window.updateSaveModeNotice?.();
  window.state = state;

  const wasmBadge = document.getElementById('wasm-badge');
  if (wasmBadge) wasmBadge.style.display = 'inline-flex';

  const exportBtn = document.getElementById('wasm-export-btn');
  if (exportBtn) exportBtn.style.display = 'inline-flex';
  const exportAllBtn = document.getElementById('wasm-export-all-btn');
  if (exportAllBtn) exportAllBtn.style.display = 'inline-flex';
  const originalsBtn = document.getElementById('wasm-originals-btn');
  if (originalsBtn) originalsBtn.style.display = 'inline-flex';
  const invalidateBtn = document.getElementById('wasm-invalidate-btn');
  if (invalidateBtn) {
    invalidateBtn.style.display = 'inline-flex';
  }



  showToast('Running in 100% Client-Side WebAssembly Mode (Offline / Zero-Backend)', 'info');

  // Check if directory handle is stored and permission already granted
  if (window.D2Wasm) {
    try {
      const dirHandle = await window.D2Wasm.getDirectoryHandle();
      if (dirHandle) {
        const perm = await dirHandle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          console.log('[D2Wasm] Active directory handle detected with granted permission. Auto-reloading fresh saves from disk...');
          const res = await window.D2Wasm.reloadFromDirectoryHandle();
          if (res && res.success) {
            await refreshWasmDataset();
            showToast(`Automatically refreshed ${res.count} save files from ${res.folderName}!`, 'success');
            return;
          }
        }
      }
    } catch (e) {
      console.warn('[D2Wasm] Error checking directory handle permission:', e);
    }

    // Otherwise check IndexedDB for existing cached saves
    const cached = await window.D2Wasm.loadAllFilesFromDB();
    if (cached && cached.length > 0) {
      for (const entry of cached) {
        window.D2Wasm.loadedFiles.set(entry.name, entry.bytes);
        const baseline = entry.exportedBytes || entry.original;
        if (baseline) {
          window.D2Wasm.initialFileBytes.set(entry.name, baseline);
        }
      }
      await refreshWasmDataset();
      checkAndNotifyStaleCache();
      return;
    }
  }

  // Show dropzone overlay if no saves loaded yet
  const overlay = document.getElementById('d2-dropzone-overlay');
  if (overlay) overlay.classList.add('active');
}

function checkAndNotifyStaleCache() {
  const meta = window.D2Wasm?.getImportMeta?.();
  if (!meta || !meta.timestamp) return;
  const diffMins = Math.floor((Date.now() - meta.timestamp) / 60000);
  if (diffMins >= 10) {
    const timeStr = diffMins < 60 ? `${diffMins} minutes ago` : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
    showToast(`Loaded cached saves from ${timeStr}. Click "Rescan" to re-grab fresh saves from your save folder.`, 'info');
  }
}

// Rebuild and refresh dataset from WebAssembly engine
async function refreshWasmDataset() {
  if (!window.D2Wasm) return;
  dom.rescanIcon.classList.add('spin');
  dom.rescanLabel.textContent = 'Processing...';

  try {
    const dataset = await window.D2Wasm.buildDataset();
    window.D2Wasm.allSaves = dataset.saves;
    state.saves = dataset.saves.filter(save => save.core === state.core);
    state.allWasmItems = dataset.items.filter(item => item.sourceCore === state.core);
    state.items = state.allWasmItems;

    updateCharacterFilterDropdown();
    await executeSearch();

    if (state.activeTab === 'armory-view') {
      loadArmoryView();
    } else if (state.activeTab === 'chronicle-view') {
      loadChronicleView();
    }
  } catch (err) {
    showToast('Error processing saves in WebAssembly: ' + err.message, 'error');
  } finally {
    dom.rescanIcon.classList.remove('spin');
    dom.rescanLabel.textContent = 'Rescan Saves';
    updateExportButtonState();
  }
}
window.refreshWasmDataset = refreshWasmDataset;

// Handle user file ingestion (Drag & Drop or File/Folder Picker)
async function handleUserFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  if (!state.isWasmMode) {
    await enableWasmMode();
  }

  const overlay = document.getElementById('d2-dropzone-overlay');
  if (overlay) overlay.classList.remove('active');

  const isIgnoredFolder = (name) => {
    return /^(backups?|archive|old|crashdumps?|temp|tmp|\.git|\.vs|\.death-tracker|\.kill-tracker|\.time-played|d2rloader backups|reimaginedlauncherbackups|reimagined backups|bkbackup|bt-backup)$/i.test(name);
  };

  const isBackupFile = (name) => {
    return /^\d{8}[-_]\d{6}/i.test(name) || /\.(bak|old|backup|tmp)$/i.test(name);
  };

  const collected = [];

  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const name = f.name;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i') && !lower.endsWith('.ctl')) {
      continue;
    }
    if (isBackupFile(name)) {
      continue;
    }

    const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const segments = relPath.split('/').filter(Boolean);
    const hasIgnoredDir = segments.slice(0, -1).some(seg => isIgnoredFolder(seg));
    if (hasIgnoredDir) {
      continue;
    }

    collected.push({ file: f, name, relPath });
  }

  if (collected.length === 0) {
    showToast('No valid .d2s or .d2i files found in selection.', 'warning');
    return;
  }

  const hasBK = collected.some(c => /bkdiablo/i.test(c.relPath));
  const candidateFiles = hasBK ? collected.filter(c => /bkdiablo/i.test(c.relPath)) : collected;

  const fileMap = new Map();
  for (const item of candidateFiles) {
    const lower = item.name.toLowerCase();
    if (!fileMap.has(lower)) {
      fileMap.set(lower, item);
    }
  }

  const filesToIngest = [];
  for (const item of fileMap.values()) {
    const bytes = await D2WasmEngine.readFileAsBytes(item.file);
    filesToIngest.push({ name: item.name, bytes, file: item.file });
  }

  if (filesToIngest.length === 0) {
    showToast('No valid .d2s or .d2i files found in selection.', 'warning');
    return;
  }

  showToast(`Loading ${filesToIngest.length} active save file(s) into WebAssembly...`, 'info');
  await window.D2Wasm.ingestFiles(filesToIngest);
  await refreshWasmDataset();
  showToast(`Successfully parsed and loaded ${filesToIngest.length} files with WebAssembly!`, 'success');
}
window.handleUserFiles = handleUserFiles;

// Updates Export button count and badge based on modified saves in memory
function updateExportButtonState() {
  const exportBtn = document.getElementById('wasm-export-btn');
  const exportLabel = document.getElementById('wasm-export-label');
  if (!exportBtn || !window.D2Wasm) return;

  const modified = typeof window.D2Wasm.getModifiedFiles === 'function' ? window.D2Wasm.getModifiedFiles() : [];
  const count = modified.length;

  if (count === 0) {
    if (exportLabel) exportLabel.textContent = '💾 Export';
    exportBtn.title = 'No saves modified yet in this browser session';
    exportBtn.classList.remove('has-modifications');
  } else {
    if (exportLabel) exportLabel.textContent = `💾 Export (${count})`;
    const listStr = modified.map(m => (m.isNew ? `+ ${m.name}` : `* ${m.name}`)).join('\n');
    exportBtn.title = `${count} modified/new save(s):\n${listStr}`;
    exportBtn.classList.add('has-modifications');
  }
}
window.updateExportButtonState = updateExportButtonState;

// Invalidate browser save cache and clear session
async function invalidateWasmCache() {
  if (!window.D2Wasm) return;

  const modified = typeof window.D2Wasm.getModifiedFiles === 'function' ? window.D2Wasm.getModifiedFiles() : [];
  const confirmMsg = modified.length > 0
    ? `You have ${modified.length} unexported modified save(s). Invalidate cache and discard all loaded saves?`
    : 'Are you sure you want to invalidate and clear all loaded saves from the browser cache?';

  if (!window.confirm(confirmMsg)) return;

  const dirHandle = await window.D2Wasm.getDirectoryHandle();
  const hasHandle = Boolean(dirHandle);
  const folderName = dirHandle?.name || localStorage.getItem('bkdiablo-folder-name') || '';

  await window.D2Wasm.invalidateCache({ keepHandle: false });

  state.saves = [];
  state.items = [];
  state.allWasmItems = [];
  state.chronicle = null;
  try {
    localStorage.removeItem('bk-chronicle-manual');
  } catch (e) {}
  if (window.EditWorkspace) {
    window.EditWorkspace.chronicleDraft = null;
    window.EditWorkspace.chronicleOriginal = null;
    window.EditWorkspace.hasChronicleChanges = false;
  }
  updateCharacterFilterDropdown();
  await executeSearch();
  updateExportButtonState();
  window.updateSaveModeNotice?.();

  showToast('Browser save cache invalidated and cleared.', 'success');

  if (hasHandle && window.confirm(`Cache cleared. Would you like to reload fresh saves from "${folderName}" now?`)) {
    await window.D2Wasm.saveDirectoryHandle(dirHandle);
    await reloadWasmSavesFromDisk();
  } else {
    const overlay = document.getElementById('d2-dropzone-overlay');
    if (overlay) overlay.classList.add('active');
  }
}
window.invalidateWasmCache = invalidateWasmCache;

// Pick and load folder using modern File System Access API with input fallback
async function pickAndLoadWasmFolder() {
  let dirHandle = null;
  if (window.showDirectoryPicker) {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[D2Wasm] showDirectoryPicker failed, falling back to file input:', err);
    }
  }

  if (dirHandle) {
    try {
      if (!state.isWasmMode) await enableWasmMode();
      await window.D2Wasm.saveDirectoryHandle(dirHandle);
      showToast(`Reading save files from "${dirHandle.name}"...`, 'info');
      const files = await window.D2Wasm.readDirectoryFiles(dirHandle);
      if (!files || files.length === 0) {
        showToast(`No valid .d2s or .d2i files found in "${dirHandle.name}".`, 'warning');
        return;
      }
      showToast(`Loading ${files.length} active save file(s) into WebAssembly...`, 'info');
      await window.D2Wasm.ingestFiles(files);
      window.D2Wasm.recordImportMeta(dirHandle.name, files.length);
      const overlay = document.getElementById('d2-dropzone-overlay');
      if (overlay) overlay.classList.remove('active');
      await refreshWasmDataset();
      showToast(`Successfully loaded ${files.length} fresh save files from ${dirHandle.name}!`, 'success');
      return;
    } catch (err) {
      console.error('[D2Wasm] Error processing selected folder:', err);
      showToast(`Error processing folder "${dirHandle.name}": ${err.message}`, 'error');
      return;
    }
  }

  const folderPicker = document.getElementById('wasm-folder-picker');
  if (folderPicker) folderPicker.click();
}
window.pickAndLoadWasmFolder = pickAndLoadWasmFolder;

// Re-read fresh saves directly from disk folder
async function reloadWasmSavesFromDisk() {
  if (!window.D2Wasm) return;

  const modified = typeof window.D2Wasm.getModifiedFiles === 'function' ? window.D2Wasm.getModifiedFiles() : [];
  if (modified.length > 0) {
    const proceed = window.confirm(
      `You have ${modified.length} unexported modified save(s) in this browser session. Rescanning will discard pending browser edits and re-grab fresh files from disk. Continue?`
    );
    if (!proceed) return;
  }

  dom.rescanIcon.classList.add('spin');
  dom.rescanLabel.textContent = 'Re-reading...';
  dom.rescanBtn.disabled = true;

  try {
    const dirHandle = await window.D2Wasm.getDirectoryHandle();
    if (dirHandle) {
      showToast(`Re-reading save folder "${dirHandle.name}" from disk...`, 'info');
      const res = await window.D2Wasm.reloadFromDirectoryHandle();
      if (res && res.success) {
        await refreshWasmDataset();
        showToast(`Successfully re-scanned and loaded ${res.count} fresh save files from ${res.folderName}!`, 'success');
        return;
      } else if (res && res.reason === 'permission_denied') {
        showToast('Permission to access save folder was denied. Please select your folder again.', 'warning');
      }
    }

    // No handle or permission not granted: prompt to pick folder
    showToast('Select your D2R save folder to re-grab fresh files from disk...', 'info');
    await pickAndLoadWasmFolder();
  } catch (err) {
    showToast('Error re-scanning saves from disk: ' + err.message, 'error');
  } finally {
    dom.rescanIcon.classList.remove('spin');
    dom.rescanLabel.textContent = 'Rescan Saves';
    dom.rescanBtn.disabled = false;
    updateExportButtonState();
  }
}
window.reloadWasmSavesFromDisk = reloadWasmSavesFromDisk;

// Setup WASM Event Listeners (Folder pickers, dropzone, exports)
function setupWasmEvents() {
  const folderPicker = document.getElementById('wasm-folder-picker');
  const filesPicker = document.getElementById('wasm-files-picker');
  const pickFolderBtn = document.getElementById('wasm-pick-folder-btn');
  const dropzoneFolderBtn = document.getElementById('dropzone-folder-btn');
  const dropzoneFilesBtn = document.getElementById('dropzone-files-btn');
  const dropzoneCloseBtn = document.getElementById('dropzone-close-btn');
  const exportBtn = document.getElementById('wasm-export-btn');
  const exportAllBtn = document.getElementById('wasm-export-all-btn');
  const invalidateBtn = document.getElementById('wasm-invalidate-btn');
  const overlay = document.getElementById('d2-dropzone-overlay');

  if (invalidateBtn) {
    invalidateBtn.addEventListener('click', invalidateWasmCache);
  }
  if (pickFolderBtn) {
    pickFolderBtn.addEventListener('click', pickAndLoadWasmFolder);
  }
  if (dropzoneFolderBtn) {
    dropzoneFolderBtn.addEventListener('click', pickAndLoadWasmFolder);
  }
  if (dropzoneFilesBtn && filesPicker) {
    dropzoneFilesBtn.addEventListener('click', () => filesPicker.click());
  }
  if (dropzoneCloseBtn && overlay) {
    dropzoneCloseBtn.addEventListener('click', () => overlay.classList.remove('active'));
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!window.D2Wasm) return;
      const modified = typeof window.D2Wasm.getModifiedFiles === 'function' ? window.D2Wasm.getModifiedFiles() : [];
      if (modified.length === 0) {
        showToast('No saves have been modified yet in this session.', 'info');
        return;
      }
      try {
        const result = await window.D2Wasm.downloadModifiedSaves(modified);
        if (result.zip) {
          showToast(`Exported ${result.count} modified save(s) in ZIP: ${result.fileName}`, 'success');
        } else {
          showToast(`Exported ${result.count} modified save(s).`, 'success');
        }
        if (typeof window.clearEditLog === 'function') window.clearEditLog();
        updateExportButtonState();
      } catch (err) {
        showToast('Error exporting modified saves: ' + err.message, 'error');
      }
    });
  }

  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async () => {
      if (!window.D2Wasm) return;
      try {
        const result = await window.D2Wasm.downloadAllSavesAsZip();
        if (result.count === 0) {
          showToast('No saves loaded to export.', 'info');
        } else {
          showToast(`Exported all ${result.count} save(s) in ZIP: ${result.fileName}`, 'success');
        }
      } catch (err) {
        showToast('Error exporting all saves: ' + err.message, 'error');
      }
    });
  }

  document.getElementById('wasm-originals-btn')?.addEventListener('click', async () => {
    try {
      if (!window.D2Wasm) return;
      const result = await window.D2Wasm.downloadOriginals();
      if (!result || result.count === 0) {
        showToast('No original saves found in browser storage.', 'info');
      } else if (result.zip) {
        showToast(`Original imported saves exported (${result.count} files in ZIP: ${result.fileName}). Current browser edits are unchanged.`, 'info');
      } else {
        showToast(`Original imported saves exported (${result.count} files). Current browser edits are unchanged.`, 'info');
      }
    } catch (error) { showToast(error.message, 'error'); }
  });

  if (folderPicker) {
    folderPicker.addEventListener('change', async (e) => {
      await handleUserFiles(e.target.files);
      folderPicker.value = '';
    });
  }
  if (filesPicker) {
    filesPicker.addEventListener('change', async (e) => {
      await handleUserFiles(e.target.files);
      filesPicker.value = '';
    });
  }

  // Global Drag & Drop onto browser window
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (overlay && !overlay.classList.contains('active')) {
      overlay.classList.add('active');
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      if (overlay && state.saves && state.saves.length > 0) {
        overlay.classList.remove('active');
      }
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (overlay && state.saves && state.saves.length > 0) {
      overlay.classList.remove('active');
    }

    const droppedFiles = [];
    if (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const traverseEntry = async (entry, path = '') => {
        if (!entry) return;
        if (entry.isFile) {
          try {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            file.webkitRelativePath = path ? `${path}/${file.name}` : file.name;
            droppedFiles.push(file);
          } catch (err) {
            console.warn('[D2Wasm] Error reading dropped file entry:', err);
          }
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readEntries = () => new Promise((res, rej) => reader.readEntries(res, rej));
          let batch;
          do {
            batch = await readEntries();
            for (const child of batch) {
              await traverseEntry(child, path ? `${path}/${entry.name}` : entry.name);
            }
          } while (batch && batch.length > 0);
        }
      };

      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry();
          if (entry) await traverseEntry(entry);
        } else if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) droppedFiles.push(f);
        }
      }
    }

    if (droppedFiles.length > 0) {
      await handleUserFiles(droppedFiles);
    } else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUserFiles(e.dataTransfer.files);
    }
  });
}


// Load Saves and Items
async function loadSavesAndItems() {
  await refreshWasmDataset();
}

function updateCharacterFilterDropdown() {
  const currentVal = dom.characterFilter.value;
  dom.characterFilter.innerHTML = '<option value="all">All Characters &amp; Stashes</option>';

  const chars = state.saves.filter(s => !s.is_stash);
  const stashes = state.saves.filter(s => s.is_stash);

  if (chars.length > 0) {
    const charGroup = document.createElement('optgroup');
    charGroup.label = 'Characters';
    chars.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = `${c.name} (Lvl ${c.level} ${c.class})`;
      charGroup.appendChild(opt);
    });
    dom.characterFilter.appendChild(charGroup);
  }

  if (stashes.length > 0) {
    const stashGroup = document.createElement('optgroup');
    stashGroup.label = 'Shared Stashes';
    stashes.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.file;
      opt.textContent = `${s.file} (${s.item_count} items)`;
      stashGroup.appendChild(opt);
    });
    dom.characterFilter.appendChild(stashGroup);
  }

  const wanted = (state.filters.source && state.filters.source !== 'all') ? state.filters.source : (currentVal || 'all');
  if ([...dom.characterFilter.options].some(o => o.value === wanted)) {
    dom.characterFilter.value = wanted;
    state.filters.source = wanted;
  } else {
    dom.characterFilter.value = 'all';
    state.filters.source = 'all';
  }
}

// Rescan Button
dom.rescanBtn.addEventListener('click', async () => {
  await reloadWasmSavesFromDisk();
});

const TYPE_FILTER_MAP = {
  // Broad categories
  weapon: new Set([
    'axe', 'sword', 'club', 'hammer', 'mace', 'knife',
    'throwing axe', 'throwing knife', 'javelin', 'spear', 'polearm',
    'bow', 'crossbow', 'scepter', 'wand', 'staff',
    'hand to hand', 'hand to hand 2', 'orb',
    'amazon bow', 'amazon spear', 'amazon javelin',
    'missile potion', 'throwing spear', 'thrown weapon', 'throwing weapon'
  ]),
  weapons: new Set([
    'axe', 'sword', 'club', 'hammer', 'mace', 'knife',
    'throwing axe', 'throwing knife', 'javelin', 'spear', 'polearm',
    'bow', 'crossbow', 'scepter', 'wand', 'staff',
    'hand to hand', 'hand to hand 2', 'orb',
    'amazon bow', 'amazon spear', 'amazon javelin',
    'missile potion', 'throwing spear', 'thrown weapon', 'throwing weapon'
  ]),
  armor_all: new Set([
    'armor', 'helm', 'circlet', 'primal helm', 'pelt', 'merc equip',
    'shield', 'auric shields', 'voodoo heads', 'grimoire',
    'gloves', 'boots', 'belt'
  ]),

  // Weapons (BT-BK categories)
  throwing: new Set(['throwing axe', 'throwing knife', 'javelin', 'amazon javelin', 'missile potion', 'throwing spear', 'thrown weapon', 'throwing weapon']),
  throw: new Set(['throwing axe', 'throwing knife', 'missile potion']),
  axe: new Set(['axe', 'throwing axe']),
  axes: new Set(['axe', 'throwing axe']),
  sword: new Set(['sword']),
  swords: new Set(['sword']),
  mace: new Set(['mace', 'hammer', 'club']),
  maces: new Set(['mace', 'hammer', 'club']),
  dagger: new Set(['knife', 'throwing knife']),
  daggs: new Set(['knife', 'throwing knife']),
  knife: new Set(['knife', 'throwing knife']),
  javelin: new Set(['javelin', 'amazon javelin', 'throwing spear']),
  javel: new Set(['javelin', 'amazon javelin', 'throwing spear']),
  polearm: new Set(['polearm']),
  poles: new Set(['polearm']),
  spear: new Set(['spear', 'amazon spear']),
  bow: new Set(['bow', 'amazon bow']),
  bows: new Set(['bow', 'amazon bow']),
  crossbow: new Set(['crossbow']),
  xbow: new Set(['crossbow']),
  xbows: new Set(['crossbow']),
  scepter: new Set(['scepter']),
  scept: new Set(['scepter']),
  wand: new Set(['wand']),
  wands: new Set(['wand']),
  staff: new Set(['staff']),
  stave: new Set(['staff']),
  staves: new Set(['staff']),
  claw: new Set(['hand to hand', 'hand to hand 2']),
  claws: new Set(['hand to hand', 'hand to hand 2']),
  assas: new Set(['hand to hand', 'hand to hand 2']),
  orb: new Set(['orb']),
  orbs: new Set(['orb']),
  sorce: new Set(['orb']),
  amazon: new Set(['amazon bow', 'amazon spear', 'amazon javelin']),
  amazo: new Set(['amazon bow', 'amazon spear', 'amazon javelin']),

  // Armor (BT-BK categories)
  helm: new Set(['helm', 'circlet', 'primal helm', 'pelt', 'merc equip']),
  helms: new Set(['helm', 'circlet', 'primal helm', 'pelt', 'merc equip']),
  armor: new Set(['armor']),
  shield: new Set(['shield', 'auric shields', 'voodoo heads', 'grimoire']),
  shields: new Set(['shield', 'auric shields', 'voodoo heads', 'grimoire']),
  shlds: new Set(['shield', 'auric shields', 'voodoo heads', 'grimoire']),
  gloves: new Set(['gloves']),
  glove: new Set(['gloves']),
  boots: new Set(['boots']),
  boot: new Set(['boots']),
  belt: new Set(['belt']),
  belts: new Set(['belt']),

  // Accessories & Sockets (BT-BK categories)
  ring: new Set(['ring']),
  rings: new Set(['ring']),
  amulet: new Set(['amulet']),
  amulets: new Set(['amulet']),
  amule: new Set(['amulet']),
  charm: new Set(['charm', 'small charm', 'medium charm', 'large charm', 'crafted sunder charm', 'charms', 'torch']),
  charms: new Set(['charm', 'small charm', 'medium charm', 'large charm', 'crafted sunder charm', 'charms', 'torch']),
  jewel: new Set(['jewel', 'colossal jewel']),
  jewels: new Set(['jewel', 'colossal jewel']),
  rune: new Set(['rune']),
  runes: new Set(['rune']),
  gem: new Set([
    'gem', 'chipped gem', 'flawed gem', 'standard gem', 'flawless gem', 'perfect gem', 'ascended gem',
    'amethyst', 'diamond', 'emerald', 'ruby', 'sapphire', 'topaz', 'skull'
  ]),
  gems: new Set([
    'gem', 'chipped gem', 'flawed gem', 'standard gem', 'flawless gem', 'perfect gem', 'ascended gem',
    'amethyst', 'diamond', 'emerald', 'ruby', 'sapphire', 'topaz', 'skull'
  ])
};

function matchesTypeFilter(it, filterType) {
  if (!filterType || filterType === 'all') return true;
  const fLower = filterType.toLowerCase().trim();
  const rawType = (it.type || '').toLowerCase().trim();
  if (!rawType) return false;

  const targetSet = TYPE_FILTER_MAP[fLower];
  if (targetSet) {
    if (targetSet.has(rawType)) return true;
    if (rawType.endsWith('s') && targetSet.has(rawType.slice(0, -1))) return true;
    if (targetSet.has(rawType + 's')) return true;
    return false;
  }
  return rawType === fLower || rawType === (fLower + 's') || (fLower.endsWith('s') && rawType === fLower.slice(0, -1));
}

if (typeof window !== 'undefined') {
  window.TYPE_FILTER_MAP = TYPE_FILTER_MAP;
  window.matchesTypeFilter = matchesTypeFilter;
}

// Search & Filter Execution
let searchDebounceTimer = null;
function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(executeSearch, 250);
}

async function executeSearch() {
  let filtered = [...(state.allWasmItems || [])];
  const f = state.filters;

  if (f.quality !== 'all') {
    const qLower = f.quality.toLowerCase();
    filtered = filtered.filter(it => (it.quality || '').toLowerCase() === qLower || (qLower === 'runeword' && it.isRuneword));
  }
  if (f.source !== 'all') {
    const srcLower = f.source.toLowerCase();
    filtered = filtered.filter(it => (it.sourceName || '').toLowerCase() === srcLower || (it.sourceFile || '').toLowerCase() === srcLower);
  }
  if (f.type !== 'all') {
    filtered = filtered.filter(it => matchesTypeFilter(it, f.type));
  }
  if (f.tier !== 'all') {
    filtered = filtered.filter(it => (it.tier || '').toLowerCase() === f.tier.toLowerCase());
  }
  if (f.location !== 'all') {
    filtered = filtered.filter(it => (it.location || '').toLowerCase().includes(f.location.toLowerCase()));
  }
  if (f.sockets !== 'all') {
    if (f.sockets === 'has') filtered = filtered.filter(it => (it.socketCount || 0) > 0);
    else if (f.sockets === 'open') filtered = filtered.filter(it => (it.openSockets || 0) > 0);
    else {
      const cnt = parseInt(f.sockets, 10);
      filtered = filtered.filter(it => (it.socketCount || 0) === cnt);
    }
  }
  if (f.ethereal === 'yes') filtered = filtered.filter(it => it.isEthereal);
  if (f.ethereal === 'no') filtered = filtered.filter(it => !it.isEthereal);
  if (f.out_of_date === 'out_of_date') filtered = filtered.filter(it => it.isOutOfDate);

  if (f.perfect === 'yes' || f.perfect === '100') {
    filtered = filtered.filter(it => it.perfectionNum != null && it.perfectionNum >= 100.0);
  } else if (f.perfect === '90') {
    filtered = filtered.filter(it => it.perfectionNum != null && it.perfectionNum >= 90.0);
  }
  if (f.min_perf > 0) {
    filtered = filtered.filter(it => it.perfectionNum != null && it.perfectionNum >= f.min_perf);
  }

  if (f.q) {
    const qLower = f.q.toLowerCase();
    filtered = filtered.filter(it => {
      if ((it.displayName || '').toLowerCase().includes(qLower)) return true;
      if ((it.baseName || '').toLowerCase().includes(qLower)) return true;
      if ((it.set || '').toLowerCase().includes(qLower)) return true;
      for (const s of (it.stats || []).concat(it.runewordStats || [])) {
        if ((s.description || s.id || '').toLowerCase().includes(qLower)) return true;
      }
      return false;
    });
  }

  // Sorting
  if (f.sort === 'perfection_desc') {
    filtered.sort((a, b) => (b.perfectionNum || 0) - (a.perfectionNum || 0));
  } else if (f.sort === 'perfection_asc') {
    filtered.sort((a, b) => (a.perfectionNum || 100) - (b.perfectionNum || 100));
  } else if (f.sort === 'ilvl_desc') {
    filtered.sort((a, b) => (b.itemLevel || 0) - (a.itemLevel || 0));
  } else if (f.sort === 'quality_desc') {
    const qRank = { unique: 7, set: 6, runeword: 5, crafted: 4, rare: 3, magic: 2, superior: 1, normal: 0 };
    filtered.sort((a, b) => (qRank[(b.quality || '').toLowerCase()] || 0) - (qRank[(a.quality || '').toLowerCase()] || 0));
  } else if (f.sort === 'character_asc') {
    filtered.sort((a, b) => (a.sourceName || '').localeCompare(b.sourceName || ''));
  } else {
    filtered.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  state.items = filtered;
  dom.resultsCountBadge.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
  renderItemsView();
}

// Render Items Grid & Table
function renderItemsView() {
  const more = document.getElementById('load-more-items');
  if (more) more.remove();

  dom.resultsCountBadge.textContent = `${state.items.length.toLocaleString()} items found`;

  if (state.items.length === 0) {
    dom.itemsGrid.style.display = 'none';
    dom.itemsTableWrap.style.display = 'none';
    dom.emptyState.style.display = 'block';
    return;
  }

  dom.emptyState.style.display = 'none';

  if (state.viewMode === 'grid' || state.viewMode === 'detailed') {
    dom.itemsGrid.style.display = 'grid';
    dom.itemsTableWrap.style.display = 'none';
    renderItemsGrid();
  } else {
    dom.itemsGrid.style.display = 'none';
    dom.itemsTableWrap.style.display = 'block';
    renderItemsTable();
  }
}

function renderItemsGrid() {
  dom.itemsGrid.innerHTML = '';
  state.items.forEach(it => {
    const card = createItemCardElement(it);
    dom.itemsGrid.appendChild(card);
  });
}

function createItemCardElement(it, showVerifierDetails = false) {
  const card = document.createElement('div');
  const qKey = getQualityKey(it.quality, it.isRuneword);
  const qClass = getQualityClass(it.quality, it.isRuneword);
  const outOfDateClass = it.isOutOfDate ? 'is-out-of-date' : '';
  const isDetailed = (state.viewMode === 'detailed' || showVerifierDetails) ? 'is-detailed' : '';
  card.className = `loot item-card ${qClass} ${outOfDateClass} ${isDetailed}`.trim();
  card.dataset.itemId = it.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Inspect ${it.displayName || it.name}`);

  // Title and Quality
  const cleanTitle = escapeHtml(formatItemTitle(it.displayName));

  // Left Icon Box (58x58px matching BT-BK wiki items.html)
  const typeIconHref = getItemTypeIconHref(it);
  const qtyOverlay = (it.quantity && it.quantity > 1) ? `<span class="d2r-mod-slot-qty">${it.quantity}</span>` : '';
  const iconMarkup = it.invFile ? `
    <img class="wiki-item-icon item-card-icon" src="assets/items/${it.invFile}" alt="${cleanTitle}" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='grid';" />
    <span class="fallback-icon-box" style="display:none;"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
    ${qtyOverlay}
  ` : `
    <span class="fallback-icon-box"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
    ${qtyOverlay}
  `;

  // Base Name & Meta Line matching BT-BK wiki (e.g. "Shako · Helm", "Jah · Ith · Ber · Archon Plate", "Shadow Plate · Set")
  const baseName = escapeHtml(it.baseName || it.type || '');
  let baseDetails = [];
  if (it.isRuneword && it.runes && it.runes.length > 0) {
    const runeNames = it.runes.map(r => (typeof r === 'string' ? r : (r.name || r.code || '')).replace(/\s*Rune\b.*$/i, '').trim()).join(' · ');
    baseDetails.push(runeNames);
  }
  if (baseName) baseDetails.push(baseName);
  if (it.set) baseDetails.push(`<span style="color:var(--q-set); font-weight:600;">${escapeHtml(it.set)}</span>`);
  const baseLineText = baseDetails.join(' · ');

  // Tags in loot-foot matching BT-BK wiki's exact .loot-foot .tag structure
  let tagsHtml = '';
  // 1. Required Level / Item Level
  const reqLvl = it.requiredLevel;
  if (reqLvl && reqLvl > 0) {
    tagsHtml += `<span class="tag lvl">LVL ${reqLvl}</span>`;
  }
  // 2. Perfection Score (★ 100% or ★ 92%)
  if (typeof it.perfectionNum === 'number' && !isNaN(it.perfectionNum)) {
    const isPerfect = it.perfectionNum >= 100;
    const isHigh = it.perfectionNum >= 90;
    const perfClass = isPerfect ? 'tag perf perf-100' : (isHigh ? 'tag perf' : 'tag perf');
    const label = isPerfect ? '★ 100%' : `★ ${it.perfectionNum.toFixed(0)}%`;
    tagsHtml += `<span class="${perfClass}">${label}</span>`;
  }
  // 3. Stack Quantity
  if (it.quantity && it.quantity > 1) {
    tagsHtml += `<span class="tag stack-qty" title="Stack size">x${it.quantity}</span>`;
  }
  // 4. Sockets
  if (it.socketCount > 0) {
    tagsHtml += `<span class="tag sock">${it.socketCount} SOCK</span>`;
  }
  // 5. Ethereal
  if (it.isEthereal) {
    tagsHtml += `<span class="tag eth">ETH</span>`;
  }
  // 6. Corrupted
  if (it.isCorrupted) {
    tagsHtml += `<span class="tag corrupt">💥 CORRUPT</span>`;
  }
  // 7. Owner & Location
  const ownerIcon = it.isStash ? '📦' : '👤';
  const ownerName = escapeHtml(it.sourceName);
  const locShort = escapeHtml(it.location || '');
  tagsHtml += `<span class="tag owner" title="${ownerName} (${locShort})">${ownerIcon} ${ownerName}</span>`;
  // 8. Out of date
  if (it.isOutOfDate) {
    tagsHtml += `<span class="tag warning" title="Differs from current patch definitions">⚠️ Out of Date</span>`;
  }

  // Base Stats and Properties. Wiki-style cards always show a compact property
  // preview; Detailed mode and the verifier expand the list.
  let extraContentHtml = '';
  {
    const expanded = state.viewMode === 'detailed' || showVerifierDetails;
    let baseStatsItems = [];
    if (it.defense) baseStatsItems.push(`<span>Def: <strong>${it.defense}</strong></span>`);
    if (it.twoHandedDamage) baseStatsItems.push(`<span>2H: <strong>${it.twoHandedDamage}</strong></span>`);
    else if (it.oneHandedDamage) baseStatsItems.push(`<span>1H: <strong>${it.oneHandedDamage}</strong></span>`);
    if (it.requiredStrength && it.requiredStrength > 0) baseStatsItems.push(`<span>Str: <strong>${it.requiredStrength}</strong></span>`);
    if (it.requiredDexterity && it.requiredDexterity > 0) baseStatsItems.push(`<span>Dex: <strong>${it.requiredDexterity}</strong></span>`);
    const baseStatsHtml = baseStatsItems.length > 0 ? `<div class="loot-base-stats">${baseStatsItems.join('<span class="sep-dot">·</span>')}</div>` : '';

    let statsListHtml = '';
    const statList = (it.runewordStats || []).concat(it.stats || []);
    if (statList.length > 0) {
      statsListHtml = '<ul class="property-list">';
      const maxDisplay = expanded ? 8 : 3;
      statList.slice(0, maxDisplay).forEach(s => {
        const desc = escapeHtml(s.description || s.id || '');
        const isCorruptStat = (s.description || s.id || '').toLowerCase().includes('corrupt');
        statsListHtml += `<li class="property-entry ${isCorruptStat ? 'stat-corrupted' : ''}">${desc}</li>`;
      });
      if (statList.length > maxDisplay) {
        statsListHtml += `<li class="property-entry is-more">+ ${statList.length - maxDisplay} more properties…</li>`;
      }
      statsListHtml += '</ul>';
    }

    let outOfDateHtml = '';
    if (it.isOutOfDate && it.outOfDateIssues && it.outOfDateIssues.length > 0) {
      outOfDateHtml = `
        <div class="mismatch-box" style="margin-top:6px; padding:6px 10px; background:rgba(192,86,63,0.08); border:1px solid rgba(192,86,63,0.3); border-radius:var(--radius-sm);">
          <div style="font-size:0.74rem; font-weight:700; color:var(--removed); text-transform:uppercase;">⚠️ Patch Mismatches:</div>
          <ul class="property-list" style="margin-top:3px; gap:3px;">
            ${it.outOfDateIssues.slice(0, 3).map(iss => `<li class="property-entry is-warning" style="font-size:0.8rem;">${escapeHtml(iss)}</li>`).join('')}
            ${it.outOfDateIssues.length > 3 ? `<li class="property-entry is-more" style="color:var(--removed); font-size:0.75rem;">+ ${it.outOfDateIssues.length - 3} more…</li>` : ''}
          </ul>
        </div>
      `;
    }

    extraContentHtml = (expanded ? baseStatsHtml : '') + statsListHtml + outOfDateHtml;
  }

  const statRows = (it.runewordStats || []).concat(it.stats || []);
  const statRowsHtml = statRows.slice(0, state.viewMode === 'detailed' ? 12 : 8)
    .map(s => {
      const description = s.description || s.id || '';
      let range = s.range || (s.expectedMin != null && s.expectedMax != null
        ? (s.expectedMin === s.expectedMax ? `${s.expectedMin}` : `${s.expectedMin}-${s.expectedMax}`)
        : '');
      if (range) {
        const parts = String(range).split('-');
        if (parts.length === 2 && parts[0] === parts[1]) range = parts[0];
      }
      const rangeSuffix = range && !description.includes(`[${range}]`) ? ` <span class="stat-range">[${escapeHtml(range)}]</span>` : '';
      return `<div class="sp-row sp-row-single"><span class="sp-cell is-same">${escapeHtml(description)}${rangeSuffix}</span></div>`;
    }).join('');
  const moreCount = Math.max(0, statRows.length - (state.viewMode === 'detailed' ? 12 : 8));
  card.className = `base-item-card item-index-card ${qClass} ${outOfDateClass}`.trim();
  card.innerHTML = `
    <div class="sp-head">
      ${iconMarkup}
      <div class="sp-head-text">
        <span class="set-th-name">${cleanTitle}</span>
        <span class="set-th-meta">${baseLineText}</span>
        ${tagsHtml}
      </div>
    </div>
    ${statRowsHtml}
    ${moreCount ? `<div class="sp-row sp-row-single"><span class="sp-cell is-same">+ ${moreCount} more properties…</span></div>` : ''}
    ${it.isOutOfDate && it.outOfDateIssues?.length ? `<div class="sp-sep">Patch mismatches</div><div class="sp-row sp-row-single"><span class="sp-cell is-changed">${it.outOfDateIssues.slice(0, 3).map(escapeHtml).join('<br>')}</span></div>` : ''}
  `;

  card.addEventListener('click', () => openItemDetailModal(it));
  return card;
}

function renderItemsTable() {
  dom.itemsTableBody.innerHTML = '';
  state.items.forEach(it => {
    const tr = document.createElement('tr');
    const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
    const displayName = escapeHtml(it.displayName);
    const baseName = escapeHtml(it.baseName || '');
    const quality = it.isRuneword ? 'Runeword' : (it.quality || 'Normal');
    const tier = it.tier || '-';
    const loc = escapeHtml(it.location || '-');
    const owner = escapeHtml(it.sourceName);
    const perf = (typeof it.perfectionNum === 'number' && !isNaN(it.perfectionNum)) 
      ? (it.perfectionNum >= 100 
          ? `<span class="badge badge-perf-perfect">★ 100%</span>` 
          : `<span class="badge ${it.perfectionNum >= 90 ? 'badge-perf-high' : 'badge-perf'}">${it.perfectionNum.toFixed(1)}%</span>`)
      : '-';
    const oodBadge = it.isOutOfDate ? ` <span class="badge badge-out-of-date" style="font-size: 9px; vertical-align: middle;">⚠️ Out of Date</span>` : '';

    // Summary of stats
    const stats = (it.runewordStats || []).concat(it.stats || []);
    const statSummary = stats.slice(0, 2).map(s => escapeHtml(s.description || '')).join(', ');
    const spriteThumb = it.invFile ? `<img src="assets/items/${it.invFile}" class="table-item-icon" loading="lazy" onerror="this.style.display='none'" />` : '';

    tr.innerHTML = `
      <td>${spriteThumb}<strong class="${qColorClass}">${displayName}</strong>${oodBadge}</td>
      <td>${baseName}</td>
      <td><span class="${qColorClass}">${quality}</span></td>
      <td>${tier}</td>
      <td>${loc}</td>
      <td>${owner}</td>
      <td><strong>${perf}</strong></td>
      <td><small class="item-stat-row">${statSummary}</small></td>
    `;
    tr.addEventListener('click', () => openItemDetailModal(it));
    dom.itemsTableBody.appendChild(tr);
  });
}

// Item Detail Modal
function openItemDetailModal(it) {
  const qKey = getQualityKey(it.quality, it.isRuneword);
  const qClass = getQualityClass(it.quality, it.isRuneword);
  const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
  const cleanTitle = escapeHtml(formatItemTitle(it.displayName));
  const qualityLabel = it.isRuneword ? 'Runeword' : (it.quality || 'Normal');
  const typeIconHref = getItemTypeIconHref(it);

  dom.itemModalTitle.innerHTML = `<span class="${qColorClass}">${cleanTitle}</span>`;

  // Left Side: BT-BK Gothic Tooltip Card
  const spriteImg = it.invFile ? `
    <div class="tooltip-art">
      <img src="assets/items/${it.invFile}" alt="${cleanTitle}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='grid';" />
      <span class="fallback-icon-box" style="display:none;"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
    </div>
  ` : `
    <div class="tooltip-art">
      <span class="fallback-icon-box"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
    </div>
  `;

  let ttMetaRows = [];
  if (it.baseName) ttMetaRows.push(`<li class="meta"><strong>Base Item:</strong> ${escapeHtml(it.baseName)}</li>`);
  if (it.type) ttMetaRows.push(`<li class="meta"><strong>Item Type:</strong> ${escapeHtml(it.type)}</li>`);
  if (it.tier) ttMetaRows.push(`<li class="meta"><strong>Tier:</strong> ${escapeHtml(it.tier)}</li>`);
  if (it.defense) ttMetaRows.push(`<li class="meta"><strong>Defense:</strong> ${it.defense}${it.baseDefenseRange ? ` (Base: ${it.baseDefenseRange})` : ''}</li>`);
  if (it.twoHandedDamage) ttMetaRows.push(`<li class="meta"><strong>Two-Hand Damage:</strong> ${it.twoHandedDamage}</li>`);
  else if (it.oneHandedDamage) ttMetaRows.push(`<li class="meta"><strong>One-Hand Damage:</strong> ${it.oneHandedDamage}</li>`);
  if (it.durability && it.maxDurability) ttMetaRows.push(`<li class="meta"><strong>Durability:</strong> ${it.durability}/${it.maxDurability}</li>`);
  if (it.itemLevel != null) ttMetaRows.push(`<li class="meta"><strong>Item Level:</strong> ${it.itemLevel}</li>`);
  const reqLvl = it.requiredLevel ?? it.lvlReq;
  if (reqLvl != null) ttMetaRows.push(`<li class="meta req"><strong>Required Level:</strong> ${reqLvl}</li>`);
  if (it.requiredStrength) ttMetaRows.push(`<li class="meta req"><strong>Required Strength:</strong> ${it.requiredStrength}</li>`);
  if (it.requiredDexterity) ttMetaRows.push(`<li class="meta req"><strong>Required Dexterity:</strong> ${it.requiredDexterity}</li>`);
  if (it.socketCount > 0) ttMetaRows.push(`<li class="meta"><strong>Sockets:</strong> ${it.socketCount} (${it.openSockets || 0} open)</li>`);

  const isStack = it.isAdvancedStack || (it.quantity != null && it.quantity > 1);
  const stackQty = it.quantity != null ? it.quantity : 1;
  if (isStack) {
    ttMetaRows.push(`<li class="meta" style="color: #ffd700;"><strong>Stack Quantity:</strong> ${stackQty}</li>`);
  }

  let ttStatsRows = '';
  const intrinsicStats = (it.runewordStats || []).concat(it.stats || []).map(s => typeof s === 'string' ? { description: s } : s);
  if (intrinsicStats.length > 0) {
    ttStatsRows += intrinsicStats.map(s => {
      const isCorrupt = (s.description || s.id || '').toLowerCase().includes('corrupt');
      return `<li class="${isCorrupt ? 'req' : ''}">${escapeHtml(s.description || s.id)}</li>`;
    }).join('');
  }
  if (it.socketBonuses && it.socketBonuses.length > 0) {
    ttStatsRows += it.socketBonuses.map(sb => `<li style="color:#647eff;">${escapeHtml(sb)}</li>`).join('');
  }
  for (let i = 1; i <= 5; i++) {
    const sbKey = 'setBonus' + i;
    if (it[sbKey] && it[sbKey].length > 0) {
      ttStatsRows += it[sbKey].map(sb => `<li style="color:var(--q-set);">${escapeHtml(sb.description || sb.id)}</li>`).join('');
    }
  }

  const tooltipHtml = `
    <aside class="tooltip q-${qKey}" aria-label="${cleanTitle} item tooltip">
      ${spriteImg}
      <div class="tt-name">${cleanTitle}</div>
      <div class="tt-base">${escapeHtml(it.baseName || it.type || '')}</div>
      ${ttMetaRows.length > 0 ? `<div class="tt-rule"></div><ul class="tt-stats">${ttMetaRows.join('')}</ul>` : ''}
      ${ttStatsRows ? `<div class="tt-rule"></div><ul class="tt-stats">${ttStatsRows}</ul>` : ''}
    </aside>
  `;

  // Right Side: Detail Main
  let detailMainHtml = `
    <div class="detail-main">
      <div>
        <div class="detail-title">
          <h1>${cleanTitle}</h1>
          <span class="pill ${qKey}">${qualityLabel}</span>
          ${isStack ? `<span class="pill stack-qty" style="background: rgba(227, 179, 65, 0.2); border: 1px solid var(--gold); color: #ffd700; font-weight: 700;">📦 Stack: ${stackQty}</span>` : ''}
          ${it.isEthereal ? '<span class="pill ethereal">Ethereal</span>' : ''}
          ${it.isCorrupted ? '<span class="pill corrupted">💥 Corrupted</span>' : ''}
          ${it.socketCount > 0 ? `<span class="pill socket">${it.socketCount} Sockets</span>` : ''}
          ${it.isUnidentified ? '<span class="pill req">Unidentified</span>' : ''}
        </div>
        ${it.isChronicleItem ? `
          <p class="muted" style="margin-top:6px;">
            Chronicle Status: <strong style="color: ${it.tracked ? '#4ade80' : '#f87171'}">${it.tracked ? '✔ Discovered' : '✖ Undiscovered'}</strong>
            ${it.isManual ? ' <span class="badge" style="background:rgba(234,179,8,0.2);color:#facc15;border:1px solid #ca8a04;">Manual</span>' : ''}
          </p>
        ` : `
          <p class="muted">
            Owned by <strong>${escapeHtml(it.sourceName || 'Unknown')}</strong> · Location: <strong>${escapeHtml(it.location || 'Unknown')}</strong>
          </p>
        `}
      </div>
  `;

  // Perfection score panel
  if (typeof it.perfectionNum === 'number' && !isNaN(it.perfectionNum)) {
    const isPerfect = it.perfectionNum >= 100;
    detailMainHtml += `
      <section class="panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0; font-size:1.05rem;"><svg aria-hidden="true"><use href="#i-sigil"/></svg> Perfection Score</h2>
          <span class="pill ${isPerfect ? 'perfection-perfect' : 'perfection-high'}">★ ${it.perfectionNum.toFixed(2)}%</span>
        </div>
        <div class="progress-bar-wrap" style="height: 8px; margin: 0; background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; overflow: hidden;">
          <div class="progress-bar-fill" style="width: ${it.perfectionNum}%; height: 100%; background: linear-gradient(90deg, var(--gold-deep), var(--gold-bright));"></div>
        </div>
      </section>
    `;
  }

  // Out of date banner
  if (it.isOutOfDate) {
    detailMainHtml += `
      <section class="panel" style="border-color: var(--removed); background: rgba(192, 86, 63, 0.08);">
        <h2 style="color: var(--removed); font-size: 1rem; margin: 0 0 6px;">⚠️ Legacy / Out-of-Date Item Detected</h2>
        <p style="font-size: 0.86rem; color: var(--text); margin: 0 0 10px;">This item's rolled property ranges or affixes differ from current game/mod definitions.</p>
        ${it.outOfDateIssues && it.outOfDateIssues.length > 0 ? `
          <ul class="property-list">
            ${it.outOfDateIssues.map(iss => `<li class="property-entry is-warning">${escapeHtml(iss)}</li>`).join('')}
          </ul>
        ` : ''}
      </section>
    `;
  }

  // Intrinsic Stats
  if (intrinsicStats.length > 0) {
    detailMainHtml += `
      <section class="panel">
        <h2><svg aria-hidden="true"><use href="#i-magic"/></svg> Item Properties</h2>
        <ul class="property-list">
          ${intrinsicStats.map(s => {
            const isCorrupt = (s.description || s.id || '').toLowerCase().includes('corrupt');
            return `<li class="property-entry ${isCorrupt ? 'req' : ''}">${escapeHtml(s.description || s.id)}</li>`;
          }).join('')}
        </ul>
      </section>
    `;
  }

  // Set Bonuses
  for (let i = 1; i <= 5; i++) {
    const sbKey = 'setBonus' + i;
    if (it[sbKey] && it[sbKey].length > 0) {
      detailMainHtml += `
        <section class="panel">
          <h2 style="color:var(--q-set);"><svg aria-hidden="true"><use href="#i-magic"/></svg> Set Bonus (${i})</h2>
          <ul class="property-list">
            ${it[sbKey].map(sb => `<li class="property-entry" style="color:var(--q-set);">${escapeHtml(sb.description || sb.id)}</li>`).join('')}
          </ul>
        </section>
      `;
    }
  }

  // Socketed items & socket bonuses
  if ((it.sockets && it.sockets.length > 0) || (it.socketBonuses && it.socketBonuses.length > 0)) {
    detailMainHtml += `
      <section class="panel">
        <h2><svg aria-hidden="true"><use href="#i-gem"/></svg> Socket Details (${it.socketCount} Sockets, ${it.openSockets || 0} Open)</h2>
        ${it.sockets && it.sockets.length > 0 ? `
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom: 8px;">
            ${it.sockets.map(sk => {
              const code = (sk.code || '').toLowerCase().trim();
              const sprite = (window.itemImageMappings && (window.itemImageMappings.hd_codes?.[code] || window.itemImageMappings.codes?.[code])) || (code.startsWith('jew') ? 'hd_jewel_1.png' : null);
              const imgHtml = sprite ? `<img src="assets/items/${sprite}" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:6px;">` : '💎 ';
              return `<span class="socket-pill" style="display:inline-flex;align-items:center;">${imgHtml}${escapeHtml(sk.name)}</span>`;
            }).join('')}
          </div>
        ` : ''}
        ${it.socketBonuses && it.socketBonuses.length > 0 ? `
          <ul class="property-list">
            ${it.socketBonuses.map(sb => `<li class="property-entry">${escapeHtml(sb)}</li>`).join('')}
          </ul>
        ` : ''}
      </section>
    `;
  }

  // Transfer and Edit Stack item action panel
  const editStackBtnHtml = it.isStash && it.isAdvancedStack ? `
    <button class="filter-button" onclick="if (window.openEditStackModalByCode) { window.openEditStackModalFromItem(${it.id}); }" style="border-color: var(--gold); color: #ffd700; font-weight: 600; font-size: 0.85rem; margin-right: 8px;">
      ✏️ Edit Stack (${stackQty})
    </button>
  ` : '';

  const safeItemName = escapeHtml(it.name || '');
  const managementSectionHtml = it.isChronicleItem ? `
    <section class="panel" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <strong style="color:var(--text); font-size:0.92rem;">The Chronicle Tracker</strong>
        <p class="muted" style="margin:2px 0 0; font-size:0.8rem;">
          Toggle this item's completion status in your Chronicle collection.
        </p>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="filter-button" onclick="window.toggleChronicleItem('${safeItemName}', ${!it.tracked}); window.closeItemDetailModal();" style="border-color: ${it.tracked ? '#ef4444' : 'var(--gold)'}; color: ${it.tracked ? '#f87171' : '#ffd700'}; font-weight: 600; font-size: 0.85rem;">
          ${it.tracked ? '✖ Mark as Undiscovered' : '✔ Mark as Completed in Chronicle'}
        </button>
      </div>
    </section>
  ` : `
    <section class="panel" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <strong style="color:var(--text); font-size:0.92rem;">Item Management</strong>
        <p class="muted" style="margin:2px 0 0; font-size:0.8rem;">
          ${isStack ? `Current Stack: <strong style="color:#ffd700;">${stackQty}</strong> &bull; ` : ''}Transfer this item or adjust its stack quantity.
        </p>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        ${editStackBtnHtml}
        <button class="filter-button" onclick="openTransferModalForItemId(${it.id})" style="border-color: var(--gold-deep); color: var(--gold); font-weight: 600; font-size: 0.85rem;">
          📦 Transfer Item →
        </button>
      </div>
    </section>
  `;

  detailMainHtml += `
      ${managementSectionHtml}
    </div>
  `;

  dom.itemModalBody.innerHTML = `
    <div class="detail item-detail-layout">
      ${tooltipHtml}
      ${detailMainHtml}
    </div>
  `;
  dom.itemModal.style.display = 'flex';

  window.closeItemDetailModal = function() {
    dom.itemModal.style.display = 'none';
  };

  // Copy item info handler
  dom.itemModalCopyBtn.onclick = () => {
    let copyText = `${cleanTitle} (${it.baseName || it.base || ''})\n`;
    if (it.sourceName) copyText += `Location: ${it.sourceName} - ${it.location || ''}\n`;
    if (it.requiredLevel || it.lvlReq) copyText += `Required Level: ${it.requiredLevel || it.lvlReq}\n`;
    if (typeof it.perfectionNum === 'number' && !isNaN(it.perfectionNum)) copyText += `Perfection: ${it.perfectionNum.toFixed(1)}%\n`;
    intrinsicStats.forEach(s => copyText += `${s.description || s.id}\n`);
    navigator.clipboard.writeText(copyText).then(() => {
      showToast('Item details copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy to clipboard', 'error');
    });
  };
}

function renderComparisonSection(comp) {
  if (!comp || !comp.stats_comparison || comp.stats_comparison.length === 0) return '<p class="muted">No supported comparison is available for this item.</p>';
  if (comp.catalogStale) return '<p class="muted">Definitions or saved data changed. Rescan before comparing this item.</p>';

  let html = `
    <div class="comparison-section">
      <div class="comparison-title-row">
        <h4>BKDiablo Definition Comparison</h4>
        <span class="badge ${comp.is_out_of_date ? 'badge-out-of-date' : 'badge-perf'}">
          ${comp.is_out_of_date ? 'Differences from current definitions' : 'Known ranges checked; verification incomplete'}
        </span>
      </div>
  `;

  if (comp.is_out_of_date && comp.issues && comp.issues.length > 0) {
    html += '<div class="out-of-date-issues-box" style="margin-bottom: 12px;">';
    html += '<div class="out-of-date-issues-title">Detected Issues:</div>';
    comp.issues.forEach(iss => {
      let issClass = '';
      if (iss.includes('Missing')) issClass = 'issue-missing';
      else if (iss.includes('ABOVE')) issClass = 'issue-above';
      html += `<div class="out-of-date-issue-item ${issClass}">• ${escapeHtml(iss)}</div>`;
    });
    html += '</div>';
  }

  html += `
      <p class="muted">Known properties only · Definition revision ${escapeHtml((comp.catalogRevision || 'unknown').slice(0, 12))}</p>
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Property / Stat</th>
              <th>Rolled Value</th>
              <th>Expected Range</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
  `;

  comp.stats_comparison.forEach(s => {
    const isMismatch = s.status !== 'ok';
    const rowClass = isMismatch ? 'row-mismatch' : '';
    let statusBadge = s.status === 'unknown' ? '<span class="status-tag">Not verified</span>' : '<span class="status-tag status-ok">✔ In Range</span>'; 
    let valText = s.actualValue !== null && s.actualValue !== undefined ? escapeHtml(String(s.actualValue)) : '<em style="color: #eccc68;">None</em>';

    if (s.status === 'below_min') {
      statusBadge = '<span class="status-tag status-below">▼ Below Min</span>';
      valText = `<strong style="color: #ff6b81;">${valText}</strong>`;
    } else if (s.status === 'above_max') {
      statusBadge = '<span class="status-tag status-above">▲ Above Max</span>';
      valText = `<strong style="color: #a29bfe;">${valText}</strong>`;
    } else if (s.status === 'missing') {
      statusBadge = '<span class="status-tag status-missing">⚠️ Missing</span>';
      valText = '<strong style="color: #ffa502;">Missing</strong>';
    }

    const rangeText = s.range ? escapeHtml(s.range) : (s.expectedMin !== null && s.expectedMax !== null ? (s.expectedMin === s.expectedMax ? s.expectedMin : `${s.expectedMin}-${s.expectedMax}`) : '-');

    html += `
      <tr class="${rowClass}">
        <td><strong>${escapeHtml(s.description || s.id)}</strong></td>
        <td>${valText}</td>
        <td>${rangeText}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;
  return html;
}

dom.itemModalCloseBtn.addEventListener('click', () => dom.itemModal.style.display = 'none');
dom.itemModalDoneBtn.addEventListener('click', () => dom.itemModal.style.display = 'none');

// View Mode Toggle (Grid vs Detailed vs Table)
if (dom.modeGridBtn) {
  dom.modeGridBtn.addEventListener('click', () => {
    dom.modeGridBtn.classList.add('active');
    if (dom.modeDetailBtn) dom.modeDetailBtn.classList.remove('active');
    if (dom.modeTableBtn) dom.modeTableBtn.classList.remove('active');
    state.viewMode = 'grid';
    renderItemsView();
  });
}

if (dom.modeDetailBtn) {
  dom.modeDetailBtn.addEventListener('click', () => {
    dom.modeDetailBtn.classList.add('active');
    if (dom.modeGridBtn) dom.modeGridBtn.classList.remove('active');
    if (dom.modeTableBtn) dom.modeTableBtn.classList.remove('active');
    state.viewMode = 'detailed';
    renderItemsView();
  });
}

if (dom.modeTableBtn) {
  dom.modeTableBtn.addEventListener('click', () => {
    dom.modeTableBtn.classList.add('active');
    if (dom.modeGridBtn) dom.modeGridBtn.classList.remove('active');
    if (dom.modeDetailBtn) dom.modeDetailBtn.classList.remove('active');
    state.viewMode = 'table';
    renderItemsView();
  });
}

// Search and Filter Events
dom.searchInput.addEventListener('input', (e) => {
  state.filters.q = e.target.value.trim();
  debouncedSearch();
});

dom.searchClearBtn.addEventListener('click', () => {
  dom.searchInput.value = '';
  state.filters.q = '';
  executeSearch();
});

document.querySelectorAll('#quality-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#quality-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filters.quality = chip.dataset.value;
    executeSearch();
  });
});

dom.characterFilter.addEventListener('change', (e) => {
  state.filters.source = e.target.value;
  executeSearch();
});

dom.typeFilter.addEventListener('change', (e) => {
  state.filters.type = e.target.value;
  executeSearch();
});

dom.tierFilter.addEventListener('change', (e) => {
  state.filters.tier = e.target.value;
  executeSearch();
});

dom.locationFilter.addEventListener('change', (e) => {
  state.filters.location = e.target.value;
  executeSearch();
});

dom.socketsFilter.addEventListener('change', (e) => {
  state.filters.sockets = e.target.value;
  executeSearch();
});

document.querySelectorAll('[data-ethereal]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-ethereal]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filters.ethereal = btn.dataset.ethereal;
    executeSearch();
  });
});

document.querySelectorAll('[data-out-of-date]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-out-of-date]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filters.out_of_date = btn.dataset.outOfDate;
    executeSearch();
  });
});

dom.perfMinSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  dom.perfValLabel.textContent = val + '%';
  state.filters.min_perf = val;
  // Sync segmented control
  document.querySelectorAll('#perfect-control .seg-btn').forEach(b => b.classList.remove('active'));
  if (val >= 100) {
    state.filters.perfect = '100';
    const b100 = document.querySelector('#perfect-control [data-perfect="100"]');
    if (b100) b100.classList.add('active');
  } else if (val >= 90) {
    state.filters.perfect = '90';
    const b90 = document.querySelector('#perfect-control [data-perfect="90"]');
    if (b90) b90.classList.add('active');
  } else if (val === 0) {
    state.filters.perfect = 'all';
    const bAll = document.querySelector('#perfect-control [data-perfect="all"]');
    if (bAll) bAll.classList.add('active');
  } else {
    state.filters.perfect = 'all';
  }
  debouncedSearch();
});

dom.perf90Btn?.addEventListener('click', () => {
  dom.perfMinSlider.value = 90;
  dom.perfValLabel.textContent = '90%';
  state.filters.min_perf = 90;
  state.filters.perfect = '90';
  document.querySelectorAll('#perfect-control .seg-btn').forEach(b => b.classList.remove('active'));
  const b90 = document.querySelector('#perfect-control [data-perfect="90"]');
  if (b90) b90.classList.add('active');
  executeSearch();
});

dom.perf100Btn?.addEventListener('click', () => {
  dom.perfMinSlider.value = 100;
  dom.perfValLabel.textContent = '100%';
  state.filters.min_perf = 100;
  state.filters.perfect = '100';
  document.querySelectorAll('#perfect-control .seg-btn').forEach(b => b.classList.remove('active'));
  const b100 = document.querySelector('#perfect-control [data-perfect="100"]');
  if (b100) b100.classList.add('active');
  executeSearch();
});

document.querySelectorAll('#perfect-control .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#perfect-control .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.perfect;
    state.filters.perfect = p;
    if (p === '100') {
      dom.perfMinSlider.value = 100;
      dom.perfValLabel.textContent = '100%';
      state.filters.min_perf = 100;
    } else if (p === '90') {
      dom.perfMinSlider.value = 90;
      dom.perfValLabel.textContent = '90%';
      state.filters.min_perf = 90;
    } else {
      dom.perfMinSlider.value = 0;
      dom.perfValLabel.textContent = '0%';
      state.filters.min_perf = 0;
    }
    executeSearch();
  });
});

dom.statFilter.addEventListener('input', (e) => {
  state.filters.stat = e.target.value.trim();
  debouncedSearch();
});

document.querySelectorAll('.quick-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    dom.statFilter.value = tag.dataset.stat;
    state.filters.stat = tag.dataset.stat;
    executeSearch();
  });
});

dom.sortSelect.addEventListener('change', (e) => {
  state.filters.sort = e.target.value;
  executeSearch();
});

dom.resetFiltersBtn.addEventListener('click', () => {
  dom.searchInput.value = '';
  dom.statFilter.value = '';
  dom.characterFilter.value = 'all';
  dom.typeFilter.value = 'all';
  dom.tierFilter.value = 'all';
  dom.locationFilter.value = 'all';
  dom.socketsFilter.value = 'all';
  dom.perfMinSlider.value = 0;
  dom.perfValLabel.textContent = '0%';
  document.querySelectorAll('#perfect-control .seg-btn').forEach(b => b.classList.remove('active'));
  const allPerfBtn = document.querySelector('#perfect-control [data-perfect="all"]');
  if (allPerfBtn) allPerfBtn.classList.add('active');
  document.querySelectorAll('#quality-chips .chip').forEach(c => c.classList.remove('active'));
  document.querySelector('#quality-chips .chip[data-value="all"]').classList.add('active');
  document.querySelectorAll('[data-ethereal]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-ethereal="all"]').classList.add('active');
  document.querySelectorAll('[data-out-of-date]').forEach(b => b.classList.remove('active'));
  const allOodBtn = document.querySelector('[data-out-of-date="all"]');
  if (allOodBtn) allOodBtn.classList.add('active');

  state.filters = {
    q: '',
    quality: 'all',
    source: 'all',
    type: 'all',
    tier: 'all',
    location: 'all',
    sockets: 'all',
    ethereal: 'all',
    out_of_date: 'all',
    perfect: 'all',
    min_perf: 0,
    stat: '',
    sort: 'perfection_desc'
  };
  executeSearch();
});

// ==========================================================================
// CHARACTERS & STASH VIEW
// ==========================================================================
function renderCharactersView() {
  if (!dom.charactersGrid || !dom.charactersSummaryStats) return;
  dom.charactersGrid.innerHTML = '';

  const chars = state.saves.filter(s => !s.is_stash);
  const stashes = state.saves.filter(s => s.is_stash);
  const totalItems = state.saves.reduce((acc, s) => acc + (s.item_count || 0), 0);

  dom.charactersSummaryStats.innerHTML = `
    <div class="stat-pill">
      <span class="stat-pill-label">Characters</span>
      <span class="stat-pill-val">${chars.length}</span>
    </div>
    <div class="stat-pill">
      <span class="stat-pill-label">Shared Stashes</span>
      <span class="stat-pill-val">${stashes.length}</span>
    </div>
    <div class="stat-pill">
      <span class="stat-pill-label">Total Items</span>
      <span class="stat-pill-val">${totalItems}</span>
    </div>
  `;

  // Render Characters
  chars.forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card';
    const isHC = c.core === 'hard';
    const stats = c.stats || {};

    card.innerHTML = `
      <div class="char-card-top">
        <div class="char-title-wrap">
          <span class="char-name">${escapeHtml(c.name)}</span>
          <span class="char-meta-line">Level ${c.level} ${escapeHtml(c.class)}</span>
        </div>
        <div class="char-flags">
          ${isHC ? '<span class="badge badge-hardcore">HARDCORE</span>' : '<span class="badge">SOFTCORE</span>'}
        </div>
      </div>

      <div class="char-attributes-grid">
        <div class="attr-box"><span class="attr-name">STR</span><span class="attr-val">${stats.strength || '-'}</span></div>
        <div class="attr-box"><span class="attr-name">DEX</span><span class="attr-val">${stats.dexterity || '-'}</span></div>
        <div class="attr-box"><span class="attr-name">VIT</span><span class="attr-val">${stats.vitality || '-'}</span></div>
        <div class="attr-box"><span class="attr-name">ENG</span><span class="attr-val">${stats.energy || '-'}</span></div>
      </div>

      <div class="char-pools">
        <div class="pool-bar"><span class="pool-life">❤️ Life:</span><span>${stats.life || '-'}</span></div>
        <div class="pool-bar"><span class="pool-mana">🔮 Mana:</span><span>${stats.mana || '-'}</span></div>
        <div class="pool-bar"><span class="pool-gold">💰 Gold:</span><span>${(stats.stashGold || 0).toLocaleString()}</span></div>
      </div>

      <div class="char-card-actions">
        <button class="btn btn-secondary btn-sm" onclick="filterBySource('${escapeHtml(c.name)}')">View ${c.item_count} Items</button>
        <button class="btn btn-primary btn-sm" onclick="openArmoryForChar('${escapeHtml(c.name)}')">Armory Sheet</button>
        <button class="btn btn-secondary btn-sm" onclick="openQuestsModal('${escapeHtml(c.name)}')">📜 Quests &amp; WPs</button>
      </div>
    `;
    dom.charactersGrid.appendChild(card);
  });

  // Render Shared Stashes
  stashes.forEach(s => {
    const card = document.createElement('div');
    card.className = 'char-card';
    const isHC = s.core === 'hard';
    const tabsCount = (s.tabs || []).length;

    let tabsHtml = '';
    if (s.tabs && s.tabs.length > 0) {
      tabsHtml = '<div style="display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0;">';
      s.tabs.forEach((t, idx) => {
        tabsHtml += `<span class="badge">Tab ${idx + 1}: ${t.itemCount || 0} items</span>`;
      });
      tabsHtml += '</div>';
    }

    card.innerHTML = `
      <div class="char-card-top">
        <div class="char-title-wrap">
          <span class="char-name">📦 Shared Stash</span>
          <span class="char-meta-line">${escapeHtml(s.file)}</span>
        </div>
        <div class="char-flags">
          ${isHC ? '<span class="badge badge-hardcore">HARDCORE</span>' : '<span class="badge">SOFTCORE</span>'}
        </div>
      </div>

      <div style="font-size: 13px; color: var(--text-muted);">
        <div><strong>Total Tabs:</strong> ${tabsCount}</div>
        <div><strong>Total Items:</strong> ${s.item_count}</div>
        <div><strong>Total Gold:</strong> ${(s.total_gold || 0).toLocaleString()}</div>
      </div>

      ${tabsHtml}

      <div class="char-card-actions">
        <button class="btn btn-primary btn-sm" onclick="filterBySource('${escapeHtml(s.file)}')">Explore ${s.item_count} Stash Items</button>
        <button class="btn btn-secondary btn-sm" onclick="openArmoryForStash()">⚔️ In-Game Stash</button>
      </div>
    `;
    dom.charactersGrid.appendChild(card);
  });
}

window.filterBySource = function(sourceName) {
  state.filters.source = sourceName;
  dom.characterFilter.value = sourceName;
  document.querySelector('.nav-tab[data-tab="search-view"]').click();
  executeSearch();
};

window.openArmoryForChar = function(charName) {
  state.selectedChar = charName;
  document.querySelector('.nav-tab[data-tab="armory-view"]').click();
};

// ==========================================================================
// ARMORY / PAPERDOLL SHEET VIEW
// ==========================================================================
async function loadArmoryView() {
  const chars = state.saves.filter(s => !s.is_stash);
  const stashes = state.saves.filter(s => s.is_stash);
  if (chars.length === 0 && stashes.length === 0) {
    dom.armoryContent.innerHTML = '<div class="empty-state"><h3>No saves loaded</h3></div>';
    return;
  }

  const preferredChar = state.selectedChar || window._d2rState?.activeCharName || dom.armoryCharSelect.value;
  dom.armoryCharSelect.innerHTML = '';
  chars.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    const countSuffix = c.item_count != null ? ` - ${c.item_count} items` : '';
    opt.textContent = `${c.name} (Lvl ${c.level} ${c.class}${countSuffix})`;
    if (preferredChar && c.name.toLowerCase() === preferredChar.toLowerCase()) {
      opt.selected = true;
    }
    dom.armoryCharSelect.appendChild(opt);
  });

  if (chars.length === 0 && stashes.length > 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = `Shared Stash (${stashes[0].item_count || 0} items)`;
    opt.selected = true;
    dom.armoryCharSelect.appendChild(opt);
  }

  const activeChar = dom.armoryCharSelect.value || (chars[0] && chars[0].name) || '';
  state.selectedChar = activeChar;
  if (window._d2rState) window._d2rState.activeCharName = activeChar;
  await renderArmoryForChar(activeChar);
}

dom.armoryCharSelect.addEventListener('change', async (e) => {
  state.selectedChar = e.target.value;
  if (window._d2rState) window._d2rState.activeCharName = e.target.value;
  await renderArmoryForChar(e.target.value);
});

async function renderArmoryForChar(charName) {
  try {
    if (window._d2rState) {
      window._d2rState.activeCharName = charName;
    }

    if (window.D2Wasm) {
      const data = charName ? window.D2Wasm.getCharacterDetail(charName, state.saves, state.allWasmItems || state.items) : { character: { name: 'Shared Stash' }, equipped: {}, stats: {}, inventory: [], stash: [], cube: [] };
      const stashData = window.D2Wasm.getSharedStashDetail(state.saves, state.allWasmItems || state.items, charName);
      const dims = { inventory: { width: 11, height: 8 }, stash: { width: 16, height: 13 }, cube: { width: 6, height: 6 } };

      window._currentArmoryData = data;
      if (window.renderD2RInGameArmory) {
        window.renderD2RInGameArmory(data, stashData, dims);
      }
    }
  } catch (err) {
    dom.armoryContent.innerHTML = `<div class="empty-state"><h3>Error loading armory: ${escapeHtml(err.message)}</h3></div>`;
  }
}

window.openPackMuleModalForCurrentArmoryChar = function() {
  const charName = dom.armoryCharSelect ? dom.armoryCharSelect.value : null;
  if (charName && window.openPackMuleModal) {
    window.openPackMuleModal(charName);
  }
};

window.openItemDetailModalById = function(itemId) {
  itemId = parseInt(itemId, 10);
  const allItems = (state && state.items) || [];
  let item = allItems.find(it => it.id === itemId);
  if (!item && typeof d2rState !== 'undefined') {
    item = (d2rState.stashData && d2rState.stashData.tabs && d2rState.stashData.tabs.flatMap(t => t.items || []).find(x => x.id === itemId))
        || (d2rState.charData && [...(d2rState.charData.inventory || []), ...(d2rState.charData.stash || []), ...(d2rState.charData.cube || [])].find(x => x.id === itemId));
  }
  if (item) {
    openItemDetailModal(item);
  }
};

window.openArmorySlotItem = function(slotKey) {
  if (window._currentArmoryData && window._currentArmoryData.equipped[slotKey]) {
    openItemDetailModal(window._currentArmoryData.equipped[slotKey]);
  }
};

window.switchInvTab = function(tabName, btnEl) {
  document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
  const btn = btnEl || document.querySelector(`.inv-tab-btn[data-inv-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');

  const container = document.getElementById('armory-tab-content');
  if (!container || !window._currentArmoryData) return;

  container.innerHTML = '';
  const list = window._currentArmoryData[tabName] || [];
  if (list.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: var(--text-muted); grid-column: 1/-1;">No items in this section.</div>';
    return;
  }

  list.forEach(it => {
    container.appendChild(createItemCardElement(it));
  });
};

// ==========================================================================
// HOLY GRAIL VIEW
// ==========================================================================
async function loadGrailView() {
  if (!dom.grailCategories) return;
  if (window.D2Wasm) {
    state.grail = window.D2Wasm.getGrailProgress(state.allWasmItems || state.items);
    renderGrailView();
  }
}

function renderGrailView() {
  if (!state.grail || !dom.grailCategories) return;

  const g = state.grail;
  const pct = (typeof g.percent === 'number' && !isNaN(g.percent)) ? g.percent.toFixed(2) : '0.00';
  dom.grailOverallScore.textContent = `${pct}%`;
  dom.grailOverallBar.style.width = `${pct}%`;
  dom.grailCountText.textContent = `${g.total_owned || 0} / ${g.total_items || 0} items collected`;

  dom.grailCategories.innerHTML = '';
  (g.categories || []).forEach(cat => {
    const card = document.createElement('div');
    card.className = 'grail-category-card';

    const header = document.createElement('div');
    header.className = 'grail-category-header';
    header.innerHTML = `
      <div class="grail-cat-title-group">
        <h3>${escapeHtml(cat.category)}</h3>
        <span class="badge badge-perf">${cat.owned} / ${cat.total} (${cat.percent}%)</span>
      </div>
      <div class="progress-bar-wrap" style="max-width: 260px; width: 100%; height: 6px;">
        <div class="progress-bar-fill" style="width: ${cat.percent}%;"></div>
      </div>
    `;
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grail-items-grid';

    let matchCount = 0;
    (cat.items || []).forEach(it => {
      if (it.is_group) {
        (it.items || []).forEach(subItem => {
          if (shouldShowGrailItem(subItem.collected)) {
            grid.appendChild(createGrailItemCard(subItem, cat.category, it.group_name));
            matchCount++;
          }
        });
      } else {
        if (shouldShowGrailItem(it.collected)) {
          grid.appendChild(createGrailItemCard(it, cat.category));
          matchCount++;
        }
      }
    });

    if (matchCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.style.padding = '20px 0';
      empty.innerHTML = `<p style="color: var(--muted);">No ${state.grailFilter === 'collected' ? 'collected' : 'missing'} items in this category.</p>`;
      grid.appendChild(empty);
    }

    card.appendChild(grid);
    dom.grailCategories.appendChild(card);
  });
}

function shouldShowGrailItem(collected) {
  if (state.grailFilter === 'collected') return collected;
  if (state.grailFilter === 'missing') return !collected;
  return true;
}

function createGrailItemCard(it, categoryName, groupName) {
  const isCollected = !!it.collected;
  const isSet = (categoryName && categoryName.includes('Set')) || !!groupName;
  const isRuneword = (categoryName && categoryName.includes('Runeword')) || (it.runes && it.runes.length > 0);

  const qClass = isRuneword ? 'q-runeword' : (isSet ? 'q-set' : 'q-unique');
  const qColorClass = isRuneword ? 'color-runeword' : (isSet ? 'color-set' : 'color-unique');
  const cleanTitle = escapeHtml(it.name || '');

  // Look up matching item in state.items for sprite / inspection
  const nameLower = (it.name || '').toLowerCase();
  const ownedMatch = (state.items || []).find(x => {
    const xName = (x.name || '').toLowerCase();
    const xDisp = (x.displayName || '').toLowerCase();
    return xName === nameLower || xDisp === nameLower || xDisp.startsWith(nameLower);
  });

  const invFile = (ownedMatch && ownedMatch.invFile) ? ownedMatch.invFile : (it.invFile || null);
  const typeIconHref = getItemTypeIconHref(ownedMatch || { type: it.base, baseName: it.base });

  const iconMarkup = invFile ? `
    <img class="wiki-item-icon item-card-icon" src="assets/items/${invFile}" alt="${cleanTitle}" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='grid';" />
    <span class="fallback-icon-box" style="display:none;"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
  ` : `
    <span class="fallback-icon-box"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
  `;

  // Meta line (runes, base, set)
  let metaParts = [];
  if (isRuneword && it.runes && it.runes.length > 0) {
    metaParts.push(it.runes.join(' · '));
  }
  if (it.base) metaParts.push(escapeHtml(it.base));
  if (groupName) metaParts.push(`<span style="color:var(--q-set); font-weight:600;">${escapeHtml(groupName)}</span>`);
  const metaLine = metaParts.join(' · ');

  // Status tag
  const statusBadge = isCollected
    ? `<span class="tag tag-found">✔ Found</span>`
    : `<span class="tag tag-missing">✖ Missing</span>`;

  let extraTags = '';
  // Perfection if available
  if (isCollected && it.holders && it.holders.length > 0) {
    const perfs = it.holders.map(h => h.perfectionNum).filter(p => typeof p === 'number' && !isNaN(p));
    if (perfs.length > 0) {
      const best = Math.max(...perfs);
      const isPerf100 = best >= 100;
      extraTags += `<span class="tag perf ${isPerf100 ? 'perf-100' : ''}">★ ${best.toFixed(0)}%</span>`;
    }
  }

  // Location badge if collected
  if (isCollected && it.holders && it.holders.length > 0) {
    const first = it.holders[0];
    const holderCount = it.holders.length;
    const ownerName = escapeHtml(first.source || '');
    const loc = escapeHtml(first.location || '');
    if (holderCount === 1) {
      extraTags += `<span class="tag owner" title="${ownerName} (${loc})">👤 ${ownerName}</span>`;
    } else {
      const allOwners = it.holders.map(h => `${h.source} (${h.location})`).join(', ');
      extraTags += `<span class="tag owner" title="${escapeHtml(allOwners)}">📍 x${holderCount} (${ownerName}…)</span>`;
    }
  }

  const card = document.createElement('div');
  const collectedClass = isCollected ? 'is-collected' : 'is-missing';
  card.className = `base-item-card item-index-card grail-item-card ${qClass} ${collectedClass}`.trim();
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${it.name} (${isCollected ? 'Found' : 'Missing'})`);

  card.innerHTML = `
    <div class="sp-head">
      ${iconMarkup}
      <div class="sp-head-text">
        <span class="set-th-name ${qColorClass}">${cleanTitle}</span>
        <span class="set-th-meta">${metaLine}</span>
        <div class="loot-foot">
          ${statusBadge}
          ${extraTags}
        </div>
      </div>
    </div>
  `;

  if (ownedMatch) {
    card.addEventListener('click', () => openItemDetailModal(ownedMatch));
  }

  return card;
}

document.querySelectorAll('[data-grail-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-grail-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.grailFilter = btn.dataset.grailFilter;
    renderGrailView();
  });
});

// ==========================================================================
// VIEW 4.5: THE CHRONICLE (IN-GAME DISCOVERY TRACKER)
// ==========================================================================

state.chronicle = null;
state.chronicleFilter = 'all'; // 'all', 'discovered', 'undiscovered'
state.chronicleCategory = 'all'; // 'all', 'uniques', 'sets', 'runewords'
state.chronicleSearch = '';
state.chronicleCore = 'both'; // 'both', 'soft', 'hard'

async function loadChronicleView() {
  if (window.D2Wasm && typeof window.D2Wasm.getChronicleProgress === 'function') {
    if (!window.D2Wasm.ready) {
      await window.D2Wasm.init();
    }
    // Auto-rollback unstaged 100% Complete All blowout to restore authentic save file discoveries
    try {
      if (localStorage.getItem('bk-chronicle-rollback-done') !== 'true') {
        const storedManual = JSON.parse(localStorage.getItem('bk-chronicle-manual') || '{}');
        if (Object.keys(storedManual).length > 200) {
          localStorage.removeItem('bk-chronicle-manual');
          console.log('[Chronicle] Automatically rolled back unstaged 100% manual completion blowout.');
        }
        localStorage.setItem('bk-chronicle-rollback-done', 'true');
      }
    } catch (e) {}

    const savesForChronicle = window.D2Wasm.allSaves || state.saves;
    state.chronicle = window.D2Wasm.getChronicleProgress(savesForChronicle, state.chronicleCore);
    mergeLocalChronicleCompletions();
    renderChronicleView();
  }
}
window.loadChronicleView = loadChronicleView;

function mergeLocalChronicleCompletions() {
  if (!state.chronicle || !state.chronicle.categories) return;
  let manual = {};
  try {
    const raw = (window.EditWorkspace?.active && window.EditWorkspace?.hasChronicleChanges)
      ? window.EditWorkspace.chronicleDraft
      : localStorage.getItem('bk-chronicle-manual');
    manual = JSON.parse(raw || '{}');
  } catch (e) {
    manual = {};
  }
  if (!manual || Object.keys(manual).length === 0) return;

  const aliases = {
    'game modifiers': ['game modifers', 'charm modifiers'],
    'game modifers': ['game modifiers', 'charm modifiers'],
    'charm modifiers': ['game modifiers', 'game modifers'],
    'blank charm': ['charm blank'],
    'charm blank': ['blank charm'],
    'level 90 reward': ['charm level reward'],
    'charm level reward': ['level 90 reward']
  };

  function getManualStatus(k) {
    if (k in manual) return manual[k];
    const al = aliases[k];
    if (al) {
      for (const a of al) {
        if (a in manual) return manual[a];
      }
    }
    return undefined;
  }

  state.chronicle.categories.forEach(cat => {
    (cat.items || []).forEach(it => {
      if (it.is_group) {
        (it.items || []).forEach(sub => {
          const k = (sub.name || '').toLowerCase();
          const m = getManualStatus(k);
          if (m !== undefined) {
            sub.tracked = m;
            sub.collected = m;
            sub.isManual = true;
          }
        });
        it.owned_count = (it.items || []).filter(x => x.tracked).length;
      } else {
        const k = (it.name || '').toLowerCase();
        const m = getManualStatus(k);
        if (m !== undefined) {
          it.tracked = m;
          it.collected = m;
          it.isManual = true;
        }
      }
    });
    let catTracked = 0;
    (cat.items || []).forEach(it => {
      if (it.is_group) catTracked += it.owned_count;
      else if (it.tracked) catTracked += 1;
    });
    cat.owned = catTracked;
    cat.percent = cat.total > 0 ? Math.round((cat.owned / cat.total) * 1000) / 10 : 0;
  });

  let totalTracked = 0;
  state.chronicle.categories.forEach(cat => totalTracked += cat.owned);
  state.chronicle.total_owned = totalTracked;
  state.chronicle.percent = state.chronicle.total_items > 0
    ? Math.round((totalTracked / state.chronicle.total_items) * 10000) / 100
    : 0;
}

async function toggleChronicleItem(itemName, newStatus) {
  if (!itemName) return;
  if (window.EditWorkspace && !window.EditWorkspace.active) {
    await window.EditWorkspace.start();
  }
  const nameLower = itemName.toLowerCase();

  // Update in-memory state
  if (state.chronicle && state.chronicle.categories) {
    state.chronicle.categories.forEach(cat => {
      (cat.items || []).forEach(it => {
        if (it.is_group) {
          (it.items || []).forEach(sub => {
            if ((sub.name || '').toLowerCase() === nameLower) {
              sub.tracked = newStatus;
              sub.collected = newStatus;
              sub.isManual = true;
            }
          });
          it.owned_count = (it.items || []).filter(x => x.tracked).length;
        } else {
          if ((it.name || '').toLowerCase() === nameLower) {
            it.tracked = newStatus;
            it.collected = newStatus;
            it.isManual = true;
          }
        }
      });
      let catTracked = 0;
      (cat.items || []).forEach(it => {
        if (it.is_group) catTracked += it.owned_count;
        else if (it.tracked) catTracked += 1;
      });
      cat.owned = catTracked;
      cat.percent = cat.total > 0 ? Math.round((cat.owned / cat.total) * 1000) / 10 : 0;
    });

    let totalTracked = 0;
    state.chronicle.categories.forEach(cat => totalTracked += cat.owned);
    state.chronicle.total_owned = totalTracked;
    state.chronicle.percent = state.chronicle.total_items > 0
      ? Math.round((totalTracked / state.chronicle.total_items) * 10000) / 100
      : 0;
  }

  // Stage in EditWorkspace draft (do NOT write localStorage until Save changes)
  let manual = {};
  try {
    const raw = window.EditWorkspace.chronicleDraft || localStorage.getItem('bk-chronicle-manual');
    manual = JSON.parse(raw || '{}');
  } catch (e) {
    manual = {};
  }
  manual[nameLower] = newStatus;
  const aliases = {
    'game modifiers': ['game modifers', 'charm modifiers'],
    'game modifers': ['game modifiers', 'charm modifiers'],
    'charm modifiers': ['game modifiers', 'game modifers'],
    'blank charm': ['charm blank'],
    'charm blank': ['blank charm'],
    'level 90 reward': ['charm level reward'],
    'charm level reward': ['level 90 reward']
  };
  (aliases[nameLower] || []).forEach(a => manual[a] = newStatus);

  window.EditWorkspace.chronicleDraft = JSON.stringify(manual);
  window.EditWorkspace.hasChronicleChanges = true;
  window.EditWorkspace.changed();

  renderChronicleView();
  showToast(`${itemName} marked as ${newStatus ? 'discovered' : 'undiscovered'} (staged in Edit mode). Click Save changes to apply.`, 'success');
}
window.toggleChronicleItem = toggleChronicleItem;

async function completeAllChronicle() {
  if (window.EditWorkspace && !window.EditWorkspace.active) {
    await window.EditWorkspace.start();
  }
  if (!confirm("Are you sure you want to mark all Chronicle items as completed (100%)?")) {
    return;
  }

  // 1. Update in-memory state
  if (state.chronicle && state.chronicle.categories) {
    state.chronicle.categories.forEach(cat => {
      (cat.items || []).forEach(it => {
        if (it.is_group) {
          (it.items || []).forEach(sub => {
            sub.tracked = true;
            sub.collected = true;
            sub.isManual = true;
          });
          it.owned_count = (it.items || []).length;
        } else {
          it.tracked = true;
          it.collected = true;
          it.isManual = true;
        }
      });
      cat.owned = cat.total;
      cat.percent = 100.0;
    });
    state.chronicle.total_owned = state.chronicle.total_items;
    state.chronicle.percent = 100.0;
  }

  // 2. Stage in EditWorkspace (do NOT save to localStorage until Save changes)
  let manual = {};
  try {
    const raw = window.EditWorkspace.chronicleDraft || localStorage.getItem('bk-chronicle-manual');
    manual = JSON.parse(raw || '{}');
  } catch (e) {
    manual = {};
  }
  if (state.chronicle && state.chronicle.categories) {
    state.chronicle.categories.forEach(cat => {
      (cat.items || []).forEach(it => {
        if (it.is_group) {
          (it.items || []).forEach(sub => {
            if (sub.name) manual[sub.name.toLowerCase()] = true;
          });
        } else {
          if (it.name) manual[it.name.toLowerCase()] = true;
        }
      });
    });
  }
  const aliases = ['game modifiers', 'game modifers', 'charm modifiers', 'blank charm', 'charm blank', 'level 90 reward', 'charm level reward'];
  aliases.forEach(a => manual[a] = true);

  window.EditWorkspace.chronicleDraft = JSON.stringify(manual);
  window.EditWorkspace.hasChronicleChanges = true;
  window.EditWorkspace.changed();

  renderChronicleView();
  showToast('Chronicle marked 100% complete (staged in Edit mode). Click Save changes to apply.', 'success');
}
window.completeAllChronicle = completeAllChronicle;

async function completeUndroppableChronicle() {
  if (window.EditWorkspace && !window.EditWorkspace.active) {
    await window.EditWorkspace.start();
  }
  const undroppableList = [
    'game modifiers',
    'game modifers',
    'charm modifiers',
    'blank charm',
    'charm blank',
    'level 90 reward',
    'charm level reward',
    'azurewrath',
    'gore ripper',
    "zakarum's salvation",
    "larzuk's champion",
    'darkfear',
    'crafted cold rupture',
    'crafted flame rift',
    'crafted crack of the heavens',
    'crafted rotting fissure',
    'crafted bone break',
    'crafted black cleft',
    'horadric staff',
    'hell forge hammer'
  ];
  const undroppableSet = new Set(undroppableList);

  let updatedCount = 0;

  // 1. Update in-memory state
  if (state.chronicle && state.chronicle.categories) {
    state.chronicle.categories.forEach(cat => {
      (cat.items || []).forEach(it => {
        if (it.is_group) {
          (it.items || []).forEach(sub => {
            const k = (sub.name || '').toLowerCase();
            if (undroppableSet.has(k)) {
              sub.tracked = true;
              sub.collected = true;
              sub.isManual = true;
              updatedCount++;
            }
          });
          it.owned_count = (it.items || []).filter(x => x.tracked).length;
        } else {
          const k = (it.name || '').toLowerCase();
          if (undroppableSet.has(k)) {
            it.tracked = true;
            it.collected = true;
            it.isManual = true;
            updatedCount++;
          }
        }
      });
      let catTracked = 0;
      (cat.items || []).forEach(it => {
        if (it.is_group) catTracked += it.owned_count;
        else if (it.tracked) catTracked += 1;
      });
      cat.owned = catTracked;
      cat.percent = cat.total > 0 ? Math.round((cat.owned / cat.total) * 1000) / 10 : 0;
    });

    let totalTracked = 0;
    state.chronicle.categories.forEach(cat => totalTracked += cat.owned);
    state.chronicle.total_owned = totalTracked;
    state.chronicle.percent = state.chronicle.total_items > 0
      ? Math.round((totalTracked / state.chronicle.total_items) * 10000) / 100
      : 0;
  }

  // 2. Stage in EditWorkspace (do NOT save to localStorage until Save changes)
  let manual = {};
  try {
    const raw = window.EditWorkspace.chronicleDraft || localStorage.getItem('bk-chronicle-manual');
    manual = JSON.parse(raw || '{}');
  } catch (e) {
    manual = {};
  }
  undroppableList.forEach(k => manual[k] = true);

  window.EditWorkspace.chronicleDraft = JSON.stringify(manual);
  window.EditWorkspace.hasChronicleChanges = true;
  window.EditWorkspace.changed();

  renderChronicleView();
  showToast('Undroppable items marked as complete (staged in Edit mode). Click Save changes to apply.', 'success');
}
window.completeUndroppableChronicle = completeUndroppableChronicle;

async function resetChronicleCompletions() {
  if (!confirm("Reset all manual Chronicle completions and revert to save file discoveries?")) {
    return;
  }

  if (window.EditWorkspace && !window.EditWorkspace.active) {
    await window.EditWorkspace.start();
  }

  if (window.EditWorkspace?.active) {
    window.EditWorkspace.chronicleDraft = '{}';
    window.EditWorkspace.hasChronicleChanges = true;
    window.EditWorkspace.changed();
    await loadChronicleView();
    showToast('Chronicle manual completions reset (staged in Edit mode). Click Save changes to apply.', 'info');
  } else {
    try {
      localStorage.removeItem('bk-chronicle-manual');
      localStorage.setItem('bk-chronicle-rollback-done', 'true');
    } catch (e) {}
    await loadChronicleView();
    showToast('Chronicle manual completions reset!', 'info');
  }
}
window.resetChronicleCompletions = resetChronicleCompletions;

function setChronicleCore(core) {
  state.chronicleCore = core;
  document.querySelectorAll('[data-chronicle-core]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-chronicle-core') === core);
  });
  loadChronicleView();
}
window.setChronicleCore = setChronicleCore;

function setChronicleStatus(status) {
  state.chronicleFilter = status;
  document.querySelectorAll('[data-chronicle-status]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-chronicle-status') === status);
  });
  renderChronicleView();
}
window.setChronicleStatus = setChronicleStatus;

function setChronicleCategory(cat) {
  state.chronicleCategory = cat;
  document.querySelectorAll('[data-chronicle-cat]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-chronicle-cat') === cat);
  });
  renderChronicleView();
}
window.setChronicleCategory = setChronicleCategory;

function onChronicleSearchInput(val) {
  state.chronicleSearch = (val || '').trim().toLowerCase();
  renderChronicleView();
}
window.onChronicleSearchInput = onChronicleSearchInput;

function renderChronicleView() {
  if (!state.chronicle || !dom.chronicleCategories) return;

  const c = state.chronicle;
  const pct = (typeof c.percent === 'number' && !isNaN(c.percent)) ? c.percent.toFixed(2) : '0.00';
  if (dom.chronicleOverallScore) dom.chronicleOverallScore.textContent = `${pct}%`;
  if (dom.chronicleOverallBar) dom.chronicleOverallBar.style.width = `${pct}%`;
  if (dom.chronicleCountText) dom.chronicleCountText.textContent = `${c.total_owned || 0} / ${c.total_items || 0} items discovered`;

  // Render category summary pills
  if (dom.chronicleCategoryPills) {
    dom.chronicleCategoryPills.innerHTML = (c.categories || []).map(cat => {
      return `<span class="chronicle-cat-pill"><strong>${escapeHtml(cat.category)}:</strong> ${cat.owned} / ${cat.total} (${cat.percent}%)</span>`;
    }).join('');
  }

  dom.chronicleCategories.innerHTML = '';

  const activeCategoryFilter = state.chronicleCategory;
  const query = state.chronicleSearch;

  (c.categories || []).forEach(cat => {
    // Check category filter
    if (activeCategoryFilter === 'uniques' && !cat.category.toLowerCase().includes('unique')) return;
    if (activeCategoryFilter === 'sets' && !cat.category.toLowerCase().includes('set')) return;
    if (activeCategoryFilter === 'runewords' && !cat.category.toLowerCase().includes('runeword')) return;

    const card = document.createElement('div');
    card.className = 'grail-category-card';

    const header = document.createElement('div');
    header.className = 'grail-category-header';
    header.innerHTML = `
      <div class="grail-cat-title-group">
        <h3>${escapeHtml(cat.category)}</h3>
        <span class="badge badge-perf">${cat.owned} / ${cat.total} (${cat.percent}%)</span>
      </div>
      <div class="progress-bar-wrap" style="max-width: 260px; width: 100%; height: 6px;">
        <div class="progress-bar-fill" style="width: ${cat.percent}%;"></div>
      </div>
    `;
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grail-items-grid';

    let matchCount = 0;
    (cat.items || []).forEach(it => {
      if (it.is_group) {
        (it.items || []).forEach(subItem => {
          if (shouldShowChronicleItem(subItem, query)) {
            grid.appendChild(createChronicleItemCard(subItem, cat.category, it.group_name));
            matchCount++;
          }
        });
      } else {
        if (shouldShowChronicleItem(it, query)) {
          grid.appendChild(createChronicleItemCard(it, cat.category));
          matchCount++;
        }
      }
    });

    if (matchCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.style.padding = '20px 0';
      empty.innerHTML = `<p style="color: var(--muted);">No matching items found in ${escapeHtml(cat.category)}.</p>`;
      grid.appendChild(empty);
    }

    card.appendChild(grid);
    dom.chronicleCategories.appendChild(card);
  });
}

function shouldShowChronicleItem(it, query) {
  const isTracked = !!it.tracked;
  if (state.chronicleFilter === 'discovered' && !isTracked) return false;
  if (state.chronicleFilter === 'undiscovered' && isTracked) return false;

  if (query) {
    const nameMatch = (it.name || '').toLowerCase().includes(query);
    const baseMatch = (it.base || '').toLowerCase().includes(query);
    const runesMatch = (it.runes || []).some(r => r.toLowerCase().includes(query));
    if (!nameMatch && !baseMatch && !runesMatch) return false;
  }
  return true;
}

function createChronicleItemCard(it, categoryName, groupName) {
  const isTracked = !!it.tracked;
  const isSet = (categoryName && categoryName.includes('Set')) || !!groupName;
  const isRuneword = (categoryName && categoryName.includes('Runeword')) || (it.runes && it.runes.length > 0);

  const qClass = isRuneword ? 'q-runeword' : (isSet ? 'q-set' : 'q-unique');
  const qColorClass = isRuneword ? 'color-runeword' : (isSet ? 'color-set' : 'color-unique');
  const cleanTitle = escapeHtml(it.name || '');

  // Look up matching item in state.items for sprite / inspection (strict quality check)
  const nameLower = (it.name || '').toLowerCase();
  const ownedMatch = (state.items || []).find(x => {
    const xName = (x.name || '').toLowerCase();
    const xDisp = (x.displayName || '').toLowerCase();
    const nameMatches = xName === nameLower || xDisp === nameLower;
    if (!nameMatches) return false;
    if (isRuneword) return !!x.isRuneword;
    if (isSet) return x.quality === 'Set';
    return x.quality === 'Unique' && !x.isRuneword;
  });

  const invFile = it.invFile || (ownedMatch && ownedMatch.invFile) || null;
  const typeIconHref = getItemTypeIconHref(ownedMatch || { type: it.base, baseName: it.base });

  const iconMarkup = invFile ? `
    <img class="wiki-item-icon item-card-icon" src="assets/items/${invFile}" alt="${cleanTitle}" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='grid';" />
    <span class="fallback-icon-box" style="display:none;"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
  ` : `
    <span class="fallback-icon-box"><svg aria-hidden="true"><use href="${typeIconHref}"/></svg></span>
  `;

  // Meta line (runes, base, set)
  let metaParts = [];
  if (isRuneword && it.runes && it.runes.length > 0) {
    metaParts.push(it.runes.join(' · '));
  }
  if (it.base) metaParts.push(escapeHtml(it.base));
  if (groupName) metaParts.push(`<span style="color:var(--q-set); font-weight:600;">${escapeHtml(groupName)}</span>`);
  const metaLine = metaParts.join(' · ');

  // Status badge
  const statusBadge = isTracked
    ? `<span class="tag tag-chronicle-found">✔ In Chronicle</span>`
    : `<span class="tag tag-chronicle-missing">✖ Undiscovered</span>`;

  let extraTags = '';
  if (isTracked && it.core) {
    const coreLabel = it.core === 'hard' ? 'Hardcore' : 'Softcore';
    const coreClass = it.core === 'hard' ? 'badge-hardcore' : 'badge-softcore';
    extraTags += `<span class="badge ${coreClass}">${coreLabel}</span>`;
  }
  if (it.isManual) {
    extraTags += `<span class="badge" style="background:rgba(234,179,8,0.2);color:#facc15;border:1px solid #ca8a04;">Manual</span>`;
  }

  const toggleBtnMarkup = `
    <button type="button" class="chronicle-toggle-btn ${isTracked ? 'is-completed' : ''}" title="${isTracked ? 'Mark as Undiscovered' : 'Mark as Completed in Chronicle'}">
      ${isTracked ? '✔' : '+'}
    </button>
  `;

  const card = document.createElement('div');
  const discoveredClass = isTracked ? 'is-discovered' : 'is-undiscovered';
  card.className = `base-item-card item-index-card grail-item-card chronicle-item-card ${qClass} ${discoveredClass}`.trim();
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${it.name} (${isTracked ? 'Discovered in Chronicle' : 'Undiscovered'})`);

  card.innerHTML = `
    <div class="sp-head">
      ${iconMarkup}
      <div class="sp-head-text">
        <span class="set-th-name ${qColorClass}">${cleanTitle}</span>
        <span class="set-th-meta">${metaLine}</span>
        <div class="loot-foot">
          ${statusBadge}
          ${extraTags}
          ${toggleBtnMarkup}
        </div>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('.chronicle-toggle-btn');
    if (btn) {
      e.stopPropagation();
      toggleChronicleItem(it.name, !isTracked);
      return;
    }
    if (ownedMatch) {
      openItemDetailModal(ownedMatch);
    } else {
      openItemDetailModal({
        name: it.name,
        displayName: it.name,
        quality: isRuneword ? 'Runeword' : (isSet ? 'Set' : 'Unique'),
        baseName: it.base || '',
        invFile: invFile,
        isRuneword: isRuneword,
        requiredLevel: it.lvlReq || null,
        lvlReq: it.lvlReq || null,
        isEthereal: !!it.isEthereal,
        stats: (it.stats || []).map(s => typeof s === 'string' ? { description: s } : s),
        isChronicleItem: true,
        isUnowned: true,
        tracked: isTracked,
        isManual: !!it.isManual,
        categoryName: categoryName,
        groupName: groupName
      });
    }
  });

  return card;
}


// ==========================================================================
// ITEM VERIFIER VIEW
// ==========================================================================
async function loadVerifierView() {
  const all = state.allWasmItems || state.items || [];
  const outOfDate = all.filter(it => it.isOutOfDate);
  const belowMin = outOfDate.filter(it => (it.outOfDateIssues || []).some(iss => iss.includes('BELOW'))).length;
  const aboveMax = outOfDate.filter(it => (it.outOfDateIssues || []).some(iss => iss.includes('ABOVE'))).length;
  const missing = outOfDate.filter(it => (it.outOfDateIssues || []).some(iss => iss.includes('Missing'))).length;

  state.verifier = {
    total_checked: all.length,
    total_out_of_date: outOfDate.length,
    total_up_to_date: all.filter(it => !it.isOutOfDate && it.verificationStatus !== 'unknown').length,
    percent_out_of_date: all.length > 0 ? Math.round((outOfDate.length / all.length) * 100) : 0,
    counts_by_issue: { below_min: belowMin, above_max: aboveMax, missing_stats: missing },
    items: outOfDate
  };
  renderVerifierView();
}

function renderVerifierView() {
  if (!state.verifier) return;
  const v = state.verifier;

  // Update summary stats
  dom.verifierTotalChecked.textContent = v.total_checked || 0;
  dom.verifierTotalUpToDate.textContent = v.total_up_to_date || 0;
  dom.verifierTotalOutOfDate.textContent = v.total_out_of_date || 0;
  dom.verifierPctOutOfDate.textContent = `${v.percent_out_of_date || 0}% of collection`;

  const counts = v.counts_by_issue || {};
  dom.verifierBelowMinTag.textContent = `▼ ${counts.below_min || 0} Below Min`;
  dom.verifierAboveMaxTag.textContent = `▲ ${counts.above_max || 0} Above Max`;
  dom.verifierMissingTag.textContent = `⚠️ ${counts.missing_stats || 0} Missing`;

  let items = v.items || [];

  // Filter by issue type
  if (state.verifierFilter !== 'all') {
    items = items.filter(it => {
      const issues = it.outOfDateIssues || [];
      if (state.verifierFilter === 'below') {
        return issues.some(iss => iss.includes('BELOW'));
      } else if (state.verifierFilter === 'above') {
        return issues.some(iss => iss.includes('ABOVE'));
      } else if (state.verifierFilter === 'missing') {
        return issues.some(iss => iss.includes('Missing'));
      }
      return true;
    });
  }

  // Filter by search text
  if (state.verifierSearch) {
    const q = state.verifierSearch.toLowerCase();
    items = items.filter(it => {
      return (it.displayName || '').toLowerCase().includes(q) ||
             (it.baseName || '').toLowerCase().includes(q) ||
             (it.sourceName || '').toLowerCase().includes(q) ||
             (it.outOfDateIssues || []).some(iss => iss.toLowerCase().includes(q));
    });
  }

  dom.verifierItemsList.innerHTML = '';

  if (v.total_out_of_date === 0) {
    dom.verifierAllClean.style.display = 'block';
    dom.verifierItemsList.style.display = 'none';
    return;
  }

  dom.verifierAllClean.style.display = 'none';
  dom.verifierItemsList.style.display = 'grid';

  if (items.length === 0) {
    dom.verifierItemsList.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><h3>No items match your verifier filter</h3><p>Try selecting a different issue category or clearing your search.</p></div>';
    return;
  }

  items.forEach(it => {
    const card = createItemCardElement(it, true);
    dom.verifierItemsList.appendChild(card);
  });
}

// Verifier Event Listeners
if (dom.verifierRefreshBtn) {
  dom.verifierRefreshBtn.addEventListener('click', () => {
    loadVerifierView();
  });
}

if (dom.verifierSearchInput) {
  dom.verifierSearchInput.addEventListener('input', (e) => {
    state.verifierSearch = e.target.value.trim();
    renderVerifierView();
  });
}

document.querySelectorAll('[data-verifier-issue]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-verifier-issue]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.verifierFilter = btn.dataset.verifierIssue;
    renderVerifierView();
  });
});

// Create Mule Modal Logic
function openCreateMuleModal() {
  const coreCheck = document.getElementById('mule-hardcore-check');
  coreCheck.checked = state.core === 'hard';
  coreCheck.disabled = true;
  const modal = document.getElementById('create-mule-modal');
  const nameInput = document.getElementById('mule-name-input');
  const statusEl = document.getElementById('mule-create-status');
  if (modal) {
    modal.style.display = 'flex';
    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
    }
  }
}

function closeCreateMuleModal() {
  const modal = document.getElementById('create-mule-modal');
  if (modal) modal.style.display = 'none';
}

async function submitCreateMule() {
  const nameInput = document.getElementById('mule-name-input');
  const classSelect = document.getElementById('mule-class-select');
  const hcCheck = document.getElementById('mule-hardcore-check');
  const statusEl = document.getElementById('mule-create-status');
  const submitBtn = document.getElementById('btn-submit-mule');

  const name = nameInput ? nameInput.value.trim() : '';
  const charClass = classSelect ? classSelect.value : 'Amazon';
  const hardcore = hcCheck ? hcCheck.checked : false;

  if (!name) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
      statusEl.style.color = '#f87171';
      statusEl.textContent = 'Please enter a character name.';
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(59, 130, 246, 0.2)';
    statusEl.style.color = '#60a5fa';
    statusEl.textContent = 'Generating character...';
  }

  if (window.D2Wasm) {
    try {
      if (window.EditWorkspace && !window.EditWorkspace.active) {
        await window.EditWorkspace.start();
      }
      const data = await window.D2Wasm.createMule(name, charClass, hardcore);
      if (data.success) {
        window.EditWorkspace?.changed();
        window.recordEdit?.('create mule');
        if (statusEl) {
          statusEl.style.background = 'rgba(34, 197, 94, 0.2)';
          statusEl.style.color = '#4ade80';
          statusEl.textContent = `Character '${name}' created! Staged in Edit mode. Use 'Save changes' above to commit to disk.`;
        }
        showToast(`Mule '${name}' created! Staged in Edit mode. Click 'Save changes' to apply.`, 'success');
        setTimeout(async () => {
          closeCreateMuleModal();
          if (submitBtn) submitBtn.disabled = false;
          await refreshWasmDataset();
        }, 1000);
      } else {
        if (statusEl) {
          statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = data.error || 'Failed to create mule.';
        }
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
        statusEl.style.color = '#f87171';
        statusEl.textContent = 'Error: ' + err.message;
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}

window.openCreateMuleModal = openCreateMuleModal;
window.closeCreateMuleModal = closeCreateMuleModal;
window.submitCreateMule = submitCreateMule;

// Attach click listener directly
const createMuleBtn = document.getElementById('btn-open-create-mule');
if (createMuleBtn) {
  createMuleBtn.addEventListener('click', openCreateMuleModal);
}

const muleModalEl = document.getElementById('create-mule-modal');
if (muleModalEl) {
  muleModalEl.addEventListener('click', (e) => {
    if (e.target === muleModalEl) closeCreateMuleModal();
  });
}


// Quests & Waypoints Modal Logic
const PROTECTED_CHARS = ["assassin", "barbarian", "druid", "jewelry", "jewlery", "necromancer", "paladin", "sorceress", "warlock", "zon"];

function openQuestsModal(charName) {
  const modal = document.getElementById('quests-modal');
  const titleEl = document.getElementById('quests-modal-title');
  const charInput = document.getElementById('quests-char-name');
  const statusEl = document.getElementById('quests-status');

  if (!modal) return;
  modal.style.display = 'flex';

  if (charInput) charInput.value = charName;
  if (titleEl) titleEl.textContent = `Quests & Waypoints: ${charName}`;
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  }
}

function openQuestsModalForCurrentArmoryChar() {
  const charSelect = document.getElementById('armory-char-select');
  const charName = charSelect ? charSelect.value : '';
  if (charName) {
    openQuestsModal(charName);
  } else {
    showToast('Please select a character first', 'warning');
  }
}

function closeQuestsModal() {
  const modal = document.getElementById('quests-modal');
  if (modal) modal.style.display = 'none';
}

async function submitCompleteQuests() {
  const charName = (document.getElementById('quests-char-name')?.value || '').trim();
  const diffSelect = document.getElementById('quests-diff-select');
  const actSelect = document.getElementById('quests-act-select');
  const wpCheck = document.getElementById('quests-waypoints-check');
  const rewCheck = document.getElementById('quests-rewards-check');
  const statusEl = document.getElementById('quests-status');
  const submitBtn = document.getElementById('btn-submit-quests');

  if (!charName) {
    showToast('Character name is missing', 'error');
    return;
  }

  const difficulty = diffSelect ? diffSelect.value : 'all';
  const actVal = actSelect ? actSelect.value : 'all';
  const act = actVal === 'all' ? null : parseInt(actVal, 10);
  const unlockWaypoints = wpCheck ? wpCheck.checked : true;
  const grantRewards = rewCheck ? rewCheck.checked : true;

  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(59, 130, 246, 0.2)';
    statusEl.style.color = '#93c5fd';
    statusEl.textContent = 'Applying quest completions and updating waypoints...';
  }

  if (window.D2Wasm) {
    try {
      if (window.EditWorkspace && !window.EditWorkspace.active) {
        await window.EditWorkspace.start();
      }
      const data = await window.D2Wasm.completeQuests(charName, difficulty, act, unlockWaypoints, grantRewards);
      if (data.success) {
        window.EditWorkspace?.changed();
        window.recordEdit?.('complete quests');
        if (statusEl) {
          statusEl.style.background = 'rgba(34, 197, 94, 0.2)';
          statusEl.style.color = '#4ade80';
          statusEl.textContent = (data.message || 'Quests updated!') + ' Staged in Edit mode. Use \'Save changes\' above to commit to disk.';
        }
        showToast(`Quests updated for ${charName}! Staged in Edit mode. Click 'Save changes' to apply.`, 'success');
        setTimeout(async () => {
          closeQuestsModal();
          if (submitBtn) submitBtn.disabled = false;
          await refreshWasmDataset();
        }, 1000);
      } else {
        if (statusEl) {
          statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = data.message || 'Failed to update quests.';
        }
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
        statusEl.style.color = '#f87171';
        statusEl.textContent = 'Error: ' + err.message;
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}

window.openQuestsModal = openQuestsModal;
window.openQuestsModalForCurrentArmoryChar = openQuestsModalForCurrentArmoryChar;
window.closeQuestsModal = closeQuestsModal;
window.submitCompleteQuests = submitCompleteQuests;

const questsModalEl = document.getElementById('quests-modal');
if (questsModalEl) {
  questsModalEl.addEventListener('click', (e) => {
    if (e.target === questsModalEl) closeQuestsModal();
  });
}

// ==========================================
// ITEM TRANSFER & PACK MULE HANDLERS (PHASE 3)
// ==========================================

function openTransferModalForItemId(itemId) {
  const it = state.items.find(i => i.id === itemId);
  if (!it) {
    showToast('Item not found in memory', 'error');
    return;
  }

  // Populate hidden fields
  document.getElementById('transfer-source-file').value = it.sourceFile || '';
  document.getElementById('transfer-source-file').dataset.revision = it.saveRevision || '';
  document.getElementById('transfer-source-container').value = it.isStash ? 'sharedstash' : (it.location || 'inventory').toLowerCase();
  document.getElementById('transfer-source-tab').value = it.tabIndex !== undefined ? it.tabIndex : 0;
  document.getElementById('transfer-source-x').value = it.invX !== undefined ? it.invX : '';
  document.getElementById('transfer-source-y').value = it.invY !== undefined ? it.invY : '';
  document.getElementById('transfer-item-seed').value = it.itemSeed || '';
  document.getElementById('transfer-item-code').value = it.itemCode || '';

  // Render item preview
  const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
  const previewEl = document.getElementById('transfer-item-preview');
  const w = it.width || 1;
  const h = it.height || 1;
  const locStr = it.isStash 
    ? `Shared Stash (${it.tabName || ('Tab ' + ((it.tabIndex || 0) + 1))}) at slot (${it.invX}, ${it.invY})`
    : `${it.sourceName}'s ${it.location || 'Inventory'} at slot (${it.invX}, ${it.invY})`;

  previewEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div>
        <div class="item-name ${qColorClass}" style="font-size:14px; font-weight:700;">${escapeHtml(it.displayName)}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Base: ${escapeHtml(it.baseName || it.itemCode)} | Size: ${w}×${h}</div>
        <div style="font-size:12px; color:var(--color-accent); margin-top:4px;">📍 Current: ${escapeHtml(locStr)}</div>
      </div>
      <div style="background:rgba(255,255,255,0.05); border:1px solid var(--border-color); border-radius:4px; padding:4px 8px; font-size:12px; font-family:monospace;">
        ${w}×${h} Grid
      </div>
    </div>
  `;

  // Populate destination file select
  const fileSelect = document.getElementById('transfer-target-file-select');
  fileSelect.innerHTML = '';

  const chars = state.saves.filter(s => !s.is_stash);
  const stashes = state.saves.filter(s => s.is_stash);

  if (chars.length > 0) {
    const charGroup = document.createElement('optgroup');
    charGroup.label = 'Characters / Mules';
    chars.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.file;
      opt.dataset.isStash = 'false';
      opt.dataset.charName = c.name;
      opt.textContent = `${c.name} (${c.class} Lvl ${c.level})`;
      if (c.name.toLowerCase() !== (it.sourceName || '').toLowerCase() && !fileSelect.value) {
        opt.selected = true;
      }
      charGroup.appendChild(opt);
    });
    fileSelect.appendChild(charGroup);
  }

  if (stashes.length > 0) {
    const stashGroup = document.createElement('optgroup');
    stashGroup.label = 'Shared Stashes';
    stashes.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.file;
      opt.dataset.isStash = 'true';
      opt.dataset.tabsCount = (s.tabs ? s.tabs.length : 6);
      opt.textContent = `${s.name} (${s.file})`;
      if (!fileSelect.value) opt.selected = true;
      stashGroup.appendChild(opt);
    });
    fileSelect.appendChild(stashGroup);
  }

  onTransferTargetFileChange();

  // Reset status
  const statusEl = document.getElementById('transfer-status');
  if (statusEl) statusEl.style.display = 'none';

  const modal = document.getElementById('transfer-item-modal');
  if (modal) modal.style.display = 'flex';
}

function closeTransferItemModal() {
  const modal = document.getElementById('transfer-item-modal');
  if (modal) modal.style.display = 'none';
}

function onTransferTargetFileChange() {
  const fileSelect = document.getElementById('transfer-target-file-select');
  const contSelect = document.getElementById('transfer-target-container-select');

  const selOpt = fileSelect.options[fileSelect.selectedIndex];
  if (!selOpt) return;

  const isStash = selOpt.dataset.isStash === 'true';

  contSelect.innerHTML = '';
  if (isStash) {
    const tabsCount = parseInt(selOpt.dataset.tabsCount || '6', 10);
    for (let t = 0; t < tabsCount; t++) {
      const opt = document.createElement('option');
      opt.value = `stash-tab:${t}`;
      opt.textContent = `Shared Stash Tab ${t + 1}`;
      contSelect.appendChild(opt);
    }
  } else {
    const invOpt = document.createElement('option');
    invOpt.value = 'inventory';
    invOpt.textContent = 'Inventory (11×8)';
    contSelect.appendChild(invOpt);

    const cubeOpt = document.createElement('option');
    cubeOpt.value = 'cube';
    cubeOpt.textContent = 'Horadric Cube (6×6)';
    contSelect.appendChild(cubeOpt);

    const stashOpt = document.createElement('option');
    stashOpt.value = 'stash';
    stashOpt.textContent = 'Personal Stash (16×13)';
    contSelect.appendChild(stashOpt);
  }
}

function toggleTransferCoords() {
  const autoCheck = document.getElementById('transfer-autoplace-check');
  const customCoords = document.getElementById('transfer-custom-coords');
  if (customCoords) {
    customCoords.style.display = autoCheck && autoCheck.checked ? 'none' : 'flex';
  }
}

async function submitItemTransfer() {
  const submitBtn = document.getElementById('btn-submit-transfer');
  const statusEl = document.getElementById('transfer-status');

  const sourceFile = document.getElementById('transfer-source-file').value;
  const sourceContainer = document.getElementById('transfer-source-container').value;
  const sourceTab = parseInt(document.getElementById('transfer-source-tab').value || '0', 10);
  const sourceX = document.getElementById('transfer-source-x').value;
  const sourceY = document.getElementById('transfer-source-y').value;
  const itemSeed = document.getElementById('transfer-item-seed').value;
  const itemCode = document.getElementById('transfer-item-code').value;

  const fileSelect = document.getElementById('transfer-target-file-select');
  const contSelect = document.getElementById('transfer-target-container-select');
  const autoCheck = document.getElementById('transfer-autoplace-check');

  const targetFile = fileSelect.value;
  const targetVal = contSelect.value;
  let targetContainer = 'inventory';
  let targetTab = 0;

  if (targetVal.startsWith('stash-tab:')) {
    targetContainer = 'sharedstash';
    targetTab = parseInt(targetVal.split(':')[1], 10);
  } else {
    targetContainer = targetVal;
  }

  let targetX = null;
  let targetY = null;
  if (!autoCheck || !autoCheck.checked) {
    const tx = document.getElementById('transfer-target-x').value;
    const ty = document.getElementById('transfer-target-y').value;
    if (tx !== '' && ty !== '') {
      targetX = parseInt(tx, 10);
      targetY = parseInt(ty, 10);
    }
  }

  const forceLive = true;

  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(59, 130, 246, 0.2)';
    statusEl.style.color = '#93c5fd';
    statusEl.textContent = 'Transferring item and preserving original saves...';
  }

  try {
    const payload = {
      source_revision: document.getElementById('transfer-source-file').dataset.revision,
      target_revision: state.saves.find(save => save.file === targetFile)?.saveRevision,
      source_file: sourceFile,
      source_container: sourceContainer,
      source_tab: sourceTab,
      seed: itemSeed ? parseInt(itemSeed, 10) : null,
      code: itemCode || null,
      target_file: targetFile,
      target_container: targetContainer,
      target_tab: targetTab,
      force_live: forceLive
    };
    if (sourceX !== '' && sourceY !== '') {
      payload.source_x = parseInt(sourceX, 10);
      payload.source_y = parseInt(sourceY, 10);
    }
    if (targetX !== null && targetY !== null) {
      payload.target_x = targetX;
      payload.target_y = targetY;
    }

    if (window.D2Wasm) {
      if (window.EditWorkspace && !window.EditWorkspace.active) {
        await window.EditWorkspace.start();
      }
      const data = await window.D2Wasm.transferItem(payload);
      if (data.success) {
        window.EditWorkspace?.changed();
        window.recordEdit?.('item transfer');
        if (statusEl) {
          statusEl.style.background = 'rgba(34, 197, 94, 0.2)';
          statusEl.style.color = '#4ade80';
          statusEl.textContent = (data.message || 'Item transferred!') + ' Staged in Edit mode. Use \'Save changes\' above to commit to disk.';
        }
        showToast('Item transferred! Staged in Edit mode. Click \'Save changes\' to apply.', 'success');
        setTimeout(async () => {
          closeTransferItemModal();
          if (dom.itemModal) dom.itemModal.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
          await refreshWasmDataset();
        }, 800);
      } else {
        if (statusEl) {
          statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = data.message || 'Transfer failed.';
        }

        if (submitBtn) submitBtn.disabled = false;
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
      statusEl.style.color = '#f87171';
      statusEl.textContent = 'Error: ' + err.message;
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

let packMuleRefreshing = false;
async function openPackMuleModal() {
  if (packMuleRefreshing) return;
  packMuleRefreshing = true;
  try {
    if (window.D2Wasm) {
      await refreshWasmDataset();
    }
  } catch (err) {
    showToast('Cannot open Pack Mule: ' + err.message, 'error');
    return;
  } finally {
    packMuleRefreshing = false;
  }
  const stashSelect = document.getElementById('pack-stash-select');
  const tabSelect = document.getElementById('pack-tab-select');
  const charSelect = document.getElementById('pack-target-char-select');

  stashSelect.innerHTML = '';
  tabSelect.innerHTML = '';
  charSelect.innerHTML = '';

  const stashes = state.saves.filter(s => s.is_stash);
  const chars = state.saves.filter(s => !s.is_stash);

  stashes.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.file;
    opt.textContent = `${s.name} — ${s.core === 'hard' ? 'Hardcore' : 'Softcore'} (${s.file})`;
    opt.dataset.tabs = JSON.stringify(s.tabs || []);
    stashSelect.appendChild(opt);
  });

  onPackStashChange();

  chars.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.file;
    opt.dataset.charName = c.name;
    opt.textContent = `${c.name} (${c.class} Lvl ${c.level}) — ${c.core === 'hard' ? 'Hardcore' : 'Softcore'}`;
    charSelect.appendChild(opt);
  });

  onPackTargetCharChange();

  const statusEl = document.getElementById('pack-status');
  if (statusEl) statusEl.style.display = 'none';

  const modal = document.getElementById('pack-mule-modal');
  if (modal) modal.style.display = 'flex';
}

function closePackMuleModal() {
  const modal = document.getElementById('pack-mule-modal');
  if (modal) modal.style.display = 'none';
}

function onPackStashChange() {
  const stashSelect = document.getElementById('pack-stash-select');
  const tabSelect = document.getElementById('pack-tab-select');
  tabSelect.innerHTML = '';

  const selOpt = stashSelect.options[stashSelect.selectedIndex];
  if (!selOpt) return;

  let tabs = [];
  try {
    tabs = JSON.parse(selOpt.dataset.tabs || '[]');
  } catch (e) {
    tabs = [];
  }

  const count = tabs.length > 0 ? tabs.length : 6;
  for (let i = 0; i < count; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    const tabName = (tabs[i] && tabs[i].name) ? tabs[i].name : `Tab ${i + 1}`;
    const itemCount = (tabs[i] && tabs[i].itemCount !== undefined) ? ` (${tabs[i].itemCount} items)` : '';
    opt.textContent = `${tabName}${itemCount}`;
    tabSelect.appendChild(opt);
  }
}

function onPackTargetCharChange() {
  // Target char change handler
}

async function submitPackMule() {
  const submitBtn = document.getElementById('btn-submit-pack');
  const statusEl = document.getElementById('pack-status');

  const stashFile = document.getElementById('pack-stash-select').value;
  const tab = parseInt(document.getElementById('pack-tab-select').value || '0', 10);
  const charFile = document.getElementById('pack-target-char-select').value;
  const filter = document.getElementById('pack-filter-select').value;
  const maxItems = parseInt(document.getElementById('pack-max-items').value || '30', 10);
  const forceLive = true;

  if (submitBtn) submitBtn.disabled = true;
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(59, 130, 246, 0.2)';
    statusEl.style.color = '#93c5fd';
    statusEl.textContent = 'Packing items into mule containers...';
  }

  if (window.D2Wasm) {
    try {
      if (window.EditWorkspace && !window.EditWorkspace.active) {
        await window.EditWorkspace.start();
      }
      const data = await window.D2Wasm.bulkTransfer({
        source_revision: state.saves.find(save => save.file === stashFile)?.saveRevision,
        target_revision: state.saves.find(save => save.file === charFile)?.saveRevision,
        source_stash_file: stashFile,
        source_tab: tab,
        target_char_file: charFile,
        item_filter: filter,
        max_items: maxItems,
        force_live: forceLive
      });
      if (data.success) {
        window.EditWorkspace?.changed();
        window.recordEdit?.('pack mule');
        if (statusEl) {
          statusEl.style.background = 'rgba(34, 197, 94, 0.2)';
          statusEl.style.color = '#4ade80';
          statusEl.textContent = (data.message || 'Mule packed!') + ' Staged in Edit mode. Use \'Save changes\' above to commit to disk.';
        }
        showToast(`Packed ${data.itemsMoved} items! Staged in Edit mode. Click 'Save changes' to apply.`, 'success');
        setTimeout(async () => {
          closePackMuleModal();
          if (submitBtn) submitBtn.disabled = false;
          await refreshWasmDataset();
        }, 1000);
      } else {
        if (statusEl) {
          statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = data.message || 'Packing failed.';
        }
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
        statusEl.style.color = '#f87171';
        statusEl.textContent = 'Error: ' + err.message;
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}

window.openTransferModalForItemId = openTransferModalForItemId;
window.closeTransferItemModal = closeTransferItemModal;
window.onTransferTargetFileChange = onTransferTargetFileChange;
window.toggleTransferCoords = toggleTransferCoords;
window.submitItemTransfer = submitItemTransfer;
window.openPackMuleModal = openPackMuleModal;
window.closePackMuleModal = closePackMuleModal;
window.onPackStashChange = onPackStashChange;
window.onPackTargetCharChange = onPackTargetCharChange;
window.submitPackMule = submitPackMule;

const transferModalEl = document.getElementById('transfer-item-modal');
if (transferModalEl) {
  transferModalEl.addEventListener('click', (e) => {
    if (e.target === transferModalEl) closeTransferItemModal();
  });
}

const packMuleModalEl = document.getElementById('pack-mule-modal');
if (packMuleModalEl) {
  packMuleModalEl.addEventListener('click', (e) => {
    if (e.target === packMuleModalEl) closePackMuleModal();
  });
}

// Initialize on page load
setupWasmEvents();
loadProfiles();

window.loadSavesAndItems = loadSavesAndItems;
window.loadProfiles = loadProfiles;



