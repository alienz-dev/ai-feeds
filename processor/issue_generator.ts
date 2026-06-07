/**
 * Learning Issue Generator: creates markdown learning issues from high-scoring papers.
 *
 * Reads scored papers from SQLite (relevance_score >= threshold), deduplicates
 * against existing issues/, and writes markdown issue files.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "yaml";
import { log, setupLogging } from "../collectors/common.js";
import { openDatabase } from "../db/database.js";
import type { PaperRow } from "../db/types.js";
import type { Database } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueConfig {
  threshold: number;
  interests: string[];
}

export interface IssueResult {
  generated: number;
  skipped_existing: number;
  skipped_low_score: number;
  total_eligible: number;
  issues: GeneratedIssue[];
  warnings: string[];
}

export interface GeneratedIssue {
  filename: string;
  paper_title: string;
  paper_url: string;
  relevance_score: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Load issue generator config from config.yaml defaults.
 */
function loadDefaultConfig(): IssueConfig {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, "..", "config.yaml");
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.parse(raw);
    return {
      threshold: parsed?.processor?.relevance_threshold ?? 8,
      interests: parsed?.learning_plan?.interests ?? [],
    };
  } catch {
    return {
      threshold: 8,
      interests: [],
    };
  }
}

/**
 * Load config from a raw parsed config object, falling back to defaults.
 */
export function loadConfig(rawConfig: unknown): IssueConfig {
  const cfg = rawConfig as Record<string, any> | undefined;
  const defaults = loadDefaultConfig();

  const threshold =
    cfg?.processor?.relevance_threshold ?? defaults.threshold;

  let interests: string[] | undefined;
  if (cfg?.learning_plan && "interests" in cfg.learning_plan) {
    interests = cfg.learning_plan.interests;
    if (!Array.isArray(interests) || interests.length === 0) {
      interests = undefined;
    }
  }
  if (!interests) {
    interests = defaults.interests;
  }

  return { threshold, interests };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a filesystem-safe slug from a paper title.
 * Lowercase, replace spaces with hyphens, strip non-alphanum/hyphen, truncate to 50 chars.
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Scan existing issue files in the issues/ directory and extract paper URLs
 * from YAML frontmatter for deduplication.
 */
export function loadExistingIssueUrls(issuesDir: string): Set<string> {
  const urls = new Set<string>();
  if (!fs.existsSync(issuesDir)) {
    return urls;
  }

  const files = fs.readdirSync(issuesDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    if (file === "TEMPLATE.md" || file === "BACKLOG.md") continue;
    const content = fs.readFileSync(path.join(issuesDir, file), "utf-8");
    // Extract paper_url from frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const urlMatch = match[1].match(/paper_url:\s*(.+)/);
      if (urlMatch) {
        urls.add(urlMatch[1].trim());
      }
    }
  }

  return urls;
}

/**
 * Generate markdown issue content for a paper.
 */
