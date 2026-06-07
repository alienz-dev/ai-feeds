---
name: coder-safety
description: Safety rules for coder agents. Landmines, verification protocol, anti-destruction, anti-hallucination, forbidden actions.
---

# Coder Safety

## Landmines (memorize these)

- **Never** `pool: 'forks'` in vitest — orphans at 2GB each, OOMs the system. Fix test isolation instead.
- **Never** raw `tsc --noEmit` — OOMs. Use `npm run typecheck` (routes through `--max-old-space-size=4096 --incremental`).
- **Never** `git push --force`, `git reset --hard`, `rm -rf` outside `/tmp/`, `kill`/`pkill`, `DROP`/`DELETE`/`TRUNCATE`.
- **Never** close/kill tabs, panes, sessions. Only `/quit` your own session.
- **Never** modify files outside your Owned Files list.
- **Never** `git checkout --` or `git clean` on files you didn't create — stash first.

## Verification Protocol

1. IDENTIFY the one command that proves the fix works
2. RUN it — not "should work", actually run it
3. READ full output, check exit code
4. COMPARE against acceptance criteria
5. Only if PASS → write result file with `## Verification Output`
6. If FAIL → fix, retry (max 3 cycles)

Banned without evidence: "should work now", "fixed", "done", "implementation complete".

## Anti-Destruction

- **Scope: solve what was asked.** No bonus features, no adjacent refactoring, no "improving" names in files you touch.
- **Convention beats novelty.** Match existing patterns. A second pattern is worse than either alone.
- **Surface conflicts, don't average.** If codebase has conflicting patterns, flag it — don't combine both.
- **Failed attempts leave debris.** Check state after failures, clean up before retrying.

## Anti-Hallucination

- You start with zero project knowledge. Read files before modifying them.
- You hallucinate signatures and APIs. Read actual source, run code after writing.
- Cross-reference specs against source — specs go stale.
- Read project context on startup: STATUS.md, NEXT-SESSION.md, README.md, DECISIONS.md, CONTEXT.md.

## Require Briefing Authorization

- `git push` — briefing must say "push to remote"
- `git commit` — briefing must include commit instructions
- Creating/deleting branches
- Deployment scripts
- Config files outside the repo

## Context Discipline

- Treat context like RAM. Don't dump entire files for 10 lines.
- Use line ranges in reads. Batch independent reads.
- One change → verify → next. Never stack unverified changes.
- Fail visibly: "14/15 succeeded, 1 skipped: [reason]" not "done".

## Tool Selection

- Symbol lookup → `code` tool first, grep fallback
- Text pattern → grep
- File discovery → glob (not find)
- Specific lines → read with line range (not cat)
- File-by-name → `find ~ -name "<pattern>" -maxdepth 4 2>/dev/null | grep -v node_modules`
- Never search from `/` or `~` without scoping to known directories
