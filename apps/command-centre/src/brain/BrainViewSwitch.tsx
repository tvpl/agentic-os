/**
 * "Grafo | Notas" (.specs/features/cerebro-vista-notas, AC 1; design.md, "Tela - Vista de notas"): the row above the
 * brain in both shells, two `.btn.sm` with `aria-pressed`. The notes view is the route `/brain/notes` (the frame's
 * `main` of `/brain`, the Núcleo's brain scene in its "Notas" mode); the graph is `/brain`, and coming back to it
 * restores the selection and the camera it had (`brain/navigationSnapshot.ts`). The commands "Ver notas" and
 * "Ver grafo" and the key `v` of the `view:brain` scope are registered here, once, for whichever brain is on screen.
 */
import { useCallback, useContext, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, Network } from "lucide-react";
import { useT } from "../i18n";
import "./viewSwitch.css";
import { lazyRoute } from "../lazyRoute";
import { AppRouteContext } from "../desktop/appRoute";
import { useCommands, type Command } from "../commands/registry";

export type BrainMode = "graph" | "notes";
export const GRAPH_PATH = "/brain";
export const NOTES_PATH = "/brain/notes";

/** The notes view, its own chunk: fetched the first time "Notas" is chosen (AC 51). */
export const NotesView = lazyRoute(() => import("./notes/NotesView"));

export interface BrainModeState {
  mode: BrainMode;
  /** Go to a view; `search` is the graph's query (a selection, local mode), empty by default. */
  go: (mode: BrainMode, search?: string) => void;
}

/** Which view of the brain the route is in, and how to move: the panel's route when in one, the router's otherwise. */
export function useBrainMode(): BrainModeState {
  const panel = useContext(AppRouteContext);
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = panel?.pathname ?? location.pathname;
  const mode: BrainMode = pathname.startsWith(NOTES_PATH) ? "notes" : "graph";
  const setLocation = panel?.setLocation;
  const go = useCallback(
    (next: BrainMode, search = "") => {
      const path = next === "notes" ? NOTES_PATH : GRAPH_PATH;
      if (setLocation) setLocation({ pathname: path, search });
      else navigate(`${path}${search}`);
    },
    [setLocation, navigate],
  );
  return { mode, go };
}

/** "Ver notas" on the graph and "Ver grafo" on the notes, each answering `v` (amendment 13: the scope's keys are lower case). */
export function useBrainViewCommands({ mode, go }: BrainModeState): void {
  const commands = useMemo<Command[]>(
    () =>
      mode === "graph"
        ? [
            {
              id: "brain.view.notes",
              title: "notes.cmd.viewNotes",
              group: "view",
              scope: "view:brain",
              icon: FileText,
              keywords: ["notes", "notas", "tree", "árvore", "arvore", "list"],
              palette: true,
              keys: ["v"],
              run: () => go("notes"),
            },
          ]
        : [
            {
              id: "brain.view.graph",
              title: "notes.cmd.viewGraph",
              group: "view",
              scope: "view:brain",
              icon: Network,
              keywords: ["graph", "grafo", "map", "mapa"],
              palette: true,
              keys: ["v"],
              run: () => go("graph"),
            },
          ],
    [mode, go],
  );
  // The classic map of the Núcleo mounts the frame's brain inside the scene: the newest answers.
  useCommands(commands, { exclusive: "brain.view" });
}

export function BrainViewSwitch({
  mode,
  onChoose,
}: {
  mode: BrainMode;
  onChoose: (mode: BrainMode) => void;
}) {
  const t = useT();
  return (
    <div className="brain-viewrow" role="group" aria-label={t("notes.view.label")}>
      <button
        type="button"
        className="btn sm"
        aria-pressed={mode === "graph"}
        onClick={() => mode !== "graph" && onChoose("graph")}
      >
        <Network aria-hidden size={14} />
        {t("notes.view.graph")}
      </button>
      <button
        type="button"
        className="btn sm"
        aria-pressed={mode === "notes"}
        onClick={() => mode !== "notes" && onChoose("notes")}
      >
        <FileText aria-hidden size={14} />
        {t("notes.view.notes")}
      </button>
    </div>
  );
}
