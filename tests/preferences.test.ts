import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ESLint } from "eslint";
import {
  ProviderRegistry,
  SettingsSchema,
  SettingsStore,
  UI_PREFERENCE_KEYS,
  createBackup,
  createEngine,
  events,
  ensureDirs,
  resolvePaths,
  restoreBackup,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";

/** UI preferences apart from the engine's settings (.specs/features/preferencias-ui). */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-prefs-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  return home;
}

const settingsFile = (home: string) => resolvePaths(home).settingsFile;
const prefsFile = (home: string) => path.join(resolvePaths(home).config, "ui-preferences.json");

/** A settings.json as the previous version wrote it: UI fields inside, version 1. */
function writeV1(home: string, extra: Record<string, unknown> = {}): string {
  const v1 = {
    version: 1,
    systemName: "Casa",
    themePreset: "jarvis",
    microApps: [{ id: "pixel", name: "Pixel", description: "Draw", href: "/pixel" }],
    brain: { layout: "rings" },
    hud: { l: ["app:brain"], r: ["pulse"] },
    activeSpace: "focus",
    ...extra,
  };
  const text = JSON.stringify(v1, null, 2) + "\n";
  fs.writeFileSync(settingsFile(home), text);
  return text;
}

function engineOver(home: string) {
  const engine = createEngine({
    home,
    seedDir: null,
    providers: new ProviderRegistry().register(claudeManifest, createClaudeAdapter),
  });
  engine.close();
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

describe("S1 migration without losing anything", () => {
  it("C1 a v1 settings file is migrated without losing a preference", () => {
    const home = tempHome();
    writeV1(home);
    engineOver(home);
    const prefs = readJson(prefsFile(home));
    expect(prefs.themePreset).toBe("jarvis");
    expect(prefs.microApps).toEqual([{ id: "pixel", name: "Pixel", description: "Draw", href: "/pixel" }]);
    expect((prefs.brain as { layout: string }).layout).toBe("rings");
    expect(prefs.hud).toEqual({ l: ["app:brain"], r: ["pulse"] });
    const settings = readJson(settingsFile(home));
    expect(settings.version).toBe(2);
    expect(settings.systemName).toBe("Casa");
    for (const key of UI_PREFERENCE_KEYS) expect(settings, key).not.toHaveProperty(key);
  });

  it("C2 the v1 file is kept byte for byte", () => {
    const home = tempHome();
    // Not what JSON.stringify would write: other indentation and key order, no final newline.
    const original =
      '{"systemName": "Casa",\n\t"themePreset":"jarvis",  "version":1,\n\t"brain": {"layout":"rings"}}';
    fs.writeFileSync(settingsFile(home), original);
    engineOver(home);
    expect(fs.readFileSync(`${settingsFile(home)}.v1.bak`, "utf8")).toBe(original);
  });

  it("C3 existing preferences win over the migration", () => {
    const home = tempHome();
    writeV1(home);
    const existing = JSON.stringify({ version: 1, themePreset: "ocean" }) + "\n";
    fs.writeFileSync(prefsFile(home), existing);
    engineOver(home);
    expect(fs.readFileSync(prefsFile(home), "utf8")).toBe(existing);
    const settings = readJson(settingsFile(home));
    for (const key of UI_PREFERENCE_KEYS) expect(settings, key).not.toHaveProperty(key);
  });

  it("C4 a migrated file is never rewritten by a load", () => {
    const home = tempHome();
    writeV1(home);
    engineOver(home);
    const before = fs.statSync(settingsFile(home));
    const text = fs.readFileSync(settingsFile(home), "utf8");
    engineOver(home);
    new SettingsStore(resolvePaths(home)).load();
    expect(fs.statSync(settingsFile(home)).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readFileSync(settingsFile(home), "utf8")).toBe(text);
  });

  it("C5 a newer settings file is never overwritten", () => {
    const home = tempHome();
    const newer = JSON.stringify({ version: 3, systemName: "Futuro", somethingNew: true }, null, 2) + "\n";
    fs.writeFileSync(settingsFile(home), newer);
    const store = new SettingsStore(resolvePaths(home));
    let thrown: unknown;
    try {
      store.save(SettingsSchema.parse({}));
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe("settings_newer");
    expect(fs.readFileSync(settingsFile(home), "utf8")).toBe(newer);
  });

  it("C6 the engine schema holds no UI preference", () => {
    for (const key of UI_PREFERENCE_KEYS) expect(Object.keys(SettingsSchema.shape), key).not.toContain(key);
    expect(UI_PREFERENCE_KEYS).toHaveLength(7);
    expect(SettingsSchema.parse({}).version).toBe(2);
  });

  it("C7 a file without version migrates as v1", () => {
    const home = tempHome();
    fs.writeFileSync(
      settingsFile(home),
      JSON.stringify({ themePreset: "mono", systemName: "Sem versão" }) + "\n",
    );
    engineOver(home);
    expect(readJson(prefsFile(home)).themePreset).toBe("mono");
    expect(readJson(settingsFile(home))).not.toHaveProperty("themePreset");
    expect(readJson(settingsFile(home)).version).toBe(2);
  });
});

async function server(home = tempHome()) {
  const ctx = new AppContext(home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token(), "content-type": "application/json" };
  return {
    home,
    ctx,
    app,
    headers,
    close: async () => {
      await app.close();
      ctx.close();
    },
  };
}

describe("S2 the preferences routes", () => {
  it("C8 a new home answers the default preferences", async () => {
    const s = await server();
    try {
      const res = await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().themePreset).toBe("hud-orange");
      expect(res.json().version).toBe(1);
    } finally {
      await s.close();
    }
  });

  it("C9 a partial preferences patch keeps the rest", async () => {
    const s = await server();
    try {
      const apps = [{ id: "a", name: "A", description: "", href: "/a" }];
      expect(
        (
          await s.app.inject({
            method: "PUT",
            url: "/api/ui-preferences",
            headers: s.headers,
            payload: { microApps: apps },
          })
        ).statusCode,
      ).toBe(200);
      const res = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest" },
      });
      expect(res.statusCode).toBe(200);
      const got = (
        await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers })
      ).json();
      expect(got.themePreset).toBe("forest");
      expect(got.microApps).toEqual(apps);
    } finally {
      await s.close();
    }
  });

  it("C10 an invalid preference is refused", async () => {
    const s = await server();
    try {
      const res = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "nope" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("validation");
    } finally {
      await s.close();
    }
  });

  it("C11 a stale layout write conflicts", async () => {
    const s = await server();
    try {
      const box = { x: 40, y: 40, w: 420, h: 300, z: 1, visible: true };
      const first = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { dashboardLayoutBase: {}, dashboardLayout: { now: box } },
      });
      expect(first.statusCode).toBe(200);
      const stale = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { dashboardLayoutBase: {}, dashboardLayout: { now: { ...box, x: 999 } } },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("layout_conflict");
      const got = (
        await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers })
      ).json();
      expect(got.dashboardLayout.now.x).toBe(40);
    } finally {
      await s.close();
    }
  });

  it("C12 the settings route refuses moved fields", async () => {
    const s = await server();
    try {
      // A real file to compare: a new home has none, and null === null proves nothing.
      const before = JSON.stringify({ version: 2, systemName: "Antes" }, null, 2) + "\n";
      fs.writeFileSync(settingsFile(s.home), before);
      const samples: Record<string, unknown> = {
        themePreset: "forest",
        microApps: [],
        dashboardLayout: {},
        spaces: {},
        activeSpace: "work",
        hud: { l: [], r: [] },
        brain: {},
      };
      for (const key of UI_PREFERENCE_KEYS) {
        const res = await s.app.inject({
          method: "PUT",
          url: "/api/settings",
          headers: s.headers,
          payload: { [key]: samples[key] },
        });
        expect(res.statusCode, key).toBe(400);
        expect(res.json().error.code, key).toBe("moved_to_ui_preferences");
      }
      expect(fs.readFileSync(settingsFile(s.home), "utf8")).toBe(before);
    } finally {
      await s.close();
    }
  });

  it("C13 settings no longer carry UI preferences", async () => {
    const s = await server();
    try {
      const body = (await s.app.inject({ method: "GET", url: "/api/settings", headers: s.headers })).json();
      const settings = (body.settings ?? body) as Record<string, unknown>;
      expect(settings).toHaveProperty("systemName");
      for (const key of UI_PREFERENCE_KEYS) expect(settings, key).not.toHaveProperty(key);
    } finally {
      await s.close();
    }
  });

  it("C14 preferences survive a backup and restore", async () => {
    const s = await server();
    try {
      await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest" },
      });
      const backup = await createBackup(s.ctx.paths, s.ctx.db);
      fs.writeFileSync(prefsFile(s.home), JSON.stringify({ version: 1, themePreset: "mono" }) + "\n");
      await s.close();
      restoreBackup(resolvePaths(s.home), backup.name);
      expect(readJson(prefsFile(s.home)).themePreset).toBe("forest");
    } catch (err) {
      await s.close().catch(() => undefined);
      throw err;
    }
  });
});

