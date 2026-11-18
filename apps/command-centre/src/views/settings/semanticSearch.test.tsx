// @vitest-environment jsdom
/**
 * Settings › Memória › "Busca por significado" (.specs/features/cerebro-busca-significado, S7, C109-C127 and C131;
 * design.md "Bloco - Busca por significado"): the block's five parts in order, the header, the provider radio group,
 * each provider's detail, the model list with its states and actions, the license dialog, the progress and its
 * polling, the two confirmations, the reranker block, the index line, loading and failure, the help link and the
 * keyboard. The network is `./semanticSearchNet`, which answers only the requests each test allows (L-052); the copy
 * is asserted in pt-BR, by value, as design.md's "Texto" table writes it.
 */
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { api } from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { MemoryTab } from "./memory";
import { SemanticSearch } from "./SemanticSearch";
import type { SettingsShape } from "./shared";
import { EMB, GEMMA, QWEN, RECALL, RERANKER, net, resetNet, status } from "./semanticSearchNet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./semanticSearchNet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => resetNet());

type Json = Record<string, unknown>;
const ENDPOINT = "http://127.0.0.1:11434/v1/embeddings";
const HTTP = { ...EMB, provider: "http", endpoint: ENDPOINT, model: "nomic-embed-text", dimensions: 768 };
const LOCAL = { ...EMB, provider: "local", local: { model: GEMMA.id } };

/** The Settings screen's write: `PUT /api/settings`, then the tab draws the settings the route answered. */
function Harness({ tab }: { tab: boolean }) {
  const [s, setS] = useState(() => structuredClone(net.settings) as unknown as SettingsShape);
  const put = (patch: unknown) =>
    api.putSettings<{ settings: SettingsShape }>(patch as never).then(
      (res) => {
        setS(res.settings);
        return { ok: true as const };
      },
      (err: Error) => ({ ok: false as const, error: err.message }),
    );
  return tab ? (
    <div className="tab-panel">
      <MemoryTab s={s} put={put} />
    </div>
  ) : (
    <SemanticSearch s={s} put={put} />
  );
}

function draw(embeddings: Json = EMB, opts: { tab?: boolean; recall?: Json; extra?: Json } = {}) {
  net.settings = {
    indexedFolders: [],
    areas: [],
    excludes: [],
    marketplace: { registries: [] },
    ...opts.extra,
    memory: { journalBudgetTokens: 1200, agentStance: "neutral", embeddings, recall: opts.recall ?? RECALL },
  };
  return renderWith(<Harness tab={opts.tab ?? false} />, { lang: "pt-BR" });
}
const block = () => document.querySelector<HTMLElement>("section.ss")!;
const detail = () => block().querySelector<HTMLElement>(".ss-detail")!;
const radios = () => within(block()).getAllByRole("radio");
const radio = (name: string) => radios().find((r) => r.textContent!.includes(name))!;
const icon = (el: Element) => [...el.querySelectorAll("svg")].map((s) => s.getAttribute("class"));
const has = (el: Element, lucide: string) => icon(el).some((c) => c?.split(" ").includes(`lucide-${lucide}`));
const writes = () => net.calls.filter((c) => c.method !== "GET");
const gets = (url: string) => net.calls.filter((c) => c.method === "GET" && c.url === url).length;
const row = (id: string) => document.querySelector<HTMLElement>(`.ss-model[data-model="${id}"]`)!;
const rowButton = (id: string, name: string) =>
  [...row(id).querySelectorAll("button")].find((b) => b.textContent === name) ?? null;
const models = (...list: Json[]) => (net.catalog = { ...net.catalog, models: list });
const allowPut = (embeddings: Json) => net.puts.push({ memory: { embeddings } });
const loaded = () => waitFor(() => expect(document.querySelector(".ss-model")).not.toBeNull());

describe("C109 the block's place and its five parts, in order", () => {
  it("C109 in Settings › Memória the second .card.stack, after the indexed folders' card", async () => {
    draw(EMB, { tab: true });
    const cards = [...document.querySelectorAll(".tab-panel > .card.stack")];
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getAllByText("Pastas indexadas").length).toBeGreaterThan(0);
    expect(cards[1]).toBe(block());
    expect(within(block()).getByRole("heading").textContent).toBe("Busca por significado");
  });

  it("C109 with the search on: header, radio group, detail, index line, footer link, in that order", async () => {
    net.status = status({ enabled: true, provider: "hash-v1:256", sections: 3 });
    draw({ ...EMB, enabled: true });
    await waitFor(() =>
      expect(block().querySelector(":scope > [role=status]")!.textContent).toContain("3 seções"),
    );
    const parts = [...block().children];
    expect(parts).toHaveLength(5);
    expect(parts[0]!.querySelector("h3")!.textContent).toBe("Busca por significado");
    expect(parts[1]!.getAttribute("role")).toBe("radiogroup");
    expect(parts[2]!.className).toBe("ss-detail");
    expect(parts[3]!.getAttribute("role")).toBe("status");
    expect(parts[4]!.querySelector("a")!.textContent).toBe("Como instalar o Ollama");
  });

  it("C109 with the search off the index line is absent: header, radio group, detail, footer link", () => {
    draw(EMB);
    const parts = [...block().children];
    expect(parts).toHaveLength(4);
    expect(parts.map((p) => p.getAttribute("role") ?? p.className)).toEqual([
      "ss-top",
      "radiogroup",
      "ss-detail",
      "ss-s",
    ]);
    expect(block().querySelector(":scope > [role=status]")).toBeNull();
  });
});

