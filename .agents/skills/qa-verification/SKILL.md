---
name: qa-verification
description: >-
  QA and automated test execution runbook for d2sitems. Use this skill when verifying pull
  requests, running the 4-tier regression suite, executing byte-diff conservation checks,
  or diagnosing test failures.
---

# QA & Test Automation Runbook

The `d2sitems` test suite verifies save safety, core engine regressions, API contracts, and browser WebAssembly automation across 4 distinct tiers.

## The 4-Tier Test Matrix

```
┌────────────────────────────────────────────────────────┐
│ Tier 1: C# Save Safety & Transaction Recovery          │
│ Command: dotnet run --project tests/save_safety/       │
├────────────────────────────────────────────────────────┤
│ Tier 2: C# Engine Regressions & Byte Conservation       │
│ Command: dotnet run --project tests/engine_regressions/│
├────────────────────────────────────────────────────────┤
│ Tier 3: Python API & Mod Catalog Unit Tests            │
│ Command: python -m unittest tests/test_catalog.py ...  │
├────────────────────────────────────────────────────────┤
│ Tier 4: Headless Browser & WASM Automation             │
│ Command: node tests/run_browser_regressions.mjs        │
└────────────────────────────────────────────────────────┘
```

## Running the Complete Suite (One-Shot)

To run all 4 tiers in sequence with formatted output and timing:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_all_qa.ps1
```

## Individual Tier Procedures

### Tier 1: Save Safety & Crash Recovery
- Project: `tests/save_safety/SaveSafety.csproj`
- Validates:
  - Atomic backups before file writes.
  - Staging file isolation and cleanup.
  - Rollback on locked second destination file.
  - Interrupted transaction recovery via journal.
  - Competing writer rejection.

### Tier 2: Engine Regressions & Fixtures
- Project: `tests/engine_regressions/EngineRegressions.csproj`
- Validates:
  - Character generation for all 8 classes from mod charstats.
  - Advanced bank deposit/withdrawal quantity conservation.
  - Quest reward idempotence.
  - Exact stack editing and bounds checking.
  - Parity between C# CLI and WASM engines on baseline fixtures.

### Tier 3: Python API & Catalog
- Script: `tests/test_catalog.py`, `tests/test_api.py`
- Validates:
  - Artwork resolution (BKDiablo priority over retail fallback).
  - Stash selection based on character core (softcore vs hardcore).
  - API endpoint responses and status codes.

### Tier 4: Headless Browser WASM Automation
- Runner: `tests/run_browser_regressions.mjs`
- Test Page: `tests/browser_regressions.html` (served via HTTP server)
- Validates:
  - 100% offline browser WASM ingestion of `.d2s` and `.d2i` files.
  - In-memory item transfers and stack editing.
  - IndexedDB paired commit persistence and original byte retention.
  - Session isolation across different imported folders.
