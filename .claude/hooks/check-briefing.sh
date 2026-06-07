#!/bin/bash
# check-briefing.sh — PreToolUse hook on Agent tool
# Validates agent briefings follow the information barrier:
# - Coders receive test scripts, not specs
# - Briefings have file boundaries
# - Briefings have verification commands
#
# Exit 0: allow spawn
# Exit 2: block spawn (prints error to stderr)
#
# Only applies to general-purpose and coder agents, not Explore/Plan/Researcher.

set -euo pipefail

# Read the JSON payload from stdin
input=$(cat)

# Extract the prompt and subagent type
prompt=$(echo "$input" | jq -r '.input.prompt // ""' 2>/dev/null)
agent_type=$(echo "$input" | jq -r '.input.subagent_type // ""' 2>/dev/null)

if [ -z "$prompt" ]; then
  exit 0  # No prompt to check, allow
fi

# Only check general-purpose and coder agents
# Explore, Plan, researcher, and other read-only agents don't need test scripts
case "$agent_type" in
  Explore|Plan|researcher)
    exit 0
    ;;
esac

# --- Check for patch wave exception ---
# Patch wave briefings legitimately contain specific AC text for targeted fixes
patch_wave=0
if echo "$prompt" | grep -qiE 'PATCH.WAVE|patch.briefing|alignment.*divergen|alignment.*report|alignment-gate'; then
  patch_wave=1
fi

# --- Check for spec leakage ---
# If the briefing contains acceptance criteria or spec IDs, the barrier leaked
spec_leak=0
if echo "$prompt" | grep -qiE 'acceptance criteria|AC-[0-9]|SPEC-[0-9]|spec/|specs/'; then
  spec_leak=1
fi

# --- Check for test scripts ---
# Coders need test scripts to know what to implement
has_tests=0
if echo "$prompt" | grep -qiE 'test scripts|expected output|expected:.*exit|# Expected'; then
  has_tests=1
fi

# --- Check for file boundaries ---
# Coders need to know which files they can modify
has_files=0
if echo "$prompt" | grep -qiE 'files you may modify|owned files|## Files you may'; then
  has_files=1
fi

# --- Enforcement ---

# BLOCK: Spec leakage — but allow patch wave briefings
# Patch waves legitimately need specific AC text for targeted fixes
if [ "$spec_leak" -eq 1 ] && [ "$patch_wave" -eq 0 ]; then
  echo "BRIEFING ERROR: Contains spec/AC references." >&2
  echo "The information barrier requires: coders receive test scripts, not specs." >&2
  echo "Fix: Remove spec text. Use test scripts with expected outputs only." >&2
  echo "Exception: Patch wave briefings may contain specific AC text." >&2
  echo "  Mark patch briefings with 'PATCH WAVE' header." >&2
  exit 2
fi

# WARN: No test scripts (allow — some tasks don't need tests)
if [ "$has_tests" -eq 0 ]; then
  echo "BRIEFING WARNING: No test scripts found. Consider adding verification commands." >&2
fi

# WARN: No file boundaries (allow — some tasks are broad)
if [ "$has_files" -eq 0 ]; then
  echo "BRIEFING WARNING: No file boundaries specified." >&2
fi

exit 0
