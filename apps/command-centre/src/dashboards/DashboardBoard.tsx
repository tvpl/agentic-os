/**
 * What the page and the scene of the dashboards both draw (.specs/features/cerebro-paineis, design.md "Página"):
 * the header (greeting or title; the kind, the date, when it was updated and the sources; the selector, "Atualizar"
 * and "Mais"), the highlights, the KPIs and the cards in the definition's order, the question's citations and its
 * error, the next steps after the first overview, the two dialogs, and the "Atualizar painel" command while a
 * dashboard is on screen.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  Clock,
  Loader,
  MoreHorizontal,
  Plug,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { apiCall } from "../apiCall";
import { useCommands, type Command } from "../commands/registry";
import { useToast } from "../components/ui";
import { useLocale, useT, type TKey } from "../i18n";
import { useOsContexts } from "../queries";
import { DropdownMenu, type MenuEntry } from "../ui";
import { errorMessage } from "../views/shared";
import { useMemoryRoot } from "../brain/notes/notesData";
import { CustomizeDialog, NewDashboardDialog, type NewChoice } from "./DashboardDialogs";
import {
  greetingKey,
  hhmm,
  useDashboardBoard,
  useOpen,
  type DashboardRead,
  type DefWidget,
  type Row,
  type SnapSource,
  type SnapWidget,
} from "./dashboardsData";
import { HighlightsRow, KpiTile, WidgetCard, type WidgetEnv } from "./widgets";
import "./dashboards.css";

/** The clock the header and the widgets read: once a minute, and at once when the tab comes back. */
function useNow(ms = 60_000): number {
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

const SOURCE_ICON: Record<SnapSource["status"], LucideIcon> = {
  ok: Check,
  error: AlertTriangle,
  not_configured: Plug,
  unavailable: CircleSlash,
};
const SOURCE_NAME: Record<string, TKey> = {
  notes: "dash.source.notes",
  tasks: "dash.source.tasks",
  decisions: "dash.source.decisions",
  openLoops: "dash.source.openLoops",
  projects: "dash.source.projects",
  reviews: "dash.source.reviews",
  facts: "dash.source.facts",
  runs: "dash.source.runs",
  approvals: "dash.source.approvals",
  metrics: "dash.source.metrics",
  question: "dash.kind.question",
};

/** The widgets to draw, in order: the definition's that are not hidden, or the answer's for a question. */
export function widgetsOf(read: DashboardRead | undefined): Array<{ def?: DefWidget; snap?: SnapWidget }> {
  if (!read) return [];
  const snaps = read.snapshot?.widgets ?? [];
  if (read.definition.kind === "question") return snaps.map((snap) => ({ snap }));
  return read.definition.widgets
    .filter((w) => w.options?.hidden !== true)
    .map((def) => ({ def, snap: snaps.find((s) => s.id === def.id) }));
}

/** Everything a presentation of the dashboards needs. */
export function useBoardScreen() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const board = useDashboardBoard();
  const now = useNow();
  const open = useOpen();
  const memoryRoot = useMemoryRoot();
  const contexts = useOsContexts({ enabled: board.current?.kind === "area" });
  const [dialog, setDialog] = useState<{ kind: "new"; choice: NewChoice } | { kind: "customize" } | null>(
    null,
  );
  const read = board.data;
  const id = board.currentId;
  const { refresh } = board;

  const env: WidgetEnv = {
    now,
    memoryRoot,
    sources: read?.snapshot?.sources ?? [],
    open,
    retry: () => id && void board.refresh(id),
  };
  const commands = useMemo<Command[]>(
    () =>
      id === null
        ? []
        : [
            {
              id: "action:dashboard-refresh",
              title: "dash.cmd.refresh",
              group: "actions",
              scope: "global",
              icon: RefreshCw,
              keywords: ["refresh", "atualizar", "dashboard", "painel"],
              palette: true,
              run: () => void refresh(id),
            },
          ],
    [id, refresh],
  );
  useCommands(commands, { exclusive: "dashboards" });

  const exportHtml = async () => {
    if (!id) return;
    try {
      const { path } = await apiCall("POST /api/dashboards/:id/export", { params: { id } });
      const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(Date.now());
      toast(`${t("dash.exported", { date })}: ${path}`, "ok");
    } catch (err) {
      toast(errorMessage(err, t), "danger");
    }
  };
  const editFile = async () => {
    if (!id || memoryRoot === null) return;
    try {
      await apiCall("POST /api/memory/open", { body: { p: `${memoryRoot}/dashboards/${id}.json` } });
    } catch (err) {
      toast(errorMessage(err, t), "danger");
    }
  };
  const archive = async () => {
    if (!id) return;
    try {
      await board.forget(id);
    } catch (err) {
      toast(errorMessage(err, t), "danger");
    }
  };

  const selector: MenuEntry[] = [
    ...board.dashboards.map((d) => ({
      id: `dash:${d.id}`,
      label: d.title,
      checked: d.id === id,
      onSelect: () => board.show(d.id),
    })),
    { id: "dash-sep", separator: true as const },
    {
      id: "dash:new",
      label: `${t("dash.new")}…`,
      onSelect: () => setDialog({ kind: "new", choice: "overview" }),
    },
  ];
  const more: MenuEntry[] = [
    { id: "dash:export", label: t("dash.export"), onSelect: () => void exportHtml() },
    { id: "dash:customize", label: t("dash.customize"), onSelect: () => setDialog({ kind: "customize" }) },
    { id: "dash:edit", label: t("dash.editFile"), onSelect: () => void editFile() },
    { id: "dash:archive", label: t("dash.archive"), onSelect: () => void archive() },
  ];

  const kind = read?.definition.kind ?? board.current?.kind ?? "overview";
  const contextName =
    contexts.data?.contexts.find((c) => c.id === read?.definition.contextId)?.name ??
    read?.definition.contextId ??
    "";
  const heading =
    kind === "overview"
      ? t(greetingKey(new Date(now).getHours()))
      : kind === "question"
        ? (read?.definition.question ?? read?.definition.title ?? board.current?.title ?? "")
        : (read?.definition.title ?? board.current?.title ?? "");
  const kindLabel =
    kind === "overview"
      ? t("dash.kind.overview")
      : kind === "area"
        ? t("dash.kind.area", { name: contextName })
        : t("dash.kind.question");
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    now,
  );

  const dialogs: ReactNode =
    dialog?.kind === "new" ? (
      <NewDashboardDialog
        initial={dialog.choice}
        onCreate={(input) => board.create(input)}
        onClose={() => setDialog(null)}
      />
    ) : dialog?.kind === "customize" && read && id ? (
      <CustomizeDialog
        id={id}
        definition={read.definition}
        version={read.version}
        onSaved={(definition, version) => {
          qc.setQueriesData<DashboardRead>({ queryKey: ["dashboards", "one", id] }, (old) =>
            old ? { ...old, definition, version } : old,
          );
        }}
        onReload={async () => {
          const fresh = await board.one.refetch();
          return fresh.data ? { definition: fresh.data.definition, version: fresh.data.version } : undefined;
        }}
        onClose={() => setDialog(null)}
      />
    ) : null;

  const needsNext =
    board.dashboards.length > 0 && !board.dashboards.some((d) => d.kind === "area" || d.kind === "question");
  const questionSource = read?.snapshot?.sources.find((s) => s.id === "question");
  return {
    t,
    board,
    read,
    env,
    heading,
    kindLabel,
    date,
    selector,
    more,
    dialogs,
    needsNext,
    questionError:
      questionSource?.status === "error" ? (questionSource.message ?? t("dash.widget.error")) : null,
    openNew: (choice: NewChoice) => setDialog({ kind: "new", choice }),
  };
}
export type BoardScreen = ReturnType<typeof useBoardScreen>;

