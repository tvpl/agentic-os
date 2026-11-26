import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RunStatus } from "@mordomo/contracts";
import {
  checkSummary,
  chooseSummarySources,
  resolveSummaryScope,
  summaryRunOutcome,
  summaryState,
  type SummarySource,
} from "@mordomo/core/internal";
import * as safeFs from "../core/src/security/safeFs.js";
import {
  paragraph,
  recordedSource,
  resumosWorld,
  type Json,
  type ResumosWorld,
} from "./helpers/resumosWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch C, S5 at its own layer (door 6): the check of `summary.json`
 * (`checkSummary`), what a run's status means for a summary (`summaryRunOutcome`) and the staleness rule
 * (`summaryState`), each called with no HTTP; then the reads of the sources a `GET` makes, and `summary_runs` going with
 * its run.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, readWorkspaceFile: vi.fn(actual.readWorkspaceFile) };
});

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (w: ResumosWorld) => Promise<T>): Promise<T> {
  const w = await resumosWorld(`mordomo-resumos-layer-${++seq}-`);
  try {
    return await fn(w);
  } finally {
    await w.close();
  }
}

const PAST = Date.now() - 86_400_000;

// ---- C140: the source choice at its own layer ----------------------------------------------------------------------------

describe("C140 the source choice at its own layer", () => {
  /** What `chooseSummarySources` picks for the area `Projetos` today, with no HTTP and no run. */
  const choose = (w: ResumosWorld, hidden: (p: string) => boolean = () => false): string[] => {
    const settings = w.ctx.settings();
    const env = { db: w.ctx.db, paths: w.ctx.paths, settings, hidden };
    const scope = resolveSummaryScope(env, "area", "Projetos")!;
    return chooseSummarySources(env, scope).map((s) => s.path);
  };

  it("C140 35 files: the 30 chosen are the most linked to from inside the scope, then the most recent; a link from outside counts for nothing", async () => {
    await fresh(async (w) => {
      const name = (i: number) => `n${String(i).padStart(2, "0")}`;
      const linksTo: Record<number, string[]> = {
        10: ["n05"],
        11: ["n05"],
        12: ["n05", "n07"],
        13: ["n07"],
        14: ["n09"],
      };
      const files: string[] = [];
      for (let i = 0; i < 35; i++) {
        const links = (linksTo[i] ?? []).map((t) => `Veja [[${t}]].`).join("\n");
        files.push(
          w.note(path.join(w.projetos, `${name(i)}.md`), `# ${name(i)}\n\n${links}\n`, PAST + i * 60_000),
        );
      }
      const docs = w.areaRoot("docs", "Documentos");
      w.note(path.join(docs, "fora.md"), "# Fora\n\nVeja [[n00]] e [[n01]] e [[n02]].\n", PAST);
      await w.index();
      // inbound links from inside the scope: n05 3, n07 2, n09 1, the rest 0; then mtime descending
      const inbound = new Map<string, number>([
        ["n05", 3],
        ["n07", 2],
        ["n09", 1],
      ]);
      const want = files
        .map((file, i) => ({ file, links: inbound.get(name(i)) ?? 0, mtime: PAST + i * 60_000 }))
        .sort((a, b) => b.links - a.links || b.mtime - a.mtime)
        .slice(0, 30)
        .map((f) => f.file);
      const chosen = choose(w);
      expect(chosen).toHaveLength(30);
      expect(chosen.slice(0, 3)).toEqual([files[5], files[7], files[9]]);
      expect(chosen).toEqual(want);
      // the five left out are the oldest without a link
      expect(files.filter((f) => !chosen.includes(f))).toEqual(files.slice(0, 5));
    });
  });

  it("C140 a policy-excluded file, a file hidden from agents and a file outside the scope are never chosen, each alone", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n", PAST + 1000);
      const excluded = w.note(path.join(w.projetos, "privado", "b.md"), "# B\n", PAST + 4000);
      const hidden = w.note(path.join(w.projetos, "sigilo", "c.md"), "# C\n", PAST + 3000);
      const docs = w.areaRoot("docs", "Documentos");
      const outside = w.note(path.join(docs, "d.md"), "# D\n", PAST + 2000);
      await w.index();
      const hiddenFn = (p: string) => p === hidden;
      // each alone: without its exclusion the file is in the choice (the scope's files, newest first)
      expect(choose(w)).toEqual([excluded, hidden, a]);
      expect(choose(w, hiddenFn)).toEqual([excluded, a]);
      w.update((s) => {
        s.excludes = [...s.excludes, "privado"];
      });
      expect(choose(w)).toEqual([hidden, a]);
      expect(choose(w, hiddenFn)).toEqual([a]);
      expect(choose(w, hiddenFn)).not.toContain(outside);
    });
  });
});

