# Changelog

## 0.8.0 — 2026-09-05

The ten follow-ups proposed after the plan closed, in the order they were
suggested, each shipped with its tests.

- **Answer from the phone**: Telegram alerts about approvals carry Approve /
  Deny buttons and `/pending`, `/approve`, `/deny` commands; a long poll on
  the bot honours only the configured chat id and decides through the same
  code path as the Command Centre button.
- **Web Push**: RFC 8291 `aes128gcm` encryption and VAPID ES256 written on
  `node:crypto` (matches the RFC test vector byte for byte); keys in
  `config/vapid.json`, subscriptions in SQLite, dead endpoints dropped; the
  installed PWA subscribes from Settings › Notifications and hears alerts
  while closed.
- **E2E coverage** for pairing, mid-run tool approval, squads and the
  marketplace, driven through the UI against the fake CLI; `file://`
  registries; marketplace Refresh bypasses the server cache; verification
  failures answer with the reason.
- **Event-driven cache**: SSE invalidations coalesced per key, a wider event
  map, every remaining poll demoted to a slow fallback.
- **Emulated sessions** where the provider cannot resume (cursor-agent,
  older codex): earlier turns folded into the prompt, no more "starting
  fresh".
- **Related edges at index time**: term vectors and cosine neighbours stored
  by the indexer (`file_terms`, `file_related`), refreshed incrementally for
  the files that changed.
- **Skill notes hygiene**: `limits.skillNotesMax` archives old entries to
  `NOTES.archive.md`; a promote run folds recurring lessons into SKILL.md,
  parked for approval under review profiles.
- **Budgets per routine and per skill** with a cap on each run; fires and
  runs past the cap are skipped or refused with the reason and flagged once
  a day.
- **Trends**: hourly metrics samples (90 days) and Settings › Trends with six
  single-series charts and a table view — the plan's §9 targets are now
  measurable.
- **Marketplace publisher**: `mordomo skills publish` builds a registry with
  SHA-256 per file and an Ed25519-signed index; `#key=` on a registry URL
  pins the publisher; rows show signed ✓ / unsigned.
- **Built-in TLS for remote devices**: a self-signed X.509 certificate
  generated without dependencies, a second https listener for the allowed
  hosts, the fingerprint on the pairing screen; loopback stays http.
- Also: axe audits now cover Second Brain, Runs, Routines and Connectors;
  the Windows checklist in the manual.
- Migrations 8–11 (`push_subscriptions`, `file_terms` + `file_related`,
  `runs.max_cost_usd`, `metrics_samples`). Settings added:
  `channels.telegram.inbound`, `channels.push`, `limits.skillNotesMax`,
  `remote.tls`; `routines.budgetUsd`, SKILL.md `budgetUsd`.
- Not done, on purpose: rendering the Second Brain in an OffscreenCanvas
  worker. It needs the whole draw pipeline and the world state to cross the
  worker boundary every frame; with the physics already off the main thread
  the remaining cost is bounded by the edge budget and the idle throttle.

## 0.7.0 — 2026-09-04

Every remaining item of the evolution plan (`docs/plan-2026-09/`): the rest
of Onda 1 and 2, Onda 3 and Onda 4. Nothing in the plan is pending.

- **Tool approvals mid-run** (Onda 1): in `review_before_write` and
  `controlled_write`, the Claude adapter runs with `--permission-prompt-tool`
  pointed at a MordomoOS MCP server (`mordomo mcp permission`) that turns
  each tool prompt into a `tool_use` approval; the run page and the Console
  show the card while the run waits, with Allow / Deny. `mordomo mcp` also
  serves the memory (recall, facts, journal), skills and inbox as MCP tools
  for any client. Journal lines carry the skill or prompt head, session id,
  files changed and a reply gist.
- **Sentinels and triage** (Onda 2): repeated-failure, silent-routine,
  connector-delta, repeat-detector (the *did it twice* nudge that offers to
  save a prompt as a skill), fs-watch and a cheap-model triage, each with a
  toggle in Settings › Notifications; Telegram delivery with a test button;
  the inbox becomes a system notification and, optionally, a spoken line
  when the tab is hidden. The Now panel shows the **next step** for a fresh
  install (folder → run → routine → budget → connector).
