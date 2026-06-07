/**
 * Main scorer module: config loading, input reading, batch scoring pipeline.
 */

import type { Paper } from "../collectors/common.js";
import { buildBatchPrompt, parseScoredResponse } from "./scorer-prompt.js";
import { callLlmOnce, type LlmProviderConfig } from "./llm-client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "yaml";
import { log, setupLogging } from "../collectors/common.js";

export interface ScorerConfig {
  provider: "claude" | "openai" | "ollama";
  model: string;
  batch_size: number;
  threshold: number;
  interests: string[];
}

export interface ScoredPaper extends Paper {
  relevance_score: number;
  score_explanation: string;
}

export interface ScorerResult {
  source: string;
  scored_at: string;
  interests_used: string[];
  provider: string;
  model: string;
  total_input: number;
  total_scored: number;
  total_above_threshold: number;
  warnings: string[];
  papers: ScoredPaper[];
}

/**
 * Load scorer config from raw config object (e.g., parsed YAML).
 * Reads from rawConfig.processor.llm and rawConfig.learning_plan.
 */
export function loadConfig(rawConfig: unknown): ScorerConfig {
  const cfg = rawConfig as Record<string, any> | undefined;

  // Read config.yaml as the default base config
  const defaults = loadDefaultConfig();

  const llm = cfg?.processor?.llm ?? {};

  let interests: string[] | undefined;

  // If learning_plan.interests is explicitly provided, validate it
  if (cfg?.learning_plan && "interests" in cfg.learning_plan) {
    interests = cfg.learning_plan.interests;
    if (!Array.isArray(interests) || interests.length === 0) {
      throw new Error(
        "learning_plan.interests is required and must be a non-empty array"
      );
    }
  }

  // Fall back to config.yaml defaults if not explicitly provided
  if (!interests) {
    // If processor is specified without learning_plan, it must include
    // relevance_threshold to signal the user has a complete config
    if (cfg?.processor && cfg.processor.relevance_threshold === undefined) {
      throw new Error(
        "learning_plan.interests is required and must be a non-empty array"
      );
    }
    interests = defaults.interests;
    if (!interests || interests.length === 0) {
      throw new Error(
        "learning_plan.interests is required and must be a non-empty array"
      );
    }
  }

  return {
    provider: llm.provider ?? defaults.provider,
    model: llm.model ?? defaults.model,
    batch_size: llm.batch_size ?? defaults.batch_size,
    threshold: cfg?.processor?.relevance_threshold ?? defaults.threshold,
    interests,
  };
}

/**
 * Read input file(s) and extract papers.
 * If inputPath is a file: read JSON, extract papers[].
 * If inputPath is a directory: read all *.json files, extract papers[] from each.
 * Deduplicates by paper.id.
 */
export function readInputFiles(inputPath: string): Paper[] {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  const stat = fs.statSync(inputPath);

  if (stat.isFile()) {
    const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    return deduplicatePapers(data.papers ?? []);
  }

  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter((f) => f.endsWith(".json"));
    const allPapers: Paper[] = [];

    for (const file of files) {
      const filePath = path.join(inputPath, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(data.papers)) {
        allPapers.push(...data.papers);
      }
    }

    return deduplicatePapers(allPapers);
  }

  throw new Error(`Input path is neither a file nor directory: ${inputPath}`);
}

/**
 * Score papers using an LLM. The main pipeline function.
 */
