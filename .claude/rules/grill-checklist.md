---
name: grill-checklist
description: Grill session checklist for tool/kit specs. Questions to ask before approving a spec.
---

# Grill Checklist — Tool/Kit Specs

## Why

Specs written by the planner without adversarial review have blind spots:
- Edge cases not considered
- Design decisions not questioned
- Interactions with existing tools not explored
- Error handling assumptions not challenged

## Grill Questions — Ask Before Approving Any Spec

### 1. Scope Questions
- [ ] What does this NOT do? (Non-Goals)
- [ ] What happens if this is used on a project that doesn't need it?
- [ ] Should this be opt-in or opt-out?
- [ ] Does this interact with any existing tools? How?

### 2. Edge Case Questions
- [ ] What happens on empty input? (no files, no specs, no tests)
- [ ] What happens on malformed input? (bad JSON, missing fields)
- [ ] What happens on concurrent access? (two agents, two terminals)
- [ ] What happens on macOS vs Linux? (flock, grep -P, sed -i)
- [ ] What happens if a dependency is missing? (jq, vitest, node)

### 3. Design Decision Questions
- [ ] Why this approach over alternatives?
- [ ] What's the simplest version that delivers 80% of the value?
- [ ] Is this solving a real problem or a theoretical one?
- [ ] Will this be used in practice, or just documented?

### 4. Interaction Questions
- [ ] How does this interact with gate.sh?
- [ ] How does this interact with the pipeline stages?
- [ ] Does this change any existing behavior?
- [ ] What existing docs need updating?

### 5. Verification Questions
- [ ] How will we know this works? (specific commands)
- [ ] How will we know this breaks? (specific failure modes)
- [ ] What's the minimum test that proves this works?
- [ ] Are there hidden tests that should pass?

### 5b. Debugging & Observability Questions
- [ ] When this fails at 2am, what does the user see? (error message quality)
- [ ] What log output does this produce? (structured? machine-parseable?)
- [ ] Is there a --verbose or --debug flag for troubleshooting?
- [ ] What diagnostic command proves this is working? (health check, status command)
- [ ] What are the 3 most likely failure modes and how to identify each?
- [ ] If this silently fails (no error, wrong result), how would the user notice?
- [ ] What state does this leave behind on failure? (temp files, partial writes, stuck locks)
- [ ] Is there a way to dry-run or preview before committing changes?

### 6. Tool-Specific Questions
- [ ] Does this script work on macOS bash 3.2? (no associative arrays, no `grep -P`)
- [ ] Does this script handle missing dependencies gracefully?
- [ ] Does this script complete in under 30 seconds?
- [ ] Does this script modify any files? (should it?)
- [ ] Does this script have a `--help` flag?

## Shell-Specific Grill Questions (for scripts/tools)

- [ ] What happens when run without arguments?
- [ ] What happens when a required file is missing?
- [ ] What happens when run twice (idempotency)?
- [ ] What happens when run concurrently with itself?
- [ ] What happens when interrupted mid-execution (Ctrl+C)?
- [ ] What exit code on success? On failure? On partial failure?
- [ ] What does the tool write to stdout vs stderr?
- [ ] What temp files are created? When are they cleaned up?
- [ ] What environment variables does it read? What are their defaults?
- [ ] What existing tools does this conflict with or replace?
- [ ] How does the user undo what this tool did?
- [ ] What does the user see when this tool fails?
- [ ] Does it handle `set -e` correctly? Are traps set for cleanup?
- [ ] Is it portable (bashisms vs POSIX? macOS vs Linux)?
- [ ] Does it leave partial state on failure (atomicity)?

## Grill Process (Amazon FAQ Pattern)

Amazon's "Working Backwards" method: write the FAQ before building. Each FAQ entry
becomes a branch of the design tree to walk.

1. **Generate FAQ** — from the spec, generate 5-10 FAQ entries: for each claim ask
   "what if this is wrong?", for each decision ask "why not the alternative?"
2. **Walk the FAQ** — for each entry, provide recommended answer with rationale
3. **Ask 3-5 targeted questions** from the checklists above
4. **Challenge the spec** — try to find a reason to reject it
5. **If all branches resolve:** approve with clarifications section updated
6. **If any branch exposes a gap:** send back for revision

The FAQ survives the grill as the Clarifications section of the spec.

## Example Grill Session

```
Spec: SPEC-003 gate.sh Retreat Command

Q: What happens if I retreat from review to test, then retreat again from test?
A: The second retreat would fail — review_to_test requires current stage "review",
   not "test". This is correct behavior. Clarify in spec.

Q: Should retreat work from "sprint" stage? (not just "review")
A: Not in this spec. Sprint has its own retry mechanism (retry_sprint).
   But we should add sprint_to_test for completeness. → Add to spec.

Q: Does this work on macOS? (flock issue)
A: The spec doesn't address locking. We discovered flock doesn't exist on macOS.
   → Add macOS fallback requirement to spec.

Result: Spec updated with 3 clarifications, approved.
```

## Anti-Patterns

- ❌ **Skip grill** — blind spots become bugs
- ❌ **Grill too many questions** — 3-5 targeted questions beat 20 vague ones
- ❌ **Grill without codebase context** — explore before asking
- ❌ **Approve without clarifications** — every grill should add at least 1 clarification
