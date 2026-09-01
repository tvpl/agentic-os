---
name: SDD Coding Plan
description: >-
  Turn a feature idea into a Spec-Driven Development plan: spec, acceptance
  criteria, technical plan and verifiable task breakdown.
triggers:
  - /sdd-plan
  - "sdd"
  - "planejamento de codificação"
inputs:
  - name: feature
    label: Feature / change to plan
    type: textarea
    required: true
  - name: project
    label: Project directory (optional)
    type: path
    required: false
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: high
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Planning only — write no code and change no project files; all output goes to the artifacts directory.
  - Ground every technical statement in the actual codebase when a project path is given.
  - Unknowns become explicit open questions, never guesses.
successCriteria:
  - spec.md, plan.md and tasks.md exist and cross-reference each other.
  - Every task has a verification step ("done when…").
examples:
  - "Plan 'add CSV export to the reports page' against ./myapp."
---

# SDD Coding Plan

Produce a three-artifact SDD package for the requested feature. Use
`resources/templates.md` for the exact structure of each artifact.

## Procedure

1. If a project path was given, explore it read-only: stack, conventions,
   the modules the feature touches. Cite real files in the plan.
2. Write `spec.md` — WHAT and WHY: user story, scope in/out, acceptance
   criteria (testable), open questions.
3. Write `plan.md` — HOW: architecture choice with alternatives considered,
   affected files, data changes, risks with mitigations.
4. Write `tasks.md` — ordered small tasks; each names its files and its
   "done when" verification; independent tasks marked parallelizable.
5. Reply with the three paths and the biggest open question, if any.
