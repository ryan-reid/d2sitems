/**
 * D2SItems Web Explorer - Frontend Application
 */

// Application State
const state = {
  activeTab: 'search-view',
  profiles: [],
  activeProfileId: null,
  saves: [],
  items: [],
  grail: null,
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
    min_perf: 0,
    stat: '',
    sort: 'perfection_desc'
  },
  grailFilter: 'all' // 'all', 'collected', 'missing'
};

// DOM Elements
const dom = {
  profileSelect: document.getElementById('profile-select'),
  rescanBtn: document.getElementById('rescan-btn'),
  rescanIcon: document.getElementById('rescan-icon'),
  rescanLabel: document.getElementById('rescan-label'),
  addProfileBtn: document.getElementById('add-profile-btn'),
  searchInput: document.getElementById('search-input'),
  searchClearBtn: document.getElementById('search-clear-btn'),
  resultsCountBadge: document.getElementById('results-count-badge'),
  sortSelect: document.getElementById('sort-select'),
  modeGridBtn: document.getElementById('mode-grid-btn'),
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
  profileModal: document.getElementById('profile-modal'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  modalSaveBtn: document.getElementById('modal-save-btn'),
  customProfileName: document.getElementById('custom-profile-name'),
  customProfilePath: document.getElementById('custom-profile-path'),
  customExcelPath: document.getElementById('custom-excel-path'),
  itemModal: document.getElementById('item-modal'),
  itemModalTitle: document.getElementById('item-modal-title'),
  itemModalBody: document.getElementById('item-modal-body'),
  itemModalCloseBtn: document.getElementById('item-modal-close-btn'),
  itemModalDoneBtn: document.getElementById('item-modal-done-btn'),
  itemModalCopyBtn: document.getElementById('item-modal-copy-btn'),
  toastContainer: document.getElementById('toast-container')
};

// Utilities
function showToast(message, type = 'info') {
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

function getQualityClass(quality, isRuneword) {
  if (isRuneword) return 'quality-runeword';
  switch ((quality || '').toLowerCase()) {
    case 'unique': return 'quality-unique';
    case 'set': return 'quality-set';
    case 'rare': return 'quality-rare';
    case 'crafted': return 'quality-crafted';
    case 'magic': return 'quality-magic';
    case 'superior':
    case 'normal': return 'quality-normal';
    default: return 'quality-normal';
  }
}

function getQualityColorClass(quality, isRuneword) {
  if (isRuneword) return 'color-runeword';
  switch ((quality || '').toLowerCase()) {
    case 'unique': return 'color-unique';
    case 'set': return 'color-set';
    case 'rare': return 'color-rare';
    case 'crafted': return 'color-crafted';
    case 'magic': return 'color-magic';
    case 'superior':
    case 'normal': return 'color-normal';
    default: return 'color-normal';
  }
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
    if (state.activeTab === 'characters-view') {
      renderCharactersView();
    } else if (state.activeTab === 'armory-view') {
      loadArmoryView();
    } else if (state.activeTab === 'grail-view') {
      loadGrailView();
    }
  });
});

// Load Profiles from Server
async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    state.profiles = data.profiles || [];
    state.activeProfileId = data.active_id;

    dom.profileSelect.innerHTML = '';
    state.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === state.activeProfileId) opt.selected = true;
      dom.profileSelect.appendChild(opt);
    });

    await loadSavesAndItems();
  } catch (err) {
    showToast('Failed to load profiles: ' + err.message, 'error');
  }
}

// Switch Profile
dom.profileSelect.addEventListener('change', async (e) => {
  const newProfileId = e.target.value;
  try {
    const res = await fetch('/api/profiles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: newProfileId })
    });
    const data = await res.json();
    if (data.success) {
      state.activeProfileId = newProfileId;
      showToast('Switched profile to ' + dom.profileSelect.options[dom.profileSelect.selectedIndex].text, 'success');
      await loadSavesAndItems();
    }
  } catch (err) {
    showToast('Error switching profile: ' + err.message, 'error');
  }
});

// Load Saves and Items
async function loadSavesAndItems() {
  try {
    const res = await fetch('/api/saves');
    const data = await res.json();
    state.saves = data.saves || [];
    
    // Update Character filter dropdown
    updateCharacterFilterDropdown();

    // Trigger search
    await executeSearch();

    // If characters tab active, render it
    if (state.activeTab === 'characters-view') {
      renderCharactersView();
    } else if (state.activeTab === 'armory-view') {
      loadArmoryView();
    }
  } catch (err) {
    showToast('Failed to load saves: ' + err.message, 'error');
  }
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

  dom.characterFilter.value = currentVal || 'all';
}

