// @vitest-environment jsdom
/**
 * The panels that stay in place and do their own keys (.specs/features/primitivas, C33):
 * `useDrawer` takes Escape and Tab for itself, and leaves to a Radix layer above it the Escape
 * that layer took first (a popover over the chat drawer, a hint on a control in the sidebar):
 * one Escape closes one thing.
 */
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu, Popover, Tooltip, useDrawer } from ".";
import { noteEscape } from "./layers";
import { installPage, mount, motion, tick } from "./testkit";

installPage();

function Drawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: (ref: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDrawer(ref, onClose, { initialFocus: () => ref.current?.querySelector("button") });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Drawer" tabIndex={-1}>
      {children(ref)}
    </div>
  );
}

const settle = async () => {
  await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(0)))));
  await tick();
};

const escapeEvent = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

describe("C33 the drawer takes Escape for itself and leaves to a layer above it the Escape that layer took", () => {
  it("C33 an Escape the drawer takes is marked handled and goes no further (the registry listens on the window)", async () => {
    const onClose = vi.fn();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    mount(<Drawer onClose={onClose}>{() => <button>first</button>}</Drawer>);
    await settle();
    const event = escapeEvent();
    act(() => void document.activeElement!.dispatchEvent(event));
    window.removeEventListener("keydown", onWindow);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("C33 an Escape someone else already handled does not close the drawer", async () => {
    const onClose = vi.fn();
    mount(<Drawer onClose={onClose}>{() => <button>first</button>}</Drawer>);
    await settle();
    const taken = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", taken, true);
    act(() => void document.activeElement!.dispatchEvent(escapeEvent()));
    document.removeEventListener("keydown", taken, true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => void document.activeElement!.dispatchEvent(escapeEvent()));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("C33 an Escape that a layer took while it was already leaving (data-state closed) does not keep the drawer open; one it took while open does", async () => {
    const onClose = vi.fn();
    mount(<Drawer onClose={onClose}>{() => <button>first</button>}</Drawer>);
    await settle();
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    // What Radix does: its layer takes the Escape in the document capture and marks it handled.
    const layer = (e: Event) => {
      noteEscape(e, panel);
      e.preventDefault();
    };
    document.addEventListener("keydown", layer, true);
    panel.setAttribute("data-state", "open");
    act(() => void document.activeElement!.dispatchEvent(escapeEvent()));
    expect(onClose).not.toHaveBeenCalled();
    panel.setAttribute("data-state", "closed");
    act(() => void document.activeElement!.dispatchEvent(escapeEvent()));
    document.removeEventListener("keydown", layer, true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const closesTheLayerFirst = async (
    ui: (state: { onClose: () => void }) => React.ReactElement,
    layer: () => HTMLElement | null,
    reach: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
  ) => {
    motion.reduced = true;
    const onClose = vi.fn();
    mount(ui({ onClose }));
    await settle();
    const user = userEvent.setup();
    await reach(user);
    await tick();
    expect(layer()).not.toBeNull();
    await user.keyboard("{Escape}");
    await tick();
    expect(layer()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  };

  it("C33 a popover over the drawer (the console's model chip over the chat drawer): the first Escape closes the popover", async () => {
    function Host({ onClose }: { onClose: () => void }) {
      return <Drawer onClose={onClose}>{() => <Chip />}</Drawer>;
    }
    function Chip() {
      const anchor = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={anchor} onClick={() => setOpen((v) => !v)}>
            model
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} ariaLabel="Model">
            <button>sonnet</button>
          </Popover>
        </>
      );
    }
    await closesTheLayerFirst(
      (s) => <Host {...s} />,
      () => screen.queryByRole("dialog", { name: "Model" }),
      async (user) => void (await user.click(screen.getByRole("button", { name: "model" }))),
    );
  });

  it("C33 a hint on a control inside the drawer (the sidebar overlay, the document drawer): the first Escape closes the hint", async () => {
    await closesTheLayerFirst(
      (s) => (
        <Drawer {...s}>
          {() => (
            <Tooltip label="Close the chat">
              <button aria-label="Close">x</button>
            </Tooltip>
          )}
        </Drawer>
      ),
      () => document.querySelector<HTMLElement>(".ui-tip"),
      async () => void act(() => document.querySelector<HTMLElement>("button")!.focus()),
    );
  });

  it("C33 a menu opened from inside the drawer: the first Escape closes the menu", async () => {
    await closesTheLayerFirst(
      (s) => (
        <Drawer {...s}>
          {() => (
            <DropdownMenu
              trigger={<button>more</button>}
              items={[{ id: "a", label: "Alpha", onSelect: () => undefined }]}
            />
          )}
        </Drawer>
      ),
      () => screen.queryByRole("menu"),
      async (user) => {
        screen.getByRole("button", { name: "more" }).focus();
        await user.keyboard("{Enter}");
      },
    );
  });
});
