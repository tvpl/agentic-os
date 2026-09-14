/**
 * The OS's own apps, plus the connectors that exist but were never finished.
 * Shared by the app rail (the chrome) and the micro-apps widget (the legacy
 * grid tile) so the two can never list different apps.
 */
import { BrainCircuit, FolderOpen, Grid3x3, Images, Plug, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../i18n";
import { useOsConnectors } from "../queries";

export interface AppRow {
  to: string;
  icon: ReactNode;
  Icon: LucideIcon;
  name: string;
  desc: string;
  /** A connector the user started and never configured. */
  ghost?: boolean;
}

/** A connector counts as configured once its status leaves the "available" catalogue state. */
export function isConfigured(status: string): boolean {
  const s = status.toLowerCase();
  return s === "connected" || s === "configured" || s === "ok" || s === "enabled";
}

export function useAppRows(pendingLimit = 2): { apps: AppRow[]; pending: AppRow[] } {
  const t = useT();
  const connectors = useOsConnectors({ staleTime: 60_000, retry: false });

  const apps: AppRow[] = [
    {
      to: "/brain",
      Icon: BrainCircuit,
      icon: <BrainCircuit aria-hidden />,
      name: t("nav.brain"),
      desc: t("microapp.brain.desc"),
    },
    {
      to: "/pixel",
      Icon: Grid3x3,
      icon: <Grid3x3 aria-hidden />,
      name: t("nav.pixel"),
      desc: t("microapp.pixel.desc"),
    },
    {
      to: "/generations",
      Icon: Images,
      icon: <Images aria-hidden />,
      name: t("desktop.apps.generations"),
      desc: t("desktop.apps.generationsDesc"),
    },
    {
      to: "/artifacts",
      Icon: FolderOpen,
      icon: <FolderOpen aria-hidden />,
      name: t("desktop.apps.artifacts"),
      desc: t("desktop.apps.artifactsDesc"),
    },
  ];

  const pending = (connectors.data ?? [])
    .filter((c) => !isConfigured(c.status))
    .slice(0, pendingLimit)
    .map<AppRow>((c) => ({
      to: `/connectors#${encodeURIComponent(c.id)}`,
      Icon: Plug,
      icon: <Plug aria-hidden />,
      name: c.name,
      desc: t("microapp.notConfigured"),
      ghost: true,
    }));

  return { apps, pending };
}
