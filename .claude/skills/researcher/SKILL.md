---
description: Deep investigation with structured multi-agent output. Spawns parallel explorers, synthesizes, then spawns adversarial critic.
user-invocable: true
argument-hint: <research question>
---

# Researcher: $ARGUMENTS

## Protocol (ARIA v2)

### Step 1: Score Investigation Need

Rate 5 signals (0-2 each):

| Signal | 0 | 1 | 2 |
|--------|---|---|---|
| Approach clarity | Obvious solution | Some ambiguity | Multiple viable approaches |
| Precedent | Done before in codebase | Similar exists | Novel territory |
| Integration surface | 1 file | 2-5 files | 6+ files or cross-system |
| Failure cost | Trivial to revert | Moderate rework | Data loss or security risk |
| Domain uncertainty | Well-understood | Some unknowns | Significant unknowns |

**Routing:**
- 0-3: Skip research. Plan directly. Tell the user why.
- 4-5: Light discovery (single explorer, no critic).
- 6-10: Full ARIA v2 (this protocol).

### Step 2: Decompose into Angles

Break the question into 2-4 independent investigation angles. Each angle should be:
- Focused on one aspect (no overlap)
- Answerable from codebase or web search
- Relevant to the decision at hand

### Step 3: Spawn Explorers

Spawn one Explorer per angle in parallel:

```
Agent(subagent_type="explorer", prompt="<focused question for this angle>")
```

- Model: haiku (fast, cost-efficient)
- Each explorer investigates independently — no cross-pollination
- Each writes findings to its return value

### Step 4: Synthesize Findings

After all explorers complete, read their return values and produce a unified analysis:
- Merge complementary findings
- Flag contradictions between explorers
- Identify gaps that none covered
- Structure by theme, not by explorer

### Step 5: Spawn Research-Critic

Spawn the adversarial critic with the synthesized findings:

```
Agent(subagent_type="research-critic", prompt="Challenge this synthesis: <findings>")
```

- Model: sonnet
- Fresh context — does NOT see raw explorer outputs (avoids anchoring bias)
- Reviews through 4 lenses: Evidence Quality, Completeness, Consistency, Actionability

### Step 6: Incorporate Critique and Produce Verdict

Read the critic's output and:
- Address valid challenges
- Note where the critic was wrong (with evidence)
- Produce the final verdict

### Step 7: Write Verdict

Write to `plans/research-<topic>-verdict.md`:

```markdown
# Research Verdict: <topic>

## Question
<Original research question>

## Verdict
<Clear recommendation with confidence level>

## Evidence
### Angle 1: <explorer-1 focus>
<Key findings>

### Angle 2: <explorer-2 focus>
<Key findings>

## Critique Response
<How critic's challenges were addressed>

## Risks & Unknowns
<What we still don't know>

## Recommendation
<Actionable next step>
```

## Integration with Planning

After producing the verdict:
1. If recommendation is clear → proceed to spec writing
2. If recommendation is "need more data" → targeted follow-up research
3. Verdict informs spec's §4 Constraints and risk sections

## Rules

- You orchestrate research, you don't implement. The Coder implements.
- Write to plans/ and /tmp/ only. Never write src/ or tests/.
- Every claim must cite a source (file path, URL, or explorer output).
- If explorers disagree, surface the disagreement — don't average it away.
- The critic must have fresh context. Never feed raw explorer outputs to the critic.
