/**
 * The work context of a run (.specs/features/cerebro-contextos, AC 24), on the sheet line of the run detail: the
 * context's name, or, when the context was deleted after the run was recorded, the id the run keeps with the text
 * "Context deleted". While the list of contexts loads (or cannot be read), the id alone: nothing is claimed.
 */
import { Crosshair } from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { useT } from "../i18n";

export type ContextList = ApiCallResult<"GET /api/contexts">["contexts"];

export function RunContext({
  contextId,
  contexts,
}: {
  contextId: string;
  contexts: ContextList | undefined;
}) {
  const t = useT();
  const context = contexts?.find((c) => c.id === contextId);
  const deleted = contexts !== undefined && context === undefined;
  return (
    <span className="run-work-context" title={contextId}>
      <Crosshair aria-hidden size={12} />{" "}
      {context ? <span>{context.name}</span> : <span className="mono">{contextId}</span>}
      {deleted && (
        <>
          {" "}
          <span>{t("context.deleted")}</span>
        </>
      )}
    </span>
  );
}
