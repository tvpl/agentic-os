// @vitest-environment jsdom
/**
 * Pixel Studio as a plugin (.specs/features/limpeza-legado, C22, C27): the host builds its entry from the plugin's
 * manifest with the values it always had, and the plugin's keys are the same commands of the typed registry.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Grid3x3 } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { APPS } from "../../desktop/apps";
import { CommandRegistry, CommandsProvider } from "../../commands/registry";
import { ConfirmProvider } from "../../hooks/useConfirm";
import { ToastProvider } from "../../components/ui";
import { UiProvider } from "../../ui";
import { installRecordingCanvas } from "../../testing/canvasText";
import { pixelPlugin } from "./index";
import PixelStudio from "./PixelStudio";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
let restoreCanvas: () => void;
beforeAll(() => {
  restoreCanvas = installRecordingCanvas();
});
afterAll(() => restoreCanvas());
afterEach(cleanup);

describe("C22 the entry of the host", () => {
  it("C22 APPS.pixel is built from the plugin and carries what it carried before the move", () => {
    const { Component, ...rest } = APPS.pixel;
    expect(rest).toEqual({
      kind: "pixel",
      route: "/pixel",
      titleKey: "nav.pixel",
      refKey: "desktop.ref.app.pixel",
      descKey: "microapp.pixel.desc",
      Icon: Grid3x3,
    });
    expect(Component).toBeDefined();
    expect(pixelPlugin.route).toBe(APPS.pixel.route);
    expect(pixelPlugin.Icon).toBe(APPS.pixel.Icon);
  });

  it("C22 the plugin's view is behind load(), which resolves to the Pixel Studio component", async () => {
    const mod = await pixelPlugin.load();
    expect(mod.default).toBe(PixelStudio);
  });
});

describe("C27 the commands of the plugin", () => {
  it("C27 mounting the view registers the 13 commands of scope view:pixel that were registered before the move", async () => {
    const registry = new CommandRegistry();
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <UiProvider>
              <CommandsProvider registry={registry}>
                <PixelStudio />
              </CommandsProvider>
            </UiProvider>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(registry.list().length).toBeGreaterThan(0));
    expect(
      registry
        .list()
        .map((c) => ({ id: c.id, title: c.title, keys: c.keys, group: c.group, scope: c.scope })),
    ).toEqual(
      [
        ["pixel.undo", "pixel.undo", ["Mod+Z"]],
        ["pixel.redo", "cmd.pixel.redo", ["Mod+Shift+Z", "Mod+Y"]],
        ["pixel.prevFrame", "cmd.pixel.prevFrame", ["["]],
        ["pixel.nextFrame", "cmd.pixel.nextFrame", ["]"]],
        ["pixel.brushUp", "cmd.pixel.brushUp", ["+", "="]],
        ["pixel.brushDown", "cmd.pixel.brushDown", ["-", "_"]],
        ["pixel.swap", "cmd.pixel.swap", ["x"]],
        ["pixel.onion", "pixel.onion", ["o"]],
        ["pixel.tool.pencil", "pixel.tool.pencil", ["1"]],
        ["pixel.tool.eraser", "pixel.tool.eraser", ["2"]],
        ["pixel.tool.fill", "pixel.tool.fill", ["3"]],
        ["pixel.tool.eyedropper", "pixel.tool.eyedropper", ["4"]],
        ["pixel.leave", "cmd.pixel.leave", ["Escape"]],
      ].map(([id, title, keys]) => ({ id, title, keys, group: "view", scope: "view:pixel" })),
    );
  });
});
