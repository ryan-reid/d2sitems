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
    graphicsMode: 'hd',     // 'hd' (Resurrected HD) | 'classic' (Legacy Classic)
    weaponSwap: 1,          // 1: Primary (RightHand/LeftHand), 2: Secondary (AlternateRightHand/AlternateLeftHand)
    activeStashTab: 'shared_0', // 'shared_0'..'shared_5', 'personal', 'cube'
    stackedViewMode: 'mod_layout', // 'mod_layout' | 'categorized' | 'grid'
    rightPanelView: 'hero',        // 'hero' | 'mercenary'
    draggedItem: null
  };

  window._d2rState = d2rState;

  // Sprite Mappings Cache
  let itemImageMappings = { codes: {}, uniques: {}, sets: {} };
  fetch('item_images.json')
    .then(r => r.json())
    .then(data => {
      if (data) {
        itemImageMappings = data;
        window.itemImageMappings = data;
      }
    })
    .catch(() => {});

  function resolveJewelSprite() { return null; }

  function getItemSpriteUrl(item) {
    const isClassic = d2rState.graphicsMode === 'classic';
    const resolved = window.BKItemArt?.resolve(item, itemImageMappings, isClassic);
    if (resolved?.file) return `assets/items/${resolved.file}`;
    const jewelSprite = resolveJewelSprite(item, isClassic);
    if (jewelSprite) {
      return `assets/items/${jewelSprite}`;
    }

    if (isClassic) {
      if (item.invFileClassic) {
        return `assets/items/${item.invFileClassic}`;
      }
      const code = (item.itemCode || '').trim();
      const classicFile = (itemImageMappings.classic_codes && itemImageMappings.classic_codes[code]) || `inv${code.toLowerCase()}.png`;
      return `assets/items/${classicFile}`;
    }

    if (item.invFile) {
      return `assets/items/${item.invFile}`;
    }
    const q = (item.quality || '').toLowerCase();
    const rawName = (item.name || item.displayName || '').split('(')[0].trim().toLowerCase();
    const uid = item.uniqueId !== undefined && item.uniqueId !== null ? String(item.uniqueId) : null;
    const code = (item.itemCode || '').trim();

    let file = null;
    if (q === 'unique') {
      file = (uid && itemImageMappings.uniques && itemImageMappings.uniques[uid]) || (itemImageMappings.uniques && itemImageMappings.uniques[rawName]);
    } else if (q === 'set') {
      file = itemImageMappings.sets && itemImageMappings.sets[rawName];
    }

    if (!file && code && itemImageMappings.codes) {
      file = itemImageMappings.codes[code];
    }

    if (file) {
      return `assets/items/${file}`;
    }
    if (code) {
      return `assets/items/inv${code.toLowerCase()}.png`;
    }
    return null;
  }

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
      let runes = (item.socketedRunes || []).join('');
      if (!runes && Array.isArray(item.sockets) && item.sockets.length > 0) {
        runes = item.sockets.map(s => {
          const m = s.name?.match(/^(\w+)\s+Rune/i);
          return m ? m[1] : (s.name || s.code);
        }).join('');
      }
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

    // Affixes & Modifiers (including runeword and socket stats)
    // Affixes & Modifiers
    const statsList = [...(item.stats || []), ...(item.runewordStats || [])];
    if (statsList.length > 0) {
      statsList.forEach(aff => {
        const desc = aff.description || '';
        if (desc) html += `<div class="d2r-tooltip-affix">${escapeHtml(desc)}</div>`;
      });
    }

    if (item.socketBonuses && item.socketBonuses.length > 0) {
      item.socketBonuses.forEach(desc => {
        html += `<div class="d2r-tooltip-affix socket-bonus" style="color:#647eff;">${escapeHtml(desc)}</div>`;
      });
    }

    for (let i = 1; i <= 5; i++) {
      const sbKey = 'setBonus' + i;
      if (item[sbKey] && item[sbKey].length > 0) {
        item[sbKey].forEach(aff => {
          const desc = aff.description || '';
          if (desc) html += `<div class="d2r-tooltip-affix set-bonus" style="color:#00ff00;">${escapeHtml(desc)}</div>`;
        });
      }
    }

    // Sockets
    const socketCount = item.socketCount || item.totalSockets || 0;
    if (socketCount > 0) {
      html += `<div class="d2r-tooltip-sockets">Socketed (${socketCount})</div>`;
    }

    // Ethereal
    if (item.isEthereal) {
      html += `<div class="d2r-tooltip-ethereal">Ethereal (Cannot be Repaired)</div>`;
    }

    // Unidentified
    if (item.isUnidentified) {
      html += `<div class="d2r-tooltip-unidentified" style="color:var(--removed);">Unidentified</div>`;
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
  // Stackable Slot Names & Edit Modal Handlers
  // -------------------------------------------------------------------------
  const D2R_STACK_SLOT_NAMES = {
    // Runes
    r01: "El Rune", r02: "Eld Rune", r03: "Tir Rune", r04: "Nef Rune", r05: "Eth Rune",
    r06: "Ith Rune", r07: "Tal Rune", r08: "Ral Rune", r09: "Ort Rune", r10: "Thul Rune",
    r11: "Amn Rune", r12: "Sol Rune", r13: "Shael Rune", r14: "Dol Rune", r15: "Hel Rune",
    r16: "Io Rune", r17: "Lum Rune", r18: "Ko Rune", r19: "Fal Rune", r20: "Lem Rune",
    r21: "Pul Rune", r22: "Um Rune", r23: "Mal Rune", r24: "Ist Rune", r25: "Gul Rune",
    r26: "Vex Rune", r27: "Ohm Rune", r28: "Lo Rune", r29: "Sur Rune", r30: "Ber Rune",
    r31: "Jah Rune", r32: "Cham Rune", r33: "Zod Rune",
    // Chipped
    gcw: "Chipped Diamond", gcg: "Chipped Emerald", gcr: "Chipped Ruby",
    gcy: "Chipped Topaz", gcv: "Chipped Amethyst", gcb: "Chipped Sapphire", skc: "Chipped Skull",
    // Flawed
    gfw: "Flawed Diamond", gfg: "Flawed Emerald", gfr: "Flawed Ruby",
    gfy: "Flawed Topaz", gfv: "Flawed Amethyst", gfb: "Flawed Sapphire", skf: "Flawed Skull",
    // Regular
    gsw: "Diamond", gsg: "Emerald", gsr: "Ruby",
    gsy: "Topaz", gsv: "Amethyst", gsb: "Sapphire", sku: "Skull",
    // Flawless
    glw: "Flawless Diamond", glg: "Flawless Emerald", glr: "Flawless Ruby",
    gly: "Flawless Topaz", gzv: "Flawless Amethyst", glb: "Flawless Sapphire", skl: "Flawless Skull",
    // Perfect
    gpw: "Perfect Diamond", gpg: "Perfect Emerald", gpr: "Perfect Ruby",
    gpy: "Perfect Topaz", gpv: "Perfect Amethyst", gpb: "Perfect Sapphire", skz: "Perfect Skull",
    // Keys & Essences
    pk1: "Key of Terror", pk2: "Key of Hate", pk3: "Key of Destruction",
    tes: "Twisted Essence of Suffering", ceh: "Charged Essence of Hatred",
    bet: "Burning Essence of Terror", fed: "Festering Essence of Destruction",
    toa: "Token of Absolution",
    dhn: "Diablo's Horn", bey: "Baal's Eye", mbr: "Mephisto's Brain",
    // Potions & Special
    wms: "Thawing Potion", mfp: "Magic Find Potion", rvl: "Full Rejuvenation Potion", rvs: "Rejuvenation Potion",
    // Crafting & Mod Materials
    std: "Standard of Heroes", dsd: "The Divine Standard",
    cct: "(C) Caster Crafting Tablet", bct: "(B) Blood Crafting Tablet",
    sct: "(S) Safety Crafting Tablet", pct: "(P) Hit Power Crafting Tablet",
    rrr: "Infernal Mawstone", tds: "Hellfire Ashes", rtr: "Fracture Halo",
    fel: "Flask of Etheric Light", voa: "Blood-Coiled Stone", gwh: "Prime Sigil",
    hsm: "Hratli's Spiritual Herb", dss: "Diablo's Soulstone",
    mls: "Charsi's Malus", lmr: "Larzuk's Forging Hammer", bgn: "The Gidbinn",
    gft: "Holiday Gift", dw1: "White Dye", db1: "Black Dye", "1dr": "Dye Cleanser",
    brk: "Hellfire Brick", mbk: "Megabrick"
  };

  window.openEditStackModalByCode = function (code, displayName, currentQty, tabIndex, selectedItem, quickDelta) {
    window.closeD2RActionMenu();
    window.hideD2RItemTooltip();

    code = (code || '').trim().toLowerCase();
    const candidates = ((d2rState.stashData?.tabs || []).flatMap(t => t.items || []))
      .filter(it => it.itemCode?.trim().toLowerCase() === code && it.tabIndex === tabIndex);
    const item = selectedItem || (candidates.length === 1 ? candidates[0] : null);
    if (!item || !item.isStash || item.itemSeed == null || !item.sourceFile) {
      window.showToast?.('Select an existing stack from a specific shared stash. Reload if it is missing or ambiguous.', 'error');
      return;
    }
    window.editStackSelection = { file: item.sourceFile, seed: item.itemSeed, revision: item.saveRevision, tab: item.tabIndex, code: item.itemCode };

    if (!displayName || displayName === code || displayName === code.toUpperCase()) {
      displayName = D2R_STACK_SLOT_NAMES[code] || code.toUpperCase();
    }
    currentQty = parseInt(currentQty, 10) || 0;
    tabIndex = tabIndex != null ? tabIndex : 5;

    const modal = document.getElementById('edit-stack-modal');
    if (!modal) return;

    document.getElementById('edit-stack-item-code').value = code;
    document.getElementById('edit-stack-tab-idx').value = tabIndex;
    document.getElementById('edit-stack-preview-name').textContent = displayName;
    document.getElementById('edit-stack-preview-code').textContent = code;
    document.getElementById('edit-stack-preview-curr').textContent = currentQty;

    const input = document.getElementById('edit-stack-qty-input');
    
    if (quickDelta) {
      input.value = Math.max(0, Math.min(255, currentQty + quickDelta));
      input.dataset.currentQty = currentQty;
      window.submitEditStackQuantity();
      return;
    }

    input.value = currentQty > 0 ? currentQty : 1;
    input.dataset.currentQty = currentQty;

    const iconBox = document.getElementById('edit-stack-preview-icon');
    if (iconBox) {
      const sprite = resolveSlotSprite(code);
      iconBox.innerHTML = sprite ? `<img src="/assets/items/${sprite}" style="max-width: 44px; max-height: 44px; object-fit: contain;">` : '📦';
    }

    const statusEl = document.getElementById('edit-stack-status');
    if (statusEl) statusEl.style.display = 'none';

    modal.style.display = 'flex';
    input.focus();
    input.select();
  };

  window.openEditStackModalFromItem = function (itemId) {
    window.closeD2RActionMenu();
    const it = (d2rState.stashData && d2rState.stashData.tabs && d2rState.stashData.tabs.flatMap(t => t.items || []).find(x => String(x.id) === String(itemId)))
            || (d2rState.charData && [...(d2rState.charData.inventory || []), ...(d2rState.charData.stash || []), ...(d2rState.charData.cube || [])].find(x => String(x.id) === String(itemId)))
            || ((window.state && window.state.items) || []).find(x => String(x.id) === String(itemId));
    if (it) {
      window.openEditStackModalByCode(it.itemCode, it.displayName || it.name, it.quantity != null ? it.quantity : 1, it.tabIndex != null ? it.tabIndex : 5, it);
    }
  };

  window.closeEditStackModal = function () {
    const modal = document.getElementById('edit-stack-modal');
    if (modal) modal.style.display = 'none';
  };

  window.adjustEditStackQty = function (delta) {
    const input = document.getElementById('edit-stack-qty-input');
    if (!input) return;
    let v = (parseInt(input.value, 10) || 0) + delta;
    input.value = Math.max(0, Math.min(255, v));
  };

  window.addEditStackRelative = function (addCount) {
    const input = document.getElementById('edit-stack-qty-input');
    if (!input) return;
    const base = parseInt(input.dataset.currentQty, 10) || 0;
    input.value = Math.max(0, Math.min(255, base + addCount));
  };

  window.setEditStackPreset = function (val) {
    const input = document.getElementById('edit-stack-qty-input');
    if (!input) return;
    input.value = Math.max(0, Math.min(255, val));
  };

  window.submitEditStackQuantity = function () {
    const code = document.getElementById('edit-stack-item-code').value.trim();
    const tabIdx = parseInt(document.getElementById('edit-stack-tab-idx').value, 10);
    const qty = parseInt(document.getElementById('edit-stack-qty-input').value, 10);
    const btn = document.getElementById('btn-submit-edit-stack');
    const statusEl = document.getElementById('edit-stack-status');

    if (isNaN(qty) || qty < 1 || qty > 255) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(255,0,0,0.2)';
        statusEl.style.color = '#ff6b6b';
        statusEl.textContent = 'Please enter a valid stack quantity between 1 and 255.';
      }
      return;
    }

    if (btn) btn.disabled = true;
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(255,215,0,0.1)';
      statusEl.style.color = 'var(--gold)';
      statusEl.textContent = 'Saving stack quantity...';
    }

    // WASM mode support
    if (window.state?.isWasmMode && window.D2Wasm) {
      window.D2Wasm.editStackQuantity(tabIdx, code, qty, window.editStackSelection.file, window.editStackSelection.seed).then(async res => {
        if (btn) btn.disabled = false;
        if (res && res.success) {
          window.closeEditStackModal();
          window.recordEdit?.('stack quantity');
          if (window.showToast) window.showToast(`Updated ${res.code || code} stack quantity to ${qty}.`, 'success');
          if (typeof reloadArmoryData === 'function') await reloadArmoryData();
          if (window.loadSavesAndItems) await window.loadSavesAndItems();
        } else {
          if (statusEl) {
            statusEl.style.background = 'rgba(255,0,0,0.2)';
            statusEl.style.color = '#ff6b6b';
            statusEl.textContent = (res && res.message) || 'Failed to update stack.';
          }
        }
      }).catch(err => {
        if (btn) btn.disabled = false;
        if (statusEl) statusEl.textContent = err.message || 'Failed to save stack.';
      });
      return;
    }

    // Server API mode
    window.coreFetch('/api/stash/stack-quantity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...window.editStackSelection,
        tab: tabIdx,
        code: code,
        quantity: qty
      })
    })
    .then(r => r.json())
    .then(async res => {
      if (btn) btn.disabled = false;
      if (res && (res.Success || res.success)) {
        window.closeEditStackModal();
        window.recordEdit?.('stack quantity');
        if (window.showToast) window.showToast(`Updated ${code.toUpperCase()} stack count to ${qty}.`, 'success');
        // Refresh shared stash data and item list
        if (typeof reloadArmoryData === 'function') await reloadArmoryData();
        if (window.loadSavesAndItems) await window.loadSavesAndItems();
      } else {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(255,0,0,0.2)';
          statusEl.style.color = '#ff6b6b';
          statusEl.textContent = (res && (res.Message || res.error)) || 'Failed to update stack.';
        }
      }
    })
    .catch(err => {
      if (btn) btn.disabled = false;
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(255,0,0,0.2)';
        statusEl.style.color = '#ff6b6b';
        statusEl.textContent = 'Network error: ' + err.message;
      }
    });
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

    // Stack editing option if item is in stackable tab or has stackable properties
    const isStackable = item.isStash && item.isAdvancedStack;
    if (isStackable) {
      itemsHtml += `
        <div class="d2r-menu-item" style="color: #ffd700;" onclick="openEditStackModalFromItem(${item.id})">
          <span>✏️ Edit Stack Quantity (${item.quantity != null ? item.quantity : 0})...</span>
        </div>
        <div class="d2r-menu-divider"></div>
      `;
    }

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
    el._d2Item = item;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Inspect ${item.displayName || item.name}`);

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

    // Item badge / name label (fallback / loading state)
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

    // Authentic Item Sprite Image
    const spriteUrl = getItemSpriteUrl(item);
    if (spriteUrl) {
      const iconWrap = document.createElement('div');
      iconWrap.className = 'd2r-item-icon-wrap';

      const img = document.createElement('img');
      img.className = 'd2r-item-icon';
      img.src = spriteUrl;
      img.alt = dName;
      img.loading = 'lazy';

      img.onload = () => {
        nameLabel.style.display = 'none';
      };
      img.onerror = () => {
        iconWrap.style.display = 'none';
        nameLabel.style.display = 'block';
      };

      iconWrap.appendChild(img);
      content.appendChild(iconWrap);
    }

    // Perfection score badge
    if (item.perfectionScore !== undefined && item.perfectionScore !== null && w >= 2 && h >= 2) {
      const perf = document.createElement('div');
      perf.className = 'd2r-item-perf-badge';
      perf.textContent = `${Math.round(item.perfectionScore)}%`;
      content.appendChild(perf);
    }

    // Sockets overlay
    const socketCount = item.socketCount || 0;
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
          const socketItem = item.sockets && item.sockets[sIdx];
          if (socketItem) {
            sNode.classList.add('has-socketed-item');
            const spriteFile = resolveSocketSprite(socketItem);
            if (spriteFile) {
              const gemImg = document.createElement('img');
              gemImg.className = 'd2r-socket-gem';
              gemImg.src = `assets/items/${spriteFile}`;
              gemImg.alt = socketItem.name || socketItem.code || 'Socketed Item';
              sNode.appendChild(gemImg);
            }
          }
          rowEl.appendChild(sNode);
          sIdx++;
        }
        socketsLayer.appendChild(rowEl);
      }
      content.appendChild(socketsLayer);
    }

    // Stack / Quantity badge for grid and inventory
    if (item.quantity && item.quantity > 1) {
      const qBadge = document.createElement('div');
      qBadge.className = 'd2r-mod-slot-qty';
      qBadge.textContent = item.quantity;
      content.appendChild(qBadge);
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
        <!-- RIGHT PANEL: HERO PAPERDOLL OR MERCENARY IN-GAME PANEL           -->
        <!-- ================================================================= -->
        <div class="d2r-panel d2r-inventory-panel" id="d2r-right-panel">
          <!-- Rendered in renderRightPanelContent -->
        </div>

      </div>
    `;

    // Render Right Panel (Hero Inventory or Mercenary)
    renderRightPanelContent();

    // Populate Stash Tab Ribbon & Viewport
    updateStashTabRibbon();
    renderActiveStashViewport();
    initD2RArmorySearch();
    applyD2RArmorySearch();
    initD2RArmoryScale();

    // Enable drag targets
    setupDragDropTargets();
  };

  // -------------------------------------------------------------------------
  // Mercenary Data Resolution & Slot Mapping
  // -------------------------------------------------------------------------
  function mapMercenarySlots(mercItems) {
    const slots = {
      Head: null, Neck: null, Torso: null,
      RightHand: null, LeftHand: null,
      Belt: null, RightRing: null, LeftRing: null
    };

    (mercItems || []).forEach(it => {
      const loc = (it.location || '').toLowerCase();
      const x = it.invX;

      if (x === 1 || loc.includes('head') || loc.includes('helm')) slots.Head = it;
      else if (x === 2 || loc.includes('neck') || loc.includes('amulet')) slots.Neck = it;
      else if (x === 3 || loc.includes('torso') || loc.includes('armor')) slots.Torso = it;
      else if (x === 4 || loc.includes('righthand') || loc.includes('rightarm') || loc.includes('mainhand')) slots.RightHand = it;
      else if (x === 5 || loc.includes('lefthand') || loc.includes('leftarm') || loc.includes('offhand') || loc.includes('shield')) slots.LeftHand = it;
      else if (x === 6 || loc.includes('rightring')) slots.RightRing = it;
      else if (x === 7 || loc.includes('leftring')) slots.LeftRing = it;
      else if (x === 8 || loc.includes('belt')) slots.Belt = it;
      else if (loc.includes('ring')) {
        if (!slots.RightRing) slots.RightRing = it;
        else if (!slots.LeftRing) slots.LeftRing = it;
      }
    });

    return slots;
  }

  function calculateMercenaryStats(charData) {
    const mercInfo = charData.mercenary_info || {};
    const char = charData.character || {};
    const level = mercInfo.level || char.level || 90;
    const mercType = mercInfo.type || 'Desert Mercenary';
    const subType = mercInfo.subType || '';
    const isDead = Boolean(mercInfo.isDead);

    // Base attributes derived from type and level
    let baseLife, baseStr, baseDex, baseDef, baseRes;
    const mt = mercType.toLowerCase();
    if (mt.includes('barbarian')) {
      baseLife = 1680 + (level - 80) * 45;
      baseStr = 200 + Math.round((level - 80) * 2.0);
      baseDex = 129 + Math.round((level - 80) * 1.5);
      baseDef = 1332 + (level - 80) * 35;
      baseRes = Math.min(75, 50 + (level - 80));
    } else if (mt.includes('desert')) {
      baseLife = 1430 + (level - 75) * 40;
      baseStr = 173 + Math.round((level - 75) * 1.5);
      baseDex = 139 + Math.round((level - 75) * 1.2);
      baseDef = 1027 + (level - 75) * 28;
      baseRes = Math.min(75, 50 + (level - 75));
    } else if (mt.includes('rogue')) {
      baseLife = 1100 + (level - 75) * 30;
      baseStr = 135 + Math.round((level - 75) * 1.0);
      baseDex = 210 + Math.round((level - 75) * 2.0);
      baseDef = 950 + (level - 75) * 25;
      baseRes = Math.min(75, 50 + (level - 75));
    } else if (mt.includes('iron') || mt.includes('wolf')) {
      baseLife = 1250 + (level - 75) * 32;
      baseStr = 145 + Math.round((level - 75) * 1.5);
      baseDex = 140 + Math.round((level - 75) * 1.5);
      baseDef = 1100 + (level - 75) * 30;
      baseRes = Math.min(75, 50 + (level - 75));
    } else {
      baseLife = 1200 + (level - 70) * 35;
      baseStr = 150 + (level - 70);
      baseDex = 150 + (level - 70);
      baseDef = 1000 + (level - 70) * 25;
      baseRes = 75;
    }

    let bonusLife = 0, bonusStr = 0, bonusDex = 0, bonusDef = 0;
    let bonusFire = 0, bonusCold = 0, bonusLight = 0, bonusPois = 0;
    let maxPoisRes = 75;
    let enhancedDmg = 0;
    let dmgMin = 50 + Math.round(level * 1.5);
    let dmgMax = 120 + Math.round(level * 2.5);

    (charData.mercenary || []).forEach(it => {
      if (it.defense) bonusDef += it.defense;
      else if (it.baseDefense) bonusDef += it.baseDefense;

      const allStats = [...(it.stats || []), ...(it.runewordStats || []), ...(it.socketBonuses || [])];
      allStats.forEach(st => {
        const desc = (st.description || '').toLowerCase();
        const id = (st.id || '').toLowerCase();
        const val = typeof st.value === 'number' ? st.value : (parseInt(st.value, 10) || 0);

        if (id.includes('strength') || desc.includes('strength')) bonusStr += val;
        if (id.includes('dexterity') || desc.includes('dexterity')) bonusDex += val;
        if (id.includes('vitality') || desc.includes('vitality')) bonusLife += val * 3;
        if (id.includes('maxlife') || desc.includes('to life')) bonusLife += val;
        if (id.includes('fire') && (id.includes('resist') || desc.includes('fire resist'))) bonusFire += val;
        if (id.includes('cold') && (id.includes('resist') || desc.includes('cold resist'))) bonusCold += val;
        if (id.includes('lightning') && (id.includes('resist') || desc.includes('lightning resist'))) bonusLight += val;
        if (id.includes('poison') && (id.includes('resist') || desc.includes('poison resist'))) bonusPois += val;
        if (desc.includes('all resistances') || desc.includes('to all resistances')) {
          bonusFire += val; bonusCold += val; bonusLight += val; bonusPois += val;
        }
        if (desc.includes('maximum poison resist')) maxPoisRes += val;
        if (id === 'maxdamagepercent' || id === 'mindamagepercent' || desc.includes('enhanced damage')) {
          enhancedDmg = Math.max(enhancedDmg, val);
        }
        if (st.id === 'NormalDamage' || desc.includes('damage +')) {
          dmgMin += val; dmgMax += val;
        }
      });
    });

    if (enhancedDmg > 0) {
      dmgMin = Math.round(dmgMin * (1 + enhancedDmg / 100));
      dmgMax = Math.round(dmgMax * (1 + enhancedDmg / 100));
    }

    return {
      name: mercInfo.name || 'Mercenary',
      type: mercType,
      subType,
      level,
      isDead,
      life: Math.max(1, baseLife + bonusLife),
      str: baseStr + bonusStr,
      dex: baseDex + bonusDex,
      def: baseDef + bonusDef,
      dmgMin,
      dmgMax,
      fireRes: Math.min(75, baseRes + bonusFire),
      coldRes: Math.min(75, baseRes + bonusCold),
      lightRes: Math.min(75, baseRes + bonusLight),
      poisRes: Math.min(maxPoisRes, baseRes + bonusPois)
    };
  }

  function populateMercenarySlots(mercSlots) {
    const slotMap = {
      Head: { id: 'merc-slot-Head', w: 64, h: 64 },
      Torso: { id: 'merc-slot-Torso', w: 64, h: 96 },
      RightHand: { id: 'merc-slot-RightHand', w: 64, h: 128 },
      LeftHand: { id: 'merc-slot-LeftHand', w: 64, h: 128 }
    };

    Object.keys(slotMap).forEach(key => {
      const info = slotMap[key];
      const el = document.getElementById(info.id);
      if (!el) return;
      el.innerHTML = '';
      const it = mercSlots[key];
      const emptyCls = 'empty-' + (key.includes('Ring') ? 'ring' : (key === 'RightHand' ? 'rhand' : (key === 'LeftHand' ? 'lhand' : key.toLowerCase())));
      if (it) {
        el.classList.remove(emptyCls);
        el.appendChild(createD2RItemElement(it, 0, 0, info.w, info.h));
      } else {
        el.classList.add(emptyCls);
      }
    });
  }

  function renderRightPanelContent() {
    const panel = document.getElementById('d2r-right-panel');
    if (!panel || !d2rState.charData) return;

    const charData = d2rState.charData;
    const char = charData.character || {};
    const equipped = charData.equipped || {};
    const stats = char.stats || {};
    const inventory = charData.inventory || [];
    const invDims = d2rState.containerDims.inventory || { width: 11, height: 8 };
    const mercCount = (charData.mercenary || []).length;
    const hasMerc = mercCount > 0 || !!(charData.mercenary_info && charData.mercenary_info.name);
    const isMercView = (d2rState.rightPanelView === 'mercenary' && hasMerc);

    const mercStats = calculateMercenaryStats(charData);
    const mercSlots = mapMercenarySlots(charData.mercenary);

    panel.innerHTML = `
      <div class="d2r-panel-header">
        <div class="d2r-panel-nav-tabs">
          <button class="d2r-panel-nav-tab ${!isMercView ? 'active' : ''}" onclick="window.switchRightPanelTab('hero')">👤 HERO INVENTORY (I)</button>
          ${hasMerc ? `<button class="d2r-panel-nav-tab ${isMercView ? 'active' : ''}" onclick="window.switchRightPanelTab('mercenary')">🛡️ MERCENARY ${mercCount > 0 ? `(${mercCount})` : ''} (O)</button>` : ''}
        </div>
        <h3 class="d2r-panel-title">${isMercView ? 'MERCENARY' : 'INVENTORY'}</h3>
        <div class="d2r-panel-subtitle">
          ${isMercView ? `${escapeHtml(mercStats.name)} - Level ${mercStats.level} ${escapeHtml(mercStats.type)}${escapeHtml(mercStats.subType ? ' (' + mercStats.subType + ')' : '')}` : `${escapeHtml(char.name)} - Level ${char.level} ${escapeHtml(char.class)}`}
        </div>
      </div>

      <div id="d2r-right-panel-body">
        ${isMercView ? `
          <!-- Mercenary Summary Bar -->
          <div class="d2r-hero-summary-bar">
            <span class="d2r-hero-name">${escapeHtml(mercStats.name)}</span>
            ${mercStats.isDead ? '<span class="d2r-corpse-badge" style="color:#e74c3c; font-size:11px; margin-left:8px; border:1px solid #e74c3c; padding:1px 6px; border-radius:3px; background:rgba(231,76,60,0.15);" title="Mercenary has fallen in battle">⚰️ Fallen in Battle</span>' : '<span style="color:#2ecc71; font-size:11px; margin-left:8px; border:1px solid #2ecc71; padding:1px 6px; border-radius:3px; background:rgba(46,204,113,0.15);">⚔️ Active</span>'}
            <button class="d2r-merc-toggle-btn" onclick="window.switchRightPanelTab('hero')" style="margin-left:auto; margin-right:8px; background:#1e1a14; border:1px solid #7c6237; color:#d8b874; padding:2px 8px; border-radius:3px; cursor:pointer; font-size:11px;" title="Switch back to Hero Inventory (Shortcut: I)">👤 Hero (I)</button>
            <div class="d2r-attr-row">
              <div class="d2r-attr-item"><span>STR:</span><span>${mercStats.str}</span></div>
              <div class="d2r-attr-item"><span>DEX:</span><span>${mercStats.dex}</span></div>
              <div class="d2r-attr-item"><span>DEF:</span><span>${mercStats.def.toLocaleString()}</span></div>
            </div>
          </div>

          <!-- Authentic Mercenary Paperdoll & Stat Sheet (380x493) -->
          <div class="d2r-merc-panel-container">
            <div class="d2r-paperdoll-frame" id="d2r-merc-paperdoll">
              <!-- Equipped Slots -->
              <div class="d2r-merc-slot slot-head ${!mercSlots.Head ? 'empty-head' : ''}" id="merc-slot-Head" title="Head / Helm"></div>
              <div class="d2r-merc-slot slot-torso ${!mercSlots.Torso ? 'empty-torso' : ''}" id="merc-slot-Torso" title="Torso / Armor"></div>
              <div class="d2r-merc-slot slot-rhand ${!mercSlots.RightHand ? 'empty-rhand' : ''}" id="merc-slot-RightHand" title="Right Arm / Main Hand"></div>
              <div class="d2r-merc-slot slot-lhand ${!mercSlots.LeftHand ? 'empty-lhand' : ''}" id="merc-slot-LeftHand" title="Left Arm / Off Hand"></div>

              <!-- Name & Level banner -->
              <div class="d2r-merc-name-banner">
                <span class="d2r-merc-name-title">${escapeHtml(mercStats.name)}</span>
                <span class="d2r-merc-sub-title">Level ${mercStats.level} ${escapeHtml(mercStats.type)}${escapeHtml(mercStats.subType ? ' (' + mercStats.subType + ')' : '')}</span>
              </div>

              <!-- Left Column Stat Rows -->
              <div class="d2r-merc-stat-row d2r-merc-stat-left" style="top: 334px;">
                <span class="stat-label">LIFE</span>
                <span class="stat-val">${mercStats.life.toLocaleString()} / ${mercStats.life.toLocaleString()}</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-left" style="top: 360px;">
                <span class="stat-label">STRENGTH</span>
                <span class="stat-val">${mercStats.str}</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-left" style="top: 388px;">
                <span class="stat-label">DEXTERITY</span>
                <span class="stat-val">${mercStats.dex}</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-left" style="top: 415px;">
                <span class="stat-label">DAMAGE</span>
                <span class="stat-val">${mercStats.dmgMin} - ${mercStats.dmgMax}</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-left" style="top: 442px;">
                <span class="stat-label">DEFENSE</span>
                <span class="stat-val">${mercStats.def.toLocaleString()}</span>
              </div>

              <!-- Right Column Resistance Rows -->
              <div class="d2r-merc-stat-row d2r-merc-stat-right stat-fire" style="top: 360px;">
                <span class="stat-label">FIRE RESIST</span>
                <span class="stat-val">${mercStats.fireRes}%</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-right stat-cold" style="top: 388px;">
                <span class="stat-label">COLD RESIST</span>
                <span class="stat-val">${mercStats.coldRes}%</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-right stat-light" style="top: 415px;">
                <span class="stat-label">LIGHTNING RES</span>
                <span class="stat-val">${mercStats.lightRes}%</span>
              </div>
              <div class="d2r-merc-stat-row d2r-merc-stat-right stat-poison" style="top: 442px;">
                <span class="stat-label">POISON RESIST</span>
                <span class="stat-val">${mercStats.poisRes}%</span>
              </div>
            </div>


          </div>
        ` : `
          <!-- Hero Attributes Summary -->
          <div class="d2r-hero-summary-bar">
            <span class="d2r-hero-name">${escapeHtml(char.name)}</span>
            ${(charData.hasCorpse || char.hasCorpse) ? '<span class="d2r-corpse-badge" style="color:#e74c3c; font-size:11px; margin-left:8px; border:1px solid #e74c3c; padding:1px 6px; border-radius:3px; background:rgba(231,76,60,0.15);" title="Character currently has an unretrieved corpse with equipped gear">⚰️ Corpse Gear</span>' : ''}
            ${hasMerc ? `<button class="d2r-merc-toggle-btn" onclick="window.switchRightPanelTab('mercenary')" style="margin-left:auto; margin-right:8px; background:#1e1a14; border:1px solid #7c6237; color:#d8b874; padding:2px 8px; border-radius:3px; cursor:pointer; font-size:11px;" title="View Full Mercenary In-Game Panel (Shortcut: O)">🛡️ Merc ${mercCount > 0 ? `(${mercCount})` : ''}</button>` : ''}
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
        `}
      </div>
    `;

    if (isMercView) {
      populateMercenarySlots(mercSlots);
    } else {
      populatePaperdollSlots(equipped, d2rState.weaponSwap);
      populateGridWithItems(document.getElementById('d2r-inventory-grid'), inventory, 'inventory');
    }
  }

  window.switchRightPanelTab = function (tab) {
    if (tab === 'mercenary') {
      const merc = (d2rState.charData && d2rState.charData.mercenary) || [];
      const mercInfo = d2rState.charData && d2rState.charData.mercenary_info;
      if (!merc.length && (!mercInfo || !mercInfo.name)) {
        if (window.showToast) window.showToast('No mercenary found for this character.', 'info');
        else alert('No mercenary found for this character.');
        return;
      }
    }
    d2rState.rightPanelView = tab;
    renderRightPanelContent();
  };

  // -------------------------------------------------------------------------
  // Paperdoll Slots Population
  // -------------------------------------------------------------------------
  function populatePaperdollSlots(equipped, weaponSwap) {
    const getEq = (keys) => keys.reduce((acc, k) => acc || equipped[k], null);

    const slotMap = {
      Head: { id: 'slot-Head', w: 64, h: 64, keys: ['Head'] },
      Neck: { id: 'slot-Neck', w: 32, h: 32, keys: ['Neck'] },
      Torso: { id: 'slot-Torso', w: 64, h: 96, keys: ['Torso', 'Body Armor', 'Armor'] },
      Gloves: { id: 'slot-Gloves', w: 60, h: 60, keys: ['Gloves', 'Hands'] },
      Belt: { id: 'slot-Belt', w: 60, h: 30, keys: ['Belt'] },
      Boots: { id: 'slot-Boots', w: 60, h: 60, keys: ['Boots', 'Feet'] },
      RightRing: { id: 'slot-RightRing', w: 30, h: 30, keys: ['RightRing', 'Right Ring'] },
      LeftRing: { id: 'slot-LeftRing', w: 30, h: 30, keys: ['LeftRing', 'Left Ring'] }
    };

    // Weapon swap handling
    const rHandItem = weaponSwap === 1 
      ? getEq(['RightHand', 'Right Arm', 'PrimaryRight']) 
      : getEq(['AlternateRightHand', 'Alternate Right Arm', 'SecondaryRight']);
    const lHandItem = weaponSwap === 1 
      ? getEq(['LeftHand', 'Left Arm', 'PrimaryLeft']) 
      : getEq(['AlternateLeftHand', 'Alternate Left Arm', 'SecondaryLeft']);

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
      const it = getEq(info.keys);
      const emptyCls = 'empty-' + (key.includes('Ring') ? 'ring' : key.toLowerCase());
      if (it) {
        slotEl.classList.remove(emptyCls);
        slotEl.appendChild(createD2RItemElement(it, 0, 0, info.w, info.h));
      } else {
        slotEl.classList.add(emptyCls);
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
  // -------------------------------------------------------------------------
  // Stash Tabs & Active Viewport Rendering
  // -------------------------------------------------------------------------
  function updateStashTabRibbon() {
    const ribbon = document.getElementById('d2r-stash-tabs');
    if (!ribbon) return;

    const tabsMeta = (d2rState.stashData && d2rState.stashData.tabs) || [];
    const pStashItems = (d2rState.charData && d2rState.charData.stash) || [];
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];

    // Regular shared tabs (indices 0..4 only)
    const sharedTabs = tabsMeta.slice(0, 5);
    const stackTab = tabsMeta[5] || { name: 'Stackable', itemCount: 0, items: [] };
    const sharedTotalCount = sharedTabs.reduce((sum, t) => sum + (t.itemCount || 0), 0);

    // Compute crafting total (items in Cube + crafting materials in stash)
    const craftingMatCodes = /mls|lmr|bgn|gft|dw1|db1|1dr|cct|bct|sct|pct|rrr|mfp|tds|std|dsd|rtr|fel|voa|gwh|hsm|dss/;
    const craftingMaterialsCount = (stackTab.items || []).filter(it => craftingMatCodes.test((it.itemCode || '').toLowerCase())).length;
    const craftingTotalCount = cubeItems.length + craftingMaterialsCount;

    const isPersonalActive = d2rState.activeStashTab === 'personal';
    const isSharedActive = d2rState.activeStashTab.startsWith('shared_') && d2rState.activeStashTab !== 'shared_5';
    const isCraftingActive = d2rState.activeStashTab === 'crafting' || d2rState.activeStashTab === 'cube';
    const isStackableActive = d2rState.activeStashTab === 'stackable' || d2rState.activeStashTab === 'shared_5';

    let html = `
      <div class="d2r-main-tabs-row">
        <button class="d2r-tab-btn ${isPersonalActive ? 'active' : ''}" onclick="switchD2RStashTab('personal')">
          Personal (${pStashItems.length})
        </button>
        <button class="d2r-tab-btn ${isSharedActive ? 'active' : ''}" onclick="switchD2RSharedSubTab(0)">
          Shared (${sharedTotalCount})
        </button>
        <button class="d2r-tab-btn ${isCraftingActive ? 'active' : ''}" onclick="switchD2RStashTab('crafting')">
          Crafting (${craftingTotalCount})
        </button>
        <button class="d2r-tab-btn ${isStackableActive ? 'active' : ''}" onclick="switchD2RStashTab('stackable')">
          Stackable (${stackTab.itemCount || 0})
        </button>
      </div>
    `;

    if (isSharedActive) {
      const match = d2rState.activeStashTab.match(/^shared_(\d+)$/);
      const currentSharedIdx = match ? parseInt(match[1], 10) : 0;
      let subPagesHtml = '';
      sharedTabs.forEach((t, idx) => {
        const isSubActive = currentSharedIdx === idx;
        subPagesHtml += `
          <button class="d2r-subtab-btn ${isSubActive ? 'active' : ''}" onclick="switchD2RSharedSubTab(${idx})">
            ${escapeHtml(t.name || `Shared ${idx + 1}`)} (${t.itemCount || 0})
          </button>
        `;
      });
      html += `
        <div class="d2r-shared-subtabs-row">
          <button class="d2r-subtab-arrow" onclick="switchD2RSharedRelative(-1)" title="Previous Shared Tab">◄</button>
          <div class="d2r-subtab-pages">${subPagesHtml}</div>
          <button class="d2r-subtab-arrow" onclick="switchD2RSharedRelative(1)" title="Next Shared Tab">►</button>
        </div>
      `;
    }

    ribbon.innerHTML = html;
    if (d2rState.searchQuery && typeof updateTabSearchHighlights === 'function') {
      updateTabSearchHighlights(d2rState.searchQuery);
    }
  }

  function resolveSlotSprite(code) {
    if (!code) return null;
    code = code.toLowerCase().trim();
    if (code === 'jew' || code.startsWith('jew')) {
      return 'hd_jewel_1.png';
    }
    const mappings = itemImageMappings || window.itemImageMappings;
    if (mappings) {
      if (mappings.hd_codes && mappings.hd_codes[code]) {
        return mappings.hd_codes[code];
      }
      if (mappings.codes && mappings.codes[code]) {
        return mappings.codes[code];
      }
    }
    return null;
  }

  function resolveSocketSprite(socketItem) {
    if (!socketItem) return null;
    const code = typeof socketItem === 'string' ? socketItem.toLowerCase().trim() : (socketItem.code || '').toLowerCase().trim();
    if (!code) return null;
    let file = resolveSlotSprite(code);
    if (!file && window.BKItemArt) {
      const mappings = itemImageMappings || window.itemImageMappings;
      if (mappings) {
        const res = window.BKItemArt.resolve({ itemCode: code, quality: 'Normal' }, mappings);
        if (res?.file) file = res.file;
      }
    }
    return file;
  }

  function renderActiveStashViewport() {
    const container = document.getElementById('d2r-stash-viewport-container');
    const titleEl = document.getElementById('d2r-stash-title');
    const subTitleEl = document.getElementById('d2r-stash-subtitle');
    if (!container) return;

    const stashDims = d2rState.containerDims.sharedStash || { width: 16, height: 13 };
    const cubeDims = d2rState.containerDims.cube || { width: 6, height: 6 };
    const tabsMeta = (d2rState.stashData && d2rState.stashData.tabs) || [];
    const stackTab = tabsMeta[5] || { name: 'Stackable', gold: 0, items: [] };

    // Case 1: Personal Stash
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
    if (window.applyD2RArmorySearch) window.applyD2RArmorySearch();
      return;
    }

    // Case 2: Crafting Tab (Authentic 6x6 Cube + advancedstash_materials layout)
    if (d2rState.activeStashTab === 'crafting' || d2rState.activeStashTab === 'cube') {
      if (titleEl) titleEl.textContent = 'CRAFTING CHAMBER';
      if (subTitleEl) subTitleEl.textContent = 'BKDiablo Horadric Forge & Materials';
      renderCraftingViewport(container, stackTab);
      return;
    }

    // Case 3: Stackable Tab (Authentic 112-slot advancedstash_gems layout)
    if (d2rState.activeStashTab === 'stackable' || d2rState.activeStashTab === 'shared_5') {
      if (titleEl) titleEl.textContent = 'STACKABLE ADVANCED STASH';
      if (subTitleEl) subTitleEl.textContent = 'BKDiablo Gems, Runes & Stacked Materials';
      renderStackableViewport(container, stackTab);
      return;
    }

    // Case 5: Shared Stash Tabs 1..5
    const match = d2rState.activeStashTab.match(/^shared_(\d+)$/);
    const tabIdx = match ? parseInt(match[1], 10) : 0;
    const activeTab = tabsMeta[tabIdx] || { name: `Shared ${tabIdx + 1}`, gold: 0, items: [] };

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
    if (window.applyD2RArmorySearch) window.applyD2RArmorySearch();
  }

  function renderStackableViewport(container, activeTab) {
    const items = activeTab.items || [];
    const currentMode = d2rState.stackedViewMode || 'mod_layout';
    const layout = window.D2R_BANK_LAYOUT || null;
    const origin = (layout && layout.origin) || { x: 91, y: 235 };
    const scale = (layout && layout.scale) || (32.0 / 98.0);
    const slots = (layout && layout.stackable_slots) || [];

    let bodyHtml = '';

    if (currentMode === 'mod_layout' && slots.length > 0) {
      const itemsByCode = new Map();
      items.forEach(it => {
        const c = (it.itemCode || '').trim().toLowerCase();
        if (!itemsByCode.has(c)) itemsByCode.set(c, []);
        itemsByCode.get(c).push(it);
      });

      let slotsHtml = '';
      slots.forEach(slot => {
        const code = (slot.itemCode || '').toLowerCase();
        const sx = Math.round((slot.x - origin.x) * scale);
        const sy = Math.round((slot.y - origin.y) * scale);
        const sw = Math.round(slot.width * scale);
        const sh = Math.round(slot.height * scale);

        const matchedList = itemsByCode.get(code) || [];
        const totalQty = matchedList.reduce((sum, x) => sum + (x.quantity != null ? x.quantity : 0), 0);
        const hasItem = matchedList.length > 0 && totalQty > 0;
        const friendlyName = (matchedList[0] && (matchedList[0].displayName || matchedList[0].name)) || D2R_STACK_SLOT_NAMES[code] || code.toUpperCase();

        if (hasItem) {
          const primaryItem = Object.assign({}, matchedList[0]);
          primaryItem.quantity = totalQty;
          const itEncoded = encodeURIComponent(JSON.stringify(primaryItem));
          slotsHtml += `
            <div class="d2r-mod-slot has-item" style="left: ${sx}px; top: ${sy}px; width: ${sw}px; height: ${sh}px;" data-code="${code}" data-name="${escapeHtml(friendlyName)}" data-qty="${totalQty}" data-tab="5" data-item="${itEncoded}" data-item-id="${primaryItem.id || ''}" title="${escapeHtml(friendlyName)} (Count: ${totalQty} - Click to Edit Stack)">
              <button class="d2r-mod-slot-edit-btn" title="Edit Stack Count">✏️</button>
            </div>
          `;
        } else {
          const imgFile = resolveSlotSprite(code);
          const wmHtml = imgFile ? `<img src="/assets/items/${imgFile}" class="d2r-mod-slot-watermark" alt="${code}">` : '';
          slotsHtml += `
            <div class="d2r-mod-slot is-empty" style="left: ${sx}px; top: ${sy}px; width: ${sw}px; height: ${sh}px;" data-code="${code}" data-name="${escapeHtml(friendlyName)}" data-qty="0" data-tab="5" title="Empty Slot: ${escapeHtml(friendlyName)} (Click to Add / Edit Stack)">
              ${wmHtml}
              <div class="d2r-mod-slot-empty-add" title="Add to stack">+</div>
            </div>
          `;
        }
      });

      bodyHtml = `
        <div class="d2r-mod-layout-viewport" id="d2r-mod-stackable-viewport">
          ${slotsHtml}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="d2r-stacked-tab-wrapper">
        <div class="d2r-stacked-header-bar">
          <div class="d2r-stacked-info">
            <span class="d2r-stacked-pill">STACKABLE</span>
            <span class="d2r-stacked-tab-name">Advanced Stash (Mod Layout)</span>
            <span class="d2r-stacked-count-pill">${items.length} items</span>
          </div>
        </div>

        <div class="d2r-stacked-body" id="d2r-stacked-body-container">
          ${bodyHtml}
        </div>
      </div>
    `;

    if (currentMode === 'mod_layout') {
      container.querySelectorAll('.d2r-mod-slot.has-item').forEach(slotBox => {
        const itemJson = slotBox.getAttribute('data-item');
        if (itemJson) {
          try {
            const it = JSON.parse(decodeURIComponent(itemJson));
            const w = parseInt(slotBox.style.width, 10) || 32;
            const h = parseInt(slotBox.style.height, 10) || 32;
            const itemEl = createD2RItemElement(it, 0, 0, w, h);
            itemEl.style.position = 'relative';
            itemEl.style.left = '0';
            itemEl.style.top = '0';
            itemEl.style.width = '100%';
            itemEl.style.height = '100%';
            slotBox.appendChild(itemEl);

            // Display stack count badge on the slot
            const q = it.quantity != null ? it.quantity : 1;
            const qBadge = document.createElement('div');
            qBadge.className = 'd2r-mod-slot-qty';
            qBadge.textContent = q;
            const wrap = itemEl.querySelector('.d2r-item-content') || itemEl;
            wrap.appendChild(qBadge);

            // Double click opens stack editor
            itemEl.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              window.openEditStackModalByCode(it.itemCode, it.displayName || it.name, q, 5);
            });
          } catch (e) {}
        }
      });

      // Attach click listeners to all empty slots and edit buttons cleanly
      container.querySelectorAll('#d2r-mod-stackable-viewport .d2r-mod-slot.is-empty').forEach(slotBox => {
        slotBox.addEventListener('click', () => {
          const code = slotBox.getAttribute('data-code');
          const name = slotBox.getAttribute('data-name');
          const qty = parseInt(slotBox.getAttribute('data-qty'), 10) || 0;
          const tab = parseInt(slotBox.getAttribute('data-tab'), 10) || 5;
          window.openEditStackModalByCode(code, name, qty, tab);
        });
      });

      container.querySelectorAll('#d2r-mod-stackable-viewport .d2r-mod-slot-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slot = btn.closest('.d2r-mod-slot');
          if (slot) {
            const code = slot.getAttribute('data-code');
            const name = slot.getAttribute('data-name');
            const qty = parseInt(slot.getAttribute('data-qty'), 10) || 0;
            const tab = parseInt(slot.getAttribute('data-tab'), 10) || 5;
            window.openEditStackModalByCode(code, name, qty, tab);
          }
        });
      });
    } else if (currentMode === 'categorized') {
      attachCategorizedSlotItems(container);
    } else if (currentMode === 'grid') {
      const gridEl = document.getElementById('d2r-stash-grid');
      if (gridEl) {
        gridEl.innerHTML = '';
        const numRows = Math.max(13, Math.ceil(items.length / 16));
        gridEl.style.height = `${numRows * 32}px`;
        items.forEach((it, idx) => {
          const col = idx % 16;
          const row = Math.floor(idx / 16);
          const itemEl = createD2RItemElement(it, col * 32, row * 32, (it.width || 1) * 32, (it.height || 1) * 32);
          gridEl.appendChild(itemEl);
        });
      }
    }

    setupDragDropTargets();
    if (window.applyD2RArmorySearch) window.applyD2RArmorySearch();
  }

  function renderCraftingViewport(container, activeTab) {
    const items = activeTab.items || [];
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
    const currentMode = d2rState.stackedViewMode || 'mod_layout';
    const layout = window.D2R_BANK_LAYOUT || null;
    const origin = (layout && layout.origin) || { x: 91, y: 235 };
    const scale = (layout && layout.scale) || (32.0 / 98.0);
    const slots = ((layout && layout.crafting_slots) || []).filter(s => (s.itemCode || '').toLowerCase() !== 'rtr');
    const cubeMeta = (layout && layout.crafting_cube) || { x: 1002, y: 538, cellCount: { x: 6, y: 6 } };

    let bodyHtml = '';

    if (currentMode === 'mod_layout') {
      const itemsByCode = new Map();
      items.forEach(it => {
        const c = (it.itemCode || '').trim().toLowerCase();
        if (!itemsByCode.has(c)) itemsByCode.set(c, []);
        itemsByCode.get(c).push(it);
      });

      const slotNames = {
        hdm: "Horadric Malus",
        hfh: "Hellforge Hammer",
        bgn: "The Gidbinn",
        dw1: "White Dye",
        db1: "Black Dye",
        '1dr': "Dye Cleanser",
        cct: "Colossal Caster Jewel",
        bct: "Colossal Blood Jewel",
        sct: "Colossal Safety Jewel",
        pct: "Colossal Hit Power Jewel",
        rrr: "Infernal Mawstone",
        mfp: "Magic Find Potion",
        tds: "Hellfire Ashes",
        std: "Standard of Heroes",
        dsd: "The Divine Standard",
        fel: "Flask of Etheric Light",
        voa: "Blood-Coiled Stone",
        gwh: "Prime Sigil",
        hsm: "Hratli's Spiritual Herb",
        dss: "Diablo's Soulstone",
        gft: "Holiday Gift"
      };

      let slotsHtml = '';
      slots.forEach(slot => {
        const code = (slot.itemCode || '').toLowerCase();
        const sx = Math.round((slot.x - origin.x) * scale);
        const sy = Math.round((slot.y - origin.y) * scale);
        const sw = Math.round(slot.width * scale);
        const sh = Math.round(slot.height * scale);

        const matchedList = itemsByCode.get(code) || [];
        const totalQty = matchedList.reduce((sum, x) => sum + (x.quantity != null ? x.quantity : 0), 0);
        const hasItem = matchedList.length > 0 && totalQty > 0;
        const friendlyName = (matchedList[0] && (matchedList[0].displayName || matchedList[0].name)) || slotNames[code] || D2R_STACK_SLOT_NAMES[code] || ('Crafting Material: ' + code.toUpperCase());

        if (hasItem) {
          const primaryItem = Object.assign({}, matchedList[0]);
          primaryItem.quantity = totalQty;
          const itEncoded = encodeURIComponent(JSON.stringify(primaryItem));
          slotsHtml += `
            <div class="d2r-mod-slot has-item" style="left: ${sx}px; top: ${sy}px; width: ${sw}px; height: ${sh}px;" data-code="${code}" data-name="${escapeHtml(friendlyName)}" data-qty="${totalQty}" data-tab="5" data-item="${itEncoded}" data-item-id="${primaryItem.id || ''}" title="${escapeHtml(friendlyName)} (Count: ${totalQty} - Click to Edit Stack)">
              <button class="d2r-mod-slot-edit-btn" title="Edit Stack Count">✏️</button>
            </div>
          `;
        } else {
          const imgFile = resolveSlotSprite(code);
          const wmHtml = imgFile ? `<img src="/assets/items/${imgFile}" class="d2r-mod-slot-watermark" alt="${code}">` : '';
          slotsHtml += `
            <div class="d2r-mod-slot is-empty" style="left: ${sx}px; top: ${sy}px; width: ${sw}px; height: ${sh}px;" data-code="${code}" data-name="${escapeHtml(friendlyName)}" data-qty="0" data-tab="5" title="Empty Slot: ${escapeHtml(friendlyName)} (Click to Add / Edit Stack)">
              ${wmHtml}
              <div class="d2r-mod-slot-empty-add" title="Add to stack">+</div>
            </div>
          `;
        }
      });

      const cubeX = Math.round((cubeMeta.x - origin.x) * scale);
      const cubeY = Math.round((cubeMeta.y - origin.y) * scale);

      bodyHtml = `
        <div class="d2r-mod-layout-viewport" id="d2r-mod-crafting-viewport">
          <!-- Authentic 6x6 Horadric Cube Chamber -->
          <div class="d2r-crafting-cube-grid-authentic" id="d2r-crafting-cube-grid" style="left: ${cubeX}px; top: ${cubeY}px;"></div>

          <!-- Crafting Slots (mls, lmr, bgn, dw1, tablets, etc.) -->
          ${slotsHtml}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="d2r-stacked-tab-wrapper">
        <div class="d2r-stacked-header-bar">
          <div class="d2r-stacked-info">
            <span class="d2r-stacked-pill">CRAFTING</span>
            <span class="d2r-stacked-tab-name">Horadric Forge (Mod Layout)</span>
            <span class="d2r-stacked-count-pill">${cubeItems.length} in Cube</span>
          </div>
        </div>

        <div class="d2r-stacked-body" id="d2r-stacked-body-container">
          ${bodyHtml}
        </div>
      </div>
    `;

    if (currentMode === 'mod_layout') {
      const craftingCubeGrid = document.getElementById('d2r-crafting-cube-grid');
      if (craftingCubeGrid) {
        populateGridWithItems(craftingCubeGrid, cubeItems, 'cube');
      }

      container.querySelectorAll('.d2r-mod-slot.has-item').forEach(slotBox => {
        const itemJson = slotBox.getAttribute('data-item');
        if (itemJson) {
          try {
            const it = JSON.parse(decodeURIComponent(itemJson));
            const w = parseInt(slotBox.style.width, 10) || 32;
            const h = parseInt(slotBox.style.height, 10) || 32;
            const itemEl = createD2RItemElement(it, 0, 0, w, h);
            itemEl.style.position = 'relative';
            itemEl.style.left = '0';
            itemEl.style.top = '0';
            itemEl.style.width = '100%';
            itemEl.style.height = '100%';
            slotBox.appendChild(itemEl);

            const q = it.quantity != null ? it.quantity : 1;
            const qBadge = document.createElement('div');
            qBadge.className = 'd2r-mod-slot-qty';
            qBadge.textContent = q;
            const wrap = itemEl.querySelector('.d2r-item-content') || itemEl;
            wrap.appendChild(qBadge);

            // Double click opens stack editor
            itemEl.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              window.openEditStackModalByCode(it.itemCode, it.displayName || it.name, q, 5);
            });
          } catch (e) {}
        }
      });

      // Attach click listeners to all empty slots and edit buttons cleanly
      container.querySelectorAll('#d2r-mod-crafting-viewport .d2r-mod-slot.is-empty').forEach(slotBox => {
        slotBox.addEventListener('click', () => {
          const code = slotBox.getAttribute('data-code');
          const name = slotBox.getAttribute('data-name');
          const qty = parseInt(slotBox.getAttribute('data-qty'), 10) || 0;
          const tab = parseInt(slotBox.getAttribute('data-tab'), 10) || 5;
          window.openEditStackModalByCode(code, name, qty, tab);
        });
      });

      container.querySelectorAll('#d2r-mod-crafting-viewport .d2r-mod-slot-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slot = btn.closest('.d2r-mod-slot');
          if (slot) {
            const code = slot.getAttribute('data-code');
            const name = slot.getAttribute('data-name');
            const qty = parseInt(slot.getAttribute('data-qty'), 10) || 0;
            const tab = parseInt(slot.getAttribute('data-tab'), 10) || 5;
            window.openEditStackModalByCode(code, name, qty, tab);
          }
        });
      });
    } else if (currentMode === 'cube') {
      populateGridWithItems(document.getElementById('d2r-cube-grid'), cubeItems, 'cube');
    } else if (currentMode === 'categorized') {
      attachCategorizedSlotItems(container);
    }

    setupDragDropTargets();
    if (window.applyD2RArmorySearch) window.applyD2RArmorySearch();
  }

  function renderCategorizedMaterialsHtml(items) {
    const runes = [];
    const gems = [];
    const keysEssences = [];
    const craftingMaterials = [];
    const others = [];

    const gemCodes = new Set([
      'gcw', 'gfw', 'gsw', 'glw', 'gpw', 'gaw',
      'gcg', 'gfg', 'gsg', 'glg', 'gpg', 'gag',
      'gcr', 'gfr', 'gsr', 'glr', 'gpr', 'gar',
      'gcy', 'gfy', 'gsy', 'gly', 'gpy', 'gay',
      'gcv', 'gfv', 'gsv', 'gzv', 'gpv', 'gav',
      'gcb', 'gfb', 'gsb', 'glb', 'gpb', 'gab',
      'skc', 'skf', 'sku', 'skl', 'skz', 'ska'
    ]);

    items.forEach(it => {
      const code = (it.itemCode || '').trim().toLowerCase();
      const itype = (it.type || '').toLowerCase();
      const rawName = (it.name || it.baseName || '').toLowerCase();

      if (itype === 'rune' || (/^r\d{2}$/.test(code))) {
        runes.push(it);
      } else if (gemCodes.has(code) || itype.includes('gem') || itype.includes('diamond') || itype.includes('ruby') || itype.includes('topaz') || itype.includes('amethyst') || itype.includes('sapphire') || itype.includes('emerald') || itype.includes('skull') || code === 'jew' || code === 'cjw' || rawName.includes('jewel')) {
        gems.push(it);
      } else if (/pk|bey|dhn|mbr|tes|ceh|bet|fed|toa|xa|ua/.test(code)) {
        keysEssences.push(it);
      } else if (/pct|sct|cct|bct|brk|mbk|rrr|rtr|fel|tds|gwh|std|wms|mfp|rvl|rvs|lmr|mls|dsd|dss|voa|hsm/.test(code)) {
        craftingMaterials.push(it);
      } else {
        others.push(it);
      }
    });

    runes.sort((a, b) => ((a.itemCode || '').toLowerCase()).localeCompare((b.itemCode || '').toLowerCase()));
    gems.sort((a, b) => ((a.itemCode || '').toLowerCase()).localeCompare((b.itemCode || '').toLowerCase()));

    return `
      <div class="d2r-stacked-categories">
        ${renderStackedSection('ᚱ Runes', runes, 'runes')}
        ${renderStackedSection('💎 Gems & Jewels', gems, 'gems')}
        ${renderStackedSection('🗝️ Keys & Essences', keysEssences, 'keys')}
        ${renderStackedSection('📜 Crafting Tablets & Materials', craftingMaterials, 'materials')}
        ${others.length > 0 ? renderStackedSection('📦 Other Stacked Items', others, 'others') : ''}
      </div>
    `;
  }

  function attachCategorizedSlotItems(container) {
    container.querySelectorAll('.d2r-stacked-slot-box').forEach(slotBox => {
      const itemJson = slotBox.getAttribute('data-item');
      if (itemJson) {
        try {
          const it = JSON.parse(decodeURIComponent(itemJson));
          const itemEl = createD2RItemElement(it, 0, 0, 32, 32);
          itemEl.style.position = 'relative';
          itemEl.style.left = '0';
          itemEl.style.top = '0';
          itemEl.style.width = '100%';
          itemEl.style.height = '100%';
          slotBox.appendChild(itemEl);
        } catch (e) {}
      }
    });
  }

  function renderStackedSection(title, items, type) {
    if (!items || items.length === 0) return '';
    let slotsHtml = '';
    items.forEach(it => {
      const itEncoded = encodeURIComponent(JSON.stringify(it));
      const code = (it.itemCode || '').trim();
      const isRune = /^r\d{2}$/i.test(code);
      const runeNum = isRune ? parseInt(code.slice(1), 10) : null;
      const runeBadge = runeNum ? `<span class="d2r-stacked-rune-badge">${runeNum}</span>` : '';

      slotsHtml += `
        <div class="d2r-stacked-slot-box" data-item="${itEncoded}" title="${escapeHtml(it.displayName || it.name)}">
          ${runeBadge}
        </div>
      `;
    });

    return `
      <div class="d2r-stacked-section d2r-section-${type}">
        <div class="d2r-stacked-section-title">
          <span>${title}</span>
          <span class="d2r-section-count">(${items.length})</span>
        </div>
        <div class="d2r-stacked-section-grid">
          ${slotsHtml}
        </div>
      </div>
    `;
  }

  window.setD2RStackedViewMode = function (mode) {
    d2rState.stackedViewMode = mode;
    renderActiveStashViewport();
  };

  window.triggerD2RTransmute = function() {
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
    if (cubeItems.length === 0) {
      if (window.showToast) window.showToast('Horadric Cube is empty! Place items inside first.', 'warning');
      else alert('Horadric Cube is empty! Place items inside first.');
      return;
    }
    const itemNames = cubeItems.map(it => it.displayName || it.name).join(', ');
    if (window.showToast) {
      window.showToast(`Transmute active: [${itemNames}]. Transmuting recipes in D2R!`, 'info');
    } else {
      alert(`Transmute active: [${itemNames}]`);
    }
  };

  window.triggerD2RWithdrawAll = async function() {
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
    if (cubeItems.length === 0) {
      if (window.showToast) window.showToast('Horadric Cube is empty.', 'info');
      return;
    }
    if (window.showToast) window.showToast(`Withdrawing ${cubeItems.length} items to stash...`, 'info');
    for (const it of cubeItems) {
      try {
        await window.quickTransferD2RItem(it.id, 'stash', 5);
      } catch (e) {}
    }
    await reloadArmoryData();
  };

  // -------------------------------------------------------------------------
  // State Switching Controls
  // -------------------------------------------------------------------------
  window.switchD2RStashTab = function (tabKey) {
    d2rState.activeStashTab = tabKey;
        // Populate Stash Tab Ribbon & Viewport
    updateStashTabRibbon();
    renderActiveStashViewport();
    initD2RArmorySearch();
    applyD2RArmorySearch();
  };

  window.switchD2RSharedSubTab = function (idx) {
    d2rState.activeStashTab = `shared_${idx}`;
        // Populate Stash Tab Ribbon & Viewport
    updateStashTabRibbon();
    renderActiveStashViewport();
    initD2RArmorySearch();
    applyD2RArmorySearch();
  };

  window.switchD2RSharedRelative = function (delta) {
    const tabsMeta = (d2rState.stashData && d2rState.stashData.tabs) || [];
    const sharedTabs = tabsMeta.slice(0, 5);
    if (sharedTabs.length === 0) return;

    let currentIdx = 0;
    const match = d2rState.activeStashTab.match(/^shared_(\d+)$/);
    if (match) currentIdx = parseInt(match[1], 10);
    if (currentIdx === 5) currentIdx = 0;

    let newIdx = currentIdx + delta;
    if (newIdx < 0) newIdx = sharedTabs.length - 1;
    if (newIdx >= sharedTabs.length) newIdx = 0;

    window.switchD2RSharedSubTab(newIdx);
  };

  window.toggleD2RWeaponSwap = function (swapNum) {
    d2rState.weaponSwap = swapNum;
    const equipped = (d2rState.charData && d2rState.charData.equipped) || {};
    populatePaperdollSlots(equipped, d2rState.weaponSwap);

    document.querySelectorAll('.d2r-swap-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.trim() === (swapNum === 1 ? 'I' : 'II'));
    });
  };

  window.setArmoryViewMode = function () {};

  window.openArmoryForStash = function (tabIdx) {
    d2rState.activeStashTab = `shared_${tabIdx !== undefined ? tabIdx : 0}`;
    const navTab = document.querySelector('.nav-tab[data-tab="armory-view"]');
    if (navTab) navTab.click();
  };

  window.toggleD2RGraphicsMode = function () {
    d2rState.graphicsMode = d2rState.graphicsMode === 'hd' ? 'classic' : 'hd';
    const btn = document.getElementById('d2r-graphics-toggle-btn');
    if (btn) {
      if (d2rState.graphicsMode === 'hd') {
        btn.textContent = '✨ Resurrected HD (G)';
        btn.className = 'btn btn-sm btn-primary';
      } else {
        btn.textContent = '🕹️ Legacy Classic (G)';
        btn.className = 'btn btn-sm btn-secondary';
      }
    }
    if (d2rState.charData) {
      populatePaperdollSlots(d2rState.charData.equipped || {}, d2rState.weaponSwap);
      populateGridWithItems(document.getElementById('d2r-inventory-grid'), d2rState.charData.inventory || [], 'inventory');
    }
    renderActiveStashViewport();
  };

  // Authentic D2R Keyboard shortcuts:
  // 'G' -> Toggle Graphics Mode (D2R vs Classic)
  // 'O' -> Toggle Mercenary panel
  // 'I' -> Switch to Hero Inventory
  // 'W' -> Toggle Weapon Swap (Hero Paperdoll)
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT')) {
      return;
    }
    const armoryView = document.getElementById('armory-view');
    if (!armoryView || !armoryView.classList.contains('active')) {
      return;
    }

    if (e.key === 'g' || e.key === 'G') {
      window.toggleD2RGraphicsMode();
    } else if (e.key === 'o' || e.key === 'O') {
      const nextTab = d2rState.rightPanelView === 'mercenary' ? 'hero' : 'mercenary';
      window.switchRightPanelTab(nextTab);
    } else if (e.key === 'i' || e.key === 'I') {
      window.switchRightPanelTab('hero');
    } else if (e.key === 'w' || e.key === 'W') {
      if (d2rState.rightPanelView !== 'mercenary') {
        const nextSwap = d2rState.weaponSwap === 1 ? 2 : 1;
        window.toggleD2RWeaponSwap(nextSwap);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Drag & Drop Handlers
  // -------------------------------------------------------------------------
  function dropCell(event, grid) {
    const bounds = grid.getBoundingClientRect();
    const scaleX = bounds.width / grid.offsetWidth || 1;
    const scaleY = bounds.height / grid.offsetHeight || 1;
    return { x: Math.floor((event.clientX - bounds.left) / (32 * scaleX)), y: Math.floor((event.clientY - bounds.top) / (32 * scaleY)) };
  }

  function setupDragDropTargets() {
    const invGrid = document.getElementById('d2r-inventory-grid');
    const stashGrid = document.getElementById('d2r-stash-grid') || 
                      document.getElementById('d2r-mod-stackable-viewport') || 
                      document.getElementById('d2r-mod-crafting-viewport') || 
                      document.getElementById('d2r-stacked-body-container');
    const cubeGrid = document.getElementById('d2r-crafting-cube-grid') || 
                     document.getElementById('d2r-cube-grid');

    const isStackedTab = d2rState.activeStashTab === 'stackable' || d2rState.activeStashTab === 'crafting' || d2rState.activeStashTab === 'shared_5';
    const stashTargetType = isStackedTab ? 'stash' : (d2rState.activeStashTab.startsWith('shared') ? 'stash' : 'personal_stash');
    const stashTargetTab = isStackedTab ? 5 : parseInt((d2rState.activeStashTab.match(/\d+/) || [0])[0], 10);

    // 1. Separate handler for cubeGrid to stop event propagation
    if (cubeGrid) {
      cubeGrid.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        cubeGrid.classList.add('d2r-drag-over');
      });

      cubeGrid.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        cubeGrid.classList.remove('d2r-drag-over');
      });

      cubeGrid.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cubeGrid.classList.remove('d2r-drag-over');
        if (!d2rState.draggedItem) return;

        const it = d2rState.draggedItem;
        window.quickTransferD2RItem(it.id, 'cube', 0, dropCell(e, cubeGrid));
      });
    }

    // 2. Handlers for inventory and stash grids
    [
      { el: invGrid, type: 'inventory', tab: 0 },
      { el: stashGrid, type: stashTargetType, tab: stashTargetTab }
    ].forEach(target => {
      if (!target.el) return;

      target.el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        target.el.classList.add('d2r-drag-over');
      });

      target.el.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        target.el.classList.remove('d2r-drag-over');
      });

      target.el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        target.el.classList.remove('d2r-drag-over');
        if (!d2rState.draggedItem) return;

        const it = d2rState.draggedItem;
        const cell = target.type === 'stash' && isStackedTab ? null : dropCell(e, target.el);
        window.quickTransferD2RItem(it.id, target.type, target.tab, cell);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Atomic Item Transfer Executor
  // -------------------------------------------------------------------------
  window.quickTransferD2RItem = async function (itemId, targetContainer, targetTab, cell = null) {
    if (!window.EditWorkspace?.active) { window.showToast('Turn on Edit mode to move items.', 'info'); return; }
    if (window.EditWorkspace.busy) return;
    window.EditWorkspace.busy = true;
    window.closeD2RActionMenu();
    window.hideD2RItemTooltip();

    const charName = d2rState.activeCharName;
    if (!charName) {
      window.EditWorkspace.busy = false;
      if (window.showToast) window.showToast('Please select a character first', 'error');
      return;
    }

    try {
      const selected = (window.state?.allWasmItems || window.state?.items || []).find(item => String(item.id) === String(itemId))
        || ['inventory', 'stash', 'cube'].flatMap(key => d2rState.charData?.[key] || []).find(item => String(item.id) === String(itemId))
        || (d2rState.stashData?.tabs || []).flatMap(tab => tab.items || []).find(item => String(item.id) === String(itemId));
      const targetSave = (window.state?.saves || []).find(save => targetContainer === 'stash' ? save.file === d2rState.stashData?.save?.file : save.name === charName && !save.is_stash);
      if (!selected || !targetSave) throw new Error('The exact source or destination save is unavailable. Reload and select a matching stash.');
      const payload = {
        SourceRevision: selected?.saveRevision,
        TargetRevision: targetSave?.saveRevision,
        SourceFile: selected?.sourceFile,
        ItemSeed: selected?.itemSeed,
        ItemCode: selected?.itemCode,
        SourceContainer: selected?.isStash ? 'SharedStash' : selected?.location,
        SourceTab: selected?.tabIndex ?? 0,
        SourceX: selected?.invX,
        SourceY: selected?.invY,
        TargetX: cell?.x,
        TargetY: cell?.y,
        TargetFile: targetSave.file,
        TargetContainer: targetContainer === 'stash' ? 'SharedStash' : (targetContainer === 'personal_stash' ? 'Stash' : targetContainer),
        TargetTab: targetTab !== undefined ? targetTab : 0,
        ForceLive: true
      };


      if (window.state && window.state.isWasmMode && window.D2Wasm) {
        // In-memory WASM transfer
        const allItems = window.state.allWasmItems || window.state.items || [];
        const it = allItems.find(x => x.id === itemId);
        if (!it) throw new Error('Item not found in memory');
        const isTargetStash = targetContainer === 'stash';
        const stashSave = d2rState.stashData?.save;
        const result = await window.D2Wasm.transferItem(payload);
        if (!result.success) throw new Error(result.message);
        window.EditWorkspace.changed();
        window.recordEdit?.('item transfer');
        if (window.refreshWasmDataset) await window.refreshWasmDataset();
        await reloadArmoryData();
        return;
      }

      const res = await window.coreFetch('/api/item/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !(data.Success === true || data.success === true)) {
        throw new Error(data.Message || data.message || data.error || 'Transfer failed');
      }

      window.EditWorkspace.changed();
      await window.loadSavesAndItems();

      // Live reload armory data
      await reloadArmoryData();

    } catch (err) {
      if (window.showToast) {
        window.showToast('Transfer Error: ' + err.message, 'error');
      }
    } finally {
      window.EditWorkspace.busy = false;
    }
  };

  async function reloadArmoryData() {
    if (window.state && window.state.isWasmMode && window.D2Wasm) {
      const charData = d2rState.activeCharName
        ? window.D2Wasm.getCharacterDetail(d2rState.activeCharName, window.state.saves, window.state.allWasmItems || window.state.items)
        : null;
      const stashData = window.D2Wasm.getSharedStashDetail(window.state.saves, window.state.allWasmItems || window.state.items, d2rState.activeCharName);
      const dims = { inventory: { width: 11, height: 8 }, stash: { width: 16, height: 13 }, cube: { width: 6, height: 6 } };
      window.renderD2RInGameArmory(charData || d2rState.charData || { character: {}, equipped: {}, stats: {}, inventory: [], stash: [], cube: [] }, stashData, dims);
      return;
    }

    try {
      const promises = [
        window.coreFetch(`/api/shared-stash?character=${encodeURIComponent(d2rState.activeCharName || '')}`),
        window.coreFetch('/api/container-dimensions')
      ];
      if (d2rState.activeCharName) {
        promises.push(window.coreFetch(`/api/character/${encodeURIComponent(d2rState.activeCharName)}`));
      }
      const results = await Promise.all(promises);
      const stashRes = results[0];
      const dimsRes = results[1];
      const charRes = d2rState.activeCharName ? results[2] : null;

      const stashData = stashRes.ok ? await stashRes.json() : null;
      const dims = dimsRes.ok ? await dimsRes.json() : d2rState.containerDims;
      const charData = (charRes && charRes.ok) ? await charRes.json() : d2rState.charData;

      if (stashData) {
        window.renderD2RInGameArmory(charData || { character: {}, equipped: {}, stats: {}, inventory: [], stash: [], cube: [] }, stashData, dims);
      }
    } catch (err) {
      console.error('Failed to reload armory data:', err);
    }
  }
  window.reloadArmoryData = reloadArmoryData;

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



  window.toggleD2RMercModal = function() {
    window.switchRightPanelTab(d2rState.rightPanelView === 'mercenary' ? 'hero' : 'mercenary');
  };


  // -------------------------------------------------------------------------
  // In-Game Armory & Stash Real-Time Search & Sheen Dimming
  // -------------------------------------------------------------------------
  function itemMatchesSearch(it, query) {
    if (!query) return true;
    if (!it) return false;
    const q = query.trim().toLowerCase();
    if ((it.displayName || '').toLowerCase().includes(q)) return true;
    if ((it.name || '').toLowerCase().includes(q)) return true;
    if ((it.baseName || '').toLowerCase().includes(q)) return true;
    if ((it.type || '').toLowerCase().includes(q)) return true;
    if ((it.quality || '').toLowerCase().includes(q)) return true;
    if (Array.isArray(it.flags) && it.flags.some(f => String(f).toLowerCase().includes(q))) return true;
    if (Array.isArray(it.stats) && it.stats.some(s => (s.description || s.id || '').toLowerCase().includes(q))) return true;
    if (Array.isArray(it.runewordStats) && it.runewordStats.some(s => (s.description || s.id || '').toLowerCase().includes(q))) return true;
    if (Array.isArray(it.socketBonuses) && it.socketBonuses.some(s => String(s).toLowerCase().includes(q))) return true;
    if (Array.isArray(it.sockets) && it.sockets.some(s => (s.name || s.code || '').toLowerCase().includes(q))) return true;
    return false;
  }

  function applyD2RArmorySearch() {
    const query = (d2rState.searchQuery || '').trim().toLowerCase();
    const clearBtn = document.getElementById('d2r-armory-search-clear');
    const badge = document.getElementById('d2r-armory-search-matches');

    if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

    const itemEls = document.querySelectorAll('.d2r-item-element');
    const modSlots = document.querySelectorAll('.d2r-mod-slot.has-item');

    if (!query) {
      if (badge) badge.style.display = 'none';
      itemEls.forEach(el => {
        el.classList.remove('d2r-item-dimmed', 'd2r-item-matched');
      });
      modSlots.forEach(slot => {
        slot.classList.remove('d2r-item-dimmed', 'd2r-item-matched');
      });
      return;
    }

    let matchCount = 0;

    itemEls.forEach(el => {
      if (el.closest('.d2r-mod-slot')) return;
      const it = el._d2Item;
      if (itemMatchesSearch(it, query)) {
        el.classList.add('d2r-item-matched');
        el.classList.remove('d2r-item-dimmed');
        matchCount++;
      } else {
        el.classList.add('d2r-item-dimmed');
        el.classList.remove('d2r-item-matched');
      }
    });

    modSlots.forEach(slot => {
      let it = null;
      const json = slot.getAttribute('data-item');
      if (json) {
        try { it = JSON.parse(decodeURIComponent(json)); } catch (e) {}
      }
      const innerItemEl = slot.querySelector('.d2r-item-element');
      if (itemMatchesSearch(it, query)) {
        slot.classList.add('d2r-item-matched');
        slot.classList.remove('d2r-item-dimmed');
        if (innerItemEl) {
          innerItemEl.classList.add('d2r-item-matched');
          innerItemEl.classList.remove('d2r-item-dimmed');
        }
        matchCount++;
      } else {
        slot.classList.add('d2r-item-dimmed');
        slot.classList.remove('d2r-item-matched');
        if (innerItemEl) {
          innerItemEl.classList.add('d2r-item-dimmed');
          innerItemEl.classList.remove('d2r-item-matched');
        }
      }
    });

    if (badge) {
      badge.textContent = `${matchCount} found`;
      badge.style.display = 'inline-block';
    }

    updateTabSearchHighlights(query);
  }
  window.applyD2RArmorySearch = applyD2RArmorySearch;

  function updateTabSearchHighlights(query) {
    const allTabBtns = document.querySelectorAll('.d2r-main-tabs-row .d2r-tab-btn, .d2r-shared-subtabs-row .d2r-subtab-btn, .d2r-panel-nav-tab, .d2r-merc-toggle-btn');
    if (!query) {
      allTabBtns.forEach(btn => btn.classList.remove('d2r-tab-has-matches'));
      return;
    }

    // 1. Personal Stash
    const pStashItems = (d2rState.charData && d2rState.charData.stash) || [];
    const personalMatches = pStashItems.some(it => it && itemMatchesSearch(it, query));

    // 2. Shared Tabs 0..4
    const stashTabs = (d2rState.stashData && d2rState.stashData.tabs) || [];
    const sharedSubMatches = [0, 1, 2, 3, 4].map(idx => {
      const tab = stashTabs[idx];
      return !!(tab && (tab.items || []).some(it => it && itemMatchesSearch(it, query)));
    });
    const anySharedMatch = sharedSubMatches.some(Boolean);

    // 3. Crafting Tab (Cube items + tab 5 crafting items)
    const cubeItems = (d2rState.charData && d2rState.charData.cube) || [];
    const tab5Items = (stashTabs[5] && stashTabs[5].items) || [];
    const craftingMatches = cubeItems.some(it => it && itemMatchesSearch(it, query)) || tab5Items.some(it => it && it.isCrafting && itemMatchesSearch(it, query));

    // 4. Stackable Tab (tab 5)
    const stackMatches = tab5Items.some(it => it && itemMatchesSearch(it, query));

    // 5. Hero Gear / Inventory / Mercenary
    const rawEquipped = (d2rState.charData && d2rState.charData.equipped) || {};
    const equippedItems = Array.isArray(rawEquipped) ? rawEquipped : Object.values(rawEquipped);
    const gearMatches = equippedItems.some(it => it && itemMatchesSearch(it, query));
    const invItems = (d2rState.charData && (d2rState.charData.inventory || []).concat(d2rState.charData.belt || [])) || [];
    const invMatches = invItems.some(it => it && itemMatchesSearch(it, query));
    const heroMatches = gearMatches || invMatches;

    const rawMerc = (d2rState.charData && d2rState.charData.mercenary) || [];
    const mercItems = Array.isArray(rawMerc) ? rawMerc : Object.values(rawMerc);
    const mercMatches = mercItems.some(it => it && itemMatchesSearch(it, query));

    // Apply classes to Main Stash Tabs
    const mainTabBtns = document.querySelectorAll('.d2r-main-tabs-row .d2r-tab-btn');
    mainTabBtns.forEach(btn => {
      const text = btn.textContent.toLowerCase();
      if (text.includes('personal')) {
        btn.classList.toggle('d2r-tab-has-matches', personalMatches);
      } else if (text.includes('shared')) {
        btn.classList.toggle('d2r-tab-has-matches', anySharedMatch);
      } else if (text.includes('crafting')) {
        btn.classList.toggle('d2r-tab-has-matches', craftingMatches);
      } else if (text.includes('stackable')) {
        btn.classList.toggle('d2r-tab-has-matches', stackMatches);
      }
    });

    // Apply to Shared Sub-tab buttons
    const subTabBtns = document.querySelectorAll('.d2r-shared-subtabs-row .d2r-subtab-btn');
    subTabBtns.forEach((btn, idx) => {
      if (idx < sharedSubMatches.length) {
        btn.classList.toggle('d2r-tab-has-matches', sharedSubMatches[idx]);
      }
    });

    // Apply to Right Panel Nav Tabs (Hero Inventory vs Mercenary)
    const panelNavTabs = document.querySelectorAll('.d2r-panel-nav-tab');
    panelNavTabs.forEach(btn => {
      const text = btn.textContent.toLowerCase();
      if (text.includes('hero') || text.includes('inventory')) {
        btn.classList.toggle('d2r-tab-has-matches', heroMatches);
      } else if (text.includes('merc')) {
        btn.classList.toggle('d2r-tab-has-matches', mercMatches);
      }
    });

    // Apply to Merc toggle button
    const mercToggleBtn = document.querySelector('.d2r-merc-toggle-btn');
    if (mercToggleBtn) {
      const text = mercToggleBtn.textContent.toLowerCase();
      if (text.includes('hero')) {
        mercToggleBtn.classList.toggle('d2r-tab-has-matches', heroMatches);
      } else {
        mercToggleBtn.classList.toggle('d2r-tab-has-matches', mercMatches);
      }
    }
  }

  function initD2RArmorySearch() {
    const input = document.getElementById('d2r-armory-search');
    const clearBtn = document.getElementById('d2r-armory-search-clear');
    if (input && !input._hasD2RSearchListener) {
      input._hasD2RSearchListener = true;
      input.addEventListener('input', (e) => {
        d2rState.searchQuery = e.target.value;
        applyD2RArmorySearch();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          input.value = '';
          d2rState.searchQuery = '';
          applyD2RArmorySearch();
        }
      });
    }
    if (clearBtn && !clearBtn._hasD2RSearchListener) {
      clearBtn._hasD2RSearchListener = true;
      clearBtn.addEventListener('click', () => {
        if (input) input.value = '';
        d2rState.searchQuery = '';
        applyD2RArmorySearch();
        if (input) input.focus();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Responsive Scale & Zoom Management (100% Default with Cookie Persistence)
  // -------------------------------------------------------------------------
  const D2R_ZOOM_LEVELS = {
    '100': { zoom: '1.0', maxWidth: '1040px' },
    '120': { zoom: '1.20', maxWidth: '1260px' },
    '135': { zoom: '1.35', maxWidth: '1450px' },
    '150': { zoom: '1.50', maxWidth: '1650px' }
  };

  function getScalePreference() {
    // 1. Check cookie first
    const match = document.cookie.match(/(?:^|;\s*)d2r_armory_scale=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    // 2. Fall back to localStorage
    try {
      const stored = localStorage.getItem('d2r_armory_scale');
      if (stored) return stored;
    } catch (e) {}
    // 3. Default to 100% (user preference: 100% default)
    return '100';
  }

  function setScalePreference(scaleKey) {
    document.cookie = `d2r_armory_scale=${encodeURIComponent(scaleKey)}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem('d2r_armory_scale', scaleKey);
    } catch (e) {}
  }

  window.setD2RArmoryScale = function (scaleKey) {
    setScalePreference(scaleKey);
    applyD2RArmoryScale(scaleKey);
  };

  function applyD2RArmoryScale(scaleKey) {
    const armoryView = document.getElementById('armory-view');
    const pc = document.querySelector('.d2r-panels-container');
    const tb = document.querySelector('.d2r-armory-toolbar');
    const buttons = document.querySelectorAll('.d2r-zoom-btn');

    buttons.forEach(btn => {
      if (btn.getAttribute('data-scale') === scaleKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (!armoryView) return;

    if (scaleKey === 'auto' || !D2R_ZOOM_LEVELS[scaleKey]) {
      armoryView.style.removeProperty('--d2r-armory-max-width');
      if (pc) {
        pc.removeAttribute('data-scale-override');
        pc.style.zoom = '';
      }
      if (tb) {
        tb.style.maxWidth = '';
      }
    } else {
      const cfg = D2R_ZOOM_LEVELS[scaleKey];
      armoryView.style.setProperty('--d2r-armory-max-width', cfg.maxWidth);
      if (pc) {
        pc.setAttribute('data-scale-override', scaleKey);
        pc.style.zoom = cfg.zoom;
      }
      if (tb) {
        tb.style.maxWidth = cfg.maxWidth;
      }
    }
  }
  window.applyD2RArmoryScale = applyD2RArmoryScale;

  function initD2RArmoryScale() {
    const saved = getScalePreference();
    applyD2RArmoryScale(saved);
  }
  window.initD2RArmoryScale = initD2RArmoryScale;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initD2RArmoryScale);
  } else {
    initD2RArmoryScale();
  }

})();