// Rescan Button
dom.rescanBtn.addEventListener('click', async () => {
  dom.rescanIcon.classList.add('spin');
  dom.rescanLabel.textContent = 'Scanning...';
  dom.rescanBtn.disabled = true;

  try {
    const res = await fetch('/api/scan', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Scan complete! Loaded ${data.saves_count} saves and ${data.items_count} items.`, 'success');
      await loadSavesAndItems();
    } else {
      showToast('Scan error: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Scan failed: ' + err.message, 'error');
  } finally {
    dom.rescanIcon.classList.remove('spin');
    dom.rescanLabel.textContent = 'Rescan Saves';
    dom.rescanBtn.disabled = false;
  }
});

// Search & Filter Execution
let searchDebounceTimer = null;
function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(executeSearch, 250);
}

async function executeSearch() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.quality !== 'all') params.set('quality', state.filters.quality);
  if (state.filters.source !== 'all') params.set('source', state.filters.source);
  if (state.filters.type !== 'all') params.set('type', state.filters.type);
  if (state.filters.tier !== 'all') params.set('tier', state.filters.tier);
  if (state.filters.location !== 'all') params.set('location', state.filters.location);
  if (state.filters.sockets !== 'all') params.set('sockets', state.filters.sockets);
  if (state.filters.ethereal !== 'all') params.set('ethereal', state.filters.ethereal);
  if (state.filters.min_perf > 0) params.set('min_perf', state.filters.min_perf);
  if (state.filters.stat) params.set('stat', state.filters.stat);
  if (state.filters.sort) params.set('sort', state.filters.sort);

  try {
    const res = await fetch('/api/items?' + params.toString());
    const data = await res.json();
    state.items = data.items || [];
    const totalCount = data.total || 0;

    dom.resultsCountBadge.textContent = `${totalCount} item${totalCount === 1 ? '' : 's'}`;
    renderItemsView();
  } catch (err) {
    showToast('Search query error: ' + err.message, 'error');
  }
}

// Render Items Grid & Table
function renderItemsView() {
  if (state.items.length === 0) {
    dom.itemsGrid.style.display = 'none';
    dom.itemsTableWrap.style.display = 'none';
    dom.emptyState.style.display = 'block';
    return;
  }

  dom.emptyState.style.display = 'none';

  if (state.viewMode === 'grid') {
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

function createItemCardElement(it) {
  const card = document.createElement('div');
  const qClass = getQualityClass(it.quality, it.isRuneword);
  const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
  card.className = `item-card ${qClass}`;

  // Header & Name
  const displayName = escapeHtml(it.displayName);
  const baseName = escapeHtml(it.baseName || it.type || '');
  const tier = it.tier ? `<span class="badge">${it.tier}</span>` : '';
  const type = it.type ? `<span class="badge">${it.type}</span>` : '';
  
  // Badges
  let badgesHtml = `${tier} ${type}`;
  if (it.isEthereal) badgesHtml += `<span class="badge badge-eth">Ethereal</span>`;
  if (it.socketCount > 0) {
    badgesHtml += `<span class="badge badge-socket">${it.socketCount} Sockets</span>`;
  }
  if (it.perfectionNum !== null) {
    const isHigh = it.perfectionNum >= 90;
    badgesHtml += `<span class="badge ${isHigh ? 'badge-perf-high' : 'badge-perf'}">★ ${it.perfectionNum.toFixed(1)}%</span>`;
  }

  // Base Defense / Damage stats
  let baseStatsHtml = '';
  if (it.defense) {
    baseStatsHtml += `<span>Defense: <strong>${it.defense}</strong>${it.baseDefenseRange ? ` (Base: ${it.baseDefenseRange})` : ''}</span>`;
  }
  if (it.twoHandedDamage) {
    baseStatsHtml += `<span>Two-Hand Damage: <strong>${it.twoHandedDamage}</strong></span>`;
  } else if (it.oneHandedDamage) {
    baseStatsHtml += `<span>One-Hand Damage: <strong>${it.oneHandedDamage}</strong></span>`;
  }
  if (it.durability && it.maxDurability) {
    baseStatsHtml += `<span>Durability: ${it.durability}/${it.maxDurability}</span>`;
  }

  // Magical Stats List
  let statsHtml = '';
  const statList = (it.runewordStats || []).concat(it.stats || []);
  if (statList.length > 0) {
    statsHtml = '<div class="item-stats-list">';
    statList.slice(0, 8).forEach(s => {
      const desc = escapeHtml(s.description || s.id || '');
      statsHtml += `<div class="item-stat-row">${desc}</div>`;
    });
    if (statList.length > 8) {
      statsHtml += `<div class="stat-roll-range">+ ${statList.length - 8} more properties...</div>`;
    }
    statsHtml += '</div>';
  }

  // Socketed runes / gems
  let socketsHtml = '';
  if (it.sockets && it.sockets.length > 0) {
    socketsHtml = '<div class="item-sockets-list">';
    it.sockets.forEach(sk => {
      socketsHtml += `<span class="socket-pill">💎 ${escapeHtml(sk.name)}</span>`;
    });
    socketsHtml += '</div>';
  }

  // Footer / Location
  const ownerIcon = it.isStash ? '📦' : '👤';
  const ownerName = escapeHtml(it.sourceName);
  const locationName = escapeHtml(it.location || 'Unknown');

  card.innerHTML = `
    <div class="item-card-header">
      <div class="item-name-block">
        <span class="item-name ${qColorClass}">${displayName}</span>
        <span class="item-base-line">${baseName}</span>
      </div>
      <div class="item-badges">${badgesHtml}</div>
    </div>
    ${baseStatsHtml ? `<div class="item-base-stats">${baseStatsHtml}</div>` : ''}
    ${statsHtml}
    ${socketsHtml}
    <div class="item-card-footer">
      <span class="item-owner"><span class="owner-icon">${ownerIcon}</span> ${ownerName}</span>
      <span class="item-location">${locationName}</span>
    </div>
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
    const perf = it.perfectionNum !== null ? `${it.perfectionNum.toFixed(1)}%` : '-';

    // Summary of stats
    const stats = (it.runewordStats || []).concat(it.stats || []);
    const statSummary = stats.slice(0, 2).map(s => escapeHtml(s.description || '')).join(', ');

    tr.innerHTML = `
      <td><strong class="${qColorClass}">${displayName}</strong></td>
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
  const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
  dom.itemModalTitle.innerHTML = `<span class="${qColorClass}">${escapeHtml(it.displayName)}</span>`;

  let contentHtml = `
    <div style="margin-bottom: 12px;">
      <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 6px;">
        <strong>Base:</strong> ${escapeHtml(it.baseName || '-')} | 
        <strong>Quality:</strong> ${it.isRuneword ? 'Runeword' : (it.quality || 'Normal')} | 
        <strong>Tier:</strong> ${it.tier || '-'} | 
        <strong>Item Level:</strong> ${it.itemLevel || '-'}
      </div>
      <div style="font-size: 13px; color: var(--text-muted);">
        <strong>Owner:</strong> ${escapeHtml(it.sourceName)} (${escapeHtml(it.sourceFile)}) | 
        <strong>Location:</strong> ${escapeHtml(it.location || '-')}
      </div>
    </div>
  `;

  if (it.perfectionNum !== null) {
    contentHtml += `
      <div style="background: rgba(196, 154, 69, 0.15); border: 1px solid var(--border-gold); padding: 8px 12px; border-radius: 6px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; font-weight: 700; color: var(--color-accent); margin-bottom: 4px;">
          <span>PERFECTION SCORE</span>
          <span>${it.perfectionNum.toFixed(2)}%</span>
        </div>
        <div class="progress-bar-wrap" style="height: 8px; margin: 0;">
          <div class="progress-bar-fill" style="width: ${it.perfectionNum}%;"></div>
        </div>
      </div>
    `;
  }

  // Defense / Damage / Sockets
  let defenseDamage = [];
  if (it.defense) defenseDamage.push(`Defense: ${it.defense}${it.baseDefenseRange ? ` (Base: ${it.baseDefenseRange})` : ''}`);
  if (it.twoHandedDamage) defenseDamage.push(`Two-Hand Damage: ${it.twoHandedDamage}`);
  if (it.oneHandedDamage) defenseDamage.push(`One-Hand Damage: ${it.oneHandedDamage}`);
  if (it.durability && it.maxDurability) defenseDamage.push(`Durability: ${it.durability}/${it.maxDurability}`);
  if (it.socketCount > 0) defenseDamage.push(`Sockets: ${it.socketCount} (${it.openSockets || 0} open)`);

  if (defenseDamage.length > 0) {
    contentHtml += `<div class="item-base-stats" style="margin-bottom: 14px;">${defenseDamage.join(' | ')}</div>`;
  }

  // All stats
  const allStats = (it.runewordStats || []).concat(it.stats || []);
  if (allStats.length > 0) {
    contentHtml += `<div style="margin-bottom: 14px;"><strong style="font-size: 12px; text-transform: uppercase; color: var(--text-muted);">Properties:</strong><div class="item-stats-list" style="margin-top: 6px;">`;
    allStats.forEach(s => {
      contentHtml += `<div class="item-stat-row" style="font-size: 13px;">• ${escapeHtml(s.description || s.id)}</div>`;
    });
    contentHtml += `</div></div>`;
  }

  // Socket Bonuses & Socketed Items
  if (it.socketBonuses && it.socketBonuses.length > 0) {
    contentHtml += `<div style="margin-bottom: 14px;"><strong style="font-size: 12px; text-transform: uppercase; color: var(--color-accent);">Socket Bonuses:</strong><div class="item-stats-list" style="margin-top: 6px;">`;
    it.socketBonuses.forEach(sb => {
      contentHtml += `<div class="item-stat-row">• ${escapeHtml(sb)}</div>`;
    });
    contentHtml += `</div></div>`;
  }

  if (it.sockets && it.sockets.length > 0) {
    contentHtml += `<div><strong style="font-size: 12px; text-transform: uppercase; color: var(--color-rune);">Socketed Gems & Runes:</strong><div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">`;
    it.sockets.forEach(sk => {
      contentHtml += `<span class="socket-pill">💎 ${escapeHtml(sk.name)}</span>`;
    });
    contentHtml += `</div></div>`;
  }

  dom.itemModalBody.innerHTML = contentHtml;
  dom.itemModal.style.display = 'flex';

  // Copy item info handler
  dom.itemModalCopyBtn.onclick = () => {
    let copyText = `${it.displayName} (${it.baseName || ''})\n`;
    copyText += `Location: ${it.sourceName} - ${it.location}\n`;
    if (it.perfectionNum !== null) copyText += `Perfection: ${it.perfectionNum}%\n`;
    allStats.forEach(s => copyText += `${s.description || s.id}\n`);
    navigator.clipboard.writeText(copyText).then(() => {
      showToast('Item details copied to clipboard!', 'success');
    });
  };
}

dom.itemModalCloseBtn.addEventListener('click', () => dom.itemModal.style.display = 'none');
dom.itemModalDoneBtn.addEventListener('click', () => dom.itemModal.style.display = 'none');

// View Mode Toggle (Grid vs Table)
dom.modeGridBtn.addEventListener('click', () => {
  dom.modeGridBtn.classList.add('active');
  dom.modeTableBtn.classList.remove('active');
  state.viewMode = 'grid';
  renderItemsView();
});

dom.modeTableBtn.addEventListener('click', () => {
  dom.modeTableBtn.classList.add('active');
  dom.modeGridBtn.classList.remove('active');
  state.viewMode = 'table';
  renderItemsView();
});

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

dom.perfMinSlider.addEventListener('input', (e) => {
  const val = e.target.value;
  dom.perfValLabel.textContent = val + '%';
  state.filters.min_perf = parseInt(val, 10);
  debouncedSearch();
});

dom.perf90Btn.addEventListener('click', () => {
  dom.perfMinSlider.value = 90;
  dom.perfValLabel.textContent = '90%';
  state.filters.min_perf = 90;
  executeSearch();
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
  document.querySelectorAll('#quality-chips .chip').forEach(c => c.classList.remove('active'));
  document.querySelector('#quality-chips .chip[data-value="all"]').classList.add('active');
  document.querySelectorAll('[data-ethereal]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-ethereal="all"]').classList.add('active');

  state.filters = {
    q: '',
    quality: 'all',
    source: 'all',
    type: 'all',
    tier: 'all',
    location: 'all',
    sockets: 'all',
    ethereal: 'all',
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
  if (chars.length === 0) {
    dom.armoryContent.innerHTML = '<div class="empty-state"><h3>No characters loaded</h3></div>';
    return;
  }

  dom.armoryCharSelect.innerHTML = '';
  chars.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (Lvl ${c.level} ${c.class})`;
    if (state.selectedChar && c.name.toLowerCase() === state.selectedChar.toLowerCase()) {
      opt.selected = true;
    }
    dom.armoryCharSelect.appendChild(opt);
  });

  const activeChar = dom.armoryCharSelect.value || chars[0].name;
  await renderArmoryForChar(activeChar);
}

dom.armoryCharSelect.addEventListener('change', async (e) => {
  await renderArmoryForChar(e.target.value);
});

async function renderArmoryForChar(charName) {
  try {
    const res = await fetch(`/api/character/${encodeURIComponent(charName)}`);
    if (!res.ok) throw new Error('Character not found');
    const data = await res.json();
    const char = data.character;
    const equipped = data.equipped || {};
    const stats = char.stats || {};

    const createSlotHtml = (slotKey, slotLabel, slotClass) => {
      const it = equipped[slotKey];
      if (it) {
        const qColorClass = getQualityColorClass(it.quality, it.isRuneword);
        return `
          <div class="gear-slot filled ${slotClass}" onclick="openArmorySlotItem('${slotKey}')">
            <span class="gear-slot-label">${slotLabel}</span>
            <span class="gear-slot-name ${qColorClass}">${escapeHtml(it.displayName)}</span>
          </div>
        `;
      } else {
        return `
          <div class="gear-slot ${slotClass}">
            <span class="gear-slot-label">${slotLabel}</span>
            <span style="font-size: 11px; color: var(--text-dim);">Empty</span>
          </div>
        `;
      }
    };

    window._currentArmoryData = data;

    dom.armoryContent.innerHTML = `
      <!-- Paperdoll & Attributes Column -->
      <div class="paperdoll-container">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <h3 style="font-family: var(--font-heading); color: var(--color-accent); font-size: 18px;">
            ${escapeHtml(char.name)}
          </h3>
          <span style="color: var(--text-muted); font-size: 13px;">Level ${char.level} ${escapeHtml(char.class)}</span>
        </div>

        <div class="char-attributes-grid">
          <div class="attr-box"><span class="attr-name">STR</span><span class="attr-val">${stats.strength || '-'}</span></div>
          <div class="attr-box"><span class="attr-name">DEX</span><span class="attr-val">${stats.dexterity || '-'}</span></div>
          <div class="attr-box"><span class="attr-name">VIT</span><span class="attr-val">${stats.vitality || '-'}</span></div>
          <div class="attr-box"><span class="attr-name">ENG</span><span class="attr-val">${stats.energy || '-'}</span></div>
        </div>

        <div class="paperdoll-layout">
          ${createSlotHtml('Head', 'Head', 'slot-head')}
          ${createSlotHtml('Neck', 'Amulet', 'slot-neck')}
          ${createSlotHtml('Torso', 'Armor', 'slot-torso')}
          ${createSlotHtml('RightHand', 'Main Hand', 'slot-rhand')}
          ${createSlotHtml('LeftHand', 'Off Hand', 'slot-lhand')}
          ${createSlotHtml('Gloves', 'Gloves', 'slot-gloves')}
          ${createSlotHtml('RightRing', 'Right Ring', 'slot-rring')}
          ${createSlotHtml('LeftRing', 'Left Ring', 'slot-lring')}
          ${createSlotHtml('Belt', 'Belt', 'slot-belt')}
          ${createSlotHtml('Boots', 'Boots', 'slot-boots')}
        </div>
      </div>

      <!-- Inventory & Stash Panels -->
      <div class="armory-inventory-panel">
        <div class="inventory-tabs">
          <button class="inv-tab-btn active" onclick="switchInvTab('inventory')">Inventory (${(data.inventory || []).length})</button>
          <button class="inv-tab-btn" onclick="switchInvTab('stash')">Personal Stash (${(data.stash || []).length})</button>
          <button class="inv-tab-btn" onclick="switchInvTab('cube')">Cube (${(data.cube || []).length})</button>
          <button class="inv-tab-btn" onclick="switchInvTab('merc')">Mercenary (${(data.mercenary || []).length})</button>
        </div>

        <div id="armory-tab-content" class="items-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
          <!-- Populated by switchInvTab -->
        </div>
      </div>
    `;

    switchInvTab('inventory');

  } catch (err) {
    dom.armoryContent.innerHTML = `<div class="empty-state"><h3>Error loading armory: ${err.message}</h3></div>`;
  }
}

window.openArmorySlotItem = function(slotKey) {
  if (window._currentArmoryData && window._currentArmoryData.equipped[slotKey]) {
    openItemDetailModal(window._currentArmoryData.equipped[slotKey]);
  }
};

window.switchInvTab = function(tabName) {
  document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  const container = document.getElementById('armory-tab-content');
  if (!container || !window._currentArmoryData) return;

  container.innerHTML = '';
  const list = window._currentArmoryData[tabName] || [];
  if (list.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">No items in this section.</div>';
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
  dom.grailCategories.innerHTML = '<div class="empty-state"><h3>Calculating Holy Grail progress...</h3></div>';

  try {
    const res = await fetch('/api/grail');
    const data = await res.json();
    if (data.error) {
      dom.grailCategories.innerHTML = `<div class="empty-state"><h3>Grail Error: ${escapeHtml(data.error)}</h3></div>`;
      return;
    }

    state.grail = data;
    renderGrailView();
  } catch (err) {
    dom.grailCategories.innerHTML = `<div class="empty-state"><h3>Failed to load grail report: ${err.message}</h3></div>`;
  }
}

function renderGrailView() {
  if (!state.grail) return;

  const g = state.grail;
  dom.grailOverallScore.textContent = `${g.percent.toFixed(2)}%`;
  dom.grailOverallBar.style.width = `${g.percent}%`;
  dom.grailCountText.textContent = `${g.total_owned} / ${g.total_items} items collected`;

  dom.grailCategories.innerHTML = '';
  (g.categories || []).forEach(cat => {
    const card = document.createElement('div');
    card.className = 'grail-category-card';

    let itemsHtml = '<div class="grail-items-grid">';
    (cat.items || []).forEach(it => {
      if (it.is_group) {
        // Group of set items
        it.items.forEach(subItem => {
          if (shouldShowGrailItem(subItem.collected)) {
            itemsHtml += createGrailItemRow(subItem, it.group_name);
          }
        });
      } else {
        if (shouldShowGrailItem(it.collected)) {
          itemsHtml += createGrailItemRow(it);
        }
      }
    });
    itemsHtml += '</div>';

    card.innerHTML = `
      <div class="grail-category-header">
        <h3>${escapeHtml(cat.category)}</h3>
        <span class="badge badge-perf">${cat.owned} / ${cat.total} (${cat.percent}%)</span>
      </div>
      ${itemsHtml}
    `;

    dom.grailCategories.appendChild(card);
  });
}

function shouldShowGrailItem(collected) {
  if (state.grailFilter === 'collected') return collected;
  if (state.grailFilter === 'missing') return !collected;
  return true;
}

function createGrailItemRow(it, groupName) {
  const isCollected = it.collected;
  const holders = (it.holders || []).map(h => h.source).join(', ');
  const baseLabel = it.base ? ` <small style="color: var(--text-dim);">(${escapeHtml(it.base)})</small>` : '';
  const runesLabel = it.runes && it.runes.length > 0 ? ` <small style="color: var(--color-rune);">[${it.runes.join('+')}]</small>` : '';
  const groupLabel = groupName ? `<small style="color: var(--color-set);">[${escapeHtml(groupName)}] </small>` : '';

  return `
    <div class="grail-item-row ${isCollected ? 'collected' : ''}">
      <div>
        ${groupLabel}
        <span class="grail-item-name ${isCollected ? 'color-unique' : ''}">${escapeHtml(it.name)}</span>
        ${baseLabel}
        ${runesLabel}
        ${holders ? `<div style="font-size: 11px; color: var(--color-accent); margin-top: 2px;">📍 ${escapeHtml(holders)}</div>` : ''}
      </div>
      <span class="grail-item-status">${isCollected ? '✅' : '❌'}</span>
    </div>
  `;
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
// ADD CUSTOM PROFILE MODAL
// ==========================================================================
dom.addProfileBtn.addEventListener('click', () => {
  dom.profileModal.style.display = 'flex';
});

dom.modalCloseBtn.addEventListener('click', () => dom.profileModal.style.display = 'none');
dom.modalCancelBtn.addEventListener('click', () => dom.profileModal.style.display = 'none');

dom.modalSaveBtn.addEventListener('click', async () => {
  const name = dom.customProfileName.value.trim();
  const saveDir = dom.customProfilePath.value.trim();
  const excelDir = dom.customExcelPath.value.trim();

  if (!saveDir) {
    showToast('Please specify a Saved Games Directory Path', 'error');
    return;
  }

  try {
    const res = await fetch('/api/profiles/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'Custom Profile', save_dir: saveDir, excel_dir: excelDir })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Profile added successfully!', 'success');
      dom.profileModal.style.display = 'none';
      await loadProfiles();
    } else {
      showToast('Failed to add profile: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
});

// Initialize on page load
loadProfiles();
