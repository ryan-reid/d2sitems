# BKDiablo Armory, Stash Manager, and Hero Editor Audit

Date: 2026-09-29. Scope: the current working tree, including uncommitted Gemini work, the running local UI, installed BKDiablo data, and `E:\Games\GeminiDiff\BT-BKDiff`.

## Assessment

The project has useful save parsing and inventory rendering foundations, but it is not yet dependable for editing valuable saves or declaring items compatible with the current patch. Several failures are reproducible, including a partially committed transfer that removes an item from its source without adding it to its destination. The visual inconsistency is partly a data-resolution problem: handwritten exceptions override actual BKDiablo definitions, and three image resolvers disagree.

No application fixes were made during this audit. Live saves and golden fixtures were not modified. Mutation probes used in-memory data and disposable copies under `%TEMP%\d2sitems-audit-20260929`.

Priority: **P1** should be fixed before trusting affected editing or verification workflows; **P2** is a significant correctness or usability defect. “Reproduced” means an executed probe or direct UI observation; “source-confirmed” means a traced code path, not an in-game compatibility test.

## Verification performed

- CLI and WebAssembly builds succeeded, with three and four warnings respectively. StackEditorManager has nullable warnings; WASM also has a platform annotation warning.
- All eight golden character baselines and the seven-tab golden shared stash round-tripped byte-for-byte using D2SSharp 0.0.21. This supports the serializer foundation; it does not validate mutation logic.
- Probed transfer write failure, backup collisions, repeated quest rewards, new-character stats, invalid stack destinations, browser request deserialization, and browser comparison-table initialization.
- Inspected search, armory, crafting, and verifier in the running local UI, including a 1440-pixel desktop viewport and the narrower app panel.
- Compared six important installed BKDiablo tables with embedded data and BT-BKDiff; the captured hashes and header offsets are in the evidence JSON. The browser verifier failure occurs even with matching data.
- Did not submit live editing requests, test changed saves in the game, or run every existing browser script. Existing scripts include machine-specific paths and shallow success/screenshot checks; the isolated probes were used for failure cases.

Evidence: [probe results](/E:/Games/d2sitems/docs/audits/2026-09-29-probe-results.txt), [probe source, stored as text](/E:/Games/d2sitems/docs/audits/2026-09-29-probe.cs.txt), [source hashes and mod definitions](/E:/Games/d2sitems/docs/audits/2026-09-29-source-evidence.json).

## Save integrity and editing

### 1. P1 — Transfers can lose items on a destination-write failure

**Reproduced.** [ItemTransferManager.cs:140](/E:/Games/d2sitems/ItemTransferManager.cs:140) labels writes atomic but writes the source and destination sequentially. With a disposable destination made read-only, the operation returned failure, the source count fell from 86 to 85, and the destination remained unchanged. Bulk transfer repeats the same pattern at lines 374–381. Backups exist, but there is no automatic rollback or transaction recovery.

Fix: stage and validate both outputs, retain immutable backups, use per-file atomic replacement with a transaction journal and recovery/rollback for the pair. Test failure at every commit step; two separate file replacements alone are not a multi-file transaction.

### 2. P1 — Backups overwrite each other within one second

**Reproduced.** [SaveBackup.cs:35](/E:/Games/d2sitems/SaveBackup.cs:35) uses second-resolution timestamps and `overwrite: true`. Two backups returned the same path; the original backup then contained the later contents. Use unique transaction IDs, exclusive creation, and a restore manifest.

### 3. P1 — Stack editing can target a different item and save

**Source-confirmed, with backend validation failure reproduced.** [d2_armory.js:400](/E:/Games/d2sitems/web/d2_armory.js:400) discards source filename and seed when opening the editor. Submission sends only code, tab, and quantity; the API defaults to `ModernSharedStashSoftCoreV2.d2i`. The context menu offers this action for character inventory quantities too. Editing a character's tome or throwing stack therefore routes to the shared-stash operation. Also, `parseInt(...) || 5` changes a valid tab zero into tab five.

[StackEditorManager.cs:51](/E:/Games/d2sitems/StackEditorManager.cs:51) permits any tab, falls back from an unmatched seed to the first matching code, and creates absent items without checking the mod's permitted bank slots. The probe successfully added an advanced stack to ordinary tab zero. Preserve an explicit file/container/item identity and distinguish ordinary quantities from advanced-bank counters. Reject invalid targets and stale identity rather than silently creating or substituting an item.

