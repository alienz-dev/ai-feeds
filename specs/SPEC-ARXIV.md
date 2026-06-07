# SPEC-ARXIV: arXiv Paper Collector

**Status:** approved
**Created:** 2026-06-07
**Updated:** 2026-06-07 (grill: TypeScript, shared logging, config decisions)
**Complexity:** 4 (Medium)
**Phase:** 1.1 — Foundation

---

## 1. Intent

Build a CLI collector in TypeScript that fetches new AI/ML papers from the arXiv API, deduplicates them, and writes structured JSON output. This is the first collector in the AI Feeds system and establishes patterns (data model, error handling, config-driven behavior) for all subsequent collectors.

**In scope:** arXiv API fetching, dedup by arXiv ID, JSON output, config-driven parameters, CLI with dry-run mode, shared logging utility.

**Out of scope:** LLM scoring, Obsidian markdown generation, HuggingFace collection, cross-source dedup, PDF download, web UI.

---

## 2. Actors

| Actor | Role |
|-------|------|
| User (operator) | Runs collector manually or via cron, configures via `config.yaml` |
| arXiv API | External data source, no auth, Atom XML, 3s rate limit |
| LLM Processor (downstream) | Reads JSON output for relevance scoring — not in scope |
| Obsidian Vault (downstream) | Receives formatted markdown later — not in scope |

---

## 3. Acceptance Criteria

### Normal Flow

**AC-1: Category-based fetch**
WHEN the collector is invoked with `config.yaml` containing categories `["cs.AI", "cs.CL", "cs.LG", "stat.ML"]` and `max_results: 150`
THEN the system SHALL query the arXiv API using a single OR query (`cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:stat.ML`)
AND produce a JSON file containing at most 150 records.

**AC-2: Output schema**
WHEN papers are successfully fetched
THEN each record SHALL contain:
- `id` (string): arXiv paper ID with version, e.g., `"2606.06493v1"`
- `title` (string): stripped of newlines and excess whitespace
- `abstract` (string): full abstract text
- `url` (string): abstract page URL
- `pdf_url` (string): PDF download URL
- `authors` (string[]): author names
- `categories` (string[]): all arXiv categories
- `primary_category` (string)
- `published` (string): ISO 8601
- `updated` (string): ISO 8601

AND the top-level structure SHALL be:
```json
{
  "source": "arxiv",
  "fetched_at": "2026-06-07T10:00:00Z",
  "categories_queried": ["cs.AI", "cs.CL", "cs.LG", "stat.ML"],
  "total_results": 42,
  "warnings": [],
  "papers": [ ... ]
}
```

**AC-11: CLI invocation**
WHEN the user runs `npx tsx collectors/arxiv.ts`
THEN the system SHALL fetch papers, write the output file, and print a summary to stdout
AND the exit code SHALL be 0 on success, 1 on total failure.

**AC-12: Dry-run mode**
WHEN the user runs `npx tsx collectors/arxiv.ts --dry-run`
THEN the system SHALL fetch papers and print the result count to stdout
AND NOT write any output file.

**AC-15: Help flag**
WHEN the user runs `npx tsx collectors/arxiv.ts --help`
THEN the system SHALL print usage information with all available flags and exit 0.

### Edge Cases

**AC-3: Deduplication by arXiv ID**
WHEN the same paper appears in results with different versions (e.g., `2606.06493v1` and `2606.06493v2`)
THEN the system SHALL include only the latest version in the output
AND dedup logic SHALL use the version-stripped ID (`2606.06493`) for comparison
AND the `id` field in output SHALL保留 the full versioned ID.

**AC-5: API failure handling**
WHEN the arXiv API returns an HTTP error or timeout for a query
THEN the system SHALL log the error, continue fetching, and include a `warnings` array in the output.

**AC-6: Malformed response handling**
WHEN the arXiv API returns unparseable XML
THEN the system SHALL log the error and return whatever papers were successfully parsed.

**AC-7: Empty results**
WHEN the arXiv API returns zero papers
THEN the system SHALL produce a valid JSON file with `"total_results": 0` and `"papers": []`.

### Constraints

