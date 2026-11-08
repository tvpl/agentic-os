/**
 * Mounted once by `OsShell`: hears `OPEN_CLEANUP_EVENT` and shows the guided cleanup. The wizard is `lazy`, so its
 * code and its stylesheet are fetched only when a person first opens it (cerebro-faxina-guiada, AC 43).
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { OPEN_CLEANUP_EVENT, type CleanupRequest } from "./cleanupEvents";

const CleanupWizard = lazy(() => import("./cleanup/CleanupWizard"));

export function CleanupHost() {
  const [open, setOpen] = useState<{ n: number; request: CleanupRequest } | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) =>
      setOpen((prev) => ({ n: (prev?.n ?? 0) + 1, request: (event as CustomEvent<CleanupRequest>).detail }));
    window.addEventListener(OPEN_CLEANUP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CLEANUP_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CleanupWizard key={open.n} request={open.request} onClose={() => setOpen(null)} />
    </Suspense>
  );
}
