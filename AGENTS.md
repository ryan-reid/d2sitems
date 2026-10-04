# Repository Guidelines

## Project Structure & Module Organization

- Root C# files implement the .NET 10 CLI and save engine: `Program.cs`, `SaveInspectorEngine.cs`, `ItemTransferManager.cs`, `MuleGenerator.cs`, and related helpers.
- `web_ui.py` serves the local UI and API; `find_items.py`, `fetch.py`, and `mule.py` provide command-line utilities.
- `web/` contains HTML, CSS, JavaScript, and item artwork in `web/assets/`. Treat `web/_framework/` as generated WebAssembly output.
- `src/D2SWasm/` links shared root C# engine files and embeds game data for browser execution. Keep shared logic compatible with both targets.
- `tests/` contains browser checks, a snapshot harness, the C# inspector, and save fixtures under `tests/fixtures/`.

## Build, Test, and Development Commands

Run commands from the repository root with the .NET 10 SDK and Python installed.

- `dotnet build d2sitems.csproj` — compile the CLI.
- `dotnet run -- "path/to/saves"` — parse saves and generate searchable JSON; configure game data paths first.
- `python web_ui.py --no-browser` — serve the explorer at `http://localhost:5000`; `run_ui.bat` also opens a browser.
- `dotnet publish src/D2SWasm/D2SWasm.csproj -c Release -o web/wasm` — publish the browser engine. Copy `web/wasm/wwwroot/_framework` into `web/` for local use, matching `.github/workflows/deploy-pages.yml`.
- `python tests/snapshot_harness.py --help` — list snapshot capture and byte-diff commands.

## Coding Style & Naming Conventions

Match surrounding code: four-space indentation for C# and Python, two spaces for JavaScript. Use PascalCase for C# types and public members, snake_case for Python functions, and camelCase for JavaScript variables and functions. Preserve C# nullable annotations. No repository-wide formatter or linter is configured; avoid unrelated reformatting.

## Testing Guidelines

Run `dotnet run --project tests/save_safety/SaveSafety.csproj` for crash recovery and `dotnet run --project tests/engine_regressions/EngineRegressions.csproj` for fixture/parsing checks. Run `python -m unittest tests/test_catalog.py tests/test_api.py` for catalog/API checks. Serve the repository root and open `tests/browser_regressions.html` for WASM checks. No coverage threshold is configured. Use disposable copies and byte diffs for mutations; preserve golden fixtures.


## Commit & Pull Request Guidelines

History mixes imperative subjects with `feat(scope):` and `fix(scope):`; use concise, action-oriented messages. PRs should explain behavior changes, reference relevant issues, list validation performed, and include screenshots for UI changes.

## Save Safety & Configuration

Configure `d2sitems.conf` for local save and extracted game-data paths. Preserve backup and transactional safeguards when changing save-writing code. Use disposable copies for mutation tests; never overwrite golden fixtures casually.

## BKDiablo Data Priority

Use BKDiablo definitions, layouts, and artwork first; use retail only for missing matches. Consult BT-BKDiff parsing conventions. Record provenance and keep `docs/REPAIR_CHECKLIST.md` current.
