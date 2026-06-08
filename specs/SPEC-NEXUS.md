---
id: SPEC-NEXUS
title: "Nexus Feedback Integration — Cross-Source Scoring Boost"
status: open
version: "1.0"
created: 2026-06-08
linked_issues: []
test-files:
  - tests/nexus/nexus-client.test.ts
  - tests/scorer/nexus-boost.test.ts
---

# Nexus Feedback Integration

## §1 Intent

Connect ai-feeds to the nexus knowledge hub for cross-source intelligence. The nexus system ingests ai-feeds data along with job-hunter, email-hub, vault, and RSS feeds. It builds a knowledge graph, extracts entities, detects skill gaps, and identifies trending topics. This spec adds a feedback loop: nexus signals boost paper relevance scoring in ai-feeds.

**In scope:** Nexus client adapter, scorer integration, configuration.

**Out of scope:** Running nexus itself (it's a separate service), modifying nexus code.

## §2 Data Flow

```
ai-feeds collects papers → LLM scorer → relevance score
                                    ↓
                          nexus client fetches signals
                                    ↓
                          gap skills + trending topics
                                    ↓
                          boost = f(gap_match, trend_match)
                                    ↓
                          final_score = llm_score + nexus_boost
```

## §3 Nexus Client

Create `src/nexus-client.ts` — a client adapter that fetches scoring signals from the nexus feedback API.

### API Endpoints Used

| Endpoint | Returns | Cache TTL |
|---|---|---|
| `GET /api/feedback/scoring-signals` | Full signal package | 30 min |
| `GET /api/feedback/gap-skills` | Just gap skills | 30 min |
| `GET /api/feedback/skill-demand` | Demand scores 0-10 | 30 min |

### Client Interface

```typescript
interface NexusScoringClient {
  getScoringSignals(): Promise<ScoringSignals>;
  getGapSkills(): Promise<GapSkill[]>;
  getSkillDemand(): Promise<Record<string, number>>;
  resolveSkill(name: string): Promise<string>;
  scorePaper(title: string, abstract: string, categories: string[]): Promise<{
    boost: number;      // 0-10
    reasons: string[];  // why this boost was applied
  }>;
}
```

### Configuration

Add to `config.yaml`:

```yaml
nexus:
  enabled: false                    # disabled by default
  url: "http://localhost:3777"      # nexus server URL
  cache_ttl_minutes: 30             # signal cache TTL
  boost_weight: 0.5                 # multiplier for nexus boost (0 = no effect, 1 = full)
  gap_skill_boost: 0.5              # boost per gap point
  trending_boost: 0.2               # boost per trending mention
  hot_topic_boost: 0.1              # boost per hot topic mention
  max_boost: 5.0                    # cap on total nexus boost
```

## §4 Scorer Integration

Modify `src/processor/scorer.ts` to apply nexus boost after LLM scoring.

### Scoring Pipeline

```
1. LLM scores paper (existing) → llm_score (0-10)
2. Nexus scores paper (new) → nexus_boost (0-10 * boost_weight)
3. final_score = min(llm_score + nexus_boost * boost_weight, 10)
4. Store both scores in DB for transparency
```

### Database Changes

Add columns to `papers` table:

```sql
ALTER TABLE papers ADD COLUMN nexus_boost REAL DEFAULT 0;
ALTER TABLE papers ADD COLUMN nexus_reasons TEXT DEFAULT '[]';
```

### CLI Changes

Add `--nexus` flag to scoring commands:
- `npm run score -- --nexus` — enable nexus boost
- `npm run score` — existing behavior (no nexus)

## §5 Error Handling

- Nexus unavailable → skip boost, log warning, continue with LLM score only
- Timeout (10s) → skip boost, log warning
- Invalid response → skip boost, log error
- All errors are non-fatal — scoring never fails due to nexus issues

## §6 Testing

### Unit Tests

- `nexus-client.test.ts`: Mock fetch, test caching, test error handling
- `nexus-boost.test.ts`: Test boost calculation with known signals

### Integration Tests

- Start mock nexus server, verify scoring pipeline end-to-end
- Test with nexus disabled (default config)
- Test with nexus unavailable (connection refused)

## §7 Dependencies

- Nexus server running at configured URL (separate service)
- No new npm dependencies (uses native fetch)

## §8 Acceptance Criteria

- [ ] `src/nexus-client.ts` implements NexusScoringClient interface
- [ ] Config added to `config.yaml` with `enabled: false` default
- [ ] Scorer applies nexus boost when enabled
- [ ] `nexus_boost` and `nexus_reasons` stored in DB
- [ ] `--nexus` flag on scoring CLI
- [ ] Graceful degradation when nexus unavailable
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Documentation updated in CLAUDE.md
