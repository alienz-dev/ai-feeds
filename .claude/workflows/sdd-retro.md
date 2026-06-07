export const meta = {
  name: 'sdd-retro',
  description: 'SDD retrospective: analyze artifacts, classify findings, route outputs',
  phases: [
    { title: 'Analyze', detail: 'read pipeline artifacts and classify findings' },
    { title: 'Route', detail: 'write findings to appropriate destinations' },
  ],
}

// Workaround: args arrives as serialized JSON string
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath
const pipelineDir = _args.pipelineDir || '.pipeline'
const projectDir = _args.projectDir || '.'
const isFullRetro = _args.fullRetro || false

// ── Phase 1: Analyze ──────────────────────────────────────────────
phase('Analyze')

const analysis = await agent(
  `Analyze the pipeline artifacts and produce a retrospective.

${isFullRetro ? 'This is a FULL retrospective (complexity >= 8 or retries >= 2).' : 'This is a lightweight retrospective.'}

Read these artifacts:
1. Spec: ${specPath || 'find the spec in specs/'}
2. Pipeline state: ${pipelineDir}/state.json
3. Gate proofs: ${pipelineDir}/gates/*.passed
4. Test map: ${pipelineDir}/test_map.json
5. Review findings (if available)

Classify each finding into one of:
- **Heuristic**: Agent behavior that should be codified as a rule (e.g., "coders tend to miss null checks")
- **Issue**: A real bug or tooling problem that needs fixing
- **Drop**: A one-off occurrence that doesn't warrant a rule

For each finding, specify:
- What happened
- Why it happened (root cause)
- Classification (Heuristic/Issue/Drop)
- Recommended action

${isFullRetro ? `Also analyze:
- Time spent per phase
- Retry count and causes
- Gate failures and their resolution
- Token usage patterns (if available)` : ''}

Project directory: ${projectDir}`,
  {
    label: 'retro-analyze',
    phase: 'Analyze',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              what: { type: 'string' },
              why: { type: 'string' },
              classification: { type: 'string', enum: ['Heuristic', 'Issue', 'Drop'] },
              action: { type: 'string' },
              destination: { type: 'string', enum: ['hot-memory', 'issue', 'knowledge', 'drop'] },
            },
            required: ['what', 'classification', 'action'],
          },
        },
        metrics: {
          type: 'object',
          properties: {
            totalRetries: { type: 'number' },
            gateFailures: { type: 'number' },
            phasesCompleted: { type: 'number' },
          },
        },
      },
      required: ['summary', 'findings'],
    },
  }
)

const findings = analysis?.findings || []
const heuristics = findings.filter(f => f.classification === 'Heuristic')
const issues = findings.filter(f => f.classification === 'Issue')
const drops = findings.filter(f => f.classification === 'Drop')

log(`Retro: ${findings.length} findings — ${heuristics.length} heuristics, ${issues.length} issues, ${drops.length} drops`)

// ── Phase 2: Route outputs ────────────────────────────────────────
phase('Route')

// Route each finding to its destination
const routes = await parallel(
  findings.filter(f => f.classification !== 'Drop').map(finding => {
    const destination = finding.destination ||
      (finding.classification === 'Heuristic' ? 'hot-memory' :
       finding.classification === 'Issue' ? 'issue' : 'knowledge')

    return () => agent(
      `Route this retrospective finding to the appropriate destination.

Finding: ${finding.what}
Root cause: ${finding.why}
Classification: ${finding.classification}
Action: ${finding.action}
Destination: ${destination}

${destination === 'hot-memory' ? `Write to the workspace hot memory file. Add a one-line entry with the heuristic.
Path: ${projectDir}/.agents/hot-memory.md (create if not exists, append if exists)` : ''}

${destination === 'issue' ? `File an issue for this finding. Use the issue-cli if available, or create a markdown issue file.
Include: title, description, root cause, recommended fix.` : ''}

${destination === 'knowledge' ? `Write to the project knowledge base.
Path: ${projectDir}/.agents/knowledge/retro-findings.md (create if not exists, append if exists)` : ''}

Project directory: ${projectDir}`,
      {
        label: `route:${destination}:${finding.what.slice(0, 30)}`,
        phase: 'Route',
        schema: {
          type: 'object',
          properties: {
            destination: { type: 'string' },
            written: { type: 'boolean' },
            path: { type: 'string' },
          },
          required: ['destination', 'written'],
        },
      }
    ).then(r => ({ finding, route: r }))
  })
)

const routed = routes.filter(Boolean).filter(r => r.route?.written)
log(`Routed ${routed.length} findings to destinations`)

// ── Summary ───────────────────────────────────────────────────────
return {
  summary: `Retro complete. ${findings.length} findings: ${heuristics.length} heuristics, ${issues.length} issues, ${drops.length} drops. ${routed.length} routed.`,
  findings: findings.map(f => ({
    what: f.what,
    classification: f.classification,
    action: f.action,
  })),
  heuristics: heuristics.length,
  issues: issues.length,
  drops: drops.length,
  routed: routed.map(r => ({
    finding: r.finding.what,
    destination: r.route.destination,
    path: r.route.path,
  })),
  metrics: analysis?.metrics,
}
