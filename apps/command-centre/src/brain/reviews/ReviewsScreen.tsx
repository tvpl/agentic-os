/**
 * "Revisões" (.specs/features/cerebro-natureza, S5; design.md "Tela - Revisões"; plan.md amendments 6-10): what fell
 * due, oldest first, and the notes with no nature, in the active work context, each decided in one click over
 * `POST /api/memory/reviews`, with "Desfazer" for 8 s. The same screen is the frame's page at `/brain/reviews` and the
 * Núcleo's brain panel there; it is a chunk of its own, fetched the first time it is opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Archive, BellOff, Check, CircleCheck, Lock, PencilLine } from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { Markdown } from "../../components/Markdown";
import { useToast } from "../../components/ui";
import { useCommands, useRegisteredCommands, type Command } from "../../commands/registry";
import { usePanelSearchParams } from "../../desktop/appRoute";
import { prefersReducedMotion } from "../../hooks/useViewTransition";
import { useLang, useT, type TKey } from "../../i18n";
import { useApiQuery, useInvalidate, useRouteQuery } from "../../queries";
import { DropdownMenu, Tabs } from "../../ui";
import { errorMessage } from "../../views/shared";
import { SWITCH_CONTEXT_ID, useWorkContext } from "../../contexts/useWorkContext";
import { openNoteEditor } from "../noteEvents";
import {
  ESCOPOS,
  FilterRow,
  NATUREZAS,
  NatureBadge,
  ScopeBadge,
  natureName,
  natureOf,
  type Escopo,
  type Natureza,
} from "../natureza";
import { BecameFactDialog, type FactInput } from "./BecameFactDialog";
import "./reviews.css";

type Kind = "due" | "unclassified";
type List = ReturnType<typeof useList>;
export type ReviewItem = NonNullable<List["data"]>["items"][number];
type Decided = { previous: State | null; version?: string; fact?: { id: number } };
type State = { lastReviewed: number | null; snoozeUntil: number | null; never: 0 | 1 };
type Property = { key: string; value: string | string[] };
export type Decision =
  | { action: "keep" | "never" | "abandon" }
  | { action: "snooze"; days: number }
  | { action: "classify"; natureza: Natureza }
  | { action: "became_fact"; fact?: FactInput };

const SNOOZE_DAYS = [7, 14, 30, 90];
const NOTICE_MS = 8_000;
const LEAVE_MS = 150;
const DAY = 86_400_000;

/** The keys of the front matter each decision writes (core/src/memory/reviewDecisions.ts), for "Desfazer". */
function writtenKeys(d: Decision, before: Property[]): string[] {
  if (d.action === "keep") return ["last_reviewed"];
  if (d.action === "never") return ["review_every"];
  if (d.action === "abandon") return ["status", "abandoned"];
  if (d.action === "classify") return ["natureza"];
  if (d.action === "became_fact") {
    const old = before.find((p) => p.key === "natureza")?.value;
    const was = typeof old === "string" && natureOf({ natureza: old }) !== null;
    return ["natureza", ...(was ? ["was"] : []), "became_fact", "last_reviewed"];
  }
  return [];
}

function doneText(t: ReturnType<typeof useT>, d: Decision): string {
  switch (d.action) {
    case "snooze":
      return t("reviews.done.snooze", { n: d.days });
    case "classify":
      return t("reviews.done.classify", { natureza: natureName(t, d.natureza) });
    case "became_fact":
      return t("reviews.done.becameFact");
    case "never":
      return t("reviews.done.never");
    case "abandon":
      return t("reviews.done.abandon");
    default:
      return t("reviews.done.keep");
  }
}

/** A local day `AAAA-MM-DD` as a date at local midnight. */
const dayDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const midnight = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** "4 meses", "12 dias", "2 anos": how long from `from` to now, in the largest whole unit. */
export function ageText(from: Date, lang: string, now = new Date()): string {
  const months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    now.getMonth() -
    from.getMonth() -
    (now.getDate() < from.getDate() ? 1 : 0);
  const [n, unit] =
    months >= 12
      ? [Math.floor(months / 12), "year"]
      : months >= 1
        ? [months, "month"]
        : [Math.max(0, Math.round((midnight(now).getTime() - midnight(from).getTime()) / DAY)), "day"];
  return new Intl.NumberFormat(lang, { style: "unit", unit, unitDisplay: "long" }).format(n);
}

