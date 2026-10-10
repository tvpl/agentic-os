// @vitest-environment jsdom
/**
 * The popover (.specs/features/primitivas, C10): anchored, not modal, closed by
 * Escape (focus back to its anchor) or by a press outside (focus where the press put it).
 */
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, getDialogDepth } from ".";
import { installPage, mount, motion, tick } from "./testkit";

installPage();

function Anchored({ portal = true }: { portal?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((v) => !v)}>
        anchor
      </button>
      <button>elsewhere</button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} ariaLabel="Notes" portal={portal}>
        <button>inside</button>
      </Popover>
    </>
  );
}

const popover = () => screen.queryByRole("dialog", { name: "Notes" });

describe("C10 the popover", () => {
  it("C10 is a dialog that says it is not modal, leaves the page live and out of the depth", async () => {
    mount(<Anchored />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "anchor" }));
    await tick();
    const dialog = popover()!;
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(document.getElementById("modal-root")!.contains(dialog)).toBe(true);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(getDialogDepth()).toBe(0);
    // The page behind it is still there to be used.
    expect(screen.getByRole("button", { name: "elsewhere" })).toBeTruthy();
  });

  it("C10 Escape closes it and focus returns to the anchor", async () => {
    motion.reduced = true;
    mount(<Anchored />);
    const user = userEvent.setup();
    const anchor = screen.getByRole("button", { name: "anchor" });
    await user.click(anchor);
    await tick();
    expect(popover()).not.toBeNull();
    await user.keyboard("{Escape}");
    await tick();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("C10 a press outside closes it and focus stays on what was pressed", async () => {
    motion.reduced = true;
    mount(<Anchored />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "anchor" }));
    await tick();
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    await user.click(elsewhere);
    await tick();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("C10 a press on the anchor itself is the anchor's toggle: the popover closes once and stays closed", async () => {
    motion.reduced = true;
    mount(<Anchored />);
    const user = userEvent.setup();
    const anchor = screen.getByRole("button", { name: "anchor" });
    await user.click(anchor);
    await tick();
    expect(popover()).not.toBeNull();
    await user.click(anchor);
    await tick();
    expect(popover()).toBeNull();
  });

  it("C10 can stay in its parent's place in the tree (portal={false})", async () => {
    mount(<Anchored portal={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "anchor" }));
    await tick();
    expect(document.getElementById("root")!.contains(popover())).toBe(true);
  });

  it("C10 an anchor given as an element works like a ref", async () => {
    function ByElement() {
      const [el, setEl] = useState<HTMLButtonElement | null>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={setEl} onClick={() => setOpen(true)}>
            by element
          </button>
          {el && (
            <Popover open={open} onClose={() => setOpen(false)} anchor={el} ariaLabel="Notes">
              <p>hello</p>
            </Popover>
          )}
        </>
      );
    }
    mount(<ByElement />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "by element" })));
    await tick();
    expect(popover()).not.toBeNull();
  });
});
