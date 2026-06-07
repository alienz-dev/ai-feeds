---
name: wave-execution
description: Wave-based execution protocol with retros between waves. Replaces "all at once" dispatch with structured batching.
---

# Wave Execution Protocol

## Why

Dispatching all agents at once (one giant wave) causes:
- Dependency violations (agent B needs agent A's output but runs in parallel)
- No learning between batches (mistakes in wave 1 repeat in wave 2)
- Reviewer overwhelmed (5 implementations to verify at once)
- No course correction (can't adjust wave 2 based on wave 1 results)

## Wave Rules

### Rule 1: Group by Dependency
Analyze the dependency graph between specs/tasks. Group into waves where:
- All tasks in a wave are **independent** (no task needs another's output)
- All tasks in wave N+1 **depend on** at least one task in wave N

```
Wave 1: [SPEC-001, SPEC-005]  — independent, low-risk docs/config
Wave 2: [SPEC-003]             — depends on SPEC-001's transitions.json
Wave 3: [SPEC-002, SPEC-004]  — independent tools
```

### Rule 2: Retro Between Waves
After each wave completes and is verified, run a mini-retro (2 minutes):

```markdown
## Wave N Retro
- What worked: <list>
- What broke: <list>
- Alignment issues found: <list of misalignment types from alignment gate>
- Patch waves needed: <count>
- What to change in next wave: <list>
- Go/No-Go for next wave: <decision>
```

**Go/No-Go criteria:**
- All wave N specs verified? → Go
- Any spec failed verification? → Fix before wave N+1
- New dependency discovered? → Re-plan wave N+1
- Approach fundamentally wrong? → Stop, re-plan

### Rule 3: Max 3-4 Agents Per Wave
Keep waves small. Research shows:
- 2-4 agents per wave is optimal for reliability (Google DeepMind: 17.2x error amplification in unstructured networks)
- More than 4 overwhelms the reviewer and makes dependency tracking harder
- Exception: truly independent trivial tasks (docs, config) can go up to 5-6 with exclusive file ownership
- Never exceed 6 without exclusive resource partitioning (vault race condition taxonomy)

### Rule 4: Verify Before Advancing
Before starting wave N+1:
1. Run all verification commands from wave N specs
2. Run the reviewer (adversarial) on wave N results
3. Fix any failures
4. Only then dispatch wave N+1

### Rule 5: Overlap Planning N+1 During Execution of N
AAMAS 2026 finding: 79% efficiency loss from serial planning. While wave N executes:
- Start writing wave N+1 briefings to `/tmp/ctx-<topic>-waveN+1-<agent>.md`
- Use a shared scratchpad (`/tmp/ctx-<topic>-scratchpad.md`) for cross-wave context
- Finalize wave N+1 briefings after wave N results are in

### Rule 6: Gate.sh Tracks Waves
Use gate.sh to track pipeline state across waves:
```bash
gate.sh init <feature>
# Wave 1
gate.sh advance plan_ready   # plan → test
# ... wave 1 work ...
gate.sh advance tests_ready  # test → sprint
# ... wave 1 verify ...
# Retro
# Wave 2
# ... wave 2 work ...
gate.sh advance sprint_complete  # sprint → review
# ... final review ...
gate.sh advance review_complete  # review → done
```

## Wave Planning Template

```markdown
## Wave Plan: <feature>

### Dependency Graph
- SPEC-A: independent
- SPEC-B: depends on SPEC-A (needs transitions.json)
- SPEC-C: independent
- SPEC-D: depends on SPEC-C (needs spec-trace.sh)

### Wave 1: [SPEC-A, SPEC-C]
- Risk: low (docs/config)
- Agents: 2 parallel
- Verification: syntax checks, grep for conflicts

### Wave 2: [SPEC-B, SPEC-D]
- Risk: medium (tooling)
- Agents: 2 parallel
- Depends on: Wave 1 outputs verified
- Verification: functional tests, edge cases

### Retro Schedule
- After Wave 1: check dependencies, adjust Wave 2 if needed
- After Wave 2: final verify, capture lessons
```

## Anti-Patterns

- ❌ **All-at-once dispatch** — no learning, no course correction
- ❌ **Skip retro** — mistakes repeat across waves
- ❌ **Waves too large** — reviewer overwhelmed, harder to track
- ❌ **No dependency analysis** — parallel tasks that depend on each other
- ❌ **No gate.sh tracking** — can't see where we are in the pipeline

## Workflow Automation

The `wave-dispatch` workflow automates this entire protocol:

- **Rule 1 (Group by Dependency)**: The workflow receives wave definitions as input, grouped by dependency
- **Rule 2 (Retro Between Waves)**: The workflow runs a mini-retro agent after each wave with Go/No-Go
- **Rule 3 (Max 3-4 Agents)**: The workflow enforces `maxCoders` per wave via `parallel()` with worktree isolation
- **Rule 4 (Verify Before Advancing)**: The workflow runs GREEN gate before proceeding to next wave
- **Rule 5 (Overlap Planning)**: Not implemented in workflow (sequential wave iteration)
- **Rule 6 (Gate.sh Tracks Waves)**: The workflow calls gate.sh internally for state transitions

Trigger: `/sdd <feature>` or `ultracode: implement <spec>`
