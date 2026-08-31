---
name: Code Review
description: >-
  Review a diff, branch or folder for correctness bugs first, then
  simplification and efficiency — findings ranked by severity with evidence.
triggers:
  - /code-review
  - "review code"
  - "revisar código"
inputs:
  - name: project
    label: Project directory
    type: path
    required: true
  - name: target
    label: What to review
    type: text
    required: false
    placeholder: "uncommitted changes (default), a branch name, or a subfolder"
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: high
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Read-only — never fix anything in this run; the report is the deliverable.
  - Each finding needs file:line and a concrete failure scenario; no style nits without impact.
  - Verify each suspected bug by reading the surrounding code before reporting it.
successCriteria:
  - review.md exists with findings ranked most-severe first (or an explicit "no findings survived verification").
  - Zero findings that a reader could not reproduce from the given evidence.
examples:
  - "Review uncommitted changes in ./myapp before committing."
---

# Code Review

Review the requested target inside the project directory.

## Procedure

1. Determine the diff: default `git diff` + `git diff --staged` in the project;
   a branch → diff against the default branch; a folder → review its files.
2. First pass — correctness only: broken logic, unhandled edge cases, security
   issues, races, wrong types. For each suspect, read enough context to either
   confirm (with a failure scenario) or discard it. Discard what you cannot
   confirm.
3. Second pass — quality: dead code, duplication, needless complexity,
   obvious performance waste. Only items worth a change, ranked.
4. Write `review.md` in the artifacts directory: confirmed findings first
   (severity, file:line, failure scenario, suggested fix sketch), then quality
   notes, then a one-paragraph overall verdict.
5. Reply with the verdict and the count of findings by severity.
