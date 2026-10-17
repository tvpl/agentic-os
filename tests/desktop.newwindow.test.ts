import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * distribuicao, round 2 (C63): the window script that routes a click on `<a target="_blank">` to `window.open`
 * (apps/desktop/src-tauri/src/new-window.js). In WebKitGTK that click alone reaches nothing; `window.open(address,
 * "_blank")` reaches the shell's `on_new_window`, which decides (tested in shell-core, `nav.rs`). This file proves which
 * clicks the script reroutes and which it leaves alone; `apps/desktop/smoke/gui.sh` (scenario F) proves the real click.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fs.readFileSync(
  path.join(ROOT, "apps", "desktop", "src-tauri", "src", "new-window.js"),
  "utf8",
);

/** The script without its comment lines: the checks on what it does read code, not the prose around it. */
const CODE = SCRIPT.split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

interface Opened {
  address: unknown;
  name: unknown;
}
interface Anchor {
  href: string;
  attrs: Record<string, string>;
}

/** A DOM event as far as the script can tell: `defaultPrevented` turns true when anyone calls `preventDefault`. */
interface FakeEvent {
  defaultPrevented: boolean;
  button: number;
  preventDefault: () => void;
  target: { closest: (selector: string) => unknown };
}

/**
 * Runs the script on a page at `origin`; returns what it registered and a way to click. The fake DOM has the two phases
 * that matter to the script: a click reaches the `document` listeners registered to capture first, then the page's own
 * handlers on the link (`pageHandlers`, the router or menu that may take the click), then the `document` listeners that
 * bubble. A listener registered with `true` or `{ capture: true }` is a capturing one; with nothing, a bubbling one.
 */
function page(
  location: { protocol: string; hostname: string },
  pageHandlers: Array<(event: FakeEvent) => void> = [],
) {
  const listeners: Array<{ type: string; run: (event: FakeEvent) => void; capture: boolean }> = [];
  const opened: Opened[] = [];
  const document = {
    addEventListener: (
      type: string,
      run: (event: FakeEvent) => void,
      options?: boolean | { capture?: boolean },
    ) =>
      listeners.push({
        type,
        run,
        capture: options === true || (typeof options === "object" && options.capture === true),
      }),
  };
  const window = { open: (address: unknown, name: unknown) => opened.push({ address, name }) };
  vm.runInNewContext(SCRIPT, { location, document, window });
  const selectors: string[] = [];
  /** `anchor`: the link the click lands in, or none; `closest` answers like a DOM element does for `a[target]`. */
  const click = (
    anchor: Anchor | null,
    { defaultPrevented = false, button = 0 }: { defaultPrevented?: boolean; button?: number } = {},
  ) => {
    const element = anchor && {
      hasAttribute: (name: string) => name in anchor.attrs,
      getAttribute: (name: string) => anchor.attrs[name] ?? null,
      href: anchor.href,
    };
    let inScript = false;
    let scriptPrevented = false;
    const event: FakeEvent = {
      defaultPrevented,
      button,
      preventDefault: () => {
        event.defaultPrevented = true;
        if (inScript) scriptPrevented = true;
      },
      target: {
        closest: (selector: string) => {
          selectors.push(selector);
          // `a[target]`: only a link that has a target attribute
          return element && "target" in anchor!.attrs ? element : null;
        },
      },
    };
    const clicks = listeners.filter((x) => x.type === "click");
    inScript = true;
    for (const l of clicks.filter((x) => x.capture)) l.run(event);
    inScript = false;
    if (anchor) for (const handle of pageHandlers) handle(event);
    inScript = true;
    for (const l of clicks.filter((x) => !x.capture)) l.run(event);
    return scriptPrevented; // whether the script took the click (the page's own preventDefault does not count)
  };
  return { listeners, opened, click, selectors };
}

const SERVICE = { protocol: "http:", hostname: "127.0.0.1" };
const link = (href: string, attrs: Record<string, string> = { target: "_blank" }): Anchor => ({
  href,
  attrs,
});

