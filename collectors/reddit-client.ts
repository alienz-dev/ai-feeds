/**
 * Reddit JSON API client — handles HTTP fetching, rate limiting, and retries.
 *
 * Uses the public Reddit JSON API (no auth required).
 * IMPORTANT: Reddit requires a User-Agent header.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface RedditClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  retries: number;
}

const USER_AGENT = "ai-feeds/0.1 (Reddit collector)";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

interface RawRedditPost {
  data: {
    id: string;
    name: string;
    title: string;
    selftext: string;
    author: string;
    subreddit: string;
    permalink: string;
    url: string;
    created_utc: number;
    score: number;
    num_comments: number;
  };
}

interface RawRedditResponse {
  data: {
    children: RawRedditPost[];
  };
}

/**
 * Parse a raw Reddit post into the Paper interface.
 * Maps Reddit fields to the common Paper shape.
 */
export function parseRedditPost(post: RawRedditPost): Paper {
  const d = post.data;
  const created = new Date(d.created_utc * 1000).toISOString();

  return {
    id: d.id,
    title: d.title.replace(/\s+/g, " ").trim(),
    abstract: d.selftext || "",
    url: `https://www.reddit.com${d.permalink}`,
    pdf_url: "",
    authors: [d.author],
    categories: [d.subreddit],
    primary_category: d.subreddit,
    published: created,
    updated: created,
  };
}

export class RedditClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private retries: number;

  constructor(config: RedditClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
  }

  /**
   * Fetch hot posts from a single subreddit.
   */
  async fetchSubreddit(
    subreddit: string,
    sort: string,
    limit: number
  ): Promise<Paper[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}`;

    const raw = await this.fetchWithRetry(url);

    if (!raw?.data?.children) {
      log.warn(`No children in response for r/${subreddit}`);
      return [];
    }

    const papers: Paper[] = [];
    for (const child of raw.data.children) {
      try {
        papers.push(parseRedditPost(child));
      } catch (err) {
        log.warn(`Failed to parse post from r/${subreddit}: ${err}`);
      }
    }

    return papers;
  }

  /**
   * Fetch posts from multiple subreddits with rate limiting between requests.
   */
  async fetchMultipleSubreddits(
    subreddits: string[],
    sort: string,
    limit: number
  ): Promise<Paper[]> {
    const allPapers: Paper[] = [];

    for (let i = 0; i < subreddits.length; i++) {
      if (i > 0) {
        log.debug(`Rate limiting: waiting ${this.delaySeconds}s before next subreddit`);
        await sleep(this.delaySeconds);
      }

      const sub = subreddits[i];
      log.info(`Fetching r/${sub} (${sort}, limit=${limit})`);

      try {
        const papers = await this.fetchSubreddit(sub, sort, limit);
        allPapers.push(...papers);
        log.debug(`Got ${papers.length} posts from r/${sub}`);
      } catch (err) {
        log.warn(`Failed to fetch r/${sub}: ${err}`);
      }
    }

    return allPapers;
  }

  private async fetchWithRetry(url: string): Promise<RawRedditResponse> {
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
          headers: { "User-Agent": USER_AGENT },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const json = (await response.json()) as RawRedditResponse;
        return json;
      } catch (err) {
        lastError =
          err instanceof Error ? err : new Error(String(err));
        log.warn(
          `Request failed (attempt ${attempt + 1}/${this.retries + 1}): ${lastError.message}`
        );
      }
    }

    throw lastError ?? new Error("Unknown fetch error");
  }
}
