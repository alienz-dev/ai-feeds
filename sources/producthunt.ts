import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

const FEED_URL = "https://www.producthunt.com/feed";

interface FeedEntry {
  id: string;
  title: string;
  link: string;
  content: string;
  published: string;
}

/**
 * Parse Product Hunt Atom feed XML into entries.
 */
function parseFeedXml(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];

  // Simple XML parsing for Atom feed
  const entryMatches = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];

  for (const entryXml of entryMatches) {
    const id = entryXml.match(/<id>(.*?)<\/id>/)?.[1] ?? "";
    const title = entryXml.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const link = entryXml.match(/<link[^>]*href="([^"]*)"/)?.[1] ?? "";
    const published = entryXml.match(/<published>(.*?)<\/published>/)?.[1] ?? "";

    // Extract tagline from content (HTML-encoded)
    const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
    let content = "";
    if (contentMatch) {
      // Decode HTML entities and extract text
      content = contentMatch[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/<[^>]*>/g, "")
        .trim();
    }

    if (title && link) {
      entries.push({ id, title, link, content, published });
    }
  }

  return entries;
}

/**
 * Extract slug from Product Hunt URL.
 */
function extractSlug(url: string): string {
  const match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : "";
}

function entryToPaper(entry: FeedEntry): Paper {
  const slug = extractSlug(entry.link) || entry.title.toLowerCase().replace(/\s+/g, "-");
  const date = entry.published ? new Date(entry.published).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  return {
    id: slug,
    title: entry.title,
    abstract: entry.content,
    url: entry.link,
    pdf_url: "",
    authors: [],
    categories: [],
    primary_category: "producthunt",
    published: date,
    updated: date,
    source: "producthunt",
  };
}

export const producthuntSource = defineSource({
  name: "producthunt",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      ctx.logger.info("Fetching Product Hunt RSS feed");

      const response = await fetch(FEED_URL, {
        headers: {
          "User-Agent": "ai-feeds/0.1 (Product Hunt collector)",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const entries = parseFeedXml(xml);

      ctx.logger.info(`[producthunt] parsed ${entries.length} entries from feed`);

      const papers = entries.map(entryToPaper);

      // Dedup by ID
      const seen = new Set<string>();
      const deduped: Paper[] = [];
      for (const paper of papers) {
        if (!seen.has(paper.id)) {
          seen.add(paper.id);
          deduped.push(paper);
        }
      }

      ctx.logger.info(`[producthunt] collected ${deduped.length} products`);
      return deduped;
    } catch (err) {
      ctx.logger.error(`[producthunt] fetch failed: ${err}`);
      return [];
    }
  },
});
