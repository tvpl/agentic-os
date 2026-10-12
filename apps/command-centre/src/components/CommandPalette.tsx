import { errorMessage } from "../views/shared";
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Keyboard,
  LayoutGrid,
  ListTree,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import {
  api,
  type MemorySearchHit,
  type Meta,
  type ModelishOption,
  type ProviderId,
  type RunSummary,
  type Skill,
  type UiShell,
} from "../api";
import { apiCall } from "../apiCall";
import { ARRANGE_VERBS, arrangeFor } from "../desktop/arrange";
import { ARRANGE_EVENT, PANEL_GLYPH, getPanels } from "../desktop/panelKinds";
import { HUD_CATALOGUE, hudTitleKey } from "../desktop/hud";
import { APPS, appKindOf } from "../desktop/apps";
import { useT, type TKey } from "../i18n";
import { localizeSkill } from "../views/Skills/localize";
import { qk, useApiQuery, useOsProviders, useOsRuns, useOsSkills } from "../queries";
import { PRESETS, applyAccentTokens, applyPreset, type PresetId } from "../theme";
import { useOsNavigate } from "../hooks/useViewTransition";
import { getNotifySound } from "../hooks/useNotifications";
import { StatusBadge, timeAgo, useToast } from "./ui";
import { Badge, Button, Segmented } from "./primitives";
import { DialogSurface } from "../ui";
import { rankItems } from "./paletteMatch";
import { useCommands, useRegisteredCommands, type Command } from "../commands/registry";
import { ariaShortcut, comboLabel, isMac } from "../commands/keys";
import { useI18nLang } from "./paletteLang";

/** Fired by the palette to put a registered instrument panel on the stage (`detail` = its id). */
export const OPEN_PANEL_EVENT = "mordomo:open-panel";

/** `detail` of the LAUNCHER_EVENT CustomEvent: open with a query or straight on a skill's run page. */
export interface PaletteOpenDetail {
  query?: string;
  /** Open the "Run skill →" page for this slug. */
  runSkill?: string;
  /** `panels`: open on the "Open a panel" page — the dock's "+" (plan step 5); `theme`: on the presets. */
  mode?: "panels" | "theme";
}

export interface CommandPaletteProps {
  meta: Meta;
  closing?: boolean;
  onClose: (opts?: { instant?: boolean }) => void;
  onMetaChanged: () => void;
  onShortcuts: () => void;
  initial?: PaletteOpenDetail;
  /**
   * The shell the palette opened over. The frame has no lâminas, so "Open
   * panel" and the arrange row are the Núcleo's only; each shell offers the
   * switch to the other (.specs/features/moldura-app, Tela 4).
   */
  shell?: UiShell;
}

type Section = "apps" | "actions" | "skills" | "files" | "runs" | "themes" | "page";
type Page = { kind: "root" } | { kind: "run"; skill: Skill } | { kind: "theme" } | { kind: "panels" };

interface Row {
  id: string;
  section: Section;
  label: string;
  sub?: string;
  icon: ReactNode;
  keywords?: string[];
  right?: ReactNode;
  /** The key combinations the row's command answers to (`aria-keyshortcuts`). */
  shortcuts?: string;
  /** Enter */
  primary: () => void;
  /** ⌘Enter */
  secondary?: () => void;
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
  for (const name of ["opus", "sonnet", "haiku", "fable", "gpt-5.2", "gpt-5", "o4"])
    if (m.includes(name)) return name.toUpperCase();
  return model.slice(0, 10).toUpperCase();
}

