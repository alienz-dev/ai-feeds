# AI Feeds

Personal AI industry intelligence system. Aggregates signals from papers, trending repos, news, and community discussions — then converts them into hands-on learning artifacts.

## Why This Exists

You have a 79-module learning plan that's 77% complete. But completion hasn't translated into real capability. This project closes that gap by:

1. **Surfacing what matters** — LLM-scored relevance against your learning plan
2. **Evaluating what's worth learning** — 5-question filter before investing time
3. **Generating learning issues** — GitHub Issues as contracts with yourself
4. **Producing artifacts** — not just reading, but building, teaching, and reflecting

## Feed Sources

| Source | API | Auth |
|--------|-----|------|
| arXiv papers | `export.arxiv.org/api/query` | None |
| HuggingFace Daily Papers | `huggingface.co/api/daily_papers` | None |
| Hacker News | Firebase + Algolia APIs | None |
| Reddit (r/MachineLearning, r/LocalLLaMA) | JSON API | None |
| GitHub Trending | HTML scrape / Search API | None |
| Semantic Scholar | REST API | Free key optional |
| Product Hunt | GraphQL API | OAuth2 |
| Dev.to | Forem API | None |
| Lobste.rs | JSON API | None |
| Newsletters | RSS feeds | None |

## Architecture

```
Feed Collectors → LLM Processor → Obsidian Vault + GitHub Issues
                  (relevance,      (daily signal    (learning
                   summarize,       snapshots)       contracts)
                   dedup)
```

## Project Structure

```
ai-feeds/
├── CLAUDE.md           — Claude Code guidance
├── README.md           — This file
├── research/           — Research reports
│   ├── landscape-report.md    — Existing services & tools landscape
│   └── upskilling-system.md   — Learn-by-doing framework
├── collectors/         — Feed collection scripts (planned)
├── processor/          — LLM scoring & summarization (planned)
├── issues/             — Learning issue templates (planned)
└── examples/           — Working examples from learning (planned)
```

## Upskilling Framework

See `research/upskilling-system.md` for the full framework. Key components:

- **5-Question Evaluation Filter** — score any new technique before investing time
- **Issue-Driven Learning** — GitHub Issues with acceptance criteria as learning contracts
- **Weekly Sprints** — Monday=Consume, Tue-Thu=Implement, Friday=Teach & Reflect
- **Learn-by-Doing Pipeline** — CONSUME (10%) → IMPLEMENT (60%) → TEACH (20%) → REFLECT (10%)

## Reference Projects

| Project | Stars | What to Borrow |
|---------|-------|----------------|
| [Horizon](https://github.com/Thysrael/Horizon) | 5.6k | Scoring system, MCP exposure |
| [Follow Builders](https://github.com/zarazhangrui/follow-builders) | 5k | Person-centric signal source |
| [Meridian](https://github.com/iliane5/meridian) | 2.4k | Clustering, story continuity |
| [ClawFeed](https://github.com/kevinho/clawfeed) | 2.2k | Multi-frequency digests, UI |
| [agents-radar](https://github.com/duanyytop/agents-radar) | 800 | Broadest source coverage |
| [CondenseIt](https://github.com/wildlifechorus/condenseit) | 60 | Preference learning engine |
| [arxiv-digest](https://github.com/matouskozak/arxiv-digest) | 2 | Papers as GitHub Issues |

## Status

🟡 Early design phase — research complete, architecture defined, ready for implementation.

## Related Vault Notes
- `knowledge/wikis/ai-engineering/wiki/concepts/signal-aggregation.md`
- `knowledge/wikis/ai-engineering/wiki/concepts/signal-detection.md`
- `knowledge/wikis/ai-engineering/wiki/sources/ai-llm-learning-plan.md`
- `knowledge/wikis/ai-engineering/wiki/concepts/learning-plan-phases.md`
