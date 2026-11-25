/**
 * "Resumos" (.specs/features/cerebro-entidades-resumos, S7; design.md "Vista - Resumos"): the areas and the work contexts
 * (`GET /api/memory/summaries`) with the state of each one's summary, and one scope's summary open (`GET
 * /api/memory/summaries/:kind/:id`, `?kind=&id=` in the route): its paragraphs with the notes they cite, the sources
 * with their state, the band of a stale summary and the card of how it was made. "Gerar" and "Atualizar" send `POST
 * /api/memory/summaries`; a run that fails, a skill that is off and a scope with no notes each say so in place of the
 * body alone. The same screen is the frame's page at `/brain/summaries` and the Núcleo's brain panel there; a chunk of
 * its own, fetched the first time it is opened (AC 85).
 */
import { useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleCheck,
  CircleDashed,
  Clock,
  FileQuestion,
  FileText,
  Layers,
  Loader,
  Lock,
  PencilLine,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useCommands, type Command } from "../../commands/registry";
import { Markdown } from "../../components/Markdown";
import { formatDuration } from "../../components/ui";
import { AppRouteContext } from "../../desktop/appRoute";
import { useLocale, useT, type TKey } from "../../i18n";
import { qk, useOsSettings, useRouteQuery } from "../../queries";
import { parseMarkdown, type Block } from "../markdown";
import { NatureBadge } from "../natureza";
import { useBrainMode } from "../BrainViewSwitch";
import { Fold } from "../notes/Fold";
import "../notes/notes.css";
import "./summaries.css";

type Item = ApiCallResult<"GET /api/memory/summaries">["items"][number];
type Detail = ApiCallResult<"GET /api/memory/summaries/:kind/:id">;
type Scope = { kind: "area" | "context"; id: string };
type Changes = { changed: number; removed: number; added: number };

const POLL_MS = 2_000;
const LIST_KEY = ["memory", "summaries"] as const;
const SKILL = "brain-summarize";

