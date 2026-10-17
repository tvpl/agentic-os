import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";

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
      timers.current.set(
        id,
        window.setTimeout(() => remove(id), ms),
      );
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
      <button
        type="button"
        className="btn ghost sm icon-only toast-close"
        onClick={onClose}
        aria-label={t("common.dismiss")}
      >
        <X aria-hidden />
      </button>
      <span className="toast-progress" aria-hidden />
    </div>
  );
}

/* ---------- state blocks ---------- */
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

export function ErrorBox({
  message,
  offline,
  onRetry,
}: {
  message: string;
  offline?: boolean;
  onRetry?: () => void;
}) {
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

export function formatDuration(ms: number | null, locale?: string): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${locale ? s.toLocaleString(locale, { maximumFractionDigits: 1 }) : s.toFixed(1)} s`;
  }
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