- **Remote access and the shell** (Onda 3): device pairing (6-digit code,
  per-device tokens with expiry, revoke list) behind `settings.remote`, a
  pairing screen on non-loopback hosts; the Command Centre installs as a
  **PWA** (manifest, service worker, icons) and keeps working offline for
  the shell; voice in the Console (mic → prompt, Read aloud per reply, the
  core shows *listening*); **squads** — fan a run out into up to 8 sub-agents
  from its page, with a children list; a verified **skill marketplace**
  (registries in Settings › Memory, sha256-checked, staged before install).
- **Second Brain and skills** (Onda 4): *Similar content* edges from a
  dependency-free TF-IDF cosine over the indexed text (top-3 per file, off
  by default in the legend, counted always); the force layout runs in a
  **Web Worker** with positions applied per frame (inline fallback where
  workers are missing); labels no longer overlap (greedy collision, selected
  and matched files win). **Agent notes**: every skill gets a `NOTES.md`
  appended from run pages (*Note for the skill*) or the skill's Notes tab,
  and folded into every run prompt. The nightly memory consolidation ships
  **enabled** (03:00, `review_before_write`, so it parks for approval).
- **HUD sound**: a short ack when a run starts, a chord when it finishes, a
  low tone on failure — same toggle as the inbox blip, burst-guarded for
  squads.
- APIs added: `GET/POST /api/approvals/tool`, `GET /api/approvals/:id`,
  `POST /api/runs/:id/children`, `GET /api/runs/:id/children`,
  `GET /api/skills/registry`, `POST /api/skills/install`,
  `GET/POST /api/skills/:slug/notes`, `POST /api/pair/start`,
  `POST /api/pair/claim`, `GET/DELETE /api/devices`,
  `POST /api/channels/telegram/test`, `/api/memory/graph?related=`.
  Settings added: `limits.toolApprovalTimeoutMs`, `remote`, `marketplace`,
  `sentinels`, `channels`. Migration 7 (`devices`).

## 0.6.0 — 2026-09-04

The evolution plan (`docs/plan-2026-09/`) executed: Onda 0 in full, the
desktop harmony pass, the "HUD Mordomo" visual layer, sessions with a
conversational Console (Onda 1) and the first slice of Onda 2 (budget,
persisted inbox).

- **Desktop harmony**: a 20-row, content-first default layout; widgets never
  clip (scroll shadows on the frame, corner brackets on the non-scrolling
  section, a 1px bevel on top); one hero size (`--fs-hero`) for every widget
  figure, so the clock and the counters stop shouting; the ring, the core and
  the Now panel anchor to the free region between the widget columns
  (`freeRegion()`), so chips never hide behind widgets at 1024 or 1440; the
  stacked column on phones grows with its content and gets a bottom
  navigation; the byline hides under 1200px; the light theme drops the glow
  and gets visible canvas lines.
- **HUD layer**: the wallpaper core reacts to the event stream — thinking
  (arcs and converging particles), tool (a blip leaves the core), responding
  (radial pulses), alert (amber, brackets blink), done (a flash) — with a
  radar sweep and reactor arcs; a CSS overlay adds scanlines, a vignette and
  corner brackets, all scaled by `--hud-intensity` (slider in Settings ›
  Theme, per-preset defaults, 0 turns it off); telemetry strips under the
  top bar (runs, tokens/h, spend, memory, skills, routines); a boot sequence
  replaces the blank first frame; the **JARVIS** preset (cyan on cold black);
  Rajdhani and JetBrains Mono bundled as latin subsets; widgets materialise
  with a wipe, the palette opens as an iris, toasts arrive as a transmission,
  the primary button charges on press. Everything honours reduced motion.
- **Sessions and the Console** (Onda 1): a `sessions` table, `runs.session_id`
  and `--resume` in the Claude adapter (`--session-id` on the first turn),
  `POST /api/runs { sessionId }`, `GET /api/sessions`, `GET /api/sessions/:id`,
  `POST /api/sessions/:id/continue`, `DELETE /api/sessions/:id`. The desktop
  Prompt became the **Console**: a thread of turns (what you asked, what the
  agent answered, tool calls, cost, duration) that streams live, with Stop,
  New conversation and a link to the full log.
- **Budget and inbox** (Onda 2, first slice): `limits.dailyBudgetUsd` with a
  bar in the Cost widget, rows in Needs attention at 80 % and 100 % and a
  notification once per day per level; notifications persist server-side
  (`GET /api/notifications`, `POST /api/notifications/read`) and seed the
  feed on load, so closing the tab no longer loses them.
