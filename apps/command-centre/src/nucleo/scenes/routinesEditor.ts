/**
 * The routine editor the Routines scene reuses: the production view's
 * `RoutineModal` (views/Routines.tsx), opened directly on "edit" and "new".
 */
import type { ComponentType } from "react";
import type { RoutineStatus, Skill } from "../../api";
import RoutinesView, { RoutineModal } from "../../views/Routines";

export interface RoutineEditorProps {
  routine: RoutineStatus | null;
  skills: Skill[];
  allowWebhooks: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** The production editor. */
export const RoutineEditor: ComponentType<RoutineEditorProps> | null = RoutineModal;

/** The production view itself: the fallback, and the "classic" way in. */
export const RoutinesClassic: ComponentType = RoutinesView;

/** `settings.routines.allowWebhooks`, read defensively (the settings payload is untyped). */
export function allowWebhooks(settings: unknown): boolean {
  const routines = (settings as { routines?: { allowWebhooks?: unknown } } | undefined)?.routines;
  return routines?.allowWebhooks === true;
}
