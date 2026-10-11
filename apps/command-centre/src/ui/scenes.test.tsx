// @vitest-environment jsdom
/**
 * The scenes of the Núcleo that listen on the window before Radix does (.specs/features/primitivas, C34, C35):
 * each of them, with a layer open, leaves the key to the layer; with none, it answers. One test per site, so
 * that removing a guard (or making it never true) fails the test of that site and no other.
 *
 * Escape guards (hint, popover or menu open): Runs, Routines (the classic sheet), the focus mode, the Brain.
 * Key guards (popover or menu open, not a hint): the Brain's Shift+1-4, the Skills ring's arrows and letters.
 * A layer that is leaving (its exit still playing: a menu, a dialog) is no longer the one to leave the key to.
 *
 * No test waits a fixed time: each waits for the thing it needs (`waitFor`), and a claim that something did not
 * happen is made after the key's own work is done (`flush`), on the marker the scene would have set.
 */
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { CommandRegistry } from "../commands/registry";
import { installHarness, mountShell, press } from "../commands/testkit";
import { server } from "../commands/testserver";
import { DialogSurface, DropdownMenu, Popover, Tooltip } from ".";
import { giveLayersAnExit } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("../commands/testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

installHarness();
// (The harness marks the tour as done before each test and clears the storage after: clearing it here too
// would put the tour back, and its Escape would swallow the key.)
beforeEach(() => window.sessionStorage.clear());

const SLOW = { timeout: 15_000 };
/** Let what the key set off (state, effects, microtasks) finish: not a wait for time to pass. */
const flush = () => act(async () => undefined);

/**
 * Four ways to have a layer open, beside the scene: a hint, a popover, a menu and a dialog whose exit is long
 * (a minute: once asked to close it stays, `closed`, for the whole test, so "leaving" is not a race).
 */
function Layers() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState(false);
  const [sheet, setSheet] = useState(false);
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
      <button onClick={() => setSheet(true)}>sheet</button>
      <DialogSurface
        open={sheet}
        onOpenChange={(next) => !next && setSheet(false)}
        label="Sheet"
        exitMs={60_000}
      >
        <input aria-label="in the sheet" />
      </DialogSurface>
    </div>
  );
}
type Kind = "hint" | "popover" | "menu";
const open = async (kind: Kind) => {
  const user = userEvent.setup();
  if (kind === "hint") act(() => screen.getByRole("button", { name: "Hint control" }).focus());
  else if (kind === "popover") await user.click(screen.getByRole("button", { name: "pop" }));
  else await user.click(screen.getByRole("button", { name: "menu" }));
  await waitFor(() => expect(layerUp()).toBe(true));
};
/** Open the dialog and put the key where a person's is: in its field. Returns the dialog. */
const openSheet = async () => {
  await userEvent.setup().click(screen.getByRole("button", { name: "sheet" }));
  const dialog = await screen.findByRole("dialog", { name: "Sheet" });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
};
const escapeInTheSheet = () => press({ key: "Escape" }, document.activeElement ?? document.body);
const layerUp = () =>
  document.querySelector(
    '.ui-tip[data-state$="open"], .popover[data-state="open"], .ui-menu[data-state="open"]',
  ) !== null;
/** The key goes to the page, as a person's does when focus is on nothing in particular. */
const onPage = (init: KeyboardEventInit) => press(init);

/** The first Escape closes the layer; once it is closed (and what the key set off is done) the scene has not moved. */
const layerTakesTheFirst = async () => {
  onPage({ key: "Escape" });
  await waitFor(() => expect(layerUp()).toBe(false));
  await flush();
};

const mount = (path: string) =>
  mountShell(path, "nucleo", "en", new CommandRegistry(), { inside: <Layers /> });

