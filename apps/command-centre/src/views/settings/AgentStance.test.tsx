// @vitest-environment jsdom
/**
 * Settings › Memory › Agents' stance (.specs/features/cerebro-organizar, C40-C42; plan AC 31-32, amendment 10): the
 * group with its two options and the line about `mordomo sync`, what choosing one sends, where the group sits on the
 * tab, and a save that fails. The network is the work-context tests' `contexts/testnet` (the tab also draws the
 * Contexts section, which reads `GET /api/contexts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { api, ApiError } from "../../api";
import { dictionaries, type Lang } from "../../i18n";
import { installPage } from "../../ui/testkit";
import { net, resetNet } from "../../contexts/testnet";
import { renderWith } from "../../contexts/testkit";
import type { Put } from "../SettingsFields";
import { MemoryTab } from "./memory";
import type { SettingsShape } from "./shared";

vi.mock("../../api", async (importOriginal) =>
  (await import("../../contexts/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => {
  resetNet();
});

const NEW_KEYS = [
  "settings.stance.title",
  "settings.stance.neutral",
  "settings.stance.contest",
  "settings.stance.hint",
] as const;

function settings(stance: "neutral" | "contest-conflicts" = "neutral"): SettingsShape {
  return {
    indexedFolders: [{ path: "/work", area: null, enabled: true }],
    areas: ["Projetos"],
    excludes: [],
    marketplace: { registries: [] },
    memory: { journalBudgetTokens: 1200, agentStance: stance, embeddings: { enabled: false } },
  } as unknown as SettingsShape;
}

/** The tab's write as the Settings page makes it: `PUT /api/settings`, never rejecting. */
const put: Put = (patch) =>
  api.putSettings(patch).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, error: (err as Error).message }),
  );

function draw(lang: Lang, stance?: "neutral" | "contest-conflicts") {
  return renderWith(<MemoryTab s={settings(stance)} put={put} />, { lang });
}

const group = (name: string) => screen.getByRole("group", { name }) as HTMLFieldSetElement;
const radio = (g: HTMLElement, name: string) => within(g).getByRole("radio", { name }) as HTMLInputElement;
const writes = () => net.calls.filter((c) => c.method !== "GET");

describe("C40 the stance group", () => {
  it("C40 in pt-BR the group Postura dos agentes has the two options, the current one checked, a line naming mordomo sync, and choosing the other sends PUT /api/settings {memory:{agentStance}}; every new key has an English text", async () => {
    const user = userEvent.setup();
    draw("pt-BR");
    const g = group("Postura dos agentes");
    const radios = within(g).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual([
      "Neutra",
      "Contestar o que conflita com as metas",
    ]);
    expect(radio(g, "Neutra").checked).toBe(true);
    expect(radio(g, "Contestar o que conflita com as metas").checked).toBe(false);
    expect(g.textContent).toContain("mordomo sync");

    await user.click(radio(g, "Contestar o que conflita com as metas"));
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "PUT", url: "/api/settings", body: { memory: { agentStance: "contest-conflicts" } } },
      ]),
    );
    expect(radio(g, "Contestar o que conflita com as metas").checked).toBe(true);

    // The stored value draws its option checked.
    draw("pt-BR", "contest-conflicts");
    const again = screen.getAllByRole("group", { name: "Postura dos agentes" }).at(-1)!;
    expect(radio(again, "Contestar o que conflita com as metas").checked).toBe(true);

    for (const key of NEW_KEYS) {
      expect(dictionaries.en[key], key).toBeTruthy();
      expect(dictionaries["pt-BR"][key], key).toBeTruthy();
      expect(dictionaries.en[key], key).not.toBe(dictionaries["pt-BR"][key]);
    }
    expect(dictionaries.en["settings.stance.hint"]).toContain("mordomo sync");
  });
});

describe("C41 where the group sits", () => {
  it("C41 the group is the last block of the Memory tab, after the registries field, and the Contexts section still comes right after the indexed folders", async () => {
    draw("en");
    const g = group(dictionaries.en["settings.stance.title"]);
    const card = g.closest(".card")!;
    expect(card.lastElementChild).toBe(g);
    const registries = document.getElementById("st-registries")!;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(registries, g)).toBe(true);
    expect(g.previousElementSibling!.contains(registries)).toBe(true);

    const section = (await screen.findByText("No contexts yet.")).closest(".ctx-settings")!;
    const addFolder = document.getElementById("st-newfolder")!;
    const fields = [...card.querySelectorAll(":scope > .field, :scope > section")];
    const at = fields.indexOf(section);
    expect(at).toBeGreaterThan(0);
    expect(fields[at - 1]!.contains(addFolder)).toBe(true);
    expect(follows(section, document.getElementById("st-areas")!)).toBe(true);
  });
});

describe("C42 a save that fails", () => {
  it("C42 when PUT /api/settings answers 500 the group shows the error text beside an icon and the previous option stays checked", async () => {
    const user = userEvent.setup();
    net.answers.set("PUT /api/settings", () =>
      Promise.reject(new ApiError(500, "The settings could not be saved.", "internal")),
    );
    draw("en");
    const g = group("Agents' stance");
    await user.click(radio(g, "Contest what conflicts with the goals"));
    const alert = await within(g).findByRole("alert");
    expect(alert.textContent).toBe("The settings could not be saved.");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(alert.querySelector("svg")!.nextElementSibling!.textContent).toBe(
      "The settings could not be saved.",
    );
    expect(radio(g, "Neutral").checked).toBe(true);
    expect(radio(g, "Contest what conflicts with the goals").checked).toBe(false);
    expect(writes()).toEqual([
      { method: "PUT", url: "/api/settings", body: { memory: { agentStance: "contest-conflicts" } } },
    ]);
  });
});
