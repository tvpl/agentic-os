---
name: Claude Code Resource Optimizer
description: >-
  Audit the local Claude Code setup (skills, agents, MCP servers, CLAUDE.md,
  settings) and report what to clean, merge or slim down. Report only — it
  changes nothing.
triggers:
  - /claude-optimize
  - "optimize claude code"
  - "limpar recursos do claude"
inputs:
  - name: scope
    label: Extra directory to audit (optional)
    type: path
    required: false
    placeholder: a project folder with .claude/ inside
providers: [claude]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Strictly read-only — never edit, move or delete any configuration.
  - Never open credential files (.credentials.json, keys); list their presence only.
  - Recommendations must cite the exact file path and line-count evidence.
successCriteria:
  - A report artifact exists covering all five checklist areas with concrete file paths.
  - Each recommendation has an estimated impact (tokens/latency/clarity).
examples:
  - "Run monthly as maintenance."
---

# Claude Code Resource Optimizer

Audit this machine's Claude Code resources and produce a cleanup report.

## Procedure

1. Read `resources/checklist.md` in this skill folder and follow it area by
   area (`~/.claude` plus the optional extra directory).
2. For each area, gather evidence (file lists, line counts, sizes) before
   judging. Never open files that look like credentials.
3. Write `claude-optimization-report.md` in the artifacts directory:
   one section per checklist area → findings → prioritized recommendations
   (top 5 overall, ranked by impact, each with the exact command or edit the
   user could make manually).
4. Reply with the report path and the top 3 recommendations inline.
