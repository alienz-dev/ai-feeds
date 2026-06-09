#!/usr/bin/env npx tsx
/**
 * CLI entry point for the daily pipeline.
 *
 * Usage: npx tsx pipelines/run-daily.ts [options]
 *
 * Replaces scripts/daily-pipeline.sh with a TypeScript pipeline
 * that uses the nexus SDK.
 */

import { parseArgs } from "node:util";
import { runDailyPipeline, type DailyPipelineOptions } from "./daily.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      "skip-scorer": { type: "boolean", default: false },
      "skip-frontier": { type: "boolean", default: false },
      "skip-site": { type: "boolean", default: false },
      "skip-deploy": { type: "boolean", default: false },
      "skip-telegram": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: run-daily [options]

AI Feeds Daily Pipeline — collect, score, detect frontier, generate outputs.

Options:
  -h, --help           Show this help message
  --skip-scorer        Skip LLM relevance scoring
  --skip-frontier      Skip frontier topic detection
  --skip-site          Skip static site generation
  --skip-deploy        Skip Vercel deployment
  --skip-telegram      Skip Telegram notification
  --dry-run            Run pipeline without writing output files
  -v, --verbose        Enable debug logging
`);
    process.exit(0);
  }

  const options: DailyPipelineOptions = {
    skipScorer: !!values["skip-scorer"],
    skipFrontier: !!values["skip-frontier"],
    skipSite: !!values["skip-site"],
    skipDeploy: !!values["skip-deploy"],
    skipTelegram: !!values["skip-telegram"],
    dryRun: !!values["dry-run"],
    verbose: !!values.verbose,
  };

  console.log("🚀 Starting daily pipeline...");

  const startTime = Date.now();
  const result = await runDailyPipeline(options);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("");
  console.log("✅ Pipeline complete");
  console.log(`   Papers collected: ${result.papersCollected}`);
  if (result.scorerResult) {
    console.log(`   Papers scored: ${result.scorerResult.total_scored}`);
    console.log(`   Above threshold: ${result.scorerResult.total_above_threshold}`);
  }
  if (result.frontierResult) {
    console.log(`   Frontier topics: ${result.frontierResult.topics.length}`);
  }
  console.log(`   Outputs: ${result.outputs.length} files`);
  console.log(`   Duration: ${duration}s`);

  if (result.scorerResult && result.scorerResult.warnings.length > 0) {
    console.log(`\n⚠️  Warnings:`);
    for (const w of result.scorerResult.warnings) {
      console.log(`   - ${w}`);
    }
  }
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
