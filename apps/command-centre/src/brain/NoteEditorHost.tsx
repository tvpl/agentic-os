/**
 * Mounted once by `OsShell`: hears `OPEN_NOTE_EVENT` and shows the editor. The editor is `lazy`, so its code (and the
 * stylesheet that goes with it) is fetched only when a person first asks for a note.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { OPEN_NOTE_EVENT, type NoteEditorRequest } from "./noteEditor";

const NoteEditor = lazy(() => import("./NoteEditor"));

export function NoteEditorHost() {
  const [request, setRequest] = useState<NoteEditorRequest | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => setRequest((event as CustomEvent<NoteEditorRequest>).detail);
    window.addEventListener(OPEN_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, onOpen);
  }, []);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <NoteEditor request={request} onRequest={setRequest} onClose={() => setRequest(null)} />
    </Suspense>
  );
}
