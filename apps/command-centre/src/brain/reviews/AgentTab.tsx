/**
 * "Revisões", the tab "Do agente" (.specs/features/cerebro-memoria-confiavel, AC 80-86; design.md "Tela - Revisões, aba
 * Do agente"): what agents proposed to write to the memory, newest first as the route answers, on the left; on the
 * right the chosen proposal from top to bottom (its summary, its author, the diff, the ops with their checkbox, section,
 * text, source and trust), and at its foot "Aceitar selecionadas (k)" and "Recusar", which asks first. Accepting sends
 * the ticked op indexes with the `baseVersion` the detail showed; the item leaves as on "Para revisar" and "Proposta
 * aceita." stays 8 s with "Ver histórico". No bare key decides: `j`/`k` move (the screen's commands) and `Enter` on an
 * item is its button's own click.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AlertTriangle, Check, Inbox, Sparkles, X } from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { timeAgo } from "../../components/ui";
import { prefersReducedMotion } from "../../hooks/useViewTransition";
import { useLocale, useT } from "../../i18n";
import { useInvalidate, useRouteQuery } from "../../queries";
import { Modal } from "../../ui";
import { errorMessage } from "../../views/shared";
import { Author, OpState, TrustBadge, authorText, notesHref } from "../memoria";
import { DiffLines } from "../memoriaDiff";
import { useMemoryRoot, withoutExt } from "../notes/notesData";
import "./agent.css";

type T = ReturnType<typeof useT>;
export type ProposalList = ApiCallResult<"GET /api/memory/proposals">;
export type ProposalItem = ProposalList["items"][number];
export type ProposalDetail = ApiCallResult<"GET /api/memory/proposals/:id">;
export type OpView = ProposalDetail["ops"][number];
export type PendingQuery = ReturnType<typeof usePendingProposals>;

const NOTICE_MS = 8_000;
const LEAVE_MS = 150;

/** The proposals the tab lists and counts: the pending ones (`?status=pending`, one query for both). */
export function usePendingProposals() {
  return useRouteQuery(["memory", "proposals", "pending"], "GET /api/memory/proposals", {
    query: { status: "pending" },
  });
}

