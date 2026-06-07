/**
 * GitHub Trending Collector — main entry point.
 *
 * Fetches trending AI/ML repos from GitHub Search API, deduplicates by ID,
 * and returns a structured GithubResult.
 */

import { GithubClient } from "./github-client.js";
import { log, setupLogging, dedupPapers } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./github-client.js";

export interface GithubResult {
  source: "github_trending";
  fetched_at: string;
  languages_queried: string[];
  since: string;
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface GithubConfig {
  enabled: boolean;
  languages: string[];
  since: string;
  max_results: number;
  delay_seconds: number;
  timeout_seconds: number;
  retries: number;
}

const DEFAULTS: GithubConfig = {
  enabled: true,
  languages: ["python", "typescript"],
  since: "daily",
  max_results: 30,
  delay_seconds: 2.0,
  timeout_seconds: 30,
  retries: 3,
};

/**
 * Load GitHub Trending config by merging a partial config (possibly nested
 * under sources.github_trending) with defaults.
 */
export function loadConfig(rawConfig: unknown): GithubConfig {
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.github_trending ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    languages: raw.languages ?? DEFAULTS.languages,
    since: raw.since ?? DEFAULTS.since,
    max_results: raw.max_results ?? DEFAULTS.max_results,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    retries: raw.retries ?? DEFAULTS.retries,
  };
}

export interface FetchOptions {
  client?: GithubClient;
}

/**
 * Fetch GitHub trending repos based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchGithub(
  config: GithubConfig,
  options?: FetchOptions
): Promise<GithubResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "github_trending",
      fetched_at: new Date().toISOString(),
      languages_queried: config.languages,
      since: config.since,
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new GithubClient({
      delaySeconds: config.delay_seconds,
      timeoutSeconds: config.timeout_seconds,
      retries: config.retries,
    });

  try {
    papers = await client.fetchRepos(
      config.languages,
      config.since,
      config.max_results
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(msg);
    log.warn(`fetchRepos failed: ${msg}`);
  }

  // Dedup by ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: GithubResult = {
    source: "github_trending",
    fetched_at: new Date().toISOString(),
    languages_queried: [...config.languages],
    since: config.since,
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
    console.log(`Usage: github [options]

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
    log.info("GitHub Trending collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchGithub(config);

  // Atomic write: write to .tmp then rename
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
    const filename = `github-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} repos to ${outPath}`);
    } catch (err) {
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} repos`);
    console.log(JSON.stringify(result, null, 2));
  }
}

// Run CLI if this is the main module
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
