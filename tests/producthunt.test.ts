/**
 * Tests for Product Hunt Collector (RSS-based)
 *
 * Covers: normal fetch, empty results, config defaults, disabled source, dedup.
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
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct ProductHuntResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Normal fetch", () => {
  it("fetches products and returns correct ProductHuntResult structure", async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue([makeProduct(), makeProduct2()]),
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

  it("calls client.fetch once", async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue([makeProduct()]),
    };

    await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(mockClient.fetch).toHaveBeenCalledTimes(1);
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
});

// ---------------------------------------------------------------------------
// AC-3: Empty results
// ---------------------------------------------------------------------------
describe("AC-3: Empty results", () => {
  it("produces valid ProductHuntResult with total_results: 0 when no products found", async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Fetch error handling
// ---------------------------------------------------------------------------
describe("AC-4: Fetch error handling", () => {
  it("populates warnings array on fetch error, returns empty papers", async () => {
    const mockClient = {
      fetch: vi.fn().mockRejectedValue(new Error("Network error")),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("Network error");
  });
});

// ---------------------------------------------------------------------------
// AC-5: Config defaults
// ---------------------------------------------------------------------------
describe("AC-5: Config defaults", () => {
  it("uses defaults when config has no sources.producthunt section", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(false);
  });

  it("reads enabled from sources.producthunt", () => {
    const config = loadConfig({ sources: { producthunt: { enabled: true } } });
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Disabled source
// ---------------------------------------------------------------------------
describe("AC-6: Disabled source", () => {
  it("returns empty result when disabled", async () => {
    const config: ProductHuntConfig = { enabled: false };
    const result = await fetchProducthunt(config);

    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Dedup
// ---------------------------------------------------------------------------
describe("AC-7: Dedup", () => {
  it("deduplicates products by ID", async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue([
        makeProduct(),
        makeProduct(), // duplicate
        makeProduct2(),
      ]),
    };

    const result = await fetchProducthunt(DEFAULT_CONFIG, {
      client: mockClient as unknown as ProductHuntClient,
    });

    expect(result.total_results).toBe(2);
    expect(result.papers).toHaveLength(2);
  });
});
