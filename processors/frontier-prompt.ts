/**
 * Prompt construction and response parsing for the frontier topic detector.
 * Re-exports from the original processor/frontier-prompt.ts with updated imports.
 */

import type { Paper } from "../sources/types.js";

export interface FrontierTopic {
  topic_name: string;
  why_novel: string;
  potential_relevance: string;
  papers: Array<{
    index: number;
    title: string;
    connection: string;
  }>;
}

/**
 * Build a prompt that asks the LLM to identify novel technical directions
 * not covered by the user's known interest areas.
 */
export function buildFrontierPrompt(
  knownInterests: string[],
  papers: Array<{ title: string; abstract: string; primary_category: string }>
): string {
  const interestList = knownInterests.map((i) => `- ${i}`).join("\n");

  const paperEntries = papers
    .map(
      (p, i) =>
        `${i}. Title: ${p.title}\n   Abstract: ${p.abstract}\n   Category: ${p.primary_category}`
    )
    .join("\n\n");

  return `You are a research frontier analyst. Your job is to identify papers that represent NEW technical directions or emerging paradigms NOT covered by the user's known interest areas.

User's Known Interest Areas:
${interestList}

Papers to analyze:
${paperEntries}

For each paper, determine if it represents a genuinely novel technical direction that the user might be missing. Group related papers into frontier topics.

IMPORTANT CRITERIA:
- A frontier topic must be DISTINCT from the known interest areas above — not just a rephrasing
- Look for: new architectures, novel training methods, emerging evaluation paradigms, new application domains, breakthrough techniques
- Ignore: incremental improvements to known techniques, product announcements, survey papers
- Each topic should have a clear "why this matters" that goes beyond keyword matching

Respond with a JSON array of frontier topics (max ${Math.min(5, papers.length)} topics):
[{
  "topic_name": "short descriptive name",
  "why_novel": "1-2 sentences on why this is a new direction worth watching",
  "potential_relevance": "how this could impact the user's work",
  "papers": [{"index": N, "title": "paper title", "connection": "why this paper represents this frontier"}]
}]

If no genuinely novel topics are found, return an empty array: []
No other text, just the JSON array.`;
}

/**
 * Parse the LLM's frontier detection response.
 * Handles: valid JSON, markdown-wrapped JSON, JSON embedded in text.
 */
export function parseFrontierResponse(
  response: string,
  papers: Paper[]
): FrontierTopic[] {
  if (!response || response.trim().length === 0) {
    return [];
  }

  let topics: FrontierTopic[];
  try {
    topics = extractJsonArray(response);
  } catch {
    return [];
  }

  if (!Array.isArray(topics)) {
    return [];
  }

  const results: FrontierTopic[] = [];

  for (const topic of topics) {
    // Validate topic
    if (
      typeof topic.topic_name !== "string" ||
      topic.topic_name.trim().length === 0
    ) {
      continue;
    }
    if (
      typeof topic.why_novel !== "string" ||
      topic.why_novel.trim().length === 0
    ) {
      continue;
    }
    if (!Array.isArray(topic.papers)) {
      continue;
    }

    // Validate paper indices
    const validPapers = topic.papers.filter(
      (p) => typeof p.index === "number" && p.index >= 0 && p.index < papers.length
    );

    if (validPapers.length === 0) {
      continue;
    }

    results.push({
      topic_name: topic.topic_name.trim(),
      why_novel: topic.why_novel.trim(),
      potential_relevance: topic.potential_relevance?.trim() ?? "",
      papers: validPapers,
    });
  }

  return results;
}

/**
 * Extract a JSON array from a response that may contain markdown blocks or extra text.
 */
function extractJsonArray(response: string): FrontierTopic[] {
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
