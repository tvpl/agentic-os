/**
 * The pods (redesign F7): the desktop's instruments as hexagons on two arcs —
 * apps on the left, readings on the right.
 *
 * This replaces the ambient strip's line of text and the rail's drawer. The
 * strip proved the rule (`idle` never lights up) but kept the old shape: a row
 * of numbers at the top, which is what the dashboard already was. A pod gives
 * the same reading a body — glyph, one value, a counter when something is
 * pending — so a glance at the edge of the screen answers "does anything need
 * me?" without reading anything.
 *
 * Levels still come from `signal.ts`, so a pod and the panel behind it can
 * never disagree.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CalendarClock, Coins, Terminal } from "lucide-react";
import { useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings, useOsSkills } from "../queries";
import { budgetState } from "./budget";
import { useDesktopRoutines, useDesktopRuns } from "./data";
import { useAppRows } from "./appRows";
import { APPS, type AppKind } from "./apps";
import {
  attentionItems,
  attentionSignal,
  costSignal,
  isLit,
  pulseSignal,
  routinesSignal,
  runsSignal,
  type SignalValue,
} from "./signal";

interface Approval {
  id: string;
}

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

function PodButton({ pod, side }: { pod: Pod; side: "l" | "r" }) {
  return (
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
  );
}

export interface DesktopPodsProps {
  activeRuns: number;
  /** Opens a widget's surface; the desktop decides whether it can. */
  onExpand: (widgetId: string) => void;
  /** Opens one of the OS's apps as a panel on the stage. */
  onOpenApp: (kind: AppKind) => void;
}

export default function DesktopPods({ activeRuns, onExpand, onOpenApp }: DesktopPodsProps) {
  const t = useT();
  const { pending } = useAppRows(3);
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const skills = useOsSkills();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  const settings = useOsSettings();
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });
  const [hoverSide, setHoverSide] = useState<"l" | "r" | null>(null);

  const right = useMemo<Pod[]>(() => {
    const runList = runs.data ?? [];
    // "done" is the canonical success status (core/src/runs/runManager.ts).
    const finished = runList.filter(
      (r) => r.status === "done" || r.status === "failed" || r.status === "timed_out",
    );
    const succeeded = finished.filter((r) => r.status === "done").length;
    const routineList = routines.data ?? [];
    const due = routineList.filter((r) => r.enabled).length;
    const fired = routineList.filter((r) => r.enabled && r.healthy).length;
    const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
    const attentionCount = attentionItems({
      failures: runList.filter((r) => r.status === "failed" || r.status === "timed_out").length,
      unhealthyRoutines: routineList.filter((r) => !r.healthy).length,
      approvals: approvals.data?.length ?? 0,
      budgetHot: budget.tone === "warn" || budget.tone === "over",
    });

    const pulse = pulseSignal(succeeded, finished.length);
    const attention = attentionSignal(attentionCount);
    const routineSig = routinesSignal(fired, due);
    const cost = costSignal(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
    const runsSig = runsSignal(activeRuns);

    return [
      {
        id: "pulse",
        icon: <Activity aria-hidden />,
        name: t("desktop.widget.pulse"),
        detail: pulse.label,
        value: pulse.value,
        level: pulse.level,
        onOpen: () => onExpand("pulse"),
      },
      {
        id: "attention",
        icon: <AlertTriangle aria-hidden />,
        name: t("desktop.widget.attention"),
        detail: attention.label,
        count: attentionCount,
        level: attention.level,
        onOpen: () => onExpand("attention"),
      },
      {
        id: "runs",
        icon: <Terminal aria-hidden />,
        name: t("desktop.hud.runs"),
        detail: runsSig.label,
        value: runsSig.value,
        level: runsSig.level,
        live: activeRuns > 0,
        // The prototype's runs pod opens the Runs app; the objective panel
        // (`now`) stays one palette action away.
        onOpen: () => onOpenApp("runs"),
      },
      {
        id: "routines",
        icon: <CalendarClock aria-hidden />,
        name: t("desktop.widget.routines"),
        detail: routineSig.label,
        value: routineSig.value,
        level: routineSig.level,
        onOpen: () => onExpand("routines"),
      },
      {
        id: "cost",
        icon: <Coins aria-hidden />,
        name: t("desktop.widget.cost"),
        detail: cost.label,
        value: cost.value,
        level: cost.level,
        onOpen: () => onExpand("cost"),
      },
    ];
  }, [
    runs.data,
    routines.data,
    settings.data,
    metrics.data,
    approvals.data,
    activeRuns,
    t,
    onExpand,
    onOpenApp,
  ]);

  const left = useMemo<Pod[]>(() => {
    // The prototype's left arc: brain, skills, artifacts, generations,
    // connectors, settings — plus Pixel Studio, until G5 lets the HUD be
    // edited. Every pod opens its app as a panel on the stage.
    const order: AppKind[] = [
      "brain",
      "skills",
      "artifacts",
      "generations",
      "connectors",
      "settings",
      "pixel",
    ];
    const enabled = (skills.data ?? []).filter((s) => s.enabled).length;
    return order.map((kind) => {
      const def = APPS[kind];
      const Icon = def.Icon;
      const pod: Pod = {
        id: `app:${kind}`,
        icon: <Icon aria-hidden />,
        name: t(def.titleKey),
        detail: t(def.descKey),
        level: "idle",
        onOpen: () => onOpenApp(kind),
      };
      if (kind === "skills") {
        pod.detail = t("desktop.pods.skills", { n: enabled });
        pod.value = String(enabled);
      }
      if (kind === "connectors" && pending.length > 0) {
        pod.detail = t("microapp.notConfigured");
        pod.count = pending.length;
        pod.soft = true;
        pod.level = "warn";
      }
      return pod;
    });
  }, [pending, skills.data, onOpenApp, t]);

  return (
    <>
      <nav
        className={`pod-arc l${hoverSide === "l" ? " near" : ""}`}
        aria-label={t("desktop.pods.apps")}
        onPointerEnter={() => setHoverSide("l")}
        onPointerLeave={() => setHoverSide(null)}
      >
        {left.map((pod) => (
          <PodButton key={pod.id} pod={pod} side="l" />
        ))}
      </nav>
      <nav
        className={`pod-arc r${hoverSide === "r" ? " near" : ""}`}
        aria-label={t("desktop.pods.readings")}
        onPointerEnter={() => setHoverSide("r")}
        onPointerLeave={() => setHoverSide(null)}
      >
        {right.map((pod) => (
          <PodButton key={pod.id} pod={pod} side="r" />
        ))}
      </nav>
    </>
  );
}
