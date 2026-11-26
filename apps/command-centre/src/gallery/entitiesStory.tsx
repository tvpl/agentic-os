/**
 * "Entidades" in the gallery (.specs/features/cerebro-entidades-resumos, C145; design.md "Vista - Entidades"): the view
 * from fixture data (the gallery never talks to the API: each frame has its own cache with the answers seeded and no
 * query runs, which a polling view would otherwise ask of an API the gallery lacks): the empty list with the card
 * off, an entity open with its mentions, duplicates and corrections beside a batch of suggestions, the card with a
 * batch that left nothing new, and the view off. Fetched when the gallery opens, through the view's own chunk.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../api";
import EntitiesView from "../brain/entities/EntitiesView";
import { CommandsProvider } from "../commands/registry";
import { AppRouteContext } from "../desktop/appRoute";
import { qk } from "../queries";

const ROOT = "/fixture/memory/notes";
const AT = Date.UTC(2026, 10, 22, 13, 0);
const none = () => undefined;
const at = (...rest: unknown[]) => ["memory", "entities", ...rest];
const ent = (kind: string, name: string, files: number, aliases: string[] = []) => ({
  key: `${kind}:${name.toLowerCase()}`,
  kind,
  name,
  aliases,
  files,
  mentions: files,
});
const ANA = ent("perfil", "Ana Souza", 3, ["Ana", "A. Souza"]);
const LIST = [ANA, ent("perfil", "Bruno Lima", 1)];
const mention = (fileId: number, file: string, line: number, excerpt: string) => ({
  fileId,
  path: `${ROOT}/${file}`,
  name: "Ana Souza",
  line,
  proof: "termo",
  excerpt,
});
const DETAIL = {
  ...ANA,
  mentions: [
    mention(2, "meeting.md", 12, "Talked to Ana Souza about the plan."),
    mention(3, "visit.md", 3, "Visit from Ana Souza."),
  ],
  related: [{ key: "projeto:atlas", name: "Atlas", kind: "projeto", shared: 2 }],
  duplicates: [{ key: "termo:ana sousa", name: "Ana Sousa", similarity: 0.82 }],
  corrections: [{ id: 1, action: "merge", names: ["ana souza", "a souza"], createdAt: AT, undoneAt: null }],
};
const BATCH = { id: "fixture-run", status: "done", startedAt: AT, finishedAt: AT + 9_000 };
const sugg = (id: string, name: string, extra: object = {}) => ({
  id,
  kind: "perfil",
  name,
  aliases: [],
  evidence: [
    { fileId: 2, path: `${ROOT}/meeting.md`, line: 12, excerpt: `Talked to ${name} about the plan.` },
  ],
  state: "pending",
  ...extra,
});

type Seed = (qc: QueryClient) => void;
/** One frame: its own cache with the answers seeded, its own commands and its own route. */
function Frame({ seed, search = "", children }: { seed: Seed; search?: string; children: ReactNode }) {
  const [qc] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, staleTime: Infinity, retry: false },
      },
    });
    seed(client);
    return client;
  });
  return (
    <QueryClientProvider client={qc}>
      <CommandsProvider>
        <AppRouteContext.Provider value={{ pathname: "/brain/entities", search, setLocation: none }}>
          {children}
        </AppRouteContext.Provider>
      </CommandsProvider>
    </QueryClientProvider>
  );
}

/** The list, the four counts, the settings and the suggestions. */
const seeded =
  (items: object[], suggestions: object, llm = false, detail?: object): Seed =>
  (qc) => {
    qc.setQueryData(qk.settings, {
      defaultProvider: "claude",
      memory: { entities: { enabled: true, llm: { enabled: llm } } },
    });
    qc.setQueryData(at("list", "perfil", ""), { pages: [{ items, total: items.length }], pageParams: [0] });
    for (const kind of ["perfil", "projeto", "tag", "termo"])
      qc.setQueryData(at("count", kind), { items: [], total: kind === "perfil" ? items.length : 0 });
    qc.setQueryData(at("suggestions"), suggestions);
    if (detail) qc.setQueryData(at("one", ANA.key), detail);
  };

const off: Seed = (qc) => {
  seeded([], { items: [] })(qc);
  qc.getQueryCache()
    .build(qc, { queryKey: at("list", "perfil", "") })
    .setState({
      status: "error",
      fetchStatus: "idle",
      error: new ApiError(409, "The entities are off.", "entities_disabled"),
    });
};

export default function EntitiesStory() {
  const open = [
    sugg("fixture-run:0", "Carla Dias"),
    sugg("fixture-run:1", "Ana Sousa", { mergeWith: ANA.key }),
  ];
  return (
    <>
      <Frame seed={seeded([], { items: [] })}>
        <EntitiesView />
      </Frame>
      <Frame
        seed={seeded(LIST, { items: open, lastBatch: BATCH }, true, DETAIL)}
        search={`?key=${encodeURIComponent(ANA.key)}`}
      >
        <EntitiesView />
      </Frame>
      <Frame seed={seeded([], { items: [], lastBatch: BATCH }, true)}>
        <EntitiesView />
      </Frame>
      <Frame seed={off}>
        <EntitiesView />
      </Frame>
    </>
  );
}
