// @vitest-environment jsdom
/**
 * The panel (redesign G1) is the one primitive on the stage: whatever the
 * body, the plate carries the same chrome — glyph, title, `@ref`, park,
 * expand, close — and reports each gesture upward instead of acting.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Panel, { type PanelProps } from "./Panel";

function setup(over: Partial<PanelProps> = {}) {
  const qc = new QueryClient();
  const onReference = vi.fn();
  const onMinimize = vi.fn();
  const onExpand = vi.fn();
  const onClose = vi.fn();
  const props: PanelProps = {
    id: "run:abc",
    kind: "run",
    title: "run-abc · /digest",
    refName: "run-abc",
    on: true,
    fresh: false,
    leaving: false,
    parking: false,
    dragging: false,
    stacked: false,
    expandable: true,
    closable: true,
    expanded: false,
    style: {},
    children: null,
    onPointerDown: () => undefined,
    onReference,
    onMinimize,
    onExpand,
    onClose,
    onResizeStart: () => undefined,
    onResizeKey: () => undefined,
    onScrollMore: () => undefined,
    ...over,
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Panel {...props}>
          <p>body</p>
        </Panel>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onReference, onMinimize, onExpand, onClose };
}

afterEach(cleanup);

describe("Panel", () => {
  it("carries the kind, the title and the reference, and reports the reference gesture", () => {
    const { onReference } = setup();
    const plate = document.querySelector('section.panel[data-panel="run:abc"]')!;
    expect(plate.getAttribute("data-kind")).toBe("run");
    expect(plate.classList.contains("on")).toBe(true);
    expect(screen.getByText("run-abc · /digest")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /@run-abc/ }));
    expect(onReference).toHaveBeenCalledTimes(1);
  });

  it("parks, expands and closes through its callbacks", () => {
    const { onMinimize, onExpand, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^(Collapse to the dock|Recolher)/ }));
    fireEvent.click(screen.getByRole("button", { name: /^(Maximize|Maximizar)/ }));
    fireEvent.click(screen.getByRole("button", { name: /^(Close|Fechar)/ }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no close when it is not closable, and steps back when it is not on top", () => {
    setup({ closable: false, on: false });
    expect(screen.queryByRole("button", { name: /^(Close|Fechar)/ })).toBeNull();
    expect(document.querySelector("section.panel")!.classList.contains("on")).toBe(false);
  });
});
