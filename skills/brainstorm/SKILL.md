---
name: Structured Brainstorm
description: >-
  Run a structured brainstorming session on a topic: diverge widely, then
  converge on the strongest ideas with next steps.
triggers:
  - /brainstorm
  - "brainstorm"
  - "braimstorming de ideias"
inputs:
  - name: topic
    label: Topic / problem to explore
    type: textarea
    required: true
  - name: constraint
    label: Hard constraints (optional)
    type: text
    required: false
    placeholder: budget, time, tech stack, audience…
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Quantity before judgment in the diverge phase — no criticism until converge.
  - Respect the stated constraints; flag ideas that break them instead of hiding the conflict.
  - Output goes to the artifacts directory only.
successCriteria:
  - brainstorm.md contains 15+ distinct raw ideas and exactly 3 developed picks with next steps.
  - The 3 picks are genuinely different approaches, not variations of one idea.
examples:
  - "Topic: products I could build on top of my agent OS."
---

# Structured Brainstorm

Explore the topic using the method in `resources/methods.md` — read it first.

## Procedure

1. Frame: restate the topic as 2–3 "How might we…" questions honoring the
   constraints.
2. Diverge: generate 15–25 raw ideas across at least 4 of the lenses from the
   methods file. One line each; wild ideas welcome.
3. Converge: score ideas on impact × feasibility (given the constraints); pick
   the top 3, each from a different lens where possible.
4. Develop each pick: what it is, why now, first concrete step, main risk.
5. Write `brainstorm.md` in the artifacts directory with all phases, and reply
   with the 3 picks in one line each.
