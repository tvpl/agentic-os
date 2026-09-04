/**
 * Design-system primitives (audit item 32). Views compose these instead of
 * hand-rolled `.btn`/`.field` markup and inline styles.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useT } from "../i18n";
import { DialogPortal, usePresence } from "./dialog";
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
  {
    variant = "secondary",
    size = "md",
    icon,
    loading = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
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
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
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
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: SegmentedProps<T>) {
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

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      title={title}
      onClose={onCancel}
      narrow
      initialFocus={() => (danger ? cancelRef.current : confirmRef.current)}
    >
      {body && <div className="modal-body">{body}</div>}
      <div className="modal-actions">
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button
          ref={confirmRef}
          variant={danger ? "danger" : "primary"}
          onClick={onConfirm}
          loading={loading}
        >
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
  /** Id base shared with the panel: render the panel as `<div id={`${id}-panel-${active}`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`}>`. */
  id?: string;
}

export function Tabs({ tabs, active, onChange, ariaLabel, id }: TabsProps) {
  const generated = useId();
  const base = id ?? generated;
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
    <span
      className={["badge", tone, kind === "meta" ? "meta" : "", className ?? ""].filter(Boolean).join(" ")}
      title={title}
    >
      {children}
    </span>
  );
}

/* ---------- Popover ---------- */
export type PopoverPlacement = "bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The trigger: a ref or the element itself. The popover is anchored to it and focus returns to it on close. */
  anchor: RefObject<HTMLElement | null> | HTMLElement | null;
  children: ReactNode;
  placement?: PopoverPlacement;
  /** Gap between anchor and popover in px (default 6). */
  offset?: number;
  ariaLabel?: string;
  className?: string;
  /** Where focus lands on open; default: first focusable, else the popover. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Matching width with the anchor (menus under inputs). */
  matchWidth?: boolean;
}

function resolveAnchor(anchor: PopoverProps["anchor"]): HTMLElement | null {
  if (!anchor) return null;
  return anchor instanceof HTMLElement ? anchor : anchor.current;
}

/**
 * Anchored, non-modal floating panel: outside click and Escape close it,
 * `spring-in` on open, `fade-out` on close (via usePresence), focus goes in
 * on open and back to the anchor on close. Rendered through #modal-root so it
 * floats above widgets; it never pushes the depth layer.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  placement = "bottom-start",
  offset = 6,
  ariaLabel,
  className,
  initialFocus,
  matchWidth = false,
}: PopoverProps) {
  const { mounted, closing } = usePresence(open, 160);
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });

  // Position: measure the anchor and flip when it would overflow the viewport.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = ref.current;
    const a = resolveAnchor(anchor);
    if (!el || !a) return;
    const update = () => {
      const r = a.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let wantTop = placement.startsWith("top");
      if (!wantTop && r.bottom + offset + h > vh && r.top - offset - h >= 0) wantTop = true;
      if (wantTop && r.top - offset - h < 0 && r.bottom + offset + h <= vh) wantTop = false;
      const top = wantTop ? r.top - offset - h : r.bottom + offset;
      let left: number;
      if (placement.endsWith("end")) left = r.right - w;
      else if (placement === "bottom" || placement === "top") left = r.left + r.width / 2 - w / 2;
      else left = r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      setPos({
        top: Math.round(Math.max(8, top)),
        left: Math.round(left),
        width: matchWidth ? Math.round(r.width) : undefined,
        "--popover-origin": wantTop ? "bottom center" : "top center",
      } as CSSProperties);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [mounted, anchor, placement, offset, matchWidth]);

  // Focus in on open, back to the anchor on close; outside click + Escape close.
  useEffect(() => {
    if (!open || !mounted) return;
    const el = ref.current;
    if (!el) return;
    const a = resolveAnchor(anchor);
    const target =
      initialFocus?.() ??
      el.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ??
      el;
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));
    const onPointer = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (!n || el.contains(n) || (a && a.contains(n))) return;
      onCloseRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      if (
        a &&
        a.isConnected &&
        (document.activeElement === document.body || el.contains(document.activeElement))
      )
        a.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialFocus is read once per open
  }, [open, mounted, anchor]);

  if (!mounted) return null;
  return (
    <DialogPortal>
      <div
        ref={ref}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={["popover", closing ? "closing" : "", className ?? ""].filter(Boolean).join(" ")}
        style={pos}
      >
        {children}
      </div>
    </DialogPortal>
  );
}
