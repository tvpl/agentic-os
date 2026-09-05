# MordomoOS — User Manual

## 1. First contact

After `scripts/setup.sh` (or `npm install && npm run build && npx mordomo setup`):

```bash
mordomo start        # → http://127.0.0.1:4777
```

The Command Centre opens on the **Dashboard**: active provider + quick
Claude/Cursor/Codex switcher, favorite skills with Run buttons, routines and
next executions, recent artifacts, in-progress runs, failures needing
attention, and 7-day metrics. The Second Brain card is the centrepiece.

Language (English/Português) and theme (dark/light/system) live in
**Settings → Identity**.

## 2. Skills (your SOPs as commands)

- **Run**: Dashboard button, or Skills → open → choose provider/model/effort +
  fill inputs → Run. Terminal: `mordomo run <slug> --provider codex --input focus=Finanças`.
- **Create**: Skills → New skill. Rule of thumb from ARMS: *if you prompted the
  same task twice, make it a skill*; keep SKILL.md under 60 lines.
- **Skill trees**: put long references/templates in the skill's `resources/`
  folder and let SKILL.md act as a router. Skills at ≥150 body lines are
  flagged **thick** in the UI and by `mordomo doctor`.
- **Export**: Skills → Export to providers (or `mordomo sync <dir> --apply`).
  One canonical skill becomes `.claude/skills/…`, `.cursor/commands/…`,
  `.agents/skills/…` plus CLAUDE.md/AGENTS.md. Files you edited by hand are
  flagged as conflicts and only overwritten with your per-file approval, after
  a backup.
- **Import**: `POST /api/skills/import` or copy a folder with a SKILL.md into
  `skills/` — it is validated on load.
- **Marketplace**: Skills → Marketplace lists skills from the registries in
  Settings › Memory; every file is sha256-checked and staged before it lands
  in `skills/` (an existing slug asks before being replaced).
- **Agent notes**: each skill can carry a `NOTES.md` next to SKILL.md. Add a
  line from a finished run's page (*Note for the skill*) or from the skill's
  **Notes** tab; the catalog folds the file into every run prompt, so lessons
  compound without editing the procedure itself.
- **Squads**: a run's page can fan out into up to 8 sub-agents (one prompt per
  paragraph); children are listed under the parent and follow its profile.

Every run writes its outputs to `artifacts/<run-id>/`; artifacts appear on the
Dashboard and in the run's page.

## 3. Memory & the Second Brain

- Choose folders in **Settings → Memory** (each can map to an area: Worker,
  Documentos, Finanças, Projetos — rename freely). Nothing is indexed without
  explicit selection; exclusions (`.git`, `node_modules`, `.env*`, keys, …)
  are honored *before* reading. Your files are never moved or renamed.
- **Refresh**: Second Brain → Refresh index, or `mordomo index` (also
  regenerates the routers in `memory/`).
- **Routers** (`memory/ROUTER.md` + `memory/areas/*.md`) are the agent-facing
  map — compiled into CLAUDE.md/AGENTS.md on sync. `mordomo doctor` flags
  broken pointers and stale routers.
- **Second Brain**: graph (zoom with the wheel, drag to pan, click a node) or
  grid; search as you type; filter by area/type; preview is text-only and
  secret-blocked; copy the full path or open the file explicitly. "Related
  files" explains *why* two files are connected (markdown link, same folder,
  similar content).
- **Similar content** edges come from a TF-IDF cosine over the indexed text
  (no model, no network; top 3 per file). They are off by default — toggle
  them in the legend; the count is always shown. The force layout runs in a
  Web Worker, so large graphs never freeze the page.

### 3.1 Recall, journal and consolidation

- **Recall instead of grep**: `mordomo recall "what did we decide about the Q3
  budget?"` (or the `/recall` skill, or `GET /api/memory/recall?q=&k=`) scores
  the index without opening files, opens only the best 3, and returns the
  matching **sections** with a token estimate — far cheaper than letting an
  agent read whole files.
