/**
 * The desktop's modes as the dock sees them (redesign G5). The dock lives
 * outside the desktop — it is the shell's — so it asks for a mode with an
 * event and reads the current one from a small store, the same way it lists
 * the open panels (`panelKinds.ts`).
 */
import { useSyncExternalStore } from "react";

export type DesktopAction = "overview" | "tile" | "hud";
export const DESKTOP_ACTION_EVENT = "mordomo:desktop-action";

export function requestDesktopAction(action: DesktopAction) {
  window.dispatchEvent(new CustomEvent<DesktopAction>(DESKTOP_ACTION_EVENT, { detail: action }));
}

export interface DesktopModes {
  /** The camera is pulled back. */
  overview: boolean;
  /** The HUD is being edited: pods wobble, ✕ removes, + adds. */
  editing: boolean;
}

const IDLE: DesktopModes = { overview: false, editing: false };
let current: DesktopModes = IDLE;
const listeners = new Set<() => void>();

export function publishDesktopModes(next: DesktopModes) {
  if (next.overview === current.overview && next.editing === current.editing) return;
  current = next;
  for (const fn of listeners) fn();
}
export function getDesktopModes(): DesktopModes {
  return current;
}
export function subscribeDesktopModes(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useDesktopModes(): DesktopModes {
  return useSyncExternalStore(subscribeDesktopModes, getDesktopModes, () => IDLE);
}
