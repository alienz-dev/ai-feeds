import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

const HN_ALGOLIA_API = "https://hn.algolia.com/api/v1/search";

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

function normalizePaper(hit: RawHnHit): Paper {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const storyUrl = hit.url ?? "";
  const createdAt = new Date(hit.created_at_i * 1000).toISOString();

  return {
    id: `hn-${hit.objectID}`,
    title: hit.title ?? "",
    abstract: storyUrl,
    url: hnUrl,
    pdf_url: "",
    authors: [hit.author ?? ""],
    categories: ["hackernews"],
    primary_category: "hackernews",
    published: createdAt,
    updated: createdAt,
    source: "hackernews",
  };
}

function loadHnConfig(): {
  queries: string[];
  max_stories: number;
  timeout_seconds: number;
  retries: number;
  days_back: number;
} {
  const defaults = {
    queries: ["AI", "LLM", "machine learning"],
    max_stories: 30,
    timeout_seconds: 30,
    retries: 3,
    days_back: 2,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.hackernews;
    if (!cfg) return defaults;
    return {
      queries: cfg.queries ?? defaults.queries,
      max_stories: cfg.max_stories ?? defaults.max_stories,
      timeout_seconds: cfg.timeout_seconds ?? defaults.timeout_seconds,
      retries: cfg.retries ?? defaults.retries,
      days_back: cfg.days_back ?? defaults.days_back,
    };
  } catch {
    return defaults;
  }
}

async function fetchWithRetry<T>(
  url: string,
  timeoutSeconds: number,
  retries: number,
  logger: NexusContext["logger"]
): Promise<T> {
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
        headers: { "User-Agent": "ai-feeds/0.1 (HN collector)" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Request failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`
      );
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

export const hnSource = defineSource({
  name: "hackernews",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadHnConfig();
      const sinceTimestamp =
        Math.floor(Date.now() / 1000) - config.days_back * 86400;

      ctx.logger.info(`Fetching HN stories for queries: ${config.queries.join(", ")}`);

      const allPapers: Paper[] = [];
      for (const query of config.queries) {
        try {
          let url = `${HN_ALGOLIA_API}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${config.max_stories}`;
          if (sinceTimestamp) {
            url += `&numericFilters=created_at_i>${sinceTimestamp}`;
          }

          const data = await fetchWithRetry<{ hits: RawHnHit[] }>(
            url,
            config.timeout_seconds,
            config.retries,
            ctx.logger
          );
          const hits = data.hits ?? [];

          for (const hit of hits) {
            try {
              allPapers.push(normalizePaper(hit));
            } catch (err) {
              ctx.logger.warn(`Failed to parse HN hit: ${err}`);
            }
          }
        } catch (err) {
          ctx.logger.warn(`Query "${query}" failed: ${err}`);
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

      ctx.logger.info(`[hackernews] collected ${normalized.length} stories`);
      return normalized;
    } catch (err) {
      ctx.logger.error(`[hackernews] fetch failed: ${err}`);
      return [];
    }
  },
});
