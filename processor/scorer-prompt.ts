/**
 * Prompt construction and response parsing for the LLM relevance scorer.
 */

import type { Paper } from "../collectors/common.js";

export interface ScoredItem {
  index: number;
  score: number;
  explanation: string;
}

/**
 * Build a batch prompt that asks the LLM to score papers against interest areas.
 */
export function buildBatchPrompt(
  interests: string[],
  papers: Array<{ title: string; abstract: string; primary_category: string }>
): string {
  const interestList = interests.map((i) => `- ${i}`).join("\n");

  const paperEntries = papers
    .map(
      (p, i) =>
        `${i}. Title: ${p.title}\n   Abstract: ${p.abstract}\n   Category: ${p.primary_category}`
    )
    .join("\n\n");

  return `You are a research paper relevance scorer. Score each paper against the following interest areas.

Interest Areas:
${interestList}

Scoring Rubric (1-10):
- 1-2: Irrelevant — no connection to any interest area
- 3-4: Tangential — mentions a related topic but not directly relevant
- 5-6: Related — addresses one interest area but not a primary focus
- 7-8: Relevant — directly addresses one or more interest areas
- 9-10: Highly relevant — central to interest areas, novel contribution

Papers to score:
${paperEntries}

For each paper, provide:
- index: the paper number (0-indexed)
- score: integer 1-10
- explanation: brief explanation referencing specific interest areas

IMPORTANT SCORING INSTRUCTIONS:
- When in doubt, score lower rather than higher
- Do not infer details not in the abstract — if the abstract is vague, score accordingly
- Base your score only on what is explicitly stated in the abstract

Respond with a JSON array: [{"index": 0, "score": N, "explanation": "..."}]
No other text, just the JSON array.`;
}

/**
 * Parse the LLM's response into ScoredPaper entries mapped back to original papers.
 * Handles: valid JSON, markdown-wrapped JSON, JSON embedded in text, malformed responses.
 */
export function parseScoredResponse(
  response: string,
  papers: Paper[]
): Array<Paper & { relevance_score: number; score_explanation: string }> {
  if (!response || response.trim().length === 0) {
    return [];
  }

  let items: ScoredItem[];
  try {
    items = extractJsonArray(response);
  } catch {
    return [];
  }

  if (!Array.isArray(items)) {
    return [];
  }

  const results: Array<Paper & { relevance_score: number; score_explanation: string }> = [];

  for (const item of items) {
    // Validate index
    if (typeof item.index !== "number" || item.index < 0 || item.index >= papers.length) {
      continue;
    }

    // Validate score: must be integer 1-10
    const score = Math.round(item.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      continue;
    }

    // Validate explanation: must be non-empty string
    if (typeof item.explanation !== "string" || item.explanation.trim().length === 0) {
      continue;
    }

    const paper = papers[item.index];
    results.push({
      ...paper,
      relevance_score: score,
      score_explanation: item.explanation,
    });
  }

  return results;
}

/**
 * Extract a JSON array from a response that may contain markdown blocks or extra text.
 */
function extractJsonArray(response: string): ScoredItem[] {
  const trimmed = response.trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // not direct JSON
  }

  // Try extracting from markdown code block
  const mdMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (mdMatch) {
    try {
      const parsed = JSON.parse(mdMatch[1].trim());
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not valid JSON in code block
    }
  }

  // Try finding a JSON array substring
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not valid JSON
    }
  }

  throw new Error("Could not extract JSON array from response");
}