### 4. P1 — Quick-transfer destination names disagree with the server

**Source-confirmed.** [d2_armory.js:2090](/E:/Games/d2sitems/web/d2_armory.js:2090) sends `target_character` with `target_container: 'stash'` for “Move to Shared Stash.” The server resolves that to the selected character's `.d2s`, and the CLI interprets `stash` as personal stash. Conversely, UI `personal_stash` is not recognized by [ParseContainerType](/E:/Games/d2sitems/ItemTransferManager.cs:625), so it defaults to Inventory.

The quick path also forces live edits and only checks HTTP/error fields, ignoring `{Success:false, Message:...}`. A rejected transfer can display success. Use one typed destination contract and shared result handling; never infer the save from an ambiguous label.

### 5. P1 — Browser transfer requests fail before editing

**Deserialization reproduced.** [d2_wasm_engine.js:619](/E:/Games/d2sitems/web/d2_wasm_engine.js:619) sends string enum values, but [D2EngineInterop.cs:159](/E:/Games/d2sitems/src/D2SWasm/D2EngineInterop.cs:159) does not configure a string-enum converter. `SharedStash` produces a JsonException; bulk `TargetContainers` has the same problem.

There are additional identity mismatches: the modal sends `seed/code`, the adapter reads `item_seed/item_code`, and quick transfer reads `it.x/it.y/it.seed` instead of `invX/invY/itemSeed`. Fix and test the entire UI-to-engine contract, not just the byte-edit function.

### 6. P1 — Quest completion repeatedly grants rewards

**Reproduced.** [QuestManager.cs:261](/E:/Games/d2sitems/QuestManager.cs:261) overwrites completion flags and grants rewards without checking prior reward state. Applying Normal Act I twice changed skill points `0 → 1 → 2`; both calls reported success. Reward amounts are also hardcoded. Make completion idempotent, retain appropriate reward-claim state, and explicitly validate BKDiablo reward behavior before applying it.

### 7. P1 — New characters ignore current mod starting stats

**Reproduced.** [MuleGenerator.cs:96](/E:/Games/d2sitems/MuleGenerator.cs:96) clones a golden save, changes its name, and optionally sets Hardcore. It does not derive starting attributes, life/mana, skills, or starting equipment from the current mod. In a copied data directory, setting Amazon `charstats.txt` strength to 99 still generated strength 20. A false Hardcore argument also does not explicitly clear a Hardcore template flag.

Use fixtures as structural templates, then apply validated current BKDiablo character definitions. Add tests that change mod starting values and verify generated values and equipment.

### 8. P1 — Ordinary grids are used for advanced stash transfers

**Source-confirmed.** [ItemTransferManager.cs:238](/E:/Games/d2sitems/ItemTransferManager.cs:238) treats every shared-stash tab as a rectangular placement grid. [d2_armory.js:2028](/E:/Games/d2sitems/web/d2_armory.js:2028) allows drops onto crafting/stackable views and routes both to tab five. The backend does not validate accepted codes, merge stack counts, enforce quantity conversion, or split an advanced stack when withdrawing it. Single-item cube transfers also do not check cube ownership, unlike bulk packing.

Implement separate operations for normal placement, bank deposit/withdrawal, and stack adjustment, driven by mod layout/type data. Do not enable a generic drop target until its save representation is supported.

### 9. P1 — Edits lack stale-save and concurrency protection

**Source-confirmed.** The Python server is threaded; mutation methods perform independent read/modify/write cycles without a shared file lock or expected hash. Two edits can overwrite each other, and the game can overwrite editor changes. Item IDs are counters rebuilt during [reload](/E:/Games/d2sitems/web_ui.py:217), while [FindItem](/E:/Games/d2sitems/ItemTransferManager.cs:539) can fall back to coordinates even when a supplied seed no longer matches.

Lock all affected files in a consistent order, compare expected content hashes before committing, and reject stale selections. Stable identity must include the save and item discriminator, not a display-list counter.

## BKDiablo definitions, verification, and artwork

### 10. P1 — The browser comparison engine loads zero stat ranges

