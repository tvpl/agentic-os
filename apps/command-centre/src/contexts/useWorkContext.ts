/**
 * The active work context of this machine (.specs/features/cerebro-contextos, door 5), as every screen reads it: the
 * id stored in `UiPreferences.activeContext`, kept only while `GET /api/contexts` lists it (AC 38). A read sends
 * `context=<id>` with `query`, a new run `contextId`; `undefined` is the whole brain.
 */
import { useCallback } from "react";
import type { ApiCallResult } from "@mordomo/contracts";
import { useOsContexts, useOsUiPreferences, useSaveUiPreferences } from "../queries";

export type ContextList = ApiCallResult<"GET /api/contexts">["contexts"];
export type WorkContextView = ContextList[number];

export interface WorkContextState {
  /** The list as the server answers it (pending, failed, refetch). */
  list: ReturnType<typeof useOsContexts>;
  contexts: ContextList;
  /** The active context, when the list holds it. */
  active: WorkContextView | null;
  /** What a read sends as `context`: the active id, or `undefined` for the whole brain. */
  query: string | undefined;
  /** False while what to send cannot be told yet (a context is stored and the list is still on its way). */
  ready: boolean;
  /** The stored id names a context the list no longer holds. */
  gone: string | null;
  choose: (id: string | null) => Promise<void>;
}

export function useWorkContext(): WorkContextState {
  const prefs = useOsUiPreferences();
  const list = useOsContexts({ staleTime: 30_000 });
  const save = useSaveUiPreferences();
  const stored = prefs.data?.activeContext ?? null;
  const contexts = list.data?.contexts ?? [];
  const listed = stored === null ? null : (contexts.find((c) => c.id === stored) ?? null);
  // A list that is being asked again may hold a context made in another window: nothing is judged gone meanwhile.
  const settled = list.isSuccess && !list.isFetching;
  const gone = stored !== null && listed === null && settled ? stored : null;
  // The shells mount once the preferences are read; before that (or without them) there is no choice to wait for.
  // A list that cannot be read leaves the stored id to the server to judge.
  const query = listed ? listed.id : stored !== null && list.isError ? stored : undefined;
  const ready = stored === null || listed !== null || list.isError || gone !== null;
  const choose = useCallback(
    async (id: string | null) => {
      await save({ activeContext: id });
    },
    [save],
  );
  return { list, contexts, active: listed, query, ready, gone, choose };
}
