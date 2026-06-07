# Agent Roles

## Claude Code Agent Mapping

| dev-kit Role | Claude Code Agent | Location | Type |
|-------------|------------------|----------|------|
| Supervisor/Planner | Main Claude Code session | (interactive) | Main session |
| Sprint-Manager | Main session running `/trio` skill | (interactive) | Main session |
| Researcher | `/researcher` skill (main session) | (skill) | Main session skill |
| Coder | `.claude/agents/coder.md` | `Agent(subagent_type="coder")` | Subagent |
| Test-Manager | `.claude/agents/test-manager.md` | `Agent(subagent_type="test-manager")` | Subagent |
| Tester | `.claude/agents/tester.md` | `Agent(subagent_type="tester")` | Subagent |
| Reviewer-Lite | `.claude/agents/reviewer-lite.md` | `Agent(subagent_type="reviewer-lite")` | Subagent |
| Reviewer | `.claude/agents/reviewer.md` | `Agent(subagent_type="reviewer")` | Subagent |
| BA | `.claude/agents/ba.md` | `Agent(subagent_type="ba")` | Subagent |
| Architect | `.claude/agents/architect.md` | `Agent(subagent_type="architect")` | Subagent |
| Explorer | `.claude/agents/explorer.md` | `Agent(subagent_type="explorer")` | Subagent |
| Research-Critic | `.claude/agents/research-critic.md` | `Agent(subagent_type="research-critic")` | Subagent |
| UI-Designer | `.claude/agents/ui-designer.md` | `Agent(subagent_type="ui-designer")` | Subagent |
| Data-Analyst | `.claude/agents/data-analyst.md` | `Agent(subagent_type="data-analyst")` | Subagent |

Claude Code spawns in-process subagents via the `Agent()` tool. No daemon or multiplexer needed.

**Key constraint:** Subagents cannot spawn subagents. Only the main session can spawn. Roles that need to spawn (Researcher, Sprint-Manager) must run in the main session as skills, not as subagents.

## Role Architecture

```
User
  └── Main Session (persistent)
        ├── [Planner mode] — spec writing, grill, plan derivation
        │     ├── BA (subagent — requirements gathering, complexity 6+)
        │     ├── Architect (subagent — system design, complexity 8+)
        │     ├── UI-Designer (subagent — visual design loop, opus)
        │     └── Data-Analyst (subagent — iterative data analysis, sonnet)
        │
        ├── [Sprint-Manager mode] — /trio skill orchestrates:
        │     ├── Test-Manager (subagent — owns RED gate)
        │     ├── Tester (subagent — helper for test-manager)
        │     ├── Coder ×N (subagent, worktree-isolated — max 3 parallel per wave)
        │     ├── Reviewer-Lite (subagent — Tier 2, complexity 4-7)
        │     └── Reviewer (subagent — Tier 3, complexity 8+)
        │
        └── [Researcher mode] — /researcher skill orchestrates:
              ├── Explorer ×N (subagent — focused investigation, parallel)
              └── Research-Critic (subagent — adversarial review, after all explorers)
```

**Key constraint:** Subagents cannot spawn subagents. Only the main session can spawn. Roles that orchestrate spawning (Sprint-Manager, Researcher) run as skills in the main session, not as subagents.

## How Skills Work

A skill is a **prompt template** that gets injected into the main session's context when invoked. The main session reads the SKILL.md and follows its instructions literally.

```
User types: /sdd dark-mode
  ↓
Claude Code loads: phases/implement/skills/sdd/SKILL.md
  ↓
The SKILL.md content becomes the main session's instructions
  ↓
Main session follows the protocol step by step
```

The main session doesn't "switch roles" — it follows different skill protocols at different stages. Each skill tells the main session what sequence of Agent() calls to make.

## How Workflows Work

Dynamic workflows are JavaScript scripts that orchestrate many subagents at scale.
Unlike skills (prompt templates the LLM follows), workflows are deterministic scripts
the runtime executes.

| Dimension | Skills | Workflows |
|-----------|--------|-----------|
| What it is | Instructions Claude follows | A script the runtime executes |
| Who decides next | Claude, turn by turn | The script |
| Where results live | Claude's context window | Script variables |
| Scale | A few per turn | Dozens to hundreds per run |
| Resumable | No | Yes (within session) |