/** The callouts of a note's body (door 2): each nature and its first words, outside fenced code. */
function passagesOf(body: string): Array<{ n: Natureza; text: string }> {
  const out: Array<{ n: Natureza; text: string }> = [];
  let fence = false;
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^>\s*\[!(\w+)\][-+]?\s*(.*)$/.exec(line);
    const n = m?.[1]?.toLowerCase() as Natureza | undefined;
    if (!m || !n || !(NATUREZAS as readonly string[]).includes(n)) return;
    out.push({ n, text: m[2] || (lines[i + 1] ?? "").replace(/^>\s?/, "") });
  });
  return out;
}

function useList(kind: Kind, query: Record<string, string>, enabled: boolean) {
  const q = { kind, ...query };
  return useRouteQuery(["memory", "reviews", kind, q], "GET /api/memory/reviews", { query: q }, { enabled });
}

export default function ReviewsScreen() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const invalidate = useInvalidate();
  const work = useWorkContext();
  const commands = useRegisteredCommands();
  const [params] = usePanelSearchParams();
  const wanted = params.get("path");
  const [tab, setTab] = useState<Kind>("due");
  const [natureza, setNatureza] = useState<Natureza[]>([]);
  const [escopo, setEscopo] = useState<Escopo[]>([]);
  const base: Record<string, string> = {
    ...(work.query ? { context: work.query } : {}),
    ...(escopo.length ? { escopo: escopo.join(",") } : {}),
  };
  // Order of the query as the claims spell it: kind, context, natureza, escopo.
  const due = useList(
    "due",
    {
      ...(work.query ? { context: work.query } : {}),
      ...(natureza.length ? { natureza: natureza.join(",") } : {}),
      ...base,
    },
    work.ready,
  );
  // An unclassified note has no nature: the nature filters do not apply to the tab.
  const unclassified = useList("unclassified", base, work.ready);
  const list = tab === "due" ? due : unclassified;
  const info = useApiQuery<{ home: string }>(["system", "info"], "/api/system/info", { staleTime: 60_000 });

  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<ReadonlySet<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [factOpen, setFactOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: ReactNode; partial?: boolean; act?: () => void } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const items = (list.data?.items ?? []).filter((i) => !gone.has(i.path));
  const left = (l: typeof due) =>
    Math.max(0, (l.data?.total ?? 0) - (l.data?.items ?? []).filter((i) => gone.has(i.path)).length);
  const current =
    items.find((i) => i.path === sel) ??
    (sel === null ? items.find((i) => i.path === wanted) : undefined) ??
    items[0];

  const note = useRouteQuery(
    ["memory", "note", current?.path ?? null],
    "GET /api/memory/note",
    { query: { p: current?.path ?? "" } },
    { enabled: !!current, retry: false },
  );

  useEffect(() => {
    if (focusOn) buttons.current.get(focusOn)?.focus();
  }, [focusOn, items.length]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = useCallback((next: typeof notice, ms?: number) => {
    window.clearTimeout(timer.current);
    setNotice(next);
    if (ms) timer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const select = (path: string, focus = false) => {
    setSel(path);
    if (focus) setFocusOn(path);
  };
  const move = (by: number) => {
    const at = items.findIndex((i) => i.path === current?.path);
    const next = items[Math.min(items.length - 1, Math.max(0, at + by))];
    if (next) select(next.path, true);
  };

  const undo = async (
    item: ReviewItem,
    d: Decision,
    res: Decided,
    before: Property[],
    steps: Array<"props" | "retract" | "restore">,
  ) => {
    const failed: typeof steps = [];
    for (const step of steps) {
      try {
        if (step === "props") {
          const set: Record<string, string | string[]> = {};
          const remove: string[] = [];
          for (const key of writtenKeys(d, before)) {
            const old = before.find((p) => p.key === key);
            if (old) set[key] = old.value;
            else remove.push(key);
          }
          await apiCall("PUT /api/memory/notes/properties", {
            body: {
              path: item.path,
              baseVersion: res.version!,
              ...(Object.keys(set).length ? { set } : {}),
              ...(remove.length ? { remove } : {}),
            },
          });
        } else if (step === "retract") {
          await apiCall("POST /api/memory/facts/:id/retract", { params: { id: res.fact!.id } });
        } else {
          await apiCall("POST /api/memory/reviews", {
            body: { path: item.path, action: "restore", state: res.previous },
          });
        }
      } catch {
        failed.push(step);
      }
    }
    if (failed.length > 0) {
      show({
        text: t("reviews.undoPartial"),
        partial: true,
        act: () => void undo(item, d, res, before, failed),
      });
      return;
    }
    show(null);
    setGone((g) => new Set([...g].filter((p) => p !== item.path)));
    setLeaving((g) => new Set([...g].filter((p) => p !== item.path)));
    select(item.path, true);
    void invalidate(["memory", "note", item.path], ["memory", "reviews"]);
  };

  /** One decision on `item`; a failure is thrown back to the dialog when it asked, a toast otherwise. */
  const decide = async (item: ReviewItem, d: Decision, fromDialog = false) => {
    const written = item.editable && d.action !== "snooze";
    // The version the write is guarded by: the note as it was read (read now, if it was not yet).
    const read = written ? (note.data ?? (await note.refetch()).data) : undefined;
    if (written && !read) return void toast(t("reviews.conflict"), "danger");
    const before = read ? (read.properties as Property[]) : [];
    const { fact, ...rest } = d.action === "became_fact" ? d : { ...d, fact: undefined };
    let res: Decided;
    try {
      res = await apiCall("POST /api/memory/reviews", {
        body: {
          path: item.path,
          ...rest,
          ...(read ? { baseVersion: read.version } : {}),
          ...(fact ? { fact } : {}),
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "edit_conflict") {
        setConflict((c) => new Set(c).add(item.path));
        if (fromDialog) setFactOpen(false);
        return;
      }
      if (fromDialog) throw err;
      toast(errorMessage(err, t), "danger");
      return;
    }
    setFactOpen(false);
    void invalidate(["memory", "note", item.path], ["memory", "reviews", "count"]);
    const at = items.findIndex((i) => i.path === item.path);
    const next = items[at + 1] ?? items[at - 1];
    if (next) select(next.path, true);
    const steps: Array<"props" | "retract" | "restore"> = res.version
      ? ["props", ...(res.fact ? (["retract"] as const) : [])]
      : ["restore"];
    show(
      {
        text: doneText(t, d),
        act: () => void undo(item, d, res, before, steps),
      },
      NOTICE_MS,
    );
    if (prefersReducedMotion()) setGone((g) => new Set(g).add(item.path));
    else {
      setLeaving((g) => new Set(g).add(item.path));
      window.setTimeout(() => setGone((g) => new Set(g).add(item.path)), LEAVE_MS);
    }
  };

  const reload = (path: string) => {
    setConflict((c) => new Set([...c].filter((p) => p !== path)));
    void list.refetch();
    void invalidate(["memory", "note", path]);
  };

  // The list's keys (design.md binding `comandos-atalhos`): j/k move, v is "Ainda vale", a opens "Adiar".
  const live = useRef({ move, decide, current, tab });
  live.current = { move, decide, current, tab };
  useCommands(
    useMemo<Command[]>(
      () => [
        {
          id: "reviews.next",
          title: "reviews.cmd.next",
          group: "view",
          scope: "view:reviews",
          keys: ["j"],
          run: () => live.current.move(1),
        },
        {
          id: "reviews.prev",
          title: "reviews.cmd.prev",
          group: "view",
          scope: "view:reviews",
          keys: ["k"],
          run: () => live.current.move(-1),
        },
        {
          id: "reviews.keep",
          title: "reviews.keep",
          group: "view",
          scope: "view:reviews",
          keys: ["v"],
          when: () => live.current.tab === "due" && !!live.current.current,
          run: () => void live.current.decide(live.current.current!, { action: "keep" }),
        },
        {
          id: "reviews.snooze",
          title: "reviews.snooze",
          group: "view",
          scope: "view:reviews",
          keys: ["a"],
          when: () => live.current.tab === "due" && !!live.current.current,
          run: () => setSnoozeOpen(true),
        },
      ],
      [],
    ),
  );

  const home = info.data?.home;
  const rel = (p: string) => (home && p.startsWith(`${home}/`) ? p.slice(home.length + 1) : p);
  const age = (i: ReviewItem) =>
    i.lastReviewed
      ? t("reviews.age.reviewed", { age: ageText(dayDate(i.lastReviewed), lang) })
      : t("reviews.age.never", { age: ageText(new Date(i.mtime), lang) });
  const nextIn = list.data?.nextDue
    ? Math.round((dayDate(list.data.nextDue).getTime() - midnight(new Date()).getTime()) / DAY)
    : null;

  const body = (() => {
    if (list.isPending)
      return (
        <p className="rv-state">
          <span className="spinner" aria-hidden />
          {t("common.loading")}
        </p>
      );
    if (list.isError)
      return (
        <div className="rv-state" role="alert">
          <AlertTriangle aria-hidden />
          <span>{errorMessage(list.error, t)}</span>
          <button type="button" className="btn sm" onClick={() => void list.refetch()}>
            {t("common.retry")}
          </button>
        </div>
      );
    if (items.length === 0)
      return (
        <div className="rv-empty">
          <CircleCheck aria-hidden size={32} />
          <p className="rv-prose">{t("reviews.empty")}</p>
          {nextIn !== null && <p className="rv-next">{t("reviews.next", { n: nextIn })}</p>}
        </div>
      );
    return (
      <div className="rv-body">
        <ul className="rv-list" aria-label={t("reviews.title")}>
          {items.map((i) => (
            <ReviewListItem
              key={i.path}
              item={i}
              selected={i.path === current?.path}
              leaving={leaving.has(i.path)}
              path={rel(i.path)}
              age={age(i)}
              conflict={conflict.has(i.path)}
              buttonRef={(el) => void (el ? buttons.current.set(i.path, el) : buttons.current.delete(i.path))}
              onSelect={() => select(i.path)}
              onReload={() => reload(i.path)}
            />
          ))}
        </ul>
        {current && (
          <Detail
            key={current.path}
            item={current}
            kind={tab}
            content={note.data ? note.data.content.slice(note.data.bodyStart) : null}
            snoozeOpen={snoozeOpen}
            onSnoozeOpen={setSnoozeOpen}
            onDecide={(d) => void decide(current, d)}
            onFact={() => setFactOpen(true)}
          />
        )}
      </div>
    );
  })();

  const name = work.active ? work.active.name : t("context.all");
  return (
    <section className="rv" aria-labelledby="rv-title">
      <header className="rv-head">
        <h1 id="rv-title" className="rv-title">
          {t("reviews.title")}
        </h1>
        <div className="rv-tools">
          <FilterRow
            label={t("reviews.filter.nature")}
            values={NATUREZAS}
            chosen={natureza}
            onChange={setNatureza}
          />
          <FilterRow
            label={t("reviews.filter.scope")}
            values={ESCOPOS}
            chosen={escopo}
            onChange={setEscopo}
          />
          <button
            type="button"
            className="rv-context"
            onClick={() => commands.find((c) => c.id === SWITCH_CONTEXT_ID)?.run()}
          >
            {t("reviews.context", { name })}
          </button>
        </div>
      </header>
      <Tabs
        tabs={[
          { id: "due", label: t("reviews.tab.due", { n: left(due) }) },
          { id: "unclassified", label: t("reviews.tab.unclassified", { n: left(unclassified) }) },
        ]}
        active={tab}
        onChange={(id) => setTab(id as Kind)}
        ariaLabel={t("reviews.title")}
        panelClassName="rv-panel"
      >
        <p className="rv-status" role="status">
          {list.data ? t("reviews.notification", { n: left(list) }) : ""}
        </p>
        {body}
      </Tabs>
      {notice && (
        <div className="rv-notice" role="status">
          {notice.partial ? <AlertTriangle aria-hidden /> : <Check aria-hidden />}
          <span>{notice.text}</span>
          {notice.act && (
            <button type="button" className="btn sm" onClick={notice.act}>
              {t(notice.partial ? "common.retry" : "reviews.undo")}
            </button>
          )}
        </div>
      )}
      {factOpen && current && (
        <BecameFactDialog
          onCancel={() => setFactOpen(false)}
          onConfirm={(fact) => decide(current, { action: "became_fact", ...(fact ? { fact } : {}) }, true)}
        />
      )}
    </section>
  );
}

/** One item of the list (C73): line 1 the name and the nature badge, line 2 the path, the age and the scope badge. */
export function ReviewListItem(p: {
  item: ReviewItem;
  selected: boolean;
  leaving?: boolean;
  path: string;
  age: string;
  conflict?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onReload?: () => void;
}) {
  const t = useT();
  const { item } = p;
  return (
    <li className="rv-item" data-leaving={p.leaving ? "" : undefined}>
      <button
        type="button"
        className="rv-pick"
        aria-current={p.selected ? "true" : undefined}
        ref={p.buttonRef}
        onClick={p.onSelect}
      >
        <span className="rv-line1">
          <span className="rv-name">{item.name}</span>
          <NatureBadge n={item.natureza as Natureza | null} />
        </span>
        <span className="rv-line2">
          <span className="rv-path">{p.path}</span>
          <span className="rv-age">{p.age}</span>
          {item.escopo && <ScopeBadge s={item.escopo as Escopo} />}
        </span>
      </button>
      {p.conflict && (
        <div className="rv-conflict" role="alert">
          <AlertTriangle aria-hidden />
          <span>{t("reviews.conflict")}</span>
          <button type="button" className="btn sm" onClick={p.onReload}>
            {t("reviews.reload")}
          </button>
        </div>
      )}
    </li>
  );
}

const act = (key: TKey, icon: ReactNode, className: string, run: () => void, t: ReturnType<typeof useT>) => (
  <button key={key} type="button" className={className} onClick={run}>
    {icon}
    {t(key)}
  </button>
);

/** The chosen item: the start of the note, its passages, and the decisions it can take (C75, C85). */
export function Detail({
  item,
  kind,
  content,
  snoozeOpen,
  onSnoozeOpen,
  onDecide,
  onFact,
}: {
  item: ReviewItem;
  kind: Kind;
  content: string | null;
  snoozeOpen: boolean;
  onSnoozeOpen: (open: boolean) => void;
  onDecide: (d: Decision) => void;
  onFact: () => void;
}) {
  const t = useT();
  const n = item.natureza as Natureza | null;
  const passages = content ? passagesOf(content) : [];
  const snooze = (
    <DropdownMenu
      key="snooze"
      open={snoozeOpen}
      onOpenChange={onSnoozeOpen}
      align="start"
      trigger={
        <button type="button" className="btn">
          {t("reviews.snooze")}
        </button>
      }
      items={SNOOZE_DAYS.map((days) => ({
        id: String(days),
        label: t("reviews.snooze.days", { n: days }),
        onSelect: () => onDecide({ action: "snooze", days }),
      }))}
    />
  );
  const keep = act(
    "reviews.keep",
    <Check aria-hidden />,
    "btn primary",
    () => onDecide({ action: "keep" }),
    t,
  );
  const never = act(
    "reviews.never",
    <BellOff aria-hidden />,
    "btn ghost",
    () => onDecide({ action: "never" }),
    t,
  );
  const acts =
    kind === "unclassified"
      ? null
      : item.editable
        ? [
            keep,
            act(
              "reviews.update",
              <PencilLine aria-hidden />,
              "btn",
              () => openNoteEditor({ mode: "edit", path: item.path }),
              t,
            ),
            ...(n === "plano" || n === "hipotese"
              ? [act("reviews.becameFact", <CircleCheck aria-hidden />, "btn", onFact, t)]
              : []),
            act("reviews.abandon", <Archive aria-hidden />, "btn", () => onDecide({ action: "abandon" }), t),
            snooze,
            never,
          ]
        : [keep, snooze, never];
  const suggested = (item.suggested ?? null) as Natureza | null;
  return (
    <div className="rv-detail">
      <h2 className="rv-detail-name">{item.name}</h2>
      {content !== null && <Markdown source={content.slice(0, 600)} shape="page" className="rv-excerpt" />}
      {passages.length > 0 && (
        <ul className="rv-passages">
          {passages.map((p, i) => (
            <li key={i}>
              <NatureBadge n={p.n} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      {acts && !item.editable && (
        <p className="rv-readonly">
          <Lock aria-hidden />
          {t("reviews.readonly")}
        </p>
      )}
      {acts && <div className="rv-acts">{acts}</div>}
      {kind === "unclassified" && (
        <div className="rv-classify">
          {suggested ? (
            <p className="rv-suggest">
              <NatureBadge
                n={suggested}
                label={t("reviews.suggestion", { natureza: natureName(t, suggested) })}
              />
              <button
                type="button"
                className="btn primary sm"
                onClick={() => onDecide({ action: "classify", natureza: suggested })}
              >
                {t("reviews.confirm")}
              </button>
            </p>
          ) : (
            <p className="rv-suggest">{t("reviews.noSuggestion")}</p>
          )}
          <div className="rv-natures">
            {NATUREZAS.map((v) => (
              <button
                key={v}
                type="button"
                className="nb-filter"
                onClick={() => onDecide({ action: "classify", natureza: v })}
              >
                <NatureBadge n={v} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => onDecide({ action: "snooze", days: 90 })}
          >
            {t("reviews.noClassify")}
          </button>
        </div>
      )}
    </div>
  );
}
