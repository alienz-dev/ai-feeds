/**
 * Dev.to (Forem) Collector — main entry point.
 *
 * Fetches articles from the Dev.to Forem API, deduplicates by ID,
 * and returns a structured DevtoResult.
 */

import { DevtoClient } from "./devto-client.js";
import { log, setupLogging } from "./common.js";
import type { Paper } from "./common.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// Re-export types for consumers
export type { Paper } from "./common.js";

export interface DevtoResult {
  source: "devto";
  fetched_at: string;
  tag_queried: string;
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

export interface DevtoConfig {
  enabled: boolean;
  tag: string;
  top: number;
  limit: number;
  timeout_seconds: number;
  retries: number;
  delay_seconds: number;
}

const DEFAULTS: DevtoConfig = {
  enabled: true,
  tag: "ai",
  top: 7,
  limit: 30,
  timeout_seconds: 30,
  retries: 3,
  delay_seconds: 1.0,
};

/**
 * Load Dev.to config by merging a partial config (possibly nested under
 * sources.devto) with defaults. Only overrides keys that are explicitly
 * provided — missing keys fall back to defaults.
 */
export function loadConfig(rawConfig: unknown): DevtoConfig {
  const cfg = rawConfig as Record<string, any> | undefined;
  const raw = cfg?.sources?.devto ?? cfg ?? {};

  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    tag: raw.tag ?? DEFAULTS.tag,
    top: raw.top ?? DEFAULTS.top,
    limit: raw.limit ?? DEFAULTS.limit,
    timeout_seconds: raw.timeout_seconds ?? DEFAULTS.timeout_seconds,
    retries: raw.retries ?? DEFAULTS.retries,
    delay_seconds: raw.delay_seconds ?? DEFAULTS.delay_seconds,
  };
}

/**
 * Deduplicate articles by ID. Keeps the first occurrence.
 */
function dedupPapers(papers: Paper[]): Paper[] {
  const seen = new Set<string>();
  const result: Paper[] = [];

  for (const paper of papers) {
    if (!seen.has(paper.id)) {
      seen.add(paper.id);
      result.push(paper);
    }
  }

  return result;
}

export interface FetchOptions {
  client?: DevtoClient;
}

/**
 * Fetch Dev.to articles based on config. Supports dependency injection
 * via the options.client parameter for testability.
 */
export async function fetchDevto(
  config: DevtoConfig,
  options?: FetchOptions
): Promise<DevtoResult> {
  const warnings: string[] = [];
  let papers: Paper[] = [];

  if (!config.enabled) {
    return {
      source: "devto",
      fetched_at: new Date().toISOString(),
      tag_queried: config.tag,
      total_results: 0,
      warnings,
      papers,
    };
  }

  const client =
    options?.client ??
    new DevtoClient({
      delaySeconds: config.delay_seconds,
      timeoutSeconds: config.timeout_seconds,
      retries: config.retries,
    });

  try {
    papers = await client.fetchArticles(config.tag, config.top, config.limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(msg);
    log.warn(`fetchArticles failed: ${msg}`);
  }

  // Dedup by ID
  papers = dedupPapers(papers);

  // Normalize titles (strip newlines, collapse whitespace, trim)
  papers = papers.map((p) => ({
    ...p,
    title: p.title.replace(/\s+/g, " ").trim(),
  }));

  const result: DevtoResult = {
    source: "devto",
    fetched_at: new Date().toISOString(),
    tag_queried: config.tag,
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
    console.log(`Usage: devto [options]

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
    log.info("Dev.to collector is disabled in config");
    process.exit(0);
  }

  const result = await fetchDevto(config);

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
    const filename = `devto-${today}.json`;
    const outPath = path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote ${result.total_results} articles to ${outPath}`);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info(`[dry-run] Would write ${result.total_results} articles`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
