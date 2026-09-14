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
  /**
   * Document windows currently on the stage, newest first. The console shows
   * them as context chips and resolves `@ref` against them, so what is open
   * is what the agent can be pointed at (redesign F5).
   */
  openDocs: ReadonlyArray<{ id: string; ref: string; path: string }>;
  /** Open a file as a window on the stage (idempotent: focuses an open one). */
  openDoc: (path: string) => void;
  /** Insert `@ref` for a document window into the console draft. */
  referenceDoc: (id: string) => void;
}

const noop = () => undefined;
const DesktopActionsContext = createContext<DesktopActions>({
  runSkill: noop,
  configureSkill: noop,
  focusDeck: noop,
  runningSkills: new Set<string>(),
  openDocs: [],
  openDoc: noop,
  referenceDoc: noop,
});

export function DesktopActionsProvider({ value, children }: { value: DesktopActions; children: ReactNode }) {
  return <DesktopActionsContext.Provider value={value}>{children}</DesktopActionsContext.Provider>;
}

export function useDesktopActions(): DesktopActions {
  return useContext(DesktopActionsContext);
}
