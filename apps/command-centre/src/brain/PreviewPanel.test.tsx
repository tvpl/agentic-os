// @vitest-environment jsdom
/**
 * The preview of a note (.specs/features/cerebro-v2): the "Edit" action (C19, C22) and the links section (C31). The
 * server is a table behind a mocked `apiCall`; everything is asserted on the DOM a person meets.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ApiError } from "../api";
import { dictionaries } from "../i18n";
import { ToastProvider } from "../components/ui";
import { installPage, mount } from "../ui/testkit";
import type { FileNode, World } from "./engine/world";
import { PreviewPanel, type PreviewState } from "./PreviewPanel";
import { OPEN_NOTE_EVENT, type NoteEditorRequest } from "./noteEditor";

const h = vi.hoisted(() => ({
  handler: null as null | ((key: string, input: unknown) => Promise<unknown>),
  calls: [] as Array<{ key: string; input: unknown }>,
}));
vi.mock("../apiCall", () => ({
  apiCall: vi.fn((key: string, input?: unknown) => {
    h.calls.push({ key, input });
    return h.handler!(key, input);
  }),
}));

installPage();

const row = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  root: "/home/memory",
  path: `/home/memory/${name}`,
  rel: name,
  name,
  ext: ".md",
  dir: "/home/memory",
  area: null,
  size: 10,
  mtime: 1,
  indexedAt: 1,
  title: null,
  tags: [],
  fields: {},
  ...extra,
});
const node = {
  id: 7,
  name: "alvo.md",
  title: "Alvo",
  path: "/home/memory/alvo.md",
  ext: ".md",
  group: "memory",
  size: 10,
  mtime: 1,
  pinned: false,
} as unknown as FileNode;
const world = { files: [], edges: [] } as unknown as World;

const preview = (over: Partial<PreviewState> = {}): PreviewState => ({
  node,
  content: "# Alvo\n\ntexto\n",
  kind: "text",
  message: null,
  ...over,
});

function show(state: PreviewState, onSelectId = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PreviewPanel
            preview={state}
            world={world}
            skills={new Set()}
            lang="en"
            onClose={() => undefined}
            onSelectId={onSelectId}
            onSkill={() => undefined}
            onUnpin={() => undefined}
            onDangling={() => undefined}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  mount(ui);
  return onSelectId;
}

const LINKS = {
  file: row(7, "alvo.md"),
  backlinks: [
    { file: row(1, "um.md", { title: "Um" }), kind: "wikilink", line: 3, label: "o alvo" },
    { file: row(2, "dois.md"), kind: "markdown-link", line: 9, label: null },
  ],
  outgoing: [
    { kind: "wikilink", target: "fantasma", label: null, line: 4, resolved: null, alternatives: [] },
    {
      kind: "markdown-link",
      target: "/home/memory/sumiu.md",
      label: "sumiu",
      line: 5,
      resolved: null,
      alternatives: [],
    },
    {
      kind: "wikilink",
      target: "outra",
      label: null,
      line: 6,
      resolved: row(3, "outra.md"),
      alternatives: [],
    },
  ],
};

beforeEach(() => {
  h.calls = [];
  h.handler = async (key) => {
    if (key === "GET /api/memory/links") return LINKS;
    throw new Error(`unexpected ${key}`);
  };
});

const section = () => screen.findByRole("region", { name: "Links" });

describe("C31 the links of a note in its preview", () => {
  it("C31 shows the backlinks with their count and opens the note that links here", async () => {
    const onSelectId = show(preview());
    const links = await section();
    expect(await within(links).findByText("Backlinks (2)")).toBeTruthy();
    expect(within(links).getByRole("button", { name: "Um" })).toBeTruthy();
    expect(within(links).getByText("line 3")).toBeTruthy();
    fireEvent.click(within(links).getByRole("button", { name: "dois.md" }));
    expect(onSelectId).toHaveBeenCalledWith(2, true);
    expect((h.calls[0]!.input as { query: { id: number } }).query.id).toBe(7);
  });

  it("C31 lists the links that lead nowhere, and only those", async () => {
    show(preview());
    const links = await section();
    expect(await within(links).findByText("Links to nothing (2)")).toBeTruthy();
    expect(within(links).getByText("fantasma")).toBeTruthy();
    expect(within(links).getByText("sumiu")).toBeTruthy();
    expect(within(links).queryByText("outra")).toBeNull();
    // broken links are not buttons: there is nothing to open
    expect(
      within(links)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Um", "dois.md"]);
  });

  it("C31 says so when no note points here, in both languages, and shows no broken-links group", async () => {
    h.handler = async () => ({ file: row(7, "alvo.md"), backlinks: [], outgoing: [] });
    show(preview());
    const links = await section();
    expect(await within(links).findByText("Backlinks (0)")).toBeTruthy();
    expect(within(links).getByText("No note points here.")).toBeTruthy();
    expect(within(links).queryByText(/Links to nothing/)).toBeNull();
    expect(dictionaries["pt-BR"]["brain.links.none"]).toBe("Nenhuma nota aponta para esta.");
    expect(dictionaries["pt-BR"]["brain.links.broken"]).toBe("Links quebrados");
  });

  it("C31 shows a spinner with text while it loads, and the error with Try again that retries", async () => {
    let release: (v: unknown) => void = () => undefined;
    let attempt = 0;
    h.handler = async () => {
      attempt++;
      if (attempt === 1) return new Promise((resolve) => (release = resolve));
      return LINKS;
    };
    show(preview());
    const loading = await section();
    expect(within(loading).getByText("Loading…").parentElement!.querySelector(".spinner")).not.toBeNull();
    await act(async () => release(Promise.reject(new ApiError(500, "Internal error", "internal"))));
    await waitFor(() => expect(within(loading).getByRole("alert").textContent).toContain("Internal error"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Backlinks (2)")).toBeTruthy();
  });

  it("C31 only a Markdown file has the section", async () => {
    show(preview({ node: { ...node, ext: ".txt" } as FileNode }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
    expect(h.calls).toEqual([]);
  });
});

describe("C19 C22 the Edit action of the preview", () => {
  const listen = () => {
    const heard: NoteEditorRequest[] = [];
    window.addEventListener(OPEN_NOTE_EVENT, (e) => heard.push((e as CustomEvent<NoteEditorRequest>).detail));
    return heard;
  };

  it("C19 an editable note shows Edit, and it asks for the editor on that path", async () => {
    const heard = listen();
    show(preview({ editable: true }));
    await section();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(heard).toEqual([{ mode: "edit", path: "/home/memory/alvo.md" }]);
  });

  it("C22 a file that is not an editable note has no Edit button, whether the flag is false or absent", async () => {
    show(preview({ editable: false }));
    await section();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    document.body.innerHTML = '<div id="root"></div><div id="modal-root"></div>';
    show(preview());
    await section();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
