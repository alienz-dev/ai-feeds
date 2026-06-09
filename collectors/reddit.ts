/**
 * Reddit Collector — main entry point.
 *
 * Fetches posts from Reddit subreddits via Arctic Shift API,
 * deduplicates by ID, and returns a structured RedditResult.
 */

import { RedditClient } from "./reddit-client.js";
import { log, setupLogging, dedupPapers } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface RedditResult {
  source: "reddit";
  fetched_at: string;
  subreddits_queried: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface RedditConfig {
  enabled: boolean;
  subreddits: string[];
  limit: number;
  hours_back: number;
  delay_seconds: number;
}

const DEFAULTS: RedditConfig = {
  enabled: true,
  subreddits: ["MachineLearning", "LocalLLaMA", "artificial"],
  limit: 100,
  hours_back: 24,
  delay_seconds: 0.5,
};

/**
 * Load Reddit config by merging a partial config (possibly nested under
 * sources.reddit) with defaults.
 */
export function loadConfig(rawConfig: unknown): RedditConfig {
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.reddit ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    subreddits: raw.subreddits ?? DEFAULTS.subreddits,
    limit: raw.limit ?? DEFAULTS.limit,
    hours_back: raw.hours_back ?? DEFAULTS.hours_back,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
  };
}

export interface FetchOptions {
  client?: RedditClient;
}

/**
 * Fetch Reddit posts based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchReddit(
  config: RedditConfig,
  options?: FetchOptions
): Promise<RedditResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "reddit",
      fetched_at: new Date().toISOString(),
      subreddits_queried: [...config.subreddits],
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new RedditClient({
      limit: config.limit,
      hoursBack: config.hours_back,
      delaySeconds: config.delay_seconds,
    });

  try {
    papers = await client.fetchMultipleSubreddits(
      config.subreddits,
      "hot",
      config.limit
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(msg);
    log.warn(`fetchMultipleSubreddits failed: ${msg}`);
  }

  // Dedup by post ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: RedditResult = {
    source: "reddit",
    fetched_at: new Date().toISOString(),
    subreddits_queried: [...config.subreddits],
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
      subreddits: { type: "string", short: "s" },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: reddit [options]

Fetch Reddit posts from subreddits via Arctic Shift API.

Options:
  -h, --help           Show this help message
  --dry-run            Fetch but do not write output file
  -c, --config PATH    Path to config YAML file (default: config.yaml)
  -v, --verbose        Enable debug logging
  -s, --subreddits LIST  Comma-separated subreddit list (overrides config)
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

  // Override subreddits from CLI
  if (values.subreddits) {
    config.subreddits = (values.subreddits as string)
      .split(",")
      .map((s: string) => s.trim());
  }

  if (!config.enabled) {
    log.info("Reddit collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchReddit(config);

  log.info(
    `Fetched ${result.total_results} posts from ${result.subreddits_queried.length} subreddits`
  );

  if (result.warnings.length > 0) {
    log.warn(`${result.warnings.length} warnings during fetch`);
  }

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
    const filename = `reddit-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} posts to ${outPath}`);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} posts`);
    console.log(JSON.stringify(result, null, 2));
  }
}

// Only run CLI when executed directly, not when imported (e.g. by tests)
const isDirectRun =
  process.argv[1] &&
  new URL(`file://${process.argv[1]}`).pathname ===
    new URL(import.meta.url).pathname;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
