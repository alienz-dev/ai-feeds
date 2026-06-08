---
wrapped: 2026-06-07T21:55:00+10:00
branch: main
session-id: ad3d622a-c736-477a-ac2f-bc52f2d7276b
---

# Session: AI Feeds — 2026-06-07

## Status
AI Feeds is a fully operational AI industry intelligence system. All 7 collectors working (arXiv, HN, Reddit CDP, Dev.to, GitHub, Product Hunt, HuggingFace). Static site live at signals.mingli.world with daily digests and article pages. Telegram notifications with direct links.

## Progress This Session
- Fixed 6 quality issues (HN date filter, scoring prompt, dedup, issue generator, weekend tuning, Reddit CDP)
- Built static site generator with daily digests, article pages, Obsidian vault save
- Deployed to Vercel with custom domain signals.mingli.world
- Updated Telegram format with emoji-prefixed sections and article links
- All 332 tests passing

## Key Learnings
- Vercel + native modules: deploy from public/ directory with empty install/build commands
- Reddit DOM: shreddit-post web components with attributes (post-id, post-title, author)
- HN Algolia: must add numericFilters=created_at_i to limit by date
- LLM scoring: explicit negative instructions needed for generic content
- Obsidian URI: obsidian://new?vault=vault&file=path&content=markdown for direct writes

## Open Items
- Gemini AI still scores 9 (LLM ignores negative prompting)
- Google Duplex (2018) still scores 8 (HN date filter is post date, not article date)
- Product Hunt CDP requires Chrome running
- GitHub trending returns 0 repos (weekly filter, no new repos)

## Next Session Goals
1. Topic depth/breadth management — balance deep dives vs broad coverage
2. Repository monitoring — identify key repos to track for state-of-the-art research
3. Knowledge ingestion pipeline — improve Save to Vault with auto-tagging and backlinks
4. Scoring refinement — address remaining noise with better filtering

## Recent Commits
- 04b5b57 spec: nexus feedback integration (SPEC-NEXUS)
- 0eaa5b3 feat: Add static site generator and improve Telegram format
- 296eb45 feat: Reddit collector migrated from JSON API to CDP scraping
- 7210a22 fix: quality improvements — HN date filter, scoring prompt, dedup, config tuning
- b957fc1 fix: improve Telegram message formatting
- e6cd8f1 feat: weekly GitHub trends analyzer
- 19d1f9b chore: update pipeline to source .env for API keys
- 05d8ddd fix: scorer works with NVIDIA NIM + Llama 70B
- a954d95 chore: gitignore SQLite WAL files
- d263d1d feat: Telegram notifications for high-scoring papers
