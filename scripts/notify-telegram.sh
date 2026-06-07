#!/bin/bash
# AI Feeds Telegram Notification
# Sends a summary of high-scoring papers to Telegram.
# Usage: ./scripts/notify-telegram.sh [date]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATE="${1:-$(date +%Y-%m-%d)}"
TOKEN=$(pass show telegram/agent-bot-token 2>/dev/null || echo "")
CHAT_ID="8241902980"

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

# Query high-scoring papers from SQLite
DB_PATH="db/ai-feeds.sqlite"
if [[ ! -f "$DB_PATH" ]]; then
  echo "No database found, skipping notification"
  exit 0
fi

# Get counts
TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE';" 2>/dev/null || echo "0")
HIGH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE' AND relevance_score >= 8;" 2>/dev/null || echo "0")
MEDIUM=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM papers WHERE date(first_seen_at) = '$DATE' AND relevance_score = 7;" 2>/dev/null || echo "0")

# Only notify if there are high-scoring papers
if [[ "$HIGH" -eq 0 ]]; then
  echo "No high-scoring papers today, skipping notification"
  exit 0
fi

# Get top 5 papers
TOP_PAPERS=$(sqlite3 -separator '|' "$DB_PATH" "
  SELECT relevance_score, title, url, score_explanation
  FROM papers
  WHERE date(first_seen_at) = '$DATE'
    AND relevance_score >= 7
  ORDER BY relevance_score DESC
  LIMIT 5;
" 2>/dev/null || echo "")

# Build message with clean formatting
MSG="📊 AI Feeds Daily — ${DATE}

━━━━━━━━━━━━━━━━━━━━

📋 Collected: ${TOTAL} papers
🔥 High (8+): ${HIGH}
📌 Medium (7): ${MEDIUM}

━━━━━━━━━━━━━━━━━━━━

🏆 TOP PAPERS
"

IFS=$'\n'
for line in $TOP_PAPERS; do
  SCORE=$(echo "$line" | cut -d'|' -f1)
  TITLE=$(echo "$line" | cut -d'|' -f2)
  URL=$(echo "$line" | cut -d'|' -f3)
  EXPLANATION=$(echo "$line" | cut -d'|' -f4 | head -c 120)

  # Escape HTML special characters
  TITLE=$(html_escape "$TITLE")
  EXPLANATION=$(html_escape "$EXPLANATION")

  # Add score emoji
  if [[ "$SCORE" -ge 9 ]]; then
    SCORE_EMOJI="🔥"
  elif [[ "$SCORE" -ge 8 ]]; then
    SCORE_EMOJI="⭐"
  else
    SCORE_EMOJI="📌"
  fi

  MSG="${MSG}
${SCORE_EMOJI} ${SCORE}/10 — <a href=\"${URL}\">${TITLE}</a>
   ${EXPLANATION}...

"
done

MSG="${MSG}━━━━━━━━━━━━━━━━━━━━
📄 Full digest in your vault"

# Send message
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  --data-urlencode text="${MSG}" \
  -d parse_mode="HTML" \
  -d disable_web_page_preview="true" 2>&1)

# Check response
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✅ Telegram notification sent (${HIGH} high-scoring papers)"
else
  echo "❌ Failed to send Telegram notification"
  echo "$RESPONSE"
  exit 1
fi
