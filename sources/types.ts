import { z } from "nexus";

/**
 * Shared paper schema for all ai-feeds sources.
 * Each source returns Paper[] with its own `source` field set.
 */
export const PaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  abstract: z.string(),
  url: z.string(),
  pdf_url: z.string().default(""),
  authors: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  primary_category: z.string().default(""),
  published: z.string().default(""),
  updated: z.string().default(""),
  source: z.string(), // "arxiv", "huggingface", "hackernews", etc.
});

export type Paper = z.infer<typeof PaperSchema>;
