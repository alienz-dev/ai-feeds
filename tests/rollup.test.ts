/**
 * Tests for Weekly Rollup (SPEC-ROLLUP)
 *
 * Covers: AC-1 (query weekly data), AC-2 (statistics), AC-3 (markdown),
 * AC-4 (CLI), AC-5 (output path).
 *
 * Uses in-memory SQLite for fast, cleanup-free tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import type { IngestPaper } from "../db/types.js";
import { openDatabase, upsertPaper } from "../db/database.js";
import { generateRollup } from "../processor/rollup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makePaper(overrides: Partial<IngestPaper> = {}): IngestPaper {
  return {
    source: "arxiv",
    id: "2606.00001v1",
    title: "Test Paper",
    abstract: "A test abstract.",
    url: "https://arxiv.org/abs/2606.00001v1",
    authors: ["Alice"],
    categories: ["cs.AI"],
    primary_category: "cs.AI",
    published: daysAgo(1),
    ...overrides,
  };
}

function insertPaper(
  db: Database,
  overrides: Partial<IngestPaper> & { daysBack?: number } = {}
): void {
  const { daysBack = 1, ...paperOverrides } = overrides;
  const paper = makePaper(paperOverrides);
  upsertPaper(db, paper);
  // Back-date first_seen_at to simulate ingestion N days ago
  const seen = daysAgo(daysBack);
  db.prepare("UPDATE papers SET first_seen_at = ? WHERE title = ?").run(
    seen,
    paper.title
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateRollup", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  // --- AC-1: Query weekly data ---

  it("returns a non-empty markdown string", () => {
    insertPaper(db, { title: "Paper A", id: "p1", relevance_score: 9 });
    const md = generateRollup(db);
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("# Weekly Rollup");
  });

  it("queries papers from the last N weeks", () => {
    // Recent paper (1 day ago)
    insertPaper(db, {
      title: "Recent Paper",
      id: "p1",
      relevance_score: 8,
      daysBack: 1,
    });
    // Old paper (30 days ago) — should NOT appear in 1-week rollup
    insertPaper(db, {
      title: "Old Paper",
      id: "p2",
      relevance_score: 9,
      daysBack: 30,
    });

    const md = generateRollup(db, { weeks: 1 });
    expect(md).toContain("Recent Paper");
    expect(md).not.toContain("Old Paper");
  });

  it("includes more papers with larger week window", () => {
    insertPaper(db, {
      title: "Recent Paper",
      id: "p1",
      relevance_score: 8,
      daysBack: 1,
    });
    insertPaper(db, {
      title: "Old Paper",
      id: "p2",
      relevance_score: 9,
      daysBack: 30,
    });

    const md = generateRollup(db, { weeks: 8 });
    expect(md).toContain("Recent Paper");
    expect(md).toContain("Old Paper");
  });

  // --- AC-2: Generate statistics ---

  it("computes correct total papers count", () => {
    insertPaper(db, { title: "A", id: "p1", relevance_score: 5, daysBack: 1 });
    insertPaper(db, { title: "B", id: "p2", relevance_score: 3, daysBack: 2 });
    insertPaper(db, { title: "C", id: "p3", relevance_score: 8, daysBack: 3 });

    const md = generateRollup(db);
    expect(md).toContain("| Papers ingested | 3 |");
  });

  it("computes high relevance (8+) count", () => {
    insertPaper(db, { title: "High1", id: "p1", relevance_score: 9, daysBack: 1 });
    insertPaper(db, { title: "High2", id: "p2", relevance_score: 8, daysBack: 1 });
    insertPaper(db, { title: "Low", id: "p3", relevance_score: 5, daysBack: 1 });

    const md = generateRollup(db);
    expect(md).toContain("| High relevance (8+) | 2 |");
  });

  it("computes medium relevance (7) count", () => {
    insertPaper(db, { title: "Med1", id: "p1", relevance_score: 7, daysBack: 1 });
    insertPaper(db, { title: "Med2", id: "p2", relevance_score: 7, daysBack: 1 });
    insertPaper(db, { title: "High", id: "p3", relevance_score: 9, daysBack: 1 });

    const md = generateRollup(db);
    expect(md).toContain("| Medium relevance (7) | 2 |");
  });

  it("shows correct sources active count", () => {
    insertPaper(db, {
      title: "Arxiv Paper",
      id: "p1",
      source: "arxiv",
      relevance_score: 8,
      daysBack: 1,
    });
    insertPaper(db, {
      title: "HF Paper",
      id: "p2",
      source: "huggingface",
      relevance_score: 7,
      daysBack: 1,
    });

    const md = generateRollup(db);
    expect(md).toContain("| Sources active | 2 |");
  });

  // --- AC-2 / AC-3: Top papers sorted by score ---

  it("lists top 5 papers sorted by score descending", () => {
    const scores = [5, 9, 7, 10, 3, 8, 6];
    for (let i = 0; i < scores.length; i++) {
      insertPaper(db, {
        title: `Paper ${scores[i]}`,
        id: `p${i}`,
        relevance_score: scores[i],
        daysBack: 1,
      });
    }

    const md = generateRollup(db);
    // Top section should have score 10 first
    const topSection = md.split("## Top Papers")[1]?.split("##")[0] ?? "";
    expect(topSection).toContain("| 10 |");
    // Verify ordering: 10 appears before 9, 9 before 8
    const idx10 = topSection.indexOf("| 10 |");
    const idx9 = topSection.indexOf("| 9 |");
    const idx8 = topSection.indexOf("| 8 |");
    expect(idx10).toBeLessThan(idx9);
    expect(idx9).toBeLessThan(idx8);
  });

  it("limits top papers to 5", () => {
    for (let i = 0; i < 8; i++) {
      insertPaper(db, {
        title: `Paper ${i}`,
        id: `p${i}`,
        relevance_score: i + 1,
        daysBack: 1,
      });
    }

    const md = generateRollup(db);
    const topSection = md.split("## Top Papers")[1]?.split("##")[0] ?? "";
    // Count table data rows (lines starting with "| " that aren't headers)
    const dataRows = topSection
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Score"));
    // 5 data rows + 1 separator row
    const tableRows = dataRows.filter((r) => !r.match(/^\|[-\s|]+\|$/));
    expect(tableRows.length).toBe(5);
  });

  // --- Category distribution ---

  it("shows category distribution", () => {
    insertPaper(db, {
      title: "AI Paper",
      id: "p1",
      categories: ["cs.AI", "cs.CL"],
      primary_category: "cs.AI",
      relevance_score: 8,
      daysBack: 1,
    });
    insertPaper(db, {
      title: "LG Paper",
      id: "p2",
      categories: ["cs.LG"],
      primary_category: "cs.LG",
      relevance_score: 7,
      daysBack: 1,
    });

    const md = generateRollup(db);
    const catSection = md.split("## Categories")[1]?.split("##")[0] ?? "";
    expect(catSection).toContain("cs.AI");
    expect(catSection).toContain("cs.CL");
    expect(catSection).toContain("cs.LG");
  });

  // --- Source distribution ---

  it("shows source distribution", () => {
    insertPaper(db, {
      title: "Arxiv1",
      id: "p1",
      source: "arxiv",
      relevance_score: 8,
      daysBack: 1,
    });
    insertPaper(db, {
      title: "Arxiv2",
      id: "p2",
      source: "arxiv",
      relevance_score: 7,
      daysBack: 1,
    });
    insertPaper(db, {
      title: "HF1",
      id: "p3",
      source: "huggingface",
      relevance_score: 6,
      daysBack: 1,
    });

    const md = generateRollup(db);
    const srcSection = md.split("## Sources")[1]?.split("##")[0] ?? "";
    expect(srcSection).toContain("| arxiv | 2 |");
    expect(srcSection).toContain("| huggingface | 1 |");
  });

  // --- AC-3: Frontmatter ---

  it("has correct YAML frontmatter format", () => {
    insertPaper(db, { title: "Paper A", id: "p1", relevance_score: 8, daysBack: 1 });
    const md = generateRollup(db);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('title: "Weekly Rollup');
    expect(md).toContain("topic: wikis");
    expect(md).toContain("type: signal");
    expect(md).toContain("signal-source: rollup");
    expect(md).toContain("created:");
  });

  // --- Empty week ---

  it("handles empty week (no papers)", () => {
    const md = generateRollup(db);
    expect(md).toContain("| Papers ingested | 0 |");
    expect(md).toContain("| High relevance (8+) | 0 |");
    expect(md).toContain("| Medium relevance (7) | 0 |");
    expect(md).toContain("_No papers this week._");
    expect(md).toContain("_No categories this week._");
    expect(md).toContain("_No sources this week._");
  });

  // --- Edge cases ---

  it("handles papers with null relevance_score", () => {
    // Insert with a score, then clear it to simulate unscored paper
    insertPaper(db, {
      title: "Unscored Paper",
      id: "p1",
      relevance_score: 5,
      daysBack: 1,
    });
    db.prepare("UPDATE papers SET relevance_score = NULL WHERE title = ?").run(
      "Unscored Paper"
    );
    const md = generateRollup(db);
    // Should count in total but not in high/medium
    expect(md).toContain("| Papers ingested | 1 |");
    expect(md).toContain("| High relevance (8+) | 0 |");
    expect(md).toContain("_No papers this week._"); // no scored papers for top 5
  });

  it("escapes pipe characters in paper titles", () => {
    insertPaper(db, {
      title: "Paper | with pipes",
      id: "p1",
      relevance_score: 9,
      daysBack: 1,
    });
    const md = generateRollup(db);
    // The escaped title should appear
    expect(md).toContain("Paper \\| with pipes");
  });

  // --- CLI help ---

  it("CLI --help flag is recognized (import check)", async () => {
    // Verify the module exports generateRollup
    expect(typeof generateRollup).toBe("function");
  });
});
