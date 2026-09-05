/**
 * Component gallery (audit item 42): the primitives and desktop widgets
 * rendered with fixture data, in either theme, with no server. It is the
 * visual-regression surface for `tests/e2e/gallery.spec.ts` and a place to
 * look at a component in every state before wiring it into a view.
 *
 * Open with `npm run gallery` (Vite dev) or `/gallery.html?theme=light` on the
 * built app (`&preset=forest|ocean|mono` picks a theme preset). Each story section has a stable `#story-<id>` for screenshots.
 */
import { StrictMode, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Bell, Play, Sparkles, Trash2 } from "lucide-react";
import "../theme.css";
import "../desktop/desktop.css";
import "./gallery.css";
import { I18nContext, type Lang } from "../i18n";
import { qk } from "../queries";
import { applyAccentTokens, applyPreset, isPresetId } from "../theme";
import { ToastProvider, Modal, StatusBadge, Skeleton, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Popover, Segmented, Tabs } from "../components/primitives";
import { CommandPalette } from "../components/CommandPalette";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { ConfirmProvider, useConfirm } from "../hooks/useConfirm";
import { NotificationsProvider, useNotifications } from "../hooks/useNotifications";
import type { ArtifactEntry, Meta, Metrics, RoutineStatus, RunRecord, Skill } from "../api";
import TodayWidget from "../desktop/widgets/TodayWidget";
import WorkspaceWidget from "../desktop/widgets/WorkspaceWidget";
import DeckWidget from "../desktop/widgets/DeckWidget";
import BoardWidget from "../desktop/widgets/BoardWidget";
import PulseWidget from "../desktop/widgets/PulseWidget";
import AttentionWidget from "../desktop/widgets/AttentionWidget";
import NowPanel from "../desktop/NowPanel";
import EventTimeline from "../runs/EventTimeline";
import type { RunEventView } from "../runs/useRunStream";

