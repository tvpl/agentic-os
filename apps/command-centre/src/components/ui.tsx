import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { ApiError } from "../api";

/* ---------- data fetching ---------- */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): {
  data: T | null;
  error: string | null;
  offline: boolean;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setOffline(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (err instanceof ApiError) setError(err.message);
        else {
          setOffline(true);
          setError(err.message);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, error, offline, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/* ---------- toasts ---------- */
interface Toast {
  id: number;
  text: string;
  kind: "ok" | "danger" | "info";
}
const ToastContext = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export function useToast(): (text: string, kind?: Toast["kind"]) => void {
  return useContext(ToastContext);
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- state blocks ---------- */
export function Loading() {
  const t = useT();
  return (
    <div className="empty" role="status">
      <span className="spinner" aria-hidden /> {t("common.loading")}
    </div>
  );
}

export function ErrorBox({ message, offline, onRetry }: { message: string; offline?: boolean; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-box" role="alert">
      <strong>{offline ? t("common.offline") : t("common.error")}</strong>
      {!offline && <div style={{ marginTop: 4 }}>{message}</div>}
      {onRetry && (
        <button className="btn sm" style={{ marginTop: 10 }} onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- misc ---------- */
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const kind =
    status === "done" ? "ok" : status === "running" || status === "queued" ? "info" : status === "failed" ? "danger" : status === "cancelled" || status === "interrupted" ? "warn" : "dim";
  const key = `status.${status}` as Parameters<typeof t>[0];
  const label = t(key);
  return <span className={`badge ${kind}`}>{label === key ? status : label}</span>;
}

export function timeAgo(ts: number | null, lang: string): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const minutes = Math.round(abs / 60000);
  const value = future ? 1 : -1;
  if (minutes < 1) return rtf.format(0, "minute");
  if (minutes < 60) return rtf.format(value * minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(value * hours, "hour");
  return rtf.format(value * Math.round(hours / 24), "day");
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
