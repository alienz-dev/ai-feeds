import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import { arxivSource } from "./arxiv.js";
import { hfSource } from "./huggingface.js";
import { hnSource } from "./hackernews.js";
import { redditSource } from "./reddit.js";
import { githubSource } from "./github.js";
import { producthuntSource } from "./producthunt.js";
import { devtoSource } from "./devto.js";

/**
 * All sources in one array for easy iteration.
 */
export const allSources = [
  arxivSource,
  hfSource,
  hnSource,
  redditSource,
  githubSource,
  producthuntSource,
  devtoSource,
];

/**
 * Merged source that fetches from all collectors in parallel.
 * Failures from individual sources are logged and skipped.
 */
export const mergedSource = defineSource({
  name: "all-sources",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, since?: string): Promise<Paper[]> => {
    const results = await Promise.allSettled(
      allSources.map((src) => src.fetch(ctx, since))
    );

    const papers: Paper[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const sourceName = allSources[i].name;
      if (result.status === "fulfilled") {
        papers.push(...result.value);
        ctx.logger.info(`[${sourceName}] collected ${result.value.length} papers`);
      } else {
        ctx.logger.warn(`[${sourceName}] failed: ${result.reason}`);
      }
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    const deduped: Paper[] = [];
    for (const paper of papers) {
      if (!seen.has(paper.id)) {
        seen.add(paper.id);
        deduped.push(paper);
      }
    }

    ctx.logger.info(`[merged] total: ${papers.length} raw, ${deduped.length} deduped`);
    return deduped;
  },
});
