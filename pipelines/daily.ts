/**
 * Daily pipeline: collect → score → detect frontier → write outputs.
 *
 * This replaces the shell-based daily-pipeline.sh with a TypeScript pipeline
 * that uses the nexus SDK for LLM calls, knowledge boost, and context management.
 */

import { createContext, type NexusContext } from "nexus";
import { withKnowledge } from "nexus/knowledge";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { mergedSource } from "../sources/index.js";
import type { Paper } from "../sources/types.js";
import {
  scorePapers,
  loadScorerConfig,
  detectFrontier,
  loadFrontierConfig,
  filterMiddleBand,
  AdoptionEvaluator,
  type ScorerConfig,
  type ScorerResult,
  type FrontierConfig,
  type FrontierResult,
  type AdoptionEvaluatorConfig,
  type AdoptionResult,
} from "../processors/index.js";
import type { ScoredPaper } from "../processors/scorer.js";
import { initPapersTable, upsertPaper } from "../db/database.js";

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface DailyPipelineOptions {
  skipScorer?: boolean;
  skipFrontier?: boolean;
  skipSite?: boolean;
  skipDeploy?: boolean;
  skipTelegram?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(): Record<string, any> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.join(__dirname, "..", "config.yaml");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return yaml.parse(raw) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------

function writeScoredOutput(result: ScorerResult, outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const date = new Date().toISOString().slice(0, 10);
  const filename = `scored-${date}.json`;
  const outPath = path.join(outputDir, filename);
  const tmpPath = outPath + ".tmp";

  fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
  fs.renameSync(tmpPath, outPath);
  return outPath;
}

function writeFrontierOutput(result: FrontierResult, outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const date = new Date().toISOString().slice(0, 10);
  const filename = `frontier-${date}.json`;
  const outPath = path.join(outputDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

/**
 * Generate Telegram notification message.
 */
function generateTelegramMessage(
  date: string,
  scored: ScorerResult,
  frontier?: FrontierResult
): string {
  const lines: string[] = [];
  lines.push(`📊 AI Signals — ${date}`);
  lines.push(`${scored.total_above_threshold} papers above threshold`);
  lines.push("");

  // Group by score band
  const band9 = scored.papers.filter((p) => p.relevance_score >= 9);
  const band8 = scored.papers.filter((p) => p.relevance_score >= 8 && p.relevance_score < 9);
  const band7 = scored.papers.filter((p) => p.relevance_score >= 7 && p.relevance_score < 8);

  if (band9.length > 0) {
    lines.push(`🔥 Score 9+ (${band9.length}):`);
    for (const p of band9.slice(0, 5)) {
      lines.push(`  • ${p.title}`);
    }
    lines.push("");
  }

  if (band8.length > 0) {
    lines.push(`⭐ Score 8 (${band8.length}):`);
    for (const p of band8.slice(0, 5)) {
      lines.push(`  • ${p.title}`);
    }
    lines.push("");
  }

  if (band7.length > 0) {
    lines.push(`📌 Score 7 (${band7.length}):`);
    for (const p of band7.slice(0, 3)) {
      lines.push(`  • ${p.title}`);
    }
    lines.push("");
  }

  if (frontier && frontier.topics.length > 0) {
    lines.push(`🔭 Frontier topics (${frontier.topics.length}):`);
    for (const t of frontier.topics) {
      lines.push(`  • ${t.topic_name}: ${t.why_novel}`);
    }
    lines.push("");
  }

  lines.push(`https://signals.mingli.world`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the daily pipeline: collect → score → frontier → outputs.
 */
export async function runDailyPipeline(
  options: DailyPipelineOptions = {}
): Promise<{
  papersCollected: number;
  scorerResult?: ScorerResult;
  frontierResult?: FrontierResult;
  outputs: string[];
}> {
  const config = loadConfig();
  const outputs: string[] = [];
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.join(__dirname, "..");

  // Create nexus context (shared DB with nexus)
  const nexusDbPath = path.resolve(projectRoot, "..", "nexus", "data", "nexus.sqlite");
  const useKnowledge = config?.nexus?.enabled ?? false;

  const ctx = await createContext({
    storage: { main: nexusDbPath },
    llm: {
      endpoint: config?.processor?.llm?.endpoint ?? process.env.LLM_ENDPOINT,
      model: config?.processor?.llm?.model ?? process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
      maxRetries: 2,
    },
    logLevel: options.verbose ? "debug" : "info",
    extend: useKnowledge ? withKnowledge() : undefined,
  });

  // Initialize ai-feeds papers table in the shared DB
  initPapersTable(ctx.db);

  // Step 1: Collect from all sources
  ctx.logger.info("[pipeline] step 1: collecting from all sources");
  const papers = await mergedSource.fetch(ctx);
  ctx.logger.info(`[pipeline] collected ${papers.length} papers`);

  // Ingest raw papers into DB
  for (const paper of papers) {
    upsertPaper(ctx.db, {
      ...paper,
      source: paper.source,
    });
  }

  let scorerResult: ScorerResult | undefined;
  let frontierResult: FrontierResult | undefined;

  // Step 2: Score papers
  if (!options.skipScorer) {
    ctx.logger.info("[pipeline] step 2: scoring papers");
    const scorerConfig = loadScorerConfig(config);
    scorerResult = await scorePapers(papers, scorerConfig, ctx);

    ctx.logger.info(
      `[pipeline] scored ${scorerResult.total_scored} papers, ` +
      `${scorerResult.total_above_threshold} above threshold ${scorerConfig.threshold}`
    );

    // Write scored output
    if (!options.dryRun) {
      const scoredPath = writeScoredOutput(scorerResult, path.join(projectRoot, "processor", "output"));
      outputs.push(scoredPath);
      ctx.logger.info(`[pipeline] wrote scored output: ${scoredPath}`);
    }

    // Ingest scored papers into DB (update scores)
    for (const paper of scorerResult.papers) {
      upsertPaper(ctx.db, {
        ...paper,
        source: paper.source,
        relevance_score: paper.relevance_score,
        score_explanation: paper.score_explanation,
        nexus_boost: paper.nexus_boost,
        nexus_reasons: paper.nexus_reasons,
      });
    }

    // Step 3: Frontier detection (on middle band papers)
    if (!options.skipFrontier) {
      ctx.logger.info("[pipeline] step 3: detecting frontier topics");
      const frontierConfig = loadFrontierConfig(config);

      if (frontierConfig.enabled) {
        // Get middle band from scored papers
        const middleBand = filterMiddleBand(scorerResult.papers as ScoredPaper[]);

        if (middleBand.length > 0) {
          frontierResult = await detectFrontier(middleBand, frontierConfig, ctx);
          ctx.logger.info(
            `[pipeline] found ${frontierResult.topics.length} frontier topics`
          );

          if (!options.dryRun) {
            const frontierPath = writeFrontierOutput(frontierResult, path.join(projectRoot, "processor", "output"));
            outputs.push(frontierPath);
          }
        } else {
          ctx.logger.info("[pipeline] no middle band papers for frontier detection");
        }
      }
    }
  }

  // Step 4: Adoption evaluation
  let adoptionResults: AdoptionResult[] | undefined;
  if (scorerResult && config.enhancement_targets?.enabled) {
    ctx.logger.info("[pipeline] step 4: evaluating adoption targets");
    const adoptionConfig: AdoptionEvaluatorConfig = {
      enabled: config.enhancement_targets.enabled,
      project: config.enhancement_targets.project ?? "ai-feeds",
      reporter: config.enhancement_targets.reporter ?? "ai-feeds-pipeline",
      severity: config.enhancement_targets.severity ?? "P2",
      scoreThreshold: config.enhancement_targets.score_threshold ?? 8,
      evaluationMode: config.enhancement_targets.evaluation_mode ?? "hybrid",
      nexusUrl: config.enhancement_targets.nexus_url ?? "http://localhost:3777",
      targets: config.enhancement_targets.targets ?? [],
    };

    const evaluator = new AdoptionEvaluator(adoptionConfig);
    adoptionResults = await evaluator.evaluate(scorerResult.papers as ScoredPaper[]);

    const created = adoptionResults.filter((r) => r.action === "created").length;
    const skipped = adoptionResults.filter((r) => r.action === "skipped").length;
    ctx.logger.info(`[pipeline] adoption: ${created} issues created, ${skipped} skipped`);
  }

  // Step 5: Generate Telegram message
  if (!options.skipTelegram && scorerResult && !options.dryRun) {
    const date = new Date().toISOString().slice(0, 10);
    const message = generateTelegramMessage(date, scorerResult, frontierResult);
    const telegramPath = path.join(projectRoot, "public", "telegram-message.txt");
    fs.writeFileSync(telegramPath, message);
    outputs.push(telegramPath);
    ctx.logger.info("[pipeline] wrote telegram message");
  }

  // Cleanup
  await (ctx as any).stop?.();

  return {
    papersCollected: papers.length,
    scorerResult,
    frontierResult,
    outputs,
  };
}
