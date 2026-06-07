/**
 * GitHub Trending API client — handles HTTP fetching, rate limiting, and retries.
 * Uses the GitHub Search API to find trending AI/ML repositories.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface GithubClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  retries: number;
}

// Re-export Paper for backward compatibility
export type { Paper } from "./common.js";

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
  };
}

export class GithubClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private retries: number;

  constructor(config: GithubClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
  }

  /**
   * Fetch trending repos using the GitHub Search API.
   * Queries for repos with AI/ML topics, sorted by stars.
   * Optionally filters by language and creation date.
   */
  async fetchRepos(
    languages: string[],
    since: string,
    maxResults: number
  ): Promise<Paper[]> {
    const papers: Paper[] = [];

    // Calculate date cutoff based on `since` parameter
    const sinceDate = this.getSinceDate(since);

    // Build queries — one per language for targeted results
    // Use AI/ML topics to find relevant repos
    const baseTopics = [
      "machine-learning",
      "deep-learning",
      "artificial-intelligence",
    ];

    if (languages.length === 0) {
      // No language filter — single query
      const papersFromQuery = await this.fetchByQuery(
        baseTopics,
        undefined,
        sinceDate,
        maxResults
      );
      papers.push(...papersFromQuery);
    } else {
      // One query per language
      for (const lang of languages) {
        const papersFromQuery = await this.fetchByQuery(
          baseTopics,
          lang,
          sinceDate,
          maxResults
        );
        papers.push(...papersFromQuery);

        // Rate limit: delay between requests
        await sleep(this.delaySeconds);
      }
    }

    return papers;
  }

  private async fetchByQuery(
    topics: string[],
    language: string | undefined,
    sinceDate: string,
    maxResults: number
  ): Promise<Paper[]> {
    const topicQuery = topics.map((t) => `topic:${t}`).join("+");
    const dateQuery = `created:>${sinceDate}`;
    let q = `${topicQuery}+${dateQuery}`;
    if (language) {
      q += `+language:${language}`;
    }

    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${maxResults}`;

    const response = await this.fetchWithRetry(url);
    if (!response) return [];

    return response.items.map(repoToPaper);
  }

  private getSinceDate(since: string): string {
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

  private async fetchWithRetry(
    url: string
  ): Promise<GithubSearchResponse | null> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(2 ** attempt, 30);
        log.debug(`Retry ${attempt}/${this.retries}, backing off ${backoff}s`);
        await sleep(backoff);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.timeoutSeconds * 1000
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

        const json = (await response.json()) as GithubSearchResponse;
        return json;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.warn(
          `Request failed (attempt ${attempt + 1}/${this.retries + 1}): ${lastError.message}`
        );
      }
    }

    throw lastError ?? new Error("Unknown fetch error");
  }
}
