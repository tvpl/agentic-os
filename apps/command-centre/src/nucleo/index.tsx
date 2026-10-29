/**
 * The immersive shell ("Núcleo"). There are no windows: the OS is a machine
 * you are inside of, with an AI that is always present —
 *
 * - **Each thing in its place.** Top-left: the pendências — what waits on
 *   you, with the alerts about it; a click turns the whole OS toward
 *   resolving them (focus). Left edge: the modules. Top centre: where you
 *   are. Top-right: the day's telemetry. Bottom: the voice line, with the
 *   agent's iris in it. Nothing else is chrome.
 * - **Scenes** fill the screen, one at a time; the URL is the scene.
 *   Travelling zooms *through* what you touched — the new scene grows out of
 *   the press, the old one rushes past; going home folds the scene back
 *   into its module.
 * - **Lâminas** are the only sub-blocks: at most two projections that grow
 *   out of the control that asked for them and dissolve when dismissed.
 * - **Presence.** The agent's state lights the edge of the screen (aura);
 *   what it is doing orbits its body in the Núcleo.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileText, Sparkles } from "lucide-react";
import type { Meta, Skill } from "../api";
import { useT } from "../i18n";
import { qk, useOsProviders } from "../queries";
import { Skeleton } from "../components/ui";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useWorkspace } from "../components/Workspace";
import { APPS, appId, appKindOf, type AppKind, type AppLocation } from "../desktop/apps";
import { AppRouteContext, type AppRoute } from "../desktop/appRoute";
import { DesktopActionsProvider, type DesktopActions } from "../desktop/actions";
import { ARRANGE_EVENT, panelKind, publishPanels, type OpenPanel } from "../desktop/panelKinds";
import { docId, docPath, isDocId } from "../desktop/docIds";
import {
  formPanelId,
  formSlugOf,
  isFormPanelId,
  isRunPanelId,
  runIdOf,
  runPanelId,
  runPanelTitle,
} from "../desktop/runPanels";
import { WIDGET_REGISTRY, widgetDefinition } from "../desktop/registry";
import { isActiveStatus, useDesktopRuns } from "../desktop/data";
import { useDesktopSignals } from "../desktop/useSignals";
import {
  focusSkillDeck,
  useActiveRunCount,
  usePanelEventBridge,
  useReferencePanel,
  useRunningSkills,
  useRunSkill,
} from "../desktop/shellActions";
import DocWindow from "../desktop/DocWindow";
import RunPanel from "../desktop/RunPanel";
import SkillInputsPanel from "../desktop/SkillInputsPanel";
import SkillDeck from "../desktop/SkillDeck";
import ModelEffortPopover from "../desktop/ModelEffortPopover";
import { SearchBar } from "../desktop/ArtifactSearch";
import type { HumanEvent } from "../runs/humanize";
import Console from "../desktop/console/Console";
import "../desktop/desktop.css";
import { useBudgetNotifications, useCoreState } from "./agentState";
import { useUniversalSearch } from "./useUniversalSearch";
import { MAIN_SCENES, horizonRing, sceneById, sceneForPath, type SceneDef, type SceneId } from "./scenes";
import { dismiss, dismissNewest, getLaminas, project, useLaminas } from "./projections";
import Field from "./Field";
import Telemetry from "./Telemetry";
import NucleoScene from "./NucleoScene";
import Entity from "./entity/Entity";
import ModuleSpine from "./ModuleSpine";
import Aura from "./Aura";
import Sparks, { burst } from "./Sparks";
import PendingHub from "./pending/PendingHub";
import FocusMode from "./pending/FocusMode";
import { usePending } from "./pending/usePending";
import { describePending } from "./pending/describe";
import { useResolveApproval } from "../runs/ApprovalCards";
import { requiresFullReview } from "../runs/approvals";
import { useBriefing } from "./useBriefing";
import VoiceHints from "./VoiceHints";
import { ContextSelector } from "../contexts/ContextSelector";
import { ACTIVITY_EVENT, FOCUS_EVENT } from "./events";
import { freshOrigin, pressTarget, setOrigin } from "./travel";
import Beams from "./Beams";
import Lamina, { type LaminaSpec } from "./Lamina";
import { SCENE_VIEWS } from "./sceneViews";
import "./nucleo.css";
import "./luz.css";
import { setSubject, useSubject } from "./subject";
import { CommandsGate, useCommands, type Command } from "../commands/registry";
import { isTypingTarget } from "../commands/keys";
import { Tooltip } from "../ui";

/** The scenes that take the shared language (luz.css); the Núcleo and the Brain draw their own worlds. */
const LUZ = (id: SceneId) => (id === "nucleo" || id === "brain" ? "" : " luz");

