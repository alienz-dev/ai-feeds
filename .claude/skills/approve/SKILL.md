---
description: Approve a spec for implementation. Sets status to approved after validation.
user-invocable: true
argument-hint: <spec-file>
---

# Approve Spec: $ARGUMENTS

You approve a spec for implementation. This is the bridge between design phase and implementation phase.

## Steps

### 1. Validate the spec
```bash
bash workflow/sdd/validate-spec.sh "$ARGUMENTS"
```
If FAIL → tell user to fix errors first. Do not approve.

### 2. Check grill occurred
Read the spec file. Check if the Clarifications section (§6 or "Clarifications") has content.
- If non-empty → grill occurred, proceed
- If empty → warn: "Spec has no clarifications. Was a grill session run? Proceeding anyway, but consider running /grill first."

### 3. Check ba-validate passed
Run the ba-validate skill's Phase 1 (structural) checks:
```bash
bash workflow/sdd/validate-spec.sh "$ARGUMENTS"
```
If WARN → list warnings, ask user to confirm
If PASS → proceed

### 4. Set status to approved
Edit the spec file's frontmatter:
```yaml
status: approved
approved_by: <user or "auto">
approval_date: <today's date>
```

### 5. Report
```
Spec approved: $ARGUMENTS
  Status: draft → approved
  Approved by: <user>
  Next: run /sdd <feature> to implement
```

## Rules
- Never approve a spec with FAIL validation
- Warn on empty Clarifications but don't block
- Set approved_by and approval_date in frontmatter
- After approval, tell the user to run /sdd to implement
