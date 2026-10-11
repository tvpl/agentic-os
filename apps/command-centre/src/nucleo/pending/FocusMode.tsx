/**
 * The Resolver (immersive shell): the OS turns toward what waits on you.
 * One card at a time, centred: the agent's reading of the item first, then
 * what is needed to decide, then one primary action (and at most three
 * others). Each cause is listed once (model.ts folds repetitions); quiet
 * notices wait in a folded history at the end of the queue. A resolved item
 * leaves with an animation and the next one comes forward; the Resolver
 * stays until nothing needs you.
 *
 * Keys: ↑/↓ (j/k) choose, A approve, D deny, Enter the primary action, Esc back.
 */
import { escapeLayerOpen } from "../../ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BellOff,
  CircleDollarSign,
  CalendarClock,
  MessageCircleQuestion,
  Plug,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SquareArrowOutUpRight,
  TriangleAlert,
  Bell,
  LogIn,
  X,
} from "lucide-react";
import { apiCall } from "../../apiCall";
import { useLocale, useT } from "../../i18n";
import { qk, useOsProviders } from "../../queries";
import { timeAgo, useToast } from "../../components/ui";
import { useNotifications } from "../../hooks/useNotifications";
import { useResolveApproval } from "../../runs/ApprovalCards";
import { ApprovalRequest } from "../../runs/ApprovalRequest";
import { failureFix } from "../../runs/failureFix";
import { useDesktopActions } from "../../desktop/actions";
import { describeDecision, editPreview, previewLines } from "../../desktop/decision";
import type { Pending } from "./usePending";
import type { PendingItem, PendingKind } from "./model";
import { describePending, readingFor } from "./describe";
import Entity from "../entity/Entity";
import QuestionCard from "../QuestionCard";
import { askAbout, refWord, type Subject } from "../subject";
import { useCommandScope } from "../../commands/registry";

const ICON: Record<PendingKind, ReactNode> = {
  question: <MessageCircleQuestion aria-hidden />,
  decision: <ShieldAlert aria-hidden />,
  provider: <Plug aria-hidden />,
  budget: <CircleDollarSign aria-hidden />,
  failure: <TriangleAlert aria-hidden />,
  routine: <CalendarClock aria-hidden />,
  notice: <Bell aria-hidden />,
};

export { askAgent } from "../subject";

interface Act {
  key: string;
  label: string;
  icon: ReactNode;
  primary?: boolean;
  danger?: boolean;
  hint?: string;
  busy?: boolean;
  run: () => void;
}

