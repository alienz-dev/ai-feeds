# SPEC-SCORER: LLM Relevance Scorer

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 6 (Medium-Complex)
**Phase:** 2.2 — Processor

---

## 1. Intent

Build an LLM-powered relevance scorer that reads collector output (Paper[]), evaluates each paper against the user's learning interests, and outputs only high-relevance papers (score 7+) with explanations. This is the core value-add of the system — turning 150 raw papers into 20 actionable signals.

**In scope:** Batch scoring with LLM, multi-provider support (Claude/OpenAI/Ollama), threshold filtering, config-driven behavior, CLI.

**Out of scope:** Summarization, learning issue generation, preference learning, full-text analysis, streaming, web UI, non-paper sources.

---

## 2. Actors

| Actor | Role |
|-------|------|
| Pipeline orchestrator | Runs collectors then scorer in sequence |
| Ming (reader) | Consumes scored output to decide what to read |
| LLM provider | Claude, OpenAI, or Ollama that performs scoring |
| Future preference learner | Will consume scorer output (Phase 4.2) — not in scope |

---

## 3. Acceptance Criteria

### Input / Output

**AC-1: Read collector output**
THE scorer SHALL read a JSON file matching `ArxivResult` or `HfResult` structure and extract `papers[]`.

**AC-2: Write scored output**
THE scorer SHALL write JSON to `processor/output/scored-YYYY-MM-DD.json` with structure:
```json
{
  "source": "scorer",
  "scored_at": "ISO-8601",
  "interests_used": ["..."],
  "provider": "claude",
  "model": "claude-sonnet-4-20250514",
  "total_input": 150,
  "total_scored": 150,
  "total_above_threshold": 23,
  "warnings": [],
  "papers": [ScoredPaper...]
}
```

**AC-3: Scored paper extends Paper**
EVERY scored paper SHALL have all Paper fields plus `relevance_score` (int 1-10) and `score_explanation` (string, 1-2 sentences).

### Scoring

**AC-4: Score against configured interests**
THE scorer SHALL evaluate papers against `learning_plan.interests` from config.

**AC-5: Score range**
`relevance_score` SHALL be integer 1-10. 1 = irrelevant, 10 = directly addresses interest with novel contribution.

**AC-6: Explanation requirement**
`score_explanation` SHALL reference at least one interest area and cite what the paper contributes.

**AC-7: Threshold filtering**
Papers with `relevance_score < processor.relevance_threshold` SHALL be excluded. Default threshold: 7.

### Batching

**AC-9: Batch scoring**
Papers SHALL be sent in batches of 10 (configurable via `processor.llm.batch_size`). Each batch = one API call.

**AC-10: Batch prompt format**
Prompt SHALL include: interest areas, scoring rubric (1-10 anchors), numbered papers (title + abstract + primary_category), and instructions to return `[{index, score, explanation}]`.

### Provider Support

**AC-11: Claude provider**
WHEN provider is `"claude"`, call Anthropic Messages API with `ANTHROPIC_API_KEY`.

**AC-12: OpenAI provider**
WHEN provider is `"openai"`, call OpenAI Chat Completions API with `OPENAI_API_KEY`.

**AC-13: Ollama provider**
WHEN provider is `"ollama"`, call `http://localhost:11434/api/chat` with no auth.

**AC-14: Provider switching**
Changing `processor.llm.provider` changes API used. Same prompt, same output format.

### Error Handling

**AC-15: Rate limit backoff**
HTTP 429 → exponential backoff (1s, 2s, 4s), max 3 retries per batch.

**AC-16: Server error retry**
HTTP 5xx → retry up to 3 times with 2s delay.

**AC-17: Batch failure resilience**
Failed batch after retries → skip, log warning, continue. Skipped papers in `warnings[]`.

**AC-18: Partial results preserved**
Some batches fail → still write output with successfully scored papers.

### Configuration

**AC-19: Config loading**
Load from `--config` path, default `config.yaml`.

**AC-20: Missing interests is fatal**
No `learning_plan.interests` → exit 1 with error message.

**AC-21: API key validation**
Check required env var at startup. Missing → exit 1 with instructions.

### CLI