**AC-4: Rate limiting**
WHEN multiple requests are issued
THEN the system SHALL enforce at least 3 seconds between requests
AND the delay SHALL be configurable via `config.yaml`.

**AC-8: Date filtering**
WHEN `config.yaml` contains `sources.arxiv.days_back: 2`
THEN only papers published within the last N days SHALL be included
AND the default SHALL be 2.

**AC-9: Config-driven behavior**
THEN all tunable parameters SHALL come from `config.yaml` under `sources.arxiv`:
- `categories` (default: `["cs.AI", "cs.CL", "cs.LG", "stat.ML"]`)
- `max_results` (default: 150)
- `delay_seconds` (default: 3.0)
- `days_back` (default: 2)
- `timeout_seconds` (default: 30)
- `retries` (default: 3)

WHEN `config.yaml` has no `sources.arxiv` section
THEN the system SHALL use these defaults
AND log a DEBUG message that no config section was found.

WHEN `config.yaml` has `sources.arxiv` but is missing specific keys
THEN the system SHALL use defaults for missing keys only
AND log a DEBUG message for each missing key.

**AC-10: Output file naming**
THEN the file SHALL be named `arxiv-YYYY-MM-DD.json`
AND written to `collectors/output/` (or configured path)
AND atomic write SHALL be used (write to `.tmp`, then `fs.renameSync`).

**AC-13: Logging**
THEN the system SHALL use a shared logging utility from `collectors/common.ts`
AND log at INFO: fetch start, per-category count, dedup count, output path
AND log at WARNING: API errors, missing fields
AND log at DEBUG: individual paper titles, config fallbacks.

**AC-14: Unit testability**
THEN the arXiv client dependency SHALL be injectable
AND tests SHALL cover: normal fetch, dedup, empty results, API error, malformed response.

---

## 4. Design Decisions

### DD-1: TypeScript with direct arXiv API access

**Decision:** Write in TypeScript. Implement a custom `arxiv-client.ts` wrapper instead of using the Python `arxiv` package.

**Rationale:** Consistency with the user's dev environment. Shared types with downstream TS consumers (LLM processor, Obsidian output). The ~150 lines of HTTP + XML parsing boilerplate is a one-time cost.

**Trade-off:** More boilerplate than Python's `arxiv` package, but better DX and type safety for the overall pipeline.

**Implementation:** Use `node-fetch` (or built-in `fetch` in Node 18+) for HTTP, `fast-xml-parser` for Atom XML parsing. Manual rate limiting with `setTimeout` + promisified sleep.

### DD-2: Single OR query vs per-category queries

**Decision:** Use a single query with `cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:stat.ML`.

**Rationale:** One request instead of 4 (3s vs 12s minimum). The `categories` field on each paper still tells you which categories it belongs to. Set `max_results: 150` to get broad coverage across categories.

### DD-3: Output to `collectors/output/` first

**Decision:** JSON goes to local staging dir, not directly to vault.

**Rationale:** Keeps collector decoupled from Obsidian format. The `output/obsidian.ts` module (Phase 2.3) handles vault formatting separately.

### DD-4: Dependency injection for testability

**Decision:** Accept the arXiv client as an optional constructor parameter, create default if not provided.

**Rationale:** Enables mocking in tests without monkey-patching. Clean interface for CI.

### DD-5: Dedup by version-stripped ID

**Decision:** Strip the version suffix (e.g., `v1`, `v2`) from arXiv IDs before dedup comparison. Keep the full versioned ID in the output `id` field.

**Rationale:** A revised paper isn't a new paper. The collector's purpose is "what's new today." If revision tracking is needed later, it's a separate feature.

### DD-6: Shared logging in `collectors/common.ts`

**Decision:** Add `collectors/common.ts` with a `setupLogging()` function that configures a consistent log format across all collectors.

**Rationale:** The first collector establishes patterns. Inconsistent logging across modules (some `console.log`, some structured logging) creates debugging friction. `common.ts` is ~10 lines for now, grows as shared types are added.

---

## 5. Data Model

### TypeScript Interfaces

