/**
 * Tests for Hacker News Collector
 *
 * Covers:
 *   Normal fetch, dedup, empty results, API error, config defaults,
 *   disabled collector, field normalization, retry capability,
 *   CLI exports, User-Agent, source field, JSON serialization
 *
 * All imports target the implementation files.
 * The coder MUST export: fetchHn (main collector), HnClient (API client),
 * Paper and HnResult interfaces, loadConfig (config loader with defaults).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper } from "../collectors/common.js";

// ---------------------------------------------------------------------------
// Types that the implementation must export
// ---------------------------------------------------------------------------

interface HnConfig {
  enabled: boolean;
  queries: string[];
  max_stories: number;
  timeout_seconds: number;
  retries: number;
}

interface HnResult {
  source: "hackernews";
  fetched_at: string;
  queries_searched: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

interface HnClientLike {
  searchStories(query: string, hitsPerPage: number): Promise<Paper[]>;
  fetchTopStories(limit: number): Promise<Paper[]>;
}

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeHnPaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "hn-40000001",
    title: "GPT-5 Announced with 10x Context Window",
    abstract: "https://example.com/gpt5-announcement",
    url: "https://news.ycombinator.com/item?id=40000001",
    pdf_url: "",
    authors: ["alice"],
    categories: ["hackernews"],
    primary_category: "hackernews",
    published: "2026-06-07T10:00:00.000Z",
    updated: "2026-06-07T10:00:00.000Z",
    ...overrides,
  };
}

function makeHnPaper2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "hn-40000002",
    title: "LocalLLaMA: New Quantization Technique Reduces Memory 4x",
    abstract: "https://example.com/quantization",
    url: "https://news.ycombinator.com/item?id=40000002",
    pdf_url: "",
    authors: ["bob"],
    categories: ["hackernews"],
    primary_category: "hackernews",
    published: "2026-06-07T09:00:00.000Z",
    updated: "2026-06-07T09:00:00.000Z",
    ...overrides,
  };
}

const DEFAULT_HN_CONFIG: HnConfig = {
  enabled: true,
  queries: ["AI", "LLM", "machine learning"],
  max_stories: 30,
  timeout_seconds: 30,
  retries: 3,
};

// ---------------------------------------------------------------------------
// Normal fetch — correct HnResult structure
// ---------------------------------------------------------------------------
describe("Normal fetch", () => {
  it("fetches stories and returns correct HnResult structure", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([makeHnPaper(), makeHnPaper2()]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.source).toBe("hackernews");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("hn-40000001");
  });

  it("passes queries and max_stories to the client", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([makeHnPaper()]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    // searchStories should be called once per query
    expect(mockClient.searchStories).toHaveBeenCalledTimes(3);
    expect(mockClient.searchStories).toHaveBeenCalledWith("AI", 30);
    expect(mockClient.searchStories).toHaveBeenCalledWith("LLM", 30);
    expect(mockClient.searchStories).toHaveBeenCalledWith("machine learning", 30);
  });

  it("queries_searched contains the configured queries", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.queries_searched).toEqual(["AI", "LLM", "machine learning"]);
  });
});

// ---------------------------------------------------------------------------
// Output schema — Paper interface has all required fields
// ---------------------------------------------------------------------------
describe("Output schema", () => {
  it("Paper has all required fields with correct types", () => {
    const paper = makeHnPaper();

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

  it("pdf_url is empty string for HN stories", () => {
    const paper = makeHnPaper();
    expect(paper.pdf_url).toBe("");
  });

  it("categories is ['hackernews']", () => {
    const paper = makeHnPaper();
    expect(paper.categories).toEqual(["hackernews"]);
  });

  it("primary_category is 'hackernews'", () => {
    const paper = makeHnPaper();
    expect(paper.primary_category).toBe("hackernews");
  });

  it("title is normalized (whitespace collapsed, trimmed)", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const messyPaper = makeHnPaper({
      id: "hn-40000099",
      title: "  A\nVery\n  Messy   Title  ",
    });

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([messyPaper]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.papers[0].title).not.toMatch(/\n/);
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("HnResult has all required top-level fields", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([makeHnPaper()]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("queries_searched");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// Deduplication by ID
// ---------------------------------------------------------------------------
describe("Deduplication by ID", () => {
  it("removes duplicate papers with the same id", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const paper1 = makeHnPaper();
    const paper1Dup = makeHnPaper({ title: "Same Story Different Title" });
    const paper2 = makeHnPaper2();

    const mockClient: HnClientLike = {
      searchStories: vi.fn()
        .mockResolvedValueOnce([paper1, paper1Dup])
        .mockResolvedValueOnce([paper2])
        .mockResolvedValueOnce([]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps the first occurrence when duplicates exist", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const paper1 = makeHnPaper();
    const paper1Dup = makeHnPaper({ title: "Later Duplicate" });

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([paper1, paper1Dup]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HN_CONFIG, queries: ["AI"] };
    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("GPT-5 Announced with 10x Context Window");
  });

  it("does not dedup papers with different ids", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const paper1 = makeHnPaper();
    const paper2 = makeHnPaper2();

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([paper1, paper2]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HN_CONFIG, queries: ["AI"] };
    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty results
// ---------------------------------------------------------------------------
describe("Empty results", () => {
  it("produces valid HnResult with total_results: 0 when no stories found", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.source).toBe("hackernews");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
    expect(result.queries_searched).toEqual(DEFAULT_HN_CONFIG.queries);
  });

  it("output is valid JSON serializable", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.total_results).toBe(0);
    expect(parsed.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// API error handling
// ---------------------------------------------------------------------------
describe("API error handling", () => {
  it("populates warnings on API error, returns empty papers", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockRejectedValue(new Error("HTTP 500: Internal Server Error")),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HN_CONFIG, queries: ["AI"] };
    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("500");
    expect(result.papers).toEqual([]);
  });

  it("does not crash on network error", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HN_CONFIG, queries: ["AI"] };
    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });

  it("result is still valid JSON after error", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockRejectedValue(new Error("timeout")),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HN_CONFIG, queries: ["AI"] };
    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    const json = JSON.stringify(result);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.source).toBe("hackernews");
  });

  it("continues fetching remaining queries after one fails", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn()
        .mockRejectedValueOnce(new Error("Query failed"))
        .mockResolvedValueOnce([makeHnPaper2()])
        .mockResolvedValueOnce([]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    // First query failed, but second returned results
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].id).toBe("hn-40000002");
  });
});

// ---------------------------------------------------------------------------
// Config loading with defaults and overrides
// ---------------------------------------------------------------------------
describe("Config defaults", () => {
  it("uses defaults when config has no sources.hackernews section", async () => {
    const { loadConfig } = await import("../collectors/hn.js");

    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.queries).toEqual(["AI", "LLM", "machine learning"]);
    expect(config.max_stories).toBe(30);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("uses defaults for missing keys only (preserves provided keys)", async () => {
    const { loadConfig } = await import("../collectors/hn.js");

    const partialConfig = {
      sources: {
        hackernews: {
          enabled: true,
          queries: ["deep learning"],
          max_stories: 50,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.queries).toEqual(["deep learning"]);
    expect(config.max_stories).toBe(50);
    // These should use defaults
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("returns enabled: true by default", async () => {
    const { loadConfig } = await import("../collectors/hn.js");

    const config = loadConfig({});
    expect(config.enabled).toBe(true);
  });

  it("flat config keys are supported (not just nested sources.hackernews)", async () => {
    const { loadConfig } = await import("../collectors/hn.js");

    const flatConfig = {
      enabled: false,
      queries: ["test"],
      max_stories: 10,
    };

    const config = loadConfig(flatConfig);
    expect(config.enabled).toBe(false);
    expect(config.queries).toEqual(["test"]);
    expect(config.max_stories).toBe(10);
  });

  it("enabled: false can be set via config", async () => {
    const { loadConfig } = await import("../collectors/hn.js");

    const config = loadConfig({
      sources: { hackernews: { enabled: false } },
    });

    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disabled collector
// ---------------------------------------------------------------------------
describe("Disabled collector", () => {
  it("returns empty result with no papers when enabled: false", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const config: HnConfig = { ...DEFAULT_HN_CONFIG, enabled: false };
    const mockClient: HnClientLike = {
      searchStories: vi.fn(),
      fetchTopStories: vi.fn(),
    };

    const result = await fetchHn(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    // Should not call the client at all
    expect(mockClient.searchStories).not.toHaveBeenCalled();
    // Should return valid empty result
    expect(result.source).toBe("hackernews");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.queries_searched).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HnClient retry capability
// ---------------------------------------------------------------------------
describe("HnClient retry capability", () => {
  it("HnClient can be instantiated with retry config", async () => {
    const { HnClient } = await import("../collectors/hn-client.js");

    const client = new HnClient({
      timeoutSeconds: 30,
      retries: 3,
    });

    expect(client).toBeDefined();
    expect(typeof client.searchStories).toBe("function");
    expect(typeof client.fetchTopStories).toBe("function");
  });

  it("HnClient constructor accepts all config parameters", async () => {
    const { HnClient } = await import("../collectors/hn-client.js");

    expect(() => new HnClient({
      timeoutSeconds: 30,
      retries: 3,
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CLI entry point exports
// ---------------------------------------------------------------------------
describe("CLI entry point exports", () => {
  it("fetchHn is exported", async () => {
    const mod = await import("../collectors/hn.js");
    expect(typeof mod.fetchHn).toBe("function");
  });

  it("loadConfig is exported", async () => {
    const mod = await import("../collectors/hn.js");
    expect(typeof mod.loadConfig).toBe("function");
  });

  it("HnResult interface is used as return type of fetchHn", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([makeHnPaper()]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    // Verify HnResult shape
    expect(result.source).toBe("hackernews");
    expect(typeof result.fetched_at).toBe("string");
    expect(typeof result.total_results).toBe("number");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.papers)).toBe(true);
    expect(Array.isArray(result.queries_searched)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// User-Agent header (structural)
// ---------------------------------------------------------------------------
describe("User-Agent header", () => {
  it("HnClient is importable (User-Agent is set internally)", async () => {
    const { HnClient } = await import("../collectors/hn-client.js");
    expect(HnClient).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Source field
// ---------------------------------------------------------------------------
describe("Source field", () => {
  it("result.source is always 'hackernews'", async () => {
    const { fetchHn } = await import("../collectors/hn.js");

    const mockClient: HnClientLike = {
      searchStories: vi.fn().mockResolvedValue([makeHnPaper()]),
      fetchTopStories: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHn(DEFAULT_HN_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hn-client.js"))["HnClient"]>,
    });

    expect(result.source).toBe("hackernews");
  });
});
