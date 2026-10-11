import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderRegistry } from "@mordomo/core";
import { MordomoEngine, UiPreferencesStore, ensureDirs, resolvePaths } from "@mordomo/core/internal";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";

/** Which shell mounts (.specs/features/moldura-app, S3): the preference, its default, its migration. */

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-moldura-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  return home;
}

const prefsFile = (home: string) => path.join(resolvePaths(home).config, "ui-preferences.json");

async function server(home = tempHome()) {
  const ctx = new AppContext(home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token(), "content-type": "application/json" };
  return {
    app,
    headers,
    close: async () => {
      await app.close();
      ctx.close();
    },
  };
}

describe("S3 the shell preference", () => {
  it("C15 the shell preference round-trips", async () => {
    const s = await server();
    try {
      const fresh = await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().shell).toBe("moldura");

      const put = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { shell: "nucleo" },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().shell).toBe("nucleo");
      const after = await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers });
      expect(after.json().shell).toBe("nucleo");

      const bad = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { shell: "x" },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe("validation");
      // The refused write changed nothing.
      const still = await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers });
      expect(still.json().shell).toBe("nucleo");
    } finally {
      await s.close();
    }
  });

  it("C16 an unknown shell on disk falls back", () => {
    const home = tempHome();
    fs.writeFileSync(prefsFile(home), JSON.stringify({ version: 1, shell: "outro", themePreset: "ocean" }));
    const prefs = new UiPreferencesStore(resolvePaths(home)).load();
    expect(prefs.shell).toBe("moldura");
    // Only the unreadable field degrades: the rest of the file is kept.
    expect(prefs.themePreset).toBe("ocean");
  });

  it("C17 migrated homes keep the Núcleo", () => {
    const migrated = tempHome();
    fs.writeFileSync(
      resolvePaths(migrated).settingsFile,
      JSON.stringify({ version: 1, systemName: "Casa", themePreset: "jarvis" }, null, 2) + "\n",
    );
    const fresh = tempHome();
    for (const home of [migrated, fresh]) {
      new MordomoEngine({
        home,
        seedDir: null,
        providers: new ProviderRegistry().register(claudeManifest, createClaudeAdapter),
      }).close();
    }
    const written = JSON.parse(fs.readFileSync(prefsFile(migrated), "utf8")) as Record<string, unknown>;
    expect(written.shell).toBe("nucleo");
    expect(written.themePreset).toBe("jarvis");
    expect(new UiPreferencesStore(resolvePaths(migrated)).load().shell).toBe("nucleo");

    expect(fs.existsSync(prefsFile(fresh))).toBe(false);
    expect(new UiPreferencesStore(resolvePaths(fresh)).load().shell).toBe("moldura");
  });

  it("C25 a preferences file written before the frame reads as the Núcleo", async () => {
    // Whoever has a ui-preferences.json without `shell` ran a version that had only the Núcleo.
    const home = tempHome();
    fs.writeFileSync(prefsFile(home), JSON.stringify({ version: 1, themePreset: "ocean" }));
    const store = new UiPreferencesStore(resolvePaths(home));
    const prefs = store.load();
    expect(prefs.shell).toBe("nucleo");
    expect(prefs.themePreset).toBe("ocean");

    // Over the route, and a write of something else pins the choice into the file.
    const s = await server(home);
    try {
      const get = await s.app.inject({ method: "GET", url: "/api/ui-preferences", headers: s.headers });
      expect(get.json().shell).toBe("nucleo");
      const put = await s.app.inject({
        method: "PUT",
        url: "/api/ui-preferences",
        headers: s.headers,
        payload: { themePreset: "forest" },
      });
      expect(put.json().shell).toBe("nucleo");
      expect(JSON.parse(fs.readFileSync(prefsFile(home), "utf8")).shell).toBe("nucleo");
    } finally {
      await s.close();
    }

    // The other origins are unchanged: an unknown value and a missing file read as the frame,
    // and a file that is not an object reads as the defaults.
    const unknown = tempHome();
    fs.writeFileSync(prefsFile(unknown), JSON.stringify({ version: 1, shell: "outro" }));
    expect(new UiPreferencesStore(resolvePaths(unknown)).load().shell).toBe("moldura");
    const absent = tempHome();
    expect(new UiPreferencesStore(resolvePaths(absent)).load().shell).toBe("moldura");
    const broken = tempHome();
    fs.writeFileSync(prefsFile(broken), "[1, 2");
    expect(new UiPreferencesStore(resolvePaths(broken)).load().shell).toBe("moldura");
    const array = tempHome();
    fs.writeFileSync(prefsFile(array), "[]");
    expect(new UiPreferencesStore(resolvePaths(array)).load().shell).toBe("moldura");
  });

  it("C26 a saved file always carries the shell, so a missing key means pre-frame", () => {
    const home = tempHome();
    const store = new UiPreferencesStore(resolvePaths(home));
    store.update({ themePreset: "mono" });
    expect(JSON.parse(fs.readFileSync(prefsFile(home), "utf8")).shell).toBe("moldura");
    expect(new UiPreferencesStore(resolvePaths(home)).load().shell).toBe("moldura");
  });
});
