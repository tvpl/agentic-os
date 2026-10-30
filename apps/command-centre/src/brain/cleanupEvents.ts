/**
 * How anything on screen opens the guided cleanup (.specs/features/cerebro-faxina-guiada, S5): a window event, so the
 * context selector, the palette, the Second Brain's action row and the Núcleo's scene menu need not know where the
 * wizard is mounted (`OsShell`), nor pull its code in: the wizard is a chunk of its own, fetched on the first request.
 */
export const OPEN_CLEANUP_EVENT = "mordomo:open-cleanup";

export interface CleanupRequest {
  /** A context to clean, chosen already (the selector's entry opens at step 2 with it). */
  context?: string;
  /** 1 (the default): "Escopo", with the active context preselected; 2: "O que tem aqui" for `context`. */
  step?: 1 | 2;
}

export function openCleanup(request: CleanupRequest = {}): void {
  window.dispatchEvent(new CustomEvent<CleanupRequest>(OPEN_CLEANUP_EVENT, { detail: request }));
}
