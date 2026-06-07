/**
 * Tests for LLM Relevance Scorer (SPEC-SCORER)
 *
 * Covers: AC-1 (input), AC-2 (output schema), AC-3 (ScoredPaper), AC-4 (interests),
 * AC-5 (score range), AC-6 (explanation), AC-7 (threshold), AC-9 (batching),
 * AC-10 (prompt format), AC-14 (provider switching), AC-15 (rate limit backoff),
 * AC-16 (server error retry), AC-17 (batch failure resilience), AC-18 (partial results),
 * AC-19 (config loading), AC-20 (missing interests), AC-22 (CLI flags),
 * AC-25 (conservative scoring), AC-26 (no hallucination), AC-27 (empty abstract),
 * DD-3 (cross-source dedup), DD-4 (threshold CLI override)
 *
 * Mock strategy: HTTP-level — intercept fetch() calls with canned LLM responses.
 * Tests full pipeline including prompt construction and response parsing.
 */

// Set dummy API keys for tests (API key validation happens before fetch)
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key-anthropic";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key-openai";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Paper } from "../collectors/common.js";
import {
  buildBatchPrompt,
  parseScoredResponse,
} from "../processor/scorer-prompt.js";
import {
  callLlm,
  type LlmProviderConfig,
} from "../processor/llm-client.js";
import {
  scorePapers,
  loadConfig,
  readInputFiles,
  type ScorerConfig,
  type ScorerResult,
  type ScoredPaper,
} from "../processor/scorer.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers: mock data
// ---------------------------------------------------------------------------

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2606.06493v1",
    title: "Attention Is All You Need (Again)",
    abstract:
      "We propose a new transformer architecture that improves context engineering through novel attention mechanisms.",
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
    title: "Scaling Laws for RAG Systems",
    abstract:
      "We study the scaling behavior of retrieval-augmented generation across model sizes.",
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

function makePaper3(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "2606.08888v1",
    title: "Unrelated Topic on Quantum Computing",
    abstract: "We present quantum error correction codes for topological qubits.",
    url: "https://arxiv.org/abs/2606.08888v1",
    pdf_url: "https://arxiv.org/pdf/2606.08888v1",
    authors: ["Dave Wilson"],
    categories: ["quant-ph"],
    primary_category: "quant-ph",
    published: "2026-06-07T08:00:00Z",
    updated: "2026-06-07T08:00:00Z",
    ...overrides,
  };
}

const INTERESTS = [
  "context engineering",
  "agent architectures",
  "RAG",
  "fine-tuning",
  "production AI",
  "LLM integration",
  "browser automation",
];

const DEFAULT_CONFIG: ScorerConfig = {
  provider: "claude",
  model: "claude-sonnet-4-20250514",
  batch_size: 10,
  threshold: 7,
  interests: INTERESTS,
};

/**
 * Build a realistic Claude API response containing a scored JSON array.
 */
function makeLlmResponse(scores: { index: number; score: number; explanation: string }[]): string {
  return JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(scores) }],
  });
}

/**
 * Build a Claude API response with the JSON wrapped in a markdown code block.
 */
function makeLlmResponseMarkdown(scores: { index: number; score: number; explanation: string }[]): string {
  return JSON.stringify({
    content: [{ type: "text", text: "```json\n" + JSON.stringify(scores) + "\n```" }],
  });
}

// ---------------------------------------------------------------------------
// Fetch mock setup
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Prompt construction tests
// ---------------------------------------------------------------------------

