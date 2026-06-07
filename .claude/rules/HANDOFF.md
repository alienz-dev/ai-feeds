# Handoff Protocol

Defines every inter-role data exchange: what's passed, where it's written, what format.

## Artifact Registry

| Artifact | Path | Format | Owner | Consumer |
|----------|------|--------|-------|----------|
| Requirements doc | `specs/<id>-requirements.md` | Markdown with EARS criteria | BA | Planner |
| Architecture doc | `specs/<id>-architecture.md` | Component diagram + ADRs | Architect | Planner |
| Design spec | `DESIGN.md` | Component specs + layout + tokens | UI-Designer | Planner, Coder |
| Analysis report | `plans/analysis-<topic>.md` | Markdown (findings + recommendation) | Data-Analyst | Planner |
| Spec | `specs/SPEC-<id>.markdown` | SDD template (7 sections) | Planner | Test-Manager, Reviewer |
| Plan | `plans/<id>-plan.md` | Wave decomposition | Planner | Sprint-Manager |
| Test map | `.pipeline/test_map.json` | JSON (see format below) | Test-Manager | Sprint-Manager |
| Coder result | `.pipeline/coder-<id>.json` | JSON (see format below) | Coder | Sprint-Manager |
| Review report | `.pipeline/review-<id>.md` | Markdown (verdict + findings) | Reviewer | Sprint-Manager |
| Pipeline state | `.pipeline/state.json` | JSON (gate.sh manages) | gate.sh | All roles |
| Checkpoint | `.pipeline/checkpoint-<stage>.json` | JSON (checkpoint.sh manages) | Agents | All roles |

## Handoff 1: BA → Planner

**Trigger:** BA completes requirements gathering
**Artifact:** `specs/<id>-requirements.md`
**Format:**
```markdown
# Requirements: <feature-name>

## Stakeholder Intent
<raw request>

## Actors
- <role>: <description>

## Outcomes
- <measurable outcome>

## Constraints
- <non-functional requirement>

## Edge Cases
- <boundary condition>

## Non-Goals
- <out-of-scope item>

## Draft Acceptance Criteria
**AC-1: <name> (Pattern)**
THE system SHALL <behavior>
```

**Handoff mechanism:** BA writes file, returns path to Planner. Planner reads and converts to spec.

---

## Handoff 2: Architect → Planner

**Trigger:** Architect completes system design
**Artifact:** `specs/<id>-architecture.md`
**Format:**
```markdown
# Architecture: <feature-name>

## Component Decomposition
- <module>: <responsibility>

## Interface Contracts
### <component>
- Input: <type>
- Output: <type>
- Errors: <types>

## Data Flow
1. <step>

## ADR: <decision>
- Context/Decision/Alternatives/Consequences
```

**Handoff mechanism:** Architect writes file, returns path to Planner. Planner incorporates into plan.

---

## Handoff 2b: UI-Designer → Planner

**Trigger:** UI-Designer completes design loop
**Artifact:** `DESIGN.md`
**Format:**
```markdown
# Design: <feature-name>

## Visual Direction
<design rationale>

## Component Specs
### <component>
- Layout/Tokens/States/Responsive

## Layout
<page-level layout>

## Interactions
<animation, transition specs>

## Accessibility
<contrast, focus, ARIA>
```

**Handoff mechanism:** UI-Designer returns text to caller. Main session writes to DESIGN.md.

---

## Handoff 2c: Data-Analyst → Planner

**Trigger:** Data-Analyst completes analysis
**Artifact:** `plans/analysis-<topic>.md`
**Format:**
```markdown
# Analysis: <task-name>

## Question
<what was asked>

## Method
<how analysis was performed>

## Findings
<key results with data points>

## Caveats
<limitations, assumptions>

## Recommendation
<actionable next step>
```

**Handoff mechanism:** Data-Analyst returns text to caller. Main session writes to plans/.

---

## Handoff 3: Planner → Test-Manager

**Trigger:** Spec approved, plan derived
**Artifact:** Spec path + plan path (passed via prompt)
**Format:** File paths in the Agent() prompt
```
Agent({
  subagent_type: "test-manager",
  prompt: "Write tests for spec: specs/SPEC-FOO.md, plan: plans/foo-plan.md"
})
```

**Handoff mechanism:** Direct prompt. Test-Manager reads files itself.

---

## Handoff 4: Test-Manager → Sprint-Manager

**Trigger:** Test-Manager verifies RED (all tests fail)
**Artifact:** `.pipeline/test_map.json`
**Format:**
```json
{
  "spec": "specs/SPEC-FOO.md",
  "visible": [
    "tests/unit/foo.test.ts",
    "tests/unit/foo-edge.test.ts"
  ],
  "hidden": [
    "tests/hidden/foo-regression.test.ts"
  ],
  "all_red": true,
  "timestamp": "2026-06-05T10:00:00Z"
}
```

**Handoff mechanism:** Test-Manager writes JSON file. Sprint-Manager (TRIO skill) reads it to plan waves.

---

## Handoff 5: Sprint-Manager → Coder

**Trigger:** Wave dispatch
**Artifact:** Briefing (passed via Agent() prompt)
**Format:** Per implementation-briefing.md template
```
Agent({
  subagent_type: "coder",
  prompt: `Make these tests pass: tests/unit/foo.test.ts

Files you may modify: src/foo.ts, src/bar.ts
Files you may read: src/types.ts

DO NOT read specs/ directory.
DO NOT modify tests/ except to fix setup.

Verification: npm test -- tests/unit/foo.test.ts
Expected: all tests pass`,
  isolation: "worktree"
})
```

**Handoff mechanism:** Direct prompt with briefing template. No file exchange.

---

## Handoff 6: Coder → Sprint-Manager

**Trigger:** Coder completes (tests pass or max retries)
**Artifact:** `.pipeline/coder-<id>.json`
**Format:**
```json
{
  "coder_id": "coder-1",
  "status": "success" | "failed",
  "files_changed": ["src/foo.ts", "src/bar.ts"],
  "tests_passed": true,
  "test_output": "...",
  "timestamp": "2026-06-05T11:00:00Z"
}
```

**Handoff mechanism:** Coder writes JSON file. Sprint-Manager reads to determine wave success.

---

## Handoff 7: Reviewer → Sprint-Manager

**Trigger:** Reviewer completes review
**Artifact:** `.pipeline/review-<id>.md`
**Format:**
```markdown
# Review Report

## Verdict: APPROVE | APPROVE_WITH_COMMENTS | REQUEST_CHANGES

## Findings
### [SEVERITY] <title>
- **File:** path:line
- **Issue:** <description>
- **Suggestion:** <fix>

## Summary
- Blocking: N
- Major: N
- Minor: N
```

**Handoff mechanism:** Reviewer writes markdown file. Sprint-Manager reads verdict.

---

## Rules

1. **File-based handoffs for persistent artifacts** (requirements, architecture, test_map, review reports)
2. **Prompt-based handoffs for ephemeral instructions** (briefings, task descriptions)
3. **JSON for machine-readable data** (test_map, coder results, pipeline state)
4. **Markdown for human-readable reports** (review reports, requirements, architecture)
5. **All paths are relative to project root** (not absolute)
6. **Timestamps are ISO 8601** (e.g., `2026-06-05T10:00:00Z`)
