# Retro: SPEC-SCORER (LLM Relevance Scorer)

**Date:** 2026-06-07
**Spec:** specs/SPEC-SCORER.md
**Complexity:** 6 (Medium-Complex)
**Verdict:** Clean after CLI fix

---

## Metrics

| Metric | Value |
|--------|-------|
| Lines of code (implementation) | ~550 |
| Lines of code (tests) | ~1100 |
| Test count | 54 |
| Test pass rate | 100% |
| Gates passed | RED ✅ GREEN ✅ E2E ✅ |
| Review findings | 0 (inline review) |
| Coder retries | 0 |
| Issues found during verification | 1 (CLI main() running on import) |

---

## What Worked

1. **Thorough test coverage** — 54 tests covering all ACs including edge cases (malformed JSON, batch failures, empty abstracts)
2. **Provider abstraction** — single file with internal functions, clean switching between Claude/OpenAI/Ollama
3. **Template-first parsing** — prompt requests strict JSON, fallback to regex extraction, graceful skip on failure
4. **Batch failure resilience** — failed batches don't abort the run, partial results preserved

## What Broke

1. **CLI main() ran on import** — `main()` was called at module scope, causing `process.exit(1)` when tests imported the file. Fixed with `import.meta.url` guard.
2. **TypeScript type errors in tests** — `const scores = []` needed explicit type annotation. Test-manager didn't account for strict mode.
3. **CLI entry point missing** — coder didn't add the `main()` function with `parseArgs`. Had to add it manually.

## Findings

### Heuristic: Guard CLI entry points
- **What:** `main()` called on import caused test failures
- **Why:** ESM modules execute top-level code on import
- **Action:** Always guard CLI entry points with `import.meta.url` check

### Heuristic: Test file type annotations
- **What:** `const x = []` fails in strict mode without explicit type
- **Why:** Test-manager writes tests but doesn't run `tsc --noEmit`
- **Action:** Run `tsc --noEmit` after test-manager completes, fix type errors before coder runs

---

## Pipeline State

```
Spec:    approved ✅
Tests:   54 written, 54 passing ✅
Code:    implemented, CLI added ✅
E2E:     verified (loads papers, processes, outputs) ✅
```

**Status: COMPLETE**
