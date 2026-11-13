/**
 * "Revisão semanal" (.specs/features/cerebro-rituais, S5; design.md "Página - Revisão semanal"): five steps over
 * `GET /api/memory/weekly-review` for the active context, any of them open at any time. Step 1 decides the open loops
 * (`POST /api/memory/weekly-review/loops`) and empties the inbox, step 2 puts each active project up to date (the
 * routes of the reviews and of the properties, and `POST /api/memory/tasks`), step 3 is someday, step 4 archives what
 * ended, step 5 finishes the week. The same screen is the frame's page at `/brain/weekly` and the Núcleo's brain panel
 * there; it is a chunk of its own, fetched the first time it is opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarClock,
  Check,
  CircleCheck,
  Clock,
  CloudMoon,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  ListPlus,
  Lock,
  Pause,
  Play,
  type LucideIcon,
} from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useCommands, useRegisteredCommands, type Command } from "../../commands/registry";
import { OPEN_PANEL_EVENT } from "../../components/CommandPalette";
import { Badge, type BadgeTone } from "../../components/primitives";
import { SWITCH_CONTEXT_ID, useWorkContext } from "../../contexts/useWorkContext";
import { useTweenNumber } from "../../desktop/useTweenNumber";
import { prefersReducedMotion, useOsNavigate } from "../../hooks/useViewTransition";
import { useLocale, useT, type TKey } from "../../i18n";
import { useApiQuery } from "../../queries";
import { DropdownMenu } from "../../ui";
import { useBrainMode } from "../BrainViewSwitch";
import { openNoteEditor } from "../noteEvents";
import { shortDay, useWeeklyReview } from "../weeklyEntry";
import "./weekly.css";

type Data = ApiCallResult<"GET /api/memory/weekly-review">;
type Loop = Data["loops"]["items"][number];
type Project = Data["projects"]["items"][number];
type Inbox = Data["inbox"]["items"][number];
type Archived = ApiCallResult<"POST /api/memory/weekly-review/archive">;
type Undone = ApiCallResult<"POST /api/memory/cleanup/undo">;
type Finished = ApiCallResult<"POST /api/memory/weekly-review/finish">;
type T = ReturnType<typeof useT>;
type Trouble = { kind: "conflict" } | { kind: "failed"; retry: () => void };
type Notice = { text: string; act?: { label: string; run: () => void } };

const STEPS: TKey[] = [
  "weekly.step.clear",
  "weekly.step.current",
  "weekly.step.someday",
  "weekly.step.archive",
  "weekly.step.done",
];
const NOTICE_MS = 8_000;
const LEAVE_MS = 150;
const DAY = 86_400_000;

/** The dashboards' health badge (G34: `paused` and `done` are never a badge of step 2). */
const HEALTH: Partial<Record<Project["health"], [LucideIcon, TKey, BadgeTone]>> = {
  behind: [AlertTriangle, "dash.state.behind", "danger"],
  due_today: [Clock, "dash.state.dueToday", "warn"],
  in_review: [Eye, "dash.state.inReview", "info"],
  on_track: [CircleCheck, "dash.state.onTrack", "ok"],
};
const SKIPS: Record<Archived["skipped"][number]["reason"], TKey> = {
  changed: "weekly.skip.changed",
  missing: "weekly.skip.missing",
  exists: "weekly.skip.exists",
  forbidden_path: "weekly.skip.forbidden",
};

const dayDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const daysSince = (day: string) => {
  const now = new Date();
  return Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - dayDate(day).getTime()) / DAY,
  );
};

/** "9 a 15/11", or "30/11 a 6/12" across two months (G19). */
function weekText(t: T, week: string) {
  const from = dayDate(week);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  return t("weekly.week", {
    from: from.getMonth() === to.getMonth() ? String(from.getDate()) : shortDay(from),
    to: shortDay(to),
  });
}

