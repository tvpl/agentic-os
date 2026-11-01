import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../core/src/db/db.js";
import { resolvePaths, ensureDirs } from "../core/src/paths.js";
import {
  FactValidationError,
  assertFact,
  factKey,
  overlapAction,
  provenanceRefusal,
  queryFacts,
} from "../core/src/memory/facts.js";
import {
  MIN_VERSIONS_KEPT,
  enforceByteCap,
  isVersionedPath,
  recordVersion,
  storedBlobBytes,
} from "../core/src/memory/historyStore.js";
import { SettingsSchema } from "../core/src/config/schema.js";
import {
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
  applyOps,
  evaluateOps,
  opTrust,
  withinBudget,
} from "../core/src/memory/proposals.js";
import { ProposalFileSchema, type ProposalOp } from "@mordomo/contracts";
import { readScope } from "../core/src/security/safeFs.js";
import { setAsideAndWrite, workspaceEntryKind, workspaceLinkTarget } from "../core/src/security/safeWrite.js";
import { resolveFolderAccess } from "../core/src/memory/folderAccess.js";
import { accessExclude, makeWorkspaceFilter } from "../core/src/memory/excludes.js";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { FAKE_BIN, withFakeBinPath } from "./helpers.js";

/**
 * .specs/features/cerebro-memoria-confiavel, the deciding code at its own layer (checks.md, Test policy rows 1 and 2),
 * with no HTTP. Batch A1: `factKey` (door 1), the overlap rule (door 2), the provenance rule (door 3), the policy filter
 * of facts (AC 20), the versioned-path rule and the retention of the history (door 4). The HTTP side of each is in
 * `memoria.facts.test.ts` and `memoria.history.test.ts`.
 */

type Json = Record<string, any>;

const DAY = 86_400_000;
const T = Date.UTC(2026, 5, 1);
const U = Date.UTC(2026, 6, 1);

