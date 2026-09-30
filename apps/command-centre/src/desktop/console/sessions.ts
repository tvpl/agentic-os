/**
 * Conversations (refino item 49): a session's title is the first prompt,
 * bounded by the server; the list shows it as a name of at most six words.
 */
export const TITLE_WORDS = 6;

export function shortTitle(title: string | null | undefined, words = TITLE_WORDS): string {
  const parts = (title ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length <= words) return parts.join(" ");
  return `${parts
    .slice(0, words)
    .join(" ")
    .replace(/[,;:.!?…]+$/, "")}…`;
}
