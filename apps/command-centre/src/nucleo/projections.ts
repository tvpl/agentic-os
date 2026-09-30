/**
 * Lâminas (immersive shell): what the conversation projects beside the core.
 *
 * Not windows — no drag, no resize, no stacking. The agent (or a click on a
 * signal) projects one; a second one sits beside it; a third pushes the
 * oldest out. They dissolve when dismissed and are forgotten with the tab.
 * A lâmina is named by the same ids the panels used: a registry id
 * (`attention`), `run:<id>`, `doc:<path>` or `form:<slug>`.
 */
import { useSyncExternalStore } from "react";

export const MAX_LAMINAS = 2;
const KEY = "mordomo.laminas.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): readonly string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string").slice(-MAX_LAMINAS)
      : [];
  } catch {
    return [];
  }
}
let items: readonly string[] = typeof window === "undefined" ? [] : read();

function set(next: readonly string[]) {
  items = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: they last for the page */
  }
  for (const fn of listeners) fn();
}

/** Pure: `id` projected onto `list` — moved to the newest place, the oldest pushed out past the cap. */
export function withProjected(list: readonly string[], id: string, max = MAX_LAMINAS): string[] {
  return [...list.filter((x) => x !== id), id].slice(-max);
}

export function project(id: string): void {
  set(withProjected(items, id));
}
export function dismiss(id: string): void {
  if (!items.includes(id)) return;
  set(items.filter((x) => x !== id));
}
/** The newest lâmina goes (Escape). Returns whether there was one. */
export function dismissNewest(): boolean {
  const last = items[items.length - 1];
  if (last === undefined) return false;
  dismiss(last);
  return true;
}
export function getLaminas(): readonly string[] {
  return items;
}
export function subscribeLaminas(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useLaminas(): readonly string[] {
  return useSyncExternalStore(subscribeLaminas, getLaminas, getLaminas);
}
/** Tests only. */
export function resetLaminas(): void {
  set([]);
}
