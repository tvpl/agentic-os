/**
 * The shell's window events, in one place so the voice line (which lives in
 * `desktop/console`) can talk to the shell without importing it.
 */

/** Open the focus mode (the pendências). */
export const FOCUS_EVENT = "mordomo:focus";
/** The agent's live activity, as humanized lines (`HumanEvent[]`), newest last. */
export const ACTIVITY_EVENT = "mordomo:activity";
/** Reply text arrived: `{ chars }` more characters. The entity speaks with it. */
export const SPEAK_EVENT = "mordomo:speak";

export function openFocus(): void {
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** Talk to the agent: the conversation opens and the microphone listens. */
export const LISTEN_EVENT = "mordomo:listen";
export function talk(): void {
  window.dispatchEvent(new Event(LISTEN_EVENT));
}
