/**
 * Command palette (analysis item 20): the launcher grown into a cmdk-like
 * surface without dependencies. Sections: Apps (tiles when the query is
 * empty), Actions, Skills, Files (`/api/memory/search`), Recent runs. Nested
 * pages: "Run skill →" (model × effort) and "Theme →" (presets). Keyboard:
 * arrows loop, Enter opens, ⌘Enter runs a skill read-only, → opens the
 * nested page, Backspace on an empty query goes back, Esc closes.
 *
 * Open it with `window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT, { detail }))`
 * (see `PaletteOpenDetail`) or ⌘K / ⌘M.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Grid3x3,
  Keyboard,
  LayoutGrid,
  ListTree,
  Palette,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Stethoscope,
  SunMoon,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, type BackupCreated, type DoctorReport, type MemorySearchHit, type Meta, type ModelishOption, type ProviderId, type RunLaunchResponse, type RunRecord, type Skill } from "../api";
import { useT, type TKey } from "../i18n";
import { qk, useApiQuery, useOsProviders, useOsRuns, useOsSkills } from "../queries";
import { PRESETS, applyAccentTokens, applyPreset, type PresetId } from "../theme";
import { useOsNavigate } from "../hooks/useViewTransition";
import { getNotifySound, setNotifySound, useNotifications } from "../hooks/useNotifications";
import { StatusBadge, timeAgo, useToast } from "./ui";
import { Badge, Button, Segmented } from "./primitives";
import { DialogPortal, useDialog } from "./dialog";
import { rankItems } from "./paletteMatch";
import { useI18nLang } from "./paletteLang";

/** Fired by the palette's "Toggle edit mode" action; the desktop listens and toggles its edit mode. */
export const TOGGLE_EDIT_EVENT = "mordomo:toggle-edit";

/** `detail` of the LAUNCHER_EVENT CustomEvent: open with a query or straight on a skill's run page. */
export interface PaletteOpenDetail {
  query?: string;
  /** Open the "Run skill →" page for this slug. */
  runSkill?: string;
}

export interface CommandPaletteProps {
  meta: Meta;
  closing?: boolean;
  onClose: (opts?: { instant?: boolean }) => void;
  onMetaChanged: () => void;
  onShortcuts: () => void;
  initial?: PaletteOpenDetail;
}

type Section = "apps" | "actions" | "skills" | "files" | "runs" | "themes" | "page";
type Page = { kind: "root" } | { kind: "run"; skill: Skill } | { kind: "theme" };

interface Row {
  id: string;
  section: Section;
  label: string;
  sub?: string;
  icon: ReactNode;
  keywords?: string[];
  right?: ReactNode;
  /** Enter */
  primary: (el: HTMLElement | null) => void;
  /** ⌘Enter */
  secondary?: (el: HTMLElement | null) => void;
  /** ArrowRight */
  nested?: () => void;
  busy?: boolean;
}

const EFFORTS = ["low", "medium", "high", "default"] as const;
type Effort = (typeof EFFORTS)[number];
const SECTION_LABEL: Record<Exclude<Section, "page">, TKey> = {
  apps: "shell.palette.apps",
  actions: "shell.palette.actions",
  skills: "shell.palette.skills",
  files: "shell.palette.files",
  runs: "shell.palette.runs",
  themes: "shell.palette.themes",
};

function shortModel(model: string | null): string {
  if (!model) return "AUTO";
  const m = model.toLowerCase();
  for (const name of ["opus", "sonnet", "haiku", "fable", "gpt-5.2", "gpt-5", "o4"]) if (m.includes(name)) return name.toUpperCase();
  return model.slice(0, 10).toUpperCase();
}

