// @vitest-environment jsdom
/**
 * The surface contract has one visible consequence: a widget that declares no
 * surface must not offer an expand control. Asserted on the real frame rather
 * than on the registry flag, because the promise the user sees is the button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WidgetLayer, { type WidgetSpec } from "./WidgetLayer";
import type { WindowMap } from "./windowModel";

// The layer measures its grid with a ResizeObserver jsdom does not provide.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// jsdom defaults to 1024×768; the surface cap is asserted against a desktop.
Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

const layout: WindowMap = {
  today: { x: 0, y: 0, w: 300, h: 320, z: 1, visible: true },
  pulse: { x: 320, y: 0, w: 300, h: 220, z: 2, visible: true },
};

const spec = (title: string, expandable?: boolean): WidgetSpec => ({
  title,
  icon: null,
  node: <p>body of {title}</p>,
  expandable,
  surfaceMin: { w: 420, h: 340 },
});

function setup() {
  return render(
    <WidgetLayer
      layout={layout}
      widgets={{ today: spec("Today", false), pulse: spec("Pulse") }}
      onLayoutChange={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("widget frame honours the surface contract", () => {
  it("omits the expand control for a widget with no surface", () => {
    setup();
    expect(screen.queryByLabelText(/Maximize: Today|Expandir: Today/i)).toBeNull();
  });

  it("keeps the expand control for a widget that has one", () => {
    setup();
    expect(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i)).toBeTruthy();
  });

  it("opens a real dialog instead of stretching the widget over the screen", () => {
    setup();
    fireEvent.click(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i));
    const dialog = screen.getByRole("dialog", { name: "Pulse" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Sized by surfaceMin × GROW (672 × 544), not by the viewport.
    expect(dialog.style.width).toBe("672px");
    expect(dialog.style.height).toBe("544px");
  });

  it("leaves the rest of the desktop on screen behind the veil", () => {
    const { container } = setup();
    fireEvent.click(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i));
    // The old maximize hid every sibling with visibility:hidden.
    const sections = [...container.querySelectorAll<HTMLElement>("section.widget")];
    expect(sections.length).toBe(2);
    for (const section of sections) expect(section.style.visibility).not.toBe("hidden");
    expect(screen.getByTestId("surface-veil")).toBeTruthy();
  });

  it("moves the body into the surface rather than mounting it twice", () => {
    setup();
    expect(screen.getAllByText("body of Pulse").length).toBe(1);
    fireEvent.click(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i));
    expect(screen.getAllByText("body of Pulse").length).toBe(1);
    expect(screen.getByRole("dialog", { name: "Pulse" }).textContent).toContain("body of Pulse");
  });

  it("closes on Escape and on a click outside the panel", () => {
    setup();
    const open = () => fireEvent.click(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i));
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Pulse" })).toBeNull();
    open();
    fireEvent.pointerDown(screen.getByTestId("surface-veil"));
    expect(screen.queryByRole("dialog", { name: "Pulse" })).toBeNull();
  });

  it("a click inside the panel does not close it", () => {
    setup();
    fireEvent.click(screen.getByLabelText(/Maximize: Pulse|Expandir: Pulse/i));
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Pulse" }));
    expect(screen.getByRole("dialog", { name: "Pulse" })).toBeTruthy();
  });

  it("still lets both widgets be hidden", () => {
    setup();
    // Removing the expand control must not remove the rest of the frame.
    expect(screen.getAllByRole("button", { name: /Hide|Ocultar/i }).length).toBe(2);
    expect(screen.getByText("body of Today")).toBeTruthy();
  });
});
