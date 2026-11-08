// @vitest-environment jsdom
/**
 * The commands of the work contexts (.specs/features/cerebro-contextos, C39; comandos-atalhos design): "Switch
 * context" and "Whole brain" are commands of the registry, `global`, in the palette, and the contexts add no keyboard
 * listener of their own: the allowlist of the listeners outside the registry stays as it is.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type * as ApiModule from "../api";
import { dictionaries } from "../i18n";
import { installPage } from "../ui/testkit";
import { OUTSIDE_THE_REGISTRY, OUTSIDE_THE_REGISTRY_DEPS } from "../commands/listenersAllowlist";
import { ContextSelector, SWITCH_CONTEXT_ID, WHOLE_BRAIN_ID } from "./ContextSelector";
import { CONTEXT, net, resetNet } from "./testnet";
import { renderWith } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

describe("C39 Switch context and Whole brain are global commands of the palette", () => {
  it("C39 the registry holds both, scope global, in the palette, with the design's titles in both languages", async () => {
    const { registry } = renderWith(createElement(ContextSelector, { variant: "frame" }));
    await waitFor(() => expect(registry.list().length).toBeGreaterThanOrEqual(2));
    const byId = (id: string) => registry.list().find((c) => c.id === id);
    for (const [id, title] of [
      [SWITCH_CONTEXT_ID, "context.cmd.switch"],
      [WHOLE_BRAIN_ID, "context.all"],
    ] as const) {
      const command = byId(id);
      expect(command, id).toBeDefined();
      expect(command!.scope).toBe("global");
      expect(command!.palette).toBe(true);
      expect(command!.title).toBe(title);
      // A command of the palette, not a key: nothing new to listen for.
      expect(command!.keys ?? []).toEqual([]);
    }
    expect(dictionaries.en["context.cmd.switch"]).toBe("Switch context");
    expect(dictionaries["pt-BR"]["context.cmd.switch"]).toBe("Trocar de contexto");
    expect(dictionaries.en["context.all"]).toBe("Whole brain");
    expect(dictionaries["pt-BR"]["context.all"]).toBe("Todo o cérebro");
  });

  it("C39 Whole brain sets activeContext to null, and Switch context opens the selector's menu", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    net.prefs.activeContext = "alfa";
    const { registry } = renderWith(createElement(ContextSelector, { variant: "frame" }));
    await screen.findByRole("button", { name: /Alfa/ });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() =>
      registry
        .list()
        .find((c) => c.id === SWITCH_CONTEXT_ID)!
        .run(),
    );
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: /Alfa/ }).getAttribute("aria-checked")).toBe("true");
    act(() =>
      registry
        .list()
        .find((c) => c.id === WHOLE_BRAIN_ID)!
        .run(),
    );
    await waitFor(() =>
      expect(net.calls).toContainEqual({
        method: "PUT",
        url: "/api/ui-preferences",
        body: { activeContext: null },
      }),
    );
  });

  it("C39 the keyboard-listener allowlist does not grow, and no file of the contexts listens for a key", () => {
    // The lists as comandos-atalhos and primitivas left them (C16 of each).
    expect(Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY).map(([f, [n]]) => [f, n]))).toEqual({
      "commands/registry.ts": 1,
      "ui/layers.ts": 1,
      "nucleo/pending/FocusMode.tsx": 1,
      "onboarding/useTourSurface.ts": 1,
      "runs/Replay.tsx": 1,
      "nucleo/scenes/SkillsScene.tsx": 1,
      "nucleo/scenes/BrainScene.tsx": 2,
      "nucleo/scenes/RunsScene.tsx": 1,
      "nucleo/scenes/RoutinesScene.tsx": 1,
      "nucleo/NucleoScene.tsx": 1,
    });
    expect(Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY_DEPS).map(([p, [n]]) => [p, n]))).toEqual({
      "@radix-ui/react-dismissable-layer": 1,
      "@radix-ui/react-menu": 1,
    });
    const here = __dirname;
    const sources = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\.|testnet|testkit/.test(f));
    expect(sources).toEqual(
      expect.arrayContaining([
        "ContextSelector.tsx",
        "ContextChip.tsx",
        "NewContextDialog.tsx",
        "ContextsSettings.tsx",
      ]),
    );
    for (const file of sources) {
      const text = readFileSync(join(here, file), "utf8");
      expect(/addEventListener\(\s*["'`]key/.test(text), file).toBe(false);
      expect(/onKey(Down|Up|Press)\b/.test(text), file).toBe(false);
      expect(/\.onkey(down|up|press)\b/i.test(text), file).toBe(false);
    }
  });
});
