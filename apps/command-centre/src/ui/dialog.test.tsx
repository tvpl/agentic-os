// @vitest-environment jsdom
/**
 * The dialog (.specs/features/primitivas, C4-C9): where it renders, where focus
 * goes in and comes back, what Tab and Escape do, what is `inert` behind it,
 * and when `onClose` runs. Each claim is asserted on the DOM a person meets.
 */
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { CommandRegistry, CommandsProvider, useCommands, type Command } from "../commands/registry";
import { DialogSurface, DropdownMenu, Modal, Popover, getDialogDepth, useDialogDepth } from ".";
import { installPage, mount, motion, tick } from "./testkit";

installPage();

/** A press the way a person makes it: Radix hears the pointer going down and dismisses on the click that follows. */
const pressOn = (el: Element) => {
  fireEvent.pointerDown(el);
  fireEvent.mouseDown(el);
  fireEvent.pointerUp(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
};
const dialogs = () => screen.queryAllByRole("dialog");
const press = (key: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement) =>
  act(() => void fireEvent.keyDown(target ?? document.body, { key, ...init }));

/** A page with an opener button and a Modal that opens from it. */
function Opener({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      {open && (
        <Modal
          title="Rename"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          {children}
        </Modal>
      )}
    </>
  );
}

const openFromButton = async () => {
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  await act(async () => void fireEvent.click(opener));
  await tick();
  return opener;
};

describe("C4 where the dialog renders and where focus lands", () => {
  it("C4 renders under #modal-root as a modal dialog named by its title", async () => {
    mount(<Opener />);
    await openFromButton();
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(document.getElementById("modal-root")!.contains(dialog)).toBe(true);
    expect(document.getElementById("root")!.contains(dialog)).toBe(false);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Rename");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(within(dialog).getByRole("heading", { name: "Rename" })).toBeTruthy();
  });

  it("C4 focus lands on initialFocus, else the first field, else the first control that is not close, else the dialog", async () => {
    // 1. initialFocus
    const target = { current: null as HTMLElement | null };
    const first = mount(
      <Modal title="A" onClose={() => undefined} initialFocus={() => target.current}>
        <input aria-label="field" />
        <button ref={(el) => void (target.current = el)}>chosen</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "chosen" }));
    first.unmount();
    // 2. the first field, even though the close button comes first in the DOM
    const second = mount(
      <Modal title="B" onClose={() => undefined}>
        <button>action</button>
        <input aria-label="name" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "name" }));
    second.unmount();
    // 3. no field: the first control that is not the close button
    const third = mount(
      <Modal title="C" onClose={() => undefined}>
        <button>one</button>
        <button>two</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "one" }));
    third.unmount();
    // 4. nothing to focus but the close button, which does not count: the dialog itself
    mount(
      <Modal title="D" onClose={() => undefined}>
        <p>Only words.</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "D" }));
  });
});

