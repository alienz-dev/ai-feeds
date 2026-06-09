import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

const DEVTO_API = "https://dev.to/api/articles";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

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
    source: "devto",
  };
}

function loadDevtoConfig(): {
  tag: string;
  top: number;
  limit: number;
  timeout_seconds: number;
  retries: number;
  delay_seconds: number;
} {
  const defaults = {
    tag: "ai",
    top: 7,
    limit: 30,
    timeout_seconds: 30,
    retries: 3,
    delay_seconds: 1.0,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.devto;
    if (!cfg) return defaults;
    return {
      tag: cfg.tag ?? defaults.tag,
      top: cfg.top ?? defaults.top,
      limit: cfg.limit ?? defaults.limit,
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
): Promise<RawArticle[]> {
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
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Request failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`
      );
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

export const devtoSource = defineSource({
  name: "devto",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadDevtoConfig();

      const url = `${DEVTO_API}?tag=${encodeURIComponent(config.tag)}&top=${config.top}&per_page=${config.limit}`;

      ctx.logger.info(`Fetching Dev.to articles (tag=${config.tag}, top=${config.top})`);

      // Rate limit: wait before first request
      await sleep(config.delay_seconds);

      const rawArticles = await fetchWithRetry(
        url,
        config.timeout_seconds,
        config.retries,
        ctx.logger
      );

      const papers = rawArticles.map(parseArticle);

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

      ctx.logger.info(`[devto] collected ${normalized.length} articles`);
      return normalized;
    } catch (err) {
      ctx.logger.error(`[devto] fetch failed: ${err}`);
      return [];
    }
  },
});