export function generateIssueMarkdown(paper: PaperRow): string {
  const title = paper.title;
  const url = paper.url ?? "";
  const pdfUrl = paper.pdf_url ?? "";
  const score = paper.relevance_score ?? 0;
  const explanation = paper.score_explanation ?? "No explanation available.";
  const authors = paper.authors
    ? JSON.parse(paper.authors as unknown as string).join(", ")
    : "Unknown";
  const categories = paper.categories
    ? JSON.parse(paper.categories as unknown as string)
    : [];
  const date = new Date().toISOString().split("T")[0];

  const tags = ["learning", ...categories.map((c: string) => c.replace(".", "-"))];

  return `---
title: "Learn: ${title}"
status: BACKLOG
paper_url: ${url}
relevance_score: ${score}
created: ${date}
tags: [${tags.join(", ")}]
---

# Learn: ${title}

## Why This Matters
${explanation}

## Learning Goal
Understand and apply the key concepts from this paper in a hands-on experiment.

## Acceptance Criteria
- [ ] Read the paper abstract and introduction
- [ ] Identify the 3 most important concepts
- [ ] Build a minimal working example
- [ ] Write a summary in your own words
- [ ] Create an evergreen note in your vault

## Source
- **Paper:** [${title}](${url})
- **PDF:** [${pdfUrl}](${pdfUrl})
- **Score:** ${score}/10
- **Authors:** ${authors}

## Timebox
2 hours
`;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate learning issues from high-scoring papers in the database.
 *
 * - Queries papers with relevance_score >= threshold
 * - Deduplicates against existing issues/ by paper URL
 * - Writes markdown issue files to issues/
 */
export async function generateIssues(
  db: Database,
  options: { limit?: number; dryRun?: boolean; issuesDir?: string } = {}
): Promise<IssueResult> {
  const config = loadDefaultConfig();
  const threshold = config.threshold;
  const issuesDir = options.issuesDir ?? "issues";
  const limit = options.limit ?? Infinity;
  const dryRun = options.dryRun ?? false;

  // Ensure issues directory exists
  if (!dryRun && !fs.existsSync(issuesDir)) {
    fs.mkdirSync(issuesDir, { recursive: true });
  }

  // Load existing issue URLs for dedup
  const existingUrls = loadExistingIssueUrls(issuesDir);
  log.debug(`Found ${existingUrls.size} existing issue URLs for dedup`);

  // Query papers above threshold
  const allPapers = db
    .prepare(
      `SELECT * FROM papers
       WHERE relevance_score >= ?
       ORDER BY relevance_score DESC`
    )
    .all(threshold) as PaperRow[];

  const totalEligible = allPapers.length;
  log.info(`Found ${totalEligible} papers with score >= ${threshold}`);

  const result: IssueResult = {
    generated: 0,
    skipped_existing: 0,
    skipped_low_score: 0,
    total_eligible: totalEligible,
    issues: [],
    warnings: [],
  };

  for (const paper of allPapers) {
    if (result.generated >= limit) break;

    const paperUrl = paper.url ?? "";

    // Dedup: skip if issue already exists for this paper URL
    if (paperUrl && existingUrls.has(paperUrl)) {
      log.debug(`Skipping (existing issue): ${paper.title}`);
      result.skipped_existing++;
      continue;
    }

    // Generate issue
    const slug = titleToSlug(paper.title);
    if (!slug) {
      result.warnings.push(`Empty slug for paper: ${paper.title}`);
      continue;
    }
    const filename = `learn-${slug}.md`;
    const markdown = generateIssueMarkdown(paper);

    if (dryRun) {
      log.info(`[dry-run] Would create: ${filename}`);
    } else {
      const filePath = path.join(issuesDir, filename);
      fs.writeFileSync(filePath, markdown, "utf-8");
      log.info(`Created: ${filename}`);
    }

    result.generated++;
    result.issues.push({
      filename,
      paper_title: paper.title,
      paper_url: paperUrl,
      relevance_score: paper.relevance_score ?? 0,
    });

    // Track this URL so we don't create dupes in the same run
    if (paperUrl) {
      existingUrls.add(paperUrl);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`Usage: issue_generator [options]

Generate learning issues from high-scoring papers in the database.

Options:
  --db <path>       Path to SQLite database (required)
  --limit <n>       Max number of issues to generate
  --dry-run         Print what would be generated without writing files
  --verbose, -v     Enable debug logging
  -h, --help        Show this help message
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      db: { type: "string" },
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  setupLogging(values.verbose ? "debug" : "info");

  let dbPath: string;
  if (values.db) {
    dbPath = values.db as string;
  } else {
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
      console.error("Error: --db is required (no database.path in config.yaml).");
      process.exit(1);
    }
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database not found: ${dbPath}`);
    process.exit(1);
  }

  const limit = values.limit ? parseInt(values.limit as string, 10) : undefined;
  const dryRun = values["dry-run"] === true;

  const db = openDatabase(dbPath);

  try {
    const result = await generateIssues(db, { limit, dryRun });

    console.log(`\nIssue Generation Summary:`);
    console.log(`  Eligible papers: ${result.total_eligible}`);
    console.log(`  Generated: ${result.generated}`);
    console.log(`  Skipped (existing): ${result.skipped_existing}`);
    console.log(`  Skipped (low score): ${result.skipped_low_score}`);

    if (result.warnings.length > 0) {
      console.log(`  Warnings: ${result.warnings.length}`);
      for (const w of result.warnings) {
        console.log(`    - ${w}`);
      }
    }

    if (result.issues.length > 0) {
      console.log(`\nGenerated issues:`);
      for (const issue of result.issues) {
        console.log(`  - ${issue.filename} (score: ${issue.relevance_score})`);
      }
    }
  } finally {
    db.close();
  }
}

// Only run CLI when executed directly, not when imported
const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] &&
  (process.argv[1] === __filename ||
   process.argv[1] === __filename.replace(/\.ts$/, ".js"));

if (isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
