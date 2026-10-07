/**
 * The Skills scene's bar (immersive shell): one search pill and one row of
 * chips above the ring — mode, provider, favourites, paused — the count and
 * the pager, and a single "+" that holds the management actions
 * (marketplace, export, new skill). Nothing on the sides.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, Star, Store, Upload, WandSparkles } from "lucide-react";
import { useT } from "../../i18n";
import { providerOptions } from "../../providers/options";
import { useOsProviders } from "../../queries";
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
          <button
            type="button"
            className="sks-icon"
            aria-label={t("scene.skills.prevPage")}
            title={t("scene.skills.prevPage")}
            onClick={() => p.onPage(-1)}
          >
            <ChevronLeft aria-hidden />
          </button>
          <span className="mono">{t("scene.skills.page", { n: p.page + 1, total: p.pages })}</span>
          <button
            type="button"
            className="sks-icon"
            aria-label={t("scene.skills.nextPage")}
            title={t("scene.skills.nextPage")}
            onClick={() => p.onPage(1)}
          >
            <ChevronRight aria-hidden />
          </button>
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
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!menuRef.current?.contains(el) && !btnRef.current?.contains(el)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };
  return (
    <span className="sks-more">
      <button
        ref={btnRef}
        type="button"
        className="sks-plus"
        data-testid="skills-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("scene.skills.manage")}
        title={t("scene.skills.manage")}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="sks-menu"
          role="menu"
          tabIndex={-1}
          aria-label={t("scene.skills.manage")}
          onKeyDown={onKey}
        >
          <button type="button" role="menuitem" onClick={pick(onMarket)}>
            <Store aria-hidden /> {t("skills.market.title")}
          </button>
          <button type="button" role="menuitem" onClick={pick(onExport)}>
            <Upload aria-hidden /> {t("skills.export")}
          </button>
          <button type="button" role="menuitem" className="new" onClick={pick(onNew)}>
            <WandSparkles aria-hidden /> {t("skills.new")}
          </button>
        </div>
      )}
    </span>
  );
}
