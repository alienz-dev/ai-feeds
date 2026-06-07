export const meta = {
  name: 'research-crosscheck',
  description: 'Multi-angle research with cross-checked sources and cited report',
  phases: [
    { title: 'Search', detail: 'parallel searches from different angles' },
    { title: 'Cross-check', detail: 'verify claims against sources' },
    { title: 'Report', detail: 'synthesized findings with citations' },
  ],
}

// Workaround: args arrives as serialized JSON string in workflow runtime
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const question = _args.question || (typeof args === 'string' ? args : null) || 'No question provided'

if (question === 'No question provided') {
  return { error: 'Pass a question via args' }
}

phase('Search')

// Fan out searches from different angles
const ANGLES = [
  { key: 'official', prompt: `Find official documentation and authoritative sources about: ${question}. Focus on primary sources — docs, specs, RFCs, official blog posts.` },
  { key: 'community', prompt: `Find community perspectives and real-world experience about: ${question}. Focus on blog posts, conference talks, GitHub discussions, Stack Overflow.` },
  { key: 'comparison', prompt: `Find comparisons, benchmarks, and trade-off analyses about: ${question}. Focus on head-to-head comparisons, migration guides, performance data.` },
]

const searchResults = await parallel(
  ANGLES.map(angle => () =>
    agent(angle.prompt, {
      label: `search:${angle.key}`,
      phase: 'Search',
      schema: {
        type: 'object',
        properties: {
          claims: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                source: { type: 'string' },
                url: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['claim', 'source'],
            },
          },
        },
        required: ['claims'],
      },
    })
  )
)

const allClaims = searchResults.filter(Boolean).flatMap(r => r.claims)
log(`Found ${allClaims.length} claims across ${searchResults.filter(Boolean).length} search angles`)

phase('Cross-check')

// Deduplicate claims
const seen = new Set()
const uniqueClaims = allClaims.filter(c => {
  const key = c.claim.toLowerCase().slice(0, 80)
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

log(`Cross-checking ${uniqueClaims.length} unique claims`)

// Cross-check each claim against other sources
const crossChecked = await parallel(
  uniqueClaims.map(claim => () =>
    agent(
      `Cross-check this claim against other sources. Is it supported, contradicted, or unverifiable?

Claim: "${claim.claim}"
Original source: ${claim.source}
URL: ${claim.url || 'N/A'}

Search for corroborating or contradicting evidence. Be skeptical.`,
      {
        label: `check:${claim.claim.slice(0, 40)}`,
        phase: 'Cross-check',
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['supported', 'contradicted', 'unverifiable'] },
            evidence: { type: 'string' },
            additionalSources: { type: 'array', items: { type: 'string' } },
          },
          required: ['status', 'evidence'],
        },
      }
    ).then(v => ({ ...claim, crosscheck: v }))
  )
)

phase('Report')

const supported = crossChecked.filter(Boolean).filter(c => c.crosscheck?.status === 'supported')
const contradicted = crossChecked.filter(Boolean).filter(c => c.crosscheck?.status === 'contradicted')
const unverifiable = crossChecked.filter(Boolean).filter(c => c.crosscheck?.status === 'unverifiable')

log(`${supported.length} supported, ${contradicted.length} contradicted, ${unverifiable.length} unverifiable`)

return {
  question,
  summary: `Research complete. ${supported.length} claims supported, ${contradicted.length} contradicted, ${unverifiable.length} unverifiable out of ${uniqueClaims.length} total.`,
  findings: supported.map(c => ({
    claim: c.claim,
    source: c.source,
    url: c.url,
    evidence: c.crosscheck.evidence,
    additionalSources: c.crosscheck.additionalSources,
  })),
  contradictions: contradicted.map(c => ({
    claim: c.claim,
    originalSource: c.source,
    contradictingEvidence: c.crosscheck.evidence,
  })),
  unverifiable: unverifiable.map(c => ({
    claim: c.claim,
    source: c.source,
    reason: c.crosscheck.evidence,
  })),
}
