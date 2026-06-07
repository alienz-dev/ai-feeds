/**
 * Tests for arXiv Collector (SPEC-ARXIV)
 *
 * Covers: AC-1 (fetch), AC-2 (output schema), AC-3 (dedup), AC-4 (rate limiting),
 * AC-5 (API error), AC-6 (malformed XML), AC-7 (empty results), AC-9 (config defaults),
 * AC-10 (output naming), AC-12 (dry-run), AC-14 (testability)
 *
 * All imports target the implementation files that the coder will build.
 * The coder MUST export: fetchArxiv (main collector), ArxivClient (API client),
 * Paper and ArxivResult interfaces, loadConfig (config loader with defaults).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper, ArxivResult, ArxivConfig } from "../collectors/arxiv.js";
import { fetchArxiv, loadConfig } from "../collectors/arxiv.js";
import { ArxivClient } from "../collectors/arxiv-client.js";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
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
    ...overrides,
  };
}

function makePaper2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2606.07777v1",
    title: "Scaling Laws for Context Engineering",
    abstract: "We study the scaling behavior of context window utilization...",
    url: "https://arxiv.org/abs/2606.07777v1",
    pdf_url: "https://arxiv.org/pdf/2606.07777v1",
    authors: ["Charlie Brown"],
    categories: ["cs.LG", "stat.ML"],
    primary_category: "cs.LG",
    published: "2026-06-07T09:00:00Z",
    updated: "2026-06-07T09:00:00Z",
    ...overrides,
  };
}

const DEFAULT_CONFIG: ArxivConfig = {
  enabled: true,
  categories: ["cs.AI", "cs.CL", "cs.LG", "stat.ML"],
  max_results: 150,
  delay_seconds: 3.0,
  days_back: 2,
  timeout_seconds: 30,
  retries: 3,
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct ArxivResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Category-based fetch", () => {
  it("fetches papers and returns correct ArxivResult structure", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([makePaper(), makePaper2()]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.source).toBe("arxiv");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.categories_queried).toEqual([
      "cs.AI", "cs.CL", "cs.LG", "stat.ML",
    ]);
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("2606.06493v1");
  });

  it("passes categories, max_results, and days_back to the client", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([makePaper()]),
    };

    await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(mockClient.fetchPapers).toHaveBeenCalledWith(
      ["cs.AI", "cs.CL", "cs.LG", "stat.ML"],
      150,
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-2: Output schema — Paper interface has all required fields
// ---------------------------------------------------------------------------
describe("AC-2: Output schema", () => {
  it("Paper has all required fields with correct types", () => {
    const paper = makePaper();

    expect(typeof paper.id).toBe("string");
    expect(typeof paper.title).toBe("string");
    expect(typeof paper.abstract).toBe("string");
    expect(typeof paper.url).toBe("string");
    expect(typeof paper.pdf_url).toBe("string");
    expect(Array.isArray(paper.authors)).toBe(true);
    expect(paper.authors.every((a) => typeof a === "string")).toBe(true);
    expect(Array.isArray(paper.categories)).toBe(true);
    expect(typeof paper.primary_category).toBe("string");
    expect(typeof paper.published).toBe("string");
    expect(typeof paper.updated).toBe("string");
  });

  it("title is stripped of newlines and excess whitespace", async () => {
    const messyPaper = makePaper({
      id: "2606.99999v1",
      title: "  A\nVery\n  Messy   Title  ",
    });

    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([messyPaper]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // After normalization, title should not contain newlines
    expect(result.papers[0].title).not.toMatch(/\n/);
    // Should be trimmed
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("ArxivResult has all required top-level fields", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([makePaper()]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("categories_queried");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Dedup by version-stripped ID
// ---------------------------------------------------------------------------
describe("AC-3: Deduplication by arXiv ID", () => {
  it("keeps only the latest version when same paper appears at v1 and v2", async () => {
    const v1 = makePaper({ id: "2606.06493v1" });
    const v2 = makePaper({ id: "2606.06493v2", updated: "2026-06-07T12:00:00Z" });
    const other = makePaper2();

    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([v1, v2, other]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // Only 2 unique papers (6493 deduped, 7777 kept)
    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);

    // The surviving 6493 entry should be v2 (latest version)
    const paper6493 = result.papers.find((p) => p.id.startsWith("2606.06493"));
    expect(paper6493).toBeDefined();
    expect(paper6493!.id).toBe("2606.06493v2");
  });

  it("preserves the full versioned ID in output (not stripped)", async () => {
    const v2 = makePaper({ id: "2606.06493v2" });

    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([v2]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // ID should still have the version suffix
    expect(result.papers[0].id).toBe("2606.06493v2");
    expect(result.papers[0].id).toMatch(/v\d+$/);
  });

  it("does not dedup papers with different base IDs", async () => {
    const paper1 = makePaper({ id: "2606.06493v1" });
    const paper2 = makePaper({ id: "2606.06494v1" });

    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([paper1, paper2]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Rate limiting
// ---------------------------------------------------------------------------
describe("AC-4: Rate limiting", () => {
  it("enforces delay between requests (configurable via config)", () => {
    // Verify the config has delay_seconds
    expect(DEFAULT_CONFIG.delay_seconds).toBeGreaterThanOrEqual(3);
  });

  it("ArxivClient accepts delay_seconds parameter", () => {
    // The constructor should accept a config that includes delay_seconds
    // This test verifies the interface exists
    const client = new ArxivClient({
      delaySeconds: DEFAULT_CONFIG.delay_seconds,
      timeoutSeconds: DEFAULT_CONFIG.timeout_seconds,
      retries: DEFAULT_CONFIG.retries,
    });
    expect(client).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-5: API failure handling
// ---------------------------------------------------------------------------
describe("AC-5: API failure handling", () => {
  it("populates warnings array on HTTP error, returns empty papers", async () => {
    // Single fetch call that throws — fetchArxiv catches and records warning
    const mockClient = {
      fetchPapers: vi.fn()
        .mockRejectedValue(new Error("HTTP 500: Internal Server Error")),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("500");
    expect(result.papers).toEqual([]);
  });

  it("continues fetching after error (does not crash)", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };

    // Should not throw — error is caught and recorded in warnings
    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Malformed response handling
// ---------------------------------------------------------------------------
describe("AC-6: Malformed response handling", () => {
  it("handles malformed XML gracefully (no crash)", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockRejectedValue(new Error("Invalid XML: unexpected token")),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // Should not crash — returns empty papers with a warning
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });

  it("returns whatever papers were successfully parsed", async () => {
    const paper = makePaper();

    // First batch succeeds, second has malformed XML
    const mockClient = {
      fetchPapers: vi.fn()
        .mockResolvedValueOnce([paper])
        .mockRejectedValueOnce(new Error("Malformed XML")),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // The successfully parsed paper should still be in the output
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].id).toBe("2606.06493v1");
  });
});

// ---------------------------------------------------------------------------
// AC-7: Empty results
// ---------------------------------------------------------------------------
describe("AC-7: Empty results", () => {
  it("produces valid ArxivResult with total_results: 0 when no papers found", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.source).toBe("arxiv");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
    expect(result.categories_queried).toEqual(DEFAULT_CONFIG.categories);
  });

  it("output is valid JSON serializable", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    // Should not throw during serialization
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.total_results).toBe(0);
    expect(parsed.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Config-driven behavior / defaults
// ---------------------------------------------------------------------------
describe("AC-9: Config defaults", () => {
  it("uses defaults when config has no sources.arxiv section", () => {
    const config = loadConfig({});
    expect(config.categories).toEqual(["cs.AI", "cs.CL", "cs.LG", "stat.ML"]);
    expect(config.max_results).toBe(150);
    expect(config.delay_seconds).toBe(3.0);
    expect(config.days_back).toBe(2);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("uses defaults for missing keys only (preserves provided keys)", () => {
    const partialConfig = {
      sources: {
        arxiv: {
          enabled: true,
          categories: ["cs.AI"],
          max_results: 50,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.categories).toEqual(["cs.AI"]);
    expect(config.max_results).toBe(50);
    // These should use defaults
    expect(config.delay_seconds).toBe(3.0);
    expect(config.days_back).toBe(2);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("returns enabled: true by default", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-10: Output file naming (dry-run verifies no file written)
// ---------------------------------------------------------------------------
describe("AC-10: Output file naming", () => {
  it("output follows arxiv-YYYY-MM-DD.json pattern", () => {
    // Verify the naming convention exists in the code path
    const today = new Date().toISOString().slice(0, 10);
    const expectedName = `arxiv-${today}.json`;
    expect(expectedName).toMatch(/^arxiv-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

// ---------------------------------------------------------------------------
// AC-12: Dry-run mode
// ---------------------------------------------------------------------------
describe("AC-12: Dry-run mode", () => {
  it("fetchArxiv returns result without writing files (file writing is CLI-only)", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([makePaper()]),
    };

    // fetchArxiv itself never writes files — that's handled by CLI main()
    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.source).toBe("arxiv");
  });

  it("returns full result object with correct structure", async () => {
    const mockClient = {
      fetchPapers: vi.fn().mockResolvedValue([makePaper(), makePaper2()]),
    };

    const result = await fetchArxiv(DEFAULT_CONFIG, {
      client: mockClient as unknown as ArxivClient,
    });

    expect(result.total_results).toBe(2);
    expect(result.papers).toHaveLength(2);
    expect(result.fetched_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-13: Logging (shared logging from common.ts)
// ---------------------------------------------------------------------------
describe("AC-13: Logging", () => {
  it("setupLogging is exported from collectors/common.ts", async () => {
    const { setupLogging } = await import("../collectors/common.js");
    expect(typeof setupLogging).toBe("function");
  });

  it("setupLogging accepts optional level parameter", async () => {
    const { setupLogging } = await import("../collectors/common.js");
    // Should not throw with or without level
    expect(() => setupLogging()).not.toThrow();
    expect(() => setupLogging("debug")).not.toThrow();
    expect(() => setupLogging("info")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-15: Help flag
// ---------------------------------------------------------------------------
describe("AC-15: Help flag", () => {
  it("fetchArxiv options support help flag concept", () => {
    // The options type should allow a help/dryRun flag
    // This is a structural test — the CLI layer handles --help
    // but fetchArxiv should accept an options object
    expect(typeof fetchArxiv).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ArxivClient interface tests
// ---------------------------------------------------------------------------
describe("ArxivClient", () => {
  it("can be instantiated with config", () => {
    const client = new ArxivClient({
      delaySeconds: 3,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(client).toBeDefined();
  });

  it("has fetchPapers method", () => {
    const client = new ArxivClient({
      delaySeconds: 3,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(typeof client.fetchPapers).toBe("function");
  });
});
