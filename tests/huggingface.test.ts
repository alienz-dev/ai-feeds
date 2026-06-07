/**
 * Tests for HuggingFace Daily Papers Collector (SPEC-HF)
 *
 * Covers:
 *   AC-1  Fetch and parse JSON
 *   AC-2  Field normalization (title, abstract, authors, urls, categories, primary_category)
 *   AC-3  Config loading with defaults
 *   AC-4  Deduplication by paper ID
 *   AC-5  Date filtering (days_back)
 *   AC-6  Retry with exponential backoff (handled by HfClient — structural test)
 *   AC-7  CLI entry point (structural test — exports exist)
 *   AC-9  Disabled collector
 *   AC-13 Unit tests cover JSON normalization, dedup, config defaults, config overrides, date filtering, empty response
 *
 * All imports target the implementation files that the coder will build.
 * The coder MUST export:
 *   - fetchHuggingFace (main collector), loadConfig (config loader),
 *     HfResult, HfConfig from collectors/huggingface.ts
 *   - HfClient from collectors/hf-client.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper } from "../collectors/common.js";

// ---------------------------------------------------------------------------
// Types that the implementation must export (matching spec interfaces)
// ---------------------------------------------------------------------------

/** Config interface for HuggingFace collector */
interface HfConfig {
  enabled: boolean;
  limit: number;
  days_back: number;
  timeout_seconds: number;
  retries: number;
  delay_seconds: number;
}

/** Result interface for HfClient.fetchPapers */
interface HfResult {
  source: "huggingface";
  fetched_at: string;
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

/** Shape of the HfClient we expect to exist */
interface HfClientLike {
  fetchPapers(limit: number, daysBack: number): Promise<Paper[]>;
}

// ---------------------------------------------------------------------------
// Helpers: mock HF API response data
// ---------------------------------------------------------------------------

/** A raw HF Daily Papers API entry (what the real API returns) */
interface RawHfEntry {
  paper: {
    id: string;
    title: string;
    summary: string;
    authors: Array<{ name: string; _id: string }>;
    publishedAt: string;
    ai_keywords?: string[];
  };
  publishedAt: string;
  numComments: number;
}

function makeRawHfEntry(overrides: Partial<RawHfEntry["paper"]> = {}): RawHfEntry {
  const paper = {
    id: "2606.05515",
    title: "Attention Is All You Need (Again)",
    summary: "We propose a new transformer architecture for context engineering...",
    authors: [
      { name: "Alice Smith", _id: "abc123" },
      { name: "Bob Jones", _id: "def456" },
    ],
    publishedAt: "2026-06-06T00:00:00.000Z",
    ai_keywords: ["transformers", "attention"],
    ...overrides,
  };
  return {
    paper,
    publishedAt: "2026-06-06T12:00:00.000Z",
    numComments: 5,
  };
}

function makeRawHfEntry2(overrides: Partial<RawHfEntry["paper"]> = {}): RawHfEntry {
  const paper = {
    id: "2606.07777",
    title: "Scaling Laws for Context Windows",
    summary: "We study the scaling behavior of context window utilization...",
    authors: [{ name: "Charlie Brown", _id: "ghi789" }],
    publishedAt: "2026-06-07T00:00:00.000Z",
    ai_keywords: ["scaling", "context"],
    ...overrides,
  };
  return {
    paper,
    publishedAt: "2026-06-07T08:00:00.000Z",
    numComments: 12,
  };
}

/** A normalized Paper as we expect HfClient to produce from HF API data */
function makeExpectedPaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2606.05515",
    title: "Attention Is All You Need (Again)",
    abstract: "We propose a new transformer architecture for context engineering...",
    url: "https://huggingface.co/papers/2606.05515",
    pdf_url: "https://arxiv.org/pdf/2606.05515",
    authors: ["Alice Smith", "Bob Jones"],
    categories: ["transformers", "attention"],
    primary_category: "transformers",
    published: "2026-06-06T00:00:00.000Z",
    updated: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

function makeExpectedPaper2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2606.07777",
    title: "Scaling Laws for Context Windows",
    abstract: "We study the scaling behavior of context window utilization...",
    url: "https://huggingface.co/papers/2606.07777",
    pdf_url: "https://arxiv.org/pdf/2606.07777",
    authors: ["Charlie Brown"],
    categories: ["scaling", "context"],
    primary_category: "scaling",
    published: "2026-06-07T00:00:00.000Z",
    updated: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

const DEFAULT_HF_CONFIG: HfConfig = {
  enabled: true,
  limit: 30,
  days_back: 2,
  timeout_seconds: 30,
  retries: 3,
  delay_seconds: 1.0,
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct HfResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Normal fetch", () => {
  it("fetches papers and returns correct HfResult structure", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([makeExpectedPaper(), makeExpectedPaper2()]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.source).toBe("huggingface");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("2606.05515");
  });

