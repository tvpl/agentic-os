import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { AREA_COLORS } from "../data";
import { WidgetGate } from "./WidgetGate";

interface MemoryStatus {
  facets: { total: number; areas: Array<{ area: string; count: number }> };
}

export default function WorkspaceWidget() {
  const t = useT();
  const locale = useLocale();
  const status = useApiQuery<MemoryStatus>(qk.memoryStatus, "/api/memory/status", { refetchInterval: 60_000 });
  const total = status.data?.facets.total ?? 0;
  const areas = status.data?.facets.areas ?? [];
  const max = Math.max(1, ...areas.map((a) => a.count));
  return (
    <WidgetGate queries={[status]} lines={3}>
      <div className="stat ws-total">
        <span className="value accented">{total.toLocaleString(locale)}</span>
        <span className="label">{t("widget.filesIndexed")}</span>
      </div>
      {areas.slice(0, 4).map((a, i) => (
        <div key={a.area} className="ws-row">
          <span className="hud-label ws-area" title={a.area}>
            {a.area}
          </span>
          <span className="ws-dots" style={{ "--c": AREA_COLORS[i % AREA_COLORS.length] } as React.CSSProperties}>
            {Array.from({ length: Math.max(1, Math.round((a.count / max) * 14)) }, (_, d) => (
              <span key={d} className="ws-dot" />
            ))}
          </span>
          <span className="mono ws-count">{a.count}</span>
        </div>
      ))}
    </WidgetGate>
  );
}
