// @vitest-environment jsdom
/**
 * "Grafo | Notas" in both shells (.specs/features/cerebro-vista-notas, C29; design.md "Tela - Vista de notas"): the
 * row with its two buttons, the notes view at `/brain/notes`, and the way back to the graph with its selection and
 * camera. The shell is mounted the way App.tsx mounts it; the network is `./testnet`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import type * as SnapshotModule from "../navigationSnapshot";
import { mountShell } from "../../commands/testkit";
import { installPage } from "../../ui/testkit";
import { MEM, fileRow, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
// What the graph keeps of itself when it is left (the selection's query and the camera), watched.
const snapshots = vi.hoisted(() => ({ saved: [] as Array<{ params: string; camera: unknown }> }));
vi.mock("../navigationSnapshot", async (importOriginal) => {
  const mod = await importOriginal<typeof SnapshotModule>();
  return {
    ...mod,
    saveBrainNavigation: (params: URLSearchParams, camera: { x: number; y: number; k: number }) => {
      snapshots.saved.push({ params: params.toString(), camera: { ...camera } });
      mod.saveBrainNavigation(params, camera);
    },
  };
});
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
  snapshots.saved = [];
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.scrollTo ??= () => undefined;
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
  const nodes = [1, 2].map((id) => ({
    ...fileRow(note(id, MEM, `n${id}.md`, { title: `Nota ${id}` })),
    tags: [],
  }));
  net.overrides.push((u) =>
    u.pathname === "/api/memory/graph"
      ? Promise.resolve({ nodes, edges: [], truncated: false, totalFiles: nodes.length })
      : u.pathname === "/api/memory/preview"
        ? Promise.resolve({ kind: "text", content: "# Nota", message: null, editable: true })
        : undefined,
  );
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const row = (scope: ParentNode = document) => scope.querySelector<HTMLElement>(".brain-viewrow")!;
const buttons = (scope: ParentNode = document) => within(row(scope)).getAllByRole("button");

describe("C29 Grafo | Notas", () => {
  it("C29 the frame: two .btn.sm with aria-pressed; Notas goes to /brain/notes and shows the notes view; Grafo goes back to /brain with the selected node and the camera as they were", async () => {
    net.prefs.shell = "moldura";
    await mountShell("/brain?sel=1", "moldura", "pt-BR");
    await waitFor(() => expect(document.querySelector('[data-app="brain"] .brain-viewrow')).not.toBeNull());
    const [grafo, notas] = buttons();
    expect([grafo!.textContent, notas!.textContent]).toEqual(["Grafo", "Notas"]);
    for (const b of [grafo!, notas!])
      expect(b.className.split(" ")).toEqual(expect.arrayContaining(["btn", "sm"]));
    expect(grafo!.getAttribute("aria-pressed")).toBe("true");
    expect(notas!.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".brain2")).not.toBeNull();

    const user = userEvent.setup();
    await user.click(notas!);
    await waitFor(() => expect(window.location.hash).toBe("#/brain/notes"));
    await waitFor(() => expect(document.querySelector('[data-app="brain"] .notes-view')).not.toBeNull());
    expect(document.querySelector(".brain2")).toBeNull();
    expect(buttons()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons()[0]!.getAttribute("aria-pressed")).toBe("false");
    // Leaving, the graph kept its selection and its camera.
    expect(snapshots.saved.at(-1)!.params).toBe("sel=1");
    const camera = snapshots.saved.at(-1)!.camera;

    await user.click(buttons()[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/brain?sel=1"));
    await waitFor(() => expect(document.querySelector(".brain2")).not.toBeNull());
    expect(document.querySelector(".notes-view")).toBeNull();
    // Back on the graph and away again: the camera it had is the camera it has.
    await user.click(buttons()[1]!);
    await waitFor(() => expect(window.location.hash).toBe("#/brain/notes"));
    expect(snapshots.saved.at(-1)).toEqual({ params: "sel=1", camera });
  });

  it("C29 the Núcleo's brain scene: the same two buttons, and its Notas mode", async () => {
    net.prefs.shell = "nucleo";
    window.sessionStorage.removeItem("mordomo.brainScene.classic");
    await mountShell("/brain", "nucleo", "pt-BR");
    await waitFor(() => expect(document.querySelector(".bs > .brain-viewrow")).not.toBeNull(), {
      timeout: 10_000,
    });
    const scene = document.querySelector(".bs")!;
    const [grafo, notas] = buttons(scene);
    expect([grafo!.textContent, notas!.textContent]).toEqual(["Grafo", "Notas"]);
    for (const b of [grafo!, notas!])
      expect(b.className.split(" ")).toEqual(expect.arrayContaining(["btn", "sm"]));
    expect(grafo!.getAttribute("aria-pressed")).toBe("true");
    const user = userEvent.setup();
    await user.click(notas!);
    await waitFor(() => expect(window.location.hash).toBe("#/brain/notes"));
    await waitFor(() => expect(document.querySelector(".bs-notes .notes-view")).not.toBeNull());
    expect(document.querySelector(".nu-shell")!.getAttribute("data-scene")).toBe("brain");
    expect(
      within(row(document.querySelector(".bs-notes")!))
        .getByRole("button", { name: "Notas" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(
      within(row(document.querySelector(".bs-notes")!)).getByRole("button", { name: "Grafo" }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/brain"));
    await waitFor(() => expect(document.querySelector(".bs > .brain-viewrow")).not.toBeNull());
  });
});
