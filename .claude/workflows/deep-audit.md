export const meta = {
  name: 'deep-audit',
  description: 'Comprehensive codebase audit using multi-modal sweep and adversarial verification',
  phases: [
    { title: 'Sweep', detail: 'multi-modal search for issues' },
    { title: 'Verify', detail: 'adversarial verification of findings' },
    { title: 'Report', detail: 'confirmed issues with recommendations' },
  ],
}

// Workaround: args arrives as serialized JSON string in workflow runtime
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const scope = _args.scope || '.'
const focus = _args.focus || 'general quality and security issues'

phase('Sweep')

// Multi-modal sweep — each agent searches a different way
const SWEEPS = [
  { key: 'structure', prompt: `Audit ${scope} for structural issues: circular dependencies, dead code, unused exports, overly complex modules, god files. Focus on: ${focus}` },
  { key: 'security', prompt: `Audit ${scope} for security issues: injection risks, auth bypass, data exposure, unsafe operations, hardcoded secrets. Focus on: ${focus}` },
  { key: 'reliability', prompt: `Audit ${scope} for reliability issues: missing error handling, unhandled promises, race conditions, resource leaks, missing null checks. Focus on: ${focus}` },
  { key: 'testing', prompt: `Audit ${scope} for testing gaps: untested critical paths, missing edge cases, brittle tests, test anti-patterns, missing integration tests. Focus on: ${focus}` },
]

const sweepResults = await parallel(
  SWEEPS.map(sweep => () =>
    agent(sweep.prompt, {
      label: `sweep:${sweep.key}`,
      phase: 'Sweep',
      schema: {
        type: 'object',
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                file: { type: 'string' },
                category: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
                description: { type: 'string' },
                recommendation: { type: 'string' },
              },
              required: ['title', 'severity', 'description'],
            },
          },
        },
        required: ['findings'],
      },
    })
  )
)

const allFindings = sweepResults.filter(Boolean).flatMap(r => r.findings)
log(`Sweep found ${allFindings.length} issues across ${sweepResults.filter(Boolean).length} search modes`)

if (allFindings.length === 0) {
  return { summary: 'No issues found', findings: [] }
}

phase('Verify')

// Deduplicate
const seen = new Set()
const unique = allFindings.filter(f => {
  const key = `${f.file || 'global'}:${f.title.toLowerCase().slice(0, 50)}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

log(`Verifying ${unique.length} unique findings`)

// Loop-until-dry: verify until no new findings survive
let confirmed = []
let round = 0
const MAX_ROUNDS = 3

while (round < MAX_ROUNDS) {
  round++
  const batch = unique.filter(f => !confirmed.find(c => c.title === f.title))

  if (batch.length === 0) break

  const verdicts = await parallel(
    batch.slice(0, 20).map(finding => () =>
      agent(
        `Skeptically verify this audit finding. Try to refute it. If the code actually has this issue, confirm it. If the finding is wrong or overstated, refute it.

Finding: ${finding.title}
File: ${finding.file || 'N/A'}
Category: ${finding.category}
Severity: ${finding.severity}
Description: ${finding.description}

Read the actual code and verify.`,
        {
          label: `verify:${finding.title.slice(0, 40)}`,
          phase: 'Verify',
          schema: {
            type: 'object',
            properties: {
              confirmed: { type: 'boolean' },
              reasoning: { type: 'string' },
              adjustedSeverity: { type: 'string', enum: ['critical', 'major', 'minor'] },
            },
            required: ['confirmed', 'reasoning'],
          },
        }
      ).then(v => ({ ...finding, verdict: v }))
    )
  )

  const newlyConfirmed = verdicts.filter(Boolean).filter(f => f.verdict?.confirmed)
  confirmed.push(...newlyConfirmed)
  log(`Round ${round}: ${newlyConfirmed.length} confirmed, ${confirmed.length} total`)
}

phase('Report')

const critical = confirmed.filter(f => (f.verdict?.adjustedSeverity || f.severity) === 'critical')
const major = confirmed.filter(f => (f.verdict?.adjustedSeverity || f.severity) === 'major')
const minor = confirmed.filter(f => (f.verdict?.adjustedSeverity || f.severity) === 'minor')

return {
  summary: `Audit complete. ${confirmed.length} confirmed issues: ${critical.length} critical, ${major.length} major, ${minor.length} minor.`,
  critical: critical.map(f => ({
    title: f.title,
    file: f.file,
    description: f.description,
    recommendation: f.recommendation,
    verdict: f.verdict.reasoning,
  })),
  major: major.map(f => ({
    title: f.title,
    file: f.file,
    description: f.description,
    recommendation: f.recommendation,
  })),
  minor: minor.map(f => ({
    title: f.title,
    file: f.file,
    description: f.description,
  })),
  refuted: unique.length - confirmed.length,
}
