/**
 * DIABLO II: RESURRECTED - AUTHENTIC IN-GAME PANELS & ARMORY ENGINE
 * Mimics authentic in-game UI layouts, coordinates, dimensions, and graphics.
 */

(function () {
  'use strict';

  // In-Game Armory State
  const d2rState = {
    activeCharName: null,
    charData: null,
    stashData: null,
    containerDims: {
      inventory: { width: 11, height: 8 },
      stash: { width: 16, height: 13 },
      cube: { width: 6, height: 6 },
      sharedStash: { width: 16, height: 13 }
    },
    viewMode: 'panels', // 'panels' | 'cards'
    weaponSwap: 1,      // 1: Primary (RightHand/LeftHand), 2: Secondary (AlternateRightHand/AlternateLeftHand)
    activeStashTab: 'shared_0', // 'shared_0'..'shared_5', 'personal', 'cube'
    draggedItem: null
  };

  window._d2rState = d2rState;

  // -------------------------------------------------------------------------
  // Quality & Color Mapping
  // -------------------------------------------------------------------------
  function getItemQualityClass(quality, isRuneword) {
    if (isRuneword) return 'q-runeword';
    const q = (quality || '').toLowerCase();
    if (q === 'unique') return 'q-unique';
    if (q === 'set') return 'q-set';
    if (q === 'rare') return 'q-rare';
    if (q === 'magic') return 'q-magic';
    if (q === 'crafted') return 'q-crafted';
    if (q === 'socketed') return 'q-socketed';
    return 'q-normal';
  }

  function getItemQualityColor(quality, isRuneword) {
    if (isRuneword) return '#ffd700';
    const q = (quality || '').toLowerCase();
    if (q === 'unique') return '#c7b377';
    if (q === 'set') return '#00e600';
    if (q === 'rare') return '#ffff66';
    if (q === 'magic') return '#647eff';
    if (q === 'crafted') return '#ff8000';
    if (q === 'socketed') return '#8a9ba8';
    return '#ffffff';
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

  // -------------------------------------------------------------------------
  // In-Game Floating Tooltip
  // -------------------------------------------------------------------------
  function getFloatingTooltipEl() {
    return document.getElementById('d2r-floating-tooltip');
  }

  function getActionMenuEl() {
    return document.getElementById('d2r-action-menu');
  }

  window.showD2RItemTooltip = function (item, evt) {
    const tip = getFloatingTooltipEl();
    if (!tip || !item) return;

    const stats = (d2rState.charData && d2rState.charData.character && d2rState.charData.character.stats) || {};
    const charStr = stats.strength || 0;
    const charDex = stats.dexterity || 0;
    const charLvl = (d2rState.charData && d2rState.charData.character && d2rState.charData.character.level) || 1;

    const qClass = getItemQualityClass(item.quality, item.isRuneword);
    const qColor = getItemQualityColor(item.quality, item.isRuneword);

    let html = '';

    // Runeword socketed runes banner
    if (item.isRuneword) {
      const runes = (item.socketedRunes || []).join('');
      if (runes) {
        html += `<div class="d2r-tooltip-runes">'${escapeHtml(runes)}'</div>`;
      }
    }

    // Title
    html += `<div class="d2r-tooltip-title" style="color: ${qColor};">${escapeHtml(item.displayName || item.name)}</div>`;

    // Base Name
    if (item.baseName && item.baseName !== item.displayName && item.baseName !== item.name) {
      html += `<div class="d2r-tooltip-base" style="color: ${item.isRuneword ? '#ffd700' : '#d8d3c5'};">${escapeHtml(item.baseName)}</div>`;
    }

    html += `<div class="d2r-tooltip-divider"></div>`;

    // Defense & Durability
    const primaryStats = [];
    if (item.defense !== undefined && item.defense !== null) {
      primaryStats.push(`Defense: ${item.defense}`);
    }
    if (item.durability !== undefined && item.maxDurability) {
      primaryStats.push(`Durability: ${item.durability} of ${item.maxDurability}`);
    }
    if (primaryStats.length > 0) {
      html += `<div class="d2r-tooltip-stats-primary">${primaryStats.join('<br>')}</div>`;
    }

    // Requirements
    const reqs = [];
    if (item.requiredLevel) {
      const unmet = charLvl < item.requiredLevel;
      reqs.push(`<span class="${unmet ? 'unmet' : ''}">Required Level: ${item.requiredLevel}</span>`);
    }
    if (item.requiredStrength) {
      const unmet = charStr < item.requiredStrength;
      reqs.push(`<span class="${unmet ? 'unmet' : ''}">Required Strength: ${item.requiredStrength}</span>`);
    }
    if (item.requiredDexterity) {
      const unmet = charDex < item.requiredDexterity;
      reqs.push(`<span class="${unmet ? 'unmet' : ''}">Required Dexterity: ${item.requiredDexterity}</span>`);
    }
    if (reqs.length > 0) {
      html += `<div class="d2r-tooltip-reqs">${reqs.join('<br>')}</div>`;
    }

    // Affixes & Modifiers
    const affixes = item.stats || [];
    if (affixes.length > 0) {
      affixes.forEach(aff => {
        const desc = aff.description || '';
        if (desc) {
          const isSetBonus = desc.toLowerCase().includes('(set');
          html += `<div class="d2r-tooltip-affix ${isSetBonus ? 'set-bonus' : ''}">${escapeHtml(desc)}</div>`;
        }
      });
    }

    // Sockets
    if (item.sockets || item.totalSockets) {
      const count = item.sockets || item.totalSockets;
      html += `<div class="d2r-tooltip-sockets">Socketed (${count})</div>`;
    }

    // Ethereal
    if (item.isEthereal) {
      html += `<div class="d2r-tooltip-ethereal">Ethereal (Cannot be Repaired)</div>`;
    }

    // Perfection
    if (item.perfectionScore !== undefined && item.perfectionScore !== null) {
      html += `<div class="d2r-tooltip-perfection">Perfection: ${item.perfectionScore.toFixed(1)}%</div>`;
    }

    tip.innerHTML = html;
    tip.style.display = 'block';

    window.moveD2RItemTooltip(evt);
  };

  window.moveD2RItemTooltip = function (evt) {
    const tip = getFloatingTooltipEl();
    if (!tip || tip.style.display === 'none') return;

    let x = evt.clientX;
    let y = evt.clientY - 12;

    const tipRect = tip.getBoundingClientRect();
    if (x - tipRect.width / 2 < 10) {
      x = tipRect.width / 2 + 10;
    } else if (x + tipRect.width / 2 > window.innerWidth - 10) {
      x = window.innerWidth - tipRect.width / 2 - 10;
    }

    if (y - tipRect.height < 10) {
      y = evt.clientY + 24 + tipRect.height;
    }

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  window.hideD2RItemTooltip = function () {
    const tip = getFloatingTooltipEl();
    if (tip) tip.style.display = 'none';
  };

  // -------------------------------------------------------------------------
  // Context Action Menu
  // -------------------------------------------------------------------------
  window.showD2RItemActionMenu = function (item, evt) {
    evt.stopPropagation();
    window.hideD2RItemTooltip();

    const menu = getActionMenuEl();
    if (!menu) return;

    const loc = item.location || '';
    const isStash = item.isStash || loc === 'Stash';
    const isInv = loc === 'Inventory';
    const isCube = loc === 'Cube';
    const isEquipped = loc in { Head: 1, Neck: 1, Torso: 1, RightHand: 1, LeftHand: 1, Gloves: 1, Belt: 1, Boots: 1, RightRing: 1, LeftRing: 1 };

    let itemsHtml = `
      <div class="d2r-action-menu-header">${escapeHtml(item.displayName || item.name)}</div>
    `;

    // Quick transfer options
    if (isInv || isCube || isEquipped) {
      itemsHtml += `
        <div class="d2r-menu-item" onclick="quickTransferD2RItem(${item.id}, 'stash', 0)">
          <span>📥 Move to Shared Stash Tab 1</span>
        </div>
        <div class="d2r-menu-item" onclick="quickTransferD2RItem(${item.id}, 'personal_stash')">
          <span>📦 Move to Personal Stash</span>
        </div>
      `;
      if (!isCube) {
        itemsHtml += `
          <div class="d2r-menu-item" onclick="quickTransferD2RItem(${item.id}, 'cube')">
            <span>🔮 Move to Horadric Cube</span>
          </div>
        `;
      }
    } else if (isStash) {
      itemsHtml += `
        <div class="d2r-menu-item" onclick="quickTransferD2RItem(${item.id}, 'inventory')">
          <span>🎒 Move to Hero Inventory</span>
        </div>
        <div class="d2r-menu-item" onclick="quickTransferD2RItem(${item.id}, 'cube')">
          <span>🔮 Move to Horadric Cube</span>
        </div>
      `;
    }

    itemsHtml += `
      <div class="d2r-menu-divider"></div>
      <div class="d2r-menu-item" onclick="openTransferModalForD2RItem(${item.id})">
        <span>🔄 Transfer to Another Character...</span>
      </div>
      <div class="d2r-menu-item" onclick="inspectD2RItemDetails(${item.id})">
        <span>🔍 Inspect Full Details</span>
      </div>
    `;

    menu.innerHTML = itemsHtml;
    menu.style.display = 'block';

    let x = evt.clientX;
    let y = evt.clientY;
    const mRect = menu.getBoundingClientRect();
    if (x + mRect.width > window.innerWidth - 10) {
      x = window.innerWidth - mRect.width - 10;
    }
    if (y + mRect.height > window.innerHeight - 10) {
      y = window.innerHeight - mRect.height - 10;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  };

  window.closeD2RActionMenu = function () {
    const menu = getActionMenuEl();
    if (menu) menu.style.display = 'none';
  };

  document.addEventListener('click', () => {
    window.closeD2RActionMenu();
  });

  // -------------------------------------------------------------------------
  // Item Element Builder for Grids & Paperdoll
  // -------------------------------------------------------------------------
  function createD2RItemElement(item, customLeft, customTop, customWidth, customHeight) {
    const el = document.createElement('div');
    const qClass = getItemQualityClass(item.quality, item.isRuneword);
    const qColor = getItemQualityColor(item.quality, item.isRuneword);

    const w = item.width || 1;
    const h = item.height || 1;
    const x = item.invX !== undefined ? item.invX : 0;
    const y = item.invY !== undefined ? item.invY : 0;

    el.className = `d2r-item-element ${qClass} ${item.isEthereal ? 'is-ethereal' : ''}`;

    if (customLeft !== undefined) {
      el.style.left = `${customLeft}px`;
      el.style.top = `${customTop}px`;
      el.style.width = `${customWidth}px`;
      el.style.height = `${customHeight}px`;
    } else {
      el.style.left = `${x * 32}px`;
      el.style.top = `${y * 32}px`;
      el.style.width = `${w * 32}px`;
      el.style.height = `${h * 32}px`;
    }

    // Drag-and-drop support
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      d2rState.draggedItem = item;
      e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, item }));
      el.style.opacity = '0.5';
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '1';
      d2rState.draggedItem = null;
    });

    // Content container
    const content = document.createElement('div');
    content.className = 'd2r-item-content';

    // Item badge / name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'd2r-item-badge-name';
    nameLabel.style.color = qColor;

    // Friendly display: show rune name or short name
    const dName = item.displayName || item.name || '';
    if (item.type === 'Runes' || dName.toLowerCase().endsWith(' rune')) {
      nameLabel.textContent = dName.replace(/ rune/i, '');
      nameLabel.style.fontWeight = 'bold';
    } else if (item.type === 'Gems') {
      nameLabel.textContent = dName.replace(/(Chipped|Flawed|Flawless|Perfect) /i, '');
    } else {
      nameLabel.textContent = dName;
    }
    content.appendChild(nameLabel);

    // Perfection score badge
    if (item.perfectionScore !== undefined && item.perfectionScore !== null && w >= 2 && h >= 2) {
      const perf = document.createElement('div');
      perf.className = 'd2r-item-perf-badge';
      perf.textContent = `${Math.round(item.perfectionScore)}%`;
      content.appendChild(perf);
    }

    // Sockets overlay
    const socketCount = item.sockets || item.totalSockets || 0;
    if (socketCount > 0 && socketCount <= 6) {
      const socketsLayer = document.createElement('div');
      socketsLayer.className = 'd2r-sockets-layer';

      // Sockets layout pattern
      const rows = socketCount <= 3 ? socketCount : Math.ceil(socketCount / 2);
      let sIdx = 0;
      for (let r = 0; r < rows; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'd2r-socket-row';
        const inRow = (socketCount === 5 && r === 1) ? 1 : (socketCount > 3 ? 2 : 1);
        for (let c = 0; c < inRow && sIdx < socketCount; c++) {
          const sNode = document.createElement('div');
          sNode.className = 'd2r-socket-node';
          rowEl.appendChild(sNode);
          sIdx++;
        }
        socketsLayer.appendChild(rowEl);
      }
      content.appendChild(socketsLayer);
    }

    el.appendChild(content);

    // Hover & Tooltip Events
    el.addEventListener('mouseenter', (e) => window.showD2RItemTooltip(item, e));
    el.addEventListener('mousemove', (e) => window.moveD2RItemTooltip(e));
    el.addEventListener('mouseleave', () => window.hideD2RItemTooltip());

    // Click Action Menu
    el.addEventListener('click', (e) => window.showD2RItemActionMenu(item, e));

    return el;
  }

  // -------------------------------------------------------------------------
  // Main Renderers: In-Game Panels & Components
  // -------------------------------------------------------------------------
  window.renderD2RInGameArmory = function (charData, stashData, containerDims) {
    d2rState.charData = charData;
    d2rState.stashData = stashData;
    if (containerDims) d2rState.containerDims = containerDims;

    const container = document.getElementById('armory-content');
    if (!container) return;

    if (d2rState.viewMode === 'cards') {
      renderLegacyCardsView(container, charData);
      return;
    }

    const char = charData.character || {};
    const equipped = charData.equipped || {};
    const stats = char.stats || {};
    const inventory = charData.inventory || [];
    const personalStash = charData.stash || [];
    const cube = charData.cube || [];

    const invDims = d2rState.containerDims.inventory || { width: 11, height: 8 };
    const stashDims = d2rState.containerDims.sharedStash || { width: 16, height: 13 };
    const cubeDims = d2rState.containerDims.cube || { width: 6, height: 6 };

    container.innerHTML = `
      <div class="d2r-panels-container">

        <!-- ================================================================= -->
        <!-- LEFT PANEL: IN-GAME STASH / BANK / HORADRIC CUBE                 -->
        <!-- ================================================================= -->
        <div class="d2r-panel d2r-stash-panel" id="d2r-left-panel">
          <div class="d2r-panel-header">
            <h3 class="d2r-panel-title" id="d2r-stash-title">STASH</h3>
            <div class="d2r-panel-subtitle" id="d2r-stash-subtitle">Diablo II: Resurrected Bank</div>
          </div>

          <!-- Stash Tabs -->
          <div class="d2r-stash-tab-ribbon" id="d2r-stash-tabs">
            <!-- Rendered in updateStashTabRibbon -->
          </div>

          <!-- Stash Content Area -->
          <div id="d2r-stash-viewport-container">
            <!-- Rendered in renderActiveStashViewport -->
          </div>
        </div>

        <!-- ================================================================= -->
        <!-- RIGHT PANEL: HERO PAPERDOLL & INVENTORY                          -->
        <!-- ================================================================= -->
        <div class="d2r-panel d2r-inventory-panel" id="d2r-right-panel">
          <div class="d2r-panel-header">
            <h3 class="d2r-panel-title">INVENTORY</h3>
            <div class="d2r-panel-subtitle">${escapeHtml(char.name)} - Level ${char.level} ${escapeHtml(char.class)}</div>
          </div>

          <!-- Hero Attributes Summary -->
          <div class="d2r-hero-summary-bar">
            <span class="d2r-hero-name">${escapeHtml(char.name)}</span>
            <div class="d2r-attr-row">
              <div class="d2r-attr-item"><span>STR:</span><span>${stats.strength || '-'}</span></div>
              <div class="d2r-attr-item"><span>DEX:</span><span>${stats.dexterity || '-'}</span></div>
              <div class="d2r-attr-item"><span>VIT:</span><span>${stats.vitality || '-'}</span></div>
              <div class="d2r-attr-item"><span>ENG:</span><span>${stats.energy || '-'}</span></div>
            </div>
          </div>

          <!-- Paperdoll Frame (320x236) -->
          <div class="d2r-paperdoll-frame" id="d2r-paperdoll">
            <!-- Weapon Swap Tabs -->
            <div class="d2r-weapon-swap-tabs left-tabs">
              <button class="d2r-swap-btn ${d2rState.weaponSwap === 1 ? 'active' : ''}" onclick="toggleD2RWeaponSwap(1)">I</button>
              <button class="d2r-swap-btn ${d2rState.weaponSwap === 2 ? 'active' : ''}" onclick="toggleD2RWeaponSwap(2)">II</button>
            </div>
            <div class="d2r-weapon-swap-tabs right-tabs">
              <button class="d2r-swap-btn ${d2rState.weaponSwap === 1 ? 'active' : ''}" onclick="toggleD2RWeaponSwap(1)">I</button>
              <button class="d2r-swap-btn ${d2rState.weaponSwap === 2 ? 'active' : ''}" onclick="toggleD2RWeaponSwap(2)">II</button>
            </div>

            <!-- Paperdoll Equipment Slots -->
            <div class="d2r-paperdoll-slot slot-head ${!equipped.Head ? 'empty-head' : ''}" id="slot-Head"></div>
            <div class="d2r-paperdoll-slot slot-neck ${!equipped.Neck ? 'empty-neck' : ''}" id="slot-Neck"></div>
            <div class="d2r-paperdoll-slot slot-torso ${!equipped.Torso ? 'empty-torso' : ''}" id="slot-Torso"></div>
            <div class="d2r-paperdoll-slot slot-rhand ${!(d2rState.weaponSwap === 1 ? equipped.RightHand : equipped.AlternateRightHand) ? 'empty-rhand' : ''}" id="slot-RightHand"></div>
            <div class="d2r-paperdoll-slot slot-lhand ${!(d2rState.weaponSwap === 1 ? equipped.LeftHand : equipped.AlternateLeftHand) ? 'empty-lhand' : ''}" id="slot-LeftHand"></div>
            <div class="d2r-paperdoll-slot slot-gloves ${!equipped.Gloves ? 'empty-gloves' : ''}" id="slot-Gloves"></div>
            <div class="d2r-paperdoll-slot slot-belt ${!equipped.Belt ? 'empty-belt' : ''}" id="slot-Belt"></div>
            <div class="d2r-paperdoll-slot slot-boots ${!equipped.Boots ? 'empty-boots' : ''}" id="slot-Boots"></div>
            <div class="d2r-paperdoll-slot slot-rring ${!equipped.RightRing ? 'empty-ring' : ''}" id="slot-RightRing"></div>
            <div class="d2r-paperdoll-slot slot-lring ${!equipped.LeftRing ? 'empty-ring' : ''}" id="slot-LeftRing"></div>
          </div>

          <!-- Character Inventory Grid (11x8) -->
          <div class="d2r-inv-grid-viewport" id="d2r-inventory-grid" style="width: ${invDims.width * 32}px; height: ${invDims.height * 32}px;">
            <!-- Rendered in renderInventoryGrid -->
          </div>

          <!-- Inventory Gold Purse Bar -->
          <div class="d2r-inv-gold-bar" style="width: ${invDims.width * 32}px;">
            <button class="d2r-gold-button" title="Gold Purse">💰 Gold</button>
            <span class="d2r-gold-val">${(stats.gold || stats.stashGold || 0).toLocaleString()}</span>
          </div>
        </div>

      </div>
    `;

    // Populate Paperdoll Slots
    populatePaperdollSlots(equipped, d2rState.weaponSwap);

    // Populate Inventory Grid
    populateGridWithItems(document.getElementById('d2r-inventory-grid'), inventory, 'inventory');

    // Populate Stash Tab Ribbon & Viewport
    updateStashTabRibbon();
    renderActiveStashViewport();

    // Enable drag targets
    setupDragDropTargets();
  };

  // -------------------------------------------------------------------------
  // Paperdoll Slots Population
  // -------------------------------------------------------------------------
  function populatePaperdollSlots(equipped, weaponSwap) {
    const slotMap = {
      Head: { id: 'slot-Head', w: 64, h: 64 },
      Neck: { id: 'slot-Neck', w: 32, h: 32 },
      Torso: { id: 'slot-Torso', w: 64, h: 96 },
      Gloves: { id: 'slot-Gloves', w: 60, h: 60 },
      Belt: { id: 'slot-Belt', w: 60, h: 30 },
      Boots: { id: 'slot-Boots', w: 60, h: 60 },
      RightRing: { id: 'slot-RightRing', w: 30, h: 30 },
      LeftRing: { id: 'slot-LeftRing', w: 30, h: 30 }
    };

    // Weapon swap handling
    const rHandItem = weaponSwap === 1 ? equipped.RightHand : equipped.AlternateRightHand;
    const lHandItem = weaponSwap === 1 ? equipped.LeftHand : equipped.AlternateLeftHand;

    const rHandSlot = document.getElementById('slot-RightHand');
    if (rHandSlot) {
      rHandSlot.innerHTML = '';
      if (rHandItem) {
        rHandSlot.classList.remove('empty-rhand');
        rHandSlot.appendChild(createD2RItemElement(rHandItem, 0, 0, 64, 128));
      } else {
        rHandSlot.classList.add('empty-rhand');
      }
    }

    const lHandSlot = document.getElementById('slot-LeftHand');
    if (lHandSlot) {
      lHandSlot.innerHTML = '';
      if (lHandItem) {
        lHandSlot.classList.remove('empty-lhand');
        lHandSlot.appendChild(createD2RItemElement(lHandItem, 0, 0, 64, 128));
      } else {
        lHandSlot.classList.add('empty-lhand');
      }
    }

    // Standard gear slots
    Object.keys(slotMap).forEach(key => {
      const info = slotMap[key];
      const slotEl = document.getElementById(info.id);
      if (!slotEl) return;

      slotEl.innerHTML = '';
      const it = equipped[key];
      if (it) {
        slotEl.className = slotEl.className.replace(/empty-[a-z]+/g, '');
        slotEl.appendChild(createD2RItemElement(it, 0, 0, info.w, info.h));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Grid Item Population
  // -------------------------------------------------------------------------
  function populateGridWithItems(gridEl, items, containerType) {
    if (!gridEl) return;
    gridEl.innerHTML = '';

    items.forEach(it => {
      const itemEl = createD2RItemElement(it);
      gridEl.appendChild(itemEl);
    });
  }

  // -------------------------------------------------------------------------
  // Stash Tabs & Active Viewport Rendering
  // -------------------------------------------------------------------------
  function updateStashTabRibbon() {
    const ribbon = document.getElementById('d2r-stash-tabs');
    if (!ribbon) return;

    const tabsMeta = (d2rState.stashData && d2rState.stashData.tabs) || [];
    let html = '';

    // Shared Stash Tabs 1..N
    tabsMeta.forEach((t, idx) => {
      const tabKey = `shared_${idx}`;
      const isActive = d2rState.activeStashTab === tabKey;
      html += `
        <button class="d2r-tab-btn ${isActive ? 'active' : ''}" onclick="switchD2RStashTab('${tabKey}')">
          ${escapeHtml(t.name || `Shared ${idx + 1}`)} (${t.itemCount || 0})
        </button>
      `;
    });

    // Personal Stash Tab
    const pStashItems = (d2rState.charData && d2rState.charData.stash) || [];
    const isPStashActive = d2rState.activeStashTab === 'personal';
    html += `
      <button class="d2r-tab-btn ${isPStashActive ? 'active' : ''}" onclick="switchD2RStashTab('personal')">
        Personal (${pStashItems.length})
      </button>
    `;

    // Horadric Cube Tab
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
    const isCubeActive = d2rState.activeStashTab === 'cube';
    html += `
      <button class="d2r-tab-btn ${isCubeActive ? 'active' : ''}" onclick="switchD2RStashTab('cube')">
        Horadric Cube (${cubeItems.length})
      </button>
    `;

    ribbon.innerHTML = html;
  }

  function renderActiveStashViewport() {
    const container = document.getElementById('d2r-stash-viewport-container');
    const titleEl = document.getElementById('d2r-stash-title');
    const subTitleEl = document.getElementById('d2r-stash-subtitle');
    if (!container) return;

    const stashDims = d2rState.containerDims.sharedStash || { width: 16, height: 13 };
    const cubeDims = d2rState.containerDims.cube || { width: 6, height: 6 };

    // Case 1: Horadric Cube
    if (d2rState.activeStashTab === 'cube') {
      if (titleEl) titleEl.textContent = 'HORADRIC CUBE';
      if (subTitleEl) subTitleEl.textContent = 'Transmutation & Storage';

      const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
      container.innerHTML = `
        <div class="d2r-cube-container">
          <div class="d2r-cube-grid-viewport" id="d2r-cube-grid" style="width: ${cubeDims.width * 32}px; height: ${cubeDims.height * 32}px;"></div>
          <button class="d2r-transmute-btn" onclick="alert('Cube recipes are active in Diablo II!')">TRANSMUTE</button>
        </div>
      `;
      populateGridWithItems(document.getElementById('d2r-cube-grid'), cubeItems, 'cube');
      setupDragDropTargets();
      return;
    }

    // Case 2: Personal Stash
    if (d2rState.activeStashTab === 'personal') {
      if (titleEl) titleEl.textContent = 'PERSONAL STASH';
      if (subTitleEl) subTitleEl.textContent = `${(d2rState.charData && d2rState.charData.character && d2rState.charData.character.name) || ''}'s Bank`;

      const pStashItems = (d2rState.charData && d2rState.charData.stash) || [];
      const stats = (d2rState.charData && d2rState.charData.character && d2rState.charData.character.stats) || {};

      container.innerHTML = `
        <div class="d2r-stash-grid-viewport" id="d2r-stash-grid" style="width: ${stashDims.width * 32}px; height: ${stashDims.height * 32}px;"></div>
        <div class="d2r-stash-gold-bar">
          <span style="color: var(--d2-color-text-dim);">Personal Stash Deposit</span>
          <span class="d2r-gold-val">${(stats.stashGold || 0).toLocaleString()} Gold</span>
        </div>
      `;
      populateGridWithItems(document.getElementById('d2r-stash-grid'), pStashItems, 'personal');
      setupDragDropTargets();
      return;
    }

    // Case 3: Shared Stash Tabs 1..N
    const match = d2rState.activeStashTab.match(/^shared_(\d+)$/);
    const tabIdx = match ? parseInt(match[1], 10) : 0;
    const tabsMeta = (d2rState.stashData && d2rState.stashData.tabs) || [];
    const activeTab = tabsMeta[tabIdx] || { name: `Shared Stash Tab ${tabIdx + 1}`, gold: 0, items: [] };

    if (titleEl) titleEl.textContent = 'SHARED STASH';
    if (subTitleEl) subTitleEl.textContent = activeTab.name || `Shared Tab ${tabIdx + 1}`;

    container.innerHTML = `
      <div class="d2r-stash-grid-viewport" id="d2r-stash-grid" style="width: ${stashDims.width * 32}px; height: ${stashDims.height * 32}px;"></div>
      <div class="d2r-stash-gold-bar">
        <span style="color: var(--d2-color-text-dim);">${escapeHtml(activeTab.name || `Tab ${tabIdx + 1}`)} Gold:</span>
        <span class="d2r-gold-val">${(activeTab.gold || 0).toLocaleString()} / 2,500,000</span>
      </div>
    `;

    populateGridWithItems(document.getElementById('d2r-stash-grid'), activeTab.items || [], 'shared');
    setupDragDropTargets();
  }

  // -------------------------------------------------------------------------
  // State Switching Controls
  // -------------------------------------------------------------------------
  window.switchD2RStashTab = function (tabKey) {
    d2rState.activeStashTab = tabKey;
    updateStashTabRibbon();
    renderActiveStashViewport();
  };

  window.toggleD2RWeaponSwap = function (swapNum) {
    d2rState.weaponSwap = swapNum;
    const equipped = (d2rState.charData && d2rState.charData.equipped) || {};
    populatePaperdollSlots(equipped, d2rState.weaponSwap);

    document.querySelectorAll('.d2r-swap-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.trim() === (swapNum === 1 ? 'I' : 'II'));
    });
  };

  window.setArmoryViewMode = function (mode) {
    d2rState.viewMode = mode;
    document.getElementById('view-toggle-panels').classList.toggle('active', mode === 'panels');
    document.getElementById('view-toggle-cards').classList.toggle('active', mode === 'cards');

    if (d2rState.charData) {
      window.renderD2RInGameArmory(d2rState.charData, d2rState.stashData, d2rState.containerDims);
    }
  };

  window.openArmoryForStash = function (tabIdx) {
    d2rState.activeStashTab = `shared_${tabIdx !== undefined ? tabIdx : 0}`;
    const navTab = document.querySelector('.nav-tab[data-tab="armory-view"]');
    if (navTab) navTab.click();
  };

  // -------------------------------------------------------------------------
  // Drag & Drop Handlers
  // -------------------------------------------------------------------------
  function setupDragDropTargets() {
    const invGrid = document.getElementById('d2r-inventory-grid');
    const stashGrid = document.getElementById('d2r-stash-grid');
    const cubeGrid = document.getElementById('d2r-cube-grid');

    [
      { el: invGrid, type: 'inventory', tab: 0 },
      { el: stashGrid, type: d2rState.activeStashTab.startsWith('shared') ? 'stash' : 'personal_stash', tab: parseInt((d2rState.activeStashTab.match(/\d+/) || [0])[0], 10) },
      { el: cubeGrid, type: 'cube', tab: 0 }
    ].forEach(target => {
      if (!target.el) return;

      target.el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        target.el.classList.add('d2r-drag-over');
      });

      target.el.addEventListener('dragleave', () => {
        target.el.classList.remove('d2r-drag-over');
      });

      target.el.addEventListener('drop', (e) => {
        e.preventDefault();
        target.el.classList.remove('d2r-drag-over');
        if (!d2rState.draggedItem) return;

        const it = d2rState.draggedItem;
        window.quickTransferD2RItem(it.id, target.type, target.tab);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Atomic Item Transfer Executor
  // -------------------------------------------------------------------------
  window.quickTransferD2RItem = async function (itemId, targetContainer, targetTab) {
    window.closeD2RActionMenu();
    window.hideD2RItemTooltip();

    const charName = d2rState.activeCharName;
    if (!charName) {
      if (window.showToast) window.showToast('Please select a character first', 'error');
      return;
    }

    try {
      const payload = {
        item_id: itemId,
        source: 'any',
        target_character: charName,
        target_container: targetContainer,
        target_tab: targetTab !== undefined ? targetTab : 0,
        force_live: true
      };

      if (window.showToast) window.showToast('Executing transfer...', 'info');

      const res = await fetch('/api/item/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Transfer failed');
      }

      if (window.showToast) {
        window.showToast(`Transferred ${data.item_name || 'item'} to ${data.target_container}!`, 'success');
      }

      // Live reload armory data
      await reloadArmoryData();

    } catch (err) {
      if (window.showToast) {
        window.showToast('Transfer Error: ' + err.message, 'error');
      }
    }
  };

  async function reloadArmoryData() {
    if (!d2rState.activeCharName) return;

    try {
      const [charRes, stashRes, dimsRes] = await Promise.all([
        fetch(`/api/character/${encodeURIComponent(d2rState.activeCharName)}`),
        fetch('/api/shared-stash'),
        fetch('/api/container-dimensions')
      ]);

      if (charRes.ok && stashRes.ok) {
        const charData = await charRes.json();
        const stashData = await stashRes.json();
        const dims = dimsRes.ok ? await dimsRes.json() : d2rState.containerDims;

        window.renderD2RInGameArmory(charData, stashData, dims);
      }
    } catch (err) {
      console.error('Failed to reload armory data:', err);
    }
  }

  window.openTransferModalForD2RItem = function (itemId) {
    if (window.openTransferModal) {
      window.openTransferModal(itemId);
    }
  };

  window.inspectD2RItemDetails = function (itemId) {
    if (window.openItemDetailModalById) {
      window.openItemDetailModalById(itemId);
    }
  };

  // -------------------------------------------------------------------------
  // Fallback / Legacy Card List View
  // -------------------------------------------------------------------------
  function renderLegacyCardsView(container, charData) {
    const char = charData.character || {};
    const equipped = charData.equipped || {};
    const stats = char.stats || {};

    const createSlotHtml = (slotKey, slotLabel) => {
      const it = equipped[slotKey];
      if (it) {
        const qColorClass = getItemQualityClass(it.quality, it.isRuneword);
        return `
          <div class="gear-slot filled" onclick="inspectD2RItemDetails(${it.id})">
            <span class="gear-slot-label">${slotLabel}</span>
            <span class="gear-slot-name ${qColorClass}">${escapeHtml(it.displayName)}</span>
          </div>
        `;
      } else {
        return `
          <div class="gear-slot">
            <span class="gear-slot-label">${slotLabel}</span>
            <span style="font-size: 11px; color: var(--text-dim);">Empty</span>
          </div>
        `;
      }
    };

    container.innerHTML = `
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
          ${createSlotHtml('Head', 'Head')}
          ${createSlotHtml('Neck', 'Amulet')}
          ${createSlotHtml('Torso', 'Armor')}
          ${createSlotHtml('RightHand', 'Main Hand')}
          ${createSlotHtml('LeftHand', 'Off Hand')}
          ${createSlotHtml('Gloves', 'Gloves')}
          ${createSlotHtml('RightRing', 'Right Ring')}
          ${createSlotHtml('LeftRing', 'Left Ring')}
          ${createSlotHtml('Belt', 'Belt')}
          ${createSlotHtml('Boots', 'Boots')}
        </div>
      </div>

      <div class="armory-inventory-panel">
        <div class="inventory-tabs">
          <button class="inv-tab-btn active" data-inv-tab="inventory" onclick="switchInvTab('inventory', this)">Inventory (${(charData.inventory || []).length})</button>
          <button class="inv-tab-btn" data-inv-tab="stash" onclick="switchInvTab('stash', this)">Personal Stash (${(charData.stash || []).length})</button>
          <button class="inv-tab-btn" data-inv-tab="cube" onclick="switchInvTab('cube', this)">Cube (${(charData.cube || []).length})</button>
        </div>

        <div id="armory-tab-content" class="items-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        </div>
      </div>
    `;

    if (window.switchInvTab) window.switchInvTab('inventory');
  }

})();
