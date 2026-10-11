# MordomoOS — User Manual

## 1. First contact

Install the packaged app or a source checkout ([install.md](install.md)). Then:

```bash
mordomo launch       # starts the service if needed and opens http://127.0.0.1:4777
mordomo start        # the same, without opening the browser
```

The first visit shows the **setup screen**: which provider CLIs were found on
this computer (with the install or login command for the missing ones and a
*Detect again* button), your name/theme/language, one folder to index, data
connectors and the desktop look. Everything is editable later in Settings.
If none of the enabled providers can run yet (not installed, or signed out),
the OS opens with **Connect your AI first** and the top bar reads *login
required* until a `claude auth login` / `codex login` / `cursor-agent login`
succeeds; the console will not start a run before that.

The Command Centre opens on the **Dashboard**: active provider + quick
Claude/Cursor/Codex switcher, favorite skills with Run buttons, routines and
next executions, recent artifacts, in-progress runs, failures needing
attention, and 7-day metrics. The Second Brain card is the centrepiece.

Language (English/Português) and theme (dark/light/system) live in
**Settings → Identity**, next to the running version, the data folder and an
opt-in check for new releases. **Settings → Diagnostics** runs the doctor and
exports a redacted diagnostics file for bug reports.

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

### 2.1 Sharing skills: the marketplace

- **Install**: Skills → Marketplace lists every registry from Settings › Memory
  › Registries (an `https://` or `file://` `index.json`). Every file is
  downloaded and its SHA-256 checked before the catalog is touched; a
  mismatch refuses the install with the reason.
- **Publish**: `mordomo skills publish [dir] --out <registry-dir>` copies your
  skills (never `NOTES.md`) into the folder with an `index.json` signed by the
  Ed25519 key generated once into `config/registry-signing.json`. Serve the
  folder over https or sync it (a shared drive works: use the `file://` URL).
  The command prints the registry URL with `#key=<your public key>`; a
  consumer that keeps that fragment refuses an index that is unsigned,
  tampered or signed by anyone else. `mordomo skills key` prints the key.

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
  carries **Approve / Deny** buttons (a write that a paired phone asked for can be denied there but not approved: the chat shows one line, so you read the whole request in the Command Centre and approve it there); `/pending` lists what waits and
  `/approve <id>` / `/deny <id>` work as text. Only your chat id is honoured;
  anyone else who finds the bot gets silence. Decisions go through the same
  code path as the button in the Command Centre.
- **Push notifications**: install the Command Centre as an app (browser menu
  → Install), then turn on **Push notifications** in Settings › Notifications
  and the **Push channel** on the server side. Alerts arrive with the app
  closed. Payloads are encrypted end to end (RFC 8291) with keys the server
  generates once into `config/vapid.json`; the push service only relays
  ciphertext. Subscribed devices are listed and can be removed. The server only
  posts to a public `https` push service: an endpoint that points at this
  machine or its network (`localhost`, a private address, a name that resolves
  to one) is refused, when it is registered and again at every send. A paired
  phone needs *Read content* to register and may name only the browsers' own
  push services (Chrome/Edge, Firefox, Safari, Windows); its subscription
  disappears with it when you revoke the device or take that permission away.
  The inbox is yours: a paired phone reads it, but marking read and deleting
  alerts happen on the desktop.

### 5.2.2 Trends

**Settings › Trends** charts the numbers the desktop shows live — spend,
runs, failures, tokens, inbox unread, approval wait — from one sample per
hour (`metrics_samples`, 90 days), folded per day, with a table view. The
first sample lands at boot; the plan's §9 targets are measured here.

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
offline. Only paired devices are accepted on non-loopback hosts, only over TLS
or through a tunnel (7.1), and each one only does what you let it (7.1,
*What a device may do*).

## 7.1 Remote access

Settings › Security › **Remote access** answers to the hosts you list and
lets a phone or laptop pair with a six-digit code shown on the desktop; each
device gets its own token (revocable, with a lifetime). **Another machine is
served over TLS or through a tunnel, never plain http**: a request from outside
this machine on plain http is refused (`tls_required`), and `bindAddress`
beyond `127.0.0.1` only takes effect together with TLS (without it the
service stays on loopback and says so at start, and `mordomo doctor` warns).
Two ways to reach it safely:

- **Built-in TLS**: turn on **TLS for remote devices** and restart. A
  second https listener (port + 1) serves a self-signed certificate
  generated into `config/tls/` for the allowed hosts; the pairing screen
  shows its SHA-256 so the phone can compare with the desktop before
  trusting it. Loopback stays plain http on the main port, so the CLI and
  the MCP broker never change.
- **A tunnel or reverse proxy running on this machine** (recommended for a
  home network: Tailscale serve, Caddy, cloudflared): it terminates the
  encryption and forwards to `127.0.0.1` on the main port with the original
  `Host` header; add that host to the allowed hosts. **Do not rewrite `Host` to
  `127.0.0.1`** (nginx does unless told otherwise: add `proxy_set_header Host
  $host;` and `proxy_set_header X-Forwarded-For $remote_addr;`): a request
  that reaches the service from this machine with a loopback `Host` is taken
  for you, and gets the page with your token in it. The page withholds the
  token from a request that names a proxy (`X-Forwarded-For`, `Forwarded`,
  `X-Real-IP`, `Via`), so keep the original `Host` and let the proxy say who it
  forwards. A proxy on another machine is not a tunnel: it would reach plain
  http and is refused, so point it at the TLS port.

**What a device may do.** Before the code is shown you tick what the new
device will be allowed to: *Monitor* (see runs, approvals, notifications and
status), *Read content* (files, notes, memory, results), *Start runs*
(read-only runs on Claude; anything that writes waits for you) and *Approve*
(decide what other people or devices asked for, never its own requests).
Ticking one that needs another ticks it for you. The default is the first
three; a device paired before this existed has them too. Change a device's
permissions at any time with its **Permissions** button; the change applies to
its next request. A write a device asks for waits in your approvals with the
whole request in front of you: who asked, the provider, folder and mode, the
full prompt or every input of the skill, in boxes that scroll when they are
long (nothing is cut). Cancelling it from the phone withdraws the approval
too. Codex and Cursor read the whole disk, so a device cannot
start a run on them (you can, from the desktop); settings, backups, skills,
routines, connectors and memory writes stay yours alone.

Never expose the main port beyond this machine: it is plain http and it
listens on loopback only (`127.0.0.1`, or the loopback name `bindAddress`
gives; an address beyond loopback applies to the TLS listener alone).

Claude is the one provider a phone may use because Claude Code keeps reads to
the working folder, which its documentation says and this release has not
measured. If you prefer certainty, set Claude's `readConfinement` to `"none"` in
`adapters/claude/src/manifest.ts`: no paired device then starts a run at all.

## 7.2 Windows checklist

MordomoOS is validated on Linux and macOS in this release; on Windows keep
these in mind:

- `mordomo service plan` prints the Task Scheduler command before anything is
  installed; paths with spaces are quoted for you.
- Secrets on disk (`config/token`, `config/vapid.json`,
  `config/registry-signing.json`, `config/tls/key.pem`) are written with
  POSIX mode 0600; NTFS ignores it, so keep `MORDOMO_HOME` inside your user
  profile and out of shared folders.
- The fake provider CLIs the test suite uses are bash scripts; the tests
  that need them skip on Windows.
- Pairing, push, Telegram and TLS behave the same; the service binds to
  `bindAddress` on the main port and to the TLS port when enabled — allow
  both in Windows Defender Firewall for remote devices.

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
