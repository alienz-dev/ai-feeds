/**
 * Frontier Topic Detector using nexus LLM client.
 *
 * Identifies emerging technical directions outside the user's known interest areas.
 * Reads "middle band" papers (score 4-6), sends to LLM to detect novel paradigms.
 */

import type { NexusContext } from "nexus";
import { callLLM } from "nexus";
import type { Paper } from "../sources/types.js";
import {
  buildFrontierPrompt,
  parseFrontierResponse,
  type FrontierTopic,
} from "./frontier-prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrontierConfig {
  enabled: boolean;
  maxTopics: number;
  interests: string[];
  batchSize: number;
}

export interface FrontierResult {
  source: string;
  detected_at: string;
  known_interests: string[];
  total_input: number;
  total_analyzed: number;
  topics: FrontierTopic[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function loadFrontierConfig(rawConfig: Record<string, any>): FrontierConfig {
  return {
    enabled: rawConfig?.processor?.frontier?.enabled ?? true,
    maxTopics: rawConfig?.processor?.frontier?.max_topics ?? 5,
    interests: rawConfig?.learning_plan?.interests ?? [],
    batchSize: rawConfig?.processor?.llm?.batch_size ?? 5,
  };
}

// ---------------------------------------------------------------------------
// Middle band filter
// ---------------------------------------------------------------------------

/**
 * Filter papers to the "middle band" — score 4-6.
 * These are papers most likely to contain hidden frontier signals.
 */
export function filterMiddleBand(
  papers: ScoredPaper[],
  lowThreshold: number = 4,
  highThreshold: number = 7
): Paper[] {
  return papers
    .filter(
      (p) =>
        p.relevance_score >= lowThreshold && p.relevance_score < highThreshold
    )
    .map(({ relevance_score, score_explanation, nexus_boost, nexus_reasons, ...rest }) => rest);
}

// Import ScoredPaper type from scorer
import type { ScoredPaper } from "./scorer.js";

// ---------------------------------------------------------------------------
// Detection pipeline
// ---------------------------------------------------------------------------

/**
 * Detect frontier topics from a set of papers.
 */
export async function detectFrontier(
  papers: Paper[],
  config: FrontierConfig,
  ctx: NexusContext
): Promise<FrontierResult> {
  if (config.interests.length === 0) {
    throw new Error("No learning interests configured");
  }

  const allTopics: FrontierTopic[] = [];
  const warnings: string[] = [];

  // Process in batches
  for (let i = 0; i < papers.length; i += config.batchSize) {
    const batch = papers.slice(i, i + config.batchSize);
    const batchNum = Math.floor(i / config.batchSize);

    try {
      const prompt = buildFrontierPrompt(config.interests, batch);
      const response = await callLLM({
        client: ctx.llm,
        prompt,
        vars: {},
      });
      const topics = parseFrontierResponse(response, batch);
      allTopics.push(...topics);
      ctx.logger.info(
        `[frontier] batch ${batchNum}: found ${topics.length} frontier topics`
      );
    } catch (err) {
      const msg = `Batch ${batchNum} failed: ${err instanceof Error ? err.message : err}`;
      warnings.push(msg);
      ctx.logger.warn(`[frontier] ${msg}`);
    }
  }

  // Deduplicate topics by name (merge papers from same topic)
  const topicMap = new Map<string, FrontierTopic>();
  for (const topic of allTopics) {
    const key = topic.topic_name.toLowerCase();
    if (topicMap.has(key)) {
      const existing = topicMap.get(key)!;
      const existingIndices = new Set(existing.papers.map((p) => p.index));
      for (const p of topic.papers) {
        if (!existingIndices.has(p.index)) {
          existing.papers.push(p);
        }
      }
    } else {
      topicMap.set(key, { ...topic });
    }
  }

  // Sort by number of papers and limit
  const uniqueTopics = Array.from(topicMap.values())
    .sort((a, b) => b.papers.length - a.papers.length)
    .slice(0, config.maxTopics);

  return {
    source: "frontier-detector",
    detected_at: new Date().toISOString(),
    known_interests: config.interests,
    total_input: papers.length,
    total_analyzed: papers.length,
    topics: uniqueTopics,
    warnings,
  };
}