**Reproduced.** [SaveInspectorEngine.cs:1771](/E:/Games/d2sitems/SaveInspectorEngine.cs:1771) skips the header, then looks for header labels inside data rows and falls back to hardcoded offsets. BKDiablo's actual offsets are unique `prop1=25`, set `prop1=24`, runeword `T1Code1=24`, and `Rune1=18`; the code assumes 23, 13, 33, and 27 respectively. All three range dictionaries contained zero entries in the probe.

[Program.cs:2541](/E:/Games/d2sitems/Program.cs:2541) has a separate, more capable header-based implementation. Thus local and browser results differ despite sharing the same source tables. Consolidate parsing and property semantics into one engine and add CLI/browser parity fixtures. Reject initialization when required schemas cannot be loaded.

### 11. P1 — “Up to Date” includes items that were not meaningfully verified

**Source-confirmed.** Both item builders mark `isOutOfDate=false` when no comparison ranges exist. The browser verifier counts all items as checked; local mode restricts eligibility but still treats absent comparisons as clean. Missing/unsupported properties, old JSON caches, and removed properties are not modeled as uncertainty. Corruption and other legitimate added stats need separate treatment from definition mismatches.

The local UI showed 667 checked, 576 up to date, and 91 outdated; these are observed UI claims, not independently certified classifications. Use explicit `compatible`, `mismatch`, `unsupported`, and `unknown` states, preserve structured reasons, and show the definition fingerprint and scan time. Detecting a mismatch does not by itself identify which historical patch created the item.

### 12. P1 — Handwritten image overrides contradict BKDiablo

**Confirmed against installed mod manifests and current mapping output.** [extract_item_sprites.py:333](/E:/Games/d2sitems/extract_item_sprites.py:333) overwrites generated mappings:

- BKDiablo `items.json` maps `bgn` to `key/bigdinn_key`, whose mod sprite exists. The output instead uses `hd_knife_gidbinn.png`; the UI additionally forces its label to “The Gidbinn.”
- BKDiablo's base Jewel uses `invgswe` and `gem/perfect_diamond`, but code replaces it with six retail jewel variants selected using seed modulo six.
- BKDiablo `uniques.json` maps Rainbow Facet to `gem/perfect_diamond`; the application substitutes colored jewel sprites.
- Defender/Guardian unique mappings reference elemental fragments, including `../misc/body_part/fragment_fire`; the generator flattens the unresolved relative path and later forces all Colossal Jewels to a perfect diamond. Extracted fragment PNGs already exist.

The Python search resolver, WASM resolver, and armory resolver also disagree: a cold Facet is jewel 2 in Python and jewel 3 in armory. Replace them with one generated resolver that respects the selected mod definition and records its asset origin.

### 13. P2 — Image matching loses identity, tier, and provenance

**Source-confirmed.** Generated HD quality keys replace underscores with spaces but do not consistently normalize apostrophes/punctuation. Only the `normal` quality variant is selected; `uber/ultra` are ignored. The shared item DTO omits unique/set file identity needed to distinguish same-name definitions. Five classic unique mapping entries point to nonexistent `invcm3.png`; these all come from the Gheed override.

Finally, `merged.update(hd)` gives HD priority irrespective of whether a classic candidate came from BKDiablo. This permits retail HD to outrank a mod classic override; it is an architectural precedence defect, not a demonstrated current item count. Resolve the mod match before selecting presentation format, retain stable definition IDs, normalize asset paths, and distinguish missing artwork from a missing definition.

### 14. P2 — Generated data is not tied to a mod revision

**Source-confirmed.** Embedded tables, image mappings, layout JSON/JS, and PNGs are maintained separately. The deployment workflow publishes whatever is present; it does not rebuild or verify their common provenance. Local mode displays previously generated save JSON without checking save/table hashes, and `run_scan()` reports success even after subprocess failure.

Create one catalog build with source hashes/version, validate every referenced asset, and bind parsed save caches to the catalog fingerprint. Invalidate or explicitly label stale caches. Required malformed mod data should be an error, not a silent retail substitution.

## Browser/local behavior and UX defects

### 15. P1 — Browser stack editing and comparisons still call server APIs