/** The left block's second line: the kind, the date, when it was updated (or that it is updating), the sources. */
export function HeaderMeta({
  kindLabel,
  date,
  read,
  refreshing,
}: {
  kindLabel: string;
  date: string;
  read: DashboardRead | undefined;
  refreshing: boolean;
}) {
  const t = useT();
  const snapshot = read?.snapshot ?? null;
  const when = refreshing ? (
    <>
      <Loader aria-hidden className="dsh-spin" />
      {t("dash.updating")}
    </>
  ) : !read ? null : snapshot === null ? (
    t("dash.never")
  ) : read.stale ? (
    <>
      <Clock aria-hidden />
      {t("dash.stale", { time: hhmm(snapshot.generatedAt) })}
    </>
  ) : (
    t("dash.updatedAt", { time: hhmm(snapshot.generatedAt) })
  );
  return (
    <div className="dsh-meta">
      <span className="dsh-kind">{kindLabel}</span>
      <span className="dsh-date">{date}</span>
      <span className="dsh-when" role="status">
        {when}
      </span>
      {snapshot && snapshot.sources.length > 0 && (
        <ul className="dsh-sources">
          {snapshot.sources.map((src) => {
            const Icon = SOURCE_ICON[src.status];
            return (
              <li key={src.id} className="dsh-source" data-status={src.status}>
                <Icon aria-hidden />
                {sourceName(src, snapshot.widgets, t)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** `HeaderMeta` of the dashboard on screen. */
export function BoardMeta({ s }: { s: BoardScreen }) {
  return <HeaderMeta kindLabel={s.kindLabel} date={s.date} read={s.read} refreshing={s.board.refreshing} />;
}

function sourceName(src: SnapSource, widgets: readonly SnapWidget[], t: (k: TKey) => string): string {
  if (src.id.startsWith("connector:")) {
    for (const w of widgets) {
      const c = ((w.data ?? {}) as Row).connector as Row | undefined;
      if (c && `connector:${String(c.id)}` === src.id && typeof c.name === "string") return c.name;
    }
    return src.id.slice("connector:".length);
  }
  const key = SOURCE_NAME[src.id];
  return key ? t(key) : src.id;
}

/** The right block: the selector, "Atualizar", "Mais". */
export function HeaderActions({ s }: { s: BoardScreen }) {
  const { t, board } = s;
  return (
    <div className="dsh-actions">
      <DropdownMenu
        items={s.selector}
        align="end"
        trigger={
          <button type="button" className="btn sm dsh-pick">
            {board.current?.title ?? t("dash.nav")}
            <ChevronDown aria-hidden />
          </button>
        }
      />
      <button
        type="button"
        className="btn sm dsh-refresh"
        disabled={board.currentId === null}
        onClick={() => board.currentId && void board.refresh(board.currentId)}
      >
        <RefreshCw aria-hidden />
        {t("dash.refresh")}
      </button>
      <DropdownMenu
        items={s.more}
        align="end"
        tip={t("dash.more")}
        trigger={
          <button type="button" className="btn sm ghost icon-only dsh-more" aria-label={t("dash.more")}>
            <MoreHorizontal aria-hidden />
          </button>
        }
      />
    </div>
  );
}

/** The question's own failure (AC 53): its reason and "Tentar de novo". */
export function QuestionError({ s }: { s: BoardScreen }) {
  if (s.questionError === null) return null;
  return (
    <div className="dsh-state-msg dsh-question-error" role="alert">
      <AlertTriangle aria-hidden />
      <span className="dsh-state-text">{s.questionError}</span>
      <button type="button" className="btn sm" onClick={s.env.retry}>
        {s.t("dash.widget.retry")}
      </button>
    </div>
  );
}

/** The KPI row holds at most this many tiles (design.md "Corpo"). */
const KPI_ROW_MAX = 5;

/** The KPIs (up to five) and the cards, apart. */
export function splitWidgets(s: BoardScreen) {
  const all = widgetsOf(s.read);
  const kind = (w: { def?: DefWidget; snap?: SnapWidget }) => w.def?.kind ?? w.snap?.kind;
  const kpis = all.filter((w) => kind(w) === "kpi");
  const row = kpis.slice(0, KPI_ROW_MAX);
  return {
    kpis: row,
    // The row holds five (design.md "Fileira de KPIs: até 5"); a KPI past the fifth is a tile on the grid, in the
    // definition's order, never dropped. A `highlights` widget is the row of pills at the top ("ver a fileira").
    cards: all.filter((w) => kind(w) !== "highlights" && !row.includes(w)),
  };
}

export function KpiRow({ s, className }: { s: BoardScreen; className: string }) {
  const { kpis } = splitWidgets(s);
  if (kpis.length === 0) return null;
  return (
    <div className={className}>
      {kpis.map((w) => (
        <KpiTile key={w.def?.id ?? w.snap?.id} def={w.def} snap={w.snap} env={s.env} />
      ))}
    </div>
  );
}

export function Highlights({ s }: { s: BoardScreen }) {
  return <HighlightsRow highlights={s.read?.highlights ?? []} env={s.env} ready={s.read !== undefined} />;
}

/** A card of the body. */
export function Card({
  s,
  w,
  as,
}: {
  s: BoardScreen;
  w: { def?: DefWidget; snap?: SnapWidget };
  as?: "section" | "article";
}) {
  if ((w.def?.kind ?? w.snap?.kind) === "kpi") return <KpiTile def={w.def} snap={w.snap} env={s.env} />;
  return <WidgetCard def={w.def} snap={w.snap} env={s.env} as={as} />;
}

/** "Painel de um contexto" and "Painel de uma pergunta", after the first overview (AC 30). */
export function NextSteps({ s }: { s: BoardScreen }) {
  if (!s.needsNext) return null;
  return (
    <div className="dsh-next">
      <button type="button" className="btn sm" onClick={() => s.openNew("area")}>
        {s.t("dash.new.area")}
      </button>
      <button type="button" className="btn sm" onClick={() => s.openNew("question")}>
        {s.t("dash.new.question")}
      </button>
    </div>
  );
}
