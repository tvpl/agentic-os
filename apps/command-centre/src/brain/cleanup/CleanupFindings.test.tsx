// @vitest-environment jsdom
/**
 * Step 3 of the guided cleanup (.specs/features/cerebro-faxina-guiada, C58-C66; design.md "Etapa 3"; plan.md
 * amendments 7 and 10): the tabs by kind, the card of each kind, "Juntar", an answer stored before its card moves, a
 * failed one, "Revisar depois" and "Não sei", "Aplicar a todos deste tipo", and "O que importa aqui?".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { net, note, resetNet } from "../notes/testnet";
import { CleanupFindings } from "./CleanupFindings";
import type { Answers, Finding } from "./cleanupData";
import {
  DAY,
  MEM,
  NetError,
  WORK,
  atStep,
  cleanup,
  finding,
  openWizard,
  resetCleanup,
  scan,
  sent,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async () => ({
  useOsEvent: (await import("../notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetCleanup();
});

/** The step as the wizard holds it: the answers are its state, handed back by `onAnswered`. */
function Step({ findings, brief = null }: { findings: Finding[]; brief?: string | null }) {
  const [answered, setAnswered] = useState<Answers>({});
  return (
    <CleanupFindings
      scanId="scan-1"
      findings={findings}
      answered={answered}
      onAnswered={(e) => setAnswered((p) => ({ ...p, ...e }))}
      brief={brief}
    />
  );
}
const show = (findings: Finding[], brief: string | null = null) =>
  renderWith(<Step findings={findings} brief={brief} />, { lang: "pt-BR" });

const tabs = () => screen.getAllByRole("tab").map((t) => t.textContent);
const cards = () => [...document.querySelectorAll<HTMLElement>(".cln-cards > li")];
const name = (c: Element) => c.querySelector(".cln-file-name, .cln-mono")!.textContent;
const answers = (c: HTMLElement) =>
  [...c.querySelectorAll(".cln-answers > button")].map((b) => b.textContent);
const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const puts = () =>
  sent("PUT", "/api/memory/cleanup/decisions") as Array<{ scanId: string; decisions: unknown[] }>;

const EIGHT = (): Finding[] => [
  finding("untitled", [`${MEM}/notes/sem.md`]),
  finding("duplicate", [`${MEM}/notes/a.md`, `${MEM}/notes/a-copia.md`]),
  finding("large-file", [`${WORK}/video.mp4`], {
    detail: { bytes: 7 * 1024 * 1024, limit: 5 * 1024 * 1024 },
  }),
  finding("near-duplicate", [`${MEM}/notes/plano.md`, `${MEM}/notes/plano-v2.md`], {
    detail: { similarity: 0.92 },
  }),
  finding("stale", [`${WORK}/velho.md`], { detail: { since: "mtime", ageDays: 410 } }),
  finding("orphan", [`${MEM}/notes/solta.md`]),
  finding("broken-link", [`${MEM}/notes/com-link.md`], {
    detail: { target: "nada", line: 3, linkKind: "wikilink" },
  }),
  finding("empty-folder", [], { detail: { folder: `${WORK}/vazia` } }),
];

describe("C58 the tabs by kind", () => {
  it("C58 the eight kinds in the design's order, each with its count", () => {
    show([
      ...EIGHT(),
      ...[1, 2].map((i) => finding("stale", [`${WORK}/s${i}.md`], { detail: { ageDays: 200 } })),
    ]);
    expect(tabs()).toEqual([
      "Duplicatas (1)",
      "Quase iguais (1)",
      "Parados (3)",
      "Órfãs (1)",
      "Links quebrados (1)",
      "Pastas vazias (1)",
      "Grandes (1)",
      "Sem título (1)",
    ]);
  });

  it("C58 a kind with no finding has no tab: three kinds, three tabs in that relative order", () => {
    show([
      finding("untitled", [`${MEM}/notes/x.md`]),
      finding("orphan", [`${MEM}/notes/y.md`]),
      finding("duplicate", [`${MEM}/notes/z.md`, `${MEM}/notes/z2.md`]),
    ]);
    expect(tabs()).toEqual(["Duplicatas (1)", "Órfãs (1)", "Sem título (1)"]);
  });
});

