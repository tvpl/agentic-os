/**
 * The Skills scene's quiet toolbar (immersive shell): the finder, the
 * filters and the management actions (marketplace, export, new skill), as
 * typography in the top-left corner. No buttons-as-boxes.
 */
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, Star, Store, Upload } from "lucide-react";
import type { ProviderId } from "../../api";
import { useT } from "../../i18n";
import type { ModeFilter, ProviderFilter, SkillFilters } from "./skillsMatch";

const PROVIDERS: ProviderId[] = ["claude", "cursor", "codex"];
const MODES: ModeFilter[] = ["all", "read_only", "write"];

export interface ToolsProps {
  query: string;
  onQuery: (q: string) => void;
  onQueryKey: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement>;
  filters: SkillFilters;
  onFilters: (f: SkillFilters) => void;
  pausedCount: number;
  shown: number;
  total: number;
  page: number;
  pages: number;
  onPage: (dir: 1 | -1) => void;
  onMarket: () => void;
  onExport: () => void;
  onNew: () => void;
}

export default function SkillsTools(p: ToolsProps) {
  const t = useT();
  const f = p.filters;
  const set = (patch: Partial<SkillFilters>) => p.onFilters({ ...f, ...patch });
  return (
    <nav className="sks-tools" aria-label={t("scene.skills.tools")}>
      <label className="sks-find">
        <Search aria-hidden />
        <input
          ref={p.inputRef}
          type="search"
          value={p.query}
          placeholder={t("scene.skills.filterPh")}
          aria-label={t("scene.skills.filterLabel")}
          onChange={(e: ChangeEvent<HTMLInputElement>) => p.onQuery(e.target.value)}
          onKeyDown={p.onQueryKey}
        />
      </label>
      <div className="sks-filters">
        <div className="sks-row" role="group" aria-label={t("scene.skills.mode")}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className="sks-opt"
              data-mode={m}
              aria-pressed={f.mode === m}
              onClick={() => set({ mode: m })}
            >
              {t(`scene.skills.mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="sks-row" role="group" aria-label={t("scene.skills.provider")}>
          {(["all", ...PROVIDERS] as ProviderFilter[]).map((prov) => (
            <button
              key={prov}
              type="button"
              className="sks-opt mono"
              aria-pressed={f.provider === prov}
              onClick={() => set({ provider: prov })}
            >
              {prov === "all" ? t("scene.skills.provider.all") : prov}
            </button>
          ))}
        </div>
        <div className="sks-row">
          <button
            type="button"
            className="sks-opt"
            aria-pressed={f.favOnly}
            onClick={() => set({ favOnly: !f.favOnly })}
          >
            <Star aria-hidden fill={f.favOnly ? "currentColor" : "none"} /> {t("scene.skills.favorites")}
          </button>
          <button
            type="button"
            className="sks-opt"
            aria-pressed={f.showPaused}
            disabled={p.pausedCount === 0 && !f.showPaused}
            onClick={() => set({ showPaused: !f.showPaused })}
          >
            {t("scene.skills.paused", { n: p.pausedCount })}
          </button>
        </div>
        <p className="sks-count mono" aria-live="polite">
          {t("scene.skills.count", { shown: p.shown, total: p.total })}
        </p>
        {p.pages > 1 && (
          <div className="sks-row sks-pager">
            <button
              type="button"
              className="sks-opt"
              aria-label={t("scene.skills.prevPage")}
              title={t("scene.skills.prevPage")}
              onClick={() => p.onPage(-1)}
            >
              <ChevronLeft aria-hidden />
            </button>
            <span className="mono">{t("scene.skills.page", { n: p.page + 1, total: p.pages })}</span>
            <button
              type="button"
              className="sks-opt"
              aria-label={t("scene.skills.nextPage")}
              title={t("scene.skills.nextPage")}
              onClick={() => p.onPage(1)}
            >
              <ChevronRight aria-hidden />
            </button>
          </div>
        )}
        <div className="sks-row sks-manage" role="group" aria-label={t("scene.skills.manage")}>
          <button type="button" className="sks-opt" onClick={p.onMarket}>
            <Store aria-hidden /> {t("skills.market.title")}
          </button>
          <button type="button" className="sks-opt" onClick={p.onExport}>
            <Upload aria-hidden /> {t("skills.export")}
          </button>
          <button type="button" className="sks-opt new" onClick={p.onNew}>
            <Plus aria-hidden /> {t("skills.new")}
          </button>
        </div>
      </div>
    </nav>
  );
}
