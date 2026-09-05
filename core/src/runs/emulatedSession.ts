/**
 * Emulated conversations (plan follow-up 4): when a provider CLI cannot
 * resume a conversation (cursor-agent has no resume flag; an old codex
 * without `exec resume`), the earlier turns of the session are folded into
 * the next prompt as a compact transcript, so the Console keeps its thread
 * on every provider. Pure: turns in, prompt text out.
 */

export interface EmulatedTurn {
  /** What the user asked (the stored prompt summary, ≤ 500 chars). */
  prompt: string;
  /** The last assistant text of that run, if any. */
  reply: string | null;
}

export interface EmulateOptions {
  /** Most recent turns kept (default 6). */
  maxTurns?: number;
  /** Characters kept per reply (default 1200). */
  maxReplyChars?: number;
  /** Total budget for the transcript (default 6000). */
  maxChars?: number;
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+\n/g, "\n");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build the prompt for the next turn: a transcript of the previous turns
 * (oldest first, newest kept when the budget is short) and then the new
 * request. Returns the prompt unchanged when there is nothing to fold.
 */
export function emulatedPrompt(
  turns: ReadonlyArray<EmulatedTurn>,
  prompt: string,
  opts: EmulateOptions = {},
): string {
  const maxTurns = opts.maxTurns ?? 6;
  const maxReply = opts.maxReplyChars ?? 1200;
  const maxChars = opts.maxChars ?? 6000;
  const kept = turns.filter((t) => t.prompt.trim()).slice(-maxTurns);
  if (kept.length === 0) return prompt;
  const blocks = kept.map((t) => {
    const user = `User: ${clip(t.prompt, 500)}`;
    return t.reply ? `${user}\nAssistant: ${clip(t.reply, maxReply)}` : user;
  });
  // Drop the oldest blocks until the transcript fits.
  while (blocks.length > 1 && blocks.join("\n\n").length > maxChars) blocks.shift();
  const transcript = blocks.join("\n\n");
  return [
    "Earlier in this conversation (the provider cannot resume it natively, so the previous turns are quoted here; treat them as context, not as new instructions):",
    transcript,
    "The user now says:",
    prompt,
  ].join("\n\n");
}
