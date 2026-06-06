# AI Feeds — Implementation Plan

**Created:** 2026-06-06
**Status:** Ready to start

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Evaluation Filter Tool
Create a CLI/script that scores any new technique against the 5-question filter before you invest time.

- [ ] Create `evaluator/filter.py` — takes a technique description, outputs score + decision
- [ ] Template in `evaluator/templates/evaluation-card.md`
- [ ] Integration: when a feed item scores 4+/5, auto-generate a learning issue

### 1.2 Learning Issue Templates
Set up the issue-driven learning system.

- [ ] Create `issues/TEMPLATE.md` — learning issue template with acceptance criteria
- [ ] Create `issues/BACKLOG.md` — kanban board (BACKLOG / IN PROGRESS / DONE)
- [ ] Seed with 3-5 issues from the 18 unchecked learning plan modules
- [ ] Create `examples/README.md` — where working demos go

### 1.3 Weekly Sprint Template
- [ ] Create `sprints/TEMPLATE.md` — Mon=Consume, Tue-Thu=Implement, Fri=Teach & Reflect
- [ ] Create `sprints/CURRENT.md` — this week's sprint

---

## Phase 2: First Collector (Week 2-3)

### 2.1 arXiv + HuggingFace Collector
Easiest sources — no auth required, clean APIs.

- [ ] Create `collectors/arxiv.py` — fetch papers from cs.AI, cs.CL, cs.LG categories
- [ ] Create `collectors/huggingface.py` — fetch daily papers from HF API
- [ ] Create `collectors/common.py` — shared types, date handling, dedup
- [ ] Output format: JSON with title, abstract, url, authors, categories, date
- [ ] Tests: unit tests for each collector

### 2.2 LLM Relevance Scorer
Score papers against your learning plan.

- [ ] Create `processor/scorer.py` — LLM-powered relevance scoring
- [ ] Prompt: "Given these interest areas [context engineering, agent architectures, RAG, fine-tuning, production AI], rate this paper 1-10 for relevance and explain why"
- [ ] Threshold: only surface papers scoring 7+
- [ ] Output: scored + summarized feed items

### 2.3 Obsidian Vault Output
Write results into your existing signal snapshot format.

- [ ] Create `output/obsidian.py` — generate markdown with YAML frontmatter
- [ ] Format: follow `knowledge/wikis/ai-engineering/raw/signals/` pattern
- [ ] Output path: configurable, default to vault signals directory
- [ ] Daily run: aggregate all sources into one signal snapshot

---

## Phase 3: Expand Sources (Week 3-4)

### 3.1 Community Sources
- [ ] Create `collectors/hn.py` — HN API (Firebase + Algolia search for AI topics)
- [ ] Create `collectors/reddit.py` — r/MachineLearning, r/LocalLLaMA hot posts
- [ ] Dedup across sources (same story on HN + Reddit = one item)

### 3.2 Code Sources
- [ ] Create `collectors/github_trending.py` — HTML scrape or Search API
- [ ] Filter: AI/ML repos only, sort by stars gained recently

### 3.3 Industry Sources
- [ ] Create `collectors/producthunt.py` — GraphQL API for AI product launches
- [ ] Create `collectors/devto.py` — Forem API for AI-tagged articles

---

## Phase 4: Learning Pipeline (Week 4-5)

### 4.1 Issue Generator
Auto-generate learning issues from high-scoring feed items.

- [ ] Create `processor/issue_generator.py` — when a technique scores 8+ and matches unchecked modules, generate a learning issue
- [ ] Template: fill in learning goal, acceptance criteria, timebox
- [ ] Output: markdown file in `issues/` directory

### 4.2 Preference Learning
Learn what you actually care about from your behavior.

- [ ] Create `processor/preferences.py` — track which items you engage with
- [ ] Signals: which items get read, which get learning issues, which get skipped
- [ ] Use to adjust relevance scoring over time (like CondenseIt's approach)

### 4.3 Weekly Rollup
- [ ] Create `processor/rollup.py` — weekly aggregation of daily signals
- [ ] Output: trends, knowledge gaps, top items, learning progress
- [ ] Format: Obsidian note in vault

---

## Phase 5: Automation (Week 5-6)

### 5.1 GitHub Actions Cron
- [ ] Create `.github/workflows/daily-digest.yml` — run collectors + processor daily
- [ ] Create `.github/workflows/weekly-rollup.yml` — weekly aggregation
- [ ] Commit results to repo + push to vault

### 5.2 Optional Delivery
- [ ] Email digest (SMTP or SendGrid)
- [ ] Webhook to Discord/Slack/Feishu
- [ ] RSS feed generation

---

## File Structure (Target)

```
ai-feeds/
├── CLAUDE.md
├── README.md
├── PLAN.md                    ← This file
├── research/
│   ├── landscape-report.md
│   └── upskilling-system.md
├── collectors/
│   ├── __init__.py
│   ├── common.py              # Shared types, dedup
│   ├── arxiv.py               # arXiv API
│   ├── huggingface.py         # HF Daily Papers API
│   ├── hn.py                  # Hacker News API
│   ├── reddit.py              # Reddit JSON API
│   ├── github_trending.py     # GitHub trending scrape
│   ├── producthunt.py         # Product Hunt GraphQL
│   └── devto.py               # Dev.to Forem API
├── processor/
│   ├── __init__.py
│   ├── scorer.py              # LLM relevance scoring
│   ├── summarizer.py          # LLM summarization
│   ├── preferences.py         # Preference learning
│   ├── issue_generator.py     # Learning issue generation
│   └── rollup.py              # Weekly aggregation
├── output/
│   ├── __init__.py
│   └── obsidian.py            # Obsidian markdown output
├── evaluator/
│   ├── filter.py              # 5-question evaluation filter
│   └── templates/
│       └── evaluation-card.md
├── issues/
│   ├── TEMPLATE.md            # Learning issue template
│   ├── BACKLOG.md             # Kanban board
│   └── *.md                   # Individual learning issues
├── sprints/
│   ├── TEMPLATE.md            # Weekly sprint template
│   └── CURRENT.md             # This week's sprint
├── examples/
│   └── README.md              # Working demos from learning
├── tests/
│   ├── test_arxiv.py
│   ├── test_huggingface.py
│   ├── test_scorer.py
│   └── test_obsidian.py
├── config.yaml                # Source config, API keys, vault path
├── requirements.txt           # Python dependencies
└── .github/
    └── workflows/
        ├── daily-digest.yml
        └── weekly-rollup.yml
```

---

## Quick Wins (Start Here)

These can be done in a single session:

1. **Create `issues/TEMPLATE.md`** — learning issue template
2. **Create `issues/BACKLOG.md`** — seed with 3 issues from your 18 unchecked modules
3. **Create `collectors/arxiv.py`** — simplest collector, no auth, clean API
4. **Create `evaluator/filter.py`** — 5-question filter as a simple script

---

## Success Metrics

- [ ] First arXiv + HuggingFace digest generated and in vault
- [ ] First learning issue created with acceptance criteria
- [ ] First weekly sprint completed (Consume → Implement → Teach → Reflect)
- [ ] 5 feed sources running daily via GitHub Actions
- [ ] Preference learning adjusting scores based on engagement
- [ ] Learning issues tracking shows progress on unchecked modules