export function CommandPalette({ meta, closing = false, onClose, onMetaChanged, onShortcuts, initial }: CommandPaletteProps) {
  const t = useT();
  const lang = useI18nLang();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useOsNavigate();
  const { pathname } = useLocation();
  const { notify } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initial?.query ?? "");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [sound, setSound] = useState(getNotifySound);

  const skills = useOsSkills({ staleTime: 60_000 });
  const runs = useOsRuns({ limit: 8 }, { staleTime: 15_000 });
  const providers = useOsProviders({ staleTime: 60_000 });

  const [page, setPage] = useState<Page>(() => {
    if (initial?.runSkill) {
      const skill = skills.data?.find((s) => s.slug === initial.runSkill);
      if (skill) return { kind: "run", skill };
    }
    return { kind: "root" };
  });

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback((opts?: { instant?: boolean }) => closeRef.current(opts), []);
  useDialog(ref, () => close(), { initialFocus: () => inputRef.current });

  /* ---------- navigation helpers ---------- */
  const go = useCallback(
    (to: string, el?: HTMLElement | null, morph = false) => {
      navigate(to, { morph: morph ? el : null, before: () => close({ instant: true }) });
    },
    [navigate, close],
  );

  const runAction = useCallback(
    async (id: string, label: string, fn: () => Promise<void>, closeAfter = true) => {
      if (busy) return;
      setBusy(id);
      try {
        await fn();
        if (closeAfter) close();
      } catch (err) {
        toast(t("shell.action.failed", { action: label, error: err instanceof Error ? err.message : String(err) }), "danger");
      } finally {
        setBusy(null);
      }
    },
    [busy, close, toast, t],
  );

  const launchSkill = useCallback(
    async (skill: Skill, opts: { provider?: ProviderId; model?: string | null; effort?: Effort } = {}) => {
      if (skill.inputs.some((i) => i.required)) {
        toast(`/${skill.slug}: ${t("shell.palette.needsInputs")}`, "info");
        go(`/skills/${encodeURIComponent(skill.slug)}`);
        return;
      }
      const res = await api.post<RunLaunchResponse>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, { inputs: {}, ...opts });
      if (!res.runId) {
        toast(t("runs.approvalPending"), "info");
        go("/settings?tab=security");
        return;
      }
      toast(t("shell.palette.started", { slug: skill.slug }), "ok");
      go(`/runs/${res.runId}`);
    },
    [go, toast, t],
  );

  /* ---------- apps ---------- */
  const apps = useMemo<Row[]>(
    () =>
      (
        [
          ["brain", "/brain", <BrainCircuit aria-hidden />, t("nav.brain"), ["memory", "graph", "brain", "cerebro", "files"]],
          ["skills", "/skills", <Sparkles aria-hidden />, t("nav.skills"), ["sop", "commands"]],
          ["routines", "/routines", <CalendarClock aria-hidden />, t("nav.routines"), ["cron", "schedule", "agenda"]],
          ["runs", "/runs", <ListTree aria-hidden />, t("nav.runs"), ["history", "logs", "execucoes"]],
          ["connectors", "/connectors", <Plug aria-hidden />, t("nav.connectors"), ["mcp", "integrations"]],
          ["pixel", "/pixel", <Grid3x3 aria-hidden />, t("nav.pixel"), ["pixel", "art", "sprite"]],
          ["settings", "/settings", <SettingsIcon aria-hidden />, t("nav.settings"), ["preferences", "config", "configuracoes"]],
          ["home", "/", <LayoutGrid aria-hidden />, t("nav.dashboard"), ["desktop", "home", "os"]],
        ] as Array<[string, string, ReactNode, string, string[]]>
      ).map(([id, to, icon, label, keywords]) => ({
        id: `app:${id}`,
        section: "apps" as const,
        label,
        icon,
        keywords,
        primary: (el) => go(to, el, true),
      })),
    [t, go],
  );

  /* ---------- actions ---------- */
  const actions = useMemo<Row[]>(() => {
    const act = (id: string, label: TKey, icon: ReactNode, keywords: string[], primary: Row["primary"], extra: Partial<Row> = {}): Row => ({
      id: `action:${id}`,
      section: "actions",
      label: t(label),
      icon,
      keywords,
      primary,
      busy: busy === `action:${id}`,
      ...extra,
    });
    return [
      act("reindex", "shell.action.reindex", <RefreshCw aria-hidden />, ["index", "rebuild", "memory", "reindexar"], () =>
        void runAction("action:reindex", t("shell.action.reindex"), async () => {
          await api.post("/api/memory/index");
          toast(t("shell.action.reindexDone"), "ok");
          await qc.invalidateQueries({ queryKey: ["memory"] });
        }),
      ),
      act("backup", "shell.action.backup", <Archive aria-hidden />, ["backup", "export", "save"], () =>
        void runAction("action:backup", t("shell.action.backup"), async () => {
          const res = await api.post<BackupCreated>("/api/backups", {});
          toast(t("shell.action.backupDone", { name: res.name }), "ok");
          await qc.invalidateQueries({ queryKey: qk.backups });
        }),
      ),
      act("doctor", "shell.action.doctor", <Stethoscope aria-hidden />, ["doctor", "health", "diagnostics", "check", "diagnostico"], () =>
        void runAction("action:doctor", t("shell.action.doctor"), async () => {
          const rep = await api.get<DoctorReport>("/api/doctor?audit=0");
          const text = t("shell.action.doctorDone", { ok: rep.ok, warn: rep.warn, fail: rep.fail });
          toast(text, rep.fail > 0 ? "danger" : "ok");
          notify({ kind: "system", title: t("shell.action.doctor"), body: text, href: "/settings?tab=diagnostics", tone: rep.fail > 0 ? "danger" : "ok" });
          qc.setQueryData(qk.doctor, rep);
          go("/settings?tab=diagnostics");
        }, false),
      ),
      act("new-skill", "shell.action.newSkill", <Plus aria-hidden />, ["skill", "create", "nova"], (el) => go("/skills?new=1", el)),
      act("toggle-edit", "shell.action.toggleEdit", <Pencil aria-hidden />, ["edit", "layout", "widgets", "editar"], () => {
        const fire = () => window.dispatchEvent(new Event(TOGGLE_EDIT_EVENT));
        if (pathname === "/") {
          fire();
          close();
        } else {
          go("/");
          requestAnimationFrame(() => requestAnimationFrame(fire));
        }
      }),
      act("toggle-theme", "shell.action.toggleTheme", <SunMoon aria-hidden />, ["dark", "light", "theme", "tema", "escuro", "claro"], () =>
        void runAction("action:toggle-theme", t("shell.action.toggleTheme"), async () => {
          const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
          await api.put("/api/settings", { theme: next });
          onMetaChanged();
          toast(t("shell.palette.themeToggled", { theme: next }), "ok");
        }),
      ),
      act("presets", "shell.action.presets", <Palette aria-hidden />, ["preset", "accent", "colour", "color", "cor", "forest", "ocean", "mono"], () => setPage({ kind: "theme" }), {
        nested: () => setPage({ kind: "theme" }),
        right: <ChevronRight aria-hidden className="pr-chevron" />,
      }),
      act("brain", "shell.action.brain", <BrainCircuit aria-hidden />, ["brain", "memory", "graph"], (el) => go("/brain", el)),
      act("shortcuts", "shell.action.shortcuts", <Keyboard aria-hidden />, ["keys", "help", "atalhos", "?"], () => {
        close();
        onShortcuts();
      }),
      act("sound", "shell.action.sound", sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />, ["sound", "audio", "notification", "som"], () => {
        const next = !sound;
        setNotifySound(next);
        setSound(next);
        toast(t(next ? "shell.action.soundOn" : "shell.action.soundOff"), "ok");
      }, { right: <Badge kind="meta" tone={sound ? "ok" : "dim"}>{sound ? "on" : "off"}</Badge> }),
    ];
  }, [t, busy, runAction, toast, qc, notify, go, pathname, close, onMetaChanged, onShortcuts, sound]);

  /* ---------- skills ---------- */
  const skillRows = useMemo<Row[]>(
    () =>
      (skills.data ?? [])
        .filter((s) => s.enabled)
        .map((s) => ({
          id: `skill:${s.slug}`,
          section: "skills" as const,
          label: s.name,
          sub: `/${s.slug}${s.description ? ` · ${s.description}` : ""}`,
          icon: <Sparkles aria-hidden />,
          keywords: [s.slug, s.description, ...s.triggers],
          right: (
            <span className="pr-badges">
              {s.inputs.some((i) => i.required) && <Badge kind="meta">{t("shell.palette.needsInputs")}</Badge>}
              <Badge kind="meta" tone={s.mode === "write" ? "warn" : "ok"}>
                {t(s.mode === "write" ? "skills.mode.write" : "skills.mode.read_only")}
              </Badge>
              <ChevronRight aria-hidden className="pr-chevron" />
            </span>
          ),
          primary: (el) => go(`/skills/${encodeURIComponent(s.slug)}`, el),
          secondary: () => void runAction(`skill:${s.slug}`, `/${s.slug}`, () => launchSkill(s), false),
          nested: () => setPage({ kind: "run", skill: s }),
        })),
    [skills.data, t, go, runAction, launchSkill],
  );

  /* ---------- files (debounced server search) ---------- */
  const [files, setFiles] = useState<MemorySearchHit[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const needle = query.trim();
  useEffect(() => {
    if (page.kind !== "root" || needle.length < 2) {
      setFiles([]);
      setFilesLoading(false);
      return;
    }
    const controller = new AbortController();
    setFilesLoading(true);
    const timer = window.setTimeout(() => {
      api
        .get<MemorySearchHit[]>(`/api/memory/search?q=${encodeURIComponent(needle)}&limit=8`, { signal: controller.signal })
        .then((hits) => {
          setFiles(Array.isArray(hits) ? hits : []);
          setFilesLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setFiles([]);
          setFilesLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [needle, page.kind]);
  const fileRows = useMemo<Row[]>(
    () =>
      files.map((f) => ({
        id: `file:${f.id}`,
        section: "files" as const,
        label: f.name,
        sub: f.rel,
        icon: <FileText aria-hidden />,
        primary: (el) => go(`/brain?sel=${f.id}`, el),
      })),
    [files, go],
  );

  /* ---------- runs ---------- */
  const runRows = useMemo<Row[]>(
    () =>
      (runs.data ?? []).slice(0, 8).map((r: RunRecord) => ({
        id: `run:${r.id}`,
        section: "runs" as const,
        label: r.skillSlug ? `/${r.skillSlug}` : r.promptSummary || r.id.slice(0, 8),
        sub: `${r.provider} · ${timeAgo(r.createdAt, lang)}${r.skillSlug && r.promptSummary ? ` · ${r.promptSummary}` : ""}`,
        icon: <ListTree aria-hidden />,
        keywords: [r.id, r.provider, r.status, r.skillSlug ?? "", r.promptSummary],
        right: <StatusBadge status={r.status} />,
        primary: (el) => go(`/runs/${r.id}`, el),
      })),
    [runs.data, lang, go],
  );

  /* ---------- nested pages ---------- */
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort>("default");
  const runSkill = page.kind === "run" ? page.skill : null;
  const runProvider = useMemo<ProviderId | null>(() => {
    if (!runSkill) return null;
    const enabled = new Set((providers.data ?? []).filter((p) => p.enabled).map((p) => p.id));
    const def = providers.data?.find((p) => p.isDefault)?.id;
    if (def && runSkill.providers.includes(def) && enabled.has(def)) return def;
    return runSkill.providers.find((p) => enabled.has(p)) ?? runSkill.providers[0] ?? null;
  }, [runSkill, providers.data]);
  const models = useApiQuery<ModelishOption[]>([...qk.providers, runProvider ?? "none", "models"], `/api/providers/${runProvider ?? "claude"}/models`, {
    enabled: runProvider !== null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!runSkill) return;
    setModel(runSkill.recommendedModel);
    setEffort((EFFORTS as readonly string[]).includes(runSkill.recommendedEffort) ? (runSkill.recommendedEffort as Effort) : "default");
  }, [runSkill]);

  const originalPreset = useRef<PresetId>((document.documentElement.dataset.preset as PresetId | undefined) ?? "hud-orange");
  const committedPreset = useRef(false);
  const revertPreset = useCallback(() => {
    if (committedPreset.current) return;
    applyPreset(originalPreset.current, { persist: false, accent: false });
    applyAccentTokens(meta.accentColor);
  }, [meta.accentColor]);
  useEffect(() => {
    if (page.kind !== "theme") return;
    return () => revertPreset();
  }, [page.kind, revertPreset]);

  const pageRows = useMemo<Row[]>(() => {
    if (page.kind === "run") {
      const skill = page.skill;
      return [
        {
          id: "page:run-now",
          section: "page",
          label: t("shell.palette.runNow"),
          sub: `${runProvider ?? "?"} · ${shortModel(model)} · ${t(`effort.${effort}` as TKey)}`,
          icon: <Play aria-hidden />,
          busy: busy === "page:run-now",
          primary: () => void runAction("page:run-now", t("shell.palette.runNow"), () => launchSkill(skill, { provider: runProvider ?? undefined, model, effort }), false),
        },
        {
          id: "page:open-skill",
          section: "page",
          label: t("shell.palette.openSkill"),
          sub: skill.skillFile,
          icon: <Sparkles aria-hidden />,
          primary: (el) => go(`/skills/${encodeURIComponent(skill.slug)}`, el),
        },
      ];
    }
    if (page.kind === "theme") {
      return PRESETS.map((p) => ({
        id: `theme:${p.id}`,
        section: "themes" as const,
        label: p.label,
        sub: p.accent,
        keywords: [p.id],
        icon: (
          <span className="pr-swatch" aria-hidden>
            {p.swatch.map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </span>
        ),
        right: originalPreset.current === p.id ? <Badge kind="meta" tone="accent">{t("shell.palette.current")}</Badge> : undefined,
        primary: () =>
          void runAction(`theme:${p.id}`, p.label, async () => {
            committedPreset.current = true;
            applyPreset(p.id);
            await api.put("/api/settings", { accentColor: p.accent });
            onMetaChanged();
            toast(t("shell.palette.themeApplied", { name: p.label }), "ok");
          }),
      }));
    }
    return [];
  }, [page, t, runProvider, model, effort, busy, runAction, launchSkill, go, onMetaChanged, toast]);

  /* ---------- flat list ---------- */
  const sections = useMemo<Array<{ section: Section; rows: Row[] }>>(() => {
    if (page.kind !== "root") return [{ section: page.kind === "theme" ? "themes" : "page", rows: rankItems(pageRows, needle).map((r) => r.item) }];
    if (!needle) {
      const base: Array<{ section: Section; rows: Row[] }> = [
        { section: "apps", rows: apps },
        { section: "actions", rows: actions },
        { section: "runs", rows: runRows.slice(0, 3) },
      ];
      return base.filter((s) => s.rows.length > 0);
    }
    return [
      { section: "apps" as const, rows: rankItems(apps, needle).map((r) => r.item) },
      { section: "actions" as const, rows: rankItems(actions, needle).map((r) => r.item) },
      { section: "skills" as const, rows: rankItems(skillRows, needle, 8).map((r) => r.item) },
      { section: "files" as const, rows: fileRows },
      { section: "runs" as const, rows: rankItems(runRows, needle, 8).map((r) => r.item) },
    ].filter((s) => s.rows.length > 0 || (s.section === "files" && filesLoading));
  }, [page.kind, pageRows, needle, apps, actions, runRows, skillRows, fileRows, filesLoading]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  useEffect(() => setSelected(0), [needle, page.kind]);
  useEffect(() => {
    if (selected >= rows.length) setSelected(0);
  }, [rows.length, selected]);
  const listId = "palette-list";
  const current = rows[selected];
  useEffect(() => {
    if (!current) return;
    document.getElementById(`${listId}-${current.id}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  // Theme page: preview the highlighted preset live; revert on leave unless committed.
  useEffect(() => {
    if (page.kind !== "theme" || !current || !current.id.startsWith("theme:")) return;
    applyPreset(current.id.slice("theme:".length), { persist: false });
  }, [page.kind, current]);

  const back = useCallback(() => {
    setPage({ kind: "root" });
    setQuery("");
  }, []);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setSelected((i) => (e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length));
    } else if (e.key === "Enter") {
      if (!current) return;
      e.preventDefault();
      const el = document.getElementById(`${listId}-${current.id}`);
      if ((e.metaKey || e.ctrlKey) && current.secondary) current.secondary(el);
      else current.primary(el);
    } else if (e.key === "ArrowRight" && current?.nested) {
      const input = e.currentTarget;
      if (input.selectionStart === input.value.length) {
        e.preventDefault();
        current.nested();
        setQuery("");
      }
    } else if (e.key === "Backspace" && query === "" && page.kind !== "root") {
      e.preventDefault();
      back();
    }
  };

  const placeholder = page.kind === "run" ? t("shell.palette.runPage", { slug: page.skill.slug }) : page.kind === "theme" ? t("shell.palette.themes") : t("shell.palette.placeholder");
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";
  let flatIndex = -1;

  return (
    <DialogPortal>
      <div className={`launcher${closing ? " closing" : ""}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div className="launcher-panel palette" role="dialog" aria-modal="true" aria-label={t("shell.palette.title")} ref={ref} tabIndex={-1}>
          {page.kind === "root" ? (
            <div className="palette-brand">
              <span className="os-brand">
                <span className="line1">
                  <span className="brand-mark" aria-hidden>
                    {meta.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="name">
                    <span className="accent">{meta.name.replace(/\s*os$/i, "")}</span> OS
                  </span>
                </span>
              </span>
            </div>
          ) : (
            <div className="palette-crumbs">
              <button type="button" className="os-chip" onClick={back} aria-label={t("shell.palette.hintBack")}>
                <ArrowLeft aria-hidden /> {t("shell.palette.hintBack")}
              </button>
              <span className="palette-crumb">{page.kind === "run" ? t("shell.palette.runPage", { slug: page.skill.slug }) : t("shell.palette.themes")}</span>
            </div>
          )}
          <div className="launcher-search">
            <Search aria-hidden />
            <input
              ref={inputRef}
              className="input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder}
              aria-label={t("shell.palette.title")}
              role="combobox"
              aria-expanded={rows.length > 0}
              aria-controls={listId}
              aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {page.kind === "run" && (
            <div className="palette-form">
              <p className="modal-intro">{t("shell.palette.runPageIntro")}</p>
              <div className="palette-form-row">
                <label className="label" htmlFor="palette-model">
                  {t("shell.palette.model")}
                </label>
                <select id="palette-model" className="input sm" value={model ?? ""} onChange={(e) => setModel(e.target.value || null)} disabled={models.isPending && runProvider !== null}>
                  <option value="">{t("shell.palette.auto")}</option>
                  {(models.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="palette-form-row">
                <span className="label">{t("shell.palette.effort")}</span>
                <Segmented
                  size="sm"
                  ariaLabel={t("shell.palette.effort")}
                  value={effort}
                  onChange={setEffort}
                  options={EFFORTS.map((e) => ({ value: e, label: t(`effort.${e}` as TKey) }))}
                />
              </div>
            </div>
          )}

          <div className="palette-list" id={listId} role="listbox" aria-label={t("shell.palette.title")}>
            {rows.length === 0 && !filesLoading && (
              <p className="palette-empty">{needle ? t("shell.palette.noResults", { query: needle }) : t("common.empty")}</p>
            )}
            {sections.map(({ section, rows: sectionRows }) => {
              const tiles = section === "apps" && !needle && page.kind === "root";
              return (
                <div key={section} className={`palette-section${tiles ? " tiles" : ""}`}>
                  {section !== "page" && (
                    <div className="launcher-section" aria-hidden>
                      {t(SECTION_LABEL[section])}
                      {section === "files" && filesLoading && <span className="spinner sm" />}
                    </div>
                  )}
                  {tiles ? (
                    <div className="launcher-grid">
                      {sectionRows.map((row, i) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        return (
                          <button
                            key={row.id}
                            id={`${listId}-${row.id}`}
                            type="button"
                            role="option"
                            aria-selected={idx === selected}
                            className={`launcher-tile${idx === selected ? " selected" : ""}`}
                            style={{ "--i": i } as CSSProperties}
                            onMouseEnter={() => setSelected(idx)}
                            onClick={(e) => row.primary(e.currentTarget)}
                          >
                            <span className="lt-icon">{row.icon}</span>
                            <span className="lt-name">{row.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="launcher-results">
                      {sectionRows.map((row) => {
                        flatIndex += 1;
                        const idx = flatIndex;
                        return (
                          <button
                            key={row.id}
                            id={`${listId}-${row.id}`}
                            type="button"
                            role="option"
                            aria-selected={idx === selected}
                            aria-busy={row.busy || undefined}
                            className={`launcher-result palette-row${idx === selected ? " selected" : ""}`}
                            onMouseEnter={() => setSelected(idx)}
                            onClick={(e) => row.primary(e.currentTarget)}
                          >
                            <span className="lr-icon">{row.busy ? <span className="spinner sm" /> : row.icon}</span>
                            <span className="pr-text">
                              <div className="lr-name">{row.label}</div>
                              {row.sub && <div className="lr-sub">{row.sub}</div>}
                            </span>
                            {row.right && <span className="pr-right">{row.right}</span>}
                          </button>
                        );
                      })}
                      {section === "files" && filesLoading && sectionRows.length === 0 && <p className="palette-empty">{t("shell.palette.searching")}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="launcher-hint palette-footer">
            <span className="kbd">
              <ArrowUp aria-hidden /> <ArrowDown aria-hidden />
            </span>{" "}
            {t("shell.palette.hintNav")} ·{" "}
            <span className="kbd">
              <CornerDownLeft aria-hidden />
            </span>{" "}
            {t("shell.palette.hintOpen")} ·{" "}
            <span className="kbd">
              {mod} <CornerDownLeft aria-hidden />
            </span>{" "}
            {t("shell.palette.hintRun")} ·{" "}
            <span className="kbd">
              <ChevronRight aria-hidden />
            </span>{" "}
            {t("shell.palette.runSkill")} · <span className="kbd">Esc</span> {t("shell.palette.hintClose")}
            {page.kind === "root" && (
              <Button variant="ghost" size="sm" className="palette-help" icon={<Keyboard aria-hidden />} onClick={() => { close(); onShortcuts(); }}>
                ?
              </Button>
            )}
          </p>
        </div>
      </div>
    </DialogPortal>
  );
}

export default CommandPalette;
