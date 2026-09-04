/**
 * Per-widget loading / error gate so that one failing endpoint degrades
 * only its widget (audit item 16). Skeleton while the first load is in
 * flight, inline error with retry when it failed without cached data.
 */
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useT } from "../../i18n";
import { Skeleton } from "../../components/ui";
import { ApiError } from "../../api";

type AnyQuery = Pick<UseQueryResult<unknown, Error>, "data" | "isPending" | "isError" | "error" | "refetch">;

export function WidgetGate({
  queries,
  lines = 3,
  children,
}: {
  queries: AnyQuery[];
  lines?: number;
  children: ReactNode;
}) {
  const t = useT();
  const failed = queries.find((q) => q.isError && q.data === undefined);
  if (failed) {
    const err = failed.error;
    const unreachable = err instanceof ApiError && err.unreachable;
    return (
      <div className="widget-error" role="alert">
        <strong>{unreachable ? t("common.offline") : t("widget.error")}</strong>
        {!unreachable && err?.message && <span className="widget-error-msg">{err.message}</span>}
        <button type="button" className="btn sm" onClick={() => void failed.refetch()}>
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (queries.some((q) => q.isPending && q.data === undefined)) return <Skeleton lines={lines} />;
  return <>{children}</>;
}
