// @vitest-environment jsdom
/** The hint (.specs/features/primitivas, C14): keyboard focus, the pointer's 400 ms, Escape, and no `title`. */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { Tooltip, UiProvider } from ".";
import { installPage, mount, tick } from "./testkit";

installPage();

const button = () => screen.getByRole("button", { name: "Fold" });

describe("C14 tooltip", () => {
  it("C14 keyboard focus shows the hint, the button points at it (a hint that adds to the name), and Escape takes it away with focus unchanged", async () => {
    mount(
      <UiProvider>
        <Tooltip label="Fold the sidebar">
          <button aria-label="Fold">«</button>
        </Tooltip>
      </UiProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button().hasAttribute("title")).toBe(false);
    act(() => button().focus());
    await tick();
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Fold the sidebar");
    expect(button().getAttribute("aria-describedby")).toBe(tip.id);
    expect(button().getAttribute("aria-label")).toBe("Fold");
    fireEvent.keyDown(button(), { key: "Escape" });
    await tick();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("C14 the pointer resting on it shows the hint at 400 ms, not at 399", async () => {
    vi.useFakeTimers();
    mount(
      <UiProvider>
        <Tooltip label="Fold the sidebar">
          <button aria-label="Fold">«</button>
        </Tooltip>
      </UiProvider>,
    );
    fireEvent.pointerMove(button(), { pointerType: "mouse" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(399)));
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
    expect(screen.getByRole("tooltip").textContent).toContain("Fold the sidebar");
  });

  it("C14 brings its own provider when none is above, and shows nothing without a label", async () => {
    mount(
      <>
        <Tooltip label="Alone">
          <button aria-label="Fold">«</button>
        </Tooltip>
        <Tooltip>
          <button aria-label="Plain">p</button>
        </Tooltip>
      </>,
    );
    act(() => button().focus());
    await tick();
    expect(screen.getByRole("tooltip").textContent).toContain("Alone");
    act(() => screen.getByRole("button", { name: "Plain" }).focus());
    await tick();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("C14 can share a button with another Radix trigger (props and ref reach the one element)", async () => {
    const onClick = vi.fn();
    mount(
      <Tooltip label="Hint">
        <button aria-label="Fold" onClick={onClick}>
          «
        </button>
      </Tooltip>,
    );
    fireEvent.click(button());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("C37 a hint that only repeats the control's name does not become its description (it would be said twice)", async () => {
    mount(
      <UiProvider>
        <Tooltip label="Fold">
          <button aria-label="Fold">«</button>
        </Tooltip>
        <Tooltip label="Unfold (⌘B)">
          <button aria-label="Unfold">»</button>
        </Tooltip>
      </UiProvider>,
    );
    act(() => button().focus());
    await tick();
    expect(screen.getByRole("tooltip").textContent).toContain("Fold");
    expect(button().getAttribute("aria-label")).toBe("Fold");
    expect(button().hasAttribute("aria-describedby")).toBe(false);
    act(() => screen.getByRole("button", { name: "Unfold" }).focus());
    await tick();
    expect(screen.getByRole("button", { name: "Unfold" }).getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id,
    );
  });

  it("C37 the description a control declared itself stays when the hint repeats its name; the comparison ignores the padding", async () => {
    mount(
      <UiProvider>
        <p id="d">Saves the draft</p>
        <Tooltip label="Save ">
          <button aria-label="Save" aria-describedby="d">
            s
          </button>
        </Tooltip>
      </UiProvider>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    act(() => save.focus());
    await tick();
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(save.getAttribute("aria-describedby")).toBe("d");
  });

  it("C37 a control with no description of its own has none while the hint only repeats its name, even when padded", async () => {
    mount(
      <UiProvider>
        <Tooltip label="Save ">
          <button aria-label="Save">s</button>
        </Tooltip>
      </UiProvider>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    act(() => save.focus());
    await tick();
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(save.hasAttribute("aria-describedby")).toBe(false);
  });
});
