/**
 * Adoption Evaluator — evaluates whether scored papers are worth adopting for target repos.
 *
 * Uses nexus API for evaluation, then creates issues via issue-cli.
 */

import type { ScoredPaper } from "./scorer.js";
import { execSync } from "node:child_process";

export interface EnhancementTarget {
  name: string;
  path: string;
  reason: string;
  enhancementAreas: string[];
  interests: string[];
}

export interface AdoptionEvaluatorConfig {
  enabled: boolean;
  project: string;
  reporter: string;
  severity: string;
  scoreThreshold: number;
  evaluationMode: "nexus" | "local" | "hybrid";
  nexusUrl: string;
  targets: EnhancementTarget[];
}

export interface AdoptionResult {
  signal: ScoredPaper;
  target: EnhancementTarget;
  evaluation: {
    alreadyAdopted: boolean;
    alreadyTracked: boolean;
    relevance: number;
    recommendation: "adopt" | "skip" | "monitor";
    confidence: number;
    reasoning: string;
  };
  action: "created" | "skipped" | "monitored";
  issueRef?: string;
}

export class AdoptionEvaluator {
  private config: AdoptionEvaluatorConfig;

  constructor(config: AdoptionEvaluatorConfig) {
    this.config = config;
  }

  /**
   * Evaluate papers for adoption across all targets.
   */
  async evaluate(papers: ScoredPaper[]): Promise<AdoptionResult[]> {
    const results: AdoptionResult[] = [];

    // Filter by score threshold
    const candidates = papers.filter(
      (p) => p.relevance_score >= this.config.scoreThreshold
    );

    for (const paper of candidates) {
      for (const target of this.config.targets) {
        try {
          const result = await this.evaluateForTarget(paper, target);
          results.push(result);
        } catch (err) {
          console.warn(`[adoption] failed to evaluate ${paper.title} for ${target.name}: ${err}`);
        }
      }
    }

    return results;
  }

  /**
   * Evaluate a single paper for a single target.
   */
  private async evaluateForTarget(
    paper: ScoredPaper,
    target: EnhancementTarget
  ): Promise<AdoptionResult> {
    let evaluation: AdoptionResult["evaluation"];

    if (this.config.evaluationMode === "nexus") {
      evaluation = await this.evaluateViaNexus(paper, target);
    } else if (this.config.evaluationMode === "local") {
      evaluation = this.evaluateLocally(paper, target);
    } else {
      // hybrid: local first, then nexus for uncertain cases
      const local = this.evaluateLocally(paper, target);
      if (local.confidence >= 0.8) {
        evaluation = local;
      } else {
        evaluation = await this.evaluateViaNexus(paper, target);
      }
    }

    let action: AdoptionResult["action"] = "monitored";
    let issueRef: string | undefined;

    if (evaluation.recommendation === "adopt" && !evaluation.alreadyTracked) {
      issueRef = this.createIssue(paper, target, evaluation);
      action = "created";
    } else {
      action = "skipped";
    }

    return { signal: paper, target, evaluation, action, issueRef };
  }

  /**
   * Evaluate via nexus API.
   */
  private async evaluateViaNexus(
    paper: ScoredPaper,
    target: EnhancementTarget
  ): Promise<AdoptionResult["evaluation"]> {
    const evidence = this.collectEvidence(paper, target);

    const response = await fetch(
      `${this.config.nexusUrl}/api/projects/${target.name}/evaluate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: {
            title: paper.title,
            abstract: paper.abstract,
            source: paper.source,
            score: paper.relevance_score,
            url: paper.url,
          },
          evidence,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Nexus API error: ${response.status}`);
    }

