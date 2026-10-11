/**
 * What I know about you (refino item 33): the durable facts the agent
 * asserted, each with where it came from and a way to take it back.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { apiCall } from "../../apiCall";
import { useLocale, useT } from "../../i18n";
import { useApiQuery } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { timeAgo, useToast } from "../../components/ui";
import { useDesktopActions } from "../actions";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";
import { Tooltip } from "../../ui";

interface Fact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validTo: number | null;
  sourceRunId: string | null;
  sourcePath: string | null;
}
interface FactsPayload {
  facts: Fact[];
  stats: { open: number; expired: number; subjects: number };
}

export default function FactsWidget(_props: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { openRun } = useDesktopActions();
  const facts = useApiQuery<FactsPayload>(["memory", "facts"], "/api/memory/facts", {
    refetchInterval: 120_000,
  });
  const retract = useMutation({
    mutationFn: (id: number) => apiCall("POST /api/memory/facts/:id/retract", { params: { id } }),
    onSuccess: () => {
      toast(t("desktop.facts.retracted"), "ok");
      qc.invalidateQueries({ queryKey: ["memory", "facts"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const open = (facts.data?.facts ?? []).filter((f) => f.validTo === null).slice(0, 30);
  return (
    <WidgetGate queries={[facts]} lines={3}>
      {open.length === 0 ? (
        <EmptyState
          className="compact"
          title={t("desktop.facts.empty")}
          body={t("desktop.facts.emptyBody")}
        />
      ) : (
        <div className="facts">
          <p className="dm-note">{t("desktop.facts.count", { n: open.length })}</p>
          {open.map((f) => (
            <div key={f.id} className="rw fact-row">
              <span className="fact-text">
                <b>{f.subject}</b> {f.predicate} <span className="fact-object">{f.object}</span>
              </span>
              <span className="sp" />
              {f.sourceRunId ? (
                <button type="button" className="go" onClick={() => openRun(f.sourceRunId!)}>
                  {timeAgo(f.validFrom, locale)}
                </button>
              ) : (
                <span className="dm">{timeAgo(f.validFrom, locale)}</span>
              )}
              <Tooltip label={t("desktop.facts.retract")}>
                <button
                  type="button"
                  className="go icon quiet"
                  aria-label={t("desktop.facts.retract")}
                  disabled={retract.isPending}
                  onClick={() => retract.mutate(f.id)}
                >
                  <Undo2 aria-hidden />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </WidgetGate>
  );
}
