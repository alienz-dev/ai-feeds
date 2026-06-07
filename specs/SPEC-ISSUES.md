# SPEC-ISSUES: Learning Issue Generator

**Status:** approved
**Created:** 2026-06-07
**Complexity:** 5 (Medium)
**Phase:** 4.1 — Learning Pipeline

---

## 1. Intent

Auto-generate learning issues from high-scoring papers in the SQLite database. When a paper scores 8+ and matches an unchecked module from the learning plan, generate a markdown issue file with learning goals, acceptance criteria, and timebox.

**In scope:** Read from SQLite, match against learning plan, generate markdown issues.

**Out of scope:** Preference learning, issue tracking/completion, GitHub Issues integration.

---

## 2. Acceptance Criteria

**AC-1: Read scored papers from DB**
THE generator SHALL query SQLite for papers with `relevance_score >= 8` that don't yet have a learning issue.

**AC-2: Match against learning plan**
THE generator SHALL match papers against `learning_plan.interests` from config.

**AC-3: Generate issue markdown**
THE generator SHALL create a markdown file in `issues/` with:
- Title: "Learn: {paper title}"
- Learning goal (from score_explanation)
- Acceptance criteria (3-5 actionable items)
- Timebox (default: 2 hours)
- Source paper link
- Relevance score and explanation

**AC-4: Dedup issues**
THE generator SHALL NOT create duplicate issues for the same paper (check by paper URL in existing issues).

**AC-5: CLI**
`npx tsx processor/issue_generator.ts --db <path> [--limit <n>] [--dry-run] [--verbose]`

**AC-6: Config**
Reads from `config.yaml`: `learning_plan.interests`, `processor.relevance_threshold`.

---

## 3. Implementation Notes

### File Structure
```
processor/
  issue_generator.ts   # Main generator + CLI
```

### Issue Template
```markdown
---
title: "Learn: {title}"
status: BACKLOG
paper_url: {url}
relevance_score: {score}
created: {date}
tags: [learning, {categories}]
---

# Learn: {title}

## Why This Matters
{score_explanation}

## Learning Goal
Understand and apply the key concepts from this paper in a hands-on experiment.

## Acceptance Criteria
- [ ] Read the paper abstract and introduction
- [ ] Identify the 3 most important concepts
- [ ] Build a minimal working example
- [ ] Write a summary in your own words
- [ ] Create an evergreen note in your vault

## Source
- **Paper:** [{title}]({url})
- **PDF:** [{pdf_url}]({pdf_url})
- **Score:** {relevance_score}/10
- **Authors:** {authors}

## Timebox
2 hours
```
