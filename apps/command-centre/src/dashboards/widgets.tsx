/**
 * The eight widgets of a dashboard and their states (.specs/features/cerebro-paineis, design.md "Widgets" and AC 34 to
 * AC 39): a card with its title, its counter and its body; the stat tile of a KPI; the highlights row. Every state
 * shows an icon and a text, never a colour alone. An item from a note opens `/brain?sel=<fileId>` (amendment 18), a
 * connector's item its `href` outside the app; a task of a note under `memory/` is checked in place (amendment 17).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronsUp,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Clock,
  Eye,
  Flag,
  Inbox,
  Loader,
  Lock,
  Pause,
  Plug,
  RotateCcw,
  Sparkles,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import type { SourceKind } from "@mordomo/contracts";
import { ApiError } from "../api";
import { apiCall } from "../apiCall";
import { Markdown } from "../components/Markdown";
import { Badge, type BadgeTone } from "../components/primitives";
import { prefersReducedMotion } from "../hooks/useViewTransition";
import { useLocale, useT, type TKey } from "../i18n";
import { Switch } from "../ui";
import { NatureBadge, type Natureza } from "../brain/natureza";
import { Bars, ChartOrTable, Sparkline, type BarDatum, type ChartPoint } from "./charts";
import {
  compactNumber,
  daysBetween,
  hhmm,
  localDay,
  num,
  rows,
  shortDate,
  text,
  type DefWidget,
  type Highlight,
  type Row,
  type SnapSource,
  type SnapWidget,
} from "./dashboardsData";

/** What every widget is handed by the screen. */
export interface WidgetEnv {
  now: number;
  memoryRoot: string | null;
  sources: readonly SnapSource[];
  open: (target: string) => void;
  retry: () => void;
}

type T = ReturnType<typeof useT>;

/* ---- badges --------------------------------------------------------------------------------------------------- */

/** The state badge of a list row (design.md `list`), with its icon, text and tone. */
const STATES: Record<string, [LucideIcon, TKey, BadgeTone]> = {
  decided: [Check, "dash.state.decided", "ok"],
  open: [CircleDot, "dash.state.open", "warn"],
  on_track: [CircleCheck, "dash.state.onTrack", "ok"],
  behind: [AlertTriangle, "dash.state.behind", "danger"],
  due_today: [Clock, "dash.state.dueToday", "warn"],
  in_review: [Eye, "dash.state.inReview", "info"],
  paused: [Pause, "dash.state.paused", "dim"],
  running: [Loader, "dash.state.running", "info"],
};

export function StateBadge({ state }: { state: string }) {
  const t = useT();
  const known = STATES[state];
  if (!known) return <Badge kind="meta">{t(`status.${state}` as TKey)}</Badge>;
  const [Icon, key, tone] = known;
  return (
    <Badge kind="state" tone={tone} className="dsh-state" title={undefined}>
      <Icon aria-hidden className={state === "running" ? "dsh-spin" : undefined} />
      {t(key)}
    </Badge>
  );
}

/** A nature that is not yet a fact, which a row shows as C6's badge and never as "Decidido" (AC 38, amendment 22). */
const NOT_A_FACT: readonly string[] = ["plano", "hipotese", "opiniao"];
const natureOf = (item: Row): Natureza | null =>
  typeof item.natureza === "string" && NOT_A_FACT.includes(item.natureza)
    ? (item.natureza as Natureza)
    : null;

/* ---- the states of a widget (AC 34, AC 35) -------------------------------------------------------------------- */

export function sourceIdOf(def: DefWidget | undefined): string {
  if (!def) return "question";
  return def.source.kind === "connector" ? `connector:${def.source.id}` : def.source.kind;
}

const CONTEXT_GONE = "O contexto deste painel não existe mais.";