    const result = (await response.json()) as any;
    return result.evaluation;
  }

  /**
   * Evaluate locally (keyword-based).
   */
  private evaluateLocally(
    paper: ScoredPaper,
    target: EnhancementTarget
  ): AdoptionResult["evaluation"] {
    const keywords = this.extractKeywords(paper.title + " " + paper.abstract);
    const targetKeywords = [
      ...target.enhancementAreas,
      ...target.interests,
    ].map((s) => s.toLowerCase());

    const matches = keywords.filter((k) =>
      targetKeywords.some((t) => t.includes(k) || k.includes(t))
    );

    const alreadyAdopted = matches.length > 0;
    const relevance = alreadyAdopted ? 0.9 : 0.5;

    return {
      alreadyAdopted,
      alreadyTracked: false,
      relevance,
      recommendation: alreadyAdopted ? "skip" : "adopt",
      confidence: 0.7,
      reasoning: alreadyAdopted
        ? `Matches target areas: ${matches.join(", ")}`
        : `No matching areas found`,
    };
  }

  /**
   * Collect evidence for evaluation.
   */
  private collectEvidence(
    paper: ScoredPaper,
    target: EnhancementTarget
  ): any {
    const keywords = this.extractKeywords(paper.title);

    // Code search
    let codeMatches = 0;
    let codeFiles: string[] = [];
    try {
      const grepResult = execSync(
        `grep -rl "${keywords.join("|")}" ${target.path}/ --include="*.md" --include="*.ts" 2>/dev/null | head -5`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      codeFiles = grepResult ? grepResult.split("\n") : [];
      codeMatches = codeFiles.length;
    } catch {}

    // Git history
    let gitCommits = 0;
    let gitRecent = false;
    try {
      const gitResult = execSync(
        `git -C "${target.path}" log --grep="${keywords[0]}" --oneline -5 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitResult) {
        const commits = gitResult.split("\n");
        gitCommits = commits.length;
        gitRecent = true;
      }
    } catch {}

    // Issue search
    let issueMatches = 0;
    let issueRefs: string[] = [];
    try {
      const issueResult = execSync(
        `issue search "${keywords.join(" ")}" --project ${target.name} --limit 3 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (issueResult && !issueResult.includes("No results")) {
        const lines = issueResult.split("\n").filter((l) => l.includes("#"));
        issueRefs = lines.map((l) => l.trim());
        issueMatches = issueRefs.length;
      }
    } catch {}

    return { codeMatches, codeFiles, gitCommits, gitRecent, issueMatches, issueRefs };
  }

  /**
   * Create an issue via issue-cli.
   */
  private createIssue(
    paper: ScoredPaper,
    target: EnhancementTarget,
    evaluation: AdoptionResult["evaluation"]
  ): string {
    const tags = [
      "auto-generated",
      paper.source,
      ...paper.categories.slice(0, 3),
    ].join(",");

    const body = [
      `## Signal`,
      `Source: ${paper.source}`,
      `Score: ${paper.relevance_score}/10`,
      `URL: ${paper.url}`,
      ``,
      `## Abstract`,
      paper.abstract.slice(0, 500),
      ``,
      `## Relevance`,
      evaluation.reasoning,
      ``,
      `## Recommendation`,
      `Confidence: ${evaluation.confidence}`,
      `Action: ${evaluation.recommendation}`,
    ].join("\n");

    const title = `Enhancement: ${paper.title.slice(0, 100)}`;

    try {
      const result = execSync(
        `issue open "${title.replace(/"/g, '\\"')}" ` +
        `--project ${target.name} ` +
        `--type enhancement ` +
        `--severity ${this.config.severity} ` +
        `--reporter ${this.config.reporter} ` +
        `--tags "${tags}" ` +
        `--body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();

      return result;
    } catch (err) {
      console.warn(`[adoption] failed to create issue: ${err}`);
      return "failed";
    }
  }

  /**
   * Extract keywords from text.
   */
  private extractKeywords(text: string): string[] {
    const stopwords = new Set([
      "the", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "shall", "can", "need",
      "a", "an", "in", "for", "on", "with", "at", "by", "from",
      "of", "to", "and", "or", "but", "not", "this", "that",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w))
      .slice(0, 5);
  }
}
