/**
 * Weekly Trends Analyzer — fetches GitHub trending repos for the last N weeks,
 * scores them against learning interests, and generates a research verdict.
 */

import { GithubClient } from "../collectors/github-client.js";
import type { Paper } from "../collectors/common.js";
import { log, setupLogging } from "../collectors/common.js";
import { buildBatchPrompt, parseScoredResponse } from "./scorer-prompt.js";
import { callLlmOnce, type LlmProviderConfig } from "./llm-client.js";
import { openDatabase } from "../db/database.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

interface TrendVerdict {
  repo: Paper;
  score: number;
  verdict: "adopt" | "watch" | "skip";
  reasoning: string;
  action_items: string[];
}

interface WeeklyTrendsResult {
  generated_at: string;
  weeks_analyzed: number;
  total_repos: number;
  adopt: TrendVerdict[];
  watch: TrendVerdict[];
  skip: TrendVerdict[];
  summary: string;
}

// Load config
function loadConfig(): {
  languages: string[];
  weeks: number;
  maxResults: number;
  interests: string[];
  provider: string;
  model: string;
} {
  try {
    const configPath = path.join(process.cwd(), "config.yaml");
    const raw = yaml.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      languages: raw?.sources?.github_trending?.languages ?? ["python", "typescript"],
      weeks: 4,
      maxResults: 50,
      interests: raw?.learning_plan?.interests ?? [],
      provider: raw?.processor?.llm?.provider ?? "openai",
      model: raw?.processor?.llm?.model ?? "meta/llama-3.1-70b-instruct",
    };
  } catch {
    return {
      languages: ["python", "typescript"],
      weeks: 4,
      maxResults: 50,
      interests: [],
      provider: "openai",
      model: "meta/llama-3.1-70b-instruct",
    };
  }
}

// Fetch repos for the last N weeks
async function fetchWeeklyRepos(config: ReturnType<typeof loadConfig>): Promise<Paper[]> {
  const client = new GithubClient({
    delaySeconds: 2,
    timeoutSeconds: 30,
    retries: 3,
  });

  // Fetch repos from the last month (covers 4 weeks)
  const repos = await client.fetchRepos(
    config.languages,
    "monthly",
    config.maxResults
  );

  log.info(`Fetched ${repos.length} repos from last ${config.weeks} weeks`);
  return repos;
}

// Score repos and generate verdicts
async function scoreAndVerdict(
  repos: Paper[],
  config: ReturnType<typeof loadConfig>
): Promise<TrendVerdict[]> {
  const llmConfig: LlmProviderConfig = {
    provider: config.provider as any,
    model: config.model,
  };

  const verdicts: TrendVerdict[] = [];

  // Process in batches of 5
  for (let i = 0; i < repos.length; i += 5) {
    const batch = repos.slice(i, i + 5);

    try {
      const prompt = buildVerdictPrompt(config.interests, batch);
      const response = await callLlmOnce(prompt, llmConfig);
      const batchVerdicts = parseVerdictResponse(response, batch);
      verdicts.push(...batchVerdicts);
    } catch (err) {
      log.warn(`Batch ${Math.floor(i / 5)} failed: ${err instanceof Error ? err.message : err}`);
      // Assign skip verdict to failed batch
      for (const repo of batch) {
        verdicts.push({
          repo,
          score: 0,
          verdict: "skip",
          reasoning: "Failed to analyze",
          action_items: [],
        });
      }
    }
  }

  return verdicts;
}

// Build verdict prompt
function buildVerdictPrompt(
  interests: string[],
  repos: Paper[]
): string {
  const interestList = interests.map((i) => `- ${i}`).join("\n");
  const repoEntries = repos
    .map(
      (r, i) =>
        `${i}. ${r.title}
   Description: ${r.abstract}
   Stars: ${r.categories?.[0] || "N/A"}
   URL: ${r.url}`
    )
    .join("\n\n");

  return `You are a technology research advisor. Evaluate these GitHub repositories against the user's learning interests.

User's Learning Interests:
${interestList}

Repositories to evaluate:
${repoEntries}

For each repository, provide:
- index: the repo number (0-indexed)
- score: 1-10 relevance to learning interests
- verdict: "adopt" (highly relevant, start using), "watch" (relevant, monitor progress), or "skip" (not relevant)
- reasoning: 1-2 sentences explaining why
- action_items: 1-2 specific things to do (e.g., "Read the README", "Try the getting started guide", "Star and watch for updates")

IMPORTANT:
- Be conservative — only "adopt" if it directly addresses an active learning interest
- "watch" for emerging tools that might become relevant
- "skip" for things that are interesting but not aligned with current learning goals

Respond with a JSON array:
[{"index": 0, "score": N, "verdict": "adopt|watch|skip", "reasoning": "...", "action_items": ["..."]}]
No other text, just the JSON array.`;
}

