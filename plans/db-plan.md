# Plan: SQLite Storage + Digest (SPEC-DB)

**Spec:** specs/SPEC-DB.md
**Status:** approved
**Created:** 2026-06-07

---

## Wave 1: All implementation (single coder)

**Files to create:**
- `db/types.ts` — TypeScript interfaces for DB rows
- `db/database.ts` — openDatabase, schema, upsert, query helpers
- `db/ingest.ts` — CLI: JSON → SQLite
- `db/digest.ts` — CLI: SQLite → markdown

**Files to modify:**
- `config.yaml` — already done (database.path added)
- `tsconfig.json` — add `db/**/*.ts` to include
- `package.json` — already done (better-sqlite3 installed)

**Verification:**
- `npx tsc --noEmit` passes
- `npx vitest run tests/db.test.ts` — all pass
- `npx tsx db/ingest.ts --help` prints usage
- `npx tsx db/digest.ts --help` prints usage
- E2E: ingest → digest → verify markdown output
