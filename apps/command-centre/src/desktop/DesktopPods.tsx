/**
 * The pods (redesign F7, editable since G5): the desktop's instruments as
 * hexagons on two arcs, drawn from `settings.hud`. A pod gives a reading a
 * body — glyph, one value, a counter when something is pending — so a glance
 * at the edge of the screen answers "does anything need me?" without reading.
 *
 * Editing the HUD (the dock's "Edit HUD"): the pods wobble, ✕ removes one,
 * the dashed + at the end of an arc opens the gallery of instruments that
 * are not on an arc yet. The result is persisted by the desktop.
 *
 * Levels still come from `signal.ts`, so a pod and the panel behind it can
 * never disagree.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CalendarClock, Coins, Inbox, ShieldCheck, Terminal, X } from "lucide-react";
import { useT } from "../i18n";
import { DialogPortal, useDialog, usePresence } from "../components/dialog";
import { APPS, appKindOf, type AppKind } from "./apps";
import { freeInstruments, type Hud, type HudSide } from "./hud";
import { isLit, type SignalValue } from "./signal";
import type { DesktopSignals } from "./useSignals";

export interface Pod {
  id: string;
  icon: ReactNode;
  /** Short name, shown in the tooltip and read by assistive tech. */
  name: string;
  /** One line under the name: what the number means. */
  detail: string;
  /** Two or three characters at most, under the glyph. */
  value?: string;
  /** Pending items; only these light the counter. */
  count?: number;
  /** Amber rather than red: pending, not broken. */
  soft?: boolean;
  level: SignalValue["level"];
  /** Something is running inside it right now. */
  live?: boolean;
  onOpen: () => void;
}

export interface DesktopPodsProps {
  hud: Hud;
  signals: DesktopSignals;
  /** The HUD is being edited: pods wobble, ✕ removes, + adds. */
  editing: boolean;
  onHudChange: (next: Hud) => void;
  /** Opens a widget's surface; the desktop decides whether it can. */
  onExpand: (widgetId: string) => void;
  /** Opens one of the OS's apps as a panel on the stage. */
  onOpenApp: (kind: AppKind) => void;
}

/** Everything the catalogue can turn into a pod, by id. */
function usePodCatalogue(
  signals: DesktopSignals,
  onExpand: (id: string) => void,
  onOpenApp: (kind: AppKind) => void,
): (id: string) => Pod | null {
  const t = useT();
  return useMemo(() => {
    const readings: Record<string, () => Pod> = {
      pulse: () => ({
        id: "pulse",
        icon: <Activity aria-hidden />,
        name: t("desktop.widget.pulse"),
        detail: signals.pulse.label,
        value: signals.pulse.value,
        level: signals.pulse.level,
        onOpen: () => onExpand("pulse"),
      }),
      attention: () => ({
        id: "attention",
        icon: <AlertTriangle aria-hidden />,
        name: t("desktop.widget.attention"),
        detail: signals.attention.label,
        count: signals.attention.count,
        level: signals.attention.level,
        onOpen: () => onExpand("attention"),
      }),
      runs: () => ({
        id: "runs",
        icon: <Terminal aria-hidden />,
        name: t("desktop.hud.runs"),
        detail: signals.runs.label,
        value: signals.runs.value,
        level: signals.runs.level,
        live: signals.activeRuns > 0,
        // The prototype's runs pod opens the Runs app.
        onOpen: () => onOpenApp("runs"),
      }),
      routines: () => ({
        id: "routines",
        icon: <CalendarClock aria-hidden />,
        name: t("desktop.widget.routines"),
        detail: signals.routines.label,
        value: signals.routines.value,
        level: signals.routines.level,
        onOpen: () => onExpand("routines"),
      }),
      cost: () => ({
        id: "cost",
        icon: <Coins aria-hidden />,
        name: t("desktop.widget.cost"),
        detail: signals.cost.label,
        value: signals.cost.value,
        level: signals.cost.level,
        onOpen: () => onExpand("cost"),
      }),
      inbox: () => ({
        id: "inbox",
        icon: <Inbox aria-hidden />,
        name: t("desktop.widget.inbox"),
        detail: t("desktop.inbox.title"),
        level: "idle",
        onOpen: () => onExpand("inbox"),
      }),
      approvals: () => ({
        id: "approvals",
        icon: <ShieldCheck aria-hidden />,
        name: t("desktop.widget.approvals"),
        detail: t("desktop.approvals.empty"),
        count: signals.approvals,
        soft: true,
        level: signals.approvals > 0 ? "warn" : "idle",
        onOpen: () => onExpand("approvals"),
      }),
      now: () => ({
        id: "now",
        icon: <Activity aria-hidden />,
        name: t("now.title"),
        detail: t("desktop.ref.now"),
        level: "idle",
        onOpen: () => onExpand("now"),
      }),
    };
    return (id: string): Pod | null => {
      const kind = appKindOf(id);
      if (kind) {
        const def = APPS[kind];
        const Icon = def.Icon;
        const pod: Pod = {
          id,
          icon: <Icon aria-hidden />,
          name: t(def.titleKey),
          detail: t(def.descKey),
          level: "idle",
          onOpen: () => onOpenApp(kind),
        };
        if (kind === "skills") {
          pod.detail = t("desktop.pods.skills", { n: signals.skills });
          pod.value = String(signals.skills);
        }
        if (kind === "connectors" && signals.pendingConnectors > 0) {
          pod.detail = t("microapp.notConfigured");
          pod.count = signals.pendingConnectors;
          pod.soft = true;
          pod.level = "warn";
        }
        return pod;
      }
      return readings[id]?.() ?? null;
    };
  }, [signals, onExpand, onOpenApp, t]);
}

