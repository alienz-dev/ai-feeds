/**
 * HuggingFace Daily Papers API client — handles HTTP fetching,
 * rate limiting, and retries.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface HfClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  retries: number;
}

const HF_API = "https://huggingface.co/api/daily_papers";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface RawHfEntry {
  paper: {
    id: string;
    title: string;
    summary: string;
    authors: Array<{ name: string; _id: string }>;
    publishedAt: string;
    ai_keywords?: string[];
  };
  publishedAt: string;
  numComments: number;
}

function normalizePaper(raw: RawHfEntry): Paper {
  const { paper } = raw;
  const keywords = paper.ai_keywords ?? [];

  return {
    id: paper.id,
    title: normalizeWhitespace(paper.title ?? ""),
    abstract: String(paper.summary ?? ""),
    url: `https://huggingface.co/papers/${paper.id}`,
    pdf_url: `https://arxiv.org/pdf/${paper.id}`,
    authors: (paper.authors ?? []).map((a) => a.name),
    categories: keywords,
    primary_category: keywords.length > 0 ? keywords[0] : "hf-daily",
    published: String(paper.publishedAt ?? ""),
    updated: String(paper.publishedAt ?? ""),
  };
}

export class HfClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private retries: number;

  constructor(config: HfClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
  }

  async fetchPapers(limit: number, daysBack: number): Promise<Paper[]> {
    const url = `${HF_API}?limit=${limit}`;
    const cutoff = new Date(Date.now() - daysBack * 86_400_000);

    const entries = await this.fetchWithRetry(url);
    const papers: Paper[] = [];

    for (const entry of entries) {
      try {
        const paper = normalizePaper(entry);
        const pubDate = new Date(paper.published);
        if (pubDate >= cutoff) {
          papers.push(paper);
        }
      } catch (err) {
        log.warn(`Failed to parse HF entry: ${err}`);
      }
    }

    return papers;
  }

  private async fetchWithRetry(url: string): Promise<RawHfEntry[]> {
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
          headers: { "User-Agent": "ai-feeds/0.1 (HuggingFace collector)" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as RawHfEntry[];
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
