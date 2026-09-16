/**
 * What a panel is (redesign G1). The prototype has one primitive on the
 * stage and six kinds of it; the kind decides the glyph in the header, the
 * body padding and, later, how a reference to it expands for the agent.
 *
 * The kind is read off the id rather than stored: `doc:<path>` is an
 * artifact, `app:<name>` an app, `run:<id>` a trace, and a bare registry id
 * is an instrument surface. A layout is then self-describing, and a reopened
 * desktop knows what to render without a second lookup.
 */
export type PanelKind = "app" | "artifact" | "run" | "surface" | "image" | "node";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

export function panelKind(id: string): PanelKind {
  if (id.startsWith("doc:")) return IMAGE.test(id) ? "image" : "artifact";
  if (id.startsWith("app:")) return "app";
  if (id.startsWith("run:")) return "run";
  if (id.startsWith("node:")) return "node";
  return "surface";
}

/** The header glyph per kind — the prototype's, so a panel reads the same in both. */
export const PANEL_GLYPH: Record<PanelKind, string> = {
  artifact: "◈",
  run: "⎔",
  surface: "◉",
  app: "⬡",
  image: "▦",
  node: "✦",
};

/**
 * What the dock and the console tray need to know about an open panel. Kept
 * in a tiny external store because the dock lives outside the desktop route
 * and the console outside the layer, and a window event is how the desktop
 * already talks to both.
 */
export interface OpenPanel {
  id: string;
  kind: PanelKind;
  /** The `@name` the console resolves; one word. */
  ref: string;
  title: string;
  /** A file the agent can read; only artifacts and images carry one. */
  path?: string;
  /** Parked in the dock rather than on the stage. */
  minimized: boolean;
  /** Something is running inside it right now (a trace still streaming). */
  live?: boolean;
}

type Listener = () => void;
let panels: readonly OpenPanel[] = [];
const listeners = new Set<Listener>();

export function publishPanels(next: readonly OpenPanel[]): void {
  panels = next;
  for (const fn of listeners) fn();
}
export function subscribePanels(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getPanels(): readonly OpenPanel[] {
  return panels;
}

/** What the dock asks the desktop to do with a panel. */
export type PanelAction = "focus" | "minimize" | "restore";
export const PANEL_ACTION_EVENT = "mordomo:panel-action";
export function requestPanelAction(id: string, action: PanelAction): void {
  window.dispatchEvent(
    new CustomEvent<{ id: string; action: PanelAction }>(PANEL_ACTION_EVENT, { detail: { id, action } }),
  );
}
