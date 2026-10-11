/**
 * The Routines scene (immersive shell): the day as a 24-hour dial, not a
 * list of cards. The dial holds the clock — every routine at its time(s)
 * today, the next one in cyan with an arc from "now", today's firings as
 * ok/fail dots — and its centre names the next (or selected) routine with a
 * countdown. Beside it, the same routines as a typographic agenda; the
 * selected line unfolds into its details and every action the production
 * view has (run now, pause/enable, edit, duplicate, history, delete, new).
 * A failing routine is red with its reason, and the agent can be asked
 * about it through the voice line.
 *
 * The selection lives in the URL (`/routines?r=<id>`), so a routine can be
 * linked to.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { type RoutineStatus, type RoutineSummary } from "../../api";
import { apiCall } from "../../apiCall";
import { useLocale, useT, type TKey } from "../../i18n";
import { qk, useApiQuery, useOsSettings, useOsSkills } from "../../queries";
import { ErrorBox, Skeleton, useToast } from "../../components/ui";
import { useConfirm } from "../../hooks/useConfirm";
import { useDesktopRoutines } from "../../desktop/data";
import { useDesktopActions } from "../../desktop/actions";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "../../desktop/consoleDraft";
import { errorMessage, isOffline } from "../../views/shared";
import { routineKind } from "../../views/Routines";
import { formatIn } from "../format";
import type { SceneViewProps } from "../sceneViews";
import {
  agendaOrder,
  dayMarks,
  endOfLocalDay,
  fireOutcome,
  nextFiring,
  pickNext,
  startOfLocalDay,
  type DayMarks,
} from "./routinesDial";
import { scheduleInWords, type Translate } from "./routinesWords";
import { RoutineEditor, RoutinesClassic, allowWebhooks } from "./routinesEditor";
import RoutinesSceneDial, { type DialRoutineView, type PastFire } from "./RoutinesSceneDial";
import RoutinesSceneDetail from "./RoutinesSceneDetail";
import { escapeLayerOpen } from "../../ui";
import "./routinesScene.css";

/** The clock the dial reads: a re-render every `ms`, and at once when the tab comes back. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
  return now;
}

const isUnhealthy = (r: RoutineStatus) => !r.healthy || r.recentFailures >= 2;
/** Histories fetched for the dial's past ring (one request per routine). */
const MAX_HISTORIES = 30;

