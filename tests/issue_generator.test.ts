/**
 * Tests for Learning Issue Generator (SPEC-ISSUES)
 *
 * Covers: AC-1 (read scored papers), AC-2 (match against learning plan),
 * AC-3 (generate issue markdown), AC-4 (dedup), AC-5 (CLI), AC-6 (config)
 *
 * Uses in-memory SQLite (`:memory:`) for fast, cleanup-free tests.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PaperRow, IngestPaper } from "../db/types.js";
import { openDatabase, upsertPaper } from "../db/database.js";
import {
  generateIssues,
  loadConfig,
  titleToSlug,
  loadExistingIssueUrls,
  generateIssueMarkdown,
} from "../processor/issue_generator.js";
import type { Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeScoredPaper(overrides: Partial<IngestPaper> = {}): IngestPaper {
  return {
    source: "arxiv",
    id: "2606.06493v1",
    title: "Attention Is All You Need (Again)",
    abstract: "We propose a new transformer architecture...",
    url: "https://arxiv.org/abs/2606.06493v1",
    pdf_url: "https://arxiv.org/pdf/2606.06493v1",
    authors: ["Alice Smith", "Bob Jones"],
    categories: ["cs.AI", "cs.CL"],
    primary_category: "cs.AI",
    published: "2026-06-07T10:00:00Z",
    updated: "2026-06-07T10:00:00Z",
    relevance_score: 8,
    score_explanation: "Highly relevant to context engineering interests.",
    scored_at: "2026-06-07T12:00:00Z",
    score_interests: ["context engineering", "transformers"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-6: Config loading
// ---------------------------------------------------------------------------

describe("AC-6: Config loading", () => {
  it("loadConfig returns defaults when given empty object", () => {
    const config = loadConfig({});
    expect(config.threshold).toBeDefined();
    expect(typeof config.threshold).toBe("number");
    expect(Array.isArray(config.interests)).toBe(true);
  });

  it("loadConfig reads threshold from processor.relevance_threshold", () => {
    const config = loadConfig({
      processor: { relevance_threshold: 9 },
      learning_plan: { interests: ["RAG", "agents"] },
    });
    expect(config.threshold).toBe(9);
    expect(config.interests).toEqual(["RAG", "agents"]);
  });

  it("loadConfig falls back to defaults for missing learning_plan", () => {
    const config = loadConfig({ processor: { relevance_threshold: 7 } });
    // interests should come from config.yaml defaults or be empty
    expect(Array.isArray(config.interests)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// titleToSlug
// ---------------------------------------------------------------------------

describe("titleToSlug", () => {
  it("converts title to lowercase hyphenated slug", () => {
    expect(titleToSlug("Attention Is All You Need")).toBe(
      "attention-is-all-you-need"
    );
  });

  it("strips non-alphanumeric characters", () => {
    expect(titleToSlug("Scaling Laws: A Deep Dive (2026)")).toBe(
      "scaling-laws-a-deep-dive-2026"
    );
  });

  it("truncates to 50 characters", () => {
    const longTitle =
      "A Very Long Paper Title That Goes On And On And Should Be Truncated At Fifty Characters";
    const slug = titleToSlug(longTitle);
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("handles empty string", () => {
    expect(titleToSlug("")).toBe("");
  });

  it("collapses multiple hyphens", () => {
    expect(titleToSlug("foo---bar")).toBe("foo-bar");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Generate issue markdown
// ---------------------------------------------------------------------------

describe("AC-3: Generate issue markdown", () => {
  let db: Database;

  beforeAll(() => {
    db = openDatabase(":memory:");
    upsertPaper(
      db,
      makeScoredPaper({
        id: "md-1",
        title: "Test Paper for Markdown",
        relevance_score: 9,
        score_explanation: "This paper explains the key concept.",
      })
    );
  });

  afterAll(() => {
    db.close();
  });

  it("generates markdown with correct YAML frontmatter", () => {
    const paper = db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .get("md-1") as PaperRow;
    const md = generateIssueMarkdown(paper);

    expect(md).toContain("---");
    expect(md).toContain('title: "Learn: Test Paper for Markdown"');
    expect(md).toContain("status: BACKLOG");
    expect(md).toContain("paper_url: https://arxiv.org/abs/2606.06493v1");
    expect(md).toContain("relevance_score: 9");
    expect(md).toContain("created:");
    expect(md).toContain("tags: [learning, cs-AI, cs-CL]");
  });

  it("includes paper URL and PDF URL in Source section", () => {
    const paper = db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .get("md-1") as PaperRow;
    const md = generateIssueMarkdown(paper);

    expect(md).toContain(
      "[Test Paper for Markdown](https://arxiv.org/abs/2606.06493v1)"
    );
    expect(md).toContain(
      "[https://arxiv.org/pdf/2606.06493v1](https://arxiv.org/pdf/2606.06493v1)"
    );
  });

  it("includes score_explanation in Why This Matters section", () => {
    const paper = db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .get("md-1") as PaperRow;
    const md = generateIssueMarkdown(paper);

    expect(md).toContain("## Why This Matters");
    expect(md).toContain("This paper explains the key concept.");
  });

  it("includes acceptance criteria with checkboxes", () => {
    const paper = db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .get("md-1") as PaperRow;
    const md = generateIssueMarkdown(paper);

    expect(md).toContain("## Acceptance Criteria");
    expect(md).toContain("- [ ] Read the paper abstract and introduction");
    expect(md).toContain("- [ ] Identify the 3 most important concepts");
    expect(md).toContain("- [ ] Build a minimal working example");
    expect(md).toContain("- [ ] Write a summary in your own words");
    expect(md).toContain("- [ ] Create an evergreen note in your vault");
  });

  it("includes timebox section", () => {
    const paper = db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .get("md-1") as PaperRow;
    const md = generateIssueMarkdown(paper);

    expect(md).toContain("## Timebox");
    expect(md).toContain("2 hours");
  });
});

// ---------------------------------------------------------------------------
// AC-4: Dedup against existing issues
// ---------------------------------------------------------------------------

describe("AC-4: Dedup against existing issues", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-dedup-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadExistingIssueUrls extracts paper_url from frontmatter", () => {
    const issuesDir = path.join(tmpDir, "existing");
    fs.mkdirSync(issuesDir, { recursive: true });

    const existingIssue = `---
title: "Learn: Existing Paper"
status: IN_PROGRESS
paper_url: https://arxiv.org/abs/1234.56789
relevance_score: 9
created: 2026-06-01
tags: [learning]
---

# Learn: Existing Paper
`;
    fs.writeFileSync(
      path.join(issuesDir, "learn-existing-paper.md"),
      existingIssue
    );

    const urls = loadExistingIssueUrls(issuesDir);
    expect(urls.has("https://arxiv.org/abs/1234.56789")).toBe(true);
    expect(urls.size).toBe(1);
  });

  it("loadExistingIssueUrls skips TEMPLATE.md and BACKLOG.md", () => {
    const issuesDir = path.join(tmpDir, "skip-templates");
    fs.mkdirSync(issuesDir, { recursive: true });

    fs.writeFileSync(
      path.join(issuesDir, "TEMPLATE.md"),
      `---\npaper_url: https://example.com/template\n---\n`
    );
    fs.writeFileSync(
      path.join(issuesDir, "BACKLOG.md"),
      `---\npaper_url: https://example.com/backlog\n---\n`
    );

    const urls = loadExistingIssueUrls(issuesDir);
    expect(urls.size).toBe(0);
  });

  it("generateIssues skips papers whose URL already has an issue", async () => {
    const db2 = openDatabase(":memory:");
    const issuesDir = path.join(tmpDir, "dedup-run");
    fs.mkdirSync(issuesDir, { recursive: true });

    upsertPaper(
      db2,
      makeScoredPaper({
        id: "dedup-1",
        title: "Already Has Issue",
        url: "https://arxiv.org/abs/9999.00001",
        relevance_score: 9,
      })
    );
    upsertPaper(
      db2,
      makeScoredPaper({
        id: "dedup-2",
        title: "New Paper Needs Issue",
        url: "https://arxiv.org/abs/9999.00002",
        relevance_score: 9,
      })
    );

    // Create an existing issue for the first paper
    fs.writeFileSync(
      path.join(issuesDir, "learn-already-has-issue.md"),
      `---
title: "Learn: Already Has Issue"
status: BACKLOG
paper_url: https://arxiv.org/abs/9999.00001
relevance_score: 9
created: 2026-06-01
tags: [learning]
---

# Learn: Already Has Issue
`
    );

    const result = await generateIssues(db2, {
      issuesDir,
      dryRun: false,
    });

    expect(result.skipped_existing).toBe(1);
    expect(result.generated).toBe(1);
    expect(result.issues[0].paper_title).toBe("New Paper Needs Issue");

    db2.close();
  });
});

// ---------------------------------------------------------------------------
// AC-1: Query scored papers from DB
// ---------------------------------------------------------------------------

describe("AC-1: Query scored papers from DB", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-query-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates issues only for papers with score >= threshold", async () => {
    const db2 = openDatabase(":memory:");
    const issuesDir = path.join(tmpDir, "threshold-test");
    fs.mkdirSync(issuesDir, { recursive: true });

    upsertPaper(
      db2,
      makeScoredPaper({
        id: "high-1",
        title: "High Score Paper",
        url: "https://arxiv.org/abs/high-1",
        relevance_score: 9,
      })
    );
    upsertPaper(
      db2,
      makeScoredPaper({
        id: "low-1",
        title: "Low Score Paper",
        url: "https://arxiv.org/abs/low-1",
        relevance_score: 5,
      })
    );
    upsertPaper(
      db2,
      makeScoredPaper({
        id: "no-score-1",
        title: "No Score Paper",
        url: "https://arxiv.org/abs/no-score-1",
        relevance_score: null as unknown as number,
      })
    );

    const result = await generateIssues(db2, { issuesDir });

    // Only high score paper should generate an issue
    expect(result.generated).toBe(1);
    expect(result.issues[0].paper_title).toBe("High Score Paper");
    expect(result.total_eligible).toBe(1);

    db2.close();
  });

  it("returns empty result when no papers meet threshold", async () => {
    const db2 = openDatabase(":memory:");
    const issuesDir = path.join(tmpDir, "empty-test");
    fs.mkdirSync(issuesDir, { recursive: true });

    upsertPaper(
      db2,
      makeScoredPaper({
        id: "empty-low",
        title: "Below Threshold",
        relevance_score: 3,
      })
    );

    const result = await generateIssues(db2, { issuesDir });

    expect(result.generated).toBe(0);
    expect(result.total_eligible).toBe(0);
    expect(result.issues).toEqual([]);

    db2.close();
  });
});

// ---------------------------------------------------------------------------
// AC-5: CLI --limit
// ---------------------------------------------------------------------------

describe("AC-5: CLI options", () => {
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    db = openDatabase(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-cli-test-"));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("respects limit option to cap number of issues", async () => {
    const db2 = openDatabase(":memory:");
    const issuesDir = path.join(tmpDir, "limit-test");
    fs.mkdirSync(issuesDir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      upsertPaper(
        db2,
        makeScoredPaper({
          id: `limit-${i}`,
          title: `Paper Number ${i}`,
          url: `https://arxiv.org/abs/limit-${i}`,
          relevance_score: 9,
        })
      );
    }

    const result = await generateIssues(db2, { issuesDir, limit: 2 });

    expect(result.generated).toBe(2);
    expect(result.total_eligible).toBe(5);

    db2.close();
  });

  it("dryRun does not create files", async () => {
    const db2 = openDatabase(":memory:");
    const issuesDir = path.join(tmpDir, "dryrun-test");
    fs.mkdirSync(issuesDir, { recursive: true });

    upsertPaper(
      db2,
      makeScoredPaper({
        id: "dry-1",
        title: "Dry Run Paper",
        url: "https://arxiv.org/abs/dry-1",
        relevance_score: 9,
      })
    );

    const result = await generateIssues(db2, { issuesDir, dryRun: true });

    expect(result.generated).toBe(1);
    // No files should be created
    const files = fs.readdirSync(issuesDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(0);

    db2.close();
  });
});

// ---------------------------------------------------------------------------
// AC-3: Issue file naming
// ---------------------------------------------------------------------------

describe("AC-3: Issue file naming", () => {
  it("uses learn-{slug}.md naming convention", () => {
    const slug = titleToSlug("Scaling Laws for Context Engineering");
    expect(slug).toBe("scaling-laws-for-context-engineering");
    expect(`learn-${slug}.md`).toBe(
      "learn-scaling-laws-for-context-engineering.md"
    );
  });

  it("generates correct filename from generateIssues", async () => {
    const db = openDatabase(":memory:");
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "issue-naming-test-")
    );
    const issuesDir = path.join(tmpDir, "naming");
    fs.mkdirSync(issuesDir, { recursive: true });

    upsertPaper(
      db,
      makeScoredPaper({
        id: "name-1",
        title: "Context Engineering for LLMs",
        url: "https://arxiv.org/abs/name-1",
        relevance_score: 9,
      })
    );

    const result = await generateIssues(db, { issuesDir });

    expect(result.issues[0].filename).toBe(
      "learn-context-engineering-for-llms.md"
    );
    expect(
      fs.existsSync(path.join(issuesDir, "learn-context-engineering-for-llms.md"))
    ).toBe(true);

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
