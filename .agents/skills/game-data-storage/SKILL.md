---
name: game-data-storage
description: >-
  Game data tables, binary bitstreams, and storage schema runbook for d2sitems. Use this skill
  when parsing Diablo II save files (.d2s/.d2i), modifying mod definitions or item stats,
  updating bank expansion layouts, or adjusting browser IndexedDB persistence.
---

# Game Data & Storage Schema Runbook

This guide documents data storage schemas across binary save files, mod balance tables, and browser IndexedDB caching.

## 1. Binary Save File Structures

### Character Saves (`.d2s`)
- **Header**: Signature `0xAA55AA55`, file version (`0x60` for modern D2R), checksum (CRC32 or mod-specific), character name (16 bytes null-padded), character status flags (hardcore, expansion, ladder, died).
- **Embedded Sections**:
  - `quests`: Quest completion bits per act and difficulty.
  - `waypoints`: Waypoint unlock bitfields per act and difficulty.
  - `skills`: Skill point allocations (30 skills per class).
  - `items`: Item list header `JM`, followed by count and variable-length bit-packed item structures.
  - `corpse_items`, `merc_items`, `golem_item`: Optional sub-sections.

### Shared Stash Saves (`.d2i`)
- **Header**: Signature `0xAA55AA55`, version, stash flags (softcore/hardcore).
- **Tabs**: Multiple tabs (default 6 tabs in BKDiablo expansion). Each tab contains a `JM` header, item count, and item bitstream.
- **Advanced Stash Bank**: Tab 6 (index 5) in BKDiablo contains advanced stackable items (runes, gems, tokens) governed by mod stack bounds and specific layout grids.

## 2. Mod Definitions & Priority Rules
Authoritative mod data priority:
1. **BKDiablo Mod Definitions**:
   - Primary source: `mods/BKDiablo/bkdiablo.mpq/data/global/excel/` (`UniqueItems.txt`, `Sets.txt`, `ItemStatCost.txt`, `charstats.txt`, `runes.txt`).
   - Consult BT-BKDiff parsing conventions (`scripts/d2lib`).
2. **Retail Fallback**:
   - Only utilized if an item code or property has no mod match.
   - Preserves provenance: badges must clearly indicate whether stats are verified from mod definitions or fallback.
3. **Data Versioning**:
   - Whenever mod TXT files or layouts change, regenerate `web/catalog_meta.json` with SHA-256 fingerprints of definitions, layout, and artwork.

## 3. Browser IndexedDB Storage Schema
In WebAssembly mode, browser persistence is managed in `web/d2_wasm_engine.js` under IndexedDB database `d2s_wasm_db`:
- **Object Store**: `saves`
  - Key: `fileName` (e.g. `Amazon.d2s`, `ModernSharedStashSoftCoreV2.d2i`).
  - Fields:
    - `name`: File name string.
    - `bytes`: Current modified `Uint8Array` byte buffer.
    - `original`: Original imported `Uint8Array` byte buffer (preserved for rollback and "Export Originals").
    - `timestamp`: Last modified epoch timestamp.
- **Session Isolation**: Each imported folder initiates an isolated session. Aborted transactions never commit partial bytes.
