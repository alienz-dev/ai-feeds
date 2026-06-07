# Plan: arXiv Collector (SPEC-ARXIV)

**Spec:** specs/SPEC-ARXIV.md
**Status:** complete
**Created:** 2026-06-07

---

## Dependency Graph

```
package.json + tsconfig.json  (foundation)
         │
    ┌────┴────┐
    ▼         ▼
common.ts  config.yaml update
    │
    ▼
arxiv-client.ts  (depends on common.ts)
    │
    ▼
arxiv.ts  (depends on arxiv-client.ts + common.ts)
    │
    ▼
tests/test-arxiv.ts  (depends on all source files)
```

---

## Wave 1: Foundation

**Goal:** Project setup, shared logging, config update

**Files:**
- `package.json` — dependencies: `fast-xml-parser`, `yaml`; devDeps: `vitest`, `tsx`, `typescript`, `@types/node`
- `tsconfig.json` — strict mode, ESNext target, NodeNext module resolution
- `collectors/common.ts` — `setupLogging()` function, consistent format
- `config.yaml` — add `delay_seconds`, `days_back`, `timeout_seconds`, `retries`, bump `max_results` to 150

**Verification:**
- `npx tsc --noEmit` passes
- `import { setupLogging } from './collectors/common'` resolves
- `config.yaml` parses with all required keys

---

## Wave 2: arXiv API Client

**Goal:** Implement the arXiv API wrapper with fetch, XML parsing, rate limiting, retry

**Files:**
- `collectors/arxiv-client.ts` — `ArxivClient` class with `fetchPapers(categories, maxResults, daysBack)` method

**Key implementation details:**
- Build query string: `cat:cs.AI OR cat:cs.CL OR ...`
- Fetch from `http://export.arxiv.org/api/query?search_query=...&start=0&max_results=...&sortBy=submittedDate&sortOrder=descending`
- Parse Atom XML with `fast-xml-parser`
- Rate limit with `await sleep(delaySeconds * 1000)`
- Retry on HTTP errors (configurable attempts)
- Return `Paper[]` with all fields from AC-2

**Verification:**
- `npx tsc --noEmit` passes
- `ArxivClient` can be instantiated with mock fetch
- Unit test: mock HTTP response → correct `Paper[]` output

---

## Wave 3: Collector CLI + Tests

**Goal:** Main collector entry point with CLI flags, plus full test suite

**Files:**
- `collectors/arxiv.ts` — CLI entry point with `--help`, `--dry-run`, `--config PATH`
- `tests/test-arxiv.ts` — tests for: normal fetch, dedup, empty results, API error, malformed response, dry-run, config defaults

**Key implementation details:**
- `util.parseArgs` for flag parsing
- Load config from `config.yaml` with defaults for missing keys (AC-9)
- Instantiate `ArxivClient`, fetch papers, dedup by version-stripped ID (AC-3)
- Atomic write to `collectors/output/arxiv-YYYY-MM-DD.json` (AC-10)
- Summary output to stdout (AC-11)
- Shared logging via `common.ts` (AC-13)

**Verification:**
- `npx tsx collectors/arxiv.ts --help` prints usage
- `npx tsx collectors/arxiv.ts --dry-run` runs without error (hits real API, no file written)
- `npx tsx collectors/arxiv.ts` produces valid JSON in `collectors/output/`
- `npx vitest run tests/test-arxiv.ts` — all tests pass

---

## Gates

| Gate | Command | Expected |
|------|---------|----------|
| TypeScript compiles | `npx tsc --noEmit` | exit 0 |
| Tests pass | `npx vitest run tests/test-arxiv.ts` | all green |
| CLI help | `npx tsx collectors/arxiv.ts --help` | prints usage, exit 0 |
| CLI dry-run | `npx tsx collectors/arxiv.ts --dry-run` | prints counts, exit 0 |
| Full run | `npx tsx collectors/arxiv.ts` | valid JSON output |
| JSON schema | `cat collectors/output/arxiv-*.json \| jq .papers[0]` | matches Paper interface |
