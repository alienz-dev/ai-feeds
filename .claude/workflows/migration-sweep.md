export const meta = {
  name: 'migration-sweep',
  description: 'Codebase-wide migration: discover targets, transform in isolation, verify',
  phases: [
    { title: 'Discover', detail: 'find all files needing migration' },
    { title: 'Transform', detail: 'migrate each file in worktree isolation' },
    { title: 'Verify', detail: 'check each migration succeeded' },
  ],
}

// Workaround: args arrives as serialized JSON string in workflow runtime
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const migration = _args.migration || 'the requested migration'
const scope = _args.scope || '.'

phase('Discover')

const discovery = await agent(
  `Find all files in ${scope} that need this migration: ${migration}. List every file with a brief note on what needs to change. Be thorough — check imports, tests, configs, and documentation too.`,
  {
    label: 'discover:targets',
    phase: 'Discover',
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              changeType: { type: 'string' },
              complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] },
            },
            required: ['path', 'changeType'],
          },
        },
      },
      required: ['files'],
    },
  }
)

const files = discovery?.files || []
log(`Found ${files.length} files needing migration`)

if (files.length === 0) {
  return { summary: 'No files found needing migration', files: [] }
}

phase('Transform')

// Transform files in parallel with worktree isolation
const transforms = await pipeline(
  files,
  file => agent(
    `Migrate this file: ${file.path}
Migration: ${migration}
Change type: ${file.changeType}
Complexity: ${file.complexity}

Apply the migration. Preserve existing behavior. Update imports, types, and tests as needed.`,
    {
      label: `transform:${file.path.split('/').pop()}`,
      phase: 'Transform',
      isolation: 'worktree',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          changes: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['success'],
      },
    }
  ),
  // Stage 2: verify each transform
  (result, file) => {
    if (!result?.success) return Promise.resolve(null)
    return agent(
      `Verify the migration of ${file.path} was correct. Check: (1) syntax is valid, (2) imports resolve, (3) behavior is preserved, (4) no regressions introduced.`,
      {
        label: `verify:${file.path.split('/').pop()}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['valid'],
        },
      }
    ).then(v => ({ file: file.path, transform: result, verification: v }))
  }
)

phase('Report')

const succeeded = transforms.filter(Boolean).filter(t => t?.verification?.valid)
const failed = transforms.filter(Boolean).filter(t => !t?.verification?.valid)
const skipped = transforms.filter(t => t === null)

log(`${succeeded.length} succeeded, ${failed.length} failed, ${skipped.length} skipped`)

return {
  summary: `Migration: ${migration}. ${succeeded.length}/${files.length} files migrated successfully.`,
  succeeded: succeeded.map(t => ({ file: t.file, changes: t.transform.changes })),
  failed: failed.map(t => ({ file: t.file, issues: t.verification?.issues })),
  skipped: skipped.length,
}
