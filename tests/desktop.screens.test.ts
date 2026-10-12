import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

/**
 * distribuicao, S3: the two screens of the shell (.specs/features/distribuicao, AC 24-25 and design.md).
 * The copy is read from the binding table of design.md, not from the script that renders it.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "apps", "desktop", "ui");
const html = fs.readFileSync(path.join(UI, "index.html"), "utf8");
const script = fs.readFileSync(path.join(UI, "shell.js"), "utf8");
const css = fs.readFileSync(path.join(UI, "shell.css"), "utf8");
const design = fs.readFileSync(path.join(ROOT, ".specs", "features", "distribuicao", "design.md"), "utf8");

interface Copy {
  title: string;
  body: string;
}
/** kind -> { en, pt } from the table of design.md. */
const SPEC = new Map<string, { en: Copy; pt: Copy }>();
for (const line of design.split("\n")) {
  const m = /^\| `([a-z_]+)` \| \*\*(.+?)\*\* — (.+?) \| \*\*(.+?)\*\* — (.+?) \|$/.exec(line);
  if (m) SPEC.set(m[1]!, { en: { title: m[2]!, body: m[3]! }, pt: { title: m[4]!, body: m[5]! } });
}
const KINDS = [
  "payload_missing",
  "spawn_failed",
  "home_in_use",
  "home_blocked",
  "port_busy",
  "crashed",
  "timeout",
  "bad_ready",
  "ui_not_served",
  "stopped",
];
// design.md writes the quotes of a sentence as plain " and the script as \" in a string: both are the same character.

interface Status {
  state: "starting" | "ready" | "failed";
  failure: { kind: string; detail: string; tail: string[] } | null;
  version: string;
}

/** The page with the script running, `invoke` answering from `statuses` (the last one repeats), and the commands asked for. */
async function open(language: string, ...statuses: Status[]) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.navigator, "language", { value: language, configurable: true });
  const calls: string[] = [];
  let n = 0;
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: (command: string) => {
        calls.push(command);
        if (command === "shell_status") return Promise.resolve(statuses[Math.min(n++, statuses.length - 1)]);
        return Promise.resolve(null);
      },
    },
  };
  window.eval(script);
  await new Promise((r) => window.setTimeout(r, 30));
  const doc = window.document;
  const text = (sel: string) => doc.querySelector(sel)?.textContent ?? "";
  const visible = (sel: string) => !(doc.querySelector(sel) as HTMLElement).hidden;
  return { window, doc, calls, text, visible };
}

const failed = (kind: string, detail = "exit code 4", tail: string[] = []): Status => ({
  state: "failed",
  failure: { kind, detail, tail },
  version: "0.8.0",
});

