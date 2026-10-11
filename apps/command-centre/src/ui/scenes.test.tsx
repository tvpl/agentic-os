// @vitest-environment jsdom
/**
 * The scenes of the Núcleo that listen on the window before Radix does (.specs/features/primitivas, C34, C35):
 * each of them, with a layer open, leaves the key to the layer; with none, it answers. One test per site, so
 * that removing a guard (or making it never true) fails the test of that site and no other.
 *
 * Escape guards (hint, popover or menu open): Runs, Routines (the classic sheet), the focus mode, the Brain.
 * Key guards (popover or menu open, not a hint): the Brain's Shift+1-4, the Skills ring's arrows and letters.
 */
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { CommandRegistry } from "../commands/registry";
import { installHarness, mountShell, press } from "../commands/testkit";
import { server } from "../commands/testserver";
import { DropdownMenu, Popover, Tooltip } from ".";

vi.mock("../api", async (importOriginal) =>
  (await import("../commands/testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

installHarness();
beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const SLOW = { timeout: 15_000 };
const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

/** Three ways to have a layer open, beside the scene: a hint, a popover and a menu. */
function Layers() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState(false);
  return (
    <div data-testid="layers">
      <Tooltip label="Hint">
        <button aria-label="Hint control">h</button>
      </Tooltip>
      <button ref={anchor} onClick={() => setPop(true)}>
        pop
      </button>
      <Popover open={pop} onClose={() => setPop(false)} anchor={anchor} ariaLabel="Floating">
        <p>x</p>
      </Popover>
      <DropdownMenu
        trigger={<button>menu</button>}
        items={[{ id: "a", label: "Alpha", onSelect: () => undefined }]}
      />
    </div>
  );
}
type Kind = "hint" | "popover" | "menu";
const open = async (kind: Kind) => {
  const user = userEvent.setup();
  if (kind === "hint") act(() => screen.getByRole("button", { name: "Hint control" }).focus());
  else if (kind === "popover") await user.click(screen.getByRole("button", { name: "pop" }));
  else await user.click(screen.getByRole("button", { name: "menu" }));
  await settle();
};
const layerUp = () =>
  document.querySelector(
    '.ui-tip[data-state$="open"], .popover[data-state="open"], .ui-menu[data-state="open"]',
  ) !== null;
/** The key goes to the page, as a person's does when focus is on nothing in particular. */
const onPage = (init: KeyboardEventInit) => press(init);

const mount = (path: string) =>
  mountShell(path, "nucleo", "en", new CommandRegistry(), { inside: <Layers /> });

describe("C34 Escape: the layer on top takes it, the scene on the next one", () => {
  const KINDS: Kind[] = ["hint", "popover", "menu"];

  describe("the Runs scene: Escape steps back from the run", () => {
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the run stays; the next Escape leaves it`, async () => {
        await mount("/runs/r1");
        await waitFor(() => expect(document.querySelector(".rs-run")).not.toBeNull(), SLOW);
        expect(window.location.hash).toBe("#/runs/r1");
        await settle(200);
        await open(kind);
        onPage({ key: "Escape" });
        await settle(500);
        expect(window.location.hash, "the run is still open").toBe("#/runs/r1");
        await waitFor(() => expect(layerUp()).toBe(false));
        onPage({ key: "Escape" });
        await waitFor(() => expect(window.location.hash).toBe("#/runs"), SLOW);
      });
  });

  describe("the Routines scene: Escape closes the classic sheet", () => {
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the sheet stays; the next Escape closes it`, async () => {
        await mount("/routines");
        fireEvent.click(await screen.findByRole("button", { name: "All routines" }, SLOW));
        await screen.findByRole("region", { name: /./ }, SLOW).catch(() => undefined);
        const sheet = () => document.querySelector(".rts-sheet");
        await waitFor(() => expect(sheet()).not.toBeNull());
        await open(kind);
        onPage({ key: "Escape" });
        await settle(100);
        expect(sheet(), "the sheet is still open").not.toBeNull();
        await waitFor(() => expect(layerUp()).toBe(false));
        onPage({ key: "Escape" });
        await waitFor(() => expect(sheet()).toBeNull());
      });
  });

  describe("the focus mode: Escape leaves it", () => {
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the focus mode stays; the next Escape leaves it`, async () => {
        await mount("/");
        onPage({ key: "p" });
        const mode = () => document.querySelector("div.nu-focus");
        await waitFor(() => expect(mode()).not.toBeNull(), SLOW);
        await open(kind);
        onPage({ key: "Escape" });
        await settle(100);
        expect(mode(), "the focus mode is still up").not.toBeNull();
        await waitFor(() => expect(layerUp()).toBe(false));
        onPage({ key: "Escape" });
        await waitFor(() => expect(mode()).toBeNull());
      });
  });
});

/** A graph of three notes: enough for the Brain scene to draw its tools and its help card. */
const graph = () => ({
  nodes: [0, 1, 2].map((id) => ({
    id,
    name: `n${id}.md`,
    rel: `n${id}.md`,
    path: `/h/n${id}.md`,
    ext: "md",
    area: "Docs",
    dir: "/h",
    size: 10,
    mtime: Date.now(),
    title: null,
    tags: [],
  })),
  edges: [{ source: 0, target: 1, kind: "markdown-link", why: "link" }],
  truncated: false,
  totalFiles: 3,
});

describe("C34 the Brain scene", () => {
  for (const kind of ["hint", "popover", "menu"] as Kind[])
    it(`C34 Escape with a ${kind} open leaves the help card; the next Escape closes it`, async () => {
      server.graph = graph();
      try {
        await mount("/brain");
        const help = () => document.querySelector(".bs-help");
        await waitFor(() => expect(help()).not.toBeNull(), SLOW);
        await open(kind);
        onPage({ key: "Escape" });
        await settle(100);
        expect(help(), "the help card is still open").not.toBeNull();
        await waitFor(() => expect(layerUp()).toBe(false));
        onPage({ key: "Escape" });
        await waitFor(() => expect(help()).toBeNull());
      } finally {
        server.graph = null;
      }
    });

  /** Shift+1-4 change the arrangement (`data-dim`); a popover or a menu has the keys, a hint does not. */
  const dimAfter = async (kind: Kind | null) => {
    server.graph = graph();
    try {
      await mount("/brain");
      const root = () => document.querySelector<HTMLElement>(".bs")!;
      await waitFor(() => expect(root()).not.toBeNull(), SLOW);
      const before = root().getAttribute("data-dim");
      if (kind) await open(kind);
      onPage({ key: "@", code: "Digit2", shiftKey: true });
      await settle(50);
      return { before, after: root().getAttribute("data-dim") };
    } finally {
      server.graph = null;
    }
  };
  for (const kind of [null, "hint"] as const)
    it(`C35 Shift+2 changes the arrangement under ${kind ?? "nothing"}`, async () => {
      const { before, after } = await dimAfter(kind);
      expect(after).not.toBe(before);
    });
  for (const kind of ["popover", "menu"] as const)
    it(`C35 Shift+2 does not change the arrangement under a ${kind}`, async () => {
      const { before, after } = await dimAfter(kind);
      expect(after).toBe(before);
    });
});

describe("C35 the Skills scene", () => {
  const filter = () => document.querySelector<HTMLInputElement>(".sks-bar input[type='search']")!;
  const ready = async () => {
    await mount("/skills");
    await waitFor(() => expect(filter()).not.toBeNull(), SLOW);
    await settle(100);
  };
  for (const kind of [null, "hint"] as const)
    it(`C35 under ${kind ?? "nothing"} a letter starts the filter and the arrows are the scene's (default prevented)`, async () => {
      await ready();
      if (kind) await open(kind);
      expect(fireEvent.keyDown(document.body, { key: "ArrowRight" }), "the arrow").toBe(false);
      onPage({ key: "d" });
      await settle(30);
      expect(filter().value, "the letter").toBe("d");
    });
  for (const kind of ["popover", "menu"] as const)
    it(`C35 under a ${kind} the letter and the arrow are not the scene's`, async () => {
      await ready();
      await open(kind);
      const arrow = fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(arrow, "the arrow is left alone").toBe(true);
      onPage({ key: "d" });
      await settle(30);
      expect(filter().value).toBe("");
    });
  it("C34 the details sheet is a Modal: Escape closes it (the scene has no Escape of its own)", async () => {
    await mount("/skills/demo?d=1");
    await screen.findByRole("dialog", {}, SLOW);
    press({ key: "Escape" }, document.activeElement ?? document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), SLOW);
    await waitFor(() => expect(window.location.hash).not.toContain("d=1"));
  });
});
