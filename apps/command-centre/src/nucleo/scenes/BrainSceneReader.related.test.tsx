// @vitest-environment jsdom
/**
 * The related files of the Núcleo reader (.specs/features/cerebro-correcoes, C25): when they could not be loaded the
 * "Close, but not linked" list gives way to the error and its "Try again", in the same place of the rail.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { GraphData } from "../../api";
import { buildWorld, createWorld, DEFAULT_SETTINGS, groupOfNode } from "../../brain/engine/world";
import { installPage, mount } from "../../ui/testkit";
import { BrainSceneReader, type BrainSceneReaderProps } from "./BrainSceneReader";

installPage();
// jsdom has no element scrolling; the reader scrolls its body back to the top on a new note
Element.prototype.scrollTo = () => undefined;

const graph: GraphData = {
  nodes: [1, 2].map((id) => ({
    id,
    name: `nota-${id}.md`,
    rel: `nota-${id}.md`,
    path: `/ws/nota-${id}.md`,
    ext: ".md",
    area: "Docs",
    dir: "/ws",
    size: 10,
    mtime: 1,
    title: null,
    tags: [],
  })),
  edges: [],
  truncated: false,
  totalFiles: 2,
};

function files() {
  const w = createWorld(DEFAULT_SETTINGS);
  buildWorld(w, {
    graph,
    skills: [],
    routines: [],
    connectors: [],
    groupOf: (node) => groupOfNode(node, "areas"),
    labels: { skills: "Skills", routines: "Routines", apps: "Apps" },
    now: 2,
  });
  return w.files;
}

function show(over: Partial<BrainSceneReaderProps>) {
  const nodes = files();
  const noop = () => undefined;
  const props: BrainSceneReaderProps = {
    preview: { node: nodes[0]!, content: "# Nota\n\ntexto", kind: "text", message: null },
    kind: "note",
    kindLabel: "Note",
    group: "Docs",
    degree: 0,
    files: nodes,
    skills: new Set(),
    lang: "en",
    context: [],
    nearby: [{ index: 1, id: 2, label: "nota-2", kind: "note", group: "Docs", line: "vizinha de conteúdo" }],
    terms: [],
    pinned: new Set(),
    kindOfId: () => "note",
    onTermHover: noop,
    onTermPin: noop,
    onClose: noop,
    onNote: noop,
    onPeek: noop,
    onProgress: noop,
    onSkill: noop,
    onLamina: noop,
    onReference: noop,
    onCopy: noop,
    onEditor: noop,
    onDangling: noop,
    ...over,
  };
  return mount(<BrainSceneReader {...props} />);
}

describe("C25 the related files of the reader", () => {
  it("C25 with the related files loaded, the nearby list shows in the rail", () => {
    show({});
    const rail = screen.getByRole("complementary");
    expect(within(rail).getByText("Close, but not linked")).toBeTruthy();
    expect(within(rail).getByText("vizinha de conteúdo")).toBeTruthy();
  });

  it("C25 failed: no nearby entry, the message and the retry are in the rail, the message before the button", () => {
    const onRelatedRetry = vi.fn();
    show({ relatedFailed: true, onRelatedRetry });
    const rail = screen.getByRole("complementary");
    expect(within(rail).queryByText("Close, but not linked")).toBeNull();
    expect(within(rail).queryByText("vizinha de conteúdo")).toBeNull();
    const alert = within(rail).getByRole("alert");
    expect(alert.textContent).toMatch(/^Could not load related files\.Try again$/);
    const button = within(alert).getByRole("button", { name: "Try again" });
    expect(alert.lastElementChild).toBe(button);
    fireEvent.click(button);
    expect(onRelatedRetry).toHaveBeenCalledTimes(1);
  });
});
