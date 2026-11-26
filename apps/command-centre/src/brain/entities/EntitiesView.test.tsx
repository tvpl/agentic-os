// @vitest-environment jsdom
/**
 * The view "Entidades" in rendered components (.specs/features/cerebro-entidades-resumos, C101, C103-C115, C117, C118;
 * design.md "Vista - Entidades", "Painel da entidade", "Seção - Sugestões por IA", "Confirmações e avisos", "Estados"):
 * the arrangement in the DOM and in the stylesheet (the browser measures it, `entidades.spec.ts` C101), the tabs and
 * the list, the search, the panel, each correction with its confirmation and its 8 s notice, the 409s, each state and
 * the AI suggestions card, over the routes as the API answers them. The interface reads pt-BR, so the claims' own words
 * are asserted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { CommandRegistry } from "../../commands/registry";
import { installPage } from "../../ui/testkit";
import { asked, resetNet } from "../notes/testnet";
import {
  NOW,
  NetError,
  before,
  card,
  detail,
  entity,
  kit,
  mention,
  mountEntities,
  net,
  on,
  only,
  panel,
  resetEntities,
  rows,
  sent,
  suggests,
  wrote,
} from "./testkit";

// The claims' local day and hour (L-050): set before the clock of the testkit is read.
vi.hoisted(() => {
  process.env.TZ = "America/Sao_Paulo";
});
vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetEntities();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

const CSS = readFileSync(join(__dirname, "entities.css"), "utf8");
/** The declarations of `selector`, inside the at-rule whose params are `media` (or outside any). */
function rule(selector: string, media?: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkRules((r) => {
    const listed = r.selector.split(",").map((x) => x.trim());
    const parent = r.parent;
    const at = parent?.type === "atrule" ? (parent as postcss.AtRule).params : undefined;
    if (listed.includes(selector) && at === media) r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}

const ANA = entity("perfil", "Ana Souza", 8, ["Ana", "A. Souza", "Aninha", "Souza"]);
const BRUNO = entity("perfil", "Bruno Lima", 1);
const ATLAS = entity("projeto", "Atlas", 3);
const CLIENTE = entity("tag", "Cliente-X", 2);
const SOUSA = entity("termo", "Ana Sousa", 2);
const BANCO = entity("termo", "Banco Central", 4);
const all = () => [ANA, BRUNO, ATLAS, CLIENTE, BANCO, SOUSA];

const ANA_FULL = detail(ANA, {
  home: { fileId: 1, path: "/m/pessoas/ana.md" },
  mentions: [
    mention(2, "reuniao.md", 12, "Falei com Ana Souza sobre o plano.", "Ana Souza"),
    mention(2, "reuniao.md", 14, "A Ana voltou.", "Ana"),
    mention(3, "visita.md", 3, "Visita da Ana Souza.", "Ana Souza"),
  ],
  related: [
    { key: ATLAS.key, name: "Atlas", kind: "projeto", shared: 3 },
    { key: BANCO.key, name: "Banco Central", kind: "termo", shared: 2 },
  ],
  duplicates: [{ key: SOUSA.key, name: "Ana Sousa", similarity: 0.82 }],
  corrections: [
    { id: 7, action: "merge", names: ["ana souza", "a sousa"], createdAt: NOW, undoneAt: null },
    { id: 8, action: "rename", names: ["ana souza"], name: "Ana Souza", createdAt: NOW, undoneAt: null },
  ],
});

/** The view with the six entities, `?key=` when given. */
async function up(search = "", registry?: CommandRegistry) {
  kit.entities = all();
  kit.details.set(ANA.key, ANA_FULL);
  const m = mountEntities({ search, ...(registry ? { registry } : {}) });
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  return m;
}
const tabNames = () => [...document.querySelectorAll('.ent-view [role="tab"]')].map((b) => b.textContent);
const panelUp = () => waitFor(() => expect(panel()!.querySelector(".ent-pname")).not.toBeNull());

describe("C101 the arrangement", () => {
  it("C101 the list column holds header, tabs, search, the AI suggestions card and the list, in that order; the panel holds header, MENÇÕES, APARECE JUNTO COM, TALVEZ SEJA A MESMA and Correções", async () => {
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    const col = document.querySelector(".ent-view .ent-listcol")!;
    const parts = [
      col.querySelector(".ent-head h1")!,
      col.querySelector(".ent-head .ent-small")!,
      col.querySelector('[role="tablist"]')!,
      col.querySelector(".ent-search input")!,
      col.querySelector(".ent-ai")!,
      col.querySelector(".ent-list")!,
    ];
    expect(parts.every(Boolean)).toBe(true);
    for (let i = 1; i < parts.length; i++) expect(before(parts[i - 1]!, parts[i]!)).toBe(true);
    const p = panel()!;
    const sections = [
      p.querySelector(".ent-phead")!,
      p.querySelector(".ent-mentions")!,
      p.querySelector(".ent-related")!,
      p.querySelector(".ent-dups")!,
      p.querySelector(".ent-corrections")!,
    ];
    expect(sections.every(Boolean)).toBe(true);
    for (let i = 1; i < sections.length; i++) expect(before(sections[i - 1]!, sections[i]!)).toBe(true);
    const head = p.querySelector(".ent-phead-row")!;
    expect([...head.children].map((c) => c.className.split(" ").at(-1))).toEqual([
      "ent-pname",
      "ent-chip",
      "ent-menu",
    ]);
    expect(before(col, p)).toBe(true);
  });

  it("C101 the stylesheet: two columns, the list 320px and the panel the rest; one column below 720px, where an open entity hides the list and Voltar shows", () => {
    expect(rule(".ent-view .ent-cols")["grid-template-columns"]).toBe("320px minmax(0, 1fr)");
    expect(rule(".ent-view .ent-cols", "(max-width: 719px)")["grid-template-columns"]).toBe("minmax(0, 1fr)");
    expect(rule(".ent-view[data-open] .ent-listcol", "(max-width: 719px)").display).toBe("none");
    expect(rule(".ent-view .ent-back").display).toBe("none");
    expect(rule(".ent-view .ent-back", "(max-width: 719px)").display).toBe("inline-flex");
  });

  it("C101 an open entity sets data-open on the root and the panel starts with Voltar, which clears ?key=", async () => {
    const { setLocation } = await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    expect(document.querySelector(".ent-view")!.hasAttribute("data-open")).toBe(true);
    const back = panel()!.querySelector(".ent-panel")!.firstElementChild as HTMLButtonElement;
    expect(back.textContent).toBe(" Voltar");
    expect(back.querySelector("svg.lucide-arrow-left")).not.toBeNull();
    fireEvent.click(back);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/entities", search: "" });
  });
});

describe("C103 the tabs and the list", () => {
  it("C103 the tabs Perfis (2), Projetos (1), Tags (1), Termos (2) with counts from the API", async () => {
    await up();
    await waitFor(() => expect(tabNames()).toEqual(["Perfis (2)", "Projetos (1)", "Tags (1)", "Termos (2)"]));
    expect(
      asked("/api/memory/entities").some((p) => p.get("kind") === "termo" && p.get("limit") === "1"),
    ).toBe(true);
  });

  it("C103 each row: the name, N notas or 1 nota at the right, up to three aliases joined by ' · ' below; ordered as the API; aria-current on the open one", async () => {
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    const [ana, bruno] = rows();
    expect(ana!.querySelector(".ent-name")!.textContent).toBe("Ana Souza");
    expect(ana!.querySelector(".ent-count")!.textContent).toBe("8 notas");
    expect(ana!.querySelector(".ent-aliases")!.textContent).toBe("Ana · A. Souza · Aninha");
    expect(bruno!.querySelector(".ent-count")!.textContent).toBe("1 nota");
    expect(bruno!.querySelector(".ent-aliases")).toBeNull();
    expect(rows().map((r) => r.querySelector(".ent-name")!.textContent)).toEqual(["Ana Souza", "Bruno Lima"]);
    expect(ana!.getAttribute("aria-current")).toBe("true");
    expect(bruno!.hasAttribute("aria-current")).toBe(false);
    expect(rule(".ent-view .ent-name")["font-size"]).toBe("var(--fs-3)");
    expect(rule(".ent-view .ent-count")["font-size"]).toBe("var(--fs-2)");
  });

  it("C103 Mostrar mais after 50 rows fetches the next 50 by offset", async () => {
    kit.entities = Array.from({ length: 120 }, (_, i) =>
      entity("termo", `Termo ${String(i).padStart(3, "0")}`, 2),
    );
    mountEntities();
    fireEvent.click(await screen.findByRole("tab", { name: "Termos (120)" }));
    await waitFor(() => expect(rows()).toHaveLength(50));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    await waitFor(() => expect(rows()).toHaveLength(100));
    expect(
      asked("/api/memory/entities")
        .filter((p) => p.get("kind") === "termo" && p.get("limit") === "50")
        .map((p) => p.get("offset")),
    ).toEqual(["0", "50"]);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    await waitFor(() => expect(rows()).toHaveLength(120));
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();
  });
});

describe("C104 the search and the keys", () => {
  it("C104 typing filters the open tab through q, one request per pause; Nada com “x”. on an empty result", async () => {
    await up();
    const user = userEvent.setup();
    const field = screen.getByPlaceholderText("Buscar por nome");
    const qs = () =>
      asked("/api/memory/entities")
        .filter((p) => p.get("limit") === "50" && p.has("q"))
        .map((p) => [p.get("kind"), p.get("q")]);
    await user.type(field, "bru");
    await waitFor(() => expect(qs()).toEqual([["perfil", "bru"]]));
    await waitFor(() =>
      expect(rows().map((r) => r.querySelector(".ent-name")!.textContent)).toEqual(["Bruno Lima"]),
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(qs()).toEqual([["perfil", "bru"]]);
    await user.clear(field);
    await user.type(field, "x");
    await waitFor(() => expect(screen.getByText("Nada com “x”.")).toBeTruthy());
    expect(qs()).toEqual([
      ["perfil", "bru"],
      ["perfil", "x"],
    ]);
  });

  it("C104 j and k move in the list and Enter opens; inside the field they are letters", async () => {
    const registry = new CommandRegistry();
    const { setLocation } = await up("", registry);
    const user = userEvent.setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("j");
    expect(document.activeElement).toBe(rows()[0]);
    await user.keyboard("j");
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard("k");
    expect(document.activeElement).toBe(rows()[0]);
    await user.keyboard("{Enter}");
    expect(setLocation).toHaveBeenCalledWith({
      pathname: "/brain/entities",
      search: `?key=${encodeURIComponent(ANA.key)}`,
    });
    const field = screen.getByPlaceholderText<HTMLInputElement>("Buscar por nome");
    await user.click(field);
    await user.keyboard("jk");
    expect(field.value).toBe("jk");
    expect(document.activeElement).toBe(field);
  });
});

describe("C105 opening an entity", () => {
  it("C105 choosing a row writes ?key= to the route; a mount with ?key= opens it", async () => {
    const { setLocation } = await up();
    fireEvent.click(rows()[0]!);
    expect(setLocation).toHaveBeenCalledWith({
      pathname: "/brain/entities",
      search: `?key=${encodeURIComponent(ANA.key)}`,
    });
    cleanup();
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    expect(panel()!.querySelector(".ent-pname")!.textContent).toBe("Ana Souza");
  });

  it("C105 the panel: the name at 15px, Também escrito como: …, and with home Abrir a nota (FileText) to /brain?sel=1", async () => {
    const { setLocation } = await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    const p = panel()!;
    expect(rule(".ent-view .ent-pname")["font-size"]).toBe("calc((var(--fs-4) + var(--fs-5)) / 2)");
    expect(rule(".ent-view .ent-pname")["font-weight"]).toBe("600");
    expect(p.querySelector(".ent-phead .ent-small")!.textContent).toBe(
      "Também escrito como: Ana · A. Souza · Aninha · Souza",
    );
    const home = within(p).getByRole("button", { name: "Abrir a nota" });
    expect(home.querySelector("svg.lucide-file-text")).not.toBeNull();
    fireEvent.click(home);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain", search: "?sel=1" });
  });

  it("C105 without home there is no Abrir a nota", async () => {
    kit.entities = all();
    kit.details.set(BRUNO.key, detail(BRUNO));
    mountEntities({ search: `?key=${encodeURIComponent(BRUNO.key)}` });
    await panelUp();
    expect(within(panel()!).queryByRole("button", { name: "Abrir a nota" })).toBeNull();
    expect(panel()!.querySelector(".ent-phead .ent-small")).toBeNull();
  });

  for (const [e, icon, text] of [
    [ANA, "user", "Perfil"],
    [ATLAS, "folder-kanban", "Projeto"],
    [CLIENTE, "hash", "Tag"],
    [BANCO, "quote", "Termo"],
  ] as const)
    it(`C105 the kind chip of a ${text}: ${icon} and "${text}"`, async () => {
      kit.entities = all();
      kit.details.set(e.key, detail(e));
      mountEntities({ search: `?key=${encodeURIComponent(e.key)}` });
      await panelUp();
      const chip = panel()!.querySelector(".ent-phead .ent-chip")!;
      expect(chip.textContent).toBe(text);
      expect(chip.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
    });
});

describe("C106 the mentions", () => {
  it("C106 grouped by file: each file name a button to /brain?sel=<fileId>, each line 'linha 12 · ' and the excerpt with the name in weight 600", async () => {
    const { setLocation } = await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    const sec = panel()!.querySelector(".ent-mentions")!;
    expect(sec.querySelector("h3")!.textContent).toBe("MENÇÕES (3)");
    const files = [...sec.querySelectorAll(".ent-files > li")];
    expect(files.map((f) => f.querySelector("button")!.textContent)).toEqual(["reuniao.md", "visita.md"]);
    expect([...files[0]!.querySelectorAll(".ent-mline")].map((l) => l.textContent)).toEqual([
      "linha 12 · Falei com Ana Souza sobre o plano.",
      "linha 14 · A Ana voltou.",
    ]);
    expect([...files[0]!.querySelectorAll(".ent-mline b")].map((b) => b.textContent)).toEqual([
      "Ana Souza",
      "Ana",
    ]);
    expect(rule(".ent-view .ent-excerpt b")["font-weight"]).toBe("600");
    fireEvent.click(files[1]!.querySelector("button")!);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain", search: "?sel=3" });
  });

  it("C106 at most 20 files, then Mostrar mais shows the next", async () => {
    kit.entities = all();
    kit.details.set(
      ANA.key,
      detail(ANA, {
        mentions: Array.from({ length: 25 }, (_, i) =>
          mention(10 + i, `n${10 + i}.md`, 1, "Ana Souza.", "Ana Souza"),
        ),
      }),
    );
    mountEntities({ search: `?key=${encodeURIComponent(ANA.key)}` });
    await panelUp();
    const files = () => panel()!.querySelectorAll(".ent-files > li");
    expect(files()).toHaveLength(20);
    fireEvent.click(within(panel()!).getByRole("button", { name: "Mostrar mais" }));
    expect(files()).toHaveLength(25);
  });
});

describe("C107 appears with and maybe the same", () => {
  it("C107 APARECE JUNTO COM: up to 10 chips with the name and the shared count, each opening that entity", async () => {
    kit.entities = all();
    kit.details.set(
      ANA.key,
      detail(ANA, {
        related: Array.from({ length: 12 }, (_, i) => ({
          key: `termo:t${i}`,
          name: `T${i}`,
          kind: "termo" as const,
          shared: 12 - i,
        })),
      }),
    );
    const { setLocation } = mountEntities({ search: `?key=${encodeURIComponent(ANA.key)}` });
    await panelUp();
    const sec = panel()!.querySelector(".ent-related")!;
    expect(sec.querySelector("h3")!.textContent).toBe("APARECE JUNTO COM");
    const chips = [...sec.querySelectorAll("button.btn.sm")];
    expect(chips).toHaveLength(10);
    expect(chips[0]!.textContent).toBe("T0 12");
    fireEvent.click(chips[1]!);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/entities", search: "?key=termo%3At1" });
  });

  it("C107 TALVEZ SEJA A MESMA only with duplicates: the name, parecida: 82%, Juntar (Merge) and São diferentes (Split)", async () => {
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    const sec = panel()!.querySelector(".ent-dups")!;
    expect(sec.querySelector("h3")!.textContent).toBe("TALVEZ SEJA A MESMA");
    const row = sec.querySelector(".ent-dup")!;
    expect(row.querySelector(".ent-name")!.textContent).toBe("Ana Sousa");
    expect(row.querySelector(".ent-count")!.textContent).toBe("parecida: 82%");
    const [merge, separate] = [...row.querySelectorAll("button")];
    expect([merge!.textContent, separate!.textContent]).toEqual([" Juntar", " São diferentes"]);
    expect(merge!.querySelector("svg.lucide-merge")).not.toBeNull();
    expect(separate!.querySelector("svg.lucide-split")).not.toBeNull();
    cleanup();
    kit.details.set(BRUNO.key, detail(BRUNO));
    mountEntities({ search: `?key=${encodeURIComponent(BRUNO.key)}` });
    await panelUp();
    expect(panel()!.querySelector(".ent-dups")).toBeNull();
    expect(panel()!.textContent).not.toContain("TALVEZ SEJA A MESMA");
  });
});

const notice = () => document.querySelector<HTMLElement>('.ent-view .ent-notice[role="status"]');
const dialog = () => screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));

describe("C108 Juntar", () => {
  it("C108 the confirmation Juntar Ana Souza e Ana Sousa? with the body and the button Juntar; confirming sends merge, then Juntadas. with Desfazer for 8 s, and Desfazer sends undo with the correction's id", async () => {
    on("correct", (body) => {
      const b = body as { action: string };
      if (b.action === "merge")
        return only({ action: "merge", key: ANA.key, other: SOUSA.key }, wrote(41, "merge"))(body);
      return only({ action: "undo", id: 41 }, wrote(41, "merge"))(body);
    });
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "Juntar" }));
    const d = await dialog();
    expect(within(d).getByText("Juntar Ana Souza e Ana Sousa?")).toBeTruthy();
    expect(
      within(d).getByText(
        "As menções das duas passam a ser de uma entidade só. Vale também nas próximas indexações.",
      ),
    ).toBeTruthy();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(within(d).getByRole("button", { name: "Juntar" }));
    // microtasks only: the notice's clock does not move until the test moves it
    for (let i = 0; i < 200 && !notice(); i++) await act(async () => void (await Promise.resolve()));
    expect(notice()?.textContent).toBe("Juntadas.Desfazer");
    expect(sent("correct")).toEqual([{ action: "merge", key: ANA.key, other: SOUSA.key }]);
    await act(async () => void vi.advanceTimersByTime(7_999));
    expect(notice()).not.toBeNull();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(notice()).toBeNull();
    vi.useRealTimers();
    // again, and this time Desfazer
    fireEvent.click(within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "Juntar" }));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Juntar" }));
    await waitFor(() => expect(notice()).not.toBeNull());
    fireEvent.click(within(notice()!).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(sent("correct").at(-1)).toEqual({ action: "undo", id: 41 }));
  });

  it("C108 cancelling sends nothing", async () => {
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "Juntar" }));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Cancelar" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent("correct")).toEqual([]);
    expect(notice()).toBeNull();
  });
});

