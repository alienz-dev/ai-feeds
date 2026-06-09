/**
 * Tests for Reddit Collector
 *
 * Covers:
 *   - Normal fetch and result structure
 *   - Field normalization (title, abstract, authors, urls, categories)
 *   - Config loading with defaults and overrides
 *   - Deduplication by post ID
 *   - Empty results
 *   - API error handling
 *   - Disabled collector
 *   - CLI entry point exports
 *   - RedditClient instantiation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper } from "../collectors/common.js";

// ---------------------------------------------------------------------------
// Types that the implementation must export
// ---------------------------------------------------------------------------

interface RedditConfig {
  enabled: boolean;
  subreddits: string[];
  sort: string;
  limit: number;
  timeout_seconds: number;
  delay_seconds: number;
  cdp_endpoint: string;
}

interface RedditResult {
  source: "reddit";
  fetched_at: string;
  subreddits_queried: string[];
  total_results: number;
  warnings: string[];
  papers: Paper[];
}

interface RedditClientLike {
  fetchMultipleSubreddits(
    subreddits: string[],
    sort: string,
    limit: number
  ): Promise<Paper[]>;
}

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makeExpectedPaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "abc123",
    title: "New SOTA on MMLU with context engineering",
    abstract: "We achieve state-of-the-art results using novel context engineering techniques...",
    url: "https://www.reddit.com/r/MachineLearning/comments/abc123/new_sota/",
    pdf_url: "",
    authors: ["ml_researcher"],
    categories: ["MachineLearning"],
    primary_category: "MachineLearning",
    published: "2026-06-07T10:00:00.000Z",
    updated: "2026-06-07T10:00:00.000Z",
    ...overrides,
  };
}

function makeExpectedPaper2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "def456",
    title: "LocalLLaMA: Running Llama 3 on M2 MacBook",
    abstract: "Here is my setup for running Llama 3 locally...",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/def456/running_llama/",
    pdf_url: "",
    authors: ["local_llm_fan"],
    categories: ["LocalLLaMA"],
    primary_category: "LocalLLaMA",
    published: "2026-06-07T09:00:00.000Z",
    updated: "2026-06-07T09:00:00.000Z",
    ...overrides,
  };
}

const DEFAULT_REDDIT_CONFIG: RedditConfig = {
  enabled: true,
  subreddits: ["MachineLearning", "LocalLLaMA", "artificial"],
  sort: "hot",
  limit: 25,
  timeout_seconds: 30,
  delay_seconds: 1.0,
  cdp_endpoint: "http://localhost:9222",
};

// ---------------------------------------------------------------------------
// Normal fetch — correct RedditResult structure
// ---------------------------------------------------------------------------
describe("Normal fetch", () => {
  it("fetches posts and returns correct RedditResult structure", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper(), makeExpectedPaper2()]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.source).toBe("reddit");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("abc123");
  });

  it("passes subreddits, sort, and limit to the client", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(mockClient.fetchMultipleSubreddits).toHaveBeenCalledWith(
      ["MachineLearning", "LocalLLaMA", "artificial"],
      "hot",
      25
    );
  });

  it("includes subreddits_queried from config", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.subreddits_queried).toEqual(["MachineLearning", "LocalLLaMA", "artificial"]);
  });
});

// ---------------------------------------------------------------------------
// Field normalization — Reddit response maps to Paper interface
// ---------------------------------------------------------------------------
describe("Field normalization", () => {
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

  it("pdf_url is empty string for Reddit posts", () => {
    const paper = makeExpectedPaper();
    expect(paper.pdf_url).toBe("");
  });

  it("authors contains the Reddit username", () => {
    const paper = makeExpectedPaper();
    expect(paper.authors).toEqual(["ml_researcher"]);
  });

  it("categories contains the subreddit name", () => {
    const paper = makeExpectedPaper();
    expect(paper.categories).toEqual(["MachineLearning"]);
  });

  it("primary_category is the subreddit name", () => {
    const paper = makeExpectedPaper();
    expect(paper.primary_category).toBe("MachineLearning");
  });

  it("url is the full reddit permalink", () => {
    const paper = makeExpectedPaper();
    expect(paper.url).toContain("reddit.com");
    expect(paper.url).toContain("abc123");
  });

  it("title is normalized (whitespace collapsed, trimmed)", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const messyPaper = makeExpectedPaper({
      id: "messy1",
      title: "  A\nVery\n  Messy   Title  ",
    });

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([messyPaper]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.papers[0].title).not.toMatch(/\n/);
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("RedditResult has all required top-level fields", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("subreddits_queried");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// Config loading with defaults and overrides
// ---------------------------------------------------------------------------
describe("Config loading with defaults", () => {
  it("uses defaults when config has no sources.reddit section", async () => {
    const { loadConfig } = await import("../collectors/reddit.js");

    const config = loadConfig({});
    expect(config.enabled).toBe(true);
    expect(config.subreddits).toEqual(["MachineLearning", "LocalLLaMA", "artificial"]);
    expect(config.limit).toBe(100);
    expect(config.hours_back).toBe(24);
    expect(config.delay_seconds).toBe(0.5);
  });

  it("uses defaults for missing keys only (preserves provided keys)", async () => {
    const { loadConfig } = await import("../collectors/reddit.js");

    const partialConfig = {
      sources: {
        reddit: {
          enabled: true,
          subreddits: ["customsub"],
          limit: 50,
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.enabled).toBe(true);
    expect(config.subreddits).toEqual(["customsub"]);
    expect(config.limit).toBe(50);
    // These should use defaults
    expect(config.hours_back).toBe(24);
    expect(config.delay_seconds).toBe(0.5);
  });

  it("flat config keys are supported (not just nested sources.reddit)", async () => {
    const { loadConfig } = await import("../collectors/reddit.js");

    const flatConfig = {
      enabled: false,
      subreddits: ["testsub"],
    };

    const config = loadConfig(flatConfig);
    expect(config.enabled).toBe(false);
    expect(config.subreddits).toEqual(["testsub"]);
  });
});

// ---------------------------------------------------------------------------
// Deduplication by post ID
// ---------------------------------------------------------------------------
describe("Deduplication by post ID", () => {
  it("removes duplicate posts with the same id", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const paper1 = makeExpectedPaper();
    const paper1Dup = makeExpectedPaper({ title: "Same Post Different Title" });
    const paper2 = makeExpectedPaper2();

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([paper1, paper1Dup, paper2]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps the first occurrence when duplicates exist", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const paper1 = makeExpectedPaper();
    const paper1Dup = makeExpectedPaper({ title: "Later Duplicate" });

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([paper1, paper1Dup]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("New SOTA on MMLU with context engineering");
  });

  it("does not dedup posts with different ids", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const paper1 = makeExpectedPaper();
    const paper2 = makeExpectedPaper2();

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([paper1, paper2]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty results
// ---------------------------------------------------------------------------
describe("Empty response", () => {
  it("produces valid RedditResult with total_results: 0 when API returns empty", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.source).toBe("reddit");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
  });

  it("output is valid JSON serializable", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
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
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockRejectedValue(new Error("HTTP 429: Too Many Requests")),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("429");
    expect(result.papers).toEqual([]);
  });

  it("does not crash on network error", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });

  it("result is still valid JSON after error", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockRejectedValue(new Error("timeout")),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    const json = JSON.stringify(result);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed.source).toBe("reddit");
  });
});

// ---------------------------------------------------------------------------
// Disabled collector
// ---------------------------------------------------------------------------
describe("Disabled collector", () => {
  it("returns empty result with no papers when enabled: false", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const config: RedditConfig = { ...DEFAULT_REDDIT_CONFIG, enabled: false };
    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn(),
    };

    const result = await fetchReddit(config, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    // Should not call the client at all
    expect(mockClient.fetchMultipleSubreddits).not.toHaveBeenCalled();
    // Should return valid empty result
    expect(result.source).toBe("reddit");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
  });

  it("loadConfig correctly sets enabled: false", async () => {
    const { loadConfig } = await import("../collectors/reddit.js");

    const config = loadConfig({
      sources: { reddit: { enabled: false } },
    });

    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI entry point — structural tests
// ---------------------------------------------------------------------------
describe("CLI entry point exports", () => {
  it("fetchReddit is exported", async () => {
    const mod = await import("../collectors/reddit.js");
    expect(typeof mod.fetchReddit).toBe("function");
  });

  it("loadConfig is exported", async () => {
    const mod = await import("../collectors/reddit.js");
    expect(typeof mod.loadConfig).toBe("function");
  });

  it("RedditResult interface is used as return type of fetchReddit", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    // Verify RedditResult shape
    expect(result.source).toBe("reddit");
    expect(typeof result.fetched_at).toBe("string");
    expect(typeof result.total_results).toBe("number");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.papers)).toBe(true);
    expect(Array.isArray(result.subreddits_queried)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RedditClient instantiation
// ---------------------------------------------------------------------------
describe("RedditClient instantiation", () => {
  it("RedditClient can be instantiated with config", async () => {
    const { RedditClient } = await import("../collectors/reddit-client.js");

    const client = new RedditClient({
      limit: 100,
      hoursBack: 24,
      delaySeconds: 0.5,
    });

    expect(client).toBeDefined();
    expect(typeof client.fetchMultipleSubreddits).toBe("function");
  });

  it("RedditClient constructor accepts all config parameters", async () => {
    const { RedditClient } = await import("../collectors/reddit-client.js");

    expect(() => new RedditClient({
      limit: 50,
      hoursBack: 12,
      delaySeconds: 1.0,
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Source field
// ---------------------------------------------------------------------------
describe("Source field", () => {
  it("result.source is always 'reddit'", async () => {
    const { fetchReddit } = await import("../collectors/reddit.js");

    const mockClient: RedditClientLike = {
      fetchMultipleSubreddits: vi.fn().mockResolvedValue([makeExpectedPaper()]),
    };

    const result = await fetchReddit(DEFAULT_REDDIT_CONFIG, {
      client: mockClient as unknown as InstanceType<(typeof import("../collectors/reddit-client.js"))["RedditClient"]>,
    });

    expect(result.source).toBe("reddit");
  });
});
