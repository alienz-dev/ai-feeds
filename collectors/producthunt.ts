/**
 * Product Hunt Collector — main entry point.
 *
 * Scrapes the Product Hunt daily leaderboard via CDP, deduplicates by ID,
 * and returns a structured ProductHuntResult.
 */

import { ProductHuntClient } from "./producthunt-client.js";
import { log, setupLogging, dedupPapers } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./common.js";

export interface ProductHuntResult {
  source: "producthunt";
  fetched_at: string;
  date_queried: string;
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface ProductHuntConfig {
  enabled: boolean;
  days: number;
  timeout_seconds: number;
  delay_seconds: number;
  cdp_endpoint: string;
}

const DEFAULTS: ProductHuntConfig = {
  enabled: false,
  days: 1,
  timeout_seconds: 30,
  delay_seconds: 2.0,
  cdp_endpoint: "http://localhost:9222",
};

/**
 * Load Product Hunt config by merging a partial config (possibly nested under
 * sources.producthunt) with defaults. Only overrides keys that are explicitly
 * provided — missing keys fall back to defaults.
 */
export function loadConfig(rawConfig: unknown): ProductHuntConfig {
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.producthunt ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    days: raw.days ?? DEFAULTS.days,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
    cdp_endpoint: raw.cdp_endpoint ?? DEFAULTS.cdp_endpoint,
  };
}

export interface FetchOptions {
  client?: ProductHuntClient;
}

/**
 * Fetch Product Hunt products based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchProducthunt(
  config: ProductHuntConfig,
  options?: FetchOptions
): Promise<ProductHuntResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "producthunt",
      fetched_at: new Date().toISOString(),
      date_queried: new Date().toISOString().slice(0, 10),
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new ProductHuntClient({
      delaySeconds: config.delay_seconds,
      timeoutSeconds: config.timeout_seconds,
      cdpEndpoint: config.cdp_endpoint,
    });

  // Scrape up to `config.days` days back
  const dates: string[] = [];
  for (let i = 0; i < config.days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  for (const date of dates) {
    try {
      const dayPapers = await client.fetchProducts(date);
      papers.push(...dayPapers);
      log.info(`Fetched ${dayPapers.length} products for ${date}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to fetch ${date}: ${msg}`);
      log.warn(`Failed to fetch ${date}: ${msg}`);
    }
  }

  // Dedup by ID
  papers = dedupPapers(papers);

  const result: ProductHuntResult = {
    source: "producthunt",
    fetched_at: new Date().toISOString(),
    date_queried: dates[0] ?? new Date().toISOString().slice(0, 10),
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
      days: { type: "string", short: "d" },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: producthunt [options]

Scrape Product Hunt daily leaderboard via Chrome DevTools Protocol.

Options:
  -h, --help         Show this help message
  --dry-run          Fetch but do not write output file
  -c, --config PATH  Path to config YAML file (default: config.yaml)
  -v, --verbose      Enable debug logging
  -d, --days N       How many days back to scrape (default: 1)
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

  // Override days from CLI
  if (values.days) {
    config.days = parseInt(values.days as string, 10);
  }

  if (!config.enabled) {
    log.info("Product Hunt collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchProducthunt(config);

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
    const filename = `producthunt-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} products to ${outPath}`);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} products`);
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
