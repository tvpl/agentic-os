/**
 * What the dashboards' specs share (.specs/features/cerebro-paineis, S5): fixtures in the shapes the routes answer
 * (a definition of door 1, a snapshot of door 4, a list item), the page or the scene mounted with the providers the
 * shells give it under a router that starts at a path (and a probe of where it went), in pt-BR. The network is
 * `./testnet`; the `vi.mock` calls stay in the spec files.
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { I18nContext, type Lang } from "../i18n";
import { ToastProvider } from "../components/ui";
import { ConfirmProvider } from "../hooks/useConfirm";
import { CommandRegistry, CommandsProvider } from "../commands/registry";
import DashboardsPage from "./DashboardsPage";
import DashboardsScene from "./DashboardsScene";
import type {
  DefWidget,
  Definition,
  DashboardListItem,
  DashboardRead,
  SnapWidget,
  Snapshot,
} from "./dashboardsData";
import { answerRead, dash } from "./testnet";

export const HOUR = 3_600_000;

/** A widget of a definition. */
export function w(
  id: string,
  kind: DefWidget["kind"],
  source: DefWidget["source"],
  options?: DefWidget["options"],
  title = `Título ${id}`,
): DefWidget {
  return { id, kind, title, source, ...(options ? { options } : {}) };
}

export function definition(
  kind: Definition["kind"],
  widgets: DefWidget[],
  over: Partial<Definition> = {},
): Definition {
  return {
    v: 1,
    title: kind === "overview" ? "Visão geral" : kind === "area" ? "Projeto X" : "Por que demora?",
    kind,
    refresh: kind === "question" ? "manual" : "15m",
    ...(kind === "area" ? { contextId: "projeto-x" } : {}),
    ...(kind === "question" ? { question: "Por que demora?" } : {}),
    widgets,
    ...over,
  };
}

export function snapshot(dashboardId: string, widgets: SnapWidget[], over: Partial<Snapshot> = {}): Snapshot {
  return { v: 1, dashboardId, generatedAt: Date.now(), sources: [], widgets, ...over };
}

export const ok = (id: string, kind: SnapWidget["kind"], data: Record<string, unknown>): SnapWidget => ({
  id,
  kind,
  status: "ok",
  data,
});

export function read(
  def: Definition,
  snap: Snapshot | null,
  over: Partial<DashboardRead> = {},
): DashboardRead {
  return {
    definition: def,
    version: `sha256:${"a".repeat(64)}`,
    snapshot: snap,
    stale: false,
    highlights: [],
    ...over,
  };
}

export function item(id: string, def: Definition, over: Partial<DashboardListItem> = {}): DashboardListItem {
  return {
    id,
    title: def.title,
    kind: def.kind,
    contextId: def.contextId ?? null,
    refresh: def.refresh,
    generatedAt: Date.now(),
    stale: false,
    ...over,
  };
}

/** Put one dashboard in the list and its read in the table (asked with `since`, or with none). */
export function serve(id: string, r: DashboardRead, since: number | null = null): void {
  const list = Array.isArray(dash.list) ? dash.list : [];
  dash.list = [...list.filter((d) => (d as DashboardListItem).id !== id), item(id, r.definition)];
  answerRead(id, r, since);
}

/** Where the router is. */
export const where = { pathname: "", search: "", hash: "" };
function Probe() {
  const l = useLocation();
  where.pathname = l.pathname;
  where.search = l.search;
  where.hash = l.hash;
  return null;
}

export function mountBoard({
  path = "/dashboards",
  lang = "pt-BR",
  shell = "page",
  registry = new CommandRegistry(),
  extra = null,
}: {
  path?: string;
  lang?: Lang;
  shell?: "page" | "scene";
  registry?: CommandRegistry;
  extra?: ReactNode;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const container = document.createElement("div");
  container.className = "app";
  document.getElementById("root")!.appendChild(container);
  const View = shell === "page" ? DashboardsPage : DashboardsScene;
  const result = render(
    <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={qc}>
          <CommandsProvider registry={registry}>
            <ToastProvider>
              <ConfirmProvider>
                <Probe />
                <View onMetaChanged={() => undefined} />
                {extra}
              </ConfirmProvider>
            </ToastProvider>
          </CommandsProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nContext.Provider>,
    { container },
  );
  return { ...result, qc, registry };
}

/** The cards of the body, in order, by widget id. */
export const cardIds = () =>
  [...document.querySelectorAll<HTMLElement>(".dsh-card")].map((c) => c.dataset.widget);
export const card = (id: string) => document.querySelector<HTMLElement>(`.dsh-card[data-widget="${id}"]`)!;
export const tile = (id: string) => document.querySelector<HTMLElement>(`.dsh-kpi[data-widget="${id}"]`)!;
/** The lucide icon of an element, by its class (`lucide-check`, …). */
export const icons = (el: Element) =>
  [...el.querySelectorAll("svg")].map((s) =>
    [...s.classList].find((c) => c.startsWith("lucide-") && c !== "lucide"),
  );