/* ---------- fixtures (plainly synthetic; the gallery never talks to the API) ---------- */
const NOW = Date.UTC(2026, 8, 2, 14, 30);
const skills: Skill[] = ["workspace-digest", "code-review", "daily-tech-news", "brainstorm", "sdd-plan"].map(
  (slug, i) => ({
    slug,
    name: slug.replace(/-/g, " "),
    description: `Fixture skill ${i + 1}.`,
    triggers: [`/${slug}`],
    inputs: [],
    providers: ["claude", "cursor", "codex"],
    recommendedModel: i % 2 ? "claude-sonnet-5" : null,
    recommendedEffort: ["low", "medium", "high", "default"][i % 4]!,
    mode: i === 1 ? "write" : "read_only",
    enabled: true,
    version: "1.0.0",
    guardrails: [],
    successCriteria: [],
    resources: [],
    bodyLineCount: 16,
    thick: false,
    favorite: i === 0,
    body: "",
    skillFile: `/ws/skills/${slug}/SKILL.md`,
  }),
);
const routines: RoutineStatus[] = [
  {
    id: "digest",
    name: "Daily workspace digest",
    skillSlug: "workspace-digest",
    prompt: null,
    schedule: "30 7 * * 1-5",
    timezone: "America/Sao_Paulo",
    provider: "claude",
    model: null,
    effort: "low",
    missedPolicy: "skip",
    enabled: true,
    nextRunAt: NOW + 3_600_000,
    lastFiredAt: NOW - 82_800_000,
    lastStatus: "done",
    recentFailures: 0,
    healthy: true,
    timeoutMs: 600_000,
    maxAttempts: 1,
    profile: "read_only",
    inputs: {},
    notify: true,
    backoffMs: 60_000,
    workingDir: null,
    artifactsSubdir: null,
    createdAt: NOW - 86_400_000 * 10,
  },
  {
    id: "news",
    name: "Tech news briefing",
    skillSlug: "daily-tech-news",
    prompt: null,
    schedule: "0 9 * * *",
    timezone: "",
    provider: "codex",
    model: null,
    effort: "medium",
    missedPolicy: "run_on_boot",
    enabled: false,
    nextRunAt: null,
    lastFiredAt: NOW - 3 * 86_400_000,
    lastStatus: "failed",
    recentFailures: 2,
    healthy: false,
    timeoutMs: 600_000,
    maxAttempts: 2,
    profile: "read_only",
    inputs: {},
    notify: true,
    backoffMs: 60_000,
    workingDir: null,
    artifactsSubdir: null,
    createdAt: NOW - 86_400_000 * 30,
  },
];
const runs: RunRecord[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: NOW - 120_000,
    finishedAt: null,
    origin: "skill",
    provider: "claude",
    model: "claude-sonnet-5",
    status: "running",
    durationMs: null,
    promptSummary: "(skill: code-review)",
    skillSlug: "code-review",
    routineId: null,
    error: null,
    artifacts: [],
    exitCode: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    createdAt: NOW - 3_600_000,
    finishedAt: NOW - 3_500_000,
    origin: "manual",
    provider: "claude",
    model: null,
    status: "done",
    durationMs: 25_200,
    promptSummary: "Summarise the workspace and list the newest files.",
    skillSlug: null,
    routineId: null,
    error: null,
    artifacts: ["digest.md"],
    exitCode: 0,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    createdAt: NOW - 7_200_000,
    finishedAt: NOW - 7_100_000,
    origin: "routine",
    provider: "codex",
    model: null,
    status: "failed",
    durationMs: 61_000,
    promptSummary: "(skill: daily-tech-news)",
    skillSlug: "daily-tech-news",
    routineId: "news",
    error: "Provider exited with code 1.",
    artifacts: [],
    exitCode: 1,
  },
];
const metrics: Metrics = {
  total: 42,
  last7d: 12,
  successRate: 0.83,
  avgDurationMs: 43_900,
  byProvider: [
    { provider: "claude", count: 30, success: 27 },
    { provider: "codex", count: 12, success: 8 },
  ],
  running: 1,
  failedRecent: 1,
};
const artifacts: ArtifactEntry[] = [
  {
    runId: runs[1]!.id,
    file: "digest.md",
    path: "/ws/artifacts/2222/digest.md",
    createdAt: NOW - 3_500_000,
    origin: "manual",
    skillSlug: null,
    provider: "claude",
    sizeBytes: 2_048,
  },
  {
    runId: runs[1]!.id,
    file: "changed-files.txt",
    path: "/ws/artifacts/2222/changed-files.txt",
    createdAt: NOW - 3_400_000,
    origin: "manual",
    skillSlug: null,
    provider: "claude",
    sizeBytes: 512,
  },
];
const memoryStatus = {
  facets: {
    total: 156,
    areas: [
      { area: "Worker", count: 113 },
      { area: "Documentos", count: 29 },
      { area: "Projetos", count: 14 },
    ],
  },
};
const events: RunEventView[] = [
  { type: "started", ts: NOW - 120_000, pid: 4242 },
  { type: "assistant", ts: NOW - 118_000, text: "Reading the diff first, then the tests." },
  {
    type: "tool_use",
    ts: NOW - 117_000,
    tool: "Read",
    detail: '{"file_path":"/ws/core/src/runs/runManager.ts"}',
  },
  { type: "text", ts: NOW - 116_000, stream: "stdout", text: "runManager.ts: 812 lines" },
  { type: "text", ts: NOW - 115_000, stream: "stderr", text: "warning: large file" },
  { type: "permission", ts: NOW - 110_000, detail: "Bash(rm:*) is disallowed by the read-only profile." },
  {
    type: "result",
    ts: NOW - 60_000,
    exitCode: 0,
    summary: "3 findings, none blocking.",
    durationMs: 60_000,
    timedOut: false,
  },
];

function seededClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchInterval: false },
    },
  });
  qc.setQueryData(qk.skills, skills);
  qc.setQueryData(qk.routines, routines);
  qc.setQueryData(qk.runs({ limit: 200 }), runs);
  qc.setQueryData(qk.runs({ limit: 100 }), runs);
  qc.setQueryData(qk.metrics, metrics);
  qc.setQueryData(qk.artifacts, artifacts);
  qc.setQueryData(qk.memoryStatus, memoryStatus);
  qc.setQueryData(qk.approvals, [
    { id: "a1", kind: "write_run", description: "Write-mode prompt run with claude" },
  ]);
  qc.setQueryData(qk.providers, [
    {
      id: "claude",
      displayName: "Claude Code",
      enabled: true,
      isDefault: true,
      defaultModel: null,
      defaultEffort: "default",
      health: {
        ok: true,
        installed: true,
        authenticated: true,
        version: "2.1.0",
        detail: "",
        checkedAt: NOW,
      },
    },
  ]);
  for (const r of runs) qc.setQueryData(qk.run(r.id), { run: r, events: r.id === runs[0]!.id ? events : [] });
  return qc;
}

