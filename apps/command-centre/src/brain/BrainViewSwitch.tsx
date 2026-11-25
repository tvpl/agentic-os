/**
 * "Grafo | Notas" (.specs/features/cerebro-vista-notas, AC 1; design.md, "Tela - Vista de notas"): the row above the
 * brain in both shells, two `.btn.sm` with `aria-pressed`. The notes view is the route `/brain/notes` (the frame's
 * `main` of `/brain`, the Núcleo's brain scene in its "Notas" mode); the graph is `/brain`, and coming back to it
 * restores the selection and the camera it had (`brain/navigationSnapshot.ts`). The commands "Ver notas" and
 * "Ver grafo" and the key `v` of the `view:brain` scope are registered here, once, for whichever brain is on screen.
 */
import { useCallback, useContext, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FileText, MessageSquare, Network } from "lucide-react";
import { useT } from "../i18n";
import "./viewSwitch.css";
import { lazyRoute } from "../lazyRoute";
import { AppRouteContext } from "../desktop/appRoute";
import { useCommands, type Command } from "../commands/registry";
import { REVIEWS_PATH } from "./natureza";

export type BrainMode = "graph" | "notes" | "reviews" | "weekly" | "ask" | "entities" | "summaries";
export const GRAPH_PATH = "/brain";
export const NOTES_PATH = "/brain/notes";
/** "Revisão semanal" (.specs/features/cerebro-rituais, S5): the page's route, in both shells. */
export const WEEKLY_PATH = "/brain/weekly";
/** "Perguntar" (.specs/features/cerebro-perguntar, S5, door 6): the view's route, in both shells. */
export const ASK_PATH = "/brain/ask";
/** "Entidades" (.specs/features/cerebro-entidades-resumos, S6, door 8): the view's route, in both shells (`?key=`). */
export const ENTITIES_PATH = "/brain/entities";
/** "Resumos" (.specs/features/cerebro-entidades-resumos, S7, door 8): the view's route, in both shells (`?kind=&id=`). */
export const SUMMARIES_PATH = "/brain/summaries";

/** The notes view, its own chunk: fetched the first time "Notas" is chosen (AC 51). */
export const NotesView = lazyRoute(() => import("./notes/NotesView"));
/** "Revisões" (.specs/features/cerebro-natureza, S5), its own chunk: fetched the first time it is opened (C92). */
export const ReviewsView = lazyRoute(() => import("./reviews/ReviewsScreen"));
/** "Revisão semanal" (.specs/features/cerebro-rituais, S5), its own chunk: fetched the first time it is opened. */
export const WeeklyView = lazyRoute(() => import("./weekly/WeeklyReview"));
/** "Perguntar" (.specs/features/cerebro-perguntar, AC 54), its own chunk: fetched the first time /brain/ask opens. */
export const AskView = lazyRoute(() => import("./ask/AskView"));
/** "Entidades" (.specs/features/cerebro-entidades-resumos, AC 85), its own chunk: fetched the first time it opens. */
export const EntitiesView = lazyRoute(() => import("./entities/EntitiesView"));
/** "Resumos" (.specs/features/cerebro-entidades-resumos, AC 85), its own chunk: fetched the first time it opens. */
export const SummariesView = lazyRoute(() => import("./summaries/SummariesView"));

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
  const mode: BrainMode = pathname.startsWith(NOTES_PATH)
    ? "notes"
    : pathname.startsWith(REVIEWS_PATH)
      ? "reviews"
      : pathname.startsWith(WEEKLY_PATH)
        ? "weekly"
        : pathname.startsWith(ASK_PATH)
          ? "ask"
          : pathname.startsWith(ENTITIES_PATH)
            ? "entities"
            : pathname.startsWith(SUMMARIES_PATH)
              ? "summaries"
              : "graph";
  const setLocation = panel?.setLocation;
  const go = useCallback(
    (next: BrainMode, search = "") => {
      const path =
        next === "notes"
          ? NOTES_PATH
          : next === "reviews"
            ? REVIEWS_PATH
            : next === "weekly"
              ? WEEKLY_PATH
              : next === "ask"
                ? ASK_PATH
                : next === "entities"
                  ? ENTITIES_PATH
                  : next === "summaries"
                    ? SUMMARIES_PATH
                    : GRAPH_PATH;
      if (setLocation) setLocation({ pathname: path, search });
      else navigate(`${path}${search}`);
    },
    [setLocation, navigate],
  );
  return { mode, go };
}

/**
 * "Ver notas" on the graph and "Ver grafo" on the notes, each answering `v` (amendment 13: the scope's keys are lower
 * case), and `a`, which opens "Perguntar" (cerebro-perguntar, AC 35) from every view of the brain but "Revisões", where
 * `a` is "Adiar" (cerebro-natureza, C71), and "Perguntar" itself.
 */
export function useBrainViewCommands({ mode, go }: BrainModeState): void {
  const ask = useMemo<Command[]>(
    () =>
      mode === "reviews" || mode === "ask"
        ? []
        : [
            {
              id: "brain.view.ask",
              title: "ask.title",
              group: "view",
              scope: "view:brain",
              icon: MessageSquare,
              keys: ["a"],
              run: () => go("ask"),
            },
          ],
    [mode, go],
  );
  useCommands(ask, { exclusive: "brain.view.ask" });
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
              // In "Revisões", `v` is "Ainda vale" (cerebro-natureza, C71).
              ...(mode === "reviews" ? {} : { keys: ["v"] }),
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
