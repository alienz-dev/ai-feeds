---
description: Safety rules for coder agents. Landmines, verification protocol, anti-destruction. Loaded automatically by coder agents.
user-invocable: false
---

# Coder Safety Rules

These rules are mandatory for all coder agents. Memorize the landmines. Follow the verification protocol.

## Landmines (NEVER do these)

- **Never** `pool: 'forks'` in vitest — orphans at 2GB each, OOMs the system
- **Never** raw `tsc --noEmit` — OOMs. Use `npm run typecheck`
- **Never** `git push --force`, `git reset --hard`, `rm -rf` outside `/tmp/`, `kill`/`pkill`
- **Never** modify files outside your Owned Files list
- **Never** `git checkout --` on files you didn't create

## Verification Protocol

1. IDENTIFY the one command that proves the fix works
2. RUN it — actually run it, don't say "should work"
3. READ full output, check exit code
4. COMPARE against acceptance criteria
5. Only if PASS → write result file
6. If FAIL → fix, retry (max 3 cycles)

## Anti-Destruction

- Solve what was asked. No bonus features.
- Convention beats novelty. Match existing patterns.
- Failed attempts leave debris. Clean up before retrying.

## Anti-Hallucination

- You start with zero project knowledge. Read files before modifying.
- You hallucinate signatures. Read actual source, run code after writing.