function PodButton({
  pod,
  side,
  editing,
  onRemove,
}: {
  pod: Pod;
  side: HudSide;
  editing: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className={`pod-seat${editing ? " editing" : ""}`}>
      <button
        type="button"
        className={`pod${isLit(pod.level) ? " lit" : ""}${pod.live ? " live" : ""}`}
        data-level={pod.level}
        data-pod={pod.id}
        aria-label={`${pod.name}: ${pod.detail}`}
        onClick={pod.onOpen}
      >
        <span className="hex" aria-hidden />
        <span className="ic" aria-hidden>
          {pod.icon}
        </span>
        {pod.value && (
          <span className="mv" aria-hidden>
            {pod.value}
          </span>
        )}
        {pod.count ? (
          <span className={`ct${pod.soft ? " w" : ""}`} aria-hidden>
            {pod.count > 99 ? "99+" : pod.count}
          </span>
        ) : null}
        <span className={`tip ${side}`} aria-hidden>
          {pod.name}
          <span className="sub">{pod.detail}</span>
        </span>
      </button>
      {editing && (
        <button
          type="button"
          className="pod-rm"
          aria-label={`${t("desktop.hud.remove")}: ${pod.name}`}
          title={t("desktop.hud.remove")}
          onClick={onRemove}
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}

export default function DesktopPods({
  hud,
  signals,
  editing,
  onHudChange,
  onExpand,
  onOpenApp,
}: DesktopPodsProps) {
  const t = useT();
  const podFor = usePodCatalogue(signals, onExpand, onOpenApp);
  const [hoverSide, setHoverSide] = useState<HudSide | null>(null);
  const [gallery, setGallery] = useState<HudSide | null>(null);
  useEffect(() => {
    if (!editing) setGallery(null);
  }, [editing]);

  const arc = (side: HudSide, label: string) => (
    <nav
      className={`pod-arc ${side}${hoverSide === side ? " near" : ""}`}
      aria-label={label}
      onPointerEnter={() => setHoverSide(side)}
      onPointerLeave={() => setHoverSide(null)}
    >
      {hud[side].map((id) => {
        const pod = podFor(id);
        if (!pod) return null;
        return (
          <PodButton
            key={id}
            pod={pod}
            side={side}
            editing={editing}
            onRemove={() => onHudChange({ ...hud, [side]: hud[side].filter((x) => x !== id) })}
          />
        );
      })}
      {editing && (
        <div className="pod-seat editing">
          <button
            type="button"
            className="pod add"
            data-pod={`add:${side}`}
            aria-label={t("desktop.hud.add")}
            title={t("desktop.hud.add")}
            onClick={() => setGallery(side)}
          >
            <span className="hex" aria-hidden />
            <span className="ic" aria-hidden>
              +
            </span>
          </button>
        </div>
      )}
    </nav>
  );

  return (
    <>
      {arc("l", t("desktop.pods.apps"))}
      {arc("r", t("desktop.pods.readings"))}
      <HudGallery
        side={gallery}
        hud={hud}
        podFor={podFor}
        onPick={(id) => {
          if (!gallery) return;
          onHudChange({ ...hud, [gallery]: [...hud[gallery], id] });
          setGallery(null);
        }}
        onClose={() => setGallery(null)}
      />
    </>
  );
}

/** "Add to the HUD": the instruments not on an arc, as a small grid. */
function HudGallery({
  side,
  hud,
  podFor,
  onPick,
  onClose,
}: {
  side: HudSide | null;
  hud: Hud;
  podFor: (id: string) => Pod | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  // Presence out here, the dialog inside: `useDialog` registers on mount, so
  // the element it guards has to mount with it (the deck does the same).
  const { mounted, closing } = usePresence(side !== null, 160);
  if (!mounted) return null;
  return <HudGalleryBox hud={hud} podFor={podFor} onPick={onPick} onClose={onClose} closing={closing} />;
}

function HudGalleryBox({
  hud,
  podFor,
  onPick,
  onClose,
  closing,
}: {
  hud: Hud;
  podFor: (id: string) => Pod | null;
  onPick: (id: string) => void;
  onClose: () => void;
  closing: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  const free = freeInstruments(hud)
    .map((id) => podFor(id))
    .filter((p): p is Pod => p !== null);
  return (
    <DialogPortal>
      <div className={`hud-gallery${closing ? " closing" : ""}`}>
        <button
          type="button"
          className="hud-gallery-scrim"
          aria-label={t("common.close")}
          onClick={onClose}
        />
        <div
          ref={ref}
          className="hud-gallery-box"
          role="dialog"
          aria-modal="true"
          aria-label={t("desktop.hud.gallery")}
          tabIndex={-1}
        >
          <div className="in">
            <h4>{t("desktop.hud.gallery")}</h4>
            {free.length === 0 ? (
              <p className="dim">{t("desktop.hud.galleryEmpty")}</p>
            ) : (
              <div className="hud-gallery-grid">
                {free.map((pod) => (
                  <button
                    key={pod.id}
                    type="button"
                    data-add={pod.id}
                    title={pod.detail}
                    onClick={() => onPick(pod.id)}
                  >
                    <span className="e" aria-hidden>
                      {pod.icon}
                    </span>
                    {pod.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
