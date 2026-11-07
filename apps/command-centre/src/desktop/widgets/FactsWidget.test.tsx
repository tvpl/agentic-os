// @vitest-environment jsdom
/**
 * The facts widget's line of provenance (.specs/features/cerebro-memoria-confiavel, C87; design.md "Widget de fatos"):
 * below each fact's text, in this order, one 12px line with the trust badge (icon and text, one case each), the author's
 * label and, when the fact has a `sourcePath`, the source as a link `journal/2026-09-03.md:12` (relative to `memory/`,
 * with `sourceLine`) to the notes view at that line. The route is answered for `GET /api/memory/facts` with no
 * `includeRetracted` only (L-052): a retracted fact is not on the default list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { MEM, NetError, asked, net, resetNet, type Asked } from "../../brain/notes/testnet";
import FactsWidget from "./FactsWidget";

vi.mock("../../api", async (importOriginal) =>
  (await import("../../brain/notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

let ids = 0;
const fact = (over: Record<string, unknown>) => ({
  id: ++ids,
  subject: "Cliente X",
  predicate: "status",
  object: "ativo",
  validFrom: Date.now() - 86_400_000,
  validTo: null,
  sourceRunId: null,
  sourcePath: null,
  createdAt: Date.now() - 86_400_000,
  recordedAt: Date.now() - 86_400_000,
  retractedAt: null,
  sourceLine: null,
  author: "owner",
  trust: "usuario",
  proposalId: null,
  sourceFileId: null,
  ...over,
});

const FACTS = [
  fact({
    subject: "A",
    author: "owner",
    trust: "usuario",
    sourcePath: `${MEM}/journal/2026-09-03.md`,
    sourceLine: 12,
  }),
  fact({ subject: "B", author: "run:a1b2c3", trust: "ferramenta", sourceRunId: "a1b2c3" }),
  fact({ subject: "C", author: "mcp", trust: "inferido", sourcePath: `${MEM}/notes/cliente.md` }),
  fact({ subject: "D", author: "unknown", trust: "inferido" }),
];

/** `GET /api/memory/facts` with no query only; one that carries `includeRetracted` (or anything) is refused. */
function facts(list: unknown[]) {
  net.overrides.push((u: Asked) => {
    if (u.pathname !== "/api/memory/facts") return undefined;
    if ([...u.searchParams].length > 0)
      return Promise.reject(new NetError(400, "unexpected_query", `unexpected: ${u.searchParams}`));
    return Promise.resolve({
      facts: structuredClone(list),
      stats: { open: list.length, expired: 0, subjects: 4 },
    });
  });
}

const rows = () => [...document.querySelectorAll<HTMLElement>(".fact-row")];
const meta = (row: HTMLElement) => row.querySelector<HTMLElement>(".fact-text > .mc-meta")!;

describe("C87 the line below each fact", () => {
  it("C87 the trust badge, the author and the source link, in this order, one trust and one author each", async () => {
    facts(FACTS);
    renderWith(<FactsWidget />, { lang: "pt-BR" });
    await waitFor(() => expect(rows()).toHaveLength(4));
    await waitFor(() =>
      expect(meta(rows()[0]!).querySelector("a")?.textContent).toBe("journal/2026-09-03.md:12"),
    );
    const parts = (row: HTMLElement) =>
      [...meta(row).children].map((c) => `${c.tagName.toLowerCase()}|${c.textContent}`);
    expect(parts(rows()[0]!)).toEqual(["span|Escrito por você", "span|Você", "a|journal/2026-09-03.md:12"]);
    expect(parts(rows()[1]!)).toEqual(["span|Saída de ferramenta", "span|Execução a1b2c3"]);
    expect(parts(rows()[2]!)).toEqual([
      "span|Inferido pelo agente",
      "span|Agente (MCP)",
      "a|notes/cliente.md",
    ]);
    expect(parts(rows()[3]!)).toEqual(["span|Inferido pelo agente", "span|Origem desconhecida"]);
    // the badge is an icon and a text, always both
    const icon = (row: HTMLElement) => meta(row).querySelector(".mc-trust svg")!.getAttribute("class");
    expect(icon(rows()[0]!)).toContain("lucide-user-check");
    expect(icon(rows()[1]!)).toContain("lucide-wrench");
    expect(icon(rows()[2]!)).toContain("lucide-sparkles");
    // below the text: after it inside the text's cell, on its own line, at 12px
    const text = rows()[0]!.querySelector(".fact-text")!;
    expect(text.lastElementChild).toBe(meta(rows()[0]!));
    const css = postcss.parse(readFileSync(join(__dirname, "..", "..", "brain", "memoria.css"), "utf8"));
    const decls: Record<string, string> = {};
    css.walkRules((r) => {
      if (r.selectors.includes(".mc-meta")) r.walkDecls((d) => void (decls[d.prop] = d.value));
    });
    expect(decls).toMatchObject({ display: "flex", "font-size": "var(--fs-2)" });
    // the link opens the notes view at the cited line
    const href = meta(rows()[0]!).querySelector("a")!.getAttribute("href")!;
    expect(href.split("?")[0]).toBe("#/brain/notes");
    const q = new URLSearchParams(href.split("?")[1]);
    expect([q.get("open"), q.get("line")]).toEqual([`${MEM}/journal/2026-09-03.md`, "12"]);
    expect(
      new URLSearchParams(meta(rows()[2]!).querySelector("a")!.getAttribute("href")!.split("?")[1]).get(
        "line",
      ),
    ).toBeNull();
    // the widget asked the default list: no includeRetracted
    expect(asked("/api/memory/facts").map(String)).toEqual(asked("/api/memory/facts").map(() => ""));
  });

  it("C87 in en the labels read Written by you, You", async () => {
    facts([FACTS[0]]);
    renderWith(<FactsWidget />, { lang: "en" });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect([...meta(rows()[0]!).children].slice(0, 2).map((c) => c.textContent)).toEqual([
      "Written by you",
      "You",
    ]);
  });
});
