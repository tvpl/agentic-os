# Changelog

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