- **Daily journal**: `memory/journal/YYYY-MM-DD.md` is created on first access
  each day with *Today / Decisions / Open loops / Runs*; finished runs log
  themselves, and today + yesterday are injected into `memory/ROUTER.md` under
  `settings.memory.journalBudgetTokens` (default 1200).
- **Consolidation**: the `consolidate-memory` skill promotes recurring journal
  notes into `memory/MEMORY.md` and never deletes — contradicted lines move to
  *Superseded* and facts get a `valid_to`. The routine *Nightly memory
  consolidation* (03:00) ships **enabled** under `review_before_write`: it
  runs, parks its write for your approval in the inbox, and nothing changes
  until you say so. Disable it in Routines if you prefer a manual cadence.
- **Hygiene**: Second Brain → Hygiene (or `GET /api/memory/hygiene`) lists
  orphan notes, broken router pointers, files untouched for 90 days, skills
  never run, silent routines and connectors unused for 30 days.
- **Inline fields**: write `owner:: Ana` in any note and query it with
  `GET /api/memory/query?where=owner:Ana`.

Full details, including how to measure the token saving before and after:
[docs/memory-guide.md](./memory-guide.md).

## 4. Routines (scheduled work)

Routines → New routine: name, a skill (or free prompt), cron schedule +
timezone, provider/model/effort, missed-run policy (*skip* or *run on next
boot*), timeout, attempts, security profile. Routines are created **paused**
unless you tick Enabled — including the seeded *Daily workspace digest*.

- **Test now** fires it immediately and links to the live run.
- **History** shows every firing with its run; repeatedly failing routines are
  flagged on the Dashboard.
- Routines fire while the MordomoOS service is running. For login autostart:
  `mordomo service install` (systemd --user on Linux, launchd on macOS, Task
  Scheduler on Windows) — always shown and confirmed before anything is
  installed. With the *run on next boot* policy, missed schedules are caught up
  when the service starts.

## 5. Connectors

Connectors → **Run audit**: discovers MCP servers already configured for
Claude/Cursor/Codex (names and commands only — credential values are never
read) and recommends at most 3 additions, official/maintained first. Each
registry entry shows origin, maintainer, auth method, permissions, read/write
operations, risks and health. Enabling write operations always creates a
pending approval in Settings. Install/authenticate steps are never performed
without you.

## 5.1 The Console (talk to the agent)

The **Console** widget on the desktop is a conversation, not a one-shot
prompt. Every message continues the same session: MordomoOS resumes the
provider's own conversation (`claude --resume`, `codex exec resume`), so the
agent remembers what you said two turns ago. The thread shows each turn — what
you asked, the reply, how many tools it used, what it cost — and streams while
the agent works. **Stop** cancels the running turn, **New conversation** starts
fresh, **Open run** jumps to the full log. A bare `/slug` still runs the skill.
Sessions are listed by `GET /api/sessions` and continue with
`POST /api/sessions/:id/continue`.

Providers that cannot resume a conversation natively (cursor-agent has no
resume flag; older Codex builds lack `exec resume`) still keep the thread:
MordomoOS folds the earlier turns of the session into the next prompt as a
quoted transcript (newest six turns, capped) and marks the run with a
"session emulated" line in its log.

## 5.2 Budget and the inbox

Set a **daily budget** (Settings › Security). The Cost widget shows the bar,
"Needs attention" flags 80 % and 100 %, and the inbox gets one row per day per
level. The inbox itself is persisted on the server: approvals, failed runs,
routine alerts and budget crossings survive a closed tab and are read from
`GET /api/notifications` on load.

Budgets also exist per routine (**Daily budget** in the routine editor) and
per skill (`budgetUsd` in the SKILL.md frontmatter, shown as a badge). A
fire or a run past its cap is skipped and refused with the reason, flagged
once a day in the inbox, and the remaining amount rides on each run as its
cap for providers that report cost while running.

