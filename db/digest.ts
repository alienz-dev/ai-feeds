/**
 * Digest module: generate markdown signal digests from the papers database.
 */

import type { Database } from "better-sqlite3";
import { parseArgs } from "node:util";
import fs from "node:fs";
import type { PaperRow } from "./types.js";
import { openDatabase, queryPapersByDate, queryPapersByDateRange } from "./database.js";

/**
 * Generate a markdown digest for a given date (or date range).
 *
 * Options:
 * - range: "startDate:endDate" for multi-day digest
 * - threshold: minimum relevance_score (default 7)
 */
export function generateDigest(
  db: Database,
  date: string,
  options?: { range?: string; threshold?: number }
): string {
  const threshold = options?.threshold ?? 7;

  let papers: PaperRow[];
  if (options?.range) {
    const [startDate, endDate] = options.range.split(":");
    papers = queryPapersByDateRange(db, startDate, endDate, threshold);
  } else {
    papers = queryPapersByDate(db, date, threshold);
  }

  // Group by score band
  const highBand = papers.filter((p) => p.relevance_score! >= 8);
  const mediumBand = papers.filter(
    (p) => p.relevance_score! >= 7 && p.relevance_score! < 8
  );

  // Build markdown
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`title: AI Papers Signal — ${date}`);
  lines.push(`topic: ai-papers`);
  lines.push(`type: signal`);
  lines.push(`signal-source: papers`);
  lines.push(`created: ${date}`);
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# AI Papers Signal — ${date}`);
  lines.push("");

  if (papers.length === 0) {
    lines.push("No papers above threshold for this date.");
    return lines.join("\n");
  }

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Title | Score | Explanation |");
  lines.push("|-------|-------|-------------|");
  for (const paper of papers) {
    const explanation = paper.score_explanation
      ? paper.score_explanation.replace(/\|/g, "\\|").replace(/\n/g, " ")
      : "";
    lines.push(
      `| ${paper.title} | ${paper.relevance_score} | ${explanation} |`
    );
  }
  lines.push("");

  // High band (8-10)
  if (highBand.length > 0) {
    lines.push("## High (8-10)");
    lines.push("");
    for (const paper of highBand) {
      lines.push(`### ${paper.title}`);
      lines.push("");
      lines.push(`- **Score:** ${paper.relevance_score}`);
      if (paper.score_explanation) {
        lines.push(`- **Explanation:** ${paper.score_explanation}`);
      }
      if (paper.url) {
        lines.push(`- **URL:** ${paper.url}`);
      }
      const authors = paper.authors
        ? JSON.parse(paper.authors as unknown as string)
        : [];
      if (authors.length > 0) {
        lines.push(`- **Authors:** ${authors.join(", ")}`);
      }
      const categories = paper.categories
        ? JSON.parse(paper.categories as unknown as string)
        : [];
      if (categories.length > 0) {
        lines.push(`- **Categories:** ${categories.join(", ")}`);
      }
      if (paper.abstract) {
        lines.push("");
        lines.push(`> ${paper.abstract}`);
      }
      lines.push("");
    }
  }

  // Medium band (7)
  if (mediumBand.length > 0) {
    lines.push("## Medium (7)");
    lines.push("");
    for (const paper of mediumBand) {
      lines.push(`### ${paper.title}`);
      lines.push("");
      lines.push(`- **Score:** ${paper.relevance_score}`);
      if (paper.score_explanation) {
        lines.push(`- **Explanation:** ${paper.score_explanation}`);
      }
      if (paper.url) {
        lines.push(`- **URL:** ${paper.url}`);
      }
      const authors = paper.authors
        ? JSON.parse(paper.authors as unknown as string)
        : [];
      if (authors.length > 0) {
        lines.push(`- **Authors:** ${authors.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      date: { type: "string", short: "D" },
      range: { type: "string", short: "r" },
      db: { type: "string", short: "d", default: "db/ai-feeds.sqlite" },
      output: { type: "string", short: "o" },
      threshold: { type: "string", short: "t", default: "7" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: digest [options]

Options:
  -h, --help             Show this help message
  -D, --date <YYYY-MM-DD>  Date for digest (required unless --range)
  -r, --range <start:end>  Date range (YYYY-MM-DD:YYYY-MM-DD)
  -d, --db <path>        Database path (default: db/ai-feeds.sqlite)
  -o, --output <path>    Output file (default: stdout)
  -t, --threshold <n>    Minimum score threshold (default: 7)
  -v, --verbose          Enable verbose output
`);
    process.exit(0);
  }

  const date = (typeof values.date === "string" ? values.date : null) ?? new Date().toISOString().slice(0, 10);
  const dbPath = (typeof values.db === "string" ? values.db : null) ?? "db/ai-feeds.sqlite";
  const threshold = parseInt(values.threshold as string, 10);

  const db = openDatabase(dbPath);

  try {
    const output = generateDigest(db, date, {
      range: typeof values.range === "string" ? values.range : undefined,
      threshold,
    });

    if (values.output) {
      fs.writeFileSync(values.output as string, output);
      if (values.verbose) {
        console.log(`Wrote digest to ${values.output}`);
      }
    } else {
      console.log(output);
    }
  } finally {
    db.close();
  }
}

// Only run CLI when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/digest.ts") ||
    process.argv[1].endsWith("/digest.js") ||
    process.argv[1].endsWith("\\digest.ts") ||
    process.argv[1].endsWith("\\digest.js"));

if (isMain) {
  main();
}
