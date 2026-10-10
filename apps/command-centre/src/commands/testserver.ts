/**
 * The server the commands tests talk to, as a table. No JSX and no import of
 * the app: the `vi.mock("../api")` factories load this file, and it must not
 * pull the mocked module back in.
 */
import { vi } from "vitest";
import type * as ApiModule from "../api";

/* ---- the server: a table ------------------------------------------------------ */
export const PREFS = {
  version: 1,
  shell: "nucleo",
  themePreset: "hud-orange",
  microApps: [],
  dashboardLayout: {},
  spaces: {},
  activeSpace: "work",
  hud: { l: [], r: [] },
  brain: {},
};
export const SKILL = {
  slug: "demo",
  name: "Demo",
  description: "a demo skill",
  enabled: true,
  mode: "read_only",
  inputs: [],
  triggers: [],
  providers: ["claude"],
  recommendedModel: null,
  recommendedEffort: "default",
  skillFile: "demo/SKILL.md",
  body: "",
  favorite: false,
  version: "1",
  guardrails: [],
  successCriteria: [],
  resources: [],
  bodyLineCount: 0,
  thick: false,
};
export const RUN = {
  id: "r1",
  createdAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 30_000,
  origin: "skill",
  provider: "claude",
  model: null,
  effort: "default",
  status: "completed",
  exitCode: 0,
  durationMs: 30_000,
  cwd: null,
  promptSummary: "a demo run",
  request: { mode: "read_only", prompt: "do the demo" },
  skillSlug: "demo",
  routineId: null,
  maxCostUsd: null,
  parentRunId: null,
  sessionId: null,
  pid: null,
  error: null,
  failure: null,
  artifacts: [],
  filesChanged: [],
  attempts: 1,
  timeoutMs: null,
  permissionProfile: null,
  startedBy: null,
  usage: null,
};
export const PROVIDERS = [
  {
    id: "claude",
    displayName: "Claude",
    enabled: true,
    isDefault: true,
    health: { installed: true, ok: true, authenticated: true },
  },
];
export const server = {
  prefs: { ...PREFS } as Record<string, unknown>,
  /** What `GET /api/doctor` answers: pending unless a test says otherwise. */
  doctor: (): Promise<unknown> => new Promise(() => undefined),
};

export function mockApi(mod: typeof ApiModule) {
  const answer = (url: string): Promise<unknown> => {
    if (url === "/api/ui-preferences") return Promise.resolve(structuredClone(server.prefs));
    if (url === "/api/doctor?audit=0") return server.doctor();
    if (url.startsWith("/api/providers")) return Promise.resolve(structuredClone(PROVIDERS));
    if (url === "/api/runs/r1") return Promise.resolve({ run: structuredClone(RUN), events: [] });
    if (url.startsWith("/api/runs")) return Promise.resolve([structuredClone(RUN)]);
    if (url === "/api/skills/demo") return Promise.resolve(structuredClone(SKILL));
    if (url.startsWith("/api/skills")) return Promise.resolve([structuredClone(SKILL)]);
    if (
      url.startsWith("/api/approvals") ||
      url.startsWith("/api/routines") ||
      url.startsWith("/api/connectors")
    )
      return Promise.resolve([]);
    if (url.startsWith("/api/notifications")) return Promise.resolve({ items: [] });
    if (url.startsWith("/api/settings")) return Promise.resolve({ indexedFolders: [] });
    return new Promise(() => undefined);
  };
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => answer(url)),
      post: vi.fn(() => new Promise(() => undefined)),
      put: vi.fn(() => new Promise(() => undefined)),
      patch: vi.fn(() => new Promise(() => undefined)),
      del: vi.fn(() => new Promise(() => undefined)),
      putSettings: vi.fn(() => new Promise(() => undefined)),
      putUiPreferences: vi.fn(() => new Promise(() => undefined)),
      uiPreferences: vi.fn(() => answer("/api/ui-preferences")),
      streamEvents: vi.fn(() => () => undefined),
      streamRun: vi.fn(() => () => undefined),
    },
  };
}
