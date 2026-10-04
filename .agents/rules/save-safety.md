# Save File Safety & Data Integrity Invariants

These invariants are non-negotiable across every feature, mutation endpoint, and test in this repository. A single corrupted byte or failed transaction permanently destroys a player's character or stash.

## 1. Golden Fixtures & Live Saves are Inviolable
- Golden fixtures in `tests/fixtures/baselines/` and live saves in `tests/fixtures/snapshots/` MUST NEVER be edited, overwritten, or mutated.
- All mutation tests, transfers, stack modifications, and bulk mule operations MUST execute on disposable copies in temporary directories (`System.IO.Path.GetTempPath()`).
- Staging files and disposable directories must be cleaned up on both test completion and failure.

## 2. Mandatory Transactional Safeguards
- **Pre-Mutation Backups**: Every write to a `.d2s` (character) or `.d2i` (stash) file must create an atomic, timestamped backup in a dedicated `backups/` directory before touching the target file.
- **Staging & Two-Phase Commit**: Staging bytes must be written to a temporary sibling file (e.g., `.d2s.stage`) and verified before replacing the destination.
- **Rollback on Paired Commit Failure**: In dual-file operations (e.g., character-to-stash or stash-to-character item transfers), if the second file fails to write or locks, the first file must be rolled back immediately using the backup, leaving both saves byte-identical to their initial state.
- **Crash Recovery & Undo Journal**: Active transactions must persist an undo log (`.json`) on disk before committing replacements. On startup or restart, any incomplete transaction found in the journal must be recovered idempotently.

## 3. Concurrency & Revision Tokens
- Every mutation endpoint (CLI, API `/api/item/transfer`, WASM `transferItem`, stack editor) must require and validate save revision tokens.
- Stale revision tokens must be rejected without modifying either save file.
- External game writers require the game to be closed; concurrent writes between competing processes or tabs must be blocked via mutex/lock guards.

## 4. Item & Quantity Conservation
- Item transfers between containers or files must strictly conserve items: no duplicate items may ever be spawned, and no items may ever be destroyed unintentionally.
- Stackable item operations (deposit, withdrawal, quantity adjustment) must conserve exact counts down to the integer.
- Boundary violations (bank overflow, invalid charm placement, exceeding mod stack limits) must be rejected cleanly with zero replacement bytes written.