describe("C109 São diferentes", () => {
  it("C109 sends separate with no confirmation, the row leaves TALVEZ SEJA A MESMA, and the notice reads Separadas.", async () => {
    on("correct", only({ action: "separate", key: ANA.key, other: SOUSA.key }, wrote(42, "separate")));
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(
      within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "São diferentes" }),
    );
    await waitFor(() => expect(notice()?.textContent).toBe("Separadas.Desfazer"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent("correct")).toEqual([{ action: "separate", key: ANA.key, other: SOUSA.key }]);
    expect(panel()!.querySelector(".ent-dups")).toBeNull();
  });
});

describe("C110 Não é uma entidade", () => {
  it("C110 the confirmation, then ignore, Tirada das entidades. with Desfazer; the row leaves with the item transition, the panel reads Escolha uma entidade… and the tabs and the list stay", async () => {
    on("correct", only({ action: "ignore", key: ANA.key }, wrote(43, "ignore")));
    const user = userEvent.setup();
    const m = await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    await user.click(within(panel()!).getByRole("button", { name: "Mais" }));
    await user.click(await screen.findByRole("menuitem", { name: "Não é uma entidade" }));
    const d = await dialog();
    expect(within(d).getByText("Tirar Ana Souza das entidades?")).toBeTruthy();
    expect(within(d).getByText("As notas não mudam. Você pode desfazer depois.")).toBeTruthy();
    await user.click(within(d).getByRole("button", { name: "Tirar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Tirada das entidades.Desfazer"));
    expect(sent("correct")).toEqual([{ action: "ignore", key: ANA.key }]);
    expect(m.setLocation).toHaveBeenLastCalledWith({ pathname: "/brain/entities", search: "" });
    // the row is marked leaving (the transition of the Revisões item), then goes
    const leaving = document.querySelector(".ent-view .ent-row[data-leaving]");
    expect(leaving?.querySelector(".ent-name")?.textContent).toBe("Ana Souza");
    await waitFor(() =>
      expect(rows().map((r) => r.querySelector(".ent-name")!.textContent)).toEqual(["Bruno Lima"]),
    );
    const anim = postcss
      .parse(CSS)
      .nodes.filter(
        (n): n is postcss.AtRule =>
          n.type === "atrule" && n.params === "(prefers-reduced-motion: no-preference)",
      )
      .flatMap((a) => a.nodes ?? [])
      .find((r) => (r as postcss.Rule).selector === ".ent-view .ent-row[data-leaving]") as postcss.Rule;
    expect(anim.toString()).toContain("ent-fold 150ms ease-out forwards");
    // as the route goes back to /brain/entities, the panel says pick one and the tabs and the list stay
    cleanup();
    kit.entities = [BRUNO];
    mountEntities();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(panel()!.textContent).toBe("Escolha uma entidade para ver onde ela aparece.");
    expect(document.querySelector('.ent-view [role="tablist"]')).not.toBeNull();
  });
});

describe("C111 Renomear", () => {
  it("C111 the name becomes a Field with the current name, Salvar and Cancelar; Escape cancels with nothing sent; Enter sends rename and the notice reads Renomeada.", async () => {
    on("correct", only({ action: "rename", key: ANA.key, name: "Ana S. Souza" }, wrote(44, "rename")));
    const user = userEvent.setup();
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    await user.click(within(panel()!).getByRole("button", { name: "Mais" }));
    await user.click(await screen.findByRole("menuitem", { name: "Renomear" }));
    const field = await within(panel()!).findByLabelText<HTMLInputElement>("Renomear");
    expect(field.closest(".field")).not.toBeNull();
    expect(field.value).toBe("Ana Souza");
    expect(within(panel()!).getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(within(panel()!).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard("{Escape}");
    expect(within(panel()!).queryByLabelText("Renomear")).toBeNull();
    expect(panel()!.querySelector(".ent-pname")!.textContent).toBe("Ana Souza");
    expect(sent("correct")).toEqual([]);
    await user.click(within(panel()!).getByRole("button", { name: "Mais" }));
    await user.click(await screen.findByRole("menuitem", { name: "Renomear" }));
    const again = await within(panel()!).findByLabelText<HTMLInputElement>("Renomear");
    await user.clear(again);
    await user.type(again, "Ana S. Souza{Enter}");
    await waitFor(() => expect(notice()?.textContent).toBe("Renomeada.Desfazer"));
    expect(sent("correct")).toEqual([{ action: "rename", key: ANA.key, name: "Ana S. Souza" }]);
  });
});

describe("C112 the 409s", () => {
  const band = () => panel()!.querySelector<HTMLElement>('.ent-band[role="alert"]');
  it("C112 correction_conflict on Juntar: Essas duas estão marcadas como diferentes. …; the panel stays", async () => {
    on("correct", () => Promise.reject(new NetError(409, "correction_conflict")));
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "Juntar" }));
    fireEvent.click(within(await dialog()).getByRole("button", { name: "Juntar" }));
    await waitFor(() =>
      expect(band()?.textContent).toBe(
        "Essas duas estão marcadas como diferentes. Desfaça essa correção antes de juntar.",
      ),
    );
    expect(panel()!.querySelector(".ent-pname")!.textContent).toBe("Ana Souza");
    expect(panel()!.querySelector(".ent-dups")).not.toBeNull();
    expect(notice()).toBeNull();
  });

  it("C112 correction_conflict on São diferentes: Essas duas estão marcadas como a mesma. …; the panel stays", async () => {
    on("correct", () => Promise.reject(new NetError(409, "correction_conflict")));
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(
      within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "São diferentes" }),
    );
    await waitFor(() =>
      expect(band()?.textContent).toBe(
        "Essas duas estão marcadas como a mesma. Desfaça essa correção antes de separar.",
      ),
    );
    expect(panel()!.querySelector(".ent-dup")).not.toBeNull();
  });

  it("C112 too_many_corrections: Há 2 000 correções ativas. …; the panel stays", async () => {
    on("correct", () => Promise.reject(new NetError(409, "too_many_corrections")));
    await up(`?key=${encodeURIComponent(ANA.key)}`);
    await panelUp();
    fireEvent.click(
      within(panel()!.querySelector(".ent-dup")!).getByRole("button", { name: "São diferentes" }),
    );
    await waitFor(() =>
      expect(band()?.textContent).toBe("Há 2 000 correções ativas. Desfaça alguma antes de fazer outra."),
    );
    expect(panel()!.querySelector(".ent-mentions")).not.toBeNull();
  });
});

