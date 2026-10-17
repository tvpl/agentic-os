/**
 * What both shells do the same way. The Núcleo and the app frame answer
 * "open this" differently (a lâmina there, a page or a drawer here), but run
 * a skill, know which skills are in flight, reference a panel in the
 * conversation and listen to the old panel events identically. Each shell
 * supplies only its navigation; the rest lives here so the two cannot drift.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { type RunRecord, type Skill } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { useToast } from "../components/ui";
import { OPEN_PANEL_EVENT } from "../components/CommandPalette";
import { PANEL_ACTION_EVENT, type OpenPanel, type PanelAction } from "./panelKinds";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "./consoleDraft";
import { isActiveStatus } from "./data";

/** Where launching a skill ends up: its inputs form, the approvals, or the run. */
export type RunOutcome = { form: string } | { approvals: true } | { run: string };

/**
 * Launch a skill. A skill with required inputs does not run: its form is
 * the outcome. The returned function is stable, and `onOutcome` may change
 * every render: it is read when the launch answers.
 */
export function useRunSkill(onOutcome: (outcome: RunOutcome) => void): (skill: Skill) => void {
  const t = useT();
  const toast = useToast();
  const outcomeRef = useRef(onOutcome);
  outcomeRef.current = onOutcome;
  const { mutate } = useMutation({
    mutationFn: async (skill: Skill): Promise<RunOutcome> => {
      if (skill.inputs.some((i) => i.required)) return { form: skill.slug };
      const res = await apiCall("POST /api/skills/:slug/run", {
        params: { slug: skill.slug },
        body: {
          inputs: {},
        },
      });
      if (res.status === "waiting_approval" || !res.runId) {
        toast(t("runs.approvalPending"), "info");
        return { approvals: true };
      }
      toast(`▶ /${skill.slug}`, "ok");
      return { run: res.runId };
    },
    onSuccess: (out) => outcomeRef.current(out),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  return mutate;
}

type RunLike = Pick<RunRecord, "skillSlug"> & { status: string };

/** How many runs are in flight. */
export function useActiveRunCount(runs: readonly RunLike[] | undefined): number {
  return useMemo(() => (runs ?? []).filter((r) => isActiveStatus(r.status)).length, [runs]);
}

/** The skills that have a run in flight right now. */
export function useRunningSkills(runs: readonly RunLike[] | undefined): ReadonlySet<string> {
  return useMemo(
    () =>
      new Set((runs ?? []).filter((r) => isActiveStatus(r.status) && r.skillSlug).map((r) => r.skillSlug!)),
    [runs],
  );
}

/** Move focus to the first skill of the skill deck (the empty-state call to action); nothing when no deck is mounted. */
export function focusSkillDeck(): void {
  document.querySelector<HTMLElement>(".skill-deck .deck-skill")?.focus();
}

/** Put `@ref` of an open panel on the conversation's line; an unknown id does nothing. */
export function referencePanel(openPanels: readonly OpenPanel[], id: string): void {
  const panel = openPanels.find((p) => p.id === id);
  if (!panel) return;
  const draft = readConsoleDraft();
  const text = draft.text.trimEnd();
  storeConsoleDraft({ ...draft, text: `${text ? `${text} ` : ""}@${panel.ref} ` });
  window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
}

/** A `referencePanel` bound to the panels currently open. */
export function useReferencePanel(openPanels: readonly OpenPanel[]): (id: string) => void {
  return useCallback((id: string) => referencePanel(openPanels, id), [openPanels]);
}

/**
 * Old callers still speak in panels: the palette's "open panel" and the
 * inbox's "focus"/"close". A shell says what opening and dismissing one means
 * for it. The handlers are read when the event arrives, so passing fresh
 * closures every render neither re-subscribes nor drops an event.
 */
export function usePanelEventBridge(handlers: {
  open: (id: string) => void;
  dismiss: (id: string) => void;
}): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onOpenPanel = (e: Event) => ref.current.open((e as CustomEvent<string>).detail);
    const onAction = (e: Event) => {
      const { id, action } = (e as CustomEvent<{ id: string; action: PanelAction }>).detail;
      if (action === "close" || action === "minimize") ref.current.dismiss(id);
      else ref.current.open(id);
    };
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
    window.addEventListener(PANEL_ACTION_EVENT, onAction);
    return () => {
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
      window.removeEventListener(PANEL_ACTION_EVENT, onAction);
    };
  }, []);
}
