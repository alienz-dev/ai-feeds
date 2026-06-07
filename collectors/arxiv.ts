/**
 * arXiv Collector — main entry point.
 *
 * Fetches papers from arXiv API, deduplicates by version-stripped ID,
 * and returns a structured ArxivResult.
 */

import { ArxivClient, stripVersion } from "./arxiv-client.js";
import type { Paper } from "./arxiv-client.js";
import { log, setupLogging } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./arxiv-client.js";

export interface ArxivResult {
  source: "arxiv";
  fetched_at: string;
  categories_queried: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface ArxivConfig {
  enabled: boolean;
  categories: string[];
  max_results: number;
  delay_seconds: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
}

const DEFAULTS: ArxivConfig = {
  enabled: true,
  categories: ["cs.AI", "cs.CL", "cs.LG", "stat.ML"],
  max_results: 150,
  delay_seconds: 3.0,
  days_back: 2,
  timeout_seconds: 30,
  retries: 3,
};

/**
 * Load arXiv config by merging a partial config (possibly nested under
 * sources.arxiv) with defaults. Only overrides keys that are explicitly
 * provided — missing keys fall back to defaults.
 */
export function loadConfig(rawConfig: unknown): ArxivConfig {
  // Support both flat config and nested sources.arxiv structure
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.arxiv ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    categories: raw.categories ?? DEFAULTS.categories,
    max_results: raw.max_results ?? DEFAULTS.max_results,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
    days_back: raw.days_back ?? DEFAULTS.days_back,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    retries: raw.retries ?? DEFAULTS.retries,
  };
}

/**
 * Deduplicate papers by version-stripped arXiv ID.
 * When the same paper appears at multiple versions (v1, v2), keep the latest.
 */
function dedupPapers(papers: Paper[]): Paper[] {
  const byBaseId = new Map<string, Paper>();

  for (const paper of papers) {
    const baseId = stripVersion(paper.id);
    const existing = byBaseId.get(baseId);

    if (!existing) {
      byBaseId.set(baseId, paper);
    } else {
      // Keep the one with the higher version number (ties go to later entry)
      const existingVer = parseInt(
        existing.id.match(/v(\d+)$/)?.[1] ?? "0",
        10
      );
      const newVer = parseInt(
        paper.id.match(/v(\d+)$/)?.[1] ?? "0",
        10
      );
      if (newVer > existingVer) {
        byBaseId.set(baseId, paper);
      }
    }
  }

  return Array.from(byBaseId.values());
}

export interface FetchOptions {
  client?: ArxivClient;
}

/**
 * Fetch arXiv papers based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchArxiv(
  config: ArxivConfig,
  options?: FetchOptions
): Promise<ArxivResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  const client =
    options?.client ??
    new ArxivClient({
      delaySeconds: config.delay_seconds,
      timeoutSeconds: config.timeout_seconds,
      retries: config.retries,
    });

  try {
    papers = await client.fetchPapers(
      config.categories,
      config.max_results,
      config.days_back
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(msg);
    log.warn(`fetchPapers failed: ${msg}`);
  }

  // Dedup by version-stripped ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: ArxivResult = {
    source: "arxiv",
    fetched_at: new Date().toISOString(),
    categories_queried: [...config.categories],
    total_results: papers.length,
    warnings,
    papers,
  };

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      "dry-run": { type: "boolean", default: false },
      config: { type: "string", short: "c" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: arxiv [options]

Options:
  -h, --help         Show this help message
  --dry-run          Fetch but do not write output file
  -c, --config PATH  Path to config YAML file (default: config.yaml)
  -v, --verbose      Enable debug logging
`);
    process.exit(0);
  }

  // Configure logging (AC-13)
  setupLogging(values.verbose ? "debug" : "info");

  // Load config
  let rawConfig: any = {};
  const configPath = (values.config as string) ?? "config.yaml";
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    rawConfig = YAML.parse(content);
  } catch {
    log.info(`No config file at ${configPath}, using defaults`);
  }

  const config = loadConfig(rawConfig);

  if (!config.enabled) {
    log.info("arXiv collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchArxiv(config);

  // Atomic write: write to .tmp then rename
  // AC-10: Output goes to collectors/output/ directory
  if (!values["dry-run"]) {
    const outputDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "output"
    );
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `arxiv-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} papers to ${outPath}`);
    } catch (err) {
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} papers`);
    console.log(JSON.stringify(result, null, 2));
  }
}

// Run CLI if this is the main module
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
