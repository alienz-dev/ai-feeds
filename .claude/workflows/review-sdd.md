export const meta = {
  name: 'review-sdd',
  description: 'Multi-angle review of SDD methodology with parallel agents and synthesis',
  phases: [
    { title: 'Review', detail: 'parallel agents review different aspects' },
    { title: 'Synthesize', detail: 'consolidate findings into recommendations' },
  ],
}

phase('Review')

const reviews = await parallel([
  () => agent(
    `Review the SDD methodology files in /Users/ding/projects/dev-kit/workflow/sdd/ — focus on the spec lifecycle (draft → approved → implementing → verified → shipped). Identify any gaps or ambiguities in the state transitions. Read the main SDD.md and SPEC-CHANGE.md files.`,
    { label: 'review:spec-lifecycle', phase: 'Review', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, description: { type: 'string' } } } } }, required: ['findings'] } }
  ),
  () => agent(
    `Review the TRIO protocol in /Users/ding/projects/dev-kit/workflow/trio/ — focus on the information barrier (coders never see spec, only tests). Evaluate the gate system (RED → GREEN → wiring → visual → wave-smoke → hidden → alignment → activation → review). Identify any enforcement gaps. Read the main TRIO.md file.`,
    { label: 'review:trio-gates', phase: 'Review', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, description: { type: 'string' } } } } }, required: ['findings'] } }
  ),
  () => agent(
    `Review the pipeline enforcement in /Users/ding/projects/dev-kit/workflow/pipeline/ — focus on what IS code-enforced (gate.sh, lefthook) vs what is prompt-only (role spawn, write scope, stall detection). Read PIPELINE-ENFORCEMENT.md and gate.sh. Identify the biggest enforcement gaps.`,
    { label: 'review:enforcement', phase: 'Review', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, description: { type: 'string' } } } } }, required: ['findings'] } }
  ),
])

phase('Synthesize')

const synthesis = await agent(
  `Synthesize these three review findings into a prioritized action plan. Group by severity (critical first), deduplicate overlapping findings, and for each recommendation specify: (1) what to change, (2) why it matters, (3) estimated effort (small/medium/large). Reviews: ${JSON.stringify(reviews, null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: { type: 'object', properties: { summary: { type: 'string' }, recommendations: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' }, effort: { type: 'string' } } } } }, required: ['summary', 'recommendations'] } }
)

return synthesis
