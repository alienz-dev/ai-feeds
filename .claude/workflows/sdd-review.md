export const meta = {
  name: 'sdd-review',
  description: 'SDD multi-perspective review with adversarial verification',
  phases: [
    { title: 'Review', detail: 'parallel reviewers with different lenses' },
    { title: 'Verify', detail: 'adversarial verification of findings' },
    { title: 'Verdict', detail: 'synthesize APPROVE/REJECT' },
  ],
}

// Workaround: args arrives as serialized JSON string
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const specPath = _args.specPath
const changedFiles = _args.changedFiles || []
const complexity = _args.complexity || 5
const projectDir = _args.projectDir || '.'
const maxRetries = 2

if (!specPath) {
  return { error: 'Missing required arg: specPath' }
}

// ── Select review tier ─────────────────────────────────────────────
const isFullReview = complexity >= 8
const reviewerType = isFullReview ? 'reviewer' : 'reviewer-lite'

log(`Review tier: ${reviewerType} (complexity: ${complexity})`)

// ── Phase 1: Review ───────────────────────────────────────────────
phase('Review')

let reviewResults

if (isFullReview) {
  // Full review: 3 parallel reviewers with different lenses
  const LENSES = [
    { key: 'security', prompt: `Security review of changes to implement ${specPath}.
Changed files: ${changedFiles.join(', ')}
Check for: injection, auth bypass, data exposure, unsafe operations, hardcoded secrets.
Project directory: ${projectDir}` },
    { key: 'correctness', prompt: `Correctness review of changes to implement ${specPath}.
Changed files: ${changedFiles.join(', ')}
Check for: logic errors, off-by-one, null handling, race conditions, incorrect assumptions.
Project directory: ${projectDir}` },
    { key: 'quality', prompt: `Design & quality review of changes to implement ${specPath}.
Changed files: ${changedFiles.join(', ')}
Check for: code duplication, unclear naming, missing error handling, tight coupling, testability.
Project directory: ${projectDir}` },
  ]

  reviewResults = await parallel(
    LENSES.map(lens => () =>
      agent(lens.prompt, {
        label: `review:${lens.key}`,
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
                },
                required: ['title', 'severity', 'description'],
              },
            },
            sectionPass: { type: 'boolean' },
          },
          required: ['findings', 'sectionPass'],
        },
      })
    )
  )
} else {
  // Reviewer-lite: single 3-section review
  reviewResults = [await agent(
    `Review the implementation of ${specPath}.
Changed files: ${changedFiles.join(', ')}
Project directory: ${projectDir}

Review three sections:
1. Bug Hunter: logic errors, null handling, edge cases
2. Security: injection, auth, data exposure
3. Design & Quality: naming, coupling, error handling

Return findings per section with pass/fail verdict.`,
    {
      label: 'review-lite',
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
                severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
                description: { type: 'string' },
              },
              required: ['title', 'severity', 'description'],
            },
          },
          sectionPass: { type: 'boolean' },
          sections: {
            type: 'object',
            properties: {
              bugHunter: { type: 'boolean' },
              security: { type: 'boolean' },
              designQuality: { type: 'boolean' },
            },
          },
        },
        required: ['findings', 'sectionPass'],
      },
    }
  )]
}

const allFindings = reviewResults.filter(Boolean).flatMap(r => r.findings || [])
const allSectionsPass = reviewResults.every(r => r?.sectionPass)

log(`Review: ${allFindings.length} findings, sections ${allSectionsPass ? 'PASS' : 'FAIL'}`)

// ── Phase 2: Adversarial verify ───────────────────────────────────
phase('Verify')

let verifiedFindings = allFindings

if (allFindings.length > 0) {
  // Deduplicate
  const seen = new Set()
  const unique = allFindings.filter(f => {
    const key = `${f.file || 'global'}:${f.title.toLowerCase().slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Verify each finding adversarially
  const verdicts = await parallel(
    unique.slice(0, 10).map(finding => () =>
      agent(
        `Skeptically verify this review finding. Try to refute it.
If the code actually has this issue, confirm it.

Finding: ${finding.title}
File: ${finding.file || 'N/A'}
Severity: ${finding.severity}
Description: ${finding.description}
Project directory: ${projectDir}`,
        {
          label: `verify:${finding.title.slice(0, 30)}`,
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

  verifiedFindings = verdicts.filter(Boolean).filter(f => f.verdict?.confirmed)
  log(`Adversarial verify: ${verifiedFindings.length}/${unique.length} confirmed`)
}

// ── Phase 3: Verdict ──────────────────────────────────────────────
phase('Verdict')

const criticalFindings = verifiedFindings.filter(f => f.severity === 'critical')
const majorFindings = verifiedFindings.filter(f => f.severity === 'major')

const verdict = criticalFindings.length > 0 ? 'REJECT' :
                majorFindings.length > 2 ? 'REJECT' :
                allSectionsPass ? 'APPROVE' : 'REJECT'

log(`Verdict: ${verdict} (${criticalFindings.length} critical, ${majorFindings.length} major)`)

return {
  verdict,
  findings: verifiedFindings.map(f => ({
    title: f.title,
    file: f.file,
    severity: f.severity,
    description: f.description,
    confirmed: f.verdict?.reasoning,
  })),
  criticalCount: criticalFindings.length,
  majorCount: majorFindings.length,
  minorCount: verifiedFindings.filter(f => f.severity === 'minor').length,
  reviewTier: reviewerType,
  sectionsPass: allSectionsPass,
}
