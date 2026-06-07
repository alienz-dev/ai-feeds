---
description: Validate a spec for structural correctness, EARS compliance, ambiguity, and test coverage. Run before approval.
user-invocable: true
argument-hint: <spec-file>
---

# Validate Spec: $ARGUMENTS

You are the Spec Validator. You run a three-phase validation on the spec file at `$ARGUMENTS` and produce a structured report. You do NOT fix the spec — you only report findings.

## Phase 1: Structural Validation (Bash)

Run the existing structural validator:

```bash
bash workflow/sdd/validate-spec.sh "$ARGUMENTS"
```

Capture the output. This checks:
- Frontmatter fields (id, title, status)
- Required sections (§1 Overview, §2 Behavior)
- EARS acceptance criteria presence
- test-files and linked_issues fields

Then run these additional checks that validate-spec.sh does NOT cover:

### 1a. Status Value Validation
Extract the `status:` field. Must be one of: `draft`, `approved`, `implementing`, `verified`, `shipped`. Flag any other value.

### 1b. Banned Words in Acceptance Criteria
Scan the Acceptance Criteria section (under §2 Behavior) for banned words:
- "should", "appropriately", "properly", "correctly"
- "might", "could", "ideally", "when possible", "as needed"

Do NOT flag these words in the Clarifications section (§6) — Q&A format is acceptable there.
For each hit, quote the line and suggest an EARS-compliant replacement.

### 1c. Placeholder Detection
Scan the entire spec for:
- `TBD`, `TODO`, `FIXME`
- "add appropriate", "add proper", "insert here"
- Empty acceptance criteria (`- ` followed by nothing)

### 1d. Non-Goals Presence
Check for a Non-Goals section or bullet list. Per planner-core.md quality gate, specs must have 2-5 non-goal bullets. Flag if missing or if count is outside range.

### 1e. Error Handling Table
Check for an error handling table in §4. Expected format:
```
| Input | Expected | Rationale |
```
or similar tabular format. Flag if §4 exists but has no table.

### 1f. Field Name Consistency
Check if frontmatter uses `test-files:` (hyphen, canonical) or `test_files:` (underscore). Both are accepted but flag the underscore variant as non-canonical.

### 1g. Section Numbering
Check if sections use numbered format (`## 1 Overview`) or unnumbered (`## Overview`). Both accepted but flag unnumbered as non-canonical.

### 1h. Debugging & Observability (§8)
Check for §8 Debugging & Observability section. Must contain:
- Diagnostic Commands table (at least 1 command)
- At least 1 EARS debugging acceptance criterion (WHEN/IF ... THE system SHALL log/display ...)
- Failure Modes table (at least 1 failure mode)

Flag as MAJOR if §8 is missing entirely. Flag as MINOR if §8 exists but has empty tables.

Record PASS/FAIL/WARN for each check.

## Phase 2: Test Coverage (Bash)

Run the traceability checker:

```bash
bash tools/spec-trace.sh tests/ specs/
```

Capture the output. This cross-references `@spec` annotations in test files against spec sections and reports which sections are covered vs uncovered.

If no test files exist yet (spec is in `draft` status), skip this phase and record "SKIPPED — no tests yet".

Record the coverage table and overall PASS/FAIL.

## Phase 3: Semantic Validation (LLM)

Read the full spec file. Perform these checks using your reasoning:

### 3a. EARS Compliance
For each acceptance criterion, verify it matches one of the 5 EARS patterns:
- **Ubiquitous:** `THE system SHALL [behavior]`
- **Event-driven:** `WHEN [trigger] THE system SHALL [response]`
- **State-driven:** `WHILE [state] THE system SHALL [behavior]`
- **Unwanted:** `IF [error] THEN THE system SHALL [recovery]`
- **Optional:** `WHERE [config] THE system SHALL [behavior]`

Compound patterns are allowed: `WHILE [state] WHEN [trigger] THE system SHALL [response]`

Flag any criterion that:
- Does not start with a valid EARS prefix (WHEN/WHILE/IF/WHERE/THE)
- Uses passive voice hiding the actor ("errors are logged" → by what?)
- Is missing the response/action after SHALL

### 3b. Ambiguity Detection
Scan for vague language that makes criteria untestable:
- Unquantified terms: "fast", "efficient", "user-friendly", "reasonable", "minimal"
- Missing specificity: "handle errors" (which errors? how?)
- Subjective judgment: "looks good", "feels responsive"
- Missing boundaries: "limit results" (to what number?)

### 3c. Testability Check
For each acceptance criterion, ask: "Could a developer write a deterministic test for this without guessing?"
Flag criteria that are:
- Missing observable outcomes
- Dependent on subjective judgment
- Missing boundary conditions
- Missing error cases for IF/THEN patterns
- Compound criteria with AND/OR that should be split

### 3d. Completeness Check
- Does §4 Error Handling cover all IF/THEN criteria from §2?
- Does §3 Change Specification (if present) have Invariants?
- Are Invariants specific enough to generate hidden regression tests?
- Does the Scope Boundary exclude things that are ambiguously in-scope?
- Does each behavior subsection have at least one acceptance criterion?

### 3e. Internal Consistency
- Do linked_issues match the feature described?
- Do test-files reference files that exist (or are plausible)?
- Does the status field make sense for the content (e.g., "approved" but no acceptance criteria)?
- Are terms used consistently (same concept = same name throughout)?

## Output Format

Produce a single report with this structure:

```
# Spec Validation Report: $ARGUMENTS

## Summary
- Structural: PASS | FAIL (N errors, M warnings)
- Coverage:  PASS | FAIL | SKIPPED (X/Y sections covered)
- Semantic:  PASS | FAIL (Z findings)

## Structural Checks
| Check | Status | Detail |
|-------|--------|--------|
| Frontmatter | PASS/FAIL | ... |
| §1 Overview | PASS/FAIL | ... |
| §2 Behavior | PASS/FAIL | ... |
| EARS criteria | PASS/WARN | ... |
| test-files | PASS/WARN | ... |
| linked_issues | PASS/WARN | ... |
| Status value | PASS/FAIL | ... |
| Banned words | PASS/WARN | ... |
| Placeholders | PASS/WARN | ... |
| Non-Goals | PASS/WARN | ... |
| Error handling | PASS/WARN | ... |
| §8 Debugging | PASS/WARN | ... |

## Test Coverage
| Spec Section | Status |
|--------------|--------|
| §2 Behavior | covered/UNCOVERED |
| ... | ... |

## Semantic Findings
For each finding:
- **[BLOCKING/MAJOR/MINOR]** Section §N: <finding>
  - Current: "<quoted text from spec>"
  - Issue: <what is wrong>
  - Suggestion: <how to fix>

## Verdict
APPROVE — spec is ready for planning
or
REJECT — N blocking issues must be resolved before approval

## Recommended Fixes
(Only if REJECT) Ordered list of specific edits to make, referencing section numbers.
```

## Rules
- You are a validator, not an author. Do NOT rewrite the spec.
- **BLOCKING** = spec cannot proceed to planning until fixed (untestable criteria, missing sections, structural errors).
- **MAJOR** = should fix before approval (ambiguity, incomplete error handling).
- **MINOR** = note for author (style, naming, missing optional fields).
- If all three phases PASS with zero findings, report that honestly. Do not manufacture findings.
- Always show the quoted text from the spec so the author knows exactly what to change.
- Accept both canonical (`## 1 Overview`, `test-files:`) and non-canonical (`## Overview`, `test_files:`) formats, but flag non-canonical as MINOR.
