/**
 * Model → context window (tokens). Providers never send the window size, so
 * this small table backs the context meter; unknown models yield null ("n/a").
 */
export interface ModelWindow {
  match: RegExp;
  window: number;
}

export const MODEL_WINDOWS: readonly ModelWindow[] = [
  { match: /\[1m\]|-1m\b|1m-context/i, window: 1_000_000 },
  { match: /gemini/i, window: 1_000_000 },
  { match: /gpt-5|gpt-4\.1/i, window: 400_000 },
  { match: /gpt-4o|gpt-4-turbo/i, window: 128_000 },
  { match: /^o[1-4](-|$)/i, window: 200_000 },
  { match: /claude|sonnet|opus|haiku/i, window: 200_000 },
];

export function contextWindowFor(model: string | null | undefined): number | null {
  if (!model) return null;
  for (const entry of MODEL_WINDOWS) if (entry.match.test(model)) return entry.window;
  return null;
}
