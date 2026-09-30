/**
 * The panels a run produces (redesign G3): its trace while it runs, and the
 * form a skill asks for before it starts. Both are addressed by id, the way
 * every lâmina is, so the shell knows what to render from the id alone.
 */
const RUN = "run:";
const FORM = "form:";

export const runPanelId = (runId: string): string => RUN + runId;
export const isRunPanelId = (id: string): boolean => id.startsWith(RUN);
export const runIdOf = (id: string): string => id.slice(RUN.length);

export const formPanelId = (slug: string): string => FORM + slug;
export const isFormPanelId = (id: string): boolean => id.startsWith(FORM);
export const formSlugOf = (id: string): string => id.slice(FORM.length);

/** `run-41 · /skill`: the prototype's title, from what the record knows. */
export function runPanelTitle(runId: string, skillSlug: string | null | undefined): string {
  const short = runId.length > 8 ? runId.slice(0, 8) : runId;
  return skillSlug ? `run-${short} · /${skillSlug}` : `run-${short}`;
}