/** How long the scene being left stays on screen while it travels away. */
const LEAVE_MS = 650;
const LAMINA_EXIT_MS = 430;

export default function Nucleo({ meta, onMetaChanged }: { meta: Meta; onMetaChanged?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { economy } = useWorkspace();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const activeRuns = useActiveRunCount(runs.data);
  const coreState = useCoreState(runs.data ?? []);
  const signals = useDesktopSignals(activeRuns);
  useBudgetNotifications();

  /* ---- where journeys start ------------------------------------------- */
  // Every press is a candidate origin: the next scene or lâmina grows out of it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = pressTarget(e.target);
      const r = el?.getBoundingClientRect();
      setOrigin(
        e.clientX,
        e.clientY,
        r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
      );
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  /* ---- scenes ---------------------------------------------------------- */
  const [focus, setFocus] = useState(false);
  // The conversation: the line at the bottom is all there is until you use
  // it; then the rest dims and the conversation rises out of the line.
  const [dialog, setDialog] = useState(false);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const pressing = useRef(false);
  const scene = sceneForPath(location.pathname);
  type Mode = "zoom" | "home";
  const [leaving, setLeaving] = useState<{ id: SceneId; mode: Mode } | null>(null);
  const [mode, setMode] = useState<Mode>("zoom");
  const [origin, setOriginVars] = useState({ x: "50%", y: "50%" });
  const stageRef = useRef<HTMLElement>(null);
  const lastScene = useRef<SceneId>(scene.id);
  useLayoutEffect(() => {
    const from = lastScene.current;
    if (from === scene.id) return;
    lastScene.current = scene.id;
    // Lâminas belong to the moment they were projected in: a new scene is a
    // new subject, and they dissolve on the way.
    for (const id of getLaminas()) dismiss(id);
    // Travelling is leaving the focus too: you went somewhere to act.
    setFocus(false);
    setDialog(false);
    const m: Mode = scene.id === "nucleo" ? "home" : "zoom";
    // The journey starts where you pressed; a key has no press, so it starts
    // at the module's glyph (going home: the glyph of the scene being left,
    // which folds back into it).
    const press = freshOrigin();
    const glyph = document
      .querySelector(`.nu-mod[data-scene="${m === "home" ? from : scene.id}"] .nu-mod-glyph`)
      ?.getBoundingClientRect();
    const px = press?.x ?? (glyph ? glyph.left + glyph.width / 2 : window.innerWidth / 2);
    const py = press?.y ?? (glyph ? glyph.top + glyph.height / 2 : window.innerHeight / 2);
    const st = stageRef.current?.getBoundingClientRect();
    setOriginVars({ x: `${px - (st?.left ?? 0)}px`, y: `${py - (st?.top ?? 0)}px` });
    burst(px, py, m === "home" ? "system" : "agent", 1.2);
    setMode(m);
    setLeaving({ id: from, mode: m });
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [scene.id]);
  const go = useCallback(
    (to: SceneDef) => {
      if (to.id === sceneForPath(location.pathname).id) return;
      navigate(to.path);
    },
    [navigate, location.pathname],
  );

  /* ---- pendências, focus, the briefing, the agent's activity ------------ */
  const pending = usePending();
  useEffect(() => {
    const on = () => setFocus(true);
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  const briefing = useBriefing();
  const [activity, setActivity] = useState<readonly HumanEvent[]>([]);
  useEffect(() => {
    const on = (e: Event) => setActivity((e as CustomEvent<HumanEvent[]>).detail ?? []);
    window.addEventListener(ACTIVITY_EVENT, on);
    return () => window.removeEventListener(ACTIVITY_EVENT, on);
  }, []);

  /* ---- lâminas ---------------------------------------------------------- */
  const laminas = useLaminas();
  // Ones on their way out stay drawn for the exit.
  const [exiting, setExiting] = useState<string[]>([]);
  const shownLaminas = useRef<readonly string[]>(laminas);
  // Each exit owns its timer: a projection arriving mid-exit must not cancel
  // it, or the leaving sheet would stay drawn for good.
  const exitTimers = useRef(new Set<number>());
  useEffect(() => {
    const gone = shownLaminas.current.filter((id) => !laminas.includes(id));
    shownLaminas.current = laminas;
    // One projected again mid-exit is live again, not leaving.
    setExiting((cur) => {
      const next = [...cur.filter((id) => !laminas.includes(id) && !gone.includes(id)), ...gone];
      return next.length === cur.length && next.every((id, i) => id === cur[i]) ? cur : next;
    });
    if (gone.length === 0) return;
    const timer = window.setTimeout(() => {
      exitTimers.current.delete(timer);
      setExiting((cur) => cur.filter((id) => !gone.includes(id)));
    }, LAMINA_EXIT_MS);
    exitTimers.current.add(timer);
  }, [laminas]);
  useEffect(() => {
    const timers = exitTimers.current;
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  const specFor = useCallback(
    (id: string): LaminaSpec | null => {
      const kind = panelKind(id);
      if (isDocId(id)) {
        const path = docPath(id);
        const name = path.split(/[\\/]/).pop() || path;
        return {
          id,
          kind,
          title: name,
          refName: name,
          icon: <FileText aria-hidden />,
          wide: true,
          node: <DocWindow instanceId={id} />,
        };
      }
      if (isRunPanelId(id)) {
        const rid = runIdOf(id);
        const record = (runs.data ?? []).find((r) => r.id === rid);
        return {
          id,
          kind,
          title: runPanelTitle(rid, record?.skillSlug),
          refName: `run-${rid.length > 8 ? rid.slice(0, 8) : rid}`,
          wide: true,
          scenePath: `/runs/${encodeURIComponent(rid)}`,
          node: <RunPanel runId={rid} />,
        };
      }
      if (isFormPanelId(id)) {
        const slug = formSlugOf(id);
        return {
          id,
          kind,
          title: t("desktop.form.title", { slug }),
          refName: slug,
          wide: true,
          node: <SkillInputsPanel slug={slug} onDone={() => dismiss(id)} />,
        };
      }
      const def = widgetDefinition(id);
      if (!def) return null;
      const Component = def.Component;
      const scenePath =
        id === "routines" ? "/routines" : id === "pulse" ? "/runs" : id === "mission" ? undefined : undefined;
      return {
        id,
        kind,
        title: t(def.titleKey),
        refName: t(def.refKey),
        icon: def.icon,
        scenePath,
        node: <Component instanceId={id} />,
      };
    },
    [runs.data, t],
  );
  const laminaIds = useMemo(() => {
    const out = [...laminas];
    for (const id of exiting) if (!out.includes(id)) out.push(id);
    return out;
  }, [laminas, exiting]);
  const specs = useMemo(
    () => laminaIds.map(specFor).filter((s): s is LaminaSpec => s !== null),
    [laminaIds, specFor],
  );

  /* ---- what the voice line can point at --------------------------------- */
  const subject = useSubject();
  // A subject belongs to the scene it was asked from.
  useEffect(() => setSubject(null), [scene.id]);
  const openPanels = useMemo<OpenPanel[]>(() => {
    const out: OpenPanel[] = [];
    for (const spec of specs) {
      if (exiting.includes(spec.id)) continue;
      out.push({
        id: spec.id,
        kind: spec.kind,
        ref: spec.refName,
        title: spec.title,
        path: isDocId(spec.id) ? docPath(spec.id) : undefined,
        minimized: false,
        live: isRunPanelId(spec.id)
          ? isActiveStatus((runs.data ?? []).find((r) => r.id === runIdOf(spec.id))?.status ?? "")
          : undefined,
      });
    }
    out.reverse();
    // The item being asked about, when it is not already on screen as a lâmina.
    if (subject && !out.some((p) => p.id === subject.id))
      out.unshift({
        id: subject.id,
        kind: subject.kind,
        ref: subject.ref,
        title: subject.title,
        path: subject.path,
        minimized: false,
      });
    if (scene.app) {
      const def = APPS[scene.app];
      out.push({
        id: appId(scene.app),
        kind: "app",
        ref: t(def.refKey),
        title: t(def.titleKey),
        minimized: false,
      });
    }
    return out;
  }, [specs, exiting, scene.app, runs.data, t, subject]);
  useEffect(() => {
    publishPanels(openPanels);
    return () => publishPanels([]);
  }, [openPanels]);

  const referencePanel = useReferencePanel(openPanels);

  /* ---- actions everything else calls ------------------------------------ */
  const sceneRef = useRef(scene.id);
  sceneRef.current = scene.id;
  // Going to look at something (a trace, a document, an instrument) folds
  // the conversation: what it asked for is behind the sheet's veil otherwise.
  const fold = useCallback(() => {
    if (!dialogRef.current) return;
    setDialog(false);
    const el = document.activeElement as HTMLElement | null;
    if (el?.closest(".nu-voice")) el.blur();
  }, []);
  const openRun = useCallback(
    (runId: string) => {
      fold();
      // In the Runs scene the trace unfolds in place; anywhere else it is projected.
      if (sceneRef.current === "runs") navigate(`/runs/${encodeURIComponent(runId)}`);
      else project(runPanelId(runId));
    },
    [navigate, fold],
  );
  const openApp = useCallback(
    (kind: AppKind, at?: Partial<AppLocation>) => {
      const def = APPS[kind];
      navigate(`${at?.pathname ?? def.route}${at?.search ?? ""}`);
    },
    [navigate],
  );
  const runSkill = useRunSkill((out) => {
    if ("form" in out) project(formPanelId(out.form));
    else if ("approvals" in out) project("approvals");
    else openRun(out.run);
  });
  const runningSkills = useRunningSkills(runs.data);
  const [deckPopover, setDeckPopover] = useState<{ skill: Skill; anchor: HTMLElement } | null>(null);
  const actions = useMemo<DesktopActions>(
    () => ({
      runSkill,
      configureSkill: (skill, anchor) => setDeckPopover({ skill, anchor }),
      focusDeck: focusSkillDeck,
      runningSkills,
      openPanels,
      openDoc: (path) => {
        fold();
        project(docId(path));
      },
      openApp,
      openRun,
      openSkillForm: (slug) => {
        fold();
        project(formPanelId(slug));
      },
      openPanel: (id) => {
        if (
          WIDGET_REGISTRY[id as keyof typeof WIDGET_REGISTRY] ||
          isRunPanelId(id) ||
          isDocId(id) ||
          isFormPanelId(id)
        ) {
          fold();
          project(id);
        }
      },
      referencePanel,
    }),
    [runSkill, runningSkills, openPanels, openApp, openRun, referencePanel, fold],
  );

  // Old callers still speak in panels: the palette's "open panel", the inbox's
  // "focus". A panel id is a lâmina now.
  usePanelEventBridge({ open: actions.openPanel, dismiss });
  useEffect(() => {
    // "Organizar revisar código" (refino item 47): the scene the intent needs,
    // and its instruments projected beside it — two at most.
    const onArrange = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail ?? [];
      const app = ids.map(appKindOf).find((k): k is AppKind => k !== null);
      if (app) actions.openApp(app);
      const panels = ids.filter((x) => appKindOf(x) === null).slice(0, 2);
      // After the travel: arriving in a scene dissolves what was projected before it.
      const later = () => panels.forEach((id) => actions.openPanel(id));
      if (app) requestAnimationFrame(() => requestAnimationFrame(later));
      else later();
    };
    window.addEventListener(ARRANGE_EVENT, onArrange);
    return () => window.removeEventListener(ARRANGE_EVENT, onArrange);
  }, [actions]);

  /* ---- modes: the one search, the deck ---------------------------------- */
  const [searching, setSearching] = useState(false);
  const search = useUniversalSearch(searching);
  const [deckOpen, setDeckOpen] = useState(false);

  /* ---- keys (the `nucleo` scope of the command registry) ------------------ */
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const resolve = useResolveApproval((runId) => runId && openRun(runId));
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const keyState = useRef({ go, searching });
  keyState.current = { go, searching };
  const commands = useMemo<Command[]>(() => {
    const key = (
      id: string,
      title: Command["title"],
      keys: string[],
      run: () => void,
      extra: Partial<Command> = {},
    ) => ({ id, title, group: "navigation", scope: "nucleo", keys, run, ...extra }) satisfies Command;
    const cycle = (step: 1 | -1) => () => {
      const ring = horizonRing(sceneRef.current);
      const i = ring.findIndex((s) => s.id === sceneRef.current);
      const next = ring[(i + (step === 1 ? 1 : ring.length - 1)) % ring.length];
      if (next) keyState.current.go(next);
    };
    // ⌘⇧A approves, ⌘⇧D denies the first decision — from anywhere.
    const firstDecision = () => pendingRef.current.items.find((i) => i.kind === "decision")?.approval;
    const decidable: Partial<Command> = {
      when: () => Boolean(firstDecision()) && !resolveRef.current.isPending,
    };
    const resolveFirst = (decision: "approved" | "denied") => () => {
      const first = firstDecision();
      if (!first) return;
      // A write a paired device asked for is not approved from a key: ⌘⇧A opens the Resolver, which shows the whole
      // request, and the person approves there. Denying needs no review.
      if (decision === "approved" && requiresFullReview(first)) {
        setFocus(true);
        return;
      }
      resolveRef.current.mutate({ id: first.id, decision });
    };
    return [
      ...MAIN_SCENES.map((scene, i) =>
        key(`nucleo.scene.${scene.id}`, scene.labelKey, [String(i + 1)], () => keyState.current.go(scene)),
      ),
      key("nucleo.prev", "cmd.nucleo.prev", ["["], cycle(-1)),
      key("nucleo.next", "cmd.nucleo.next", ["]"], cycle(1)),
      key("nucleo.voice", "shell.shortcuts.cinema", ["/"], () =>
        document.querySelector<HTMLTextAreaElement>(".cons-input")?.focus(),
      ),
      key("nucleo.focus", "cmd.nucleo.focus", ["p"], () => setFocus(true)),
      key("nucleo.search", "shell.shortcuts.overview", ["Mod+F"], () => setSearching(true)),
      key("nucleo.approve", "cmd.nucleo.approve", ["Mod+Shift+A"], resolveFirst("approved"), decidable),
      key("nucleo.deny", "cmd.nucleo.deny", ["Mod+Shift+D"], resolveFirst("denied"), decidable),
      // Escape folds the conversation first (and lets go of the line), then
      // closes the search, then takes the newest lâmina away; with none, the
      // global Escape goes home.
      key(
        "nucleo.escape",
        "cmd.nucleo.escape",
        ["Escape"],
        () => {
          if (dialogRef.current) {
            setDialog(false);
            (document.activeElement as HTMLElement | null)?.blur();
          } else if (keyState.current.searching) setSearching(false);
          else dismissNewest();
        },
        {
          allowInInput: true,
          when: () =>
            dialogRef.current ||
            keyState.current.searching ||
            (!isTypingTarget(document.activeElement) && getLaminas().length > 0),
        },
      ),
      {
        id: "action:skill-deck",
        title: "desktop.deck.open",
        group: "actions",
        scope: "nucleo",
        icon: Sparkles,
        keywords: ["skill", "deck", "run", "executar", "radial"],
        keys: ["Mod+J"],
        palette: true,
        run: () => setDeckOpen((v) => !v),
      },
    ];
  }, []);
  useCommands(commands);

  /* ---- the scene's own route, for the production views ------------------ */
  const route = useMemo<AppRoute>(
    () => ({
      pathname: location.pathname,
      search: location.search,
      setLocation: (next) => {
        const pathname = next.pathname ?? location.pathname;
        const search = next.search ?? location.search;
        // A new path is a place (history); a new query is state inside it.
        navigate(`${pathname}${search}`, { replace: next.pathname === undefined });
      },
    }),
    [location.pathname, location.search, navigate],
  );

  const activeProvider = providers.data?.find((p) => p.isDefault);
  const renderScene = (id: SceneId) => {
    if (id === "nucleo")
      return (
        <NucleoScene
          coreState={coreState}
          signals={signals}
          economy={economy}
          onProject={project}
          briefing={briefing}
          activity={activity}
          pending={{
            count: pending.count,
            level: pending.level,
            top: pending.items[0] ? describePending(pending.items[0], t).title : null,
          }}
          onFocus={() => setFocus(true)}
        />
      );
    const def = sceneById(id);
    if (!def.app) return null;
    const app = APPS[def.app];
    const View = SCENE_VIEWS[id] ?? app.Component;
    return (
      <div
        className="nu-scene-app app-panel"
        data-onboarding={def.app}
        data-designed={SCENE_VIEWS[id] ? "" : undefined}
      >
        <ErrorBoundary name={t(app.titleKey)} resetKey={location.pathname}>
          <Suspense fallback={<Skeleton page lines={6} />}>
            <View onMetaChanged={onMetaChanged ?? (() => undefined)} />
          </Suspense>
        </ErrorBoundary>
      </div>
    );
  };
  const projCount = Math.min(2, laminas.length);

  // The voice's real height is the floor every scene stands on.
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    // The whole voice — the conversation above the line included: a scene
    // stands above what is being said, and grows back when it folds.
    const voice = shell?.querySelector<HTMLElement>(".nu-voice");
    if (!shell || !voice) return;
    const apply = () => {
      // The open conversation floats over the dimmed scene; the floor is the
      // folded line, so nothing behind it moves when it rises.
      if (voice.dataset.open !== undefined) return;
      const top = voice.getBoundingClientRect().top;
      shell.style.setProperty("--nu-voice-h", `${Math.max(90, Math.ceil(window.innerHeight - top))}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(voice);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  const liveMarks: Partial<Record<SceneId, string>> = {};
  if (activeRuns > 0) liveMarks.runs = String(activeRuns);

  return (
    <DesktopActionsProvider value={actions}>
      <AppRouteContext.Provider value={route}>
        <div
          ref={shellRef}
          className={`nu-shell${searching ? " searching" : ""}`}
          data-scene={scene.id}
          data-proj={projCount}
          data-core={coreState}
          data-pending={pending.count > 0 ? (pending.level ?? "clear") : "clear"}
          data-focus={focus ? "" : undefined}
          style={{ "--ox": origin.x, "--oy": origin.y } as CSSProperties}
        >
          <Field travel={scene.id} economy={economy} />
          <div className="nu-vignette" aria-hidden />
          <Aura />

          <div className="nu-os">
            <header className="nu-hud">
              <PendingHub pending={pending} onOpen={() => setFocus(true)} />
              <div className="nu-title" aria-live="polite">
                <span className="nu-title-g" aria-hidden>
                  {scene.glyph}
                </span>
                <h1 className="nu-title-t" key={scene.id}>
                  {t(scene.labelKey)}
                </h1>
              </div>
              <Telemetry
                name={meta.name}
                provider={activeProvider}
                coreState={coreState}
                signals={signals}
                onProvider={() => openApp("settings", { pathname: "/settings", search: "?tab=providers" })}
                onCost={() => project("cost")}
                onRuns={() => navigate("/runs")}
                onMission={() => project("mission")}
              />
            </header>
            <ModuleSpine current={scene.id} onGo={go} marks={liveMarks} />

            <main className="nu-stage" ref={stageRef}>
              {leaving && leaving.id !== scene.id && (
                <section
                  key={leaving.id}
                  className={`nu-scene out-${leaving.mode}${LUZ(leaving.id)}`}
                  data-scene={leaving.id}
                  aria-hidden
                  // The scene on its way out is a picture, not a place (React 18
                  // has no `inert` prop, so it is set on the element).
                  ref={(el) => el?.setAttribute("inert", "")}
                >
                  {/* Same shape as the scene on: React keeps the view mounted while it leaves. */}
                  <CommandsGate enabled={false}>{renderScene(leaving.id)}</CommandsGate>
                </section>
              )}
              <section
                key={scene.id}
                className={`nu-scene on${leaving ? ` in-${mode}` : ""}${LUZ(scene.id)}`}
                // Coming back within the exit's 650 ms reuses the element that was
                // leaving: it must not keep the exit's `inert`.
                ref={(el) => el?.removeAttribute("inert")}
                data-scene={scene.id}
                aria-label={t(scene.labelKey)}
              >
                <CommandsGate enabled>{renderScene(scene.id)}</CommandsGate>
              </section>
            </main>

            <Beams active={scene.id === "nucleo" && !leaving} economy={economy} />

            {specs.length > 0 && (
              <aside className="nu-laminas" data-count={specs.length} aria-label={t("nucleo.lamina.region")}>
                {specs.map((spec) => (
                  // A lâmina dissolving is a picture: its screen's keys stand down.
                  <CommandsGate key={spec.id} enabled={!exiting.includes(spec.id)}>
                    <Lamina
                      spec={spec}
                      leaving={exiting.includes(spec.id)}
                      onDismiss={() => dismiss(spec.id)}
                      onReference={() => referencePanel(spec.id)}
                      onOpenScene={
                        spec.scenePath
                          ? () => {
                              dismiss(spec.id);
                              navigate(spec.scenePath!);
                            }
                          : undefined
                      }
                    />
                  </CommandsGate>
                ))}
              </aside>
            )}

            <SkillDeck open={deckOpen} onClose={() => setDeckOpen(false)} />
            {dialog && (
              <div
                className="nu-dialog-veil"
                aria-hidden
                onClick={() => {
                  setDialog(false);
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              />
            )}
            {/* The work context, left of the voice line (cerebro-contextos design). */}
            <div className="nu-context">
              <ContextSelector variant="nucleo" />
            </div>
            <div
              className="nu-voice"
              data-open={dialog ? "" : undefined}
              data-testid="voice"
              // A press on the folded line's tools (send, mic, context…) must
              // land where it started: the sheet rises (and the line moves)
              // once the press is over, not between its down and its up.
              onPointerDownCapture={() => {
                if (dialogRef.current) return;
                pressing.current = true;
                window.addEventListener(
                  "pointerup",
                  () =>
                    window.setTimeout(() => {
                      pressing.current = false;
                      const voice = document.querySelector(".nu-voice");
                      if (voice?.contains(document.activeElement)) setDialog(true);
                    }, 0),
                  { once: true, capture: true },
                );
              }}
              onFocusCapture={() => {
                if (!pressing.current) setDialog(true);
              }}
            >
              {dialog && (
                <header className="nu-dialog-head">
                  <span className="nu-dialog-pulse" data-state={coreState} aria-hidden />
                  <span className="nu-dialog-t">{t("nucleo.dialog.title")}</span>
                  <span className="nu-dialog-state mono">{t(`desktop.core.${coreState}`)}</span>
                  <span className="sp" />
                  <Tooltip label={`${t("nucleo.dialog.close")} · Esc`}>
                    <button
                      type="button"
                      className="nu-dialog-x"
                      aria-label={t("nucleo.dialog.close")}
                      onClick={() => {
                        setDialog(false);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                    >
                      <ChevronDown aria-hidden />
                    </button>
                  </Tooltip>
                </header>
              )}
              {!dialog && (activeRuns > 0 || coreState !== "idle") && (
                <button type="button" className="nu-voice-status" onClick={() => setDialog(true)}>
                  <span className="dot" aria-hidden />
                  <span className="tx">
                    {activity.length > 0
                      ? `${activity[activity.length - 1]!.text}${activity[activity.length - 1]!.subject ? ` ${activity[activity.length - 1]!.subject}` : ""}`
                      : t(`desktop.core.${coreState}`)}
                  </span>
                  <span className="go mono">{t("nucleo.dialog.open")} ↑</span>
                </button>
              )}
              <VoiceHints scene={scene.id} pending={pending.items} />
              <Console
                busy={activeRuns > 0}
                deckOpen={deckOpen}
                onToggleDeck={(open) => setDeckOpen((v) => open ?? !v)}
                stacked={false}
                lead={
                  <span className="nu-iris" aria-hidden>
                    <Entity variant="iris" state={coreState} economy={economy} className="nu-iris-orb" />
                  </span>
                }
              />
            </div>
            <p className="nu-keys mono" aria-hidden>
              {t("nucleo.keys")}
            </p>
          </div>

          <Sparks />
          {focus && <FocusMode pending={pending} onClose={() => setFocus(false)} />}

          {searching && (
            <SearchBar
              query={search.query}
              matches={search.hits.length}
              hits={search.hits}
              onQuery={search.setQuery}
              onPick={(hit) => {
                const kind = hit.kind ?? "artifact";
                if (kind === "run" && hit.runId) openRun(hit.runId);
                else if (kind === "skill" && hit.skillSlug) {
                  const sk = search.skills.find((x) => x.slug === hit.skillSlug);
                  if (sk) runSkill(sk);
                } else if (kind === "notification") {
                  if (hit.runId) openRun(hit.runId);
                } else if (kind === "file" && !hit.path.startsWith("/")) {
                  navigate(`/brain?sel=${hit.nodeId ?? ""}`);
                } else project(docId(hit.path));
                setSearching(false);
              }}
              onFly={(hit) => {
                navigate(
                  hit.nodeId !== undefined
                    ? `/brain?sel=${hit.nodeId}`
                    : `/brain?q=${encodeURIComponent(hit.label)}`,
                );
                setSearching(false);
              }}
              onClose={() => setSearching(false)}
            />
          )}

          {deckPopover && (
            <ModelEffortPopover
              skill={deckPopover.skill}
              providers={providers.data ?? []}
              anchor={deckPopover.anchor}
              open
              onClose={() => setDeckPopover(null)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: qk.skills }).catch(() => undefined);
              }}
            />
          )}
        </div>
      </AppRouteContext.Provider>
    </DesktopActionsProvider>
  );
}
