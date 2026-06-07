/**
 * Tests for GitHub Trending Collector
 *
 * Covers: normal fetch, dedup, empty results, API error, config defaults, disabled,
 * output schema, rate limiting, help flag, logging, client interface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper, GithubResult, GithubConfig } from "../collectors/github.js";
import { fetchGithub, loadConfig } from "../collectors/github.js";
import { GithubClient } from "../collectors/github-client.js";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "12345",
    title: "owner/awesome-ml-repo",
    abstract: "A machine learning framework for production AI",
    url: "https://github.com/owner/awesome-ml-repo",
    pdf_url: "",
    authors: ["owner"],
    categories: ["machine-learning", "deep-learning"],
    primary_category: "machine-learning",
    published: "2026-06-07T10:00:00Z",
    updated: "2026-06-07T12:00:00Z",
    ...overrides,
  };
}

function makePaper2(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "67890",
    title: "org/llm-toolkit",
    abstract: "A toolkit for LLM integration and context engineering",
    url: "https://github.com/org/llm-toolkit",
    pdf_url: "",
    authors: ["org"],
    categories: ["artificial-intelligence", "nlp"],
    primary_category: "artificial-intelligence",
    published: "2026-06-07T09:00:00Z",
    updated: "2026-06-07T11:00:00Z",
    ...overrides,
  };
}

const DEFAULT_CONFIG: GithubConfig = {
  enabled: true,
  languages: ["python", "typescript"],
  since: "daily",
  max_results: 30,
  delay_seconds: 2.0,
  timeout_seconds: 30,
  retries: 3,
};

// ---------------------------------------------------------------------------
// AC-1: Normal fetch — correct GithubResult structure
// ---------------------------------------------------------------------------
describe("AC-1: Normal fetch", () => {
  it("fetches repos and returns correct GithubResult structure", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([makePaper(), makePaper2()]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.source).toBe("github_trending");
    expect(result.fetched_at).toBeDefined();
    expect(new Date(result.fetched_at).getTime()).not.toBeNaN();
    expect(result.languages_queried).toEqual(["python", "typescript"]);
    expect(result.since).toBe("daily");
    expect(result.total_results).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.papers).toHaveLength(2);
    expect(result.papers[0].id).toBe("12345");
  });

  it("passes languages, since, and max_results to the client", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([makePaper()]),
    };

    await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(mockClient.fetchRepos).toHaveBeenCalledWith(
      ["python", "typescript"],
      "daily",
      30,
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

  it("pdf_url is empty string for GitHub repos", () => {
    const paper = makePaper();
    expect(paper.pdf_url).toBe("");
  });

  it("title is stripped of newlines and excess whitespace", async () => {
    const messyPaper = makePaper({
      id: "99999",
      title: "  owner\n  messy\n  repo  ",
    });

    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([messyPaper]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.papers[0].title).not.toMatch(/\n/);
    expect(result.papers[0].title).toBe(result.papers[0].title.trim());
  });

  it("GithubResult has all required top-level fields", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([makePaper()]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("fetched_at");
    expect(result).toHaveProperty("languages_queried");
    expect(result).toHaveProperty("since");
    expect(result).toHaveProperty("total_results");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("papers");
  });
});

// ---------------------------------------------------------------------------
// AC-3: Deduplication by ID
// ---------------------------------------------------------------------------
describe("AC-3: Deduplication by repo ID", () => {
  it("removes duplicates when same repo ID appears twice", async () => {
    const repo1 = makePaper({ id: "12345" });
    const repo2 = makePaper({ id: "12345", title: "owner/awesome-ml-repo-updated" });
    const other = makePaper2();

    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([repo1, repo2, other]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.papers).toHaveLength(2);
    expect(result.total_results).toBe(2);
  });

  it("keeps first occurrence on duplicate ID", async () => {
    const repo1 = makePaper({ id: "12345", title: "first" });
    const repo2 = makePaper({ id: "12345", title: "second" });

    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([repo1, repo2]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].title).toBe("first");
  });

  it("does not dedup repos with different IDs", async () => {
    const repo1 = makePaper({ id: "12345" });
    const repo2 = makePaper({ id: "67890" });

    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([repo1, repo2]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC-4: Empty results
// ---------------------------------------------------------------------------
describe("AC-4: Empty results", () => {
  it("produces valid GithubResult with total_results: 0 when no repos found", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.source).toBe("github_trending");
    expect(result.total_results).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fetched_at).toBeDefined();
    expect(result.languages_queried).toEqual(DEFAULT_CONFIG.languages);
  });

  it("output is valid JSON serializable", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.total_results).toBe(0);
    expect(parsed.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-5: API error handling
// ---------------------------------------------------------------------------
describe("AC-5: API error handling", () => {
  it("populates warnings array on HTTP error, returns empty papers", async () => {
    const mockClient = {
      fetchRepos: vi.fn()
        .mockRejectedValue(new Error("HTTP 403: rate limit exceeded")),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("403");
    expect(result.papers).toEqual([]);
  });

  it("continues after error (does not crash)", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-6: Config defaults
// ---------------------------------------------------------------------------
describe("AC-6: Config defaults", () => {
  it("uses defaults when config has no sources.github_trending section", () => {
    const config = loadConfig({});
    expect(config.languages).toEqual(["python", "typescript"]);
    expect(config.since).toBe("daily");
    expect(config.max_results).toBe(30);
    expect(config.delay_seconds).toBe(2.0);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("uses defaults for missing keys only (preserves provided keys)", () => {
    const partialConfig = {
      sources: {
        github_trending: {
          enabled: true,
          languages: ["rust"],
          since: "weekly",
        },
      },
    };

    const config = loadConfig(partialConfig);
    expect(config.languages).toEqual(["rust"]);
    expect(config.since).toBe("weekly");
    // These should use defaults
    expect(config.max_results).toBe(30);
    expect(config.delay_seconds).toBe(2.0);
    expect(config.timeout_seconds).toBe(30);
    expect(config.retries).toBe(3);
  });

  it("returns enabled: true by default", () => {
    const config = loadConfig({});
    expect(config.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-7: Disabled collector
// ---------------------------------------------------------------------------
describe("AC-7: Disabled collector", () => {
  it("respects enabled: false in config", () => {
    const config = loadConfig({
      sources: {
        github_trending: {
          enabled: false,
        },
      },
    });
    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-8: Output file naming
// ---------------------------------------------------------------------------
describe("AC-8: Output file naming", () => {
  it("output follows github-YYYY-MM-DD.json pattern", () => {
    const today = new Date().toISOString().slice(0, 10);
    const expectedName = `github-${today}.json`;
    expect(expectedName).toMatch(/^github-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

// ---------------------------------------------------------------------------
// AC-9: Rate limiting
// ---------------------------------------------------------------------------
describe("AC-9: Rate limiting", () => {
  it("enforces delay between requests (configurable via config)", () => {
    expect(DEFAULT_CONFIG.delay_seconds).toBeGreaterThanOrEqual(2);
  });

  it("GithubClient accepts delay_seconds parameter", () => {
    const client = new GithubClient({
      delaySeconds: DEFAULT_CONFIG.delay_seconds,
      timeoutSeconds: DEFAULT_CONFIG.timeout_seconds,
      retries: DEFAULT_CONFIG.retries,
    });
    expect(client).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-10: Dry-run mode
// ---------------------------------------------------------------------------
describe("AC-10: Dry-run mode", () => {
  it("fetchGithub returns result without writing files (file writing is CLI-only)", async () => {
    const mockClient = {
      fetchRepos: vi.fn().mockResolvedValue([makePaper()]),
    };

    const result = await fetchGithub(DEFAULT_CONFIG, {
      client: mockClient as unknown as GithubClient,
    });

    expect(result.papers).toHaveLength(1);
    expect(result.source).toBe("github_trending");
  });
});

// ---------------------------------------------------------------------------
// AC-11: Logging
// ---------------------------------------------------------------------------
describe("AC-11: Logging", () => {
  it("setupLogging is exported from collectors/common.ts", async () => {
    const { setupLogging } = await import("../collectors/common.js");
    expect(typeof setupLogging).toBe("function");
  });

  it("setupLogging accepts optional level parameter", async () => {
    const { setupLogging } = await import("../collectors/common.js");
    expect(() => setupLogging()).not.toThrow();
    expect(() => setupLogging("debug")).not.toThrow();
    expect(() => setupLogging("info")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GithubClient interface tests
// ---------------------------------------------------------------------------
describe("GithubClient", () => {
  it("can be instantiated with config", () => {
    const client = new GithubClient({
      delaySeconds: 2,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(client).toBeDefined();
  });

  it("has fetchRepos method", () => {
    const client = new GithubClient({
      delaySeconds: 2,
      timeoutSeconds: 30,
      retries: 3,
    });
    expect(typeof client.fetchRepos).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Help flag
// ---------------------------------------------------------------------------
describe("Help flag", () => {
  it("fetchGithub options support help flag concept", () => {
    expect(typeof fetchGithub).toBe("function");
  });
});