/** Line 1 of an item: the title by kind (design.md "Lista"). */
export function proposalTitle(t: T, p: ProposalItem, locale: string): string {
  switch (p.kind) {
    case "consolidation":
      return t("proposals.title.consolidation", {
        day: new Date(p.createdAt).toLocaleDateString(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      });
    case "memory_edit":
      return t("proposals.title.memoryEdit", { author: authorText(t, p.author) });
    case "fact": {
      const [subject = "", predicate = ""] = p.summary.split(" · ");
      return t("proposals.title.fact", { subject, predicate });
    }
    case "note_create":
      return t("proposals.title.noteCreate", { title: p.summary });
    default:
      return t("proposals.title.noteSave", { name: withoutExt(p.summary) });
  }
}

export function AgentListItem(p: {
  item: ProposalItem;
  selected: boolean;
  leaving?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  const t = useT();
  const locale = useLocale();
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
          <span className="rv-name">{proposalTitle(t, item, locale)}</span>
        </span>
        <span className="rv-line2">
          <span>{authorText(t, item.author)}</span>
          <span>{timeAgo(item.createdAt, locale)}</span>
          <span>{item.opCount === 1 ? t("proposals.ops.one") : t("proposals.ops", { n: item.opCount })}</span>
        </span>
      </button>
    </li>
  );
}

/** One op, left to right: the checkbox, the section, the text (and why it cannot be applied), the source, the trust. */
export function OpRow({
  op,
  ticked,
  onTick,
  memoryRoot,
}: {
  op: OpView;
  ticked: boolean;
  onTick: (on: boolean) => void;
  memoryRoot: string | null;
}) {
  const t = useT();
  const source = op.source?.replace(/#.*$/, "") ?? null;
  const abs = source && !source.startsWith("/") && memoryRoot ? `${memoryRoot}/${source}` : source;
  const shown =
    source && memoryRoot && source.startsWith(`${memoryRoot}/`)
      ? source.slice(memoryRoot.length + 1)
      : source;
  const section =
    op.section === "Fact"
      ? t("proposals.section.fact")
      : op.section?.startsWith("Topic ")
        ? t("proposals.section.topic", { slug: op.section.slice(6) })
        : (op.section ?? "");
  return (
    <li className="ag-op">
      <input
        type="checkbox"
        aria-label={op.text}
        checked={ticked}
        disabled={op.state !== "valid"}
        onChange={(e) => onTick(e.target.checked)}
      />
      <span className="ag-section">{section}</span>
      <span className="ag-text">
        <span>{op.text}</span>
        {op.state !== "valid" && <OpState state={op.state} reason={op.reason} />}
      </span>
      {abs ? (
        <a className="ag-source" href={notesHref(abs, op.line)}>
          {shown}
          {op.line ? `:${op.line}` : ""}
        </a>
      ) : (
        <span />
      )}
      <TrustBadge trust={op.trust} />
    </li>
  );
}

/** The list's and the detail's own states: "Carregando…", and the message with "Tentar de novo". */
function Loading() {
  const t = useT();
  return (
    <p className="rv-state">
      <span className="spinner" aria-hidden />
      {t("common.loading")}
    </p>
  );
}
function Failed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rv-state" role="alert">
      <AlertTriangle aria-hidden />
      <span>{errorMessage(error, t)}</span>
      <button type="button" className="btn sm" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

/** What a refused decision leaves in the detail: the conflict, the ceiling, or the error's own message. */
export type Refusal = { code: "edit_conflict" | "memory_over_budget" | null; message: string };

export function RefusalBanner({ refusal, onReload }: { refusal: Refusal; onReload?: () => void }) {
  const t = useT();
  return (
    <div className="ag-banner" role="alert">
      <AlertTriangle aria-hidden />
      <span>
        {refusal.code === "edit_conflict"
          ? t("proposals.conflict")
          : refusal.code === "memory_over_budget"
            ? t("proposals.overBudget")
            : refusal.message}
      </span>
      {refusal.code === "edit_conflict" && (
        <button type="button" className="btn sm" onClick={onReload}>
          {t("reviews.reload")}
        </button>
      )}
    </div>
  );
}

/** The chosen proposal, top to bottom, with its decisions (AC 81-85). */
export function AgentDetail({
  detail,
  memoryRoot,
  refusal,
  onReload,
  onAccept,
  onReject,
}: {
  detail: ProposalDetail;
  memoryRoot: string | null;
  refusal: Refusal | null;
  onReload: () => void;
  onAccept: (ops: number[] | null) => void;
  onReject: () => void;
}) {
  const t = useT();
  const withOps = detail.kind === "consolidation" || detail.kind === "fact";
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(detail.ops.flatMap((o, i) => (o.state === "valid" && o.trust === "usuario" ? [i] : []))),
  );
  const enabled = detail.ops.flatMap((o, i) => (o.state === "valid" ? [i] : []));
  const note = String(detail.payload.path ?? detail.payload.title ?? detail.summary);
  const name = withoutExt(note.slice(note.lastIndexOf("/") + 1));
  const what =
    detail.kind === "consolidation" || detail.kind === "memory_edit"
      ? t("proposals.diff.memory")
      : t("proposals.diff.note", { name });
  return (
    <div className="rv-detail ag-detail">
      {detail.summary && <p className="ag-summary">{detail.summary}</p>}
      <Author author={detail.author} link />
      {detail.diff && (
        <section className="ag-diff-box">
          <h3 className="ag-diff-title">{what}</h3>
          <div className="ag-diff">
            <DiffLines diff={detail.diff} label={what} />
          </div>
        </section>
      )}
      {withOps && (
        <>
          <div className="ag-marks">
            <button type="button" className="btn ghost sm" onClick={() => setTicked(new Set(enabled))}>
              {t("proposals.selectAll")}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setTicked(new Set())}>
              {t("proposals.selectNone")}
            </button>
          </div>
          <ul className="ag-ops">
            {detail.ops.map((op, i) => (
              <OpRow
                key={i}
                op={op}
                memoryRoot={memoryRoot}
                ticked={ticked.has(i)}
                onTick={(on) =>
                  setTicked((cur) => {
                    const next = new Set(cur);
                    if (on) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </>
      )}
      {refusal && <RefusalBanner refusal={refusal} onReload={onReload} />}
      <div className="rv-acts">
        <button
          type="button"
          className="btn primary"
          disabled={withOps && ticked.size === 0}
          onClick={() => onAccept(withOps ? [...ticked].sort((a, b) => a - b) : null)}
        >
          <Check aria-hidden />
          {withOps ? t("proposals.accept", { k: ticked.size }) : t("proposals.acceptOne")}
        </button>
        <button type="button" className="btn" onClick={onReject}>
          <X aria-hidden />
          {t("proposals.reject")}
        </button>
      </div>
    </div>
  );
}

export function AgentTab({
  list,
  gone,
  onGone,
  moveRef,
}: {
  list: PendingQuery;
  gone: ReadonlySet<string>;
  onGone: (id: string) => void;
  moveRef: MutableRefObject<((by: number) => void) | null>;
}) {
  const t = useT();
  const invalidate = useInvalidate();
  const memoryRoot = useMemoryRoot();
  const [sel, setSel] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [asking, setAsking] = useState(false);
  // The notice after an acceptance, with the file whose history "Ver histórico" opens (none for a fact).
  const [notice, setNotice] = useState<{ file: string | null } | null>(null);
  const [started, setStarted] = useState<"no" | "asking" | "yes">("no");
  const timer = useRef<number | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const items = (list.data?.items ?? []).filter((i) => !gone.has(i.id));
  const current = items.find((i) => i.id === sel) ?? items[0];
  const detail = useRouteQuery(
    ["memory", "proposals", "one", current?.id ?? null],
    "GET /api/memory/proposals/:id",
    { params: { id: current?.id ?? "" } },
    { enabled: !!current, retry: false },
  );

  useEffect(() => {
    if (focusOn) buttons.current.get(focusOn)?.focus();
  }, [focusOn, items.length]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const select = (id: string, focus = false) => {
    setSel(id);
    setRefusal(null);
    if (focus) setFocusOn(id);
  };
  moveRef.current = (by: number) => {
    const at = items.findIndex((i) => i.id === current?.id);
    const next = items[Math.min(items.length - 1, Math.max(0, at + by))];
    if (next) select(next.id, true);
  };

  const leave = (id: string) => {
    const at = items.findIndex((i) => i.id === id);
    const next = items[at + 1] ?? items[at - 1];
    if (next) select(next.id, true);
    if (prefersReducedMotion()) onGone(id);
    else {
      setLeaving((g) => new Set(g).add(id));
      window.setTimeout(() => onGone(id), LEAVE_MS);
    }
  };

  const decide = async (body: { action: "accept" | "reject"; ops?: number[] }) => {
    const shown = detail.data;
    if (!shown) return;
    try {
      const res = await apiCall("POST /api/memory/proposals/:id/decide", {
        params: { id: shown.id },
        body: {
          ...body,
          ...(body.action === "accept" && shown.baseVersion ? { baseVersion: shown.baseVersion } : {}),
        },
      });
      void invalidate(["memory", "history"], ["memory", "facts"]);
      leave(shown.id);
      if (body.action === "accept") {
        const file =
          shown.kind === "fact"
            ? null
            : shown.kind === "consolidation" || shown.kind === "memory_edit"
              ? "MEMORY.md"
              : (res.written[0]?.path ?? null);
        window.clearTimeout(timer.current);
        setNotice({ file });
        timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setRefusal({
        code: code === "edit_conflict" || code === "memory_over_budget" ? code : null,
        message: errorMessage(err, t),
      });
    }
  };

  const consolidate = async () => {
    setStarted("asking");
    try {
      await apiCall("POST /api/skills/:slug/run", { params: { slug: "consolidate-memory" } });
      setStarted("yes");
    } catch (err) {
      setStarted("no");
      setRefusal({ code: null, message: errorMessage(err, t) });
    }
  };

  let body;
  if (list.isPending) body = <Loading />;
  else if (list.isError) body = <Failed error={list.error} onRetry={() => void list.refetch()} />;
  else if (items.length === 0)
    body = (
      <div className="rv-empty ag-empty">
        <Inbox aria-hidden size={32} />
        <p className="rv-prose">{t("proposals.empty")}</p>
        {started === "yes" ? (
          <p className="rv-prose" role="status">
            {t("proposals.consolidateStarted")}
          </p>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={started === "asking"}
            onClick={() => void consolidate()}
          >
            <Sparkles aria-hidden />
            {t("proposals.consolidateNow")}
          </button>
        )}
        {refusal && <RefusalBanner refusal={refusal} />}
      </div>
    );
  else
    body = (
      <div className="rv-body">
        <ul className="rv-list" aria-label={t("reviews.title")}>
          {items.map((i) => (
            <AgentListItem
              key={i.id}
              item={i}
              selected={i.id === current?.id}
              leaving={leaving.has(i.id)}
              buttonRef={(el) => void (el ? buttons.current.set(i.id, el) : buttons.current.delete(i.id))}
              onSelect={() => select(i.id)}
            />
          ))}
        </ul>
        {detail.isPending ? (
          <Loading />
        ) : detail.isError ? (
          <Failed error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <AgentDetail
            key={`${detail.data.id}:${detail.dataUpdatedAt}`}
            detail={detail.data}
            memoryRoot={memoryRoot}
            refusal={refusal}
            onReload={() => {
              setRefusal(null);
              void detail.refetch();
            }}
            onAccept={(ops) => void decide({ action: "accept", ...(ops ? { ops } : {}) })}
            onReject={() => setAsking(true)}
          />
        )}
      </div>
    );

  const history = notice?.file && memoryRoot ? `${memoryRoot}/${notice.file}` : null;
  return (
    <>
      {body}
      {notice !== null && (
        <div className="rv-notice" role="status">
          <Check aria-hidden />
          <span>{t("proposals.accepted")}</span>
          {history && (
            <a className="btn sm" href={notesHref(history)}>
              {t("proposals.seeHistory")}
            </a>
          )}
        </div>
      )}
      {asking && (
        <Modal title={t("proposals.reject.title")} onClose={() => setAsking(false)} className="rv-dialog">
          <div className="rv-dialog-body">
            <p className="rv-prose">{t("proposals.reject.body")}</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setAsking(false);
                void decide({ action: "reject" });
              }}
            >
              {t("proposals.reject")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
