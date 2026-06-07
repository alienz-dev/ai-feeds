# AI Feeds

AI industry intelligence system. Aggregates signals from papers, trending repos, news, and community discussions — then converts them into actionable learning artifacts.

## What It Does

1. **Collect** — Fetches papers from arXiv, HuggingFace, HN, Reddit, Dev.to, GitHub Trending, Product Hunt
2. **Score** — LLM-powered relevance scoring against your learning interests
3. **Store** — SQLite database as source of truth
4. **Digest** — Generates Obsidian-compatible markdown for daily reading
5. **Learn** — Auto-generates learning issues from high-scoring papers

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> ai-feeds
cd ai-feeds
npm install

# 2. Configure
cp config.yaml.example config.yaml
# Edit config.yaml: set your vault_path, learning interests, enable/disable sources

# 3. Set up LLM provider (for scoring)
cp .env.example .env
# Edit .env: add your ANTHROPIC_API_KEY or OPENAI_API_KEY

# 4. Run collectors
npx tsx collectors/arxiv.ts
npx tsx collectors/huggingface.ts

# 5. Score papers
npx tsx processor/scorer.ts --input collectors/output/

# 6. Ingest into database
npx tsx db/ingest.ts --input collectors/output/
npx tsx db/ingest.ts --input processor/output/

# 7. Generate digest
npx tsx db/digest.ts --date $(date +%Y-%m-%d)
```

## Feed Sources

| Source | API | Auth | Status |
|--------|-----|------|--------|
| arXiv | REST API | None | ✅ |
| HuggingFace | Daily Papers API | None | ✅ |
| Hacker News | Firebase + Algolia | None | ✅ |
| Reddit | JSON API | None | ✅ |
| GitHub Trending | Search API | None | ✅ |
| Dev.to | Forem API | None | ✅ |
| Product Hunt | CDP scraping | Chrome session | ✅ |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   COLLECTORS                         │
├────────┬────────┬────────┬────────┬────────┬────────┤
│  arXiv │   HF   │   HN   │ Reddit │ Dev.to │ GitHub │
└───┬────┴───┬────┴───┬────┴───┬────┴───┬────┴───┬────┘
    └────────┴────────┴────────┴────────┴────────┘
                        │
               collectors/output/*.json
                        │
                ┌───────▼───────┐
                │  LLM Scorer   │
                └───────┬───────┘
                        │
               processor/output/*.json
                        │
                ┌───────▼───────┐
                │    Ingest     │
                └───────┬───────┘
                        │
                ┌───────▼───────┐
                │    SQLite     │◄── Issue Generator
                └───────┬───────┘◄── Weekly Rollup
                        │
                ┌───────▼───────┐
                │    Digest     │
                └───────┬───────┘
                        │
                Obsidian Markdown
```

## Configuration

### config.yaml

Copy `config.yaml.example` to `config.yaml` and customize:

- **sources** — enable/disable collectors, set API parameters
- **processor** — LLM provider (claude/openai/ollama), model, batch size
- **database** — SQLite path
- **output** — vault path for Obsidian markdown
- **learning_plan** — your interest areas for relevance scoring

### Environment Variables

Copy `.env.example` to `.env` and set:

- `ANTHROPIC_API_KEY` — for Claude provider
- `OPENAI_API_KEY` — for OpenAI provider

Ollama requires no API key (runs locally).

## CLI Commands

### Collectors
```bash
npx tsx collectors/arxiv.ts [--dry-run] [--verbose]
npx tsx collectors/huggingface.ts [--dry-run] [--verbose]
npx tsx collectors/hn.ts [--dry-run] [--verbose]
npx tsx collectors/reddit.ts [--dry-run] [--verbose]
npx tsx collectors/devto.ts [--dry-run] [--verbose]
npx tsx collectors/github.ts [--dry-run] [--verbose]
npx tsx collectors/producthunt.ts [--dry-run] [--days N] [--verbose]
```

### Scorer
```bash
npx tsx processor/scorer.ts --input <file-or-dir> [--threshold N] [--dry-run]
```

### Database
```bash
npx tsx db/ingest.ts --input <file-or-dir> [--db path.sqlite]
npx tsx db/digest.ts --date YYYY-MM-DD [--threshold N] [--output path.md]
```

### Issue Generator
```bash
npx tsx processor/issue_generator.ts [--limit N] [--dry-run]
```

### Weekly Rollup
```bash
npx tsx processor/rollup.ts [--weeks N] [--output path.md]
```

## Tests

```bash
npx vitest run          # All tests (332 tests)
npx vitest run tests/arxiv.test.ts  # Single file
```

## Dependencies

- Node.js 18+
- `playwright` — for Product Hunt CDP scraping
- `better-sqlite3` — for database
- `fast-xml-parser` — for arXiv XML parsing
- `yaml` — for config file parsing

## License

MIT
