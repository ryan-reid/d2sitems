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
    this.initialFileBytes = new Map(); // fileName -> Uint8Array (unmodified baseline)
    this.dbName = 'D2SItems_Wasm_Storage';
    this.dbVersion = 3;
    this.sessionId = localStorage.getItem('bkdiablo-session') || crypto.randomUUID();
    localStorage.setItem('bkdiablo-session', this.sessionId);
    this.db = null;
    this.dirHandle = null;
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
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata');
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

  /**
   * Saves FileSystemDirectoryHandle to IndexedDB for persistent reload across browser sessions.
   */
  async saveDirectoryHandle(dirHandle) {
    this.dirHandle = dirHandle;
    if (!dirHandle) return;
    const db = await this.initDB();
    if (!db || !db.objectStoreNames.contains('handles')) return;
    try {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(dirHandle, 'saveDirectory');
      if (dirHandle.name) {
        localStorage.setItem('bkdiablo-folder-name', dirHandle.name);
      }
    } catch (e) {
      console.warn('[D2WasmEngine] Could not persist directory handle in IndexedDB:', e);
    }
  }

  /**
   * Retrieves stored FileSystemDirectoryHandle from IndexedDB if available.
   */
  async getDirectoryHandle() {
    if (this.dirHandle) return this.dirHandle;
    const db = await this.initDB();
    if (!db || !db.objectStoreNames.contains('handles')) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('saveDirectory');
        req.onsuccess = () => {
          this.dirHandle = req.result || null;
          resolve(this.dirHandle);
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Removes saved directory handle from memory and IndexedDB.
   */
  async clearDirectoryHandle() {
    this.dirHandle = null;
    localStorage.removeItem('bkdiablo-folder-name');
    const db = await this.initDB();
    if (!db || !db.objectStoreNames.contains('handles')) return;
    try {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('saveDirectory');
    } catch (e) {
      console.warn('[D2WasmEngine] Error deleting directory handle:', e);
    }
  }

  /**
   * Reads raw file objects from a FileSystemDirectoryHandle, recursively traversing
   * subdirectories (e.g. Saved Games/Diablo II Resurrected/Mods/BKDiablo).
   * Scopes to BKDiablo mod saves when present to prevent duplicate characters or backup pollution.
   */
  async readDirectoryFiles(dirHandle) {
    if (!dirHandle) return [];
    const collected = [];

    const isIgnoredFolder = (name) => {
      return /^(backups?|archive|old|crashdumps?|temp|tmp|\.git|\.vs|\.death-tracker|\.kill-tracker|\.time-played|d2rloader backups|reimaginedlauncherbackups|reimagined backups|bkbackup|bt-backup)$/i.test(name);
    };

    const isBackupFile = (name) => {
      return /^\d{8}[-_]\d{6}/i.test(name) || /\.(bak|old|backup|tmp)$/i.test(name);
    };

    const scanDir = async (handle, pathSegments = []) => {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'directory') {
          if (!isIgnoredFolder(name) && pathSegments.length < 5) {
            await scanDir(entry, [...pathSegments, name]);
          }
        } else if (entry.kind === 'file') {
          const lower = name.toLowerCase();
          if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i') && !lower.endsWith('.ctl')) {
            continue;
          }
          if (isBackupFile(name)) {
            continue;
          }
          try {
            const file = await entry.getFile();
            const bytes = new Uint8Array(await file.arrayBuffer());
            const relPath = [...pathSegments, name].join('/');
            collected.push({ name, bytes, file, relPath });
          } catch (e) {
            console.warn(`[D2WasmEngine] Could not read file ${name} from handle:`, e);
          }
        }
      }
    };

    await scanDir(dirHandle, [dirHandle.name || '']);

    const hasBK = collected.some(c => /bkdiablo/i.test(c.relPath));
    const candidateFiles = hasBK ? collected.filter(c => /bkdiablo/i.test(c.relPath)) : collected;

    const fileMap = new Map();
    for (const item of candidateFiles) {
      const lower = item.name.toLowerCase();
      if (!fileMap.has(lower)) {
        fileMap.set(lower, item);
      }
    }

    return Array.from(fileMap.values());
  }

  /**
   * Re-reads fresh save files directly from disk via stored FileSystemDirectoryHandle.
   */
  async reloadFromDirectoryHandle() {
    const dirHandle = await this.getDirectoryHandle();
    if (!dirHandle) return { success: false, reason: 'no_handle' };

    let perm = 'denied';
    try {
      perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        perm = await dirHandle.requestPermission({ mode: 'read' });
      }
    } catch (e) {
      console.warn('[D2WasmEngine] Permission request error:', e);
    }

    if (perm !== 'granted') {
      return { success: false, reason: 'permission_denied' };
    }

    const files = await this.readDirectoryFiles(dirHandle);
    if (!files || files.length === 0) {
      return { success: false, reason: 'no_files' };
    }

    await this.ingestFiles(files);
    this.recordImportMeta(dirHandle.name, files.length);
    return { success: true, count: files.length, folderName: dirHandle.name };
  }

  /**
   * Records metadata about the imported folder and timestamp.
   */
  recordImportMeta(folderName, fileCount) {
    const timestamp = Date.now();
    localStorage.setItem('bkdiablo-import-time', timestamp.toString());
    if (folderName) {
      localStorage.setItem('bkdiablo-folder-name', folderName);
    }
    localStorage.setItem('bkdiablo-file-count', (fileCount || 0).toString());
    this.importTimestamp = timestamp;
  }

  /**
   * Retrieves metadata regarding cache age and folder source.
   */
  getImportMeta() {
    const timeStr = localStorage.getItem('bkdiablo-import-time');
    const folderName = localStorage.getItem('bkdiablo-folder-name') || '';
    const fileCount = parseInt(localStorage.getItem('bkdiablo-file-count') || '0', 10);
    const timestamp = timeStr ? parseInt(timeStr, 10) : null;
    return { timestamp, folderName, fileCount };
  }

  /**
   * Invalidates browser save cache, clearing IndexedDB and in-memory files.
   */
  async invalidateCache(options = {}) {
    const keepHandle = options.keepHandle === true;
    const db = await this.initDB();
    if (db) {
      try {
        const tx = db.transaction(['sessionSaves', 'history'], 'readwrite');
        tx.objectStore('sessionSaves').clear();
        tx.objectStore('history').clear();
      } catch (e) {
        console.warn('[D2WasmEngine] Error clearing IndexedDB session saves:', e);
      }
    }

    if (!keepHandle) {
      await this.clearDirectoryHandle();
    }

    this.sessionId = crypto.randomUUID();
    localStorage.setItem('bkdiablo-session', this.sessionId);
    localStorage.removeItem('bkdiablo-import-time');
    localStorage.removeItem('bkdiablo-file-count');
    if (!keepHandle) {
      localStorage.removeItem('bkdiablo-folder-name');
    }

    this.loadedFiles.clear();
    this.initialFileBytes.clear();
    this.allSaves = [];
    if (window.state) {
      window.state.saves = [];
      window.state.items = [];
      window.state.allWasmItems = [];
      window.state.selectedChar = null;
    }
    if (window.EditWorkspace) {
      window.EditWorkspace.changes = 0;
      window.EditWorkspace.active = false;
      window.EditWorkspace.originals = null;
    }
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
          store.put({
            id,
            session,
            name,
            bytes,
            original: old?.original || bytes,
            exportedBytes: old ? old.exportedBytes : bytes,
            timestamp: Date.now()
          });
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
      tx.oncomplete = () => {
        const rows = (req.result || []).filter(row => row.session === this.sessionId);
        for (const row of rows) {
          const baseline = row.exportedBytes || row.original;
          if (baseline && !this.initialFileBytes.has(row.name)) {
            this.initialFileBytes.set(row.name, baseline);
          }
        }
        resolve(rows);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearDB() {
    const db = await this.initDB();
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['sessionSaves', 'history'], 'readwrite');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
          tx.objectStore('sessionSaves').clear();
          tx.objectStore('history').clear();
        });
      } catch (e) {
        console.warn('[D2WasmEngine] Error clearing IndexedDB session saves:', e);
      }
    }
    this.sessionId = crypto.randomUUID();
    localStorage.setItem('bkdiablo-session', this.sessionId);
    this.loadedFiles.clear();
    this.initialFileBytes.clear();
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
    if (!this.initialFileBytes.has(fileName)) {
      this.initialFileBytes.set(fileName, bytes.slice());
    }
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

    const isIgnoredFolder = (name) => {
      return /^(backups?|archive|old|crashdumps?|temp|tmp|\.git|\.vs|\.death-tracker|\.kill-tracker|\.time-played|d2rloader backups|reimaginedlauncherbackups|reimagined backups|bkbackup|bt-backup)$/i.test(name);
    };

    const isBackupFile = (name) => {
      return /^\d{8}[-_]\d{6}/i.test(name) || /\.(bak|old|backup|tmp)$/i.test(name);
    };

    const collected = [];
    for (const item of fileList) {
      const name = item.name || item.fileName;
      if (!name) continue;
      const lower = name.toLowerCase();
      if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i') && !lower.endsWith('.ctl')) continue;
      if (isBackupFile(name)) continue;

      const relPath = (item.webkitRelativePath || item.relPath || item.name || '').replace(/\\/g, '/');
      const segs = relPath.split('/').filter(Boolean);
      if (segs.slice(0, -1).some(s => isIgnoredFolder(s))) continue;

      collected.push({ ...item, name, relPath });
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
    const finalItems = Array.from(fileMap.values());

    for (const item of finalItems) {
      const name = item.name;
      const lower = name.toLowerCase();
      let bytes = item.bytes;
      if (!bytes && item.file) {
        bytes = await D2WasmEngine.readFileAsBytes(item.file);
      }
      if (bytes) {
        if (!this.initialFileBytes.has(name)) {
          this.initialFileBytes.set(name, bytes.slice());
        }
        if (lower.endsWith('.ctl')) {
          await this.saveFileToDB(name, bytes);
          continue;
        }
        const res = await this.ingestFile(name, bytes);
        results.push(res);
      }
    }
    this.recordImportMeta(localStorage.getItem('bkdiablo-folder-name') || 'Imported Files', results.length);
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
    let candidates = saves.filter(save => save.is_stash && (!characterName || (character && save.core === character.core && save.gameVersion === character.gameVersion)));
    if (candidates.length === 0) {
      candidates = saves.filter(save => save.is_stash);
    }
    const stashSave = candidates.find(s => s.file && s.file.toLowerCase().includes('modern')) || candidates[0] || null;
    if (!stashSave) return null;

    const stashItems = items.filter(it => it.isStash && (!stashSave.file || it.sourceFile === stashSave.file));
    const tabs = (stashSave.tabs || []).map((t, idx) => {
      const tabItems = stashItems.filter(it => it.tabIndex === idx);
      const rawName = t.name || '';
      let tabName = rawName;
      if (!rawName || rawName.startsWith('Shared Stash Tab')) {
        tabName = idx === 5 ? 'Stackable' : `Shared ${idx + 1}`;
      }
      return {
        index: idx,
        name: tabName,
        gold: t.gold || 0,
        itemCount: tabItems.length,
        items: tabItems
      };
    });

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
      this.loadedFiles.set(stashFileName, newStash);
      await this.saveFileToDB(stashFileName, newStash);
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

  downloadBlob(blob, fileName) {
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

  downloadFile(fileName, bytes) {
    if (this.editOriginals) return;
    this.downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), fileName);
  }

  /**
   * Returns an array of saves that were modified or newly created during this session.
   * @returns {Array<{name: string, bytes: Uint8Array, isNew: boolean}>}
   */
  getModifiedFiles() {
    const modified = [];
    for (const [name, currentBytes] of this.loadedFiles.entries()) {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.d2s') && !lower.endsWith('.d2i') && !lower.endsWith('.ctl')) continue;
      const orig = this.initialFileBytes?.get(name);
      if (!orig) {
        modified.push({ name, bytes: currentBytes, isNew: true });
      } else if (currentBytes.length !== orig.length || currentBytes.some((b, i) => b !== orig[i])) {
        modified.push({ name, bytes: currentBytes, isNew: false });
      }
    }
    return modified;
  }

  /**
   * Marks specified files as exported (synced with user's download/disk).
   * Updates initialFileBytes baseline and persists exportedBytes in IndexedDB.
   * @param {string[]|Array<{name: string}>} files 
   */
  async markFilesAsExported(files) {
    if (!files || files.length === 0) return;
    const names = files.map(f => (typeof f === 'string' ? f : f.name));

    for (const name of names) {
      const current = this.loadedFiles.get(name);
      if (current) {
        this.initialFileBytes.set(name, current.slice());
      }
    }

    const db = await this.initDB();
    if (!db) return;

    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sessionSaves', 'readwrite');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        const store = tx.objectStore('sessionSaves');

        for (const name of names) {
          const id = this.sessionId + ':' + name;
          const req = store.get(id);
          req.onsuccess = () => {
            const row = req.result;
            if (row) {
              const current = this.loadedFiles.get(name);
              row.exportedBytes = current ? current.slice() : row.bytes;
              store.put(row);
            }
          };
        }
      });
    } catch (err) {
      console.warn('[D2Wasm] Error persisting exportedBytes to IndexedDB:', err);
    }
  }

  /**
   * Exports saves that were modified or newly created.
   * If 1-3 files: downloads individually with a 200ms delay.
   * If >3 files: packages them into a single uncompressed ZIP archive.
   */
  async downloadModifiedSaves(modifiedList) {
    const list = modifiedList || this.getModifiedFiles();
    if (!list || list.length === 0) return { count: 0, zip: false };

    let res;
    if (list.length <= 3) {
      for (let i = 0; i < list.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 200));
        this.downloadFile(list[i].name, list[i].bytes);
      }
      res = { count: list.length, zip: false };
    } else {
      const zip = D2WasmEngine.createZip(list);
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const zipName = `BKDiablo_Modified_Saves_${dateStr}.zip`;
      this.downloadBlob(new Blob([zip], { type: 'application/zip' }), zipName);
      res = { count: list.length, zip: true, fileName: zipName };
    }

    await this.markFilesAsExported(list.map(f => f.name));
    if (typeof window.clearEditLog === 'function') window.clearEditLog();
    if (typeof window.updateExportButtonState === 'function') window.updateExportButtonState();
    return res;
  }

  /**
   * Downloads all currently loaded save files in a single ZIP archive.
   */
  async downloadAllSavesAsZip() {
    const files = [];
    for (const [name, bytes] of this.loadedFiles.entries()) {
      const lower = name.toLowerCase();
      if (lower.endsWith('.d2s') || lower.endsWith('.d2i') || lower.endsWith('.ctl')) {
        files.push({ name, bytes });
      }
    }
    if (files.length === 0) return { count: 0, zip: false };

    const zip = D2WasmEngine.createZip(files);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const zipName = `BKDiablo_All_Saves_${dateStr}.zip`;
    this.downloadBlob(new Blob([zip], { type: 'application/zip' }), zipName);

    await this.markFilesAsExported(files.map(f => f.name));
    if (typeof window.clearEditLog === 'function') window.clearEditLog();
    if (typeof window.updateExportButtonState === 'function') window.updateExportButtonState();
    return { count: files.length, zip: true, fileName: zipName };
  }

  /**
   * Downloads original imported saves. If >2 files, packages them into a ZIP archive.
   */
  async downloadOriginals() {
    const originals = await this.loadAllFilesFromDB();
    const valid = originals.filter(r => r.original && (r.name.endsWith('.d2s') || r.name.endsWith('.d2i') || r.name.endsWith('.ctl')));
    if (valid.length === 0) return { count: 0, zip: false };

    if (valid.length <= 2) {
      for (let i = 0; i < valid.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 200));
        this.downloadFile('original-' + valid[i].name, valid[i].original);
      }
      return { count: valid.length, zip: false };
    }

    const files = valid.map(r => ({ name: r.name, bytes: r.original }));
    const zip = D2WasmEngine.createZip(files);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const zipName = `BKDiablo_Original_Saves_${dateStr}.zip`;
    this.downloadBlob(new Blob([zip], { type: 'application/zip' }), zipName);
    return { count: valid.length, zip: true, fileName: zipName };
  }

  /**
   * Backward-compatible alias for downloading all saves.
   */
  async downloadAllSaves() {
    return this.downloadAllSavesAsZip();
  }

  /**
   * Generates a standard uncompressed PKZIP (STORE) archive in browser memory.
   * @param {Array<{name: string, bytes: Uint8Array}>} files
   * @returns {Uint8Array}
   */
  static createZip(files) {
    let crcTable = D2WasmEngine._crcTable;
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)) >>> 0;
        }
        crcTable[i] = c;
      }
      D2WasmEngine._crcTable = crcTable;
    }

    const calcCrc = (bytes) => {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++) {
        crc = (crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    };

    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    const encoder = new TextEncoder();

    let totalLocal = 0;
    let totalCentral = 0;
    const prepared = files.map(f => {
      const cleanName = f.name.replace(/^.*[\\\/]/, '');
      const nameBytes = encoder.encode(cleanName);
      const crc = calcCrc(f.bytes);
      const localLen = 30 + nameBytes.length + f.bytes.length;
      const centralLen = 46 + nameBytes.length;
      totalLocal += localLen;
      totalCentral += centralLen;
      return { nameBytes, bytes: f.bytes, crc, localLen, centralLen };
    });

    const totalSize = totalLocal + totalCentral + 22;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    let localOffset = 0;
    const offsets = [];

    for (const item of prepared) {
      offsets.push(localOffset);
      view.setUint32(localOffset, 0x04034b50, true);
      view.setUint16(localOffset + 4, 20, true);
      view.setUint16(localOffset + 6, 0x0800, true); // UTF-8 filename flag
      view.setUint16(localOffset + 8, 0, true);      // STORE (uncompressed)
      view.setUint16(localOffset + 10, dosTime, true);
      view.setUint16(localOffset + 12, dosDate, true);
      view.setUint32(localOffset + 14, item.crc, true);
      view.setUint32(localOffset + 18, item.bytes.length, true);
      view.setUint32(localOffset + 22, item.bytes.length, true);
      view.setUint16(localOffset + 26, item.nameBytes.length, true);
      view.setUint16(localOffset + 28, 0, true);
      buffer.set(item.nameBytes, localOffset + 30);
      buffer.set(item.bytes, localOffset + 30 + item.nameBytes.length);
      localOffset += item.localLen;
    }

    let centralOffset = localOffset;
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      const off = offsets[i];
      view.setUint32(centralOffset, 0x02014b50, true);
      view.setUint16(centralOffset + 4, 20, true);
      view.setUint16(centralOffset + 6, 20, true);
      view.setUint16(centralOffset + 8, 0x0800, true);
      view.setUint16(centralOffset + 10, 0, true);
      view.setUint16(centralOffset + 12, dosTime, true);
      view.setUint16(centralOffset + 14, dosDate, true);
      view.setUint32(centralOffset + 16, item.crc, true);
      view.setUint32(centralOffset + 20, item.bytes.length, true);
      view.setUint32(centralOffset + 24, item.bytes.length, true);
      view.setUint16(centralOffset + 28, item.nameBytes.length, true);
      view.setUint16(centralOffset + 30, 0, true);
      view.setUint16(centralOffset + 32, 0, true);
      view.setUint16(centralOffset + 34, 0, true);
      view.setUint16(centralOffset + 36, 0, true);
      view.setUint32(centralOffset + 38, 0, true);
      view.setUint32(centralOffset + 42, off, true);
      buffer.set(item.nameBytes, centralOffset + 46);
      centralOffset += item.centralLen;
    }

    view.setUint32(centralOffset, 0x06054b50, true);
    view.setUint16(centralOffset + 4, 0, true);
    view.setUint16(centralOffset + 6, 0, true);
    view.setUint16(centralOffset + 8, prepared.length, true);
    view.setUint16(centralOffset + 10, prepared.length, true);
    view.setUint32(centralOffset + 12, totalCentral, true);
    view.setUint32(centralOffset + 16, localOffset, true);
    view.setUint16(centralOffset + 20, 0, true);

    return buffer;
  }
}

// Global singleton instance
window.D2Wasm = new D2WasmEngine();
