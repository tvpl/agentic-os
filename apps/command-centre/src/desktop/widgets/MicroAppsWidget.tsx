/**
 * Micro apps: the OS's own apps as rows (icon, name, one-line description,
 * arrow), then the connectors that exist but are not configured as ghosted
 * rows (`.ma-icon.ghost` / `.ma-name.dim`), then "+ Add app".
 */
import { Link } from "react-router-dom";
import { BrainCircuit, FolderOpen, Grid3x3, Images, Plug, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useOsConnectors } from "../../queries";
import type { WidgetProps } from "../widgetTypes";

interface AppRow {
  to: string;
  icon: ReactNode;
  name: string;
  desc: string;
  ghost?: boolean;
}

/** A connector counts as configured once its status leaves the "available" catalogue state. */
export function isConfigured(status: string): boolean {
  const s = status.toLowerCase();
  return s === "connected" || s === "configured" || s === "ok" || s === "enabled";
}

export default function MicroAppsWidget(_props: WidgetProps) {
  const t = useT();
  const connectors = useOsConnectors({ staleTime: 60_000, retry: false });

  const apps: AppRow[] = [
    {
      to: "/brain",
      icon: <BrainCircuit aria-hidden />,
      name: t("nav.brain"),
      desc: t("microapp.brain.desc"),
    },
    { to: "/pixel", icon: <Grid3x3 aria-hidden />, name: t("nav.pixel"), desc: t("microapp.pixel.desc") },
    {
      to: "/generations",
      icon: <Images aria-hidden />,
      name: t("desktop.apps.generations"),
      desc: t("desktop.apps.generationsDesc"),
    },
    {
      to: "/artifacts",
      icon: <FolderOpen aria-hidden />,
      name: t("desktop.apps.artifacts"),
      desc: t("desktop.apps.artifactsDesc"),
    },
  ];

  const pending = (connectors.data ?? [])
    .filter((c) => !isConfigured(c.status))
    .slice(0, 2)
    .map<AppRow>((c) => ({
      to: `/connectors#${encodeURIComponent(c.id)}`,
      icon: <Plug aria-hidden />,
      name: c.name,
      desc: t("microapp.notConfigured"),
      ghost: true,
    }));

  return (
    <>
      {[...apps, ...pending].map((row) => (
        <Link className="microapp-row" to={row.to} key={row.to}>
          <span className={`ma-icon${row.ghost ? " ghost" : ""}`}>{row.icon}</span>
          <span className="ma-text">
            <span className={`ma-name${row.ghost ? " dim" : ""}`}>{row.name}</span>
            <span className="ma-desc">{row.desc}</span>
          </span>
          <span className="ma-arrow" aria-hidden>
            →
          </span>
        </Link>
      ))}
      <Link className="microapp-row add" to="/connectors">
        <span className="ma-icon ghost">
          <Plus aria-hidden />
        </span>
        <span className="ma-text">
          <span className="ma-name dim">{t("desktop.apps.add")}</span>
        </span>
      </Link>
    </>
  );
}
