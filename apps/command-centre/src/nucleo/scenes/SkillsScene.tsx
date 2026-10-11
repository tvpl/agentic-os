/**
 * The Skills scene (immersive shell): an arsenal, not a card grid.
 *
 * The enabled skills stand on a ring, in sectors read from their words
 * (agents, code, memory…), read-only in amber and file-writing in cyan. The
 * chosen one turns to the top and stands in the middle as typography, with
 * what you can do with it: run it, ask for it in the voice line, open its
 * details. Arrows and the wheel turn the ring; typing dims what does not
 * match and turns to the best match. `/skills/:slug` is the choice, so back
 * and forward walk through it; `?d=1` opens the full `SkillDetail` in a
 * glass sheet (edit, model × effort, inputs, notes, resources, export…).
 * The management actions — marketplace, export, new skill, filters — sit in
 * a quiet toolbar in the top-left corner. On a narrow screen the ring
 * becomes a sectored grid under the chosen skill.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiCall } from "../../apiCall";
import { useLang, useT } from "../../i18n";
import { qk, useInvalidate, useOsProviders, useOsSkills } from "../../queries";
import { ErrorBox, Skeleton, useToast } from "../../components/ui";
import { keyLayerOpen, Modal } from "../../ui";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePanelParams, usePanelSearchParams } from "../../desktop/appRoute";
import { useDesktopActions } from "../../desktop/actions";
import { isActiveStatus, useDesktopRuns } from "../../desktop/data";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "../../desktop/consoleDraft";
import { errorMessage, isOffline } from "../../views/shared";
import SkillDetail from "../../views/Skills/SkillDetail";
import NewSkillModal from "../../views/Skills/NewSkillModal";
import MarketplaceModal from "../../views/Skills/MarketplaceModal";
import ExportModal from "../../views/Skills/ExportModal";
import { useLaminas } from "../projections";
import type { SceneViewProps } from "../sceneViews";
import { groupSectors, nextRotation, paginate, ringGeometry, ringLayout } from "./skillsRing";
import { bestMatch, filterSkills, matchScore, NO_FILTERS, stepIndex, withSlashCommand } from "./skillsMatch";
import { toEntry } from "./skillsEntries";
import { SkillGrid, SkillRing, type ArsenalProps } from "./SkillsSceneRing";
import { SkillFocus, SkillReadings, type FocusActions } from "./SkillsSceneFocus";
import SkillsTools from "./SkillsSceneTools";
import "./skillsScene.css";

const isEditable = (el: Element | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export default function SkillsScene(_props: SceneViewProps) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const skills = useOsSkills();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const actions = useDesktopActions();
  const laminas = useLaminas();
  const narrow = useMediaQuery("(max-width: 760px)");
  const { slug: routeSlug } = usePanelParams<"slug">("/skills/:slug");
  const [params] = usePanelSearchParams();
  const sheetOpen = params.get("d") === "1";

  /* ---- management: the modals the list page had --------------------------- */
  // `/skills?new=1&prompt=…` (the did-it-twice suggestion) opens "new skill" pre-filled.
  const [showNew, setShowNew] = useState(() => params.get("new") === "1");
  const [initialPrompt] = useState(() => params.get("prompt") ?? undefined);
  const [showExport, setShowExport] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const closeNew = () => {
    setShowNew(false);
    if (params.has("new"))
      navigate(routeSlug ? `/skills/${encodeURIComponent(routeSlug)}` : "/skills", { replace: true });
  };

  /* ---- what stands on the ring ---------------------------------------------- */
  const [filters, setFilters] = useState(NO_FILTERS);
  const [query, setQuery] = useState("");
  const all = useMemo(() => skills.data ?? [], [skills.data]);
  const known = routeSlug ? all.find((s) => s.slug === routeSlug) : undefined;
  const entries = useMemo(
    () => filterSkills(all, filters, known?.slug).map((s) => toEntry(s, lang)),
    [all, filters, known?.slug, lang],
  );
  const sectors = useMemo(() => groupSectors(entries), [entries]);
  const flat = useMemo(() => sectors.flatMap((s) => s.items), [sectors]);
  const querying = query.trim() !== "";
  const scores = useMemo(
    () => new Map(flat.map((e) => [e.slug, querying ? matchScore(e.text, query) : 1])),
    [flat, query, querying],
  );
  const pausedCount = all.filter((s) => !s.enabled).length;

  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  const fallback = useMemo(() => {
    const onRing = new Set(flat.map((e) => e.slug));
    const recent = runList.find((r) => r.skillSlug && onRing.has(r.skillSlug))?.skillSlug;
    return flat.find((e) => e.favorite)?.slug ?? recent ?? flat[0]?.slug ?? null;
  }, [flat, runList]);
  const notFound = Boolean(routeSlug) && skills.data !== undefined && !known;
  const selected = known ? known.slug : notFound ? null : fallback;
  const entry = flat.find((e) => e.slug === selected) ?? null;

  /* ---- choosing ------------------------------------------------------------- */
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);
  const select = useCallback(
    (slug: string, opts?: { replace?: boolean; focus?: boolean }) => {
      if (opts?.focus) focusNext.current = slug;
      if (slug === selected && routeSlug) return;
      navigate(`/skills/${encodeURIComponent(slug)}${sheetOpen ? "?d=1" : ""}`, { replace: opts?.replace });
    },
    [navigate, selected, routeSlug, sheetOpen],
  );
  useEffect(() => {
    if (!selected || focusNext.current !== selected) return;
    focusNext.current = null;
    buttons.current.get(selected)?.focus({ preventScroll: !narrow });
  }, [selected, narrow]);

  /** Move the choice by `delta` — among the matches while a filter is typed. */
  const step = useCallback(
    (delta: number, focus: boolean) => {
      const pool = querying ? flat.filter((e) => (scores.get(e.slug) ?? 0) > 0) : flat;
      const list = pool.length ? pool : flat;
      if (!list.length) return;
      const i = list.findIndex((e) => e.slug === selected);
      const next = i < 0 ? list[0] : list[stepIndex(i, delta, list.length)];
      if (next) select(next.slug, { replace: true, focus });
    },
    [flat, querying, scores, selected, select],
  );
  const onRingKey = (e: KeyboardEvent<HTMLElement>) => {
    const k = e.key;
    let target: string | undefined;
    if (k === "ArrowRight" || k === "ArrowDown") return (e.preventDefault(), step(1, true));
    if (k === "ArrowLeft" || k === "ArrowUp") return (e.preventDefault(), step(-1, true));
    if (k === "Home") target = flat[0]?.slug;
    else if (k === "End") target = flat[flat.length - 1]?.slug;
    else if (k === "PageDown" || k === "PageUp") {
      const si = sectors.findIndex((s) => s.items.some((x) => x.slug === selected));
      const next = sectors[stepIndex(si, k === "PageDown" ? 1 : -1, sectors.length)];
      target = next?.items[0]?.slug;
    }
    if (target) {
      e.preventDefault();
      select(target, { replace: true, focus: true });
    }
  };

  const onQuery = (q: string) => {
    setQuery(q);
    if (!q.trim()) return;
    const best = bestMatch(
      flat.map((e) => ({ slug: e.slug, favorite: e.favorite, score: matchScore(e.text, q) })),
    );
    if (best && best !== selected) select(best, { replace: true });
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const onQueryKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1, false);
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      buttons.current.get(selected)?.focus();
    }
  };

  /* ---- the ring's turn ------------------------------------------------------- */
  const pages = useMemo(() => paginate(sectors), [sectors]);
  const pageIndex = Math.max(
    0,
    pages.findIndex((p) => p.some((s) => s.items.some((x) => x.slug === selected))),
  );
  const pageSectors = useMemo(() => pages[pageIndex] ?? [], [pages, pageIndex]);
  const layout = useMemo(() => ringLayout(pageSectors.map((s) => s.items.length)), [pageSectors]);
  const pageItems = pageSectors.flatMap((s) => s.items);
  const selIndex = pageItems.findIndex((x) => x.slug === selected);
  const selAngle = selIndex >= 0 ? (layout.slots[selIndex]?.angle ?? null) : null;
  const [rot, setRot] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (selAngle === null) return;
    setRot((prev) => (prev === null ? -90 - selAngle : nextRotation(prev, selAngle)));
  }, [selAngle]);
  // The first turn lands without travel; after it, every turn is animated.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (rot === null || settled) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [rot, settled]);
  const turnPage = (dir: 1 | -1) => {
    const next = pages[stepIndex(pageIndex, dir, pages.length)];
    const first = next?.[0]?.items[0];
    if (first) select(first.slug, { replace: true });
  };

  // The ring is as large as the stage allows.
  const hasData = skills.data !== undefined;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      setStage({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow, hasData]);

  const geo = ringGeometry(stage.w, stage.h, layout.rings);

  /* ---- the chosen skill's actions ------------------------------------------- */
  const favorite = useMutation({
    mutationFn: (slug: string) => apiCall("POST /api/skills/:slug/favorite", { params: { slug } }),
    onSuccess: () => invalidate(qk.skills),
    onError: (err) => toast(errorMessage(err), "danger"),
  });
  const enable = useMutation({
    mutationFn: (slug: string) => apiCall("POST /api/skills/:slug/toggle", { params: { slug } }),
    onSuccess: () => invalidate(qk.skills),
    onError: (err) => toast(errorMessage(err), "danger"),
  });
  const skillRuns = useMemo(
    () => (selected ? runList.filter((r) => r.skillSlug === selected) : []),
    [runList, selected],
  );
  const liveRun = skillRuns.find((r) => isActiveStatus(r.status)) ?? null;
  const lastRun = skillRuns[0] ?? null;

  // The skill's readings (recent runs, inputs, model) wait to be asked for.
  const [readings, setReadings] = useState(false);
  const detailsOpener = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const openDetails = () => {
    if (!selected) return;
    detailsOpener.current = document.activeElement as HTMLElement | null;
    navigate(`/skills/${encodeURIComponent(selected)}?d=1`, { replace: true });
  };
  const closeDetails = useCallback(() => {
    navigate(selected ? `/skills/${encodeURIComponent(selected)}` : "/skills", { replace: true });
    const back = detailsOpener.current;
    detailsOpener.current = null;
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
      else rootRef.current?.querySelector<HTMLElement>("[data-details]")?.focus();
    });
  }, [navigate, selected]);

  const ask = (slug: string) => {
    const draft = readConsoleDraft();
    storeConsoleDraft({ ...draft, text: withSlashCommand(draft.text, slug) });
    window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(".cons-input");
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const focusActions: FocusActions | null = entry
    ? {
        onRun: () => actions.runSkill(entry.skill),
        onAsk: () => ask(entry.slug),
        onDetails: () => setReadings((v) => !v),
        detailsOpen: readings,
        onEdit: openDetails,
        onConfigure: (anchor) => actions.configureSkill(entry.skill, anchor),
        onFavorite: () => favorite.mutate(entry.slug),
        onEnable: () => enable.mutate(entry.slug),
        onOpenRun: actions.openRun,
        favoriteBusy: favorite.isPending,
        enableBusy: enable.isPending,
      }
    : null;

  /* ---- keys the scene answers to anywhere ------------------------------------ */
  const keyState = useRef({ step, onQuery, query });
  keyState.current = { step, onQuery, query };
  useEffect(() => {
    const outside = (el: Element | null) =>
      Boolean(el?.closest('[role="dialog"], .nu-voice, .nu-laminas, .sks-sheet'));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || keyLayerOpen()) return;
      if (document.documentElement.dataset.onboarding || rootRef.current?.closest("[inert]")) return;
      const el = e.target instanceof Element ? e.target : null;
      if (isEditable(el) || outside(el) || el?.closest(".sks-items, .sks-list")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        keyState.current.step(e.key === "ArrowRight" ? 1 : -1, false);
        return;
      }
      // Type to find: a letter anywhere in the scene starts the filter.
      if (e.key.length === 1 && /\p{L}/u.test(e.key) && inputRef.current) {
        e.preventDefault();
        inputRef.current.focus();
        keyState.current.onQuery(keyState.current.query + e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const showSheet = sheetOpen && Boolean(known);

  // On a narrow screen the chosen skill is above the grid: bring it into view.
  const focusRef = useRef<HTMLDivElement>(null);
  const pickFromArsenal = (slug: string) => {
    select(slug);
    if (narrow) focusRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /* ---- render ---------------------------------------------------------------- */
  const running = actions.runningSkills;
  const arsenal: ArsenalProps = {
    sectors: narrow ? sectors : pageSectors,
    selected,
    scores,
    querying,
    running,
    onPick: pickFromArsenal,
    onKey: onRingKey,
    buttons,
  };
  const loading = (skills.isPending && !skills.data) || (providers.isPending && !providers.data);
  const err = skills.error ?? providers.error;

  const centre = (() => {
    if (loading) return <Skeleton lines={5} />;
    if (err && !skills.data)
      return (
        <ErrorBox
          message={errorMessage(err)}
          offline={isOffline(err)}
          onRetry={() => {
            void skills.refetch();
            void providers.refetch();
          }}
        />
      );
    if (notFound)
      return (
        <div className="sks-focus">
          <p className="sks-eyebrow">{t("skills.notFound")}</p>
          <span className="sks-cmd">/{routeSlug}</span>
          <div className="sks-acts">
            <Link className="sks-act" to="/skills">
              {t("scene.skills.back")}
            </Link>
          </div>
        </div>
      );
    if (all.length === 0)
      return (
        <div className="sks-focus">
          <h2 className="sks-name">{t("skills.emptyTitle")}</h2>
          <p className="sks-desc">{t("skills.emptyBody")}</p>
          <div className="sks-acts">
            <button type="button" className="sks-act primary" onClick={() => setShowNew(true)}>
              {t("skills.new")}
            </button>
          </div>
        </div>
      );
    if (!entry || !focusActions)
      return (
        <div className="sks-focus">
          <h2 className="sks-name">{t("skills.noMatch")}</h2>
          <p className="sks-desc">{t("skills.noMatchBody")}</p>
          <div className="sks-acts">
            <button
              type="button"
              className="sks-act"
              onClick={() => {
                setFilters(NO_FILTERS);
                setQuery("");
              }}
            >
              {t("skills.clearFilters")}
            </button>
          </div>
        </div>
      );
    return (
      <SkillFocus
        key={entry.slug}
        entry={entry}
        live={liveRun}
        lastRun={lastRun}
        actions={focusActions}
        compact={!narrow && geo.compact}
      />
    );
  })();
  const noneMatch = querying && flat.length > 0 && ![...scores.values()].some((v) => v > 0);

  return (
    <div
      ref={rootRef}
      className="sks"
      data-narrow={narrow || undefined}
      data-sheet={showSheet || undefined}
      data-read={(readings && !narrow) || undefined}
      data-proj={!showSheet && laminas.length > 0 ? laminas.length : undefined}
    >
      <div className="sks-body">
        <SkillsTools
          query={query}
          onQuery={onQuery}
          onQueryKey={onQueryKey}
          inputRef={inputRef}
          filters={filters}
          onFilters={setFilters}
          pausedCount={pausedCount}
          shown={flat.length}
          total={all.length}
          page={pageIndex}
          pages={narrow ? 1 : pages.length}
          onPage={turnPage}
          onMarket={() => setShowMarket(true)}
          onExport={() => setShowExport(true)}
          onNew={() => setShowNew(true)}
        />
        {noneMatch && (
          <p className="sks-nomatch" role="status">
            {t("scene.skills.noMatchDim", { q: query.trim() })}
          </p>
        )}

        {narrow ? (
          <div className="sks-stage" ref={stageRef}>
            <div ref={focusRef} className="sks-narrow-focus">
              {centre}
            </div>
            {!loading && flat.length > 0 && <SkillGrid props={arsenal} />}
          </div>
        ) : (
          <div className="sks-stage" ref={stageRef}>
            {stage.w > 0 && !loading && flat.length > 0 ? (
              <SkillRing
                props={arsenal}
                layout={layout}
                rot={rot ?? 0}
                settled={settled}
                width={stage.w}
                height={stage.h}
                geo={geo}
                onWheelStep={(dir) => step(dir, false)}
              >
                <div className="sks-centre">{centre}</div>
              </SkillRing>
            ) : (
              <div className="sks-centre solo">{centre}</div>
            )}
          </div>
        )}

        {!narrow && readings && entry && (
          <SkillReadings entry={entry} runs={skillRuns.slice(0, 5)} onOpenRun={actions.openRun} />
        )}
        {!narrow && (
          <p className="sks-keys mono" aria-hidden>
            {t("scene.skills.keys")}
          </p>
        )}
      </div>

      {showSheet && known && (
        <Modal title={entry?.name ?? known.name} className="sks-sheet" onClose={closeDetails}>
          <p className="sks-sheet-sub">
            <span className="hx" data-mode={known.mode} aria-hidden>
              {known.mode === "write" ? "✎" : "◇"}
            </span>
            <span className="sks-cmd">/{known.slug}</span>
          </p>
          <div className="sks-sheet-body">
            <ErrorBoundary name={known.name} resetKey={known.slug}>
              {providers.data ? (
                <SkillDetail key={known.slug} skill={known} providers={providers.data} />
              ) : (
                <Skeleton lines={8} />
              )}
            </ErrorBoundary>
          </div>
        </Modal>
      )}

      {showNew && <NewSkillModal initialPrompt={initialPrompt} onClose={closeNew} onCreated={closeNew} />}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showMarket && <MarketplaceModal onClose={() => setShowMarket(false)} />}
    </div>
  );
}
