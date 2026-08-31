---
name: Agent Usage Report
description: >-
  Analyze how agents and subagents are used in a project: which are defined,
  which are actually invoked, and where delegation would help.
triggers:
  - /agent-usage-report
  - "agent usage"
  - "uso dos agents"
inputs:
  - name: project
    label: Project directory
    type: path
    required: true
    placeholder: /path/to/project
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Read-only outside the artifacts directory.
  - Only inspect the given project directory; never wander into other folders.
  - Evidence first — never claim an agent is unused without checking references.
successCriteria:
  - A report artifact lists every defined agent/subagent with its purpose, tools and usage evidence.
  - At least one concrete delegation recommendation (or an explicit "setup is already good").
examples:
  - "Run on a repo before restructuring its .claude/agents."
---

# Agent Usage Report

Map the agent landscape of one project and report how well it is used.

## Procedure

1. Inventory: look for agent definitions in the project —
   `.claude/agents/*.md`, `.cursor/` rules mentioning agents, `AGENTS.md`,
   `.agents/`, workflow files that spawn subagents.
2. For each definition capture: name, purpose (from its description), granted
   tools, model hints, and size of its prompt.
3. Usage evidence: search the project (docs, scripts, configs, recent logs if
   present) for references to each agent name.
4. Write `agent-usage-report.md` in the artifacts directory: a table of agents
   (name, purpose, tools, referenced-where), findings (orphans, overlaps,
   oversized prompts), and up to 3 delegation opportunities — repetitive tasks
   in the repo that a dedicated agent could own.
5. Reply with the artifact path and the single most valuable change.
