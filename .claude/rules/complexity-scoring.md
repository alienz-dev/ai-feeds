---
name: complexity-scoring
description: Scoring rubric for feature complexity. Determines agent spawning (BA at 6+, Architect at 8+) and review tier (lite at 4-7, full at 8+).
---

# Complexity Scoring

Every feature gets a complexity score (1-10) at session start. This determines which agents spawn and what review tier applies.

## Thresholds

| Score | Classification | Agents | Review Tier |
|-------|---------------|--------|-------------|
| 1-3 | Simple | None | Tier 1 (planner inline) |
| 4-7 | Medium | None | Tier 2 (reviewer-lite) |
| 6-7 | Medium-Complex | BA required | Tier 2 (reviewer-lite) |
| 8-10 | Complex | BA + Architect required | Tier 3 (full reviewer) |

## Scoring Signals (0-2 each, max 10)

| Signal | 0 | 1 | 2 |
|--------|---|---|---|
| **Files touched** | 1-2 files | 3-5 files | 6+ files |
| **Cross-module** | No | Yes (2-3 modules) | System-wide (4+ modules) |
| **New patterns** | Existing pattern | Variant of existing | Novel pattern |
| **Risk** | Low (UI, docs) | Medium (business logic) | High (auth, data, perf) |
| **Dependencies** | None | Internal (project deps) | External (APIs, services) |

## Auto-Promote Rules

Regardless of score, auto-promote to Tier 3 if any changed files match:
- `/auth/`, `/security/`, `/crypto/`
- `/api/`, `/schema/`, `/migration/`
- Files with `@sensitive` annotations

## Examples

**Score 2 (Simple):** Fix a typo in a single component
- Files: 1 (0), Cross-module: no (0), New patterns: existing (0), Risk: low (0), Deps: none (0)

**Score 5 (Medium):** Add pagination to an existing list page
- Files: 3 (1), Cross-module: no (0), New patterns: variant (1), Risk: low (0), Deps: internal (1)
- → No BA/Architect, Tier 2 review

**Score 7 (Medium-Complex):** Add OAuth login with session management
- Files: 5 (1), Cross-module: yes (1), New patterns: variant (1), Risk: high (2), Deps: external (2)
- → BA required, Tier 2 review (but auto-promote to Tier 3 due to /auth/)

**Score 9 (Complex):** Redesign the data layer with new ORM and migration
- Files: 12 (2), Cross-module: system-wide (2), New patterns: novel (2), Risk: high (2), Deps: external (1)
- → BA + Architect required, Tier 3 review
