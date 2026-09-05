import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./engine/world";
import {
  decodeGroups,
  defaultUi,
  encodeGroups,
  paramsFromUi,
  parseBrainSettings,
  sameParams,
  settingsFromUi,
  uiFromParams,
  urlControlledKeys,
} from "./state";

describe("brain ui state codecs", () => {
  it("round-trips the view state through the hash query, omitting defaults", () => {
    const ui = defaultUi();
    expect(paramsFromUi(ui).toString()).toBe("");
    ui.sel = 42;
    ui.layout = "force";
    ui.local = true;
    ui.localHops = 2;
    ui.edgeKinds = ["same-area", "markdown-link"];
    ui.filters = { exts: [".md", ".ts"], tags: ["core"], modified: "7d", size: "small" };
    ui.query = "plan";
    ui.filterGroup = "Docs";
    ui.groups = [{ query: "notes", color: "#22d3ee" }];
    const p = paramsFromUi(ui);
    expect(p.get("sel")).toBe("42");
    expect(p.get("kinds")).toBe("markdown-link,same-area");
    expect(p.get("groups")).toBe("notes~22d3ee");
    const back = uiFromParams(p, defaultUi());
    expect(back).toEqual({ ...ui, edgeKinds: ["markdown-link", "same-area"] });
    expect(sameParams(p, paramsFromUi(back))).toBe(true);
  });

  it("ignores malformed url values", () => {
    const p = new URLSearchParams(
      "sel=abc&layout=nope&view=x&hops=9&mod=yesterday&size=huge&kinds=bogus,same-dir",
    );
    const ui = uiFromParams(p, defaultUi());
    expect(ui.sel).toBeNull();
    expect(ui.layout).toBe(DEFAULT_SETTINGS.layout);
    expect(ui.view).toBe("areas");
    expect(ui.localHops).toBe(1);
    expect(ui.filters.modified).toBe("all");
    expect(ui.filters.size).toBe("any");
    expect(ui.edgeKinds).toEqual(["same-dir"]);
    expect([...urlControlledKeys(p)]).toEqual(
      ["layout", "view", "edgeKinds", "hops"].map((k) => (k === "hops" ? "localHops" : k)),
    );
  });

  it("validates server / localStorage blobs field by field", () => {
    expect(parseBrainSettings(null)).toEqual({});
    expect(parseBrainSettings("x")).toEqual({});
    const parsed = parseBrainSettings({
      layout: "hex",
      view: "folders",
      spin: 2,
      showNames: true,
      linkSpring: 0.1,
      nodeScale: "big",
      edgeKinds: ["same-dir", "nope"],
      localHops: 3,
      focusMode: false,
      workspace: { pinned: [{ id: 1, x: 2, y: 3 }, { id: "x" }], collapsed: ["Docs", 5] },
    });
    expect(parsed).toEqual({
      layout: "hex",
      view: "folders",
      showNames: true,
      linkSpring: 0.1,
      edgeKinds: ["same-dir"],
      localHops: 3,
      focusMode: false,
      workspace: { pinned: [{ id: 1, x: 2, y: 3 }], collapsed: ["Docs"] },
    });
  });

  it("settingsFromUi keeps only the persisted subset and copies the workspace", () => {
    const ui = defaultUi();
    ui.sel = 3;
    ui.query = "q";
    const s = settingsFromUi(ui, { pinned: [{ id: 3, x: 1, y: 1 }], collapsed: [] });
    expect("sel" in s).toBe(false);
    expect("query" in s).toBe(false);
    expect(s.workspace).toEqual({ pinned: [{ id: 3, x: 1, y: 1 }], collapsed: [] });
    expect(settingsFromUi(defaultUi()).workspace).toBeUndefined();
  });

  it("group codec strips separators, validates colours and caps at four", () => {
    const encoded = encodeGroups([
      { query: "a|b~c", color: "#ABCDEF" },
      { query: "  ", color: "#000000" },
    ]);
    expect(encoded).toBe("abc~abcdef");
    expect(decodeGroups("x~zzz|y~112233|1~000000|2~000000|3~000000|4~000000")).toEqual([
      { query: "x", color: "#f97316" },
      { query: "y", color: "#112233" },
      { query: "1", color: "#000000" },
      { query: "2", color: "#000000" },
    ]);
  });
});
