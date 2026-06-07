export const meta = {
  name: 'sdd-test-gen',
  description: 'SDD test generation: generate tests from spec, verify RED gate, check AC coverage',
  phases: [
    { title: 'Generate', detail: 'generate tests from spec acceptance criteria' },
    { title: 'Verify RED', detail: 'confirm all tests fail before implementation' },
    { title: 'Trace', detail: 'verify AC coverage via spec-trace' },
  ],
}

// Workaround: args arrives as serialized JSON string
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath
const testDir = _args.testDir || 'tests'
const projectDir = _args.projectDir || '.'

if (!specPath) {
  return { error: 'Missing required arg: specPath' }
}

// ── Phase 1: Generate tests ───────────────────────────────────────
phase('Generate')

const specRead = await agent(
  `Read the spec at ${specPath} and extract all acceptance criteria.
For each AC, identify:
- The EARS pattern type (Ubiquitous, Event-driven, State-driven, Unwanted, Optional)
- The requirement text
- Whether it's visible (60%) or hidden (40% — regression/invariant checks)

Return the structured AC list.`,
  {
    label: 'read-spec',
    phase: 'Generate',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        acceptanceCriteria: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              earsType: { type: 'string' },
              visibility: { type: 'string', enum: ['visible', 'hidden'] },
            },
            required: ['id', 'text', 'visibility'],
          },
        },
      },
      required: ['acceptanceCriteria'],
    },
  }
)

const acs = specRead?.acceptanceCriteria || []
const visibleACs = acs.filter(a => a.visibility === 'visible')
const hiddenACs = acs.filter(a => a.visibility === 'hidden')

log(`Found ${acs.length} ACs: ${visibleACs.length} visible, ${hiddenACs.length} hidden`)

// Generate tests for visible ACs
const testGen = await agent(
  `Generate test files for these acceptance criteria. Each test should:
1. Reference the AC via @spec annotation: // @spec ${specPath}#AC-id
2. Be structured as a failing test (RED) — the implementation doesn't exist yet
3. Use the project's test framework (check package.json for vitest/jest)
4. Cover the happy path AND edge cases for each AC
5. Be placed in ${testDir}/unit/ for visible tests

Acceptance criteria:
${visibleACs.map(a => `- [${a.id}] ${a.text} (${a.earsType})`).join('\n')}

Project directory: ${projectDir}
Write the test files. Do NOT implement the solution.`,
  {
    label: 'generate-tests',
    phase: 'Generate',
    schema: {
      type: 'object',
      properties: {
        testFiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              acIds: { type: 'array', items: { type: 'string' } },
              testCount: { type: 'number' },
            },
            required: ['path', 'acIds'],
          },
        },
        totalTests: { type: 'number' },
      },
      required: ['testFiles', 'totalTests'],
    },
  }
)

// Generate hidden tests for invariants/unwanted behaviors
let hiddenTestGen = null
if (hiddenACs.length > 0) {
  hiddenTestGen = await agent(
    `Generate hidden regression tests for these invariant/unwanted-behavior ACs.
These tests verify things that should NEVER happen (unwanted behaviors) or invariants that must always hold.
Place them in ${testDir}/hidden/ — they are NOT visible to coders.

Acceptance criteria:
${hiddenACs.map(a => `- [${a.id}] ${a.text} (${a.earsType})`).join('\n')}

Project directory: ${projectDir}
Write the test files.`,
    {
      label: 'generate-hidden-tests',
      phase: 'Generate',
      schema: {
        type: 'object',
        properties: {
          testFiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                acIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['path', 'acIds'],
            },
          },
        },
        required: ['testFiles'],
      },
    }
  )
}

// ── Phase 2: Verify RED ───────────────────────────────────────────
phase('Verify RED')

const redCheck = await agent(
  `Run all tests and verify they FAIL (RED gate).
Command: cd ${projectDir} && npm test
Expected: ALL tests should fail because no implementation exists yet.
Report: total tests, passed (should be 0), failed.`,
  {
    label: 'verify-red',
    phase: 'Verify RED',
    schema: {
      type: 'object',
      properties: {
        allFail: { type: 'boolean' },
        total: { type: 'number' },
        passed: { type: 'number' },
        failed: { type: 'number' },
      },
      required: ['allFail'],
    },
  }
)

if (!redCheck?.allFail) {
  log(`RED gate: ${redCheck?.passed || 0} tests unexpectedly passed — may need implementation`)
}

// ── Phase 3: Trace coverage ───────────────────────────────────────
phase('Trace')

const trace = await agent(
  `Run spec-trace to verify all ACs are covered by tests:
Command: bash tools/spec-trace.sh "${specPath}"
Project directory: ${projectDir}
Report: coverage percentage, any uncovered ACs.`,
  {
    label: 'spec-trace',
    phase: 'Trace',
    schema: {
      type: 'object',
      properties: {
        coverage: { type: 'number' },
        uncoveredACs: { type: 'array', items: { type: 'string' } },
        totalACs: { type: 'number' },
        coveredACs: { type: 'number' },
      },
      required: ['coverage'],
    },
  }
)

// ── Summary ───────────────────────────────────────────────────────
return {
  summary: `${testGen?.totalTests || 0} tests generated for ${acs.length} ACs. RED: ${redCheck?.allFail ? 'CONFIRMED' : 'PARTIAL'}. Coverage: ${trace?.coverage || 0}%`,
  testFiles: testGen?.testFiles || [],
  hiddenTestFiles: hiddenTestGen?.testFiles || [],
  totalTests: testGen?.totalTests || 0,
  redConfirmed: redCheck?.allFail || false,
  coverage: trace?.coverage || 0,
  uncoveredACs: trace?.uncoveredACs || [],
  acCount: acs.length,
}
