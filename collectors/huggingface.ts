/**
 * HuggingFace Daily Papers Collector — main entry point.
 *
 * Fetches papers from HuggingFace Daily Papers API, deduplicates by ID,
 * and returns a structured HfResult.
 */

import { HfClient } from "./hf-client.js";
import { log, setupLogging, dedupPapers } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./common.js";

export interface HfResult {
  source: "huggingface";
  fetched_at: string;
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface HfConfig {
  enabled: boolean;
  limit: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
  delay_seconds: number;
}

const DEFAULTS: HfConfig = {
  enabled: true,
  limit: 30,
  days_back: 2,
  timeout_seconds: 30,
  retries: 3,
  delay_seconds: 1.0,
};

/**
 * Load HuggingFace config by merging a partial config (possibly nested under
 * sources.huggingface) with defaults. Only overrides keys that are explicitly
 * provided — missing keys fall back to defaults.
 */
export function loadConfig(rawConfig: unknown): HfConfig {
  // Support both flat config and nested sources.huggingface structure
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.huggingface ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    limit: raw.limit ?? DEFAULTS.limit,
    days_back: raw.days_back ?? DEFAULTS.days_back,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    retries: raw.retries ?? DEFAULTS.retries,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
  };
}

export interface FetchOptions {
  client?: HfClient;
}

/**
 * Fetch HuggingFace papers based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchHuggingFace(
  config: HfConfig,
  options?: FetchOptions
): Promise<HfResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "huggingface",
      fetched_at: new Date().toISOString(),
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new HfClient({
      delaySeconds: config.delay_seconds,
      timeoutSeconds: config.timeout_seconds,
      retries: config.retries,
    });

  try {
    papers = await client.fetchPapers(config.limit, config.days_back);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(msg);
    log.warn(`fetchPapers failed: ${msg}`);
  }

  // Dedup by ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: HfResult = {
    source: "huggingface",
    fetched_at: new Date().toISOString(),
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
    console.log(`Usage: huggingface [options]

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
    log.info("HuggingFace collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchHuggingFace(config);

  if (!values["dry-run"]) {
    const outputDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "output"
    );
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `huggingface-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} papers to ${outPath}`);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} papers`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