describe("C113 the empty states", () => {
  it("C113 no entity in any tab: Users, Nenhuma entidade ainda. and the 12px explanation", async () => {
    mountEntities();
    const empty = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ent-view .ent-empty");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(empty.querySelector("svg.lucide-users")).not.toBeNull();
    expect(empty.querySelector(".ent-line")!.textContent).toBe(" Nenhuma entidade ainda.");
    const why = empty.querySelector(".ent-small")!;
    expect(why.textContent).toBe(
      "As entidades vêm das notas de perfil e de projeto (type: profile, type: project), das tags e dos nomes com iniciais maiúsculas que aparecem em pelo menos duas notas.",
    );
    expect([...why.querySelectorAll("code")].map((c) => c.textContent)).toEqual([
      "type: profile",
      "type: project",
    ]);
    expect(rule(".ent-view .ent-small")["font-size"]).toBe("var(--fs-2)");
  });

  it("C113 an empty tab: Nenhum projeto ainda.", async () => {
    kit.entities = [ANA];
    mountEntities();
    fireEvent.click(await screen.findByRole("tab", { name: "Projetos (0)" }));
    await waitFor(() =>
      expect(document.querySelector(".ent-view .ent-list .ent-state")?.textContent).toBe(
        "Nenhum projeto ainda.",
      ),
    );
  });

  it("C113 no entity open: Escolha uma entidade para ver onde ela aparece.", async () => {
    await up();
    expect(panel()!.textContent).toBe("Escolha uma entidade para ver onde ela aparece.");
  });
});

