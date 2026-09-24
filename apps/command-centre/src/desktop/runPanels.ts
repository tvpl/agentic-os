/**
 * The panels a run produces (redesign G3): its trace while it runs, and the
 * form a skill asks for before it starts. Both are addressed by id, the way
 * every panel is, so a reopened desktop knows what to put back.
 */
import type { Size } from "./windowModel";

const RUN = "run:";
const FORM = "form:";

export const runPanelId = (runId: string): string => RUN + runId;
export const isRunPanelId = (id: string): boolean => id.startsWith(RUN);
export const runIdOf = (id: string): string => id.slice(RUN.length);

export const formPanelId = (slug: string): string => FORM + slug;
export const isFormPanelId = (id: string): boolean => id.startsWith(FORM);
export const formSlugOf = (id: string): string => id.slice(FORM.length);

/** A trace wants room for the timeline; a form is a short column of fields. */
export const RUN_BOX: Size = { w: 620, h: 460 };
export const FORM_BOX: Size = { w: 460, h: 380 };

/** `run-41 · /skill`: the prototype's title, from what the record knows. */
export function runPanelTitle(runId: string, skillSlug: string | null | undefined): string {
  const short = runId.length > 8 ? runId.slice(0, 8) : runId;
  return skillSlug ? `run-${short} · /${skillSlug}` : `run-${short}`;
}