**Key constraint**: Workflow agents inherit your tool allowlist and run in `acceptEdits`
mode. They can call gate.sh, read/write files, and run commands — but the script itself
has no direct filesystem access.

**Integration**: The SDD pipeline uses workflows for automated phases (test gen, coder
dispatch, review, retro) and skills for interactive phases (grill, approval).
See `.claude/workflows/` for available workflow scripts.

### Main Session vs Subagent

| Capability | Main Session | Subagent |
|-----------|--------------|----------|
| Call Agent() to spawn | ✅ Yes | ❌ No (hard constraint) |
| Call Bash/Read/Write/Edit | ✅ Yes | ✅ Yes |
| Persist across turns | ✅ Yes | ❌ Returns and dies |
| Follow skill protocol | ✅ Yes | ❌ Follows agent .md |
| Interactive with user | ✅ Yes | ❌ No (returns text) |

### Agent Return Values

Subagents return structured data. Main session reads `content[0].text`:
```typescript
{
  content: [{ type: "text", text: "agent's final output" }],
  totalToolUseCount: 12,
  totalDurationMs: 45000,
}
```

### No Persistent State Between Skills

Each skill invocation starts fresh. Context persists via:
- Conversation history (all previous turns)
- Files on disk (specs/, plans/, .pipeline/)
- STATUS.md, CONTEXT.md (project state)

---

## Main Session Mode Switching

The main session is ONE persistent Claude Code conversation. It follows two distinct phases:

### Phase 1: Design (Interactive — user makes decisions)
```
User: "add dark mode"
  ↓
Main session:
  1. Reads STATUS.md, CONTEXT.md
  2. Estimates complexity (6+)
  3. Spawns BA subagent → writes requirements to specs/<id>-requirements.md
  4. Writes spec draft
  5. Runs /grill (interactive Q&A with user)
  6. Runs /ba-validate on spec
  7. User approves spec (status: approved)
```

### Phase 2: Implementation (Automatic — no human intervention)
```
User: "/sdd dark-mode"
  ↓
Main session:
  1. Reads approved spec
  2. Derives plan → writes plans/<id>-plan.md
  3. Spawns Test-Manager → writes tests + .pipeline/test_map.json
  4. Verifies RED (all tests fail)
  5. Runs /trio → coder waves → gates → reviewer
  6. Pipeline reaches "done"
  7. Reports completion to user
```

### Phase 3: Review (Human — user evaluates results)
```
User: plays with feature, files issues if needed
  ↓
If issues found → file issues → run /sdd again (Phase 2)
If design change needed → new design session (Phase 1)
If satisfied → ship
```

### Why Two Phases?

Design decisions need human judgment. Implementation doesn't. Separating them means:
- User focuses on **what** to build (design phase)
- Agent focuses on **how** to build it (implementation phase)
- User evaluates the result (review phase)
- No back-and-forth during implementation — it runs to completion

## Dispatch Rules

| From | To | Policy |
|------|-----|--------|
| Main Session (Planner) | BA | CONDITIONAL (complexity 6+ features) |
| Main Session (Planner) | Architect | CONDITIONAL (complexity 8+ features) |
| Main Session (Planner) | UI-Designer | CONDITIONAL (UI/visual features) |
| Main Session (Planner) | Data-Analyst | CONDITIONAL (data analysis tasks) |
| Main Session (Planner) | Test-Manager | ALWAYS (for RED gate) |
| Main Session (Planner) | Coder | **NEVER** (Planner never spawns coders directly) |
| Main Session (Sprint-Manager via /trio) | Coder | **ALWAYS** (max 3 parallel, no file overlap) |
| Main Session (Sprint-Manager via /trio) | Tester | CONDITIONAL (test-manager needs help) |
| Main Session (Sprint-Manager via /trio) | Reviewer-Lite | ALWAYS (Tier 2, complexity 4-7) |
| Main Session (Sprint-Manager via /trio) | Reviewer | ALWAYS (Tier 3, complexity 8+) |
| Main Session (Researcher via /researcher) | Explorer | ALWAYS (parallel, one per research angle) |
| Main Session (Researcher via /researcher) | Research-Critic | ALWAYS (after all explorers complete) |
| Test-Manager | Coder | NEVER |
| BA | Anything | NEVER (leaf agent) |
| Architect | Anything | NEVER (leaf agent) |
| UI-Designer | Anything | NEVER (leaf agent) |
| Data-Analyst | Anything | NEVER (leaf agent) |
| Tester | Anything | NEVER (leaf agent) |

