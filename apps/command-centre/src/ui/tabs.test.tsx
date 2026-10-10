// @vitest-environment jsdom
/**
 * Tabs (.specs/features/primitivas, C11): the ids and `aria-*` that tie a tab to
 * its one panel, one tab stop, and the keys that move the selection.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { Tabs } from ".";
import { installPage, mount, tick } from "./testkit";

installPage();

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

function Host({ orientation = "horizontal" as "horizontal" | "vertical" }) {
  const [active, setActive] = useState("a");
  return (
    <Tabs
      id="x"
      ariaLabel="Letters"
      tabs={TABS}
      active={active}
      onChange={setActive}
      orientation={orientation}
    >
      <p>panel of {active}</p>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
/** Radix moves focus on the next turn of the event loop, not inside the key event. */
const key = async (name: string, k: string) => {
  fireEvent.keyDown(tab(name), { key: k });
  await act(async () => void (await tick()));
};

describe("C11 tabs", () => {
  it("C11 the tablist, the tabs and the one panel are tied by ids and aria", () => {
    mount(<Host />);
    expect(screen.getByRole("tablist", { name: "Letters" })).toBeTruthy();
    for (const t of TABS) {
      const el = tab(t.label);
      expect(el.id).toBe(`x-tab-${t.id}`);
      expect(el.getAttribute("aria-controls")).toBe(`x-panel-${t.id}`);
      expect(el.getAttribute("aria-selected")).toBe(String(t.id === "a"));
    }
    // One tab stop: the list takes Tab and hands focus to the selected tab; no tab competes with it.
    expect(screen.getByRole("tablist").tabIndex).toBe(0);
    expect(screen.getAllByRole("tab").filter((el) => el.tabIndex === 0)).toHaveLength(0);
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.id).toBe("x-panel-a");
    expect(panels[0]!.getAttribute("aria-labelledby")).toBe("x-tab-a");
  });

  it("C11 ArrowRight and ArrowLeft move the selection and the focus, wrapping at the ends", async () => {
    mount(<Host />);
    await act(async () => void tab("Alpha").focus());
    // Once focus is in the list the selected tab is its one tab stop.
    expect(screen.getAllByRole("tab").filter((el) => el.tabIndex === 0)).toEqual([tab("Alpha")]);
    await key("Alpha", "ArrowRight");
    expect(document.activeElement).toBe(tab("Beta"));
    expect(tab("Beta").getAttribute("aria-selected")).toBe("true");
    await key("Beta", "ArrowLeft");
    await key("Alpha", "ArrowLeft");
    expect(document.activeElement).toBe(tab("Gamma"));
    expect(screen.getByRole("tabpanel").id).toBe("x-panel-c");
    await key("Gamma", "ArrowRight");
    expect(document.activeElement).toBe(tab("Alpha"));
  });

  it("C11 Home and End go to the first and the last", async () => {
    mount(<Host />);
    tab("Alpha").focus();
    await key("Alpha", "End");
    expect(document.activeElement).toBe(tab("Gamma"));
    await key("Gamma", "Home");
    expect(document.activeElement).toBe(tab("Alpha"));
  });

  it("C11 vertical tabs answer ArrowDown and ArrowUp, and no longer the horizontal arrows", async () => {
    mount(<Host orientation="vertical" />);
    tab("Alpha").focus();
    await key("Alpha", "ArrowRight");
    expect(document.activeElement).toBe(tab("Alpha"));
    await key("Alpha", "ArrowDown");
    expect(document.activeElement).toBe(tab("Beta"));
    await key("Beta", "ArrowUp");
    expect(document.activeElement).toBe(tab("Alpha"));
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("C11 a click that arrives alone (a script, a tap) selects the tab too", () => {
    mount(<Host />);
    fireEvent.click(tab("Beta"));
    expect(tab("Beta").getAttribute("aria-selected")).toBe("true");
  });

  it("C11 without an id the ids are still tied together, and the parts can sit apart in the layout", () => {
    function Apart() {
      const [active, setActive] = useState("b");
      return (
        <Tabs.Root value={active} onChange={setActive} id="apart">
          <nav>
            <Tabs.List variant="list" label="Places">
              <Tabs.Group>Group</Tabs.Group>
              <Tabs.Tab value="a">Alpha</Tabs.Tab>
              <Tabs.Tab value="b">Beta</Tabs.Tab>
            </Tabs.List>
          </nav>
          <section>
            <Tabs.Panel>on {active}</Tabs.Panel>
          </section>
        </Tabs.Root>
      );
    }
    mount(<Apart />);
    expect(tab("Beta").getAttribute("aria-controls")).toBe("apart-panel-b");
    expect(screen.getByRole("tabpanel").id).toBe("apart-panel-b");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("apart-tab-b");
    expect(screen.getByText("Group").getAttribute("role")).toBe("presentation");
  });

  it("C11 custom ids replace the defaults (a panel shared by every tab)", () => {
    function Shared() {
      const [active, setActive] = useState("a");
      return (
        <Tabs
          tabs={TABS}
          active={active}
          onChange={setActive}
          ids={{ tab: (id) => `t-${id}`, panel: () => "one-panel" }}
        >
          <p>{active}</p>
        </Tabs>
      );
    }
    mount(<Shared />);
    expect(tab("Gamma").id).toBe("t-c");
    expect(tab("Gamma").getAttribute("aria-controls")).toBe("one-panel");
    expect(screen.getByRole("tabpanel").id).toBe("one-panel");
  });
});
