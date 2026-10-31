// @vitest-environment jsdom
/**
 * The note panel's "Histórico" and the dialog of a version, in rendered components (.specs/features/cerebro-memoria-
 * confiavel, C97-C100; design.md "Painel da nota, seção Histórico" and "Diálogo - Versão de <data e hora>"): the fourth
 * fold after "Nesta nota", open; each row's parts in order, one origin label per row of the design's table and the
 * authors `external` and `system`; "Atual"; the empty, loading and failed fold; the 720px dialog with its diff, its
 * footer and the text of a deleted note; and the restore, its notice, its conflict and its other errors. The history
 * route answers `?path=notes/a.md&limit=50` only (L-052).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { NotePanel } from "./NotePanel";
import { MEM, NetError, asked, net, note, pathOf, resetNet, type Asked } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();

type Version = {
  id: number;
  path: string;
  at: number;
  author: string;
  origin: string;
  size: number | null;
  sha256: string | null;
  exists: boolean;
};
const H = 3_600_000;
let vids = 0;
const version = (over: Partial<Version> = {}): Version => ({
  id: ++vids,
  path: "notes/a.md",
  at: Date.now() - 3 * H,
  author: "owner",
  origin: "save",
  size: 10,
  sha256: `sha256:v${vids}`,
  exists: true,
  ...over,
});

const history = {
  list: [] as Version[] | Error | "pending",
  details: new Map<number, Record<string, unknown>>(),
  restore: (_b: unknown): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
};

beforeEach(() => {
  resetNet();
  history.list = [];
  history.details = new Map();
  history.restore = () => Promise.reject(new NetError(500, "unexpected"));
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/history") {
      const q = [...u.searchParams];
      if (
        q.length !== 2 ||
        u.searchParams.get("path") !== "notes/a.md" ||
        u.searchParams.get("limit") !== "50"
      )
        return Promise.reject(new NetError(400, "unexpected_query", `unexpected: ${u.searchParams}`));
      const answer = history.list;
      if (answer === "pending") return new Promise(() => undefined);
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ versions: structuredClone(answer) });
    }
    const one = /^\/api\/memory\/history\/(\d+)$/.exec(u.pathname);
    if (one) {
      const d = history.details.get(Number(one[1]));
      return d ? Promise.resolve(structuredClone(d)) : Promise.reject(new NetError(404, "not_found"));
    }
    return undefined;
  });
  net.writes.set("POST /api/memory/history/restore", (b) => history.restore(b));
});

/** The note `notes/a.md` (version `sha256:1`) in the panel. */
function mountPanel() {
  const f = note(1, MEM, "notes/a.md", { title: "A", content: "# A\n\n## Um\n" });
  renderWith(<NotePanel path={pathOf(f)} id={1} onOpen={() => undefined} />, { lang: "pt-BR" });
  return f;
}
const fold = () =>
  [...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold")].find(
    (s) => s.querySelector(".notes-fold-head")!.textContent === "Histórico",
  )!;
const rows = () => [...fold().querySelectorAll<HTMLElement>(".hf-pick")];
const detail = (v: Version, over: Record<string, unknown> = {}) =>
  history.details.set(v.id, {
    id: v.id,
    path: v.path,
    at: v.at,
    author: v.author,
    origin: v.origin,
    content: "# A\n\nantes\n",
    diff: "--- a/notes/a.md\n+++ b/notes/a.md\n@@ -1,3 +1,3 @@\n # A\n \n-agora\n+antes\n",
    current: "sha256:1",
    ...over,
  });
