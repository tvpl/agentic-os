import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { ApiError } from "../api";
import { DialogPortal, useDialog } from "./dialog";

/* ---------- data fetching (legacy; prefer useApiQuery from ../queries) ---------- */
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
  // Serialise the deps so the effect has a static dependency list.
  const depsKey = deps.map((d) => (typeof d === "object" && d !== null ? JSON.stringify(d) : String(d))).join(" ");

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
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // Only unreachable-service errors are "offline"; a TypeError from a
        // bug is a bug and is shown as such.
        setOffline(err instanceof ApiError && err.unreachable);
        setError(message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick, depsKey]);

  return { data, error, offline, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/* ---------- toasts ---------- */
type ToastKind = "ok" | "danger" | "info";
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  ms: number;
  leaving: boolean;
}
type PushToast = (text: string, kind?: ToastKind) => void;
const ToastContext = createContext<PushToast>(() => {});
export function useToast(): PushToast {
  return useContext(ToastContext);
}

const TOAST_MS: Record<ToastKind, number> = { ok: 4200, info: 4200, danger: 8000 };
const TOAST_EXIT_MS = 160;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      return;
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_EXIT_MS);
  }, []);

  const push = useCallback<PushToast>(
    (text, kind = "info") => {
      const id = Date.now() + Math.random();
      const ms = TOAST_MS[kind];
      setToasts((prev) => [...prev, { id, text, kind, ms, leaving: false }]);
      timers.current.set(id, window.setTimeout(() => remove(id), ms));
    },
    [remove],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const polite = toasts.filter((t) => t.kind !== "danger");
  const assertive = toasts.filter((t) => t.kind === "danger");
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap">
        <div role="status" aria-live="polite" style={{ display: "contents" }}>
          {polite.map((t) => (
            <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" style={{ display: "contents" }}>
          {assertive.map((t) => (
            <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const t = useT();
  const style = { "--toast-ms": `${toast.ms}ms` } as CSSProperties;
  return (
    <div className={`toast ${toast.kind}${toast.leaving ? " leaving" : ""}`} style={style}>
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="btn ghost sm icon-only toast-close" onClick={onClose} aria-label={t("common.dismiss")}>
        <X aria-hidden />
      </button>
      <span className="toast-progress" aria-hidden />
    </div>
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

/** Content-shaped placeholder; prefer over `Loading` inside cards and tables. */
export function Skeleton({
  lines = 3,
  height,
  className,
  page = false,
}: {
  lines?: number;
  height?: number;
  className?: string;
  /** Full-page variant used as the route Suspense fallback. */
  page?: boolean;
}) {
  const t = useT();
  const style = height ? ({ "--skeleton-h": `${height}px` } as CSSProperties) : undefined;
  return (
    <div
      className={["skeleton", page ? "page-skeleton" : "", className ?? ""].filter(Boolean).join(" ")}
      role="status"
      aria-label={t("common.loading")}
      style={style}
    >
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" />
      ))}
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
        <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={onRetry}>
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
export interface ModalProps {
  title: string;
  /** May be an inline arrow; it is read through a ref, so re-renders never steal focus. */
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
  /** Override the initial focus target (default: first field, else the dialog itself). */
  initialFocus?: () => HTMLElement | null | undefined;
}

export function Modal({ title, onClose, children, narrow = false, initialFocus }: ModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose, { initialFocus });
  return (
    <DialogPortal>
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal${narrow ? " narrow" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
          <div className="modal-head">
            <h2>{title}</h2>
            <button type="button" className="btn ghost sm icon-only" onClick={onClose} aria-label={t("common.close")} data-dialog-close>
              <X aria-hidden />
            </button>
          </div>
          {children}
        </div>
      </div>
    </DialogPortal>
  );
}

/* ---------- misc ---------- */
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const kind =
    status === "done"
      ? "ok"
      : status === "running" || status === "queued"
        ? "info"
        : status === "failed"
          ? "danger"
          : status === "cancelled" || status === "interrupted"
            ? "warn"
            : "dim";
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
