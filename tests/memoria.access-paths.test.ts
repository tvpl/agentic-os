import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API } from "../contracts/src/api/index.js";
import { code, runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";
import { stream, ticket } from "./helpers/sse.js";
import { fsWatchPayload } from "../core/src/sentinels/fsWatch.js";

/**
 * .specs/features/cerebro-memoria-confiavel, batch B1b (plan amendments 4 and 5): the scores anyone but the owner is
 * given (C149), and every route a paired device reads that can name a path (C150 to C159). Over a real home with the
 * fake Claude CLI (`runWorld`); `notes/fin` is `hide` for devices and `write` for agents throughout, so every refusal
 * here is the devices' level alone.
 */

const opened: RunWorld[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

const HIDDEN = "(pasta oculta)";

interface Seeded {
  w: RunWorld;
  fin: string;
  outra: string;
  secret: string;
  visible: string;
}

async function seeded(prefix: string): Promise<Seeded> {
  const w = await runWorld(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const secret = w.put(
    path.join(fin, "segredo.md"),
    "---\ntags: [cofre-secreto]\n---\n# Segredo\n\nOrçamento sigiloso do trimestre e do orçamento.\n",
  );
  const visible = w.put(
    path.join(outra, "visivel.md"),
    "---\ntags: [aberta]\n---\n# Visível\n\nOrçamento público do trimestre.\n",
  );
  w.put(path.join(outra, "outra.md"), "# Outra\n\nOrçamento, orçamento e orçamento do trimestre.\n");
  await w.index();
  return { w, fin, outra, secret, visible };
}

const hideFromDevices = async (w: RunWorld, fin: string) => {
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

/** A run of the owner, waited for. */
async function ownerRun(w: RunWorld, cwd: string, prompt: string): Promise<string> {
  const res = await w.call("POST", "/api/runs", { prompt, mode: "read_only", cwd });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await w.ctx.execution.wait(res.body.runId);
  return res.body.runId as string;
}

const text = (body: unknown) => JSON.stringify(body);

// ---- C149: the scores --------------------------------------------------------------------------------------------

describe("C149 the scores anyone but the owner is given", () => {
  it("C149 a device's and a run's search and recall scores are 1 / position; the owner's are the bm25 and the recall's own", async () => {
    const { w } = await seeded("mordomo-paths-c149-");
    const device = w.device(["content"]);
    const run = w.run("write");
    const search = "/api/memory/search?q=orcamento";
    const recall = "/api/memory/recall?q=orcamento%20trimestre&record=false";
    const owner = await w.call("GET", search);
    expect(owner.body.length).toBeGreaterThan(1);
    // the owner: the full-text score of each hit, as before
    for (const hit of owner.body as Json[]) {
      expect(hit.via).toBe("text");
      expect(hit.score).toBeLessThan(0);
    }
    const ownerRecall = await w.call("GET", recall);
    expect(ownerRecall.body.candidates.length).toBeGreaterThan(1);
    expect(ownerRecall.body.candidates.map((c: Json) => c.score)).not.toEqual(
      ownerRecall.body.candidates.map((_: Json, i: number) => 1 / (i + 1)),
    );
    for (const headers of [device, run.headers]) {
      const hits = (await w.call("GET", search, undefined, headers)).body as Json[];
      expect(hits.map((h) => h.score)).toEqual(hits.map((_, i) => 1 / (i + 1)));
      expect(hits.map((h) => h.path)).toEqual((owner.body as Json[]).map((h) => h.path));
      const r = (await w.call("GET", recall, undefined, headers)).body;
      expect(r.candidates.length).toBeGreaterThan(1);
      expect(r.candidates.map((c: Json) => c.score)).toEqual(
        r.candidates.map((_: Json, i: number) => 1 / (i + 1)),
      );
      expect(r.answerContext.length).toBeGreaterThan(0);
      expect(r.answerContext.map((c: Json) => c.score)).toEqual(
        r.answerContext.map((_: Json, i: number) => 1 / (i + 1)),
      );
    }
  });
});

// ---- C150 to C152: runs, the event stream, conversations ----------------------------------------------------------

describe("C150 the runs a device reads", () => {
  it("C150 no hidden run in the lists, 404 for one, and a visible run's hidden paths written as (pasta oculta)", async () => {
    const { w, fin, outra, secret, visible } = await seeded("mordomo-paths-c150-");
    const hiddenRun = await ownerRun(w, fin, "leia a nota");
    const visibleRun = await ownerRun(w, outra, `compare ${secret} com ${visible}`);
    // the files it changed, as a write run records them
    w.ctx.db
      .prepare("UPDATE runs SET files_changed_json = ? WHERE id = ?")
      .run(JSON.stringify([secret, visible]), visibleRun);
    const child = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "filho",
      cwd: fin,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      parentRunId: visibleRun,
      startedBy: "owner",
    });
    const ownerList = await w.call("GET", "/api/runs");
    expect(ownerList.body.map((r: Json) => r.id)).toEqual(expect.arrayContaining([hiddenRun, visibleRun]));
    expect(text((await w.call("GET", `/api/runs/${visibleRun}`)).body)).toContain(secret);

    await hideFromDevices(w, fin);
    const device = w.device(["monitor", "content"]);
    const list = await w.call("GET", "/api/runs", undefined, device);
    expect(list.body.map((r: Json) => r.id)).toContain(visibleRun);
    expect(list.body.map((r: Json) => r.id)).not.toContain(hiddenRun);
    expect(list.body.map((r: Json) => r.id)).not.toContain(child.id);
    expect(text(list.body)).not.toContain(fin);
    expect((await w.call("GET", `/api/runs/${visibleRun}/children`, undefined, device)).body).toEqual([]);
    expect((await w.call("GET", `/api/runs/${visibleRun}/children`)).body.map((r: Json) => r.id)).toEqual([
      child.id,
    ]);
    for (const url of [
      `/api/runs/${hiddenRun}`,
      `/api/runs/${hiddenRun}/children`,
      `/api/runs/${hiddenRun}/diff?file=${encodeURIComponent(secret)}`,
    ]) {
      expect(code(await w.call("GET", url, undefined, device)), url).toEqual([404, "not_found"]);
    }
    const streamTicket = await ticket(w, device, { target: "run", runId: hiddenRun });
    expect(
      code(await w.call("GET", `/api/runs/${hiddenRun}/stream?ticket=${streamTicket}`, undefined, {})),
    ).toEqual([404, "not_found"]);
    const detail = await w.call("GET", `/api/runs/${visibleRun}`, undefined, device);
    expect(detail.status).toBe(200);
    expect(detail.body.run.promptSummary).toBe(`compare ${HIDDEN} com ${visible}`);
    expect(detail.body.run.filesChanged).toEqual([visible]);
    expect(text(detail.body)).not.toContain(fin);
    // the visible run's own stream: its frames carry no hidden path
    const runTicket = await ticket(w, device, { target: "run", runId: visibleRun });
    const frames = await stream(
      w,
      `/api/runs/${visibleRun}/stream?ticket=${runTicket}`,
      /run_state/,
      async () => undefined,
    );
    expect(frames).toContain("run_state");
    expect(frames).not.toContain(fin);
    const ownerDetail = await w.call("GET", `/api/runs/${visibleRun}`);
    expect(ownerDetail.body.run.promptSummary).toBe(`compare ${secret} com ${visible}`);
    expect(ownerDetail.body.run.filesChanged).toEqual([secret, visible]);
  });
});

describe("C151 the event stream a device reads", () => {
  it("C151 no run or notification event of a hidden run, and a visible run's events carry (pasta oculta)", async () => {
    const { w, fin, outra, secret } = await seeded("mordomo-paths-c151-");
    await hideFromDevices(w, fin);
    const device = w.device(["monitor"]);
    const hiddenRun = await ownerRun(w, fin, "antes");
    const visibleRun = await ownerRun(w, outra, "antes");
    const emit = async () => {
      w.ctx.events.emit("run.created", { runId: hiddenRun, origin: "manual", provider: "claude" });
      w.ctx.notifications.add({ kind: "system", title: "da escondida", runId: hiddenRun });
      w.ctx.notifications.add({ kind: "system", title: `veja ${secret}`, runId: visibleRun });
      w.ctx.events.emit("run.created", { runId: visibleRun, origin: "manual", provider: "claude" });
      w.ctx.events.emit("notification.read", { all: true });
    };
    const devStream = await stream(
      w,
      `/api/events?ticket=${await ticket(w, device, { target: "events" })}`,
      /notification\.read/,
      emit,
    );
    expect(devStream).toContain(visibleRun);
    expect(devStream).not.toContain(hiddenRun);
    expect(devStream).not.toContain("da escondida");
    expect(devStream).toContain(`veja ${HIDDEN}`);
    expect(devStream).not.toContain(fin);
    const ownStream = await stream(
      w,
      `/api/events?ticket=${await ticket(w, w.owner(), { target: "events" })}`,
      /notification\.read/,
      emit,
    );
    expect(ownStream).toContain(hiddenRun);
    expect(ownStream).toContain(`veja ${secret}`);
  });
});

describe("C152 the conversations a device reads", () => {
  it("C152 no conversation in a hidden folder, 404 for one, and no hidden run in a visible one", async () => {
    const { w, fin, outra } = await seeded("mordomo-paths-c152-");
    const hiddenRun = await ownerRun(w, fin, "a");
    const visibleRun = await ownerRun(w, outra, "b");
    const hiddenSession = w.ctx.runs.get(hiddenRun)!.sessionId!;
    const visibleSession = w.ctx.runs.get(visibleRun)!.sessionId!;
    // a run of the visible conversation that ran in the hidden folder
    const stray = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "c",
      cwd: fin,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      sessionId: visibleSession,
      startedBy: "owner",
    });
    await hideFromDevices(w, fin);
    const device = w.device(["monitor"]);
    const list = await w.call("GET", "/api/sessions", undefined, device);
    expect(list.body.map((s: Json) => s.id)).toEqual([visibleSession]);
    expect(code(await w.call("GET", `/api/sessions/${hiddenSession}`, undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    const one = await w.call("GET", `/api/sessions/${visibleSession}`, undefined, device);
    expect(one.body.runs.map((r: Json) => r.id)).toEqual([visibleRun]);
    expect((await w.call("GET", "/api/sessions")).body.map((s: Json) => s.id).sort()).toEqual(
      [hiddenSession, visibleSession].sort(),
    );
    expect(
      (await w.call("GET", `/api/sessions/${visibleSession}`)).body.runs.map((r: Json) => r.id).sort(),
    ).toEqual([visibleRun, stray.id].sort());
  });
});

// ---- C153 to C155: approvals, notifications, objectives ------------------------------------------------------------

describe("C153 the approvals a device reads and decides", () => {
  it("C153 no approval of a hidden run, 404 to read or resolve it, a gone run's approval hidden while devices hide a folder", async () => {
    const { w, fin, outra } = await seeded("mordomo-paths-c153-");
    w.update((s) => {
      s.securityProfile = "review_before_write";
    });
    const park = async (url: string, body: Json) => {
      const res = await w.call("POST", url, body);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      return res.body.pendingApproval.id as string;
    };
    const inHidden = await park("/api/runs", { prompt: "escreva", mode: "write", cwd: fin });
    const handed = await park("/api/skills/organize-brain/run", {
      inputs: { folder: fin, etapa: "indexar" },
    });
    const inVisible = await park("/api/runs", { prompt: "escreva", mode: "write", cwd: outra });
    const orphan = await park("/api/runs", { prompt: "escreva", mode: "write", cwd: outra });
    const orphanRun = w.ctx.approvals.get(orphan)!.payload.runId as string;
    w.ctx.db.prepare("DELETE FROM runs WHERE id = ?").run(orphanRun);

    await hideFromDevices(w, fin);
    const monitor = w.device(["monitor"]);
    const listed = await w.call("GET", "/api/approvals", undefined, monitor);
    expect(listed.body.map((a: Json) => a.id)).toEqual([inVisible]);
    for (const id of [inHidden, handed, orphan]) {
      expect(code(await w.call("GET", `/api/approvals/${id}`, undefined, monitor)), id).toEqual([
        404,
        "not_found",
      ]);
    }
    const approver = w.device(["approve"]);
    expect(
      code(await w.call("POST", `/api/approvals/${inHidden}/resolve`, { decision: "approved" }, approver)),
    ).toEqual([404, "not_found"]);
    expect(w.ctx.approvals.get(inHidden)!.status).toBe("pending");
    expect((await w.call("GET", "/api/approvals")).body.map((a: Json) => a.id).sort()).toEqual(
      [inHidden, handed, inVisible, orphan].sort(),
    );
    // with no folder hidden from devices, the approval whose run is gone is shown again (the fail-closed case is its own)
    await w.call("PUT", "/api/settings", { folderAccess: [] });
    expect(
      (await w.call("GET", "/api/approvals", undefined, monitor)).body.map((a: Json) => a.id).sort(),
    ).toEqual([inHidden, handed, inVisible, orphan].sort());
  });
});

describe("C154 the notifications a device reads", () => {
  it("C154 none of a hidden run, of a gone run, or opening a hidden file; hidden paths in a body written (pasta oculta); unread counts what is shown", async () => {
    const { w, fin, outra, secret, visible } = await seeded("mordomo-paths-c154-");
    const hiddenRun = await ownerRun(w, fin, "a");
    const visibleRun = await ownerRun(w, outra, "b");
    const before = new Set(w.ctx.notifications.list({ limit: 1000 }).map((n) => n.id));
    for (const id of before) w.ctx.notifications.delete(id);
    const add = (title: string, extra: Json = {}) =>
      w.ctx.notifications.add({ kind: "system", title, ...extra }).id;
    const ofHidden = add("da escondida", { runId: hiddenRun });
    const ofGone = add("de uma que sumiu", { runId: crypto.randomUUID() });
    const opensHidden = add("abrir", { href: `#/brain/notes?open=${encodeURIComponent(secret)}` });
    const cites = add("cita", { body: `leia ${secret} e ${visible}`, runId: visibleRun });
    const plain = add("normal", { href: `#/brain/notes?open=${encodeURIComponent(visible)}` });
    await hideFromDevices(w, fin);
    const device = w.device(["monitor"]);
    const res = await w.call("GET", "/api/notifications", undefined, device);
    expect(res.body.items.map((n: Json) => n.id).sort()).toEqual([cites, plain].sort());
    expect(res.body.items.find((n: Json) => n.id === cites).body).toBe(`leia ${HIDDEN} e ${visible}`);
    expect(res.body.unread).toBe(2);
    const owner = await w.call("GET", "/api/notifications");
    expect(owner.body.items.map((n: Json) => n.id).sort()).toEqual(
      [ofHidden, ofGone, opensHidden, cites, plain].sort(),
    );
    expect(owner.body.unread).toBe(5);
    expect(owner.body.items.find((n: Json) => n.id === cites).body).toBe(`leia ${secret} e ${visible}`);
  });
});

describe("C155 the objectives a device reads", () => {
  it("C155 no hidden source, the visible one kept, a hidden path in the description written (pasta oculta)", async () => {
    const { w, fin, secret, visible } = await seeded("mordomo-paths-c155-");
    const created = await w.call("POST", "/api/objectives", {
      title: "Objetivo",
      description: `Fechar ${secret} antes de ${visible}`,
      context: {
        sources: [
          { label: "segredo", path: secret },
          { label: "visível", path: visible },
        ],
      },
      steps: [{ title: "Passo", request: { version: 1, kind: "prompt", prompt: "leia", mode: "read_only" } }],
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const id = created.body.id as string;
    await hideFromDevices(w, fin);
    const device = w.device(["monitor"]);
    for (const url of ["/api/objectives", `/api/objectives/${id}`]) {
      const res = await w.call("GET", url, undefined, device);
      expect(res.status, url).toBe(200);
      const objective = Array.isArray(res.body) ? res.body.find((o: Json) => o.id === id) : res.body;
      expect(
        objective.context.sources.map((s: Json) => s.path),
        url,
      ).toEqual([visible]);
      expect(objective.description, url).toBe(`Fechar ${HIDDEN} antes de ${visible}`);
      expect(text(res.body), url).not.toContain(fin);
    }
    const owner = await w.call("GET", `/api/objectives/${id}`);
    expect(owner.body.context.sources.map((s: Json) => s.path)).toEqual([secret, visible]);
  });
});

// ---- C156 to C158: the status facets, skills, connectors ---------------------------------------------------------

describe("C156 the facets of the memory status a device reads", () => {
  it("C156 equal the twin's: no tag, extension or count of the hidden files", async () => {
    const { w, fin } = await seeded("mordomo-paths-c156-");
    const ownerFacets = (await w.call("GET", "/api/memory/status")).body.facets;
    expect(text(ownerFacets), "the owner counts the hidden tag (the case is not empty)").toContain(
      "cofre-secreto",
    );
    await hideFromDevices(w, fin);
    const facets = (await w.call("GET", "/api/memory/status", undefined, w.device(["monitor"]))).body.facets;
    expect(text(facets)).not.toContain("cofre-secreto");
    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    expect(facets).toEqual((await w.call("GET", "/api/memory/status")).body.facets);
  });
});

describe("C157 the skills a device reads", () => {
  it("C157 the skill, its notes and a text resource write a hidden path as (pasta oculta); the owner's carry it", async () => {
    const { w, fin, secret } = await seeded("mordomo-paths-c157-");
    const dir = path.join(w.ctx.paths.skills, "organize-brain");
    fs.appendFileSync(path.join(dir, "SKILL.md"), `\nVeja também ${secret}.\n`);
    fs.writeFileSync(path.join(dir, "NOTES.md"), `# Notes\n\n- a nota ${secret} é a de referência\n`);
    fs.writeFileSync(
      path.join(dir, "resources", "b1b-ref.md"),
      `# Referência\n\nA pasta ${fin} guarda o orçamento.\n`,
    );
    await hideFromDevices(w, fin);
    const device = w.device(["content"]);
    const urls = [
      "/api/skills/organize-brain",
      "/api/skills/organize-brain/notes",
      "/api/skills/organize-brain/resource?rel=resources/b1b-ref.md",
    ];
    for (const url of urls) {
      const owned = await w.app.inject({ method: "GET", url, headers: w.owner() });
      expect(owned.statusCode, `${url} ${owned.body.slice(0, 200)}`).toBe(200);
      expect(owned.body, url).toContain(fin);
      const res = await w.app.inject({ method: "GET", url, headers: device });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain(fin);
      expect(res.body, url).toContain(HIDDEN);
    }
  });
});

describe("C158 the connectors a device reads", () => {
  it("C158 no connector whose entry point is hidden, 404 for its data, a hidden path in notes written (pasta oculta)", async () => {
    const { w, fin, secret } = await seeded("mordomo-paths-c158-");
    const make = async (id: string, extra: Json) => {
      const res = await w.call("POST", "/api/connectors", {
        id,
        name: id,
        kind: "cli",
        origin: "teste",
        maintainer: "teste",
        ...extra,
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    };
    await make("escondido", { entryPoint: path.join(fin, "ferramenta.sh") });
    await make("aberto", { notes: `lê ${secret} toda manhã` });
    await hideFromDevices(w, fin);
    const device = w.device(["content"]);
    const list = await w.call("GET", "/api/connectors", undefined, device);
    const ids = (list.body.connectors ?? list.body).map((c: Json) => c.id);
    expect(ids).toContain("aberto");
    expect(ids).not.toContain("escondido");
    expect(text(list.body)).not.toContain(fin);
    expect(text(list.body)).toContain(`lê ${HIDDEN} toda manhã`);
    expect(code(await w.call("GET", "/api/connectors/escondido/data", undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    expect(text((await w.call("GET", "/api/connectors")).body)).toContain(path.join(fin, "ferramenta.sh"));
  });
});

// ---- C159: every other route a device may read -------------------------------------------------------------------

describe("C159 every GET route a device may call", () => {
  it("C159 none answers a hidden path; routines in a hidden folder are not there; a route the table gains fails this test", async () => {
    const { w, fin, outra, secret, visible } = await seeded("mordomo-paths-c159-");
    // the hidden folder cited everywhere a device can read
    const visibleRun = await ownerRun(w, outra, `compare ${secret}`);
    const session = w.ctx.runs.get(visibleRun)!.sessionId!;
    w.ctx.notifications.add({ kind: "system", title: `veja ${secret}` });
    const routine = await w.call("POST", "/api/routines", {
      id: "rotina-escondida",
      name: "Rotina",
      prompt: `leia ${secret}`,
      kind: "every",
      every: { value: 1, unit: "hours" },
      workingDir: fin,
      provider: "claude",
      enabled: false,
    });
    expect(routine.status, JSON.stringify(routine.body)).toBeLessThan(300);
    const objective = await w.call("POST", "/api/objectives", {
      title: "O",
      description: secret,
      steps: [
        { title: "P", request: { version: 1, kind: "prompt", prompt: `leia ${secret}`, mode: "read_only" } },
      ],
    });
    const board = await w.call("POST", "/api/dashboards", { template: "overview" });
    const fact = await w.call("POST", "/api/memory/facts", {
      subject: "S",
      predicate: "p",
      object: secret,
      sourcePath: visible,
    });
    expect(fact.status).toBe(201);
    w.update((s) => {
      s.contexts = [{ id: "ctx", name: "Ctx", paths: [outra, fin] }];
    });
    const proposal = await w.call("POST", "/api/memory/proposals", {
      kind: "fact",
      subject: "S",
      predicate: "p",
      object: secret,
      sourcePath: visible,
    });
    expect(proposal.status).toBe(201);
    const note = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(visible)}`);
    await w.call("PUT", "/api/memory/notes", {
      path: visible,
      content: `${note.body.content}\n${secret}\n`,
      baseVersion: note.body.version,
    });
    const version = (await w.call("GET", "/api/memory/history")).body.versions[0].id;
    await w.index();
    const scan = await w.call("POST", "/api/memory/cleanup/scans", { dir: path.join(w.memory, "notes") });
    for (
      let i = 0;
      i < 400 &&
      (await w.call("GET", `/api/memory/cleanup/scans/${scan.body.scanId}`)).body.status === "running";
      i++
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const visibleId = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(visible) as { id: number })
      .id;
    // An indexed folder hidden from the devices that the fs sentinel has spoken about (round 2 finding 8): its name and
    // the counts of the passes are not a path, and the sweep looks for them in every answer as it looks for a path.
    const cofre = w.indexedRoot("c159-cofre");
    await w.index();
    w.ctx.events.emit("sentinel.fired", fsWatchPayload(cofre, 7));
    const cofreName = path.basename(cofre);
    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [
        { path: fin, agents: "write", devices: "hide" },
        { path: cofre, agents: "write", devices: "hide" },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await w.index();

    const enc = encodeURIComponent;
    const urls: Record<string, string> = {
      "approvals.list": "/api/approvals",
      "artifacts.list": "/api/artifacts/list",
      "artifacts.recent": "/api/artifacts/recent",
      "connectors.list": "/api/connectors",
      "contexts.list": "/api/contexts",
      "dashboards.list": "/api/dashboards",
      "dashboards.get": `/api/dashboards/${board.body.id}`,
      "doctor.get": "/api/doctor?audit=0",
      "health.get": "/api/health",
      "memory.cleanup.inventory": `/api/memory/cleanup/inventory?dir=${enc(path.join(w.memory, "notes"))}`,
      "memory.cleanup.scans.get": `/api/memory/cleanup/scans/${scan.body.scanId}`,
      "memory.facts.list": "/api/memory/facts",
      "memory.graph": "/api/memory/graph",
      "memory.history.list": "/api/memory/history",
      "memory.history.get": `/api/memory/history/${version}`,
      "memory.hygiene": "/api/memory/hygiene",
      "memory.journal": "/api/memory/journal?days=7",
      "memory.links": `/api/memory/links?id=${visibleId}`,
      "memory.maps": "/api/memory/maps",
      "memory.note": `/api/memory/note?p=${enc(visible)}`,
      "memory.preview": `/api/memory/preview?p=${enc(visible)}`,
      "memory.proposals.list": "/api/memory/proposals",
      "memory.proposals.get": `/api/memory/proposals/${proposal.body.proposal.id}`,
      "memory.query": "/api/memory/query?where=status",
      "memory.recall": "/api/memory/recall?q=orcamento&record=false",
      "memory.recall.stats": "/api/memory/recall/stats",
      "memory.related": `/api/memory/related?id=${visibleId}`,
      "memory.reviews.list": "/api/memory/reviews?kind=unclassified",
      "memory.routers.check": "/api/memory/routers/check",
      "memory.search": "/api/memory/search?q=orcamento",
      "memory.status": "/api/memory/status",
      "memory.tree": `/api/memory/tree?root=${enc(w.memory)}&dir=notes`,
      "metrics.get": "/api/metrics",
      "metrics.history": "/api/metrics/history?days=1",
      "notifications.list": "/api/notifications",
      "objectives.list": "/api/objectives",
      "objectives.get": `/api/objectives/${objective.body.id}`,
      "openapi.get": "/api/openapi.json",
      "providers.list": "/api/providers",
      "push.vapid": "/api/push/vapid",
      "routines.list": "/api/routines",
      "routines.history": "/api/routines/rotina-escondida/history",
      "routines.silent": "/api/routines/silent?days=30",
      "routines.summary": "/api/routines/summary",
      "runs.list": "/api/runs",
      "runs.get": `/api/runs/${visibleRun}`,
      "runs.children.list": `/api/runs/${visibleRun}/children`,
      "runs.diff": `/api/runs/${visibleRun}/diff?file=${enc(visible)}`,
      "sentinels.list": "/api/sentinels",
      "sessions.list": "/api/sessions",
      "sessions.get": `/api/sessions/${session}`,
      "settings.get": "/api/settings",
      "skills.list": "/api/skills",
      "skills.get": "/api/skills/organize-brain",
      "skills.notes.get": "/api/skills/organize-brain/notes",
      "system.info": "/api/system/info",
      "telegram.status": "/api/channels/telegram/status",
      "uiPreferences.get": "/api/ui-preferences",
      "updates.check": "/api/updates",
    };
    // Proven elsewhere: the two streams (C150, C151), a binary artifact (C116) and a skill's resource (C157); an
    // approval, a connector's data and an artifact file by id have no visible row here to call with (C153, C158, C116).
    const elsewhere = new Set([
      "events.stream",
      "runs.stream",
      "artifacts.raw",
      "skills.resource",
      "approvals.get",
      "connectors.data",
      "artifacts.file",
    ]);
    const deviceGets = Object.entries(API)
      .filter(([, r]) => r.method === "GET" && r.scope !== "owner" && r.public !== true)
      .map(([id]) => id)
      .sort();
    expect(deviceGets.filter((id) => !(id in urls) && !elsewhere.has(id))).toEqual([]);
    expect([...Object.keys(urls), ...elsewhere].filter((id) => !deviceGets.includes(id))).toEqual([]);
    const device = w.device(["content", "monitor", "run", "approve"]);
    for (const id of deviceGets) {
      if (elsewhere.has(id)) continue;
      const res = await w.app.inject({ method: "GET", url: urls[id]!, headers: device });
      expect(res.statusCode, `${id} ${res.body.slice(0, 300)}`).toBeLessThan(500);
      expect(res.body.includes(fin), `${id} answers the hidden folder`).toBe(false);
      expect(res.body.includes(cofreName), `${id} names the hidden indexed folder`).toBe(false);
    }
    // no count over every file: the status of the memory has the counts of the pass at zero, the stats of a pass that
    // ends are not sent, and a number of a hidden folder's own (the 7 files that changed in it) is in no row
    const status = (
      await w.app.inject({ method: "GET", url: urls["memory.status"]!, headers: device })
    ).json() as Json;
    expect(Object.values(status.lastIndex.stats as Record<string, number>).every((n) => n === 0)).toBe(true);
    expect(JSON.stringify((await w.call("GET", "/api/notifications", undefined, device)).body)).not.toMatch(
      /7 files|scanned/,
    );
    // routines in a hidden folder are not there for a device; the owner's are
    const routines = await w.call("GET", "/api/routines", undefined, device);
    expect(routines.body.map((r: Json) => r.id)).not.toContain("rotina-escondida");
    expect(code(await w.call("GET", "/api/routines/rotina-escondida/history", undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    expect((await w.call("GET", "/api/routines")).body.map((r: Json) => r.id)).toContain("rotina-escondida");
    expect((await w.call("GET", "/api/routines/rotina-escondida/history")).status).toBe(200);
  });
});
