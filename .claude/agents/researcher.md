# ARIA v2 — Multi-Agent Research Protocol

Orchestrator pattern for deep investigation. Spawns parallel explorers, synthesizes, then spawns adversarial critic.

## When to Use

Solution discovery scoring (5 signals × 0-2 each):

| Signal | 0 | 1 | 2 |
|--------|---|---|---|
| Approach clarity | Obvious solution | Some ambiguity | Multiple viable approaches |
| Precedent | Done before in codebase | Similar exists | Novel territory |
| Integration surface | 1 file | 2-5 files | 6+ files or cross-system |
| Failure cost | Trivial to revert | Moderate rework | Data loss or security risk |
| Domain uncertainty | Well-understood | Some unknowns | Significant unknowns |

**Score routing:**
- 0-3: Skip research. Plan directly.
- 4-5: Light discovery (single researcher, no explorers).
- 6-10: Full ARIA v2 (orchestrator + explorers + critic).

## Protocol

```
1. Researcher (opus) receives question
2. Decomposes into 2-4 investigation angles
3. Spawns Explorer per angle (sonnet, parallel)
4. Waits for all explorers (--subscribe)
5. Synthesizes findings into unified analysis
6. Spawns Research-Critic (sonnet, fresh context)
7. Incorporates critique
8. Produces final verdict → ~/plans/research-<topic>-verdict.md
```

## Explorer Role

- **Model:** sonnet (cost-efficient for focused investigation)
- **Scope:** Single angle only — no cross-pollination between explorers
- **Output:** Findings file at specified /tmp/ path
- **Lifecycle:** Ephemeral — writes output, self-closes

```
Agent(explorer: "Investigate pagination patterns in similar OSS projects")
```

## Research-Critic Role

- **Model:** sonnet
- **Context:** Fresh — does NOT see explorer raw outputs, only synthesized findings
- **Purpose:** Challenge assumptions, find gaps, identify contradictions
- **Spawned:** AFTER all explorers complete (never concurrent)

```
Agent(research-critic: "Challenge this synthesis: /tmp/research-synthesis.md")
```

## Why Fresh Context for Critic?

Explorers accumulate confirmation bias during investigation. The critic starts clean:
- No anchoring to explorer hypotheses
- Can spot logical gaps the synthesizer missed
- Challenges "obvious" conclusions that may be wrong

## Output Format

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

After ARIA produces a verdict:
1. Supervisor reads verdict
2. If recommendation is clear → proceed to spec writing
3. If recommendation is "need more data" → additional targeted research
4. Verdict informs spec's §4 Constraints and risk sections
