/**
 * Chrome around the Second Brain canvas: the top bar, the loading skeleton and
 * indexing progress, the zoom stack, the legend (groups, rings and edge-kind
 * toggles), the layout pill and the hover tooltip. Presentational only.
 */
import { type CSSProperties } from "react";
import { ArrowLeft, Diamond, Maximize2, Menu, Minus, Plus, RefreshCw, Scan, Tv, X, Zap } from "lucide-react";
import type { IndexProgressPayload } from "../api";
import { LAUNCHER_EVENT } from "../App";
import { ErrorBox } from "../components/ui";
import { useT } from "../i18n";
import { APP_COLOR, EDGE_KINDS, ROUTINE_COLOR, SKILL_COLOR, type EdgeKind } from "./engine/world";
import type { BrainUi } from "./state";

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
  refreshing: boolean;
  onRefresh: () => void;
  liveCount: number;
  onNavigate: (to: string) => void;
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
  "brain.kind.markdown-link" | "brain.kind.same-dir" | "brain.kind.same-area" | "brain.kind.other"
> = {
  "markdown-link": "brain.kind.markdown-link",
  "same-dir": "brain.kind.same-dir",
  "same-area": "brain.kind.same-area",
  other: "brain.kind.other",
};

export function BrainChrome(p: BrainChromeProps) {
  const t = useT();
  const { ui, patch, presenting, progress } = p;
  const ratio = progress?.total ? Math.min(1, progress.scanned / progress.total) : 0;

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
      {(progress !== null || p.refreshing) && (
        <div className="brain-progress" role="status" aria-live="polite">
          <span>
            {t("brain.indexing")}
            {progress ? ` · ${progress.scanned}${progress.total ? ` / ${progress.total}` : ""}` : "…"}
          </span>
          <div className={`bar${progress?.total ? "" : " indeterminate"}`}>
            <span style={{ "--p": ratio } as CSSProperties} />
          </div>
        </div>
      )}

      <div className="brain2-topbar">
        <div>
          <div className="brain2-brand">
            <span className="primary accent-text">{p.systemName.replace(/\s*os$/i, "")}</span>
            <span className="secondary">{t("brain.title")}</span>
          </div>
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
            <button
              className="btn sm"
              onClick={p.onRefresh}
              disabled={p.refreshing}
              title={t("brain.refresh")}
              aria-label={t("brain.refresh")}
            >
              {p.refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />}
            </button>
            <button
              className="btn sm"
              onClick={() => p.setPresenting(true)}
              title={`${t("brain.present")} (p)`}
              aria-label={t("brain.present")}
            >
              <Tv aria-hidden />
            </button>
            <button className="os-chip" onClick={() => p.onNavigate("/")}>
              <ArrowLeft aria-hidden /> {t("os.backToOs")}
            </button>
            <button className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
              <Menu aria-hidden /> {t("os.menu")}
            </button>
          </div>
        )}
      </div>

      {!presenting && (
        <div className="zoom-stack">
          <button
            className="os-tool"
            onClick={p.zoom.in}
            aria-label={t("brain.zoomIn")}
            title={`${t("brain.zoomIn")} (⌘+)`}
          >
            <Plus aria-hidden />
          </button>
          <button
            className="os-tool"
            onClick={p.zoom.out}
            aria-label={t("brain.zoomOut")}
            title={`${t("brain.zoomOut")} (⌘−)`}
          >
            <Minus aria-hidden />
          </button>
          <button
            className="os-tool"
            onClick={p.zoom.fit}
            aria-label={t("brain.zoomFit")}
            title={t("brain.zoomFit")}
          >
            <Maximize2 aria-hidden />
          </button>
          <button
            className="os-tool"
            onClick={p.zoom.reset}
            aria-label={t("brain.reset")}
            title={`${t("brain.reset")} (⌘0)`}
          >
            <Scan aria-hidden />
          </button>
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
