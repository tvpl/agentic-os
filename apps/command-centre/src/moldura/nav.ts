import { Sun, type LucideIcon } from "lucide-react";
import type { TKey } from "../i18n";
import { APPS, appForPath, type AppKind } from "../desktop/apps";

export interface NavItem {
  id: "today" | AppKind;
  to: string;
  labelKey: TKey;
  Icon: LucideIcon;
}

const item = (kind: AppKind, labelKey: TKey): NavItem => ({
  id: kind,
  to: APPS[kind].route,
  labelKey,
  Icon: APPS[kind].Icon,
});

/** The sidebar, top to bottom (design Tela 1): the main group, "More", then Settings alone. */
const NAV_MAIN: readonly NavItem[] = [
  { id: "today", to: "/", labelKey: "moldura.nav.today", Icon: Sun },
  // "Painéis", right after "Hoje" (.specs/features/cerebro-paineis, amendment 25).
  item("dashboards", "dash.nav"),
  item("runs", "moldura.nav.runs"),
  item("skills", "moldura.nav.skills"),
  item("routines", "moldura.nav.routines"),
  item("brain", "moldura.nav.memory"),
];
const NAV_MORE: readonly NavItem[] = [
  item("connectors", "moldura.nav.connectors"),
  item("artifacts", "moldura.nav.artifacts"),
  item("generations", "moldura.nav.generations"),
  item("pixel", "moldura.nav.pixel"),
];
const NAV_END: readonly NavItem[] = [item("settings", "moldura.nav.settings")];
export const NAV_GROUPS = { main: NAV_MAIN, more: NAV_MORE, end: NAV_END } as const;
const NAV_ALL = [...NAV_MAIN, ...NAV_MORE, ...NAV_END];

/**
 * The item a path belongs to: a detail route is its parent's. `null` for a
 * path that is no place of the frame (the frame sends it to Today).
 */
export function navItemFor(pathname: string): NavItem | null {
  if (pathname === "/") return NAV_MAIN[0]!;
  const app = appForPath(pathname);
  return NAV_ALL.find((n) => n.id === app?.kind) ?? null;
}
