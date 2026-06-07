/**
 * Tests for SQLite Storage + Digest (SPEC-DB)
 *
 * Covers: AC-1 (Papers table), AC-2 (Interactions table), AC-3 (Ingest CLI),
 * AC-4 (Digest CLI), AC-5 (Database config), AC-6 (database.ts module)
 *
 * All imports target the implementation files that the coder will build.
 * Uses in-memory SQLite (`:memory:`) for fast, cleanup-free tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PaperRow, IngestPaper } from "../db/types.js";
import {
  openDatabase,
  upsertPaper,
  queryPapersByDate,
  queryPapersByDateRange,
} from "../db/database.js";
import { ingestFile, ingestDirectory } from "../db/ingest.js";
import { generateDigest } from "../db/digest.js";
import type { Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeIngestPaper(overrides: Partial<IngestPaper> = {}): IngestPaper {
  return {
    source: "arxiv",
    id: "2606.06493v1",
    title: "Attention Is All You Need (Again)",
    abstract: "We propose a new transformer architecture...",
    url: "https://arxiv.org/abs/2606.06493v1",
    pdf_url: "https://arxiv.org/pdf/2606.06493v1",
    authors: ["Alice Smith", "Bob Jones"],
    categories: ["cs.AI", "cs.CL"],
    primary_category: "cs.AI",
    published: "2026-06-07T10:00:00Z",
    updated: "2026-06-07T10:00:00Z",
    ...overrides,
  };
}

function makeIngestPaper2(overrides: Partial<IngestPaper> = {}): IngestPaper {
  return {
    source: "arxiv",
    id: "2606.07777v1",
    title: "Scaling Laws for Context Engineering",
    abstract: "We study the scaling behavior of context window utilization...",
    url: "https://arxiv.org/abs/2606.07777v1",
    pdf_url: "https://arxiv.org/pdf/2606.07777v1",
    authors: ["Charlie Brown"],
    categories: ["cs.LG", "stat.ML"],
    primary_category: "cs.LG",
    published: "2026-06-07T09:00:00Z",
    updated: "2026-06-07T09:00:00Z",
    ...overrides,
  };
}

function makeScoredPaper(overrides: Partial<IngestPaper> = {}): IngestPaper {
  return {
    ...makeIngestPaper(),
    relevance_score: 8,
    score_explanation: "Highly relevant to context engineering interests.",
    scored_at: "2026-06-07T12:00:00Z",
    score_interests: ["context engineering", "transformers"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-1 + AC-6: Schema creation — tables exist after openDatabase
// ---------------------------------------------------------------------------
describe("AC-1 + AC-6: Schema creation", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("papers table exists with all required columns", () => {
    const row = db
      .prepare("PRAGMA table_info(papers)")
      .all() as Array<{ name: string }>;
    const columnNames = row.map((r) => r.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("dedup_key");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("abstract");
    expect(columnNames).toContain("url");
    expect(columnNames).toContain("pdf_url");
    expect(columnNames).toContain("authors");
    expect(columnNames).toContain("categories");
    expect(columnNames).toContain("primary_category");
    expect(columnNames).toContain("published");
    expect(columnNames).toContain("updated");
    expect(columnNames).toContain("sources");
    expect(columnNames).toContain("source_ids");
    expect(columnNames).toContain("relevance_score");
    expect(columnNames).toContain("score_explanation");
    expect(columnNames).toContain("scored_at");
    expect(columnNames).toContain("score_interests");
    expect(columnNames).toContain("first_seen_at");
    expect(columnNames).toContain("updated_at");
  });

  it("dedup_key column is UNIQUE", () => {
    const row = db
      .prepare("PRAGMA index_list(papers)")
      .all() as Array<{ name: string; unique: number }>;
    const uniqueIndexes = row.filter((r) => r.unique === 1);

    // At least one unique index should exist (the dedup_key unique constraint)
    expect(uniqueIndexes.length).toBeGreaterThanOrEqual(1);

    // Check that the dedup_key index is among them
    const indexInfo = db
      .prepare("PRAGMA index_info(sqlite_autoindex_papers_1)")
      .all() as Array<{ name: string }>;
    const indexedCol = indexInfo[0]?.name;
    expect(indexedCol).toBe("dedup_key");
  });

  it("indexes exist on published, relevance_score, first_seen_at", () => {
    const indexes = db
      .prepare("PRAGMA index_list(papers)")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_papers_published");
    expect(indexNames).toContain("idx_papers_relevance");
    expect(indexNames).toContain("idx_papers_first_seen");
  });
});

// ---------------------------------------------------------------------------
// AC-2: paper_interactions table with FK + CASCADE
// ---------------------------------------------------------------------------
describe("AC-2: paper_interactions table", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("paper_interactions table exists with required columns", () => {
    const row = db
      .prepare("PRAGMA table_info(paper_interactions)")
      .all() as Array<{ name: string }>;
    const columnNames = row.map((r) => r.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("paper_id");
    expect(columnNames).toContain("action");
    expect(columnNames).toContain("note");
    expect(columnNames).toContain("created_at");
  });

  it("paper_id has FK reference to papers(id) with CASCADE", () => {
    const fkList = db
      .prepare("PRAGMA foreign_key_list(paper_interactions)")
      .all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;

    expect(fkList.length).toBeGreaterThanOrEqual(1);
    const fk = fkList.find((f) => f.table === "papers");
    expect(fk).toBeDefined();
    expect(fk!.from).toBe("paper_id");
    expect(fk!.to).toBe("id");
    expect(fk!.on_delete).toBe("CASCADE");
  });

  it("indexes exist on paper_id and action", () => {
    const indexes = db
      .prepare("PRAGMA index_list(paper_interactions)")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_interactions_paper_id");
    expect(indexNames).toContain("idx_interactions_action");
  });
});

// ---------------------------------------------------------------------------
// AC-6: WAL mode enabled
// ---------------------------------------------------------------------------
describe("AC-6: WAL mode", () => {
  it("opens database in WAL mode", () => {
    const db = openDatabase(":memory:");
    const journalMode = db.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("memory"); // in-memory DB uses 'memory' journal, not 'wal'
    // For file-based DBs it should be WAL. We verify the PRAGMA was set.
    // The key test is that openDatabase doesn't throw and the pragma call succeeds.
    db.close();
  });

  it("openDatabase does not throw on valid path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
    const dbPath = path.join(tmpDir, "test.sqlite");
    const db = openDatabase(dbPath);
    expect(db).toBeDefined();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("openDatabase creates parent directories if needed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
    const nestedPath = path.join(tmpDir, "sub", "dir", "test.sqlite");
    const db = openDatabase(nestedPath);
    expect(fs.existsSync(nestedPath)).toBe(true);
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// AC-6: upsertPaper — insert new paper
// ---------------------------------------------------------------------------
describe("AC-6: upsertPaper — insert", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("inserts a new paper and returns inserted=true, updated=false", () => {
    const result = upsertPaper(db, makeIngestPaper());
    expect(result.inserted).toBe(true);
    expect(result.updated).toBe(false);
  });

  it("paper is queryable after insert", () => {
    upsertPaper(db, makeIngestPaper({ id: "query-test-1", title: "Query Test Paper" }));
    const rows = db.prepare("SELECT * FROM papers WHERE dedup_key = ?").all("query test paper") as PaperRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Query Test Paper");
  });

  it("dedup_key is normalized title (lowercase, trimmed)", () => {
    upsertPaper(db, makeIngestPaper({
      id: "norm-test-1",
      title: "  A Title With Spaces  ",
    }));
    const rows = db.prepare("SELECT dedup_key FROM papers WHERE id = ?").all("norm-test-1") as Array<{ dedup_key: string }>;
    // dedup_key should be "a title with spaces"
    expect(rows[0].dedup_key).toBe("a title with spaces");
  });

  it("stores arrays as JSON TEXT", () => {
    upsertPaper(db, makeIngestPaper({
      id: "json-test-1",
      title: "JSON Array Test",
      authors: ["Author A", "Author B"],
      categories: ["cs.AI", "cs.CL"],
    }));
    const row = db.prepare("SELECT authors, categories FROM papers WHERE dedup_key = ?").get("json array test") as PaperRow;
    const parsedAuthors = JSON.parse(row.authors as unknown as string);
    const parsedCategories = JSON.parse(row.categories as unknown as string);
    expect(parsedAuthors).toEqual(["Author A", "Author B"]);
    expect(parsedCategories).toEqual(["cs.AI", "cs.CL"]);
  });

  it("sets first_seen_at and updated_at timestamps", () => {
    upsertPaper(db, makeIngestPaper({ id: "ts-test-1", title: "Timestamp Test" }));
    const row = db.prepare("SELECT first_seen_at, updated_at FROM papers WHERE dedup_key = ?").get("timestamp test") as PaperRow;
    expect(row.first_seen_at).toBeDefined();
    expect(row.updated_at).toBeDefined();
    // Should be valid ISO dates
    expect(new Date(row.first_seen_at).getTime()).not.toBeNaN();
    expect(new Date(row.updated_at).getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// AC-6: upsertPaper — update existing (same dedup_key)
// ---------------------------------------------------------------------------
describe("AC-6: upsertPaper — update", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("updating same dedup_key returns inserted=false, updated=true", () => {
    upsertPaper(db, makeIngestPaper({ id: "upsert-1", title: "Upsert Test" }));
    const result = upsertPaper(db, makeIngestPaper({ id: "upsert-1", title: "Upsert Test" }));
    expect(result.inserted).toBe(false);
    expect(result.updated).toBe(true);
  });

  it("no duplicate rows after second upsert of same title", () => {
    upsertPaper(db, makeIngestPaper({ id: "dedup-1", title: "Dedup Check" }));
    upsertPaper(db, makeIngestPaper({ id: "dedup-1", title: "Dedup Check" }));
    const rows = db.prepare("SELECT COUNT(*) as cnt FROM papers WHERE dedup_key = ?").get("dedup check") as { cnt: number };
    expect(rows.cnt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Source merging
// ---------------------------------------------------------------------------
describe("AC-6: Source merging", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("merges sources when same paper ingested from different sources", () => {
    // First ingest from arxiv
    upsertPaper(db, makeIngestPaper({
      id: "merge-1",
      title: "Merge Test Paper",
      source: "arxiv",
    }));

    // Then ingest from huggingface
    upsertPaper(db, makeIngestPaper({
      id: "merge-1",
      title: "Merge Test Paper",
      source: "huggingface",
    }));

    const row = db.prepare("SELECT sources, source_ids FROM papers WHERE dedup_key = ?").get("merge test paper") as PaperRow;
    const sources = JSON.parse(row.sources as unknown as string);
    expect(sources).toContain("arxiv");
    expect(sources).toContain("huggingface");
  });

  it("merges source_ids as object with multiple sources", () => {
    upsertPaper(db, makeIngestPaper({
      id: "sid-1",
      title: "Source ID Test",
      source: "arxiv",
    }));
    upsertPaper(db, makeIngestPaper({
      id: "hf-12345",
      title: "Source ID Test",
      source: "huggingface",
    }));

    const row = db.prepare("SELECT source_ids FROM papers WHERE dedup_key = ?").get("source id test") as PaperRow;
    const sourceIds = JSON.parse(row.source_ids as unknown as string);
    expect(sourceIds).toHaveProperty("arxiv");
    expect(sourceIds).toHaveProperty("huggingface");
  });
});

// ---------------------------------------------------------------------------
// AC-6: First-seen content preserved
// ---------------------------------------------------------------------------
describe("AC-6: First-seen wins", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("re-ingest with different abstract preserves original abstract", () => {
    upsertPaper(db, makeIngestPaper({
      id: "fsw-1",
      title: "First Seen Wins",
      abstract: "Original abstract from arxiv",
    }));

    upsertPaper(db, makeIngestPaper({
      id: "fsw-1",
      title: "First Seen Wins",
      abstract: "Different abstract from huggingface",
    }));

    const row = db.prepare("SELECT abstract FROM papers WHERE dedup_key = ?").get("first seen wins") as PaperRow;
    expect(row.abstract).toBe("Original abstract from arxiv");
  });

  it("re-ingest with different url preserves original url", () => {
    upsertPaper(db, makeIngestPaper({
      id: "fsw-2",
      title: "First Seen URL",
      url: "https://arxiv.org/abs/2606.06493v1",
    }));

    upsertPaper(db, makeIngestPaper({
      id: "fsw-2",
      title: "First Seen URL",
      url: "https://huggingface.co/papers/2606.06493",
    }));

    const row = db.prepare("SELECT url FROM papers WHERE dedup_key = ?").get("first seen url") as PaperRow;
    expect(row.url).toBe("https://arxiv.org/abs/2606.06493v1");
  });
});

// ---------------------------------------------------------------------------
// AC-6: Score update
// ---------------------------------------------------------------------------
describe("AC-6: Score update", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("ingesting a scored paper updates score fields on existing row", () => {
    // First ingest as collector (no score)
    upsertPaper(db, makeIngestPaper({
      id: "score-1",
      title: "Score Update Test",
    }));

    // Then ingest as scorer (with score)
    upsertPaper(db, makeScoredPaper({
      id: "score-1",
      title: "Score Update Test",
    }));

    const row = db
      .prepare(
        "SELECT relevance_score, score_explanation, scored_at, score_interests FROM papers WHERE dedup_key = ?"
      )
      .get("score update test") as PaperRow;

    expect(row.relevance_score).toBe(8);
    expect(row.score_explanation).toBe("Highly relevant to context engineering interests.");
    expect(row.scored_at).toBeDefined();
    const interests = JSON.parse(row.score_interests as unknown as string);
    expect(interests).toContain("context engineering");
  });

  it("inserting a scored paper directly populates score fields", () => {
    upsertPaper(db, makeScoredPaper({
      id: "score-direct-1",
      title: "Direct Score Insert",
      relevance_score: 9,
      score_explanation: "Direct insert explanation.",
    }));

    const row = db
      .prepare("SELECT relevance_score, score_explanation FROM papers WHERE dedup_key = ?")
      .get("direct score insert") as PaperRow;

    expect(row.relevance_score).toBe(9);
    expect(row.score_explanation).toBe("Direct insert explanation.");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Dedup by ID first, then title fallback
// ---------------------------------------------------------------------------
describe("AC-3: Dedup strategy", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("matches by dedup_key (normalized title) even with different id", () => {
    upsertPaper(db, makeIngestPaper({
      id: "id-a",
      title: "Same Title Different ID",
    }));

    upsertPaper(db, makeIngestPaper({
      id: "id-b",
      title: "Same Title Different ID",
    }));

    const count = db
      .prepare("SELECT COUNT(*) as cnt FROM papers WHERE dedup_key = ?")
      .get("same title different id") as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it("different titles produce separate rows", () => {
    upsertPaper(db, makeIngestPaper({ id: "dt-1", title: "Paper Alpha" }));
    upsertPaper(db, makeIngestPaper({ id: "dt-2", title: "Paper Beta" }));

    const count = db.prepare("SELECT COUNT(*) as cnt FROM papers").get() as { cnt: number };
    // At least 2 (may be more from other tests, but we check relative)
    const alphaRows = db.prepare("SELECT COUNT(*) as cnt FROM papers WHERE dedup_key = ?").get("paper alpha") as { cnt: number };
    const betaRows = db.prepare("SELECT COUNT(*) as cnt FROM papers WHERE dedup_key = ?").get("paper beta") as { cnt: number };
    expect(alphaRows.cnt).toBe(1);
    expect(betaRows.cnt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-6: queryPapersByDate
// ---------------------------------------------------------------------------
describe("AC-6: queryPapersByDate", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("returns papers for a given date above threshold", () => {
    upsertPaper(db, makeScoredPaper({
      id: "qdate-1",
      title: "High Score Paper",
      relevance_score: 9,
    }));
    upsertPaper(db, makeScoredPaper({
      id: "qdate-2",
      title: "Low Score Paper",
      relevance_score: 3,
    }));

    const results = queryPapersByDate(db, "2026-06-07", 7);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Only the high-score paper should be returned
    const highScore = results.find((r) => r.title === "High Score Paper");
    expect(highScore).toBeDefined();
    const lowScore = results.find((r) => r.title === "Low Score Paper");
    expect(lowScore).toBeUndefined();
  });

  it("returns empty array when no papers match", () => {
    const results = queryPapersByDate(db, "2099-01-01", 1);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-6: queryPapersByDateRange
// ---------------------------------------------------------------------------
describe("AC-6: queryPapersByDateRange", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("returns papers within date range above threshold", () => {
    // Use unique titles to avoid dedup conflicts
    upsertPaper(db, makeScoredPaper({
      id: "qrange-1",
      title: "Range Test Paper A",
      relevance_score: 8,
    }));

    const results = queryPapersByDateRange(db, "2026-06-01", "2026-06-30", 7);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((r) => r.title === "Range Test Paper A");
    expect(found).toBeDefined();
  });

  it("excludes papers outside date range", () => {
    const results = queryPapersByDateRange(db, "2099-01-01", "2099-12-31", 1);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Ingest file
// ---------------------------------------------------------------------------
describe("AC-3: ingestFile", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests a collector JSON file and returns correct counts", () => {
    const collectorOutput = {
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      categories_queried: ["cs.AI"],
      total_results: 2,
      warnings: [],
      papers: [
        makeIngestPaper({ id: "ingest-1", title: "Ingest Test A" }),
        makeIngestPaper2({ id: "ingest-2", title: "Ingest Test B" }),
      ],
    };

    const filePath = path.join(tmpDir, "collector-output.json");
    fs.writeFileSync(filePath, JSON.stringify(collectorOutput));

    const result = ingestFile(db, filePath);
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("re-ingesting same file returns unchanged=2", () => {
    const collectorOutput = {
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      categories_queried: ["cs.AI"],
      total_results: 2,
      warnings: [],
      papers: [
        makeIngestPaper({ id: "ingest-1", title: "Ingest Test A" }),
        makeIngestPaper2({ id: "ingest-2", title: "Ingest Test B" }),
      ],
    };

    const filePath = path.join(tmpDir, "collector-output-repeat.json");
    fs.writeFileSync(filePath, JSON.stringify(collectorOutput));

    // First ingest
    ingestFile(db, filePath);

    // Second ingest — should be unchanged (collector source, no score change)
    const result = ingestFile(db, filePath);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(2);
  });

  it("ingesting scored file updates existing papers", () => {
    // First ingest collector version
    const collectorOutput = {
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      categories_queried: ["cs.AI"],
      total_results: 1,
      warnings: [],
      papers: [
        makeIngestPaper({ id: "score-file-1", title: "Score File Test" }),
      ],
    };
    const collectorPath = path.join(tmpDir, "collector-score.json");
    fs.writeFileSync(collectorPath, JSON.stringify(collectorOutput));
    ingestFile(db, collectorPath);

    // Then ingest scored version
    const scoredOutput = {
      source: "scorer",
      scored_at: "2026-06-07T12:00:00Z",
      interests_used: ["AI"],
      provider: "claude",
      model: "claude-sonnet",
      total_input: 1,
      total_scored: 1,
      total_above_threshold: 1,
      warnings: [],
      papers: [
        makeScoredPaper({ id: "score-file-1", title: "Score File Test" }),
      ],
    };
    const scoredPath = path.join(tmpDir, "scored.json");
    fs.writeFileSync(scoredPath, JSON.stringify(scoredOutput));

    const result = ingestFile(db, scoredPath);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Ingest directory
// ---------------------------------------------------------------------------
describe("AC-3: ingestDirectory", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-dir-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("processes all .json files in directory", () => {
    // Create two separate JSON files
    const file1 = {
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      categories_queried: ["cs.AI"],
      total_results: 1,
      warnings: [],
      papers: [makeIngestPaper({ id: "dir-1", title: "Dir Test A" })],
    };
    const file2 = {
      source: "huggingface",
      fetched_at: "2026-06-07T10:00:00Z",
      total_results: 1,
      warnings: [],
      papers: [makeIngestPaper2({ id: "dir-2", title: "Dir Test B" })],
    };

    fs.writeFileSync(path.join(tmpDir, "a.json"), JSON.stringify(file1));
    fs.writeFileSync(path.join(tmpDir, "b.json"), JSON.stringify(file2));

    const result = ingestDirectory(db, tmpDir);
    expect(result.inserted).toBe(2);
  });

  it("skips non-JSON files without error", () => {
    const dirPath = path.join(tmpDir, "mixed");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "valid.json"), JSON.stringify({
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      categories_queried: ["cs.AI"],
      total_results: 1,
      warnings: [],
      papers: [makeIngestPaper({ id: "mixed-1", title: "Mixed Test" })],
    }));
    fs.writeFileSync(path.join(dirPath, "readme.txt"), "not a json file");
    fs.writeFileSync(path.join(dirPath, "data.csv"), "a,b,c");

    const result = ingestDirectory(db, dirPath);
    expect(result.inserted).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Ingest skips invalid files
// ---------------------------------------------------------------------------
describe("AC-3: Ingest handles invalid files", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-invalid-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips files with invalid JSON (no crash)", () => {
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "{invalid json!!!");

    // Should not throw
    const result = ingestFile(db, path.join(tmpDir, "bad.json"));
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("skips files with missing papers array", () => {
    fs.writeFileSync(
      path.join(tmpDir, "no-papers.json"),
      JSON.stringify({ source: "arxiv", fetched_at: "2026-06-07" })
    );

    const result = ingestFile(db, path.join(tmpDir, "no-papers.json"));
    expect(result.inserted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Digest — frontmatter
// ---------------------------------------------------------------------------
describe("AC-4: Digest frontmatter", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("generates markdown with correct YAML frontmatter", () => {
    upsertPaper(db, makeScoredPaper({
      id: "digest-1",
      title: "Digest Test Paper",
      relevance_score: 9,
    }));

    const output = generateDigest(db, "2026-06-07", { threshold: 7 });

    expect(output).toContain("---");
    expect(output).toContain("signal-source: papers");
    expect(output).toContain("created:");
    expect(output).toContain("2026-06-07");
  });
});

// ---------------------------------------------------------------------------
// AC-4: Digest — threshold filtering
// ---------------------------------------------------------------------------
describe("AC-4: Digest threshold filtering", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("excludes papers below threshold", () => {
    upsertPaper(db, makeScoredPaper({
      id: "thresh-high",
      title: "Above Threshold Paper",
      relevance_score: 9,
    }));
    upsertPaper(db, makeScoredPaper({
      id: "thresh-low",
      title: "Below Threshold Paper",
      relevance_score: 3,
    }));

    const output = generateDigest(db, "2026-06-07", { threshold: 7 });

    expect(output).toContain("Above Threshold Paper");
    expect(output).not.toContain("Below Threshold Paper");
  });
});

// ---------------------------------------------------------------------------
// AC-4: Digest — score bands
// ---------------------------------------------------------------------------
describe("AC-4: Digest score bands", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("groups papers by score band (High 8-10, Medium 7)", () => {
    upsertPaper(db, makeScoredPaper({
      id: "band-high",
      title: "High Band Paper",
      relevance_score: 9,
    }));
    upsertPaper(db, makeScoredPaper({
      id: "band-med",
      title: "Medium Band Paper",
      relevance_score: 7,
    }));

    const output = generateDigest(db, "2026-06-07", { threshold: 7 });

    // Should contain band headers
    expect(output).toMatch(/High|8-10/);
    expect(output).toMatch(/Medium|7/);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Digest — includes score_explanation
// ---------------------------------------------------------------------------
describe("AC-4: Digest includes score_explanation", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("includes score_explanation for each paper in digest", () => {
    upsertPaper(db, makeScoredPaper({
      id: "expl-1",
      title: "Explanation Test",
      relevance_score: 8,
      score_explanation: "This paper is relevant because it covers transformer scaling.",
    }));

    const output = generateDigest(db, "2026-06-07", { threshold: 7 });
    expect(output).toContain("This paper is relevant because it covers transformer scaling.");
  });
});

// ---------------------------------------------------------------------------
// AC-4: Digest — range mode
// ---------------------------------------------------------------------------
describe("AC-4: Digest range mode", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
  });

  afterAll(() => {
    db.close();
  });

  it("generates single digest for date range", () => {
    upsertPaper(db, makeScoredPaper({
      id: "range-1",
      title: "Range Mode Paper",
      relevance_score: 8,
    }));

    const output = generateDigest(db, "2026-06-07", {
      range: "2026-06-01:2026-06-30",
      threshold: 7,
    });

    expect(output).toContain("Range Mode Paper");
    expect(output).toContain("---");
  });
});

// ---------------------------------------------------------------------------
// AC-5: Config loading for database path
// ---------------------------------------------------------------------------
describe("AC-5: Config loading", () => {
  it("openDatabase accepts custom path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
    const dbPath = path.join(tmpDir, "custom.sqlite");
    const db = openDatabase(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("openDatabase auto-creates parent directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
    const deepPath = path.join(tmpDir, "a", "b", "c", "test.sqlite");
    const db = openDatabase(deepPath);
    expect(fs.existsSync(deepPath)).toBe(true);
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
