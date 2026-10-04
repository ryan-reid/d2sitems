/**
 * D2SItems WebAssembly Client Engine
 * Provides 100% client-side save parsing, perfection scoring, item transfers,
 * mule creation, and quest completion in the browser with zero backend server.
 */

/** Maps snake_case, camelCase, or PascalCase transfer keys onto the ItemTransferRequest DTO names. */
function normalizeTransferRequest(request) {
  const canonical = {
    sourcefile: 'SourceFile', sourcecontainer: 'SourceContainer', sourcetab: 'SourceTab', sourcex: 'SourceX', sourcey: 'SourceY',
    itemseed: 'ItemSeed', seed: 'ItemSeed', itemcode: 'ItemCode', code: 'ItemCode',
    targetfile: 'TargetFile', targetcontainer: 'TargetContainer', targettab: 'TargetTab', targetx: 'TargetX', targety: 'TargetY',
    forcelive: 'ForceLive', sourcerevision: 'SourceRevision', targetrevision: 'TargetRevision'
  };
  const normalized = {};
  for (const [key, value] of Object.entries(request || {})) {
    if (value === undefined) continue;
    normalized[canonical[key.replace(/_/g, '').toLowerCase()] || key] = value;
  }
  return normalized;
}

class D2WasmEngine {
  constructor() {
    this.ready = false;
    this.loading = false;
    this.loadedFiles = new Map(); // fileName -> Uint8Array
    this.dbName = 'D2SItems_Wasm_Storage';
    this.dbVersion = 2;
    this.sessionId = localStorage.getItem('bkdiablo-session') || crypto.randomUUID();
    localStorage.setItem('bkdiablo-session', this.sessionId);
    this.db = null;
    this._initPromise = null;
    this.spriteMappings = null;
  }

