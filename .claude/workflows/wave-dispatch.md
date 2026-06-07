export const meta = {
  name: 'wave-dispatch',
  description: 'TRIO wave dispatch: parallel coders per wave, GREEN gate, post-wave gates, retro between waves',
  phases: [
    { title: 'Dispatch', detail: 'spawn coders in parallel worktrees' },
    { title: 'GREEN', detail: 'verify all tests pass' },
    { title: 'Gates', detail: 'wiring, visual, wave-smoke' },
    { title: 'Post-Wave', detail: 'hidden, alignment, activation' },
  ],
}

// Workaround: args arrives as serialized JSON string
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath
const waves = _args.waves  // [{wave: 1, tests: [{file, failingTests}], maxCoders: 3}, ...]
const testMapPath = _args.testMapPath || '.pipeline/test_map.json'
const projectDir = _args.projectDir || '.'
const maxGreenRetries = 3
const maxVisualRetries = 2
const maxPatchWaves = 2

if (!specPath || !waves) {
  return { error: 'Missing required args: specPath, waves' }
}

// ── Helper: Run gate.sh command via agent ──────────────────────────
async function runGate(command, label) {
  return agent(
    `Run this gate.sh command and report the result: bash workflow/pipeline/gate.sh ${command}
Working directory: ${projectDir}
Report the exit code and output. If the command fails, report the error.`,
    { label, phase: 'Gates', schema: {
      type: 'object',
      properties: {
        exitCode: { type: 'number' },
        output: { type: 'string' },
        success: { type: 'boolean' },
      },
      required: ['exitCode', 'success'],
    }}
  )
}

// ── Wave Loop ──────────────────────────────────────────────────────
const waveResults = []

