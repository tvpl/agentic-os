/**
 * Fired when something outside the console changes the draft (a context
 * reference, the onboarding hand-off). The console listens and re-reads.
 */
export const CONSOLE_DRAFT_EVENT = "mordomo:console-draft";

/**
 * Fired by the console when the set of `@references` in the draft changes.
 * The desktop draws a tether to each referenced window, so the link the agent
 * will receive is visible before the prompt is sent.
 */
export const CONSOLE_REFS_EVENT = "mordomo:console-refs";

/** The text and its target must survive navigation together. */
export interface ConsoleDraft {
  text: string;
  cwd: string;
  /** Undefined when the draft predates an explicit conversation choice. */
  sessionId?: string | null;
}
const KEY = "mordomo.console.workspaceDraft.v1";
// Route-to-route handoffs must still work when storage is disabled or full.
let pendingDraft: ConsoleDraft | null = null;

export function parseConsoleDraft(raw: string | null): ConsoleDraft {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 1 &&
      "text" in value &&
      typeof value.text === "string" &&
      "cwd" in value &&
      typeof value.cwd === "string" &&
      "sessionId" in value &&
      (value.sessionId === null || typeof value.sessionId === "string")
    ) {
      return { text: value.text, cwd: value.cwd, sessionId: value.sessionId };
    }
  } catch {
    /* Invalid storage must not break the console. */
  }
  return { text: "", cwd: "" };
}
export function readConsoleDraft(): ConsoleDraft {
  if (pendingDraft) return { ...pendingDraft };
  try {
    return parseConsoleDraft(sessionStorage.getItem(KEY));
  } catch {
    return { text: "", cwd: "" };
  }
}
export function storeConsoleDraft(draft: ConsoleDraft): boolean {
  pendingDraft = { ...draft };
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 1, ...draft, sessionId: draft.sessionId ?? null }));
    pendingDraft = null;
    return true;
  } catch {
    /* Keep in-memory state when browser storage is unavailable. */
    return false;
  }
}

/** Append a source without replacing the user's text or execution context. */
export function withConsoleReference(draft: ConsoleDraft, sourcePath: string, label: string): ConsoleDraft {
  return {
    ...draft,
    text: [draft.text.trimEnd(), `${label}: ${JSON.stringify(sourcePath)}`].filter(Boolean).join("\n\n"),
  };
}