export async function scorePapers(
  papers: Paper[],
  config: ScorerConfig,
  options?: { llmFn?: Function }
): Promise<ScorerResult> {
  const warnings: string[] = [];

  // Handle empty input
  if (papers.length === 0) {
    return buildResult([], 0, 0, config, warnings);
  }

  // Deduplicate
  const uniquePapers = deduplicatePapers(papers);

  // Separate empty-abstract papers (score 1, no LLM call)
  const emptyAbstractPapers: ScoredPaper[] = [];
  const scorablePapers: Paper[] = [];

  for (const paper of uniquePapers) {
    if (!paper.abstract || paper.abstract.trim().length === 0) {
      emptyAbstractPapers.push({
        ...paper,
        relevance_score: 1,
        score_explanation: "No abstract available — assigned minimum score.",
      });
    } else {
      scorablePapers.push(paper);
    }
  }

  // Batch and score via LLM
  const llmFn = options?.llmFn ?? defaultLlmFn;
  const allScored: ScoredPaper[] = [...emptyAbstractPapers];

  for (let i = 0; i < scorablePapers.length; i += config.batch_size) {
    const batch = scorablePapers.slice(i, i + config.batch_size);

    try {
      const prompt = buildBatchPrompt(config.interests, batch);
      const rawResponse = await llmFn(prompt, config);
      const scored = parseScoredResponse(rawResponse, batch);
      allScored.push(...scored);
    } catch (err) {
      const msg = `Batch ${Math.floor(i / config.batch_size)} failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      warnings.push(msg);
    }
  }

  // Filter by threshold
  const aboveThreshold = allScored.filter(
    (p) => p.relevance_score >= config.threshold
  );

  return buildResult(aboveThreshold, uniquePapers.length, allScored.length, config, warnings);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultLlmFn(prompt: string, config: ScorerConfig): Promise<string> {
  const llmConfig: LlmProviderConfig = {
    provider: config.provider,
    model: config.model,
  };
  return callLlmOnce(prompt, llmConfig);
}

function buildResult(
  papers: ScoredPaper[],
  totalInput: number,
  totalScored: number,
  config: ScorerConfig,
  warnings: string[]
): ScorerResult {
  return {
    source: "scorer",
    scored_at: new Date().toISOString(),
    interests_used: config.interests,
    provider: config.provider,
    model: config.model,
    total_input: totalInput,
    total_scored: totalScored,
    total_above_threshold: papers.length,
    warnings,
    papers,
  };
}

/**
 * Load default config from config.yaml.
 */
function loadDefaultConfig(): {
  provider: string;
  model: string;
  batch_size: number;
  threshold: number;
  interests: string[];
} {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, "..", "config.yaml");
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.parse(raw);
    return {
      provider: parsed?.processor?.llm?.provider ?? "claude",
      model: parsed?.processor?.llm?.model ?? "claude-sonnet-4-20250514",
      batch_size: parsed?.processor?.llm?.batch_size ?? 10,
      threshold: parsed?.processor?.relevance_threshold ?? 7,
      interests: parsed?.learning_plan?.interests ?? [],
    };
  } catch {
    return {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      batch_size: 10,
      threshold: 7,
      interests: [],
    };
  }
}

import { dedupPapers as sharedDedupPapers } from "../collectors/common.js";

function deduplicatePapers(papers: Paper[]): Paper[] {
  return sharedDedupPapers(papers);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      input: { type: "string", short: "i" },
      config: { type: "string", short: "c" },
      output: { type: "string", short: "o" },
      threshold: { type: "string", short: "t" },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: scorer [options]

Options:
  -h, --help           Show this help message
  -i, --input <path>   Input file or directory (required)
  -c, --config <path>  Config file (default: config.yaml)
  -o, --output <path>  Output file (default: processor/output/scored-YYYY-MM-DD.json)
  -t, --threshold <n>  Override relevance threshold
  --dry-run            Print output to stdout instead of writing
  -v, --verbose        Enable debug logging
`);
    process.exit(0);
  }

  setupLogging(values.verbose ? "debug" : "info");

  if (!values.input) {
    console.error("Error: --input is required. Provide a file or directory path.");
    process.exit(1);
  }

  // Load config
  let rawConfig: unknown = {};
  const configPath = (values.config as string) ?? "config.yaml";
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    rawConfig = yaml.parse(content);
  } catch {
    log.info(`No config file at ${configPath}, using defaults`);
  }

  let config: ScorerConfig;
  try {
    config = loadConfig(rawConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Config error: ${msg}`);
    process.exit(1);
  }

  // CLI threshold override
  if (values.threshold) {
    const t = parseInt(values.threshold as string, 10);
    if (t >= 1 && t <= 10) {
      config = { ...config, threshold: t };
    }
  }

  // Read input files
  let papers: Paper[];
  try {
    papers = readInputFiles(values.input as string);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Input error: ${msg}`);
    process.exit(1);
  }

  log.info(`Loaded ${papers.length} papers from ${values.input}`);

  // Score papers
  const result = await scorePapers(papers, config);

  log.info(`Scored ${result.total_scored} papers, ${result.total_above_threshold} above threshold ${config.threshold}`);

  if (result.warnings.length > 0) {
    log.warn(`${result.warnings.length} warnings during scoring`);
  }

  // Write output
  if (!values["dry-run"]) {
    const outputDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "output"
    );
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `scored-${today}.json`;
    const outPath = (values.output as string) ?? path.join(outputDir, filename);
    const tmpPath = outPath + ".tmp";

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
      fs.renameSync(tmpPath, outPath);
      log.info(`Wrote to ${outPath}`);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  } else {
    log.info("[dry-run] Output:");
    console.log(JSON.stringify(result, null, 2));
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
    console.error(err);
    process.exit(1);
  });
}
