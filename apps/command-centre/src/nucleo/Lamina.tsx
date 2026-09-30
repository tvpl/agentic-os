/**
 * A lâmina (immersive shell): one projection. A chamfered sheet of glass
 * that materialises out of a line of light, with a head that says what it
 * is (glyph, title, `@ref` for the voice line) and two controls — open it
 * in its own scene, when it has one, and dismiss. Nothing else: it cannot
 * be dragged, resized or stacked. The body scrolls inside it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useT } from "../i18n";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PANEL_GLYPH, type PanelKind } from "../desktop/panelKinds";
import { flipFrom, freshOrigin } from "./travel";
import { burst } from "./Sparks";

export interface LaminaSpec {
  id: string;
  kind: PanelKind;
  title: string;
  refName: string;
  icon?: ReactNode;
  /** Wants the wider sheet: traces, documents, forms. */
  wide?: boolean;
  /** Where "open in its scene" goes, when it has a scene. */
  scenePath?: string;
  node: ReactNode;
}

export interface LaminaProps {
  spec: LaminaSpec;
  leaving: boolean;
  onDismiss: () => void;
  onReference: () => void;
  onOpenScene?: () => void;
}

export default function Lamina({ spec, leaving, onDismiss, onReference, onOpenScene }: LaminaProps) {
  const t = useT();
  // The entrance plays once; a re-projection of the same id only pulses.
  const [fresh, setFresh] = useState(true);
  // It grows out of the control that asked for it: from that control's box
  // to its own, with a spark where it started.
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const origin = freshOrigin();
    if (!el || !origin || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // The FLIP is the entrance: the CSS one would shift the box being measured.
    el.style.animation = "none";
    const to = el.getBoundingClientRect();
    const from = origin.rect ?? { left: origin.x - 24, top: origin.y - 24, width: 48, height: 48 };
    const f = flipFrom(from, to);
    el.animate(
      [
        {
          transformOrigin: "0 0",
          transform: `translate(${f.dx}px, ${f.dy}px) scale(${Math.max(0.05, f.sx)}, ${Math.max(0.05, f.sy)})`,
          opacity: 0.35,
          filter: "brightness(2.4) blur(2px)",
        },
        { transformOrigin: "0 0", transform: "none", opacity: 1, filter: "none" },
      ],
      { duration: 640, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    burst(origin.x, origin.y, "agent", 0.8);
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => setFresh(false), 900);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <article
      ref={ref}
      className={`nu-lamina${spec.wide ? " wide" : ""}${fresh ? " fresh" : ""}${leaving ? " bye" : ""}`}
      data-lamina={spec.id}
      data-panel={spec.id}
      data-kind={spec.kind}
      aria-label={spec.title}
    >
      <header className="nu-lamina-head">
        <span className="nu-lamina-glyph" aria-hidden>
          {spec.icon ?? PANEL_GLYPH[spec.kind]}
        </span>
        <h2 className="nu-lamina-title">{spec.title}</h2>
        <button
          type="button"
          className="nu-lamina-ref mono"
          title={t("desktop.doc.reference")}
          aria-label={`${t("desktop.doc.reference")}: @${spec.refName}`}
          onClick={onReference}
        >
          @{spec.refName}
        </button>
        <span className="sp" />
        {onOpenScene && (
          <button
            type="button"
            className="nu-lamina-b"
            aria-label={`${t("nucleo.lamina.openScene")}: ${spec.title}`}
            title={t("nucleo.lamina.openScene")}
            onClick={onOpenScene}
          >
            <ArrowUpRight aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="nu-lamina-b x"
          aria-label={`${t("nucleo.lamina.dismiss")}: ${spec.title}`}
          title={t("nucleo.lamina.dismiss")}
          onClick={onDismiss}
        >
          <X aria-hidden />
        </button>
      </header>
      {/* A region the keyboard can scroll. */}
      <div className="nu-lamina-body" role="region" aria-label={spec.title} tabIndex={0}>
        <ErrorBoundary name={spec.title}>{spec.node}</ErrorBoundary>
      </div>
    </article>
  );
}
