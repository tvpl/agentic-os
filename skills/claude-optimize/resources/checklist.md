# Audit checklist (read-only)

## 1. Skills (`~/.claude/skills`, `<project>/.claude/skills`)
- Count skills; flag SKILL.md bodies ≥ 150 lines (thick — should become a file tree).
- Flag skills with overlapping trigger words or near-duplicate descriptions.
- Flag skills not referenced anywhere and likely unused.

## 2. Memory files (`CLAUDE.md`, `~/.claude/CLAUDE.md`)
- Flag CLAUDE.md over ~150 lines: it loads on every session and taxes every prompt.
- Flag stale pointers (paths that no longer exist).
- Flag duplicated rules that also live in skills.

## 3. Agents (`~/.claude/agents`, `<project>/.claude/agents`)
- List custom agents; flag ones with giant prompts or unused tool grants.

## 4. MCP servers (`~/.claude.json`, project `.mcp.json`)
- List configured servers (names/commands only — never credentials).
- Flag servers that look unused or duplicated across scopes.

## 5. Settings & hooks (`~/.claude/settings.json`, project settings)
- Flag risky permissions (broad Bash allowlists, bypass modes).
- Flag hooks that run on every prompt with heavy commands.

For every flag: file path, evidence (numbers), and the manual fix in one line.
