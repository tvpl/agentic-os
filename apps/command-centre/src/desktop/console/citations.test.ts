import { describe, expect, it } from "vitest";
import type { OpenPanel } from "../panelKinds";
import { citations } from "./citations";

const panels: OpenPanel[] = [
  {
    id: "run:3df2187d-1",
    kind: "run",
    ref: "run-3df2187d",
    title: "run-3df2187d · /digest",
    minimized: false,
  },
  {
    id: "doc:/home/u/notes/plan.md",
    kind: "artifact",
    ref: "plan",
    title: "plan.md",
    path: "/home/u/notes/plan.md",
    minimized: false,
  },
];

describe("citations", () => {
  it("matches @refs and files that are open, in order, without repeats", () => {
    const text = "Li @plan e @run-3df2187d; atualizei notes/plan.md e @plan de novo.";
    expect(citations(text, panels)).toEqual([
      { label: "@plan", target: { panelId: "doc:/home/u/notes/plan.md" } },
      { label: "@run-3df2187d", target: { panelId: "run:3df2187d-1" } },
    ]);
  });

  it("offers an absolute path the agent wrote as a document to open", () => {
    const text = "Escrevi o resumo em /home/u/out/summary.md e o log em ./tmp/x.log.";
    expect(citations(text, panels)).toEqual([
      { label: "summary.md", target: { path: "/home/u/out/summary.md" } },
    ]);
  });

  it("ignores emails, versions and unknown @handles", () => {
    expect(citations("mande para a@b.com, versão 1.2.3, cc @someone", panels)).toEqual([]);
  });
});
