# Creating skills

A skill is a folder in `skills/<slug>/` with a `SKILL.md` (YAML frontmatter +
markdown body) and optional `resources/` files. Files are the source of truth;
the UI and CLI are just editors.

## Minimal skill

```markdown
---
name: Clean Downloads
description: Sort the downloads folder into the right places.
triggers: ["/clean-downloads"]
mode: write
providers: [claude, cursor, codex]
guardrails:
  - Never delete anything — move to an "_archive" folder instead.
successCriteria:
  - Downloads contains only files from the last 7 days.
---

# Clean Downloads

1. List ~/Downloads.
2. Move installers to _archive/installers, documents to ~/Documents/inbox.
3. Report every move with full paths.
```

## Frontmatter reference

| Field | Meaning |
|---|---|
| `name`, `description` | Human name + what/when (description doubles as trigger text on export) |
| `triggers` | Slash command + phrases that should invoke it |
| `inputs` | Form fields for the run button: `{name, label, type: text\|textarea\|path\|select, required, placeholder, options}` |
| `providers` | Which adapters may run it |
| `recommendedModel` / `recommendedEffort` | Defaults offered in the run form |
| `mode` | `read_only` (writes only in the run's artifacts dir) or `write` |
| `guardrails` / `successCriteria` | Injected into every export; shown in the UI |
| `version`, `changelog` | Keep history when you edit |
| `enabled` | Disabled skills are not exported or runnable |

## Rules that keep skills good (from ARMS)

1. **Under 60 body lines.** Short skills get followed; long ones get skimmed.
2. **Progressive disclosure.** At ≥150 lines the catalog flags the skill as
   *thick*: move references, templates and examples into `resources/` and make
   SKILL.md a router that says which file to read for which job — the agent
   must read only what the current task needs. See `skills/sdd-plan/` or
   `skills/brainstorm/` for the pattern.
3. **Artifacts, not chat.** Tell the skill to write outputs into the artifacts
   directory — that's what makes results appear in the Command Centre and in
   `mordomo run`.
4. **Guardrails are part of the skill.** Write what it must never do.
5. **Do-it-twice rule.** Prompted the same thing twice? It becomes a skill.

## Running

- UI: Skills → open → Run (choose provider/model/effort, fill inputs).
- CLI: `mordomo run <slug> --provider claude --effort high --input key=value`
- API: `POST /api/skills/<slug>/run` → `{runId}`; stream via
  `GET /api/runs/<id>/stream`.

## Exporting to providers

`mordomo sync [target] --apply` (or Skills → Export) compiles every enabled
skill into:

- Claude: `.claude/skills/<slug>/SKILL.md` (+ resources), `CLAUDE.md`
- Cursor: `.cursor/commands/<slug>.md`, `.cursor/rules/mordomo.mdc`, `AGENTS.md`
- Codex: `.agents/skills/<slug>/` (+ resources), `AGENTS.md`

The compiler keeps a hash manifest; existing files it didn't write (or that you
hand-edited) become **conflicts** that require per-file approval and are backed
up before overwrite. The canonical skill never changes on export.
