# Consolidated Agent Rules

Core safety rules loaded into every agent session. Domain-specific knowledge is available on-demand via skills.

---

## Tool Execution Safety

> [!error] **Never let child processes inherit stdin.** Append `< /dev/null` to every shell command. Example: `npm test < /dev/null`, not `npm test`.

> [!error] **Background server isolation.** Use: `cmd > /tmp/log 2>&1 < /dev/null &`

> [!error] **Never change vitest `pool: 'threads'` to `pool: 'forks'`.** Orphans at ~2GB each = OOM.

> [!error] **Never run raw `tsc --noEmit`.** Use `npm run typecheck` (routes through `--max-old-space-size=4096 --incremental`).

---

## Verification Discipline

> [!error] **Verify before verdict.** After any fix, run concrete verification and observe actual result. Banned phrases without evidence: "should work now", "fixed", "done".

> [!error] **Auto-verify, don't ask.** Run verification yourself immediately. Don't suggest commands for the user.

> [!error] **Confirm hypothesis before implementing.** Add temporary diagnostic at suspected root cause, run reproduction. If diagnostic doesn't confirm, form new hypothesis.

> [!error] **Non-destructive verification only.** Never inject text into live panes, send messages to real roles, write to active DBs.

> [!error] **Fail visibly, not silently.** Surface every: skipped record, rolled-back transaction, constraint violation. "14/15 succeeded, 1 skipped: [reason]" — not "done".

---

## Anti-Destruction

> [!error] **Never discard uncommitted work from other agents.** When `git status` shows files you didn't create, NEVER run `git checkout --`, `git clean`, or `rm` without user confirmation.

> [!error] **Scope: solve what was asked, no bonus features.** Only modify files explicitly in scope. Don't refactor adjacent code, add unrequested error handling, or "improve" naming.

> [!error] **Convention beats novelty.** Match existing patterns. A second pattern is worse than either alone.

> [!error] **Surface conflicts, don't average them.** When codebase has conflicting patterns, flag it — don't combine both.

---

## Anti-Hallucination

> [!error] **You start every session with zero project knowledge.** Before acting: read project context files, read the specific files you plan to modify.

> [!error] **You will confidently generate wrong code.** Read the actual file before calling or modifying it, run code after writing it, check actual docs for external APIs.

> [!error] **Read project context files on startup.** Check workdir for: `STATUS.md`, `NEXT-SESSION.md`, `README.md`, `DECISIONS.md`, `CONTEXT.md`. Read any that exist.

---

## Context Discipline

> [!error] **Treat your context window like RAM, not a log file.** Don't dump entire files when you need 10 lines. Don't keep failed approaches — summarize lesson and move on.

> [!error] **Your failed attempts leave debris.** After failures: (1) check state, (2) clean up, (3) retry. Prefer idempotent operations.

---

## Spawn Compliance

> [!error] **Obey explicit spawn requests.** When user asks to spawn/delegate to specific agent, dispatch immediately. Don't do the work yourself.

---

## File Navigation

> [!error] **Never search from `/` or `~` without scoping.** Identify correct subdirectory first. Searching from `/` is banned. Searching from `~` requires `-maxdepth 3` minimum.

---

## Compaction Strategy

> [!info] **Compact between unrelated tasks.** Use `/compact` or summarize findings before starting new work. Keep context clean.

> [!info] **Use subagents for investigation.** Spawn separate agents for research — they have isolated context.

> [!info] **Monitor context budget.** If context feels heavy, summarize current state and start fresh.

---

## Domain-Specific Knowledge

For TypeScript patterns, testing patterns, and other domain knowledge, see:
- `.claude/skills/` — on-demand skill definitions
- `workflow/` — methodology (SDD, pipeline)
