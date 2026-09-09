/** The text and its target must survive navigation together. */
export interface ConsoleDraft {
  text: string;
  cwd: string;
  /** Undefined only for legacy drafts without session ownership. */
  sessionId?: string | null;
}
const KEY = "mordomo.console.workspaceDraft.v1";
const LEGACY_KEY = "mordomo.console.draft";

export function parseConsoleDraft(raw: string | null, legacy: string | null): ConsoleDraft {
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
  return { text: legacy ?? "", cwd: "" };
}
export function readConsoleDraft(): ConsoleDraft {
  try {
    return parseConsoleDraft(sessionStorage.getItem(KEY), sessionStorage.getItem(LEGACY_KEY));
  } catch {
    return { text: "", cwd: "" };
  }
}
export function storeConsoleDraft(draft: ConsoleDraft): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 1, ...draft, sessionId: draft.sessionId ?? null }));
    sessionStorage.removeItem(LEGACY_KEY);
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
