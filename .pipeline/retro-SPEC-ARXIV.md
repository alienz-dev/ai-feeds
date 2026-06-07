# Retro: SPEC-ARXIV (arXiv Collector)

**Date:** 2026-06-07
**Spec:** specs/SPEC-ARXIV.md
**Complexity:** 4 (Medium)
**Verdict:** APPROVE_WITH_COMMENTS → all findings fixed

---

## Metrics

| Metric | Value |
|--------|-------|
| Lines of code (implementation) | 539 |
| Lines of code (tests) | 492 |
| Total | 1,031 |
| Test count | 27 |
| Test pass rate | 100% |
| Gates passed | RED ✅ GREEN ✅ Review ✅ E2E ✅ |
| Review findings (major) | 4 → all fixed |
| Review findings (minor) | 7 → all fixed |
| Coder retries | 0 |
| Total phases | 4 (design → test → implement → review) |

---

## What Worked

1. **BA → Spec → Grill flow** — the grill caught real issues before implementation (single OR query decision, shared logging, TypeScript choice). Worth the 5 minutes.
2. **Test-first barrier** — coder never saw the spec, only failing tests. Implementation was driven by test assertions, not spec prose. All 27 tests passed on first attempt.
3. **Dependency injection pattern** — `options.client` made tests fast and reliable. No real API calls in tests.
4. **Config-first design** — `loadConfig` with defaults for missing keys meant the code worked even before `config.yaml` was updated.
5. **Review caught config drift** — the spec said `max_results: 150` but `config.yaml` still had `50`. Reviewer caught it.

## What Broke

1. **Config.yaml not updated by coder** — the coder implemented the code but didn't update `config.yaml` to match the spec. The code defaulted correctly, but the config file was the spec's source of truth. **Root cause:** coder briefing didn't mention config.yaml updates.
2. **`setupLogging()` called inside `fetchArxiv`** — overrode caller's log level. **Root cause:** test didn't verify log level behavior, so coder didn't think about it.
3. **Output path wrong** — coder wrote to CWD instead of `collectors/output/`. **Root cause:** test didn't verify file path, only JSON structure.
4. **Per-category vs single OR query** — coder implemented per-category queries despite spec saying single OR. **Root cause:** test mocked at the client level, so query strategy was invisible to tests.

## Findings

### Heuristic: Config file is part of the spec
- **What:** Coder didn't update `config.yaml` to match spec values
- **Why:** Briefing said "implement code to pass tests" — config file wasn't in scope
- **Action:** Include config files in the "files you may modify" section of coder briefings when the spec references them

### Heuristic: Test the contract, not just the structure
- **What:** Tests verified JSON structure but not behavioral contracts (output path, query strategy, log level)
- **Why:** Test-manager wrote structural tests (field presence, type checks) but not behavioral tests (where does the file go, what URL is fetched)
- **Action:** Test-manager should include at least one behavioral test per design decision (DD-1 through DD-6)

### Heuristic: Dead code in interfaces
- **What:** `dryRun` option in `FetchOptions` was unused — file writing is in CLI layer
- **Why:** Interface was designed before implementation clarified the boundary
- **Action:** Review interfaces after implementation — remove unused fields

### Drop: arXiv returns 0 papers with 2-day window
- **What:** Default `days_back: 2` returned no papers
- **Why:** arXiv indexing delay means papers from the last 2 days may not be available
- **Action:** None — this is expected behavior. The `days_back: 2` default is correct for daily runs.

---

## Lessons for Next Feature

1. **Briefing should list all files the spec touches** — not just source code
2. **Test-manager should include behavioral tests** — not just structural
3. **Review findings should be categorized by root cause** — "spec drift" vs "design gap" vs "code quality"
4. **Single OR query vs per-category is a real design decision** — the grill saved us from building the wrong thing

---

## Pipeline State

```
Spec:    approved ✅
Tests:   27 written, 27 passing ✅
Code:    implemented, reviewed, all findings fixed ✅
E2E:     verified with real arXiv API ✅
```

**Status: COMPLETE**