describe("C23 the failure screen says one thing per kind of failure, in both languages", () => {
  it("C23 design.md has the ten kinds the supervisor can name, each in English and Portuguese", () => {
    expect([...SPEC.keys()]).toEqual(KINDS);
    for (const [kind, copy] of SPEC)
      for (const lang of ["en", "pt"] as const) {
        expect(copy[lang].title.length, `${kind} ${lang}`).toBeGreaterThan(5);
        expect(copy[lang].body.length, `${kind} ${lang}`).toBeGreaterThan(20);
      }
    // the kinds of the table are the kinds of the Rust enum, and nothing else
    const rust = fs.readFileSync(path.join(ROOT, "apps/desktop/shell-core/src/failure.rs"), "utf8");
    const variants = [
      ...rust
        .slice(rust.indexOf("pub enum FailureKind"), rust.indexOf("pub struct Failure "))
        .matchAll(/^\s{4}([A-Z][A-Za-z]+),$/gm),
    ].map((m) => m[1]!.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
    expect(variants).toEqual(KINDS);
  });

  for (const kind of KINDS)
    for (const [language, lang] of [
      ["en-US", "en"],
      ["pt-BR", "pt"],
    ] as const)
      it(`C23 ${kind} in ${lang}: title and explanation as in design.md, the failure shown and the starting screen hidden`, async () => {
        const page = await open(
          language,
          failed(kind, "exit code 4", ["the service says it is ending with 4"]),
        );
        const expected = SPEC.get(kind)![lang];
        expect(page.text("#failure-title")).toBe(expected.title);
        expect(page.text("#failure-body")).toBe(expected.body);
        expect(page.visible("#failure")).toBe(true);
        expect(page.visible("#starting")).toBe(false);
        expect(page.text("#failure-detail")).toBe("exit code 4");
        expect(page.text("#failure-tail")).toBe("the service says it is ending with 4");
        expect(page.doc.documentElement.lang).toBe(lang === "pt" ? "pt-BR" : "en");
      });

  it("C23 a kind the screen does not know reads as crashed, and a missing failure is the starting screen", async () => {
    const page = await open("en-US", failed("something_new"));
    expect(page.text("#failure-title")).toBe(SPEC.get("crashed")!.en.title);
    const starting = await open("en-US", { state: "failed", failure: null, version: "0.8.0" });
    expect(starting.visible("#starting")).toBe(true);
    expect(starting.visible("#failure")).toBe(false);
  });

  it("C24 the failure of a service that stopped is `stopped`, and Try again is the focused control", async () => {
    const page = await open("en-US", failed("stopped", "ended by a signal"));
    expect(page.text("#failure-title")).toBe("The local service stopped");
    expect(page.doc.activeElement?.id).toBe("retry");
    expect(page.text("#failure-detail")).toBe("ended by a signal");
  });
});

describe("C23 the starting screen, the buttons and the version", () => {
  it("C23 starting: the spinner screen is up, the failure is hidden, the version line is in the language of the person", async () => {
    const en = await open("en-US", { state: "starting", failure: null, version: "0.8.0" });
    expect(en.visible("#starting")).toBe(true);
    expect(en.visible("#failure")).toBe(false);
    expect(en.text("#starting h1")).toBe("Starting MordomoOS…");
    expect(en.text("#version")).toBe("Version 0.8.0");
    const pt = await open("pt-BR", { state: "starting", failure: null, version: "0.8.0" });
    expect(pt.text("#starting h1")).toBe("Iniciando o MordomoOS…");
    expect(pt.text("#starting p")).toBe("O serviço local está iniciando. Leva alguns segundos.");
    expect(pt.text("#version")).toBe("Versão 0.8.0");
    expect(pt.text("#retry")).toBe("Tentar de novo");
    expect(pt.text("#quit")).toBe("Sair");
    expect(en.text("#retry")).toBe("Try again");
    expect(en.text("#quit")).toBe("Quit");
  });

  it("C23 the screen polls the shell until it is ready, and asks for nothing else", async () => {
    const page = await open(
      "en-US",
      { state: "starting", failure: null, version: "0.8.0" },
      failed("crashed"),
    );
    expect(new Set(page.calls)).toEqual(new Set(["shell_status"]));
    await new Promise((r) => page.window.setTimeout(r, 500));
    expect(page.visible("#failure")).toBe(true);
  });

  it("C23 Try again asks the shell to retry and goes back to the starting screen; Quit asks the shell to quit", async () => {
    const page = await open("en-US", failed("home_in_use"));
    (page.doc.getElementById("retry") as HTMLButtonElement).click();
    expect(page.calls).toContain("shell_retry");
    expect(page.visible("#starting")).toBe(true);
    expect(page.visible("#failure")).toBe(false);
    (page.doc.getElementById("quit") as HTMLButtonElement).click();
    expect(page.calls).toContain("shell_quit");
    expect(page.calls.filter((c) => c !== "shell_status").sort()).toEqual(["shell_quit", "shell_retry"]);
  });

  it("C23 what the service wrote is text, never markup, and an empty tail hides its box", async () => {
    const hostile = [
      '<img src=x onerror="document.title=1">',
      "<script>document.title=2</script>",
      "a & b < c",
    ];
    const page = await open("en-US", failed("crashed", "<b>x</b>", hostile));
    expect(page.doc.querySelector("img[src=x]")).toBeNull();
    expect(page.doc.querySelector("#failure script")).toBeNull();
    expect(page.doc.querySelector("#failure-detail b")).toBeNull();
    expect(page.text("#failure-tail")).toBe(hostile.join("\n"));
    expect(page.text("#failure-detail")).toBe("<b>x</b>");
    expect(page.visible("#failure-tail-box")).toBe(true);
    const bare = await open("en-US", failed("crashed", "exit code 1", []));
    expect(bare.visible("#failure-tail-box")).toBe(false);
  });
});

describe("C23 arrangement: one column, in this order", () => {
  it("C23 main.shell holds the mark, one of the two screens at a time, and the version, in that order", () => {
    const dom = new JSDOM(html);
    const main = dom.window.document.querySelector("main.shell")!;
    expect(
      [...main.children].map(
        (c) =>
          `${c.tagName.toLowerCase()}${c.id ? `#${c.id}` : ""}${c.className ? `.${c.className.split(" ")[0]}` : ""}`,
      ),
    ).toEqual(["img.mark", "section#starting.panel", "section#failure.panel", "p.version"]);
    expect(main.querySelector("img.mark")!.getAttribute("alt")).toBe("");
    expect(main.querySelector("#starting")!.getAttribute("role")).toBe("status");
    expect(main.querySelector("#failure")!.getAttribute("role")).toBe("alert");
    expect(main.querySelector("#failure")!.hasAttribute("hidden")).toBe(true);
    const failure = main.querySelector("#failure")!;
    expect(
      [...failure.children].map(
        (c) => c.tagName.toLowerCase() + (c.className ? `.${c.className}` : "") + (c.id ? `#${c.id}` : ""),
      ),
    ).toEqual(["h1#failure-title", "p#failure-body", "p.detail", "details#failure-tail-box", "div.actions"]);
    expect([...failure.querySelectorAll(".actions button")].map((b) => b.id)).toEqual(["retry", "quit"]);
    expect(failure.querySelector("#quit")!.className).toBe("secondary");
    expect([...main.querySelectorAll("#starting > *")].map((c) => c.tagName.toLowerCase())).toEqual([
      "div",
      "h1",
      "p",
      "p",
    ]);
  });
});

describe("C23 the rules of the design system hold for the shell's own page", () => {
  it("C23 no color literal outside the two token blocks, and every color in use is a var()", () => {
    const outsideTokens = css
      .replace(/:root\s*\{[^}]*\}/g, "")
      .replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*\}/, "");
    expect(outsideTokens).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    for (const m of css.matchAll(
      /(?:^|[;{\s])(?:color|background|border-color|border-top-color|border-right-color|outline)\s*:\s*([^;}]+)/g,
    )) {
      const value = m[1]!.trim();
      expect(value, value).toMatch(/var\(|transparent|currentColor|none|\d+px solid var|\d+px solid/);
    }
    expect((css.match(/:root\s*\{/g) ?? []).length).toBe(2);
  });

  it("C23 no font size under 12px, body text from 13px, and the tokens say so", () => {
    const sizes = [...css.matchAll(/--fs-(\d)\s*:\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(sizes.length).toBeGreaterThan(0);
    for (const [name, px] of sizes) expect(px, `--fs-${name}`).toBeGreaterThanOrEqual(12);
    for (const m of css.matchAll(/font(?:-size)?\s*:\s*([^;]*?)(\d+)px/g))
      expect(Number(m[2]), m[0]).toBeGreaterThanOrEqual(12);
    // the paragraphs and the buttons use tokens from 13px up
    const token = (name: string) => Number(new RegExp(`--${name}\\s*:\\s*(\\d+)px`).exec(css)![1]);
    expect(token("fs-4")).toBeGreaterThanOrEqual(13);
    expect(token("fs-5")).toBeGreaterThanOrEqual(13);
  });

  it("C23 the state is not only a color (the sign before the failure title), focus is visible and a reduced-motion preference stops the spinner", () => {
    expect(css).toMatch(/#failure h1::before\s*\{\s*content:\s*"\\26A0/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner\s*\{\s*animation: none/);
    expect(css).toMatch(/\[hidden\]\s*\{\s*display: none !important/);
  });
});
