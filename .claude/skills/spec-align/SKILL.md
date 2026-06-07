---
description: Compare spec acceptance criteria against current code behavior. Identify divergences and recommend reconciliation actions.
user-invocable: true
argument-hint: <spec-file> [issue-description]
---

# Spec Alignment: $ARGUMENTS

You are the Spec Aligner. You compare a spec's acceptance criteria against the current codebase and produce a divergence report with reconciliation recommendations. You do NOT fix spec or code — you only report findings and recommend actions.

Parse `$ARGUMENTS` as:
- First positional: the spec file path (required)
- Remaining text: an optional issue or change description (narrows focus)

## Phase 1: Extract Spec Data (Bash)

### 1a. Validate the spec structure
```bash
bash workflow/sdd/validate-spec.sh <spec-file>
```
If this fails with errors, stop and report: "Spec has structural errors. Run /ba-validate first."

### 1b. Extract EARS acceptance criteria with line numbers
```bash
grep -n "THE system SHALL" <spec-file>
```

### 1c. Extract spec frontmatter
```bash
head -30 <spec-file> | grep -E "^(id|title|status|test-files|test_files|linked_issues|linked_files):"
```

### 1d. Run traceability check
```bash
bash tools/spec-trace.sh tests/ specs/ 2>&1 || true
```
(Allow failure — zero @spec annotations is expected)

### 1e. Extract Change Specification section
Read the spec file and locate the Change Specification section (§3 or under Behavior). Extract:
- Current Behavior bullets
- Target Behavior bullets
- Invariants bullets
- Scope Boundary bullets

Record all artifacts for Phase 2.

## Phase 2: Compare Spec vs Code (LLM)

For each EARS acceptance criterion extracted in Phase 1:

### 2a. Locate implementation
Search the codebase for code that implements the behavior described by the criterion:
- Check `test-files` and `linked_files` frontmatter for candidate files
- Grep for function names, class names, or keywords from the criterion
- Check `linked_issues` for context about which files were modified

### 2b. Read the implementation
Read the relevant source files. Understand what the code actually does for that behavior.

### 2c. Compare spec vs code
Classify each criterion:

| Status | Meaning |
|--------|---------|
| **ALIGNED** | Code implements exactly what the spec says |
| **DIVERGENT** | Code does something different from what the spec says |
| **UNIMPLEMENTED** | No code exists that addresses this criterion |
| **OVER-IMPLEMENTED** | Code does more than the spec requires (undocumented behavior) |

### 2d. Check invariants
For each bullet in the Invariants section:
- Verify the code preserves this invariant
- Flag any invariant that the code now violates

### 2e. Narrow focus if issue provided
If an issue description was provided, prioritize criteria related to that issue. Still scan all criteria but report full detail only for relevant ones.

## Phase 3: Produce Reconciliation Report (LLM)

Synthesize all findings into this report:

```
# Spec Alignment Report: <spec-file>

## Summary
- Criteria analyzed: N
- Aligned: X
- Divergent: Y
- Unimplemented: Z
- Over-implemented: W

## Test Coverage (from spec-trace.sh)
| Spec Section | Status |
|--------------|--------|
| ... | covered/UNCOVERED/N/A |

## Divergence Details

### DIV-1: <criterion summary>
- **Spec says (line N):** "<quoted EARS criterion>"
- **Code does:** <description of actual behavior in file:line>
- **Classification:** DIVERGENT | UNIMPLEMENTED | OVER-IMPLEMENTED
- **Recommendation:** UPDATE SPEC | UPDATE CODE | FLAG FOR HUMAN
- **Rationale:** <why this recommendation>
- **Affected test files:** <list>

### DIV-2: ...

## Invariant Check
| Invariant | Status | Evidence |
|-----------|--------|----------|
| ... | PRESERVED | VIOLATED |

## Affected Files
| File | Reason |
|------|--------|
| src/foo.ts | Implements DIV-1 behavior |
| tests/foo.test.ts | @spec annotation for DIV-1 |

## Recommended Change Specification (if UPDATE SPEC recommended)

Paste this into the spec's §3 Change Specification:

### Current Behavior (update to match reality)
- <bullet describing what code actually does>

### Target Behavior (if code needs changes)
- <bullet describing what code should do>

### Invariants
- <any new invariants discovered>

## Recommended Code Changes (if UPDATE CODE recommended)
For each code divergence:
- **File:** src/foo.ts:42
- **Current:** <what the code does now>
- **Expected:** <what the spec requires>
- **Suggested fix:** <concrete change>

## Verdict
ALIGNED — spec and code agree on all criteria
or
DIVERGENT — N divergences found (X update-spec, Y update-code, Z flag-for-human)
```

## Rules
- You are an analyzer, not a fixer. Do NOT modify spec or code files.
- **ALIGNED** means the code behavior matches the EARS criterion exactly. Partial matches are DIVERGENT.
- **UPDATE SPEC** when the code behavior is correct and the spec is stale.
- **UPDATE CODE** when the spec is correct and the code has a bug or missing implementation.
- **FLAG FOR HUMAN** when neither option is clearly correct, or the divergence involves design decisions.
- Always show the quoted spec text and the actual code behavior so the reader can verify your analysis.
- If no source files can be found for a criterion, classify as UNIMPLEMENTED (not DIVERGENT).
- The Change Specification output must be paste-ready — use the exact format from the spec template.