describe("C114 entities off", () => {
  it("C114 409 entities_disabled: the tabs and the list give way to Lock, Entidades desligadas. and Ligar (.btn.primary), which sends memory.entities.enabled true and nothing else; the header and the support line stay", async () => {
    kit.list = new NetError(409, "entities_disabled");
    kit.settings = {
      defaultProvider: "claude",
      memory: { entities: { enabled: false, llm: { enabled: true } } },
    };
    on("settings", only({ memory: { entities: { enabled: true, llm: { enabled: true } } } }, {}));
    mountEntities();
    const off = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ent-view .ent-off");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(off.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(off.querySelector(".ent-line")!.textContent).toBe(" Entidades desligadas.");
    expect(document.querySelector('.ent-view [role="tablist"]')).toBeNull();
    expect(document.querySelector(".ent-view .ent-list")).toBeNull();
    expect(document.querySelector(".ent-view .ent-head h1")!.textContent).toBe("Entidades");
    expect(document.querySelector(".ent-view .ent-head .ent-small")!.textContent).toBe(
      "Pessoas, projetos, tags e termos que as suas notas citam. Nada é escrito nas notas.",
    );
    const button = within(off).getByRole("button", { name: "Ligar" });
    expect(button.className).toBe("btn primary");
    await waitFor(() => expect(asked("/api/settings").length).toBeGreaterThan(0));
    fireEvent.click(button);
    await waitFor(() =>
      expect(sent("settings")).toEqual([{ memory: { entities: { enabled: true, llm: { enabled: true } } } }]),
    );
  });
});