function WidgetError({ snap, def, env }: { snap: SnapWidget; def: DefWidget | undefined; env: WidgetEnv }) {
  const t = useT();
  const source = env.sources.find((s) => s.id === sourceIdOf(def));
  const data = (snap.data ?? {}) as Row;
  if (source?.status === "unavailable")
    return (
      <div className="dsh-state-msg">
        <CircleSlash aria-hidden />
        <span className="dsh-state-text">{t("dash.widget.unavailable")}</span>
      </div>
    );
  if (source?.status === "not_configured") {
    const connector = (data.connector ?? {}) as Row;
    const id = text(connector.id) ?? (def?.source.kind === "connector" ? def.source.id : "");
    const name = text(connector.name) ?? id;
    return (
      <div className="dsh-state-msg">
        <Plug aria-hidden />
        <span className="dsh-state-text">{t("dash.widget.notConfigured", { connector: name })}</span>
        <Link className="dsh-link" to={`/connectors#${id}`}>
          {name}
        </Link>
      </div>
    );
  }
  const message =
    snap.error === CONTEXT_GONE ? t("dash.context.gone") : (snap.error ?? t("dash.widget.error"));
  return (
    <div className="dsh-state-msg" role="alert">
      <AlertTriangle aria-hidden />
      <span className="dsh-state-text">
        {t("dash.widget.error")} {message}
      </span>
      <button type="button" className="btn sm" onClick={env.retry}>
        {t("dash.widget.retry")}
      </button>
    </div>
  );
}

const EMPTY_BY_SOURCE: Record<SourceKind, TKey> = {
  notes: "dash.empty.notes",
  tasks: "dash.empty.tasks",
  decisions: "dash.empty.decisions",
  openLoops: "dash.empty.openLoops",
  projects: "dash.empty.projects",
  reviews: "dash.empty.reviews",
  facts: "dash.empty.facts",
  runs: "dash.empty.runs",
  approvals: "dash.empty.approvals",
  metrics: "dash.empty.table",
  connector: "dash.empty.connector",
};

function EmptyText({ def, kind, data }: { def: DefWidget | undefined; kind: string; data: Row }) {
  const t = useT();
  const [help, setHelp] = useState(false);
  if (kind === "checklist")
    return (
      <div className="dsh-empty-box">
        <p className="dsh-empty">
          <Inbox aria-hidden />
          {t("dash.empty.tasks")}
        </p>
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={help}
          onClick={() => setHelp((h) => !h)}
        >
          {t("dash.task.howto")}
        </button>
        {help && (
          <p className="dsh-empty">
            <code>- [ ] … 📅 2026-10-30</code> · <code>- [ ] … [due:: 2026-10-30]</code>
          </p>
        )}
      </div>
    );
  const key: TKey =
    kind === "table"
      ? "dash.empty.table"
      : kind === "bars"
        ? "dash.empty.bars"
        : kind === "agenda"
          ? "dash.empty.agenda"
          : kind === "note"
            ? "dash.empty.note"
            : def
              ? EMPTY_BY_SOURCE[def.source.kind]
              : "dash.empty.table";
  const connector =
    text((data.connector as Row | undefined)?.name) ??
    (def?.source.kind === "connector" ? def.source.id : "");
  return (
    <p className="dsh-empty">
      <Inbox aria-hidden />
      {t(key, { connector })}
    </p>
  );
}

/* ---- list rows ---------------------------------------------------------------------------------------------- */

interface ListRow {
  title: string;
  subtitle: string | null;
  state: string | null;
  natureza: Natureza | null;
  fileId: number | null;
  href: string | null;
  target: string | null;
}