const pad = (n: number) => String(n).padStart(2, "0");
/** "24/11", the local day. */
const dayOf = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
const whenOf = (at: number) => {
  const d = new Date(at);
  return `${dayOf(at)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const providerName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const keyOf = (s: Scope) => `${s.kind}:${s.id}`;
/** A paragraph is prose: a heading reads as a paragraph (as the ask's answer). */
const prose = (text: string): Block[] =>
  parseMarkdown(text).map((b) => (b.type === "heading" ? { type: "paragraph", children: b.children } : b));

/**
 * `template` (the locale's sentence with `{changed}`, `{removed}` and `{added}` in that order, each followed by its
 * words) with only the counts that are not zero: all three give the sentence as written.
 */
function onlyCounts(template: string, c: Changes): string {
  const bits = template.split(/\{(?:changed|removed|added)\}/);
  const parts = (["changed", "removed", "added"] as const).flatMap((k, i) =>
    c[k] > 0 ? [`${c[k]}${bits[i + 1]!.replace(/[,.]\s*$/, "")}`] : [],
  );
  return `${bits[0]}${parts.join(", ")}${bits[3]!.endsWith(".") ? "." : ""}`;
}

/** The route's own search: the panel's in the Núcleo, the router's in the frame. */
function useSummariesSearch(): string {
  const panel = useContext(AppRouteContext);
  const location = useLocation();
  return panel?.search ?? location.search;
}

export default function SummariesView() {
  const t = useT();
  const qc = useQueryClient();
  const brain = useBrainMode();
  const settings = useOsSettings({ staleTime: 30_000 });
  const params = new URLSearchParams(useSummariesSearch());
  const kind = params.get("kind");
  const id = params.get("id");
  const open: Scope | null = (kind === "area" || kind === "context") && id ? { kind, id } : null;

  const list = useRouteQuery(LIST_KEY, "GET /api/memory/summaries", undefined, {
    retry: false,
    refetchInterval: (query) => (query.state.data?.items.some((i) => i.running) ? POLL_MS : false),
  });
  const items = list.data?.items ?? [];
  const [off, setOff] = useState(false);
  const [refused, setRefused] = useState<{
    key: string;
    code: "empty_scope" | "other";
    message: string;
  } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: LIST_KEY });
  const show = (scope: Scope | null) =>
    brain.go("summaries", scope ? `?kind=${scope.kind}&id=${encodeURIComponent(scope.id)}` : "");
  const start = async (scope: Scope) => {
    setRefused(null);
    try {
      await apiCall("POST /api/memory/summaries", { body: { scope } });
      setOff(false);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "skill_unavailable") setOff(true);
      else if (code !== "summary_in_progress")
        setRefused({
          key: keyOf(scope),
          code: code === "empty_scope" ? "empty_scope" : "other",
          message: err instanceof Error ? err.message : String(err),
        });
    }
    void refresh();
  };
  const cancel = async (scope: Scope) => {
    const runs = await apiCall("GET /api/runs", { query: { statusGroup: "active", limit: 50 } });
    for (const run of runs.filter((r) => r.skillSlug === SKILL)) {
      const full = await apiCall("GET /api/runs/:id", { params: { id: run.id } });
      const request = full.run.request;
      if (request?.kind === "skill" && request.inputs.scope === keyOf(scope)) {
        await apiCall("POST /api/runs/:id/cancel", { params: { id: run.id } });
        break;
      }
    }
    void refresh();
  };
  const turnOn = async () => {
    const now = await apiCall("GET /api/settings");
    const skills = now.memorySkills.includes(SKILL) ? now.memorySkills : [...now.memorySkills, SKILL];
    await apiCall("PUT /api/settings", { body: { memorySkills: skills } });
    void qc.invalidateQueries({ queryKey: qk.settings });
    setOff(false);
  };

  // j/k move in the list (a bare key never acts inside a field).
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const live = useRef({ items, at: -1 });
  live.current.items = items;
  useCommands(
    useMemo<Command[]>(() => {
      const move = (by: number) => {
        const l = live.current;
        if (l.items.length === 0) return;
        l.at = Math.min(l.items.length - 1, Math.max(0, l.at + by));
        rowButtons.current.get(keyOf(l.items[l.at]!.scope))?.focus();
      };
      return [
        {
          id: "summaries.next",
          title: "reviews.cmd.next",
          group: "view",
          scope: "view:summaries",
          keys: ["j"],
          run: () => move(1),
        },
        {
          id: "summaries.prev",
          title: "reviews.cmd.prev",
          group: "view",
          scope: "view:summaries",
          keys: ["k"],
          run: () => move(-1),
        },
      ];
    }, []),
  );

  const row = (item: Item, at: number) => {
    const scope = { kind: item.scope.kind, id: item.scope.id };
    const [Icon, text] = stateOf(t, item);
    return (
      <li key={keyOf(scope)} className="sum-row">
        <button
          type="button"
          className="sum-pick"
          aria-current={open && keyOf(open) === keyOf(scope) ? "true" : undefined}
          ref={(el) =>
            void (el ? rowButtons.current.set(keyOf(scope), el) : rowButtons.current.delete(keyOf(scope)))
          }
          onFocus={() => (live.current.at = at)}
          onClick={() => show(scope)}
        >
          <span className="sum-name">{item.scope.name}</span>
          <span className="sum-state" data-state={item.running ? "running" : item.state}>
            <Icon aria-hidden />
            {text}
          </span>
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={item.running}
          onClick={() => {
            show(scope);
            void start(scope);
          }}
        >
          {t(item.state === "missing" ? "summaries.make" : "summaries.update")}
        </button>
      </li>
    );
  };
  const group = (scopeKind: Item["scope"]["kind"], title: string): ReactNode => {
    const mine = items.filter((i) => i.scope.kind === scopeKind);
    return (
      mine.length > 0 && (
        <section className="sum-group" key={scopeKind}>
          <h2 className="sum-h2">{title}</h2>
          <ul className="sum-rows">{mine.map((i) => row(i, items.indexOf(i)))}</ul>
        </section>
      )
    );
  };

  const body = (): ReactNode => {
    if (list.isPending)
      return (
        <p className="sum-line" role="status">
          <span className="spinner sm" aria-hidden /> {t("summaries.loading")}
        </p>
      );
    if (list.isError)
      return (
        <div className="sum-band" role="alert">
          <AlertTriangle aria-hidden />
          <span>{t("summaries.listFailed")}</span>
          <button type="button" className="btn sm" onClick={() => void list.refetch()}>
            {t("summaries.retry")}
          </button>
        </div>
      );
    if (items.length === 0)
      return (
        <div className="sum-empty">
          <p className="sum-line">
            <Layers aria-hidden /> {t("summaries.empty")}
          </p>
          <Link className="sum-link" to="/settings?tab=memory">
            {t("summaries.empty.link")}
          </Link>
        </div>
      );
    return (
      <>
        {group("area", t("summaries.group.area"))}
        {group("context", t("summaries.group.context"))}
      </>
    );
  };

  const current = open ? items.find((i) => keyOf(i.scope) === keyOf(open)) : undefined;
  return (
    <div className="sum-view" data-open={open ? "" : undefined}>
      <div className="sum-cols">
        <section className="sum-listcol">
          <header className="sum-head">
            <h1 className="sum-h1">{t("summaries.title")}</h1>
            <p className="sum-small">
              {t("summaries.lede", { provider: providerName(settings.data?.defaultProvider ?? "claude") })}
            </p>
          </header>
          {body()}
        </section>
        <section className="sum-panelcol">
          {open && (
            <SummaryPanel
              key={keyOf(open)}
              scope={open}
              name={current?.scope.name ?? open.id}
              off={off}
              refused={refused?.key === keyOf(open) ? refused : null}
              onStart={() => void start(open)}
              onCancel={() => void cancel(open)}
              onTurnOn={() => void turnOn()}
              onBack={() => show(null)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** The row's state: the icon and the sentence of 12px (design.md "Lista"). */
function stateOf(t: ReturnType<typeof useT>, item: Item): [LucideIcon, string] {
  if (item.running) return [Loader, t("summaries.state.running")];
  if (item.state === "fresh")
    return [CircleCheck, t("summaries.state.fresh", { day: dayOf(item.generatedAt ?? 0) })];
  if (item.state === "stale")
    return [
      Clock,
      onlyCounts(t("summaries.state.stale"), item.changes ?? { changed: 0, removed: 0, added: 0 }),
    ];
  return [CircleDashed, t("summaries.state.missing")];
}

const SOURCE_STATE: Record<Detail["sources"][number]["state"], [LucideIcon, TKey]> = {
  same: [Check, "summaries.source.same"],
  changed: [PencilLine, "summaries.source.changed"],
  removed: [X, "summaries.source.removed"],
};

function SummaryPanel({
  scope,
  name,
  off,
  refused,
  onStart,
  onCancel,
  onTurnOn,
  onBack,
}: {
  scope: Scope;
  name: string;
  off: boolean;
  refused: { code: "empty_scope" | "other"; message: string } | null;
  onStart: () => void;
  onCancel: () => void;
  onTurnOn: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const brain = useBrainMode();
  const detail = useRouteQuery(
    [...LIST_KEY, "one", scope.kind, scope.id],
    "GET /api/memory/summaries/:kind/:id",
    { params: scope },
    {
      retry: false,
      refetchInterval: (query) => (query.state.data?.running ? POLL_MS : false),
    },
  );
  const back = (
    <button type="button" className="btn sm sum-back" onClick={onBack}>
      <ArrowLeft aria-hidden /> {t("entities.back")}
    </button>
  );
  const d = detail.data;
  const running = d?.running ?? false;
  const goFile = (fileId: number) => brain.go("graph", `?sel=${fileId}`);
  // "Gerar" is the body's when there is no summary yet.
  const update = d && d.state !== "missing" && (
    <button type="button" className="btn sm" disabled={running} onClick={onStart}>
      <RefreshCw aria-hidden /> {t("summaries.update")}
    </button>
  );

  let content: ReactNode;
  if (off)
    content = (
      <div className="sum-off">
        <p className="sum-line">
          <Lock aria-hidden /> {t("summaries.off")}
        </p>
        <button type="button" className="btn primary" onClick={onTurnOn}>
          {t("summaries.turnOn")}
        </button>
      </div>
    );
  else if (refused?.code === "empty_scope")
    content = <p className="sum-line">{t("summaries.emptyScope", { name })}</p>;
  else if (detail.isPending)
    content = (
      <p className="sum-line" role="status">
        <span className="spinner sm" aria-hidden /> {t("summaries.loading")}
      </p>
    );
  else if (!d)
    content = (
      <div className="sum-band" role="alert">
        <AlertTriangle aria-hidden />
        <span>{t("summaries.listFailed")}</span>
        <button type="button" className="btn sm" onClick={() => void detail.refetch()}>
          {t("summaries.retry")}
        </button>
      </div>
    );
  else {
    const error = refused?.message ?? d.lastError;
    content = (
      <>
        {error !== undefined && !running && (
          <div className="sum-band" role="alert">
            <AlertTriangle aria-hidden />
            <div className="sum-band-text">
              <p>{t("summaries.failed")}</p>
              <p className="sum-small">{error}</p>
            </div>
            <button type="button" className="btn sm" onClick={onStart}>
              {t("summaries.retry")}
            </button>
          </div>
        )}
        {d.state === "stale" && d.changes && (
          <div className="sum-stale">
            <Clock aria-hidden />
            <span>{onlyCounts(t("summaries.stale", { day: dayOf(d.generatedAt ?? 0) }), d.changes)}</span>
            <button type="button" className="btn sm" disabled={running} onClick={onStart}>
              {t("summaries.update")}
            </button>
          </div>
        )}
        {d.paragraphs === undefined ? (
          <div className="sum-none">
            <p className="sum-line">
              <FileQuestion aria-hidden /> {t("summaries.none", { name })}
            </p>
            {!running && (
              <button type="button" className="btn primary" onClick={onStart}>
                {t("summaries.make")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="sum-pars">
              {d.paragraphs.map((p, i) => (
                <div key={i} className="sum-par">
                  <Markdown blocks={prose(p.text)} shape="page" className="sum-md" />
                  <div className="sum-cites">
                    {p.citations.map((c, j) => (
                      <span key={`${c.path}§${c.section}§${j}`} className="sum-cite-item">
                        <button type="button" className="sum-link" onClick={() => goFile(c.fileId)}>
                          <FileText aria-hidden />
                          {`${c.name} § ${c.section}`}
                        </button>
                        {c.natureza && <NatureBadge n={c.natureza} dense />}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Fold title={t("summaries.sources", { n: d.sources.length })} shut>
              <ul className="sum-sources">
                {d.sources.map((s) => {
                  const [Icon, label] = SOURCE_STATE[s.state];
                  return (
                    <li key={s.path}>
                      {s.fileId !== undefined && s.state !== "removed" ? (
                        <button type="button" className="sum-link" onClick={() => goFile(s.fileId!)}>
                          {s.name}
                        </button>
                      ) : (
                        <span>{s.name}</span>
                      )}
                      <span className="sum-state">
                        <Icon aria-hidden />
                        {t(label)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Fold>
            {d.run && (
              <section className="card sum-how">
                <h2 className="sum-h1">{t("summaries.how")}</h2>
                <p className="sum-small">
                  {t("summaries.how.line", {
                    provider: providerName(d.run.provider),
                    duration: formatDuration(
                      d.run.finishedAt === undefined ? null : d.run.finishedAt - d.run.startedAt,
                      locale,
                    ),
                    when: whenOf(d.run.startedAt),
                  })}
                </p>
                <Link className="sum-link" to={`/runs/${d.run.id}`}>
                  {t("summaries.how.run")}
                </Link>
              </section>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="sum-panel sum-panel-in">
      {back}
      <header className="sum-phead">
        <h2 className="sum-pname">{name}</h2>
        <span className="sum-small">
          {t(scope.kind === "area" ? "summaries.kind.area" : "summaries.kind.context")}
        </span>
        {running ? (
          <span className="sum-running">
            <span className="sum-line" role="status">
              <span className="spinner sm" aria-hidden /> {t("summaries.state.running")}
            </span>
            <button type="button" className="btn sm" onClick={onCancel}>
              {t("summaries.cancel")}
            </button>
          </span>
        ) : (
          update
        )}
      </header>
      {content}
    </div>
  );
}