describe("C115 loading and error", () => {
  it("C115 loading: Carregando… with a spinner in place of the list", async () => {
    kit.list = "pending";
    mountEntities();
    const state = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ent-view .ent-list .ent-state");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(state.textContent).toBe(" Carregando…");
    expect(state.querySelector(".spinner")).not.toBeNull();
  });

  it("C115 error: role=alert, Não deu para carregar as entidades., and Tentar de novo fetches again", async () => {
    kit.list = new NetError(500, "boom");
    mountEntities();
    const band = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ent-view .ent-list [role="alert"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(band.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(band.textContent).toBe("Não deu para carregar as entidades.Tentar de novo");
    const before = asked("/api/memory/entities").filter((p) => p.get("limit") === "50").length;
    kit.list = null;
    kit.entities = all();
    fireEvent.click(within(band).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(rows().length).toBe(2));
    expect(asked("/api/memory/entities").filter((p) => p.get("limit") === "50").length).toBe(before + 1);
  });
});

const ID = "1f0e2d3c-4b5a-4968-8776-655443322110";
const batch = (over: Record<string, unknown> = {}) => ({
  id: ID,
  status: "done",
  startedAt: NOW - 60_000,
  finishedAt: NOW - 30_000,
  ...over,
});
const sugg = (over: Record<string, unknown> = {}) => ({
  id: `${ID}:0`,
  kind: "perfil",
  name: "Carla Dias",
  aliases: ["Carla", "C. Dias"],
  evidence: [{ fileId: 5, path: `/m/notas/r2.md`, line: 12, excerpt: "A Carla Dias veio." }],
  state: "pending",
  ...over,
});
const stateLine = () => card()!.querySelector<HTMLElement>(".ent-ai-state .ent-line")!;

describe("C117 the AI suggestions card", () => {
  it("C117 Sugestões por IA with the on/off button (aria-pressed) that sends memory.entities.llm.enabled, and the 12px text of design.md", async () => {
    on("settings", only({ memory: { entities: { enabled: true, llm: { enabled: true } } } }, {}));
    await up();
    const c = card()!;
    expect(c.className).toBe("card ent-ai");
    expect(c.querySelector(".ent-ai-title")!.textContent).toBe("Sugestões por IA");
    const toggle = within(c).getByRole("button", { name: "Sugestões por IA" });
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(c.querySelector(":scope > .ent-small")!.textContent).toBe(
      "Uma execução do Claude lê até 20 notas que mudaram e propõe pessoas, projetos e termos. Nada vale sem você aceitar. Pastas escondidas dos agentes ficam de fora.",
    );
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(sent("settings")).toEqual([{ memory: { entities: { enabled: true, llm: { enabled: true } } } }]),
    );
  });

  it("C117 the last batch done: Último lote: 24/11, 3 sugestões (CircleCheck)", async () => {
    suggests({
      items: [sugg(), sugg({ id: `${ID}:1` }), sugg({ id: `${ID}:2` })],
      lastBatch: batch(),
    } as never);
    await up();
    await waitFor(() => expect(stateLine().textContent).toBe("Último lote: 24/11, 3 sugestões"));
    expect(stateLine().querySelector("svg.lucide-circle-check, svg.lucide-check-circle")).not.toBeNull();
  });

  it("C117 a batch open: Lendo 20 notas… (Loader) with Cancelar, which cancels the run; Pedir sugestões agora disabled", async () => {
    suggests({ items: [], lastBatch: batch({ status: "running", finishedAt: undefined }) } as never);
    kit.runs.set(ID, {
      run: {
        id: ID,
        request: {
          kind: "skill",
          inputs: { files: Array.from({ length: 20 }, (_, i) => `/m/n${i}.md`).join("\n") },
        },
      },
      events: [],
    });
    on(`POST /api/runs/${ID}/cancel`, () => Promise.resolve({ cancelled: true }));
    await up();
    await waitFor(() => expect(stateLine().textContent).toBe("Lendo 20 notas…Cancelar"));
    expect(stateLine().querySelector("svg.lucide-loader")).not.toBeNull();
    expect(
      within(card()!).getByRole<HTMLButtonElement>("button", { name: "Pedir sugestões agora" }).disabled,
    ).toBe(true);
    fireEvent.click(within(stateLine()).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(sent(`POST /api/runs/${ID}/cancel`)).toHaveLength(1));
  });

  it("C117 a refused batch: O último lote não foi aceito: <motivo> (AlertTriangle)", async () => {
    suggests({ items: [], lastBatch: batch({ reason: "entities.json is not JSON" }) } as never);
    await up();
    await waitFor(() =>
      expect(stateLine().textContent).toBe("O último lote não foi aceito: entities.json is not JSON"),
    );
    expect(stateLine().querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
  });

  it("C117 no batch ever: Nenhum lote ainda.", async () => {
    await up();
    await waitFor(() => expect(stateLine().textContent).toBe("Nenhum lote ainda."));
  });

  it("C117 with the extraction on: Próximo lote a partir de 25/11, 09:59.; off, no such line", async () => {
    kit.settings = {
      defaultProvider: "claude",
      memory: { entities: { enabled: true, llm: { enabled: true } } },
    };
    suggests({ items: [], lastBatch: batch(), nextBatchAt: NOW + 24 * 3_600_000 - 60_000 } as never);
    await up();
    await waitFor(() => expect(card()!.textContent).toContain("Próximo lote a partir de 25/11, 09:59."));
    cleanup();
    kit.settings = {
      defaultProvider: "claude",
      memory: { entities: { enabled: true, llm: { enabled: false } } },
    };
    await up();
    await waitFor(() => expect(stateLine().textContent).toBe("Último lote: 24/11, 0 sugestões"));
    expect(card()!.textContent).not.toContain("Próximo lote");
  });

  it("C117 Pedir sugestões agora sends the POST; a 409 nothing_to_read shows Nenhuma nota mudou desde o último lote.", async () => {
    let calls = 0;
    on("suggest", () => {
      calls++;
      return Promise.reject(new NetError(409, "nothing_to_read"));
    });
    await up();
    fireEvent.click(within(card()!).getByRole("button", { name: "Pedir sugestões agora" }));
    await waitFor(() => expect(stateLine().textContent).toBe("Nenhuma nota mudou desde o último lote."));
    expect(calls).toBe(1);
    expect(
      net.calls.filter((c) => c.method === "POST" && c.url === "/api/memory/entities/suggestions"),
    ).toHaveLength(1);
  });
});

describe("C137 the card's toggle, both ways", () => {
  /** The settings route as the server keeps it: the PUT's `memory` is what the next GET answers. */
  const keep = () =>
    on("settings", async (body) => {
      kit.settings = { ...kit.settings, memory: (body as { memory: unknown }).memory };
      return {};
    });
  const toggle = () => within(card()!).getByRole("button", { name: "Sugestões por IA" });

  it("C137 with memory.entities.llm.enabled false a press sends true, aria-pressed follows, and nothing else in the body changes", async () => {
    keep();
    await up();
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("true"));
    expect(sent("settings")).toEqual([{ memory: { entities: { enabled: true, llm: { enabled: true } } } }]);
  });

  it("C137 with it true a press sends false, aria-pressed follows, and nothing else in the body changes", async () => {
    keep();
    kit.settings = {
      defaultProvider: "claude",
      memory: { entities: { enabled: true, llm: { enabled: true } } },
    };
    await up();
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("false"));
    expect(sent("settings")).toEqual([{ memory: { entities: { enabled: true, llm: { enabled: false } } } }]);
  });

  it("C137 three presses in a row send true, false, true", async () => {
    keep();
    await up();
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("false"));
    for (const [i, want] of ["true", "false", "true"].entries()) {
      fireEvent.click(toggle());
      await waitFor(() => expect(sent("settings")).toHaveLength(i + 1));
      await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe(want));
    }
    expect(
      sent("settings").map(
        (b) => (b as { memory: { entities: { llm: { enabled: boolean } } } }).memory.entities.llm.enabled,
      ),
    ).toEqual([true, false, true]);
  });
});