describe("S3 the UI reads preferences through their route", () => {
  const uiSrc = path.join(repoRoot, "apps", "command-centre", "src");
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });

  it("C16 the UI reads and writes preferences through their route", () => {
    // Reads are a compile error now (C29), any other spelling is refused at run time (C31) and raw
    // fetch is a lint error (C32). What this check still owns is the call shape, read from the
    // TypeScript AST so comments and look-alike names do not count: outside api.ts no
    // api.put/post/patch/del names the settings route, with a literal or a const bound to one.
    const settingsRoute = (text: string) => /^\/api\/settings(?:[?#/]|$)/.test(text);
    const offenders: string[] = [];
    for (const file of files(uiSrc)) {
      const rel = path.relative(uiSrc, file);
      if (rel === "api.ts") continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const consts = new Map<string, string>();
      const literal = (node: ts.Node | undefined): string | undefined => {
        if (!node) return undefined;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isTemplateExpression(node)) return node.head.text;
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literal(node.expression);
        if (ts.isIdentifier(node)) return consts.get(node.text);
        return undefined;
      };
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          const value = literal(node.initializer);
          if (value !== undefined) consts.set(node.name.text, value);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "api" &&
          ["put", "post", "patch", "del"].includes(node.expression.name.text)
        ) {
          const url = literal(node.arguments[0]);
          if (url !== undefined && settingsRoute(url))
            offenders.push(`${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
    const api = fs.readFileSync(path.join(uiSrc, "api.ts"), "utf8");
    expect(api).toMatch(
      /\buiPreferences:\s*\([^)]*\)\s*=>\s*request<UiPreferencesDoc>\("GET", "\/api\/ui-preferences"/,
    );
    expect(api).toMatch(
      /\bputUiPreferences:\s*\([^)]*\)\s*=>\s*request<UiPreferencesDoc>\("PUT", "\/api\/ui-preferences"/,
    );
    // Inside api.ts the one settings write is putSettings, typed by the patch that refuses the moved keys.
    expect(
      api.match(
        /\brequest\b[^(]*\(\s*["'`](PUT|POST|PATCH|DELETE)["'`]\s*,\s*["'`]\/api\/settings["'`?/]/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(api).toMatch(
      /\bputSettings:\s*<T = unknown>\(patch: SettingsPatch\)\s*=>\s*request<T>\("PUT", "\/api\/settings", patch\)/,
    );
    expect(api).toMatch(
      /export type SettingsPatch = Partial<SettingsDoc> & \{ \[K in MovedSettingKey\]\?: never \}/,
    );
  });

  it("C17 a saved preference refreshes the UI query", () => {
    const queries = fs.readFileSync(path.join(uiSrc, "queries.ts"), "utf8");
    expect(queries).toMatch(/uiPreferences: \["uiPreferences"\] as const/);
    expect(queries).toMatch(/"settings\.changed": \[[^\n]*\["uiPreferences"\]/);
  });
});

describe("Rodada 2 - gaps of the first verification", () => {
  it("C18 an old backup brings its own preferences back", async () => {
    // A home from before the feature, upgraded: its v1 file migrates once.
    const home = tempHome();
    const firstOriginal = writeV1(home, { themePreset: "mono", activeSpace: "home" });
    const s = await server(home);
    try {
      expect(fs.readFileSync(`${settingsFile(home)}.v1.bak`, "utf8")).toBe(firstOriginal);
      // The user moves on: other preferences, then a backup that is made old-format by hand
      // (settings.json v1 with the UI fields inside, no ui-preferences.json), as one taken before the feature.
      const put = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest", activeSpace: "work" },
      });
      expect(put.statusCode).toBe(200);
      const backup = await createBackup(s.ctx.paths, s.ctx.db);
      fs.rmSync(path.join(backup.path, "config", "ui-preferences.json"));
      const oldFile = JSON.stringify({
        version: 1,
        systemName: "Casa",
        themePreset: "jarvis",
        activeSpace: "focus",
        brain: { layout: "rings" },
      });
      fs.writeFileSync(path.join(backup.path, "config", "settings.json"), oldFile);
      await s.close();
      restoreBackup(resolvePaths(home), backup.name);
    } catch (err) {
      await s.close().catch(() => undefined);
      throw err;
    }
    // The next boot migrates the restored file: the backup's preferences, not the current ones.
    const after = await server(home);
    try {
      const got = (
        await after.app.inject({ method: "GET", url: "/api/ui-preferences", headers: after.headers })
      ).json();
      expect(got.themePreset).toBe("jarvis");
      expect(got.activeSpace).toBe("focus");
      expect(got.brain.layout).toBe("rings");
      const settings = readJson(settingsFile(home));
      expect(settings.version).toBe(2);
      for (const key of UI_PREFERENCE_KEYS) expect(settings, key).not.toHaveProperty(key);
      // The first migration's original stays: it exists nowhere else, while the
      // restored file is still in the backup directory.
      expect(fs.readFileSync(`${settingsFile(home)}.v1.bak`, "utf8")).toBe(firstOriginal);
    } finally {
      await after.close();
    }
  });

  it("C19 a saved preference is announced as settings.changed", async () => {
    const s = await server();
    const seen: string[] = [];
    const stop = events.subscribe((event) => {
      if (event.type === "settings.changed") seen.push(event.type);
    });
    try {
      const res = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest" },
      });
      expect(res.statusCode).toBe(200);
      expect(seen).toEqual(["settings.changed"]);
    } finally {
      stop();
      await s.close();
    }
  });

  it("C20 a v1 file with one invalid preference keeps the valid ones", () => {
    const home = tempHome();
    writeV1(home, { themePreset: "nope" });
    engineOver(home);
    const prefs = readJson(prefsFile(home));
    expect(prefs.themePreset).toBe("hud-orange");
    expect(prefs.microApps).toEqual([{ id: "pixel", name: "Pixel", description: "Draw", href: "/pixel" }]);
    expect((prefs.brain as { layout: string }).layout).toBe("rings");
    expect(prefs.hud).toEqual({ l: ["app:brain"], r: ["pulse"] });
    expect(prefs.activeSpace).toBe("focus");
    const settings = readJson(settingsFile(home));
    expect(settings.version).toBe(2);
    for (const key of UI_PREFERENCE_KEYS) expect(settings, key).not.toHaveProperty(key);
  });

  it("C21 a version below 1 migrates once like v1", () => {
    for (const version of [0, -3]) {
      const home = tempHome();
      writeV1(home, { version, themePreset: "ocean" });
      engineOver(home);
      expect(readJson(prefsFile(home)).themePreset, String(version)).toBe("ocean");
      const settings = readJson(settingsFile(home));
      expect(settings.version, String(version)).toBe(2);
      expect(settings, String(version)).not.toHaveProperty("themePreset");
      const before = fs.statSync(settingsFile(home)).mtimeMs;
      const text = fs.readFileSync(settingsFile(home), "utf8");
      new SettingsStore(resolvePaths(home)).load();
      engineOver(home);
      expect(fs.statSync(settingsFile(home)).mtimeMs, String(version)).toBe(before);
      expect(fs.readFileSync(settingsFile(home), "utf8"), String(version)).toBe(text);
    }
  });
});

describe("Rodada 3 - gaps of the second verification", () => {
  it("C32 the UI reaches the API only through the request guard", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const rules = ["no-restricted-globals", "no-restricted-properties"];
    // Every raw way out, written in a UI file, is a lint error.
    const raw = [
      'fetch("/api/settings", { method: "PUT" });',
      'window.fetch("/api/settings", { method: "PUT" });',
      'globalThis.fetch("/api/settings", { method: "PUT" });',
      'self.fetch("/api/settings", { method: "PUT" });',
      "new XMLHttpRequest();",
      'navigator.sendBeacon("/api/settings", "{}");',
    ];
    for (const line of raw) {
      const [result] = await eslint.lintText(`export const go = () => ${line}\n`, {
        filePath: path.join(repoRoot, "apps/command-centre/src/views/probe.ts"),
      });
      expect(
        result!.messages.filter((m) => rules.includes(m.ruleId ?? "")).map((m) => m.severity),
        line,
      ).toEqual([2]);
    }
    // api.ts itself may call fetch: it is where request() lives.
    const [inApi] = await eslint.lintText('export const go = () => fetch("/x");\n', {
      filePath: path.join(repoRoot, "apps/command-centre/src/api.ts"),
    });
    expect(inApi!.messages.filter((m) => rules.includes(m.ruleId ?? ""))).toEqual([]);
    // And the UI as it stands has none.
    const results = await eslint.lintFiles(["apps/command-centre/src/**/*.{ts,tsx}"]);
    const offenders = results.flatMap((r) =>
      r.messages
        .filter((m) => rules.includes(m.ruleId ?? ""))
        .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
    );
    expect(offenders).toEqual([]);
  }, 120_000);

  it("C35 a backup without either settings file leaves the live preferences alone", async () => {
    const s = await server();
    try {
      await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest" },
      });
      const saved = await s.app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: s.headers,
        payload: { systemName: "Casa" },
      });
      expect(saved.statusCode).toBe(200);
      const backup = await createBackup(s.ctx.paths, s.ctx.db);
      // A backup carrying neither settings.json nor ui-preferences.json (createBackup always
      // copies settings.json when it exists, so this is no pre-feature shape): nothing to restore.
      fs.rmSync(path.join(backup.path, "config", "settings.json"));
      fs.rmSync(path.join(backup.path, "config", "ui-preferences.json"));
      const live = JSON.stringify({ version: 1, themePreset: "mono", activeSpace: "focus" }) + "\n";
      fs.writeFileSync(prefsFile(s.home), live);
      const liveSettings = fs.readFileSync(settingsFile(s.home), "utf8");
      await s.close();
      restoreBackup(resolvePaths(s.home), backup.name);
      expect(fs.readFileSync(prefsFile(s.home), "utf8")).toBe(live);
      expect(fs.readFileSync(settingsFile(s.home), "utf8")).toBe(liveSettings);
    } catch (err) {
      await s.close().catch(() => undefined);
      throw err;
    }
  });
});