---

## Role Definitions

Every role has a **contract** defining its boundaries:

| Field | Meaning |
|-------|---------|
| **Trigger** | When is this role invoked? |
| **Input** | What does it receive from the caller? |
| **Output** | What does it produce? |
| **Output Path** | Where is the output written? |
| **Handoff** | How does the caller get the output? |
| **Boundaries** | What can/can't it touch? |

---

### Supervisor / Planner

**Purpose:** Orchestrate, diagnose, delegate. Never implement.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | User request or session start |
| Input | User intent, issue reference |
| Output | Spec, plan, orchestration decisions |
| Output Path | `specs/SPEC-<ID>.md`, `plans/<ID>-plan.md` |
| Handoff | Writes files directly (main session has write access) |
| Boundaries | Cannot write src/, tests/ |

**Can:**
- Read all project files
- Write: STATUS.md, NEXT-SESSION.md, issues/, plans/, specs/, /tmp/
- Run tests, typecheck, diagnostics
- Spawn: ba, architect, test-manager, explorer, research-critic

**Cannot:**
- Write src/, tests/, *.ts, *.tsx, *.js, *.py
- Modify package.json, tsconfig.json, vitest.config.*
- Spawn coders directly (only /trio skill can spawn coders)

**Mode switching:** The main session switches modes by invoking skills:
- `/grill` → design interview mode
- `/ba-validate` → spec validation mode
- `/trio` → Sprint-Manager mode (coder dispatch)
- `/researcher` → Research mode (explorer dispatch)
- `/sdd` → Full pipeline orchestration (ENH-0012)

**Behavior:**
1. On session start: read state files, present status, ask for direction
2. On task: write spec → spawn test-manager → spawn sprint-manager → monitor gates
3. On completion: update STATUS.md, NEXT-SESSION.md

---

### BA (Business Analyst)

**Purpose:** Gather requirements, validate completeness, produce EARS-ready acceptance criteria.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | Complexity 6+ features, before grill session |
| Input | User intent or issue reference (via prompt) |
| Output | Requirements document with EARS criteria |
| Output Path | Returns text to caller. **Main session writes** to `specs/<id>-requirements.md` |
| Handoff | Agent() return value — main session reads `content[0].text` |
| Boundaries | Cannot write specs, code, or spawn subagents |