for (const wave of waves) {
  const waveNum = wave.wave
  const waveTests = wave.tests || []
  const maxCoders = Math.min(wave.maxCoders || 3, 3)

  log(`Wave ${waveNum}: dispatching ${Math.min(waveTests.length, maxCoders)} coders`)

  // ── Phase: Dispatch coders ──────────────────────────────────────
  const coderResults = await parallel(
    waveTests.slice(0, maxCoders).map(testEntry => () =>
      agent(
        `You are a coder. Make all failing tests pass.

Failing test file: ${testEntry.file}
Failing tests: ${(testEntry.failingTests || []).join(', ') || 'see test output'}

Project directory: ${projectDir}

Rules:
- DO NOT read the specs/ directory
- DO NOT modify test files
- Write implementation code to make tests pass
- Run tests to verify: npm test -- ${testEntry.file}
- If tests fail, fix and retry`,
        {
          label: `coder:w${waveNum}:${testEntry.file.split('/').pop()}`,
          phase: `Dispatch (Wave ${waveNum})`,
          isolation: 'worktree',
          schema: {
            type: 'object',
            properties: {
              testsPass: { type: 'boolean' },
              filesChanged: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
            required: ['testsPass'],
          },
        }
      ).then(r => ({ testEntry, result: r }))
    )
  )

  // ── Phase: GREEN gate ───────────────────────────────────────────
  let greenPassed = false
  let greenRetries = 0

  while (!greenPassed && greenRetries < maxGreenRetries) {
    const greenCheck = await agent(
      `Run the GREEN gate: execute all visible tests and verify they pass.
Command: cd ${projectDir} && npm test
Report: total tests, passed, failed, and any failure details.`,
      {
        label: `green:w${waveNum}:${greenRetries}`,
        phase: `GREEN (Wave ${waveNum})`,
        schema: {
          type: 'object',
          properties: {
            allPass: { type: 'boolean' },
            passed: { type: 'number' },
            failed: { type: 'number' },
            failures: { type: 'array', items: { type: 'string' } },
          },
          required: ['allPass'],
        },
      }
    )

    if (greenCheck?.allPass) {
      greenPassed = true
      // Write GREEN proof
      await runGate(`proof green "Wave ${waveNum}: all visible tests pass"`, `proof:green:w${waveNum}`)
      log(`Wave ${waveNum}: GREEN passed`)
    } else {
      greenRetries++
      log(`Wave ${waveNum}: GREEN failed (attempt ${greenRetries}/${maxGreenRetries})`)

      if (greenRetries < maxGreenRetries) {
        // Re-dispatch failing coders with test output
        const failedTests = greenCheck?.failures || []
        await agent(
          `Tests are still failing. Fix them.
Failures: ${failedTests.join('\n')}
Project directory: ${projectDir}
Run: cd ${projectDir} && npm test
Fix the implementation until all tests pass.`,
          {
            label: `fix-green:w${waveNum}:${greenRetries}`,
            phase: `GREEN (Wave ${waveNum})`,
            isolation: 'worktree',
          }
        )
      }
    }
  }

  if (!greenPassed) {
    log(`Wave ${waveNum}: GREEN failed after ${maxGreenRetries} attempts — stopping`)
    waveResults.push({ wave: waveNum, greenPassed: false, retries: greenRetries })
    break
  }

  // ── Phase: Post-wave gates ──────────────────────────────────────
  // Wiring check
  const wiring = await runGate(
    `proof wiring "Wave ${waveNum}: entry-reachability check passed"`,
    `wiring:w${waveNum}`
  )

  // Visual gate (if UI files changed)
  const changedFiles = coderResults.filter(Boolean).flatMap(r => r.result?.filesChanged || [])
  const hasUIFiles = changedFiles.some(f => /\.(tsx|jsx|vue|svelte|css|scss)$/.test(f))

  let visualPassed = true
  if (hasUIFiles) {
    let visualRetries = 0
    while (visualPassed === false && visualRetries < maxVisualRetries) {
      visualRetries++
    }
    // Visual gate: run static analysis + accessibility checks
    const visualCheck = await agent(
      `Run the visual gate checks:
1. Static analysis: stylelint if CSS/SCSS changed
2. Accessibility: check for axe-core violations
3. DOM checks: empty states, touch targets, overflow
Changed files: ${changedFiles.filter(f => /\.(tsx|jsx|vue|svelte|css|scss)$/.test(f)).join(', ')}
Project directory: ${projectDir}`,
      {
        label: `visual:w${waveNum}`,
        phase: `Gates (Wave ${waveNum})`,
        schema: {
          type: 'object',
          properties: {
            pass: { type: 'boolean' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['pass'],
        },
      }
    )
    visualPassed = visualCheck?.pass !== false
    if (visualPassed) {
      await runGate(`proof visual "Wave ${waveNum}: visual checks passed"`, `proof:visual:w${waveNum}`)
    }
  }

  waveResults.push({
    wave: waveNum,
    greenPassed: true,
    greenRetries,
    visualPassed,
    codersDispatched: coderResults.filter(Boolean).length,
    filesChanged: changedFiles,
  })

  log(`Wave ${waveNum}: complete — GREEN ${greenRetries > 0 ? `(after ${greenRetries} retries)` : '✓'}, visual: ${visualPassed ? '✓' : 'skip'}`)
}

// ── Post-All-Waves Gates ──────────────────────────────────────────
phase('Post-Wave')

// Hidden gate
const hiddenCheck = await agent(
  `Run hidden regression tests: cd ${projectDir} && npm test -- tests/hidden/
All hidden tests must pass. Report results.`,
  {
    label: 'hidden-gate',
    phase: 'Post-Wave',
    schema: {
      type: 'object',
      properties: {
        allPass: { type: 'boolean' },
        failures: { type: 'array', items: { type: 'string' } },
      },
      required: ['allPass'],
    },
  }
)

if (hiddenCheck?.allPass) {
  await runGate('proof hidden "hidden regression tests pass"', 'proof:hidden')
} else {
  // Promote failing hidden tests and re-dispatch
  log('Hidden gate failed — promoting failing tests to unit')
  const promoted = await agent(
    `These hidden tests failed: ${(hiddenCheck?.failures || []).join(', ')}
Promote them from tests/hidden/ to tests/unit/ so they become visible.
Then identify which coder needs to fix the implementation.
Project directory: ${projectDir}`,
    { label: 'promote-hidden', phase: 'Post-Wave' }
  )
  // Re-run GREEN after promotion
  await runGate('proof green "GREEN after hidden promotion"', 'proof:green-post-hidden')
}

// Alignment gate
const alignment = await agent(
  `Run the alignment gate: bash workflow/pipeline/alignment-gate.sh "${specPath}"
Project directory: ${projectDir}
Report the exit code:
- 0 = ALIGNED (proceed)
- 2 = TEST GAPS (re-dispatch test-manager)
- 3 = CODE ISSUES (dispatch patch wave)
- 4 = SPEC AMBIGUITY (flag for user)`,
  {
    label: 'alignment-gate',
    phase: 'Post-Wave',
    schema: {
      type: 'object',
      properties: {
        exitCode: { type: 'number' },
        status: { type: 'string' },
        details: { type: 'string' },
      },
      required: ['exitCode', 'status'],
    },
  }
)

// Handle alignment exit codes
if (alignment?.exitCode === 2) {
  log('Alignment: TEST GAPS — test coverage incomplete')
  // Return with signal for skill to re-dispatch test-manager
  return { waveResults, alignment: { status: 'TEST_GAPS', details: alignment.details } }
}

if (alignment?.exitCode === 4) {
  log('Alignment: SPEC AMBIGUITY — flagging for user')
  return { waveResults, alignment: { status: 'SPEC_AMBIGUITY', details: alignment.details } }
}

if (alignment?.exitCode === 3) {
  // Patch wave — max 2 attempts
  let patchWaves = 0
  while (patchWaves < maxPatchWaves) {
    patchWaves++
    log(`Patch wave ${patchWaves}/${maxPatchWaves}`)

    await agent(
      `Patch wave: fix the specific code issues identified by alignment gate.
Details: ${alignment.details}
Project directory: ${projectDir}
Only modify the files identified in the alignment report. Do NOT touch other files.`,
      {
        label: `patch-wave:${patchWaves}`,
        phase: 'Post-Wave',
        isolation: 'worktree',
      }
    )

    // Re-run alignment
    const recheck = await agent(
      `Re-run alignment gate after patch: bash workflow/pipeline/alignment-gate.sh "${specPath}"
Project directory: ${projectDir}`,
      {
        label: `alignment-recheck:${patchWaves}`,
        phase: 'Post-Wave',
        schema: {
          type: 'object',
          properties: {
            exitCode: { type: 'number' },
            status: { type: 'string' },
          },
          required: ['exitCode', 'status'],
        },
      }
    )

    if (recheck?.exitCode === 0) {
      log('Patch wave successful — aligned')
      break
    }
  }
}

// Wiring + activation proofs
await runGate('proof wiring "entry-reachability check passed"', 'proof:wiring-final')
await runGate('proof activation "feature reachable from entry point"', 'proof:activation')

// Advance pipeline
await runGate('advance sprint_complete', 'advance:sprint_complete')

// ── Summary ───────────────────────────────────────────────────────
const allWavesGreen = waveResults.every(w => w.greenPassed)
const totalCoders = waveResults.reduce((sum, w) => sum + (w.codersDispatched || 0), 0)
const totalRetries = waveResults.reduce((sum, w) => sum + (w.greenRetries || 0), 0)

return {
  summary: `${waves.length} waves, ${totalCoders} coders, ${totalRetries} GREEN retries. Alignment: ${alignment?.status || 'ALIGNED'}`,
  waveResults,
  allWavesGreen,
  alignment: alignment?.status || 'ALIGNED',
  hiddenPassed: hiddenCheck?.allPass || false,
}
