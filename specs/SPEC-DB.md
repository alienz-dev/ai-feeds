# SPEC-DB: SQLite Storage + Digest Output

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 7 (Medium-Complex)
**Phase:** 2.3 — Storage & Output

---

## 1. Intent

Replace JSON-file-only pipeline with SQLite as source of truth. Ingest command loads collector/scorer JSON into DB. Digest command generates Obsidian markdown from DB.

**In scope:** SQLite schema, ingest CLI, digest CLI, shared DB module.

**Out of scope:** Direct DB writes from collectors/scorer, web UI, preference learning logic, migrations, full-text search.

---

## 2. Data Flow

```
Collectors → JSON → Ingest → SQLite → Digest → Obsidian markdown
Scorer     → JSON ↗                     ↓
                                 ~/vault/signals/YYYY-MM-DD-papers.md
```

---

## 3. Acceptance Criteria

### Schema

**AC-1: Papers table** — created on first run, arrays as JSON TEXT, dedup by normalized title (`lowercase(trim(title))`).

**AC-2: Interactions table** — FK → papers.id with CASCADE, schema only (no CLI in v1).

### Ingest

**AC-3: Ingest CLI** — `npx tsx db/ingest.ts --input <path> [--db <path>] [--verbose]`
- Upserts by dedup_key, merges sources/source_ids
- Collector JSON: first-seen content preserved (no overwrite)
- Scorer JSON: updates score fields
- Auto-creates DB + tables
- Prints summary: inserted/updated/unchanged counts
- Directory mode: processes all *.json files
- Skips invalid files with warning

### Digest

**AC-4: Digest CLI** — `npx tsx db/digest.ts --date YYYY-MM-DD [--range YYYY-MM-DD:YYYY-MM-DD] [--db <path>] [--output <path>] [--threshold <N>] [--verbose]`
- YAML frontmatter (title, topic, type, signal-source: papers, created)
- Groups by score band (High 8-10, Medium 7)
- Includes score_explanation per paper
- Threshold filtering (default from config)
- Range mode: single file for date range
- Overwrites existing file (idempotent)
- Default output: `{vault_path}/YYYY-MM-DD-papers.md`

### Config

**AC-5: Database config** — `database.path` in config.yaml, `--db` flag override, auto-create directory.

### Shared Module

**AC-6: database.ts** — `better-sqlite3`, CREATE TABLE IF NOT EXISTS, WAL mode, exported functions: `openDatabase`, `upsertPaper`, `queryPapersByDate`, `queryPapersByDateRange`.

---

## 4. Design Decisions

### DD-1: Ingest is separate from collectors/scorer

**Decision:** Collectors and scorer write JSON. Ingest is a separate CLI step.

**Rationale:** Keeps pipeline composable. User can script `scorer && ingest && digest` or run steps independently.

### DD-2: Dedup by normalized title

**Decision:** `dedup_key = title.toLowerCase().trim()`

**Rationale:** Matches existing dedup in scorer.ts. Handles cross-source duplicates (same paper from arXiv and HF).

### DD-3: First-seen wins for content

**Decision:** Collector ingest doesn't overwrite title/abstract/url. Only merges sources/source_ids.

**Rationale:** Prevents overwriting good data with incomplete data from a different source.

### DD-4: Idempotent digest (overwrite)

**Decision:** Digest overwrites existing file instead of appending suffix.

**Rationale:** Re-runs should produce the same output. Simpler than managing numbered suffixes.

### DD-5: Source from top-level JSON field

**Decision:** Use `source` field from JSON top level (`"arxiv"`, `"huggingface"`, `"scorer"`).

**Rationale:** Already present in all collector/scorer output. No filename parsing needed.

---

## 5. SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  abstract TEXT,
  url TEXT,
  pdf_url TEXT,
  authors TEXT,           -- JSON array
  categories TEXT,        -- JSON array
  primary_category TEXT,
  published TEXT,
  updated TEXT,
  sources TEXT NOT NULL,   -- JSON array ["arxiv","huggingface"]
  source_ids TEXT,         -- JSON object {"arxiv":"2606.06493v1"}
  relevance_score INTEGER,
  score_explanation TEXT,
  scored_at TEXT,
  score_interests TEXT,    -- JSON array
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_papers_published ON papers(published);
CREATE INDEX IF NOT EXISTS idx_papers_relevance ON papers(relevance_score);
CREATE INDEX IF NOT EXISTS idx_papers_first_seen ON papers(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_interactions_paper_id ON paper_interactions(paper_id);
CREATE INDEX IF NOT EXISTS idx_interactions_action ON paper_interactions(action);
```

---

## 6. Implementation Notes

### File Structure
```
db/
  database.ts     # Shared: openDatabase, schema, query helpers
  ingest.ts       # CLI: read JSON → upsert SQLite
  digest.ts       # CLI: read SQLite → generate markdown
  types.ts        # TypeScript interfaces for DB rows
```

### Dependencies
- `better-sqlite3` (new)
- `@types/better-sqlite3` (dev)

### Config Addition
```yaml
database:
  path: db/ai-feeds.sqlite
```

---

## 7. Verification

```bash
# Ingest collector output
npx tsx db/ingest.ts --input collectors/output/
# Expected: "X papers inserted, 0 updated, 0 unchanged"

# Ingest scorer output
npx tsx db/ingest.ts --input processor/output/
# Expected: "0 inserted, X updated, 0 unchanged"

# Generate digest
npx tsx db/digest.ts --date 2026-06-07
# Expected: markdown file in vault signals directory

# Verify DB
sqlite3 db/ai-feeds.sqlite "SELECT count(*) FROM papers;"
# Expected: number matching ingested papers

# Tests
npx vitest run tests/db.test.ts
```

---

## 8. Clarifications (from Grill)

*Pending grill session.*
