# Plan: LLM Relevance Scorer (SPEC-SCORER)

**Spec:** specs/SPEC-SCORER.md
**Status:** approved
**Created:** 2026-06-07

---

## Dependency Graph

```
common.ts (Paper type)  ← exists
         │
    ┌────┴────┐
    ▼         ▼
scorer-prompt.ts    llm-client.ts (provider functions)
    │                    │
    └────────┬───────────┘
             ▼
        scorer.ts (orchestration + CLI)
             │
             ▼
    tests/scorer.test.ts
```

---

## Wave 1: All implementation (single coder)

All files are tightly coupled. Single wave, single coder.

**Files to create:**
- `processor/scorer-prompt.ts` — prompt construction with template
- `processor/llm-client.ts` — multi-provider LLM client (Claude, OpenAI, Ollama)
- `processor/scorer.ts` — orchestration, batching, config, CLI
- `processor/output/` — output directory

**Verification:**
- `npx tsc --noEmit` passes
- `npx vitest run tests/scorer.test.ts` — all pass
- `npx tsx processor/scorer.ts --help` prints usage
- `npx tsx processor/scorer.ts --input collectors/output/ --dry-run` (requires API key)
