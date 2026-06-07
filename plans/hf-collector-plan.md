# Plan: HuggingFace Collector (SPEC-HF)

**Spec:** specs/SPEC-HF.md
**Status:** approved
**Created:** 2026-06-07

---

## Dependency Graph

```
common.ts (Paper already moved)  ← done
         │
    ┌────┴────┐
    ▼         ▼
hf-client.ts  config.yaml update ← done
    │
    ▼
huggingface.ts
    │
    ▼
tests/huggingface.test.ts
```

---

## Wave 1: All implementation (single coder)

All files are tightly coupled. Single wave, single coder.

**Files to create:**
- `collectors/hf-client.ts` — HF API wrapper
- `collectors/huggingface.ts` — collector + CLI

**Files to modify:**
- `config.yaml` — already done

**Verification:**
- `npx tsc --noEmit` passes
- `npx vitest run tests/huggingface.test.ts` — all pass
- `npx tsx collectors/huggingface.ts --help` prints usage
- `npx tsx collectors/huggingface.ts --dry-run` returns data