// ---- C60: the check of summary.json --------------------------------------------------------------------------------

describe("C60 the summary check at its own layer", () => {
  it("C60 each refusal alone, with its reason naming its rule; each accepted edge", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n\n## Decisão\n\nSim.\n", PAST);
      const b = w.note(path.join(w.projetos, "b.md"), "# B\n\n## Fato\n\nNão.\n", PAST);
      const excluded = w.note(path.join(w.projetos, "privado", "c.md"), "# C\n\n## Fato\n\nTalvez.\n", PAST);
      await w.index();
      const settings = w.ctx.settings();
      const base = {
        db: w.ctx.db,
        paths: w.ctx.paths,
        settings,
        hidden: () => false,
        sources: new Set([a, excluded]),
      };
      const check = (content: unknown, env: Partial<typeof base> = {}) =>
        checkSummary(
          Buffer.isBuffer(content)
            ? content
            : Buffer.from(typeof content === "string" ? content : JSON.stringify(content)),
          { ...base, ...env },
        );
      const valid = (paragraphs: Json[]) => ({ v: 1, paragraphs });
      const refused = (verdict: ReturnType<typeof check>) => (verdict.ok ? "(accepted)" : verdict.reason);

      // the base summary passes
      expect(check(valid([paragraph(a, "Decisão")])).ok).toBe(true);

      // a file in the scope, indexed and shown, that is not a recorded source
      expect(refused(check(valid([paragraph(b, "Fato")])))).toBe(
        `A citação do parágrafo 1 nomeia ${b}, que não é uma das fontes gravadas do resumo.`,
      );
      // a section the file lacks
      expect(refused(check(valid([paragraph(a, "Prazo")])))).toBe(
        `A citação do parágrafo 1 nomeia a seção "Prazo" de ${a}, que o arquivo não tem.`,
      );
      // a recorded source the policy excludes today
      expect(check(valid([paragraph(excluded, "Fato")])).ok).toBe(true);
      expect(
        refused(
          check(valid([paragraph(excluded, "Fato")]), {
            settings: { ...settings, excludes: [...settings.excludes, "privado"] },
          }),
        ),
      ).toBe(`A citação do parágrafo 1 nomeia ${excluded}, que a política de hoje exclui.`);
      // a recorded source in a folder hidden from agents
      expect(refused(check(valid([paragraph(a, "Decisão")]), { hidden: (p) => p === a }))).toBe(
        `A citação do parágrafo 1 nomeia ${a}, que está numa pasta escondida dos agentes.`,
      );

      // 65 536 bytes accepted, 65 537 refused
      const body = JSON.stringify(valid([paragraph(a, "Decisão")]));
      const padded = (size: number) => Buffer.from(body + " ".repeat(size - Buffer.byteLength(body)));
      expect(padded(65_536).length).toBe(65_536);
      expect(check(padded(65_536)).ok).toBe(true);
      expect(refused(check(padded(65_537)))).toBe("O resumo passa de 65536 bytes.");

      // 10 paragraphs accepted, 11 refused
      const many = (n: number) => valid(Array.from({ length: n }, () => paragraph(a, "Decisão")));
      expect(check(many(10)).ok).toBe(true);
      expect(refused(check(many(11)))).toBe(
        "O resumo não segue o formato de summary.json: paragraphs: 1 to 10 paragraphs",
      );

      // a paragraph with 0 and with 7 citations refused, 6 accepted
      const cites = (n: number) =>
        valid([
          { text: "Sim.", citations: Array.from({ length: n }, () => ({ path: a, section: "Decisão" })) },
        ]);
      expect(check(cites(6)).ok).toBe(true);
      expect(refused(check(cites(0)))).toBe(
        "O resumo não segue o formato de summary.json: paragraphs.0.citations: a paragraph cites 1 to 6 sections",
      );
      expect(refused(check(cites(7)))).toBe(
        "O resumo não segue o formato de summary.json: paragraphs.0.citations: a paragraph cites 1 to 6 sections",
      );

      // 1 200 characters accepted, 1 201 refused
      expect(check(valid([paragraph(a, "Decisão", "x".repeat(1200))])).ok).toBe(true);
      expect(refused(check(valid([paragraph(a, "Decisão", "x".repeat(1201))])))).toBe(
        "O resumo não segue o formato de summary.json: paragraphs.0.text: a paragraph's text has at most 1200 characters",
      );

      // not JSON; v: 2
      expect(refused(check("{ não é json"))).toBe("O resumo não é JSON.");
      expect(refused(check({ v: 2, paragraphs: [paragraph(a, "Decisão")] }))).toBe(
        "O resumo não segue o formato de summary.json: v: v must be 1",
      );
    });
  });

  it("C60 an accepted summary gives each citation its index row's path, name and id, and natureza only for a labelled note", async () => {
    await fresh(async (w) => {
      const a = w.note(
        path.join(w.projetos, "a.md"),
        "---\nnatureza: hipotese\n---\n# A\n\n## Ideia\n\nTalvez.\n",
        PAST,
      );
      const b = w.note(
        path.join(w.projetos, "b.md"),
        "---\nnatureza: fato\n---\n# B\n\n## Fato\n\nSim.\n",
        PAST,
      );
      await w.index();
      const verdict = checkSummary(
        Buffer.from(JSON.stringify({ v: 1, paragraphs: [paragraph(a, "Ideia"), paragraph(b, "Fato")] })),
        {
          db: w.ctx.db,
          paths: w.ctx.paths,
          settings: w.ctx.settings(),
          hidden: () => false,
          sources: new Set([a, b]),
        },
      );
      const id = (file: string) =>
        (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
      expect(verdict).toEqual({
        ok: true,
        paragraphs: [
          {
            text: "O projeto Atlas avança.",
            citations: [{ path: a, section: "Ideia", name: "a.md", fileId: id(a), natureza: "hipotese" }],
          },
          {
            text: "O projeto Atlas avança.",
            citations: [{ path: b, section: "Fato", name: "b.md", fileId: id(b) }],
          },
        ],
      });
    });
  });
});