const css = (selector: string) => {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(join(__dirname, "history.css"), "utf8")).walkRules((r) => {
    if (r.parent?.type === "root" && r.selectors.includes(selector))
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
};
const pad = (n: number) => String(n).padStart(2, "0");
const when = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

/* ---------------- C97: the fold and its rows ---------------- */

const ORIGINS: Array<[string, string]> = [
  ["create", "Criada"],
  ["save", "Editada"],
  ["properties", "Propriedades"],
  ["task", "Tarefa"],
  ["review", "Revisão"],
  ["cleanup", "Faxina"],
  ["proposal", "Proposta aceita"],
  ["restore", "Restaurada"],
  ["guard", "Desfeita pela guarda"],
  ["external", "Mudou fora do editor"],
  ["baseline", "Primeira versão"],
  ["removed", "Apagada"],
  ["import", "Importada"],
];

describe("C97 the fourth fold, Histórico", () => {
  it("C97 the fold heads in order, Histórico the fourth and open", async () => {
    history.list = [version()];
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const heads = [
      ...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold .notes-fold-head"),
    ];
    expect(heads.map((h) => h.textContent)).toEqual(["Links", "Relacionadas", "Nesta nota", "Histórico"]);
    expect(heads[3]!.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("C97 each row in order: há 3 horas (its Tooltip the date and time), the author's icon and label, the origin in 12px; one origin per row of the table; newest first as answered", async () => {
    const list = ORIGINS.map(([origin], i) =>
      version({
        origin,
        author: i === 9 ? "external" : i === 10 ? "system" : "owner",
        sha256: origin === "removed" ? null : `sha256:x${i}`,
      }),
    );
    history.list = list;
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(13));
    const parts = (row: HTMLElement) => [...row.children].map((c) => `${c.className}|${c.textContent}`);
    rows().forEach((row, i) => {
      const author =
        list[i]!.author === "external"
          ? "Fora do MordomoOS"
          : list[i]!.author === "system"
            ? "MordomoOS"
            : "Você";
      expect(parts(row), ORIGINS[i]![0]).toEqual([
        "hf-when|há 3 horas",
        `mc-author|${author}`,
        `hf-origin|${ORIGINS[i]![1]}`,
      ]);
    });
    const icon = (i: number) => rows()[i]!.querySelector(".mc-author svg")!.getAttribute("class");
    expect(icon(0)).toContain("lucide-user");
    expect(icon(9)).toMatch(/lucide-(file-edit|file-pen)/);
    expect(icon(10)).toContain("lucide-cpu");
    expect(css(".hf-origin")).toMatchObject({ "font-size": "var(--fs-2)" });
    // the full date and time are the row's hint
    act(() => rows()[0]!.focus());
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain(when(list[0]!.at));
  });

  it("C97 the row whose sha256 is the open note's version carries Atual; the others do not", async () => {
    history.list = [version({ sha256: "sha256:1" }), version({ sha256: "sha256:old" })];
    mountPanel();
    await waitFor(() => expect(rows()[0]?.textContent).toContain("Atual"));
    expect(rows()[0]!.lastElementChild!.textContent).toBe("Atual");
    expect(rows()[1]!.textContent).not.toContain("Atual");
    expect(asked("/api/memory/history").map(String)).toEqual(
      asked("/api/memory/history").map(() => "path=notes%2Fa.md&limit=50"),
    );
  });
});

/* ---------------- C98: the states ---------------- */

describe("C98 the fold's states", () => {
  it("C98 versions: [] shows Sem versões ainda.", async () => {
    history.list = [];
    mountPanel();
    await waitFor(() => expect(fold().textContent).toBe("HistóricoSem versões ainda."));
  });

  it("C98 while pending: Carregando…", async () => {
    history.list = "pending";
    mountPanel();
    await waitFor(() => expect(fold().querySelector(".spinner")).not.toBeNull());
    expect(fold().textContent).toContain("Carregando…");
  });

  it("C98 on failure: the message and Tentar de novo, which asks again", async () => {
    history.list = new NetError(500, "boom", "falhou o histórico");
    mountPanel();
    const alert = await waitFor(() => {
      const el = fold().querySelector<HTMLElement>('[role="alert"]');
      expect(el?.textContent).toContain("falhou o histórico");
      return el!;
    });
    const n = asked("/api/memory/history").length;
    history.list = [];
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(asked("/api/memory/history").length).toBe(n + 1));
    await waitFor(() => expect(fold().textContent).toContain("Sem versões ainda."));
  });
});

/* ---------------- C99: the dialog of a version ---------------- */

describe("C99 Versão de <data e hora>", () => {
  it("C99 a 720px Modal: the author and origin, Do texto atual para esta versão over the diff, Fechar then Restaurar esta versão", async () => {
    const v = version({ sha256: "sha256:old", author: "run:a1b2c3", origin: "proposal" });
    history.list = [v];
    detail(v);
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(rows()[0]!);
    const dialog = await screen.findByRole("dialog", { name: `Versão de ${when(v.at)}` });
    expect(dialog.className).toContain("mc-wide");
    expect(css(".modal.mc-wide")).toMatchObject({ width: "min(720px, 100%)" });
    await waitFor(() => expect(dialog.querySelector(".mc-diff")).not.toBeNull());
    const head = dialog.querySelector(".vd-body > .mc-meta")!;
    expect([...head.children].map((c) => c.textContent)).toEqual(["Execução a1b2c3", "Proposta aceita"]);
    const title = dialog.querySelector(".vd-title")!;
    expect(title.textContent).toBe("Do texto atual para esta versão");
    const diff = dialog.querySelector(".mc-diff")!;
    expect(title.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the hunk, two context lines, the line taken out and the line put in
    expect([...diff.querySelectorAll(".mc-sign")].map((s) => s.textContent)).toEqual(["", "", "", "-", "+"]);
    const footer = [...dialog.querySelectorAll(".modal-actions button")];
    expect(footer.map((b) => b.textContent)).toEqual(["Fechar", "Restaurar esta versão"]);
    expect(footer[1]!.className).toBe("btn primary");
    expect(footer[1]!.querySelector("svg.lucide-rotate-ccw")).not.toBeNull();
  });

  it("C99 the Atual version's dialog has no restore button", async () => {
    const v = version({ sha256: "sha256:1" });
    history.list = [v];
    detail(v);
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(rows()[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector(".mc-diff")).not.toBeNull());
    expect([...dialog.querySelectorAll(".modal-actions button")].map((b) => b.textContent)).toEqual([
      "Fechar",
    ]);
  });

  it("C99 a version of a deleted note shows its whole text in mono, no diff", async () => {
    const v = version({ sha256: "sha256:old" });
    history.list = [v];
    detail(v, {
      current: null,
      content: "# A\n\no texto inteiro\n",
      diff: "@@ -0,0 +1,3 @@\n+# A\n+\n+o texto inteiro\n",
    });
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(rows()[0]!);
    const dialog = await screen.findByRole("dialog");
    const pre = await waitFor(() => {
      const el = dialog.querySelector("pre.vd-text");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(pre.textContent).toBe("# A\n\no texto inteiro\n");
    expect(css(".vd-text")).toMatchObject({ "font-family": "var(--font-mono)" });
    expect(dialog.querySelector(".mc-diff")).toBeNull();
    expect(dialog.querySelector(".vd-title")).toBeNull();
  });
});

/* ---------------- C100: restoring ---------------- */

describe("C100 Restaurar esta versão", () => {
  async function open() {
    const v = version({ sha256: "sha256:old" });
    history.list = [v];
    detail(v);
    mountPanel();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(rows()[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Restaurar esta versão" })).toBeTruthy(),
    );
    return { v, dialog };
  }
  const noteReads = () =>
    net.calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/memory/note?")).length;

  it("C100 sends exactly { id, baseVersion: the open note's version }; on 200 the dialog closes, the note is read again and Versão restaurada. is up at 7 999 ms and gone at 8 000 ms", async () => {
    const { v, dialog } = await open();
    history.restore = () => Promise.resolve({ path: "notes/a.md", version: "sha256:2" });
    const n = noteReads();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar esta versão" }));
    await flush();
    expect(
      net.calls
        .filter((c) => c.method === "POST" && c.url === "/api/memory/history/restore")
        .map((c) => c.body),
    ).toEqual([{ id: v.id, baseVersion: "sha256:1" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(noteReads()).toBe(n + 1);
    expect(fold().querySelector('[role="status"]')!.textContent).toBe("Versão restaurada.");
    act(() => void vi.advanceTimersByTime(7_999));
    expect(fold().querySelector('[role="status"]')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(fold().querySelector('[role="status"]')).toBeNull();
  });

  it("C100 on 409 edit_conflict the dialog stays with the conflict's text and Recarregar, and the note is not read again", async () => {
    const { dialog } = await open();
    history.restore = () => Promise.reject(new NetError(409, "edit_conflict", "The file changed"));
    const n = noteReads();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar esta versão" }));
    const alert = await waitFor(() => {
      const el = dialog.querySelector<HTMLElement>('.vd-failure[role="alert"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert.textContent).toBe(
      "A nota mudou desde que você abriu. Recarregue e tente de novo.Recarregar",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    await flush();
    expect(noteReads()).toBe(n);
  });

  it("C100 another error stays in the dialog's body", async () => {
    const { dialog } = await open();
    history.restore = () => Promise.reject(new NetError(403, "note_not_editable", "Não é uma nota editável"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar esta versão" }));
    const alert = await waitFor(() => {
      const el = dialog.querySelector<HTMLElement>(".vd-body .vd-failure");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert.textContent).toContain("Não é uma nota editável");
    expect(within(alert).queryByRole("button", { name: "Recarregar" })).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });
});