describe("C110 the header", () => {
  it("C110 off: the title, then Desligada with CircleDashed (tone-muted), then the aria-pressed button; the line below", () => {
    draw(EMB);
    const head = block().querySelector(".ss-head")!;
    const [title, state, button] = [...head.children];
    expect(title!.tagName).toBe("H3");
    expect(title!.textContent).toBe("Busca por significado");
    expect(title!.classList.contains("ss-b")).toBe(true);
    expect(state!.textContent).toBe("Desligada");
    expect(state!.classList.contains("tone-muted")).toBe(true);
    expect(has(state!, "circle-dashed")).toBe(true);
    expect(button!.tagName).toBe("BUTTON");
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    const line = head.nextElementSibling!;
    expect(line.textContent).toBe(
      "Acha a nota que responde mesmo quando ela não usa as mesmas palavras da pergunta.",
    );
    expect(line.classList.contains("ss-s")).toBe(true);
  });

  it("C110 on: Ligada with CircleCheck (tone-ok) and the button pressed", () => {
    draw({ ...EMB, enabled: true });
    const state = block().querySelector(".ss-head .ss-state")!;
    expect(state.textContent).toBe("Ligada");
    expect(state.classList.contains("tone-ok")).toBe(true);
    expect(has(state, "circle-check")).toBe(true);
    expect(block().querySelector(".ss-head button")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("C110 the button sends PUT /api/settings with memory.embeddings = the current object with enabled flipped", async () => {
    allowPut({ ...HTTP, enabled: true });
    draw(HTTP);
    await userEvent.setup().click(block().querySelector(".ss-head button")!);
    await waitFor(() => expect(block().querySelector(".ss-head .ss-state")!.textContent).toBe("Ligada"));
    expect(writes()).toEqual([
      { method: "PUT", url: "/api/settings", body: { memory: { embeddings: { ...HTTP, enabled: true } } } },
    ]);
  });
});

describe("C111 the provider options", () => {
  it("C111 a radiogroup of three radios in order, each title (ss-b) with its one line (ss-s); the chosen one CircleDot and Em uso", () => {
    draw(EMB);
    const group = within(block()).getByRole("radiogroup");
    const all = within(group).getAllByRole("radio");
    expect(all.map((r) => r.querySelector(".ss-b")!.textContent)).toEqual([
      "Palavras e vetor simples",
      "Servidor seu",
      "Modelo neste computador",
    ]);
    expect(all.map((r) => r.querySelector(".ss-col > .ss-s")!.textContent)).toEqual([
      "Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia, não sinônimos.",
      "Ollama ou outro servidor com o formato OpenAI de embeddings.",
      "Baixa um modelo e roda aqui, sem enviar nada para fora.",
    ]);
    expect(all.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(has(all[0]!, "circle-dot")).toBe(true);
    expect(all[0]!.textContent).toContain("Em uso");
    for (const r of all.slice(1)) {
      expect(has(r, "circle")).toBe(true);
      expect(has(r, "circle-dot")).toBe(false);
      expect(r.textContent).not.toContain("Em uso");
    }
  });

  it("C111 choosing another with no ready index sends PUT with memory.embeddings.provider set and opens no dialog", async () => {
    allowPut({ ...EMB, provider: "http" });
    draw(EMB);
    await userEvent.setup().click(radio("Servidor seu"));
    await waitFor(() => expect(radio("Servidor seu").getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes()).toEqual([
      { method: "PUT", url: "/api/settings", body: { memory: { embeddings: { ...EMB, provider: "http" } } } },
    ]);
  });
});

describe("C112 no runtime for the local model", () => {
  it("C112 Modelo neste computador is aria-disabled with Lock and the reason below its description; activating it sends nothing", async () => {
    net.catalog = { ...net.catalog, platform: { ok: false, reason: "platform_unsupported" } };
    draw(EMB);
    await waitFor(() => expect(radio("Modelo neste computador").getAttribute("aria-disabled")).toBe("true"));
    const local = radio("Modelo neste computador");
    expect(has(local, "lock")).toBe(true);
    expect([...local.querySelectorAll(".ss-col > span")].map((s) => s.textContent)).toEqual([
      "Modelo neste computador",
      "Baixa um modelo e roda aqui, sem enviar nada para fora.",
      "Este computador não tem o runtime do modelo local (macOS Intel). Use um servidor seu.",
    ]);
    const user = userEvent.setup();
    await user.click(local);
    local.focus();
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(writes()).toEqual([]);
    expect(local.getAttribute("aria-checked")).toBe("false");
  });
});

describe("C113 the detail of Palavras e vetor simples", () => {
  it("C113 is only the sentence", () => {
    draw(EMB);
    expect(detail().children).toHaveLength(1);
    expect(detail().textContent).toBe(
      "Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia, não sinônimos.",
    );
  });
});

describe("C114 the detail of Servidor seu", () => {
  it("C114 in order the fields Endereço (mono), Modelo, Dimensões (number), Variável da chave (mono), the checkbox with AlertTriangle and the warning (tone-warn) beside it, then Testar conexão", () => {
    draw(HTTP);
    const labels = [...detail().querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).toEqual([
      "Endereço",
      "Modelo",
      "Dimensões",
      "Variável da chave",
      "Permitir servidor fora deste computador",
    ]);
    const input = (label: string) => within(detail()).getByLabelText(label) as HTMLInputElement;
    expect(input("Endereço").classList.contains("mono")).toBe(true);
    expect(input("Modelo").classList.contains("mono")).toBe(false);
    expect(input("Dimensões").type).toBe("number");
    expect(input("Variável da chave").classList.contains("mono")).toBe(true);
    expect(input("Permitir servidor fora deste computador").type).toBe("checkbox");
    const remote = detail().querySelector(".ss-remote")!;
    const [box, warn] = [...remote.children];
    expect(box!.textContent).toBe("Permitir servidor fora deste computador");
    expect(warn!.textContent!.trim()).toBe("Seus textos e suas perguntas serão enviados para este endereço.");
    expect(warn!.classList.contains("tone-warn")).toBe(true);
    expect(has(warn!, "triangle-alert")).toBe(true);
    const button = within(detail()).getByRole("button", { name: "Testar conexão" });
    expect(remote.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      input("Variável da chave").compareDocumentPosition(remote) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  const cases: Array<[string, string, Json]> = [
    ["Endereço", "http://127.0.0.1:8080/v1/embeddings", { endpoint: "http://127.0.0.1:8080/v1/embeddings" }],
    ["Modelo", "bge-m3", { model: "bge-m3" }],
    ["Dimensões", "1024", { dimensions: 1024 }],
    ["Variável da chave", "OLLAMA_KEY", { apiKeyEnv: "OLLAMA_KEY" }],
  ];
  it.each(cases)(
    "C114 %s saves memory.embeddings with that field changed, and only that body",
    async (label, value, change) => {
      allowPut({ ...HTTP, ...change });
      draw(HTTP);
      const user = userEvent.setup();
      const input = within(detail()).getByLabelText(label);
      await user.clear(input);
      await user.type(input, `${value}{Enter}`);
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toEqual({
        method: "PUT",
        url: "/api/settings",
        body: { memory: { embeddings: { ...HTTP, ...change } } },
      });
    },
  );

  it("C114 the checkbox saves sendRemote", async () => {
    allowPut({ ...HTTP, sendRemote: true });
    draw(HTTP);
    await userEvent.setup().click(within(detail()).getByLabelText("Permitir servidor fora deste computador"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ memory: { embeddings: { ...HTTP, sendRemote: true } } });
  });
});

describe("C115 Testar conexão", () => {
  const press = async (answer: () => Promise<unknown>) => {
    net.posts.push({ body: { action: "test" }, answer });
    draw(HTTP);
    await userEvent.setup().click(within(detail()).getByRole("button", { name: "Testar conexão" }));
    return within(detail()).getByRole("button", { name: "Testar conexão" }).nextElementSibling as HTMLElement;
  };

  it("C115 sends {action: test} exactly, shows Testando… with a spinner, then OK: 768 dimensões, 143 ms with CircleCheck (tone-ok) right after the button", async () => {
    let settle!: (v: unknown) => void;
    const after = await press(() => new Promise((r) => (settle = r)));
    expect(writes()).toEqual([{ method: "POST", url: "/api/memory/embedder", body: { action: "test" } }]);
    await waitFor(() => expect(after.textContent!.trim()).toBe("Testando…"));
    expect(after.querySelector(".spinner")).not.toBeNull();
    await act(async () => settle({ state: "absent", test: { ok: true, dimensions: 768, ms: 143 } }));
    await waitFor(() => expect(after.textContent!.trim()).toBe("OK: 768 dimensões, 143 ms"));
    const ok = after.querySelector(".tone-ok")!;
    expect(has(ok, "circle-check")).toBe(true);
  });

  const kinds: Array<[string, string]> = [
    ["timeout", "Falhou: timeout"],
    ["status", "Falhou: status"],
    ["dimension", "Falhou: dimensão"],
    ["malformed", "Falhou: resposta inválida"],
    ["network", "Falhou: rede"],
    ["local_crashed", "Falhou: o modelo parou"],
  ];
  it.each(kinds)("C115 kind %s reads %s with AlertTriangle (tone-warn)", async (kind, text) => {
    const after = await press(() => Promise.resolve({ state: "absent", test: { ok: false, kind } }));
    await waitFor(() => expect(after.textContent!.trim()).toBe(text));
    const warn = after.querySelector(".tone-warn")!;
    expect(has(warn, "triangle-alert")).toBe(true);
  });
});

describe("C116 the model list", () => {
  it("C116 one row per embedder in catalog order, the reranker's row in the reranker block; line 1 name (ss-b), Recomendado only on Gemma, the kind; line 2 (ss-s)", async () => {
    draw(LOCAL);
    await loaded();
    const list = detail().querySelector(".ss-models")!;
    expect([...list.querySelectorAll(".ss-model")].map((r) => r.getAttribute("data-model"))).toEqual([
      GEMMA.id,
      QWEN.id,
    ]);
    const rerankBlock = within(detail()).getByText("Releitura mais cuidadosa").parentElement!;
    expect(rerankBlock.querySelector(`.ss-model[data-model="${RERANKER.id}"]`)).not.toBeNull();
    const line1 = (id: string) => [...row(id).querySelector(".ss-col > .ss-row")!.children];
    expect(line1(GEMMA.id).map((c) => c.textContent)).toEqual([
      "EmbeddingGemma 300m",
      "Recomendado",
      "Embedding",
    ]);
    expect(line1(GEMMA.id)[0]!.classList.contains("ss-b")).toBe(true);
    expect(line1(QWEN.id).map((c) => c.textContent)).toEqual(["Qwen3-Embedding 0.6B", "Embedding"]);
    expect(line1(RERANKER.id).map((c) => c.textContent)).toEqual(["Qwen3-Reranker 0.6B", "Reranker"]);
    const line2 = row(GEMMA.id).querySelector(".ss-col > .ss-row")!.nextElementSibling!;
    expect(line2.textContent).toBe("209 MB · 768 dimensões · licença Gemma");
    expect(line2.classList.contains("ss-s")).toBe(true);
  });

  it("C116 a list of one embedder draws one row (L-050)", async () => {
    models(GEMMA);
    draw(LOCAL);
    await loaded();
    expect(detail().querySelectorAll(".ss-models")[0]!.querySelectorAll(".ss-model")).toHaveLength(1);
  });

  const states: Array<[string, Json, string, string, string | null]> = [
    ["absent", {}, "Não baixado", "circle-dashed", null],
    [
      "downloading",
      { progress: { done: 120_000_000, total: 209_000_000 } },
      "Baixando: 120 de 209 MB",
      "download",
      null,
    ],
    ["ready", {}, "Pronto", "circle-check", "tone-ok"],
    [
      "failed",
      { reason: "checksum" },
      "Falhou: soma de verificação diferente",
      "triangle-alert",
      "tone-warn",
    ],
  ];
  it.each(states)(
    "C116 state %s reads its text with its icon, after line 2",
    async (state, extra, text, glyph, tone) => {
      models({ ...GEMMA, state, ...extra }, QWEN, RERANKER);
      draw(LOCAL);
      await loaded();
      const shown = row(GEMMA.id).querySelector(".ss-side > .ss-row")!;
      await waitFor(() => expect(shown.textContent).toBe(text));
      expect(has(shown, glyph)).toBe(true);
      if (tone) expect(shown.classList.contains(tone)).toBe(true);
      const line2 = row(GEMMA.id).querySelector(".ss-col > .ss-s")!;
      expect(line2.compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );
});

describe("C117 the actions per state", () => {
  const cls = (b: HTMLButtonElement | null) => [...b!.classList].filter((c) => c !== "sm");

  it("C117 Baixar is .btn.primary with Download on Não baixado; Tentar de novo is .btn.primary with Download on Falhou", async () => {
    models(GEMMA, { ...QWEN, state: "failed", reason: "checksum" }, RERANKER);
    draw(LOCAL);
    await loaded();
    const baixar = rowButton(GEMMA.id, "Baixar");
    expect(cls(baixar)).toEqual(["btn", "primary"]);
    expect(has(baixar!, "download")).toBe(true);
    const again = rowButton(QWEN.id, "Tentar de novo");
    expect(cls(again)).toEqual(["btn", "primary"]);
    expect(has(again!, "download")).toBe(true);
    expect(rowButton(QWEN.id, "Baixar")).toBeNull();
  });

  it("C117 Cancelar is .btn with X on Baixando and sends {action: cancel, id}", async () => {
    models({ ...GEMMA, state: "downloading", progress: { done: 1, total: 209_000_000 } }, QWEN, RERANKER);
    net.posts.push({
      body: { action: "cancel", id: GEMMA.id },
      answer: () => Promise.resolve({ state: "absent" }),
    });
    draw(LOCAL);
    await loaded();
    const cancel = rowButton(GEMMA.id, "Cancelar");
    expect(cls(cancel)).toEqual(["btn", "secondary"]);
    expect(has(cancel!, "x")).toBe(true);
    await userEvent.setup().click(cancel!);
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "POST", url: "/api/memory/embedder", body: { action: "cancel", id: GEMMA.id } },
      ]),
    );
  });

  it("C117 on Pronto: Remover .btn.ghost with Trash2, disabled with the title on the active model, where Usar este modelo is absent", async () => {
    models({ ...GEMMA, state: "ready" }, { ...QWEN, state: "ready" }, RERANKER);
    net.catalog = { ...net.catalog, active: GEMMA.id };
    draw(LOCAL);
    await loaded();
    const remove = rowButton(GEMMA.id, "Remover");
    expect(cls(remove)).toEqual(["btn", "ghost"]);
    expect(has(remove!, "trash2")).toBe(true);
    expect(remove!.disabled).toBe(true);
    expect(remove!.title).toBe("Em uso: troque o provedor antes de remover.");
    expect(rowButton(GEMMA.id, "Usar este modelo")).toBeNull();
    const other = rowButton(QWEN.id, "Remover");
    expect(other!.disabled).toBe(false);
    expect(other!.title).toBe("");
  });

  it("C117 Usar este modelo is .btn with Check on a Pronto model that is not active, and saves memory.embeddings.local.model", async () => {
    models({ ...GEMMA, state: "ready" }, { ...QWEN, state: "ready" }, RERANKER);
    net.catalog = { ...net.catalog, active: GEMMA.id };
    allowPut({ ...LOCAL, local: { model: QWEN.id } });
    draw(LOCAL);
    await loaded();
    const use = rowButton(QWEN.id, "Usar este modelo");
    expect(cls(use)).toEqual(["btn", "secondary"]);
    expect(has(use!, "check")).toBe(true);
    await userEvent.setup().click(use!);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PUT",
          url: "/api/settings",
          body: { memory: { embeddings: { ...LOCAL, local: { model: QWEN.id } } } },
        },
      ]),
    );
  });
});

describe("C118 the license dialog", () => {
  it("C118 Baixar on a model whose license asks opens Termos do modelo with, in order, the license link, the sentence, the unchecked checkbox, Cancelar and Baixar (disabled); focus on the checkbox", async () => {
    draw(LOCAL);
    await loaded();
    await userEvent.setup().click(rowButton(GEMMA.id, "Baixar")!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Termos do modelo");
    const body = dialog.querySelector(".modal-body")!;
    const [link, sentence, label] = [...body.children];
    expect(link!.tagName).toBe("A");
    expect(link!.textContent).toBe("Gemma");
    expect(link!.getAttribute("href")).toBe("https://ai.google.dev/gemma/terms");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")!.split(" ")).toContain("noopener");
    expect(sentence!.textContent).toBe(
      "O MordomoOS não distribui este modelo: ele é baixado do repositório do autor para o seu computador, sob estes termos.",
    );
    const box = within(dialog).getByLabelText("Li e aceito os termos") as HTMLInputElement;
    expect(label!.contains(box)).toBe(true);
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    const actions = [...dialog.querySelector(".modal-actions")!.querySelectorAll("button")];
    expect(actions.map((b) => b.textContent)).toEqual(["Cancelar", "Baixar"]);
    expect(actions[1]!.classList.contains("btn")).toBe(true);
    expect(actions[1]!.classList.contains("primary")).toBe(true);
    expect(actions[1]!.disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("C118 Esc closes it with no request", async () => {
    draw(LOCAL);
    await loaded();
    const user = userEvent.setup();
    await user.click(rowButton(GEMMA.id, "Baixar")!);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
  });

  it("C118 checking the box enables Baixar, which sends {action: install, id, acceptTerms: true}", async () => {
    net.posts.push({
      body: { action: "install", id: GEMMA.id, acceptTerms: true },
      answer: () => Promise.resolve({ state: "downloading", model: GEMMA.id }),
    });
    draw(LOCAL);
    await loaded();
    const user = userEvent.setup();
    await user.click(rowButton(GEMMA.id, "Baixar")!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Li e aceito os termos"));
    const go = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "Baixar")!;
    expect((go as HTMLButtonElement).disabled).toBe(false);
    await user.click(go);
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "POST",
          url: "/api/memory/embedder",
          body: { action: "install", id: GEMMA.id, acceptTerms: true },
        },
      ]),
    );
  });

  it("C118 on a model with acceptRequired false, Baixar sends {action: install, id} with no dialog", async () => {
    net.posts.push({
      body: { action: "install", id: QWEN.id },
      answer: () => Promise.resolve({ state: "downloading", model: QWEN.id }),
    });
    draw(LOCAL);
    await loaded();
    await userEvent.setup().click(rowButton(QWEN.id, "Baixar")!);
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "POST", url: "/api/memory/embedder", body: { action: "install", id: QWEN.id } },
      ]),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("C119 while a model downloads", () => {
  it("C119 below line 2 a progressbar at the percentage, Baixando: 120 de 209 MB and Cancelar", async () => {
    models(
      { ...GEMMA, state: "downloading", progress: { done: 120_000_000, total: 209_000_000 } },
      QWEN,
      RERANKER,
    );
    draw(LOCAL);
    await loaded();
    const bar = within(row(GEMMA.id)).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("57");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.previousElementSibling!.textContent).toBe("209 MB · 768 dimensões · licença Gemma");
    await waitFor(() =>
      expect(row(GEMMA.id).querySelector(".ss-side")!.textContent).toContain("Baixando: 120 de 209 MB"),
    );
    expect(rowButton(GEMMA.id, "Cancelar")).not.toBeNull();
  });

  it("C119 the screen asks GET /api/memory/embedder once by 999 ms, a second time at 1 000 ms, and stops once the state reads Pronto", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    models(
      { ...GEMMA, state: "downloading", progress: { done: 120_000_000, total: 209_000_000 } },
      QWEN,
      RERANKER,
    );
    draw(LOCAL);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(gets("/api/memory/embedder")).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(gets("/api/memory/embedder")).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(gets("/api/memory/embedder")).toBe(2);
    models({ ...GEMMA, state: "ready" }, QWEN, RERANKER);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(gets("/api/memory/embedder")).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(row(GEMMA.id).querySelector(".ss-side")!.textContent).toContain("Pronto");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets("/api/memory/embedder")).toBe(3);
  });
});