describe("C5 focus comes back to what held it", () => {
  const ways: Array<[string, () => void | Promise<void>]> = [
    ["Escape", () => press("Escape")],
    ["the close button", () => void fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["a press on the backdrop", () => void pressOn(document.querySelector(".modal-backdrop")!)],
  ];
  for (const [how, close] of ways)
    it(`C5 closing with ${how} hands focus back to the opener, which has no Radix trigger`, async () => {
      motion.reduced = true;
      mount(<Opener />);
      const opener = await openFromButton();
      expect(document.activeElement).not.toBe(opener);
      await act(async () => void (await close()));
      await tick();
      expect(dialogs()).toHaveLength(0);
      expect(document.activeElement).toBe(opener);
    });

  it("C5 closing from the parent (open={false}) hands focus back to the opener too", async () => {
    motion.reduced = true;
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <button onClick={() => setOpen(false)}>save</button>
          <Modal title="Edit" open={open} onClose={() => setOpen(false)}>
            <input aria-label="name" />
          </Modal>
        </>
      );
    }
    mount(<Controlled />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    await act(async () => void fireEvent.click(opener));
    await tick();
    expect(dialogs()).toHaveLength(1);
    await act(async () => void screen.getByRole("button", { name: "save", hidden: true }).click());
    await tick();
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});

describe("C36 what held focus is gone: focus goes to the control the menu or the popover hung from", () => {
  it("C36 a dialog opened from an item of a menu hands focus back to the menu's trigger when it closes", async () => {
    motion.reduced = true;
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <DropdownMenu
            trigger={<button>more</button>}
            items={[{ id: "export", label: "Export", onSelect: () => setOpen(true) }]}
          />
          {open && (
            <Modal title="Export" onClose={() => setOpen(false)}>
              <button>go</button>
            </Modal>
          )}
        </>
      );
    }
    mount(<Host />);
    const trigger = screen.getByRole("button", { name: "more" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    await tick();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export" }));
    await screen.findByRole("dialog", { name: "Export" });
    press("Escape");
    await tick(30);
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("C36 a dialog opened from a control inside a popover hands focus back to the popover's anchor", async () => {
    motion.reduced = true;
    function Host() {
      const anchor = useRef<HTMLButtonElement>(null);
      const [pop, setPop] = useState(true);
      const [modal, setModal] = useState(false);
      return (
        <>
          <button ref={anchor}>bell</button>
          <Popover open={pop} onClose={() => setPop(false)} anchor={anchor} ariaLabel="Notes">
            <button
              onClick={() => {
                setPop(false);
                setModal(true);
              }}
            >
              open one
            </button>
          </Popover>
          {modal && (
            <Modal title="Doc" onClose={() => setModal(false)}>
              <button>go</button>
            </Modal>
          )}
        </>
      );
    }
    mount(<Host />);
    await tick();
    const inside = screen.getByRole("button", { name: "open one" });
    inside.focus();
    fireEvent.click(inside);
    await screen.findByRole("dialog", { name: "Doc" });
    press("Escape");
    await tick(30);
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "bell" }));
  });
});

describe("C6 Tab stays in the dialog", () => {
  it("C6 Tab on the last control goes to the first, Shift+Tab on the first goes to the last", async () => {
    mount(
      <Modal title="Tabs" onClose={() => undefined}>
        <input aria-label="a" />
        <button>b</button>
      </Modal>,
    );
    await tick();
    const close = screen.getByRole("button", { name: "Close" });
    const b = screen.getByRole("button", { name: "b" });
    // The close button, the field and "b" are the tab stops, in that order.
    b.focus();
    press("Tab");
    expect(document.activeElement).toBe(close);
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  it("C6 focus that lands outside the dialog is pulled back in", async () => {
    mount(
      <>
        <button>outside</button>
        <Modal title="Trap" onClose={() => undefined}>
          <input aria-label="inside" />
        </Modal>
      </>,
    );
    await tick();
    screen.getByRole("textbox", { name: "inside" }).focus();
    act(() => document.querySelector<HTMLElement>("#root button")!.focus());
    await tick();
    expect(document.getElementById("modal-root")!.contains(document.activeElement)).toBe(true);
  });
});

describe("C7 Escape closes the layer on top, once", () => {
  it("C7 two dialogs: the top one closes first and once, then the one below, and no command of the registry runs", async () => {
    const ran = vi.fn();
    const keys = (scope: Command["scope"]): Command => ({
      id: `esc.${scope}`,
      title: "common.close",
      group: "navigation",
      scope,
      keys: ["Escape"],
      allowInInput: true,
      run: () => ran(scope),
    });
    function Stage() {
      useCommands([keys("global"), keys("nucleo"), keys("moldura"), keys("modal")]);
      const [lower, setLower] = useState(true);
      const [upper, setUpper] = useState(false);
      return (
        <>
          <button onClick={() => setUpper(true)}>open upper</button>
          {lower && (
            <Modal title="Lower" onClose={() => setLower(false)}>
              <input aria-label="lower field" />
            </Modal>
          )}
          {upper && (
            <Modal title="Upper" onClose={() => setUpper(false)}>
              <input aria-label="upper field" />
            </Modal>
          )}
        </>
      );
    }
    motion.reduced = true;
    mount(
      <CommandsProvider registry={new CommandRegistry()}>
        <Stage />
      </CommandsProvider>,
    );
    await tick();
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "open upper", hidden: true })),
    );
    await tick();
    const open = () =>
      screen.queryAllByRole("dialog", { hidden: true }).map((d) => d.getAttribute("aria-label"));
    expect(open()).toEqual(["Lower", "Upper"]);
    expect(getDialogDepth()).toBe(2);
    press("Escape");
    await tick();
    expect(open()).toEqual(["Lower"]);
    press("Escape");
    await tick();
    expect(open()).toEqual([]);
    // Radix took both keys and marked them handled: none of the four commands saw an Escape.
    expect(ran).not.toHaveBeenCalled();
  });

  it("C7 onClose of a dialog runs once even when Escape is pressed again during its exit", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mount(
      <Modal title="Once" onClose={onClose}>
        <input aria-label="f" />
      </Modal>,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(5)));
    press("Escape");
    press("Escape");
    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("C8 the page behind is inert and the depth counts", () => {
  it("C8 the root and the other layers go inert, the toasts do not, and everything is let go on close", async () => {
    motion.reduced = true;
    const depths: number[] = [];
    function Watch() {
      depths.push(useDialogDepth());
      return null;
    }
    function Stage({ second }: { second: boolean }) {
      return (
        <>
          <Watch />
          <main id="shell">content</main>
          <div className="toast-wrap">toasts</div>
          <Modal title="One" onClose={() => undefined}>
            <input aria-label="one" />
          </Modal>
          {second && (
            <Modal title="Two" onClose={() => undefined}>
              <input aria-label="two" />
            </Modal>
          )}
        </>
      );
    }
    const view = mount(<Stage second={false} />);
    await tick();
    const root = document.getElementById("root")!;
    // The Modal portals out of #root: every child of the root is inert, but the toasts.
    expect(root.querySelector("#shell")!.closest("[inert]")).not.toBeNull();
    expect(root.querySelector(".toast-wrap")!.hasAttribute("inert")).toBe(false);
    expect(getDialogDepth()).toBe(1);
    expect(depths.at(-1)).toBe(1);
    const modalRoot = document.getElementById("modal-root")!;
    expect(modalRoot.children[0]!.hasAttribute("inert")).toBe(false);
    view.rerender(<Stage second />);
    await tick();
    expect(getDialogDepth()).toBe(2);
    expect(depths.at(-1)).toBe(2);
    // The first dialog's layer is inert under the second, which is not.
    expect(modalRoot.children[0]!.hasAttribute("inert")).toBe(true);
    expect(modalRoot.children[1]!.hasAttribute("inert")).toBe(false);
    view.unmount();
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(getDialogDepth()).toBe(0);
  });
});

describe("C9 the backdrop closes it and onClose waits for the exit", () => {
  it("C9 a press on the backdrop asks to close, a press inside the sheet does not", async () => {
    motion.reduced = true;
    const onClose = vi.fn();
    mount(
      <Modal title="Press" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );
    await tick();
    pressOn(screen.getByRole("textbox", { name: "field" }));
    pressOn(screen.getByRole("dialog", { name: "Press" }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    pressOn(document.querySelector(".modal-backdrop")!);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("C9 onClose runs 160 ms after the request, not before", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mount(
      <Modal title="Exit" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(5)));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(159)));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("C9 with reduced motion onClose runs at once and the sheet is gone with it", async () => {
    motion.reduced = true;
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Modal
          title="Now"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input aria-label="field" />
        </Modal>
      ) : null;
    }
    mount(<Host />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });
});

describe("C4 the surface other dialogs stand on", () => {
  it("C4 DialogSurface takes its own backdrop and sheet classes, and no portal for a drawer that stays", async () => {
    const view = mount(
      <DialogSurface open label="Palette" backdrop="launcher" className="launcher-panel palette">
        <input aria-label="q" />
      </DialogSurface>,
    );
    await tick();
    const dialog = screen.getByRole("dialog", { name: "Palette" });
    expect(dialog.className).toBe("launcher-panel palette");
    expect(dialog.parentElement!.className).toBe("launcher");
    view.unmount();
    mount(
      <DialogSurface open label="Drawer" portal={false} backdrop={false} className="drawer">
        <button>in place</button>
      </DialogSurface>,
    );
    await tick();
    expect(document.getElementById("root")!.contains(screen.getByRole("dialog", { name: "Drawer" }))).toBe(
      true,
    );
  });
});
