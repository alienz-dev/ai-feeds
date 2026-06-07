# SPEC-ROLLUP: Weekly Rollup

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 5 (Medium)
**Phase:** 4.3 — Learning Pipeline

---

## 1. Intent

Aggregate daily signals into a weekly summary. Show trends, top papers, knowledge gaps, and learning progress over the past 7 days.

**In scope:** Query SQLite for weekly data, generate summary markdown.

**Out of scope:** Preference learning, automated scheduling, email delivery.

---

## 2. Acceptance Criteria

**AC-1: Query weekly data**
THE rollup SHALL query SQLite for papers ingested in the last 7 days.

**AC-2: Generate statistics**
THE rollup SHALL compute:
- Total papers ingested
- Papers scored 8+ (high relevance)
- Papers scored 7 (medium relevance)
- Top 5 papers by score
- Category distribution (top 5 categories)
- Source distribution (arxiv vs huggingface vs others)

**AC-3: Generate markdown**
THE rollup SHALL write Obsidian-compatible markdown with:
- YAML frontmatter (title, topic, type, signal-source, created)
- Summary statistics table
- Top papers table
- Category breakdown
- Source breakdown

**AC-4: CLI**
`npx tsx processor/rollup.ts --db <path> [--weeks <n>] [--output <path>] [--verbose]`

**AC-5: Output path**
Default: `{vault_path}/YYYY-Www-rollup.md` (ISO week format)

---

## 3. Implementation Notes

### File Structure
```
processor/
  rollup.ts   # Main rollup + CLI
```

### Output Format
```markdown
---
title: "Weekly Rollup YYYY-Www"
topic: wikis
type: signal
signal-source: rollup
created: YYYY-MM-DD
---

# Weekly Rollup — YYYY-Www

## Summary
| Metric | Value |
|--------|-------|
| Papers ingested | 150 |
| High relevance (8+) | 23 |
| Medium relevance (7) | 15 |
| Sources active | 3 |

## Top Papers
| Score | Title | Source |
|-------|-------|--------|
| 10 | [Paper](url) | arxiv |
| 9 | [Paper](url) | huggingface |

## Categories
| Category | Count |
|----------|-------|
| cs.AI | 45 |
| cs.LG | 30 |

## Sources
| Source | Papers |
|--------|--------|
| arxiv | 80 |
| huggingface | 50 |
| hackernews | 20 |
```