### 5.2.1 Alerts that reach you outside the tab

- **Telegram** (Settings › Notifications): set the bot token in the
  environment variable named there, paste your chat id, pick the lowest tone.
  Turn on **Answer from the phone** and every alert about an approval
  carries **Approve / Deny** buttons; `/pending` lists what waits and
  `/approve <id>` / `/deny <id>` work as text. Only your chat id is honoured;
  anyone else who finds the bot gets silence. Decisions go through the same
  code path as the button in the Command Centre.
- **Push notifications**: install the Command Centre as an app (browser menu
  → Install), then turn on **Push notifications** in Settings › Notifications
  and the **Push channel** on the server side. Alerts arrive with the app
  closed. Payloads are encrypted end to end (RFC 8291) with keys the server
  generates once into `config/vapid.json`; the push service only relays
  ciphertext. Subscribed devices are listed and can be removed.

## 5.3 The HUD

The desktop core reacts to what the agent does — thinking, using a tool,
answering, alerting, done — and a HUD layer adds scanlines, corner brackets,
a radar sweep and telemetry. **Settings › Theme › HUD intensity** scales all
of it (0 turns it off); the **JARVIS** preset is the cyan-on-black look.
`prefers-reduced-motion` disables every animation. With the sound toggle on
(Settings › Notifications) the HUD also plays a short ack when a run starts,
a chord when it finishes and a low tone when it fails; **System
notifications** and **Spoken alerts** cover the time the tab is hidden.
Sentinels (repeated failures, silent routines, connector changes, the
"did it twice" nudge, folder watch) live in the same tab, with optional
Telegram delivery.

The Console has a microphone (speech → prompt) and *Read aloud* on every
reply; the core turns to *listening* while the mic is open.

## 6. Runs & observability

Runs page: every execution with status
(`queued/running/done/failed/cancelled/interrupted`), provider, origin,
duration; open one for the live event log (SSE), the prompt, artifacts and an
actionable error message. **Cancel** stops the underlying process (kill-tree).
Logs are JSONL in `logs/` (rotated, secret-redacted, retention configurable);
diagnostics export: `GET /api/diagnostics/export`.

## 7. Security profiles & approvals

Settings → Security: `read_only` → `review_before_write` → `controlled_write`
→ `approved_automation`. Regardless of profile, these always require explicit
approval: installing software, changing global configs, destructive commands,
accessing new folders, connector writes, startup services, exposing ports,
sending data to external services. Pending approvals appear in Settings.

Under `review_before_write` and `controlled_write` the agent's own tool
prompts (write a file, run a command) are brokered to you **mid-run**: the
run page and the Console show the tool and its input with Allow / Deny, and
the run continues the moment you answer (timeout: `limits.toolApprovalTimeoutMs`).

**Remote access** (Settings › Security): off by default. When enabled, a
phone or laptop pairs with a 6-digit code and gets its own token (expiry and
revoke list there); the Command Centre installs as a PWA and keeps its shell
offline. Only paired devices are accepted on non-loopback hosts.

## 8. The 7-day adoption plan (from the ARMS guide)

1. **Day 1 — Skills**: run `workspace-digest`; create one skill from your most
   repeated task. 2. **Day 2 — Skills**: split a thick skill / pin favorites.
3. **Day 3 — Memory**: pick folders, refresh index, check the routers.
4. **Day 4 — Routines**: enable the daily digest or create your own.
5. **Day 5 — Applications**: run the connector audit, wire the top pick.
6. **Day 6 — Command Centre**: set language/theme/accent; star what you use.
7. **Day 7 — Test day**: `mordomo doctor`, fix warnings by editing files.
Weekly maintenance ≈ 15 min: `mordomo doctor` (stale routers, thick skills,
silent routines) and the do-it-twice rule.
