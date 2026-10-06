// @vitest-environment jsdom
/**
 * UI preferences (.specs/features/preferencias-ui, C31): every UI request goes
 * through `request()` in api.ts, which refuses a settings write carrying one of
 * the seven keys that moved to the UI preferences, before anything is sent,
 * however the call is spelled. The rest of the traffic is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, MOVED_SETTING_KEYS } from "./api";

const fetchMock = vi.fn(
  async (_url: string, _init: RequestInit) =>
    ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response,
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("C31 a settings write carrying a moved key is refused before it leaves the page", () => {
  it("C31 the request guard refuses moved keys on the settings route in any spelling", async () => {
    expect([...MOVED_SETTING_KEYS].sort()).toEqual(
      ["activeSpace", "brain", "dashboardLayout", "hud", "microApps", "spaces", "themePreset"].sort(),
    );
    // The URL held in a variable, as a screen could write it (verification round 2, N4).
    const settingsUrl = "/api/settings";
    const urls = [
      settingsUrl,
      "/api/settings?fresh=1",
      "/api/settings/",
      "/api//settings",
      "http://127.0.0.1:7777/api/settings",
    ];
    const sends = [
      (url: string, body: object) => api.put(url, body),
      (url: string, body: object) => api.post(url, body),
      (url: string, body: object) => api.patch(url, body),
    ];
    for (const key of MOVED_SETTING_KEYS)
      for (const url of urls)
        for (const send of sends) {
          const body = { accentColor: "#ff7a1a", [key]: key === "themePreset" ? "jarvis" : {} };
          const err = await send(url, body).then(
            () => null,
            (e: unknown) => e,
          );
          expect(err, `${key} ${url}`).toBeInstanceOf(ApiError);
          expect((err as ApiError).code).toBe("moved_to_ui_preferences");
          expect((err as ApiError).message).toContain(`"${key}"`);
        }
    // Through the typed helper too, when a cast gets the key past the type.
    await expect(api.putSettings({ themePreset: "jarvis" } as never)).rejects.toThrow(/"themePreset"/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C31 the rest of the traffic still goes out", async () => {
    const settingsUrl = "/api/settings";
    await api.put(settingsUrl, { accentColor: "#ff7a1a" });
    await api.putSettings({ theme: "dark", setupCompleted: true });
    await api.put("/api/ui-preferences", { themePreset: "jarvis", brain: { layout: "rings" } });
    await api.putUiPreferences({ activeSpace: "focus" });
    await api.get(settingsUrl);
    await api.post("/api/settings-export", { themePreset: "jarvis" });
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "PUT /api/settings",
      "PUT /api/settings",
      "PUT /api/ui-preferences",
      "PUT /api/ui-preferences",
      "GET /api/settings",
      "POST /api/settings-export",
    ]);
  });
});