// ---- C63: what a run's status means ----------------------------------------------------------------------------------

describe("C63 the run-to-summary mapping at its own layer", () => {
  const accepted = () => ({ ok: true as const, paragraphs: [{ text: "Sim.", citations: [] }] });
  it("C63 one case per run status (8)", () => {
    const statuses: RunStatus[] = [
      "queued",
      "running",
      "waiting_approval",
      "done",
      "failed",
      "cancelled",
      "timed_out",
      "interrupted",
    ];
    // every member of the type is a case below
    expect(statuses).toHaveLength(8);
    let reads = 0;
    const read = () => {
      reads++;
      return accepted();
    };
    for (const status of ["queued", "running", "waiting_approval"] as const) {
      expect(summaryRunOutcome(status, read), status).toEqual({ kind: "running" });
    }
    expect(reads).toBe(0);
    expect(summaryRunOutcome("done", read)).toEqual({ kind: "candidate", paragraphs: accepted().paragraphs });
    expect(summaryRunOutcome("done", () => ({ ok: false, reason: "O resumo não é JSON." }))).toEqual({
      kind: "error",
      lastError: "O resumo não é JSON.",
    });
    expect(summaryRunOutcome("done", () => null)).toEqual({
      kind: "error",
      lastError: "A execução não escreveu summary.json.",
    });
    reads = 0;
    for (const status of ["failed", "cancelled", "timed_out", "interrupted"] as const) {
      expect(summaryRunOutcome(status, read), status).toEqual({
        kind: "error",
        lastError: `A execução terminou em ${status}.`,
      });
    }
    expect(reads).toBe(0);
  });
});

// ---- C65: the staleness rule -----------------------------------------------------------------------------------------

