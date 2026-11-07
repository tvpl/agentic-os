/**
 * Chrome around the Second Brain canvas: the top bar, the loading skeleton and
 * indexing progress, the zoom stack, the legend (groups, rings and edge-kind
 * toggles), the layout pill and the hover tooltip. Presentational only.
 */
import { type ReactNode, useContext } from "react";
import {
  ArrowLeft,
  CircleCheck,
  Diamond,
  Maximize2,
  Menu,
  Minus,
  Plus,
  RefreshCw,
  Scan,
  Sparkles,
  Tv,
  X,
  Zap,
} from "lucide-react";
import type { IndexProgressPayload } from "../api";
import { LAUNCHER_EVENT } from "../App";
import { AppRouteContext } from "../desktop/appRoute";
import { ErrorBox } from "../components/ui";
import { useT } from "../i18n";
import { IndexProgress } from "./IndexProgress";
import { openCleanup } from "./cleanupEvents";
import { useBrainMode } from "./BrainViewSwitch";
import { useReviewsDue } from "./natureza";
import { APP_COLOR, EDGE_KINDS, ROUTINE_COLOR, SKILL_COLOR, type EdgeKind } from "./engine/world";
import type { BrainUi } from "./state";
import { Tooltip } from "../ui";

/** The fourth `.btn.sm` of the graph's action row: "Revisões (N)" with N > 0 due in the active context, else nothing. */
function ReviewsButton() {
  const t = useT();
  const n = useReviewsDue();
  const { go } = useBrainMode();
  if (n <= 0) return null;
  return (
    <button className="btn sm" onClick={() => go("reviews")}>
      <CircleCheck aria-hidden /> {t("reviews.button", { n })}
    </button>
  );
}

export interface HoverInfo {
  x: number;
  y: number;
  title: string;
  sub: string;
}

export interface BrainChromeProps {
  systemName: string;
  total: number;
  lang: string;
  ui: BrainUi;
  patch: (p: Partial<BrainUi>) => void;
  presenting: boolean;
  setPresenting: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  progress: IndexProgressPayload | null;
  /** How the last pass ended when it did not finish (text, with its icon). */
  indexNote: "cancelled" | "failed" | null;
  onCancelIndex: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  liveCount: number;
  onNavigate: (to: string) => void;
  zoomReadout?: ReactNode;
  zoom: { in: () => void; out: () => void; fit: () => void; reset: () => void };
  legend: Array<{ key: string; count: number; color: string }>;
  legendOpen: boolean;
  setLegendOpen: (v: boolean) => void;
  ringCounts: { skills: number; routines: number; apps: number };
  kindCounts: Map<EdgeKind, number>;
  layoutLabel: string;
  /** Layout name to flash in the bottom pill, or null. */
  layoutToast: string | null;
  hover: HoverInfo | null;
}

const KIND_KEYS: Record<
  EdgeKind,
  | "brain.kind.markdown-link"
  | "brain.kind.wikilink"
  | "brain.kind.related"
  | "brain.kind.same-dir"
  | "brain.kind.other"
> = {
  "markdown-link": "brain.kind.markdown-link",
  wikilink: "brain.kind.wikilink",
  related: "brain.kind.related",
  "same-dir": "brain.kind.same-dir",
  other: "brain.kind.other",
};

