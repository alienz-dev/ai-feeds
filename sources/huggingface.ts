import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

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
    source: "huggingface",
  };
}

function loadHfConfig(): {
  limit: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
  delay_seconds: number;
} {
  const defaults = {
    limit: 30,
    days_back: 2,
    timeout_seconds: 30,
    retries: 3,
    delay_seconds: 1.0,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.huggingface;
    if (!cfg) return defaults;
    return {
      limit: cfg.limit ?? defaults.limit,
      days_back: cfg.days_back ?? defaults.days_back,
      timeout_seconds: cfg.timeout_seconds ?? defaults.timeout_seconds,
      retries: cfg.retries ?? defaults.retries,
      delay_seconds: cfg.delay_seconds ?? defaults.delay_seconds,
    };
  } catch {
    return defaults;
  }
}

async function fetchWithRetry(
  url: string,
  timeoutSeconds: number,
  retries: number,
  logger: NexusContext["logger"]
): Promise<RawHfEntry[]> {
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
        headers: { "User-Agent": "ai-feeds/0.1 (HuggingFace collector)" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as RawHfEntry[];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Request failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`
      );
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

export const hfSource = defineSource({
  name: "huggingface",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadHfConfig();
      const url = `${HF_API}?limit=${config.limit}`;
      const cutoff = new Date(Date.now() - config.days_back * 86_400_000);

      ctx.logger.info(`Fetching HuggingFace daily papers (limit=${config.limit})`);
      const entries = await fetchWithRetry(
        url,
        config.timeout_seconds,
        config.retries,
        ctx.logger
      );

      const papers: Paper[] = [];
      for (const entry of entries) {
        try {
          const paper = normalizePaper(entry);
          const pubDate = new Date(paper.published);
          if (pubDate >= cutoff) {
            papers.push(paper);
          }
        } catch (err) {
          ctx.logger.warn(`Failed to parse HF entry: ${err}`);
        }
      }

      // Dedup by ID
      const seen = new Set<string>();
      const deduped: Paper[] = [];
      for (const paper of papers) {
        if (!seen.has(paper.id)) {
          seen.add(paper.id);
          deduped.push(paper);
        }
      }

      const normalized = deduped.map((p) => ({
        ...p,
        title: p.title.replace(/\s+/g, " ").trim(),
      }));

      ctx.logger.info(`[huggingface] collected ${normalized.length} papers`);
      return normalized;
    } catch (err) {
      ctx.logger.error(`[huggingface] fetch failed: ${err}`);
      return [];
    }
  },
});
