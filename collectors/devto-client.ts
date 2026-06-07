/**
 * Dev.to (Forem) API client — handles HTTP fetching, rate limiting, and retries.
 *
 * API docs: https://developers.forem.com/api/v1
 * Endpoint: GET /api/articles?tag=ai&top=7&per_page=30
 * No authentication required.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface DevtoClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  retries: number;
}

const DEVTO_API = "https://dev.to/api/articles";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Raw article shape from the Forem API. */
interface RawArticle {
  id: number;
  title: string;
  description: string;
  url: string;
  canonical_url: string;
  published_at: string;
  edited_at: string | null;
  tag_list: string[];
  user: {
    name: string;
    username: string;
  };
}

function parseArticle(raw: RawArticle): Paper {
  return {
    id: String(raw.id),
    title: raw.title ?? "",
    abstract: raw.description ?? "",
    url: raw.canonical_url || raw.url || "",
    pdf_url: "",
    authors: [raw.user?.name ?? raw.user?.username ?? "unknown"],
    categories: Array.isArray(raw.tag_list) ? raw.tag_list : [],
    primary_category: "devto",
    published: raw.published_at ?? "",
    updated: raw.edited_at ?? raw.published_at ?? "",
  };
}

export class DevtoClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private retries: number;

  constructor(config: DevtoClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
  }

  /**
   * Fetch articles from the Dev.to Forem API.
   *
   * @param tag   - Tag to filter by (e.g. "ai")
   * @param top   - Timeframe: 1=day, 7=week, 30=month, infinity=all
   * @param limit - Max articles per page (max 1000, default 30)
   */
  async fetchArticles(
    tag: string,
    top: number,
    limit: number
  ): Promise<Paper[]> {
    const url = `${DEVTO_API}?tag=${encodeURIComponent(tag)}&top=${top}&per_page=${limit}`;

    // Rate limit: wait before first request as well (in case of rapid re-invocation)
    await sleep(this.delaySeconds);

    const rawArticles = await this.fetchWithRetry(url);
    return rawArticles.map(parseArticle);
  }

  private async fetchWithRetry(url: string): Promise<RawArticle[]> {
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
          headers: { "User-Agent": "ai-feeds/0.1 (Dev.to collector)" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        if (!Array.isArray(data)) {
          throw new Error("Unexpected response: expected JSON array");
        }
        return data as RawArticle[];
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
