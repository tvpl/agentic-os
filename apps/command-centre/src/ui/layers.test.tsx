// @vitest-environment jsdom
/**
 * The layers and the command registry (.specs/features/primitivas, C17): while a
 * dialog is up the screen under it is not answering keys; its own commands do;
 * a popover is not a dialog and the screen stays live. Also the drawer, the one
 * layer that does its own keys.
 */
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandRegistry, CommandsProvider, useCommands, type Command } from "../commands/registry";
import { Modal, Popover, getDialogDepth, useDrawer } from ".";
import { installPage, mount, motion, tick } from "./testkit";

installPage();

const keyDown = (key: string, init: KeyboardEventInit = {}) =>
  act(() => void fireEvent.keyDown(document.body, { key, ...init }));

describe("C17 a dialog hides the screen's keys from the registry and keeps its own", () => {
  function Stage({ dialog, popover }: { dialog: boolean; popover: boolean }) {
    const anchor = useRef<HTMLButtonElement>(null);
    return (
      <>
        <Scene />
        <button ref={anchor}>anchor</button>
        <Popover open={popover} onClose={() => undefined} anchor={anchor} ariaLabel="Notes">
          <p>notes</p>
        </Popover>
        {dialog && (
          <Modal title="Deck" onClose={() => undefined}>
            <DialogKeys />
          </Modal>
        )}
      </>
    );
  }
  const run = { p: vi.fn(), deck: vi.fn() };
  function Scene() {
    useCommands([
      {
        id: "scene.focus",
        title: "common.close",
        group: "view",
        scope: "nucleo",
        keys: ["p"],
        run: run.p,
      } as Command,
    ]);
    return null;
  }
  function DialogKeys() {
    // The dialog's own command, in the `modal` scope, the way the deck registers its toggle.
    useCommands([
      {
        id: "deck.close",
        title: "common.close",
        group: "view",
        scope: "modal",
        keys: ["Mod+J"],
        run: run.deck,
      } as Command,
    ]);
    return <input aria-label="search" />;
  }

  it("C17 `p` of the scene does not run under a Modal, runs again when it closes, and Ctrl+J of the dialog runs", async () => {
    motion.reduced = true;
    run.p.mockClear();
    run.deck.mockClear();
    const registry = new CommandRegistry();
    const view = mount(
      <CommandsProvider registry={registry}>
        <Stage dialog={false} popover={false} />
      </CommandsProvider>,
    );
    keyDown("p");
    expect(run.p).toHaveBeenCalledTimes(1);
    view.rerender(
      <CommandsProvider registry={registry}>
        <Stage dialog popover={false} />
      </CommandsProvider>,
    );
    await tick();
    expect(getDialogDepth()).toBe(1);
    keyDown("p");
    expect(run.p).toHaveBeenCalledTimes(1);
    keyDown("j", { ctrlKey: true });
    expect(run.deck).toHaveBeenCalledTimes(1);
    view.rerender(
      <CommandsProvider registry={registry}>
        <Stage dialog={false} popover={false} />
      </CommandsProvider>,
    );
    await tick();
    expect(getDialogDepth()).toBe(0);
    keyDown("p");
    expect(run.p).toHaveBeenCalledTimes(2);
  });

  it("C17 with a Popover open the scene's `p` still runs: the popover is not a modal", async () => {
    run.p.mockClear();
    const registry = new CommandRegistry();
    mount(
      <CommandsProvider registry={registry}>
        <Stage dialog={false} popover />
      </CommandsProvider>,
    );
    await tick();
    expect(screen.getByRole("dialog", { name: "Notes" })).toBeTruthy();
    expect(getDialogDepth()).toBe(0);
    keyDown("p");
    expect(run.p).toHaveBeenCalledTimes(1);
  });
});

describe("C17 a panel that stays in the tree and is a dialog only some of the time", () => {
  function Panel({ onClose }: { onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    useDrawer(ref, () => (setOpen(false), onClose()), {
      open,
      initialFocus: () => ref.current?.querySelector("input"),
    });
    return (
      <>
        <button onClick={() => setOpen(true)}>unfold</button>
        <aside ref={ref} role="dialog" aria-modal={open || undefined} tabIndex={-1} aria-label="Drawer">
          <input aria-label="inside" />
          <button>last</button>
        </aside>
        <main>behind</main>
      </>
    );
  }

  it("C17 useDrawer counts as a layer while open, traps Tab, takes Escape once, and gives focus back", async () => {
    const onClose = vi.fn();
    mount(<Panel onClose={onClose} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "unfold" });
    opener.focus();
    await user.click(opener);
    await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(0)))));
    expect(getDialogDepth()).toBe(1);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "inside" }));
    expect(document.querySelector("main")!.closest("[inert]")).not.toBeNull();
    // Tab on the last control goes to the first (the drawer's own trap).
    screen.getByRole("button", { name: "last" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "inside" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getDialogDepth()).toBe(0);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});