export default function FocusMode({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openRun, openPanel } = useDesktopActions();
  const { markRead } = useNotifications();
  const items = pending.items;
  // What waits on you, and the quiet history folded at the end.
  const live = useMemo(() => items.filter((i) => i.level !== "info"), [items]);
  const quiet = useMemo(() => items.filter((i) => i.level === "info"), [items]);
  const [selId, setSelId] = useState<string | null>(live[0]?.id ?? null);
  // A layer over the shell: while it is up, the Núcleo's and the global keys stand down.
  useCommandScope("overlay");
  const inQuiet = quiet.some((i) => i.id === selId);
  const list = inQuiet ? quiet : live;
  // When the chosen item is resolved, the next one comes forward.
  const lastIndex = useRef(0);
  const found = list.findIndex((i) => i.id === selId);
  const sel: PendingItem | undefined =
    found >= 0 ? list[found] : live[Math.min(lastIndex.current, live.length - 1)];
  const index = sel ? Math.max(0, list.indexOf(sel)) : 0;

  // The card knows which way the queue moved, and the item that just left.
  const [dir, setDir] = useState<"up" | "down">("down");
  const [ghost, setGhost] = useState<{ item: PendingItem; reading: string; title: string } | null>(null);
  const shown = useRef<PendingItem | undefined>(undefined);
  useLayoutEffect(() => {
    const prev = shown.current;
    if (prev && sel && prev.id !== sel.id) {
      if (!items.some((i) => i.id === prev.id)) {
        setDir("down");
        setGhost({
          item: prev,
          reading: readingFor(prev, t, (at) => timeAgo(at, locale)),
          title: describePending(prev, t).title,
        });
      }
    }
    if (sel) {
      lastIndex.current = list.indexOf(sel);
      if (sel.id !== selId) setSelId(sel.id);
    }
    shown.current = sel;
  }, [sel, selId, items, list, t, locale]);
  useEffect(() => {
    if (!ghost) return;
    const id = window.setTimeout(() => setGhost(null), 480);
    return () => window.clearTimeout(id);
  }, [ghost]);
  const choose = (id: string) => {
    const all = [...live, ...quiet];
    const from = all.findIndex((i) => i.id === sel?.id);
    const to = all.findIndex((i) => i.id === id);
    setDir(to < from ? "up" : "down");
    setSelId(id);
  };

  const leaveThen = (fn: () => void) => {
    onClose();
    requestAnimationFrame(fn);
  };
  // Resolving stays here: the next item comes forward; the run carries on in the voice line.
  const resolve = useResolveApproval();
  const retry = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map((id) =>
          apiCall("POST /api/runs/:id/retry", {
            params: { id },
            body: {
              submissionId: crypto.randomUUID(),
            },
          }),
        ),
      ),
    onSuccess: (_res, ids) => {
      // The cause is being handled: it leaves the queue.
      for (const id of ids) pending.silence(id);
      toast(t("concept.focus.rerunning"), "ok");
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const acts = useMemo<Act[]>(() => {
    if (!sel) return [];
    // The pendência becomes the subject: the line opens with its @reference.
    const ask = (text: string): Act => ({
      key: "ask",
      label: t("nucleo.pending.askWhy"),
      icon: <MessageCircleQuestion aria-hidden />,
      run: () => leaveThen(() => askAbout(subjectOf(sel, describePending(sel, t).title), text)),
    });
    switch (sel.kind) {
      case "question": {
        // Answered in the card itself; the run is one step away.
        const runId = typeof sel.approval!.payload?.runId === "string" ? sel.approval!.payload.runId : null;
        return runId
          ? [
              {
                key: "open",
                label: t("nucleo.pending.openRun"),
                icon: <SquareArrowOutUpRight aria-hidden />,
                run: () => leaveThen(() => openRun(runId)),
              },
            ]
          : [];
      }
      case "decision": {
        const a = sel.approval!;
        const d = describeDecision(a, t, t("runs.approve.title"));
        const busy = resolve.isPending && resolve.variables?.id === a.id;
        const out: Act[] = [
          {
            key: "approve",
            label: t("runs.approve.approve"),
            icon: <ShieldCheck aria-hidden />,
            primary: true,
            hint: "A",
            busy,
            run: () => resolve.mutate({ id: a.id, decision: "approved" }),
          },
          {
            key: "deny",
            label: t("runs.approve.deny"),
            icon: <ShieldX aria-hidden />,
            danger: true,
            hint: "D",
            busy,
            run: () => resolve.mutate({ id: a.id, decision: "denied" }),
          },
        ];
        if (d.runId)
          out.push({
            key: "open",
            label: t("nucleo.pending.openRun"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            run: () => leaveThen(() => openRun(d.runId!)),
          });
        return out;
      }
      case "failure": {
        const r = sel.run!;
        const what = r.skillSlug ? `/${r.skillSlug}` : `"${r.promptSummary.slice(0, 60)}"`;
        const fix = failureFix(r.failure, r.provider, r.status)?.action ?? { kind: "retry" as const };
        const primary: Act =
          fix.kind === "login" || fix.kind === "provider"
            ? {
                key: "fix",
                label: t(fix.kind === "login" ? "runs.fix.login" : "runs.fix.providerSettings"),
                icon: <LogIn aria-hidden />,
                primary: true,
                run: () => leaveThen(() => navigate("/settings?tab=providers")),
              }
            : fix.kind === "budget"
              ? {
                  key: "fix",
                  label: t("runs.fix.raise"),
                  icon: <CircleDollarSign aria-hidden />,
                  primary: true,
                  run: () => leaveThen(() => navigate("/settings?tab=security")),
                }
              : fix.kind === "approvals"
                ? {
                    key: "fix",
                    label: t("runs.fix.approvals"),
                    icon: <ShieldAlert aria-hidden />,
                    primary: true,
                    run: () => leaveThen(() => openPanel("approvals")),
                  }
                : {
                    key: "retry",
                    label: t("desktop.attention.rerun"),
                    icon: <RotateCcw aria-hidden />,
                    primary: true,
                    busy: retry.isPending,
                    run: () => retry.mutate([r.id]),
                  };
        return [
          primary,
          {
            key: "open",
            label: t("nucleo.pending.openRun"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            run: () => leaveThen(() => navigate(`/runs/${encodeURIComponent(r.id)}`)),
          },
          ask(t("nucleo.pending.askRunPrompt", { what })),
          {
            key: "mute",
            label: t("desktop.attention.mute"),
            icon: <BellOff aria-hidden />,
            run: () => pending.silence(r.id),
          },
        ];
      }
      case "routine": {
        const r = sel.routine!;
        const failed = (sel.also ?? []).map((i) => i.run!.id);
        const out: Act[] = [
          {
            key: "open",
            label: t("nucleo.pending.openRoutine"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            primary: true,
            run: () => leaveThen(() => navigate(`/routines?r=${encodeURIComponent(r.id)}`)),
          },
        ];
        if (failed.length > 0)
          out.push({
            key: "retry",
            label: t("desktop.attention.rerun"),
            icon: <RotateCcw aria-hidden />,
            busy: retry.isPending,
            run: () => retry.mutate(failed.slice(0, 1)),
          });
        out.push(ask(t("nucleo.pending.askWhyPrompt", { name: r.name, n: r.recentFailures })));
        return out;
      }
      case "provider":
        return [
          {
            key: "open",
            label: t("nucleo.pending.openProvider"),
            icon: <Plug aria-hidden />,
            primary: true,
            run: () => leaveThen(() => navigate("/settings?tab=providers")),
          },
        ];
      case "budget":
        return [
          {
            key: "open",
            label: t("nucleo.pending.raiseBudget"),
            icon: <CircleDollarSign aria-hidden />,
            primary: true,
            run: () => leaveThen(() => navigate("/settings?tab=security")),
          },
        ];
      case "notice": {
        const n = sel.notice!;
        // A row that stands for several notices reads them all.
        const readAll = () => {
          markRead(n.id);
          for (const o of sel.also ?? []) if (o.notice) markRead(o.notice.id);
        };
        const out: Act[] = [];
        if (n.href)
          out.push({
            key: "open",
            label: t("nucleo.pending.openNotice"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            primary: true,
            run: () => {
              readAll();
              leaveThen(() => navigate(n.href!));
            },
          });
        out.push({
          key: "read",
          label: t("nucleo.pending.markRead"),
          icon: <X aria-hidden />,
          primary: !n.href,
          run: readAll,
        });
        return out;
      }
    }
    // The switch is exhaustive; this keeps the return type honest.
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leaveThen/onClose are stable per render
  }, [sel, t, resolve, retry, pending, markRead, navigate, openRun, openPanel]);

  // Keys, in the capture phase: while focused, this is the only surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      // A hint or a popover on a control inside the queue takes this Escape first.
      if (k === "Escape" && escapeLayerOpen()) return;
      let handled = true;
      if (k === "Escape") onClose();
      else if (k === "ArrowDown" || k === "j") {
        const next = list[Math.min(list.length - 1, index + 1)];
        if (next) choose(next.id);
      } else if (k === "ArrowUp" || k === "k") {
        const prev = list[Math.max(0, index - 1)];
        if (prev) choose(prev.id);
      } else if (k === "Enter") acts.find((a) => a.primary)?.run();
      else if ((k === "a" || k === "A") && sel?.kind === "decision")
        acts.find((a) => a.key === "approve")?.run();
      else if ((k === "d" || k === "D") && sel?.kind === "decision")
        acts.find((a) => a.key === "deny")?.run();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choose reads the same state
  }, [list, index, acts, sel, onClose]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  const row = (item: PendingItem) => {
    const text = describePending(item, t);
    return (
      <li key={item.id}>
        <button
          type="button"
          className={item.id === sel?.id ? "on" : undefined}
          aria-current={item.id === sel?.id || undefined}
          data-id={item.id}
          data-kind={item.kind}
          data-level={item.level}
          onClick={() => choose(item.id)}
        >
          <span className="ic">{ICON[item.kind]}</span>
          <span className="tx">
            <span className="lv mono">{t(`nucleo.pending.level.${item.level}`)}</span>
            <span className="tt">{text.title}</span>
          </span>
          <span className="ag mono">
            {item.count ? <span className="nu-focus-times">×{item.count}</span> : timeAgo(item.at, locale)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="nu-focus" role="dialog" aria-modal="true" aria-label={t("nucleo.focus.title")}>
      <header className="nu-focus-head">
        <span className="nu-focus-title">{t("nucleo.focus.title")}</span>
        <span className="nu-focus-count mono">{t("nucleo.pending.count", { n: pending.count })}</span>
        <span className="sp" />
        <span className="nu-focus-keys mono" aria-hidden>
          {t("nucleo.focus.keys")}
        </span>
        <button ref={closeRef} type="button" className="nu-focus-close" onClick={onClose}>
          <X aria-hidden /> {t("nucleo.focus.close")}
        </button>
      </header>
      <div className="nu-focus-body" data-clear={!sel ? "" : undefined}>
        {(live.length > 0 || quiet.length > 0) && (
          <nav className="nu-focus-queue" aria-label={t("nucleo.focus.queue")}>
            {live.length > 0 && <ol>{live.map(row)}</ol>}
            {quiet.length > 0 && (
              <details className="nu-focus-history" open={inQuiet || undefined}>
                <summary className="mono">{t("concept.focus.history", { n: quiet.length })}</summary>
                <ol>{quiet.map(row)}</ol>
              </details>
            )}
          </nav>
        )}
        {ghost && (
          <div className="nu-focus-ghost-lane" aria-hidden>
            <div className="nu-focus-ghost" data-level={ghost.item.level}>
              <p className="nu-focus-reading">{ghost.reading}</p>
              <h2 className="nu-focus-h">{ghost.title}</h2>
            </div>
          </div>
        )}
        {!sel ? (
          <div className="nu-focus-clear">
            <span className="nu-focus-clear-orb" data-testid="focus-entity">
              <Entity variant="iris" state="idle" className="nu-focus-clear-entity" />
            </span>
            <p className="nu-focus-clear-t">{t("nucleo.focus.clear")}</p>
            <p className="nu-focus-clear-s">{t("concept.focus.clearSub")}</p>
            <button type="button" className="nu-act primary" onClick={onClose}>
              <X aria-hidden />
              <span>{t("nucleo.focus.close")}</span>
            </button>
          </div>
        ) : (
          <div className="nu-focus-stage">
            <section
              className="nu-focus-item"
              key={sel.id}
              data-id={sel.id}
              data-kind={sel.kind}
              data-level={sel.level}
              data-dir={dir}
              aria-live="polite"
            >
              <p className="nu-focus-reading">
                <span className="nu-focus-agent" aria-hidden />
                {readingFor(sel, t, (at) => timeAgo(at, locale))}
              </p>
              <FocusDetail item={sel} />
              <div className="nu-focus-acts">
                {acts.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`nu-act${a.primary ? " primary" : ""}${a.danger ? " danger" : ""}`}
                    disabled={a.busy}
                    onClick={a.run}
                  >
                    {a.icon}
                    <span>{a.label}</span>
                    {a.hint && <kbd>{a.hint}</kbd>}
                  </button>
                ))}
              </div>
              <p className="nu-focus-pos mono">{t("concept.focus.pos", { i: index + 1, n: list.length })}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** A pendência as the subject of a question to the agent. */
function subjectOf(item: PendingItem, title: string): Subject {
  const source =
    item.run?.id ??
    item.routine?.id ??
    item.approval?.id ??
    item.notice?.id ??
    item.provider?.snapshot.id ??
    item.kind;
  return {
    id: `subject:${item.id}`,
    kind: item.run ? "run" : "surface",
    ref: refWord("pendencia", source),
    title: `${title} (${item.id})`,
  };
}

/** Everything needed to decide, per kind. The error, when there is one, is said once. */
function FocusDetail({ item }: { item: PendingItem }) {
  const t = useT();
  const locale = useLocale();
  const providers = useOsProviders();
  const text = describePending(item, t);
  const head = (
    <>
      <p className="nu-focus-eyebrow mono">
        {t(`nucleo.pending.level.${item.level}`)} · {timeAgo(item.at, locale)}
      </p>
      <h2 className="nu-focus-h">{text.title}</h2>
    </>
  );
  if (item.kind === "question") {
    return (
      <>
        <p className="nu-focus-eyebrow mono">
          {t("nucleo.pending.kind.question")} · {timeAgo(item.at, locale)}
        </p>
        <QuestionCard approval={item.approval!} />
      </>
    );
  }
  if (item.kind === "decision") {
    const a = item.approval!;
    const d = describeDecision(a, t, t("runs.approve.title"));
    const preview = editPreview(a);
    const lines = preview ? previewLines(preview, 18) : [];
    return (
      <>
        <p className="nu-focus-eyebrow mono">
          {t(a.kind === "tool_use" ? "desktop.decide.paused" : "desktop.decide.held")} ·{" "}
          {timeAgo(item.at, locale)}
        </p>
        <h2 className="nu-focus-h">{d.headline}</h2>
        {d.subject && <code className="nu-focus-subject mono">{d.subject}</code>}
        {d.where && <p className="nu-focus-where mono">{d.where}</p>}
        {a.description && a.description !== d.headline && <p className="nu-focus-p">{a.description}</p>}
        <ApprovalRequest approval={a} />
        {preview && lines.length > 0 && (
          <div className="nu-focus-diff">
            <p className="mono">
              {preview.file} ·{" "}
              {t(preview.kind === "write" ? "desktop.decide.newFile" : "desktop.decide.change")}
            </p>
            <pre className="mono">
              {lines.map((l, i) => (
                <span key={i} className={`dl ${l.kind}`}>
                  {l.kind === "del" ? "− " : "+ "}
                  {l.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
        )}
      </>
    );
  }
  if (item.kind === "failure") {
    const r = item.run!;
    const fix = failureFix(r.failure, r.provider, r.status, providers.data)?.action;
    return (
      <>
        {head}
        {text.subject && <p className="nu-focus-err mono">{text.subject}</p>}
        {fix?.kind === "login" && fix.command && <code className="nu-focus-subject mono">{fix.command}</code>}
      </>
    );
  }
  if (item.kind === "routine") {
    const last = item.also?.[0]?.run;
    const error = last ? (last.failure?.message ?? last.error ?? null) : null;
    return (
      <>
        {head}
        {item.also && item.also.length > 0 && (
          <p className="nu-focus-p">{t("concept.read.routineRuns", { n: item.also.length })}</p>
        )}
        {error && <p className="nu-focus-err mono">{error}</p>}
      </>
    );
  }
  if (item.kind === "provider") {
    const p = item.provider!;
    const cmd =
      p.problem === "not_installed" ? (p.snapshot.installHint ?? null) : (p.snapshot.loginCommand ?? null);
    return (
      <>
        {head}
        {cmd && (
          <>
            <p className="nu-focus-p">{t("nucleo.pending.providerHint")}</p>
            <code className="nu-focus-subject mono">{cmd}</code>
          </>
        )}
      </>
    );
  }
  return (
    <>
      {head}
      {text.subject && <p className="nu-focus-p">{text.subject}</p>}
    </>
  );
}
