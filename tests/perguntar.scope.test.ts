import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { askWorld, paragraph, threeNotes, type AskWorld, type Json } from "./helpers/perguntarWorld.js";

/**
 * .specs/features/cerebro-perguntar, batch A, S2 at the boundary: the four scopes of an ask (AC 17-24) through `POST
 * /api/memory/ask` and `GET /api/memory/ask/:id` over a real home whose Claude provider is the fake CLI; the scope's
 * resolution at its own layer is `perguntar.layer.test.ts` C26.
 */

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (world: AskWorld) => Promise<T>): Promise<T> {
  const world = await askWorld(`mordomo-perguntar-scope-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const QUESTION = "O que decidi sobre o onboarding?";
const ask = (scope: Json): Json => ({ question: QUESTION, mode: "direct", scope });
const errorCode = (r: { body: Json }) => r.body?.error?.code as string | undefined;
const statusAndCode = (r: { status: number; body: Json }) => [r.status, errorCode(r)];
const BODY = "# Nota\n\n## Decisão\n\nDecidi que o onboarding dura duas semanas.\n";
const inputsOf = (w: AskWorld, id: string): Record<string, string> => {
  const run = w.ctx.runs.get(id)!;
  return run.request?.kind === "skill" ? run.request.inputs : {};
};
/** The paths `sources` names, in its order. */
const sourcePaths = (sources: string) =>
  sources
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3, l.lastIndexOf(" § ")));

/** Start an ask, wait for its run, read it with the answer `content`. */
async function judged(w: AskWorld, scope: Json, content: unknown): Promise<Json> {
  w.answer(content);
  const res = await w.ask(ask(scope));
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await w.settle(res.body.id);
  return (await w.read(res.body.id)).body;
}

async function hideFromAgents(w: AskWorld, folder: string): Promise<void> {
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: [{ path: folder, agents: "hide", devices: "write" }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await w.index();
}

/** `<home>/projetos` indexed, with the context `cliente-x` over `<home>/projetos/cliente-x` and a look-alike beside it. */
async function clienteX(w: AskWorld) {
  const projetos = path.join(w.home, "projetos");
  const inside = w.put(path.join(projetos, "cliente-x", "decisoes.md"), BODY);
  const twin = w.put(path.join(projetos, "cliente-x-old", "decisoes.md"), BODY);
  w.update((s) => {
    s.indexedFolders = [{ path: projetos, area: null, enabled: true }];
  });
  w.context("cliente-x", "Cliente X", [path.join(projetos, "cliente-x")]);
  const notes = await threeNotes(w);
  return { inside, twin, ...notes };
}

describe("C21 a context scope", () => {
  it("C21 the run has contextId cliente-x and scope input context:cliente-x; sources holds only the context's files; an answer citing cliente-x-old is refused", async () => {
    await fresh(async (w) => {
      const { inside, twin, onboarding } = await clienteX(w);
      // the whole brain's recall reaches the three: the context is what leaves two out
      const all = (
        await w.call("GET", `/api/memory/recall?q=${encodeURIComponent(QUESTION)}&record=false&k=10`)
      ).body;
      expect((all.answerContext as Json[]).map((c) => c.path)).toEqual(
        expect.arrayContaining([inside, twin, onboarding]),
      );
      w.answer({ v: 1, paragraphs: [paragraph(twin, "Decisão")] });
      const res = await w.ask(ask({ kind: "context", id: "cliente-x" }));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const run = w.ctx.runs.get(res.body.id)!;
      expect(run.contextId).toBe("cliente-x");
      const inputs = inputsOf(w, res.body.id);
      expect(inputs.scope).toBe("context:cliente-x");
      expect(sourcePaths(inputs.sources!)).toEqual([inside]);
      await w.settle(res.body.id);
      const body = (await w.read(res.body.id)).body;
      expect(body.scope).toEqual({ kind: "context", id: "cliente-x" });
      expect(body.status).toBe("refused");
      expect(body.reason).toBe(
        `A citação do parágrafo 1 nomeia ${twin}, que está fora do escopo da pergunta.`,
      );
      const right = await judged(
        w,
        { kind: "context", id: "cliente-x" },
        { v: 1, paragraphs: [paragraph(inside, "Decisão")] },
      );
      expect(right.status, right.reason).toBe("answered");
    });
  });
});

describe("C22 an unknown context", () => {
  it("C22 scope { kind: context, id: nope } → 404 context_not_found, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const before = w.runCount();
      expect(statusAndCode(await w.ask(ask({ kind: "context", id: "nope" })))).toEqual([
        404,
        "context_not_found",
      ]);
      expect(w.runCount()).toBe(before);
    });
  });
});

describe("C23 a folder scope", () => {
  it("C23 scope input folder:<realpath>; notes/projetos/a.md accepted; projetos-antigo/x.md and the folder itself refused; a folder given through a symlink judges by its realpath", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const folder = path.join(w.memory, "notes", "projetos");
      const a = w.put(path.join(folder, "a.md"), BODY);
      const old = w.put(path.join(w.memory, "notes", "projetos-antigo", "x.md"), BODY);
      await w.index();
      const real = fs.realpathSync(folder);
      const scope = { kind: "folder", path: folder };

      w.answer({ v: 1, paragraphs: [paragraph(a, "Decisão")] });
      const res = await w.ask(ask(scope));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const inputs = inputsOf(w, res.body.id);
      expect(inputs.scope).toBe(`folder:${real}`);
      expect(sourcePaths(inputs.sources!)).toEqual([a]);
      await w.settle(res.body.id);
      expect((await w.read(res.body.id)).body.status).toBe("answered");

      const outside = await judged(w, scope, { v: 1, paragraphs: [paragraph(old, "Decisão")] });
      expect([outside.status, outside.reason]).toEqual([
        "refused",
        `A citação do parágrafo 1 nomeia ${old}, que está fora do escopo da pergunta.`,
      ]);
      const itself = await judged(w, scope, { v: 1, paragraphs: [paragraph(folder, "Decisão")] });
      expect([itself.status, itself.reason]).toEqual([
        "refused",
        `A citação do parágrafo 1 nomeia ${folder}, que o índice não tem.`,
      ]);

      const link = path.join(os.tmpdir(), `mordomo-perguntar-scope-link-${process.pid}-${++seq}`);
      fs.symlinkSync(folder, link);
      try {
        w.answer({ v: 1, paragraphs: [paragraph(a, "Decisão")] });
        const linked = await w.ask(ask({ kind: "folder", path: link }));
        expect(linked.status, JSON.stringify(linked.body)).toBe(202);
        expect(inputsOf(w, linked.body.id).scope).toBe(`folder:${real}`);
        await w.settle(linked.body.id);
        const read = (await w.read(linked.body.id)).body;
        expect([read.status, read.scope]).toEqual(["answered", { kind: "folder", path: real }]);
        const viaLinkOld = await judged(
          w,
          { kind: "folder", path: link },
          { v: 1, paragraphs: [paragraph(old, "Decisão")] },
        );
        expect(viaLinkOld.status).toBe("refused");
      } finally {
        fs.rmSync(link, { force: true });
      }
    });
  });
});

describe("C24 a folder outside the index", () => {
  const outside = async (w: AskWorld, folder: string) => {
    const before = w.runCount();
    expect(statusAndCode(await w.ask(ask({ kind: "folder", path: folder }))), folder).toEqual([
      400,
      "folder_outside_index",
    ]);
    expect(w.runCount()).toBe(before);
  };
  it("C24 /tmp/x (outside memory/ and every indexed root) → 400 folder_outside_index", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      await outside(w, "/tmp/x");
    });
  });
  it("C24 a relative path → 400 folder_outside_index", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      await outside(w, "notes");
    });
  });
  it("C24 a folder inside a folder hidden from agents → 400 folder_outside_index, the same folder accepted before it is hidden", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const privado = path.join(w.memory, "notes", "privado");
      w.put(path.join(privado, "sub", "d.md"), BODY);
      await w.index();
      const res = await w.ask(ask({ kind: "folder", path: path.join(privado, "sub") }));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
      await hideFromAgents(w, privado);
      await outside(w, path.join(privado, "sub"));
    });
  });
  it("C24 a folder inside an indexed root is accepted (202), and so is memory/ itself", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const root = w.indexedRoot("raiz");
      w.put(path.join(root, "pasta", "e.md"), BODY);
      await w.index();
      for (const folder of [path.join(root, "pasta"), w.memory]) {
        const res = await w.ask(ask({ kind: "folder", path: folder }));
        expect(res.status, `${folder} ${JSON.stringify(res.body)}`).toBe(202);
        await w.settle(res.body.id);
      }
    });
  });
});

describe("C25 a notes scope", () => {
  it("C25 1 path and 20 paths 202, the scope input notes: followed by the paths joined by ;, an answer citing a file outside them refused", async () => {
    await fresh(async (w) => {
      const { onboarding, plano } = await threeNotes(w);
      const extra = Array.from({ length: 19 }, (_, i) =>
        w.put(path.join(w.memory, "notes", "lote", `n${i}.md`), BODY),
      );
      await w.index();
      const single = await judged(
        w,
        { kind: "notes", paths: [onboarding] },
        { v: 1, paragraphs: [paragraph(plano, "Próximos passos")] },
      );
      expect(inputsOf(w, single.id).scope).toBe(`notes:${onboarding}`);
      expect([single.status, single.reason]).toEqual([
        "refused",
        `A citação do parágrafo 1 nomeia ${plano}, que está fora do escopo da pergunta.`,
      ]);
      const twenty = [onboarding, ...extra];
      expect(twenty).toHaveLength(20);
      const many = await judged(
        w,
        { kind: "notes", paths: twenty },
        { v: 1, paragraphs: [paragraph(extra[3]!, "Decisão")] },
      );
      expect(inputsOf(w, many.id).scope).toBe(`notes:${twenty.join(";")}`);
      expect(many.status, many.reason).toBe("answered");
      expect(many.scope).toEqual({ kind: "notes", paths: twenty });
    });
  });
  it("C25 0 paths and 21 paths 400 validation, no run", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const before = w.runCount();
      expect(statusAndCode(await w.ask(ask({ kind: "notes", paths: [] })))).toEqual([400, "validation"]);
      expect(statusAndCode(await w.ask(ask({ kind: "notes", paths: Array(21).fill(onboarding) })))).toEqual([
        400,
        "validation",
      ]);
      expect(w.runCount()).toBe(before);
    });
  });
  it("C25 a path the index does not have, one the policy excludes and one hidden from agents each 400 unknown_note with that path", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const ghost = path.join(w.memory, "notes", "nada.md");
      const excluded = w.put(path.join(w.memory, "notes", "fora", "e.md"), BODY);
      const hidden = w.put(path.join(w.memory, "notes", "privado", "h.md"), BODY);
      await w.index();
      w.update((s) => {
        s.excludes = [...s.excludes, "fora"];
      });
      await hideFromAgents(w, path.dirname(hidden));
      const before = w.runCount();
      for (const p of [ghost, excluded, hidden]) {
        const res = await w.ask(ask({ kind: "notes", paths: [onboarding, p] }));
        expect(statusAndCode(res), p).toEqual([400, "unknown_note"]);
        expect(res.body.error.message).toContain(p);
      }
      expect(w.runCount()).toBe(before);
    });
  });
});

describe("C26 the whole brain", () => {
  it("C26 scope all recalls from the whole index agents read, with no contextId, even with an active context in the UI preferences", async () => {
    await fresh(async (w) => {
      const { inside, twin } = await clienteX(w);
      const prefs = await w.call("PUT", "/api/ui-preferences", { activeContext: "cliente-x" });
      expect(prefs.status, JSON.stringify(prefs.body)).toBe(200);
      const res = await w.ask(ask({ kind: "all" }));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const run = w.ctx.runs.get(res.body.id)!;
      expect(run.contextId).toBeNull();
      const inputs = inputsOf(w, res.body.id);
      expect(inputs.scope).toBe("all");
      const owner = (await w.call("GET", `/api/memory/recall?q=${encodeURIComponent(QUESTION)}&record=false`))
        .body;
      expect(sourcePaths(inputs.sources!)).toEqual((owner.answerContext as Json[]).map((c) => c.path));
      expect(sourcePaths(inputs.sources!)).toEqual(expect.arrayContaining([inside, twin]));
      await w.settle(res.body.id);
    });
  });
});

describe("C27 the scope's shape", () => {
  it("C27 a missing scope, kind area, context with no id, folder with paths and notes with path are each 400 validation, no run", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const before = w.runCount();
      const { scope: _s, ...missing } = ask({ kind: "all" });
      for (const body of [
        missing,
        ask({ kind: "area", id: "x" }),
        ask({ kind: "context" }),
        ask({ kind: "folder", paths: [w.memory] }),
        ask({ kind: "notes", path: onboarding }),
      ]) {
        expect(statusAndCode(await w.ask(body)), JSON.stringify(body)).toEqual([400, "validation"]);
      }
      expect(w.runCount()).toBe(before);
    });
  });
});
