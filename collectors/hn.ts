/**
 * Hacker News Collector — main entry point.
 *
 * Fetches stories from HN Algolia search API (per query) and HN Firebase
 * top stories API, deduplicates by ID, and returns a structured HnResult.
 */

import { HnClient } from "./hn-client.js";
import { log, setupLogging, dedupPapers } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./common.js";

export interface HnResult {
  source: "hackernews";
  fetched_at: string;
  queries_searched: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface HnConfig {
  enabled: boolean;
  queries: string[];
  max_stories: number;
  timeout_seconds: number;
  retries: number;
  days_back: number;
}

const DEFAULTS: HnConfig = {
  enabled: true,
  queries: ["AI", "LLM", "machine learning"],
  max_stories: 30,
  timeout_seconds: 30,
  retries: 3,
  days_back: 2,
};

/**
 * Load HN config by merging a partial config (possibly nested under
 * sources.hackernews) with defaults. Only overrides keys that are explicitly
 * provided — missing keys fall back to defaults.
 */
export function loadConfig(rawConfig: unknown): HnConfig {
  // Support both flat config and nested sources.hackernews structure
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.hackernews ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    queries: raw.queries ?? DEFAULTS.queries,
    max_stories: raw.max_stories ?? DEFAULTS.max_stories,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    retries: raw.retries ?? DEFAULTS.retries,
    days_back: raw.days_back ?? DEFAULTS.days_back,
  };
}


export interface FetchOptions {
  client?: HnClient;
}

/**
 * Fetch HN stories based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchHn(
  config: HnConfig,
  options?: FetchOptions
): Promise<HnResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "hackernews",
      fetched_at: new Date().toISOString(),
      queries_searched: [],
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new HnClient({
      timeoutSeconds: config.timeout_seconds,
      retries: config.retries,
    });

  // Compute cutoff timestamp for date filtering
  const sinceTimestamp = Math.floor(Date.now() / 1000) - config.days_back * 86400;

  // Fetch stories for each query
  for (const query of config.queries) {
    try {
      const results = await client.searchStories(query, config.max_stories, sinceTimestamp);
      papers.push(...results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Query "${query}": ${msg}`);
      log.warn(`searchStories failed for "${query}": ${msg}`);
    }
  }

  // Dedup by ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: HnResult = {
    source: "hackernews",
    fetched_at: new Date().toISOString(),
    queries_searched: [...config.queries],
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
    console.log(`Usage: hn [options]

Options:
  -h, --help         Show this help message
  --dry-run          Fetch but do not write output file
  -c, --config PATH  Path to config YAML file (default: config.yaml)
  -v, --verbose      Enable debug logging
`);
    process.exit(0);
  }

  // Configure logging
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
    log.info("Hacker News collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchHn(config);

  // Atomic write: write to .tmp then rename
  if (!values["dry-run"]) {
    const outputDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "output"
    );
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `hn-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} stories to ${outPath}`);
    } catch (err) {
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} stories`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
