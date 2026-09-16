/**
 * The console's control line (prototype `#ctl`): mode · folder · model and
 * effort · provider · new conversation · turns and cost. Each one is a small
 * chamfered control; the readout at the end doubles as the switch that
 * shows or hides the conversation above the field.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProviderId, type ProviderSnapshot, type SessionDetail } from "../../api";
import { useT } from "../../i18n";
import { qk } from "../../queries";
import { useToast } from "../../components/ui";
import { DialogPortal, useDialog, usePresence } from "../../components/dialog";
import { ModelEffortMatrix, shortModel, type Effort } from "../SkillMatrixModal";
import type { FolderOption } from "./refs";

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
  threadOpen,
  onToggleThread,
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
  threadOpen: boolean;
  onToggleThread: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [modelOpen, setModelOpen] = useState(false);
  const modelBtn = useRef<HTMLButtonElement>(null);

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
        title={t("desktop.console.model")}
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
        className="cc"
        title={t("desktop.prompt.provider")}
        aria-label={`${t("desktop.prompt.provider")}: ${session?.session.provider ?? provider ?? ""}`}
        onClick={cycleProvider}
        disabled={sessionLocked || providers.length < 2 || switchDefault.isPending}
      >
        <span aria-hidden>●</span>
        {session?.session.provider ?? provider ?? "—"}
      </button>
      <button type="button" className="cc" onClick={onNewChat} disabled={!session && turns === 0}>
        <span aria-hidden>＋</span>
        {t("desktop.console.newChat")}
      </button>
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
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, 160);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  useDialog(ref, onClose, { initialFocus: () => ref.current });
  useLayoutEffect(() => {
    if (!open) return;
    const r = anchor.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - POP_W - 8, r.left)),
      bottom: window.innerHeight - r.top + 6,
    });
  }, [open, anchor]);
  if (!mounted) return null;
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