/** What a row of a list shows, read from the item its source gives (core/src/dashboards/sources.ts). */
export function listRow(item: Row, source: SourceKind | null, t: T, locale: string): ListRow {
  const day = (v: unknown) =>
    text(v) && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? shortDate(String(v), locale) : null;
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null;
  const fileId = num(item.fileId);
  const href = text(item.href);
  const base = {
    natureza: natureOf(item),
    fileId,
    href,
    target: null as string | null,
    state: null as string | null,
  };
  switch (source) {
    case "decisions":
      return {
        ...base,
        title: text(item.text) ?? "",
        subtitle: join(day(item.day), text(item.title)),
        state: text(item.state),
      };
    case "projects": {
      const health = text(item.health);
      return {
        ...base,
        title: text(item.title) ?? "",
        subtitle: day(item.due),
        state: health === "done" ? null : health,
      };
    }
    case "runs": {
      const ms = num(item.durationMs);
      const state = text(item.state);
      return {
        ...base,
        title: text(item.skill) ?? text(item.id) ?? "",
        subtitle: ms !== null ? `${Math.max(1, Math.round(ms / 1000))} s` : null,
        state,
        target: text(item.id) ? `/runs/${String(item.id)}` : null,
      };
    }
    case "approvals":
      return {
        ...base,
        title: text(item.description) ?? "",
        subtitle:
          num(item.createdAt) !== null
            ? `${shortDate(localDay(num(item.createdAt)!), locale)} ${hhmm(num(item.createdAt)!)}`
            : null,
      };
    case "reviews":
      return {
        ...base,
        title: text(item.name) ?? text(item.path) ?? "",
        subtitle: day(item.dueSince),
        target: text(item.path) ? `/brain/reviews?path=${encodeURIComponent(String(item.path))}` : null,
      };
    case "facts":
      return {
        ...base,
        title: [item.subject, item.predicate, item.object].map(text).filter(Boolean).join(" "),
        subtitle: day(item.validFrom),
      };
    case "notes":
      return { ...base, title: text(item.title) ?? "", subtitle: join(day(item.updated), text(item.status)) };
    case "openLoops":
      return { ...base, title: text(item.text) ?? "", subtitle: day(item.day) };
    default:
      return {
        ...base,
        title: text(item.title) ?? text(item.text) ?? text(item.name) ?? "",
        subtitle: text(item.subtitle),
        state: text(item.state) ?? text(item.health),
      };
  }
}

/** The title of a row: a button when it opens something, plain text otherwise (a connector item with no `href`). */
function RowTitle({ row, env, className }: { row: ListRow; env: WidgetEnv; className: string }) {
  const target = row.fileId !== null ? `/brain?sel=${row.fileId}` : (row.href ?? row.target);
  if (target === null) return <span className={className}>{row.title}</span>;
  return (
    <button type="button" className={`${className} dsh-open`} onClick={() => env.open(target)}>
      {row.title}
    </button>
  );
}