**Source-confirmed.** [d2_armory.js:463](/E:/Games/d2sitems/web/d2_armory.js:463) tests `window.D2_WASM_ENGINE.active`, but the actual instance is `window.D2Wasm` and has no such active property. Stack editing falls through to `/api/stash/stack-quantity` on static hosting. [app.js:1020](/E:/Games/d2sitems/web/app.js:1020) always fetches `/api/item-compare/...`, including browser mode. Route both through a tested backend interface with matching result shapes.

### 16. P1 — Browser storage mixes save folders and has no transaction history

**Source-confirmed.** [d2_wasm_engine.js:7](/E:/Games/d2sitems/web/d2_wasm_engine.js:7) keys memory and IndexedDB only by filename. Importing another folder replaces matching names and retains unmatched files from earlier imports. Identically named shared stashes can overwrite one another in the browser copy. Mutations replace cached originals, and two-file transfers persist/download each file independently; IndexedDB completion is not awaited.

Give each imported save set a profile identity, keep original bytes and revision history, commit related cached files together, and export a complete transaction bundle. Clearly distinguish edits to browser copies from edits to files on disk.

### 17. P2 — Success/error handling is inconsistent across layers

**Partly reproduced.** [Program.cs:33](/E:/Games/d2sitems/Program.cs:33) discards the mule generator's exit code; an invalid class printed an error but exited zero. The API consequently reports creation success. Backup logging also writes to stdout before JSON results, causing `json.loads(proc.stdout)` to fall back to lowercase `success/output`, while the transfer modal checks only uppercase `Success`. In a source-only checkout, mutation routes try to execute the `.csproj` path rather than constructing the `dotnet run` command used by scanning.

Use one result schema, machine-readable stdout only, diagnostics on stderr, correct exit propagation, and a common executable/project runner.

### 18. P2 — Search silently hides results after the first 500

**Observed and source-confirmed.** [web_ui.py:1095](/E:/Games/d2sitems/web_ui.py:1095) returns `items[:500]` while returning the full result count. The UI advertised 1,317 items but rendered 500 search cards, without pagination or a truncation notice. Add pagination/virtualization and an explicit displayed/total count.

### 19. P2 — Item details confuse level, sockets, and verification scope

**Source-confirmed and visually consistent.** [app.js:716](/E:/Games/d2sitems/web/app.js:716) labels `requiredLevel || itemLevel` as `LVL`, although these mean different things and the parser does not supply required level. [d2_armory.js:707](/E:/Games/d2sitems/web/d2_armory.js:707) treats the `sockets` array as a number and ignores `socketCount`, preventing reliable socket overlays. Details need explicit required level versus item level, filled/empty sockets, and property groups for intrinsic stats, socket contributions, set bonuses, and comparison results.

### 20. P2 — Responsive layout and keyboard operation break core browsing

**Observed/source-confirmed.** The armory is a non-wrapping dual panel with fixed grids; in the narrow app panel, stash controls and the hero panel extend outside the visible area. Search switches to one column but retains its large sticky filter sidebar; search/results visibly overlapped the filters during the narrow-view inspection. At desktop width the sidebar is about 1,067 pixels tall, exceeding the inspected viewport.

Search cards and inventory items are clickable divs without keyboard focus/activation; modal markup lacks dialog semantics and focus management. Use a collapsible filter drawer, explicit scroll/zoom behavior for authentic grids, keyboard-operable item controls, focus trapping/return, and Escape dismissal. Preserve cell geometry when adapting the surrounding layout.

### 21. P2 — The interface obscures destination and save mode

**Observed/source-confirmed.** Dragging onto a grid ignores the drop cell and calls auto-placement. Equipped items expose transfer actions although the engine selects only stored character items. Local mode's footer still says “100% Client-Side WebAssembly,” while adjacent “+ Folder” and “Load Folder” controls invoke different storage models. Shared-stash detail selects the first stash, with no explicit softcore/hardcore/version selector. Browser Holy Grail totals are hardcoded retail estimates (385/127/85), not BKDiablo definitions.

Make the selected save set, stash file, storage mode, and pending edits persistent UI context. Preview the actual destination and placement, disable unsupported actions, and generate collection totals from the BKDiablo catalog.

## UX direction

The desktop armory currently mixes authentic inventory textures with ornamental application panels, thick borders, repeated headers, tiny decorative labels, emoji controls, and score badges covering item artwork. The crafting view nests several toolbars above a busy background; item quantities are added twice in some slots. Search promotes perfection more strongly than actual properties, and an outdated item can still appear as “100% Perfect.” These choices make the screen harder to scan and weaken trust in the data.

