# SPEC-PRODUCTHUNT: Product Hunt Collector (CDP-based)

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 5 (Medium)
**Phase:** 3.3 — Industry Sources

---

## 1. Intent

Scrape Product Hunt daily leaderboard using Chrome DevTools Protocol (CDP). No OAuth required — connects to the user's existing Chrome automation profile which has active sessions.

**In scope:** CDP connection, page navigation, DOM scraping, data extraction, Paper interface mapping.

**Out of scope:** OAuth2 GraphQL API, upvote-based filtering, comments/discussions.

---

## 2. Approach

ProductHunt requires OAuth for their GraphQL API. Instead of OAuth, we use CDP to connect to the user's existing Chrome instance (port 9222) which already has a logged-in session.

**URL pattern:** `https://www.producthunt.com/leaderboard/daily/{YYYY}/{M}/{D}`

**Tool:** Playwright's `chromium.connectOverCDP('http://localhost:9222')` — connects to existing Chrome, doesn't launch new instance.

---

## 3. Acceptance Criteria

**AC-1: CDP connection**
THE collector SHALL connect to Chrome via CDP at `http://localhost:9222`.
IF Chrome is not running, THE collector SHALL log an error and exit 1.

**AC-2: Navigate and scrape**
THE collector SHALL navigate to `https://www.producthunt.com/leaderboard/daily/{today}`.
THE collector SHALL wait for product cards to load.
THE collector SHALL extract: product name, tagline, description, score (upvotes), comments, PH URL, external URL, topics.

**AC-3: Map to Paper interface**
THE collector SHALL map extracted data to the Paper interface:
- `id`: PH product slug
- `title`: product name
- `abstract`: tagline + description
- `url`: PH product URL
- `pdf_url`: "" (no PDF)
- `authors`: [] (PH doesn't show individual authors on leaderboard)
- `categories`: topic tags
- `primary_category`: "producthunt"
- `published`: today's date
- `updated`: today's date

**AC-4: Output**
THE collector SHALL write to `collectors/output/producthunt-YYYY-MM-DD.json`.
Same format as other collectors (source, fetched_at, total_results, warnings, papers).

**AC-5: CLI**
`npx tsx collectors/producthunt.ts --dry-run --days <n> --verbose --help`
`--days`: how many days back to scrape (default: 1)

**AC-6: Rate limiting**
THE collector SHALL add a 2-second delay between page navigations when scraping multiple days.

---

## 4. Implementation Notes

### Dependencies
- `playwright` — for CDP connection and DOM interaction
- Install: `npm install playwright`

### File Structure
```
collectors/
  producthunt-client.ts  — CDP scraping logic
  producthunt.ts         — main collector + CLI
tests/
  producthunt.test.ts    — tests with mocked page
```

### DOM Selectors (to be verified via CDP inspection)
Product cards on the leaderboard page contain:
- Product name: link text
- Tagline: text below name
- Score: vote count number
- Comments: comment count
- Topics: category tags
- URLs: href attributes

### Key Pattern
```typescript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = await context.newPage();
await page.goto(url);
// ... scrape ...
await page.close();
```
