/**
 * Weekly GitHub Trends — fetches trending AI/ML repos from the last 4 weeks,
 * scores them, and generates a research verdict.
 */

import { callLlmOnce, type LlmProviderConfig } from "../processor/llm-client.js";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

interface Repo {
  id: string;
  name: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  topics: string[];
  created_at: string;
}

interface Verdict {
  repo: Repo;
  score: number;
  verdict: "adopt" | "watch" | "skip";
  reasoning: string;
  action_items: string[];
}

// Fetch repos from GitHub Search API (one query per topic, combine results)
async function fetchRepos(weeksBack: number, maxResults: number): Promise<Repo[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const topics = ["machine-learning", "deep-learning", "artificial-intelligence", "llm", "rag", "agent"];
  const seen = new Set<string>();
  const allRepos: Repo[] = [];

  console.log(`Fetching repos created after ${cutoffStr}...`);

  for (const topic of topics) {
    const query = `topic:${topic} created:>${cutoffStr} stars:>50`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Math.ceil(maxResults / topics.length)}`;

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "ai-feeds/0.1",
        },
      });

      if (!response.ok) {
        console.warn(`  ${topic}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as any;
      const count = data.items?.length || 0;
      console.log(`  ${topic}: ${count} repos`);

      for (const r of data.items || []) {
        if (seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        allRepos.push({
          id: String(r.id),
          name: r.full_name,
          description: r.description || "",
          url: r.html_url,
          stars: r.stargazers_count,
          language: r.language || "unknown",
          topics: r.topics || [],
          created_at: r.created_at,
        });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      console.warn(`  ${topic}: ${err.message}`);
    }
  }

  // Sort by stars, take top N
  allRepos.sort((a, b) => b.stars - a.stars);
  const result = allRepos.slice(0, maxResults);
  console.log(`Total unique repos: ${allRepos.length}, using top ${result.length}`);
  return result;
}

// Build verdict prompt
function buildPrompt(interests: string[], repos: Repo[]): string {
  const interestList = interests.map(i => `- ${i}`).join("\n");
  const repoEntries = repos.map((r, i) =>
    `${i}. ${r.name} (⭐${r.stars})
   Description: ${r.description}
   Language: ${r.language}
   Topics: ${r.topics.join(", ")}
   URL: ${r.url}`
  ).join("\n\n");

  return `Evaluate these GitHub repositories for a developer learning: ${interests.join(", ")}.

Repositories:
${repoEntries}

For each repo, provide:
- index: repo number (0-indexed)
- score: 1-10 relevance to learning interests
- verdict: "adopt" (start using now), "watch" (monitor), or "skip" (not relevant)
- reasoning: 1-2 sentences
- action_items: 1-2 specific next steps

Be conservative. Only "adopt" if directly relevant to active learning.

Respond with JSON array only:
[{"index":0,"score":N,"verdict":"adopt|watch|skip","reasoning":"...","action_items":["..."]}]`;
}

// Parse response
function parseResponse(response: string, repos: Repo[]): Verdict[] {
  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return repos.map(r => ({ repo: r, score: 0, verdict: "skip" as const, reasoning: "Parse failed", action_items: [] }));

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
    return repos.map(r => ({ repo: r, score: 0, verdict: "skip" as const, reasoning: "Parse failed", action_items: [] }));
  }
}

// Generate report
function generateReport(verdicts: Verdict[], weeks: number): string {
  const adopt = verdicts.filter(v => v.verdict === "adopt").sort((a, b) => b.score - a.score);
  const watch = verdicts.filter(v => v.verdict === "watch").sort((a, b) => b.score - a.score);
  const skip = verdicts.filter(v => v.verdict === "skip");

  const lines: string[] = [];
  lines.push(`# GitHub AI/ML Trends — Last ${weeks} Weeks`);
  lines.push(`Analyzed: ${verdicts.length} repos`);
  lines.push(`🟢 Adopt: ${adopt.length} | 🟡 Watch: ${watch.length} | ⚪ Skip: ${skip.length}`);
  lines.push("");

  if (adopt.length > 0) {
    lines.push(`## 🟢 Adopt (${adopt.length}) — Add to your research list`);
    lines.push("");
    for (const v of adopt) {
      lines.push(`### [${v.repo.name}](${v.repo.url}) ⭐${v.repo.stars}`);
      lines.push(`> ${v.repo.description}`);
      lines.push(`**Score:** ${v.score}/10 — ${v.reasoning}`);
      lines.push("**Actions:**");
      for (const a of v.action_items) {
        lines.push(`- [ ] ${a}`);
      }
      lines.push("");
    }
  }

  if (watch.length > 0) {
    lines.push(`## 🟡 Watch (${watch.length}) — Monitor progress`);
    lines.push("");
    for (const v of watch) {
      lines.push(`- **[${v.repo.name}](${v.repo.url})** ⭐${v.repo.stars} — ${v.reasoning}`);
    }
    lines.push("");
  }

  if (skip.length > 0) {
    lines.push(`## ⚪ Skip (${skip.length})`);
    lines.push("<details><summary>Click to expand</summary>\n");
    for (const v of skip) {
      lines.push(`- ${v.repo.name} (${v.score}/10): ${v.reasoning}`);
    }
    lines.push("\n</details>");
  }

  return lines.join("\n");
}

