/**
 * Ingest module: read collector/scorer JSON files and upsert into DB.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Database } from "better-sqlite3";
import type { IngestPaper } from "./types.js";
import { openDatabase, upsertPaper } from "./database.js";

/**
 * Ingest a single JSON file (collector or scorer output).
 * Returns counts: inserted, updated, unchanged.
 */
export function ingestFile(
  db: Database,
  filePath: string
): { inserted: number; updated: number; unchanged: number } {
  let data: any;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    data = JSON.parse(raw);
  } catch {
    return { inserted: 0, updated: 0, unchanged: 0 };
  }

  if (!Array.isArray(data.papers)) {
    return { inserted: 0, updated: 0, unchanged: 0 };
  }

  const source: string = data.source ?? "unknown";
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const paper of data.papers) {
    const ingestPaper: IngestPaper = {
      source,
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      url: paper.url,
      pdf_url: paper.pdf_url,
      authors: paper.authors,
      categories: paper.categories,
      primary_category: paper.primary_category,
      published: paper.published,
      updated: paper.updated,
      source_id: paper.source_id,
      relevance_score: paper.relevance_score,
      score_explanation: paper.score_explanation,
      scored_at: paper.scored_at,
      score_interests: paper.score_interests,
    };

    // Check if paper already exists to determine if this is a real update
    const dedupKey = paper.title.toLowerCase().trim();
    const existing = db
      .prepare("SELECT * FROM papers WHERE dedup_key = ?")
      .get(dedupKey) as any;

    const result = upsertPaper(db, ingestPaper);

    if (result.inserted) {
      inserted++;
    } else if (result.updated) {
      // Determine if this was a meaningful update or just a re-ingest
      // If existing paper had no score and this one has score => real update
      // If existing paper already had score and this one has score => check if different
      // If no score fields in ingest => check if sources changed
      const hadScore =
        existing &&
        existing.relevance_score !== null &&
        existing.relevance_score !== undefined;
      const hasNewScore =
        ingestPaper.relevance_score !== undefined &&
        ingestPaper.relevance_score !== null;

      if (hasNewScore && !hadScore) {
        // Score was added — real update
        updated++;
      } else if (hasNewScore && hadScore) {
        // Score existed — check if it changed
        if (existing.relevance_score !== ingestPaper.relevance_score) {
          updated++;
        } else {
          unchanged++;
        }
      } else {
        // No score fields — check if sources changed
        const existingSources: string[] = existing.sources
          ? JSON.parse(existing.sources)
          : [];
        if (!existingSources.includes(source)) {
          updated++;
        } else {
          unchanged++;
        }
      }
    }
  }

  return { inserted, updated, unchanged };
}

/**
 * Ingest all *.json files in a directory.
 * Returns aggregate counts.
 */
export function ingestDirectory(
  db: Database,
  dirPath: string
): { inserted: number; updated: number; unchanged: number } {
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const result = ingestFile(db, filePath);
    inserted += result.inserted;
    updated += result.updated;
    unchanged += result.unchanged;
  }

  return { inserted, updated, unchanged };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      input: { type: "string", short: "i" },
      db: { type: "string", short: "d", default: "db/ai-feeds.sqlite" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: ingest [options]

Options:
  -h, --help           Show this help message
  -i, --input <path>   Input file or directory (required)
  -d, --db <path>      Database path (default: db/ai-feeds.sqlite)
  -v, --verbose        Enable verbose output
`);
    process.exit(0);
  }

  if (!values.input) {
    console.error("Error: --input is required.");
    process.exit(1);
  }

  const inputPath = values.input as string;
  const dbPath = values.db as string;

  const db = openDatabase(dbPath);

  try {
    const stat = fs.statSync(inputPath);
    let result: { inserted: number; updated: number; unchanged: number };

    if (stat.isDirectory()) {
      result = ingestDirectory(db, inputPath);
    } else {
      result = ingestFile(db, inputPath);
    }

    if (values.verbose) {
      console.log(
        `Ingested: ${result.inserted} inserted, ${result.updated} updated, ${result.unchanged} unchanged`
      );
    }

    console.log(
      JSON.stringify(result)
    );
  } finally {
    db.close();
  }
}

// Only run CLI when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/ingest.ts") ||
    process.argv[1].endsWith("/ingest.js") ||
    process.argv[1].endsWith("\\ingest.ts") ||
    process.argv[1].endsWith("\\ingest.js"));

if (isMain) {
  main();
}
