export const meta = {
  name: 'wave-implement',
  description: 'TRIO-style wave dispatch with worktree isolation, GREEN gate, and alignment checks',
  phases: [
    { title: 'Verify RED', detail: 'Confirm all tests fail before coding' },
    { title: 'Wave Dispatch', detail: 'Parallel coders in worktrees with GREEN gate' },
    { title: 'Post-Wave Gates', detail: 'hidden, alignment, activation checks' },
    { title: 'Review', detail: 'Multi-perspective adversarial review' },
  ],
}

// Workaround: args arrives as serialized JSON string in workflow runtime
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath || 'specs/*.spec.md'
const testMapPath = _args.testMapPath || '.pipeline/test_map.json'
const maxCodersPerWave = _args.maxCodersPerWave || 3
const maxGreenRetries = _args.maxGreenRetries || 3

// --- Phase 1: Verify RED ---
phase('Verify RED')

const redCheck = await agent(
  `Run all tests and confirm they FAIL. This is the RED gate — every test must fail before implementation begins.
Read the test files and run: npm test
Report: total tests, how many fail, how many pass (should be 0).
If any tests already pass, report which ones and why.`,
  {
    label: 'verify-red',
    phase: 'Verify RED',
    schema: {
      type: 'object',
      properties: {
        totalTests: { type: 'number' },
        failing: { type: 'number' },
        passing: { type: 'number' },
        redConfirmed: { type: 'boolean' },
        alreadyPassing: { type: 'array', items: { type: 'string' } },
      },
      required: ['redConfirmed'],
    },
  }
)

if (!redCheck?.redConfirmed) {
  log(`RED gate failed: ${redCheck?.passing || 0} tests already passing`)
  return { status: 'failed', reason: 'RED gate not confirmed', details: redCheck }
}

log(`RED confirmed: ${redCheck.failing} tests failing`)

// --- Phase 2: Wave Dispatch ---
phase('Wave Dispatch')

// Read test map to understand wave grouping
const testMap = await agent(
  `Read ${testMapPath} and group test files into waves. Each wave contains tests that can be implemented independently (no file overlap between coders in the same wave).
If no test_map.json exists, read all test files and group by directory/module independence.
Return the wave grouping.`,
  {
    label: 'wave-planner',
    phase: 'Wave Dispatch',
    schema: {
      type: 'object',
      properties: {
        waves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              wave: { type: 'number' },
              tests: { type: 'array', items: { type: 'string' } },
              files: { type: 'array', items: { type: 'string' } },
            },
            required: ['wave', 'tests'],
          },
        },
      },
      required: ['waves'],
    },
  }
)

const waves = testMap?.waves || [{ wave: 1, tests: ['all tests'] }]
log(`Planning ${waves.length} waves`)

// Dispatch coders per wave with GREEN gate
const waveResults = []