// Generate Telegram-friendly message
function generateTelegramMessage(verdicts: Verdict[], weeks: number): string {
  const adopt = verdicts.filter(v => v.verdict === "adopt").sort((a, b) => b.score - a.score);
  const watch = verdicts.filter(v => v.verdict === "watch").sort((a, b) => b.score - a.score);

  const lines: string[] = [];

  lines.push(`🔬 GitHub AI/ML Trends — Last ${weeks} Week${weeks > 1 ? 's' : ''}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`📊 Analyzed: ${verdicts.length} repos`);
  lines.push(`🟢 Adopt: ${adopt.length}  🟡 Watch: ${watch.length}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  if (adopt.length > 0) {
    lines.push('');
    lines.push('🟢 ADOPT — Add to research list');
    lines.push('');
    for (const v of adopt.slice(0, 5)) {
      const desc = v.repo.description.length > 80
        ? v.repo.description.slice(0, 80) + '...'
        : v.repo.description;
      lines.push(`⭐ ${v.repo.name} (⭐${v.repo.stars})`);
      lines.push(`   ${desc}`);
      lines.push(`   → ${v.action_items[0] || 'Explore repo'}`);
      lines.push('');
    }
  }

  if (watch.length > 0) {
    lines.push('🟡 WATCH — Monitor progress');
    lines.push('');
    for (const v of watch.slice(0, 5)) {
      lines.push(`📌 ${v.repo.name} (⭐${v.repo.stars})`);
      lines.push(`   ${v.reasoning.slice(0, 80)}...`);
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📄 Full report saved to vault`);

  return lines.join('\n');
}

// Send Telegram notification
async function sendTelegram(message: string): Promise<void> {
  try {
    // Get token from pass
    const { execSync } = await import("child_process");
    const token = execSync("pass show telegram/agent-bot-token 2>/dev/null", { encoding: "utf-8" }).trim();
    const chatId = "8241902980";

    if (!token) {
      console.log("No Telegram token found, skipping notification");
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json() as any;
    if (result.ok) {
      console.log("✅ Telegram notification sent");
    } else {
      console.log("❌ Telegram error:", result.description);
    }
  } catch (err: any) {
    console.log("⚠️ Telegram notification failed:", err.message);
  }
}

// Main
async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      weeks: { type: "string", short: "w", default: "4" },
      output: { type: "string", short: "o" },
      notify: { type: "boolean", short: "n", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: weekly-github-trends [options]

Options:
  -h, --help         Show this help
  -w, --weeks <n>    Weeks to look back (default: 4)
  -o, --output <path> Output file (default: stdout)
  -n, --notify       Send Telegram notification
`);
    process.exit(0);
  }

  const weeks = parseInt(values.weeks as string, 10);

  // Load config
  const configPath = path.join(process.cwd(), "config.yaml");
  const config = yaml.parse(fs.readFileSync(configPath, "utf-8"));
  const interests: string[] = config?.learning_plan?.interests ?? [];
  const provider = config?.processor?.llm?.provider ?? "openai";
  const model = config?.processor?.llm?.model ?? "meta/llama-3.1-70b-instruct";

  if (interests.length === 0) {
    console.error("No learning interests in config.yaml");
    process.exit(1);
  }

  // Fetch repos
  const repos = await fetchRepos(weeks, 30);
  console.log(`Scoring ${repos.length} repos...`);

  // Score in batches
  const llmConfig: LlmProviderConfig = { provider: provider as any, model };
  const allVerdicts: Verdict[] = [];

  for (let i = 0; i < repos.length; i += 5) {
    const batch = repos.slice(i, i + 5);
    const batchNum = Math.floor(i / 5) + 1;
    const totalBatches = Math.ceil(repos.length / 5);
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}...`);

    try {
      const prompt = buildPrompt(interests, batch);
      const response = await callLlmOnce(prompt, llmConfig);
      const verdicts = parseResponse(response, batch);
      allVerdicts.push(...verdicts);
      console.log(` ✓ (${verdicts.length} repos)`);
    } catch (err: any) {
      console.log(` ✗ (${err.message})`);
      for (const repo of batch) {
        allVerdicts.push({ repo, score: 0, verdict: "skip", reasoning: "Analysis failed", action_items: [] });
      }
    }
  }

  // Generate report
  const report = generateReport(allVerdicts, weeks);

  if (values.output) {
    fs.writeFileSync(values.output as string, report);
    console.log(`\nReport written to ${values.output}`);
  } else {
    console.log("\n" + report);
  }

  // Send Telegram notification if requested
  if (values.notify) {
    const adopt = allVerdicts.filter(v => v.verdict === "adopt");
    const watch = allVerdicts.filter(v => v.verdict === "watch");

    if (adopt.length > 0 || watch.length > 0) {
      const telegramMsg = generateTelegramMessage(allVerdicts, weeks);
      await sendTelegram(telegramMsg);
    } else {
      console.log("No adopt/watch items, skipping Telegram notification");
    }
  }
}

main().catch(console.error);
