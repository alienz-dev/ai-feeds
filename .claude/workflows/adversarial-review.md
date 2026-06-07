export const meta = {
  name: 'adversarial-review',
  description: 'Multi-angle code review with parallel agents and adversarial verification',
  phases: [
    { title: 'Review', detail: '3 parallel reviewers with different lenses' },
    { title: 'Verify', detail: 'adversarial verification of each finding' },
    { title: 'Report', detail: 'synthesis of confirmed findings' },
  ],
}

// Workaround: args arrives as serialized JSON string in workflow runtime
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const target = _args.target || 'the current branch changes'

phase('Review')

const DIMENSIONS = [
  { key: 'correctness', prompt: `Review ${target} for correctness bugs: logic errors, off-by-one, null handling, race conditions, incorrect assumptions. Read the changed files and identify real bugs, not style issues.` },
  { key: 'security', prompt: `Review ${target} for security issues: injection, auth bypass, data exposure, unsafe deserialization, path traversal. Read the changed files and identify real vulnerabilities.` },
  { key: 'maintainability', prompt: `Review ${target} for maintainability issues: dead code, duplicated logic, unclear naming, missing error handling, tight coupling. Read the changed files.` },
]

const reviews = await parallel(
  DIMENSIONS.map(d => () =>
    agent(d.prompt, {
      label: `review:${d.key}`,
      phase: 'Review',
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
                line: { type: 'number' },
                severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
                description: { type: 'string' },
                evidence: { type: 'string' },
              },
              required: ['title', 'file', 'severity', 'description'],
            },
          },
        },
        required: ['findings'],
      },
    })
  )
)

const allFindings = reviews.filter(Boolean).flatMap(r => r.findings)
log(`Found ${allFindings.length} findings across ${reviews.filter(Boolean).length} reviewers`)

if (allFindings.length === 0) {
  log('No findings — clean review')
  return { summary: 'No issues found', findings: [] }
}

phase('Verify')

// Deduplicate by file+title similarity
const seen = new Set()
const unique = allFindings.filter(f => {
  const key = `${f.file}:${f.title.toLowerCase().slice(0, 50)}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

log(`Verifying ${unique.length} unique findings adversarially`)

// Each finding gets 2 independent refuters
const verified = await parallel(
  unique.map(finding => () =>
    agent(
      `You are a skeptical code reviewer. Try to REFUTE this finding. If the finding is real and valid, mark it as confirmed. If you can explain why it's wrong, false, or not a real issue, mark it as refuted.

Finding: ${finding.title}
File: ${finding.file}
Severity: ${finding.severity}
Description: ${finding.description}
Evidence: ${finding.evidence || 'none provided'}

Read the actual code and verify whether this finding is real. Default to refuted if uncertain.`,
      {
        label: `verify:${finding.file}:${finding.title.slice(0, 30)}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          properties: {
            confirmed: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['confirmed', 'reasoning'],
        },
      }
    ).then(v => ({ ...finding, verdict: v }))
  )
)

phase('Report')

const confirmed = verified.filter(Boolean).filter(f => f.verdict?.confirmed)
const refuted = verified.filter(Boolean).filter(f => !f.verdict?.confirmed)

log(`${confirmed.length} confirmed, ${refuted.length} refuted out of ${unique.length} unique findings`)

return {
  summary: `${confirmed.length} confirmed findings out of ${allFindings.length} total (${refuted.length} refuted by adversarial review)`,
  confirmed: confirmed.map(f => ({
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.severity,
    description: f.description,
    verdict: f.verdict.reasoning,
  })),
  refuted: refuted.map(f => ({
    title: f.title,
    file: f.file,
    reason: f.verdict.reasoning,
  })),
}