**AC-22: CLI flags**
`--input <path>` (required), `--config <path>`, `--output <path>`, `--dry-run`, `--verbose`, `--help`, `--threshold <n>`.

**AC-23: Atomic write**
Write to `.tmp` then rename. Clean up on failure.

**AC-24: Exit codes**
0 = success, 1 = fatal error, 2 = partial failure (some batches skipped).

### Quality

**AC-25: Conservative scoring**
Prompt instructs: "When in doubt, score lower. 7+ means abstract clearly addresses an interest area."

**AC-26: No hallucinated content**
Prompt instructs: "Do not infer details not in the abstract. Vague abstract → score 3 or below."

**AC-27: Empty abstract handling**
Empty abstract → score 1, explanation "No abstract available for evaluation." Do not send to LLM.

---

## 4. Design Decisions

### DD-1: Raw HTTP instead of SDK

**Decision:** Call provider APIs via native `fetch`, not `@anthropic/sdk` or `openai` package.

**Rationale:** Avoids SDK coupling. All three providers have simple REST APIs. Keeps dependencies minimal.

### DD-2: Batch scoring with structured output

**Decision:** Send 10 papers per API call. Request JSON array response.

**Rationale:** 150 papers ÷ 10 = 15 API calls (vs 150 single-paper calls). 10× cost reduction. Structured output ensures parseable responses.

### DD-3: Cross-source dedup in scorer

**Decision:** Deduplicate by paper `id` before scoring. If IDs differ but titles match exactly, keep first.

**Rationale:** Collectors dedup within their source, but the same paper can appear in both arXiv and HF output.

### DD-4: Threshold as CLI override

**Decision:** `--threshold <n>` CLI flag overrides config.

**Rationale:** Useful for testing (`--threshold 1` to see all scores) without editing config.

---

## 5. Data Model

```typescript
interface ScoredPaper extends Paper {
  relevance_score: number;    // 1-10
  score_explanation: string;  // 1-2 sentences
}

interface ScorerResult {
  source: "scorer";
  scored_at: string;
  interests_used: string[];
  provider: string;
  model: string;
  total_input: number;
  total_scored: number;
  total_above_threshold: number;
  warnings: string[];
  papers: ScoredPaper[];
}

interface ScorerConfig {
  provider: "claude" | "openai" | "ollama";
  model: string;
  batch_size: number;
  threshold: number;
  interests: string[];
}
```

---

## 6. Implementation Notes

### File Structure
```
processor/
  scorer.ts           # Main scorer + CLI
  llm-client.ts       # Multi-provider LLM client (Claude, OpenAI, Ollama)
  scorer-prompt.ts    # Prompt construction
  output/             # Scored output directory
```

### Config (already in config.yaml)
```yaml
processor:
  llm:
    provider: claude
    model: claude-sonnet-4-20250514
    batch_size: 10
  relevance_threshold: 7

learning_plan:
  interests:
    - context engineering
    - agent architectures
    - RAG
    - fine-tuning
    - production AI
    - LLM integration
    - browser automation
```

---

## 7. Verification

```bash
# Dry run with arXiv output
npx tsx processor/scorer.ts --input collectors/output/arxiv-2026-06-07.json --dry-run

# Full run
npx tsx processor/scorer.ts --input collectors/output/arxiv-2026-06-07.json

# Check output
cat processor/output/scored-2026-06-07.json | jq '.total_above_threshold'

# Tests
npx vitest run tests/scorer.test.ts
```

---

## 8. Clarifications (from Grill)

1. **Input mode:** Directory mode — `--input` accepts file or directory. Directory reads all `*.json` files, extracts papers, deduplicates, then scores.
2. **Provider architecture:** Single `llm-client.ts` with internal provider functions (30 lines each). No module system.
3. **Response parsing:** Template-first approach — prompt requests strict JSON template. Try JSON parse (handle ```json``` wrapper), then regex fallback, then skip batch.
4. **Test mocking:** HTTP-level mocking — intercept `fetch()` with canned LLM responses. Tests full pipeline including prompt construction and response parsing.
5. **API keys:** Env vars only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Never in config.yaml. Check at startup, exit with instructions if missing.
6. **CLI overrides:** `--threshold <n>` overrides config threshold.
