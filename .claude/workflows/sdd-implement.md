export const meta = {
  name: 'sdd-implement',
  description: 'Full SDD implementation: test-gen → wave-dispatch → review → retro',
  phases: [
    { title: 'Test Gen', detail: 'generate tests from spec, verify RED' },
    { title: 'Sprint', detail: 'wave dispatch with parallel coders' },
    { title: 'Review', detail: 'multi-perspective review with adversarial verify' },
    { title: 'Retro', detail: 'analyze artifacts, classify, route' },
  ],
}

// Workaround: args arrives as serialized JSON string
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath
const waves = _args.waves
const complexity = _args.complexity || 5
const projectDir = _args.projectDir || '.'
const fullRetro = _args.fullRetro || (complexity >= 8)

if (!specPath) {
  return { error: 'Missing required arg: specPath' }
}

// ── Phase 1: Test Generation ──────────────────────────────────────
phase('Test Gen')

const testResult = await workflow(
  { name: 'sdd-test-gen' },
  { specPath, projectDir }
)

log(`Test gen: ${testResult?.totalTests || 0} tests, RED ${testResult?.redConfirmed ? 'confirmed' : 'partial'}, coverage ${testResult?.coverage || 0}%`)

if (!testResult?.redConfirmed) {
  log('WARNING: RED gate not fully confirmed — some tests may already pass')
}

// ── Phase 2: Sprint (Wave Dispatch) ───────────────────────────────
phase('Sprint')

// If waves not provided, derive from test map
let waveDefinitions = waves
if (!waveDefinitions) {
  // Read test map and derive waves
  const testMap = await agent(
    `Read ${projectDir}/.pipeline/test_map.json and the failing tests.
Group test files into waves by file independence (no two coders touch the same source file).
Max 3 test files per wave.
Return the wave structure.`,
    {
      label: 'derive-waves',
      phase: 'Sprint',
      schema: {
        type: 'object',
        properties: {
          waves: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wave: { type: 'number' },
                tests: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      file: { type: 'string' },
                      failingTests: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['file'],
                  },
                },
              },
              required: ['wave', 'tests'],
            },
          },
        },
        required: ['waves'],
      },
    }
  )
  waveDefinitions = testMap?.waves || []
}

const sprintResult = await workflow(
  { name: 'wave-dispatch' },
  { specPath, waves: waveDefinitions, projectDir }
)

log(`Sprint: ${sprintResult?.summary || 'complete'}`)

if (!sprintResult?.allWavesGreen) {
  log('WARNING: Not all waves passed GREEN gate')
}

// ── Phase 3: Review ───────────────────────────────────────────────
phase('Review')

// Get list of changed files from sprint results
const changedFiles = sprintResult?.waveResults?.flatMap(w => w.filesChanged || []) || []

const reviewResult = await workflow(
  { name: 'sdd-review' },
  { specPath, changedFiles, complexity, projectDir }
)

log(`Review: ${reviewResult?.verdict || 'UNKNOWN'} (${reviewResult?.criticalCount || 0} critical, ${reviewResult?.majorCount || 0} major)`)

// Handle REJECT — re-dispatch with review findings
if (reviewResult?.verdict === 'REJECT') {
  log('Review REJECTED — dispatching fix with review findings')
  await agent(
    `Fix the issues identified in the review:
${reviewResult.findings.map(f => `- ${f.severity}: ${f.title} (${f.file || 'N/A'}) — ${f.description}`).join('\n')}

Project directory: ${projectDir}
Only fix the identified issues. Do not change other code.`,
    {
      label: 'fix-review-findings',
      phase: 'Review',
      isolation: 'worktree',
    }
  )
}

// ── Phase 4: Retro ────────────────────────────────────────────────
phase('Retro')

const retroResult = await workflow(
  { name: 'sdd-retro' },
  { specPath, projectDir, fullRetro }
)

log(`Retro: ${retroResult?.summary || 'complete'}`)

// ── Summary ───────────────────────────────────────────────────────
return {
  summary: `SDD implementation complete. Tests: ${testResult?.totalTests || 0}. Sprint: ${sprintResult?.allWavesGreen ? 'GREEN' : 'PARTIAL'}. Review: ${reviewResult?.verdict || 'UNKNOWN'}. Retro: ${retroResult?.heuristics || 0} heuristics, ${retroResult?.issues || 0} issues.`,
  testGen: {
    tests: testResult?.totalTests || 0,
    redConfirmed: testResult?.redConfirmed || false,
    coverage: testResult?.coverage || 0,
  },
  sprint: {
    allGreen: sprintResult?.allWavesGreen || false,
    alignment: sprintResult?.alignment || 'UNKNOWN',
    waves: sprintResult?.waveResults?.length || 0,
  },
  review: {
    verdict: reviewResult?.verdict || 'UNKNOWN',
    findings: reviewResult?.findings?.length || 0,
  },
  retro: {
    heuristics: retroResult?.heuristics || 0,
    issues: retroResult?.issues || 0,
    drops: retroResult?.drops || 0,
  },
}