describe("C34 Escape: the layer on top takes it, the scene on the next one", () => {
  const KINDS: Kind[] = ["hint", "popover", "menu"];

  describe("the Runs scene: Escape steps back from the run", () => {
    const run = () => document.querySelector(".rs-run");
    const ready = async () => {
      await mount("/runs/r1");
      await waitFor(() => expect(run()).not.toBeNull(), SLOW);
    };
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the run stays; the next Escape leaves it`, async () => {
        await ready();
        await open(kind);
        await layerTakesTheFirst();
        expect(run()?.classList.contains("bye"), "the run is not leaving").toBe(false);
        expect(window.location.hash, "the run is still open").toBe("#/runs/r1");
        onPage({ key: "Escape" });
        await waitFor(() => expect(window.location.hash).toBe("#/runs"), SLOW);
      });

    it("C34 a menu that is already leaving (its exit is playing) does not hold the Escape: the run steps back", async () => {
      const exit = giveLayersAnExit();
      try {
        await ready();
        await open("menu");
        onPage({ key: "Escape" });
        await waitFor(() =>
          expect(document.querySelector(".ui-menu")?.getAttribute("data-state")).toBe("closed"),
        );
        onPage({ key: "Escape" });
        await waitFor(() => expect(window.location.hash).toBe("#/runs"), SLOW);
      } finally {
        exit.restore();
      }
    });

    it("C34 a dialog that is leaving (its exit is playing, focus still in it) does not hold the Escape: the run steps back", async () => {
      await ready();
      const dialog = await openSheet();
      escapeInTheSheet();
      await waitFor(() => expect(dialog.getAttribute("data-state")).toBe("closed"));
      expect(run()?.classList.contains("bye"), "the first Escape was the dialog's").toBe(false);
      escapeInTheSheet();
      await waitFor(() => expect(window.location.hash).toBe("#/runs"), SLOW);
    });
  });

  describe("the Routines scene: Escape closes the classic sheet", () => {
    const sheet = () => document.querySelector(".rts-sheet");
    const ready = async () => {
      await mount("/routines");
      fireEvent.click(await screen.findByRole("button", { name: "All routines" }, SLOW));
      await waitFor(() => expect(sheet()).not.toBeNull());
    };
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the sheet stays; the next Escape closes it`, async () => {
        await ready();
        await open(kind);
        await layerTakesTheFirst();
        expect(sheet(), "the sheet is still open").not.toBeNull();
        onPage({ key: "Escape" });
        await waitFor(() => expect(sheet()).toBeNull());
      });

    it("C34 a dialog that is leaving does not hold the Escape: the next one closes the sheet", async () => {
      await ready();
      const dialog = await openSheet();
      escapeInTheSheet();
      await waitFor(() => expect(dialog.getAttribute("data-state")).toBe("closed"));
      expect(sheet(), "the first Escape was the dialog's").not.toBeNull();
      escapeInTheSheet();
      await waitFor(() => expect(sheet()).toBeNull());
    });
  });

  describe("the focus mode: Escape leaves it", () => {
    const mode = () => document.querySelector("div.nu-focus");
    for (const kind of KINDS)
      it(`C34 with a ${kind} open the focus mode stays; the next Escape leaves it`, async () => {
        await mount("/");
        onPage({ key: "p" });
        await waitFor(() => expect(mode()).not.toBeNull(), SLOW);
        await open(kind);
        await layerTakesTheFirst();
        expect(mode(), "the focus mode is still up").not.toBeNull();
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
        await layerTakesTheFirst();
        expect(help(), "the help card is still open").not.toBeNull();
        onPage({ key: "Escape" });
        await waitFor(() => expect(help()).toBeNull());
      } finally {
        server.graph = null;
      }
    });

  it("C34 a dialog that is leaving does not hold the Escape: the next one closes the help card", async () => {
    server.graph = graph();
    try {
      await mount("/brain");
      const help = () => document.querySelector(".bs-help");
      await waitFor(() => expect(help()).not.toBeNull(), SLOW);
      const dialog = await openSheet();
      escapeInTheSheet();
      await waitFor(() => expect(dialog.getAttribute("data-state")).toBe("closed"));
      expect(help(), "the first Escape was the dialog's").not.toBeNull();
      escapeInTheSheet();
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
      await flush();
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
  };
  for (const kind of [null, "hint"] as const)
    it(`C35 under ${kind ?? "nothing"} a letter starts the filter and the arrows are the scene's (default prevented)`, async () => {
      await ready();
      if (kind) await open(kind);
      expect(fireEvent.keyDown(document.body, { key: "ArrowRight" }), "the arrow").toBe(false);
      onPage({ key: "d" });
      await waitFor(() => expect(filter().value, "the letter").toBe("d"));
    });
  for (const kind of ["popover", "menu"] as const)
    it(`C35 under a ${kind} the letter and the arrow are not the scene's`, async () => {
      await ready();
      await open(kind);
      const arrow = fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(arrow, "the arrow is left alone").toBe(true);
      onPage({ key: "d" });
      await flush();
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
