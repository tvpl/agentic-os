// @vitest-environment jsdom
/**
 * Pluggable providers (.specs/features/provedores-plugaveis, C26-C27): every
 * screen that shows a login command or offers a provider reads it from the
 * snapshots of `GET /api/providers`, never from a list of the built-ins. The
 * proof is a third-party `acme` snapshot: it only shows up if the screen reads
 * the snapshot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type * as ApiModule from "../api";
import type { ProviderSnapshot, SettingsDoc, Skill } from "../api";
import { ProviderGate } from "../components/ProviderGate";
import Console from "../desktop/console/Console";
import Setup from "../views/Setup";
import { ProvidersTab } from "../views/settings/providers";
import type { SettingsShape } from "../views/settings/shared";
import type { SaveResult } from "../views/SettingsFields";
import FocusMode from "../nucleo/pending/FocusMode";
import SkillList from "../views/Skills/SkillList";
import SkillsTools from "../nucleo/scenes/SkillsSceneTools";
import { RoutineModal } from "../views/Routines";

/** A third-party provider that is installed but not signed in. */
function acmeSnapshot(over: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    id: "acme",
    displayName: "Acme Agent",
    installHint: "npm install -g acme-cli",
    loginCommand: "acme login",
    enabled: true,
    isDefault: true,
    defaultModel: null,
    defaultEffort: "default",
    health: { ok: false, installed: true, authenticated: false, version: "1.0.0", detail: "login required" },
    ...over,
  };
}

const settingsDoc = {
  providers: {
    claude: { enabled: false, defaultModel: null, defaultEffort: "default", binaryPath: null },
  },
  indexedFolders: [],
} as unknown as SettingsDoc;

const hoisted = vi.hoisted(() => ({ snapshots: [] as unknown[], puts: [] as unknown[] }));

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const never = () => new Promise(() => undefined);
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => {
        if (url.startsWith("/api/providers")) return Promise.resolve(hoisted.snapshots);
        if (url === "/api/settings") return Promise.resolve(settingsDoc);
        if (url === "/api/connectors") return Promise.resolve([]);
        return never();
      }),
      post: vi.fn(() => Promise.resolve({})),
      put: vi.fn(never),
      putUiPreferences: vi.fn(() => Promise.resolve({})),
      putSettings: vi.fn((patch: unknown) => {
        hoisted.puts.push(patch);
        return Promise.resolve({});
      }),
    },
  };
});

function renderWith(snapshots: ProviderSnapshot[], ui: ReactNode) {
  hoisted.snapshots = snapshots;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  hoisted.snapshots = [];
  hoisted.puts = [];
});

describe("C26 every login command reader takes loginCommand from the snapshot", () => {
  it("ProviderGate", async () => {
    renderWith([acmeSnapshot()], <ProviderGate />);
    const row = await screen.findByTestId("gate-provider-acme");
    expect(within(row).getByText("acme login")).toBeTruthy();
  });

  it("the console pre-flight", async () => {
    renderWith(
      [acmeSnapshot()],
      <Console busy={false} deckOpen={false} onToggleDeck={() => undefined} stacked={false} />,
    );
    const field = (await screen.findAllByRole("textbox"))[0]!;
    // The provider snapshot has to be in before the line sends.
    await waitFor(() => {
      fireEvent.change(field, { target: { value: "hi" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(screen.getByTestId("console-preflight")).toBeTruthy();
    });
    expect(within(screen.getByTestId("console-preflight")).getByText("acme login")).toBeTruthy();
  });

  it("Setup", async () => {
    renderWith([acmeSnapshot()], <Setup onDone={() => undefined} />);
    const row = await screen.findByTestId("setup-provider-acme");
    expect(within(row).getByText("acme login")).toBeTruthy();
  });

  it("Settings › Providers", async () => {
    const s = { providers: {} } as unknown as SettingsShape;
    renderWith(
      [acmeSnapshot()],
      <ProvidersTab s={s} put={vi.fn((): Promise<SaveResult> => Promise.resolve({ ok: true }))} />,
    );
    expect(await screen.findByText("acme login")).toBeTruthy();
  });

  it("the focus mode", async () => {
    const snapshot = acmeSnapshot();
    renderWith(
      [snapshot],
      <FocusMode
        pending={{
          items: [
            {
              id: "provider:acme",
              kind: "provider",
              level: "fix",
              at: Date.now(),
              provider: { snapshot, problem: "login_required" },
            },
          ],
          count: 1,
          level: "fix",
          silence: () => undefined,
        }}
        onClose={() => undefined}
      />,
    );
    expect(await screen.findByText("acme login")).toBeTruthy();
  });
});

describe("C27 every provider list is the snapshots", () => {
  it("SkillList offers acme in its provider filter", async () => {
    // One skill (on claude) so the filter bar shows; acme can only come from the snapshot.
    const skill = {
      slug: "say-hi",
      name: "Say hi",
      description: "Says hi.",
      triggers: [],
      inputs: [],
      providers: ["claude"],
      recommendedModel: null,
      recommendedEffort: "default",
      mode: "read_only",
      enabled: true,
      version: "1",
      guardrails: [],
      successCriteria: [],
      resources: [],
      bodyLineCount: 1,
      thick: false,
    } as unknown as Skill;
    renderWith([acmeSnapshot()], <SkillList skills={[skill]} />);
    expect(await screen.findByText("acme")).toBeTruthy();
  });

  it("SkillsSceneTools offers acme as a chip", async () => {
    renderWith(
      [acmeSnapshot()],
      <SkillsTools
        query=""
        onQuery={() => undefined}
        onQueryKey={() => undefined}
        inputRef={{ current: null }}
        filters={{ mode: "all", provider: "all", favOnly: false, showPaused: false }}
        onFilters={() => undefined}
        pausedCount={0}
        shown={0}
        total={0}
        page={0}
        pages={1}
        onPage={() => undefined}
        onMarket={() => undefined}
        onExport={() => undefined}
        onNew={() => undefined}
      />,
    );
    expect(await screen.findByRole("button", { name: "acme" })).toBeTruthy();
  });

  it("the routine editor offers acme", async () => {
    renderWith(
      [acmeSnapshot()],
      <RoutineModal
        routine={null}
        skills={[]}
        allowWebhooks={false}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const select = (await screen.findByLabelText(/Provider|Provedor/)) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.value)).toContain("acme"));
  });

  it("Setup offers acme and saves its choice for it", async () => {
    renderWith(
      [acmeSnapshot({ health: { ...acmeSnapshot().health, authenticated: true, ok: true } })],
      <Setup onDone={() => undefined} />,
    );
    await screen.findByTestId("setup-provider-acme");
    const select = document.getElementById("su-default") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["acme"]);
    const next = () => screen.getByRole("button", { name: /^(Next|Avançar)$/ });
    for (let step = 0; step < 4; step++) fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: /Finish setup|Concluir setup/ }));
    await waitFor(() => expect(hoisted.puts).toHaveLength(1));
    const saved = hoisted.puts[0] as {
      defaultProvider: string;
      providers: Record<string, { enabled: boolean }>;
    };
    expect(saved.providers.acme?.enabled).toBe(true);
    expect(saved.defaultProvider).toBe("acme");
  });
});
