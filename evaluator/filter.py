#!/usr/bin/env python3
"""
5-Question Evaluation Filter for AI Techniques

Usage:
    python evaluator/filter.py "Technique description"

    Or interactive:
    python evaluator/filter.py --interactive
"""

import sys
import json
from datetime import datetime

QUESTIONS = [
    {
        "key": "solves_problem",
        "question": "Does it solve a problem I actually have?",
        "weight": 0.30,
        "hint": "If you can't describe a concrete use case in your own work, skip it."
    },
    {
        "key": "stable_api",
        "question": "Is the API/interface stable enough to build on?",
        "weight": 0.20,
        "hint": "Check release cadence, breaking changes, community size."
    },
    {
        "key": "compounds",
        "question": "Does it compound with things I already know?",
        "weight": 0.20,
        "hint": "Techniques that build on your existing stack are higher leverage."
    },
    {
        "key": "quick_prototype",
        "question": "Can I prototype in under 2 hours?",
        "weight": 0.15,
        "hint": "If activation energy is too high for a quick test, park it."
    },
    {
        "key": "smart_people_excited",
        "question": "Are the smartest people I follow excited about it?",
        "weight": 0.15,
        "hint": "Simon Willison blogging with working code > HN hype."
    }
]

RED_FLAGS = [
    "No code examples in the announcement",
    "Requires hardware you don't have with no hosted alternative",
    "\"This changes everything\" claims with no benchmarks",
    "Tightly coupled to a single vendor's API",
    "The authors haven't shipped anything real with it"
]

GREEN_SIGNALS = [
    "Simon Willison blogged about it with working code",
    "Adopted by 2+ independent projects",
    "Clear \"getting started\" path under 30 minutes",
    "Solves a problem that's bitten you before"
]


def score_technique(answers: dict) -> dict:
    """Score a technique based on 5-question filter answers."""
    total = 0
    for q in QUESTIONS:
        if answers.get(q["key"]):
            total += q["weight"]

    if total >= 0.8:
        decision = "LEARN NOW"
        color = "🟢"
    elif total >= 0.6:
        decision = "LEARN LATER"
        color = "🟡"
    else:
        decision = "SKIP"
        color = "🔴"

    return {
        "score": total,
        "score_pct": f"{total * 100:.0f}%",
        "decision": decision,
        "color": color,
        "breakdown": {q["key"]: {"answer": answers.get(q["key"], False), "weight": q["weight"]} for q in QUESTIONS}
    }


def interactive():
    """Run the filter interactively."""
    print("=" * 60)
    print("5-Question Evaluation Filter")
    print("=" * 60)

    technique = input("\nTechnique name: ").strip()
    print(f"\nEvaluating: {technique}\n")

    answers = {}
    for q in QUESTIONS:
        print(f"  {q['question']}")
        print(f"  ({q['hint']})")
        response = input("  [y/n]: ").strip().lower()
        answers[q["key"]] = response in ("y", "yes")
        print()

    result = score_technique(answers)

    print("=" * 60)
    print(f"  {result['color']} Score: {result['score_pct']} — {result['decision']}")
    print("=" * 60)

    print("\n  Red flags to check:")
    for flag in RED_FLAGS:
        print(f"    □ {flag}")

    print("\n  Green signals to look for:")
    for signal in GREEN_SIGNALS:
        print(f"    □ {signal}")

    # Save evaluation card
    save = input("\nSave evaluation card? [y/n]: ").strip().lower()
    if save in ("y", "yes"):
        save_card(technique, answers, result)

    return result


def save_card(technique: str, answers: dict, result: dict):
    """Save an evaluation card as markdown."""
    filename = f"issues/eval-{technique.lower().replace(' ', '-')}.md"
    card = f"""# {technique} — Evaluation

**Date:** {datetime.now().strftime('%Y-%m-%d')}
**Score:** {result['score_pct']} — {result['decision']}

## 5-Question Filter

| Question | Answer | Weight |
|----------|--------|--------|
"""
    for q in QUESTIONS:
        answer = "✅ Yes" if answers.get(q["key"]) else "❌ No"
        card += f"| {q['question']} | {answer} | {q['weight']:.0%} |\n"

    card += f"""
## Red Flags
"""
    for flag in RED_FLAGS:
        card += f"- [ ] {flag}\n"

    card += f"""
## Green Signals
"""
    for signal in GREEN_SIGNALS:
        card += f"- [ ] {signal}\n"

    card += f"""
## Minimum Viable Experiment
What's the smallest thing I can build to test this?

[TODO]

## Notes
[After trying it]
"""

    with open(filename, "w") as f:
        f.write(card)
    print(f"  Saved to {filename}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--interactive":
        interactive()
    elif len(sys.argv) > 1:
        # Quick mode: assume all yes for the description
        technique = " ".join(sys.argv[1:])
        answers = {q["key"]: True for q in QUESTIONS}
        result = score_technique(answers)
        print(f"{result['color']} {technique}: {result['score_pct']} — {result['decision']}")
    else:
        print("Usage:")
        print("  python evaluator/filter.py 'Technique name'  (quick mode)")
        print("  python evaluator/filter.py --interactive      (full evaluation)")


if __name__ == "__main__":
    main()
