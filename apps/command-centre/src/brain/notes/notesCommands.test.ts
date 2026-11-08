// @vitest-environment jsdom
/**
 * The commands and the key of the notes view (.specs/features/cerebro-vista-notas, C30, amendment 13; comandos-atalhos
 * design.md): "Ver notas", "Ver grafo", "Definir como Home" and "Fechar aba" are in the registry; `v` in the
 * `view:brain` scope switches between the two views and does nothing in a text field; the keyboard-listener
 * allowlist does not grow. The shell is mounted the way App.tsx mounts it; the network is `./testnet`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type * as ApiModule from "../../api";
import { dictionaries } from "../../i18n";
import { mountShell } from "../../commands/testkit";
import { OUTSIDE_THE_REGISTRY, OUTSIDE_THE_REGISTRY_DEPS } from "../../commands/listenersAllowlist";
import { installPage } from "../../ui/testkit";
import { MEM, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : noop), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
installPage();
beforeEach(() => {
  resetNet();
  net.prefs.shell = "moldura";
  note(1, MEM, "alfa.md", { title: "Alfa" });
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const pt = dictionaries["pt-BR"];
const press = (key: string, target: Element = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key });
  });

describe("C30 the registry and the key v", () => {
  it("C30 the registry holds Ver notas on the graph, and Ver grafo, Definir como Home and Fechar aba on the notes", async () => {
    const registry = await mountShell("/brain", "moldura", "pt-BR");
    await waitFor(() => expect(registry.list().some((c) => c.id === "brain.view.notes")).toBe(true));
    const notes = registry.list().find((c) => c.id === "brain.view.notes")!;
    expect(pt[notes.title]).toBe("Ver notas");
    expect([notes.scope, notes.keys, notes.palette]).toEqual(["view:brain", ["v"], true]);

    press("v");
    await waitFor(() => expect(window.location.hash).toBe("#/brain/notes"));
    await waitFor(() => expect(registry.list().some((c) => c.id === "brain.notes.closeTab")).toBe(true));
    const byId = (id: string) => registry.list().find((c) => c.id === id)!;
    expect(pt[byId("brain.view.graph").title]).toBe("Ver grafo");
    expect(byId("brain.view.graph").keys).toEqual(["v"]);
    expect(pt[byId("brain.notes.setHome").title]).toBe("Definir como Home");
    expect(pt[byId("brain.notes.closeTab").title]).toBe("Fechar aba");
    for (const id of ["brain.view.graph", "brain.notes.setHome", "brain.notes.closeTab"])
      expect(byId(id).palette, id).toBe(true);
    // one "v" per view: the graph's own command is gone while the notes are up
    expect(registry.list().filter((c) => c.keys?.includes("v") && c.scope === "view:brain")).toHaveLength(1);

    press("v");
    await waitFor(() => expect(window.location.hash).toBe("#/brain"));
  });

  it("C30 v does nothing while the focus is in a text field", async () => {
    await mountShell("/brain/notes", "moldura", "pt-BR");
    const field = await screen.findByRole("button", { name: "Abrir outra nota" });
    fireEvent.click(field);
    const input = await screen.findByRole("combobox", { name: "Abrir outra nota" });
    input.focus();
    press("v", input);
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/brain/notes");
    press("v");
    await waitFor(() => expect(window.location.hash).toBe("#/brain"));
  });

  it("C30 the keyboard-listener allowlist does not grow, and no file of the brain's views adds a key listener", () => {
    expect(Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY).map(([f, [n]]) => [f, n]))).toEqual({
      "commands/registry.ts": 1,
      "ui/layers.ts": 1,
      "nucleo/pending/FocusMode.tsx": 1,
      "onboarding/useTourSurface.ts": 1,
      "runs/Replay.tsx": 1,
      "nucleo/scenes/SkillsScene.tsx": 1,
      "nucleo/scenes/BrainScene.tsx": 2,
      "nucleo/scenes/RunsScene.tsx": 1,
      "nucleo/scenes/RoutinesScene.tsx": 1,
      "nucleo/NucleoScene.tsx": 1,
    });
    expect(Object.keys(OUTSIDE_THE_REGISTRY_DEPS).sort()).toEqual([
      "@radix-ui/react-dismissable-layer",
      "@radix-ui/react-menu",
    ]);
    const src = path.resolve(__dirname, "../..");
    const files = [
      ...fs
        .readdirSync(path.join(src, "brain/notes"))
        .filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))
        .map((n) => `brain/notes/${n}`),
      "brain/BrainViewSwitch.tsx",
      "views/SecondBrain.tsx",
    ];
    for (const f of files) {
      const code = fs.readFileSync(path.join(src, f), "utf8");
      expect(/addEventListener\(\s*["'`]key(down|up|press)/.test(code), f).toBe(false);
    }
  });
});
