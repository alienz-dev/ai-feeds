#!/bin/bash
# check-spec-approval.sh — PreToolUse hook on Write/Edit tool
# Blocks agents from setting spec status to 'approved' without human sign-off.
# High-severity (P0/P1) and high-complexity (8+) specs require human approval.
#
# Exit 0: allow
# Exit 2: block (prints error to stderr)

set -euo pipefail

# Read the JSON payload from stdin
input=$(cat)

# Extract the file path and content being written
file_path=$(echo "$input" | jq -r '.input.file_path // ""' 2>/dev/null)
content=$(echo "$input" | jq -r '.input.content // .input.new_string // ""' 2>/dev/null)

if [ -z "$file_path" ] || [ -z "$content" ]; then
  exit 0  # No file operation, allow
fi

# Only check spec files
case "$file_path" in
  *specs/*.md|*SPEC-*.md|*spec-*.md) ;;
  *) exit 0 ;;  # Not a spec file, allow
esac

# Check if this edit is trying to set status to 'approved'
if ! echo "$content" | grep -q "status:.*approved"; then
  exit 0  # Not approving, allow
fi

# Check if the spec has P0/P1 severity markers
# Look for the spec file on disk to check its current content
spec_content=""
if [ -f "$file_path" ]; then
  spec_content=$(cat "$file_path")
fi

# Combine existing + new content for analysis
full_content="$spec_content $content"

# Check for high-severity indicators
high_severity=0
if echo "$full_content" | grep -qiE 'severity.*P0|severity.*P1|priority.*critical|priority.*high|security|vulnerability|data.?loss'; then
  high_severity=1
fi

# Check for high-complexity indicators
high_complexity=0
if echo "$full_content" | grep -qiE 'complexity.*[89]|complexity.*10|cross.?cutting|architecture|migration|database.?schema'; then
  high_complexity=1
fi

# Check if approved_by field exists and is non-empty
has_approval=0
if echo "$content" | grep -qE 'approved_by:.+[[:alnum:]]'; then
  has_approval=1
fi

# BLOCK: High-severity or high-complexity without human approval
if [ "$high_severity" -eq 1 ] || [ "$high_complexity" -eq 1 ]; then
  if [ "$has_approval" -eq 0 ]; then
    echo "SPEC APPROVAL BLOCKED: High-severity/high-complexity spec requires human sign-off." >&2
    echo "Add 'approved_by: <your-name>' to the spec frontmatter before setting status to 'approved'." >&2
    echo "Run the grill session first: /grill <spec-topic>" >&2
    exit 2
  fi
fi

exit 0