/* ---------- shell ---------- */
const META: Meta = {
  name: "Mordomo OS",
  theme: "dark",
  accentColor: "#f97316",
  language: "en",
  setupCompleted: true,
  version: "gallery",
};

function applyTheme(theme: "dark" | "light", preset: string) {
  document.documentElement.dataset.theme = theme;
  const p = applyPreset(isPresetId(preset) ? preset : "hud-orange", { persist: false, accent: false, theme });
  applyAccentTokens(p.accent, theme, p.bg[theme]);
}

function Story({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`story-${id}`} className="story" aria-label={title}>
      <h2 className="story-title">{title}</h2>
      <div className="story-body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="story-row">
      <span className="story-label">{label}</span>
      <div className="story-items">{children}</div>
    </div>
  );
}

function Dialogs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [modal, setModal] = useState(false);
  return (
    <>
      <Row label="triggers">
        <Button onClick={() => toast("Saved.", "ok")}>Toast ok</Button>
        <Button onClick={() => toast("Something failed.", "danger")}>Toast danger</Button>
        <Button
          onClick={() =>
            void confirm({ title: "Delete routine?", body: "This cannot be undone.", danger: true })
          }
        >
          Confirm
        </Button>
        <Button onClick={() => setModal(true)}>Modal</Button>
      </Row>
      {modal && (
        <Modal title="New skill" onClose={() => setModal(false)}>
          <Field label="Name" htmlFor="g-name">
            <input id="g-name" className="input" defaultValue="Weekly report" />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setModal(false)}>
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Overlays() {
  const [pop, setPop] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { items, unread, notify, markAllRead } = useNotifications();
  return (
    <>
      <Row label="popover">
        <Button ref={anchor} onClick={() => setPop((v) => !v)} aria-expanded={pop}>
          Open popover
        </Button>
        <Popover open={pop} onClose={() => setPop(false)} anchor={anchor} ariaLabel="Model and effort">
          <div className="stack-sm">
            <span className="hud-label">Model × effort</span>
            <Segmented
              ariaLabel="Effort"
              size="sm"
              value="medium"
              onChange={() => undefined}
              options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))}
            />
            <Button size="sm" variant="primary" onClick={() => setPop(false)}>
              Apply
            </Button>
          </div>
        </Popover>
      </Row>
      <Row label="palette">
        <Button onClick={() => setPalette(true)}>Command palette</Button>
        <Button onClick={() => setHelp(true)}>Shortcuts sheet</Button>
        {palette && (
          <CommandPalette
            meta={META}
            onClose={() => setPalette(false)}
            onMetaChanged={() => undefined}
            onShortcuts={() => setHelp(true)}
          />
        )}
        {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      </Row>
      <Row label="notifications">
        <Button
          icon={<Bell aria-hidden />}
          onClick={() =>
            notify({ kind: "run", title: "Run finished", body: "digest · 25.2 s", href: "/runs", tone: "ok" })
          }
        >
          Push ({unread} unread)
        </Button>
        <Button variant="ghost" onClick={markAllRead}>
          Mark all read
        </Button>
        <span className="small">{items.length} in feed</span>
      </Row>
    </>
  );
}

