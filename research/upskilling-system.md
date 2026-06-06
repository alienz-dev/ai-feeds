# Upskilling System: Learn-by-Doing Framework

**Date:** 2026-06-06
**Purpose:** How to actually absorb and apply new AI techniques, not just read about them.

---

## The Core Problem

Your learning plan is 77% complete but hasn't translated into session activity. The gap isn't *what* you're learning — it's *how* you're absorbing it.

---

## 1. The Learn-by-Doing Pipeline

```
CONSUME (10%) → IMPLEMENT (60%) → TEACH (20%) → REFLECT (10%)
```

For any new technique:
- **Day 1**: Read enough to form a 2-minute mental model. Create a vault note.
- **Day 2-3**: Build a minimal, ugly, working version. Clone-then-modify is highest-leverage.
- **Day 4**: Break it deliberately. Push to failure. Document what fails and why.
- **Day 5**: Write a summary for your past self. This forces understanding.

**Key insight from Karpathy**: If you can build the simplest version of something, you understand it. minGPT = GPT-2 in ~300 lines.

---

## 2. Evaluation Framework: "Is This Worth My Time?"

### 5-Question Filter

| Question | Weight |
|----------|--------|
| Does it solve a problem I actually have? | 30% |
| Is the API/interface stable enough to build on? | 20% |
| Does it compound with things I already know? | 20% |
| Can I prototype in under 2 hours? | 15% |
| Are the smartest people I follow excited about it? | 15% |

### Triage
- **LEARN NOW**: 4+/5 — build something this week
- **LEARN LATER**: 3/5 — parking lot, revisit when you have a use case
- **SKIP**: <3/5 — no guilt, the field moves too fast

### Red Flags (Skip)
- No code examples in the announcement
- Requires hardware you don't have with no hosted alternative
- "This changes everything" with no benchmarks
- Tightly coupled to a single vendor's API

### Green Signals (Prioritize)
- Simon Willison blogged about it with working code
- Adopted by 2+ independent projects
- Clear "getting started" path under 30 minutes
- Solves a problem that's bitten you before

---

## 3. Issue-Driven Learning

Use GitHub Issues as learning contracts with yourself.

### Template

```markdown
## Learning Goal
Understand [TECHNIQUE] well enough to [CONCRETE CAPABILITY].

## Why
[What problem does this solve? What can I do after learning this?]

## Acceptance Criteria
- [ ] Can implement [X] from scratch without referencing docs
- [ ] Can explain [X] to someone else in writing
- [ ] Have a working demo at [REPO/LINK]
- [ ] Can identify 3 failure modes and their mitigations

## Deliverables
- [ ] Vault note: `knowledge/learning/learn-[X].md`
- [ ] Working code: `examples/[x]-demo/`
- [ ] Blog post or tweet thread

## Timebox
[1-2 weeks]
```

### Kanban Board

| BACKLOG | IN PROGRESS (max 2) | DONE |
|---------|---------------------|------|
| Structured outputs | Fine-tuning LoRA | RAG failure modes |
| Agent memory patterns | — | Function calling |
| Multi-modal RAG | — | Enterprise AI patterns |

An item is only "Done" when you've produced the learning artifacts.

---

## 4. Absorption Strategies

### What Actually Works

**Spaced Repetition — But Technical**
- Don't use Anki for definitions. Use it for API patterns, failure modes, architecture decisions.
- Format: Question → Answer with code snippet. Review weekly.

**The Feynman Technique**
1. Pick a concept (e.g., "LoRA fine-tuning")
2. Write explanation as if teaching a junior dev
3. Where you resort to jargon = where you don't understand
4. Fill gaps with concrete examples

**Build Example Projects, Not Tutorials**
- Tutorial: Follow steps for pre-determined result
- Example project: Solve YOUR problem using the technique
- Put in `examples/` with READMEs explaining *why* you made each choice

**Zettelkasten for Technical Knowledge**
- Evergreen notes capture atomic ideas, not article summaries
  - Good: "LoRA works because weight updates in high-dimensional spaces are low-rank"
  - Bad: "Summary of the LoRA paper"
- Link aggressively — every new note links to 2-3 existing notes
- 3-note rule: before creating a new note, check if you can extend an existing one

**Teaching Hierarchy**
1. Writing a blog post (good)
2. Creating a vault note with examples (better)
3. Building a tool others use (best)
4. Giving a talk (excellent)

Write for your past self. You don't need an audience.

---

## 5. AI-Augmented Learning

### Effective Patterns

**Explain This Code**: Paste complex open-source AI code into Claude. Ask what it does, why it's structured that way, and what would break if you changed X.

**Generate Counterexamples**: Ask AI for 5 cases where a technique would fail. Then test them yourself. Builds intuition faster than only testing happy paths.

**Scaffold, Then Fill**: Use Claude Code for boilerplate (imports, config, structure). Do the core logic yourself. Saves 30-50% without sacrificing learning.

**Rubber Duck with Context**: When stuck, explain your problem to Claude with full context. Better than Stack Overflow because the AI has your specific situation.

**Compare Implementations**: Ask for 3 different approaches with tradeoffs. The AI gives you the map; you drive the car.

### Anti-Patterns
- Don't let AI write code you can't explain line-by-line
- Don't use AI to avoid debugging (debugging is where deepest learning happens)
- Don't skip reading source code — AI can summarize, but reading builds pattern recognition

---

## 6. Models from Top AI Engineers

**Karpathy**: Build from scratch. If you can build the simplest version, you understand it.

**swyx**: Learn in public. "Make the thing you wish you had found when you were learning." Create learning exhaust.

**Simon Willison**: Build tools, not demos. Build real tools that solve actual problems. Blog every experiment with working code.

**Fast.ai**: Top-down learning. Start with a working model, then understand the internals. Get results first, understand later.

---

## 7. Weekly Sprint Template

```markdown
# Week of [DATE]

## Focus Area
[One technique/framework to deeply learn]

## Monday: Consume
- [ ] Read primary source (paper, docs, blog)
- [ ] Create vault note with initial mental model
- [ ] Identify 3 questions to answer through implementation

## Tuesday-Thursday: Implement
- [ ] Build minimal working version
- [ ] Break it — test edge cases
- [ ] Document failures and what they taught you

## Friday: Teach & Reflect
- [ ] Write summary (blog post, tweet thread, or vault note)
- [ ] Update mental model with what surprised you
- [ ] Connect to prior knowledge (add vault links)
- [ ] Review: What would I do differently next time?
```

---

## 8. Integration with Existing System

Your vault already has:
- Learning plan with 79 modules (77% complete)
- Signal tracking files monitoring progress
- Knowledge graph with concept linking

**What to add:**
1. `learning-issues/` directory — one issue per technique needing deeper study
2. Evaluation cards for new encounters before investing time
3. Weekly sprint structure for your ~10 hrs/week
4. Minimal working examples for each completed module
5. Evergreen note promotion for best learning session notes