export default function RoutinesScene(_props: SceneViewProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useDesktopActions();
  const now = useNow(20_000);

  const routines = useDesktopRoutines();
  const skills = useOsSkills();
  const settings = useOsSettings();
  const summary = useApiQuery<RoutineSummary>([...qk.routines, "summary"], "/api/routines/summary", {
    refetchInterval: 300_000,
    retry: false,
  });
  const list = useMemo(() => routines.data ?? [], [routines.data]);
  const histories = useQueries({
    queries: list.slice(0, MAX_HISTORIES).map((r) => ({
      queryKey: qk.routineHistory(r.id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        apiCall("GET /api/routines/:id/history", { params: { id: r.id } }, { signal }),
      staleTime: 60_000,
    })),
  });
  const historyOf = (id: string) => {
    const i = list.findIndex((r) => r.id === id);
    return i >= 0 && i < MAX_HISTORIES ? histories[i] : undefined;
  };

  /* ---- the day ---------------------------------------------------------- */
  const dayStart = startOfLocalDay(now);
  const dayEnd = endOfLocalDay(now);
  const tr = useCallback<Translate>((key, vars) => t(key as TKey, vars), [t]);
  const words = useMemo(
    () => new Map(list.map((r) => [r.id, scheduleInWords(r, tr, locale)])),
    [list, tr, locale],
  );
  const marks = useMemo(
    () => new Map<string, DayMarks>(list.map((r) => [r.id, dayMarks(r, dayStart, dayEnd)])),
    [list, dayStart, dayEnd],
  );
  // The minute is enough for "next" and the order; the dial's hand reads `now` itself.
  const minute = Math.floor(now / 60_000) * 60_000;
  const agenda = useMemo(() => agendaOrder(list, minute), [list, minute]);
  const next = useMemo(() => pickNext(list, minute), [list, minute]);

  const dialRoutines = useMemo<DialRoutineView[]>(
    () =>
      agenda.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        unhealthy: isUnhealthy(r),
        marks: marks.get(r.id) ?? { kind: "none" },
        words: words.get(r.id) ?? "",
      })),
    [agenda, marks, words],
  );
  const historyData = histories.map((h) => h.data);
  // Today's firings so far, from each routine's history (a few dozen entries at most).
  const past: PastFire[] = list.slice(0, MAX_HISTORIES).flatMap((r, i) =>
    (historyData[i] ?? [])
      .filter((h) => h.firedAt >= dayStart && h.firedAt <= now)
      .map((h) => ({
        key: `${r.id}-${h.id}`,
        routineId: r.id,
        name: r.name,
        at: h.firedAt,
        outcome: fireOutcome(h.runStatus, h.status),
        runId: h.runId,
      })),
  );

  /* ---- selection (in the URL) -------------------------------------------- */
  const params = new URLSearchParams(location.search);
  const selParam = params.get("r");
  const selected = list.find((r) => r.id === selParam) ?? null;
  const shown = selected ?? next?.routine ?? agenda[0] ?? null;
  const listRef = useRef<HTMLOListElement>(null);
  const select = useCallback(
    (id: string | null, scroll = false) => {
      const p = new URLSearchParams(location.search);
      if (id) p.set("r", id);
      else p.delete("r");
      const qs = p.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
      if (scroll && id)
        requestAnimationFrame(() =>
          listRef.current
            ?.querySelector<HTMLElement>(`[data-routine="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: "nearest" }),
        );
    },
    [location.pathname, location.search, navigate],
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => setHistoryOpen(false), [selParam]);

  /* ---- editing ------------------------------------------------------------ */
  const [editing, setEditing] = useState<RoutineStatus | "new" | null>(null);
  const [classic, setClassic] = useState(false);
  const classicRef = useRef<HTMLDivElement>(null);
  const openEditor = (target: RoutineStatus | "new") => {
    if (RoutineEditor) setEditing(target);
    else setClassic(true);
  };
  useEffect(() => {
    if (!classic) return;
    const prev = document.activeElement as HTMLElement | null;
    classicRef.current?.focus();
    // Capture: the sheet closes before the shell's own Escape (lâminas, home) sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || escapeLayerOpen()) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[role="dialog"]')) return; // the view's own modals close first
      e.preventDefault();
      e.stopPropagation();
      setClassic(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [classic]);

  /* ---- actions (the production view's endpoints) ------------------------- */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.routines }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
  };
  const act = useMutation({
    mutationFn: async ({ fn }: { fn: () => Promise<unknown>; okMsg?: string }) => fn(),
    onSuccess: (_r, vars) => {
      if (vars.okMsg) toast(vars.okMsg, "ok");
      invalidate();
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const runNow = (r: RoutineStatus) =>
    act.mutate({
      fn: async () => {
        const res = await apiCall("POST /api/routines/:id/run", { params: { id: r.id } });
        if (res.runId) actions.openRun(res.runId);
        else toast(`▶ ${r.name}`, "ok");
      },
    });
  const toggle = (r: RoutineStatus) =>
    act.mutate({ fn: () => apiCall("POST /api/routines/:id/toggle", { params: { id: r.id } }) });
  const duplicate = (r: RoutineStatus) =>
    act.mutate({
      fn: () => apiCall("POST /api/routines/:id/duplicate", { params: { id: r.id } }),
      okMsg: t("routines.duplicated"),
    });
  const remove = async (r: RoutineStatus) => {
    const ok = await confirm({
      title: `${t("common.delete")} "${r.name}"?`,
      body: t("routines.deleteBody"),
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    act.mutate({
      fn: () => apiCall("DELETE /api/routines/:id", { params: { id: r.id } }),
      okMsg: t("routines.deleted"),
    });
    if (selParam === r.id) select(null);
  };
  const ask = (r: RoutineStatus) => {
    const i = list.findIndex((x) => x.id === r.id);
    const lastFail = (historyData[i] ?? []).find((h) => fireOutcome(h.runStatus, h.status) === "fail");
    const prompt = t("scene.routines.askPrompt", {
      name: r.name,
      id: r.id,
      n: r.recentFailures,
      note: lastFail?.note ? t("scene.routines.askNote", { note: lastFail.note.slice(0, 200) }) : "",
    });
    const draft = readConsoleDraft();
    storeConsoleDraft({ ...draft, text: [draft.text.trimEnd(), prompt].filter(Boolean).join("\n\n") });
    window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".cons-input");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  };

  /* ---- words for a moment ------------------------------------------------ */
  const clock = (ts: number) =>
    new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const dayWord = (ts: number) => {
    if (ts < dayEnd) return t("scene.routines.today");
    if (ts < endOfLocalDay(dayEnd)) return t("scene.routines.tomorrow");
    return new Date(ts).toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  };

  /* ---- the centre of the dial -------------------------------------------- */
  const centre = (() => {
    if (!shown) return null;
    const at = nextFiring(shown, minute);
    const kind = routineKind(shown);
    const countdown = !shown.enabled
      ? t("scene.routines.paused")
      : kind === "on-exit"
        ? t("scene.routines.afterSkill", { skill: shown.onExit?.skillSlug ?? "?" })
        : at === null
          ? "—"
          : at - now < 60_000
            ? t("scene.routines.due")
            : t("scene.routines.in", { d: formatIn(at - now) });
    return (
      <>
        <span className="rts-eyebrow">
          {selected ? t("scene.routines.selected") : t("scene.routines.next")}
        </span>
        <h2 className={isUnhealthy(shown) ? "bad" : undefined}>{shown.name}</h2>
        <span className={`rts-count${shown.enabled && at !== null ? "" : " quiet"}`}>{countdown}</span>
        <span className="rts-words">
          {words.get(shown.id)}
          {at !== null && at >= dayEnd && ` · ${dayWord(at)}`}
          {at !== null && !(words.get(shown.id) ?? "").includes(clock(at)) && ` ${clock(at)}`}
        </span>
        {isUnhealthy(shown) && <span className="rts-bad">{t("routines.failing")}</span>}
      </>
    );
  })();

  /* ---- render ---------------------------------------------------------------- */
  const counts = summary.data;
  const loading = routines.isPending && !routines.data;
  const failed = routines.error && !routines.data;

  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".rts-row") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <div className="rts" data-classic={classic ? "" : undefined}>
      <div className="rts-dial-cell">
        <div className="rts-dial-wrap">
          <RoutinesSceneDial
            routines={dialRoutines}
            past={past}
            now={now}
            next={next ? { id: next.routine.id, at: next.at } : null}
            selectedId={selected?.id ?? null}
            onSelect={(id) => select(id === selParam ? null : id, true)}
            onOpenRun={actions.openRun}
          />
          <div className="rts-centre" aria-live="polite">
            {centre ??
              (loading ? null : (
                <>
                  <span className="rts-eyebrow">{t("scene.routines.label")}</span>
                  <h2>
                    {list.length === 0 ? t("scene.routines.emptyDial") : t("scene.routines.nothingNext")}
                  </h2>
                  <span className="rts-words">
                    {list.length === 0 ? t("routines.emptyBody") : t("scene.routines.nothingNextBody")}
                  </span>
                </>
              ))}
          </div>
        </div>
      </div>

      <section className="rts-side" aria-label={t("scene.routines.list")}>
        <header className="rts-head">
          <span className="rts-eyebrow">
            {t("scene.routines.count", { n: list.length })}
            {counts && counts.totalToday > 0 && (
              <> · {t("scene.routines.todayCount", { fired: counts.firedToday, total: counts.totalToday })}</>
            )}
          </span>
          <span className="rts-head-acts">
            <button type="button" className="rts-act" onClick={() => setClassic(true)}>
              {t("scene.routines.classic")}
            </button>
            <button type="button" className="rts-act primary" onClick={() => openEditor("new")}>
              + {t("routines.new")}
            </button>
          </span>
        </header>

        {loading ? (
          <Skeleton lines={6} />
        ) : failed ? (
          <ErrorBox
            message={errorMessage(routines.error)}
            offline={isOffline(routines.error)}
            onRetry={() => void routines.refetch()}
          />
        ) : list.length === 0 ? (
          <p className="rts-empty">{t("routines.emptyBody")}</p>
        ) : (
          <ol className="rts-list" ref={listRef}>
            {agenda.map((r) => {
              const at = nextFiring(r, minute);
              const kind = routineKind(r);
              const on = r.id === (selected?.id ?? null);
              const isNext = r.id === next?.routine.id;
              const bad = isUnhealthy(r);
              const last = r.lastStatus ? fireOutcome(r.lastStatus) : null;
              const status = !r.enabled ? "paused" : (last ?? "none");
              const h = historyOf(r.id);
              return (
                <li key={r.id} className={`rts-item${on ? " on" : ""}`} data-routine={r.id}>
                  <button
                    type="button"
                    className={`rts-row${isNext ? " next" : ""}${bad ? " bad" : ""}${r.enabled ? "" : " off"}`}
                    aria-expanded={on}
                    onClick={() => select(on ? null : r.id)}
                    onKeyDown={onRowKey}
                  >
                    <span className="rts-tm">
                      {kind === "on-exit" ? (
                        <span aria-hidden>↳</span>
                      ) : at !== null ? (
                        <>
                          {clock(at)}
                          {at >= dayEnd && <small>{dayWord(at)}</small>}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="rts-what">
                      <b>{r.name}</b>
                      <small>
                        {words.get(r.id)}
                        {" · "}
                        {r.lastFiredAt
                          ? t("scene.routines.last", { when: formatAgo(r.lastFiredAt, now, t) })
                          : t("scene.routines.never")}
                      </small>
                      {bad && !on && (
                        <small className="rts-reason">
                          {t("routines.failingWhy", { n: r.recentFailures })}
                        </small>
                      )}
                    </span>
                    <span className={`rts-st o-${status}`}>{t(`scene.routines.st.${status}`)}</span>
                  </button>
                  {on && (
                    <RoutinesSceneDetail
                      routine={r}
                      words={words.get(r.id) ?? ""}
                      nextAt={at}
                      history={h?.data}
                      historyLoading={Boolean(h?.isPending)}
                      historyOpen={historyOpen}
                      busy={act.isPending}
                      onRun={() => runNow(r)}
                      onToggle={() => toggle(r)}
                      onEdit={() => openEditor(r)}
                      onDuplicate={() => duplicate(r)}
                      onDelete={() => void remove(r)}
                      onHistory={() => setHistoryOpen((v) => !v)}
                      onAsk={() => ask(r)}
                      onOpenRun={actions.openRun}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {classic && (
        <div
          className="rts-sheet"
          ref={classicRef}
          tabIndex={-1}
          role="region"
          aria-label={t("scene.routines.classicTitle")}
        >
          <header className="rts-sheet-head">
            <h2>{t("scene.routines.classicTitle")}</h2>
            <button type="button" className="rts-act" onClick={() => setClassic(false)}>
              {t("common.close")}
            </button>
          </header>
          <div className="rts-sheet-body">
            <RoutinesClassic />
          </div>
        </div>
      )}

      {editing && RoutineEditor && (
        <RoutineEditor
          routine={editing === "new" ? null : editing}
          skills={skills.data ?? []}
          allowWebhooks={allowWebhooks(settings.data)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/** "3 h ago" in the scene's words (the same units as the countdown). */
function formatAgo(ts: number, now: number, t: (k: TKey, v?: Record<string, string | number>) => string) {
  return t("scene.routines.ago", { d: formatIn(Math.max(0, now - ts)) });
}
