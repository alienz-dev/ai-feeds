#!/bin/bash
# AI Feeds Telegram Notification
# Sends a summary of high-scoring papers to Telegram with links to article pages.
# Usage: ./scripts/notify-telegram.sh [date]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATE="${1:-$(date +%Y-%m-%d)}"
TOKEN=$(pass show telegram/agent-bot-token 2>/dev/null || echo "")
CHAT_ID="8241902980"
DOMAIN="signals.mingli.world"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Could not retrieve Telegram bot token from pass"
  exit 1
fi

# HTML escape function
html_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  echo "$s"
}

# Slugify title for URL
slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-80
}

# Query high-scoring papers from SQLite
DB_PATH="db/ai-feeds.sqlite"
if [[ ! -f "$DB_PATH" ]]; then
  echo "No database found, skipping notification"
  exit 0
fi

# Get counts
TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE';" 2>/dev/null || echo "0")
HIGH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE' AND relevance_score >= 9;" 2>/dev/null || echo "0")
MEDIUM=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE' AND relevance_score = 8;" 2>/dev/null || echo "0")
LOW=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE' AND relevance_score = 7;" 2>/dev/null || echo "0")

# Only notify if there are high-scoring papers
if [[ "$((HIGH + MEDIUM))" -eq 0 ]]; then
  echo "No high-scoring papers today, skipping notification"
  exit 0
fi

# Get score 9+ papers
TOP_PAPERS=$(sqlite3 -separator '|' "$DB_PATH" "
  SELECT relevance_score, title, score_explanation
  FROM papers
  WHERE date(first_seen_at) = '$DATE'
    AND relevance_score >= 9
  ORDER BY relevance_score DESC;
" 2>/dev/null || echo "")

# Get score 8 papers
GOOD_PAPERS=$(sqlite3 -separator '|' "$DB_PATH" "
  SELECT relevance_score, title
  FROM papers
  WHERE date(first_seen_at) = '$DATE'
    AND relevance_score = 8
  ORDER BY relevance_score DESC
  LIMIT 5;
" 2>/dev/null || echo "")

# Build message
MSG="📡 AI Signals — ${DATE}
"

# Top picks (9+)
if [[ -n "$TOP_PAPERS" ]]; then
  MSG="${MSG}
🔥 TOP PICKS (${HIGH})
"
  IFS=$'\n'
  for line in $TOP_PAPERS; do
    SCORE=$(echo "$line" | cut -d'|' -f1)
    TITLE=$(echo "$line" | cut -d'|' -f2)
    EXPLANATION=$(echo "$line" | cut -d'|' -f3 | head -c 80)

    TITLE=$(html_escape "$TITLE")
    EXPLANATION=$(html_escape "$EXPLANATION")
    SLUG=$(slugify "$TITLE")

    MSG="${MSG}• ${TITLE}
  ${EXPLANATION}
  → https://${DOMAIN}/article/${SLUG}
"
  done
fi

# Worth reading (8)
if [[ -n "$GOOD_PAPERS" ]]; then
  MSG="${MSG}
⭐ WORTH READING (${MEDIUM})
"
  IFS=$'\n'
  for line in $GOOD_PAPERS; do
    SCORE=$(echo "$line" | cut -d'|' -f1)
    TITLE=$(echo "$line" | cut -d'|' -f2)

    TITLE=$(html_escape "$TITLE")
    SLUG=$(slugify "$TITLE")

    MSG="${MSG}• ${TITLE}
  → https://${DOMAIN}/article/${SLUG}
"
  done
fi

# Also noted (7)
if [[ "$LOW" -gt 0 ]]; then
  MSG="${MSG}
📌 ALSO NOTED (${LOW})
"
  # Get first 5 titles for preview
  NOTED_TITLES=$(sqlite3 -separator ' • ' "$DB_PATH" "
    SELECT substr(title, 1, 30)
    FROM papers
    WHERE date(first_seen_at) = '$DATE'
      AND relevance_score = 7
    ORDER BY relevance_score DESC
    LIMIT 5;
  " 2>/dev/null || echo "")

  if [[ -n "$NOTED_TITLES" ]]; then
    MSG="${MSG}${NOTED_TITLES}"
    if [[ "$LOW" -gt 5 ]]; then
      MSG="${MSG} +$((LOW - 5)) more"
    fi
  fi
fi

MSG="${MSG}
🔗 Full digest: https://${DOMAIN}/${DATE}"

# Send message (plain text, no HTML parsing needed)
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  --data-urlencode text="${MSG}" \
  -d disable_web_page_preview="true" 2>&1)

# Check response
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✅ Telegram notification sent (${HIGH + MEDIUM} high-scoring papers)"
else
  echo "❌ Failed to send Telegram notification"
  echo "$RESPONSE"
  exit 1
fi
