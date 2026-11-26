/**
 * "Resumos" in the gallery (.specs/features/cerebro-entidades-resumos, C145; design.md "Vista - Resumos"): the view from
 * fixture data (the gallery never talks to the API: each frame has its own cache with the answers seeded and no
 * query runs, which a polling view would otherwise ask of an API the gallery lacks): the list with a fresh, a stale, a
 * missing and a generating scope and the stale summary open, the summary being generated and the view off. Fetched
 * when the gallery opens, through the view's own chunk.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SummariesView, { SummaryFrame, SummaryPanel } from "../brain/summaries/SummariesView";
import { CommandsProvider } from "../commands/registry";
import { AppRouteContext } from "../desktop/appRoute";
import { qk } from "../queries";

const ROOT = "/fixture/memory/notes";
const AT = Date.UTC(2026, 10, 22, 13, 0);
const none = () => undefined;
const scope = (kind: string, name: string) => ({ kind, id: name, name });
const PROJECTS = {
  scope: scope("area", "Projects"),
  state: "stale",
  generatedAt: AT,
  changes: { changed: 3, removed: 1, added: 2 },
  running: false,
};
const LIST = [
  PROJECTS,
  { scope: scope("area", "People"), state: "missing", running: false },
  { scope: scope("area", "Finance"), state: "fresh", generatedAt: AT, running: false },
  { scope: scope("context", "Marketing"), state: "missing", running: true },
];
const cite = (name: string, section: string, fileId: number) => ({
  path: `${ROOT}/${name}`,
  section,
  name,
  fileId,
});
const DETAIL = {
  ...PROJECTS,
  paragraphs: [
    {
      text: "The **projects** run on two fronts: onboarding and the contract.",
      citations: [cite("onboarding.md", "Decision", 1), cite("contract.md", "Clause 3", 2)],
    },
    { text: "The budget closed on time.", citations: [cite("plan.md", "Next steps", 3)] },
  ],
  sources: [
    { fileId: 1, path: `${ROOT}/onboarding.md`, name: "onboarding.md", state: "same" },
    { fileId: 2, path: `${ROOT}/contract.md`, name: "contract.md", state: "changed" },
    { path: `${ROOT}/old.md`, name: "old.md", state: "removed" },
  ],
  run: { id: "fixture-run", provider: "claude", startedAt: AT, finishedAt: AT + 42_000 },
};

/** One frame: its own cache with the answers seeded, its own commands and its own route. */
function Frame({ search = "", children }: { search?: string; children: ReactNode }) {
  const [qc] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, staleTime: Infinity, retry: false },
      },
    });
    client.setQueryData(qk.settings, { defaultProvider: "claude", memorySkills: ["brain-summarize"] });
    client.setQueryData(["memory", "summaries"], { items: LIST });
    client.setQueryData(["memory", "summaries", "one", "area", "Projects"], DETAIL);
    client.setQueryData(["memory", "summaries", "one", "context", "Marketing"], {
      ...LIST[3],
      sources: [],
      running: true,
    });
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <CommandsProvider>
        <AppRouteContext.Provider value={{ pathname: "/brain/summaries", search, setLocation: none }}>
          {children}
        </AppRouteContext.Provider>
      </CommandsProvider>
    </QueryClientProvider>
  );
}

const panel = (kind: "area" | "context", id: string, off = false) => (
  <Frame>
    <SummaryFrame>
      <SummaryPanel
        scope={{ kind, id }}
        name={id}
        off={off}
        refused={null}
        onStart={none}
        onCancel={none}
        onTurnOn={none}
        onBack={none}
      />
    </SummaryFrame>
  </Frame>
);

export default function SummariesStory() {
  return (
    <>
      <Frame search="?kind=area&id=Projects">
        <SummariesView />
      </Frame>
      {panel("context", "Marketing")}
      {panel("area", "Projects", true)}
    </>
  );
}