for (const wave of waves) {
  log(`Wave ${wave.wave}: dispatching ${Math.min(wave.tests.length, maxCodersPerWave)} coders`)

  // Dispatch coders in worktrees (up to maxCodersPerWave parallel)
  const coderTasks = wave.tests.slice(0, maxCodersPerWave).map((testFile, i) => () =>
    agent(
      `Make these failing tests pass. Read the test files, implement the minimal code to make them pass.

Test files: ${Array.isArray(testFile) ? testFile.join(', ') : testFile}
${wave.files ? `You may modify: ${wave.files.join(', ')}` : ''}

Rules:
- Read the tests first, understand what they expect
- Write minimal code to make tests pass
- Do NOT read specs/ directory
- Run tests after each change to verify progress
- Self-close when all assigned tests pass`,
      {
        label: `coder:w${wave.wave}:${i}`,
        phase: `Wave ${wave.wave}`,
        isolation: 'worktree',
      }
    )
  )

  const coderResults = await parallel(coderTasks)
  log(`Wave ${wave.wave}: ${coderResults.filter(Boolean).length} coders completed`)

  // GREEN gate: verify all tests pass
  let greenPassed = false
  for (let retry = 0; retry < maxGreenRetries; retry++) {
    const greenCheck = await agent(
      `Run npm test and verify ALL tests pass. Report the result.`,
      {
        label: `green:w${wave.wave}:${retry}`,
        phase: `Wave ${wave.wave}`,
        schema: {
          type: 'object',
          properties: {
            passed: { type: 'boolean' },
            total: { type: 'number' },
            failing: { type: 'number' },
            failingTests: { type: 'array', items: { type: 'string' } },
          },
          required: ['passed'],
        },
      }
    )

    if (greenCheck?.passed) {
      greenPassed = true
      log(`GREEN gate passed for wave ${wave.wave}`)
      break
    }

    log(`GREEN gate failed (retry ${retry + 1}/${maxGreenRetries}): ${greenCheck?.failing} tests still failing`)

    if (retry < maxGreenRetries - 1) {
      // Re-dispatch for failing tests
      await agent(
        `These tests are still failing: ${greenCheck?.failingTests?.join(', ') || 'unknown'}
Fix the implementation to make them pass. Read the test files first.`,
        {
          label: `green-fix:w${wave.wave}:${retry}`,
          phase: `Wave ${wave.wave}`,
          isolation: 'worktree',
        }
      )
    }
  }

  if (!greenPassed) {
    log(`GREEN gate exhausted for wave ${wave.wave} after ${maxGreenRetries} retries`)
    waveResults.push({ wave: wave.wave, status: 'failed', reason: 'GREEN gate exhausted' })
    continue
  }

  // Post-wave gates
  const wiringCheck = await agent(
    `Run the entry-reachability check to verify no orphaned modules or dead imports.`,
    {
      label: `wiring:w${wave.wave}`,
      phase: `Wave ${wave.wave}`,
      schema: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['passed'],
      },
    }
  )

  waveResults.push({
    wave: wave.wave,
    status: greenPassed && wiringCheck?.passed ? 'passed' : 'partial',
    green: greenPassed,
    wiring: wiringCheck?.passed || false,
  })
}

// --- Phase 3: Post-Wave Gates ---
phase('Post-Wave Gates')

// Hidden gate: run hidden regression tests
const hiddenCheck = await agent(
  `Run the hidden regression tests (tests/hidden/ or tests/regression-prevention/). These are behavioral invariants the coder never saw. Report which pass and which fail.`,
  {
    label: 'hidden-gate',
    phase: 'Post-Wave Gates',
    schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        total: { type: 'number' },
        failing: { type: 'number' },
        failingTests: { type: 'array', items: { type: 'string' } },
      },
      required: ['passed'],
    },
  }
)

// Alignment gate: check spec-to-code alignment
const alignmentCheck = await agent(
  `Compare the spec acceptance criteria against the current code behavior. For each AC, classify as ALIGNED, DIVERGENT, UNIMPLEMENTED, or OVER-IMPLEMENTED.`,
  {
    label: 'alignment-gate',
    phase: 'Post-Wave Gates',
    schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        aligned: { type: 'number' },
        divergent: { type: 'number' },
        unimplemented: { type: 'number' },
        details: { type: 'array', items: {
          type: 'object',
          properties: {
            ac: { type: 'string' },
            status: { type: 'string' },
            file: { type: 'string' },
            issue: { type: 'string' },
          },
        }},
      },
      required: ['passed'],
    },
  }
)

// Activation gate: verify feature is reachable
const activationCheck = await agent(
  `Verify the implemented feature is reachable from the project entry point. Check that modified files are imported by entry points (index.ts, main.ts, app.ts).`,
  {
    label: 'activation-gate',
    phase: 'Post-Wave Gates',
    schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        reachableFiles: { type: 'array', items: { type: 'string' } },
        unreachableFiles: { type: 'array', items: { type: 'string' } },
      },
      required: ['passed'],
    },
  }
)

// --- Phase 4: Review ---
phase('Review')

const review = await workflow('adversarial-review', { target: 'the current branch changes' })

// --- Summary ---
const gateResults = {
  red: redCheck,
  waves: waveResults,
  hidden: hiddenCheck,
  alignment: alignmentCheck,
  activation: activationCheck,
  review: review,
}

const allPassed = hiddenCheck?.passed && alignmentCheck?.passed && activationCheck?.passed

return {
  status: allPassed ? 'passed' : 'failed',
  gates: gateResults,
  summary: allPassed
    ? 'All gates passed. Implementation complete.'
    : `Gates failed: hidden=${hiddenCheck?.passed}, alignment=${alignmentCheck?.passed}, activation=${activationCheck?.passed}`,
}
