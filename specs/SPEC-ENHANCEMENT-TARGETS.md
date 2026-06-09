---
id: SPEC-ENHANCEMENT-TARGETS
title: Enhancement Target Monitoring
status: draft
version: 1
created: 2026-06-09
---

## Problem

ai-feeds collects signals but doesn't know:
1. Which projects to enhance
2. What those projects already have
3. Whether a signal is worth adopting

## Solution

Add enhancement target monitoring to ai-feeds, using nexus for adoption evaluation.

### 1. Config

```yaml
# config.yaml
enhancement_targets:
  enabled: true
  project: ai-feeds              # issue-cli project name
  reporter: ai-feeds-pipeline    # reporter field for created issues
  severity: P2                   # default severity
  score_threshold: 8             # minimum relevance score
  evaluation_mode: nexus         # nexus | local | hybrid

  targets:
    - name: dev-kit
      path: ~/projects/dev-kit
      reason: "AI-native dev toolkit — evolves with agent/LLM research"
      enhancement_areas:
        - agent workflows
        - SDD patterns
        - multi-agent orchestration
        - checkpoint/resume
      interests:
        - agent architectures
        - production AI
        - LLM integration

    - name: nexus
      path: ~/projects/nexus
      reason: "Knowledge engine — evolves with RAG/graph/embedding research"
      enhancement_areas:
        - knowledge graph
        - entity extraction
        - vector search
        - embedding models
      interests:
        - RAG
        - fine-tuning
        - context engineering

  # NOT monitored (stable, not AI-evolving):
  # - email-hub (email digest)
  # - signal-snapshots (data pipeline)
```

### 2. Processor

**New file: `processors/adoption-evaluator.ts`**

```typescript
export interface AdoptionEvaluatorConfig {
  enabled: boolean;
  project: string;
  reporter: string;
  severity: string;
  scoreThreshold: number;
  evaluationMode: "nexus" | "local" | "hybrid";
  targets: EnhancementTarget[];
}

export interface EnhancementTarget {
  name: string;
  path: string;
  enhancementAreas: string[];
  interests: string[];
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
  evidence: {
    codeMatches: number;
    gitCommits: number;
    issueMatches: number;
  };
  action: "created" | "skipped" | "monitored";
  issueRef?: string;
}
```

### 3. Evaluation Modes

**Mode: nexus** (most reliable)
- Send signal + project context to nexus API
- Nexus runs LLM evaluation with evidence
- Returns structured recommendation

**Mode: local** (no nexus required)
- Extract keywords from signal
- Run grep + git log + issue search
- Simple heuristic: if no matches → adopt

**Mode: hybrid** (recommended)
- Run local evidence collection
- Send evidence + signal to nexus LLM
- Get structured recommendation

### 4. Pipeline Integration

```typescript
// In pipelines/daily.ts
if (config.enhancement_targets?.enabled) {
  const evaluator = new AdoptionEvaluator(config.enhancement_targets);
  const results = await evaluator.evaluate(scoredPapers);

  for (const result of results) {
    if (result.action === "created") {
      ctx.logger.info(`Created enhancement: ${result.issueRef}`);
    } else {
      ctx.logger.debug(`Skipped: ${result.signal.title} — ${result.evaluation.reasoning}`);
    }
  }
}
```

### 5. Issue Creation

```bash
issue open "Enhancement: <title>" \
  --project <target-name> \
  --type enhancement \
  --severity P2 \
  --reporter ai-feeds-pipeline \
  --tags "auto-generated,<category>,<interest>" \
  --body "## Signal
Source: <source>
Score: <score>/10
URL: <url>

## Relevance
<reasoning>

## Evidence
- Code search: <matches>
- Git history: <commits>
- Issue search: <matches>

## Recommendation
<recommendation>"
```

### 6. Deduplication Layers

1. **URL match** — same paper already has issue
2. **FTS5 search** — same topic tracked in issue-cli
3. **Code adoption** — grep target repo for keywords
4. **Git history** — check recent commits
5. **LLM evaluation** — semantic similarity check

### 7. Feedback Loop

Track outcomes:
- Which recommendations were adopted?
- Which were skipped?
- What was the actual impact?

Use this data to:
- Improve LLM prompts
- Adjust score thresholds
- Update project context

## Implementation

### Phase 1: Config & Structure
- Add `enhancement_targets` to config.yaml
- Create `processors/adoption-evaluator.ts`
- Define types and interfaces

### Phase 2: Local Evidence Collection
- Implement keyword extraction
- Implement grep adoption check
- Implement git history check
- Implement issue-cli FTS5 search

### Phase 3: Nexus Integration
- Add project context to nexus
- Call nexus API for evaluation
- Parse structured response

### Phase 4: Issue Creation
- Integrate with issue-cli
- Create issues with proper metadata
- Track created issues for dedup

### Phase 5: Pipeline Integration
- Add to daily pipeline
- Add CLI flags for control
- Add logging and metrics

## Verification

1. Configure dev-kit as enhancement target
2. Run pipeline with scored papers
3. Verify adoption check works
4. Verify issue creation works
5. Verify dedup prevents duplicates

## Dependencies

- issue-cli (existing)
- nexus API (SPEC-ADOPTION)
- ai-feeds pipeline (existing)
