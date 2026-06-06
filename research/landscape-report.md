# AI Feeds Landscape Report

**Date:** 2026-06-06
**Purpose:** Map existing services, tools, and approaches for tracking AI industry developments.

---

## 1. Existing Signal System (What You Already Have)

Your vault has a mature signal snapshot system:
- **Daily snapshots** broken down by source type: career-learning, security, ai-sessions, tools, work-activity
- **Learning plan**: 79 modules, 77% complete, Phase 4 (Production & Depth)
- **Active skills**: Context Engineering, Reflexion, Tab Inspect, WSL2 Env
- **Tools tracked**: arXiv, ArxivLens, Semantic Scholar API, HuggingFace Papers CLI, Ollama, MCP server

**Critical gap identified**: Learning plan completion (77%) hasn't translated into session activity. LLM curiosity is "emerging but thin" — you have conceptual vocabulary but need applied patterns.

---

## 2. Top Open-Source AI Digest Projects

### Tier 1: Full-Featured (1000+ stars)

| Project | Stars | Language | Key Pattern | Worth Borrowing? |
|---------|-------|----------|-------------|------------------|
| **Horizon** | 5,638 | Python | Multi-LLM scoring, bilingual, MCP server, configurable source hub | ✅ Scoring system, MCP exposure |
| **Follow Builders** | 5,015 | JavaScript | Person-centric (follows builders, not topics) | ✅ Complementary signal source |
| **Hacker Podcast** | 2,539 | TypeScript | Audio-first digest format | ⚠️ Niche, not core need |
| **Meridian** | 2,417 | TypeScript | Intelligence briefing style, story continuity tracking | ✅ Clustering + continuity |
| **ClawFeed** | 2,242 | HTML | Multi-frequency digests, web dashboard, source packs | ✅ Most mature UI |
| **AI Daily Digest** | 1,598 | TypeScript | Blog-curation (Karpathy's 90 blogs), AI scoring | ✅ Blog signal source |
| **AI News Radar** | 986 | Python | Source quality assessment ("Scout Skill") | ✅ Source health monitoring |
| **Agents Radar** | 800 | TypeScript | Broadest sources (10), GitHub Actions, MCP server | ✅ Best reference architecture |

### Tier 2: Niche-Focused (100-800 stars)

| Project | Stars | Key Pattern | Worth Borrowing? |
|---------|-------|-------------|------------------|
| **CondenseIt** | 60 | Preference learning from star ratings, "why ranked here" | ✅ Preference engine |
| **ArxivDigest** | 425 | Personalized arXiv via natural-language interest description | ✅ Interest matching |
| **auto-paper-digest** | 514 | Papers → video overviews via NotebookLM | ⚠️ Interesting but complex |
| **Agently Daily News** | 616 | Framework-driven pipeline (Agently agent framework) | ⚠️ Framework lock-in |
| **no-more-fomo** | 6 | KOLs + labs + podcasts + arxiv + HF + HN | ✅ Source list reference |
| **matouskozak/arxiv-digest** | 2 | Papers as GitHub Issues | ✅ Issue-driven learning |

---

## 3. API Reference for Feed Collectors

### arXiv API
- Endpoint: `http://export.arxiv.org/api/query`
- Categories: `cat:cs.AI`, `cat:cs.CL`, `cat:cs.LG`, `cat:stat.ML`
- No auth required, 3-second delay between requests
- Python: `arxiv` package

### HuggingFace Papers
- Daily papers: `https://huggingface.co/api/daily_papers?limit=N`
- No auth required

### HN API (Firebase)
- Top: `https://hacker-news.firebaseio.com/v0/topstories.json`
- Search: `https://hn.algolia.com/api/v1/search?query=AI&tags=story`
- No auth required

### GitHub Trending
- No official API — HTML scrape or Search API workaround
- Search: `/search/repositories?q=created:>YYYY-MM-DD+topic:machine-learning&sort=stars`

### Semantic Scholar API
- Endpoint: `https://api.semanticscholar.org/graph/v1/paper/search`
- 1 req/sec without key, 10 req/sec with free key

### Reddit
- No-auth: `https://www.reddit.com/r/{subreddit}/hot.json`
- Key subs: r/MachineLearning, r/LocalLLaMA, r/artificial

### Product Hunt
- GraphQL: `https://api.producthunt.com/v2/api/graphql`
- Auth required (OAuth2 or Developer Token)

---

## 4. Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│                  FEED COLLECTORS                 │
├─────────┬─────────┬─────────┬─────────┬─────────┤
│  arXiv  │  HN +   │ GitHub  │ Hugging │ Product │
│  API    │ Reddit  │ Trending│ Face    │  Hunt   │
└────┬────┴────┬────┴────┬────┴────┬────┴────┬────┘
     │         │         │         │         │
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

### What to Build vs. What to Borrow

**Build:**
- Relevance scoring against your learning plan (LLM-powered)
- GitHub Issues generator for issue-driven learning
- Obsidian vault integration (signal snapshot format)

**Borrow/Use:**
- RSSHub for RSS generation from non-RSS sources
- arXiv API, HuggingFace API, HN API (direct)
- agents-radar's source list as reference
- CondenseIt's preference learning approach

**Don't Build:**
- RSS feed reading (use existing tools)
- Paper metadata (use Semantic Scholar/arxiv APIs)
- LLM summarization (use Claude/GPT API)

---

## 5. Sources Consulted

- GitHub API searches for ai-news-aggregator, ai-digest, arxiv-digest
- Project READMEs: ClawFeed, CondenseIt, agents-radar, Horizon, no-more-fomo, AI Daily Digest
- Existing vault: signal snapshots, learning plan, tool references
