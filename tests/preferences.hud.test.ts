import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_HUD } from "@mordomo/contracts";
import { createBackup, ensureDirs, resolvePaths, restoreBackup } from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";

/**
 * The `hud` preference after the Setup stopped arranging it (.specs/features/limpeza-legado, C12): the interface
 * does not write it any more, and a `ui-preferences.json` written by the version that did is read, served and
 * kept exactly as before.
 */

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(prefs: string | null): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-hud-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  if (prefs !== null) fs.writeFileSync(prefsFile(home), prefs);
  return home;
}
const prefsFile = (home: string) => path.join(resolvePaths(home).config, "ui-preferences.json");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

async function serve(home: string) {
  const ctx = new AppContext(home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token(), "content-type": "application/json" };
  const get = async () => (await app.inject({ method: "GET", url: "/api/ui-preferences", headers })).json();
  const put = (payload: object) =>
    app.inject({ method: "PUT", url: "/api/ui-preferences", headers, payload });
  return {
    ctx,
    get,
    put,
    close: async () => {
      await app.close();
      ctx.close();
    },
  };
}

/** As the previous version left it: tabs, another key order, no final newline, and no `shell` (older than the frame). */
const CUSTOM =
  '{"themePreset":"forest",\t"hud": {"r": ["pulse","cost"],\n "l":["app:brain"]},\n"version":1,"brain":{"layout":"rings"}}';

describe("C12 a ui-preferences.json written before the Setup stopped arranging the HUD", () => {
  it("C12 a custom hud is served as it came, and a save of the preset alone leaves it on disk", async () => {
    const s = await serve(tempHome(CUSTOM));
    try {
      const before = await s.get();
      expect(before.hud).toEqual({ l: ["app:brain"], r: ["pulse", "cost"] });
      expect(before.themePreset).toBe("forest");
      expect(before.shell).toBe("nucleo");
      expect((await s.put({ themePreset: "ocean" })).statusCode).toBe(200);
      const after = readJson(prefsFile(s.ctx.paths.home));
      expect(after.themePreset).toBe("ocean");
      expect(after.hud).toEqual({ l: ["app:brain"], r: ["pulse", "cost"] });
      expect(after.brain).toEqual({ layout: "rings" });
    } finally {
      await s.close();
    }
  });

  it("C12 a file without hud is served with the default one", async () => {
    const s = await serve(tempHome('{"version":1,"themePreset":"mono"}'));
    try {
      const prefs = await s.get();
      expect(prefs.hud).toEqual(DEFAULT_HUD);
      expect(prefs.themePreset).toBe("mono");
    } finally {
      await s.close();
    }
  });

  it.each([
    ["text", '"hud": "nope"'],
    ["a number", '"hud": 7'],
    ["null", '"hud": null'],
    ["lists of numbers", '"hud": {"l":[1,2],"r":[3]}'],
    ["a side that is not a list", '"hud": {"l":"x","r":["pulse"]}'],
  ])("C12 a hud that is %s is served as the default and the other fields as stored", async (_name, field) => {
    const s = await serve(tempHome(`{"version":1,"themePreset":"forest",${field},"brain":{"layout":"hex"}}`));
    try {
      const prefs = await s.get();
      expect(prefs.hud).toEqual(DEFAULT_HUD);
      expect(prefs.themePreset).toBe("forest");
      expect(prefs.brain).toEqual({ layout: "hex" });
    } finally {
      await s.close();
    }
  });

  it("C12 a hud with one side missing reads that side as the default", async () => {
    const s = await serve(tempHome('{"version":1,"hud":{"r":["pulse"]}}'));
    try {
      expect((await s.get()).hud).toEqual({ l: DEFAULT_HUD.l, r: ["pulse"] });
    } finally {
      await s.close();
    }
  });

  it("C12 a backup made with a custom hud restores it", async () => {
    const home = tempHome(CUSTOM);
    const s = await serve(home);
    let name = "";
    try {
      name = (await createBackup(s.ctx.paths, s.ctx.db)).name;
      fs.writeFileSync(prefsFile(home), '{"version":1,"themePreset":"mono"}\n');
    } finally {
      await s.close();
    }
    restoreBackup(resolvePaths(home), name);
    const again = await serve(home);
    try {
      expect((await again.get()).hud).toEqual({ l: ["app:brain"], r: ["pulse", "cost"] });
    } finally {
      await again.close();
    }
  });
});