describe("C65 the staleness rule at its own layer", () => {
  const STARTED = 1_000_000;
  const src = (name: string, extra: Partial<SummarySource> = {}): SummarySource => ({
    path: `/v/${name}.md`,
    size: 100,
    mtime: STARTED - 10,
    sha256: `sha-${name}`,
    ...extra,
  });
  /** Today: the index rows and the bytes' hashes; `hashed` records each path read. */
  const todayOf = (
    rows: Record<string, { size: number; mtime: number }>,
    hashes: Record<string, string>,
    hashed: string[] = [],
  ) => ({
    file: (p: string) => rows[p],
    sha256: (p: string) => {
      hashed.push(p);
      return hashes[p] ?? null;
    },
  });
  const a = src("a");
  const b = src("b");
  const same = { [a.path]: { size: 100, mtime: a.mtime }, [b.path]: { size: 100, mtime: b.mtime } };
  const scope = [
    { path: a.path, mtime: a.mtime },
    { path: b.path, mtime: b.mtime },
  ];

  it("C65 none of the rows → fresh, no source read", () => {
    const hashed: string[] = [];
    expect(summaryState([a, b], todayOf(same, {}, hashed), scope, STARTED)).toEqual({
      state: "fresh",
      changes: { changed: 0, removed: 0, added: 0 },
      sources: [
        { path: a.path, state: "same" },
        { path: b.path, state: "same" },
      ],
    });
    expect(hashed).toEqual([]);
  });

  it("C65 a source gone from the index → removed 1", () => {
    const rows = { [a.path]: same[a.path]! };
    const r = summaryState([a, b], todayOf(rows, {}), [scope[0]!], STARTED);
    expect([r.state, r.changes]).toEqual(["stale", { changed: 0, removed: 1, added: 0 }]);
    expect(r.sources[1]).toEqual({ path: b.path, state: "removed" });
  });

  it("C65 a source moved out of the scope, still indexed → removed 1", () => {
    const r = summaryState([a, b], todayOf(same, {}), [scope[0]!], STARTED);
    expect([r.state, r.changes]).toEqual(["stale", { changed: 0, removed: 1, added: 0 }]);
  });

  it("C65 size changed and SHA-256 changed → changed 1", () => {
    const rows = { ...same, [a.path]: { size: 120, mtime: a.mtime } };
    const r = summaryState([a, b], todayOf(rows, { [a.path]: "sha-novo" }), scope, STARTED);
    expect([r.state, r.changes]).toEqual(["stale", { changed: 1, removed: 0, added: 0 }]);
    expect(r.sources[0]).toEqual({ path: a.path, state: "changed" });
  });

  it("C65 mtime changed and SHA-256 equal → same, fresh", () => {
    const rows = { ...same, [a.path]: { size: 100, mtime: a.mtime + 5000 } };
    const hashed: string[] = [];
    const r = summaryState([a, b], todayOf(rows, { [a.path]: a.sha256 }, hashed), scope, STARTED);
    expect([r.state, r.changes]).toEqual(["fresh", { changed: 0, removed: 0, added: 0 }]);
    expect(r.sources[0]).toEqual({ path: a.path, state: "same" });
    expect(hashed).toEqual([a.path]);
  });

  it("C65 size changed and SHA-256 equal (an impossible pair) → still same", () => {
    const rows = { ...same, [a.path]: { size: 99, mtime: a.mtime } };
    const r = summaryState([a, b], todayOf(rows, { [a.path]: a.sha256 }), scope, STARTED);
    expect([r.state, r.sources[0]!.state]).toEqual(["fresh", "same"]);
  });

  it("C65 a non-source file of the scope with mtime after startedAt → added 1", () => {
    const r = summaryState(
      [a, b],
      todayOf(same, {}),
      [...scope, { path: "/v/c.md", mtime: STARTED + 1 }],
      STARTED,
    );
    expect([r.state, r.changes]).toEqual(["stale", { changed: 0, removed: 0, added: 1 }]);
  });

  it("C65 one with mtime equal to startedAt → not added", () => {
    const r = summaryState(
      [a, b],
      todayOf(same, {}),
      [...scope, { path: "/v/c.md", mtime: STARTED }],
      STARTED,
    );
    expect([r.state, r.changes]).toEqual(["fresh", { changed: 0, removed: 0, added: 0 }]);
  });

  it("C65 the three combined → stale with each count", () => {
    const c = src("c");
    const rows = {
      [a.path]: { size: 140, mtime: a.mtime + 1 },
      [b.path]: same[b.path]!,
      [c.path]: same[b.path]!,
    };
    const r = summaryState(
      [a, b, c],
      todayOf(rows, { [a.path]: "sha-outro" }),
      [
        { path: a.path, mtime: a.mtime + 1 },
        { path: b.path, mtime: b.mtime },
        { path: "/v/d.md", mtime: STARTED + 10 },
        { path: "/v/e.md", mtime: STARTED + 20 },
      ],
      STARTED,
    );
    expect([r.state, r.changes]).toEqual(["stale", { changed: 1, removed: 1, added: 2 }]);
  });
});