describe("C120 no model downloaded", () => {
  const pick = "Escolha um modelo para baixar. O download não começa sem o seu pedido.";

  it("C120 the sentence sits above the list", async () => {
    draw(LOCAL);
    await loaded();
    const hint = within(detail()).getByText(pick);
    expect(hint.nextElementSibling).toBe(detail().querySelector(".ss-models"));
  });

  it("C120 with one Pronto it is absent", async () => {
    models({ ...GEMMA, state: "ready" }, QWEN, RERANKER);
    draw(LOCAL);
    await loaded();
    expect(within(detail()).queryByText(pick)).toBeNull();
  });
});

describe("C121 a failed download shows its reason", () => {
  const cases: Array<[string, string]> = [
    ["checksum", "Falhou: soma de verificação diferente"],
    ["host_not_allowed", "Falhou: endereço fora da lista"],
    ["network: socket hang up", "Falhou: socket hang up"],
  ];
  it.each(cases)("C121 %s reads %s with Tentar de novo", async (reason, text) => {
    models({ ...GEMMA, state: "failed", reason }, QWEN, RERANKER);
    draw(LOCAL);
    await loaded();
    expect(row(GEMMA.id).querySelector(".ss-side > .ss-row")!.textContent).toBe(text);
    expect(rowButton(GEMMA.id, "Tentar de novo")).not.toBeNull();
  });
});