describe("C63 a click on a link that asks for a new window is handed to window.open, where the shell decides", () => {
  it("C63 `_blank`, with and without rel=noreferrer noopener, and any named target: window.open(address, '_blank') once, the default click prevented", () => {
    for (const attrs of [
      { target: "_blank" },
      { target: "_blank", rel: "noreferrer noopener" },
      { target: "_blank", rel: "noreferrer" },
      { target: " _BLANK " },
      { target: "somewin" },
    ]) {
      const p = page(SERVICE);
      expect(p.click(link("https://github.com/tvpl/agentic-os", attrs)), JSON.stringify(attrs)).toBe(true);
      expect(p.opened, JSON.stringify(attrs)).toEqual([
        { address: "https://github.com/tvpl/agentic-os", name: "_blank" },
      ]);
    }
    // a web address of any scheme the shell hands to the system: http, https, mailto
    for (const href of ["http://example.com/a?b=c", "HTTPS://example.com/", "mailto:dono@example.com"]) {
      const p = page(SERVICE);
      p.click(link(href));
      expect(
        p.opened.map((o) => o.address),
        href,
      ).toEqual([href]);
    }
    // it asks the DOM for exactly the links that carry a target
    const p = page(SERVICE);
    p.click(link("https://example.com/"));
    expect(p.selectors).toEqual(["a[target]"]);
  });

  it("C63 everything else keeps the browser's own behaviour: no target, a relative target, a download, a scheme the shell does not hand out, a click the page took, another button", () => {
    const untouched = (
      name: string,
      anchor: Anchor | null,
      flags: Parameters<ReturnType<typeof page>["click"]>[1] = {},
    ) => {
      const p = page(SERVICE);
      expect(p.click(anchor, flags), name).toBe(false);
      expect(p.opened, name).toEqual([]);
    };
    untouched("no target", link("https://example.com/", {}));
    untouched("not in a link", null);
    for (const target of ["", "  ", "_self", "_parent", "_top", "_SELF"])
      untouched(`target=${JSON.stringify(target)}`, link("https://example.com/", { target }));
    untouched("download", link("https://example.com/f.zip", { target: "_blank", download: "" }));
    for (const href of [
      "javascript:alert(1)",
      "blob:http://127.0.0.1:41234/uuid",
      "file:///etc/passwd",
      "data:text/html,x",
      "ftp://example.com/",
      "tauri://localhost/",
      "vscode://file/x",
      "/relative-but-not-resolved",
    ])
      untouched(href, link(href));
    untouched("the page prevented it", link("https://example.com/"), { defaultPrevented: true });
    untouched("middle button", link("https://example.com/"), { button: 1 });
    untouched("right button", link("https://example.com/"), { button: 2 });
  });

  it("C63 the script listens in the bubbling phase, after the page's own handlers, so a click the page took is left alone", () => {
    const p = page(SERVICE);
    expect(p.listeners).toHaveLength(1);
    expect(p.listeners[0].capture).toBe(false);
    // a router that takes the click on the link itself (a handler on the link runs before one on the document that bubbles)
    const router = (event: FakeEvent) => event.preventDefault();
    const taken = page(SERVICE, [router]);
    expect(taken.click(link("https://example.com/"))).toBe(false); // the script did not take it
    expect(taken.opened).toEqual([]);
    // the same click with a page handler that leaves it alone is rerouted, so the test above is about the phase
    const untouched = page(SERVICE, [() => undefined]);
    untouched.click(link("https://example.com/"));
    expect(untouched.opened).toEqual([{ address: "https://example.com/", name: "_blank" }]);
  });

  it("C63 the script listens on pages of the service's origin only; the shell's own screens and any other origin get no listener", () => {
    expect(page(SERVICE).listeners.map((l) => l.type)).toEqual(["click"]);
    for (const location of [
      { protocol: "tauri:", hostname: "localhost" },
      { protocol: "http:", hostname: "tauri.localhost" },
      { protocol: "https:", hostname: "127.0.0.1" },
      { protocol: "http:", hostname: "localhost" },
      { protocol: "http:", hostname: "127.0.0.1.evil.example" },
      { protocol: "https:", hostname: "example.com" },
      { protocol: "about:", hostname: "" },
    ])
      expect(page(location).listeners, JSON.stringify(location)).toEqual([]);
  });

  it("C63 the script reaches nothing of the shell: no IPC, no network, no storage, no navigation of its own", () => {
    expect(CODE).not.toMatch(
      /__TAURI|invoke|ipc|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|eval\(|new Function/,
    );
    expect(CODE).not.toMatch(/location\.(href|assign|replace)\s*=|location\.(assign|replace)\(/);
    // its one effect on the page is window.open with the link's own address
    expect([...CODE.matchAll(/window\.open\(([^)]*)\)/g)].map((m) => m[1])).toEqual([
      'anchor.href, "_blank"',
    ]);
  });
});
