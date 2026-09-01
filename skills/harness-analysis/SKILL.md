---
name: Project Harness Analysis
description: >-
  Analyze a project's agent harness — CLAUDE.md/AGENTS.md, hooks, settings,
  permissions, CI guards — and report gaps against good practice.
triggers:
  - /harness-analysis
  - "harness analysis"
  - "analise de harness"
inputs:
  - name: project
    label: Project directory
    type: path
    required: true
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Read-only outside the artifacts directory; inspect only the given project.
  - Never read credential-pattern files; report their presence only.
  - Every finding must cite a file path (or state the file is absent).
successCriteria:
  - A report grades each harness dimension (instructions, skills, hooks, permissions, CI) with evidence.
  - Top 3 fixes are concrete enough to apply without further research.
examples:
  - "Run on a repo before onboarding agents to it."
---

# Project Harness Analysis

Assess how well the project is set up for agentic work.

## Procedure

1. Inventory the harness surface in the project directory:
   `CLAUDE.md` / `AGENTS.md` (and nested ones), `.claude/` (settings, skills,
   agents, hooks, commands), `.cursor/` (rules, commands, cli.json, mcp.json),
   `.agents/`, `.mcp.json`, CI workflows that gate agent output (lint, tests,
   typecheck).
2. Grade five dimensions from evidence, each A–D:
   **Instructions** (present? current? concise? build/test commands stated?),
   **Skills/commands** (repeated tasks captured?), **Hooks/guards** (format,
   lint, dangerous-command guards?), **Permissions** (least privilege? risky
   allowlists?), **Verification** (can an agent prove its work — tests, CI?).
3. Write `harness-report.md` in the artifacts directory: grades table with
   evidence, per-dimension findings, and the Top 3 fixes with exact file paths
   and suggested content sketches.
4. Reply with the grades line (e.g. "B A D C B") and the top fix.
