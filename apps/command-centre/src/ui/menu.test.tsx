// @vitest-environment jsdom
/** The menu (.specs/features/primitivas, C13): roles, the keys that move, what runs, and where focus goes. */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu } from ".";
import { installPage, mount, motion, tick } from "./testkit";

installPage();

function Host({ run = { market: vi.fn(), export: vi.fn(), new: vi.fn() } }) {
  return (
    <DropdownMenu
      trigger={<button aria-label="Manage skills">+</button>}
      items={[
        { id: "market", label: "Marketplace", onSelect: run.market },
        { id: "export", label: "Export", onSelect: run.export },
        { id: "new", label: "New skill", onSelect: run.new },
      ]}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: "Manage skills" });
const items = () => screen.queryAllByRole("menuitem").map((i) => i.textContent);
const openByKeyboard = async (user: ReturnType<typeof userEvent.setup>) => {
  trigger().focus();
  await user.keyboard("{Enter}");
  await tick();
};

describe("C13 menu", () => {
  it("C13 opens as a menu of three items from the trigger, with the focus on the first", async () => {
    mount(<Host />);
    const user = userEvent.setup();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("menu")).toBeNull();
    await openByKeyboard(user);
    // The menu is named by what opened it.
    expect(screen.getByRole("menu", { name: "Manage skills" })).toBeTruthy();
    expect(items()).toEqual(["Marketplace", "Export", "New skill"]);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Marketplace" }));
  });

  it("C13 ArrowDown and ArrowUp move with wrap, Home and End go to the ends, a letter goes to its item", async () => {
    mount(<Host />);
    const user = userEvent.setup();
    await openByKeyboard(user);
    const at = () => (document.activeElement as HTMLElement).textContent;
    await user.keyboard("{ArrowDown}");
    expect(at()).toBe("Export");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(at()).toBe("Marketplace");
    await user.keyboard("{ArrowUp}");
    expect(at()).toBe("New skill");
    await user.keyboard("{Home}");
    expect(at()).toBe("Marketplace");
    await user.keyboard("{End}");
    expect(at()).toBe("New skill");
    await user.keyboard("e");
    expect(at()).toBe("Export");
  });

  it("C13 Enter and Space run the item once and close the menu", async () => {
    const run = { market: vi.fn(), export: vi.fn(), new: vi.fn() };
    motion.reduced = true;
    mount(<Host run={run} />);
    const user = userEvent.setup();
    await openByKeyboard(user);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(run.export).toHaveBeenCalledTimes(1);
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
    await openByKeyboard(user);
    await user.keyboard("{ArrowDown}{ArrowDown} ");
    expect(run.new).toHaveBeenCalledTimes(1);
    expect(run.market).not.toHaveBeenCalled();
  });

  it("C13 Escape closes it and focus returns to the trigger", async () => {
    motion.reduced = true;
    mount(<Host />);
    const user = userEvent.setup();
    await openByKeyboard(user);
    await user.keyboard("{Escape}");
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("C13 the pointer opens it too (the trigger keeps its own markup)", async () => {
    mount(<Host />);
    const user = userEvent.setup();
    await user.click(trigger());
    await tick();
    expect(items()).toHaveLength(3);
  });

  it("C13 the page behind stays as it is (not aria-hidden), a press outside closes the menu, and Tab does not leave it", async () => {
    motion.reduced = true;
    mount(
      <>
        <button>Elsewhere</button>
        <Host />
      </>,
    );
    const user = userEvent.setup();
    await openByKeyboard(user);
    // Reachable by role (an aria-hidden page would not be) and not marked.
    expect(screen.getByRole("button", { name: "Elsewhere" }).closest("[aria-hidden]")).toBeNull();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    await tick();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
