/**
 * Relevance scorer processor using nexus LLM client.
 *
 * Scores papers against learning interests using an LLM.
 * Supports batch scoring (multiple papers per LLM call) and
 * optional nexus knowledge boost.
 */

import type { LLMClient, NexusContext } from "nexus";
import { callLLM } from "nexus";
import { buildBatchPrompt, parseScoredResponse } from "./scorer-prompt.js";
import type { Paper } from "../sources/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScorerConfig {
  batch_size: number;
  threshold: number;
  interests: string[];
  nexusBoost?: boolean;
}

export interface ScoredPaper extends Paper {
  relevance_score: number;
  score_explanation: string;
  nexus_boost?: number;
  nexus_reasons?: string[];
}

export interface ScorerResult {
  source: string;
  scored_at: string;
  interests_used: string[];
  total_input: number;
  total_scored: number;
  total_above_threshold: number;
  warnings: string[];
  papers: ScoredPaper[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Load scorer config from ai-feeds config.yaml.
 */
export function loadScorerConfig(rawConfig: Record<string, any>): ScorerConfig {
  return {
    batch_size: rawConfig?.processor?.llm?.batch_size ?? 5,
    threshold: rawConfig?.processor?.relevance_threshold ?? 7,
    interests: rawConfig?.learning_plan?.interests ?? [],
    nexusBoost: rawConfig?.nexus?.enabled ?? false,
  };
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/**
 * Deduplicate papers by ID, then by fuzzy title match.
 */
function dedupPapers(papers: Paper[]): Paper[] {
  const byId = new Map<string, Paper>();
  for (const p of papers) {
    if (!byId.has(p.id)) {
      byId.set(p.id, p);
    }
  }
  return Array.from(byId.values());
}

// ---------------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------------

/**
 * Score papers using an LLM via the nexus client.
 *
 * Batches papers for efficiency (multiple papers per LLM call).
 * Optionally applies nexus knowledge boost.
 */
export async function scorePapers(
  papers: Paper[],
  config: ScorerConfig,
  ctx: NexusContext
): Promise<ScorerResult> {
  const warnings: string[] = [];

  if (papers.length === 0) {
    return buildResult([], 0, 0, config, warnings);
  }

  // Deduplicate
  const uniquePapers = dedupPapers(papers);

  // Separate empty-abstract papers (score 1, no LLM call)
  const emptyAbstractPapers: ScoredPaper[] = [];
  const scorablePapers: Paper[] = [];

  for (const paper of uniquePapers) {
    if (!paper.abstract || paper.abstract.trim().length === 0) {
      emptyAbstractPapers.push({
        ...paper,
        relevance_score: 1,
        score_explanation: "No abstract available — assigned minimum score.",
      });
    } else {
      scorablePapers.push(paper);
    }
  }

  // Batch and score via LLM
  const allScored: ScoredPaper[] = [...emptyAbstractPapers];

  for (let i = 0; i < scorablePapers.length; i += config.batch_size) {
    const batch = scorablePapers.slice(i, i + config.batch_size);
    const batchNum = Math.floor(i / config.batch_size);

    try {
      const prompt = buildBatchPrompt(config.interests, batch);
      const rawResponse = await callLLM({
        client: ctx.llm,
        prompt,
        vars: {},
      });
      const scored = parseScoredResponse(rawResponse, batch);
      allScored.push(...scored);
      ctx.logger.info(`[scorer] batch ${batchNum}: scored ${scored.length}/${batch.length}`);
    } catch (err) {
      const msg = `Batch ${batchNum} failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      warnings.push(msg);
      ctx.logger.warn(`[scorer] ${msg}`);
    }
  }

  // Apply nexus boost if configured and knowledge plugin available
  if (config.nexusBoost && (ctx as any).knowledge) {
    try {
      const knowledge = (ctx as any).knowledge;
      const boostResult = applyNexusBoost(allScored, knowledge);
      if (boostResult.boosted > 0) {
        ctx.logger.info(`[scorer] applied nexus boost to ${boostResult.boosted} papers`);
      }
    } catch (err) {
      const msg = `Nexus boost failed: ${err instanceof Error ? err.message : err}`;
      warnings.push(msg);
      ctx.logger.warn(`[scorer] ${msg}`);
    }
  }

  // Filter by threshold
  const aboveThreshold = allScored.filter(
    (p) => p.relevance_score >= config.threshold
  );

  return buildResult(aboveThreshold, uniquePapers.length, allScored.length, config, warnings);
}

// ---------------------------------------------------------------------------
// Nexus boost (direct knowledge plugin access — no HTTP)
// ---------------------------------------------------------------------------

/**
 * Apply nexus knowledge boost to scored papers.
 * Queries entity store for gap skills, trending topics, and hot topics.
 */
function applyNexusBoost(
  papers: ScoredPaper[],
  knowledge: {
    entities: { findByType: (type: string) => Array<{ name: string; properties: Record<string, any> }> };
    resolver: { resolve: (name: string) => string };
  }
): { boosted: number } {
  // Get skill entities with gap/demand data
  const skills = knowledge.entities.findByType("skill");
  const gapSkills = skills.filter(
    (s) => s.properties.gap && (s.properties.gap as number) > 0.3
  );
  const trendingSkills = skills.filter(
    (s) => s.properties.trending || (s.properties.mentions as number) > 5
  );

  if (gapSkills.length === 0 && trendingSkills.length === 0) {
    return { boosted: 0 };
  }

  // Build lookup sets with canonical names
  const gapNames = new Set(
    gapSkills.map((s) => knowledge.resolver.resolve(s.name).toLowerCase())
  );
  const trendingNames = new Set(
    trendingSkills.map((s) => knowledge.resolver.resolve(s.name).toLowerCase())
  );

  let boosted = 0;

  for (const paper of papers) {
    const text = `${paper.title} ${paper.abstract}`.toLowerCase();
    const reasons: string[] = [];
    let boost = 0;

    // Check gap skills
    for (const gap of gapSkills) {
      const canonical = knowledge.resolver.resolve(gap.name).toLowerCase();
      if (text.includes(canonical)) {
        const gapScore = (gap.properties.gap as number) || 0.5;
        boost += gapScore * 0.5;
        reasons.push(`gap: ${gap.name}`);
      }
    }

    // Check trending skills
    for (const trend of trendingSkills) {
      const canonical = knowledge.resolver.resolve(trend.name).toLowerCase();
      if (text.includes(canonical)) {
        boost += 0.2;
        reasons.push(`trending: ${trend.name}`);
      }
    }

    // Cap boost
    boost = Math.min(boost, 5.0);

    if (boost > 0.1) {
      paper.nexus_boost = Math.round(boost * 10) / 10;
      paper.nexus_reasons = reasons;
      paper.relevance_score = Math.min(
        Math.round(paper.relevance_score + boost),
        10
      );
      paper.score_explanation += ` [nexus +${paper.nexus_boost}: ${reasons.join(", ")}]`;
      boosted++;
    }
  }

  return { boosted };
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  papers: ScoredPaper[],
  totalInput: number,
  totalScored: number,
  config: ScorerConfig,
  warnings: string[]
): ScorerResult {
  return {
    source: "scorer",
    scored_at: new Date().toISOString(),
    interests_used: config.interests,
    total_input: totalInput,
    total_scored: totalScored,
    total_above_threshold: papers.length,
    warnings,
    papers,
  };
}
