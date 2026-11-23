/**
 * How "Perguntar sobre esta nota" opens the view Perguntar (.specs/features/cerebro-perguntar, AC 50): the route
 * `/brain/ask` with the note's absolute path as `?note=`, which the view reads as the scope `notes` of that note alone
 * with the focus in the question. A module of its own and of no weight, so the notes view does not pull the view's chunk.
 */
export const ASK_NOTE_PARAM = "note";

/** The search of `/brain/ask` that asks about `path`. */
export const askAboutNote = (path: string) => `?${ASK_NOTE_PARAM}=${encodeURIComponent(path)}`;
