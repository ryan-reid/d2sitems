---
name: backend-wasm-sync
description: >-
  Backend and WebAssembly synchronization runbook for d2sitems. Use this skill when modifying
  C# save parsing or transfer logic, adding new API endpoints in Python, or synchronizing
  compiled Blazor WebAssembly artifacts into web/_framework.
---

# Backend & WebAssembly Synchronization Runbook

In `d2sitems`, the C# business logic in root (`SaveInspectorEngine.cs`, `ItemTransferManager.cs`, `GameDataTables.cs`, etc.) is compiled into two distinct targets:
1. Native .NET 10 console executable (`d2sitems.csproj`) used by the CLI and local server.
2. WebAssembly Blazor application (`src/D2SWasm/D2SWasm.csproj`) running 100% in the browser.

## Step-by-Step Workflow

### 1. Modifying Shared C# Logic
- Keep all shared engine logic in root C# files.
- In `src/D2SWasm/D2EngineInterop.cs`, expose static interop methods callable by JS:
  - Methods accepting byte arrays and returning JSON strings or updated byte arrays.
  - Wrap exceptions cleanly and return standard JSON error objects (`{ "success": false, "message": "..." }`).

### 2. Validating Native CLI Build
Run from the repository root:
```powershell
dotnet build d2sitems.csproj
```
Ensure zero compiler errors and resolve any nullable warnings.

### 3. Compiling and Publishing WASM
Publish the WebAssembly bundle to a temporary directory, then copy into `web/_framework`:
```powershell
$tempOut = Join-Path $env:TEMP "bk-wasm-publish"
if (Test-Path $tempOut) { Remove-Item $tempOut -Recurse -Force }
dotnet publish src/D2SWasm/D2SWasm.csproj -c Release -o $tempOut

# Copy updated framework into web/
Copy-Item "$tempOut\wwwroot\_framework\*" web\_framework -Recurse -Force
```

### 4. Updating Python API Endpoints (`web_ui.py`)
When adding or altering endpoints in `web_ui.py`:
- Use `/api/...` URL patterns.
- Normalize incoming JSON parameters to handle snake_case, camelCase, and PascalCase:
  ```python
  data = request.get_json() or {}
  source_file = data.get('source_file') or data.get('SourceFile') or data.get('sourceFile')
  ```
- Always pass revision tokens to `ItemTransferManager.TransferItemBytes` or `StackEditorManager.EditStackQuantity`.
- Return standard JSON responses with explicit `Success` boolean flags and descriptive `Message` strings.

### 5. Verification
Run C# regressions to verify native compilation and logic:
```powershell
dotnet run --project tests/engine_regressions/EngineRegressions.csproj
```
Run browser regressions to verify that the newly published WASM loads and passes tests:
```powershell
node tests/run_browser_regressions.mjs
```
