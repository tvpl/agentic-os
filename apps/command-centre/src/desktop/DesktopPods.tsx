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
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  Coins,
  FolderOpen,
  Images,
  Plug,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings, useOsSkills } from "../queries";
import { budgetState } from "./budget";
import { useDesktopRoutines, useDesktopRuns } from "./data";
import { useAppRows } from "./appRows";
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
  /** Fans the radial deck out over the console. */
  onOpenDeck: () => void;
}

export default function DesktopPods({ activeRuns, onExpand, onOpenDeck }: DesktopPodsProps) {
  const t = useT();
  const navigate = useNavigate();
  const { apps, pending } = useAppRows(3);
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
        onOpen: () => onExpand("now"),
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
  }, [runs.data, routines.data, settings.data, metrics.data, approvals.data, activeRuns, t, onExpand]);

  const left = useMemo<Pod[]>(() => {
    const appIcons: Record<string, ReactNode> = {
      "/brain": <BrainCircuit aria-hidden />,
      "/pixel": <Images aria-hidden />,
      "/generations": <Images aria-hidden />,
      "/artifacts": <FolderOpen aria-hidden />,
    };
    const out: Pod[] = apps.map((row) => ({
      id: row.to,
      icon: appIcons[row.to] ?? row.icon,
      name: row.name,
      detail: row.desc,
      level: "idle" as const,
      onOpen: () => navigate(row.to),
    }));
    out.splice(1, 0, {
      id: "/skills",
      icon: <Sparkles aria-hidden />,
      name: t("nav.skills"),
      detail: t("desktop.pods.skills", { n: (skills.data ?? []).filter((s) => s.enabled).length }),
      value: String((skills.data ?? []).filter((s) => s.enabled).length),
      level: "idle",
      // The pod fans the deck out rather than leaving the desktop: running a
      // skill is a desktop action, managing them is what /skills is for.
      onOpen: onOpenDeck,
    });
    if (pending.length > 0)
      out.push({
        id: "/connectors",
        icon: <Plug aria-hidden />,
        name: t("desktop.apps.add"),
        detail: t("microapp.notConfigured"),
        count: pending.length,
        soft: true,
        level: "warn",
        onOpen: () => navigate("/connectors"),
      });
    return out;
  }, [apps, pending, skills.data, navigate, onOpenDeck, t]);

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
