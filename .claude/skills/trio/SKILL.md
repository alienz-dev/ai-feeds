---
description: Run the implementation sprint phase only (wave dispatch + gates). Alias for wave-implement workflow.
user-invocable: true
argument-hint: <feature-name>
---

# Trio Sprint: $ARGUMENTS

This is a thin wrapper around the wave-implement workflow. It runs only the implementation sprint phase (Test → Implement → Review), not the full SDD lifecycle.

## When to use
- Re-running implementation after fixing test issues
- Running just the sprint phase without plan derivation or retro
- When tests already exist and you need implementation only

## Execution

Delegate to the wave-implement workflow:

```
workflow({name: 'wave-implement'}, {
  specPath: 'specs/SPEC-' + $ARGUMENTS + '.spec.md',
  testMapPath: '.pipeline/test_map.json'
})
```

The workflow handles:
- RED verification
- Wave dispatch with worktree isolation
- GREEN gate with retries
- Post-wave gates (hidden, alignment, activation)
- Multi-perspective adversarial review

## Rules
- You are the orchestrator. You never write implementation code yourself.
- If something fails beyond retry limits, report clearly and stop.
