# Retro: SPEC-DB (SQLite Storage + Digest)

**Date:** 2026-06-07
**Spec:** specs/SPEC-DB.md
**Complexity:** 7 (Medium-Complex)
**Verdict:** Clean after type fixes

---

## Metrics

| Metric | Value |
|--------|-------|
| Lines of code (implementation) | ~500 |
| Lines of code (tests) | ~900 |
| Test count | 42 |
| Test pass rate | 100% |
| Gates passed | RED ✅ GREEN ✅ E2E ✅ |
| Type errors fixed | 3 (better-sqlite3 imports, parseArgs types) |

---

## What Worked

1. **In-memory SQLite for tests** — fast, no cleanup, 42 tests in 167ms
2. **Separate ingest/digest** — composable pipeline, each step testable independently
3. **Spec covered edge cases** — first-seen wins, source merging, score updates

## What Broke

1. **better-sqlite3 type imports** — `import Database from "better-sqlite3"` doesn't work as a type. Needed `import BetterSqlite3 from "better-sqlite3"` + `type Database = BetterSqlite3.Database`.
2. **parseArgs returns `string | boolean | undefined`** — needed explicit type guards instead of `as string` casts.

## Findings

### Heuristic: better-sqlite3 import pattern
- **What:** Default import doesn't export the type correctly
- **Action:** Use `import BetterSqlite3 from "better-sqlite3"` + type alias

### Heuristic: parseArgs type narrowing
- **What:** `values.x as string` fails when type is `string | boolean | undefined`
- **Action:** Use `typeof values.x === "string" ? values.x : defaultValue`

---

**Status: COMPLETE**
