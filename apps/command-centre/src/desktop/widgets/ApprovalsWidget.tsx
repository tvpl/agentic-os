/**
 * What is waiting for a decision (redesign G3): the write runs the security
 * profile put on hold. A surface the desktop opens the moment a run is held,
 * and the Attention pod's way in — deciding here is what clears the pod.
 */
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "../../components/primitives";
import { useT } from "../../i18n";
import { ApprovalsCard, useApprovals } from "../../runs/ApprovalCards";
import { useDesktopActions } from "../actions";
import type { WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export default function ApprovalsWidget(_props: WidgetProps) {
  const t = useT();
  const { openRun } = useDesktopActions();
  const approvals = useApprovals({ refetchInterval: 30_000 });
  const pending = approvals.data ?? [];
  return (
    <WidgetGate queries={[approvals]} lines={2}>
      {pending.length === 0 ? (
        <EmptyState
          className="compact"
          icon={<ShieldCheck aria-hidden />}
          title={t("desktop.approvals.empty")}
        />
      ) : (
        <ApprovalsCard approvals={pending} onLaunched={(runId) => runId && openRun(runId)} />
      )}
    </WidgetGate>
  );
}
