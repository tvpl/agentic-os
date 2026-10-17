/**
 * The Skills scene's bar (immersive shell): one search pill and one row of
 * chips above the ring — mode, provider, favourites, paused — the count and
 * the pager, and a single "+" that holds the management actions
 * (marketplace, export, new skill). Nothing on the sides.
 */
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, Star, Store, Upload, WandSparkles } from "lucide-react";
import { useT } from "../../i18n";
import { providerOptions } from "../../providers/options";
import { useOsProviders } from "../../queries";
import { DropdownMenu, Tooltip } from "../../ui";
import type { ModeFilter, ProviderFilter, SkillFilters } from "./skillsMatch";

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
  const providers = useOsProviders();
  const f = p.filters;
  const set = (patch: Partial<SkillFilters>) => p.onFilters({ ...f, ...patch });
  return (
    <nav className="sks-tools sks-bar" aria-label={t("scene.skills.tools")}>
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
      <div className="sks-chips" role="group" aria-label={t("scene.skills.mode")}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className="sks-fchip"
            data-mode={m}
            aria-pressed={f.mode === m}
            onClick={() => set({ mode: m })}
          >
            {t(`scene.skills.mode.${m}`)}
          </button>
        ))}
        <span className="sks-chip-sep" aria-hidden />
        {(["all", ...providerOptions(providers.data)] as ProviderFilter[]).map((prov) => (
          <button
            key={prov}
            type="button"
            className="sks-fchip mono"
            aria-pressed={f.provider === prov}
            onClick={() => set({ provider: prov })}
          >
            {prov === "all" ? t("scene.skills.provider.all") : prov}
          </button>
        ))}
        <span className="sks-chip-sep" aria-hidden />
        <button
          type="button"
          className="sks-fchip"
          aria-pressed={f.favOnly}
          onClick={() => set({ favOnly: !f.favOnly })}
        >
          <Star aria-hidden fill={f.favOnly ? "currentColor" : "none"} /> {t("scene.skills.favorites")}
        </button>
        <button
          type="button"
          className="sks-fchip"
          aria-pressed={f.showPaused}
          disabled={p.pausedCount === 0 && !f.showPaused}
          onClick={() => set({ showPaused: !f.showPaused })}
        >
          {t("scene.skills.paused", { n: p.pausedCount })}
        </button>
      </div>
      <span className="sp" />
      <p className="sks-count mono" aria-live="polite">
        {t("scene.skills.count", { shown: p.shown, total: p.total })}
      </p>
      {p.pages > 1 && (
        <span className="sks-pager">
          <Tooltip label={t("scene.skills.prevPage")}>
            <button
              type="button"
              className="sks-icon"
              aria-label={t("scene.skills.prevPage")}
              onClick={() => p.onPage(-1)}
            >
              <ChevronLeft aria-hidden />
            </button>
          </Tooltip>
          <span className="mono">{t("scene.skills.page", { n: p.page + 1, total: p.pages })}</span>
          <Tooltip label={t("scene.skills.nextPage")}>
            <button
              type="button"
              className="sks-icon"
              aria-label={t("scene.skills.nextPage")}
              onClick={() => p.onPage(1)}
            >
              <ChevronRight aria-hidden />
            </button>
          </Tooltip>
        </span>
      )}
      <MoreMenu onMarket={p.onMarket} onExport={p.onExport} onNew={p.onNew} />
    </nav>
  );
}

/** The one "+": marketplace, export and a new skill, as a menu. */
function MoreMenu({
  onMarket,
  onExport,
  onNew,
}: {
  onMarket: () => void;
  onExport: () => void;
  onNew: () => void;
}) {
  const t = useT();
  return (
    <span className="sks-more">
      <DropdownMenu
        tip={t("scene.skills.manage")}
        trigger={
          <button
            type="button"
            className="sks-plus"
            data-testid="skills-more"
            aria-label={t("scene.skills.manage")}
          >
            <Plus aria-hidden />
          </button>
        }
        items={[
          { id: "market", label: t("skills.market.title"), icon: <Store aria-hidden />, onSelect: onMarket },
          { id: "export", label: t("skills.export"), icon: <Upload aria-hidden />, onSelect: onExport },
          {
            id: "new",
            label: t("skills.new"),
            icon: <WandSparkles aria-hidden />,
            onSelect: onNew,
            className: "new",
          },
        ]}
      />
    </span>
  );
}
