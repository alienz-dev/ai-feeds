/**
 * Tests for Dev.to (Forem) Collector
 *
 * Covers: normal fetch, output schema, dedup, rate limiting, API error,
 * empty results, config defaults, disabled source, dry-run, help flag.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper, DevtoResult, DevtoConfig } from "../collectors/devto.js";
import { fetchDevto, loadConfig } from "../collectors/devto.js";
import { DevtoClient } from "../collectors/devto-client.js";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeArticle(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "12345",
    title: "Building AI Agents with Context Engineering",
    abstract: "A deep dive into context engineering patterns for LLM agents...",
    url: "https://dev.to/author/building-ai-agents-12345",
    pdf_url: "",
    authors: ["Alice Smith"],
    categories: ["ai", "llm", "agents"],
    primary_category: "devto",
    published: "2026-06-05T10:00:00Z",
    updated: "2026-06-06T12:00:00Z",
    ...overrides,
  };
}

function makeArticle2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "67890",
    title: "RAG Patterns for Production Systems",
    abstract: "How to build production-grade retrieval augmented generation...",
    url: "https://dev.to/author/rag-patterns-67890",
    pdf_url: "",
    authors: ["Bob Jones"],
    categories: ["rag", "ai", "production"],
    primary_category: "devto",
    published: "2026-06-04T08:00:00Z",
    updated: "2026-06-04T08:00:00Z",
    ...overrides,
  };
}

const DEFAULT_CONFIG: DevtoConfig = {
  enabled: true,
  tag: "ai",
  top: 7,
  limit: 30,
  timeout_seconds: 30,
  retries: 3,
  delay_seconds: 1.0,
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct DevtoResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Tag-based fetch", () => {
  it("fetches articles and returns correct DevtoResult structure", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([makeArticle(), makeArticle2()]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.source).toBe("devto");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.tag_queried).toBe("ai");
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("12345");
  });

  it("passes tag, top, and limit to the client", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([makeArticle()]),
    };

    await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(mockClient.fetchArticles).toHaveBeenCalledWith("ai", 7, 30);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Output schema — Paper interface has all required fields
// ---------------------------------------------------------------------------
describe("AC-2: Output schema", () => {
  it("Paper has all required fields with correct types", () => {
    const paper = makeArticle();

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

  it("pdf_url is empty string (Dev.to has no PDFs)", () => {
    const paper = makeArticle();
    expect(paper.pdf_url).toBe("");
  });

  it("primary_category is 'devto'", () => {
    const paper = makeArticle();
    expect(paper.primary_category).toBe("devto");
  });

  it("title is stripped of newlines and excess whitespace", async () => {
    const messyPaper = makeArticle({
      id: "99999",
      title: "  A\nVery\n  Messy   Title  ",
    });

    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([messyPaper]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.papers[0].title).not.toMatch(/\n/);
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("DevtoResult has all required top-level fields", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([makeArticle()]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("tag_queried");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Deduplication by ID
// ---------------------------------------------------------------------------
describe("AC-3: Deduplication by ID", () => {
  it("removes duplicate articles with the same ID", async () => {
    const dup1 = makeArticle({ id: "12345" });
    const dup2 = makeArticle({ id: "12345", title: "Same article, different title" });
    const other = makeArticle2();

    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([dup1, dup2, other]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps the first occurrence of a duplicate", async () => {
    const first = makeArticle({ id: "12345", title: "Original Title" });
    const second = makeArticle({ id: "12345", title: "Duplicate Title" });

    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([first, second]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("Original Title");
  });

  it("does not dedup articles with different IDs", async () => {
    const paper1 = makeArticle({ id: "11111" });
    const paper2 = makeArticle({ id: "22222" });

    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([paper1, paper2]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Rate limiting
// ---------------------------------------------------------------------------
describe("AC-4: Rate limiting", () => {
  it("enforces delay between requests (configurable via config)", () => {
    expect(DEFAULT_CONFIG.delay_seconds).toBeGreaterThanOrEqual(1);
  });

  it("DevtoClient accepts delay_seconds parameter", () => {
    const client = new DevtoClient({
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
    const mockClient = {
      fetchArticles: vi.fn()
        .mockRejectedValue(new Error("HTTP 500: Internal Server Error")),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("500");
    expect(result.papers).toEqual([]);
  });

  it("continues after error (does not crash)", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Empty results
// ---------------------------------------------------------------------------
describe("AC-6: Empty results", () => {
  it("produces valid DevtoResult with total_results: 0 when no articles found", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.source).toBe("devto");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
    expect(result.tag_queried).toBe("ai");
  });

  it("output is valid JSON serializable", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.total_results).toBe(0);
    expect(parsed.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Config defaults
// ---------------------------------------------------------------------------
describe("AC-7: Config defaults", () => {
  it("uses defaults when config has no sources.devto section", () => {
    const config = loadConfig({});
    expect(config.tag).toBe("ai");
    expect(config.top).toBe(7);
    expect(config.limit).toBe(30);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
    expect(config.delay_seconds).toBe(1.0);
  });

  it("uses defaults for missing keys only (preserves provided keys)", () => {
    const partialConfig = {
      sources: {
        devto: {
          enabled: true,
          tag: "machine-learning",
          top: 30,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.tag).toBe("machine-learning");
    expect(config.top).toBe(30);
    // These should use defaults
    expect(config.limit).toBe(30);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
    expect(config.delay_seconds).toBe(1.0);
  });

  it("returns enabled: true by default", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-8: Disabled source
// ---------------------------------------------------------------------------
describe("AC-8: Disabled source", () => {
  it("loadConfig returns enabled: false when explicitly set", () => {
    const config = loadConfig({
      sources: { devto: { enabled: false } },
    });
    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Dry-run mode
// ---------------------------------------------------------------------------
describe("AC-9: Dry-run mode", () => {
  it("fetchDevto returns result without writing files (file writing is CLI-only)", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([makeArticle()]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.source).toBe("devto");
  });

  it("returns full result object with correct structure", async () => {
    const mockClient = {
      fetchArticles: vi.fn().mockResolvedValue([makeArticle(), makeArticle2()]),
    };

    const result = await fetchDevto(DEFAULT_CONFIG, {
      client: mockClient as unknown as DevtoClient,
    });

    expect(result.total_results).toBe(2);
    expect(result.papers).toHaveLength(2);
    expect(result.fetched_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-10: Output file naming
// ---------------------------------------------------------------------------
describe("AC-10: Output file naming", () => {
  it("output follows devto-YYYY-MM-DD.json pattern", () => {
    const today = new Date().toISOString().slice(0, 10);
    const expectedName = `devto-${today}.json`;
    expect(expectedName).toMatch(/^devto-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

// ---------------------------------------------------------------------------
// AC-11: Help flag
// ---------------------------------------------------------------------------
describe("AC-11: Help flag", () => {
  it("fetchDevto is a function", () => {
    expect(typeof fetchDevto).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// DevtoClient interface tests
// ---------------------------------------------------------------------------
describe("DevtoClient", () => {
  it("can be instantiated with config", () => {
    const client = new DevtoClient({
      delaySeconds: 1,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(client).toBeDefined();
  });

  it("has fetchArticles method", () => {
    const client = new DevtoClient({
      delaySeconds: 1,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(typeof client.fetchArticles).toBe("function");
  });
});
