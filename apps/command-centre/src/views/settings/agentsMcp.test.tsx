// @vitest-environment jsdom
/**
 * Settings › Agentes (MCP) (.specs/features/cerebro-perguntar, C101-C106, C108; design.md "Aba - Agentes (MCP) das
 * Configurações", door 6): the tab in the group `think` after `memory` and the words that find it; the card
 * "Conectar" per client, connected, not connected and with a config file that does not parse, and "Copiar"; the card
 * "Ferramentas" with the 13 tools of C53; the card "O que os agentes mais leem" with no usage and with usage; the
 * loading and error states; the copy of design.md's table in `locales/apps.ts`; and the bars' motion. The network
 * answers only the routes the tab reads (L-052): `GET /api/mcp` (answer, never answer or fail), `GET /api/system/info`
 * and, for the page itself, `GET /api/settings`; anything else is refused. "Now" is 2026-11-22 10:00 local.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import { useLocation } from "react-router-dom";
import type * as ApiModule from "../../api";
import * as apps from "../../locales/apps";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import type { Lang } from "../../i18n";
import { loadTree, productionFiles, spelledIn } from "../../testing/sourceGraph";
import Settings from "../Settings";
import AgentsMcpTab from "./AgentsMcp";

const net = vi.hoisted(() => ({
  home: "/home/ana/.mordomo",
  mcp: null as unknown,
  /** What `GET /api/mcp` does: answer `mcp`, never answer, or fail. */
  mode: "answer" as "answer" | "pending" | "fail",
  calls: [] as string[],
}));

vi.mock("../../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const refuse = (what: string) => Promise.reject(new Error(`not allowed by the test: ${what}`));
  const get = (url: string) => {
    const u = url.replace(/^\/api\/v1\//, "/api/");
    net.calls.push(u);
    if (u === "/api/mcp") {
      if (net.mode === "pending") return new Promise(() => undefined);
      if (net.mode === "fail") return Promise.reject(new Error("The service did not answer."));
      return Promise.resolve(structuredClone(net.mcp));
    }
    if (u === "/api/system/info") return Promise.resolve({ home: net.home });
    if (u === "/api/settings")
      return Promise.resolve({ systemName: "Mordomo", language: "pt-BR", indexedFolders: [], areas: [] });
    return refuse(`GET ${u}`);
  };
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn(get),
      post: vi.fn((u: string) => refuse(`POST ${u}`)),
      put: vi.fn((u: string) => refuse(`PUT ${u}`)),
      patch: vi.fn((u: string) => refuse(`PATCH ${u}`)),
      del: vi.fn((u: string) => refuse(`DELETE ${u}`)),
      putSettings: vi.fn(() => refuse("PUT /api/settings")),
      streamEvents: vi.fn(() => () => undefined),
    },
  };
});
vi.setConfig({ testTimeout: 30_000 });

const NOW = new Date(2026, 10, 22, 10, 0, 0).getTime();
const MEM = `${net.home}/memory`;
const CLAUDE_CMD = "claude mcp add mordomo -- mordomo mcp";
const CURSOR_CMD = JSON.stringify(
  { mcpServers: { mordomo: { command: "mordomo", args: ["mcp"] } } },
  null,
  2,
);
const CODEX_CMD = '[mcp_servers.mordomo]\ncommand = "mordomo"\nargs = ["mcp"]';
/** C53: the 13 tools in `tools/list` order, each with its kind. */
const TOOLS: Array<[string, "read" | "propose" | "owner"]> = [
  ["recall", "read"],
  ["skills_list", "read"],
  ["skills_run", "owner"],
  ["journal_append", "propose"],
  ["facts_assert", "propose"],
  ["facts_query", "read"],
  ["note_create", "propose"],
  ["note_read", "read"],
  ["note_save", "propose"],
  ["inbox_unread", "owner"],
  ["search", "read"],
  ["links", "read"],
  ["hygiene", "read"],
];
const NO_USAGE = { since: null, calls: 0, byTool: [], byClient: [], paths: [] };
type Path = { path: string; reads: number; lastAt: number; fileId?: number };
const USAGE = {
  since: NOW - 3 * 86_400_000,
  calls: 12,
  byTool: [
    { name: "search", calls: 8, lastAt: NOW - 60_000 },
    { name: "recall", calls: 4, lastAt: NOW - 120_000 },
  ],
  byClient: [
    { name: "claude-code", calls: 9, lastAt: NOW - 5 * 60_000 },
    { name: "run:claude", calls: 3, lastAt: NOW - 2 * 3_600_000 },
  ],
  paths: [
    { path: `${MEM}/notes/onboarding.md`, reads: 5, lastAt: NOW, fileId: 41 },
    { path: `${MEM}/notes/antiga.md`, reads: 2, lastAt: NOW },
  ] as Path[],
};

