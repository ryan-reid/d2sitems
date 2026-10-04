# BKDiablo Repair Checklist

This is the working checklist for the [2026-09-29 audit](audits/2026-09-29-bkdiablo-audit.md). Audit numbers below refer to that report. Check an item only after its acceptance check passes; partial work stays unchecked. Work in phase order, keeping each iteration small enough to review.

BKDiablo definitions, artwork, and layouts are authoritative. Retail fallback must follow a failed mod match and retain provenance. Reuse parsing knowledge from `E:/Games/GeminiDiff/BT-BKDiff`, especially `scripts/d2lib`, without treating retail-versus-mod differences as patch history. Mutation checks use disposable copies only.

## 1. Protect saves before expanding editing

- [x] **SAFE-01 — Preserve every backup (#2).** Unique names, no overwrite, diagnostics on stderr. Acceptance: rapid backups retain both original revisions.
- [x] **SAFE-02 — Handle caught transfer write failures (#1, partial).** Stage bytes, replace complete files, and roll back committed replacements. Acceptance: a locked second destination leaves both original files byte-identical; single-file and paired commits succeed.
- [x] **SAFE-03 — Recover interrupted transfers (#1).** Add durable transaction records and startup recovery. Acceptance: terminate between replacements, restart, and recover without item loss or duplication; surface rollback failures with actionable recovery paths.
- [x] **SAFE-04 — Prevent stale/concurrent edits (#9).** Add revision tokens and coordinated writes across every mutation endpoint. Acceptance: competing requests or an external save change cannot silently overwrite one another. Snapshot checks in the transfer helper are only an initial safeguard; races remain.
- [x] **SAFE-05 — Fix stack targeting and limits (#3).** Carry exact file, tab, item identity, and revision; enforce mod stackability and bounds. Acceptance: wrong seed/tab/file and invalid quantities are rejected without edits; tab zero works.
- [x] **SAFE-06 — Make quest rewards idempotent (#6).** Acceptance: completing an already completed quest grants no additional stats, skills, or rewards.
- [x] **SAFE-07 — Respect advanced banks (#8).** Use BKDiablo slot rules and explicit merge/split behavior. Acceptance: valid bank operations conserve quantities; invalid placement leaves saves unchanged.

## 2. Establish one trustworthy mod catalog

- [x] **DATA-01 — Unify TXT parsing (#10).** Use header names and shared property semantics, informed by BT-BKDiff. Acceptance: CLI and WASM produce matching, nonempty unique/set/runeword ranges, including transformed properties.
- [x] **DATA-02 — Make verification honest (#11).** Distinguish verified, changed, unsupported, and unknown. Acceptance: unsupported properties never produce an unconditional current-item badge; comparisons identify their source revision.
- [x] **DATA-03 — Generate characters from current definitions (#7).** Acceptance: changing a mod starting-stat definition changes the generated character; validate every supported class and preserve valid save structure.
- [x] **DATA-04 — Version generated data (#14).** Fingerprint definitions, layouts, and artwork inputs. Acceptance: a changed input invalidates its cache and rebuild failures remain visible.
- [x] **ART-01 — Replace contradictory overrides (#12).** Resolve mod item identity before retail fallback. Acceptance: Bigdinn key, Defender jewels, facets, and Gheed match the mod and all resolved files exist.
- [x] **ART-02 — Share artwork resolution (#13).** Preserve unique/set identity, visual variant, tier, and provenance across Python and JS. Acceptance: cards, inventory, details, and catalog show the same resolved art; mod classic art wins over unrelated retail HD art.

## 3. Make local and browser operations reliable

- [x] **FLOW-01 — Normalize transfer contracts (#4–5).** Explicit container enums and one item identity schema. Acceptance: every source/destination combination resolves correctly in local and WASM modes; errors never show success.
- [x] **FLOW-02 — Remove browser-only REST dependencies (#15).** Acceptance: stack editing and comparisons work with the server unavailable.
- [x] **FLOW-03 — Isolate browser save sessions (#16).** Namespace profiles, preserve originals, and commit paired IndexedDB writes together. Acceptance: identical filenames from different folders never mix; aborted writes preserve both previous versions.
- [x] **FLOW-04 — Standardize operation results (#17).** Consistent JSON, exit codes, runner invocation, and scan failures. Acceptance: invalid inputs and subprocess failures propagate as failures through CLI, API, and UI.

## 4. Rebuild the browsing and editing experience

- [x] **UX-01 — Show all search results (#18).** Add explicit pagination or progressive loading. Acceptance: every match is reachable and displayed counts describe loaded versus total results.
- [x] **UX-02 — Correct item details (#19).** Separate required level, item level, socket contents/count, and comparison scope. Acceptance: representative socketed and unidentified items display accurate labels and values.
- [x] **UX-03 — Make browsing readable and accessible (#20).** Simplify panel hierarchy, typography, spacing, responsive layout, and keyboard navigation. Acceptance: desktop and narrow screens retain core actions; item selection and dialogs work by keyboard with visible focus and Escape behavior.
- [ ] **UX-04 — Make edits and destinations explicit (#21).** Clearly show active save, tab, destination, pending changes, browser export versus disk write, and mod collection totals. Acceptance: drag/drop honors the chosen cell and users can identify where an edit will be saved before committing.

## 5. Release verification

- [ ] **QA-01 — Exercise real fixtures end to end.** Cover every class, normal/advanced banks, stack edits, quest rewards, transfers, and current/unknown item comparisons in both modes. Record byte-level conservation and screenshots at desktop/narrow sizes.
- [ ] **QA-02 — Confirm recovery and deployment.** Verify interrupted transactions, backup restoration, offline browser operations, generated WASM freshness, and documented setup from a clean checkout.

## Iteration log

### Mule taxonomy review

Documented the requested BKDiablo mule categories and conservative named pre-buff rules in [MULE_CATEGORIES.md](MULE_CATEGORIES.md) and [PREBUFF_PROTECTED_ITEMS.md](PREBUFF_PROTECTED_ITEMS.md). Runes, gems, and crafting materials are now explicitly excluded from the planner; corrupted items follow their underlying quality. Generic skill bonuses are deliberately not protected. The planner still needs the named pre-buff allowlist and explicit base-item classification for white/grey runeword bases.

### Explicit save-mode selection

Added a persistent Softcore-only/Hardcore-only header selector. Scoped local API reads and browser datasets separate search, characters, stashes, grail, verifier, and transfer destinations. Switching clears selected characters and closes stale dialogs; mule creation inherits the selected mode. Backend tests verify disjoint datasets without mutating global server state. This does not reverse earlier cross-core transfers.

### Hardcore isolation defect

Recovery completed at the user's explicit request: restored the hardcore stash from the 20261003_203409 backup, TestBarb from its paired backup, and TestAmazon from the 20261003_203425 backup. All three restored files were verified byte-for-byte against those originals. The transaction created and verified fresh backups of the pre-recovery current files (20261003_204821). App index rescanned after restoration.

Confirmed three bulk transfers incorrectly crossed from the hardcore stash into softcore TestBarb/TestAmazon. Added engine guards for both bulk and individual transfers using character flags and original stash filenames; unknown stash mode fails closed. Regression checks cover both rejected paths. Pack Mule labels now include core mode. Capacity validation alone did not catch this defect. Recovery audit and backup reconciliation are separate from save mutation.

### Pack Mule stale revision follow-up

Confirmed both live shared-stash hashes differed from the cached scan. Pack Mule now scans and loads current saves before showing choices; scan failures prevent opening stale choices. Revision checks remain enforced at commit time, with distinct source/destination conflict messages and no automatic transfer retry. Zero matching items return without attempting to write null replacement bytes.

Validation: engine regressions pass stale source/destination rejection, successful packing with refreshed revisions, and item-count conservation on disposable fixture bytes. JavaScript syntax check passes. Live item transfers were not performed.

### Iteration 1 — Backup preservation and caught transfer failures

Implemented SAFE-01 and SAFE-02 in `SaveBackup.cs`, `SaveFileTransaction.cs`, and both disk transfer entry points in `ItemTransferManager.cs`. The shared helper is linked into the WASM and inspector projects. Crash recovery and comprehensive concurrency protection remain open above.

Validation: `dotnet run --project tests/save_safety/SaveSafety.csproj` passes seven checks covering backup preservation, paired/single writes, read-only destination, rollback after a locked second replacement (Windows), stale input, and staging cleanup. Tests retain disposable files under the system temporary directory. These are filesystem regression checks; full save-fixture integration remains part of QA-01.

Next iteration: SAFE-03, followed by SAFE-04 and SAFE-05. Do not label audit finding #1 fully resolved until crash recovery is verified.

Build validation: CLI and WASM builds succeeded with outputs directed to the system temporary directory. Existing StackEditorManager nullable warnings and the WASM platform warning remain. Live saves and deployed application binaries were not updated.

### Iteration 2 — Durable recovery, shared catalog, and browser editing

Completed crash recovery with durable undo records and a cooperating-writer lock. Forced process termination after the first replacement restores both originals on restart; recovery is idempotent. Revision tokens now travel through disk mutation endpoints, and stale requests are rejected. External game writers still require the game to be closed; SAFE-04 remains open for broader concurrent endpoint tests.

Shared header-based item, skill, property, and range readers now produce byte-for-byte equivalent JSON structures between the CLI and shared browser engine for all nine baseline saves (matching exclusion settings). Counts: 500 unique, 217 set, and 115 runeword range records. Character creation uses current charstats definitions for all eight classes; a modified definition changes generated stats. Repeated quest completion is byte-identical.

Artwork mappings now resolve mod identity before fallback, preserve provenance and tiers, and verify every referenced PNG exists. Automated examples cover Bigdinn key, Defender's Fire, Rainbow Facet, and Gheed. Python and browser views consume the same catalog; full visual conformance remains under ART-02.

Advanced-bank withdrawal/deposit conserves rune quantity and character item count. Exact stack edits reject missing tabs, wrong seeds, and invalid quantities. More bank-boundary cases remain before checking SAFE-05/07.

Browser saves have isolated import sessions, preserved originals, and paired IndexedDB commits. The static browser regression page passes fixture parsing, mod collection totals (495 unique names, 217 set names, 115 runewords), string-enum transfers, exact stack editing, idempotent quests, Warlock creation, stale transaction rejection, and duplicate-filename session isolation. Generated WASM was rebuilt locally.

The UI now has responsive filters, quieter cards, visible keyboard focus, modal focus handling, explicit storage-mode text, shared mod artwork, and grid-cell drop coordinates. Search no longer truncates the API response. These changes remain under visual and endpoint verification; unchecked tasks are not completion claims.

Validation: `dotnet run --project tests/save_safety/SaveSafety.csproj`, `dotnet run --project tests/engine_regressions/EngineRegressions.csproj`, `python -m unittest tests/test_catalog.py`, syntax checks, and `tests/browser_regressions.html` served on a separate localhost port. Golden fixtures and live save bytes were not modified. The local UI server was restarted to load current Python code.

### Iteration 3 — Boundary checks and reachable browsing

Added bank overflow, invalid charm placement, stale transfer/stack revision, wrong file type, and normal tab-zero rejection checks. All pass without replacement bytes on failure. SAFE-05 and SAFE-07 are now checked for the supported bank operations.

Search uses progressive batches of 100, with explicit displayed/total counts and a keyboard-accessible next button. Verified progression from 100 to 200 of 1,408 current items. Enter opens item details, Escape closes them and restores focus, and the 390px layout retains filters and controls. Current save data was rescanned into JSON only; save bytes were not edited.

Fixed an additional destination defect found with both hardcore and softcore stashes present: the armory now selects the stash matching the character's core and game version, and rejects ambiguous matches. Local API tests cover this and stale-catalog badges, failed scans, and current-source runner selection. Artwork revisions now include resolved PNG contents; bank layout exports include the source hash.

Remaining release work: complete endpoint-level concurrency and mutation matrix, shared artwork visual conformance in all panels, automatic catalog/layout invalidation, missing required-level calculation, and clean-checkout deployment verification. These remain unchecked above.

### Iteration 4 - Edit visibility and accessibility

The mode banner now lists loaded saves, the active character and stash tab, and a count of edits this session (unexported in browser mode, written in local mode); transfers and stack edits feed it. The transfer dialog shows a live destination summary (file, container, slot, browser-versus-disk), and drag/drop asks for confirmation naming the container, tab, and cell. Navigation exposes aria-current and icon-only close buttons have labels. Desktop (1200px) and 390px layouts were captured in headless Edge and retain core actions; a scripted probe confirmed the summary, banner, aria-current, and close labels. UX-03 is checked. UX-04 stays open: an actual drag/drop with the confirmation prompt has not been exercised, and quest completion is intentionally excluded from the edit count.

### Iteration 5 - QA pass

Added tests/run_browser_regressions.mjs (real-time headless Edge runner; serve the repo root first). It exposed a real browser-mode defect: the transfer dialog sent snake_case keys the WASM engine did not read, so dialog transfers failed with Source file 'undefined'. web/d2_wasm_engine.js now normalizes snake_case, camelCase, and PascalCase keys. The stale generated WASM (Sep 30) was republished and copied into web/_framework (previous copy kept in the system temp folder).

Validation: SaveSafety, EngineRegressions (all eight classes, advanced bank round trip, stale revisions, stack edits, quest idempotence, CLI/WASM parity), test_catalog/test_api, and the 14 browser checks all pass. QA-01 stays open: no screenshots of every panel in both modes and no item-comparison coverage in browser mode. QA-02 stays open: clean-checkout setup and backup restoration through the UI were not exercised.

### Iteration 6 — Net-new item creator, dropped stats recovery, and BT-BKWiki alignment

Added unified item creator and search dropdown, supporting unique item generation with authoritative BKDiablo property ranges from `PropertyRangeCatalog.cs`.

Resolved dropped stat defects during live mule in-game verification (`ItemTester.d2s`):
- Restored `func 11` (chance-to-cast procs with packed skill/level layer), `func 14` (sockets and item flags), `func 15`/`16` (elemental/physical min/max damage), `func 17` (per-level stats shifted by 8 bits, frame durations, replenishments), `func 19` (charged skills), and `func 12`/`36` (random single and class skills).
- Fixed `dmg%` property: D2 `func 7` sets both `item_maxdamage_percent` (StatId 17) and `item_mindamage_percent` (StatId 18).
- Fixed duplicate property aggregation: summed multiple occurrences of identical `(StatId, Layer)` keys (e.g. multiple `swing2` or `block3` properties).
- Fixed Chance to Block: eliminated `"block" => "block1"` alias that was erroneously converting `toblock` (StatId 20) into `item_fasterblockrate` (StatId 102), restoring Chance to Block across 28 unique shields, 11 set items, and runewords (`Rhyme`, `Knight's Vigil`).
- Added fallback for `dmg-ac` with empty min/max on Guardian Angel mapping to `-100 to Monster Defense Per Hit` (StatId 120).

Cross-repository alignment & wiki backlog:
- Conducted full comparative audit of all 502 unique items, 218 set items, and 185 runewords against BT-BKWiki (`items-index.json`).
- Documented upstream wiki parsing bugs in `E:\Games\GeminiDiff\BT-BKDiff\docs\wiki-issues.md` and linked from `docs/wiki-generation-plan.md`, covering:
  1. `block` aliased to `block1` corrupting Chance to Block into Faster Block Rate across 28 uniques, 11 sets, and runewords.
  2. Poison duration formatting bug displaying damage value as duration in seconds instead of converting frames.
  3. Ormus' Robes `skill-rand` rendered as `+36-60 to Unsummon (Paladin only)` instead of Sorceress skill range 36-60.
  4. Sunder charm affix 5 placeholder overrides.
  5. Guardian Angel empty min/max defense display.
  6. Blank Charm omission and duplicate slug collisions.
- Re-exported `web/unique_items_catalog.json` (502 items) and recompiled/published Release WebAssembly to `web/_framework/`.
- Verified live `ItemTester.d2s` mule with 80 unique items; transactional commit and backup verified. All test suites pass.