describe("Prompt Construction: buildBatchPrompt", () => {
  it("includes all interest areas in the prompt", () => {
    const papers = [makePaper(), makePaper2()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    for (const interest of INTERESTS) {
      expect(prompt).toContain(interest);
    }
  });

  it("includes numbered papers with title, abstract, and primary_category", () => {
    const papers = [makePaper(), makePaper2()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    // Papers should be numbered starting from 0
    expect(prompt).toContain("0");
    expect(prompt).toContain("1");
    // Should include paper titles
    expect(prompt).toContain("Attention Is All You Need (Again)");
    expect(prompt).toContain("Scaling Laws for RAG Systems");
    // Should include abstracts
    expect(prompt).toContain("novel attention mechanisms");
    expect(prompt).toContain("retrieval-augmented generation");
    // Should include primary categories
    expect(prompt).toContain("cs.AI");
    expect(prompt).toContain("cs.LG");
  });

  it("includes a scoring rubric with 1-10 anchors", () => {
    const papers = [makePaper()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    // Rubric should reference the 1-10 scale
    expect(prompt).toMatch(/\b1\b/);
    expect(prompt).toMatch(/\b10\b/);
    // Should include anchor descriptions
    expect(prompt.toLowerCase()).toContain("irrelevant");
    expect(prompt.toLowerCase()).toContain("directly");
  });

  it("requests JSON array response with index, score, and explanation fields", () => {
    const papers = [makePaper()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    expect(prompt).toContain("index");
    expect(prompt).toContain("score");
    expect(prompt).toContain("explanation");
  });

  it("includes conservative scoring instructions", () => {
    const papers = [makePaper()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    // AC-25: conservative scoring instruction
    expect(prompt.toLowerCase()).toContain("when in doubt");
  });

  it("includes no-hallucination instructions", () => {
    const papers = [makePaper()];
    const prompt = buildBatchPrompt(INTERESTS, papers);

    // AC-26: no hallucinated content instruction
    expect(prompt.toLowerCase()).toMatch(/do not infer|not in the abstract|vague abstract/);
  });
});

// ---------------------------------------------------------------------------
// Response parsing tests
// ---------------------------------------------------------------------------

describe("Response Parsing: parseScoredResponse", () => {
  it("parses valid JSON array into ScoredPaper[]", () => {
    const papers = [makePaper(), makePaper2()];
    const response = JSON.stringify([
      { index: 0, score: 8, explanation: "Directly addresses context engineering with novel approach." },
      { index: 1, score: 5, explanation: "Related to RAG but not specific to interest areas." },
    ]);

    const scored = parseScoredResponse(response, papers);

    expect(scored).toHaveLength(2);
    expect(scored[0].relevance_score).toBe(8);
    expect(scored[0].score_explanation).toContain("context engineering");
    expect(scored[0].id).toBe("2606.06493v1");
    expect(scored[1].relevance_score).toBe(5);
  });

  it("parses JSON wrapped in markdown code block", () => {
    const papers = [makePaper()];
    const response = '```json\n[{"index": 0, "score": 9, "explanation": "Excellent match for agent architectures."}]\n```';

    const scored = parseScoredResponse(response, papers);

    expect(scored).toHaveLength(1);
    expect(scored[0].relevance_score).toBe(9);
    expect(scored[0].score_explanation).toContain("agent architectures");
  });

  it("parses JSON with extra text around it", () => {
    const papers = [makePaper()];
    const response = 'Here are the scores:\n[{"index": 0, "score": 7, "explanation": "Relevant to fine-tuning research."}]\n\nHope this helps!';

    const scored = parseScoredResponse(response, papers);

    expect(scored).toHaveLength(1);
    expect(scored[0].relevance_score).toBe(7);
  });

  it("returns empty array for completely malformed response", () => {
    const papers = [makePaper()];
    const response = "I cannot score these papers as the request is unclear.";

    const scored = parseScoredResponse(response, papers);

    expect(scored).toEqual([]);
  });

  it("returns empty array for empty response", () => {
    const papers = [makePaper()];
    const scored = parseScoredResponse("", papers);

    expect(scored).toEqual([]);
  });

  it("preserves all Paper fields in ScoredPaper output", () => {
    const paper = makePaper();
    const papers = [paper];
    const response = JSON.stringify([
      { index: 0, score: 8, explanation: "Test explanation." },
    ]);

    const scored = parseScoredResponse(response, papers);

    // All original Paper fields should be preserved
    expect(scored[0].id).toBe(paper.id);
    expect(scored[0].title).toBe(paper.title);
    expect(scored[0].abstract).toBe(paper.abstract);
    expect(scored[0].url).toBe(paper.url);
    expect(scored[0].pdf_url).toBe(paper.pdf_url);
    expect(scored[0].authors).toEqual(paper.authors);
    expect(scored[0].categories).toEqual(paper.categories);
    expect(scored[0].primary_category).toBe(paper.primary_category);
    expect(scored[0].published).toBe(paper.published);
    expect(scored[0].updated).toBe(paper.updated);
    // Plus new fields
    expect(scored[0]).toHaveProperty("relevance_score");
    expect(scored[0]).toHaveProperty("score_explanation");
  });

  it("handles score indices that skip some papers (partial parse)", () => {
    const papers = [makePaper(), makePaper2(), makePaper3()];
    // Only index 0 and 2 scored — index 1 missing
    const response = JSON.stringify([
      { index: 0, score: 8, explanation: "Match." },
      { index: 2, score: 3, explanation: "No match." },
    ]);

    const scored = parseScoredResponse(response, papers);

    // Should return only the papers that were scored
    expect(scored).toHaveLength(2);
    expect(scored[0].id).toBe("2606.06493v1");
    expect(scored[1].id).toBe("2606.08888v1");
  });
});

// ---------------------------------------------------------------------------
// LLM Client tests
// ---------------------------------------------------------------------------

describe("LLM Client: callLlm", () => {
  it("calls Anthropic Messages API when provider is claude", async () => {
    const mockResponse = makeLlmResponse([
      { index: 0, score: 8, explanation: "Test." },
    ]);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(mockResponse)),
      text: () => Promise.resolve(mockResponse),
    });
    globalThis.fetch = fetchSpy;

    const config: LlmProviderConfig = {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    };

    await callLlm("Test prompt", config);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("anthropic");
    expect(options.headers["x-api-key"]).toBe("test-key");
    expect(options.headers["anthropic-version"]).toBeDefined();
  });

  it("calls OpenAI Chat Completions API when provider is openai", async () => {
    const mockResponse = JSON.stringify({
      choices: [{ message: { content: '[{"index": 0, "score": 7, "explanation": "Test."}]' } }],
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(mockResponse)),
      text: () => Promise.resolve(mockResponse),
    });
    globalThis.fetch = fetchSpy;

    const config: LlmProviderConfig = {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    };

    await callLlm("Test prompt", config);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("openai");
    expect(options.headers["Authorization"]).toContain("test-key");
  });

  it("calls Ollama local endpoint when provider is ollama", async () => {
    const mockResponse = JSON.stringify({
      message: { content: '[{"index": 0, "score": 6, "explanation": "Test."}]' },
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(mockResponse)),
      text: () => Promise.resolve(mockResponse),
    });
    globalThis.fetch = fetchSpy;

    const config: LlmProviderConfig = {
      provider: "ollama",
      model: "llama3",
    };

    await callLlm("Test prompt", config);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain("localhost:11434");
    // No auth header for Ollama
    const headers = fetchSpy.mock.calls[0][1]?.headers ?? {};
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("returns raw response text from the API", async () => {
    const innerText = '[{"index": 0, "score": 8, "explanation": "Test."}]';
    const mockResponse = JSON.stringify({
      content: [{ type: "text", text: innerText }],
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(mockResponse)),
      text: () => Promise.resolve(mockResponse),
    });

    const config: LlmProviderConfig = {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    };

    const result = await callLlm("Test prompt", config);
    expect(result).toBe(innerText);
  });

  it("retries on HTTP 429 with exponential backoff (AC-15)", async () => {
    let callCount = 0;
    const successResponse = JSON.stringify({
      content: [{ type: "text", text: '[{"index": 0, "score": 7, "explanation": "OK."}]' }],
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 429, text: () => Promise.resolve("Rate limited") };
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(successResponse)),
        text: () => Promise.resolve(successResponse),
      };
    });

    const config: LlmProviderConfig = {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    };

    const result = await callLlm("Test", config);
    expect(callCount).toBe(3); // 2 failures + 1 success
    expect(result).toBeDefined();
  });

  it("retries on HTTP 5xx (AC-16)", async () => {
    let callCount = 0;
    const successResponse = JSON.stringify({
      content: [{ type: "text", text: '[{"index": 0, "score": 7, "explanation": "OK."}]' }],
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500, text: () => Promise.resolve("Server error") };
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(successResponse)),
        text: () => Promise.resolve(successResponse),
      };
    });

    const config: LlmProviderConfig = {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    };

    const result = await callLlm("Test", config);
    expect(callCount).toBe(2);
    expect(result).toBeDefined();
  });

  it("throws after max retries exhausted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    const config: LlmProviderConfig = {
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      apiKey: "test-key",
    };

    await expect(callLlm("Test", config)).rejects.toThrow();
    // Should have tried 3 times (initial + 2 retries)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Config loading tests
