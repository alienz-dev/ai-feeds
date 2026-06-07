/**
 * arXiv API client — handles HTTP fetching, XML parsing, rate limiting, and retries.
 */

import { XMLParser } from "fast-xml-parser";
import { log } from "./common.js";

export interface ArxivClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  retries: number;
}

export interface Paper {
  id: string;
  title: string;
  abstract: string;
  url: string;
  pdf_url: string;
  authors: string[];
  categories: string[];
  primary_category: string;
  published: string;
  updated: string;
}

const ARXIV_API = "http://export.arxiv.org/api/query";

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip version suffix from an arXiv ID: "2606.06493v1" → "2606.06493" */
function stripVersion(id: string): string {
  return id.replace(/v\d+$/, "");
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

function parseEntry(entry: RawEntry): Paper {
  const authors = parseAuthors(entry.author);
  const categories = parseCategories(entry.category);
  const primary_category = parsePrimaryCategory(
    Array.isArray(entry.category) ? entry.category[0] : entry.category
  );
  const { url, pdf_url } = extractLinks(entry.link);

  // Determine the arXiv ID from the entry id URL
  // Note: regex covers modern IDs (YYMM.NNNNN). Old-style IDs (hep-ph/9901234)
  // are not in cs.AI/cs.CL/cs.LG/stat.ML, so this is acceptable for our scope.
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
  };
}

export class ArxivClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private retries: number;
  private parser: XMLParser;

  constructor(config: ArxivClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.retries = config.retries;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
  }

  /**
   * Fetch papers from the arXiv API using a single OR query across all categories.
   * DD-2: One request instead of N (3s vs N×3s). The categories field on each
   * paper still tells you which categories it belongs to.
   */
  async fetchPapers(
    categories: string[],
    maxResults: number,
    daysBack: number
  ): Promise<Paper[]> {
    const papers: Paper[] = [];
    // Use UTC to match arXiv's UTC timestamps (avoids timezone drift)
    const cutoff = new Date(Date.now() - daysBack * 86_400_000);

    // Single OR query across all categories (DD-2)
    const query = categories.map((cat) => `cat:${cat}`).join(" OR ");
    const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

    const entries = await this.fetchWithRetry(url);
    for (const entry of entries) {
      try {
        const paper = parseEntry(entry);
        const pubDate = new Date(paper.published);
        if (pubDate >= cutoff) {
          papers.push(paper);
        }
      } catch (err) {
        log.warn(`Failed to parse entry: ${err}`);
      }
    }

    return papers;
  }

  private async fetchWithRetry(url: string): Promise<RawEntry[]> {
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
          headers: { "User-Agent": "ai-feeds/0.1 (arXiv collector)" },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xml = await response.text();
        return this.parseAtomFeed(xml);
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

  private parseAtomFeed(xml: string): RawEntry[] {
    const parsed = this.parser.parse(xml);

    // The arXiv Atom feed puts entries under feed.entry
    const feed = parsed?.feed;
    if (!feed) {
      throw new Error("Invalid XML: missing <feed> element");
    }

    const entry = feed.entry;
    if (!entry) {
      // No entries — empty result set
      return [];
    }

    return toArray(entry) as RawEntry[];
  }
}

export { stripVersion };
