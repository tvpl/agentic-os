/**
 * The console's control line (prototype `#ctl`): mode · folder · model and
 * effort · provider · new conversation · turns and cost. Each one is a small
 * chamfered control; the readout at the end doubles as the switch that
 * shows or hides the conversation above the field.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type ProviderId,
  type ProviderSnapshot,
  type SessionDetail,
  type SessionRecord,
} from "../../api";
import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { timeAgo, useToast } from "../../components/ui";
import { DialogPortal, useDialog, usePresence } from "../../components/dialog";
import { ModelEffortMatrix, shortModel, type Effort } from "../SkillMatrixModal";
import { providerProblem } from "../../components/providerReadiness";
import type { Estimate } from "../estimate";
import type { BudgetState } from "../budget";
import { Link } from "react-router-dom";
import type { FolderOption } from "./refs";
import { shortTitle } from "./sessions";

export type Mode = "read_only" | "write";

export interface ModelChoice {
  model: string | null;
  effort: Effort;
}

export function ConsoleControls({
  mode,
  onMode,
  cwd,
  onCwd,
  cwdUnavailable,
  folders,
  sessionLocked,
  provider,
  providers,
  choice,
  onChoice,
  session,
  onNewChat,
  onPickSession,
  threadOpen,
  onToggleThread,
  estimate,
  budget,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  cwd: string;
  onCwd: (cwd: string) => void;
  cwdUnavailable: boolean;
  folders: FolderOption[];
  /** A conversation is under way: folder and provider belong to it now. */
  sessionLocked: boolean;
  provider: ProviderId | undefined;
  providers: ProviderSnapshot[];
  choice: ModelChoice;
  onChoice: (choice: ModelChoice) => void;
  session: SessionDetail | undefined;
  onNewChat: () => void;
  /** Resume a conversation from the list (refino item 49). */
  onPickSession: (id: string) => void;
  threadOpen: boolean;
  onToggleThread: () => void;
  /** What the next run will probably cost (refino item 39). */
  estimate: Estimate | null;
  budget: BudgetState;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [modelOpen, setModelOpen] = useState(false);
  const modelBtn = useRef<HTMLButtonElement>(null);
  const [convOpen, setConvOpen] = useState(false);
  const convBtn = useRef<HTMLButtonElement>(null);

  // The provider control cycles the enabled providers; the default is what a
  // fresh conversation will use, so that is what it sets.
  const switchDefault = useMutation({
    mutationFn: (next: ProviderId) => api.put("/api/providers/default", { provider: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.providers }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.meta }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const cycleProvider = () => {
    if (!provider || providers.length < 2) return;
    const i = providers.findIndex((p) => p.id === provider);
    switchDefault.mutate(providers[(i + 1) % providers.length]!.id);
  };

  const turns = session?.session.turns ?? 0;
  const cost = session?.session.costUsd ?? 0;
  // The provider's state is on the chip (refino item 44): red before a run fails.
  const current = providers.find((p) => p.id === (session?.session.provider ?? provider));
  const problem = current ? providerProblem(current) : null;
  const money = (v: number) => `US$ ${v.toFixed(2)}`;
  const secs = (ms: number) =>
    ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;

  return (
    <div className="cons-ctl">
      <div className="seg" role="radiogroup" aria-label={t("desktop.prompt.mode")}>
        {(["read_only", "write"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)}>
            {t(m === "read_only" ? "desktop.prompt.readOnly" : "desktop.prompt.write")}
          </button>
        ))}
      </div>
      {sessionLocked ? (
        <span className="cc static" title={t("desktop.prompt.cwd")}>
          <span aria-hidden>▤</span>
          {folderLabel(session?.session.cwd ?? cwd, folders, t("desktop.prompt.cwdHome"))}
        </span>
      ) : (
        <label className="cc" title={t("desktop.prompt.cwd")}>
          <span aria-hidden>▤</span>
          <select
            className="cons-cwd"
            value={cwd}
            onChange={(e) => onCwd(e.target.value)}
            aria-label={t("desktop.prompt.cwd")}
          >
            <option value="">{t("desktop.prompt.cwdHome")}</option>
            {cwdUnavailable && (
              <option value={cwd} disabled>
                {cwd}
              </option>
            )}
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="cc"
        ref={modelBtn}
        aria-haspopup="dialog"
        aria-expanded={modelOpen}
        title={
          choice.model
            ? t("desktop.console.model")
            : t("desktop.console.autoHint", { provider: provider ?? "" })
        }
        onClick={() => setModelOpen((v) => !v)}
        disabled={!provider}
      >
        <span aria-hidden>◆</span>
        {shortModel(choice.model).toLowerCase()} · {t(`desktop.console.effort.${choice.effort}`)}
      </button>
      {provider && modelBtn.current && (
        <ModelPopover
          open={modelOpen}
          anchor={modelBtn.current}
          provider={provider}
          choice={choice}
          onChoice={onChoice}
          onClose={() => setModelOpen(false)}
        />
      )}
      <button
        type="button"
        className={`cc${problem ? " warn" : ""}`}
        title={
          problem
            ? `${t("desktop.prompt.provider")}: ${t(`gate.state.${problem}` as "gate.state.login_required")}`
            : t("desktop.prompt.provider")
        }
        aria-label={`${t("desktop.prompt.provider")}: ${session?.session.provider ?? provider ?? ""}`}
        onClick={cycleProvider}
        disabled={sessionLocked || providers.length < 2 || switchDefault.isPending}
      >
        <span aria-hidden>●</span>
        {session?.session.provider ?? provider ?? "—"}
      </button>
      <button
        type="button"
        className="cc"
        ref={convBtn}
        aria-haspopup="dialog"
        aria-expanded={convOpen}
        title={t("desktop.console.conversations")}
        onClick={() => setConvOpen((v) => !v)}
      >
        <span aria-hidden>◷</span>
        {session
          ? shortTitle(session.session.title) || t("desktop.console.conversations")
          : t("desktop.console.conversations")}
      </button>
      {convBtn.current && (
        <ConversationsPopover
          open={convOpen}
          anchor={convBtn.current}
          currentId={session?.session.id ?? null}
          onPick={(id) => {
            onPickSession(id);
            setConvOpen(false);
          }}
          onClose={() => setConvOpen(false)}
        />
      )}
      <button type="button" className="cc" onClick={onNewChat} disabled={!session && turns === 0}>
        <span aria-hidden>＋</span>
        {t("desktop.console.newChat")}
      </button>
      {estimate && (estimate.usd !== null || estimate.ms !== null) && (
        <span
          className="cc static estimate"
          title={t("desktop.estimateHint", { n: estimate.samples })}
          data-testid="console-estimate"
        >
          {t("desktop.estimate", {
            usd: estimate.usd !== null ? money(estimate.usd) : "—",
            time: estimate.ms !== null ? secs(estimate.ms) : "—",
          })}
        </span>
      )}
      {budget.tone !== "off" && (
        <Link
          to="/settings?tab=security"
          className={`cc static budget ${budget.tone}`}
          title={t("desktop.cost.budget")}
        >
          {budget.tone === "over"
            ? t("desktop.budget.raise")
            : t("desktop.budget.left", { usd: money(Math.max(0, budget.budgetUsd - budget.spentUsd)) })}
        </Link>
      )}
      <button
        type="button"
        className="ro"
        aria-expanded={threadOpen}
        aria-label={t(threadOpen ? "desktop.console.threadHide" : "desktop.console.thread")}
        title={t(threadOpen ? "desktop.console.threadHide" : "desktop.console.thread")}
        onClick={onToggleThread}
      >
        {t("desktop.console.turns", { n: turns })} · ${cost.toFixed(3)}
      </button>
    </div>
  );
}

function folderLabel(path: string, folders: FolderOption[], home: string): string {
  if (!path) return home;
  return folders.find((f) => f.path === path)?.label ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const POP_W = 300;

/** The MODEL + EFFORT matrix over the control, for the next prompt run. */
function ModelPopover({
  open,
  anchor,
  provider,
  choice,
  onChoice,
  onClose,
}: {
  open: boolean;
  anchor: HTMLElement;
  provider: ProviderId;
  choice: ModelChoice;
  onChoice: (choice: ModelChoice) => void;
  onClose: () => void;
}) {
  // Presence out here, the dialog inside: `useDialog` registers on mount.
  const { mounted, closing } = usePresence(open, 160);
  if (!mounted) return null;
  return (
    <ModelPopoverBox
      anchor={anchor}
      provider={provider}
      choice={choice}
      onChoice={onChoice}
      onClose={onClose}
      closing={closing}
    />
  );
}

function ModelPopoverBox({
  anchor,
  provider,
  choice,
  onChoice,
  onClose,
  closing,
}: {
  anchor: HTMLElement;
  provider: ProviderId;
  choice: ModelChoice;
  onChoice: (choice: ModelChoice) => void;
  onClose: () => void;
  closing: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  useDialog(ref, onClose, { initialFocus: () => ref.current });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - POP_W - 8, r.left)),
      bottom: window.innerHeight - r.top + 6,
    });
  }, [anchor]);
  return (
    <DialogPortal>
      <div
        ref={ref}
        className={`me-popover above cons-model${closing ? " closing" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label={t("desktop.console.model")}
        tabIndex={-1}
        style={{ left: pos.left, bottom: pos.bottom, width: POP_W }}
      >
        <div className="me-head">
          <span className="hud-label accent">{t("desktop.deck.modelEffort")}</span>
          <span className="mono me-skill">{provider}</span>
        </div>
        <ModelEffortMatrix
          provider={provider}
          model={choice.model}
          effort={choice.effort}
          onPick={(model, effort) => {
            onChoice({ model, effort });
            onClose();
          }}
        />
      </div>
    </DialogPortal>
  );
}

/** The conversations, newest first: resume, rename, forget (refino item 49). */
function ConversationsPopover({
  open,
  anchor,
  currentId,
  onPick,
  onClose,
}: {
  open: boolean;
  anchor: HTMLElement;
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { mounted, closing } = usePresence(open, 160);
  if (!mounted) return null;
  return (
    <ConversationsBox
      anchor={anchor}
      currentId={currentId}
      onPick={onPick}
      onClose={onClose}
      closing={closing}
    />
  );
}

function ConversationsBox({
  anchor,
  currentId,
  onPick,
  onClose,
  closing,
}: {
  anchor: HTMLElement;
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  closing: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  useDialog(ref, onClose, { initialFocus: () => ref.current });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - CONV_W - 8, r.left)),
      bottom: window.innerHeight - r.top + 6,
    });
  }, [anchor]);
  const sessions = useApiQuery<SessionRecord[]>(["sessions", "list", 20], "/api/sessions?limit=20", {
    staleTime: 10_000,
  });
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch(`/api/sessions/${encodeURIComponent(id)}`, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const forget = useMutation({
    mutationFn: (id: string) => api.del(`/api/sessions/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const rows = sessions.data ?? [];
  return (
    <DialogPortal>
      <div
        ref={ref}
        className={`me-popover above cons-conversations${closing ? " closing" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-label={t("desktop.console.conversations")}
        tabIndex={-1}
        style={{ left: pos.left, bottom: pos.bottom, width: CONV_W }}
      >
        <div className="me-head">
          <span className="hud-label accent">{t("desktop.console.conversations")}</span>
          <span className="mono me-skill">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className="dim conv-empty">{t("desktop.console.noConversations")}</p>
        ) : (
          <ul className="conv-list">
            {rows.map((row) => (
              <li key={row.id} className={row.id === currentId ? "on" : ""}>
                <button type="button" className="conv-main" onClick={() => onPick(row.id)}>
                  <span className="conv-title">{shortTitle(row.title) || row.id.slice(0, 8)}</span>
                  <span className="conv-sub mono">
                    {row.provider} · {t("desktop.console.turns", { n: row.turns })} · $
                    {row.costUsd.toFixed(3)} · {timeAgo(row.updatedAt, locale)}
                  </span>
                </button>
                <button
                  type="button"
                  className="conv-act"
                  aria-label={t("desktop.console.rename")}
                  title={t("desktop.console.rename")}
                  onClick={() => {
                    const next = window.prompt(t("desktop.console.rename"), row.title);
                    if (next && next.trim() && next.trim() !== row.title)
                      rename.mutate({ id: row.id, title: next.trim() });
                  }}
                >
                  <Pencil aria-hidden />
                </button>
                <button
                  type="button"
                  className="conv-act"
                  aria-label={t("desktop.console.forget")}
                  title={t("desktop.console.forget")}
                  onClick={() => forget.mutate(row.id)}
                >
                  <Trash2 aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogPortal>
  );
}

const CONV_W = 360;
