#!/bin/bash
# block-dangerous.sh — PreToolUse hook to block dangerous bash commands
# Receives JSON on stdin from Claude Code hook system
# Exit 2 = block the tool call, Exit 0 = allow
#
# Tested on macOS bash 3.2 and Linux bash 5+.
# Uses grep -E (ERE) for portability — no PCRE features like (?!...).

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // empty')
COMMAND=$(echo "$INPUT" | jq -r '.input.command // empty')

[ "$TOOL" != "Bash" ] && exit 0
[ -z "$COMMAND" ] && exit 0

# --- Violation logging + block helper ---
block() {
  local pattern="$1"
  mkdir -p "${HOME}/.claude"
  echo "${pattern}|${COMMAND}|$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${HOME}/.claude/hook-violations.log"
  echo "BLOCKED: $pattern" >&2
  echo "Command: $COMMAND" >&2
  exit 2
}

# --- rm -rf checks ---
_rm_targets() { echo "$COMMAND" | grep -oE 'rm[[:space:]]+-[a-z]*f[a-z]*[[:space:]]+[^;|&]+' 2>/dev/null || true; }
_targets=$(_rm_targets)

if [ -n "$_targets" ]; then
  echo "$_targets" | grep -qE '/[[:space:]]*$|/[[:space:]];' && block "rm -rf targeting root directory"
  echo "$_targets" | grep -qE '~[[:space:]]*$|~[[:space:];/|]' && block "rm -rf targeting home directory"
  if echo "$_targets" | grep -qE '\.[[:space:]]*$|\.[[:space:];/|&]'; then
    echo "$_targets" | grep -qE '\./' || block "rm -rf targeting current directory"
  fi
  echo "$_targets" | grep -qE '\*[[:space:]]*$|\*[[:space:];/|&]' && block "rm -rf with wildcard"
fi

# --- git push --force ---
if echo "$COMMAND" | grep -qE 'git[[:space:]]+push'; then
  if echo "$COMMAND" | grep -qE -- '--force'; then
    echo "$COMMAND" | grep -qE -- '--force-with-lease' || block "git push --force (use --force-with-lease)"
  fi
  echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+-f([[:space:]]|$)' && block "git push -f (use --force-with-lease)"
fi

# --- Other dangerous patterns ---
echo "$COMMAND" | grep -qE -- '--pool[[:space:]]+forks' && block "vitest --pool forks causes OOM"
echo "$COMMAND" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard' && block "git reset --hard discards uncommitted work"
echo "$COMMAND" | grep -qE 'git[[:space:]]+clean[[:space:]]+-f' && block "git clean removes untracked files"
echo "$COMMAND" | grep -qE 'git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.' && block "git checkout -- . discards all changes"
echo "$COMMAND" | grep -qE 'mkfs' && block "mkfs destroys filesystem"
echo "$COMMAND" | grep -qE 'dd[[:space:]]+if=' && block "dd can overwrite disks"
echo "$COMMAND" | grep -qE 'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+(/|~)' && block "chmod -R 777 on root/home"
echo "$COMMAND" | grep -qE 'kill[[:space:]]+-9[[:space:]]+-1' && block "kill -9 -1 kills all processes"
echo "$COMMAND" | grep -qE 'npm[[:space:]]+publish' && block "npm publish sends to registry"

exit 0
