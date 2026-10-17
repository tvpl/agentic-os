// @vitest-environment jsdom
/**
 * The note editor (.specs/features/cerebro-v2, C18-C23): what a person sees and can do. The server is a table behind a
 * mocked `apiCall`; the dialogs are the real primitives; every claim is asserted on the DOM.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ApiError, api } from "../api";
import { ConfirmProvider } from "../hooks/useConfirm";
import { CommandRegistry, CommandsProvider } from "../commands/registry";
import { installPage, mount, motion, tick } from "../ui/testkit";
import { ENTRIES, edgesOf, loadTree, reachable } from "../testing/sourceGraph";
import NoteEditor, { StateBadge } from "./NoteEditor";
import { NoteEditorHost } from "./NoteEditorHost";
import { openNoteEditor, type NoteEditorRequest } from "./noteEditor";

const h = vi.hoisted(() => ({
  handler: null as
    | null
    | ((
        key: string,
        input: { body?: Record<string, unknown>; query?: Record<string, unknown> },
      ) => Promise<unknown>),
  calls: [] as Array<{ key: string; input: unknown }>,
}));
vi.mock("../apiCall", () => ({
  apiCall: vi.fn((key: string, input: { body?: Record<string, unknown> } = {}) => {
    h.calls.push({ key, input });
    return h.handler!(key, input);
  }),
}));

installPage();
// The scan of the whole source tree (C23) takes a few seconds on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const NOTE_PATH = "/home/memory/notes/ideia.md";
const doc = (over: Record<string, unknown> = {}) => ({
  path: NOTE_PATH,
  name: "ideia.md",
  content: "# Ideia\n\ntexto\n",
  version: `sha256:${"a".repeat(64)}`,
  size: 14,
  mtime: 1,
  editable: true,
  ...over,
});
const conflict = () => new ApiError(409, "The file changed after it was read.", "edit_conflict");
const callsOf = (key: string) => h.calls.filter((c) => c.key === key);

beforeEach(() => {
  h.calls = [];
  h.handler = async (key) => {
    if (key === "GET /api/memory/note") return doc();
    throw new Error(`unexpected ${key}`);
  };
  vi.spyOn(api, "get").mockImplementation(
    async () =>
      ({ areas: ["Worker", "Documentos"], limits: { maxIndexedFileBytes: 2 * 1024 * 1024 } }) as never,
  );
});

function withProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CommandsProvider registry={new CommandRegistry()}>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </CommandsProvider>
    </QueryClientProvider>
  );
}

function open(
  request: NoteEditorRequest,
  handlers: { onRequest?: (r: NoteEditorRequest) => void; onClose?: () => void } = {},
) {
  const onRequest = handlers.onRequest ?? vi.fn();
  const onClose = handlers.onClose ?? vi.fn();
  mount(withProviders(<NoteEditor request={request} onRequest={onRequest} onClose={onClose} />));
  return { onRequest, onClose };
}

const field = () => screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
const save = () => screen.queryByRole("button", { name: "Save" }) as HTMLButtonElement | null;
const status = () => screen.getByRole("status");
const iconOf = (el: Element) => el.querySelector("svg")?.getAttribute("class") ?? "";
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const ready = async () => {
  await screen.findByRole("textbox", { name: "Note text" });
  await tick();
};

describe("S1b the note editor", () => {
  it("C18 the creation dialog focuses the title, creates through the route and opens the note", async () => {
    h.handler = async (key, input) => {
      if (key === "POST /api/memory/notes")
        return {
          path: "/home/memory/notes/minha-nota.md",
          name: "minha-nota.md",
          version: `sha256:${"b".repeat(64)}`,
          size: 20,
          mtime: 1,
        };
      throw new Error(`unexpected ${key} ${JSON.stringify(input)}`);
    };
    const { onRequest } = open({ mode: "new" });
    const dialog = await screen.findByRole("dialog", { name: "New note" });
    const title = within(dialog).getByRole("textbox", { name: "Title" });
    await waitFor(() => expect(document.activeElement).toBe(title));
    const create = within(dialog).getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    // the areas of the settings
    const area = within(dialog).getByRole("combobox", { name: "Area (optional)" });
    await waitFor(() =>
      expect(
        within(area)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["No area", "Worker", "Documentos"]),
    );
    fireEvent.change(title, { target: { value: "   " } });
    expect(create.disabled).toBe(true);
    fireEvent.change(title, { target: { value: "Minha nota" } });
    fireEvent.change(area, { target: { value: "Worker" } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() =>
      expect(onRequest).toHaveBeenCalledWith({ mode: "edit", path: "/home/memory/notes/minha-nota.md" }),
    );
    expect(callsOf("POST /api/memory/notes")).toHaveLength(1);
    expect((callsOf("POST /api/memory/notes")[0]!.input as { body: unknown }).body).toEqual({
      title: "Minha nota",
      area: "Worker",
    });
  });

  it("C18 an error of the route stays in the dialog and keeps the title; the command opens the same dialog", async () => {
    h.handler = async () => {
      throw new ApiError(400, "Unknown area", "unknown_area");
    };
    const { onRequest } = open({ mode: "new" });
    const dialog = await screen.findByRole("dialog", { name: "New note" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), { target: { value: "Ideia" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Unknown area");
    expect((within(dialog).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Ideia");
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("C18 the host opens the creation dialog when the command asks for it, and loads the editor then", async () => {
    mount(withProviders(<NoteEditorHost />));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openNoteEditor({ mode: "new" }));
    expect(await screen.findByRole("dialog", { name: "New note" })).toBeTruthy();
  });

  it("C19 each state shows its text beside its own icon, and the status region names it", async () => {
    const kinds = ["saved", "dirty", "saving", "conflict", "error"] as const;
    const texts = ["Saved", "Unsaved changes", "Saving…", "Conflict", "Could not save"];
    mount(
      <>
        {kinds.map((kind) => (
          <div key={kind} data-kind={kind}>
            <StateBadge kind={kind} />
          </div>
        ))}
      </>,
    );
    const seen = new Set<string>();
    kinds.forEach((kind, i) => {
      const region = document.querySelector(`[data-kind="${kind}"]`)!;
      const badge = within(region as HTMLElement).getByRole("status");
      expect(badge.textContent).toContain(texts[i]!);
      expect(badge.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      seen.add(iconOf(badge));
    });
    // five states, five different icons: the state is never only a colour
    expect(seen.size).toBe(5);
  });

  it("C19 the editor starts Saved, becomes Unsaved changes on typing, Saving…, then Saved", async () => {
    let finish: (v: unknown) => void = () => undefined;
    h.handler = async (key) => {
      if (key === "GET /api/memory/note") return doc();
      return new Promise((resolve) => (finish = resolve));
    };
    open({ mode: "edit", path: NOTE_PATH });
    await ready();
    expect(field().value).toBe("# Ideia\n\ntexto\n");
    expect(document.activeElement).toBe(field());
    expect(status().textContent).toContain("Saved");
    expect(screen.getByText("ideia.md", { exact: false })).toBeTruthy();
    type("# Ideia\n\ntexto novo\n");
    expect(status().textContent).toContain("Unsaved changes");
    fireEvent.click(save()!);
    await waitFor(() => expect(status().textContent).toContain("Saving…"));
    const sent = callsOf("PUT /api/memory/notes")[0]!.input as { body: Record<string, unknown> };
    expect(sent.body).toEqual({
      path: NOTE_PATH,
      content: "# Ideia\n\ntexto novo\n",
      baseVersion: `sha256:${"a".repeat(64)}`,
    });
    await act(async () =>
      finish({ path: NOTE_PATH, name: "ideia.md", version: `sha256:${"c".repeat(64)}`, size: 20, mtime: 2 }),
    );
    await waitFor(() => expect(status().textContent).toContain("Saved"));
    // the next save names the new version
    type("# Ideia\n\nterceira\n");
    h.handler = async () => ({
      path: NOTE_PATH,
      name: "ideia.md",
      version: `sha256:${"d".repeat(64)}`,
      size: 1,
      mtime: 3,
    });
    fireEvent.click(save()!);
    await waitFor(() => expect(callsOf("PUT /api/memory/notes")).toHaveLength(2));
    expect(
      (callsOf("PUT /api/memory/notes")[1]!.input as { body: { baseVersion: string } }).body.baseVersion,
    ).toBe(`sha256:${"c".repeat(64)}`);
  });

  it("C20 Save is disabled while the text is the saved one, and Mod+S saves", async () => {
    h.handler = async (key) => {
      if (key === "GET /api/memory/note") return doc();
      return { path: NOTE_PATH, name: "ideia.md", version: `sha256:${"c".repeat(64)}`, size: 1, mtime: 2 };
    };
    open({ mode: "edit", path: NOTE_PATH });
    await ready();
    expect(save()!.disabled).toBe(true);
    type("mudou");
    expect(save()!.disabled).toBe(false);
    type("# Ideia\n\ntexto\n");
    expect(save()!.disabled).toBe(true);
    type("de novo");
    fireEvent.keyDown(field(), { key: "s", ctrlKey: true });
    fireEvent.keyDown(field(), { key: "s", metaKey: true });
    await waitFor(() => expect(callsOf("PUT /api/memory/notes").length).toBeGreaterThanOrEqual(1));
  });

  it("C20 closing with changes asks first (initial focus on Keep editing); Discard closes, Keep stays; without changes it closes at once", async () => {
    motion.reduced = true;
    const { onClose } = open({ mode: "edit", path: NOTE_PATH });
    await ready();
    // no changes: closes at once
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("C20 with changes: Escape, the close button and the footer button each ask; Keep editing stays, Discard closes", async () => {
    motion.reduced = true;
    const { onClose } = open({ mode: "edit", path: NOTE_PATH });
    await ready();
    type("alterado");
    const dialogs = () => screen.getAllByRole("dialog");
    for (const how of ["escape", "x", "footer"] as const) {
      if (how === "escape") fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      else if (how === "x") fireEvent.click(document.querySelector("[data-dialog-close]")!);
      else fireEvent.click(within(dialogs()[0]!).getAllByRole("button", { name: "Close" }).at(-1)!);
      const ask = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
      await waitFor(() =>
        expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep editing" })),
      );
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull(),
      );
      expect(field().value).toBe("alterado");
    }
    fireEvent.click(document.querySelector("[data-dialog-close]")!);
    const ask = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("C21 a conflict shows the banner, keeps the text and blocks Save; each button does what it says", async () => {
    h.handler = async (key) => {
      if (key === "GET /api/memory/note") return doc();
      throw conflict();
    };
    open({ mode: "edit", path: NOTE_PATH });
    await ready();
    type("meu texto");
    fireEvent.click(save()!);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("This note changed on disk after you opened it.");
    expect(status().textContent).toContain("Conflict");
    expect(field().value).toBe("meu texto");
    expect(save()!.disabled).toBe(true);

    // "Load the version on disk": the field becomes the disk's text
    h.handler = async (key) => {
      if (key === "GET /api/memory/note")
        return doc({ content: "# Ideia\n\nda outra pessoa\n", version: `sha256:${"e".repeat(64)}` });
      throw new Error(key);
    };
    fireEvent.click(within(banner).getByRole("button", { name: "Load the version on disk" }));
    await waitFor(() => expect(field().value).toBe("# Ideia\n\nda outra pessoa\n"));
    expect(screen.queryByText("This note changed on disk after you opened it.")).toBeNull();
    expect(status().textContent).toContain("Saved");
  });

  it("C21 Save as a copy creates a note and saves the person's exact text into it, then opens the copy", async () => {
    const copy = {
      path: "/home/memory/notes/ideia-copia.md",
      name: "ideia-copia.md",
      version: `sha256:${"f".repeat(64)}`,
      size: 14,
      mtime: 3,
    };
    h.handler = async (key) => {
      if (key === "GET /api/memory/note") return doc();
      if (key === "PUT /api/memory/notes" && callsOf("PUT /api/memory/notes").length === 1) throw conflict();
      if (key === "POST /api/memory/notes") return copy;
      if (key === "PUT /api/memory/notes") return { ...copy, version: `sha256:${"9".repeat(64)}` };
      throw new Error(key);
    };
    const { onRequest } = open({ mode: "edit", path: NOTE_PATH });
    await ready();
    type("# Ideia\n\nmeu texto exato\n");
    fireEvent.click(save()!);
    const banner = await screen.findByRole("alert");
    fireEvent.click(within(banner).getByRole("button", { name: "Save as a copy" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ mode: "edit", path: copy.path }));
    const created = callsOf("POST /api/memory/notes")[0]!.input as { body: { title: string } };
    expect(created.body.title).toBe("Ideia (copy)");
    const puts = callsOf("PUT /api/memory/notes");
    expect(puts).toHaveLength(2);
    expect((puts[1]!.input as { body: unknown }).body).toEqual({
      path: copy.path,
      content: "# Ideia\n\nmeu texto exato\n",
      baseVersion: copy.version,
    });
  });

  it("C22 a refused save (413, 403, no network) says so in the dialog, keeps the text and stays open", async () => {
    const cases: Array<[ApiError, RegExp]> = [
      [
        new ApiError(413, "The note is larger than the limit of 1048576 bytes.", "note_too_large"),
        /larger than the limit/,
      ],
      [
        new ApiError(403, "Only notes under memory/ can be edited.", "note_not_editable"),
        /Only notes under memory/,
      ],
      [new ApiError(0, "Cannot reach the local service.", "network"), /Cannot reach/],
    ];
    for (const [error, message] of cases) {
      document.body.innerHTML = '<div id="root"></div><div id="modal-root"></div>';
      h.handler = async (key) => {
        if (key === "GET /api/memory/note") return doc();
        throw error;
      };
      const { onClose } = open({ mode: "edit", path: NOTE_PATH });
      await ready();
      type("texto que não pode perder");
      fireEvent.click(save()!);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(status().textContent).toContain("Could not save");
      expect(field().value).toBe("texto que não pode perder");
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      // not a conflict: no banner offering to reload, and Save works again
      expect(screen.queryByRole("button", { name: "Load the version on disk" })).toBeNull();
      expect(save()!.disabled).toBe(false);
    }
  });

  it("C22 loading shows a spinner with its text; a failed read shows the message with Retry; a read-only file shows why and has no Save", async () => {
    let release: (v: unknown) => void = () => undefined;
    h.handler = () => new Promise((resolve) => (release = resolve));
    open({ mode: "edit", path: NOTE_PATH });
    const loading = await screen.findByText("Loading…");
    expect(loading.parentElement!.querySelector(".spinner")).not.toBeNull();
    await act(async () =>
      release(
        doc({ editable: false, reason: "ROUTER.md is generated; regenerate it instead of editing it." }),
      ),
    );
    await ready();
    expect(screen.getByText(/ROUTER\.md is generated/)).toBeTruthy();
    expect(save()).toBeNull();
    expect(field().readOnly).toBe(true);
    expect(screen.getByText("Read-only")).toBeTruthy();

    document.body.innerHTML = '<div id="root"></div><div id="modal-root"></div>';
    let attempts = 0;
    h.handler = async () => {
      attempts++;
      if (attempts === 1) throw new ApiError(404, "The note does not exist.", "note_missing");
      return doc();
    };
    open({ mode: "edit", path: NOTE_PATH });
    const failed = await screen.findByRole("alert");
    expect(failed.textContent).toContain("The note does not exist.");
    fireEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    await ready();
    expect(field().value).toBe("# Ideia\n\ntexto\n");
  });

  it("C23 the editor is a chunk of its own: the entry reaches it only through import()", () => {
    const tree = loadTree();
    const staticOnly = new Set<string>(ENTRIES);
    const queue = [...ENTRIES];
    while (queue.length > 0) {
      for (const edge of edgesOf(tree, queue.pop()!)) {
        if (edge.how === "dynamic" || edge.how === "url" || staticOnly.has(edge.to)) continue;
        staticOnly.add(edge.to);
        queue.push(edge.to);
      }
    }
    expect([...staticOnly].filter((f) => /brain\/NoteEditor\.tsx$|brain\/noteEditor\.css$/.test(f))).toEqual(
      [],
    );
    expect(staticOnly.has("brain/noteEditor.ts")).toBe(true);
    expect(staticOnly.has("brain/NoteEditorHost.tsx")).toBe(true);
    const all = reachable(tree);
    expect(all.has("brain/NoteEditor.tsx")).toBe(true);
    const importers = [...tree.keys()].filter(
      (f) => !/\.test\./.test(f) && edgesOf(tree, f).some((e) => e.to === "brain/NoteEditor.tsx"),
    );
    expect(importers).toEqual(["brain/NoteEditorHost.tsx"]);
    expect(edgesOf(tree, "brain/NoteEditorHost.tsx").find((e) => e.to === "brain/NoteEditor.tsx")?.how).toBe(
      "dynamic",
    );
  });
});