- **Onda 0 fixes**: the machine timezone by default (also with
  `setup --defaults`); the model list no longer duplicates aliases as rows;
  `/api/meta` reports the root version and every workspace carries the same
  version; `activeRunCount` uses `COUNT(*)`; the per-run stream sends events
  straight to the client with a buffered replay for `Last-Event-ID`;
  retention for finished runs and routine history with a weekly `VACUUM`;
  approvals expire (`limits.approvalTtlDays`) and a gated run is parked as
  `waiting_approval` with its own id; concurrency slots honour a lowered
  limit; "Needs attention" no longer lists runs in progress; text artifacts
  show their first lines as the thumbnail; the settings view is typed
  (`SettingsDoc`); layout metrics are reported after commit, and a resize no
  longer rebuilds the canvas sprites.

## 0.5.0 — 2026-09-03

The September analysis (`docs/analysis-2026-09/`) executed end to end: the frame
by frame study of the RUBRIC "Agentic OS" plus the open-source state of the art,
turned into code across seven frontiers.

- **Second Brain**: the view dropped from 1505 to 470 lines over pure modules.
  All three edge kinds survive to the canvas with their own stroke, legend entry
  and toggle (only markdown links used to make it). New **Arcs** layout, the
  default: each area gets a sector proportional to the square root of its size
  and its files ride concentric arcs ordered by folder and date, with sub-folders
  as counted planets. Hovering a file lights its neighbours; **Local** mode keeps
  only what is within N hops. Filters by extension, tag, date and size, plus
  query groups that recolour matches. Hub clicks explode deterministically with
  camera framing instead of a random burst. Markdown previews render with
  clickable file and skill links and a relations card grouped by kind. Nodes drag
  and pin, the timeline scrubs the graph by date, and selection, layout and
  filters live in the URL. The render loop only runs at 60 fps while something
  moves, drops to 12 at rest and stops when the tab is hidden.
- **Desktop**: the wallpaper is a real 3D wireframe icosphere rotating on two
  axes with depth-based edge alpha, over a particle core drawn from pre-rendered
  glow sprites. The artifact ring numbers its chips, labels them on hover and
  reveals every label on demand; a search mode dims the desktop, counts matches,
  rings only the hits and opens a detail modal while the background recedes.
  Widgets drag by transform with FLIP neighbours and a snap on release. A widget
  registry brings an add gallery, per-widget configuration and duplication. New
  Prompt, Inbox, Agenda, Calendar, E-mail and Cost widgets; the routines board
  shows a runner per row and the count fired today; the Now panel is never empty.
  Artifacts and Generations galleries with thumbnails, filters and a lightbox.
- **Shell**: the launcher became a command palette (⌘K) with nested pages,
  actions, skills, files and runs. Modals animate out, routes cross-fade through
  the View Transitions API, dialogs push the background back, and every
  interactive surface has a pressed state. Notifications collect from the event
  stream with unread counts and an optional sound. Four theme presets.
- **Runs**: adapters parse token usage and cost from the provider streams and a
  migration persists them per run; `/api/metrics` reports today, week, tokens and
  burn rate. Run detail gained cost badges, a changed-files card with git diffs,
  run again, continue, copy log, timeline search, a context meter and a canvas
  replay with a scrubber. Approvals resolve inline instead of redirecting.
- **Routines and connectors**: five schedule kinds (`cron`, `at`, `every`,
  `on-exit`, `heartbeat`) with execution context, delivery and active hours; a
  runner and a fired-today summary. A read-only MCP stdio client behind argv-only
  spawning feeds `GET /api/connectors/:id/data`, with mappings for Google
  Calendar and Gmail, so the calendar and e-mail widgets can show real items.
- **Memory**: layered recall scores candidates from the index and routers without
  opening files, opens only the best few, picks the matching section and follows
  one pointer, reporting how many candidates it weighed against how many it read.
  A daily journal is created on demand, fed by finished runs and injected into the
  master router under a token budget. Hygiene reports orphans, dangling links,
  stale files, unrun skills, silent routines and unused connectors. Facts are
  bi-temporal: a new assertion closes the previous one instead of deleting it.
  Inline `key:: value` fields are indexed and queryable.
- **Skills and settings**: the SKILL.md body no longer renders in the faint
  file-path style; it gets a mono block with a line gutter, a copy button and a
  rendered-markdown toggle. Skills carry rich resources served containment-safe
  with per-kind previews. Settings gained theme presets, widget visibility, micro
  apps, the notification sound and the webhook and connector allowlists. Pixel
  Studio gained redo, frame keys, brush sizes, onion skin and a sprite sheet.