// ---- C66: a GET reads a source only when its size or mtime moved -------------------------------------------------

describe("C66 the SHA-256 is read only when size or mtime differ", () => {
  it("C66 every source unchanged: a GET opens no source file; one changed: exactly 1 read", async () => {
    await fresh(async (w) => {
      const files = ["a", "b", "c"].map((n, i) =>
        w.note(path.join(w.projetos, `${n}.md`), `# ${n}\n\n## Fato\n\nTexto ${n}.\n`, PAST + i * 1000),
      );
      await w.index();
      const runId = "resumo-c66";
      w.runRow({ id: runId, status: "done", createdAt: Date.now() - 5000, finishedAt: Date.now() - 4000 });
      w.summaryRow({
        runId,
        kind: "area",
        id: "Projetos",
        sources: files.map(recordedSource),
        startedAt: Date.now() - 5000,
      });
      w.writeSummary(runId, { v: 1, paragraphs: [paragraph(files[0]!, "Fato")] });

      const reads = vi.mocked(safeFs.readWorkspaceFile);
      const opened: string[] = [];
      const realOpen = fs.openSync;
      const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
        target: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(target).startsWith(w.projetos)) opened.push(String(target));
        return (realOpen as (...a: unknown[]) => number)(target, ...rest);
      }) as typeof fs.openSync);
      const sourceReads = () =>
        reads.mock.calls.filter(([, f]) => String(f).startsWith(w.projetos)).map(([, f]) => f);
      try {
        reads.mockClear();
        const res = await w.read("area", "Projetos");
        expect(res.body.state, JSON.stringify(res.body)).toBe("fresh");
        expect(sourceReads()).toEqual([]);
        expect(opened).toEqual([]);

        fs.writeFileSync(files[1]!, "# b\n\n## Fato\n\nTexto b, mudado.\n");
        await w.index();
        reads.mockClear();
        opened.length = 0;
        const changed = await w.read("area", "Projetos");
        expect([changed.body.state, changed.body.changes]).toEqual([
          "stale",
          { changed: 1, removed: 0, added: 0 },
        ]);
        expect(sourceReads()).toEqual([files[1]]);
        expect(opened).toEqual([files[1]]);
      } finally {
        openSpy.mockRestore();
      }
    });
  });
});

// ---- C72: summary_runs go with their run -----------------------------------------------------------------------------

describe("C72 summary_runs rows go with their run", () => {
  it("C72 a run deleted by retention takes its summary_runs row (ON DELETE CASCADE), and the summary reads as missing", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n\n## Fato\n\nSim.\n", PAST);
      await w.index();
      const old = Date.now() - 400 * 86_400_000;
      w.runRow({ id: "resumo-antigo", status: "done", createdAt: old, finishedAt: old + 1000 });
      w.summaryRow({
        runId: "resumo-antigo",
        kind: "area",
        id: "Projetos",
        sources: [recordedSource(a)],
        startedAt: Date.now() - 1000,
      });
      w.writeSummary("resumo-antigo", { v: 1, paragraphs: [paragraph(a, "Fato")] });
      expect((await w.read("area", "Projetos")).body.state).toBe("fresh");

      const count = () => (w.ctx.db.prepare("SELECT COUNT(*) n FROM summary_runs").get() as { n: number }).n;
      expect(count()).toBe(1);
      const pruned = w.ctx.runs.prune({ keepRunDays: 30 });
      expect(pruned.runsDeleted).toBeGreaterThanOrEqual(1);
      expect(w.ctx.runs.get("resumo-antigo")).toBeNull();
      expect(count()).toBe(0);
      const res = await w.read("area", "Projetos");
      expect([res.body.state, res.body.paragraphs, res.body.sources]).toEqual(["missing", undefined, []]);
    });
  });
});
