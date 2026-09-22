/**
 * Hands-free (refino item 3): what the agent says out loud is the gist,
 * not the trace. One or two sentences, never a path, never a code block,
 * capped so a long answer is an invitation to read, not a monologue.
 * Pure and tested.
 */
export const SPOKEN_MAX = 220;
export const HANDS_FREE_KEY = "mordomo.console.handsFree";

export function spokenSummary(text: string, max = SPOKEN_MAX): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[*_#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const sentences = plain.split(/(?<=[.!?…])\s+/);
  let out = "";
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
    if (out.split(/(?<=[.!?…])\s+/).length >= 2) break;
  }
  if (!out) out = plain.slice(0, max - 1).trimEnd() + "…";
  return out;
}

export function readHandsFree(): boolean {
  try {
    return localStorage.getItem(HANDS_FREE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeHandsFree(on: boolean): void {
  try {
    localStorage.setItem(HANDS_FREE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
