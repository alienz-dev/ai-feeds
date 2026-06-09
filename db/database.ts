/**
 * SQLite database module: open, schema, upsert, query.
 */

import BetterSqlite3 from "better-sqlite3";
import type { PaperRow, IngestPaper } from "./types.js";
import fs from "node:fs";
import path from "node:path";

type Database = BetterSqlite3.Database;

/**
 * Initialize the ai-feeds papers table on an existing database connection.
 * Use this when sharing a DB with nexus (via createContext).
 */
export function initPapersTable(db: Database): void {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      dedup_key TEXT NOT NULL PRIMARY KEY,
      id TEXT UNIQUE,
      title TEXT NOT NULL,
      abstract TEXT,
      url TEXT,
      pdf_url TEXT,
      authors TEXT,
      categories TEXT,
      primary_category TEXT,
      published TEXT,
      updated TEXT,
      sources TEXT NOT NULL,
      source_ids TEXT,
      relevance_score INTEGER,
      score_explanation TEXT,
      scored_at TEXT,
      score_interests TEXT,
      nexus_boost REAL DEFAULT 0,
      nexus_reasons TEXT DEFAULT '[]',
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Migration: add nexus columns if missing
  try {
    db.prepare("SELECT nexus_boost FROM papers LIMIT 0").get();
  } catch {
    db.exec(`ALTER TABLE papers ADD COLUMN nexus_boost REAL DEFAULT 0`);
    db.exec(`ALTER TABLE papers ADD COLUMN nexus_reasons TEXT DEFAULT '[]'`);
  }

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_papers_published ON papers(published);
    CREATE INDEX IF NOT EXISTS idx_papers_relevance ON papers(relevance_score);
    CREATE INDEX IF NOT EXISTS idx_papers_first_seen ON papers(first_seen_at);
    CREATE INDEX IF NOT EXISTS idx_interactions_paper_id ON paper_interactions(paper_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_action ON paper_interactions(action);
  `);
}

/**
 * Open (or create) the SQLite database, run migrations, enable WAL mode.
 * Use this for standalone operation (not sharing DB with nexus).
 */
export function openDatabase(dbPath: string): Database {
  // Create parent directories if needed (skip for :memory:)
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new BetterSqlite3(dbPath);

  // Enable WAL mode (for :memory: it becomes 'memory' journal, which is fine)
  db.pragma("journal_mode = WAL");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Initialize tables
  initPapersTable(db);

  return db;
}

/**
 * Upsert a paper into the database.
 *
 * Dedup strategy:
 * 1. ID-first: if source_id matches an existing source_ids entry, update that row
 * 2. Title-fallback: if no ID match, use dedup_key (normalized title)
 *
 * Returns { inserted, updated } — exactly one is true.
 */
export function upsertPaper(
  db: Database,
  paper: IngestPaper
): { inserted: boolean; updated: boolean } {
  const dedupKey = paper.title.toLowerCase().trim();
  const now = new Date().toISOString();
  const sourcesJson = JSON.stringify([paper.source]);
  const sourceIdsObj: Record<string, string> = {};
  if (paper.id) {
    sourceIdsObj[paper.source] = paper.id;
  }
  if (paper.source_id) {
    sourceIdsObj[paper.source] = paper.source_id;
  }
  const sourceIdsJson = JSON.stringify(sourceIdsObj);

  // Step 1: Try to find existing row by source_id (ID-first dedup)
  let existing: PaperRow | undefined;
  const lookupId = paper.id ?? paper.source_id;

  if (lookupId) {
    // Search source_ids JSON for the ID
    const allRows = db
      .prepare("SELECT * FROM papers")
      .all() as PaperRow[];
    existing = allRows.find((row) => {
      if (!row.source_ids) return false;
      try {
        const ids = JSON.parse(row.source_ids as unknown as string);
        return Object.values(ids).includes(lookupId);
      } catch {
        return false;
      }
    });
  }

  // Step 2: If no ID match, try title fallback
  if (!existing) {
    existing = db
      .prepare("SELECT * FROM papers WHERE dedup_key = ?")
      .get(dedupKey) as PaperRow | undefined;
  }

  if (existing) {
    // Update existing row
    // Merge sources
    const existingSources: string[] = JSON.parse(
      existing.sources as unknown as string
    );
    if (!existingSources.includes(paper.source)) {
      existingSources.push(paper.source);
    }

    // Merge source_ids
    const existingSourceIds: Record<string, string> = existing.source_ids
      ? JSON.parse(existing.source_ids as unknown as string)
      : {};
    if (lookupId) {
      existingSourceIds[paper.source] = lookupId;
    }

    // Determine if this is a scorer update (has score fields)
    const isScorerUpdate =
      paper.relevance_score !== undefined && paper.relevance_score !== null;

    if (isScorerUpdate) {
      // Update score fields
      db.prepare(
        `UPDATE papers SET
          sources = ?,
          source_ids = ?,
          relevance_score = ?,
          score_explanation = ?,
          scored_at = ?,
          score_interests = ?,
          nexus_boost = ?,
          nexus_reasons = ?,
          updated_at = ?
        WHERE dedup_key = ?`
      ).run(
        JSON.stringify(existingSources),
        JSON.stringify(existingSourceIds),
        paper.relevance_score,
        paper.score_explanation ?? null,
        paper.scored_at ?? now,
        paper.score_interests ? JSON.stringify(paper.score_interests) : null,
        paper.nexus_boost ?? 0,
        paper.nexus_reasons ? JSON.stringify(paper.nexus_reasons) : "[]",
        now,
        existing.dedup_key
      );
    } else {
      // Collector re-ingest: merge sources/source_ids, DON'T overwrite content
      db.prepare(
        `UPDATE papers SET
          sources = ?,
          source_ids = ?,
          updated_at = ?
        WHERE dedup_key = ?`
      ).run(
        JSON.stringify(existingSources),
        JSON.stringify(existingSourceIds),
        now,
        existing.dedup_key
      );
    }

    return { inserted: false, updated: true };
  }

  // Insert new paper — dedup_key is the PK, id stores source ID
  const sourceId = paper.id ?? paper.source_id ?? null;
  db.prepare(
    `INSERT INTO papers (
      dedup_key, id, title, abstract, url, pdf_url, authors, categories,
      primary_category, published, updated, sources, source_ids,
      relevance_score, score_explanation, scored_at, score_interests,
      nexus_boost, nexus_reasons,
      first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dedupKey,
    sourceId,
    paper.title,
    paper.abstract ?? null,
    paper.url ?? null,
    paper.pdf_url ?? null,
    paper.authors ? JSON.stringify(paper.authors) : null,
    paper.categories ? JSON.stringify(paper.categories) : null,
    paper.primary_category ?? null,
    paper.published ?? null,
    paper.updated ?? null,
    sourcesJson,
    Object.keys(sourceIdsObj).length > 0 ? sourceIdsJson : null,
    paper.relevance_score ?? null,
    paper.score_explanation ?? null,
    paper.scored_at ?? null,
    paper.score_interests ? JSON.stringify(paper.score_interests) : null,
    paper.nexus_boost ?? 0,
    paper.nexus_reasons ? JSON.stringify(paper.nexus_reasons) : "[]",
    now,
    now
  );

  return { inserted: true, updated: false };
}

/**
 * Query papers for a given date where relevance_score >= threshold.
 */
export function queryPapersByDate(
  db: Database,
  date: string,
  threshold: number,
  includeUnscored: boolean = false
): PaperRow[] {
  const scoreFilter = includeUnscored
    ? `AND (relevance_score >= ? OR relevance_score IS NULL)`
    : `AND relevance_score >= ?`;
  return db
    .prepare(
      `SELECT * FROM papers
       WHERE date(first_seen_at) = ?
         ${scoreFilter}`
    )
    .all(date, threshold) as PaperRow[];
}

/**
 * Query papers within a date range where relevance_score >= threshold.
 */
export function queryPapersByDateRange(
  db: Database,
  startDate: string,
  endDate: string,
  threshold: number,
  includeUnscored: boolean = false
): PaperRow[] {
  const scoreFilter = includeUnscored
    ? `AND (relevance_score >= ? OR relevance_score IS NULL)`
    : `AND relevance_score >= ?`;
  return db
    .prepare(
      `SELECT * FROM papers
       WHERE date(first_seen_at) >= ?
         AND date(first_seen_at) <= ?
         ${scoreFilter}`
    )
    .all(startDate, endDate, threshold) as PaperRow[];
}