// Parse verdict response
function parseVerdictResponse(
  response: string,
  repos: Paper[]
): TrendVerdict[] {
  try {
    // Try to extract JSON array
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const items = JSON.parse(match[0]);
    if (!Array.isArray(items)) return [];

    return items.map((item: any, idx: number) => ({
      repo: repos[idx] || repos[0],
      score: item.score || 0,
      verdict: item.verdict || "skip",
      reasoning: item.reasoning || "",
      action_items: item.action_items || [],
    }));
  } catch {
    return [];
  }
}

// Generate markdown report
function generateReport(result: WeeklyTrendsResult): string {
  const lines: string[] = [];

  lines.push(`# GitHub Trends Analysis — Last ${result.weeks_analyzed} Weeks`);
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(`Total repos analyzed: ${result.total_repos}`);
  lines.push("");

  // Adopt section
  if (result.adopt.length > 0) {
    lines.push(`## 🟢 Adopt (${result.adopt.length})`);
    lines.push("These are highly relevant to your learning interests. Consider adopting now.");
    lines.push("");
    for (const v of result.adopt) {
      lines.push(`### [${v.repo.title}](${v.repo.url})`);
      lines.push(`**Score:** ${v.score}/10`);
      lines.push(`**Why:** ${v.reasoning}`);
      lines.push(`**Actions:**`);
      for (const action of v.action_items) {
        lines.push(`- ${action}`);
      }
      lines.push("");
    }
  }

  // Watch section
  if (result.watch.length > 0) {
    lines.push(`## 🟡 Watch (${result.watch.length})`);
    lines.push("These are relevant but not urgent. Monitor their progress.");
    lines.push("");
    for (const v of result.watch) {
      lines.push(`### [${v.repo.title}](${v.repo.url})`);
      lines.push(`**Score:** ${v.score}/10`);
      lines.push(`**Why:** ${v.reasoning}`);
      lines.push("");
    }
  }

  // Skip section (collapsed)
  if (result.skip.length > 0) {
    lines.push(`## ⚪ Skip (${result.skip.length})`);
    lines.push("<details>");
    lines.push("<summary>Click to expand</summary>");
    lines.push("");
    for (const v of result.skip) {
      lines.push(`- **${v.repo.title}** (${v.score}/10): ${v.reasoning}`);
    }
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

// Main function
export async function analyzeWeeklyTrends(): Promise<WeeklyTrendsResult> {
  const config = loadConfig();

  if (config.interests.length === 0) {
    throw new Error("No learning interests configured in config.yaml");
  }

  // Fetch repos
  const repos = await fetchWeeklyRepos(config);

  if (repos.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      weeks_analyzed: config.weeks,
      total_repos: 0,
      adopt: [],
      watch: [],
      skip: [],
      summary: "No trending repos found for the last 4 weeks.",
    };
  }

  // Score and verdict
  const verdicts = await scoreAndVerdict(repos, config);

  // Categorize
  const adopt = verdicts.filter((v) => v.verdict === "adopt").sort((a, b) => b.score - a.score);
  const watch = verdicts.filter((v) => v.verdict === "watch").sort((a, b) => b.score - a.score);
  const skip = verdicts.filter((v) => v.verdict === "skip");

  const summary = `Analyzed ${repos.length} repos. ${adopt.length} to adopt, ${watch.length} to watch, ${skip.length} to skip.`;

  return {
    generated_at: new Date().toISOString(),
    weeks_analyzed: config.weeks,
    total_repos: repos.length,
    adopt,
    watch,
    skip,
    summary,
  };
}

// CLI entry point
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      output: { type: "string", short: "o" },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: weekly-trends [options]

Options:
  -h, --help           Show this help message
  -v, --verbose        Enable debug logging
  -o, --output <path>  Output file (default: stdout)
`);
    process.exit(0);
  }

  setupLogging(values.verbose ? "debug" : "info");

  console.log("Analyzing GitHub trends for the last 4 weeks...");
  const result = await analyzeWeeklyTrends();

  const report = generateReport(result);

  if (values.output) {
    fs.writeFileSync(values.output as string, report);
    console.log(`Report written to ${values.output}`);
  } else {
    console.log(report);
  }
}

// Run CLI
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("weekly-trends.ts") ||
   process.argv[1].endsWith("weekly-trends.js"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