describe("C59 one card per kind", () => {
  const cases: Array<[string, string, boolean]> = [
    ["Duplicatas", "Mesmos bytes que a-copia.md.", true],
    ["Quase iguais", "92% igual a plano-v2.md.", true],
    ["Parados", "Não muda há 410 dias.", false],
    ["Órfãs", "Nenhum link chega ou sai.", false],
    ["Links quebrados", "nada (linha 3) não leva a nada.", false],
    ["Pastas vazias", "Uma pasta vazia.", false],
    ["Grandes", "Tem 7.0 MB, acima de 5.0 MB.", false],
    ["Sem título", "Uma nota sem título.", false],
  ];
  for (const [tab, sentence, merge] of cases)
    it(`C59 ${tab}: the icon and "${sentence}", then the files, then the answers in one row${merge ? " with Juntar" : " without Juntar"}`, () => {
      show(EIGHT());
      fireEvent.mouseDown(screen.getByRole("tab", { name: new RegExp(`^${tab}`) }));
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${tab}`) }));
      const [card] = cards();
      expect(cards()).toHaveLength(1);
      const [why, files, row] = [...card!.children];
      expect(why!.className).toBe("cln-why");
      expect(why!.firstElementChild!.tagName.toLowerCase()).toBe("svg");
      expect(why!.textContent).toBe(sentence);
      // The other file's name in code type, as design.md writes it ("92% igual a `plano-v2.md`."; round 1).
      expect([...why!.querySelectorAll("code")].map((c) => c.textContent)).toEqual(
        tab === "Duplicatas" ? ["a-copia.md"] : tab === "Quase iguais" ? ["plano-v2.md"] : [],
      );
      expect(files!.className).toBe("cln-files");
      expect(row!.className).toBe("cln-answers");
      expect(answers(card!)).toEqual(
        merge
          ? ["Manter", "Arquivar", "Juntar", "Revisar depois", "Não sei"]
          : ["Manter", "Arquivar", "Revisar depois", "Não sei"],
      );
      // No answer rewrites a note (amendment 10): the five, and nothing else.
      for (const a of answers(card!))
        expect(["Manter", "Arquivar", "Juntar", "Revisar depois", "Não sei"]).toContain(a);
    });

  it("C59 a file reads its name, its folder, its age and its size", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 1) + 3 * DAY });
    show([finding("stale", [`${WORK}/docs/velho.md`], { detail: { ageDays: 200 } })]);
    const row = cards()[0]!.querySelector(".cln-files > li")!;
    expect([...row.children].map((c) => c.textContent)).toEqual([
      "velho.md",
      `${WORK}/docs`,
      "há 3 dias",
      "1.0 KB",
    ]);
  });
});

describe("C60 Juntar", () => {
  it("C60 shows Manter este per file with the newest checked; confirming sends merge with that file's id", async () => {
    const f = finding("duplicate", [`${MEM}/notes/a.md`, `${MEM}/notes/b.md`, `${MEM}/notes/c.md`]);
    // The middle one is the newest.
    f.files[1]!.mtime = f.files[2]!.mtime + DAY;
    show([f]);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Juntar" }));
    const radios = within(cards()[0]!).getAllByRole("radio", { name: "Manter este" }) as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      scanId: "scan-1",
      decisions: [{ key: f.key, decision: "merge", keepFileId: f.files[1]!.id }],
    });
  });

  it("C60 another file checked is the one kept", async () => {
    const f = finding("near-duplicate", [`${MEM}/notes/a.md`, `${MEM}/notes/b.md`], {
      detail: { similarity: 0.9 },
    });
    show([f]);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Juntar" }));
    fireEvent.click(within(cards()[0]!).getAllByRole("radio", { name: "Manter este" })[0]!);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.decisions).toEqual([{ key: f.key, decision: "merge", keepFileId: f.files[0]!.id }]);
  });
});

const FOURTEEN = () =>
  Array.from({ length: 14 }, (_, i) =>
    finding("stale", [`${WORK}/s${String(i).padStart(2, "0")}.md`], { detail: { ageDays: 300 } }),
  );

describe("C61 an answer is stored before its card moves", () => {
  it("C61 the card stays where it is until PUT answers 200, then shows the answer with an icon and Respondido, below the unanswered; the top reads 1 de 14 respondidos beside Aplicar a todos deste tipo", async () => {
    let release: (v: unknown) => void = () => undefined;
    cleanup.decisions = () => new Promise((r) => (release = r));
    show(FOURTEEN());
    const first = cards()[0]!;
    expect(name(first)).toBe("s00.md");
    fireEvent.click(within(first).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.decisions).toEqual([{ key: expect.stringMatching(/^stale:/), decision: "archive" }]);
    // Still there, in its place, unanswered.
    expect(name(cards()[0]!)).toBe("s00.md");
    expect(cards()[0]!.hasAttribute("data-answered")).toBe(false);
    await act(async () => release({ saved: 1 }));
    await waitFor(() => expect(cards().at(-1)!.hasAttribute("data-answered")).toBe(true));
    const done = cards().at(-1)!;
    expect(name(done)).toBe("s00.md");
    expect(done.querySelector("svg")).not.toBeNull();
    expect(done.querySelector(".cln-answer-now")!.textContent).toBe("Arquivar");
    expect(done.textContent).toContain("Respondido");
    expect(
      cards()
        .slice(0, 13)
        .every((c) => !c.hasAttribute("data-answered")),
    ).toBe(true);
    const top = document.querySelector(".cln-all")!;
    expect(top.textContent).toContain("Aplicar a todos deste tipo");
    expect(top.querySelector(".cln-count")!.textContent).toBe("1 de 14 respondidos");
    expect(follows(top, cards()[0]!)).toBe(true);
  });
});

describe("C62 a decision that could not be stored", () => {
  it("C62 the card stays unanswered where it was with the message and Tentar de novo, which sends the same request again", async () => {
    let fail = true;
    cleanup.decisions = () =>
      fail ? Promise.reject(new NetError(500, "internal")) : Promise.resolve({ saved: 1 });
    show([finding("orphan", [`${MEM}/notes/a.md`]), finding("orphan", [`${MEM}/notes/b.md`])]);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Manter" }));
    const alert = await within(cards()[0]!).findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível guardar a resposta.");
    expect(name(cards()[0]!)).toBe("a.md");
    expect(cards()[0]!.hasAttribute("data-answered")).toBe(false);
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]).toEqual(puts()[0]);
    await waitFor(() => expect(cards().at(-1)!.hasAttribute("data-answered")).toBe(true));
  });
});

describe("C63 Revisar depois and Não sei", () => {
  it("C63 Revisar depois sends snooze until now + 30 days to the millisecond; Não sei sends unsure with no until", async () => {
    const now = Date.UTC(2026, 9, 30, 12, 34, 56, 789);
    vi.useFakeTimers({ toFake: ["Date"], now });
    const a = finding("stale", [`${WORK}/a.md`]);
    const b = finding("stale", [`${WORK}/b.md`]);
    show([a, b]);
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Revisar depois" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.decisions).toEqual([{ key: a.key, decision: "snooze", until: now + 30 * DAY }]);
    await waitFor(() => expect(cards()[0]!.hasAttribute("data-answered")).toBe(false));
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Não sei" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]!.decisions).toEqual([{ key: b.key, decision: "unsure" }]);
  });
});

describe("C64 Aplicar a todos deste tipo", () => {
  it("C64 Arquivar on Parados (14) sends one PUT with 14 archive entries, and then 14 de 14 respondidos", async () => {
    const all = FOURTEEN();
    show(all);
    expect(tabs()).toEqual(["Parados (14)"]);
    fireEvent.click(
      within(document.querySelector<HTMLElement>(".cln-all")!).getByRole("button", { name: "Arquivar" }),
    );
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.decisions).toEqual(all.map((f) => ({ key: f.key, decision: "archive" })));
    await waitFor(() =>
      expect(document.querySelector(".cln-all .cln-count")!.textContent).toBe("14 de 14 respondidos"),
    );
    expect(cards().every((c) => c.hasAttribute("data-answered"))).toBe(true);
  });
});

describe("C65 O que importa aqui?", () => {
  const BRIEF = `${MEM}/notes/alfa/_resumo.md`;
  const box = () => screen.getByRole("textbox", { name: "O que importa aqui?" }) as HTMLTextAreaElement;
  const notesPut = () =>
    sent("PUT", "/api/memory/notes") as Array<{ path: string; content: string; baseVersion: string }>;

  it("C65 a three-row textarea in the 13px class, with its help and Guardar, below the tabs", () => {
    show([finding("orphan", [`${MEM}/notes/a.md`])], BRIEF);
    expect(box().rows).toBe(3);
    expect(box().tagName).toBe("TEXTAREA");
    expect(box().classList.contains("cln-prose")).toBe(true);
    const sizes: string[] = [];
    postcss.parse(readFileSync(join(__dirname, "cleanup.css"), "utf8")).walkRules((r) => {
      if (r.selectors.includes(".cln-prose")) r.walkDecls("font-size", (d) => void sizes.push(d.value));
    });
    expect(sizes).toEqual(["var(--fs-3)"]);
    expect(screen.getByText("Vai para a nota-resumo do contexto.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeTruthy();
    expect(follows(document.querySelector(".ui-tabs-root")!, box())).toBe(true);
  });

  it("C65 Guardar reads the brief and writes it with its version: the text is the last paragraph of ## O que importa, before ## Metas, every other byte kept (CRLF, no final newline)", async () => {
    const before =
      "# Alfa\r\n\r\n## O que é\r\n\r\nUm cliente.\r\n\r\n## O que importa\r\n\r\nPrazo de março.\r\n\r\n## Metas\r\n\r\n- Fechar";
    note(900, MEM, "notes/alfa/_resumo.md", { content: before, version: "sha256:v1" });
    show([finding("orphan", [`${MEM}/notes/a.md`])], BRIEF);
    fireEvent.change(box(), { target: { value: "O contrato vence em junho." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(notesPut()).toHaveLength(1));
    expect(net.calls.some((c) => c.method === "GET" && c.url.startsWith("/api/memory/note?"))).toBe(true);
    expect(notesPut()[0]).toEqual({
      path: BRIEF,
      baseVersion: "sha256:v1",
      content:
        "# Alfa\r\n\r\n## O que é\r\n\r\nUm cliente.\r\n\r\n## O que importa\r\n\r\nPrazo de março.\r\n\r\nO contrato vence em junho.\r\n\r\n## Metas\r\n\r\n- Fechar",
    });
  });

  it("C65 a brief with no such section gets ## O que importa and the text at the end", async () => {
    note(901, MEM, "notes/alfa/_resumo.md", {
      content: "# Alfa\n\n## Metas\n\n- Fechar\n",
      version: "sha256:v2",
    });
    show([finding("orphan", [`${MEM}/notes/a.md`])], BRIEF);
    fireEvent.change(box(), { target: { value: "Só o essencial." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(notesPut()).toHaveLength(1));
    expect(notesPut()[0]!.content).toBe(
      "# Alfa\n\n## Metas\n\n- Fechar\n\n## O que importa\n\nSó o essencial.\n",
    );
    expect(notesPut()[0]!.baseVersion).toBe("sha256:v2");
  });

  it("C65 a 409 edit_conflict keeps the text in the box and shows Carregar de novo", async () => {
    note(902, MEM, "notes/alfa/_resumo.md", { content: "# Alfa\n", version: "sha256:v3" });
    net.writes.set("PUT /api/memory/notes", () => Promise.reject(new NetError(409, "edit_conflict")));
    show([finding("orphan", [`${MEM}/notes/a.md`])], BRIEF);
    fireEvent.change(box(), { target: { value: "Não perder isto." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("button", { name: "Carregar de novo" })).toBeTruthy();
    expect(box().value).toBe("Não perder isto.");
  });
});

describe("C66 a scope with no brief note", () => {
  const disabled = async (dialog: HTMLElement) => {
    const box = (await within(dialog).findByRole("textbox", {
      name: "O que importa aqui?",
    })) as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(within(dialog).getByText("Este escopo não tem nota-resumo.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(sent("PUT", "/api/memory/notes")).toEqual([]);
    expect(net.calls.filter((c) => c.method === "PATCH" && c.url.startsWith("/api/contexts/"))).toEqual([]);
  };

  it("C66 a dir scope: the box is disabled with the reason, and nothing is written", async () => {
    cleanup.folders = [WORK];
    cleanup.starts.push("scan-1");
    scan("scan-1", [finding("stale", [`${WORK}/a.md`])], { scope: { kind: "dir", path: WORK } });
    const { dialog } = await openWizard({});
    fireEvent.change(within(dialog).getByLabelText("Ou uma pasta…"), { target: { value: WORK } });
    const see = within(dialog).getByRole("button", { name: "Ver o que tem aqui" }) as HTMLButtonElement;
    await waitFor(() => expect(see.disabled).toBe(false));
    fireEvent.click(see);
    const go = (await within(dialog).findByRole("button", {
      name: "Procurar o que decidir",
    })) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await atStep("Etapa 3 de 5 · Achados");
    await disabled(dialog);
  });

  it("C66 a context whose brief is null: the same", async () => {
    const { context, toFindings } = await import("./testkit");
    context("alfa", "Alfa", { brief: null });
    const { dialog } = await toFindings([finding("stale", [`${WORK}/a.md`])]);
    await disabled(dialog);
  });
});