describe("C122 the recompute confirmation", () => {
  const ready = (embeddings: Json) => {
    net.status = status({ enabled: true, sections: 1234 });
    return draw({ ...embeddings, enabled: true });
  };
  const body = (d: HTMLElement) => [...d.querySelectorAll(".modal-body p")].map((p) => p.textContent);

  it("C122 choosing Servidor seu opens Recalcular o índice? with the count and the resend line; Continuar sends the PUT", async () => {
    const before = { ...EMB, endpoint: ENDPOINT };
    allowPut({ ...before, enabled: true, provider: "http" });
    net.index = () => Promise.resolve({ stats: {} });
    ready(before);
    await waitFor(() =>
      expect(block().querySelector(":scope > [role=status]")!.textContent).toContain("1234"),
    );
    const user = userEvent.setup();
    await user.click(radio("Servidor seu"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Recalcular o índice?");
    expect(body(dialog)).toEqual([
      "As 1234 seções serão calculadas de novo.",
      "Seus textos serão enviados de novo para http://127.0.0.1:11434/v1/embeddings.",
    ]);
    expect(writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Continuar" }));
    await waitFor(() =>
      expect(writes()[0]).toEqual({
        method: "PUT",
        url: "/api/settings",
        body: { memory: { embeddings: { ...before, enabled: true, provider: "http" } } },
      }),
    );
  });

  it("C122 cancelling sends nothing", async () => {
    ready({ ...EMB, endpoint: ENDPOINT });
    await waitFor(() =>
      expect(block().querySelector(":scope > [role=status]")!.textContent).toContain("1234"),
    );
    const user = userEvent.setup();
    await user.click(radio("Servidor seu"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => b.textContent === "Cancelar")!,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
    expect(radio("Palavras e vetor simples").getAttribute("aria-checked")).toBe("true");
  });

  it("C122 Usar este modelo opens it with no resend line (the new provider is not Servidor seu)", async () => {
    models({ ...GEMMA, state: "ready" }, { ...QWEN, state: "ready" }, RERANKER);
    net.catalog = { ...net.catalog, active: GEMMA.id };
    ready(LOCAL);
    await loaded();
    await waitFor(() =>
      expect(block().querySelector(":scope > [role=status]")!.textContent).toContain("1234"),
    );
    await userEvent.setup().click(rowButton(QWEN.id, "Usar este modelo")!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Recalcular o índice?");
    expect(body(dialog)).toEqual(["As 1234 seções serão calculadas de novo."]);
    expect(writes()).toEqual([]);
  });

  it("C122 a new Dimensões opens it with the resend line; cancelling sends nothing and the field reads the stored value again", async () => {
    ready(HTTP);
    await waitFor(() =>
      expect(block().querySelector(":scope > [role=status]")!.textContent).toContain("1234"),
    );
    const user = userEvent.setup();
    const input = within(detail()).getByLabelText("Dimensões");
    await user.clear(input);
    await user.type(input, "1024{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(body(dialog)).toEqual([
      "As 1234 seções serão calculadas de novo.",
      "Seus textos serão enviados de novo para http://127.0.0.1:11434/v1/embeddings.",
    ]);
    await user.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => b.textContent === "Cancelar")!,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
    await waitFor(() =>
      expect((within(detail()).getByLabelText("Dimensões") as HTMLInputElement).value).toBe("768"),
    );
  });

  it("C122 with no ready index (the search off, or 0 sections) the change is saved with no dialog", async () => {
    allowPut({ ...EMB, provider: "local" });
    net.status = status({ enabled: false, sections: 1234 });
    draw(EMB);
    await userEvent.setup().click(radio("Modelo neste computador"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("C122 the search on with 0 sections is no ready index either", async () => {
    allowPut({ ...EMB, enabled: true, provider: "local" });
    net.status = status({ enabled: true, sections: 0 });
    draw({ ...EMB, enabled: true });
    await waitFor(() => expect(gets("/api/memory/status")).toBe(1));
    await userEvent.setup().click(radio("Modelo neste computador"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("C123 the remove confirmation", () => {
  const open = async () => {
    models({ ...GEMMA, state: "ready" }, QWEN, RERANKER);
    draw({ ...EMB, provider: "local", local: { model: QWEN.id } });
    await loaded();
    await userEvent.setup().click(rowButton(GEMMA.id, "Remover")!);
    return screen.findByRole("dialog");
  };

  it("C123 Remover EmbeddingGemma 300m? with Libera 209 MB. and the danger action Remover, which sends {action: remove, id}", async () => {
    net.posts.push({
      body: { action: "remove", id: GEMMA.id },
      answer: () => Promise.resolve({ state: "absent" }),
    });
    const dialog = await open();
    expect(within(dialog).getByRole("heading").textContent).toBe("Remover EmbeddingGemma 300m?");
    expect(dialog.querySelector(".modal-body")!.textContent).toBe("Libera 209 MB. Você pode baixar de novo.");
    const go = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "Remover")!;
    expect(go.classList.contains("danger")).toBe(true);
    await userEvent.setup().click(go);
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "POST", url: "/api/memory/embedder", body: { action: "remove", id: GEMMA.id } },
      ]),
    );
  });

  it("C123 cancelling sends nothing", async () => {
    const dialog = await open();
    await userEvent.setup().click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => b.textContent === "Cancelar")!,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
  });
});

describe("C124 the reranker block", () => {
  const rerankButton = () => within(detail()).getByRole("button", { name: "Releitura mais cuidadosa" });

  it("C124 only inside Modelo neste computador", () => {
    draw(HTTP);
    expect(within(block()).queryByText("Releitura mais cuidadosa")).toBeNull();
  });

  it("C124 after the list: the button aria-pressed false, disabled with no reranker Pronto, the text beside it, the reranker's row below", async () => {
    draw(LOCAL);
    await loaded();
    const button = rerankButton();
    const list = detail().querySelector(".ss-models")!;
    expect(list.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.nextElementSibling!.textContent).toBe(
      "Mais lento: cerca de meio segundo por seção candidata. Só vale para agentes.",
    );
    const below = row(RERANKER.id);
    expect(button.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("C124 enabled when a reranker is Pronto; switching it sends memory.recall with rerank.enabled true", async () => {
    models(GEMMA, QWEN, { ...RERANKER, state: "ready" });
    net.puts.push({ memory: { recall: { ...RECALL, rerank: { ...RECALL.rerank, enabled: true } } } });
    draw(LOCAL);
    await loaded();
    expect((rerankButton() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(rerankButton());
    await waitFor(() => expect(rerankButton().getAttribute("aria-pressed")).toBe("true"));
    expect(writes()).toEqual([
      {
        method: "PUT",
        url: "/api/settings",
        body: { memory: { recall: { ...RECALL, rerank: { ...RECALL.rerank, enabled: true } } } },
      },
    ]);
  });
});

describe("C125 the index line with the search on", () => {
  const line = () => block().querySelector<HTMLElement>(":scope > [role=status]")!;

  it("C125 hash with 1234 sections: 1234 seções indexadas com o vetor simples", async () => {
    net.status = status({ enabled: true, sections: 1234 });
    draw({ ...EMB, enabled: true });
    await waitFor(() => expect(line().textContent).toBe("1234 seções indexadas com o vetor simples"));
  });

  it("C125 the local model: 1234 seções indexadas com EmbeddingGemma 300m", async () => {
    net.status = status({ enabled: true, sections: 1234, model: GEMMA.id });
    models({ ...GEMMA, state: "ready" }, QWEN, RERANKER);
    draw({ ...LOCAL, enabled: true });
    await waitFor(() => expect(line().textContent).toBe("1234 seções indexadas com EmbeddingGemma 300m"));
  });

  it("C125 http with model nomic-embed-text: … com nomic-embed-text", async () => {
    net.status = status({ enabled: true, sections: 1234 });
    draw({ ...HTTP, enabled: true });
    await waitFor(() => expect(line().textContent).toBe("1234 seções indexadas com nomic-embed-text"));
  });

  it("C125 with semantic.error set, its text and AlertTriangle", async () => {
    net.status = status({ enabled: true, sections: 1234, error: "connect ECONNREFUSED 127.0.0.1:11434" });
    draw({ ...EMB, enabled: true });
    await waitFor(() => expect(line().textContent).toContain("connect ECONNREFUSED 127.0.0.1:11434"));
    const err = line().querySelector(".tone-warn")!;
    expect(err.textContent!.trim()).toBe("connect ECONNREFUSED 127.0.0.1:11434");
    expect(has(err, "triangle-alert")).toBe(true);
  });

  it("C125 after Continuar, Recalculando… with a spinner until the status's indexing reads idle", async () => {
    const before = { ...EMB, enabled: true, endpoint: ENDPOINT, model: "nomic-embed-text" };
    allowPut({ ...before, provider: "http" });
    let finish!: (v: unknown) => void;
    net.index = () => new Promise((r) => (finish = r));
    net.status = status({ enabled: true, sections: 1234 });
    draw(before);
    await waitFor(() => expect(line().textContent).toContain("1234"));
    const user = userEvent.setup();
    await user.click(radio("Servidor seu"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(line().textContent!.trim()).toBe("Recalculando…"));
    expect(line().querySelector(".spinner")).not.toBeNull();
    net.status = status({ enabled: true, sections: 1234 }, { state: "running", phase: "vectors" });
    await act(async () => finish({ stats: {} }));
    await waitFor(() => expect(gets("/api/memory/status")).toBeGreaterThan(1));
    expect(line().textContent!.trim()).toBe("Recalculando…");
    net.status = status({ enabled: true, sections: 1200 });
    await waitFor(() => expect(line().textContent).toBe("1200 seções indexadas com nomic-embed-text"), {
      timeout: 4000,
    });
  });
});

describe("C126 loading and failure", () => {
  it("C126 while GET /api/memory/embedder is pending, a spinner and Carregando… where the list goes; the header and options are there", () => {
    net.catalogMode = "pending";
    draw(LOCAL);
    expect(within(block()).getByRole("heading").textContent).toBe("Busca por significado");
    expect(radios()).toHaveLength(3);
    expect(detail().textContent!.trim()).toBe("Carregando…");
    expect(detail().querySelector(".spinner")).not.toBeNull();
    expect(detail().querySelector(".ss-models")).toBeNull();
  });

  it("C126 when it fails, role=alert with AlertTriangle, Não deu para carregar os modelos. and Tentar de novo, which asks again", async () => {
    net.catalogMode = "fail";
    draw(LOCAL);
    const alert = await within(detail()).findByRole("alert");
    expect(has(alert, "triangle-alert")).toBe(true);
    expect(alert.textContent).toBe("Não deu para carregar os modelos.Tentar de novo");
    expect(gets("/api/memory/embedder")).toBe(1);
    net.catalogMode = "answer";
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await loaded();
    expect(gets("/api/memory/embedder")).toBe(2);
  });
});

describe("C127 the footer link", () => {
  it("C127 Como instalar o Ollama is an <a> with target _blank, rel noopener and the guide's anchor", () => {
    draw(EMB);
    const link = within(block()).getByRole("link", { name: "Como instalar o Ollama" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")!.split(" ")).toContain("noopener");
    expect(link.getAttribute("href")!.endsWith("docs/memory-guide.md#busca-por-significado")).toBe(true);
  });
});

describe("C131 the keyboard", () => {
  const tabs = async (n: number) => {
    const user = userEvent.setup();
    const seen: Array<Element | null> = [];
    for (let i = 0; i < n; i++) {
      await user.tab();
      seen.push(document.activeElement);
    }
    return seen;
  };
  const name = (el: Element | null) =>
    el?.getAttribute("aria-label") ??
    el?.getAttribute("role") ??
    (el as HTMLInputElement).labels?.[0]?.textContent ??
    el?.textContent;

  it("C131 Servidor seu: the on/off button, the radio group (one stop), the fields in order, the checkbox, Testar conexão, the footer link", async () => {
    draw(HTTP);
    const order = await tabs(9);
    expect(order.map(name)).toEqual([
      "Busca por significado",
      "radio",
      "Endereço",
      "Modelo",
      "Dimensões",
      "Variável da chave",
      "Permitir servidor fora deste computador",
      "Testar conexão",
      "Como instalar o Ollama",
    ]);
    expect(order[1]).toBe(radio("Servidor seu"));
  });

  it("C131 Modelo neste computador: the on/off button, the radio group, the model actions, the reranker button (its own model's row below it, G49), the footer link", async () => {
    models({ ...GEMMA, state: "ready" }, QWEN, { ...RERANKER, state: "ready" });
    draw({ ...EMB, provider: "local", local: { model: QWEN.id } });
    await loaded();
    const order = await tabs(8);
    expect(order.map(name)).toEqual([
      "Busca por significado",
      "radio",
      "Remover",
      "Usar este modelo",
      "Baixar",
      "Releitura mais cuidadosa",
      "Remover",
      "Como instalar o Ollama",
    ]);
  });

  it("C131 the arrows move the choice in the radio group", async () => {
    allowPut({ ...EMB, provider: "http" });
    draw(EMB);
    radio("Palavras e vetor simples").focus();
    await userEvent.setup().keyboard("{ArrowDown}");
    await waitFor(() => expect(radio("Servidor seu").getAttribute("aria-checked")).toBe("true"));
    expect(document.activeElement).toBe(radio("Servidor seu"));
    expect(writes()).toEqual([
      { method: "PUT", url: "/api/settings", body: { memory: { embeddings: { ...EMB, provider: "http" } } } },
    ]);
  });

  it("C131 Enter and Space activate a button", async () => {
    allowPut({ ...EMB, enabled: true });
    allowPut({ ...EMB, enabled: false });
    draw(EMB);
    const button = block().querySelector<HTMLButtonElement>(".ss-head button")!;
    button.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    await user.keyboard(" ");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(writes().map((c) => c.body)).toEqual([
      { memory: { embeddings: { ...EMB, enabled: true } } },
      { memory: { embeddings: { ...EMB, enabled: false } } },
    ]);
  });

  it("C131 in the license dialog Tab stays inside it", async () => {
    draw(LOCAL);
    await loaded();
    await userEvent.setup().click(rowButton(GEMMA.id, "Baixar")!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const user = userEvent.setup();
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
