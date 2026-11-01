// @vitest-environment jsdom
/**
 * Settings › Memória, "Pastas com acesso restrito" (.specs/features/cerebro-memoria-confiavel, C142; design.md
 * "Configurações › Memória"): after the indexed folders, one row per entry of `folderAccess` with, in order, the path,
 * the two levels by name, "Permissões…" and "Remover restrição"; "Nenhuma pasta restrita." with none. The network is the
 * work-context tests' `contexts/testnet` (the tab also draws the Contexts section).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { net, resetNet } from "../../contexts/testnet";
import { renderWith } from "../../contexts/testkit";
import { MemoryTab } from "./memory";
import type { SettingsShape } from "./shared";

vi.mock("../../api", async (importOriginal) =>
  (await import("../../contexts/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

const FIN = "/home/me/.mordomo/memory/notes/financeiro";
const OTHER = "/work/clientes";
const shape = {
  indexedFolders: [{ path: "/work", area: null, enabled: true }],
  areas: [],
  excludes: [],
  marketplace: { registries: [] },
  memory: { journalBudgetTokens: 1200, agentStance: "neutral", embeddings: { enabled: false } },
} as unknown as SettingsShape;
const draw = () =>
  renderWith(<MemoryTab s={shape} put={() => Promise.resolve({ ok: true as const })} />, { lang: "pt-BR" });
const block = async () =>
  (await screen.findByText("Pastas com acesso restrito")).closest(".field") as HTMLElement;

describe("C142 the restricted folders in Settings › Memória", () => {
  it("C142 after the indexed folders, one row per entry with, in order, the path, Agentes: <level>, Dispositivos: <level>, Permissões… and Remover restrição", async () => {
    net.settings = {
      ...net.settings,
      folderAccess: [
        { path: FIN, agents: "read", devices: "hide" },
        { path: OTHER, agents: "hide", devices: "write" },
      ],
    };
    draw();
    const el = await block();
    const indexed = screen.getByText("Pastas indexadas");
    expect(indexed.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = await waitFor(() => {
      const r = [...el.querySelectorAll(".folder-row")];
      expect(r).toHaveLength(2);
      return r;
    });
    expect([...rows[0]!.children].map((c) => c.textContent)).toEqual([
      FIN,
      "Agentes: Só ler",
      "Dispositivos: Esconder",
      "Permissões…",
      "Remover restrição",
    ]);
    expect([...rows[1]!.children].map((c) => c.textContent)).toEqual([
      OTHER,
      "Agentes: Esconder",
      "Dispositivos: Podem pedir escrita",
      "Permissões…",
      "Remover restrição",
    ]);
    expect(rows[0]!.children[0]!.className).toContain("mono");
    expect(el.textContent).not.toContain("Nenhuma pasta restrita.");
  });

  it("C142 Remover restrição of a row sends the list without that entry", async () => {
    net.settings = {
      ...net.settings,
      folderAccess: [
        { path: FIN, agents: "read", devices: "hide" },
        { path: OTHER, agents: "hide", devices: "write" },
      ],
    };
    const user = userEvent.setup();
    draw();
    const el = await block();
    await waitFor(() => expect(el.querySelectorAll(".folder-row")).toHaveLength(2));
    const first = el.querySelectorAll(".folder-row")[0]! as HTMLElement;
    await user.click(
      [...first.querySelectorAll("button")].find((b) => b.textContent === "Remover restrição")!,
    );
    await waitFor(() =>
      expect(net.calls.filter((c) => c.method === "PUT")).toEqual([
        {
          method: "PUT",
          url: "/api/settings",
          body: { folderAccess: [{ path: OTHER, agents: "hide", devices: "write" }] },
        },
      ]),
    );
  });

  it("C142 with folderAccess: [] it shows Nenhuma pasta restrita.", async () => {
    net.settings = { ...net.settings, folderAccess: [] };
    draw();
    const el = await block();
    await waitFor(() => expect(el.textContent).toContain("Nenhuma pasta restrita."));
    expect(el.querySelectorAll(".folder-row")).toHaveLength(0);
  });
});
