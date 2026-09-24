/**
 * The apps (redesign G2): the nine views the OS has, registered as panels of
 * kind `app` so a pod, the palette or a deep link opens them *on the stage*
 * instead of navigating away from it. The prototype's `APPDEF`, with the
 * production views behind it.
 *
 * Each app keeps its own path and query in the panel's `config` — `/runs/abc`,
 * `?tab=security` — so a Runs panel remembers which run it shows across a
 * reload and a space switch, and a `Link` inside it still works: the router
 * bounces the URL back to `/` and the desktop hands the path to the panel.
 */
import type { ComponentType } from "react";
import {
  BrainCircuit,
  CalendarClock,
  FolderOpen,
  Grid3x3,
  Images,
  ListTree,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "../i18n";
import { lazyRoute } from "../lazyRoute";
import type { Size } from "./windowModel";

export const APP_KINDS = [
  "brain",
  "skills",
  "artifacts",
  "generations",
  "connectors",
  "settings",
  "routines",
  "runs",
  "pixel",
] as const;
export type AppKind = (typeof APP_KINDS)[number];

export interface AppDef {
  kind: AppKind;
  /** The route the app answered to; still a deep link into the panel. */
  route: string;
  titleKey: TKey;
  refKey: TKey;
  /** One line under the name in the pod's tooltip. */
  descKey: TKey;
  Icon: LucideIcon;
  /** The box it opens in, before the user resizes it. */
  size: Size;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the views take their own props
  Component: ComponentType<any>;
}

export const APPS: Record<AppKind, AppDef> = {
  brain: {
    kind: "brain",
    route: "/brain",
    titleKey: "nav.brain",
    refKey: "desktop.ref.app.brain",
    descKey: "microapp.brain.desc",
    Icon: BrainCircuit,
    size: { w: 960, h: 600 },
    Component: lazyRoute(() => import("../views/SecondBrain")),
  },
  skills: {
    kind: "skills",
    route: "/skills",
    titleKey: "nav.skills",
    refKey: "desktop.ref.app.skills",
    descKey: "desktop.pods.skillsDesc",
    Icon: Sparkles,
    size: { w: 680, h: 480 },
    Component: lazyRoute(() => import("../views/Skills")),
  },
  artifacts: {
    kind: "artifacts",
    route: "/artifacts",
    titleKey: "shell.route.artifacts",
    refKey: "desktop.ref.app.artifacts",
    descKey: "desktop.apps.artifactsDesc",
    Icon: FolderOpen,
    size: { w: 640, h: 460 },
    Component: lazyRoute(() => import("../views/Artifacts")),
  },
  generations: {
    kind: "generations",
    route: "/generations",
    titleKey: "shell.route.generations",
    refKey: "desktop.ref.app.generations",
    descKey: "desktop.apps.generationsDesc",
    Icon: Images,
    size: { w: 600, h: 440 },
    Component: lazyRoute(() => import("../views/Generations")),
  },
  connectors: {
    kind: "connectors",
    route: "/connectors",
    titleKey: "nav.connectors",
    refKey: "desktop.ref.app.connectors",
    descKey: "desktop.pods.connectorsDesc",
    Icon: Plug,
    size: { w: 560, h: 420 },
    Component: lazyRoute(() => import("../views/Connectors")),
  },
  settings: {
    kind: "settings",
    route: "/settings",
    titleKey: "nav.settings",
    refKey: "desktop.ref.app.settings",
    descKey: "desktop.pods.settingsDesc",
    Icon: Settings,
    size: { w: 760, h: 540 },
    Component: lazyRoute(() => import("../views/Settings")),
  },
  routines: {
    kind: "routines",
    route: "/routines",
    titleKey: "nav.routines",
    refKey: "desktop.ref.app.routines",
    descKey: "desktop.pods.routinesDesc",
    Icon: CalendarClock,
    size: { w: 680, h: 480 },
    Component: lazyRoute(() => import("../views/Routines")),
  },
  runs: {
    kind: "runs",
    route: "/runs",
    titleKey: "nav.runs",
    refKey: "desktop.ref.app.runs",
    descKey: "desktop.pods.runsDesc",
    Icon: ListTree,
    size: { w: 680, h: 480 },
    Component: lazyRoute(() => import("../runs")),
  },
  pixel: {
    kind: "pixel",
    route: "/pixel",
    titleKey: "nav.pixel",
    refKey: "desktop.ref.app.pixel",
    descKey: "microapp.pixel.desc",
    Icon: Grid3x3,
    size: { w: 980, h: 640 },
    Component: lazyRoute(() => import("../views/PixelStudio")),
  },
};

const PREFIX = "app:";
export const appId = (kind: AppKind): string => PREFIX + kind;
export const isAppId = (id: string): boolean => id.startsWith(PREFIX);
export function appKindOf(id: string): AppKind | null {
  const kind = id.slice(PREFIX.length);
  return isAppId(id) && (APP_KINDS as readonly string[]).includes(kind) ? (kind as AppKind) : null;
}

/** The app a URL belongs to: `/runs/abc` is the Runs app, `/` is none. */
export function appForPath(pathname: string): AppDef | null {
  const segment = pathname.split("/")[1] ?? "";
  for (const def of Object.values(APPS)) if (def.route === `/${segment}`) return def;
  return null;
}

/** What an app panel remembers between renders, reloads and spaces. */
export interface AppLocation {
  pathname: string;
  search: string;
}
export function appLocationOf(def: AppDef, config: Record<string, unknown> | undefined): AppLocation {
  const path =
    typeof config?.path === "string" && config.path.startsWith(def.route) ? config.path : def.route;
  const search = typeof config?.search === "string" ? config.search : "";
  return { pathname: path, search };
}
