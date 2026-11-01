import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { code, runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-memoria-confiavel, round 1 of the verification, part 2: what a paired device reads of the
 * output of runs (C160, C161) and of free text (C162), and the search index of each audience (C163). Over a real home
 * with the fake Claude CLI (`runWorld`); `notes/fin` is `hide` for devices and `write` for agents unless a case says so.
 */

const opened: RunWorld[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

const text = (body: unknown) => JSON.stringify(body);

async function seeded(
  prefix: string,
): Promise<{ w: RunWorld; fin: string; outra: string; secret: string; visible: string }> {
  const w = await runWorld(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const secret = w.put(path.join(fin, "segredo.md"), "# Segredo\n\nOrçamento sigiloso do cofre.\n");
  const visible = w.put(path.join(outra, "visivel.md"), "# Visível\n\nOrçamento público.\n");
  await w.index();
  return { w, fin, outra, secret, visible };
}

const hide = async (w: RunWorld, entries: Array<[string, "hide" | "read" | "write"]>) => {
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: entries.map(([p, devices]) => ({ path: p, agents: "write", devices })),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

async function ownerRun(w: RunWorld, cwd: string, prompt: string): Promise<string> {
  const res = await w.call("POST", "/api/runs", { prompt, mode: "read_only", cwd });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await w.ctx.execution.wait(res.body.runId);
  return res.body.runId as string;
}

/** A 1x1 PNG: the one type `GET /api/artifacts/raw` serves. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==",
  "base64",
);

// ---- C160: the artifacts of a run a device is told does not exist ---------------------------------------------------

describe("C160 the artifacts a device reads", () => {
  it("C160 none of a hidden run, of a run that is gone (fail closed), none listed with its title; the others as before", async () => {
    const { w, fin, outra } = await seeded("mordomo-round1-c160-");
    const hiddenRun = await ownerRun(w, fin, "leia");
    const visibleRun = await ownerRun(w, outra, "leia");
    const goneRun = crypto.randomUUID();
    const art = (...parts: string[]) => path.join(w.ctx.paths.artifacts, ...parts);
    const hiddenMd = w.put(
      art(hiddenRun, "relatorio.md"),
      "# Relatório do cofre\n\nconteúdo sigiloso do cofre\n",
    );
    const hiddenPng = w.put(art(hiddenRun, "grafico.png"), PNG);
    const visibleMd = w.put(art(visibleRun, "resumo.md"), "# Resumo aberto\n\nconteúdo público\n");
    const visiblePng = w.put(art(visibleRun, "grafico.png"), PNG);
    const goneMd = w.put(art(goneRun, "orfao.md"), "# Órfão\n\nconteúdo de uma execução podada\n");
    const loose = w.put(art("corrida", "solta.md"), "# Solta\n\nnão é de nenhuma execução\n");
    w.ctx.db
      .prepare("UPDATE runs SET artifacts_json = ? WHERE id = ?")
      .run(JSON.stringify([`${hiddenRun}/relatorio.md`, `${hiddenRun}/grafico.png`]), hiddenRun);
    w.ctx.db
      .prepare("UPDATE runs SET artifacts_json = ? WHERE id = ?")
      .run(JSON.stringify([`${visibleRun}/resumo.md`, `${visibleRun}/grafico.png`]), visibleRun);

    // the owner: all of them (the case is not empty)
    const ownerList = await w.call("GET", "/api/artifacts/list");
    expect(ownerList.body.items.map((i: Json) => i.path).sort()).toEqual(
      [hiddenMd, hiddenPng, visibleMd, visiblePng, goneMd, loose].sort(),
    );
    expect((await w.call("GET", "/api/artifacts/recent")).body.map((a: Json) => a.path).sort()).toEqual(
      [hiddenMd, hiddenPng, visibleMd, visiblePng].sort(),
    );

    await hide(w, [[fin, "hide"]]);
    const device = w.device(["content"]);
    const list = await w.call("GET", "/api/artifacts/list", undefined, device);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: Json) => i.path).sort()).toEqual([visibleMd, visiblePng, loose].sort());
    expect(list.body.total).toBe(3);
    expect(list.body.folders.sort()).toEqual(["corrida", visibleRun].sort());
    expect(list.body.skills).toEqual(
      (await w.call("GET", "/api/artifacts/list?folder=corrida", undefined, device)).body.skills,
    );
    for (const secret of [hiddenRun, goneRun, "Relatório do cofre", "Órfão"])
      expect(text(list.body)).not.toContain(secret);
    const recent = await w.call("GET", "/api/artifacts/recent", undefined, device);
    expect(recent.body.map((a: Json) => a.path).sort()).toEqual([visibleMd, visiblePng].sort());
    expect(text(recent.body)).not.toContain(hiddenRun);

    const file = (p: string, headers: Record<string, string>) =>
      w.call("GET", `/api/artifacts/file?p=${encodeURIComponent(p)}`, undefined, headers);
    const raw = (p: string, headers: Record<string, string>) =>
      w.app.inject({ method: "GET", url: `/api/artifacts/raw?p=${encodeURIComponent(p)}`, headers });
    for (const hidden of [hiddenMd, goneMd]) {
      expect(code(await file(hidden, device)), hidden).toEqual([404, "not_found"]);
      expect((await file(hidden, w.owner())).status, `owner ${hidden}`).toBe(200);
    }
    expect((await raw(hiddenPng, device)).statusCode).toBe(404);
    expect((await raw(hiddenPng, w.owner())).statusCode).toBe(200);
    expect((await file(visibleMd, device)).body.content).toContain("público");
    expect((await file(loose, device)).status).toBe(200);
    const png = await raw(visiblePng, device);
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");

    // a run that is gone is hidden only while devices have a hidden folder (L-061)
    await hide(w, []);
    expect((await file(goneMd, device)).status).toBe(200);
    expect((await file(hiddenMd, device)).status).toBe(200);
    expect((await w.call("GET", "/api/artifacts/list", undefined, device)).body.total).toBe(6);
  });
});

// ---- C161: the raw proposal.json ------------------------------------------------------------------------------------

describe("C161 a run's proposal.json", () => {
  it("C161 a device never reads one while a folder is hidden from it; a look-alike file and the default stay served", async () => {
    const { w, fin, outra } = await seeded("mordomo-round1-c161-");
    const visibleRun = await ownerRun(w, outra, "consolide");
    const art = (...parts: string[]) => path.join(w.ctx.paths.artifacts, ...parts);
    const proposal = {
      v: 1,
      summary: "revisão",
      ops: [
        {
          op: "add",
          section: "Facts",
          text: "Orçamento sigiloso do cofre",
          source: "notes/fin/segredo.md",
          line: 3,
        },
      ],
    };
    const raw = w.put(art(visibleRun, "proposal.json"), JSON.stringify(proposal));
    const nested = w.put(art(visibleRun, "extra", "proposal.json"), JSON.stringify(proposal));
    const lookalike = w.put(art(visibleRun, "proposal.json.md"), "# Notas sobre a proposta\n");
    const elsewhere = w.put(art("corrida", "proposal.json"), JSON.stringify({ not: "a run's" }));
    w.ctx.db
      .prepare("UPDATE runs SET artifacts_json = ? WHERE id = ?")
      .run(JSON.stringify([`${visibleRun}/proposal.json`, `${visibleRun}/proposal.json.md`]), visibleRun);
    const device = w.device(["content"]);
    const file = (p: string, headers: Record<string, string>) =>
      w.call("GET", `/api/artifacts/file?p=${encodeURIComponent(p)}`, undefined, headers);

    // nothing hidden from devices: served as before
    expect((await file(raw, device)).body.content).toContain("sigiloso");

    await hide(w, [[fin, "hide"]]);
    expect(code(await file(raw, device))).toEqual([404, "not_found"]);
    expect(code(await file(nested, device))).toEqual([404, "not_found"]);
    expect((await file(raw, w.owner())).body.content).toContain("sigiloso");
    // the look-alikes: a file with another name in the run's folder, and one named so outside any run's folder
    expect((await file(lookalike, device)).status).toBe(200);
    expect((await file(elsewhere, device)).status).toBe(200);
    const list = await w.call("GET", "/api/artifacts/list", undefined, device);
    expect(list.body.items.map((i: Json) => i.path).sort()).toEqual([lookalike, elsewhere].sort());
    const recent = await w.call("GET", "/api/artifacts/recent", undefined, device);
    expect(recent.body.map((a: Json) => a.path)).toEqual([lookalike]);
    expect(text(list.body) + text(recent.body)).not.toContain("sigiloso");
    expect(fin).toBeTruthy();
  });
});

// ---- C162: how a hidden folder is written in free text ------------------------------------------------------------

describe("C162 a hidden folder in free text", () => {
  it("C162 a name with a space, a path relative to memory/ or to the home and a ~/ one are written (pasta oculta); look-alikes are not", async () => {
    const { w, outra } = await seeded("mordomo-round1-c162-");
    const userHome = w.outside("userhome");
    const documentos = path.join(userHome, "Documentos");
    const pessoal = path.join(w.memory, "notes", "Fin Pessoal");
    const ficha = path.join(documentos, "Fin Pessoal");
    fs.mkdirSync(ficha, { recursive: true });
    w.put(path.join(pessoal, "segredo.md"), "# Segredo\n\nficha pessoal\n");
    w.put(path.join(ficha, "ficha.md"), "# Ficha\n");
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: documentos, area: null, enabled: true }];
    });
    await w.index();
    const was = process.env.HOME;
    process.env.HOME = userHome;
    try {
      const prompt = [
        `a ${pessoal}/segredo.md`,
        "b memory/notes/Fin Pessoal/segredo.md",
        "c notes/Fin Pessoal/segredo.md",
        "d ~/Documentos/Fin Pessoal/ficha.md",
        "e notes/Fin Pessoal2/x.md",
        "f notes/Fin/x.md",
        "g outro/notes/Fin Pessoal/x.md",
        `h ${outra}/visivel.md fim`,
      ].join(", ");
      const runId = await ownerRun(w, outra, prompt);
      w.ctx.db
        .prepare("UPDATE runs SET files_changed_json = ? WHERE id = ?")
        .run(
          JSON.stringify([`${pessoal}/segredo.md`, "notes/Fin Pessoal/segredo.md", `${outra}/visivel.md`]),
          runId,
        );
      w.ctx.notifications.add({
        kind: "system",
        title: "cita",
        body: "veja notes/Fin Pessoal/segredo.md.",
        runId,
      });
      await hide(w, [
        [pessoal, "hide"],
        [ficha, "hide"],
      ]);
      const device = w.device(["monitor"]);
      const detail = await w.call("GET", `/api/runs/${runId}`, undefined, device);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.run.promptSummary).toBe(
        [
          "a (pasta oculta)",
          "b (pasta oculta)",
          "c (pasta oculta)",
          "d (pasta oculta)",
          "e notes/Fin Pessoal2/x.md",
          "f notes/Fin/x.md",
          "g outro/notes/Fin Pessoal/x.md",
          `h ${outra}/visivel.md fim`,
        ].join(", "),
      );
      expect(detail.body.run.filesChanged).toEqual([`${outra}/visivel.md`]);
      const notes = await w.call("GET", "/api/notifications", undefined, device);
      expect(notes.body.items.find((n: Json) => n.title === "cita").body).toBe("veja (pasta oculta).");
      // the owner's answers carry every spelling as written
      const owner = await w.call("GET", `/api/runs/${runId}`);
      expect(owner.body.run.promptSummary).toBe(prompt);
      expect(owner.body.run.filesChanged).toEqual([
        `${pessoal}/segredo.md`,
        "notes/Fin Pessoal/segredo.md",
        `${outra}/visivel.md`,
      ]);
    } finally {
      if (was === undefined) delete process.env.HOME;
      else process.env.HOME = was;
    }
  });
});
