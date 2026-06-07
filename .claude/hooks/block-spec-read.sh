#!/bin/bash
# block-spec-read.sh — PreToolUse hook on Read tool
# Blocks coder agents from reading specs/ directory.
# Enforces the information barrier: coders never see the spec.
#
# Exit 0: allow read
# Exit 2: block read (prints error to stderr)

set -euo pipefail

# Read the JSON payload from stdin
input=$(cat)

# Extract the file path being read and the agent type
file_path=$(echo "$input" | jq -r '.input.file_path // ""' 2>/dev/null)
agent_type=$(echo "$input" | jq -r '.input.subagent_type // ""' 2>/dev/null)

if [ -z "$file_path" ]; then
  exit 0  # No file path, allow
fi

# Only block coder agents
if [ "$agent_type" != "coder" ]; then
  exit 0  # Not a coder, allow
fi

# Check if the path is in specs/ directory
case "$file_path" in
  */specs/*|*specs/*|specs/*)
    echo "INFORMATION BARRIER: Coders cannot read spec files." >&2
    echo "The spec is encoded in the tests. Work from tests only." >&2
    echo "Blocked: $file_path" >&2
    exit 2
    ;;
  */SPEC-*|*SPEC-*.md)
    echo "INFORMATION BARRIER: Coders cannot read spec files." >&2
    echo "The spec is encoded in the tests. Work from tests only." >&2
    echo "Blocked: $file_path" >&2
    exit 2
    ;;
esac

exit 0