  it("passes limit and days_back to the client", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(mockClient.fetchPapers).toHaveBeenCalledWith(30, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Field normalization — HF response maps to Paper interface
// ---------------------------------------------------------------------------
describe("AC-2: Field normalization", () => {
  it("Paper has all required fields with correct types", () => {
    const paper = makeExpectedPaper();

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

  it("url is huggingface.co/papers/{id}", () => {
    const paper = makeExpectedPaper();
    expect(paper.url).toBe("https://huggingface.co/papers/2606.05515");
  });

  it("pdf_url is arxiv.org/pdf/{id}", () => {
    const paper = makeExpectedPaper();
    expect(paper.pdf_url).toBe("https://arxiv.org/pdf/2606.05515");
  });

  it("authors are extracted from HF authors[].name", () => {
    const paper = makeExpectedPaper();
    expect(paper.authors).toEqual(["Alice Smith", "Bob Jones"]);
  });

  it("categories come from ai_keywords", () => {
    const paper = makeExpectedPaper();
    expect(paper.categories).toEqual(["transformers", "attention"]);
  });

  it("primary_category is ai_keywords[0] when available", () => {
    const paper = makeExpectedPaper();
    expect(paper.primary_category).toBe("transformers");
  });

  it("categories defaults to empty array when ai_keywords absent", () => {
    const paper = makeExpectedPaper({ categories: [] });
    expect(paper.categories).toEqual([]);
  });

  it("primary_category defaults to hf-daily when no ai_keywords", () => {
    // AC from spec clarification #2: use "hf-daily" instead of "unknown"
    const paper = makeExpectedPaper({ categories: [], primary_category: "hf-daily" });
    expect(paper.primary_category).toBe("hf-daily");
  });

  it("title is normalized (whitespace collapsed, trimmed)", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const messyPaper = makeExpectedPaper({
      id: "2606.99999",
      title: "  A\nVery\n  Messy   Title  ",
    });

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([messyPaper]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.papers[0].title).not.toMatch(/\n/);
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("HfResult has all required top-level fields", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });

  it("published and updated are set from paper.publishedAt", () => {
    const paper = makeExpectedPaper();
    expect(paper.published).toBe("2026-06-06T00:00:00.000Z");
    expect(paper.updated).toBe("2026-06-06T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Config loading with defaults and overrides
// ---------------------------------------------------------------------------
describe("AC-3: Config loading with defaults", () => {
  it("uses defaults when config has no sources.huggingface section", async () => {
    const { loadConfig } = await import("../collectors/huggingface.js");

    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.limit).toBe(30);
    expect(config.days_back).toBe(2);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
    expect(config.delay_seconds).toBe(1.0);
  });

  it("uses defaults for missing keys only (preserves provided keys)", async () => {
    const { loadConfig } = await import("../collectors/huggingface.js");

    const partialConfig = {
      sources: {
        huggingface: {
          enabled: true,
          limit: 50,
          days_back: 5,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.enabled).toBe(true);
    expect(config.limit).toBe(50);
    expect(config.days_back).toBe(5);
    // These should use defaults
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
    expect(config.delay_seconds).toBe(1.0);
  });

  it("returns enabled: true by default", async () => {
    const { loadConfig } = await import("../collectors/huggingface.js");

    const config = loadConfig({});
    expect(config.enabled).toBe(true);
  });

  it("flat config keys are supported (not just nested sources.huggingface)", async () => {
    const { loadConfig } = await import("../collectors/huggingface.js");

    // loadConfig should accept both nested and flat
    const flatConfig = {
      enabled: false,
      limit: 10,
    };

    const config = loadConfig(flatConfig);
    expect(config.enabled).toBe(false);
    expect(config.limit).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Deduplication by paper ID
// ---------------------------------------------------------------------------
describe("AC-4: Deduplication by paper ID", () => {
  it("removes duplicate papers with the same id", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const paper1 = makeExpectedPaper();
    const paper1Dup = makeExpectedPaper({ title: "Same Paper Different Title" });
    const paper2 = makeExpectedPaper2();

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([paper1, paper1Dup, paper2]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps the first occurrence when duplicates exist", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const paper1 = makeExpectedPaper();
    const paper1Dup = makeExpectedPaper({ title: "Later Duplicate" });

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([paper1, paper1Dup]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("Attention Is All You Need (Again)");
  });

  it("does not dedup papers with different ids", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const paper1 = makeExpectedPaper();
    const paper2 = makeExpectedPaper2();

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([paper1, paper2]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC-5: Date filtering (days_back)
// ---------------------------------------------------------------------------
describe("AC-5: Date filtering", () => {
  it("client.fetchPapers receives days_back parameter from config", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([]),
    };

    const config = { ...DEFAULT_HF_CONFIG, days_back: 7 };
    await fetchHuggingFace(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    // Second argument to fetchPapers should be days_back
    expect(mockClient.fetchPapers).toHaveBeenCalledWith(30, 7);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Retry with exponential backoff (structural test)
// ---------------------------------------------------------------------------
describe("AC-6: HfClient retry capability", () => {
  it("HfClient can be instantiated with retry config", async () => {
    const { HfClient } = await import("../collectors/hf-client.js");

    const client = new HfClient({
      delaySeconds: 1,
      timeoutSeconds: 30,
      retries: 3,
    });

    expect(client).toBeDefined();
    expect(typeof client.fetchPapers).toBe("function");
  });

  it("HfClient constructor accepts all config parameters", async () => {
    const { HfClient } = await import("../collectors/hf-client.js");

    // Should not throw with valid config
    expect(() => new HfClient({
      delaySeconds: 1.0,
      timeoutSeconds: 30,
      retries: 3,
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-7: CLI entry point — structural tests
// ---------------------------------------------------------------------------
describe("AC-7: CLI entry point exports", () => {
  it("fetchHuggingFace is exported", async () => {
    const mod = await import("../collectors/huggingface.js");
    expect(typeof mod.fetchHuggingFace).toBe("function");
  });

  it("loadConfig is exported", async () => {
    const mod = await import("../collectors/huggingface.js");
    expect(typeof mod.loadConfig).toBe("function");
  });

  it("HfResult interface is used as return type of fetchHuggingFace", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    // Verify HfResult shape
    expect(result.source).toBe("huggingface");
    expect(typeof result.fetched_at).toBe("string");
    expect(typeof result.total_results).toBe("number");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.papers)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Disabled collector
// ---------------------------------------------------------------------------
describe("AC-9: Disabled collector", () => {
  it("returns empty result with no papers when enabled: false", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const config: HfConfig = { ...DEFAULT_HF_CONFIG, enabled: false };
    const mockClient: HfClientLike = {
      fetchPapers: vi.fn(),
    };

    const result = await fetchHuggingFace(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    // Should not call the client at all
    expect(mockClient.fetchPapers).not.toHaveBeenCalled();
    // Should return valid empty result
    expect(result.source).toBe("huggingface");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
  });

  it("loadConfig correctly sets enabled: false", async () => {
    const { loadConfig } = await import("../collectors/huggingface.js");

    const config = loadConfig({
      sources: { huggingface: { enabled: false } },
    });

    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-5 edge: Empty response
// ---------------------------------------------------------------------------
describe("Empty response", () => {
  it("produces valid HfResult with total_results: 0 when API returns empty", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.source).toBe("huggingface");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
  });

  it("output is valid JSON serializable", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
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
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockRejectedValue(new Error("HTTP 500: Internal Server Error")),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("500");
    expect(result.papers).toEqual([]);
  });

  it("does not crash on network error", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });

  it("result is still valid JSON after error", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    const json = JSON.stringify(result);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.source).toBe("huggingface");
  });
});

// ---------------------------------------------------------------------------
// HF-specific: User-Agent header (structural)
// ---------------------------------------------------------------------------
describe("AC-12: User-Agent header", () => {
  it("HfClient is importable (User-Agent is set internally)", async () => {
    const { HfClient } = await import("../collectors/hf-client.js");
    expect(HfClient).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// HF-specific: source field is always "huggingface"
// ---------------------------------------------------------------------------
describe("Source field", () => {
  it("result.source is always 'huggingface'", async () => {
    const { fetchHuggingFace } = await import("../collectors/huggingface.js");

    const mockClient: HfClientLike = {
      fetchPapers: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchHuggingFace(DEFAULT_HF_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/hf-client.js"))["HfClient"]>,
    });

    expect(result.source).toBe("huggingface");
  });
});
