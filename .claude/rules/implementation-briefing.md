---
name: implementation-briefing
description: Agent briefing template with information barrier enforcement. Implementers get test scripts, not specs.
---

# Implementation Briefing Template

## Why

TRIO's iron law: "The coder NEVER sees the spec. They only see failing tests."

When an implementer reads the spec, they implement the spec's words.
When an implementer reads failing tests, they implement the spec's intent.

This applies to all implementation work — not just application code, but also
shell scripts, documentation, and configuration.

## Briefing Structure

### What the Implementer Receives

```markdown
# Implementation Briefing: <task-name>

## Goal
<1-2 sentence description of WHAT to build, not WHY>

## Test Scripts (Your Contract)
<verification scripts that must pass when you're done>

### Test 1: <name>
\`\`\`bash
<exact command>
# Expected: <exact expected output>
\`\`\`

### Test 2: <name>
\`\`\`bash
<exact command>
# Expected: <exact expected output>
\`\`\`

## Files You May Modify
- <file 1>
- <file 2>

## Files You May Read (Not Modify)
- <file 3>
- <file 4>

## Do NOT
- <explicit constraint 1>
- <explicit constraint 2>

## Verification
Run all test scripts above. All must pass before you report done.
```

### What the Implementer Does NOT Receive

- ❌ Spec text (acceptance criteria, rationale, design decisions)
- ❌ Plan text (approach, ordering, risk analysis)
- ❌ Why these test scripts exist (the rationale is in the spec)
- ❌ What other specs are being implemented (prevents cross-contamination)

## Example: Correct Briefing

```markdown
# Implementation Briefing: gate.sh retreat command

## Goal
Add a `retreat` command to gate.sh that moves the pipeline backward.

## Test Scripts (Your Contract)

### Test 1: Retreat from review to test
\`\`\`bash
cd /path/to/dev-kit
bash workflow/pipeline/gate.sh init test-retreat
bash workflow/pipeline/gate.sh advance plan_ready
bash workflow/pipeline/gate.sh advance tests_ready
bash workflow/pipeline/gate.sh advance sprint_complete
bash workflow/pipeline/gate.sh retreat review_to_test
bash workflow/pipeline/gate.sh status
# Expected: Stage: test
\`\`\`

### Test 2: Retreat fails from wrong stage
\`\`\`bash
bash workflow/pipeline/gate.sh init test-retreat2
bash workflow/pipeline/gate.sh advance plan_ready
bash workflow/pipeline/gate.sh retreat review_to_test 2>&1
# Expected: ERROR: cannot retreat: current stage is 'test', signal 'review_to_test' requires 'review'
# Expected exit code: 1
\`\`\`

### Test 3: Unknown signal
\`\`\`bash
bash workflow/pipeline/gate.sh init test-retreat3
bash workflow/pipeline/gate.sh retreat bogus_signal 2>&1
# Expected: ERROR: unknown signal: bogus_signal
# Expected exit code: 1
\`\`\`

## Files You May Modify
- workflow/pipeline/gate.sh
- workflow/pipeline/transitions.json

## Files You May Read (Not Modify)
- workflow/trio/TRIO.md (for context on pipeline stages)

## Do NOT
- Do not modify any files outside workflow/pipeline/
- Do not change existing advance/status/check behavior
- Do not add new dependencies (bash + jq only)
- Do not read specs/foundation-fixes/ (those are spec files, not for you)

## Verification
Run all 3 test scripts above. All must pass.
Also run: `bash -n workflow/pipeline/gate.sh` (syntax check)
```

## Example: WRONG Briefing (Leaks Spec)

```markdown
# WRONG — DO NOT DO THIS

## Goal
Implement SPEC-003: gate.sh Retreat Command.

## Acceptance Criteria
- AC-1: Retreat command exists
- AC-2: Retreat validates target stage
- AC-3: Retreat records history with direction:backward
- AC-4: Retreat signals defined in transitions.json (review_to_test, review_to_specced)
- AC-5: Retreat prints warning

## Approach
1. Add review_to_test and review_to_specced to transitions.json
2. Add cmd_retreat() function to gate.sh
3. Add retreat case to main dispatch
```

This is wrong because:
- The implementer reads AC-4 and just adds the signals (rubber-stamping)
- The implementer reads the approach and follows it mechanically
- No test scripts to verify against
- Spec rationale is exposed (prevents independent verification)

## How the Barrier Works in Practice

Research from SWE-bench, OpenHands, and the vault confirms:

1. **Spec → test-manager → tests** (spec transforms into executable contract)
2. **Tests → coder** (coder sees only failing tests + test map + owned files)
3. **Spec + results → reviewer** (reviewer checks spec compliance)
4. **Hidden tests → verification** (40% hidden tests catch tautological implementations)

The tests encode the spec **semantically** (behavioral contract) without exposing the spec
**syntactically** (wording, rationale, alternatives). For tool/kit development, "tests" are
literal command invocations with expected exit codes and output patterns.

## Adapting for Different Task Types

### For Shell Scripts
- Test scripts = bash scripts that run the tool and check output
- Include: `bash -n` syntax check, `--help` flag test, error case tests
- Include: edge cases (empty input, missing deps, macOS compatibility)
- Include: idempotency test (run twice, same result)
- Include: cleanup test (temp files removed on success AND failure)

### For Documentation
- Test scripts = grep commands that check for required content
- Include: `grep -c "required-term" file.md` checks
- Include: `grep -c "forbidden-term" file.md` checks (should be 0)
- Include: link integrity check (`grep -oP '\[.*?\]\((.*?)\)' file.md | ...`)

### For Configuration
- Test scripts = jq/yaml validation commands
- Include: `jq . config.json` (valid JSON check)
- Include: `grep "required-key" config.json` checks
- Include: missing-key error test (what happens when key is absent?)

## Anti-Patterns

- ❌ **Spec text in briefing** — implementer rubber-stamps instead of understanding
- ❌ **No test scripts** — implementer has no way to verify success
- ❌ **Vague goals** — "implement the retreat command" → should be "add a command that moves pipeline state backward"
- ❌ **No file boundaries** — implementer modifies files they shouldn't
- ❌ **No "Do NOT" section** — implementer reads spec files for "context"
