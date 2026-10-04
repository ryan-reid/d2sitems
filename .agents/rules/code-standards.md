# Repository Code Standards & Conventions

These standards ensure cross-platform consistency between native .NET 10 console binaries, Blazor WebAssembly running in the browser, Python API servers, and modern vanilla JavaScript.

## 1. Indentation & Formatting
- **C#**: Exactly 4 spaces per indentation level.
- **Python**: Exactly 4 spaces per indentation level.
- **JavaScript & CSS**: Exactly 2 spaces per indentation level.
- **No Unrelated Reformatting**: Maintain surrounding file style; do not reformat entire files when making small, focused changes.

## 2. C# (.NET 10 & Blazor WASM) Conventions
- **Dual-Target Invariant**: Any logic in root C# files (`Program.cs`, `SaveInspectorEngine.cs`, `ItemTransferManager.cs`, `GameDataTables.cs`, `MuleGenerator.cs`, `SaveBackup.cs`, `SaveFileTransaction.cs`, `StackEditorManager.cs`) must compile and run cleanly on both:
  1. `d2sitems.csproj` (Native .NET 10 CLI)
  2. `src/D2SWasm/D2SWasm.csproj` (Browser WebAssembly target)
- **Nullable Annotations**: Preserve and respect `#nullable enable`. Do not introduce compiler warnings (`CS8600`, `CS8602`, `CS8604`, `CS8618`).
- **Platform Limitations**: Browser WASM runs in a single-threaded WebAssembly sandbox. Do NOT use blocking console calls (e.g. `Console.In.ReadLine()`), direct multi-threading locks that deadlock WASM, or synchronous filesystem paths not virtualized by Emscripten.
- **Naming**: PascalCase for class names, structs, interfaces, methods, and public properties. camelCase for local variables and private fields (with optional `_` prefix for private fields).

## 3. JavaScript & Web UI Conventions
- **Vanilla ES6+**: No external runtime frameworks (no React/Vue/jQuery). Keep code lightweight and fast.
- **Dual-Mode Discipline**: Always check execution mode via `state.isWasmMode`:
  - When `isWasmMode === true`: use `window.D2Wasm` methods, IndexedDB persistence, and local downloads.
  - When `isWasmMode === false`: use `/api/...` fetch endpoints with local server rollback safeguards.
- **Naming**: camelCase for functions and variables. PascalCase for class constructors. UPPER_CASE for configuration constants.
- **Strict Equality**: Always use `===` and `!==`.

## 4. Python API Conventions
- **Naming**: snake_case for functions and module-level variables. PascalCase for classes.
- **Request DTOs**: Ensure API endpoints in `web_ui.py` normalize incoming payload keys (handle snake_case, camelCase, and PascalCase gracefully) so CLI, Web UI, and external tools share identical semantics.
