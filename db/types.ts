/**
 * Type definitions for the SQLite database layer.
 */

/** Row shape returned from the papers table. */
export interface PaperRow {
  id: string;
  dedup_key: string;
  title: string;
  abstract: string | null;
  url: string | null;
  pdf_url: string | null;
  authors: string | null; // JSON TEXT
  categories: string | null; // JSON TEXT
  primary_category: string | null;
  published: string | null;
  updated: string | null;
  sources: string; // JSON TEXT — always present
  source_ids: string | null; // JSON TEXT
  relevance_score: number | null;
  score_explanation: string | null;
  scored_at: string | null;
  score_interests: string | null; // JSON TEXT
  first_seen_at: string;
  updated_at: string;
}

/** Input shape for upsertPaper — fields a collector/scorer provides. */
export interface IngestPaper {
  source: string;
  id?: string;
  title: string;
  abstract?: string;
  url?: string;
  pdf_url?: string;
  authors?: string[];
  categories?: string[];
  primary_category?: string;
  published?: string;
  updated?: string;
  source_id?: string;
  relevance_score?: number;
  score_explanation?: string;
  scored_at?: string;
  score_interests?: string[];
}
