import { Link } from "react-router-dom";
import { FolderPlus } from "lucide-react";
import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { AREA_COLORS } from "../data";
import { useTweenNumber } from "../useTweenNumber";
import { cfgNumber, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

interface MemoryStatus {
  facets: { total: number; areas: Array<{ area: string; count: number }> };
}

export default function WorkspaceWidget({ config }: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const status = useApiQuery<MemoryStatus>(qk.memoryStatus, "/api/memory/status", {
    refetchInterval: 300_000,
  });
  const total = status.data?.facets.total ?? 0;
  const shown = useTweenNumber(total, 400);
  const areas = status.data?.facets.areas ?? [];
  const rows = cfgNumber(config, "rows", 4);
  const max = Math.max(1, ...areas.map((a) => a.count));
  return (
    <WidgetGate queries={[status]} lines={3}>
      {status.data && total === 0 ? (
        <EmptyState
          className="compact"
          icon={<FolderPlus aria-hidden />}
          title={t("desktop.workspace.empty")}
          body={t("desktop.workspace.emptyBody")}
          action={
            <Link to="/settings?tab=memory" className="btn sm primary">
              {t("desktop.workspace.addFolder")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="stat ws-total">
            <span className="value accented tnum">{Math.round(shown).toLocaleString(locale)}</span>
            <span className="label">{t("widget.filesIndexed")}</span>
          </div>
          {areas.slice(0, rows).map((a, i) => (
            <AreaRow
              key={a.area}
              area={a.area}
              count={a.count}
              max={max}
              color={AREA_COLORS[i % AREA_COLORS.length]!}
            />
          ))}
        </>
      )}
    </WidgetGate>
  );
}

function AreaRow({ area, count, max, color }: { area: string; count: number; max: number; color: string }) {
  const shown = useTweenNumber(count, 400);
  return (
    <div className="ws-row">
      <span className="hud-label ws-area" title={area}>
        {area}
      </span>
      <span className="ws-dots" style={{ "--dot-color": color } as React.CSSProperties}>
        {Array.from({ length: Math.max(1, Math.round((count / max) * 14)) }, (_, d) => (
          <span key={d} className="ws-dot" />
        ))}
      </span>
      <span className="mono ws-count tnum">{Math.round(shown)}</span>
    </div>
  );
}
