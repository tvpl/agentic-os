/**
 * Design-system primitives (audit item 32). Views compose these instead of
 * hand-rolled `.btn`/`.field` markup and inline styles.
 */
import {
  forwardRef,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useT } from "../i18n";
import { Modal, Skeleton } from "./ui";

export { Skeleton };

/* ---------- Button ---------- */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (16px in md, 14px in sm). Icon-only buttons need aria-label. */
  icon?: ReactNode;
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const cls = [
    "btn",
    variant,
    size === "sm" ? "sm" : "",
    loading ? "loading" : "",
    icon && (children === undefined || children === null || children === false) ? "icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {icon}
      {children}
      {loading && (
        <span className="btn-spinner" aria-hidden>
          <span className="spinner sm" />
        </span>
      )}
    </button>
  );
});

/* ---------- Field ---------- */
export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

/** Label above, control, hint or inline error below. Pair with `aria-describedby={\`${id}-hint\`}` on the control if you want. */
export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
  return (
    <div className={["field", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Segmented ---------- */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

/** Radio-group semantics: arrow keys move the selection, one tab stop. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "md", className }: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const opt = enabled[next];
    if (!opt) return;
    onChange(opt.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("button")[options.indexOf(opt)]?.focus();
  };
  return (
    <div
      ref={groupRef}
      className={["segmented", size === "sm" ? "sm" : "", className ?? ""].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            className={active ? "active" : undefined}
            onClick={() => onChange(o.value)}
            onKeyDown={onKey}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- ConfirmDialog ---------- */
export interface ConfirmDialogProps {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: red confirm button and initial focus on Cancel. */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, danger = false, loading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal title={title} onClose={onCancel} narrow initialFocus={() => (danger ? cancelRef.current : confirmRef.current)}>
      {body && <div className="modal-body">{body}</div>}
      <div className="modal-actions">
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel ?? t("common.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- EmptyState ---------- */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** Primary action — never ship an empty state without one when an action exists. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={["empty-state", className ?? ""].filter(Boolean).join(" ")}>
      {icon && (
        <span className="es-icon" aria-hidden>
          {icon}
        </span>
      )}
      <p className="es-title">{title}</p>
      {body && <p className="es-body">{body}</p>}
      {action && <div className="es-action">{action}</div>}
    </div>
  );
}

/* ---------- Tabs ---------- */
export interface TabsProps {
  tabs: Array<{ id: string; label: ReactNode }>;
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

export function Tabs({ tabs, active, onChange, ariaLabel }: TabsProps) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.findIndex((tab) => tab.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    const tab = next >= 0 ? tabs[next] : undefined;
    if (!tab) return;
    e.preventDefault();
    onChange(tab.id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={listRef} className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKey}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Badge ---------- */
export type BadgeTone = "ok" | "warn" | "danger" | "info" | "accent" | "dim";

export interface BadgeProps {
  /** `state` = filled semantic colour; `meta` = outlined, dim text. */
  kind: "state" | "meta";
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ kind, tone = "dim", children, className, title }: BadgeProps) {
  return (
    <span className={["badge", tone, kind === "meta" ? "meta" : "", className ?? ""].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
