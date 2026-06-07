#!/bin/bash
# AI Feeds Daily Pipeline
# Runs collectors, scorer, ingest, and digest generation.
# Usage: ./scripts/daily-pipeline.sh [--skip-scorer]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="logs/daily-${DATE}.log"
mkdir -p logs

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== AI Feeds Daily Pipeline — ${DATE} ==="
echo "Started at $(date)"

# 1. Run collectors
echo ""
echo "--- Running collectors ---"
for collector in arxiv huggingface hn reddit devto github producthunt; do
  echo "  Running ${collector}..."
  npx tsx "collectors/${collector}.ts" 2>&1 || echo "  WARNING: ${collector} failed (continuing)"
done

# 2. Run scorer (if API key is set and --skip-scorer not passed)
if [[ "${1:-}" != "--skip-scorer" ]]; then
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]] || [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo ""
    echo "--- Running LLM scorer ---"
    npx tsx processor/scorer.ts --input collectors/output/ 2>&1 || echo "  WARNING: scorer failed"
  else
    echo ""
    echo "--- Skipping scorer (no API key set) ---"
  fi
else
  echo ""
  echo "--- Skipping scorer (--skip-scorer) ---"
fi

# 3. Ingest into database
echo ""
echo "--- Ingesting into database ---"
npx tsx db/ingest.ts --input collectors/output/ 2>&1 || echo "  WARNING: collector ingest failed"
if [[ -d "processor/output" ]] && [[ -n "$(ls processor/output/*.json 2>/dev/null)" ]]; then
  npx tsx db/ingest.ts --input processor/output/ 2>&1 || echo "  WARNING: scorer ingest failed"
fi

# 4. Generate digest
echo ""
echo "--- Generating digest ---"
npx tsx db/digest.ts --date "$DATE" 2>&1 || echo "  WARNING: digest failed"

# 5. Generate learning issues (if scorer ran)
if [[ "${1:-}" != "--skip-scorer" ]] && [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]]; then
  echo ""
  echo "--- Generating learning issues ---"
  npx tsx processor/issue_generator.ts --limit 5 2>&1 || echo "  WARNING: issue generator failed"
fi

echo ""
echo "=== Pipeline complete at $(date) ==="
