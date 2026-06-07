/**
 * Hacker News API client — handles HTTP fetching from both the HN Algolia
 * search API and the Firebase top stories API, with rate limiting and retries.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface HnClientConfig {
  timeoutSeconds: number;
  retries: number;
}

const HN_ALGOLIA_API = "https://hn.algolia.com/api/v1/search";
const HN_FIREBASE_API = "https://hacker-news.firebaseio.com/v0";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

interface RawHnHit {
  objectID: string;
  title: string;
  url: string;
  author: string;
  created_at_i: number;
  created_at: string;
  points: number;
  num_comments: number;
}

interface RawHnTopStory {
  id: number;
  title: string;
  url: string;
  by: string;
  time: number;
  descendants: number;
  score: number;
}

function normalizePaper(hit: RawHnHit): Paper {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const storyUrl = hit.url ?? "";
  const createdAt = new Date(hit.created_at_i * 1000).toISOString();

  return {
    id: `hn-${hit.objectID}`,
    title: hit.title ?? "",
    abstract: storyUrl, // story URL as abstract (HN stories are links)
    url: hnUrl,
    pdf_url: "",
    authors: [hit.author ?? ""],
    categories: ["hackernews"],
    primary_category: "hackernews",
    published: createdAt,
    updated: createdAt,
  };
}

function normalizeTopStory(story: RawHnTopStory): Paper {
  const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const storyUrl = story.url ?? "";
  const createdAt = new Date(story.time * 1000).toISOString();

  return {
    id: `hn-${story.id}`,
    title: story.title ?? "",
    abstract: storyUrl,
    url: hnUrl,
    pdf_url: "",
    authors: [story.by ?? ""],
    categories: ["hackernews"],
    primary_category: "hackernews",
    published: createdAt,
    updated: createdAt,
  };
}

export class HnClient {
  private timeoutSeconds: number;
  private retries: number;

  constructor(config: HnClientConfig) {
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
  }

  /**
   * Search HN Algolia API for stories matching a query.
   * Returns up to `hitsPerPage` results.
   */
  async searchStories(
    query: string,
    hitsPerPage: number
  ): Promise<Paper[]> {
    const url = `${HN_ALGOLIA_API}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${hitsPerPage}`;
    const data = await this.fetchWithRetry<{ hits: RawHnHit[] }>(url);
    const hits = data.hits ?? [];

    const papers: Paper[] = [];
    for (const hit of hits) {
      try {
        papers.push(normalizePaper(hit));
      } catch (err) {
        log.warn(`Failed to parse HN hit: ${err}`);
      }
    }

    return papers;
  }

  /**
   * Fetch top stories from the HN Firebase API, then fetch details
   * for the first `limit` stories.
   */
  async fetchTopStories(limit: number): Promise<Paper[]> {
    const topUrl = `${HN_FIREBASE_API}/topstories.json`;
    const topIds = await this.fetchWithRetry<number[]>(topUrl);
    const ids = topIds.slice(0, limit);

    const papers: Paper[] = [];
    for (const id of ids) {
      try {
        const storyUrl = `${HN_FIREBASE_API}/item/${id}.json`;
        const story = await this.fetchWithRetry<RawHnTopStory>(storyUrl);
        if (story && story.title) {
          papers.push(normalizeTopStory(story));
        }
      } catch (err) {
        log.warn(`Failed to fetch HN story ${id}: ${err}`);
      }
    }

    return papers;
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
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
          headers: { "User-Agent": "ai-feeds/0.1 (HN collector)" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as T;
        return data;
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