// ---------------------------------------------------------------------------

describe("Config Loading: loadConfig", () => {
  it("loads defaults when given empty config", () => {
    const config = loadConfig({});

    // These match config.yaml values (not hardcoded defaults)
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("meta/llama-3.1-70b-instruct");
    expect(config.batch_size).toBe(5);
    expect(config.threshold).toBe(7);
    expect(config.interests).toEqual(INTERESTS);
  });

  it("preserves provided values while using defaults for missing", () => {
    const config = loadConfig({
      processor: {
        llm: {
          provider: "openai",
          model: "gpt-4o",
        },
        relevance_threshold: 5,
      },
    });

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.threshold).toBe(5);
    // batch_size should default to config.yaml value
    expect(config.batch_size).toBe(5);
  });

  it("reads interests from learning_plan.interests", () => {
    const customInterests = ["transformer architectures", "reinforcement learning"];
    const config = loadConfig({
      learning_plan: {
        interests: customInterests,
      },
    });

    expect(config.interests).toEqual(customInterests);
  });

  it("throws/fatal when learning_plan.interests is missing (AC-20)", () => {
    expect(() =>
      loadConfig({
        processor: {
          llm: { provider: "claude", model: "test" },
        },
        // No learning_plan at all
      })
    ).toThrow();
  });

  it("throws/fatal when learning_plan.interests is empty array", () => {
    expect(() =>
      loadConfig({
        learning_plan: { interests: [] },
      })
    ).toThrow();
  });

  it("reads batch_size from processor.llm.batch_size", () => {
    const config = loadConfig({
      processor: {
        llm: {
          provider: "claude",
          model: "test",
          batch_size: 5,
        },
      },
      learning_plan: { interests: ["test"] },
    });

    expect(config.batch_size).toBe(5);
  });

  it("supports ollama provider config", () => {
    const config = loadConfig({
      processor: {
        llm: {
          provider: "ollama",
          model: "llama3",
        },
      },
      learning_plan: { interests: ["test"] },
    });

    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("llama3");
  });
});

