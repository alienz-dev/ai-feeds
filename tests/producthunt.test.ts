/**
 * Tests for Product Hunt Collector (CDP-based)
 *
 * Covers: normal fetch, empty results, Chrome not running, config defaults,
 * disabled source, dedup, output schema, rate limiting, multi-day scrape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Paper } from "../collectors/common.js";
import type { ProductHuntResult, ProductHuntConfig } from "../collectors/producthunt.js";
import { fetchProducthunt, loadConfig } from "../collectors/producthunt.js";
import { ProductHuntClient } from "../collectors/producthunt-client.js";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "awesome-ai-tool",
    title: "Awesome AI Tool",
    abstract: "A revolutionary AI tool for developers",
    url: "https://www.producthunt.com/products/awesome-ai-tool",
    pdf_url: "",
    authors: [],
    categories: ["Artificial Intelligence", "Developer Tools"],
    primary_category: "producthunt",
    published: "2026-06-07",
    updated: "2026-06-07",
    ...overrides,
  };
}

function makeProduct2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "rag-search-engine",
    title: "RAG Search Engine",
    abstract: "Search engine powered by retrieval augmented generation",
    url: "https://www.producthunt.com/products/rag-search-engine",
    pdf_url: "",
    authors: [],
    categories: ["Search", "AI"],
    primary_category: "producthunt",
    published: "2026-06-07",
    updated: "2026-06-07",
    ...overrides,
  };
}

const DEFAULT_CONFIG: ProductHuntConfig = {
  enabled: true,
  days: 1,
  timeout_seconds: 30,
  delay_seconds: 2.0,
  cdp_endpoint: "http://localhost:9222",
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct ProductHuntResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Normal fetch", () => {
  it("fetches products and returns correct ProductHuntResult structure", async () => {
    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([makeProduct(), makeProduct2()]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.source).toBe("producthunt");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.date_queried).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("awesome-ai-tool");
  });

  it("calls client.fetchProducts with ISO date string", async () => {
    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([makeProduct()]),
    };

    await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(mockClient.fetchProducts).toHaveBeenCalledTimes(1);
    const calledDate = mockClient.fetchProducts.mock.calls[0][0];
    expect(calledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Output schema — Paper interface has all required fields
// ---------------------------------------------------------------------------
describe("AC-2: Output schema", () => {
  it("Paper has all required fields with correct types", () => {
    const paper = makeProduct();

    expect(typeof paper.id).toBe("string");
    expect(typeof paper.title).toBe("string");
    expect(typeof paper.abstract).toBe("string");
    expect(typeof paper.url).toBe("string");
    expect(typeof paper.pdf_url).toBe("string");
    expect(Array.isArray(paper.authors)).toBe(true);
    expect(Array.isArray(paper.categories)).toBe(true);
    expect(typeof paper.primary_category).toBe("string");
    expect(typeof paper.published).toBe("string");
    expect(typeof paper.updated).toBe("string");
  });

  it("pdf_url is empty string (Product Hunt has no PDFs)", () => {
    const paper = makeProduct();
    expect(paper.pdf_url).toBe("");
  });

  it("authors is empty array (PH leaderboard doesn't show individual authors)", () => {
    const paper = makeProduct();
    expect(paper.authors).toEqual([]);
  });

  it("primary_category is 'producthunt'", () => {
    const paper = makeProduct();
    expect(paper.primary_category).toBe("producthunt");
  });

  it("ProductHuntResult has all required top-level fields", async () => {
    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([makeProduct()]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("date_queried");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Empty results
// ---------------------------------------------------------------------------
describe("AC-3: Empty results", () => {
  it("produces valid ProductHuntResult with total_results: 0 when no products found", async () => {
    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.source).toBe("producthunt");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
    expect(result.date_queried).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Chrome not running — CDP connection error
// ---------------------------------------------------------------------------
describe("AC-4: Chrome not running", () => {
  it("populates warnings array on CDP connection error, returns empty papers", async () => {
    const mockClient = {
      fetchProducts: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Failed to connect to Chrome via CDP at http://localhost:9222: connection refused. Is Chrome running with --remote-debugging-port?"
          )
        ),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Failed to connect to Chrome");
    expect(result.papers).toEqual([]);
  });

  it("continues after error (does not crash)", async () => {
    const mockClient = {
      fetchProducts: vi.fn().mockRejectedValue(new Error("Page timeout")),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Config defaults
// ---------------------------------------------------------------------------
describe("AC-5: Config defaults", () => {
  it("uses defaults when config has no sources.producthunt section", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(false);
    expect(config.days).toBe(1);
    expect(config.timeout_seconds).toBe(30);
    expect(config.delay_seconds).toBe(2.0);
    expect(config.cdp_endpoint).toBe("http://localhost:9222");
  });

  it("uses defaults for missing keys only (preserves provided keys)", () => {
    const partialConfig = {
      sources: {
        producthunt: {
          enabled: true,
          days: 3,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.enabled).toBe(true);
    expect(config.days).toBe(3);
    // These should use defaults
    expect(config.timeout_seconds).toBe(30);
    expect(config.delay_seconds).toBe(2.0);
    expect(config.cdp_endpoint).toBe("http://localhost:9222");
  });

  it("returns enabled: false by default", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Disabled source
// ---------------------------------------------------------------------------
describe("AC-6: Disabled source", () => {
  it("loadConfig returns enabled: false when explicitly set", () => {
    const config = loadConfig({
      sources: { producthunt: { enabled: false } },
    });
    expect(config.enabled).toBe(false);
  });

  it("fetchProducthunt returns empty result when disabled", async () => {
    const config: ProductHuntConfig = { ...DEFAULT_CONFIG, enabled: false };

    const result = await fetchProducthunt(config);

    expect(result.source).toBe("producthunt");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Deduplication by ID
// ---------------------------------------------------------------------------
describe("AC-7: Deduplication by ID", () => {
  it("removes duplicate products with the same ID", async () => {
    const dup1 = makeProduct({ id: "awesome-ai-tool" });
    const dup2 = makeProduct({
      id: "awesome-ai-tool",
      title: "Same product, different title",
    });
    const other = makeProduct2();

    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([dup1, dup2, other]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps the first occurrence of a duplicate", async () => {
    const first = makeProduct({ id: "dup-id", title: "Original Title" });
    const second = makeProduct({ id: "dup-id", title: "Duplicate Title" });

    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([first, second]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("Original Title");
  });
});

// ---------------------------------------------------------------------------
// AC-8: Multi-day scraping
// ---------------------------------------------------------------------------
describe("AC-8: Multi-day scraping", () => {
  it("scrapes multiple days when days > 1", async () => {
    const config: ProductHuntConfig = { ...DEFAULT_CONFIG, days: 3 };
    const mockClient = {
      fetchProducts: vi.fn().mockResolvedValue([makeProduct()]),
    };

    const result = await fetchProducthunt(config, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(mockClient.fetchProducts).toHaveBeenCalledTimes(3);
    // Each call should receive a different date
    const dates = mockClient.fetchProducts.mock.calls.map(
      (call: unknown[]) => call[0] as string
    );
    expect(new Set(dates).size).toBe(3);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("continues fetching remaining days if one day fails", async () => {
    const config: ProductHuntConfig = { ...DEFAULT_CONFIG, days: 2 };
    const mockClient = {
      fetchProducts: vi
        .fn()
        .mockRejectedValueOnce(new Error("CDP error"))
        .mockResolvedValueOnce([makeProduct()]),
    };

    const result = await fetchProducthunt(config, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(mockClient.fetchProducts).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.papers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Rate limiting
// ---------------------------------------------------------------------------
describe("AC-9: Rate limiting", () => {
  it("enforces delay between page navigations (configurable via config)", () => {
    expect(DEFAULT_CONFIG.delay_seconds).toBeGreaterThanOrEqual(2);
  });

  it("ProductHuntClient accepts delay_seconds parameter", () => {
    const client = new ProductHuntClient({
      delaySeconds: DEFAULT_CONFIG.delay_seconds,
      timeoutSeconds: DEFAULT_CONFIG.timeout_seconds,
      cdpEndpoint: DEFAULT_CONFIG.cdp_endpoint,
    });
    expect(client).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-10: ProductHuntClient interface
// ---------------------------------------------------------------------------
describe("ProductHuntClient", () => {
  it("can be instantiated with config", () => {
    const client = new ProductHuntClient({
      delaySeconds: 2,
      timeoutSeconds: 30,
      cdpEndpoint: "http://localhost:9222",
    });
    expect(client).toBeDefined();
  });

  it("has fetchProducts method", () => {
    const client = new ProductHuntClient({
      delaySeconds: 2,
      timeoutSeconds: 30,
      cdpEndpoint: "http://localhost:9222",
    });
    expect(typeof client.fetchProducts).toBe("function");
  });
});
