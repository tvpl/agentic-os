/** The frame's left region (design Tela 1): the brand and the ten labelled places. */
import { useRef } from "react";
import { Link } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useT } from "../i18n";
import { useDrawer } from "../ui";
import { ContextSelector } from "../contexts/ContextSelector";
import { useScrimPress } from "./hooks";
import { NAV_GROUPS, type NavItem } from "./nav";

export interface SidebarProps {
  name: string;
  current: NavItem;
  collapsed: boolean;
  /** Narrow and unfolded: the sidebar is a modal overlay and traps focus like a drawer. */
  overlay: boolean;
  pending: number;
  onToggle: () => void;
  onFold: () => void;
}

export function Sidebar({ name, current, collapsed, overlay, pending, onToggle, onFold }: SidebarProps) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  useDrawer(ref, onFold, {
    open: overlay,
    initialFocus: () => ref.current?.querySelector<HTMLElement>('[aria-current="page"]'),
  });
  useScrimPress(onFold, overlay, ref);
  return (
    <nav
      className="mold-nav"
      aria-label={t("moldura.nav.label")}
      ref={ref}
      tabIndex={-1}
      data-overlay={overlay ? "" : undefined}
    >
      <div className="mold-brand" title={name}>
        <span className="mold-brand-mark" aria-hidden>
          {name.trim().charAt(0).toUpperCase() || "M"}
        </span>
        {!collapsed && <span className="mold-brand-name">{name}</span>}
      </div>
      {/* The work context, between the brand and the main group (cerebro-contextos design). */}
      <ContextSelector variant="frame" collapsed={collapsed} />
      <NavGroup items={NAV_GROUPS.main} current={current} collapsed={collapsed} pending={pending} />
      <div className="mold-nav-group">
        {collapsed ? (
          <hr className="mold-sep" />
        ) : (
          <div className="mold-group-t" id="mold-more">
            {t("moldura.nav.more")}
          </div>
        )}
        <NavGroup
          items={NAV_GROUPS.more}
          current={current}
          collapsed={collapsed}
          labelledBy={collapsed ? undefined : "mold-more"}
        />
      </div>
      <hr className="mold-sep" />
      <NavGroup items={NAV_GROUPS.end} current={current} collapsed={collapsed} />
      <span className="mold-nav-sp" />
      {/* One name for both states; `aria-expanded` says which, the tooltip what a press does. */}
      <button
        type="button"
        className="mold-collapse"
        aria-expanded={!collapsed}
        aria-label={t("moldura.nav.sidebar")}
        title={collapsed ? t("moldura.nav.expand") : t("moldura.nav.collapse")}
        onClick={onToggle}
      >
        {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        {!collapsed && <span>{t("moldura.nav.sidebar")}</span>}
      </button>
    </nav>
  );
}

function NavGroup({
  items,
  current,
  collapsed,
  pending = 0,
  labelledBy,
}: {
  items: readonly NavItem[];
  current: NavItem;
  collapsed: boolean;
  pending?: number;
  labelledBy?: string;
}) {
  const t = useT();
  return (
    <ul className="mold-list" aria-labelledby={labelledBy}>
      {items.map((it) => {
        const label = t(it.labelKey);
        const count = it.id === "today" ? pending : 0;
        // The name carries what the badge shows: collapsed, the label is all there is of the text.
        const name = count > 0 ? t("moldura.nav.labelPending", { label, n: count }) : label;
        return (
          <li key={it.id}>
            <Link
              to={it.to}
              className="mold-link"
              data-nav={it.id}
              aria-current={it.id === current.id ? "page" : undefined}
              aria-label={collapsed || count > 0 ? name : undefined}
              title={collapsed ? name : undefined}
            >
              <it.Icon aria-hidden className="mold-link-i" />
              {!collapsed && <span className="mold-link-t">{label}</span>}
              {count > 0 && (
                <span className="mold-count mono" aria-hidden>
                  {count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
