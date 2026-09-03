/**
 * Per-skill run form draft kept in sessionStorage so navigating to a run and
 * back (or to Settings for an approval) never loses what was typed.
 * Pure functions over a Storage-like object so they are unit-testable.
 */
export interface RunDraft {
  provider?: string;
  model?: string | null;
  effort?: string;
  inputs: Record<string, string>;
}

export const DRAFT_PREFIX = "mordomo.skillrun.";

export function draftKey(slug: string): string {
  return `${DRAFT_PREFIX}${slug}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(explicit?: StorageLike): StorageLike | null {
  if (explicit) return explicit;
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readDraft(slug: string, storage?: StorageLike): RunDraft | null {
  const s = store(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(draftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const inputs: Record<string, string> = {};
    if (parsed.inputs && typeof parsed.inputs === "object") {
      for (const [k, v] of Object.entries(parsed.inputs)) if (typeof v === "string") inputs[k] = v;
    }
    return {
      provider: typeof parsed.provider === "string" ? parsed.provider : undefined,
      model: typeof parsed.model === "string" ? parsed.model : parsed.model === null ? null : undefined,
      effort: typeof parsed.effort === "string" ? parsed.effort : undefined,
      inputs,
    };
  } catch {
    return null;
  }
}

/** Persist a draft; an empty draft (no inputs, no choices) removes the entry. */
export function writeDraft(slug: string, draft: RunDraft, storage?: StorageLike): void {
  const s = store(storage);
  if (!s) return;
  try {
    if (isEmptyDraft(draft)) s.removeItem(draftKey(slug));
    else s.setItem(draftKey(slug), JSON.stringify(draft));
  } catch {
    /* quota / private mode: drafts are a convenience only */
  }
}

export function clearDraft(slug: string, storage?: StorageLike): void {
  try {
    store(storage)?.removeItem(draftKey(slug));
  } catch {
    /* ignore */
  }
}

export function isEmptyDraft(d: RunDraft): boolean {
  const hasInput = Object.values(d.inputs).some((v) => v.trim() !== "");
  return !hasInput && d.provider === undefined && (d.model === undefined || d.model === null || d.model === "") && d.effort === undefined;
}