function ListBody({ items, source, env }: { items: Row[]; source: SourceKind | null; env: WidgetEnv }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ul className="dsh-list">
      {items.map((item, i) => {
        const row = listRow(item, source, t, locale);
        // A plan, a hypothesis or an opinion is never "Decidido" (AC 38).
        const state = row.natureza !== null && row.state === "decided" ? null : row.state;
        return (
          <li key={i} className="dsh-row">
            <div className="dsh-row-main">
              <RowTitle row={row} env={env} className="dsh-row-t" />
              {row.subtitle && <span className="dsh-row-meta">{row.subtitle}</span>}
            </div>
            <div className="dsh-row-badges">
              {row.natureza && <NatureBadge n={row.natureza} />}
              {state && <StateBadge state={state} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- checklist (AC 48, AC 49, amendment 17) ------------------------------------------------------------------ */

const GENERATED = /^(ROUTER\.md$|areas\/|journal\/|contexts\/)/;

/** Whether a task's box can be checked here, and why not. */
export function taskLock(path: string, memoryRoot: string | null): "outside" | "generated" | null {
  if (memoryRoot === null || !path.startsWith(`${memoryRoot}/`)) return "outside";
  return GENERATED.test(path.slice(memoryRoot.length + 1)) ? "generated" : null;
}

function DueBadge({ due, now }: { due: string; now: number }) {
  const t = useT();
  const locale = useLocale();
  const n = daysBetween(due, localDay(now));
  if (n > 0)
    return (
      <Badge kind="state" tone="danger" className="dsh-due">
        <AlertTriangle aria-hidden />
        {t("dash.task.overdue", { n })}
      </Badge>
    );
  if (n === 0)
    return (
      <Badge kind="state" tone="warn" className="dsh-due">
        <Clock aria-hidden />
        {t("dash.task.today")}
      </Badge>
    );
  if (n === -1)
    return (
      <Badge kind="state" tone="info" className="dsh-due">
        <CalendarDays aria-hidden />
        {t("dash.task.tomorrow")}
      </Badge>
    );
  return (
    <Badge kind="meta" className="dsh-due">
      <CalendarDays aria-hidden />
      {shortDate(due, locale)}
    </Badge>
  );
}

function TaskRow({ item, env }: { item: Row; env: WidgetEnv }) {
  const t = useT();
  const path = text(item.path);
  const line = num(item.line);
  const [done, setDone] = useState(item.done === true);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = path === null || line === null ? "outside" : taskLock(path, env.memoryRoot);
  const reason =
    lock === "outside"
      ? t("dash.task.readonly")
      : lock === "generated"
        ? t("notes.lock.generated")
        : undefined;
  const toggle = async (next: boolean) => {
    if (path === null || line === null) return;
    setDone(next);
    setConflict(false);
    setBusy(true);
    try {
      const note = await apiCall("GET /api/memory/note", { query: { p: path } });
      await apiCall("PUT /api/memory/tasks", { body: { path, line, done: next, baseVersion: note.version } });
    } catch (err) {
      setDone(!next);
      setConflict(err instanceof ApiError && err.code === "edit_conflict");
    } finally {
      setBusy(false);
    }
  };
  const due = text(item.due);
  const row: ListRow = {
    title: text(item.text) ?? "",
    subtitle: null,
    state: null,
    natureza: natureOf(item),
    fileId: num(item.fileId),
    href: null,
    target: null,
  };
  return (
    <li className="dsh-task" data-done={done ? "" : undefined}>
      <label className="dsh-box" title={reason}>
        <input
          type="checkbox"
          checked={done}
          disabled={lock !== null || busy}
          title={reason}
          aria-label={row.title}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {lock !== null && <Lock aria-hidden className="dsh-lock" />}
      </label>
      {num(item.priority) !== null && num(item.priority)! >= 2 && (
        <ChevronsUp aria-hidden className="dsh-prio" />
      )}
      <RowTitle row={row} env={env} className="dsh-task-t" />
      {text(item.title) && <span className="dsh-task-from">{text(item.title)}</span>}
      {due && /^\d{4}-\d{2}-\d{2}$/.test(due) && <DueBadge due={due} now={env.now} />}
      {conflict && (
        <p className="dsh-task-msg" role="alert">
          {t("dash.task.conflict")}
        </p>
      )}
    </li>
  );
}

/* ---- table, bars, agenda, note ----------------------------------------------------------------------------- */

const TABLE_MAX = 20;

function TableBody({
  data,
  source,
  title,
  env,
}: {
  data: Row;
  source: SourceKind | null;
  title: string;
  env: WidgetEnv;
}) {
  const t = useT();
  const locale = useLocale();
  const given = Array.isArray(data.columns);
  const columns = given ? (data.columns as unknown[]).map((c) => String(c)) : [title];
  const all = given
    ? rows(data.rows).map((r) => ({
        cells: Array.isArray(r.cells) ? (r.cells as unknown[]) : [],
        state: text(r.state),
        natureza: natureOf(r),
      }))
    : rows(data.items).map((item) => {
        const row = listRow(item, source, t, locale);
        return { cells: [row.title], state: row.state, natureza: row.natureza };
      });
  const withBadges = all.some((r) => r.state !== null || r.natureza !== null);
  const total = num(data.total) ?? all.length;
  const origin =
    source === "runs" ? "/runs" : source === "connector" ? "/connectors" : source ? "/brain" : null;
  return (
    <>
      <table className="dsh-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
            {withBadges && <th scope="col" aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {all.slice(0, TABLE_MAX).map((r, i) => (
            <tr key={i}>
              {r.cells.map((c, j) =>
                typeof c === "number" ? (
                  <td key={j} className="dsh-num">
                    {compactNumber(c, locale)}
                  </td>
                ) : (
                  <td key={j}>{text(c) ?? ""}</td>
                ),
              )}
              {withBadges && (
                <td className="dsh-table-badges">
                  {r.natureza && <NatureBadge n={r.natureza} />}
                  {r.state && !(r.natureza && r.state === "decided") && <StateBadge state={r.state} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {total > TABLE_MAX &&
        (origin ? (
          <button type="button" className="btn ghost sm dsh-seeall" onClick={() => env.open(origin)}>
            {t("dash.seeAll", { n: total })}
          </button>
        ) : (
          <span className="dsh-seeall">{t("dash.seeAll", { n: total })}</span>
        ))}
    </>
  );
}

/** The bars of a widget, with the conversion of each step when it is an ordered funnel. */
export function barData(data: Row, funnel: boolean, locale: string): BarDatum[] {
  const cats = rows(data.categories).map((c) => ({ label: text(c.label) ?? "—", count: num(c.count) ?? 0 }));
  return cats.map((c, i) => ({
    ...c,
    conversion:
      funnel && i > 0 && cats[i - 1]!.count > 0
        ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format((c.count / cats[i - 1]!.count) * 100)}%`
        : null,
  }));
}

const HOUR = 3_600_000;

/** Which event is now and which are past (design.md `agenda`): the last one begun, until the next begins. */
export function agendaMarks(items: Row[], now: number): Array<"past" | "now" | "next"> {
  const times = items.map((i) => num(i.ts));
  return times.map((ts, i) => {
    if (ts === null || ts > now) return "next";
    const later = times.slice(i + 1).find((x): x is number => x !== null);
    const ends = later ?? ts + HOUR;
    return now < ends ? "now" : "past";
  });
}

function AgendaBody({ items, env }: { items: Row[]; env: WidgetEnv }) {
  const sorted = [...items].sort((a, b) => (num(a.ts) ?? Infinity) - (num(b.ts) ?? Infinity));
  const marks = agendaMarks(sorted, env.now);
  return (
    <ol className="dsh-agenda">
      {sorted.map((item, i) => {
        const ts = num(item.ts);
        const row: ListRow = {
          title: text(item.title) ?? "",
          subtitle: null,
          state: null,
          natureza: null,
          fileId: num(item.fileId),
          href: text(item.href),
          target: null,
        };
        return (
          <li key={i} className={`dsh-event ${marks[i]}`} data-mark={marks[i]}>
            <span className="dsh-event-time dsh-num">{ts !== null ? hhmm(ts) : ""}</span>
            <RowTitle row={row} env={env} className="dsh-event-t" />
            {text(item.subtitle) && (
              <span className="dsh-event-prep">
                <CalendarDays aria-hidden />
                {text(item.subtitle)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const NOTE_LINES = 12;

function NoteBody({ data, env }: { data: Row; env: WidgetEnv }) {
  const t = useT();
  const locale = useLocale();
  const runId = text(data.runId);
  if (runId !== null) {
    const at = num(data.finishedAt);
    const date =
      at !== null
        ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(at)
        : runId;
    return (
      <p className="dsh-note-text">
        <Link className="dsh-link" to={`/runs/${runId}`}>
          {date}
        </Link>
      </p>
    );
  }
  const source = text(data.text) ?? text(data.excerpt) ?? "";
  const fileId = num(data.fileId) ?? num(rows(data.items)[0]?.fileId);
  if (source.trim() === "")
    return (
      <p className="dsh-empty">
        <Inbox aria-hidden />
        {t("dash.empty.note")}
      </p>
    );
  return (
    <div className="dsh-note">
      <Markdown source={source.split("\n").slice(0, NOTE_LINES).join("\n")} shape="page" className="dsh-md" />
      {fileId !== null && (
        <button type="button" className="btn ghost sm" onClick={() => env.open(`/brain?sel=${fileId}`)}>
          {t("dash.openNote")}
        </button>
      )}
    </div>
  );
}

/* ---- the card ----------------------------------------------------------------------------------------------- */

/** The title a widget is shown by: its definition's, the answer's (a question), or the runs' own. */
export function widgetTitle(def: DefWidget | undefined, snap: SnapWidget | undefined, t: T): string {
  const data = (snap?.data ?? {}) as Row;
  return def?.title ?? text(data.title) ?? (snap?.kind === "list" ? t("dash.agents") : "");
}

function Citations({ data, env }: { data: Row; env: WidgetEnv }) {
  const t = useT();
  const cites = rows(data.citations);
  if (cites.length === 0) return null;
  return (
    <div className="dsh-cites">
      <span className="dsh-cites-t">{t("dash.question.sources")}</span>
      <ul>
        {cites.map((c, i) => {
          const label = `${text(c.name) ?? text(c.path) ?? ""} § ${text(c.section) ?? ""}`;
          const fileId = num(c.fileId);
          return (
            <li key={i}>
              {fileId !== null ? (
                <button
                  type="button"
                  className="dsh-open dsh-cite"
                  onClick={() => env.open(`/brain?sel=${fileId}`)}
                >
                  {label}
                </button>
              ) : (
                <span className="dsh-cite">{label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WidgetCard({
  def,
  snap,
  env,
  as = "section",
}: {
  def: DefWidget | undefined;
  snap: SnapWidget | undefined;
  env: WidgetEnv;
  as?: "section" | "article";
}) {
  const t = useT();
  const locale = useLocale();
  const [asTable, setAsTable] = useState(false);
  const kind = def?.kind ?? snap?.kind ?? "list";
  const id = def?.id ?? snap?.id ?? "";
  const data = (snap?.data ?? {}) as Row;
  const title = widgetTitle(def, snap, t);
  const source = def ? def.source.kind : null;
  const funnel = Boolean(def?.options?.ordered && def.options.funnel);
  const bars = kind === "bars" && snap?.status === "ok" ? barData(data, funnel, locale) : [];
  const total = num(data.total);
  let body: ReactNode;
  if (!snap) body = <div className="dsh-skel" aria-hidden />;
  else if (snap.status === "error") body = <WidgetError snap={snap} def={def} env={env} />;
  else if (snap.status === "empty") body = <EmptyText def={def} kind={kind} data={data} />;
  else if (kind === "checklist")
    body = (
      <ul className="dsh-tasks">
        {rows(data.items).map((item, i) => (
          <TaskRow key={`${text(item.path)}:${num(item.line)}:${i}`} item={item} env={env} />
        ))}
      </ul>
    );
  else if (kind === "table") body = <TableBody data={data} source={source} title={title} env={env} />;
  else if (kind === "bars") {
    const points: ChartPoint[] = bars.map((b) => ({ label: b.label, value: compactNumber(b.count, locale) }));
    body = (
      <ChartOrTable asTable={asTable} points={points} caption={title}>
        <Bars data={bars} funnel={funnel} label={title} format={(n) => compactNumber(n, locale)} />
      </ChartOrTable>
    );
  } else if (kind === "agenda") body = <AgendaBody items={rows(data.items)} env={env} />;
  else if (kind === "note") body = <NoteBody data={data} env={env} />;
  else body = <ListBody items={rows(data.items)} source={source} env={env} />;
  const Tag = as;
  const size = def?.options?.size ?? (kind === "agenda" ? "l" : "m");
  const titleId = `dsh-w-${id}`;
  return (
    <Tag className="dsh-card" data-widget={id} data-kind={kind} data-size={size} aria-labelledby={titleId}>
      <header className="dsh-card-head">
        <h3 className="dsh-card-t" id={titleId}>
          {snap?.id === "como-foi-feita" ? t("dash.question.how") : title}
        </h3>
        {total !== null && snap?.status === "ok" && <span className="dsh-count dsh-num">{total}</span>}
        {kind === "bars" && snap?.status === "ok" && (
          <Switch checked={asTable} onCheckedChange={setAsTable} className="dsh-astable">
            {t("dash.widget.asTable")}
          </Switch>
        )}
      </header>
      <div className="dsh-card-b">{body}</div>
      <Citations data={data} env={env} />
    </Tag>
  );
}

/* ---- the KPI tile (AC 26 to AC 29, amendment 14) ------------------------------------------------------------ */

const PERIOD_MS = { day: 24 * HOUR, week: 7 * 24 * HOUR } as const;

/** The number on the tile counts from the old value to the new one in 400 ms, only when motion is not reduced. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || prefersReducedMotion()) {
      from.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (at: number) => {
      const k = Math.min(1, (at - began) / 400);
      setShown(start + (target - start) * k);
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target]);
  return shown;
}

/** "↑ 15% na semana" for a week with a base, the signed difference otherwise ("−1 hoje"). */
export function deltaText(data: Row, period: "day" | "week", t: T, locale: string): string {
  const delta = num(data.delta) ?? 0;
  const pct = num(data.deltaPct);
  const f = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const d =
    period === "week" && pct !== null
      ? `${pct > 0 ? "↑" : pct < 0 ? "↓" : "→"} ${f(Math.abs(pct))}%`
      : delta > 0
        ? `+${f(delta)}`
        : delta < 0
          ? `−${f(-delta)}`
          : "0";
  return t(period === "week" ? "dash.delta.week" : "dash.delta.day", { d });
}

const CHIPS: Record<string, TKey> = {
  remaining: "dash.chip.remaining",
  open: "dash.chip.open",
  behind: "dash.chip.behind",
};

export function KpiTile({
  def,
  snap,
  env,
}: {
  def: DefWidget | undefined;
  snap: SnapWidget | undefined;
  env: WidgetEnv;
}) {
  const t = useT();
  const locale = useLocale();
  const [asTable, setAsTable] = useState(false);
  const data = (snap?.data ?? {}) as Row;
  const value = num(data.value);
  const shown = useCountUp(value ?? 0);
  const label = widgetTitle(def, snap, t);
  const period = def?.options?.period ?? "day";
  const series = rows(data.series)
    .map((p) => ({ at: num(p.at), value: num(p.value) }))
    .filter((p): p is { at: number; value: number } => p.at !== null && p.value !== null);
  const hasTrend = data.delta !== undefined && series.length >= 2;
  const newest = series.at(-1)?.at ?? 0;
  const current = series.findIndex((p) => p.at >= newest - PERIOD_MS[period]);
  const points: ChartPoint[] = series.map((p) => ({
    label: `${shortDate(localDay(p.at), locale)} ${hhmm(p.at)}`,
    value: compactNumber(p.value, locale),
  }));
  const chip = (data.chip ?? null) as Row | null;
  const of = num(data.of);
  const display = Number.isInteger(value ?? 0) ? Math.round(shown) : shown;
  const direction = text(data.direction);
  let body: ReactNode;
  if (!snap) body = <div className="dsh-skel" aria-hidden />;
  else if (snap.status === "error") body = <WidgetError snap={snap} def={def} env={env} />;
  else
    body = (
      <>
        <div className="dsh-kpi-row">
          <span className="dsh-kpi-value dsh-num">
            {value === null ? "—" : compactNumber(display, locale)}
          </span>
          {of !== null && <span className="dsh-kpi-of dsh-num">/{compactNumber(of, locale)}</span>}
          {hasTrend ? (
            !asTable && (
              <Sparkline
                values={series.map((p) => p.value)}
                current={current}
                points={points}
                label={label}
              />
            )
          ) : (
            <span className="dsh-nohist">{t("dash.widget.noHistory")}</span>
          )}
        </div>
        {hasTrend && asTable && (
          <ChartOrTable asTable points={points} caption={label}>
            {null}
          </ChartOrTable>
        )}
        <div className="dsh-kpi-foot">
          {hasTrend && (
            <span
              className={`dsh-delta ${direction === "flat" ? "flat" : data.good === true ? "good" : "bad"}`}
            >
              {deltaText(data, period, t, locale)}
            </span>
          )}
          {chip && CHIPS[String(chip.rule)] && (
            <Badge kind="state" tone={chip.tone === "danger" ? "danger" : "warn"} className="dsh-chip">
              <AlertTriangle aria-hidden />
              {t(CHIPS[String(chip.rule)]!, { n: num(chip.n) ?? 0 })}
            </Badge>
          )}
          {hasTrend && (
            <Switch checked={asTable} onCheckedChange={setAsTable} className="dsh-astable">
              {t("dash.widget.asTable")}
            </Switch>
          )}
        </div>
      </>
    );
  return (
    <section className="dsh-kpi" data-widget={def?.id ?? snap?.id} aria-label={label}>
      <span className="dsh-kpi-label">{label}</span>
      {body}
      <Citations data={data} env={env} />
    </section>
  );
}

/* ---- the highlights row (AC 44, design.md "Corpo") ---------------------------------------------------------- */

const RULE_ICON: Record<string, LucideIcon> = {
  overdue: AlertTriangle,
  due_today: Clock,
  decided_this_week: Check,
  open_decision_7d: CircleDot,
  project_behind: TrendingDown,
  review_due: RotateCcw,
  connector_flagged: Flag,
  new_since_visit: Sparkles,
};

export function HighlightsRow({ highlights, env }: { highlights: readonly Highlight[]; env: WidgetEnv }) {
  if (highlights.length === 0) return null;
  return (
    <ul className="dsh-highlights">
      {highlights.slice(0, 8).map((h, i) => {
        const Icon = RULE_ICON[h.rule] ?? Sparkles;
        return (
          <li key={`${h.rule}:${h.target}:${i}`}>
            <button
              type="button"
              className={`dsh-pill ${h.tone}`}
              data-rule={h.rule}
              onClick={() => env.open(h.target)}
            >
              <Icon aria-hidden />
              {h.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
