# Changelog

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
