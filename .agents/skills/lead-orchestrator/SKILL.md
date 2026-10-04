---
name: lead-orchestrator
description: >-
  Lead Developer and Architect runbook for d2sitems. Use this skill when planning new features,
  breaking down work across backend/frontend/data/QA, establishing contracts, and executing the
  Definition of Done release gating.
---

# Lead Developer & Architect Orchestration Runbook

The Lead Developer is responsible for system integrity, architectural standards, and orchestrating work across specialized subagents and skills.

## Feature Implementation Lifecycle

When taking on a new feature or complex bugfix, follow this standard lifecycle:

```
[Requirement / Feature Request]
           │
           ▼
1. System Contract & Data Flow Planning
   - Define data schemas, DTOs, and endpoints.
   - Clarify behavior in both Local Mode and WASM Mode.
           │
           ▼
2. Delegation & Parallel Execution
   - Backend: C# engine logic, DTO mapping, dual-target build.
   - Frontend: UI components, DOM updates, mode routing.
   - UX / Styling: Authentic D2R aesthetics, 390px mobile layout.
           │
           ▼
3. Verification & Gating
   - Execute SaveSafety & EngineRegressions.
   - Execute Python API & Catalog tests.
   - Execute Browser WASM automation.
           │
           ▼
4. Definition of Done & Checkoff
```

## Definition of Done (Release Gate)

Before marking any item in `docs/REPAIR_CHECKLIST.md` or declaring a feature complete, verify:

1. **Dual Build Verification**:
   - `dotnet build d2sitems.csproj` succeeds with 0 errors.
   - `dotnet publish src/D2SWasm/D2SWasm.csproj -c Release` succeeds.
   - `web/_framework` is updated with fresh WASM artifacts.
2. **Dual Mode Functional Parity**:
   - Feature functions identically with local Python/C# backend (`web_ui.py`).
   - Feature functions identically in offline browser WASM mode (`d2_wasm_engine.js`).
3. **Safety & Conservation**:
   - No golden fixtures in `tests/fixtures/` were modified.
   - Staging files and backups are cleaned up properly.
   - Revision tokens guard against stale concurrent writes.
4. **All 4 Test Tiers Pass**:
   - `powershell -ExecutionPolicy Bypass -File scripts/run_all_qa.ps1` returns exit code 0.
5. **Git Working Tree Hygiene**:
   - No leftover scratch or debug files committed.