  /**
   * Initializes IndexedDB for offline persistent save storage.
   */
  async initDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sessionSaves')) db.createObjectStore('sessionSaves', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { autoIncrement: true });
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'name' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => {
        console.warn('[D2WasmEngine] IndexedDB open error:', e);
        resolve(null);
      };
    });
  }

  async commitFiles(changes) {
    if (this.editOriginals) {
      for (const [name, bytes] of changes) this.loadedFiles.set(name, bytes);
      return;
    }
    const db = await this.initDB();
    if (!db) throw new Error('Browser storage is unavailable; no edit was committed.');
    const session = this.sessionId;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessionSaves', 'history'], 'readwrite');
      const store = tx.objectStore('sessionSaves');
      let failure;
      tx.oncomplete = resolve;
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('Save transaction aborted'));
      for (const [name, bytes] of changes) {
        const id = session + ':' + name;
        const expected = this.loadedFiles.get(name);
        const request = store.get(id);
        request.onsuccess = () => {
          const old = request.result;
          if (old && (!expected || old.bytes.length !== expected.length || old.bytes.some((v, i) => v !== expected[i]))) {
            failure = new Error('Save changed in another browser tab. Reload before editing.');
            tx.abort();
            return;
          }
          if (old) tx.objectStore('history').add({ ...old, timestamp: Date.now() });
          store.put({ id, session, name, bytes, original: old?.original || bytes, timestamp: Date.now() });
        };
      }
    });
    for (const [name, bytes] of changes) this.loadedFiles.set(name, bytes);
  }

  async saveFileToDB(name, bytes) { await this.commitFiles([[name, bytes]]); }

  async loadAllFilesFromDB() {
    const db = await this.initDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessionSaves', 'readonly');
      const req = tx.objectStore('sessionSaves').getAll();
      tx.oncomplete = () => resolve((req.result || []).filter(row => row.session === this.sessionId));
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearDB() {
    // Start a fresh session; old imports and their original revisions remain recoverable.
    this.sessionId = crypto.randomUUID();
    localStorage.setItem('bkdiablo-session', this.sessionId);
    this.loadedFiles.clear();
  }

  /**
   * Initializes Blazor WebAssembly runtime and C# D2EngineInterop via native [JSExport].
   */
  async init() {
    if (this.ready) return true;
    if (this.loading) return this._initPromise;

    this.loading = true;
    this._initPromise = (async () => {
      console.log('[D2WasmEngine] Initializing WebAssembly runtime...');

      const { dotnet } = await import('./_framework/dotnet.js');
      const runtime = await dotnet.create();
      await runtime.runMain();

      const exports = await runtime.getAssemblyExports('D2SWasm');
      this.interop = exports.D2SWasm.D2EngineInterop;

      let catalogRev = null;
      try {
          const res = await fetch("catalog_meta.json");
          if (res.ok) {
              const meta = await res.json();
              catalogRev = meta.catalogRevision;
          }
      } catch (e) {
          console.warn("Could not fetch catalog_meta.json:", e);
      }
      const initJson = this.interop.InitEngine(catalogRev);
      const initResult = typeof initJson === 'string' ? JSON.parse(initJson) : initJson;
      this.collectionCatalog = initResult.catalog;
      console.log('[D2WasmEngine] C# Engine initialized:', initResult);

      // Load sprite mappings if not cached
      if (!this.spriteMappings) {
        try {
          const res = await fetch('item_images.json');
          if (res.ok) {
            this.spriteMappings = await res.json();
          }
        } catch (e) {
          console.warn('[D2WasmEngine] Could not load item_images.json:', e);
          this.spriteMappings = { codes: {}, uniques: {}, sets: {}, classic_codes: {}, classic_uniques: {}, classic_sets: {} };
        }
      }

      // Load unique catalog if not cached
      if (!this.uniqueItemsCatalog) {
        try {
          const res = await fetch('unique_items_catalog.json');
          if (res.ok) {
            const list = await res.json();
            const map = new Map();
            list.forEach(item => {
              if (item.name) map.set(item.name.toLowerCase(), item);
            });
            this.uniqueItemsCatalog = map;
          }
        } catch (e) {
          console.warn('[D2WasmEngine] Could not load unique_items_catalog.json:', e);
        }
      }

      this.ready = true;
      this.loading = false;
      return true;
    })();

    return this._initPromise;
  }

  /**
   * Reads raw bytes from a File or Blob.
   */
  static readFileAsBytes(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Registers and parses a file in memory.
   */
  async ingestFile(fileName, bytes) {
    await this.init();
    await this.saveFileToDB(fileName, bytes);

    const isStash = fileName.toLowerCase().endsWith('.d2i') || fileName.toLowerCase().includes('stash');
    try {
      if (isStash) {
        const json = this.interop.ParseSharedStash(fileName, bytes);
        return { isStash: true, fileName, data: JSON.parse(json) };
      } else {
        const json = this.interop.ParseCharacterSave(fileName, bytes);
        return { isStash: false, fileName, data: JSON.parse(json) };
      }
    } catch (err) {
      console.error(`[D2WasmEngine] Error parsing ${fileName}:`, err);
      return { error: err.message, fileName };
    }
  }

  /**
   * Ingest multiple files (e.g. from Drag & Drop or Directory picker).
   */
  async ingestFiles(fileList) {
    await this.clearDB();
    const results = [];
    const filteredList = [];
    const seen = new Set();

    for (const item of fileList) {
      const name = item.name || item.fileName;
      if (!name) continue;
      const lower = name.toLowerCase();
      if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i') && !lower.endsWith('.ctl')) continue;
      if (/^\d{8}[-_]\d{6}/i.test(name) || /\.(bak|old|backup|tmp)$/i.test(name)) continue;
      if (item.webkitRelativePath) {
        const segs = item.webkitRelativePath.replace(/\\/g, '/').split('/').filter(Boolean);
        if (segs.some(s => /^(backups?|archive|old|crashdumps?|temp|tmp|\.git|\.vs)$/i.test(s))) continue;
        if (segs.length > 2) continue;
      }
      if (seen.has(lower)) continue;
      seen.add(lower);
      filteredList.push(item);
    }

    for (const item of filteredList) {
      const name = item.name || item.fileName;
      const lower = name.toLowerCase();
      let bytes = item.bytes;
      if (!bytes && item.file) {
        bytes = await D2WasmEngine.readFileAsBytes(item.file);
      }
      if (bytes) {
        if (lower.endsWith('.ctl')) {
          await this.saveFileToDB(name, bytes);
          continue;
        }
        const res = await this.ingestFile(name, bytes);
        results.push(res);
      }
    }
    return results;
  }

  /**
   * Resolves authentic jewel sprites (Rainbow Facets, Colossal Jewels, Defender's Jewels).
   */
  resolveJewelSprite() { return null; }

  /**
   * Compiles all loaded saves and items into standard frontend data structures.
   */
  async buildDataset() {
    await this.init();
    const saves = [];
    const items = [];
    let itemIdCounter = 1;

    const codeMap = this.spriteMappings?.codes || {};
    const uniqueMap = this.spriteMappings?.uniques || {};
    const setMap = this.spriteMappings?.sets || {};
    const classicCodeMap = this.spriteMappings?.classic_codes || codeMap;
    const classicUniqueMap = this.spriteMappings?.classic_uniques || uniqueMap;
    const classicSetMap = this.spriteMappings?.classic_sets || setMap;

    for (const [fileName, bytes] of this.loadedFiles.entries()) {
      const lower = fileName.toLowerCase();
      if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i')) continue;

      const isStash = lower.endsWith('.d2i');
      try {
        let rawData;
        if (isStash) {
          const json = this.interop.ParseSharedStash(fileName, bytes);
          rawData = JSON.parse(json);
        } else {
          const json = this.interop.ParseCharacterSave(fileName, bytes);
          rawData = JSON.parse(json);
        }

        const itemsInFile = rawData.items || [];
        const saveEntry = {
          file: fileName,
          saveRevision: rawData.saveRevision,
          profile: 'WASM Local',
          is_stash: isStash,
          item_count: itemsInFile.length
        };

        if (isStash) {
          saveEntry.name = 'Shared Stash';
          saveEntry.core = rawData.core || 'soft';
          saveEntry.gameVersion = rawData.gameVersion || '';
          saveEntry.tabs = rawData.tabs || [];
          saveEntry.total_gold = (rawData.tabs || []).reduce((acc, t) => acc + (t.gold || 0), 0);
          saveEntry.chronicle = rawData.chronicle || null;
        } else {
          const c = rawData.character || {};
          saveEntry.name = c.name || fileName.replace(/\.[^/.]+$/, '');
          saveEntry.level = c.level || 1;
          saveEntry.class = c.class || 'Unknown';
          saveEntry.core = c.core || 'soft';
          saveEntry.gameVersion = c.gameVersion || '';
          saveEntry.stats = rawData.stats || {};
        }

        saves.push(saveEntry);

        // Normalize items
        const sourceName = saveEntry.name;
        for (const it of itemsInFile) {
          const itNorm = Object.assign({}, it);
          itNorm.id = itemIdCounter++;
          itNorm.profile = 'WASM Local';
          itNorm.sourceName = sourceName;
          itNorm.sourceFile = fileName;
          itNorm.sourceCore = saveEntry.core;
          itNorm.saveRevision = rawData.saveRevision;
          itNorm.catalogRevision = rawData.catalogRevision;
          itNorm.isStash = isStash;

          const flags = itNorm.flags || [];
          itNorm.isEthereal = flags.some(f => String(f).toLowerCase().includes('ethereal'));
          itNorm.isUnidentified = flags.some(f => String(f).toLowerCase().includes('unidentified'));
          itNorm.isRuneword = flags.some(f => String(f).toLowerCase().includes('runeword'));
          itNorm.isCorrupted = Boolean(itNorm.isCorrupted) || flags.some(f => String(f).toLowerCase().includes('corrupt'));

          const rawName = itNorm.name || itNorm.baseName || 'Unknown Item';
          itNorm.displayName = rawName;

          const art = window.BKItemArt.resolve(itNorm, this.spriteMappings);
          itNorm.invFile = art.file;
          itNorm.invFileClassic = window.BKItemArt.resolve(itNorm, this.spriteMappings, true).file;
          itNorm.artworkSource = art.source;
          itNorm.artworkFallback = art.fallback || false;

          // Perfection calculation
          let perf = itNorm.perfectionScore != null ? itNorm.perfectionScore : itNorm.perfection;
          if (perf != null) {
            if (typeof perf === 'string' && perf.endsWith('%')) {
              itNorm.perfectionNum = parseFloat(perf.slice(0, -1));
            } else {
              itNorm.perfectionNum = parseFloat(perf);
            }
            itNorm.perfection = itNorm.perfectionNum;
            itNorm.perfectionScore = itNorm.perfectionNum;
          } else {
            itNorm.perfectionNum = null;
          }

          if (itNorm.perfectionNum != null && itNorm.perfectionNum >= 100.0) {
            if (!itNorm.flags) itNorm.flags = [];
            if (!itNorm.flags.includes('Perfect')) itNorm.flags.push('Perfect');
          }

          itNorm.isOutOfDate = Boolean(it.isOutOfDate);
          itNorm.outOfDateIssues = it.outOfDateIssues || [];

          items.push(itNorm);
        }
      } catch (err) {
        console.warn(`[D2WasmEngine] Parse failed for ${fileName}:`, err);
      }
    }

    this.allSaves = saves;
    return { saves, items };
  }

  /**
   * Helper: Character Detail (paperdoll & inventory)
   */
  getCharacterDetail(charName, saves, items) {
    const targetChar = saves.find(s => !s.is_stash && s.name.toLowerCase() === charName.toLowerCase());
    if (!targetChar) return null;

    const charItems = items.filter(it => it.sourceName.toLowerCase() === charName.toLowerCase() && (!targetChar.file || it.sourceFile === targetChar.file));
    const equipped = {
      Head: null, Neck: null, Torso: null,
      RightHand: null, LeftHand: null, Gloves: null,
      RightRing: null, LeftRing: null, Belt: null, Boots: null,
      AlternateRightHand: null, AlternateLeftHand: null
    };

    const inventory = [];
    const stash = [];
    const cube = [];
    const belt = [];
    const mercenary = [];
    const other = [];

    for (const it of charItems) {
      const loc = it.location || '';
      const isMerc = it.isMercenary || loc.includes('Merc') || loc.includes('Hireling');
      if (isMerc) {
        mercenary.push(it);
        continue;
      }

      // Belt potions (Mode=InBelt) go to potion belt, never equipped slot
      if (it.mode === 'InBelt' || loc === 'InBelt') {
        belt.push(it);
        continue;
      }

      let mappedLoc = loc;
      if (loc === 'RightArm') mappedLoc = 'RightHand';
      else if (loc === 'LeftArm') mappedLoc = 'LeftHand';
      else if (loc === 'Feet') mappedLoc = 'Boots';

      if (mappedLoc in equipped) {
        if (!equipped[mappedLoc] || !it.isCorpse) {
          equipped[mappedLoc] = it;
        }
      } else if (loc === 'Inventory') {
        inventory.push(it);
      } else if (loc === 'Stash') {
        stash.push(it);
      } else if (loc === 'Cube') {
        cube.push(it);
      } else if (loc === 'Belt') {
        belt.push(it);
      } else {
        other.push(it);
      }
    }

    const hasCorpse = Boolean(targetChar.hasCorpse || charItems.some(it => it.isCorpse));
    targetChar.hasCorpse = hasCorpse;

    return {
      character: targetChar,
      equipped,
      inventory,
      stash,
      cube,
      belt,
      mercenary,
      other,
      hasCorpse,
      total_items: charItems.length
    };
  }

  /**
   * Helper: Shared Stash Detail (all tabs)
   */
  getSharedStashDetail(saves, items, characterName = null) {
    const character = saves.find(save => !save.is_stash && save.name === characterName);
    const candidates = saves.filter(save => save.is_stash && (!characterName || (character && save.core === character.core && save.gameVersion === character.gameVersion)));
    const stashSave = candidates.length === 1 ? candidates[0] : null;
    if (!stashSave) return null;

    const stashItems = items.filter(it => it.isStash && (!stashSave.file || it.sourceFile === stashSave.file));
    const tabs = (stashSave.tabs || []).map((t, idx) => ({
      index: idx,
      name: t.name || (idx === 5 ? 'Stackable' : `Shared ${idx + 1}`),
      gold: t.gold || 0,
      items: stashItems.filter(it => it.tabIndex === idx)
    }));

    return {
      save: stashSave,
      stash: stashSave,
      tabs,
      total_items: stashItems.length
    };
  }

  /**
   * Helper: Holy Grail Tracker
   */
  getGrailProgress(items) {
    const normalize = name => (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    const categories = (this.collectionCatalog?.categories || []).map(category => {
      const entries = category.names.map(name => {
        const holders = items.filter(item => normalize(item.displayName || item.name) === normalize(name))
          .map(item => ({ source: item.sourceName || item.sourceFile }));
        return { name, collected: holders.length > 0, holders };
      });
      const owned = entries.filter(item => item.collected).length;
      return { category: category.category, owned, total: entries.length,
        percent: entries.length ? Math.round(owned / entries.length * 1000) / 10 : 0, items: entries };
    });
    const total_items = categories.reduce((sum, category) => sum + category.total, 0);
    const total_owned = categories.reduce((sum, category) => sum + category.owned, 0);
    return { categories, total_items, total_owned,
      percent: total_items ? total_owned / total_items * 100 : 0, catalogRevision: this.collectionCatalog?.revision };
  }

  /**
   * Helper: In-Game Chronicle Tracker (WASM offline support)
   */
  getChronicleProgress(saves, core = 'both') {
    const trackedUniques = new Map();
    const trackedSets = new Map();
    const trackedRunewords = new Map();

    const addTracked = (map, name, entry) => {
      if (!name) return;
      const key = name.trim().toLowerCase();
      map.set(key, entry);
      const aliases = {
        'game modifiers': ['game modifers', 'charm modifiers'],
        'game modifers': ['game modifiers', 'charm modifiers'],
        'charm modifiers': ['game modifiers', 'game modifers'],
        'blank charm': ['charm blank'],
        'charm blank': ['blank charm'],
        'level 90 reward': ['charm level reward'],
        'charm level reward': ['level 90 reward']
      };
      if (aliases[key]) {
        for (const alias of aliases[key]) {
          map.set(alias, entry);
        }
      }
    };

    (saves || []).forEach(save => {
      if (!save.is_stash) return;
      const sCore = save.core || 'soft';
      if (core !== 'both' && sCore !== core) return;
      const chronicle = save.chronicle;
      if (!chronicle) return;
      (chronicle.uniques || []).forEach(u => addTracked(trackedUniques, u.name, { id: u.id, name: u.name, source: u.source, timestamp: u.timestamp, core: sCore }));
      (chronicle.sets || []).forEach(s => addTracked(trackedSets, s.name, { id: s.id, name: s.name, source: s.source, timestamp: s.timestamp, core: sCore }));
      (chronicle.runewords || []).forEach(r => addTracked(trackedRunewords, r.name, { id: r.id, name: r.name, source: r.source, timestamp: r.timestamp, core: sCore }));
    });

    const QUEST_NAMES = new Set(['amulet of the viper', 'staff of kings', 'horadric staff', 'hell forge hammer', 'khalimflail', 'superkhalimflail']);
    const normalize = name => (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    const spriteMap = this.spriteMappings || window.itemImageMappings || {};

    const categories = (this.collectionCatalog?.categories || []).map(category => {
      const isSet = category.category.includes('Set');
      const isRw = category.category.includes('Runeword');
      const trackedMap = isRw ? trackedRunewords : (isSet ? trackedSets : trackedUniques);
      const entries = category.names.filter(name => !QUEST_NAMES.has(normalize(name))).map(name => {
        const norm = normalize(name);
        const tInfo = trackedMap.get(norm);
        const isTracked = !!tInfo;
        const uCat = this.uniqueItemsCatalog?.get(norm);
        const invFile = isSet
          ? (spriteMap.sets?.[norm] || null)
          : (isRw
              ? (spriteMap.uniques?.[norm] || spriteMap.hd_codes?.['r01'] || null)
              : (spriteMap.uniques?.[norm] || (uCat && uCat.invFile) || null));
        return {
          name,
          base: uCat?.baseName || '',
          code: uCat?.code || '',
          lvlReq: uCat?.lvlReq || 0,
          stats: uCat?.stats || [],
          runes: [],
          collected: isTracked,
          tracked: isTracked,
          invFile,
          source: tInfo ? tInfo.source : null,
          timestamp: tInfo ? tInfo.timestamp : null,
          core: tInfo ? tInfo.core : null,
          isManual: false
        };
      });
      const owned = entries.filter(item => item.collected).length;
      return {
        category: category.category,
        owned,
        total: entries.length,
        percent: entries.length ? Math.round(owned / entries.length * 1000) / 10 : 0,
        items: entries
      };
    });
    const total_items = categories.reduce((sum, category) => sum + category.total, 0);
    const total_owned = categories.reduce((sum, category) => sum + category.owned, 0);
    return {
      core,
      categories,
      total_items,
      total_owned,
      percent: total_items ? Math.round(total_owned / total_items * 10000) / 100 : 0,
      catalogRevision: this.collectionCatalog?.revision
    };
  }

  /**
   * Create a new character mule directly in browser memory.
   */
  async createMule(name, charClass, hardcore) {
    await this.init();
    const res = this.interop.CreateMule(name, charClass, Boolean(hardcore));
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    if (!parsed.success) return parsed;

    const d2sBytes = Uint8Array.from(atob(parsed.d2sBase64), c => c.charCodeAt(0));
    const d2sName = `${name}.d2s`;
    if ([...this.loadedFiles.keys()].some(file => file.toLowerCase() === d2sName.toLowerCase())) return {success:false,message:'A character with this filename already exists.'};
    const changes = [[d2sName, d2sBytes]];

    if (parsed.ctlBase64) {
      const ctlBytes = Uint8Array.from(atob(parsed.ctlBase64), c => c.charCodeAt(0));
      const ctlName = `${name}.ctl`;
      if (this.loadedFiles.has(ctlName)) return {success:false,message:"A companion file with this name already exists."};
      changes.push([ctlName, ctlBytes]);
    }

    await this.commitFiles(changes);

    // Auto-trigger browser download for user convenience
    this.downloadFile(d2sName, d2sBytes);

    return {
      success: true,
      message: `Created mule '${name}' (${charClass})! File downloaded.`,
      fileName: d2sName
    };
  }

  /**
   * Complete quests and unlock waypoints for a character in browser memory.
   */
  async completeQuests(charName, difficulty, act, waypoints, rewards) {
    await this.init();
    const fileName = charName.endsWith('.d2s') ? charName : `${charName}.d2s`;
    const bytes = this.loadedFiles.get(fileName);
    if (!bytes) {
      return { success: false, error: `Character save file '${fileName}' not loaded.` };
    }

    const actNum = act != null ? parseInt(act, 10) : -1;
    const res = this.interop.CompleteQuests(
      bytes,
      difficulty || 'all',
      actNum,
      waypoints !== false,
      rewards !== false
    );

    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    if (parsed.success && parsed.d2sBase64) {
      const updatedBytes = Uint8Array.from(atob(parsed.d2sBase64), c => c.charCodeAt(0));
      await this.saveFileToDB(fileName, updatedBytes);

      // Trigger download of the modified character
      this.downloadFile(fileName, updatedBytes);
    }

    return parsed;
  }

  /**
   * Atomic item transfer between containers and files in browser memory.
   */
  async transferItem(rawRequest) {
    await this.init();
    const request = normalizeTransferRequest(rawRequest);
    const srcFile = request.SourceFile;
    const tgtFile = request.TargetFile || srcFile;

    const srcBytes = this.loadedFiles.get(srcFile);
    if (!srcBytes) return { success: false, message: `Source file '${srcFile}' not found in browser memory.` };

    const isSameFile = srcFile.toLowerCase() === tgtFile.toLowerCase();
    const tgtBytes = isSameFile ? null : this.loadedFiles.get(tgtFile);
    if (!isSameFile && !tgtBytes) {
      return { success: false, message: `Target file '${tgtFile}' not found in browser memory.` };
    }

    const res = this.interop.TransferItem(JSON.stringify(request), srcBytes, tgtBytes || new Uint8Array(0));
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;

    if (parsed.success) {
      const changes = [];
      if (parsed.sourceBytesBase64) changes.push([srcFile, Uint8Array.from(atob(parsed.sourceBytesBase64), c => c.charCodeAt(0))]);
      if (parsed.targetBytesBase64 && srcFile !== tgtFile) changes.push([tgtFile, Uint8Array.from(atob(parsed.targetBytesBase64), c => c.charCodeAt(0))]);
      await this.commitFiles(changes);
      for (const [name, bytes] of changes) this.downloadFile(name, bytes);
    }

    return parsed;
  }

  /**
   * Bulk item transfer from shared stash to mule character.
   */
  async bulkTransfer(request) {
    await this.init();
    const srcFile = request.source_stash_file;
    const tgtFile = request.target_char_file;

    const srcBytes = this.loadedFiles.get(srcFile);
    if (!srcBytes) return { success: false, message: `Stash '${srcFile}' not loaded.` };

    const tgtBytes = this.loadedFiles.get(tgtFile);
    if (!tgtBytes) return { success: false, message: `Mule '${tgtFile}' not loaded.` };

    const reqDto = {
      SourceStashFile: srcFile,
      SourceRevision: request.source_revision,
      TargetRevision: request.target_revision,
      SourceTab: parseInt(request.source_tab || 0, 10),
      TargetCharFile: tgtFile,
      TargetContainers: request.target_containers || ['Inventory', 'Cube', 'Stash'],
      ItemFilter: request.item_filter || 'all',
      ItemSeeds: request.item_seeds || null,
      MaxItems: parseInt(request.max_items || 100, 10),
      ForceLive: Boolean(request.force_live)
    };

    const res = this.interop.BulkTransfer(JSON.stringify(reqDto), srcBytes, tgtBytes || new Uint8Array(0));
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;

    if (parsed.success) {
      const changes = [];
      if (parsed.sourceBytesBase64) changes.push([srcFile, Uint8Array.from(atob(parsed.sourceBytesBase64), c => c.charCodeAt(0))]);
      if (parsed.targetBytesBase64 && srcFile !== tgtFile) changes.push([tgtFile, Uint8Array.from(atob(parsed.targetBytesBase64), c => c.charCodeAt(0))]);
      await this.commitFiles(changes);
      for (const [name, bytes] of changes) this.downloadFile(name, bytes);
    }

    return parsed;
  }

  /**
   * Edit stack quantity of an item in a shared stash tab (e.g. Advanced Stash tab 5).
   */
  async editStackQuantity(tabIndex, itemCode, quantity, stashFileName, itemSeed) {
    await this.init();
    const stashBytes = this.loadedFiles.get(stashFileName);
    if (!stashBytes || !stashFileName) {
      return { success: false, message: 'No shared stash (.d2i) loaded in WebAssembly session.' };
    }

    const res = this.interop.EditStack(stashBytes, tabIndex, itemCode, quantity, String(itemSeed));
    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    if (parsed.success && parsed.stashBytesBase64) {
      const newStash = Uint8Array.from(atob(parsed.stashBytesBase64), c => c.charCodeAt(0));
      await this.saveFileToDB(stashFileName, newStash);
      this.downloadFile(stashFileName, newStash);
      // The caller rebuilds the dataset after the durable edit.

    }
    return parsed;
  }

  /**
   * Helper: Triggers a browser file download.
   */
  /**
   * Create a net-new item directly in browser WASM memory.
   */
  async createItem(fileName, request) {
    await this.init();
    const bytes = this.loadedFiles.get(fileName);
    if (!bytes) {
      return { success: false, error: `Save file '${fileName}' not loaded.` };
    }

    const isStash = fileName.toLowerCase().endsWith('.d2i');
    const tabIndex = request.tabIndex || 0;
    const res = this.interop.CreateItem(
      JSON.stringify(request),
      bytes,
      isStash,
      tabIndex
    );

    const parsed = typeof res === 'string' ? JSON.parse(res) : res;
    if (parsed.success && parsed.bytesBase64) {
      const updatedBytes = Uint8Array.from(atob(parsed.bytesBase64), c => c.charCodeAt(0));
      if (this.editOriginals) {
        this.loadedFiles.set(fileName, updatedBytes);
      } else {
        await this.saveFileToDB(fileName, updatedBytes);
        this.downloadFile(fileName, updatedBytes);
      }
    }

    return parsed;
  }

  downloadFile(fileName, bytes) {
    if (this.editOriginals) return;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /**
   * Downloads all currently loaded save files.
   */
  async downloadOriginals() {
    const originals = await this.loadAllFilesFromDB();
    for (const row of originals) this.downloadFile('original-' + row.name, row.original);
  }

  downloadAllSaves() {
    for (const [name, bytes] of this.loadedFiles.entries()) {
      if (name.endsWith('.d2s') || name.endsWith('.d2i') || name.endsWith('.ctl')) {
        this.downloadFile(name, bytes);
      }
    }
  }
}

// Global singleton instance
window.D2Wasm = new D2WasmEngine();
