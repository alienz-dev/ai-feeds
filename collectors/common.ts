/**
 * Shared utilities for all collectors.
 */

/** Paper interface shared across all collectors (arXiv, HuggingFace, etc.) */
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

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: number = LEVELS["info"];

/**
 * Configure the global log level for all collectors.
 * Accepts: "debug", "info", "warn", "error". Defaults to "info".
 */
export function setupLogging(level?: string): void {
  const resolved = level ?? "info";
  const numeric = LEVELS[resolved.toLowerCase()];
  if (numeric === undefined) {
    // Unknown level — just fall back to info silently
    currentLevel = LEVELS["info"];
  } else {
    currentLevel = numeric;
  }
}

/** Internal logger used by collectors. */
export const log = {
  debug(msg: string): void {
    if (currentLevel <= LEVELS["debug"]) {
      console.debug(`[ai-feeds:debug] ${msg}`);
    }
  },
  info(msg: string): void {
    if (currentLevel <= LEVELS["info"]) {
      console.info(`[ai-feeds:info] ${msg}`);
    }
  },
  warn(msg: string): void {
    if (currentLevel <= LEVELS["warn"]) {
      console.warn(`[ai-feeds:warn] ${msg}`);
    }
  },
  error(msg: string): void {
    if (currentLevel <= LEVELS["error"]) {
      console.error(`[ai-feeds:error] ${msg}`);
    }
  },
};

/** Sleep for the given number of seconds. */
export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Extract a fuzzy title key: first 5 words, lowercased, stripped of non-alphanum.
 * Catches variants like "LlamaStash: Introduction" vs "LlamaStash Benchmark Results".
 */
export function fuzzyTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
}

/** Deduplicate papers by ID and fuzzy title match, keeping the first occurrence. */
export function dedupPapers(papers: Paper[]): Paper[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const result: Paper[] = [];
  for (const paper of papers) {
    if (seenIds.has(paper.id)) continue;
    const titleKey = fuzzyTitleKey(paper.title);
    if (titleKey && seenTitles.has(titleKey)) continue;
    seenIds.add(paper.id);
    if (titleKey) seenTitles.add(titleKey);
    result.push(paper);
  }
  return result;
}

/** Normalize whitespace: collapse multiple spaces, trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
