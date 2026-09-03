/**
 * Desktop-level actions a widget may need but must not own (running a skill
 * navigates, configuring one anchors a popover to the card). Passing them
 * through context keeps every registry component to the same
 * `(props: WidgetProps)` signature.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Skill } from "../api";

export interface DesktopActions {
  /** Launch a skill (may navigate to the skill page when it needs inputs). */
  runSkill: (skill: Skill) => void;
  /** Open the anchored MODEL + EFFORT popover for a deck card. */
  configureSkill: (skill: Skill, anchor: HTMLElement) => void;
  /** Move focus to the first deck card (empty-state CTA). */
  focusDeck: () => void;
  /** Ids of the skills that have a run in flight right now. */
  runningSkills: ReadonlySet<string>;
}

const noop = () => undefined;
const DesktopActionsContext = createContext<DesktopActions>({
  runSkill: noop,
  configureSkill: noop,
  focusDeck: noop,
  runningSkills: new Set<string>(),
});

export function DesktopActionsProvider({ value, children }: { value: DesktopActions; children: ReactNode }) {
  return <DesktopActionsContext.Provider value={value}>{children}</DesktopActionsContext.Provider>;
}

export function useDesktopActions(): DesktopActions {
  return useContext(DesktopActionsContext);
}