- **Quality**: 291 backend tests, 185 frontend tests and 34 end-to-end checks
  pass; lint and typecheck are clean. The theme boot script moved into the bundle
  so it stops violating the Content Security Policy.

## 0.4.0 — 2026-09-02

Hardening release: the September audit (`docs/audit-2026-09/`) executed end to end.

- **Security**: every `:id`/`:slug` route parameter validated (path traversal in
  `DELETE /api/routines` and `/api/connectors` closed, also at the store level);
  Host header parsed with `new URL` (IPv6, missing Host refused); token compared
  in constant time; preview/open honour the exclusion list plus a hard directory
  blocklist (`.git`, `.aws`, `.ssh`, …); skill import and sync targets contained;
  path containment resolves symlinked parents even for files that do not exist
  yet (a symlinked directory cannot smuggle a new file outside the roots);
  security profiles are enforced (`read_only` refuses write runs,
  `review_before_write` creates a `write_run` approval, routines write only under
  `approved_automation`); zod errors return 400 with a structured envelope.
- **Data**: backups use SQLite's online backup API (no more empty copies while
  WAL is open); API restores are staged and applied at boot; migration v2 adds
  `parent_run_id` and `pid`; run/event retention; `Last-Event-ID` on SSE.
- **Runtime**: graceful shutdown cancels active runs before closing the DB;
  run lifecycle is an explicit state machine (`timed_out` distinct); cancellation
  via `AbortSignal`; retries create a new run per attempt; croner `protect` works;
  scheduler errors never crash the process; adapters reload when settings change;
  partial settings updates deep-merge; settings cached by mtime; indexer runs in
  transactions, in slices, with progress events; stores skip corrupt files.
- **API**: `/api/events` SSE firehose, request log (`logs/api.jsonl`), real
  `/api/health`, version read from `package.json`, `npm audit` in `doctor`.
- **CLI**: `node:util.parseArgs`, validated `--provider/--effort`, pidfile
  identity (command line checked on Linux, macOS and Windows), quoted startup
  units, `service.out.log` rotation, `index` progress.
- **Command Centre**: app chrome in normal flow (no more hidden primary
  buttons); memoised `useT`; modals and launcher with focus trap, restore and
  animations; launcher search; ErrorBoundary and `React.lazy` per route (main
  chunk 367 kB → 60 kB); TanStack Query with one shared cache invalidated by the
  event stream (no more 4/5/10 s polling); desktop split into widgets with
  per-widget loading/error, a "Now" panel (active runs, next routine, latest
  artifacts), layout persistence without races, stacked layout below 900 px,
  keyboard move/resize; runs with a virtualized event timeline, filters and
  cancel; Second Brain with modifier-guarded zoom keys, preview race fix, hub
  lookup map, theme-aware palette, collapsed advanced controls, left-docked
  preview and a keyboard-navigable file list; Routines with cron validation and
  next-runs preview; Settings in tabs; 3-step Setup; Pixel Studio draft and
  unsaved-work guard; design tokens (spacing, type, z-index, motion), primitives,
  accent-derived contrast (AA), light-theme canvases, i18n parity enforced by test.
- **Providers**: `ProviderRegistry` with manifests + factories; the sync
  compiler, connector auditor, run manager write detection and API
  composition are generic over the registry; `/api/providers` exposes
  `displayName`, `capabilities` and `installHint`.
- **Second Brain engine**: world model, layouts, physics and hit testing
  extracted into pure modules (`src/brain/engine/`) with unit tests.
- **Component gallery**: `gallery.html` (`npm run gallery`) renders primitives
  and widgets with fixtures in both themes; Playwright screenshot baselines.
- **Tooling**: ESLint 9 + Prettier + husky/lint-staged, GitHub Actions CI
  (Node 22/24 × three OSes + e2e), frontend unit tests, Playwright smoke with
  axe; `npm audit` clean (fastify/static, vite, vitest updated). Node 22 is
  the minimum: Node 20 is end-of-life and better-sqlite3 12 ships no prebuilt
  binaries for it.

## 0.3.0 — 2026-08-31

The OS release: it stops being a web page and becomes a desktop.

- **OS shell**: sidebar removed. The fullscreen desktop IS the dashboard;
  every app (Skills, Routines, Runs, Connectors, Pixel Studio, Settings)
  opens over it with a "Back to the OS" chip; app launcher overlay
  (☰ Menu / Ctrl-⌘ M), Esc returns to the desktop.