**Can:**
- Read all project files
- Write: /tmp/ only (returns text, doesn't write to specs/)
- Run: codebase search (Grep, Glob, Read)

**Cannot:**
- Write specs/ (main session does this)
- Write code (Coder's job)
- Make design decisions (Architect's job)
- Spawn subagents (leaf agent)

**Workflow:**
1. Read issue/intent from prompt
2. Explore codebase for related functionality
3. Run structured requirements elicitation
4. Return requirements document as text (main session writes to file)

---

### Architect

**Purpose:** System design and component boundaries. Produces architecture decisions, interface contracts, and ADRs.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | Complexity 8+ features, new data models, API contracts |
| Input | Approved spec path (via prompt) |
| Output | Architecture document with component decomposition, ADRs |
| Output Path | Returns text to caller. **Main session writes** to `specs/<id>-architecture.md` |
| Handoff | Agent() return value — main session reads `content[0].text` |
| Boundaries | Cannot write specs, code, or spawn subagents |

**Can:**
- Read all project files
- Write: /tmp/ only (returns text, doesn't write to specs/)

**Cannot:**
- Write specs/ (main session does this)
- Write code (Coder's job)
- Spawn subagents (leaf agent)

**Workflow:**
1. Read approved spec from prompt path
2. Analyze existing codebase architecture
3. Return architecture document as text (main session writes to file)

---

### Test-Manager

**Purpose:** Own the RED gate — write tests, verify they fail.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | After spec approved, before implementation |
| Input | Spec path (via prompt) |
| Output | Test files (visible + hidden), test_map.json |
| Output Path | `tests/unit/*.test.ts`, `tests/hidden/*.test.ts`, `.pipeline/test_map.json` |
| Handoff | Writes files directly (has write access to tests/). Main session reads test_map.json |
| Boundaries | Cannot write src/ or spawn coders |

**Can:**
- Read all project files including specs
- Write: tests/, `.pipeline/test_map.json`, /tmp/
- Run tests

**Cannot:**
- Write src/ (implementation code)
- Spawn coders (main session's job via /trio)

**Behavior:**
1. Receive spec path from prompt
2. Write test files (visible 60% + hidden 40%)
3. Verify RED (all tests fail for the right reasons)
4. Write `.pipeline/test_map.json` with test file paths
5. Return summary to caller (main session)

**test_map.json format:**
```json
{
  "spec": "specs/SPEC-FOO.md",
  "visible": ["tests/unit/foo.test.ts"],
  "hidden": ["tests/hidden/foo-regression.test.ts"],
  "all_red": true
}
```

---

### Sprint-Manager (Main Session — /trio skill)

> **Workflow automation**: The sprint stage is now automated via the `wave-dispatch`
> workflow. The Sprint-Manager skill delegates to this workflow for parallel coder
> dispatch, GREEN gate, post-wave gates, and alignment checks.

**Purpose:** Receive plan + failing tests. Dispatch coders in waves. Own all gates from GREEN through REVIEW.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | Main session invokes `/trio <feature>` after test-manager completes |
| Input | `.pipeline/test_map.json` (test file paths), spec path |
| Output | Implemented code (via coder agents), review verdict |
| Output Path | Coders write to src/ in worktrees. Reviewer returns text. |
| Handoff | Coders return text (status + files changed). Reviewer returns verdict text. |
| Boundaries | Cannot write src/, tests/, specs/ directly. Only spawns coders. |

**Type:** Main session skill (not a subagent). Runs as the `/trio` skill in the main Claude Code session.

**Can:**
- Read: specs, tests, source, project config
- Write: `/tmp/`, `.pipeline/`
- Spawn: coder (max 3 parallel, no file overlap), reviewer-lite, reviewer

**Cannot:**
- Write: src/, tests/, specs/ (coders do this)

**Owns gates:**
- GREEN gate (all visible tests pass)
- Wiring gate (`entry-reachability.sh`)
- Visual QA gate (`visual-gate.sh --gate` — 3-layer: static + Playwright regression + axe-core a11y)
- Hidden gate (hidden regression tests)
- Activation gate (`activation-gate.sh`)

**Behavior:**
1. Receive plan + test_map from supervisor
2. Create worktrees for parallel coders: `git worktree add .worktrees/coder-<id> -b coder-<id>`
3. Dispatch coders in waves (max 3 parallel, worktree-isolated)
4. After each wave: run gate sequence (trio-preflight → GREEN → wiring → visual → wave-smoke)
5. After all waves: hidden → activation → spawn reviewer (tier 2 or 3)
6. Merge worktrees sequentially: rebase onto main, fast-forward merge
7. Clean up worktrees: `git worktree remove .worktrees/coder-<id>`
8. Report result to supervisor

**Retry logic:**
- GREEN fail: max 3 retries (re-dispatch coder with failure context)
- Visual fail: max 2 retries (re-dispatch coder with visual findings)
- Hidden fail: promote hidden test to visible, re-dispatch

---

### UI-Designer

**Purpose:** Design system specialist. Multi-phase autonomous visual feedback loop.

**Model:** opus

**Can:**
- Write: DESIGN.md, .interface-design/, /tmp/

**Cannot:**
- Write: src/, tests/

**Phases:** audit → explore → critique → decide → specify → verify

**Tools:**
- `design-sandbox.sh` — Playwright screenshot capture
- `design-grade.sh` — LLM-based scoring
- `design-iterate.sh` — Autonomous generate→screenshot→grade loop

**Scoring:** total = DQ×0.4 + O×0.4 + C×0.15 + F×0.05
- Accept: total ≥ 8.0 AND originality ≥ 9
- Pass gate: total ≥ 7.0, originality ≥ 7, token_fidelity ≥ 8

**Two registers:**
- Brand surface (explainer DESIGN.md)
- Product/dashboard

---

### Coder

**Purpose:** Make failing tests pass. Nothing more.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | /trio dispatches coder per wave |
| Input | Briefing with failing test paths, file boundaries, verification commands |
| Output | Implementation code in src/ |
| Output Path | Writes directly to src/ in worktree |
| Handoff | Returns text summary (status, files changed, test results) |
| Boundaries | Cannot read specs/, cannot write STATUS.md, issues/ |

**Can:**
- Read: test files, existing source, project config
- Write: src/, tests/ (only to fix test setup issues), /tmp/

**Cannot:**
- Read: specs/ (enforced by briefing — spec paths excluded)
- Write: .agents/knowledge/, STATUS.md, issues/

**Behavior:**
1. Receive briefing from /trio: "Make these tests pass: [paths]"
2. Read the failing tests to understand expected behavior
3. Implement minimal code to pass
4. Run tests to verify
5. Return result summary to caller

**Worktree isolation:**
- Each coder gets an isolated git worktree (`.worktrees/coder-<id>`)
- Coders work in parallel without merge conflicts
- After all coders complete, worktrees are merged by /trio

**Key constraint:** Coder briefing contains test file paths and project context, but NEVER the spec. This forces implementation driven by test assertions, not spec prose.

---

### Explorer

**Purpose:** Focused research sub-agent spawned by researcher orchestrator. Investigates a single angle.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | /researcher skill spawns explorers in parallel |
| Input | Focused research question (via prompt) |
| Output | Research findings for one angle |
| Output Path | Returns text to caller (/researcher reads findings) |
| Handoff | Agent() return value — /researcher reads `content[0].text` |
| Boundaries | Cannot write src/, tests/, specs/, plans/ |

**Model:** haiku (fast, focused, ephemeral)

**Can:**
- Read: everything
- Write: /tmp/ only
- Web search, web fetch

**Cannot:**
- Write: src/, tests/, specs/, plans/

**Behavior:**
1. Receive focused research question from researcher
2. Investigate single angle thoroughly
3. Write findings to specified output file
4. Self-close (ephemeral)

---

### Research-Critic

**Purpose:** Adversarial critic with fresh context. Reviews synthesis, finds gaps, challenges assumptions.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | /researcher spawns after all explorers complete |
| Input | Synthesized findings from explorers (via prompt) |
| Output | Critique with gaps, contradictions, evidence issues |
| Output Path | Returns text to caller (/researcher reads critique) |
| Handoff | Agent() return value — /researcher reads `content[0].text` |
| Boundaries | Cannot write src/, tests/, specs/, plans/ |

**Model:** sonnet

**Can:**
- Read: everything (including explorer outputs via prompt)
- Write: /tmp/ only

**Cannot:**
- Write: src/, tests/, specs/, plans/

**Behavior:**
1. Spawned AFTER all explorers complete
2. Receives synthesized findings (fresh context — no explorer bias)
3. Challenges assumptions, finds gaps, identifies contradictions
4. Writes critique to specified output file
5. Self-close (ephemeral)

---

### Reviewer-Lite

**Purpose:** Fast headless reviewer for Tier 2 complexity (4-7).

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | /trio after all coder waves pass GREEN gate |
| Input | Spec path, modified file list (via prompt) |
| Output | Review report with verdict |
| Output Path | Returns text to caller (/trio reads verdict) |
| Handoff | Agent() return value — /trio reads `content[0].text` for APPROVE/REJECT |
| Boundaries | Cannot write src/, tests/, issues/ |

**Model:** sonnet (fast, focused review)

**Can:**
- Read: everything (spec, source, tests, issues)
- Write: /tmp/ (review reports only)

**Cannot:**
- Write: src/, tests/, issues/, STATUS.md

**Pipeline:** precheck (`review-precheck.sh --diff HEAD`) → 3-section LLM review (Bug Hunter + Security + Design & Quality) → report

**Verdict rules:**
- 🔴 any = REQUEST_CHANGES
- 🟠 + 🟡 = APPROVE_WITH_COMMENTS
- 🟡 only = APPROVE

**Timeout:** 540s (non-blocking — review is advisory, never blocks pipeline)

---

### Reviewer (Full)

**Purpose:** Comprehensive code review for Tier 3 complexity (8+).

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | /trio after all coder waves pass GREEN gate (Tier 3 auto-promote) |
| Input | Spec path, modified file list (via prompt) |
| Output | Review report with verdict |
| Output Path | Returns text to caller (/trio reads verdict) |
| Handoff | Agent() return value — /trio reads `content[0].text` for APPROVE/REJECT |
| Boundaries | Cannot write src/, tests/, issues/ |

**Can:**
- Read: everything (spec, source, tests, issues)
- Write: /tmp/ (review reports only)

**Cannot:**
- Write: src/, tests/, issues/, STATUS.md

**Pipeline:** precheck → 11-section LLM review → signal filtering → feedback capture

**Timeout:** 900s (non-blocking)

**Auto-promote to Tier 3:** paths matching `/auth/`, `/security/`, `/crypto/`, `/api/`, `/schema/`, `/migration`

---

### Data-Analyst

**Purpose:** Autonomous iterative data analysis. Wraps an external analysis script (configurable via env var).

**Model:** sonnet

**Can:**
- Write: /tmp/, output files (specified in task)

**Cannot:**
- Write: src/

**Architecture:** Iterative plan→code→verify loop with sandboxed execution (2GB mem, 120s timeout, blocked patterns). PCS sanity checks. Backtracking (max 3).

**Cost:** ~$0.20-0.50 per analysis

---

### Researcher (Main Session — /researcher skill)

**Purpose:** Deep investigation with structured multi-agent output.

**Contract:**
| Field | Value |
|-------|-------|
| Trigger | User or planner invokes `/researcher <question>` |
| Input | Research question (from user or planner) |
| Output | Research verdict with findings and recommendations |
| Output Path | `plans/research-<topic>-verdict.md` |
| Handoff | Main session writes verdict file, returns path |
| Boundaries | Cannot write src/, tests/, specs/ |

**Type:** Main session skill (not a subagent). Runs as the `/researcher` skill because it needs to spawn explorers and research-critic, and only the main session can spawn subagents.

**Model:** opus (via Agent() model override when spawning explorers)

**Can:**
- Read: everything
- Write: plans/, /tmp/
- Web search, web fetch
- Spawn: explorer (×N parallel), research-critic

**Cannot:**
- Write: src/, tests/, specs/

**Behavior:**
1. Receive research question from user or planner
2. Spawn 2-4 explorer agents in parallel (each investigates one angle)
3. Wait for all explorers to complete (reads return values)
4. Synthesize findings into unified analysis
5. Spawn research-critic (fresh context, adversarial)
6. Incorporate critique, produce final verdict
7. Write to `plans/research-<topic>-verdict.md`

---

### Tester

**Purpose:** Write additional tests when test-manager needs help.

**Can:**
- Read: specs, existing tests, source code
- Write: tests/, /tmp/

**Cannot:**
- Write: src/

---

## Agent JSON Template

```json
{
  "name": "<role>",
  "description": "<Role> for <project>",
  "model": "claude-sonnet-4-20250514",
  "prompt": "<role-specific system prompt>",
  "tools": ["read", "write", "grep", "shell", "glob"],
  "resources": ["<context files loaded at start>"]
}
```

## Spawning Pattern

```
# Dispatch
Agent({ prompt: "Make these tests pass: tests/unit/pagination.test.ts", subagent_type: "general-purpose" })
Agent({ prompt: "Own RED gate for PROJ-042", subagent_type: "general-purpose" })
Agent({ prompt: "Review PR #42", subagent_type: "general-purpose" })

# Background dispatch (completion tracking)
Agent({ prompt: "task", run_in_background: true })
```

---

## Resource Loading

Each role loads a minimal set of context files at startup. See `../rules/RESOURCE-SETS.md` for the full allocation table.

**Key rule:** Every agent gets the governance layer (client_rules + amazonq + user-profile + hot-memory). Role-specific resources are added on top — only what that role actually uses.

**Context budget target:** No agent should consume more than 15% of its context window on preloaded resources. For Claude Opus (200K tokens), that's ~30K tokens (~100KB text).