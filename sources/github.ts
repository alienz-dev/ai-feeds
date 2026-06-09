import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "ai-feeds/0.1 (GitHub Trending collector)";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

interface GithubRepo {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  owner: { login: string };
  topics: string[];
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
}

interface GithubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubRepo[];
}

function repoToPaper(repo: GithubRepo): Paper {
  const topics = repo.topics ?? [];
  return {
    id: String(repo.id),
    title: repo.full_name,
    abstract: repo.description ?? "",
    url: repo.html_url,
    pdf_url: "",
    authors: [repo.owner.login],
    categories: topics,
    primary_category: topics[0] ?? "github",
    published: repo.created_at,
    updated: repo.pushed_at,
    source: "github",
  };
}

function loadGithubConfig(): {
  languages: string[];
  since: string;
  max_results: number;
  delay_seconds: number;
  timeout_seconds: number;
  retries: number;
} {
  const defaults = {
    languages: ["python", "typescript"],
    since: "daily",
    max_results: 30,
    delay_seconds: 2.0,
    timeout_seconds: 30,
    retries: 3,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.github_trending;
    if (!cfg) return defaults;
    return {
      languages: cfg.languages ?? defaults.languages,
      since: cfg.since ?? defaults.since,
      max_results: cfg.max_results ?? defaults.max_results,
      delay_seconds: cfg.delay_seconds ?? defaults.delay_seconds,
      timeout_seconds: cfg.timeout_seconds ?? defaults.timeout_seconds,
      retries: cfg.retries ?? defaults.retries,
    };
  } catch {
    return defaults;
  }
}

function getSinceDate(since: string): string {
  const now = new Date();
  let daysBack: number;

  switch (since) {
    case "daily":
      daysBack = 1;
      break;
    case "weekly":
      daysBack = 7;
      break;
    case "monthly":
      daysBack = 30;
      break;
    default:
      daysBack = 1;
  }

  const cutoff = new Date(now.getTime() - daysBack * 86_400_000);
  return cutoff.toISOString().slice(0, 10);
}

async function fetchWithRetry(
  url: string,
  timeoutSeconds: number,
  retries: number,
  logger: NexusContext["logger"]
): Promise<GithubSearchResponse | null> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(2 ** attempt, 30);
      logger.debug(`Retry ${attempt}/${retries}, backing off ${backoff}s`);
      await sleep(backoff);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        timeoutSeconds * 1000
      );

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github+json",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as GithubSearchResponse;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Request failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`
      );
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

async function fetchByQuery(
  topics: string[],
  language: string | undefined,
  sinceDate: string,
  maxResults: number,
  timeoutSeconds: number,
  retries: number,
  logger: NexusContext["logger"]
): Promise<Paper[]> {
  const topicQuery = topics.map((t) => `topic:${t}`).join("+");
  const dateQuery = `created:>${sinceDate}`;
  let q = `${topicQuery}+${dateQuery}`;
  if (language) {
    q += `+language:${language}`;
  }

  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;

  const response = await fetchWithRetry(url, timeoutSeconds, retries, logger);
  if (!response) return [];

  return response.items.map(repoToPaper);
}

export const githubSource = defineSource({
  name: "github",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadGithubConfig();
      const sinceDate = getSinceDate(config.since);

      const baseTopics = [
        "machine-learning",
        "deep-learning",
        "artificial-intelligence",
      ];

      ctx.logger.info(
        `Fetching GitHub trending repos (languages: ${config.languages.join(", ")}, since: ${config.since})`
      );

      const allPapers: Paper[] = [];

      if (config.languages.length === 0) {
        const papers = await fetchByQuery(
          baseTopics,
          undefined,
          sinceDate,
          config.max_results,
          config.timeout_seconds,
          config.retries,
          ctx.logger
        );
        allPapers.push(...papers);
      } else {
        for (const lang of config.languages) {
          const papers = await fetchByQuery(
            baseTopics,
            lang,
            sinceDate,
            config.max_results,
            config.timeout_seconds,
            config.retries,
            ctx.logger
          );
          allPapers.push(...papers);
          await sleep(config.delay_seconds);
        }
      }

      // Dedup by ID
      const seen = new Set<string>();
      const deduped: Paper[] = [];
      for (const paper of allPapers) {
        if (!seen.has(paper.id)) {
          seen.add(paper.id);
          deduped.push(paper);
        }
      }

      const normalized = deduped.map((p) => ({
        ...p,
        title: p.title.replace(/\s+/g, " ").trim(),
      }));

      ctx.logger.info(`[github] collected ${normalized.length} repos`);
      return normalized;
    } catch (err) {
      ctx.logger.error(`[github] fetch failed: ${err}`);
      return [];
    }
  },
});