export function BrainChrome(p: BrainChromeProps) {
  const t = useT();
  const inPanel = useContext(AppRouteContext) !== null;
  const { ui, patch, presenting, progress } = p;

  return (
    <>
      {p.loading && (
        <div className="brain-loading" role="status">
          <div className="rings">
            <span className="ring" />
            <span className="ring" />
            <span className="ring" />
            <span className="core" />
            <span className="label hud-label">{t("brain.loading")}</span>
          </div>
        </div>
      )}
      {p.error !== null && (
        <div className="brain-loading brain-loading-error">
          <ErrorBox message={p.error} onRetry={p.onRetry} />
        </div>
      )}
      <IndexProgress
        progress={progress}
        refreshing={p.refreshing}
        note={p.indexNote}
        onCancel={p.onCancelIndex}
      />

      <div className={`brain2-topbar${inPanel ? " in-panel" : ""}`}>
        <div>
          {/* One header per window (plan step 5): on the stage the plate's
              title bar already says "Second Brain"; the page says it only
              when it is the whole screen. The count and the actions stay. */}
          {!inPanel && (
            <div className="brain2-brand">
              <span className="primary accent-text">{p.systemName.replace(/\s*os$/i, "")}</span>
              <span className="secondary">{t("brain.title")}</span>
            </div>
          )}
          <div className="brain2-brand">
            <span className="byline">
              {p.total.toLocaleString(p.lang)} {t("brain.sub")}
            </span>
            {p.liveCount > 0 && (
              <button className="badge accent pulse-glow brain-live" onClick={() => p.onNavigate("/runs")}>
                <Zap aria-hidden /> {p.liveCount} {t("brain.liveAgents")}
              </button>
            )}
          </div>
        </div>
        {presenting ? (
          <button className="os-chip" onClick={() => p.setPresenting(false)}>
            <X aria-hidden /> {t("brain.exitPresent")}
          </button>
        ) : (
          <div className="brain-topbar-actions">
            <Tooltip label={t("brain.refresh")}>
              <button
                className="btn sm"
                onClick={p.onRefresh}
                disabled={p.refreshing}
                aria-label={t("brain.refresh")}
              >
                {p.refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />}
              </button>
            </Tooltip>
            <Tooltip label={`${t("brain.present")} (p)`}>
              <button
                className="btn sm"
                onClick={() => p.setPresenting(true)}
                aria-label={t("brain.present")}
              >
                <Tv aria-hidden />
              </button>
            </Tooltip>
            {/* The guided cleanup, at its step 1 (cerebro-faxina-guiada, amendment 11). */}
            <button className="btn sm" onClick={() => openCleanup()}>
              <Sparkles aria-hidden /> {t("cleanup.open.button")}
            </button>
            {/* "Revisões (N)" when something fell due (cerebro-natureza, amendment 10). */}
            <ReviewsButton />
            {/* On the stage the brain is a panel: the desktop is behind it, and
                the palette is ⌘K — neither needs a chip inside the app (G2). */}
            {!inPanel && (
              <>
                <button className="os-chip" onClick={() => p.onNavigate("/")}>
                  <ArrowLeft aria-hidden /> {t("os.backToOs")}
                </button>
                <button className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
                  <Menu aria-hidden /> {t("os.menu")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!presenting && (
        <div className="zoom-stack">
          {p.zoomReadout}
          <Tooltip label={`${t("brain.zoomIn")} (⌘+)`}>
            <button className="os-tool" onClick={p.zoom.in} aria-label={t("brain.zoomIn")}>
              <Plus aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={`${t("brain.zoomOut")} (⌘−)`}>
            <button className="os-tool" onClick={p.zoom.out} aria-label={t("brain.zoomOut")}>
              <Minus aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t("brain.zoomFit")}>
            <button className="os-tool" onClick={p.zoom.fit} aria-label={t("brain.zoomFit")}>
              <Maximize2 aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={`${t("brain.resetCamera")} (⌘0)`}>
            <button className="os-tool" onClick={p.zoom.reset} aria-label={t("brain.resetCamera")}>
              <Scan aria-hidden />
            </button>
          </Tooltip>
        </div>
      )}

      {!presenting &&
        p.legend.length > 0 &&
        (p.legendOpen ? (
          <div className="brain2-legend" aria-label={t("brain.legend")}>
            <button
              className="hud-label brain-legend-toggle"
              onClick={() => p.setLegendOpen(false)}
              aria-expanded
            >
              <Diamond aria-hidden /> {t("brain.legend")}
            </button>
            {p.legend.slice(0, 9).map((l) => (
              <div className="lg-row" key={l.key}>
                <button
                  onClick={() => patch({ filterGroup: ui.filterGroup === l.key ? null : l.key })}
                  aria-pressed={ui.filterGroup === l.key}
                  className={ui.filterGroup && ui.filterGroup !== l.key ? "dimmed" : undefined}
                >
                  <span className="dot" style={{ background: l.color }} />
                  <span className="truncate">{l.key}</span>
                  <span className="count">{l.count}</span>
                </button>
              </div>
            ))}
            <div className="lg-row">
              <span className="dot" style={{ background: SKILL_COLOR }} /> {t("brain.ring.skills")}
              <span className="count">{p.ringCounts.skills}</span>
            </div>
            <div className="lg-row">
              <span className="dot" style={{ background: ROUTINE_COLOR }} /> {t("brain.ring.routines")}
              <span className="count">{p.ringCounts.routines}</span>
            </div>
            <div className="lg-row">
              <span className="dot" style={{ background: APP_COLOR }} /> {t("brain.ring.apps")}
              <span className="count">{p.ringCounts.apps}</span>
            </div>
            <div className="brain-legend-kinds">
              {EDGE_KINDS.filter((k) => (p.kindCounts.get(k) ?? 0) > 0).map((k) => (
                <div className="lg-row" key={k}>
                  <button
                    className="kind-off"
                    aria-pressed={ui.edgeKinds.includes(k)}
                    onClick={() =>
                      patch({
                        edgeKinds: ui.edgeKinds.includes(k)
                          ? ui.edgeKinds.filter((x) => x !== k)
                          : [...ui.edgeKinds, k],
                      })
                    }
                  >
                    <span className={`brain-kind-swatch ${k}`} aria-hidden />
                    {t(KIND_KEYS[k])}
                    <span className="count">{p.kindCounts.get(k)}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button className="os-chip brain-legend-chip" onClick={() => p.setLegendOpen(true)}>
            <Diamond aria-hidden /> {t("brain.legend")}
          </button>
        ))}

      {!presenting && (
        <div className="brain2-bottom-tag">
          {p.layoutLabel} · {ui.view === "areas" ? t("brain.view.areas") : t("brain.view.folders")}
        </div>
      )}
      {p.layoutToast !== null && (
        <div className="brain-toast">{t("brain.layoutToast", { layout: p.layoutToast })}</div>
      )}

      {p.hover && (
        <div className="brain2-tooltip" style={{ left: p.hover.x, top: p.hover.y }}>
          {p.hover.title}
          <div className="sub">{p.hover.sub}</div>
        </div>
      )}
    </>
  );
}