let home: string;
let db: Db;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-memoria-layer-"));
  const paths = resolvePaths(home);
  ensureDirs(paths);
  db = openDb(paths).db;
});
afterAll(() => {
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

// ---- door 1 ------------------------------------------------------------------------------------------------------

describe("C1 factKey", () => {
  for (const [input, key] of [
    ["Cliente  São Paulo", "cliente sao paulo"],
    ["cliente sao paulo", "cliente sao paulo"],
    ["CLIENTE SÃO PAULO", "cliente sao paulo"],
    ["  Ação\t\n X ", "acao x"],
    ["Ångström", "angstrom"],
    ["ﬁm", "fim"],
  ] as const) {
    it(`C1 ${JSON.stringify(input)} → ${JSON.stringify(key)}`, () => {
      expect(factKey(input)).toBe(key);
    });
  }

  it("C1 a subject or predicate that is empty after trimming is refused", () => {
    expect(factKey("  \t ")).toBe("");
    expect(() => assertFact(db, { subject: "  \t ", predicate: "p", object: "o" })).toThrow(
      FactValidationError,
    );
    expect(() => assertFact(db, { subject: "s", predicate: "   ", object: "o" })).toThrow(
      FactValidationError,
    );
  });
});

// ---- door 2 ------------------------------------------------------------------------------------------------------

describe("C8 begins before T and overlaps → valid_to = T", () => {
  it("C8 from T − 1 day, open, against [T, ∞)", () => {
    expect(overlapAction({ validFrom: T - DAY, validTo: null }, T, null)).toBe("close");
  });
  it("C8 from T − 1 ms, open, against [T, ∞)", () => {
    expect(overlapAction({ validFrom: T - 1, validTo: null }, T, null)).toBe("close");
  });
  it("C8 from T − 1 day to T + 1 day, against [T, U)", () => {
    expect(overlapAction({ validFrom: T - DAY, validTo: T + DAY }, T, U)).toBe("close");
  });
});

describe("C9 begins at or after U → unchanged", () => {
  it("C9 from exactly U, against [T, U)", () => {
    expect(overlapAction({ validFrom: U, validTo: null }, T, U)).toBe("keep");
  });
  it("C9 from U + 1 day, against [T, U)", () => {
    expect(overlapAction({ validFrom: U + DAY, validTo: null }, T, U)).toBe("keep");
  });
});

describe("C10 begins at or after T, overlaps, the new one has no U → retracted_at = now", () => {
  it("C10 from exactly T", () => {
    expect(overlapAction({ validFrom: T, validTo: null }, T, null)).toBe("retract");
  });
  it("C10 from T + 1 day, closed later", () => {
    expect(overlapAction({ validFrom: T + DAY, validTo: T + 2 * DAY }, T, null)).toBe("retract");
  });
  it("C10 from T − 1 ms is closed instead", () => {
    expect(overlapAction({ validFrom: T - 1, validTo: null }, T, null)).toBe("close");
  });
});

describe("C11 the door-2 table, one case per row", () => {
  it("C11 begins before T and overlaps → close", () => {
    expect(overlapAction({ validFrom: T - DAY, validTo: U }, T, U)).toBe("close");
  });
  it("C11 begins at or after T, overlaps, the new one without U → retract", () => {
    expect(overlapAction({ validFrom: T + 1, validTo: null }, T, null)).toBe("retract");
  });
  it("C11 begins at or after U → keep", () => {
    expect(overlapAction({ validFrom: U, validTo: U + DAY }, T, U)).toBe("keep");
  });
  it("C11 the new one strictly inside (the old begins before T and ends after U, or never) → refuse", () => {
    expect(overlapAction({ validFrom: T - 1, validTo: null }, T, U)).toBe("refuse");
    expect(overlapAction({ validFrom: T - 1, validTo: U + 1 }, T, U)).toBe("refuse");
  });
  it("C11 an old fact that ended before T does not overlap → keep", () => {
    expect(overlapAction({ validFrom: T - 2 * DAY, validTo: T }, T, null)).toBe("keep");
  });
});

// ---- door 3 ------------------------------------------------------------------------------------------------------

describe("C17 the provenance rule", () => {
  const cases: Array<[string, Parameters<typeof provenanceRefusal>[0], "provenance_required" | null]> = [
    ["no source, author owner → accepted", { author: "owner" }, null],
    ["only sourcePath, author run:r-1 → accepted", { author: "run:r-1", sourcePath: "/m/a.md" }, null],
    ["only sourceRunId, author run:r-1 → accepted", { author: "run:r-1", sourceRunId: "r-1" }, null],
    ["only proposalId, author mcp → accepted", { author: "mcp", proposalId: "mp_0123456789abcdef" }, null],
    ["none, author mcp → provenance_required", { author: "mcp" }, "provenance_required"],
    ["none, author unknown → provenance_required", { author: "unknown" }, "provenance_required"],
    ["none, author run:r-1 → provenance_required", { author: "run:r-1" }, "provenance_required"],
  ];
  for (const [name, input, verdict] of cases) {
    it(`C17 ${name}`, () => {
      expect(provenanceRefusal(input)).toBe(verdict);
    });
  }
  it("C17 assertFact refuses each refused case with provenance_required and writes nothing", () => {
    const before = db.prepare("SELECT COUNT(*) c FROM facts").get();
    for (const author of ["mcp", "unknown", "run:r-1"] as const) {
      expect(() => assertFact(db, { subject: "Prov", predicate: "p", object: author, author })).toThrow(
        expect.objectContaining({ statusCode: 400, code: "provenance_required" }),
      );
    }
    expect(db.prepare("SELECT COUNT(*) c FROM facts").get()).toEqual(before);
    expect(
      assertFact(db, { subject: "Prov", predicate: "p", object: "x", author: "mcp", proposalId: "mp_1" }).fact
        .author,
    ).toBe("mcp");
  });
});

// ---- AC 20 -------------------------------------------------------------------------------------------------------

describe("C20 the policy filter of facts fails closed", () => {
  it("C20 a fact whose policy function throws is left out; the others are kept", () => {
    const a = assertFact(db, {
      subject: "Filtro a",
      predicate: "p",
      object: "x",
      sourcePath: "/m/a.md",
    }).fact;
    const b = assertFact(db, {
      subject: "Filtro b",
      predicate: "p",
      object: "x",
      sourcePath: "/m/b.md",
    }).fact;
    const shown = queryFacts(db, {
      limit: 2000,
      allow: (f: Json) => {
        if (f.id === a.id) throw new Error("no verdict");
        return true;
      },
    }).map((f) => f.id);
    expect(shown).toContain(b.id);
    expect(shown).not.toContain(a.id);
  });
});

describe("settled mid-build: a closed new fact over the start of an old one", () => {
  it("an old fact that begins inside [T, U) is refused (the door-2 table has no row for it; nothing is invented)", () => {
    expect(overlapAction({ validFrom: T + DAY, validTo: null }, T, U)).toBe("refuse");
    expect(overlapAction({ validFrom: T, validTo: U - 1 }, T, U)).toBe("refuse");
  });
});

// ---- door 4 ------------------------------------------------------------------------------------------------------

describe("C25 the versioned-path rule", () => {
  const cases: Array<[string, number, boolean]> = [
    ["MEMORY.md", 10, true],
    ["notes/a.md", 10, true],
    ["topics/x.md", 10, true],
    ["archive/x.md", 10, true],
    ["notes/journal/x.md", 10, true],
    ["notes/areas/x.md", 10, true],
    ["notes/contexts/x.md", 10, true],
    ["notes/ROUTER.md", 10, true],
    ["notes/exato.md", 1_048_576, true],
    ["journal/2026-10-31.md", 10, false],
    ["areas/a.md", 10, false],
    ["contexts/c.md", 10, false],
    ["ROUTER.md", 10, false],
    ["notes/a.txt", 10, false],
    ["notes/b.json", 10, false],
    ["notes/grande.md", 1_048_577, false],
    ["../fora/fora.md", 10, false],
  ];
  for (const [rel, size, verdict] of cases) {
    it(`C25 ${rel} of ${size} bytes → ${verdict ? "versioned" : "not versioned"}`, () => {
      expect(isVersionedPath(rel, size)).toBe(verdict);
    });
  }
});

describe("C28 the retention by bytes", () => {
  const fresh = () => {
    db.exec("DELETE FROM memory_versions; DELETE FROM memory_blobs;");
  };
  const put = (rel: string, n: number) =>
    recordVersion(
      db,
      { rel, bytes: Buffer.from(`${rel} ${n} ${"x".repeat(50)}`), author: "owner", origin: "save" },
      Number.MAX_SAFE_INTEGER,
    );
  const ids = (rel: string) =>
    (
      db.prepare("SELECT id FROM memory_versions WHERE path = ? ORDER BY id").all(rel) as Array<{
        id: number;
      }>
    ).map((r) => r.id);

  it("C28 above the cap the oldest versions outside the newest 5 of their path go, oldest first, until the store fits; blobs no version names go", () => {
    fresh();
    for (let i = 0; i < 8; i++) put("notes/a.md", i);
    for (let i = 0; i < 3; i++) put("notes/b.md", i);
    const a = ids("notes/a.md");
    const b = ids("notes/b.md");
    const total = storedBlobBytes(db);
    const one = total / 11;
    enforceByteCap(db, Math.floor(total - 1.5 * one));
    // two of a's oldest go (the first alone does not fit); b, with 3, keeps all
    expect(ids("notes/a.md")).toEqual(a.slice(2));
    expect(ids("notes/b.md")).toEqual(b);
    const orphans = db
      .prepare(
        "SELECT COUNT(*) c FROM memory_blobs WHERE sha256 NOT IN (SELECT sha256 FROM memory_versions WHERE sha256 IS NOT NULL)",
      )
      .get() as { c: number };
    expect(orphans.c).toBe(0);
  });

  it("C28 the floor: a path with only its newest 5 is never cut, even above the cap", () => {
    fresh();
    for (let i = 0; i < MIN_VERSIONS_KEPT; i++) put("notes/a.md", i);
    const a = ids("notes/a.md");
    enforceByteCap(db, 1);
    expect(ids("notes/a.md")).toEqual(a);
  });

  it("C28 a store exactly at the cap drops nothing; one byte under it drops", () => {
    fresh();
    for (let i = 0; i < 7; i++) put("notes/a.md", i);
    const a = ids("notes/a.md");
    const total = storedBlobBytes(db);
    enforceByteCap(db, total);
    expect(ids("notes/a.md")).toEqual(a);
    enforceByteCap(db, total - 1);
    expect(ids("notes/a.md")).toEqual(a.slice(1));
  });
});

// ---- batch A2: the proposals (doors 6 and 7, AC 55, 56, 62) ------------------------------------------------------

/** A memory/ of its own for the op checks: a journal day (line 4 the owner's, 5 an agent's, 9 under ## Runs), a note. */
function opsHome(excludes: string[] = []) {
  const paths = resolvePaths(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-memoria-ops-")));
  ensureDirs(paths);
  const put = (rel: string, text: string) => {
    const file = path.join(paths.memory, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  put(
    "journal/2026-10-30.md",
    "# 2026-10-30\n## Decisions\n\n- Turmas de 20\n- Sugestão (autor:: agente)\n\n## Runs\n\n- run r-1 → done\n",
  );
  put("notes/cliente.md", "# Cliente\n\n## Contrato\n\n- Renovação em março\n");
  put("privado/segredo.md", "- segredo\n");
  fs.writeFileSync(path.join(paths.home, "fora.md"), "- fora\n");
  const settings = SettingsSchema.parse({ excludes });
  return { env: { paths, settings }, done: () => fs.rmSync(paths.home, { recursive: true, force: true }) };
}

const addOp = (source: string, line?: number) =>
  ({ op: "add", section: "Decisions", text: "x", source, ...(line !== undefined ? { line } : {}) }) as const;

describe("C51 the source check of an op", () => {
  it("C51 a missing file, line count + 1, an excluded folder and ../fora.md are each invalid; the last line is valid", () => {
    const { env, done } = opsHome(["privado"]);
    try {
      const views = evaluateOps(
        env as never,
        [
          addOp("notes/nao-existe.md", 1),
          addOp("journal/2026-10-30.md", 10),
          addOp("journal/2026-10-30.md", 9),
          addOp("privado/segredo.md", 1),
          addOp("../fora.md", 1),
        ],
        null,
      );
      expect(views.map((v) => v.state)).toEqual(["invalid", "invalid", "valid", "invalid", "invalid"]);
      expect(views[0]!.reason).toMatch(/does not exist/);
      expect(views[1]!.reason).toMatch(/9 lines; line 10/);
      expect(views[3]!.reason).toMatch(/policy/);
      expect(views[4]!.reason).toMatch(/not a file under memory/);
    } finally {
      done();
    }
  });

  it("C51 the same excluded file is valid when the policy lets it be read (the refusal is the policy's)", () => {
    const { env, done } = opsHome([]);
    try {
      expect(evaluateOps(env as never, [addOp("privado/segredo.md", 1)], null)[0]!.state).toBe("valid");
    } finally {
      done();
    }
  });
});

describe("C52 the trust rule", () => {
  it("C52 a journal Decisions line of the owner is usuario", () => {
    expect(
      opTrust({ path: "journal/2026-10-30.md", line: 4, text: "- Turmas de 20", section: "Decisions" }),
    ).toBe("usuario");
  });
  it("C52 a line of notes/cliente.md is usuario", () => {
    expect(
      opTrust({ path: "notes/cliente.md", line: 5, text: "- Renovação em março", section: "Contrato" }),
    ).toBe("usuario");
  });
  it("C52 a journal line under ## Runs is ferramenta", () => {
    expect(
      opTrust({ path: "journal/2026-10-30.md", line: 9, text: "- run r-1 → done", section: "Runs" }),
    ).toBe("ferramenta");
  });
  it("C52 a journal line ending (autor:: agente) is inferido", () => {
    expect(
      opTrust({
        path: "journal/2026-10-30.md",
        line: 5,
        text: "- Sugestão (autor:: agente)",
        section: "Decisions",
      }),
    ).toBe("inferido");
  });
  it("C52 an op with no line is inferido", () => {
    expect(opTrust({ path: "journal/2026-10-30.md", line: null, text: null, section: null })).toBe(
      "inferido",
    );
  });
  it("C52 a line of MEMORY.md itself is inferido", () => {
    expect(opTrust({ path: "MEMORY.md", line: 5, text: "- O curso custa 700", section: "Facts" })).toBe(
      "inferido",
    );
  });
  it("C52 a trust the agent writes into the op is ignored (evaluateOps computes it from the line)", () => {
    const { env, done } = opsHome();
    try {
      const op = { ...addOp("journal/2026-10-30.md", 5), trust: "usuario" };
      expect(evaluateOps(env as never, [op as never], null)[0]!.trust).toBe("inferido");
      expect(evaluateOps(env as never, [addOp("journal/2026-10-30.md", 9)], null)[0]!.trust).toBe(
        "ferramenta",
      );
      expect(evaluateOps(env as never, [addOp("notes/cliente.md#Contrato", 5)], null)[0]!.trust).toBe(
        "usuario",
      );
    } finally {
      done();
    }
  });
});

describe("C59 the ceiling of MEMORY.md", () => {
  /** A text of exactly `lines` lines and `bytes` bytes. */
  const text = (lines: number, bytes: number) => {
    const rows = Array.from({ length: lines }, (_, i) => `l${i}`);
    const short = `${rows.join("\n")}\n`;
    rows[rows.length - 1] += "x".repeat(bytes - Buffer.byteLength(short));
    const out = `${rows.join("\n")}\n`;
    expect([out.split("\n").length - 1, Buffer.byteLength(out)]).toEqual([lines, bytes]);
    return out;
  };
  it("C59 201 lines and 24 000 bytes over a file of 150 lines is over", () => {
    expect(withinBudget(text(150, 20_000), text(201, 24_000))).toBe(false);
  });
  it("C59 180 lines and 25 001 bytes is over", () => {
    expect(withinBudget(text(170, 20_000), text(180, 25_001))).toBe(false);
  });
  it("C59 exactly 200 lines and 25 000 bytes is within", () => {
    expect([MEMORY_MAX_LINES, MEMORY_MAX_BYTES]).toEqual([200, 25_000]);
    expect(withinBudget(text(150, 20_000), text(200, 25_000))).toBe(true);
    expect(withinBudget(null, text(200, 25_000))).toBe(true);
  });
  it("C59 220 lines over a file of 230 is accepted (smaller than now)", () => {
    expect(withinBudget(text(230, 30_000), text(220, 29_000))).toBe(true);
    // and above the ceiling with no file before it, it is not
    expect(withinBudget(null, text(220, 29_000))).toBe(false);
  });
});

// ---- batch B1: the folder-level resolver of door 12 and the deny rules of door 13, at their own layer ---------------

describe("the folder-level resolver (door 12), one asserted case per row", () => {
  let root: string;
  let memory: string;
  const access = (entries: unknown) =>
    resolveFolderAccess({
      paths: resolvePaths(root),
      settings: { ...SettingsSchema.parse({}), folderAccess: entries } as never,
    });
  const both = (a: ReturnType<typeof access>, file: string) => ({
    agents: a.level(file, "agents"),
    devices: a.level(file, "devices"),
  });
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-access-layer-")));
    memory = path.join(root, "memory");
    for (const dir of ["notes/fin", "notes/fin2", "notes/outra"])
      fs.mkdirSync(path.join(memory, dir), { recursive: true });
    fs.symlinkSync(path.join(memory, "notes", "fin"), path.join(memory, "atalho-fin"));
    // A link that points at itself: its real path cannot be resolved (ELOOP).
    fs.symlinkSync(path.join(memory, "notes", "laco"), path.join(memory, "notes", "laco"));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("C110 no entry: write for both audiences", () => {
    expect(both(access([]), path.join(memory, "notes", "fin", "a.md"))).toEqual({
      agents: "write",
      devices: "write",
    });
  });

  it("C110 the longest entry decides: notes/fin/ is hide, notes/outra/ is read, notes/fin2/ is read (the separator)", () => {
    const a = access([
      { path: path.join(memory, "notes"), agents: "read", devices: "read" },
      { path: path.join(memory, "notes", "fin"), agents: "hide", devices: "hide" },
    ]);
    expect(both(a, path.join(memory, "notes", "fin", "a.md"))).toEqual({ agents: "hide", devices: "hide" });
    expect(both(a, path.join(memory, "notes", "fin"))).toEqual({ agents: "hide", devices: "hide" });
    expect(both(a, path.join(memory, "notes", "outra", "b.md"))).toEqual({ agents: "read", devices: "read" });
    expect(both(a, path.join(memory, "notes", "fin2", "c.md"))).toEqual({ agents: "read", devices: "read" });
    // outside every entry, as before
    expect(both(a, path.join(memory, "MEMORY.md"))).toEqual({ agents: "write", devices: "write" });
  });

  it("C110 an entry written through a link to notes/fin decides for notes/fin/ by its real path", () => {
    const a = access([{ path: path.join(memory, "atalho-fin"), agents: "read", devices: "hide" }]);
    expect(a.entries[0]!.real).toBe(path.join(memory, "notes", "fin"));
    expect(both(a, path.join(memory, "notes", "fin", "a.md"))).toEqual({ agents: "read", devices: "hide" });
    expect(both(a, path.join(memory, "notes", "outra", "b.md"))).toEqual({
      agents: "write",
      devices: "write",
    });
  });

  it("C111 an entry with a level this version cannot read is hide for both audiences", () => {
    const a = access([{ path: path.join(memory, "notes", "fin"), agents: "read", devices: "secret" }]);
    expect(both(a, path.join(memory, "notes", "fin", "a.md"))).toEqual({ agents: "hide", devices: "hide" });
    expect(both(a, path.join(memory, "notes", "outra", "b.md"))).toEqual({
      agents: "write",
      devices: "write",
    });
  });

  it("C111 an entry whose path cannot be resolved (a link loop) is hide for both and covers its lexical path (G17)", () => {
    const loop = path.join(memory, "notes", "laco");
    const a = access([{ path: loop, agents: "write", devices: "read" }]);
    expect(a.entries[0]!.real).toBeNull();
    expect(a.entries[0]!.spellings).toEqual([loop]);
    expect(both(a, path.join(loop, "a.md"))).toEqual({ agents: "hide", devices: "hide" });
    expect(both(a, loop)).toEqual({ agents: "hide", devices: "hide" });
    // it covers its own path, not its siblings
    expect(both(a, path.join(memory, "notes", "outra", "b.md"))).toEqual({
      agents: "write",
      devices: "write",
    });
  });

  it("C111 an entry for a folder that is not there is hide for both, covering its lexical path (G17)", () => {
    const gone = path.join(memory, "notes", "ainda-nao");
    const a = access([{ path: gone, agents: "write", devices: "write" }]);
    expect(both(a, path.join(gone, "a.md"))).toEqual({ agents: "hide", devices: "hide" });
  });

  it("a list that cannot be read is hide for devices and read for agents on every path (AC 90, beside C112)", () => {
    for (const unreadable of ["x", {}, 7, null]) {
      const a = access(unreadable);
      expect(a.unreadable, JSON.stringify(unreadable)).toBe(true);
      expect(both(a, path.join(memory, "notes", "outra", "b.md"))).toEqual({
        agents: "read",
        devices: "hide",
      });
      expect(both(a, path.join(os.tmpdir(), "anywhere", "c.md"))).toEqual({
        agents: "read",
        devices: "hide",
      });
    }
    // what the settings store reads an unreadable list as (`failClosed.ts`) gives the same levels
    const closed = access([{ path: "*", agents: "read", devices: "hide" }]);
    expect(both(closed, path.join(memory, "notes", "outra", "b.md"))).toEqual({
      agents: "read",
      devices: "hide",
    });
  });

  it("an entry whose path is relative or not a string names no folder: every path is hide for both, beside an entry that says write (AC 89, G17, C112; round 1 finding 7)", () => {
    for (const bad of [
      { path: "relativo/fin", agents: "write", devices: "write" },
      { path: 7 },
      { path: null },
      "texto",
    ]) {
      const a = access([{ path: memory, agents: "write", devices: "write" }, bad]);
      expect(a.unreadable, JSON.stringify(bad)).toBe(false);
      for (const file of [
        path.join(memory, "notes", "outra", "b.md"),
        path.join(os.tmpdir(), "anywhere", "c.md"),
      ]) {
        expect(both(a, file), JSON.stringify(bad)).toEqual({ agents: "hide", devices: "hide" });
      }
    }
  });

  it("C110 the workspace filter of a view refuses what the resolver hides and nothing else", () => {
    const a = access([
      { path: path.join(memory, "notes"), agents: "read", devices: "read" },
      { path: path.join(memory, "notes", "fin"), agents: "hide", devices: "write" },
    ]);
    const filter = makeWorkspaceFilter([accessExclude({ rules: a.rules("agents"), deny: [] })], {
      homeDir: root,
    });
    expect(filter.isExcluded("notes/fin/a.md", path.join(memory, "notes", "fin", "a.md"))).toBe(true);
    expect(filter.isExcluded("notes/fin2/c.md", path.join(memory, "notes", "fin2", "c.md"))).toBe(false);
    expect(filter.isExcluded("notes/outra/b.md", path.join(memory, "notes", "outra", "b.md"))).toBe(false);
    // no absolute path to judge by: refused (fail closed)
    expect(filter.isExcluded("notes/outra/b.md")).toBe(true);
    // the devices' rules hide nothing here
    const devices = makeWorkspaceFilter([accessExclude({ rules: a.rules("devices"), deny: [] })], {
      homeDir: root,
    });
    expect(devices.isExcluded("notes/fin/a.md", path.join(memory, "notes", "fin", "a.md"))).toBe(false);
    // a mark that cannot be read hides every path
    const broken = makeWorkspaceFilter(["\u0000folder-access:{not json"], { homeDir: root });
    expect(broken.isExcluded("notes/outra/b.md", path.join(memory, "notes", "outra", "b.md"))).toBe(true);
  });
});

describe("the deny rules of door 13 in the Claude adapter, in each mode it builds", () => {
  const fin = "/tmp/mordomo-home/memory/notes/fin";
  const rules = [
    `Read(/${fin}/**)`,
    `Grep(/${fin}/**)`,
    `Glob(/${fin}/**)`,
    `Edit(/${fin}/**)`,
    `Write(/${fin}/**)`,
  ];
  const adapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
  let restorePath: () => void;
  beforeAll(() => {
    restorePath = withFakeBinPath();
  });
  afterAll(() => restorePath());
  const run = (overrides: Partial<AgentRun>): AgentRun => ({
    runId: `layer-${Math.random().toString(36).slice(2)}`,
    prompt: "go",
    cwd: "/tmp/mordomo-home/memory",
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 20_000,
    profile: "read_only",
    artifactsDir: "/tmp/mordomo-home/artifacts/x",
    ...overrides,
  });
  const denied = (args: string[]): string[] =>
    args.flatMap((arg, i) => (args[i - 1] === "--disallowedTools" ? arg.split(",") : []));
  const modes: Array<[string, Partial<AgentRun>]> = [
    ["read_only", { mode: "read_only" }],
    [
      "write with the permission broker",
      {
        mode: "write",
        profile: "controlled_write",
        permissionBroker: { command: "node", args: ["broker.js"], env: {} },
      },
    ],
    ["write with acceptEdits", { mode: "write", profile: "controlled_write" }],
  ];
  for (const [name, overrides] of modes) {
    it(`C126 ${name}: the five rules for the hidden folder, and none without one`, async () => {
      const withHidden = await adapter.buildInvocation(run({ ...overrides, hiddenDirs: [fin] }));
      expect(denied(withHidden.args)).toEqual(expect.arrayContaining(rules));
      const without = await adapter.buildInvocation(run(overrides));
      expect(denied(without.args).filter((r) => r.includes(fin))).toEqual([]);
      expect(without.args.join(" ")).not.toContain(fin);
    });
  }
});

// ---- Test policy row 1: the proposal.json schema and the op applier, at their own layer (round 1, finding 8) ---------

describe("the proposal.json schema (door 6), one asserted case per row", () => {
  const add = {
    op: "add",
    section: "Decisions",
    text: "Uma linha",
    source: "journal/2026-10-30.md",
    line: 4,
  };
  const good = (extra: Json = {}) => ({ v: 1, summary: "Um resumo", ops: [add], ...extra });
  /** The path of the one issue the schema reports, or null when it takes the file. */
  const issue = (file: unknown): string | null => {
    const r = ProposalFileSchema.safeParse(file);
    if (r.success) return null;
    // one place is wrong (a value can fail two rules of the same place, as a date that is not even a pattern)
    const places = [...new Set(r.error.issues.map((i) => i.path.join(".")))];
    expect(places, JSON.stringify(file).slice(0, 80)).toHaveLength(1);
    return places[0]!;
  };

  it("takes one file of each op kind, and the edges: a summary of 2 000, a text of 500, 200 ops, one op, none", () => {
    const ops = [
      add,
      { op: "supersede", old: "- Turmas de 15", text: "Turmas de 20", source: "journal/2026-10-30.md" },
      {
        op: "close_loop",
        old: "- Lançar a turma",
        on: "2026-10-30",
        source: "journal/2026-10-30.md",
        line: 9,
      },
      { op: "move_to_topic", lines: ["- A", "- B"], topic: "clientes-2026" },
      {
        op: "fact",
        subject: "turma",
        predicate: "tamanho",
        object: "20",
        source: "notes/a.md#Contrato",
        line: 3,
      },
      { op: "fact", subject: "s", predicate: "p", object: "o", source: "x.md", validFrom: 1, validTo: 2 },
    ];
    for (const op of ops) expect(issue(good({ ops: [op] })), String(op.op)).toBeNull();
    expect(issue(good({ ops }))).toBeNull();
    expect(issue(good({ summary: "s".repeat(2000) }))).toBeNull();
    expect(issue(good({ summary: "" }))).toBeNull();
    expect(issue(good({ ops: [{ ...add, text: "t".repeat(500) }] }))).toBeNull();
    expect(issue(good({ ops: Array.from({ length: 200 }, () => add) }))).toBeNull();
    expect(issue(good({ ops: [] }))).toBeNull();
  });

  it.each([
    ["v 2", good({ v: 2 }), "v"],
    ["no v", { summary: "s", ops: [add] }, "v"],
    ["a summary of 2 001", good({ summary: "s".repeat(2001) }), "summary"],
    ["201 ops", good({ ops: Array.from({ length: 201 }, () => add) }), "ops"],
    ["ops not a list", good({ ops: add }), "ops"],
    ["op rename", good({ ops: [{ ...add, op: "rename" }] }), "ops.0.op"],
    ["section Notes", good({ ops: [{ ...add, section: "Notes" }] }), "ops.0.section"],
    ["section Superseded", good({ ops: [{ ...add, section: "Superseded" }] }), "ops.0.section"],
    ["text of 501", good({ ops: [{ ...add, text: "t".repeat(501) }] }), "ops.0.text"],
    ["empty text", good({ ops: [{ ...add, text: "" }] }), "ops.0.text"],
    ["a line break in the text", good({ ops: [{ ...add, text: "a\nb" }] }), "ops.0.text"],
    ["an absolute source", good({ ops: [{ ...add, source: "/etc/passwd" }] }), "ops.0.source"],
    ["a drive source", good({ ops: [{ ...add, source: "C:\\x.md" }] }), "ops.0.source"],
    ["line 0", good({ ops: [{ ...add, line: 0 }] }), "ops.0.line"],
    [
      "a close_loop on that is not a day",
      good({ ops: [{ op: "close_loop", old: "- x", on: "31/10/2026", source: "a.md" }] }),
      "ops.0.on",
    ],
    [
      "a close_loop on 2026-02-30",
      good({ ops: [{ op: "close_loop", old: "- x", on: "2026-02-30", source: "a.md" }] }),
      "ops.0.on",
    ],
    [
      "a topic with a capital",
      good({ ops: [{ op: "move_to_topic", lines: ["- A"], topic: "Clientes" }] }),
      "ops.0.topic",
    ],
    [
      "a topic with a slash",
      good({ ops: [{ op: "move_to_topic", lines: ["- A"], topic: "a/b" }] }),
      "ops.0.topic",
    ],
    [
      "a move_to_topic with no lines",
      good({ ops: [{ op: "move_to_topic", lines: [], topic: "a" }] }),
      "ops.0.lines",
    ],
    [
      "a fact with no object",
      good({ ops: [{ op: "fact", subject: "s", predicate: "p", source: "a.md" }] }),
      "ops.0.object",
    ],
    [
      "a fact validTo not after validFrom",
      good({
        ops: [
          { op: "fact", subject: "s", predicate: "p", object: "o", source: "a.md", validFrom: 5, validTo: 5 },
        ],
      }),
      "ops.0.validTo",
    ],
  ])("refuses %s, for its own reason alone", (_what, file, at) => {
    expect(issue(file)).toBe(at);
  });

  it("drops a key the agent adds to an op (a trust it declares), so the stored op never carries it", () => {
    const r = ProposalFileSchema.parse(good({ ops: [{ ...add, trust: "usuario", extra: 1 }] }));
    expect(r.ops[0]).toEqual(add);
  });
});

describe("the op applier (door 7), one asserted case per op kind", () => {
  const DAY = "2026-10-31";
  const SRC = "journal/2026-10-30.md";
  const BASE = [
    "# Long-term memory",
    "",
    "## Facts",
    "",
    "- O curso custa 700",
    "",
    "## Decisions",
    "",
    "- Turmas de 15",
    "",
    "## Open loops",
    "",
    "- Lançar a turma de março",
    "",
    "## Reflections",
    "",
    "## Superseded",
    "",
  ].join("\n");
  const apply = (memory: string | null, ...ops: ProposalOp[]) =>
    applyOps(
      memory,
      ops.map((op, index) => ({ index, op })),
      DAY,
    );
  const mark = (text: string, source: string, line?: number) =>
    `- ${text} (fonte:: ${source}${line !== undefined ? `:${line}` : ""}) (autor:: agente) (em:: ${DAY})`;

  it("add: the line is the last of its section, with fonte, autor and em; the rest of the file as it was", () => {
    const { memory } = apply(BASE, {
      op: "add",
      section: "Decisions",
      text: "Turmas de 20",
      source: SRC,
      line: 4,
    });
    expect(memory).toBe(
      BASE.replace("- Turmas de 15\n", `- Turmas de 15\n${mark("Turmas de 20", SRC, 4)}\n`),
    );
    const empty = apply(BASE, { op: "add", section: "Reflections", text: "Uma reflexão", source: SRC });
    expect(empty.memory).toBe(
      BASE.replace("## Reflections\n", `## Reflections\n\n${mark("Uma reflexão", SRC)}\n`),
    );
  });

  it("supersede: the exact old line ends in ## Superseded with valid_to, the new one is last in the old line's section", () => {
    const { memory } = apply(BASE, {
      op: "supersede",
      old: "- Turmas de 15",
      text: "Turmas de 20",
      source: SRC,
      line: 4,
    });
    expect(memory).toBe(
      BASE.replace("- Turmas de 15\n", `${mark("Turmas de 20", SRC, 4)}\n`).replace(
        /## Superseded\n$/,
        `## Superseded\n\n- Turmas de 15 (valid_to:: ${DAY})\n`,
      ),
    );
  });

  it("close_loop: the exact line keeps its place and ends in → closed <on>", () => {
    const { memory } = apply(BASE, {
      op: "close_loop",
      old: "- Lançar a turma de março",
      on: "2026-10-30",
      source: SRC,
    });
    expect(memory).toBe(BASE.replace("março\n", "março → closed 2026-10-30\n"));
  });

  it("move_to_topic: the lines leave, one pointer takes the first one's place, the topic receives them in order", () => {
    const text = BASE.replace("- O curso custa 700\n", "- O curso custa 700\n- Cliente A\n- Cliente B\n");
    const { memory, topics } = apply(text, {
      op: "move_to_topic",
      lines: ["- Cliente A", "- Cliente B"],
      topic: "clientes",
    });
    expect(memory).toBe(
      BASE.replace(
        "- O curso custa 700\n",
        `- O curso custa 700\n- Clientes → [[topics/clientes]] (autor:: agente) (em:: ${DAY})\n`,
      ),
    );
    expect([...topics]).toEqual([["clientes", ["- Cliente A", "- Cliente B"]]]);
  });

  it("move_to_topic: two ops to one topic add up in the order of the ops, and a second topic is apart", () => {
    const text = BASE.replace(
      "- O curso custa 700\n",
      "- O curso custa 700\n- Cliente A\n- Cliente B\n- Cliente C\n",
    );
    const { topics } = apply(
      text,
      { op: "move_to_topic", lines: ["- Cliente A"], topic: "clientes" },
      { op: "move_to_topic", lines: ["- Cliente B"], topic: "outros" },
      { op: "move_to_topic", lines: ["- Cliente C"], topic: "clientes" },
    );
    expect([...topics]).toEqual([
      ["clientes", ["- Cliente A", "- Cliente C"]],
      ["outros", ["- Cliente B"]],
    ]);
  });

  it("fact: MEMORY.md is not touched and the op's index is returned to be asserted", () => {
    const r = apply(
      BASE,
      { op: "add", section: "Facts", text: "x", source: SRC },
      { op: "fact", subject: "s", predicate: "p", object: "o", source: SRC },
    );
    expect(r.facts).toEqual([1]);
    expect(r.memory.split("\n").filter((l) => l.includes("(fonte::"))).toHaveLength(1);
    expect(apply(BASE, { op: "fact", subject: "s", predicate: "p", object: "o", source: SRC }).memory).toBe(
      BASE,
    );
  });

  it("a section the file lacks is appended in the order of the five titles; a missing file holds only what the ops need", () => {
    const only = apply(null, { op: "add", section: "Decisions", text: "Uma", source: SRC, line: 4 });
    expect(only.memory).toBe(`## Decisions\n\n${mark("Uma", SRC, 4)}\n`);
    const three = apply(
      "## Facts\n\n- F\n",
      { op: "add", section: "Reflections", text: "R", source: SRC },
      { op: "add", section: "Decisions", text: "D", source: SRC },
    );
    expect(three.memory.split("\n").filter((l) => l.startsWith("## "))).toEqual([
      "## Facts",
      "## Decisions",
      "## Reflections",
    ]);
  });

  it("a line an earlier op took is skipped, not applied twice; the skipped index is returned", () => {
    const closed = apply(
      BASE,
      { op: "close_loop", old: "- Turmas de 15", on: "2026-10-30", source: SRC },
      { op: "supersede", old: "- Turmas de 15", text: "Outra", source: SRC },
    );
    // the first op changed the line, so the second no longer finds it as written
    expect(closed.skipped).toEqual([1]);
    expect(closed.memory).toContain("- Turmas de 15 → closed 2026-10-30");
    expect(closed.memory).not.toContain("valid_to::");
    const gone = apply(
      BASE,
      { op: "supersede", old: "- Turmas de 15", text: "Outra", source: SRC },
      { op: "supersede", old: "- Turmas de 15", text: "Terceira", source: SRC },
    );
    expect(gone.skipped).toEqual([1]);
    expect(gone.memory.match(/valid_to::/g)).toHaveLength(1);
    expect(gone.memory).not.toContain("Terceira");
  });

  it("refuses an op whose text or source holds a line break (the second guard of the one-line rule)", () => {
    expect(() => apply(BASE, { op: "add", section: "Facts", text: "a\nb", source: SRC })).toThrow(/one line/);
    expect(() => apply(BASE, { op: "add", section: "Facts", text: "a", source: `j\u2028.md` })).toThrow(
      /one line/,
    );
  });
});

// ---- the set-aside of the safe writer (the guard's take-back; round 2, F16) -------------------------------------------

describe("setAsideAndWrite, one asserted case per entry kind and refusal", () => {
  let root: string;
  let scope: ReturnType<typeof readScope>;
  let aside: ReturnType<typeof readScope>;
  const at = (...p: string[]) => path.join(root, ...p);
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-setaside-")));
    fs.mkdirSync(at("memory"), { recursive: true });
    scope = readScope({ homeDir: root, roots: [at("memory")] });
    aside = readScope({ homeDir: root, roots: [at("guard")] });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("a file goes to the other scope's folder whole, the name gets the new bytes, nothing is removed", () => {
    fs.writeFileSync(at("memory", "A.md"), "run\n");
    const r = setAsideAndWrite(scope, at("memory", "A.md"), at("guard", "a-1.md"), "owner\n", aside);
    expect(r).toEqual({ aside: "file" });
    expect(fs.readFileSync(at("guard", "a-1.md"), "utf8")).toBe("run\n");
    expect(fs.readFileSync(at("memory", "A.md"), "utf8")).toBe("owner\n");
  });

  it("a destination that exists is EEXIST and is left untouched, and so is the entry at the name (F16)", () => {
    fs.writeFileSync(at("memory", "B.md"), "run B\n");
    fs.writeFileSync(at("guard", "b-1.md"), "earlier\n");
    expect(() =>
      setAsideAndWrite(scope, at("memory", "B.md"), at("guard", "b-1.md"), "owner\n", aside),
    ).toThrow(expect.objectContaining({ code: "EEXIST" }));
    expect(fs.readFileSync(at("guard", "b-1.md"), "utf8")).toBe("earlier\n");
    expect(fs.readFileSync(at("memory", "B.md"), "utf8")).toBe("run B\n");
    // a dangling link at the destination is taken too
    fs.symlinkSync(at("nowhere"), at("guard", "b-2.md"));
    expect(() => setAsideAndWrite(scope, at("memory", "B.md"), at("guard", "b-2.md"), null, aside)).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(fs.readFileSync(at("memory", "B.md"), "utf8")).toBe("run B\n");
  });

  it("a link is set aside as a link and never followed: its target is not read, only named", () => {
    fs.writeFileSync(at("memory", "alvo.md"), "ALVO\n");
    fs.symlinkSync(at("memory", "alvo.md"), at("memory", "C.md"));
    expect(workspaceEntryKind(scope, at("memory", "C.md"))).toBe("link");
    expect(workspaceLinkTarget(scope, at("memory", "C.md"))).toBe(at("memory", "alvo.md"));
    expect(workspaceLinkTarget(scope, at("memory", "alvo.md"))).toBeNull();
    expect(setAsideAndWrite(scope, at("memory", "C.md"), at("guard", "c-1.md"), "owner\n", aside)).toEqual({
      aside: "link",
    });
    expect(fs.lstatSync(at("guard", "c-1.md")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(at("memory", "alvo.md"), "utf8")).toBe("ALVO\n");
    expect(fs.lstatSync(at("memory", "C.md")).isFile()).toBe(true);
  });

  it("a folder at the name is set aside with what it holds; nothing at the name just writes the bytes", () => {
    fs.mkdirSync(at("memory", "D.md"));
    fs.writeFileSync(at("memory", "D.md", "x"), "x\n");
    expect(setAsideAndWrite(scope, at("memory", "D.md"), at("guard", "d-1"), "owner\n", aside)).toEqual({
      aside: "other",
    });
    expect(fs.readFileSync(at("guard", "d-1", "x"), "utf8")).toBe("x\n");
    expect(setAsideAndWrite(scope, at("memory", "E.md"), at("guard", "e-1.md"), "novo\n", aside)).toEqual({
      aside: null,
    });
    expect(fs.readFileSync(at("memory", "E.md"), "utf8")).toBe("novo\n");
    expect(fs.existsSync(at("guard", "e-1.md"))).toBe(false);
  });

  it("a link on the way to the destination is refused before anything moves", () => {
    fs.mkdirSync(at("elsewhere"), { recursive: true });
    fs.symlinkSync(at("elsewhere"), at("guard", "ligacao"));
    fs.writeFileSync(at("memory", "F.md"), "run F\n");
    expect(() =>
      setAsideAndWrite(scope, at("memory", "F.md"), at("guard", "ligacao", "f.md"), "o\n", aside),
    ).toThrow();
    expect(fs.readFileSync(at("memory", "F.md"), "utf8")).toBe("run F\n");
    expect(fs.readdirSync(at("elsewhere"))).toEqual([]);
  });
});