```typescript
interface Paper {
  id: string;           // "2606.06493v1" (with version)
  title: string;
  abstract: string;
  url: string;
  pdf_url: string;
  authors: string[];
  categories: string[];
  primary_category: string;
  published: string;    // ISO 8601
  updated: string;      // ISO 8601
}

interface ArxivResult {
  source: "arxiv";
  fetched_at: string;   // ISO 8601
  categories_queried: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

interface ArxivConfig {
  enabled: boolean;
  categories: string[];
  max_results: number;
  delay_seconds: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
}
```

---

## 6. Implementation Notes

### File Structure
```
collectors/
  arxiv.ts            # Main collector module + CLI entry point
  arxiv-client.ts     # arXiv API wrapper (fetch, parse XML, paginate, rate limit)
  common.ts           # Shared logging utility (setupLogging)
  output/             # Generated JSON output directory
tests/
  test-arxiv.ts       # Unit tests with mocked API
```

### Dependencies
- `fast-xml-parser` — Atom XML parsing
- `yaml` — config file parsing
- `vitest` — test runner
- Node 18+ (built-in `fetch`)

### Config Addition
The existing `config.yaml` already has `sources.arxiv.categories` and `sources.arxiv.max_results`. Add the missing keys:
```yaml
sources:
  arxiv:
    enabled: true
    categories: [cs.AI, cs.CL, cs.LG, stat.ML]
    max_results: 150        # bumped from 50
    delay_seconds: 3.0      # NEW
    days_back: 2            # NEW
    timeout_seconds: 30     # NEW
    retries: 3              # NEW
```

---

## 7. Verification

### Manual Verification
```bash
# Install deps
npm install

# Dry run
npx tsx collectors/arxiv.ts --dry-run
# Expected: prints paper counts, no file written

# Full run
npx tsx collectors/arxiv.ts
# Expected: creates collectors/output/arxiv-YYYY-MM-DD.json
# Expected: prints summary with count, duplicates, warnings

# Help
npx tsx collectors/arxiv.ts --help
# Expected: prints usage with all flags

# Check output
cat collectors/output/arxiv-YYYY-MM-DD.json | jq .
# Expected: valid JSON with correct schema
```

### Automated Tests
```bash
npx vitest run tests/test-arxiv.ts
# Expected: all tests pass
# Tests: normal fetch, dedup, empty results, API error, malformed response, dry-run
```

### Acceptance Checklist
- [ ] `npx tsx collectors/arxiv.ts --help` prints usage
- [ ] `npx tsx collectors/arxiv.ts --dry-run` runs without error
- [ ] `npx tsx collectors/arxiv.ts` produces valid JSON
- [ ] JSON matches TypeScript interfaces in AC-2
- [ ] Duplicate papers are deduped by version-stripped ID (AC-3)
- [ ] Rate limiting enforced (AC-4)
- [ ] API errors produce warnings, not crashes (AC-5, AC-6)
- [ ] Empty results produce valid JSON (AC-7)
- [ ] Config-driven via `config.yaml` with safe defaults (AC-9)
- [ ] Atomic writes (AC-10)
- [ ] Logging works at INFO/WARNING/DEBUG via shared common.ts (AC-13)
- [ ] Tests pass with mocked API (AC-14)

---

## 8. Clarifications (from Grill Session)

1. **Config truth source:** `config.yaml` is the source of truth for `categories`. Defaults only apply when keys are missing. Existing `stat.ML` category is preserved.
2. **Missing config keys:** Collector uses hardcoded defaults for missing keys (`delay_seconds`, `days_back`, etc.) and logs a DEBUG message. Does not fail.
3. **Dedup strategy:** Version-stripped ID comparison (`2606.06493` not `2606.06493v1`). Output keeps full versioned ID.
4. **Query strategy:** Single OR query, `max_results: 150` default for broad coverage.
5. **Language:** TypeScript. Custom `arxiv-client.ts` wrapper for API access.
6. **Shared logging:** `collectors/common.ts` with `setupLogging()` establishes the pattern for all future collectors.
7. **CLI framework:** `argparse` equivalent — use Node's built-in `util.parseArgs` (Node 18.3+) for zero-dependency flag parsing. Gives `--help`, `--dry-run`, `--config PATH`.
