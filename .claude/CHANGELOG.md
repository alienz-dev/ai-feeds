# Changelog

## 2026-06-07 — main

### Added
- Static site at signals.mingli.world with daily digests and individual article pages
- "Save to Obsidian Vault" button on article pages (opens Obsidian with pre-filled note)
- Reddit collector via CDP scraping (75 posts from r/MachineLearning, r/LocalLLaMA, r/artificial)
- Fuzzy title deduplication (catches variants like "LlamaStash Introduction" vs "LlamaStash Benchmark")
- Archive page for browsing all daily digests
- Telegram notifications with links to article pages

### Fixed
- HN old content — no more stories from 2012-2024 mixed with recent content
- Scoring quality — generic links (Gemini AI homepage) no longer get 9/10
- Issue generator — now works without --db flag (reads from config.yaml)
- Weekend coverage — arXiv papers from Friday now included on Sunday
- Reddit collector — migrated from JSON API (403 blocked) to Chrome CDP scraping

### Changed
- Telegram format — emoji-prefixed sections (🔥 TOP PICKS, ⭐ WORTH READING, 📌 ALSO NOTED)
- GitHub trending — switched from daily to weekly (daily returns nothing on weekends)
- arXiv/HuggingFace — days_back increased from 2 to 3 (catches Friday papers on weekends)
- Dedup logic — consolidated 7 duplicate implementations into 1 shared function
- Scoring prompt — added anti-generic instructions (cap product pages at 3, require technical substance for 7+)

### Breaking
- None
