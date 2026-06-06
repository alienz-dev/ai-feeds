# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

AI Feeds is a personal AI industry intelligence system that does two things:

1. **Aggregate signals** — papers, trending repos, news, community discussions from multiple sources
2. **Drive upskilling** — not just surface news, but evaluate what's worth learning, generate learning issues, and produce hands-on artifacts

The user (Ming) is a developer focused on AI engineering, currently in Phase 4 of an AI/LLM learning plan (79 modules, 77% complete, fine-tuning/production AI). Key interest areas: context engineering, agent architectures, RAG, LLM integration, browser automation, and local dev infrastructure.

**Critical gap**: Learning plan completion hasn't translated into session activity. This project exists to close that gap by converting passive consumption into active learning.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  FEED COLLECTORS                 │
├─────────┬─────────┬─────────┬─────────┬─────────┤
│  arXiv  │  HN +   │ GitHub  │ Hugging │ Product │
│  API    │ Reddit  │ Trending│ Face    │  Hunt   │
└────┬────┴────┬────┴────┬────┴────┬────┴────┬────┘
     └─────────┴─────────┴─────────┴─────────┘
                       │
              ┌────────▼────────┐
              │  LLM PROCESSOR  │
              │  - Relevance    │
              │  - Summarize    │
              │  - Dedup        │
              │  - Score vs     │
              │    learning plan│
              └────────┬────────┘
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
┌─────────┐     ┌──────────┐     ┌──────────┐
│ Obsidian │     │  GitHub  │     │ Optional │
│  Vault   │     │  Issues  │     │ Delivery │
│ (daily   │     │ (learn-  │     │ (email,  │
│ signal)  │     │  driven) │     │ webhook) │
└─────────┘     └──────────┘     └──────────┘
```

### Feed Sources
- **Papers**: arXiv API (cs.AI, cs.CL, cs.LG), HuggingFace Daily Papers API, Semantic Scholar API
- **Code**: GitHub Trending (HTML scrape), GitHub Search API
- **Community**: HN API (Firebase/Algolia), Reddit JSON API (r/MachineLearning, r/LocalLLaMA)
- **Industry**: Product Hunt API (GraphQL), Dev.to Forem API, Lobste.rs JSON API
- **Newsletters**: RSS feeds (The Batch, Import AI, TLDR AI, Simon Willison)

### Key APIs (no auth required)
- arXiv: `http://export.arxiv.org/api/query` (3s delay between requests)
- HuggingFace: `https://huggingface.co/api/daily_papers?limit=N`
- HN: `https://hacker-news.firebaseio.com/v0/topstories.json`
- HN Search: `https://hn.algolia.com/api/v1/search?query=AI&tags=story`
- Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/search` (1 req/sec)
- Reddit: `https://www.reddit.com/r/{sub}/hot.json` (User-Agent header required)

### GitHub Trending (no official API)
Workarounds: HTML scrape `https://github.com/trending?since=daily`, or GitHub Search API with date filters.

## Existing Vault Context

The user has a mature signal snapshot system in Obsidian:
- Daily snapshots: `knowledge/wikis/ai-engineering/raw/signals/` — broken down by source type (career-learning, security, ai-sessions, tools, work-activity)
- Learning plan: 79 modules, Phase 4 (Production & Depth), 8 concepts mastered, 18 unchecked modules
- Signal concepts: `signal-aggregation.md`, `signal-detection.md`, `signal-reporting.md`, `ai-synthesis.md`
- Tools documented: arXiv, ArxivLens, Semantic Scholar API, HuggingFace Papers CLI, Ollama, MCP server

## Upskilling System

This project implements a learn-by-doing framework (see `research/upskilling-system.md`):

- **Evaluation framework**: 5-question filter before investing time in any new technique
- **Issue-driven learning**: GitHub Issues as learning contracts with acceptance criteria
- **Weekly sprints**: Monday=Consume, Tue-Thu=Implement, Friday=Teach & Reflect
- **Absorption**: Feynman technique, Zettelkasten evergreen notes, example projects over tutorials

## Conventions

- Output files: Obsidian-compatible markdown with YAML frontmatter
- Signal snapshot format: follow the established pattern in `knowledge/wikis/ai-engineering/raw/signals/`
- Use the Obsidian MCP server (enquire-mcp) for vault knowledge retrieval
- Use the Claude Code researcher agent for web research tasks
- Learning issues go in `issues/` directory with the template from `research/upskilling-system.md`

## Reference Projects

See `research/landscape-report.md` for the full landscape. Key projects to study:
- **agents-radar** (800 stars) — broadest source coverage, GitHub Actions, MCP server
- **Horizon** (5.6k stars) — scoring system, bilingual, configurable source hub
- **CondenseIt** (60 stars) — preference learning from ratings, "why ranked here"
- **matouskozak/arxiv-digest** — papers as GitHub Issues (issue-driven learning pattern)
