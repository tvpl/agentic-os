import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Pixel Studio is loaded on demand (.specs/features/limpeza-legado, C23, C28): the production build has a chunk of
 * its own, nothing the page loads first holds its code, and the weight of the build is recorded.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "apps", "command-centre");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-pixel-dist-"));
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

/** A string only Pixel Studio spells (the key of its draft in the browser). */
const ONLY_PIXEL = "pixel-studio-draft";

/** The chunks a page loads without anyone asking: its entry, its preloads, and what they import statically. */
function staticClosure(dist: string): string[] {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const queue = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(path.join(dist, file), "utf8");
    // `import … from "./x.js"`, `import "./x.js"` and `export … from "./x.js"`; a dynamic `import("./x.js")` has a parenthesis.
    for (const m of code.matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?["'](\.\/[^"']+\.js)["']/g,
    ))
      queue.push(`assets/${m[1]!.slice(2)}`);
  }
  return [...seen].sort();
}

let built = false;
/** Builds the interface once per run of this file, into `out`. */
function build(): void {
  if (built) return;
  // `vite` hides its bin behind `exports`; its package.json does not.
  const vite = path.join(
    path.dirname(createRequire(path.join(app, "package.json")).resolve("vite/package.json")),
    "bin",
    "vite.js",
  );
  const run = spawnSync(process.execPath, [vite, "build", "--outDir", out, "--emptyOutDir"], {
    cwd: app,
    encoding: "utf8",
    // vitest runs with NODE_ENV=test, which would build React's development bundle: the build under test is the shipped one.
    env: { ...process.env, NODE_ENV: "production" },
  });
  expect(run.status, run.stderr + run.stdout).toBe(0);
  built = true;
}

describe("C23 the Pixel Studio chunk", () => {
  it(
    "C23 the build emits a PixelStudio chunk, and no chunk the page loads first holds the Pixel Studio code",
    { timeout: 240_000 },
    () => {
      build();

      const assets = fs.readdirSync(path.join(out, "assets"));
      const pixel = assets.filter((f) => /^PixelStudio-.*\.js$/.test(f));
      expect(pixel, "one chunk for Pixel Studio").toHaveLength(1);
      expect(fs.readFileSync(path.join(out, "assets", pixel[0]!), "utf8")).toContain(ONLY_PIXEL);

      const first = staticClosure(out);
      expect(first.length).toBeGreaterThan(3);
      expect(first).not.toContain(`assets/${pixel[0]}`);
      for (const file of first)
        expect(fs.readFileSync(path.join(out, file), "utf8"), `${file} loads with the page`).not.toContain(
          ONLY_PIXEL,
        );

      // The page asks for the chunk by a dynamic import, which is how it stays out of the first load.
      const asking = assets
        .filter((f) => f.endsWith(".js"))
        .filter((f) => {
          const code = fs.readFileSync(path.join(out, "assets", f), "utf8");
          const name = pixel[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp("import\\([\"'`]\\./" + name + "[\"'`]\\)").test(code);
        });
      expect(asking.length).toBeGreaterThan(0);
    },
  );

  it("C23 the reader of the page's first load tells a static import from a dynamic one", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-closure-"));
    try {
      fs.mkdirSync(path.join(dist, "assets"));
      fs.writeFileSync(
        path.join(dist, "index.html"),
        '<script type="module" src="/assets/main.js"></script><link rel="modulepreload" href="/assets/pre.js">',
      );
      fs.writeFileSync(
        path.join(dist, "assets", "main.js"),
        'import{a}from"./dep.js";import"./side.js";export{b}from"./re.js";const x=()=>import("./lazy.js");',
      );
      fs.writeFileSync(path.join(dist, "assets", "pre.js"), "");
      for (const f of ["dep", "side", "re", "lazy"])
        fs.writeFileSync(path.join(dist, "assets", `${f}.js`), "");
      expect(staticClosure(dist)).toEqual(
        ["assets/dep.js", "assets/main.js", "assets/pre.js", "assets/re.js", "assets/side.js"].sort(),
      );
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe("C28 the weight of the build is recorded", () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, "scripts", "bundle-baseline.json"), "utf8"),
  ) as {
    after: Array<{
      feature: string;
      reason: string;
      jsRaw: number;
      jsGzip: number;
      cssRaw: number;
      cssGzip: number;
    }>;
  };

  /** The entry this feature recorded and the one before it, found by name: a later feature may append its own. */
  const own = () => {
    const i = baseline.after.findIndex((e) => e.feature === "limpeza-legado");
    return { i, entry: baseline.after[i]!, before: baseline.after[i - 1]! };
  };

  it("C28 the limpeza-legado entry is recorded with a reason, the four numbers, and no more JS than the build before", () => {
    const { i, entry, before } = own();
    expect(i, "the entry exists, and a build came before it").toBeGreaterThan(0);
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const key of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[key]) && entry[key] > 0, key).toBe(true);
    expect(entry.jsGzip).toBeLessThanOrEqual(before.jsGzip);
    expect(entry.cssGzip).toBeLessThanOrEqual(before.cssGzip);
  });

  it(
    "C28 the recorded numbers are the ones this build measures, within 2%, and the build is no heavier than the one before",
    { timeout: 240_000 },
    async () => {
      build();
      const mod = (await import(pathToFileURL(path.join(root, "scripts", "bundle-bounds.mjs")).href)) as {
        measure: (dir: string) => Record<"jsRaw" | "jsGzip" | "cssRaw" | "cssGzip", number>;
      };
      const newest = baseline.after.at(-1)!;
      const now = mod.measure(out);
      for (const key of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
        expect(Math.abs(now[key] - newest[key]) / newest[key], key).toBeLessThan(0.02);
      // The ceiling of AC 28 is on the build this test measures, not on the recorded number: while this feature's
      // entry is the newest, the build weighs no more JS gzip than the build before it recorded. Once a later feature
      // appends its entry, its own reason and `bundle:check` (1.05 x the newest) are the rule.
      if (newest.feature === "limpeza-legado") expect(now.jsGzip).toBeLessThanOrEqual(own().before.jsGzip);
    },
  );
});