function overview(over: { clients?: unknown[]; usage?: unknown } = {}) {
  return {
    clients: over.clients ?? [
      {
        id: "claude",
        name: "Claude Code",
        connected: true,
        source: "/home/ana/.claude.json",
        server: { name: "mordomo", command: "mordomo mcp" },
        command: CLAUDE_CMD,
      },
      { id: "cursor", name: "Cursor", connected: false, command: CURSOR_CMD },
      { id: "codex", name: "Codex", connected: false, command: CODEX_CMD },
    ],
    tools: TOOLS.map(([name, kind]) => ({ name, kind })),
    usage: over.usage ?? NO_USAGE,
  };
}

installPage();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  net.mcp = overview();
  net.mode = "answer";
  net.calls = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let at = "";
function Where() {
  const l = useLocation();
  at = l.pathname + l.search;
  return null;
}
async function tab(lang: Lang = "pt-BR") {
  renderWith(
    <>
      <AgentsMcpTab />
      <Where />
    </>,
    { lang },
  );
  return waitFor(() => {
    const cards = [...document.querySelectorAll(".am > .card.stack")];
    expect(cards).toHaveLength(3);
    return cards as HTMLElement[];
  });
}
const icons = (el: Element) => [...el.querySelectorAll("svg")].map((s) => s.getAttribute("class") ?? "");
const texts = (els: Iterable<Element>) => [...els].map((e) => e.textContent);
const CSS = fs.readFileSync(path.join(__dirname, "agentsMcp.css"), "utf8");
/** The declarations of `selector` outside any at-rule. */
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkRules((r) => {
    if (
      r.parent?.type === "root" &&
      r.selector
        .split(",")
        .map((x) => x.trim())
        .includes(selector)
    )
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}

/* ---------------- C101: the tab and the words that find it ---------------- */

describe("C101 the tab Agentes (MCP)", () => {
  async function page(lang: Lang) {
    renderWith(<Settings onMetaChanged={() => undefined} />, { lang });
    return screen.findByRole("tablist");
  }
  const shown = (list: HTMLElement) => texts(list.querySelectorAll('[role="tab"]'));

  it("C101 the tab sits in the group think (Como o agente pensa) right after Memória, labelled Agentes (MCP), and opens the tab under its title", async () => {
    const list = await page("pt-BR");
    const seq = texts(list.children);
    const i = seq.indexOf("Como o agente pensa");
    expect(seq.slice(i, i + 5)).toEqual([
      "Como o agente pensa",
      "Provedores",
      "Memória & pastas",
      "Agentes (MCP)",
      "Quanto pode gastar e onde escrever",
    ]);
    fireEvent.click(within(list).getByRole("tab", { name: "Agentes (MCP)" }));
    expect(document.querySelector("h2.settings-section-title")!.textContent).toBe("Agentes (MCP)");
    await waitFor(() => expect(document.querySelectorAll(".am > .card.stack")).toHaveLength(3));
    expect(net.calls).toContain("/api/mcp");
  });

  it("C101 the settings search finds it by mcp, cursor and conectar", async () => {
    const list = await page("pt-BR");
    const search = screen.getByRole("searchbox", { name: "Buscar uma configuração…" });
    fireEvent.change(search, { target: { value: "mcp" } });
    expect(shown(list)).toEqual(["Agentes (MCP)"]);
    fireEvent.change(search, { target: { value: "cursor" } });
    expect(shown(list)).toEqual(["Provedores", "Agentes (MCP)"]);
    fireEvent.change(search, { target: { value: "conectar" } });
    expect(shown(list)).toEqual(["Agentes (MCP)"]);
  });

  it("C101 in en the search finds it by connect, labelled Agents (MCP)", async () => {
    const list = await page("en");
    const search = screen.getByRole("searchbox", { name: "Find a setting…" });
    fireEvent.change(search, { target: { value: "connect" } });
    expect(shown(list)).toEqual(["Agents (MCP)"]);
  });
});

/* ---------------- C102: the card Conectar ---------------- */

describe("C102 the card Conectar", () => {
  const blocks = (card: HTMLElement) => [...card.querySelectorAll(":scope > .am-col")] as HTMLElement[];

  it("C102 one block per client in the order Claude Code, Cursor, Codex, between the support line and the closing note", async () => {
    const [connect] = await tab();
    const kids = [...connect!.children];
    expect(kids[0]!.textContent).toBe(
      "Ligue o MordomoOS ao Claude Code, ao Cursor ou ao Codex para que eles busquem e leiam o seu cérebro.",
    );
    expect(blocks(connect!).map((b) => b.querySelector("b")!.textContent)).toEqual([
      "Claude Code",
      "Cursor",
      "Codex",
    ]);
    expect(kids.at(-1)!.textContent).toBe("Depois de ligar, reabra o programa.");
    expect(kids.slice(1, -1)).toEqual(blocks(connect!));
  });

  it("C102 a connected client shows CircleCheck Ligado and its source in mono, and no command", async () => {
    const [connect] = await tab();
    const claude = blocks(connect!)[0]!;
    const state = claude.querySelector(".am-ok")!;
    expect(state.textContent).toBe("Ligado");
    expect(icons(state)).toEqual(["lucide lucide-circle-check"]);
    const source = claude.querySelector(".mono")!;
    expect(source.textContent).toBe("/home/ana/.claude.json");
    expect(claude.querySelector("pre")).toBeNull();
    expect(within(claude).queryByRole("button")).toBeNull();
  });

  it("C102 a client not connected shows CircleDashed Não ligado and its command in a pre that wraps; Cursor and Codex say where to paste it, above the pre; Claude Code does not", async () => {
    net.mcp = overview({
      clients: [
        { id: "claude", name: "Claude Code", connected: false, command: CLAUDE_CMD },
        { id: "cursor", name: "Cursor", connected: false, command: CURSOR_CMD },
        { id: "codex", name: "Codex", connected: false, command: CODEX_CMD },
      ],
    });
    const [connect] = await tab();
    const [claude, cursor, codex] = blocks(connect!);
    for (const [b, cmd] of [
      [claude!, CLAUDE_CMD],
      [cursor!, CURSOR_CMD],
      [codex!, CODEX_CMD],
    ] as const) {
      const state = within(b).getByText("Não ligado");
      expect(icons(state)).toEqual(["lucide lucide-circle-dashed"]);
      expect(b.querySelector("pre")!.textContent).toBe(cmd);
      expect(b.querySelector("pre")!.className).toBe("am-pre");
      expect(within(b).getByRole("button", { name: "Copiar" })).toBeTruthy();
      expect(b.querySelector(".am-ok")).toBeNull();
    }
    expect(claude!.textContent).not.toContain("Cole em");
    const paste = (b: HTMLElement, file: string) => {
      const line = within(b).getByText(`Cole em ${file}.`);
      expect(
        line.compareDocumentPosition(b.querySelector("pre")!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    };
    paste(cursor!, "~/.cursor/mcp.json");
    paste(codex!, "~/.codex/config.toml");
    // the pre wraps and never scrolls sideways (at 320px as at any width)
    expect(rule(".am-pre")).toMatchObject({ "white-space": "pre-wrap", "overflow-wrap": "anywhere" });
    expect(CSS).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  it("C102 Copiar writes the command to the clipboard and reads Copiado with Check for 2 s, then Copiar again", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const [connect] = await tab();
    const cursor = blocks(connect!)[1]!;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    fireEvent.click(within(cursor).getByRole("button", { name: "Copiar" }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith(CURSOR_CMD);
    const copied = within(cursor).getByRole("button", { name: "Copiado" });
    expect(icons(copied)).toEqual(["lucide lucide-check"]);
    act(() => void vi.advanceTimersByTime(1999));
    expect(within(cursor).getByRole("button", { name: "Copiado" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    const copy = within(cursor).getByRole("button", { name: "Copiar" });
    expect(icons(copy)).toEqual(["lucide lucide-copy"]);
  });

  it("C102 a client whose config file does not parse shows Não ligado, Não deu para ler <arquivo>. and the command to copy", async () => {
    net.mcp = overview({
      clients: [
        { id: "claude", name: "Claude Code", connected: false, command: CLAUDE_CMD },
        {
          id: "cursor",
          name: "Cursor",
          connected: false,
          source: "/home/ana/.cursor/mcp.json",
          unreadable: true,
          command: CURSOR_CMD,
        },
        { id: "codex", name: "Codex", connected: false, command: CODEX_CMD },
      ],
    });
    const [connect] = await tab();
    const [claude, cursor] = blocks(connect!);
    expect(within(cursor!).getByText("Não ligado")).toBeTruthy();
    expect(within(cursor!).getByText("Não deu para ler /home/ana/.cursor/mcp.json.")).toBeTruthy();
    expect(cursor!.querySelector("pre")!.textContent).toBe(CURSOR_CMD);
    expect(within(cursor!).getByRole("button", { name: "Copiar" })).toBeTruthy();
    expect(connect!.textContent!.match(/Não deu para ler/g)).toHaveLength(1);
    expect(claude!.textContent).not.toContain("Não deu para ler");
  });
});

/* ---------------- C103: the card Ferramentas ---------------- */

describe("C103 the card Ferramentas", () => {
  it("C103 the line with EyeOff, then the 13 tools in order, each with its name in mono, its short description and its mark lê, propõe (vai para a caixa de revisão) or do dono", async () => {
    const [, tools] = await tab();
    const line = tools!.children[0]!;
    expect(line.textContent).toBe(
      "As ferramentas leem como um agente: pastas escondidas dos agentes ficam de fora.",
    );
    expect(icons(line)).toEqual(["lucide lucide-eye-off"]);
    const rows = [...tools!.querySelectorAll("li")];
    expect(rows.map((r) => r.querySelector("code")!.textContent)).toEqual(TOOLS.map(([n]) => n));
    const MARK = {
      read: ["lê", "lucide lucide-eye", null],
      propose: ["propõe", "lucide lucide-inbox", "vai para a caixa de revisão"],
      owner: ["do dono", "lucide lucide-key-round", null],
    } as const;
    rows.forEach((r, i) => {
      const [name, kind] = TOOLS[i]!;
      const desc = r.querySelector(".am-s")!.textContent!;
      expect(desc.length, name).toBeGreaterThan(5);
      expect(desc, name).not.toContain("mcp.");
      const mark = r.lastElementChild!;
      expect([mark.textContent, ...icons(mark), mark.getAttribute("title")], name).toEqual(MARK[kind]);
    });
    expect(rows.map((r) => r.querySelector(".am-s")!.textContent).slice(0, 3)).toEqual([
      "As seções que valem ler para uma pergunta.",
      "O catálogo de skills.",
      "Roda uma skill.",
    ]);
    // the name is mono: the app's `code` takes the mono face
    expect(monoInTheme("code")).toBe(true);
  });
});
/** Whether `sel` takes the mono face in theme.css (`code, pre, .mono`). */
function monoInTheme(sel: string): boolean {
  const theme = fs.readFileSync(path.join(__dirname, "..", "..", "theme.css"), "utf8");
  let mono = false;
  postcss.parse(theme).walkRules((r) => {
    if (
      r.selector
        .split(",")
        .map((x) => x.trim())
        .includes(sel)
    )
      r.walkDecls("font-family", (d) => void (mono ||= d.value === "var(--font-mono)"));
  });
  return mono;
}

/* ---------------- C104: the card O que os agentes mais leem ---------------- */

describe("C104 the card O que os agentes mais leem", () => {
  it("C104 with calls 0: the title, Bot and Nenhum agente leu o cérebro ainda. only", async () => {
    const [, , usage] = await tab();
    expect(usage!.querySelector("h3")!.textContent).toBe("O que os agentes mais leem");
    expect([...usage!.children].map((c) => c.textContent)).toEqual([
      "O que os agentes mais leem",
      "Nenhum agente leu o cérebro ainda.",
    ]);
    expect(icons(usage!.children[1]!)).toEqual(["lucide lucide-bot"]);
    expect(usage!.querySelector("ul")).toBeNull();
  });

  it("C104 with usage: N leituras desde <data>, then Por ferramenta, Por programa and Mais lidos in that order", async () => {
    net.mcp = overview({ usage: USAGE });
    const [, , usage] = await tab();
    expect(usage!.textContent).not.toContain("Nenhum agente");
    const parts = [...usage!.children].map((c) => (c.tagName === "UL" ? "list" : c.textContent));
    expect(parts).toEqual([
      "O que os agentes mais leem",
      "12 leituras desde 19/11/2026",
      "Por ferramenta",
      "list",
      "Por programa",
      "list",
      "Mais lidos",
      "list",
    ]);
  });

  it("C104 Por ferramenta: one bar per tool, the largest at 100%, each with its number in text", async () => {
    net.mcp = overview({ usage: USAGE });
    const [, , usage] = await tab();
    const rows = [...usage!.querySelectorAll("ul")[0]!.children] as HTMLElement[];
    expect(rows.map((r) => [r.querySelector("code")!.textContent, r.textContent])).toEqual([
      ["search", "search8"],
      ["recall", "recall4"],
    ]);
    const fills = rows.map((r) => (r.querySelector(".am-fill") as HTMLElement).style.transform);
    expect(fills).toEqual(["scaleX(1)", "scaleX(0.5)"]);
  });

  it("C104 Por programa: the name, the number and última vez <hora>; run:claude reads Execuções do Claude", async () => {
    net.mcp = overview({ usage: USAGE });
    const [, , usage] = await tab();
    const rows = [...usage!.querySelectorAll("ul")[1]!.children];
    expect(rows.map((r) => [...r.childNodes].map((n) => n.textContent))).toEqual([
      ["claude-code", "9", "última vez há 5 minutos"],
      ["Execuções do Claude", "3", "última vez há 2 horas"],
    ]);
  });

  it("C104 Mais lidos: a line opens /brain?sel=<fileId>; a line with no fileId has no link; each with FileText, the name, the path relative to memory/ and the reads", async () => {
    net.mcp = overview({ usage: USAGE });
    const [, , usage] = await tab();
    const rows = [...usage!.querySelectorAll("ul")[2]!.children] as HTMLElement[];
    expect(rows.map((r) => [...r.firstElementChild!.childNodes].map((n) => n.textContent))).toEqual([
      ["", "onboarding.md", "notes/onboarding.md", "5"],
      ["", "antiga.md", "notes/antiga.md", "2"],
    ]);
    expect(rows.map((r) => icons(r))).toEqual([["lucide lucide-file-text"], ["lucide lucide-file-text"]]);
    expect(rows[1]!.querySelector("a")).toBeNull();
    const link = within(rows[0]!).getByRole("link");
    expect(link.getAttribute("href")).toBe("/brain?sel=41");
    fireEvent.click(link);
    expect(at).toBe("/brain?sel=41");
  });

  it("C104 Mais lidos shows up to 20 lines: 20 of 20, 20 of 21, and 1 of 1", async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: `${MEM}/n${i}.md`,
        reads: 30 - i,
        lastAt: NOW,
        fileId: i + 1,
      }));
    for (const [given, seen] of [
      [20, 20],
      [21, 20],
      [1, 1],
    ] as const) {
      net.mcp = overview({ usage: { ...USAGE, paths: many(given) } });
      const [, , usage] = await tab();
      const rows = [...usage!.querySelectorAll("ul")[2]!.children];
      expect(rows, `${given}`).toHaveLength(seen);
      expect(rows[0]!.textContent).toBe("n0.mdn0.md30");
      cleanup();
    }
  });
});

/* ---------------- C105: loading and error ---------------- */

describe("C105 loading and error", () => {
  it("C105 while GET /api/mcp loads, the settings skeleton", async () => {
    net.mode = "pending";
    renderWith(<AgentsMcpTab />, { lang: "pt-BR" });
    const sk = await screen.findByRole("status", { name: "Carregando…" });
    expect(sk.className).toBe("skeleton");
    expect(sk.querySelectorAll(".skeleton-line")).toHaveLength(8);
    expect(document.querySelector(".am")).toBeNull();
  });

  it("C105 GET /api/mcp failing shows the settings error line Não deu para carregar os agentes. with Tentar de novo, which fetches again", async () => {
    net.mode = "fail";
    renderWith(<AgentsMcpTab />, { lang: "pt-BR" });
    const alert = (await screen.findByText("Não deu para carregar os agentes.")).closest<HTMLElement>(
      '[role="alert"]',
    )!;
    expect(alert.className).toContain("error-box");
    expect(alert.textContent).toBe("Não deu para carregar os agentes.Tentar de novo");
    expect(document.querySelector(".am")).toBeNull();
    const before = net.calls.filter((c) => c === "/api/mcp").length;
    net.mode = "answer";
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(document.querySelectorAll(".am > .card.stack")).toHaveLength(3));
    expect(net.calls.filter((c) => c === "/api/mcp").length).toBe(before + 1);
    expect(document.querySelector(".error-box")).toBeNull();
  });
});

/* ---------------- C106: the copy ---------------- */

const DESIGN = path.resolve(__dirname, "../../../../../.specs/features/cerebro-perguntar/design.md");
const design = fs.readFileSync(DESIGN, "utf8");
const textAt = design.indexOf("\n## Texto");
const section = design.slice(
  textAt,
  design.indexOf("\n## ", textAt + 1) < 0 ? undefined : design.indexOf("\n## ", textAt + 1),
);
/** The `| Onde | pt-BR | en |` rows of the section, from the tab's ("aba") to the end. */
function tabRows(): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const line of section.split("\n")) {
    const cells = line.trim().startsWith("|")
      ? line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
      : null;
    if (!cells || cells.length !== 3 || cells[1] === "pt-BR" || /^-+$/.test(cells[0]!)) continue;
    out.push([cells[0]!, cells[1]!, cells[2]!]);
  }
  return out.slice(out.findIndex(([where]) => where === "aba"));
}
const ROWS = tabRows();
type Dict = Record<string, string>;
const en = apps.en as unknown as Dict;
const pt = apps.ptBR as unknown as Dict;
const TAB_KEYS = Object.keys(en).filter(
  (k) => k.startsWith("mcp.") || k === "settings.agentsMcp" || k === "settings.keys.agentsMcp",
);

describe("C106 the tab's copy", () => {
  it("C106 the table holds the tab's five rows", () => {
    expect(ROWS.map(([where]) => where)).toEqual(["aba", "conectar", "ferramentas", "uso", "erro da aba"]);
  });

  it.each(ROWS)(
    "C106 %s: each string of %s · %s is a key of en and ptBR in locales/apps.ts, byte-equal",
    (_w, p, e) => {
      const ps = p.split(" · ");
      const es = e.split(" · ");
      expect(es.length).toBe(ps.length);
      ps.forEach((one, i) => {
        const keys = TAB_KEYS.filter((k) => pt[k] === one && en[k] === es[i]);
        expect(keys, `${one} | ${es[i]}`).toHaveLength(1);
      });
    },
  );

  it("C106 both locales hold the same keys; every key of the tab is a string of the table or a tool's description, and none is unused", () => {
    expect(Object.keys(apps.ptBR).sort()).toEqual(Object.keys(apps.en).sort());
    const table = new Set(
      ROWS.flatMap(([, p, e]) => {
        const es = e.split(" · ");
        return p.split(" · ").flatMap((one, i) => TAB_KEYS.filter((k) => pt[k] === one && en[k] === es[i]));
      }),
    );
    // design.md "Ferramentas" asks for a short description per tool and its table gives none: one key per tool of C53
    expect(TAB_KEYS.filter((k) => !table.has(k)).sort()).toEqual(TOOLS.map(([n]) => `mcp.tool.${n}`).sort());
    for (const [n] of TOOLS) expect(pt[`mcp.tool.${n}`]!.length, n).toBeGreaterThan(5);
    const tree = loadTree();
    const spelled = spelledIn(
      tree,
      productionFiles(tree),
      (f) => f === "i18n.ts" || f.startsWith("locales/"),
    );
    const used = (k: string) =>
      spelled.words.has(k) ||
      [...spelled.prefixes].some((pre) => pre.startsWith("mcp.") && k.startsWith(pre));
    expect(TAB_KEYS.filter((k) => !used(k))).toEqual([]);
    expect([...spelled.prefixes].filter((pre) => pre.startsWith("mcp.")).sort()).toEqual([
      "mcp.kind.",
      "mcp.tool.",
    ]);
  });

  it("C106 en: the tab reads the table's English strings", async () => {
    net.mcp = overview({ usage: USAGE });
    const [connect, tools, usage] = await tab("en");
    expect(connect!.textContent).toContain("Connected");
    expect(connect!.textContent).toContain("Paste into ~/.cursor/mcp.json.");
    expect(tools!.textContent).toContain("owner's");
    expect(usage!.textContent).toContain("12 reads since 19/11/2026");
    expect(usage!.textContent).toContain("Claude runs");
    expect(usage!.textContent).toContain("last 5 minutes ago");
  });
});

/* ---------------- C108: the bars' motion ---------------- */

describe("C108 the bars of Por ferramenta", () => {
  /** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)`. */
  function outside(): string[] {
    const out: string[] = [];
    postcss.parse(CSS).walkDecls(/^(animation|transition)(-[a-z-]+)?$/, (d) => {
      for (let p: postcss.Container | postcss.Document | undefined = d.parent; p; p = p.parent)
        if (
          p.type === "atrule" &&
          /prefers-reduced-motion:\s*no-preference/.test((p as postcss.AtRule).params)
        )
          return;
      out.push(`${(d.parent as postcss.Rule).selector} { ${d.prop}: ${d.value} }`);
    });
    return out;
  }

  it("C108 the bar grows from the left with transform: scaleX in 240 ms ease-out, inside no-preference", () => {
    const inside: Record<string, string> = {};
    let from: Record<string, string> = {};
    postcss.parse(CSS).walkAtRules("media", (m) => {
      if (!/prefers-reduced-motion:\s*no-preference/.test(m.params)) return;
      m.walkRules(".am-fill", (r) => r.walkDecls((d) => void (inside[d.prop] = d.value)));
      m.walkAtRules("keyframes", (k) => {
        if (inside.animation?.startsWith(`${k.params} `))
          k.walkRules("from", (r) => r.walkDecls((d) => void (from = { ...from, [d.prop]: d.value })));
      });
    });
    expect(inside).toEqual({ animation: "am-grow 240ms ease-out" });
    expect(from).toEqual({ transform: "scaleX(0)" });
    expect(rule(".am-fill")["transform-origin"]).toBe("left center");
  });

  it("C108 with reduce nothing moves: no animation or transition outside no-preference, and each bar is drawn at its value", async () => {
    expect(outside()).toEqual([]);
    expect(rule(".am-fill").animation).toBeUndefined();
    net.mcp = overview({ usage: USAGE });
    const [, , usage] = await tab();
    expect([...usage!.querySelectorAll<HTMLElement>(".am-fill")].map((f) => f.style.transform)).toEqual([
      "scaleX(1)",
      "scaleX(0.5)",
    ]);
  });
});
