import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { paragraph, resumosWorld, sha256Hex, type Json, type ResumosWorld } from "./helpers/resumosWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch C, S5 at the boundary (door 6): `POST /api/memory/summaries`, `GET
 * /api/memory/summaries` and `GET /api/memory/summaries/:kind/:id` through `app.inject` against `buildServer` over a
 * real home whose Claude provider is the fake CLI; the test writes what the run leaves in `artifacts/<run>/summary.json`.
 * The rules at their own layer are `resumos.layer.test.ts`.
 */

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (w: ResumosWorld) => Promise<T>): Promise<T> {
  const w = await resumosWorld(`mordomo-resumos-routes-${++seq}-`);
  try {
    return await fn(w);
  } finally {
    await w.close();
  }
}

const AREA = { kind: "area", id: "Projetos" };
const code = (r: { status: number; body: Json }) => [r.status, r.body?.error?.code];
/** A moment well before every run of the test, so that a note written at it is never "added". */
const PAST = Date.now() - 86_400_000;
const mcpOf = (w: ResumosWorld) => ({
  ...w.owner(),
  "x-mordomo-as": "mcp",
  "x-mordomo-client": "claude-code",
});

/** Three notes of the area, the newest first by mtime: atlas, borba, cacto. */
async function threeNotes(w: ResumosWorld): Promise<{ atlas: string; borba: string; cacto: string }> {
  const atlas = w.note(
    path.join(w.projetos, "atlas.md"),
    "# Atlas\n\n## Decisão\n\nO Atlas sai em março.\n",
    PAST + 3000,
  );
  const borba = w.note(
    path.join(w.projetos, "borba.md"),
    "---\nnatureza: plano\n---\n# Borba\n\n## Próximos passos\n\nContratar em abril.\n",
    PAST + 2000,
  );
  const cacto = w.note(
    path.join(w.projetos, "cacto.md"),
    "# Cacto\n\n## Lista\n\nAcme e Globex.\n",
    PAST + 1000,
  );
  await w.index();
  return { atlas, borba, cacto };
}

const twoParagraphs = (n: { atlas: string; borba: string }): Json => ({
  v: 1,
  paragraphs: [
    paragraph(n.atlas, "Decisão", "O Atlas sai em março."),
    paragraph(n.borba, "Próximos passos", "A Borba contrata em abril."),
  ],
});

describe("C53 a summary starts one read-only run of brain-summarize", () => {
  it("C53 POST answers 202 { id, status: running }; one run of brain-summarize, read_only, by the owner, with scope and sources; one summary_runs row with size, mtime and SHA-256", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      const before = w.ctx.runs.list({ limit: 100 }).map((r) => r.id);
      const res = await w.start(AREA);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(Object.keys(res.body).sort()).toEqual(["id", "status"]);
      expect(res.body.status).toBe("running");
      const added = w.ctx.runs.list({ limit: 100 }).filter((r) => !before.includes(r.id));
      expect(added.map((r) => r.id)).toEqual([res.body.id]);
      const run = added[0]!;
      expect(run.skillSlug).toBe("brain-summarize");
      expect(run.request?.kind).toBe("skill");
      expect(run.request?.mode).toBe("read_only");
      expect(run.startedBy).toBe("owner");
      const inputs = run.request?.kind === "skill" ? run.request.inputs : {};
      expect(inputs.scope).toBe("area:Projetos");
      expect(inputs.sources).toBe([n.atlas, n.borba, n.cacto].join("\n"));

      const rows = w.ctx.db.prepare("SELECT * FROM summary_runs").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.run_id).toBe(res.body.id);
      expect([rows[0]!.scope_kind, rows[0]!.scope_id]).toEqual(["area", "Projetos"]);
      const sources = JSON.parse(String(rows[0]!.sources)) as Json[];
      expect(sources).toEqual(
        [n.atlas, n.borba, n.cacto].map((file) => {
          const stat = fs.statSync(file);
          return {
            path: file,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs),
            sha256: sha256Hex(fs.readFileSync(file)),
          };
        }),
      );
      await w.settle(res.body.id);
    });
  });
});

describe("C54 the source choice", () => {
  it("C54 35 files in the area: 30 chosen, by inbound links from inside the scope then mtime descending, as renderContextMap orders them", async () => {
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
      // a link from outside the scope counts for nothing
      const docs = w.areaRoot("docs", "Documentos");
      w.note(path.join(docs, "fora.md"), "# Fora\n\nVeja [[n00]] e [[n01]] e [[n02]].\n", PAST);
      await w.index();

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

      // the context map of a context over the same folder lists the same files in the same order
      w.update((s) => {
        s.contexts = [{ id: "projetos", name: "Projetos", paths: [w.projetos] }];
      });
      const routers = await w.call("POST", "/api/memory/routers", {});
      expect(routers.status, JSON.stringify(routers.body)).toBeLessThan(300);
      const map = fs.readFileSync(path.join(w.ctx.paths.memory, "contexts", "projetos.md"), "utf8");
      const mapped = [...map.matchAll(/^- .+ → (\/.+)$/gm)].map((m) => m[1]!);
      expect(mapped).toHaveLength(30);
      expect(mapped).toEqual(want);

      const res = await w.start(AREA);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const run = w.ctx.runs.get(res.body.id)!;
      const sources = (run.request?.kind === "skill" ? run.request.inputs.sources : "")!.split("\n");
      expect(sources).toHaveLength(30);
      expect(sources).toEqual(mapped);
      await w.settle(res.body.id);
    });
  });

  const sourcesOf = async (w: ResumosWorld): Promise<string[]> => {
    const res = await w.start(AREA);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const run = w.ctx.runs.get(res.body.id)!;
    await w.settle(res.body.id);
    return (run.request?.kind === "skill" ? run.request.inputs.sources : "")!.split("\n");
  };

  it("C54 a file the policy excludes today is never chosen", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n", PAST + 2000);
      const excluded = w.note(path.join(w.projetos, "privado", "b.md"), "# B\n", PAST + 3000);
      await w.index();
      expect(
        (w.ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE path = ?").get(excluded) as { n: number }).n,
      ).toBe(1);
      w.update((s) => {
        s.excludes = [...s.excludes, "privado"];
      });
      expect(await sourcesOf(w)).toEqual([a]);
    });
  });

  it("C54 a file in a folder hidden from agents is never chosen", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n", PAST + 2000);
      const hiddenDir = path.join(w.projetos, "sigilo");
      w.note(path.join(hiddenDir, "b.md"), "# B\n", PAST + 3000);
      w.update((s) => {
        s.folderAccess = [{ path: hiddenDir, agents: "hide", devices: "read" }];
      });
      await w.index();
      expect(await sourcesOf(w)).toEqual([a]);
    });
  });

  it("C54 a file outside the scope is never chosen", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.projetos, "a.md"), "# A\n", PAST + 2000);
      const docs = w.areaRoot("docs", "Documentos");
      w.note(path.join(docs, "b.md"), "# B\n", PAST + 3000);
      await w.index();
      expect(await sourcesOf(w)).toEqual([a]);
    });
  });
});

describe("C55 the refusals of the scope", () => {
  it("C55 404 scope_not_found for an unknown area and context; 409 empty_scope for an area with no visible file; 400 validation for kind folder; no run in any case", async () => {
    await fresh(async (w) => {
      const docs = w.areaRoot("docs", "Documentos");
      w.note(path.join(docs, "so-escondido.md"), "# Escondido\n", PAST);
      w.update((s) => {
        s.folderAccess = [{ path: docs, agents: "hide", devices: "read" }];
        s.contexts = [{ id: "cliente-x", name: "Cliente X", paths: [w.projetos] }];
      });
      w.note(path.join(w.projetos, "a.md"), "# A\n", PAST);
      await w.index();
      const runs = w.runCount();
      expect(code(await w.start({ kind: "area", id: "Nope" }))).toEqual([404, "scope_not_found"]);
      expect(code(await w.start({ kind: "context", id: "nope" }))).toEqual([404, "scope_not_found"]);
      expect(code(await w.start({ kind: "area", id: "Documentos" }))).toEqual([409, "empty_scope"]);
      expect(code(await w.start({ kind: "folder", id: w.projetos }))).toEqual([400, "validation"]);
      expect(w.runCount()).toBe(runs);
      expect((w.ctx.db.prepare("SELECT COUNT(*) n FROM summary_runs").get() as { n: number }).n).toBe(0);
    });
  });
});

describe("C56 one run per scope", () => {
  it("C56 an open run of the scope (queued, running, waiting_approval) → 409 summary_in_progress; after done, failed, cancelled, timed_out, interrupted → 202; another scope's open run → 202", async () => {
    await fresh(async (w) => {
      w.note(path.join(w.projetos, "a.md"), "# A\n\n## Decisão\n\nSim.\n", PAST);
      const docs = w.areaRoot("docs", "Documentos");
      w.note(path.join(docs, "d.md"), "# D\n", PAST);
      await w.index();
      let n = 0;
      const seed = (status: string, scope = "Projetos") => {
        const id = `seeded-${++n}`;
        w.runRow({ id, status, createdAt: Date.now() - 1000, finishedAt: null });
        w.summaryRow({ runId: id, kind: "area", id: scope, sources: [], startedAt: Date.now() - 1000 });
        return id;
      };
      const clear = () => w.ctx.db.prepare("DELETE FROM summary_runs").run();
      for (const status of ["queued", "running", "waiting_approval"]) {
        clear();
        seed(status);
        const runs = w.runCount();
        expect(code(await w.start(AREA)), status).toEqual([409, "summary_in_progress"]);
        expect(w.runCount(), status).toBe(runs);
      }
      for (const status of ["done", "failed", "cancelled", "timed_out", "interrupted"]) {
        clear();
        seed(status);
        const res = await w.start(AREA);
        expect(res.status, `${status} ${JSON.stringify(res.body)}`).toBe(202);
        await w.settle(res.body.id);
      }
      clear();
      seed("running", "Documentos");
      const other = await w.start(AREA);
      expect(other.status, JSON.stringify(other.body)).toBe(202);
      await w.settle(other.body.id);
    });
  });
});

describe("C57 409 skill_unavailable", () => {
  it("C57 no skills/brain-summarize/ → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      w.note(path.join(w.projetos, "a.md"), "# A\n", PAST);
      await w.index();
      fs.rmSync(path.dirname(w.skillFile()), { recursive: true, force: true });
      const runs = w.runCount();
      expect(code(await w.start(AREA))).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C57 the skill with enabled: false (present and in memorySkills) → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      w.note(path.join(w.projetos, "a.md"), "# A\n", PAST);
      await w.index();
      const text = fs.readFileSync(w.skillFile(), "utf8");
      expect(text).toContain("enabled: true");
      fs.writeFileSync(w.skillFile(), text.replace("enabled: true", "enabled: false"));
      expect(w.ctx.settings().memorySkills).toContain("brain-summarize");
      const runs = w.runCount();
      expect(code(await w.start(AREA))).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C57 the skill absent from memorySkills (present and enabled) → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      w.note(path.join(w.projetos, "a.md"), "# A\n", PAST);
      await w.index();
      w.update((s) => {
        s.memorySkills = s.memorySkills.filter((slug) => slug !== "brain-summarize");
      });
      expect(fs.readFileSync(w.skillFile(), "utf8")).toContain("enabled: true");
      const runs = w.runCount();
      expect(code(await w.start(AREA))).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });
});

describe("C58 who may start a summary", () => {
  it("C58 through /api and /api/v1: the owner 202; a device with every scope 403 owner_only; a run's rc_ and mcp 403 forbidden", async () => {
    await fresh(async (w) => {
      w.note(path.join(w.projetos, "a.md"), "# A\n", PAST);
      await w.index();
      const device = w.device(["content", "monitor", "run", "approve"]);
      const run = w.run("read_only").headers;
      for (const prefix of ["/api", "/api/v1"]) {
        const url = `${prefix}/memory/summaries`;
        const owner = await w.call("POST", url, { scope: AREA });
        expect(owner.status, `${url} ${JSON.stringify(owner.body)}`).toBe(202);
        await w.settle(owner.body.id);
        expect(code(await w.call("POST", url, { scope: AREA }, device)), url).toEqual([403, "owner_only"]);
        expect(code(await w.call("POST", url, { scope: AREA }, run)), url).toEqual([403, "forbidden"]);
        expect(code(await w.call("POST", url, { scope: AREA }, mcpOf(w))), url).toEqual([403, "forbidden"]);
      }
    });
  });
});

describe("C59 an accepted summary", () => {
  it("C59 GET area/Projetos: fresh, the paragraphs with { path, section, name, fileId } and natureza on the plano note, generatedAt the run's start, run, sources each same", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      const runId = await w.summarize(AREA, twoParagraphs(n));
      const run = w.ctx.runs.get(runId)!;
      expect(run.status).toBe("done");
      const res = await w.read("area", "Projetos");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const idOf = (file: string) =>
        (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
      expect(res.body).toEqual({
        scope: { kind: "area", id: "Projetos", name: "Projetos" },
        state: "fresh",
        generatedAt: run.startedAt,
        changes: { changed: 0, removed: 0, added: 0 },
        paragraphs: [
          {
            text: "O Atlas sai em março.",
            citations: [{ path: n.atlas, section: "Decisão", name: "atlas.md", fileId: idOf(n.atlas) }],
          },
          {
            text: "A Borba contrata em abril.",
            citations: [
              {
                path: n.borba,
                section: "Próximos passos",
                name: "borba.md",
                fileId: idOf(n.borba),
                natureza: "plano",
              },
            ],
          },
        ],
        sources: [n.atlas, n.borba, n.cacto].map((file) => ({
          fileId: idOf(file),
          path: file,
          name: path.basename(file),
          state: "same",
        })),
        run: { id: runId, provider: "claude", startedAt: run.startedAt, finishedAt: run.finishedAt },
        running: false,
      });
    });
  });
});

describe("C61 a refused newest run", () => {
  it("C61 with an older accepted one: the older one's state and paragraphs (fresh, then stale by its sources), lastError the newest's reason", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      await w.summarize(AREA, twoParagraphs(n));
      // the newest cites a section its source does not have
      const second = await w.summarize(AREA, { v: 1, paragraphs: [paragraph(n.atlas, "Inexistente")] });
      expect(w.ctx.runs.get(second)!.status).toBe("done");
      const res = await w.read("area", "Projetos");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.paragraphs.map((p: Json) => p.text)).toEqual([
        "O Atlas sai em março.",
        "A Borba contrata em abril.",
      ]);
      expect(res.body.state).toBe("fresh");
      expect(res.body.lastError).toBe(
        `A citação do parágrafo 1 nomeia a seção "Inexistente" de ${n.atlas}, que o arquivo não tem.`,
      );
      expect(res.body.running).toBe(false);

      // by its sources, the older one turns stale
      fs.writeFileSync(n.cacto, "# Cacto\n\n## Lista\n\nAcme, Globex e Initech.\n");
      await w.index();
      const stale = await w.read("area", "Projetos");
      expect(stale.body.state).toBe("stale");
      expect(stale.body.changes).toEqual({ changed: 1, removed: 0, added: 0 });
      expect(stale.body.paragraphs).toHaveLength(2);
      expect(stale.body.lastError).toBe(res.body.lastError);
    });
  });

  it("C61 with no older accepted one: state missing and lastError", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      await w.summarize(AREA, "não é json");
      const res = await w.read("area", "Projetos");
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("missing");
      expect(res.body.paragraphs).toBeUndefined();
      expect(res.body.sources).toEqual([]);
      expect(res.body.lastError).toBe("O resumo não é JSON.");
    });
  });
});

describe("C62 an open newer run", () => {
  it("C62 with an older accepted one: running true, the older paragraphs and state kept", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      const first = await w.summarize(AREA, twoParagraphs(n));
      const before = await w.read("area", "Projetos");
      w.runRow({ id: "aberta", status: "running", createdAt: Date.now() });
      w.summaryRow({ runId: "aberta", kind: "area", id: "Projetos", sources: [], startedAt: Date.now() });
      const res = await w.read("area", "Projetos");
      expect(res.body.running).toBe(true);
      expect(res.body.state).toBe("fresh");
      expect(res.body.paragraphs).toEqual(before.body.paragraphs);
      expect(res.body.run.id).toBe(first);
      expect(res.body.lastError).toBeUndefined();
    });
  });
});

describe("C64 no summary", () => {
  it("C64 a scope with no summary: state missing, no paragraphs, sources []", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const res = await w.read("area", "Projetos");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        scope: { kind: "area", id: "Projetos", name: "Projetos" },
        state: "missing",
        sources: [],
        running: false,
      });
    });
  });
});

describe("C67 the plan's independent test", () => {
  it("C67 fresh; after editing one note stale with changed 1; after creating a note in the area stale with changed 1 and added 1", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      await w.summarize(AREA, twoParagraphs(n));
      const first = await w.read("area", "Projetos");
      expect([first.body.state, first.body.changes]).toEqual(["fresh", { changed: 0, removed: 0, added: 0 }]);

      fs.writeFileSync(n.atlas, "# Atlas\n\n## Decisão\n\nO Atlas sai em abril, não em março.\n");
      await w.index();
      const edited = await w.read("area", "Projetos");
      expect([edited.body.state, edited.body.changes]).toEqual([
        "stale",
        { changed: 1, removed: 0, added: 0 },
      ]);
      expect(edited.body.sources.find((s: Json) => s.path === n.atlas).state).toBe("changed");

      w.note(path.join(w.projetos, "nova.md"), "# Nova\n\nUma nota nova.\n");
      await w.index();
      const created = await w.read("area", "Projetos");
      expect([created.body.state, created.body.changes]).toEqual([
        "stale",
        { changed: 1, removed: 0, added: 1 },
      ]);
    });
  });
});

describe("C68 the list of summaries", () => {
  it("C68 one item per area of settings.areas in order, then one per context in order: 4 areas and 2 contexts give 6 items", async () => {
    await fresh(async (w) => {
      const n = await threeNotes(w);
      w.update((s) => {
        s.contexts = [
          { id: "cliente-x", name: "Cliente X", paths: [w.projetos] },
          { id: "alfa", name: "Alfa", paths: [w.projetos] },
        ];
      });
      expect(w.ctx.settings().areas).toEqual(["Worker", "Documentos", "Finanças", "Projetos"]);
      const runId = await w.summarize(AREA, twoParagraphs(n));
      const res = await w.list();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const missing = (kind: string, id: string, name: string) => ({
        scope: { kind, id, name },
        state: "missing",
        running: false,
      });
      expect(res.body.items).toEqual([
        missing("area", "Worker", "Worker"),
        missing("area", "Documentos", "Documentos"),
        missing("area", "Finanças", "Finanças"),
        {
          scope: { kind: "area", id: "Projetos", name: "Projetos" },
          state: "fresh",
          generatedAt: w.ctx.runs.get(runId)!.startedAt,
          changes: { changed: 0, removed: 0, added: 0 },
          running: false,
        },
        missing("context", "cliente-x", "Cliente X"),
        missing("context", "alfa", "Alfa"),
      ]);
      expect(res.body.items).toHaveLength(6);
    });
  });
});

describe("C70 who may read summaries", () => {
  it("C70 through /api and /api/v1: the owner, a device with content and mcp (on the route of its tool) pass; a device without content 403 scope_required; area/nope 404 scope_not_found", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const monitor = w.device(["monitor"]);
      for (const prefix of ["/api", "/api/v1"]) {
        for (const rest of ["/memory/summaries", "/memory/summaries/area/Projetos"]) {
          const url = `${prefix}${rest}`;
          const passing: Array<[string, Record<string, string>]> = [
            ["owner", w.owner()],
            ["device content", w.device(["content"])],
            // the principal mcp reads the one route its tool summary calls (door 7, MCP_ROUTES)
            ...(rest.endsWith("/Projetos") ? [["mcp", mcpOf(w)] as [string, Record<string, string>]] : []),
          ];
          for (const [who, headers] of passing) {
            const res = await w.call("GET", url, undefined, headers);
            expect(res.status, `${who} ${url} ${JSON.stringify(res.body)}`).toBe(200);
          }
          expect(code(await w.call("GET", url, undefined, monitor)), url).toEqual([403, "scope_required"]);
        }
        // the list is no route of an MCP tool (C41's MCP_ROUTES)
        expect(code(await w.call("GET", `${prefix}/memory/summaries`, undefined, mcpOf(w))), prefix).toEqual([
          403,
          "forbidden",
        ]);
        expect(code(await w.call("GET", `${prefix}/memory/summaries/area/nope`)), prefix).toEqual([
          404,
          "scope_not_found",
        ]);
      }
    });
  });
});

describe("C71 a summary by audience", () => {
  it("C71 a paragraph citing a file hidden from devices is dropped whole for a device, its sources and changes count only what it sees; the owner reads both", async () => {
    await fresh(async (w) => {
      const aberta = w.note(
        path.join(w.projetos, "aberta.md"),
        "# Aberta\n\n## Fato\n\nO Atlas existe.\n",
        PAST + 2000,
      );
      const hiddenDir = path.join(w.projetos, "sigilo");
      const fechada = w.note(
        path.join(hiddenDir, "fechada.md"),
        "# Fechada\n\n## Fato\n\nO Sigilo existe.\n",
        PAST + 1000,
      );
      w.update((s) => {
        s.folderAccess = [{ path: hiddenDir, agents: "read", devices: "hide" }];
      });
      await w.index();
      await w.summarize(AREA, {
        v: 1,
        paragraphs: [
          paragraph(aberta, "Fato", "O Atlas existe."),
          // a visible file and the hidden one: the paragraph goes whole
          {
            text: "O Atlas e o Sigilo existem.",
            citations: [
              { path: aberta, section: "Fato" },
              { path: fechada, section: "Fato" },
            ],
          },
        ],
      });
      // the hidden source changes: the owner's summary turns stale, the device's does not see it
      fs.writeFileSync(fechada, "# Fechada\n\n## Fato\n\nO Sigilo mudou de nome.\n");
      await w.index();

      const owner = await w.read("area", "Projetos");
      expect(owner.body.paragraphs.map((p: Json) => p.text)).toEqual([
        "O Atlas existe.",
        "O Atlas e o Sigilo existem.",
      ]);
      expect(owner.body.sources.map((s: Json) => [s.path, s.state])).toEqual([
        [aberta, "same"],
        [fechada, "changed"],
      ]);
      expect([owner.body.state, owner.body.changes]).toEqual(["stale", { changed: 1, removed: 0, added: 0 }]);

      const device = await w.read("area", "Projetos", w.device(["content"]));
      expect(device.status, JSON.stringify(device.body)).toBe(200);
      expect(device.body.paragraphs).toEqual([owner.body.paragraphs[0]]);
      expect(device.body.sources.map((s: Json) => [s.path, s.state])).toEqual([[aberta, "same"]]);
      expect([device.body.state, device.body.changes]).toEqual([
        "fresh",
        { changed: 0, removed: 0, added: 0 },
      ]);
      expect(JSON.stringify(device.body)).not.toContain(fechada);
      expect(JSON.stringify(device.body)).not.toContain("Sigilo");

      const list = await w.list(w.device(["content"]));
      expect(list.body.items.find((i: Json) => i.scope.id === "Projetos").state).toBe("fresh");
    });
  });
});
