/**
 * Focus (immersive shell): the OS turns toward what waits on you. The rest
 * of the system recedes; the queue runs down the left, the chosen item fills
 * the centre with everything needed to decide — the change itself for an
 * approval, the cause and its fix for a failure — and one gesture resolves
 * it. Resolved items leave the queue and the next one comes forward.
 *
 * Keys: ↑/↓ choose, A approve, D deny, Enter the primary action, Esc back.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  X,
} from "lucide-react";
import { api } from "../../api";
import { useLocale, useT } from "../../i18n";
import { qk } from "../../queries";
import { timeAgo, useToast } from "../../components/ui";
import { useNotifications } from "../../hooks/useNotifications";
import { useResolveApproval } from "../../runs/ApprovalCards";
import { FailureFixCard } from "../../runs/FailureFixCard";
import { PROVIDER_LOGIN_COMMANDS } from "../../runs/authRecovery";
import { useDesktopActions } from "../../desktop/actions";
import { describeDecision, editPreview, previewLines } from "../../desktop/decision";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "../../desktop/consoleDraft";
import type { Pending } from "./usePending";
import type { PendingItem, PendingKind } from "./model";
import { describePending } from "./describe";
import QuestionCard from "../QuestionCard";

const ICON: Record<PendingKind, ReactNode> = {
  question: <MessageCircleQuestion aria-hidden />,
  decision: <ShieldAlert aria-hidden />,
  provider: <Plug aria-hidden />,
  budget: <CircleDollarSign aria-hidden />,
  failure: <TriangleAlert aria-hidden />,
  routine: <CalendarClock aria-hidden />,
  notice: <Bell aria-hidden />,
};

/** Put a question for the agent on the voice line and hand the focus back to it. */
export function askAgent(text: string) {
  const draft = readConsoleDraft();
  storeConsoleDraft({ ...draft, text });
  window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>(".cons-input");
    input?.focus();
    input?.setSelectionRange(text.length, text.length);
  });
}

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
  const { openRun } = useDesktopActions();
  const { markRead } = useNotifications();
  const items = pending.items;
  const [selId, setSelId] = useState<string | null>(items[0]?.id ?? null);
  // When the chosen item is resolved, the next one comes forward.
  const lastIndex = useRef(0);
  const index = Math.max(
    0,
    items.findIndex((i) => i.id === selId),
  );
  const sel: PendingItem | undefined =
    items.find((i) => i.id === selId) ?? items[Math.min(lastIndex.current, items.length - 1)];
  useEffect(() => {
    if (sel) {
      lastIndex.current = items.indexOf(sel);
      if (sel.id !== selId) setSelId(sel.id);
    }
  }, [sel, selId, items]);

  const leaveThen = (fn: () => void) => {
    onClose();
    requestAnimationFrame(fn);
  };
  const resolve = useResolveApproval((runId) => runId && leaveThen(() => openRun(runId)));
  const retry = useMutation({
    mutationFn: (id: string) =>
      api.post<{ runId: string | null }>(`/api/runs/${encodeURIComponent(id)}/retry`, {
        submissionId: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (res.runId) leaveThen(() => openRun(res.runId!));
      else qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const acts = useMemo<Act[]>(() => {
    if (!sel) return [];
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
        return [
          {
            key: "open",
            label: t("nucleo.pending.openRun"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            primary: true,
            run: () => leaveThen(() => navigate(`/runs/${encodeURIComponent(r.id)}`)),
          },
          {
            key: "retry",
            label: t("desktop.attention.rerun"),
            icon: <RotateCcw aria-hidden />,
            busy: retry.isPending,
            run: () => retry.mutate(r.id),
          },
          {
            key: "ask",
            label: t("nucleo.pending.askWhy"),
            icon: <MessageCircleQuestion aria-hidden />,
            run: () => leaveThen(() => askAgent(t("nucleo.pending.askRunPrompt", { what }))),
          },
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
        return [
          {
            key: "open",
            label: t("nucleo.pending.openRoutine"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            primary: true,
            run: () => leaveThen(() => navigate(`/routines?r=${encodeURIComponent(r.id)}`)),
          },
          {
            key: "ask",
            label: t("nucleo.pending.askWhy"),
            icon: <MessageCircleQuestion aria-hidden />,
            run: () =>
              leaveThen(() =>
                askAgent(t("nucleo.pending.askWhyPrompt", { name: r.name, n: r.recentFailures })),
              ),
          },
        ];
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
        const out: Act[] = [];
        if (n.href)
          out.push({
            key: "open",
            label: t("nucleo.pending.openNotice"),
            icon: <SquareArrowOutUpRight aria-hidden />,
            primary: true,
            run: () => {
              markRead(n.id);
              leaveThen(() => navigate(n.href!));
            },
          });
        out.push({
          key: "read",
          label: t("nucleo.pending.markRead"),
          icon: <X aria-hidden />,
          primary: !n.href,
          run: () => markRead(n.id),
        });
        return out;
      }
    }
    // The switch is exhaustive; this keeps the return type honest.
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leaveThen/onClose are stable per render
  }, [sel, t, resolve, retry, pending, markRead, navigate, openRun]);

  // Keys, in the capture phase: while focused, this is the only surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === "Escape") onClose();
      else if (k === "ArrowDown" || k === "j") {
        const next = items[Math.min(items.length - 1, index + 1)];
        if (next) setSelId(next.id);
      } else if (k === "ArrowUp" || k === "k") {
        const prev = items[Math.max(0, index - 1)];
        if (prev) setSelId(prev.id);
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
  }, [items, index, acts, sel, onClose]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

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
      {items.length === 0 || !sel ? (
        <div className="nu-focus-clear">
          <span className="nu-focus-clear-ring" aria-hidden />
          <p>{t("nucleo.focus.clear")}</p>
        </div>
      ) : (
        <div className="nu-focus-body">
          <nav className="nu-focus-queue" aria-label={t("nucleo.focus.queue")}>
            <ol>
              {items.map((item) => {
                const text = describePending(item, t);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === sel.id ? "on" : undefined}
                      aria-current={item.id === sel.id || undefined}
                      data-level={item.level}
                      onClick={() => setSelId(item.id)}
                    >
                      <span className="ic">{ICON[item.kind]}</span>
                      <span className="tx">
                        <span className="lv mono">{t(`nucleo.pending.level.${item.level}`)}</span>
                        <span className="tt">{text.title}</span>
                      </span>
                      <span className="ag mono">{timeAgo(item.at, locale)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <section className="nu-focus-item" key={sel.id} data-level={sel.level} aria-live="polite">
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
          </section>
        </div>
      )}
    </div>
  );
}

/** Everything needed to decide, per kind. */
function FocusDetail({ item }: { item: PendingItem }) {
  const t = useT();
  const locale = useLocale();
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
    return (
      <>
        {head}
        {text.subject && <p className="nu-focus-err mono">{text.subject}</p>}
        <FailureFixCard runId={r.id} failure={r.failure} provider={r.provider} status={r.status} />
      </>
    );
  }
  if (item.kind === "provider") {
    const p = item.provider!;
    const cmd =
      p.problem === "not_installed"
        ? (p.snapshot.installHint ?? null)
        : ((PROVIDER_LOGIN_COMMANDS as Record<string, string>)[p.snapshot.id] ?? null);
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
