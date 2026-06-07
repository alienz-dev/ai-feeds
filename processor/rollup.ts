/**
 * Weekly Rollup — aggregate daily signals into a weekly summary.
 *
 * SPEC-ROLLUP: AC-1 (query weekly data), AC-2 (statistics), AC-3 (markdown),
 * AC-4 (CLI), AC-5 (output path).
 */

import { openDatabase, queryPapersByDateRange } from "../db/database.js";
import type { PaperRow } from "../db/types.js";
import { log, setupLogging } from "../collectors/common.js";
import type { Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

// ---------------------------------------------------------------------------
// ISO week helpers
// ---------------------------------------------------------------------------

/**
 * Get the ISO week number and year for a given date.
 * Returns { year, week } where week is 1-53.
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1)
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getUTCFullYear(), week };
}

/**
 * Format an ISO week as "YYYY-Www" (e.g. "2026-W23").
 */
function formatISOWeek(date: Date): string {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Get the start (Monday) and end (Sunday) of the ISO week containing `date`.
 */
function getWeekRange(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const day = d.getDay() || 7; // Mon=1..Sun=7
  // Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  // Sunday
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

// ---------------------------------------------------------------------------
// Statistics computation
// ---------------------------------------------------------------------------

interface RollupStats {
  total: number;
  highRelevance: number; // score >= 8
  mediumRelevance: number; // score == 7
  topPapers: PaperRow[];
  categoryDistribution: [string, number][];
  sourceDistribution: [string, number][];
}

function computeStats(papers: PaperRow[]): RollupStats {
  const total = papers.length;
  const highRelevance = papers.filter(
    (p) => p.relevance_score !== null && p.relevance_score >= 8
  ).length;
  const mediumRelevance = papers.filter(
    (p) => p.relevance_score === 7
  ).length;

  // Top 5 papers by score (descending)
  const sorted = [...papers]
    .filter((p) => p.relevance_score !== null)
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
  const topPapers = sorted.slice(0, 5);

  // Category distribution
  const categoryMap = new Map<string, number>();
  for (const paper of papers) {
    if (paper.categories) {
      const cats: string[] = JSON.parse(paper.categories);
      for (const cat of cats) {
        categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
      }
    }
  }
  const categoryDistribution = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Source distribution
  const sourceMap = new Map<string, number>();
  for (const paper of papers) {
    const sources: string[] = JSON.parse(paper.sources);
    for (const src of sources) {
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
    }
  }
  const sourceDistribution = [...sourceMap.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  return {
    total,
    highRelevance,
    mediumRelevance,
    topPapers,
    categoryDistribution,
    sourceDistribution,
  };
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

/**
 * Generate a weekly rollup markdown string from computed statistics.
 */
function generateMarkdown(
  weekLabel: string,
  created: string,
  stats: RollupStats
): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`title: "Weekly Rollup ${weekLabel}"`);
  lines.push("topic: wikis");
  lines.push("type: signal");
  lines.push("signal-source: rollup");
  lines.push(`created: ${created}`);
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# Weekly Rollup — ${weekLabel}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Papers ingested | ${stats.total} |`);
  lines.push(`| High relevance (8+) | ${stats.highRelevance} |`);
  lines.push(`| Medium relevance (7) | ${stats.mediumRelevance} |`);
  lines.push(
    `| Sources active | ${stats.sourceDistribution.length} |`
  );
  lines.push("");

  // Top Papers
  lines.push("## Top Papers");
  if (stats.topPapers.length === 0) {
    lines.push("_No papers this week._");
  } else {
    lines.push("| Score | Title | Source |");
    lines.push("|-------|-------|--------|");
    for (const paper of stats.topPapers) {
      const score = paper.relevance_score ?? "?";
      const url = paper.url ?? "#";
      const title = escapeMarkdown(paper.title);
      const sources: string[] = JSON.parse(paper.sources);
      lines.push(`| ${score} | [${title}](${url}) | ${sources[0] ?? "?"} |`);
    }
  }
  lines.push("");

  // Categories
  lines.push("## Categories");
  if (stats.categoryDistribution.length === 0) {
    lines.push("_No categories this week._");
  } else {
    lines.push("| Category | Count |");
    lines.push("|----------|-------|");
    for (const [cat, count] of stats.categoryDistribution) {
      lines.push(`| ${cat} | ${count} |`);
    }
  }
  lines.push("");

  // Sources
  lines.push("## Sources");
  if (stats.sourceDistribution.length === 0) {
    lines.push("_No sources this week._");
  } else {
    lines.push("| Source | Papers |");
    lines.push("|--------|--------|");
    for (const [src, count] of stats.sourceDistribution) {
      lines.push(`| ${src} | ${count} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Escape pipe characters in markdown table cells.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RollupOptions {
  /** Number of weeks to look back (default 1). */
  weeks?: number;
}

/**
 * Generate a weekly rollup markdown string.
 *
 * Queries the database for papers from the last N weeks (default 1) and
 * produces Obsidian-compatible markdown with YAML frontmatter.
 *
 * @param db - SQLite database instance
 * @param options - Optional configuration
 * @returns The rollup markdown string
 */
export function generateRollup(
  db: Database,
  options?: RollupOptions
): string {
  const weeks = options?.weeks ?? 1;

  // Compute date range: last N weeks from today
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - weeks * 7);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  log.info(
    `Generating rollup for ${startStr} to ${endStr} (${weeks} week(s))`
  );

  // Query papers (include unscored papers in total count)
  const papers = queryPapersByDateRange(db, startStr, endStr, 0, true);
  log.info(`Found ${papers.length} papers in date range`);

  // Compute statistics
  const stats = computeStats(papers);

  // Generate week label from current date
  const weekLabel = formatISOWeek(now);
  const created = endStr;

  return generateMarkdown(weekLabel, created, stats);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`Usage: npx tsx processor/rollup.ts [options]

Options:
  --db <path>       Path to SQLite database (required)
  --weeks <n>       Number of weeks to look back (default: 1)
  --output <path>   Output file path (default: ./YYYY-Www-rollup.md)
  --verbose         Enable debug logging
  --help            Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  // Parse args
  let dbPath: string | undefined;
  let weeks = 1;
  let outputPath: string | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--db":
        dbPath = args[++i];
        break;
      case "--weeks":
        weeks = parseInt(args[++i], 10);
        break;
      case "--output":
        outputPath = args[++i];
        break;
      case "--verbose":
        verbose = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!dbPath) {
    // Default from config.yaml
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, "..", "config.yaml");
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = yaml.parse(raw);
      dbPath = parsed?.database?.path;
    } catch {
      // ignore
    }
    if (!dbPath) {
      console.error("Error: --db is required (no database.path in config.yaml)");
      printUsage();
      process.exit(1);
    }
  }

  setupLogging(verbose ? "debug" : "info");

  const db = openDatabase(dbPath);
  const markdown = generateRollup(db, { weeks });

  // Determine output path
  const outPath = outputPath ?? `${formatISOWeek(new Date())}-rollup.md`;
  const fs = await import("node:fs");
  fs.writeFileSync(outPath, markdown, "utf-8");
  log.info(`Rollup written to ${outPath}`);
  console.log(markdown);
}

// Only run CLI when invoked directly (not when imported by tests)
const isDirectRun =
  process.argv[1]?.includes("rollup") &&
  !process.argv[1]?.includes("vitest");

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
