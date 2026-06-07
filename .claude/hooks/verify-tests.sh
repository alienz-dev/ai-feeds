#!/bin/bash
# verify-tests.sh — Stop hook to verify tests pass before allowing stop
# Receives JSON on stdin from Claude Code hook system
# Exit 2 = block stop (tests failed), Exit 0 = allow stop
#
# Only runs when:
# 1. package.json exists (project has tests)
# 2. vitest.config.ts/js exists (vitest is configured)
# 3. Tests were likely modified this session (not every stop)

set -euo pipefail

# Only run if package.json exists
if [ ! -f "package.json" ]; then
  exit 0
fi

# Check if vitest is configured
if [ ! -f "vitest.config.ts" ] && [ ! -f "vitest.config.js" ]; then
  exit 0
fi

# Only run if there are uncommitted changes to test files
# This prevents running tests on every stop (e.g., when just answering questions)
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
  changed_files=$(git diff --name-only 2>/dev/null || true)
  test_changed=$(echo "$changed_files" | grep -c "test\|spec" 2>/dev/null || echo "0")
  if [ "$test_changed" -eq 0 ]; then
    # No test files changed — skip verification
    exit 0
  fi
fi

# Run tests with timeout (5 minutes max)
echo "Running test verification..." >&2
TIMEOUT=300

if command -v timeout &>/dev/null; then
  # Linux
  if timeout "$TIMEOUT" npx vitest run --reporter=verbose 2>&1; then
    echo "Tests passed." >&2
    exit 0
  else
    echo "BLOCKED: Tests failed. Fix failing tests before stopping." >&2
    exit 2
  fi
elif command -v gtimeout &>/dev/null; then
  # macOS with coreutils
  if gtimeout "$TIMEOUT" npx vitest run --reporter=verbose 2>&1; then
    echo "Tests passed." >&2
    exit 0
  else
    echo "BLOCKED: Tests failed. Fix failing tests before stopping." >&2
    exit 2
  fi
else
  # No timeout available — run without it
  if npx vitest run --reporter=verbose 2>&1; then
    echo "Tests passed." >&2
    exit 0
  else
    echo "BLOCKED: Tests failed. Fix failing tests before stopping." >&2
    exit 2
  fi
fi
