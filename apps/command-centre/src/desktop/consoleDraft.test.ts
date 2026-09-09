import { expect, it } from "vitest";
import { parseConsoleDraft } from "./consoleDraft";

it("restores the draft together with its project and session ownership", () => {
  const draft = { version: 1, text: "Update this", cwd: "/projects/mobile", sessionId: "session-a" };
  expect(parseConsoleDraft(JSON.stringify(draft), "obsolete")).toEqual({
    text: draft.text,
    cwd: draft.cwd,
    sessionId: draft.sessionId,
  });
});
it("keeps an explicit new conversation separate from the global last session", () => {
  expect(
    parseConsoleDraft('{"version":1,"text":"new","cwd":"","sessionId":null}', null).sessionId,
  ).toBeNull();
});
it("migrates legacy text and tolerates malformed storage", () => {
  for (const raw of [null, "broken", "[]", '{"version":2}', '{"version":1,"text":3}']) {
    expect(parseConsoleDraft(raw, "keep me")).toEqual({ text: "keep me", cwd: "" });
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
