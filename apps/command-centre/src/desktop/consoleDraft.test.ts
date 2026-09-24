import { expect, it, vi } from "vitest";
import { parseConsoleDraft } from "./consoleDraft";

it("restores the draft together with its project and session ownership", () => {
  const draft = { version: 1, text: "Update this", cwd: "/projects/mobile", sessionId: "session-a" };
  expect(parseConsoleDraft(JSON.stringify(draft))).toEqual({
    text: draft.text,
    cwd: draft.cwd,
    sessionId: draft.sessionId,
  });
});
it("keeps an explicit new conversation separate from the global last session", () => {
  expect(parseConsoleDraft('{"version":1,"text":"new","cwd":"","sessionId":null}').sessionId).toBeNull();
});
it("tolerates malformed storage instead of throwing at the console", () => {
  for (const raw of [null, "broken", "[]", '{"version":2}', '{"version":1,"text":3}']) {
    expect(parseConsoleDraft(raw)).toEqual({ text: "", cwd: "" });
  }
});

it("adds a quoted source without changing the project or conversation", async () => {
  const { withConsoleReference } = await import("./consoleDraft");
  const draft = { text: "Keep my work", cwd: "/mobile", sessionId: "active" };
  expect(withConsoleReference(draft, '/notes/a "quoted".md', "Source")).toEqual({
    ...draft,
    text: 'Keep my work\n\nSource: "/notes/a \\"quoted\\".md"',
  });
});

it("keeps a handoff in memory when browser storage cannot accept writes", async () => {
  const { readConsoleDraft, storeConsoleDraft } = await import("./consoleDraft");
  const stored = new Map<string, string>();
  const setItem = vi.fn<(key: string, value: string) => void>(() => {
    throw new Error("quota exceeded");
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem,
    removeItem: (key: string) => stored.delete(key),
  });
  try {
    const draft = { text: "Prepared during the tour", cwd: "/work", sessionId: null };
    expect(storeConsoleDraft(draft)).toBe(false);
    expect(readConsoleDraft()).toEqual(draft);
    setItem.mockImplementation((key, value) => {
      stored.set(key, value);
    });
    expect(storeConsoleDraft(draft)).toBe(true);
    expect(readConsoleDraft()).toEqual(draft);
  } finally {
    vi.unstubAllGlobals();
  }
});