describe("C118 the Sugestões fold", () => {
  it("C118 open, only with suggestions: each item with the kind chip, the name, também: … or Juntar com <nome>, and each evidence line with the file as a link to /brain?sel=", async () => {
    kit.details.set(ANA.key, ANA_FULL);
    suggests({
      items: [
        sugg(),
        sugg({ id: `${ID}:1`, kind: "termo", name: "Ana Sousa", aliases: [], mergeWith: ANA.key }),
      ],
      lastBatch: batch(),
    } as never);
    const { setLocation } = await up();
    const fold = await waitFor(() => {
      const el = card()!.querySelector<HTMLElement>(".notes-fold");
      expect(el).not.toBeNull();
      return el!;
    });
    const head = fold.querySelector(".notes-fold-head button")!;
    expect(head.textContent).toBe("Sugestões (2)");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const [first, second] = [...fold.querySelectorAll(".ent-sugg")];
    expect(first!.querySelector(".ent-chip")!.textContent).toBe("Perfil");
    expect(first!.querySelector(".ent-chip svg.lucide-user")).not.toBeNull();
    expect(first!.querySelector(".ent-sname")!.textContent).toBe("Carla Dias");
    expect(first!.querySelector(".ent-sugg-main > .ent-small")!.textContent).toBe("também: Carla · C. Dias");
    const ev = first!.querySelector(".ent-mline")!;
    expect(ev.textContent).toBe("r2.md · linha 12 · A Carla Dias veio.");
    expect(ev.querySelector("b")!.textContent).toBe("Carla Dias");
    fireEvent.click(within(ev as HTMLElement).getByRole("button", { name: "r2.md" }));
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain", search: "?sel=5" });
    await waitFor(() => expect(second!.textContent).toContain("Juntar com Ana Souza"));
    expect(second!.querySelector(".ent-sugg-main > .ent-line .ent-chip")!.textContent).toBe("Termo");
    const target = [...second!.querySelectorAll(".ent-chip")].at(-1)!;
    expect(target.textContent).toBe("Perfil");
    const accept = within(first as HTMLElement).getByRole("button", { name: "Aceitar" });
    expect(accept.className).toBe("btn sm primary");
    expect(accept.querySelector("svg.lucide-check")).not.toBeNull();
    expect(
      within(first as HTMLElement)
        .getByRole("button", { name: "Recusar" })
        .querySelector("svg.lucide-x"),
    ).not.toBeNull();
  });

  it("C118 Aceitar sends accept and Recusar sends reject, neither asks for confirmation, each shows its notice with Desfazer", async () => {
    suggests({
      items: [sugg(), sugg({ id: `${ID}:1`, name: "Davi Reis", aliases: [] })],
      lastBatch: batch(),
    } as never);
    on("correct", (body) => {
      const b = body as { action: string };
      return b.action === "accept"
        ? only({ action: "accept", suggestion: `${ID}:0` }, wrote(50, "add"))(body)
        : b.action === "reject"
          ? only({ action: "reject", suggestion: `${ID}:1` }, wrote(51, "reject"))(body)
          : only({ action: "undo", id: 51 }, wrote(51, "reject"))(body);
    });
    await up();
    const items = await waitFor(() => {
      const els = card()!.querySelectorAll<HTMLElement>(".ent-sugg");
      expect(els).toHaveLength(2);
      return [...els];
    });
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Aceitar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Aceita.Desfazer"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Recusada.Desfazer"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(notice()!).getByRole("button", { name: "Desfazer" }));
    await waitFor(() =>
      expect(sent("correct")).toEqual([
        { action: "accept", suggestion: `${ID}:0` },
        { action: "reject", suggestion: `${ID}:1` },
        { action: "undo", id: 51 },
      ]),
    );
  });

  it("C118 after a batch with nothing new: Nenhuma sugestão nova. in place of the fold", async () => {
    suggests({ items: [], lastBatch: batch() } as never);
    await up();
    await waitFor(() => expect(card()!.textContent).toContain("Nenhuma sugestão nova."));
    expect(card()!.querySelector(".notes-fold")).toBeNull();
  });
});
