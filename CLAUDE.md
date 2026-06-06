# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

AI Feeds is a personal AI industry intelligence system. It aggregates, filters, and synthesizes signals from multiple sources — arxiv papers, GitHub trending, AI newsletters, community discussions, and job market data — into actionable briefings aligned with the user's learning plan and professional goals.

The user (Ming) is a developer focused on AI engineering, currently in Phase 4 of an AI/LLM learning plan (fine-tuning, production AI). Key interest areas: context engineering, agent architectures, RAG, LLM integration, browser automation, and local dev infrastructure.

## Architecture

This project is in its early design phase. The intended architecture:

- **Feed collectors** — scripts/agents that pull from arxiv, GitHub trending, HuggingFace papers, RSS/newsletters, Reddit, HN
- **Signal processor** — LLM-powered summarization and relevance filtering against the user's learning plan and work context
- **Briefing generator** — produces daily/weekly signal snapshots in Obsidian-compatible markdown
- **Vault integration** — outputs feed into the existing Obsidian vault under `knowledge/wikis/ai-engineering/` using the established signal snapshot format

## Existing Vault Context

The user already has a mature signal snapshot system in their Obsidian vault:
- Signal snapshots: `knowledge/wikis/ai-engineering/raw/signals/` — periodic reports aggregating session topics, skills, knowledge gaps, trending AI news
- Career learning: structured AI/LLM learning plan, 77% through Phase 4, mapped to FY26 professional goals
- Tools tracked: arXiv, ArxivLens, Semantic Scholar API, HuggingFace Papers CLI, Ollama, MCP server, etc.
- Signal concepts: `signal-aggregation.md`, `signal-detection.md`, `signal-reporting.md`, `ai-synthesis.md`

## Conventions

- Output files: Obsidian-compatible markdown with YAML frontmatter
- Signal snapshot format: follow the established pattern in `knowledge/wikis/ai-engineering/raw/signals/`
- Use the Obsidian MCP server (enquire-mcp) for vault knowledge retrieval
- Use the Claude Code researcher agent for web research tasks