- **Drag-and-drop widget desktop**: widgets snap to a 24-column grid and can
  be dragged, resized (corner handle) and hidden in edit mode (✏), with the
  layout persisted server-side in settings; reset layout anytime. Widgets:
  Micro Apps, Today (live clock, timezones, quarter-week dots, what's next),
  Workspace (indexed files with per-area glow dots), Skills Deck
  (model × effort matrix), Routines board, Pulse (metrics + 14-day run
  sparkline), Needs Attention. Wallpaper: starfield + additive-glow particle
  core built from the real index, ringed by recent artifacts/files.
- **Second Brain — the ARMS universe**: concentric labeled rings around a
  pixel ROUTER.MD core — SKILLS (spark nodes → open the skill), MEMORY (area
  hubs with folder-icon discs, counts, and expandable file nebulas with fan
  lines — click a hub to expand/collapse), ROUTINES (animated clock nodes),
  APPLICATIONS (hex badges per connector). Additive-blend glow, hex-lattice
  starfield background, animated dashed link curves, cluster-size slider,
  expand/collapse all, Bake settings (persists the view as your default),
  collapsible legend covering every layer.

## 0.2.0 — 2026-08-31

Visual overhaul: the futuristic HUD Command Centre.

- Design system 2.0: warm near-black ground, corner-bracketed panels, tracked
  uppercase labels, glowing orange default accent (still user-configurable),
  dot-grid texture, full reduced-motion support; light theme retuned.
- Second Brain 2.0: full-screen animated canvas map — Force / Circle / Hex /
  Rings layouts, Areas/Folders views, ring-spin + link-springs + node-size
  controls, file-name toggle, clickable legend and area hubs (click to
  filter), pixel-art ROUTER.MD core, search with `/` shortcut + FTS results,
  hover tooltips, in-place preview drawer, zoom/pan; scales to thousands of
  nodes via sprite caching (no per-node DOM).
- Dashboard 2.0 "orbital command centre": particle core built from the real
  index, orbital ring of recent artifacts + recently touched files with age
  tags, skills deck with a model × effort matrix picker (persists per skill),
  routines board (Fired/Next/Queued/Paused), live clock with UTC + routine
  timezone and quarter-week dots, micro-apps panel.
- Pixel Studio micro-app: 16/24/32 pixel editor with pencil/eraser/fill/
  eyedropper, mirror-X, undo, animation frames with onion skin and fps
  preview, export PNG / sprite sheet / SVG, save into artifacts through a
  validated local API; registered in the connector registry.
- New seed skill `pixel-icon` (pixel-art SVG icon sets with a contact-sheet
  preview) with progressive-disclosure drawing rules.
- Graph API cap raised to 4000 nodes; per-provider model listing endpoint.

## 0.1.0 — 2026-08-31

Initial release of MordomoOS.

- Vendor-neutral core (TypeScript strict, SQLite/FTS5, versioned migrations
  with automatic pre-migration backups).
- Provider adapters for Claude Code, Cursor Agent and OpenAI Codex CLI:
  detection with `--help` capability probing, credential-free auth checks,
  normalized streaming events, mechanically enforced read-only mode, effort
  mapping per provider capability.
- Skills: canonical catalog with progressive disclosure, thick-skill
  detection, run buttons with per-run provider/model/effort, 9 seed skills.
- Sync compiler: one canonical source exported to CLAUDE.md / AGENTS.md /
  `.claude` / `.cursor` / `.agents` with manifest, backup, diff and per-file
  conflict approval.
- Memory: incremental indexer honoring exclusions, FTS5 search, master +
  per-area routers with staleness detection, Visual Second Brain (graph +
  grid, safe preview, related-file explanations).
- Routines: cron + timezone scheduling, missed-run policy with boot catch-up,
  retries/backoff, manual test runs, per-firing history and health; OS
  startup-service generation (approval-gated); seeded paused daily digest.
- Connectors: registry (MCP/CLI/API/micro-app) with risk metadata,
  credential-free auditor recommending at most 3 additions.
- Command Centre: dashboard (provider switcher, favorites, routines,
  artifacts, failures, metrics), dark/light themes, EN/pt-BR, keyboard
  navigation, 127.0.0.1-only with local-token protection.
- CLI: setup (guided, idempotent), doctor, start/stop/status, index, sync,
  run, backup/restore, service, uninstall (data-preserving by default).
- 70 automated tests + live validation with the real Claude Code CLI.