export function CommandPalette({
  meta,
  closing = false,
  onClose,
  onMetaChanged,
  onShortcuts,
  initial,
  shell = "nucleo",
}: CommandPaletteProps) {
  const t = useT();
  const lang = useI18nLang();
  const toast = useToast();
  const navigate = useOsNavigate();
  const frame = shell === "moldura";
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus on mount, synchronously: the dialog's own initial focus lands a
  // frame later, and keys typed in that frame went to whatever panel had
  // focus behind the palette (G2 put live apps there).
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);
  const [query, setQuery] = useState(initial?.query ?? "");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Read once per opening: the sound row's badge (the command toggles it and closes the palette).
  const [sound] = useState(getNotifySound);

  const skills = useOsSkills({ staleTime: 60_000 });
  const runs = useOsRuns({ limit: 8 }, { staleTime: 15_000 });
  const providers = useOsProviders({ staleTime: 60_000 });

  const [page, setPage] = useState<Page>(() => {
    if (initial?.mode === "panels") return { kind: "panels" };
    if (initial?.mode === "theme") return { kind: "theme" };
    if (initial?.runSkill) {
      const skill = skills.data?.find((s) => s.slug === initial.runSkill);
      if (skill) return { kind: "run", skill };
    }
    return { kind: "root" };
  });

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback((opts?: { instant?: boolean }) => closeRef.current(opts), []);
  // The palette is a modal: the global keys that opened it do not reach it, so its own
  // toggle keys close it (the `modal` scope of the command registry).
  const toggleKeys = useMemo<Command[]>(
    () => [
      {
        id: "palette.close",
        title: "common.close",
        group: "navigation",
        scope: "modal",
        keys: ["Mod+K", "Mod+M", "Ctrl+M"],
        run: () => closeRef.current(),
      },
    ],
    [],
  );
  useCommands(toggleKeys);

  /* ---------- navigation helpers ---------- */
  const go = useCallback(
    (to: string) => {
      navigate(to, { before: () => close({ instant: true }) });
    },
    [navigate, close],
  );

  /**
   * The shell is mounted in every scene, so what it answers — a lâmina, the
   * deck — fires where you are and the palette closes.
   */
  const inShell = useCallback(
    (fire: () => void) => {
      fire();
      close();
    },
    [close],
  );

  const runAction = useCallback(
    async (id: string, label: string, fn: () => Promise<void>, closeAfter = true) => {
      if (busy) return;
      setBusy(id);
      try {
        await fn();
        if (closeAfter) close();
      } catch (err) {
        toast(
          t("shell.action.failed", {
            action: label,
            error: errorMessage(err, t),
          }),
          "danger",
        );
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
      const res = await apiCall("POST /api/skills/:slug/run", {
        params: { slug: skill.slug },
        body: {
          inputs: {},
          ...opts,
        },
      });
      if (res.status === "waiting_approval" || !res.runId) {
        toast(t("runs.approvalPending"), "info");
        go("/settings?tab=security");
        return;
      }
      toast(t("shell.palette.started", { slug: skill.slug }), "ok");
      go(`/runs/${res.runId}`);
    },
    [go, toast, t],
  );

  /* ---------- apps and actions: the registered commands (.specs/features/comandos-atalhos) ---------- */
  const commands = useRegisteredCommands();
  const [apps, actions] = useMemo<[Row[], Row[]]>(() => {
    // Two commands open a page of the palette itself rather than run from it.
    const nested: Record<string, Page> = {
      "action:presets": { kind: "theme" },
      "action:open-panel": { kind: "panels" },
    };
    const rows = commands
      .filter((c) => c.palette && (!c.when || c.when()))
      .map((c): Row => {
        const Icon = c.icon;
        const page = nested[c.id];
        const keys = [...new Set((c.keys ?? []).map((k) => comboLabel(k)))];
        return {
          id: c.id,
          section: c.group === "apps" ? "apps" : "actions",
          label: t(c.title),
          icon: Icon ? <Icon aria-hidden /> : null,
          keywords: c.keywords,
          shortcuts:
            keys.length > 0 ? [...new Set((c.keys ?? []).map((k) => ariaShortcut(k)))].join(" ") : undefined,
          right:
            keys.length > 0 ? (
              <span className="pr-keys">
                {keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            ) : page ? (
              <ChevronRight aria-hidden className="pr-chevron" />
            ) : c.id === "action:sound" ? (
              <Badge kind="meta" tone={sound ? "ok" : "dim"}>
                {sound ? "on" : "off"}
              </Badge>
            ) : undefined,
          primary: page
            ? () => {
                setPage(page);
                setQuery("");
              }
            : () => {
                close();
                c.run();
              },
          nested: page ? () => setPage(page) : undefined,
        };
      });
    return [rows.filter((r) => r.section === "apps"), rows.filter((r) => r.section === "actions")];
  }, [commands, t, sound, close]);

  /* ---------- skills ---------- */
  const skillRows = useMemo<Row[]>(
    () =>
      (skills.data ?? [])
        .filter((s) => s.enabled)
        .map((s): Row => {
          const loc = localizeSkill(s, lang);
          return {
            id: `skill:${s.slug}`,
            section: "skills" as const,
            label: loc.name,
            sub: `/${s.slug}${loc.description ? ` · ${loc.description}` : ""}`,
            icon: <Sparkles aria-hidden />,
            keywords: [s.slug, s.name, s.description, loc.name, loc.description, ...s.triggers],
            right: (
              <span className="pr-badges">
                {s.inputs.some((i) => i.required) && (
                  <Badge kind="meta">{t("shell.palette.needsInputs")}</Badge>
                )}
                <Badge kind="meta" tone={s.mode === "write" ? "warn" : "ok"}>
                  {t(s.mode === "write" ? "skills.mode.write" : "skills.mode.read_only")}
                </Badge>
                <ChevronRight aria-hidden className="pr-chevron" />
              </span>
            ),
            primary: () => go(`/skills/${encodeURIComponent(s.slug)}`),
            secondary: () => void runAction(`skill:${s.slug}`, `/${s.slug}`, () => launchSkill(s), false),
            nested: () => setPage({ kind: "run", skill: s }),
          };
        }),
    [skills.data, t, lang, go, runAction, launchSkill],
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
      apiCall(
        "GET /api/memory/search",
        { query: { q: needle, limit: 8 } },
        {
          signal: controller.signal,
        },
      )
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
        primary: () => go(`/brain?sel=${f.id}`),
      })),
    [files, go],
  );

  /* ---------- runs ---------- */
  const runRows = useMemo<Row[]>(
    () =>
      (runs.data ?? []).slice(0, 8).map((r: RunSummary) => ({
        id: `run:${r.id}`,
        section: "runs" as const,
        label: r.skillSlug ? `/${r.skillSlug}` : r.promptSummary || r.id.slice(0, 8),
        sub: `${r.provider} · ${timeAgo(r.createdAt, lang)}${r.skillSlug && r.promptSummary ? ` · ${r.promptSummary}` : ""}`,
        icon: <ListTree aria-hidden />,
        keywords: [r.id, r.provider, r.status, r.skillSlug ?? "", r.promptSummary],
        right: <StatusBadge status={r.status} />,
        primary: () => go(`/runs/${r.id}`),
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
  const models = useApiQuery<ModelishOption[]>(
    [...qk.providers, runProvider ?? "none", "models"],
    `/api/providers/${runProvider ?? "claude"}/models`,
    {
      enabled: runProvider !== null,
      staleTime: 60_000,
    },
  );
  useEffect(() => {
    if (!runSkill) return;
    setModel(runSkill.recommendedModel);
    setEffort(
      (EFFORTS as readonly string[]).includes(runSkill.recommendedEffort)
        ? (runSkill.recommendedEffort as Effort)
        : "default",
    );
  }, [runSkill]);

  const originalPreset = useRef<PresetId>(
    (document.documentElement.dataset.preset as PresetId | undefined) ?? "hud-orange",
  );
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
          primary: () =>
            void runAction(
              "page:run-now",
              t("shell.palette.runNow"),
              () => launchSkill(skill, { provider: runProvider ?? undefined, model, effort }),
              false,
            ),
        },
        {
          id: "page:open-skill",
          section: "page",
          label: t("shell.palette.openSkill"),
          sub: skill.skillFile,
          icon: <Sparkles aria-hidden />,
          primary: () => go(`/skills/${encodeURIComponent(skill.slug)}`),
        },
      ];
    }
    if (page.kind === "panels") {
      const open = new Set(getPanels().map((p) => p.id));
      return HUD_CATALOGUE.map((id): Row => {
        const kind = appKindOf(id);
        const Icon = kind ? APPS[kind].Icon : null;
        return {
          id: `panel:${id}`,
          section: "page",
          label: t(hudTitleKey(id)),
          sub: kind ? t(APPS[kind].descKey) : undefined,
          keywords: [id, kind ?? ""],
          icon: Icon ? (
            <Icon aria-hidden />
          ) : (
            <span className="pr-glyph" aria-hidden>
              {PANEL_GLYPH.surface}
            </span>
          ),
          right: open.has(id) ? (
            <Badge kind="meta" tone="accent">
              {t("desktop.palette.open")}
            </Badge>
          ) : undefined,
          primary: () => {
            // An app answers to its route (the desktop turns it into a panel);
            // the runs reading is the Runs app, like its pod.
            if (kind) go(APPS[kind].route);
            else if (id === "runs") go("/runs");
            else inShell(() => window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: id })));
          },
        };
      });
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
        right:
          originalPreset.current === p.id ? (
            <Badge kind="meta" tone="accent">
              {t("shell.palette.current")}
            </Badge>
          ) : undefined,
        primary: () =>
          void runAction(`theme:${p.id}`, p.label, async () => {
            committedPreset.current = true;
            applyPreset(p.id);
            await api.putSettings({ accentColor: p.accent });
            onMetaChanged();
            toast(t("shell.palette.themeApplied", { name: p.label }), "ok");
          }),
      }));
    }
    return [];
  }, [page, t, runProvider, model, effort, busy, runAction, launchSkill, go, onMetaChanged, toast, inShell]);

  /* ---------- flat list ---------- */
  const sections = useMemo<Array<{ section: Section; rows: Row[] }>>(() => {
    if (page.kind !== "root")
      return [
        {
          section: page.kind === "theme" ? "themes" : "page",
          rows: rankItems(pageRows, needle).map((r) => r.item),
        },
      ];
    if (!needle) {
      const base: Array<{ section: Section; rows: Row[] }> = [
        { section: "apps", rows: apps },
        { section: "actions", rows: actions },
        { section: "runs", rows: runRows.slice(0, 3) },
      ];
      return base.filter((s) => s.rows.length > 0);
    }
    // "organizar revisar código" → the desk composes itself (refino item 47).
    const verb = frame ? null : ARRANGE_VERBS.exec(needle);
    const arrangement = verb ? arrangeFor(verb[1]!) : null;
    const arrangeRow: Row[] = verb
      ? [
          {
            id: "action:arrange",
            section: "actions",
            label: arrangement
              ? t("desktop.arrange.label", { intent: verb[1]! })
              : t("desktop.arrange.unknown", { intent: verb[1]! }),
            sub: arrangement ? arrangement.panels.join(" · ") : t("desktop.arrange.hint"),
            icon: <LayoutGrid aria-hidden />,
            primary: () => {
              if (!arrangement) return;
              inShell(() =>
                window.dispatchEvent(new CustomEvent(ARRANGE_EVENT, { detail: arrangement.panels })),
              );
            },
          },
        ]
      : [];
    return [
      { section: "apps" as const, rows: rankItems(apps, needle).map((r) => r.item) },
      {
        section: "actions" as const,
        rows: [...arrangeRow, ...rankItems(actions, needle).map((r) => r.item)],
      },
      { section: "skills" as const, rows: rankItems(skillRows, needle, 8).map((r) => r.item) },
      { section: "files" as const, rows: fileRows },
      { section: "runs" as const, rows: rankItems(runRows, needle, 8).map((r) => r.item) },
    ].filter((s) => s.rows.length > 0 || (s.section === "files" && filesLoading));
  }, [
    page.kind,
    pageRows,
    needle,
    apps,
    actions,
    runRows,
    skillRows,
    fileRows,
    filesLoading,
    t,
    inShell,
    frame,
  ]);
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
      setSelected((i) =>
        e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length,
      );
    } else if (e.key === "Enter") {
      if (!current) return;
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && current.secondary) current.secondary();
      else current.primary();
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

  const placeholder =
    page.kind === "run"
      ? t("shell.palette.runPage", { slug: page.skill.slug })
      : page.kind === "theme"
        ? t("shell.palette.themes")
        : page.kind === "panels"
          ? t("desktop.palette.panelsPh")
          : t("shell.palette.placeholder");
  const mod = isMac() ? "⌘" : "Ctrl";
  let flatIndex = -1;

  return (
    <DialogSurface
      open={!closing}
      onOpenChange={(next) => !next && close()}
      label={t("shell.palette.title")}
      backdrop="launcher"
      className="launcher-panel palette"
      initialFocus={() => inputRef.current}
    >
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
          <span className="palette-crumb">
            {page.kind === "run"
              ? t("shell.palette.runPage", { slug: page.skill.slug })
              : page.kind === "panels"
                ? t("desktop.dock.add")
                : t("shell.palette.themes")}
          </span>
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
            <select
              id="palette-model"
              className="input sm"
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value || null)}
              disabled={models.isPending && runProvider !== null}
            >
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
          <p className="palette-empty">
            {needle ? t("shell.palette.noResults", { query: needle }) : t("common.empty")}
          </p>
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
                        onClick={() => row.primary()}
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
                        aria-keyshortcuts={row.shortcuts}
                        className={`launcher-result palette-row${idx === selected ? " selected" : ""}`}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => row.primary()}
                      >
                        <span className="lr-icon">
                          {row.busy ? <span className="spinner sm" /> : row.icon}
                        </span>
                        <span className="pr-text">
                          <div className="lr-name">{row.label}</div>
                          {row.sub && <div className="lr-sub">{row.sub}</div>}
                        </span>
                        {row.right && <span className="pr-right">{row.right}</span>}
                      </button>
                    );
                  })}
                  {section === "files" && filesLoading && sectionRows.length === 0 && (
                    <p className="palette-empty">{t("shell.palette.searching")}</p>
                  )}
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
          <Button
            variant="ghost"
            size="sm"
            className="palette-help"
            icon={<Keyboard aria-hidden />}
            onClick={() => {
              close();
              onShortcuts();
            }}
          >
            ?
          </Button>
        )}
      </p>
    </DialogSurface>
  );
}
