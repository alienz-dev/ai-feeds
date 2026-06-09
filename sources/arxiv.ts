import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";
import yaml from "yaml";

const ARXIV_API = "http://export.arxiv.org/api/query";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripVersion(id: string): string {
  return id.replace(/v\d+$/, "");
}

function toArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function parseAuthors(authorField: unknown): string[] {
  return toArray(authorField).map((a: unknown) => {
    if (typeof a === "string") return a;
    if (typeof a === "object" && a !== null && "name" in a) {
      return String((a as { name: unknown }).name);
    }
    return String(a);
  });
}

function parseCategories(catField: unknown): string[] {
  return toArray(catField).map((c: unknown) => {
    if (typeof c === "string") return c;
    if (typeof c === "object" && c !== null && "@_term" in c) {
      return String((c as { "@_term": unknown })["@_term"]);
    }
    return String(c);
  });
}

function parsePrimaryCategory(catField: unknown): string {
  if (typeof catField === "string") return catField;
  if (typeof catField === "object" && catField !== null) {
    const obj = catField as Record<string, unknown>;
    if ("@_term" in obj) return String(obj["@_term"]);
  }
  const arr = parseCategories(catField);
  return arr[0] ?? "unknown";
}

function extractLinks(linkField: unknown): { url: string; pdf_url: string } {
  let url = "";
  let pdf_url = "";
  for (const link of toArray(linkField)) {
    if (typeof link === "object" && link !== null) {
      const obj = link as Record<string, unknown>;
      const href = String(obj["@_href"] ?? "");
      const type = String(obj["@_type"] ?? "");
      const title = String(obj["@_title"] ?? "");
      if (title === "pdf" || href.endsWith(".pdf")) {
        pdf_url = href;
      } else if (type === "text/html" || href.includes("/abs/")) {
        url = href;
      }
    }
  }
  return { url, pdf_url };
}

interface RawEntry {
  id: string;
  title: string;
  summary: string;
  author: unknown;
  category: unknown;
  published: string;
  updated: string;
  link: unknown;
}

function parseEntry(entry: RawEntry): Paper {
  const authors = parseAuthors(entry.author);
  const categories = parseCategories(entry.category);
  const primary_category = parsePrimaryCategory(
    Array.isArray(entry.category) ? entry.category[0] : entry.category
  );
  const { url, pdf_url } = extractLinks(entry.link);

  const rawId = String(entry.id ?? "");
  const idMatch = rawId.match(/(\d{4}\.\d{4,5}(?:v\d+)?)$/);
  const arxivId = idMatch ? idMatch[1] : rawId;

  return {
    id: arxivId,
    title: normalizeWhitespace(String(entry.title ?? "")),
    abstract: normalizeWhitespace(String(entry.summary ?? "")),
    url: url || `https://arxiv.org/abs/${arxivId}`,
    pdf_url: pdf_url || `https://arxiv.org/pdf/${arxivId}`,
    authors,
    categories,
    primary_category,
    published: String(entry.published ?? ""),
    updated: String(entry.updated ?? ""),
    source: "arxiv",
  };
}

function dedupByBaseId(papers: Paper[]): Paper[] {
  const byBaseId = new Map<string, Paper>();
  for (const paper of papers) {
    const baseId = stripVersion(paper.id);
    const existing = byBaseId.get(baseId);
    if (!existing) {
      byBaseId.set(baseId, paper);
    } else {
      const existingVer = parseInt(
        existing.id.match(/v(\d+)$/)?.[1] ?? "0",
        10
      );
      const newVer = parseInt(
        paper.id.match(/v(\d+)$/)?.[1] ?? "0",
        10
      );
      if (newVer > existingVer) {
        byBaseId.set(baseId, paper);
      }
    }
  }
  return Array.from(byBaseId.values());
}

function loadArxivConfig(): {
  categories: string[];
  max_results: number;
  delay_seconds: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
} {
  const defaults = {
    categories: ["cs.AI", "cs.CL", "cs.LG", "stat.ML"],
    max_results: 150,
    delay_seconds: 3.0,
    days_back: 2,
    timeout_seconds: 30,
    retries: 3,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.arxiv;
    if (!cfg) return defaults;
    return {
      categories: cfg.categories ?? defaults.categories,
      max_results: cfg.max_results ?? defaults.max_results,
      delay_seconds: cfg.delay_seconds ?? defaults.delay_seconds,
      days_back: cfg.days_back ?? defaults.days_back,
      timeout_seconds: cfg.timeout_seconds ?? defaults.timeout_seconds,
      retries: cfg.retries ?? defaults.retries,
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
): Promise<RawEntry[]> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

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
        headers: { "User-Agent": "ai-feeds/0.1 (arXiv collector)" },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const parsed = parser.parse(xml);
      const feed = parsed?.feed;
      if (!feed) throw new Error("Invalid XML: missing <feed> element");
      const entry = feed.entry;
      if (!entry) return [];
      return toArray(entry) as RawEntry[];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Request failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`
      );
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

export const arxivSource = defineSource({
  name: "arxiv",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadArxivConfig();
      const cutoff = new Date(Date.now() - config.days_back * 86_400_000);

      const query = config.categories.map((cat) => `cat:${cat}`).join(" OR ");
      const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&start=0&max_results=${config.max_results}&sortBy=submittedDate&sortOrder=descending`;

      ctx.logger.info(`Fetching arXiv papers: ${config.categories.join(", ")}`);
      const entries = await fetchWithRetry(
        url,
        config.timeout_seconds,
        config.retries,
        ctx.logger
      );

      const papers: Paper[] = [];
      for (const entry of entries) {
        try {
          const paper = parseEntry(entry);
          const pubDate = new Date(paper.published);
          if (pubDate >= cutoff) {
            papers.push(paper);
          }
        } catch (err) {
          ctx.logger.warn(`Failed to parse entry: ${err}`);
        }
      }

      const deduped = dedupByBaseId(papers);
      const normalized = deduped.map((p) => ({
        ...p,
        title: p.title.replace(/\s+/g, " ").trim(),
      }));

      ctx.logger.info(`[arxiv] collected ${normalized.length} papers`);
      return normalized;
    } catch (err) {
      ctx.logger.error(`[arxiv] fetch failed: ${err}`);
      return [];
    }
  },
});