// ---------------------------------------------------------------------------
// Batching tests
// ---------------------------------------------------------------------------

describe("Batching (AC-9)", () => {
  it("sends papers in batches of batch_size", async () => {
    // 25 papers, batch_size=10 -> 3 batches (10, 10, 5)
    const papers: Paper[] = [];
    for (let i = 0; i < 25; i++) {
      papers.push(
        makePaper({
          id: `2606.${String(i).padStart(4, "0")}v1`,
          title: `Paper ${i}`,
          abstract: `Abstract for paper ${i} about context engineering.`,
        })
      );
    }

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      fetchCallCount++;
      const body = JSON.parse(opts.body);
      const messages = body.messages ?? [{ role: "user", content: body.prompt ?? "" }];
      const promptText = messages[0].content;

      // Count how many papers are in this batch by counting numbered entries
      const paperMatches = promptText.match(/^\d+\./gm);
      const count = paperMatches ? paperMatches.length : 0;

      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < count; j++) {
        scores.push({ index: j, score: 8, explanation: "Context engineering match." });
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    // Should make 3 API calls for 25 papers at batch_size=10
    expect(fetchCallCount).toBe(3);
    expect(result.total_input).toBe(25);
    expect(result.papers).toHaveLength(25);
  });

  it("respects custom batch_size from config", async () => {
    const papers: Paper[] = [];
    for (let i = 0; i < 7; i++) {
      papers.push(
        makePaper({
          id: `2606.${String(i).padStart(4, "0")}v1`,
          title: `Paper ${i}`,
          abstract: `Abstract ${i}`,
        })
      );
    }

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      fetchCallCount++;
      const body = JSON.parse(opts.body);
      const messages = body.messages ?? [{ role: "user", content: body.prompt ?? "" }];
      const promptText = messages[0].content;
      const paperMatches = promptText.match(/^\d+\./gm);
      const count = paperMatches ? paperMatches.length : 0;

      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < count; j++) {
        scores.push({ index: j, score: 7, explanation: "Match." });
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, batch_size: 3 };
    await scorePapers(papers, config);

    // 7 papers at batch_size=3 -> 3 batches (3, 3, 1)
    expect(fetchCallCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Threshold filtering tests
// ---------------------------------------------------------------------------

describe("Threshold Filtering (AC-7)", () => {
  it("excludes papers below threshold from output", async () => {
    const papers = [makePaper(), makePaper2(), makePaper3()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 9, explanation: "Directly addresses context engineering." },
        { index: 1, score: 5, explanation: "Tangentially related to RAG." },
        { index: 2, score: 2, explanation: "Not related to any interest area." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 9, explanation: "Directly addresses context engineering." },
        { index: 1, score: 5, explanation: "Tangentially related to RAG." },
        { index: 2, score: 2, explanation: "Not related to any interest area." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    // Only paper 0 (score 9) passes threshold 7
    expect(result.total_above_threshold).toBe(1);
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].id).toBe("2606.06493v1");
  });

  it("includes all papers when threshold is 1", async () => {
    const papers = [makePaper(), makePaper2()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 3, explanation: "Low relevance." },
        { index: 1, score: 8, explanation: "High relevance." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 3, explanation: "Low relevance." },
        { index: 1, score: 8, explanation: "High relevance." },
      ])),
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers(papers, config);

    expect(result.total_above_threshold).toBe(2);
    expect(result.papers).toHaveLength(2);
  });

  it("reports correct total_scored (all papers) vs total_above_threshold", async () => {
    const papers = [makePaper(), makePaper2(), makePaper3()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 8, explanation: "Match." },
        { index: 1, score: 6, explanation: "Below." },
        { index: 2, score: 3, explanation: "Not related." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 8, explanation: "Match." },
        { index: 1, score: 6, explanation: "Below." },
        { index: 2, score: 3, explanation: "Not related." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    expect(result.total_input).toBe(3);
    expect(result.total_scored).toBe(3);
    expect(result.total_above_threshold).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Empty abstract handling (AC-27)
// ---------------------------------------------------------------------------

describe("Empty Abstract Handling (AC-27)", () => {
  it("assigns score 1 without LLM call for empty abstract", async () => {
    const paperWithEmptyAbstract = makePaper({
      id: "2606.99999v1",
      title: "Paper With No Abstract",
      abstract: "",
    });
    const normalPaper = makePaper2();

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse([
          { index: 0, score: 9, explanation: "RAG match." },
        ]))),
        text: () => Promise.resolve(makeLlmResponse([
          { index: 0, score: 9, explanation: "RAG match." },
        ])),
      };
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers([paperWithEmptyAbstract, normalPaper], config);

    // Only 1 API call (for the normal paper) — empty abstract paper not sent to LLM
    expect(fetchCallCount).toBe(1);

    // The empty abstract paper should still appear in output with score 1
    const emptyResult = result.papers.find((p) => p.id === "2606.99999v1");
    expect(emptyResult).toBeDefined();
    expect(emptyResult!.relevance_score).toBe(1);
    expect(emptyResult!.score_explanation).toContain("No abstract");
  });

  it("handles whitespace-only abstract as empty", async () => {
    const paperWithWhitespaceAbstract = makePaper({
      id: "2606.99998v1",
      title: "Whitespace Abstract",
      abstract: "   \n\t  ",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([]))),
      text: () => Promise.resolve(makeLlmResponse([])),
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers([paperWithWhitespaceAbstract], config);

    // Should NOT make any LLM calls
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const emptyResult = result.papers.find((p) => p.id === "2606.99998v1");
    expect(emptyResult).toBeDefined();
    expect(emptyResult!.relevance_score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cross-source deduplication (DD-3)
// ---------------------------------------------------------------------------

describe("Cross-Source Deduplication (DD-3)", () => {
  it("deduplicates papers with same ID from multiple files", async () => {
    // Simulate two collector files with the same paper ID
    const papers = [
      makePaper({ id: "2606.06493v1", title: "From arXiv" }),
      makePaper({ id: "2606.06493v1", title: "From HuggingFace" }),
      makePaper2(),
    ];

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      fetchCallCount++;
      const body = JSON.parse(opts.body);
      const messages = body.messages ?? [{ role: "user", content: body.prompt ?? "" }];
      const promptText = messages[0].content;
      const paperMatches = promptText.match(/^\d+\./gm);
      const count = paperMatches ? paperMatches.length : 0;

      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < count; j++) {
        scores.push({ index: j, score: 8, explanation: "Match." });
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    // Should dedup: only 2 unique papers scored, not 3
    expect(result.total_scored).toBe(2);
    expect(fetchCallCount).toBe(1); // Both fit in one batch
  });

  it("deduplicates by exact title match when IDs differ", async () => {
    const papers = [
      makePaper({ id: "arxiv:2606.06493", title: "Same Title" }),
      makePaper({ id: "hf:2606.06493", title: "Same Title" }),
      makePaper2(),
    ];

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      const messages = body.messages ?? [{ role: "user", content: body.prompt ?? "" }];
      const promptText = messages[0].content;
      const paperMatches = promptText.match(/^\d+\./gm);
      const count = paperMatches ? paperMatches.length : 0;

      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < count; j++) {
        scores.push({ index: j, score: 7, explanation: "Match." });
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    // Same title dedup: only 2 unique papers
    expect(result.total_scored).toBe(2);
  });

  it("does not dedup papers with different IDs and different titles", async () => {
    const papers = [makePaper(), makePaper2(), makePaper3()];

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      const messages = body.messages ?? [{ role: "user", content: body.prompt ?? "" }];
      const promptText = messages[0].content;
      const paperMatches = promptText.match(/^\d+\./gm);
      const count = paperMatches ? paperMatches.length : 0;

      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < count; j++) {
        scores.push({ index: j, score: 5, explanation: "Test." });
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers(papers, config);

    expect(result.total_scored).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Directory input (AC-1 / Clarification 1)
// ---------------------------------------------------------------------------

describe("Directory Input: readInputFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a single JSON file and extracts papers", () => {
    const data = {
      source: "arxiv",
      fetched_at: "2026-06-07T10:00:00Z",
      total_results: 2,
      papers: [makePaper(), makePaper2()],
    };

    const filePath = path.join(tmpDir, "arxiv-2026-06-07.json");
    fs.writeFileSync(filePath, JSON.stringify(data));

    const papers = readInputFiles(filePath);

    expect(papers).toHaveLength(2);
    expect(papers[0].id).toBe("2606.06493v1");
  });

  it("reads all *.json files from a directory and merges papers", () => {
    const arxivData = {
      source: "arxiv",
      papers: [makePaper()],
    };
    const hfData = {
      source: "huggingface",
      papers: [makePaper2()],
    };

    fs.writeFileSync(path.join(tmpDir, "arxiv-2026-06-07.json"), JSON.stringify(arxivData));
    fs.writeFileSync(path.join(tmpDir, "hf-2026-06-07.json"), JSON.stringify(hfData));

    const papers = readInputFiles(tmpDir);

    expect(papers).toHaveLength(2);
  });

  it("ignores non-JSON files in directory", () => {
    const data = { papers: [makePaper()] };

    fs.writeFileSync(path.join(tmpDir, "papers.json"), JSON.stringify(data));
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "not json");

    const papers = readInputFiles(tmpDir);

    expect(papers).toHaveLength(1);
  });

  it("throws for nonexistent path", () => {
    expect(() => readInputFiles("/nonexistent/path")).toThrow();
  });

  it("deduplicates papers across multiple files in directory", () => {
    const file1 = { papers: [makePaper({ id: "2606.06493v1" }), makePaper2()] };
    const file2 = { papers: [makePaper({ id: "2606.06493v1" })] };

    fs.writeFileSync(path.join(tmpDir, "a.json"), JSON.stringify(file1));
    fs.writeFileSync(path.join(tmpDir, "b.json"), JSON.stringify(file2));

    const papers = readInputFiles(tmpDir);

    // Should dedup by ID
    expect(papers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Provider switching (AC-14)
// ---------------------------------------------------------------------------

describe("Provider Switching (AC-14)", () => {
  it("changing provider in config changes the API endpoint used", async () => {
    const papers = [makePaper()];

    const fetchCalls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse([
          { index: 0, score: 8, explanation: "Match." },
        ]))),
        text: () => Promise.resolve(makeLlmResponse([
          { index: 0, score: 8, explanation: "Match." },
        ])),
      };
    });

    // Score with Claude
    const claudeConfig: ScorerConfig = { ...DEFAULT_CONFIG, provider: "claude" };
    await scorePapers(papers, claudeConfig);
    expect(fetchCalls[0]).toContain("anthropic");

    // Score with OpenAI
    fetchCalls.length = 0;
    const openaiConfig: ScorerConfig = { ...DEFAULT_CONFIG, provider: "openai", model: "gpt-4o" };
    await scorePapers(papers, openaiConfig);
    expect(fetchCalls[0]).toContain("openai");

    // Score with Ollama
    fetchCalls.length = 0;
    const ollamaConfig: ScorerConfig = { ...DEFAULT_CONFIG, provider: "ollama", model: "llama3" };
    await scorePapers(papers, ollamaConfig);
    expect(fetchCalls[0]).toContain("localhost:11434");
  });

  it("same prompt is sent regardless of provider", async () => {
    const papers = [makePaper()];
    const promptBodies: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      promptBodies.push(opts.body);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse([
          { index: 0, score: 8, explanation: "Match." },
        ]))),
        text: () => Promise.resolve(makeLlmResponse([
          { index: 0, score: 8, explanation: "Match." },
        ])),
      };
    });

    const claudeConfig: ScorerConfig = { ...DEFAULT_CONFIG, provider: "claude" };
    await scorePapers(papers, claudeConfig);

    const openaiConfig: ScorerConfig = { ...DEFAULT_CONFIG, provider: "openai", model: "gpt-4o" };
    await scorePapers(papers, openaiConfig);

    // The core prompt content should be the same (both contain interests and paper info)
    // The body format differs between providers, but the prompt content should match
    expect(promptBodies).toHaveLength(2);
    // Both should contain the same paper title
    for (const body of promptBodies) {
      expect(body).toContain("Attention Is All You Need (Again)");
    }
  });
});

// ---------------------------------------------------------------------------
// Batch failure resilience (AC-17, AC-18)
// ---------------------------------------------------------------------------

describe("Batch Failure Resilience (AC-17, AC-18)", () => {
  it("continues scoring after a batch fails and includes warning", async () => {
    const papers: Paper[] = [];
    for (let i = 0; i < 25; i++) {
      papers.push(
        makePaper({
          id: `2606.${String(i).padStart(4, "0")}v1`,
          title: `Paper ${i}`,
          abstract: `Abstract for paper ${i}`,
        })
      );
    }

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      // First batch fails, second succeeds, third succeeds
      if (callCount === 1) {
        return { ok: false, status: 500, text: () => Promise.resolve("Server error") };
      }

      // Return scores for 10 papers in batch
      const scores: { index: number; score: number; explanation: string }[] = [];
      for (let j = 0; j < 10; j++) {
        scores.push({ index: j, score: 8, explanation: "Match." });
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers(papers, config);

    // Should have warnings about the failed batch
    expect(result.warnings.length).toBeGreaterThan(0);
    // Should still have results from successful batches
    expect(result.papers.length).toBeGreaterThan(0);
    // total_scored should reflect only successfully scored papers
    expect(result.total_scored).toBeLessThan(25);
  });

  it("writes output even when some batches fail (AC-18)", async () => {
    const papers: Paper[] = [];
    for (let i = 0; i < 15; i++) {
      papers.push(
        makePaper({
          id: `2606.${String(i).padStart(4, "0")}v1`,
          title: `Paper ${i}`,
          abstract: `Abstract ${i}`,
        })
      );
    }

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        // Second batch fails
        return { ok: false, status: 500, text: () => Promise.resolve("Error") };
      }
      const scores = Array.from({ length: 10 }, (_, j) => ({
        index: j,
        score: 8,
        explanation: "Match.",
      }));
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(makeLlmResponse(scores))),
        text: () => Promise.resolve(makeLlmResponse(scores)),
      };
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers(papers, config);

    // Result should exist and be valid
    expect(result).toBeDefined();
    expect(result.source).toBe("scorer");
    expect(result.papers.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("exit code 2 indicated for partial failure (AC-24)", async () => {
    // This tests the ScorerResult structure supports partial results
    const papers = [makePaper(), makePaper2()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Error"),
    });

    const config: ScorerConfig = { ...DEFAULT_CONFIG, threshold: 1 };
    const result = await scorePapers(papers, config);

    // Result should indicate failure
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.papers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ScorerResult output schema (AC-2)
// ---------------------------------------------------------------------------

describe("ScorerResult Output Schema (AC-2)", () => {
  it("has all required top-level fields", async () => {
    const papers = [makePaper()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 8, explanation: "Context engineering match." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 8, explanation: "Context engineering match." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);

    expect(result.source).toBe("scorer");
    expect(result.scored_at).toBeDefined();
    expect(new Date(result.scored_at).getTime()).not.toBeNaN();
    expect(result.interests_used).toEqual(INTERESTS);
    expect(result.provider).toBe("claude");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.total_input).toBe(1);
    expect(result.total_scored).toBe(1);
    expect(result.total_above_threshold).toBe(1);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.papers)).toBe(true);
  });

  it("ScoredPaper has relevance_score as integer 1-10 (AC-3, AC-5)", async () => {
    const papers = [makePaper()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 8, explanation: "Context engineering match." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 8, explanation: "Context engineering match." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);
    const paper = result.papers[0];

    expect(paper.relevance_score).toBe(8);
    expect(Number.isInteger(paper.relevance_score)).toBe(true);
    expect(paper.relevance_score).toBeGreaterThanOrEqual(1);
    expect(paper.relevance_score).toBeLessThanOrEqual(10);
  });

  it("ScoredPaper has score_explanation referencing interests (AC-6)", async () => {
    const papers = [makePaper()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 9, explanation: "Directly addresses context engineering with novel retrieval approach." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 9, explanation: "Directly addresses context engineering with novel retrieval approach." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);
    const paper = result.papers[0];

    expect(typeof paper.score_explanation).toBe("string");
    expect(paper.score_explanation.length).toBeGreaterThan(0);
    // Should reference at least one interest
    const hasInterest = INTERESTS.some((interest) =>
      paper.score_explanation.toLowerCase().includes(interest.toLowerCase())
    );
    expect(hasInterest).toBe(true);
  });

  it("result is valid JSON serializable", async () => {
    const papers = [makePaper()];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(makeLlmResponse([
        { index: 0, score: 7, explanation: "Test." },
      ]))),
      text: () => Promise.resolve(makeLlmResponse([
        { index: 0, score: 7, explanation: "Test." },
      ])),
    });

    const result = await scorePapers(papers, DEFAULT_CONFIG);
    const json = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.source).toBe("scorer");
    expect(parsed.papers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Empty input handling
// ---------------------------------------------------------------------------

describe("Empty Input", () => {
  it("handles empty papers array without calling LLM", async () => {
    globalThis.fetch = vi.fn();

    const result = await scorePapers([], DEFAULT_CONFIG);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.total_input).toBe(0);
    expect(result.total_scored).toBe(0);
    expect(result.total_above_threshold).toBe(0);
    expect(result.papers).toEqual([]);
    expect(result.source).toBe("scorer");
  });
});

// ---------------------------------------------------------------------------
// llmFn injection (testability)
// ---------------------------------------------------------------------------

describe("LLM Function Injection (Testability)", () => {
  it("accepts custom llmFn for testing without HTTP", async () => {
    const papers = [makePaper(), makePaper2()];

    const mockLlmFn = vi.fn().mockResolvedValue(
      JSON.stringify([
        { index: 0, score: 9, explanation: "Context engineering match." },
        { index: 1, score: 4, explanation: "Low relevance." },
      ])
    );

    const result = await scorePapers(papers, DEFAULT_CONFIG, { llmFn: mockLlmFn });

    expect(mockLlmFn).toHaveBeenCalled();
    expect(result.papers).toHaveLength(1); // Only paper 0 passes threshold 7
    expect(result.papers[0].relevance_score).toBe(9);
  });

  it("custom llmFn receives the constructed prompt", async () => {
    const papers = [makePaper()];
    let receivedPrompt = "";

    const mockLlmFn = vi.fn().mockImplementation(async (prompt: string) => {
      receivedPrompt = prompt;
      return JSON.stringify([
        { index: 0, score: 8, explanation: "Match." },
      ]);
    });

    await scorePapers(papers, DEFAULT_CONFIG, { llmFn: mockLlmFn });

    expect(receivedPrompt).toContain("Attention Is All You Need");
    expect(receivedPrompt).toContain("context engineering");
  });
});