function Gallery() {
  const [seg, setSeg] = useState("rings");
  const [tab, setTab] = useState("identity");
  return (
    <main className="gallery">
      <header className="gallery-head">
        <h1>MordomoOS component gallery</h1>
        <p>Fixture data only. Sections are the visual-regression baselines.</p>
      </header>

      <Story id="buttons" title="Buttons">
        {(["primary", "secondary", "outline", "ghost", "danger"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            <Button variant={variant}>Label</Button>
            <Button variant={variant} icon={<Play aria-hidden />}>
              With icon
            </Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} size="sm" icon={<Trash2 aria-hidden />} aria-label="Icon only" />
          </Row>
        ))}
      </Story>

      <Story id="badges" title="Badges and status">
        <Row label="state">
          {(["ok", "warn", "danger", "info", "accent", "dim"] as const).map((tone) => (
            <Badge key={tone} kind="state" tone={tone}>
              {tone}
            </Badge>
          ))}
        </Row>
        <Row label="meta">
          <Badge kind="meta">18 lines</Badge>
          <Badge kind="meta">claude</Badge>
          <Badge kind="meta">+2</Badge>
        </Row>
        <Row label="run status">
          {[
            "queued",
            "running",
            "waiting_approval",
            "done",
            "failed",
            "timed_out",
            "cancelled",
            "interrupted",
          ].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </Row>
      </Story>

      <Story id="fields" title="Fields">
        <div className="grid grid-2">
          <Field label="Name" htmlFor="g-f1" hint="Shown in the launcher.">
            <input id="g-f1" className="input" defaultValue="Weekly report" />
          </Field>
          <Field label="Cron" htmlFor="g-f2" error="Invalid cron expression.">
            <input id="g-f2" className="input mono" defaultValue="99 * * *" aria-invalid />
          </Field>
          <Field label="Provider" htmlFor="g-f3">
            <select id="g-f3" className="input" defaultValue="claude">
              <option>claude</option>
              <option>codex</option>
            </select>
          </Field>
          <Field label="Prompt" htmlFor="g-f4">
            <textarea id="g-f4" className="input" rows={2} defaultValue="Summarise the workspace." />
          </Field>
        </div>
      </Story>

      <Story id="controls" title="Segmented and tabs">
        <Row label="segmented">
          <Segmented
            ariaLabel="Layout"
            value={seg}
            onChange={setSeg}
            options={["force", "circle", "hex", "rings"].map((v) => ({ value: v, label: v }))}
          />
          <Segmented
            ariaLabel="Size"
            size="sm"
            value={seg}
            onChange={setSeg}
            options={["force", "circle", "hex", "rings"].map((v) => ({ value: v, label: v }))}
          />
        </Row>
        <Row label="tabs">
          <Tabs
            id="g-tabs"
            ariaLabel="Settings"
            active={tab}
            onChange={setTab}
            tabs={["identity", "providers", "memory", "security"].map((id) => ({ id, label: id }))}
          />
        </Row>
      </Story>

      <Story id="states" title="Empty and loading states">
        <div className="grid grid-2">
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="No routines yet"
            body="A routine runs a skill or prompt on a schedule."
            action={<Button variant="primary">New routine</Button>}
          />
          <div className="card">
            <Skeleton lines={5} />
          </div>
        </div>
      </Story>

      <Story id="dialogs" title="Toasts, confirm and modal">
        <Dialogs />
      </Story>

      <Story id="overlays" title="Popover, command palette, shortcuts, notifications">
        <Overlays />
      </Story>

      <Story id="widgets" title="Desktop widgets">
        <div className="story-widgets">
          {[
            ["Today", <TodayWidget key="t" />],
            ["Workspace", <WorkspaceWidget key="w" />],
            ["Skills deck", <DeckWidget key="d" />],
            ["Routines", <BoardWidget key="b" />],
            ["Pulse", <PulseWidget key="p" />],
            ["Needs attention", <AttentionWidget key="a" />],
          ].map(([title, node]) => (
            <section key={String(title)} className="widget story-widget" aria-label={String(title)}>
              <div className="widget-inner">
                <h2>{title}</h2>
                {node}
              </div>
            </section>
          ))}
        </div>
      </Story>

      <Story id="now" title="Now panel">
        <div className="story-now">
          <NowPanel />
        </div>
      </Story>

      <Story id="timeline" title="Run event timeline">
        <EventTimeline events={events} live={false} height={320} />
      </Story>
    </main>
  );
}

function Root() {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "light" ? "light" : "dark";
  const lang = (params.get("lang") === "pt-BR" ? "pt-BR" : "en") as Lang;
  applyTheme(theme, params.get("preset") ?? "hud-orange");
  document.documentElement.lang = lang;
  const client = useMemo(seededClient, []);
  const i18n = useMemo(() => ({ lang, setLang: () => undefined }), [lang]);
  return (
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={i18n}>
        <ToastProvider>
          <ConfirmProvider>
            <NotificationsProvider>
              <HashRouter>
                <Gallery />
              </HashRouter>
            </NotificationsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
