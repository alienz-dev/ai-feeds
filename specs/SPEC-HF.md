# SPEC-HF: HuggingFace Daily Papers Collector

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 3 (Simple)
**Phase:** 2.1 — Collectors

---

## 1. Intent

Build a HuggingFace Daily Papers collector that fetches curated AI/ML papers from HF's public API, normalizes them into the same `Paper` interface used by the arXiv collector, and writes JSON output. This is the second collector and follows the established two-file pattern (`*-client.ts` + `*.ts`).

**In scope:** HF API fetching, JSON normalization to Paper interface, dedup by paper ID, config-driven parameters, CLI with dry-run mode.

**Out of scope:** Pagination, HF community features (comments, upvotes filtering), HF Spaces/models/datasets, authentication, cross-source dedup (future).

---

## 2. Actors

| Actor | Role |
|-------|------|
| User (operator) | Runs collector manually or via cron, configures via `config.yaml` |
| HF Daily Papers API | External data source, no auth, JSON, no documented rate limit |
| AI Feeds pipeline | Consumes JSON output — must match Paper interface from arXiv collector |

---

## 3. Acceptance Criteria

### Normal Flow

**AC-1: Fetch and parse JSON**
WHEN `HfClient.fetchPapers(limit)` is called
THEN it returns `Paper[]` parsed from the HF JSON response
AND each paper has all required fields populated.

**AC-2: Field normalization**
WHEN the client normalizes HF API response
THEN:
- `paper.id` → `Paper.id`
- `paper.title` → `Paper.title` (whitespace normalized)
- `paper.summary` → `Paper.abstract`
- `paper.authors[].name` → `Paper.authors[]`
- `paper.publishedAt` → `Paper.published` AND `Paper.updated`
- URL: `https://huggingface.co/papers/{id}`
- pdf_url: `https://arxiv.org/pdf/{id}` (HF papers are arXiv papers)
- `paper.ai_keywords` → `Paper.categories` (empty array if absent)
- `primary_category`: `ai_keywords[0]` if available, else `"unknown"`

**AC-7: CLI entry point**
WHEN the user runs `npx tsx collectors/huggingface.ts`
THEN it loads config, fetches papers, writes `collectors/output/huggingface-YYYY-MM-DD.json`
AND output has `source: "huggingface"`, `fetched_at`, `total_results`, `warnings`, `papers`.

**AC-8: CLI flags**
WHEN the user runs with `--help`, `--dry-run`, `--config PATH`, or `--verbose`
THEN each flag behaves correctly (help prints usage, dry-run skips file write, config overrides path, verbose enables debug logging).

### Edge Cases

**AC-4: Deduplication by paper ID**
WHEN multiple entries have the same `paper.id`
THEN only one entry per unique ID is returned.

**AC-5: Date filtering**
WHEN `days_back` config is set
THEN only papers with `publishedAt` within the date window are returned.

**AC-6: Retry with exponential backoff**
WHEN the API returns 5xx, 429, or network error
THEN retry with exponential backoff (2^attempt seconds, capped at 30s)
AND throw after all retries exhausted.

**AC-9: Disabled collector**
WHEN `sources.huggingface.enabled: false` in config
THEN log info message and exit 0 without fetching.

### Constraints

**AC-3: Config loading with defaults**
WHEN `loadConfig(rawConfig)` is called with partial or missing config
THEN return complete `HfConfig` with defaults: `enabled: true`, `limit: 30`, `days_back: 2`, `timeout_seconds: 30`, `retries: 3`, `delay_seconds: 1.0`
AND provided values override defaults.

**AC-10: Atomic file output**
WHEN writing output
THEN use write-to-tmp-then-rename pattern
AND clean up temp file on failure.

**AC-11: Shared logging**
WHEN logging
THEN use `log` and `setupLogging` from `collectors/common.ts`.

**AC-12: User-Agent header**
WHEN making HTTP requests
THEN set `User-Agent: "ai-feeds/0.1 (HuggingFace collector)"`.

**AC-13: Unit tests**
THEN tests cover: JSON normalization, dedup, config defaults, config overrides, date filtering, empty response.

---

## 4. Design Decisions

### DD-1: Same two-file pattern as arXiv

**Decision:** `collectors/hf-client.ts` (HTTP + JSON parsing) + `collectors/huggingface.ts` (config, orchestration, CLI).

**Rationale:** Consistency. Every collector follows the same pattern.

### DD-2: Reuse Paper interface from arXiv

**Decision:** Import `Paper` type from `arxiv-client.ts` rather than redefining.

**Rationale:** Cross-source compatibility. Downstream processors work with one type.

### DD-3: No XML parser needed

**Decision:** HF returns JSON — use `response.json()` directly.

**Rationale:** No new dependency. Simpler than arXiv's XML parsing.

### DD-4: `primary_category` defaults to `"unknown"`

**Decision:** HF doesn't provide arXiv-style categories. Use `ai_keywords[0]` if available, else `"unknown"`.

**Rationale:** Honest about data quality. Don't fake `"cs.AI"` when we don't know.

---

## 5. Data Model

### Extended type (HF-specific enrichment)

```typescript
interface HfPaper extends Paper {
  upvotes?: number;
  numComments?: number;
  ai_summary?: string;
}
```

Base `Paper` interface stays unchanged for cross-source compatibility.

---

## 6. Implementation Notes

### File Structure
```
collectors/
  hf-client.ts        # HF API wrapper (fetch, JSON parse, retry)
  huggingface.ts       # Main collector + CLI
  common.ts           # (existing) shared logging
  arxiv-client.ts     # (existing) Paper type import
```

### Config Addition
Add to `config.yaml`:
```yaml
  huggingface:
    enabled: true
    limit: 30
    days_back: 2
    timeout_seconds: 30
    retries: 3
    delay_seconds: 1.0
```

---

## 7. Verification

```bash
# Dry run
npx tsx collectors/huggingface.ts --dry-run

# Full run
npx tsx collectors/huggingface.ts

# Check output
cat collectors/output/huggingface-YYYY-MM-DD.json | jq .

# Tests
npx vitest run tests/huggingface.test.ts
```

---

## 8. Clarifications (from Grill)

1. **Paper type location:** Move `Paper` interface from `arxiv-client.ts` to `collectors/common.ts`. Both collectors import from there. arXiv re-exports for backward compatibility.
2. **primary_category default:** Use `"hf-daily"` instead of `"unknown"` — identifies source, useful for grouping.
3. **Config gap:** `config.yaml` updated with missing HF keys (`days_back`, `timeout_seconds`, `retries`, `delay_seconds`) during spec approval — not left for coder.
4. **Limit:** `limit: 30` is correct — HF daily papers are curated (5-15/day), 30 is generous.
