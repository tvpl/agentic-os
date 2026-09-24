/**
 * The panel (redesign G1): the one primitive on the stage, ported from the
 * prototype's `.pan`. Not a system window — a plate: chamfered, materialising
 * with an iris, with a header that carries the kind's glyph, the title, the
 * `@ref` the console resolves it by, and three controls — collapse to the
 * dock, expand, close. The focused panel glows; the others step back.
 *
 * This is the chrome only. Geometry, stacking, drag and FLIP stay in the
 * layer; the panel gets a box, a few flags and callbacks, and draws itself.
 */
import { forwardRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, Maximize2, Minus, X } from "lucide-react";
import { useT } from "../i18n";
import { PANEL_GLYPH, type PanelKind } from "./panelKinds";

export interface PanelProps {
  id: string;
  kind: PanelKind;
  title: string;
  /** The `@name`; shown in the header, inserted into the console on click. */
  refName: string;
  icon?: ReactNode;
  /** The top of the stack: this one glows, the others dim. */
  on: boolean;
  /** Just opened: plays the materialisation. */
  fresh: boolean;
  /** Closing: plays the exit before the layout drops it. */
  leaving: boolean;
  /** Collapsing to the dock: plays the drop before the layout parks it. */
  parking: boolean;
  dragging: boolean;
  dragMode?: string | null;
  stacked: boolean;
  /** `false` when the expanded form would add nothing; the control is omitted. */
  expandable: boolean;
  /**
   * `false` for the console: it is where you talk to the OS, and a desktop
   * with no way to reopen it would be a desktop with no way back in. It gets
   * neither ✕ nor ▁ until G4 lifts it out of the layout altogether.
   */
  closable: boolean;
  /** The body lives in the surface while expanded; the frame stays behind the veil. */
  expanded: boolean;
  style: CSSProperties;
  children: ReactNode;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onReference: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  onClose: () => void;
  onResizeStart: (e: PointerEvent<HTMLElement>) => void;
  onResizeKey: (e: KeyboardEvent<HTMLElement>) => void;
  onScrollMore: () => void;
}

const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  {
    id,
    kind,
    title,
    refName,
    icon,
    on,
    fresh,
    leaving,
    parking,
    dragging,
    dragMode,
    stacked,
    expandable,
    closable,
    expanded,
    style,
    children,
    onPointerDown,
    onReference,
    onMinimize,
    onExpand,
    onClose,
    onResizeStart,
    onResizeKey,
    onScrollMore,
  },
  ref,
) {
  const t = useT();
  const cls = [
    "panel",
    on ? "on" : "off",
    fresh && "new",
    leaving && "bye",
    parking && "park",
    dragging && `dragging ${dragMode ?? ""}`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      ref={ref}
      data-panel={id}
      data-kind={kind}
      className={cls}
      style={style}
      aria-label={title}
      tabIndex={-1}
      onPointerDown={onPointerDown}
    >
      <div className="panel-in">
        <div className="panel-head">
          <span className="panel-glyph" aria-hidden>
            {icon ?? PANEL_GLYPH[kind]}
          </span>
          <span className="panel-title">{title}</span>
          <button
            type="button"
            className="panel-ref mono"
            title={t("desktop.doc.reference")}
            aria-label={`${t("desktop.doc.reference")}: @${refName}`}
            onClick={onReference}
          >
            @{refName}
          </button>
          <span className="panel-sp" />
          {!stacked && closable && (
            <button
              type="button"
              className="panel-b"
              aria-label={`${t("desktop.panel.minimize")}: ${title}`}
              title={t("desktop.panel.minimize")}
              onClick={onMinimize}
            >
              <Minus aria-hidden />
            </button>
          )}
          {expandable && (
            <button
              type="button"
              className="panel-b"
              aria-label={`${t("desktop.window.maximize")}: ${title}`}
              title={t("desktop.window.maximize")}
              onClick={onExpand}
            >
              <Maximize2 aria-hidden />
            </button>
          )}
          {closable && (
            <button
              type="button"
              className="panel-b x"
              aria-label={`${t("common.close")}: ${title}`}
              title={t("common.close")}
              onClick={onClose}
            >
              <X aria-hidden />
            </button>
          )}
        </div>
        <div
          className="panel-body"
          role="region"
          aria-label={title}
          tabIndex={0}
          // While expanded the body lives in the surface; the frame stays
          // behind the veil so the desktop still reads as a desktop.
          aria-hidden={expanded || undefined}
        >
          {expanded ? null : children}
        </div>
      </div>
      {/* A pointer-only affordance: the region above is focusable and scrolls
          with the keyboard, so the cue stays out of the accessibility tree. */}
      <button
        type="button"
        className="panel-more"
        tabIndex={-1}
        aria-hidden
        title={t("widget.scrollMore")}
        onClick={onScrollMore}
      >
        <ChevronDown aria-hidden />
      </button>
      {!stacked && !expanded && (
        <button
          type="button"
          className="panel-grip"
          aria-label={`${t("os.resizeWidget")}: ${title}`}
          title={t("os.resizeWidget")}
          onKeyDown={onResizeKey}
          onPointerDown={onResizeStart}
        />
      )}
    </section>
  );
});

export default Panel;