Recommended structure:

1. **Collection:** search and compact filters, readable rows/cards, explicit owner/container, comparison status, and a persistent detail pane. Explain roll quality separately from patch compatibility.
2. **Inventory:** two clearly selected containers with BKDiablo geometry/artwork, a consistent item tooltip, and visible placement feedback. Keep labels/actions outside the inventory artwork where possible.
3. **Hero:** explicit editable attributes, skills, quest state, and creation settings. The current reviewed UI mainly exposes creation/quests rather than a general hero-stat editor; do not present that broader scope as complete.
4. **Change review:** before/after values, source/destination saves, affected items, backup/restore access, and clear disk-versus-browser status. A recoverable transaction should be part of the normal workflow.

Use game fonts for short titles only, a readable body font for stats and controls, fewer competing gold borders, consistent icons, larger hit areas, and quality color supplemented by text. Keep the in-game arrangement; improve the surrounding application rather than layering decorative controls over it.

## What to reuse from BT-BKDiff

| Component | Useful behavior | Integration caution |
| --- | --- | --- |
| [repository.py](/E:/Games/GeminiDiff/BT-BKDiff/scripts/d2lib/repository.py) | Header-based TSV records, BOM handling, value normalization, mod-first table/string loading | Preserve save-relevant row identities; define file-level versus asset-level fallback explicitly. Do not merge removed mod rows back from retail. |
| [services/resolver.py](/E:/Games/GeminiDiff/BT-BKDiff/scripts/d2lib/services/resolver.py) | Property aliases, skilldesc localization, class/skill layers, per-level formatting knowledge | Display formatting is not a save-stat evaluator. Validate property functions and scaling against serialized stats. |
| [services/items.py](/E:/Games/GeminiDiff/BT-BKDiff/scripts/d2lib/services/items.py) | Base requirements, item-type ancestry, sockets, inherent/automagic properties, raw item definitions | Export structured definitions and identifiers, not just rendered descriptions. |
| [wiki/builders.py:484](/E:/Games/GeminiDiff/BT-BKDiff/scripts/d2lib/wiki/builders.py:484) | ItemIconExporter, punctuation normalization, quality manifests, tier variants, sprite/DC6 decoding | It prefers pre-existing wiki PNGs and then HD ahead of classic. Reusing it unchanged does not guarantee the requested BKDiablo-first precedence. |
| [services/comparison.py](/E:/Games/GeminiDiff/BT-BKDiff/scripts/d2lib/services/comparison.py) | Definition diffs, additions/removals, normalized comparison presentation | BT-versus-BK differences are not historical BK patch attribution. Save compatibility needs stat IDs/layers and valid roll semantics. |

Build a versioned BKDiablo catalog from this knowledge and consume it in both engines. For artwork, first resolve the BKDiablo item's definition and requested quality/tier asset; normalize relative asset paths and look for that asset in the mod, then the corresponding retail asset if absent. Consider mod classic artwork before an unrelated retail replacement. Record fallback provenance and show an explicit placeholder when no valid match exists. Treat retail as a controlled fallback, never a silent override of an existing mod match.

## Repair order and acceptance checks

1. **Save integrity:** transactions, immutable backups, stale-file detection, stack target validation, and idempotent quest rewards. Gate unsafe editing paths until failure-injection tests pass.
2. **Shared contracts:** one parser, one request/result schema, one local/browser adapter. Test both UIs against the same fixture operations and failure responses.
3. **Mod catalog:** BKDiablo-first definitions, assets, character initialization, bank layouts, and provenance. Remove handwritten image/name overrides after covering known examples.
4. **Verification:** fix range loading; represent unknown/unsupported results; validate known current, legacy, corrupted, socketed, set, and runeword fixtures.
5. **UX:** reorganize collection/inventory/hero workflows, responsive behavior, keyboard access, pagination, and change review.

Required regressions include failed second-file writes, rapid backups, concurrent edits, same-name imports, correct hardcore stash selection, invalid bank deposits, zero/maximum quantities, duplicate quest completion, changed charstats, mod-versus-retail image precedence, CLI/browser parity, and all-result navigation. Include read-back checks and targeted in-game validation on disposable saves before considering editing trustworthy.
