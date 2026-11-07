/**
 * Mounted once by `OsShell`: hears `OPEN_MEMORY_HISTORY_EVENT` and shows "Histórico da memória"
 * (.specs/features/cerebro-memoria-confiavel, AC 44). The dialog is `lazy`: its code is fetched the first time it opens.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { OPEN_MEMORY_HISTORY_EVENT } from "./memoria";

const MemoryHistoryDialog = lazy(() => import("./notes/MemoryHistoryDialog"));

export function MemoryHistoryHost() {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const onOpen = () => setOpen((n) => n + 1);
    window.addEventListener(OPEN_MEMORY_HISTORY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MEMORY_HISTORY_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <MemoryHistoryDialog key={open} onClose={() => setOpen(0)} />
    </Suspense>
  );
}