/** "sexta, 20/11, 16:00" (G23). */
function whenText(at: number, locale: string) {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d).replace(/-feira$/, "");
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day}, ${shortDay(d)}, ${time}`;
}

const without = <V,>(s: ReadonlySet<V>, v: V) => new Set([...s].filter((x) => x !== v));

export default function WeeklyReview() {
  const t = useT();
  const locale = useLocale();
  const work = useWorkContext();
  const brain = useBrainMode();
  const osNavigate = useOsNavigate();
  const commands = useRegisteredCommands();
  const list = useWeeklyReview();
  const data = list.data;
  const info = useApiQuery<{ home: string }>(["system", "info"], "/api/system/info", { staleTime: 60_000 });

  const [step, setStep] = useState<number | null>(null);
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set());
  const [forward, setForward] = useState(true);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [trouble, setTrouble] = useState<ReadonlyMap<string, Trouble>>(new Map());
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [archived, setArchived] = useState<Archived | null>(null);
  const [undone, setUndone] = useState<Undone | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const items = useRef(new Map<string, HTMLLIElement>());

  // A finished week opens on "Pronto" (AC 49); every step stays reachable.
  const current = step ?? (data?.finishedAt != null ? 5 : 1);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (focus) items.current.get(focus.id)?.focus();
  }, [focus]);

  const show = useCallback((next: Notice | null, ms?: number) => {
    window.clearTimeout(timer.current);
    setNotice(next);
    if (ms) timer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const home = info.data?.home;
  const rel = (p: string) => (home && p.startsWith(`${home}/`) ? p.slice(home.length + 1) : p);
  const versionOf = (p: Project) => versions[p.path] ?? p.version ?? undefined;
  const setVersion = (path: string, version: string) => setVersions((v) => ({ ...v, [path]: version }));

  const loops = (data?.loops.items ?? []).filter((l) => !gone.has(`loop:${l.key}`));
  const inbox = (data?.inbox.items ?? []).filter((i) => !gone.has(`inbox:${i.path}`));
  const projects = (data?.projects.items ?? [])
    .filter((p) => !gone.has(`project:${p.path}`))
    .sort((a, b) => reviewed.indexOf(a.path) - reviewed.indexOf(b.path));
  const somedayLoops = (data?.someday.loops ?? []).filter((l) => !gone.has(`loop:${l.key}`));
  const paused = (data?.someday.projects ?? []).filter((p) => !gone.has(`project:${p.path}`));
  const editable = projects.filter((p) => p.editable);
  const loopsGone = (data?.loops.items ?? []).length - loops.length;
  const openLoops = Math.max(0, (data?.loops.total ?? 0) - loopsGone);

  /** The items of the step on screen, top to bottom, by id: what j and k move over and what focus goes to. */
  const order: string[] =
    current === 1
      ? [...loops.map((l) => `loop:${l.key}`), ...inbox.map((i) => `inbox:${i.path}`)]
      : current === 2
        ? projects.map((p) => `project:${p.path}`)
        : current === 3
          ? [...somedayLoops.map((l) => `loop:${l.key}`), ...paused.map((p) => `project:${p.path}`)]
          : [];
  const selected = sel !== null && order.includes(sel) ? sel : (order[0] ?? null);

  const pick = (id: string) => {
    setSel(id);
    setFocus({ id });
  };
  const move = (by: number) => {
    const at = selected === null ? -1 : order.indexOf(selected);
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) pick(next);
  };
  const clear = (id: string) =>
    setTrouble((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  /** The item leaves its list (150 ms, at once with motion reduced) and focus goes to the next one. */
  const leave = (id: string) => {
    const at = order.indexOf(id);
    const next = order[at + 1] ?? order[at - 1];
    if (next) {
      pick(next);
      // A menu that closed ("Virar tarefa") gives focus back to its trigger first: the next item takes it after.
      window.setTimeout(() => setFocus({ id: next }), 0);
    }
    if (prefersReducedMotion()) setGone((g) => new Set(g).add(id));
    else {
      setLeaving((g) => new Set(g).add(id));
      window.setTimeout(() => setGone((g) => new Set(g).add(id)), LEAVE_MS);
    }
  };
  /** "Desfazer" brought it back: in its place, selected. */
  const back = (id: string) => {
    show(null);
    setGone((g) => without(g, id));
    setLeaving((g) => without(g, id));
    pick(id);
  };

  /** One save on item `id`: a conflict or a failure stays on the item (AC 46), a loop gone leaves it (AC 44). */
  const attempt = async <R,>(id: string, send: () => Promise<R>, ok: (r: R) => void): Promise<boolean> => {
    clear(id);
    let res: R;
    try {
      res = await send();
    } catch (err) {
      if (err instanceof ApiError && err.code === "loop_not_found") {
        leave(id);
        show({ text: t("weekly.loopGone") }, NOTICE_MS);
      } else
        setTrouble((m) =>
          new Map(m).set(
            id,
            err instanceof ApiError && err.code === "edit_conflict"
              ? { kind: "conflict" }
              : { kind: "failed", retry: () => void attempt(id, send, ok) },
          ),
        );
      return false;
    }
    ok(res);
    return true;
  };
  /** An undo: the item comes back, or the notice says it could not and offers the same request again. */
  const undo = async (id: string, send: () => Promise<unknown>, then?: (r: unknown) => void) => {
    try {
      // Sent first: `then?.(await send())` would skip the request when there is no `then`.
      const res = await send();
      then?.(res);
      back(id);
    } catch {
      show({
        text: t("weekly.saveFailed"),
        act: { label: t("weekly.retry"), run: () => void undo(id, send, then) },
      });
    }
  };
  const reload = () => {
    setTrouble(new Map());
    void list.refetch();
  };

  const LOOP_TOASTS = {
    close: "weekly.toast.closed",
    keep: "weekly.toast.kept",
    someday: "weekly.toast.someday",
  } as const;
  const decideLoop = (loop: Loop, action: keyof typeof LOOP_TOASTS) => {
    const id = `loop:${loop.key}`;
    void attempt(
      id,
      () => apiCall("POST /api/memory/weekly-review/loops", { body: { key: loop.key, action } }),
      (res) => {
        leave(id);
        const body = { key: loop.key, action: "restore" as const, previous: res.previous };
        show(
          {
            text: t(LOOP_TOASTS[action]),
            act: {
              label: t("weekly.undo"),
              run: () => void undo(id, () => apiCall("POST /api/memory/weekly-review/loops", { body })),
            },
          },
          NOTICE_MS,
        );
      },
    );
  };
  const makeProject = (loop: Loop, name: string) => {
    const id = `loop:${loop.key}`;
    const body = {
      key: loop.key,
      action: "project" as const,
      name,
      ...(work.query ? { context: work.query } : {}),
    };
    void attempt(
      id,
      () => apiCall("POST /api/memory/weekly-review/loops", { body }),
      (res) => {
        setMaking(null);
        leave(id);
        const path = res.created?.path;
        show(
          {
            text: t("weekly.toast.project", { title: name }),
            ...(path
              ? { act: { label: t("weekly.open"), run: () => openNoteEditor({ mode: "edit", path }) } }
              : {}),
          },
          NOTICE_MS,
        );
        // The new project belongs to step 2.
        void list.refetch();
      },
    );
  };
  const makeTask = (loop: Loop, p: Project) => {
    const id = `loop:${loop.key}`;
    const body = { key: loop.key, action: "task" as const, project: p.path, baseVersion: versionOf(p) };
    void attempt(
      id,
      () => apiCall("POST /api/memory/weekly-review/loops", { body }),
      (res) => {
        if (res.created) setVersion(p.path, res.created.version);
        if (!p.nextAction && !added[p.path]) setAdded((a) => ({ ...a, [p.path]: loop.text }));
        leave(id);
        show(
          {
            text: t("weekly.toast.task", { title: p.title }),
            act: { label: t("weekly.open"), run: () => openNoteEditor({ mode: "edit", path: p.path }) },
          },
          NOTICE_MS,
        );
      },
    );
  };
  const archiveInbox = (item: Inbox) => {
    const id = `inbox:${item.path}`;
    void attempt(
      id,
      () =>
        apiCall("POST /api/memory/weekly-review/archive", {
          body: { week: data!.week, paths: [item.path] },
        }),
      (res) => {
        if (res.moved.length === 0) {
          show({ text: t("weekly.skipped", { n: res.skipped.length }) }, NOTICE_MS);
          return;
        }
        leave(id);
        const manifest = res.manifest;
        show(
          {
            text: t("weekly.archived", { n: res.moved.length }),
            ...(manifest
              ? {
                  act: {
                    label: t("weekly.undo"),
                    run: () =>
                      void undo(id, () => apiCall("POST /api/memory/cleanup/undo", { body: { manifest } })),
                  },
                }
              : {}),
          },
          NOTICE_MS,
        );
      },
    );
  };
  const addNext = (p: Project, text: string) =>
    attempt(
      `project:${p.path}`,
      () => apiCall("POST /api/memory/tasks", { body: { path: p.path, text, baseVersion: versionOf(p)! } }),
      (res) => {
        setVersion(p.path, res.version);
        if (!p.nextAction && !added[p.path]) setAdded((a) => ({ ...a, [p.path]: res.task.text }));
      },
    );
  const markReviewed = (p: Project) => {
    const version = p.editable ? versionOf(p) : undefined;
    const body = { path: p.path, action: "keep" as const, ...(version ? { baseVersion: version } : {}) };
    void attempt(
      `project:${p.path}`,
      () => apiCall("POST /api/memory/reviews", { body }),
      (res) => {
        if (res.version) setVersion(p.path, res.version);
        setReviewed((r) => [...r.filter((x) => x !== p.path), p.path]);
      },
    );
  };
  const STATUS_TOASTS = {
    done: "weekly.toast.done",
    paused: "weekly.toast.paused",
    active: "weekly.toast.reactivated",
  } as const;
  const setStatus = (p: Project, status: keyof typeof STATUS_TOASTS) => {
    const id = `project:${p.path}`;
    void attempt(
      id,
      () =>
        apiCall("PUT /api/memory/notes/properties", {
          body: { path: p.path, baseVersion: versionOf(p)!, set: { status } },
        }),
      (res) => {
        setVersion(p.path, res.version);
        leave(id);
        const body = {
          path: p.path,
          baseVersion: res.version,
          ...(p.status ? { set: { status: p.status } } : { remove: ["status"] }),
        };
        show(
          {
            text: t(STATUS_TOASTS[status], { title: p.title }),
            act: {
              label: t("weekly.undo"),
              run: () =>
                void undo(
                  id,
                  () => apiCall("PUT /api/memory/notes/properties", { body }),
                  (r) => setVersion(p.path, (r as { version: string }).version),
                ),
            },
          },
          NOTICE_MS,
        );
      },
    );
  };
  /** "Manter em algum dia": nothing is written; the next item is the one to look at. */
  const skip = (id: string) => {
    const next = order[order.indexOf(id) + 1];
    if (next) pick(next);
  };

  const toArchive = (data?.archive.items ?? []).filter((i) => !unchecked.has(i.path));
  const archiveDone = async () => {
    setBusy(true);
    const paths = toArchive.map((i) => i.path);
    await attempt(
      "archive",
      () => apiCall("POST /api/memory/weekly-review/archive", { body: { week: data!.week, paths } }),
      setArchived,
    );
    setBusy(false);
  };
  const undoArchive = async (manifest: string) => {
    setBusy(true);
    await attempt(
      "archive",
      () => apiCall("POST /api/memory/cleanup/undo", { body: { manifest } }),
      setUndone,
    );
    setBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    const ok = await attempt(
      "finish",
      () => apiCall("POST /api/memory/weekly-review/finish", { body: { week: data!.week } }),
      setFinished,
    );
    setBusy(false);
    // The next reminder skips the week just finished (G23): the list says when.
    if (ok) void list.refetch();
  };

  const go = (to: number, done = false) => {
    if (done) setLeft((l) => new Set(l).add(current));
    setForward(to > current);
    setStep(to);
    setSel(null);
    // "Pronto" shows the week so far.
    if (to === 5 && current !== 5) void list.refetch();
  };
  const next = () => go(Math.min(5, current + 1), true);

  // The list's keys (design.md binding `comandos-atalhos`): j/k move, f closes a loop, m keeps it, r reviews a project.
  const live = useRef({
    move,
    selected,
    current,
    loops,
    somedayLoops,
    projects,
    decideLoop,
    markReviewed,
    skip,
  });
  live.current = { move, selected, current, loops, somedayLoops, projects, decideLoop, markReviewed, skip };
  useCommands(
    useMemo<Command[]>(() => {
      const loopOf = () => {
        const l = live.current;
        return [...l.loops, ...l.somedayLoops].find((x) => `loop:${x.key}` === l.selected);
      };
      const projectOf = () => {
        const l = live.current;
        return l.current === 2 ? l.projects.find((x) => `project:${x.path}` === l.selected) : undefined;
      };
      return [
        {
          id: "weekly.next",
          title: "reviews.cmd.next",
          group: "view",
          scope: "view:weekly",
          keys: ["j"],
          run: () => live.current.move(1),
        },
        {
          id: "weekly.prev",
          title: "reviews.cmd.prev",
          group: "view",
          scope: "view:weekly",
          keys: ["k"],
          run: () => live.current.move(-1),
        },
        {
          id: "weekly.close",
          title: "weekly.close",
          group: "view",
          scope: "view:weekly",
          keys: ["f"],
          when: () => !!loopOf(),
          run: () => live.current.decideLoop(loopOf()!, "close"),
        },
        {
          id: "weekly.keep",
          title: "weekly.keep",
          group: "view",
          scope: "view:weekly",
          keys: ["m"],
          when: () => !!loopOf(),
          run: () =>
            live.current.current === 3
              ? live.current.skip(`loop:${loopOf()!.key}`)
              : live.current.decideLoop(loopOf()!, "keep"),
        },
        {
          id: "weekly.reviewed",
          title: "weekly.reviewed",
          group: "view",
          scope: "view:weekly",
          keys: ["r"],
          when: () => !!projectOf(),
          run: () => live.current.markReviewed(projectOf()!),
        },
      ];
    }, []),
  );

  const itemRef = (id: string) => (el: HTMLLIElement | null) =>
    void (el ? items.current.set(id, el) : items.current.delete(id));
  const common = (id: string) => ({
    itemRef: itemRef(id),
    selected: id === selected,
    leaving: leaving.has(id),
    trouble: trouble.get(id),
    onReload: reload,
    onPick: () => setSel(id),
  });
  const loopItem = (l: Loop, someday: boolean) => {
    const id = `loop:${l.key}`;
    return (
      <LoopItem
        key={id}
        {...common(id)}
        loop={l}
        someday={someday}
        making={making === l.key}
        projects={editable}
        onClose={() => decideLoop(l, "close")}
        onKeep={() => decideLoop(l, "keep")}
        onSomeday={() => decideLoop(l, "someday")}
        onKeepSomeday={() => skip(id)}
        onMake={(open) => setMaking(open ? l.key : null)}
        onProject={(name) => makeProject(l, name)}
        onTask={(p) => makeTask(l, p)}
      />
    );
  };
  const projectItem = (p: Project, pausedItem: boolean) => {
    const id = `project:${p.path}`;
    return (
      <ProjectItem
        key={id}
        {...common(id)}
        project={p}
        paused={pausedItem}
        reviewedToday={reviewed.includes(p.path)}
        nextAction={p.nextAction?.text ?? added[p.path] ?? null}
        onAdd={(text) => addNext(p, text)}
        onReviewed={() => markReviewed(p)}
        onStatus={(s) => setStatus(p, s)}
      />
    );
  };
  const empty = (Icon: LucideIcon, text: TKey, hint?: TKey) => (
    <div className="wk-empty">
      <Icon aria-hidden size={32} />
      <p className="wk-prose">{t(text)}</p>
      {hint && <p className="wk-hint">{t(hint)}</p>}
      <button type="button" className="btn primary" onClick={next}>
        {t("weekly.next")}
      </button>
    </div>
  );

  let body: ReactNode;
  if (list.isPending)
    body = (
      <p className="wk-state">
        <span className="spinner" aria-hidden />
        {t("weekly.loading")}
      </p>
    );
  else if (list.isError || !data)
    body = (
      <div className="wk-state" role="alert">
        <AlertTriangle aria-hidden />
        <span>{t("weekly.loadFailed")}</span>
        <button type="button" className="btn sm" onClick={() => void list.refetch()}>
          {t("weekly.retry")}
        </button>
      </div>
    );
  else if (current === 1)
    body =
      loops.length === 0 && inbox.length === 0 ? (
        <>
          {empty(CircleCheck, "weekly.empty.clear")}
          <ReviewsLine n={data.reviewsDue} onOpen={() => brain.go("reviews")} />
        </>
      ) : (
        <>
          {loops.length > 0 && (
            <section className="wk-block">
              {data.loops.total > data.loops.items.length && (
                <p className="wk-cut">
                  {t("weekly.showing", { shown: data.loops.items.length, total: data.loops.total })}
                </p>
              )}
              <h2 className="wk-block-title">{t("weekly.loops", { n: openLoops })}</h2>
              <ul className="wk-list">{loops.map((l) => loopItem(l, false))}</ul>
            </section>
          )}
          {inbox.length > 0 && (
            <section className="wk-block">
              <h2 className="wk-block-title">{t("weekly.inbox", { n: inbox.length })}</h2>
              <ul className="wk-list">
                {inbox.map((i) => {
                  const id = `inbox:${i.path}`;
                  return (
                    <Item key={id} {...common(id)}>
                      <div className="wk-text">
                        <span className="wk-title">{i.title}</span>
                        <span className="wk-line2">
                          <span className="wk-mono">{rel(i.path)}</span>
                          <span>{t("weekly.age", { n: i.ageDays })}</span>
                        </span>
                      </div>
                      <div className="wk-acts">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openNoteEditor({ mode: "edit", path: i.path })}
                        >
                          <FileText aria-hidden />
                          {t("weekly.open")}
                        </button>
                        <button type="button" className="btn" onClick={() => archiveInbox(i)}>
                          <Archive aria-hidden />
                          {t("weekly.archive")}
                        </button>
                      </div>
                    </Item>
                  );
                })}
              </ul>
            </section>
          )}
          <ReviewsLine n={data.reviewsDue} onOpen={() => brain.go("reviews")} />
        </>
      );
  else if (current === 2)
    body =
      projects.length === 0 ? (
        empty(FolderOpen, "weekly.empty.current", "weekly.empty.currentHint")
      ) : (
        <section className="wk-block">
          <h2 className="wk-block-title">{t("weekly.projects", { n: projects.length })}</h2>
          <ul className="wk-list">{projects.map((p) => projectItem(p, false))}</ul>
        </section>
      );
  else if (current === 3)
    body =
      somedayLoops.length === 0 && paused.length === 0 ? (
        empty(CloudMoon, "weekly.empty.someday")
      ) : (
        <>
          {somedayLoops.length > 0 && (
            <section className="wk-block">
              <h2 className="wk-block-title">{t("weekly.somedayLoops", { n: somedayLoops.length })}</h2>
              <ul className="wk-list">{somedayLoops.map((l) => loopItem(l, true))}</ul>
            </section>
          )}
          {paused.length > 0 && (
            <section className="wk-block">
              <h2 className="wk-block-title">{t("weekly.paused", { n: paused.length })}</h2>
              <ul className="wk-list">{paused.map((p) => projectItem(p, true))}</ul>
            </section>
          )}
        </>
      );
  else if (current === 4)
    body = archived ? (
      <ArchiveResult
        result={archived}
        undone={undone}
        busy={busy}
        trouble={trouble.get("archive")}
        rel={rel}
        onReload={reload}
        onUndo={(m) => void undoArchive(m)}
      />
    ) : data.archive.items.length === 0 ? (
      empty(Archive, "weekly.empty.archive")
    ) : (
      <section className="wk-block">
        <p className="wk-prose">{t("weekly.archiveNote")}</p>
        <h2 className="wk-block-title">{t("weekly.doneProjects", { n: data.archive.items.length })}</h2>
        <ul className="wk-list">
          {data.archive.items.map((i) => (
            <li key={i.path} className="wk-item wk-check">
              <label className="wk-check-label">
                <input
                  type="checkbox"
                  checked={!unchecked.has(i.path)}
                  onChange={() =>
                    setUnchecked((u) => (u.has(i.path) ? without(u, i.path) : new Set(u).add(i.path)))
                  }
                />
                <span className="wk-title">{i.title}</span>
              </label>
              {i.editable ? (
                <span className="wk-mono">{rel(i.path)}</span>
              ) : (
                <span className="wk-lock">
                  <Lock aria-hidden />
                  {t("weekly.proposal")}
                </span>
              )}
              <span className="wk-dim">{t("weekly.doneOn", { day: shortDay(dayDate(i.doneSince)) })}</span>
            </li>
          ))}
        </ul>
        <TroubleLine trouble={trouble.get("archive")} onReload={reload} />
        <div className="wk-acts">
          <button
            type="button"
            className="btn primary"
            disabled={toArchive.length === 0 || busy}
            onClick={() => void archiveDone()}
          >
            <Archive aria-hidden />
            {t("weekly.archiveN", { n: toArchive.length })}
          </button>
        </div>
      </section>
    );
  else {
    const at = finished?.finishedAt ?? data.finishedAt;
    const counts = finished?.counts ?? data.counts;
    const missing = projects.filter((p) => !p.nextAction && !added[p.path]).length;
    body = (
      <section className="wk-block wk-done">
        {at !== null && (
          <p className="wk-finished">
            <CircleCheck aria-hidden />
            {finished ? t("weekly.finished") : t("weekly.finishedOn", { day: shortDay(new Date(at)) })}
          </p>
        )}
        <ol className="wk-numbers">
          <Num n={counts.loops} label={t("weekly.num.loops")} />
          <Num n={counts.projects} label={t("weekly.num.projects")} />
          <Num n={counts.archived} label={t("weekly.num.archived")} />
        </ol>
        {at === null && missing > 0 && (
          <p className="wk-warn tone-warn">
            <AlertTriangle aria-hidden />
            {t("weekly.stillNoNext", { n: missing })}
          </p>
        )}
        <TroubleLine trouble={trouble.get("finish")} onReload={reload} />
        {at !== null &&
          (data.nextReminder !== null ? (
            <p className="wk-prose">
              {t("weekly.nextReminder", { when: whenText(data.nextReminder, locale) })}
            </p>
          ) : (
            <p className="wk-prose">
              {t("weekly.reminderOff")}{" "}
              <a
                href="#/settings?tab=notifications"
                onClick={(e) => {
                  e.preventDefault();
                  osNavigate("/settings?tab=notifications");
                }}
              >
                {t("weekly.turnOn")}
              </a>
            </p>
          ))}
      </section>
    );
  }

  const done = finished !== null || data?.finishedAt != null;
  const name = work.active ? work.active.name : t("context.all");
  return (
    <section className="wk" aria-labelledby="wk-title">
      <header className="wk-head">
        <h1 id="wk-title" className="wk-h1">
          {t("weekly.title")}
        </h1>
        <div className="wk-tools">
          {data && <span className="wk-week">{weekText(t, data.week)}</span>}
          <button
            type="button"
            className="wk-context"
            onClick={() => commands.find((c) => c.id === SWITCH_CONTEXT_ID)?.run()}
          >
            {t("reviews.context", { name })}
          </button>
        </div>
      </header>
      <ol className="wk-steps">
        {STEPS.map((key, i) => (
          <li key={key} className="wk-step">
            <button
              type="button"
              aria-current={i + 1 === current ? "step" : undefined}
              data-done={left.has(i + 1) ? "" : undefined}
              onClick={() => go(i + 1)}
            >
              <span className="wk-dot" aria-hidden>
                {left.has(i + 1) ? <Check /> : i + 1}
              </span>
              <span className="wk-step-name">{t(key)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="wk-now">{t("weekly.stepOf", { n: current, name: t(STEPS[current - 1]!) })}</p>
      <p className="wk-status" role="status">
        {data ? t("weekly.status", { n: openLoops }) : ""}
      </p>
      <div key={current} className="wk-stage" data-back={forward ? undefined : ""}>
        {body}
      </div>
      {notice && (
        <div className="wk-notice" role="status">
          <Check aria-hidden />
          <span>{notice.text}</span>
          {notice.act && (
            <button type="button" className="btn sm" onClick={notice.act.run}>
              {notice.act.label}
            </button>
          )}
        </div>
      )}
      <footer className="wk-foot">
        <button type="button" className="btn" disabled={current === 1} onClick={() => go(current - 1)}>
          {t("weekly.back")}
        </button>
        <span className="wk-gap" />
        {current < 5 ? (
          <button type="button" className="btn primary" onClick={next}>
            {t("weekly.next")}
          </button>
        ) : (
          !done && (
            <button
              type="button"
              className="btn primary"
              disabled={busy || !data}
              onClick={() => void finish()}
            >
              {t("weekly.finish")}
            </button>
          )
        )}
      </footer>
    </section>
  );
}

/** C6's due notes, a line with a way to "Revisões" when there are any (AC 40). */
function ReviewsLine({ n, onOpen }: { n: number; onOpen: () => void }) {
  const t = useT();
  if (n <= 0) return null;
  return (
    <p className="wk-reviews">
      <Bell aria-hidden />
      <span>{t("weekly.reviewsDue", { n })}</span>
      <a
        href="#/brain/reviews"
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        {t("weekly.openReviews")}
      </a>
    </p>
  );
}

/** What a save left on an item: the conflict with "Recarregar", or the failure with "Tentar de novo" (AC 46). */
function TroubleLine({ trouble, onReload }: { trouble: Trouble | undefined; onReload: () => void }) {
  const t = useT();
  if (!trouble) return null;
  return (
    <div className="wk-trouble" role="alert">
      <AlertTriangle aria-hidden />
      <span>{t(trouble.kind === "conflict" ? "weekly.conflict" : "weekly.saveFailed")}</span>
      <button
        type="button"
        className="btn sm"
        onClick={trouble.kind === "conflict" ? onReload : trouble.retry}
      >
        {t(trouble.kind === "conflict" ? "weekly.reload" : "weekly.retry")}
      </button>
    </div>
  );
}

interface ItemProps {
  itemRef: (el: HTMLLIElement | null) => void;
  selected: boolean;
  leaving: boolean;
  trouble: Trouble | undefined;
  onReload: () => void;
  onPick: () => void;
}

/** One item of a list: focusable, the one `j`/`k` stand on marked, its trouble under it. */
function Item({ children, ...p }: ItemProps & { children: ReactNode }) {
  return (
    <li
      ref={p.itemRef}
      className="wk-item"
      tabIndex={-1}
      aria-current={p.selected ? "true" : undefined}
      data-leaving={p.leaving ? "" : undefined}
      onFocus={p.onPick}
    >
      <div className="wk-row">{children}</div>
      <TroubleLine trouble={p.trouble} onReload={p.onReload} />
    </li>
  );
}

/** A loop (step 1, and step 3 when put aside): its text, how old, where, and its decisions (AC 40, AC 41). */
export function LoopItem(
  p: ItemProps & {
    loop: Loop;
    someday: boolean;
    making: boolean;
    projects: Project[];
    onClose: () => void;
    onKeep: () => void;
    onSomeday: () => void;
    onKeepSomeday: () => void;
    onMake: (open: boolean) => void;
    onProject: (name: string) => void;
    onTask: (p: Project) => void;
  },
) {
  const t = useT();
  const { loop } = p;
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(loop.text);
  useEffect(() => {
    if (!p.making) return;
    setName(loop.text);
    field.current?.focus();
    field.current?.select();
  }, [p.making, loop.text]);
  const task =
    p.projects.length === 0 ? (
      <button type="button" className="btn" disabled title={t("weekly.noProject")}>
        <ListPlus aria-hidden />
        {t("weekly.makeTask")}
      </button>
    ) : (
      <DropdownMenu
        align="end"
        trigger={
          <button type="button" className="btn">
            <ListPlus aria-hidden />
            {t("weekly.makeTask")}
          </button>
        }
        items={p.projects.map((x) => ({ id: x.path, label: x.title, onSelect: () => p.onTask(x) }))}
      />
    );
  const make = (
    <button type="button" className="btn" onClick={() => p.onMake(!p.making)}>
      <FolderPlus aria-hidden />
      {t("weekly.makeProject")}
    </button>
  );
  const close = (
    <button type="button" className="btn primary" onClick={p.onClose}>
      <Check aria-hidden />
      {t("weekly.close")}
    </button>
  );
  return (
    <Item {...p}>
      <div className="wk-text">
        <span className="wk-loop">{loop.text}</span>
        <span className="wk-line2">
          <span>{t("weekly.age", { n: loop.ageDays })}</span>
          {loop.sources.length > 1 && (
            <span title={loop.sources.map((s) => s.path).join("\n")}>
              {t("weekly.sources", { n: loop.sources.length })}
            </span>
          )}
        </span>
        {p.making && (
          <form
            className="wk-make"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) p.onProject(name.trim());
            }}
          >
            <input
              ref={field}
              className="input"
              aria-label={t("weekly.makeProject")}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn primary sm" disabled={!name.trim()}>
              {t("weekly.create")}
            </button>
          </form>
        )}
      </div>
      <div className="wk-acts">
        {p.someday ? (
          <>
            {close}
            {make}
            {task}
            <button type="button" className="btn ghost" onClick={p.onKeepSomeday}>
              {t("weekly.keepSomeday")}
            </button>
          </>
        ) : (
          <>
            {close}
            <button type="button" className="btn" onClick={p.onKeep}>
              <Clock aria-hidden />
              {t("weekly.keep")}
            </button>
            <button type="button" className="btn" onClick={p.onSomeday}>
              <CloudMoon aria-hidden />
              {t("weekly.someday")}
            </button>
            {make}
            {task}
          </>
        )}
      </div>
    </Item>
  );
}

/** A project (step 2, and step 3 when paused): three lines and its decisions (AC 42, AC 26, AC 29). */
export function ProjectItem(
  p: ItemProps & {
    project: Project;
    paused: boolean;
    reviewedToday: boolean;
    nextAction: string | null;
    onAdd: (text: string) => Promise<boolean>;
    onReviewed: () => void;
    onStatus: (status: "done" | "paused" | "active") => void;
  },
) {
  const t = useT();
  const { project } = p;
  const [text, setText] = useState("");
  const health = HEALTH[project.health];
  const open = (
    <button
      type="button"
      className={p.paused ? "btn" : "btn ghost"}
      onClick={() => openNoteEditor({ mode: "edit", path: project.path })}
    >
      <FileText aria-hidden />
      {t("weekly.open")}
    </button>
  );
  const reviewed = (
    <button type="button" className="btn primary" onClick={p.onReviewed}>
      <Check aria-hidden />
      {t("weekly.reviewed")}
    </button>
  );
  if (p.paused)
    return (
      <Item {...p}>
        <div className="wk-text">
          <span className="wk-title">{project.title}</span>
        </div>
        <div className="wk-acts">
          {project.editable && (
            <button type="button" className="btn" onClick={() => p.onStatus("active")}>
              <Play aria-hidden />
              {t("weekly.reactivate")}
            </button>
          )}
          {open}
        </div>
      </Item>
    );
  return (
    <Item {...p}>
      <div className="wk-text">
        <span className="wk-line1">
          <span className="wk-title">{project.title}</span>
          {health && (
            <Badge kind="state" tone={health[2]} className="wk-health">
              {(() => {
                const Icon = health[0];
                return <Icon aria-hidden />;
              })()}
              {t(health[1])}
            </Badge>
          )}
        </span>
        <span className="wk-line2">
          {p.nextAction !== null ? (
            <span>{t("weekly.nextAction", { text: p.nextAction })}</span>
          ) : (
            <span className="wk-flag tone-warn">
              <AlertTriangle aria-hidden />
              {t("weekly.noNextAction")}
            </span>
          )}
          {p.reviewedToday ? (
            <span className="wk-flag tone-ok">
              <Check aria-hidden />
              {t("weekly.reviewedToday")}
            </span>
          ) : (
            <>
              <span>
                {project.lastReviewed
                  ? t("weekly.reviewedAgo", { n: daysSince(project.lastReviewed) })
                  : t("weekly.neverReviewed")}
              </span>
              {project.reviewDue && (
                <span className="wk-flag tone-warn">
                  <CalendarClock aria-hidden />
                  {t("weekly.reviewDue")}
                </span>
              )}
            </>
          )}
        </span>
        {project.editable && (
          <form
            className="wk-next"
            onSubmit={(e) => {
              e.preventDefault();
              const value = text.trim();
              if (value) void p.onAdd(value).then((ok) => ok && setText(""));
            }}
          >
            <input
              className="input"
              aria-label={t("weekly.field")}
              placeholder={t("weekly.field")}
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn sm" disabled={!text.trim()}>
              {t("weekly.add")}
            </button>
          </form>
        )}
      </div>
      {!project.editable && (
        <p className="wk-lock">
          <Lock aria-hidden />
          {t("reviews.readonly")}
        </p>
      )}
      <div className="wk-acts">
        {reviewed}
        {project.editable && (
          <>
            <button type="button" className="btn" onClick={() => p.onStatus("done")}>
              <CircleCheck aria-hidden />
              {t("weekly.done")}
            </button>
            <button type="button" className="btn" onClick={() => p.onStatus("paused")}>
              <Pause aria-hidden />
              {t("weekly.pause")}
            </button>
          </>
        )}
        {open}
      </div>
    </Item>
  );
}

/** One of "Pronto"'s numbers: it rises from 0 in 300 ms, or shows its value at once with motion reduced. */
function Num({ n, label }: { n: number; label: string }) {
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(n), [n]);
  const shown = useTweenNumber(target, 300);
  return (
    <li>
      <span className="wk-num">{Math.round(shown)}</span>
      <span className="wk-num-label">{label}</span>
    </li>
  );
}

/** What "Arquivar N" did (AC 43): the moved, the skipped with their reason, the proposals, and "Desfazer". */
function ArchiveResult(p: {
  result: Archived;
  undone: Undone | null;
  busy: boolean;
  trouble: Trouble | undefined;
  rel: (path: string) => string;
  onReload: () => void;
  onUndo: (manifest: string) => void;
}) {
  const t = useT();
  const { result } = p;
  const proposals = result.proposals;
  const manifest = result.manifest;
  return (
    <section className="wk-block wk-result">
      <p className="wk-prose">{t("weekly.archived", { n: result.moved.length })}</p>
      {result.skipped.length > 0 && (
        <>
          <p className="wk-prose">{t("weekly.skipped", { n: result.skipped.length })}</p>
          <ul className="wk-skips">
            {result.skipped.map((s) => (
              <li key={s.path}>
                <span className="wk-mono">{p.rel(s.path)}</span>
                <span>{t(SKIPS[s.reason])}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {proposals && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() =>
            window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: `doc:${proposals}` }))
          }
        >
          {t("weekly.openProposals")}
        </button>
      )}
      <TroubleLine trouble={p.trouble} onReload={p.onReload} />
      {p.undone ? (
        <p className="wk-prose" role="status">
          <Check aria-hidden />
          {t("weekly.undone", { n: p.undone.restored.length })}
        </p>
      ) : (
        manifest && (
          <div className="wk-acts">
            <button type="button" className="btn" disabled={p.busy} onClick={() => p.onUndo(manifest)}>
              {t("weekly.undo")}
            </button>
          </div>
        )
      )}
    </section>
  );
}
