import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { startSecureServer, type SecureServer } from "./helpers/securityHarness.js";

/**
 * Security P1, round 3 (.specs/features/seguranca-p1, C49): the built-in skills and routines were written for an
 * agent that starts in the MordomoOS home (they say `cat config/token`, `memory/MEMORY.md`). A run now starts in
 * `<home>/workspace`. This runs every one of them against the context the engine really gives: the working
 * directory `RunManager` decides, the prompt the catalog builds, the folders and the environment the agent is
 * handed, and the credential it gets in place of the owner token.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSIX = process.platform !== "win32";

/** A path under one of the home's folders written relative to wherever the agent happens to be. */
const RELATIVE_HOME_PATH = /(^|[\s`"'(=])(config|logs|memory|routines|connectors|skills)\/[\w.*<{-]/;
/** Ways to reach the owner token. */
const TOKEN_REACH = /config\/token|cat\s+config|x-mordomo-token:\s*\$\(/;

function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(full));
    else if (/\.(md|json|txt|ya?ml)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe.skipIf(!POSIX)(
  "C49 the built-in skills and routines run in the context the engine gives them",
  () => {
    let s: SecureServer;
    let captured: Array<{ slug: string; run: AgentRun }> = [];
    let current = "";

    beforeAll(async () => {
      s = await startSecureServer("mordomo-builtin-");
      seedHome(s.ctx.paths, repoRoot);
      // The adapter every provider run goes through: record what the agent is handed, then run the fake CLI.
      const execute = ClaudeAdapter.prototype.execute;
      vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
        this: ClaudeAdapter,
        run: AgentRun,
      ) {
        captured.push({ slug: current, run });
        return execute.call(this, run);
      });
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await s.close();
    });

    const skills = () => s.ctx.skills.list();

    it("finds every built-in skill and routine in the seeded home", () => {
      expect(skills().length).toBeGreaterThanOrEqual(14);
      expect(s.ctx.routines.list().map((r) => r.id)).toEqual(
        expect.arrayContaining(["nightly-consolidation", "daily-workspace-digest", "service-heartbeat"]),
      );
    });

    it("no built-in skill names a path relative to the home, or a way to the owner token, in any file it ships", () => {
      for (const skill of skills()) {
        for (const file of textFiles(skill.dir)) {
          const text = fs.readFileSync(file, "utf8");
          expect(text, `${skill.slug}: ${path.relative(skill.dir, file)}`).not.toMatch(TOKEN_REACH);
          for (const line of text.split("\n")) {
            expect(line, `${skill.slug}: ${path.relative(skill.dir, file)}`).not.toMatch(RELATIVE_HOME_PATH);
          }
        }
      }
    });

    it("no built-in routine starts in the home or names a relative path; every working directory resolves", () => {
      for (const routine of s.ctx.routines.list()) {
        const text = `${routine.prompt ?? ""} ${JSON.stringify(routine.inputs ?? {})}`;
        expect(text, routine.id).not.toMatch(TOKEN_REACH);
        for (const line of text.split("\n")) expect(line, routine.id).not.toMatch(RELATIVE_HOME_PATH);
        if (routine.context === "isolated") continue; // a throwaway directory of its own
        const cwd = s.ctx.runs.resolveCwd(routine.workingDir);
        expect(cwd, routine.id).not.toBe(s.home);
        expect(cwd.startsWith(path.join(s.home, "config")), routine.id).toBe(false);
        if (routine.workingDir === null) expect(cwd, routine.id).toBe(path.join(s.home, "workspace"));
      }
    });

    it("the prompt built for each skill hands over absolute paths and no relative path to the home", () => {
      for (const skill of skills()) {
        const artifacts = path.join(s.ctx.paths.artifacts, "run-x");
        const prompt = s.ctx.skills.buildRunPrompt(skill, {}, artifacts);
        expect(prompt, skill.slug).toContain(skill.skillFile);
        expect(prompt, skill.slug).toContain(skill.dir);
        expect(prompt, skill.slug).not.toMatch(TOKEN_REACH);
        for (const line of prompt.split("\n")) expect(line, skill.slug).not.toMatch(RELATIVE_HOME_PATH);
        if (skill.memoryAccess) {
          expect(prompt, skill.slug).toContain(path.join(s.ctx.paths.memory, "MEMORY.md"));
          expect(prompt, skill.slug).toContain(path.join(s.ctx.paths.memory, "journal"));
          expect(prompt, skill.slug).toContain("MORDOMO_RUN_TOKEN");
        } else {
          expect(prompt, skill.slug).not.toContain(s.ctx.paths.memory);
          expect(prompt, skill.slug).not.toContain("MORDOMO_RUN_TOKEN");
        }
      }
    });

    it("a skill that talks of the run credential is one the owner's settings name, and the three memory skills are", () => {
      // cerebro-organizar (AC 9, C11): organize-brain is the third built-in memory skill; cerebro-paineis (door 7,
      // amendment 19) adds dashboard-answer after it.
      expect(s.ctx.settings().memorySkills).toEqual([
        "recall",
        "consolidate-memory",
        "organize-brain",
        "dashboard-answer",
      ]);
      for (const skill of skills()) {
        const text = textFiles(skill.dir)
          .map((f) => fs.readFileSync(f, "utf8"))
          .join("\n");
        expect(/MORDOMO_RUN_TOKEN|MORDOMO_URL/.test(text), `${skill.slug} mentions the credential`).toBe(
          skill.memoryAccess,
        );
      }
      expect(
        skills()
          .filter((k) => k.memoryAccess)
          .map((k) => k.slug)
          .sort(),
      ).toEqual(["consolidate-memory", "dashboard-answer", "organize-brain", "recall"]);
    });

    it("each skill run starts in <home>/workspace with its own folder, and a memory skill also gets memory/ and its credential", async () => {
      const workspace = path.join(s.home, "workspace");
      captured = [];
      for (const skill of skills()) {
        current = skill.slug;
        const record = s.ctx.runs.create({
          origin: "skill",
          provider: "claude",
          prompt: "go",
          cwd: s.home, // what a stored run, or a skill run with no cwd, asks for
          model: null,
          effort: "default",
          mode: skill.mode === "write" ? "read_only" : "read_only",
          timeoutMs: 30_000,
          profile: "read_only",
          skillSlug: skill.slug,
        } as never);
        await s.ctx.runs.execute(record.id, "go", "read_only");
      }
      expect(captured.map((c) => c.slug).sort()).toEqual(
        skills()
          .map((k) => k.slug)
          .sort(),
      );
      for (const { slug, run } of captured) {
        const skill = skills().find((k) => k.slug === slug)!;
        expect(run.cwd, slug).toBe(workspace);
        const dirs = run.readDirs ?? [];
        expect(dirs, slug).toContain(fs.realpathSync(skill.dir));
        for (const dir of dirs) {
          expect(
            dir === s.home ||
              dir.startsWith(path.join(s.home, "config")) ||
              dir.startsWith(path.join(s.home, "logs")),
            `${slug}: ${dir}`,
          ).toBe(false);
        }
        if (skill.memoryAccess) {
          expect(dirs, slug).toContain(fs.realpathSync(s.ctx.paths.memory));
          expect(run.extraEnv?.MORDOMO_RUN_TOKEN, slug).toMatch(/^rc_[\w-]{43}$/);
          expect(run.extraEnv?.MORDOMO_URL, slug).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          expect(Object.values(run.extraEnv ?? {}), slug).not.toContain(s.ownerToken);
          // the Claude adapter lets exactly those folders in
          const inv = await new ClaudeAdapter({ binaryPath: "claude" }).buildInvocation(run);
          const added = inv.args.flatMap((a, i) => (a === "--add-dir" ? [inv.args[i + 1]] : []));
          expect(added, slug).toEqual([run.artifactsDir, ...dirs]);
        } else {
          expect(dirs, slug).toEqual([fs.realpathSync(skill.dir)]);
          expect(run.extraEnv, slug).toBeUndefined();
        }
      }
    }, 120_000);

    it("the run credential reaches the memory routes only, while its run lives, and is not the owner token", async () => {
      const memorySkill = captured.find((c) => c.slug === "consolidate-memory")!;
      const token = memorySkill.run.extraEnv!.MORDOMO_RUN_TOKEN!;
      expect(token).not.toBe(s.ownerToken);
      const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
        s.app.inject({
          method,
          url,
          headers: { "x-mordomo-token": token, "content-type": "application/json" },
          ...(payload ? { payload: payload as never } : {}),
        });
      // its run has finished (the fake CLI exits at once): the credential died with it
      for (const [method, url] of [
        ["GET", "/api/memory/recall?q=anything"],
        ["GET", "/api/memory/facts"],
        ["GET", "/api/settings"],
      ] as const) {
        expect((await call(method, url)).statusCode, `${method} ${url} after the run`).toBe(401);
      }
      // a live run: hold one open with a slow fake CLI
      const live = s.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "go",
        cwd: s.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        skillSlug: "recall",
        status: "queued",
      } as never);
      const credential = s.ctx.runApiAccessFor({ id: live.id }, "write")!;
      const liveCall = (method: "GET" | "POST", url: string, payload?: unknown) =>
        s.app.inject({
          method,
          url,
          headers: { "x-mordomo-token": credential.token, "content-type": "application/json" },
          ...(payload ? { payload: payload as never } : {}),
        });
      expect((await liveCall("GET", "/api/memory/recall?q=anything&record=false")).statusCode).toBe(200);
      expect((await liveCall("GET", "/api/memory/recall/stats")).statusCode).toBe(200);
      expect((await liveCall("GET", "/api/memory/journal")).statusCode).toBe(200);
      expect((await liveCall("GET", "/api/memory/facts")).statusCode).toBe(200);
      expect(
        (await liveCall("POST", "/api/memory/journal/append", { text: "from a memory skill run" }))
          .statusCode,
      ).toBe(200);
      for (const [method, url] of [
        ["GET", "/api/settings"],
        ["GET", "/api/runs"],
        ["GET", "/api/skills"],
        ["GET", "/api/devices"],
        ["GET", `/api/memory/preview?p=${encodeURIComponent(s.tokenFile())}`],
        ["POST", "/api/memory/routers"],
        ["POST", "/api/runs"],
        ["POST", "/api/approvals/tool"],
      ] as const) {
        const res = await liveCall(method, url, method === "POST" ? {} : undefined);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.body, `${method} ${url}`).not.toContain(s.ownerToken);
      }
      // once the run is over, nothing
      s.ctx.runs.cancel(live.id);
      await new Promise((r) => setTimeout(r, 20));
      expect((await liveCall("GET", "/api/memory/facts")).statusCode).toBe(401);
      // a credential that never existed
      expect((await call("GET", "/api/memory/facts")).statusCode).toBe(401);
    });

    it("a read-only run's credential only reads; a write run's writes, as itself, within a cap; it recalls from memory/ only", async () => {
      const live = (mode: "read_only" | "write") =>
        s.ctx.runs.create({
          origin: "skill",
          provider: "claude",
          prompt: "go",
          cwd: s.home,
          model: null,
          effort: "default",
          mode,
          timeoutMs: 30_000,
          profile: mode === "write" ? "controlled_write" : "read_only",
          skillSlug: "consolidate-memory",
          status: "queued",
        } as never);
      const calls = (token: string) => (method: "GET" | "POST", url: string, payload?: unknown) =>
        s.app.inject({
          method,
          url,
          headers: { "x-mordomo-token": token, "content-type": "application/json" },
          ...(payload ? { payload: payload as never } : {}),
        });
      const readOnlyRun = live("read_only");
      const writeRun = live("write");
      const ro = calls(s.ctx.runApiAccessFor({ id: readOnlyRun.id }, "read_only")!.token);
      const rw = calls(s.ctx.runApiAccessFor({ id: writeRun.id }, "write")!.token);

      // reading is the same for both; writing is for the run that may write
      for (const call of [ro, rw]) {
        for (const url of [
          "/api/memory/recall?q=anything&record=false",
          "/api/memory/recall/stats",
          "/api/memory/journal",
          "/api/memory/facts",
        ]) {
          expect((await call("GET", url)).statusCode, url).toBe(200);
        }
      }
      const fact = { subject: "s", predicate: "p", object: "o" };
      for (const [method, url, payload] of [
        ["POST", "/api/memory/journal/append", { text: "x" }],
        ["POST", "/api/memory/facts", fact],
      ] as const) {
        const refused = await ro(method, url, payload);
        expect(refused.statusCode, `read-only ${url}`).toBe(403);
        expect(refused.json().error.message).toContain("read-only run");
      }
      expect((await rw("POST", "/api/memory/journal/append", { text: "from a write run" })).statusCode).toBe(
        200,
      );

      // the fact says which run asserted it: the run's own id, whatever the body claims
      const asserted = await rw("POST", "/api/memory/facts", {
        ...fact,
        object: "o2",
        sourceRunId: "somebody-else",
      });
      expect(asserted.statusCode, asserted.body).toBe(201);
      const stored = s.ctx.db.prepare("SELECT source_run_id FROM facts WHERE object = 'o2'").get() as {
        source_run_id: string;
      };
      expect(stored.source_run_id).toBe(writeRun.id);

      // recall: the owner finds a note in a granted folder, the run's credential only what is in memory/
      fs.mkdirSync(path.join(s.userFolder, "notes"), { recursive: true });
      fs.writeFileSync(
        path.join(s.userFolder, "notes", "elsewhere.md"),
        "# quokka elsewhere\nquokka in a granted folder\n",
      );
      fs.writeFileSync(
        path.join(s.home, "memory", "inside.md"),
        "# quokka inside\nquokka in the memory folder\n",
      );
      s.ctx.indexer.indexAll();
      const paths = (res: {
        json(): { answerContext: Array<{ path: string }>; candidates: Array<{ path: string }> };
      }) => [...res.json().answerContext, ...res.json().candidates].map((c) => c.path).join("\n");
      const owner = await s.app.inject({
        method: "GET",
        url: "/api/memory/recall?q=quokka&record=false",
        headers: s.asOwner(),
      });
      expect(paths(owner)).toContain("elsewhere.md");
      const run = await ro("GET", "/api/memory/recall?q=quokka&record=false");
      expect(paths(run)).toContain("inside.md");
      expect(paths(run)).not.toContain("elsewhere.md");
      expect(run.body).not.toContain("granted folder");

      // the request log says who called
      await s.app.inject({ method: "GET", url: "/api/memory/facts", headers: s.asOwner() });
      const lines = fs
        .readFileSync(path.join(s.home, "logs", "api.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { url?: string; by?: string | null; status?: number });
      const by = lines.filter((l) => l.url?.startsWith("/api/memory/facts")).map((l) => l.by);
      expect(by).toContain(`run:${writeRun.id}`);
      expect(by).toContain(`run:${readOnlyRun.id}`);
      expect(by).toContain("owner");
      expect(JSON.stringify(lines)).not.toMatch(/rc_[A-Za-z0-9_-]{40,}/);

      // a cap per run: the 101st write is a 429, and another run still writes
      const spare = live("write");
      const spareCall = calls(s.ctx.runApiAccessFor({ id: spare.id }, "write")!.token);
      let last = 200;
      for (let i = 0; i < 101; i++) {
        last = (
          await spareCall("POST", "/api/memory/journal/append", { text: `line ${i}`, timestamp: false })
        ).statusCode;
      }
      expect(last).toBe(429);
      expect((await rw("POST", "/api/memory/journal/append", { text: "still fine" })).statusCode).toBe(200);
    });

    it("a credential is forgotten the moment its run finishes, the broker's included", async () => {
      const record = s.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "go",
        cwd: s.home,
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 30_000,
        profile: "controlled_write",
        skillSlug: "recall",
        status: "queued",
      } as never);
      const credential = s.ctx.runApiAccessFor({ id: record.id }, "write")!.token;
      const broker = s.ctx.permissionBrokerFor({ id: record.id, permissionProfile: "controlled_write" })!.env
        .MORDOMO_TOKEN!;
      const maps = () => ({
        run: (s.ctx as unknown as { runApiCredentials: Map<string, unknown> }).runApiCredentials,
        broker: (s.ctx as unknown as { brokerCredentials: Map<string, unknown> }).brokerCredentials,
      });
      expect(maps().run.has(credential)).toBe(true);
      expect(maps().broker.has(broker)).toBe(true);
      s.ctx.events.emit("run.finished", { runId: record.id, status: "done", durationMs: 1 });
      expect(maps().run.has(credential)).toBe(false);
      expect(maps().broker.has(broker)).toBe(false);
      // and a run that finishes for real leaves nothing behind
      const before = maps().run.size;
      captured = [];
      current = "recall";
      const done = s.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "go",
        cwd: s.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        skillSlug: "recall",
      } as never);
      await s.ctx.runs.execute(done.id, "go", "read_only");
      expect(maps().run.size).toBe(before);
    });

    it("the credential reaches the agent process, and nothing else of MordomoOS's environment does", async () => {
      const bin = path.join(s.userFolder, "env-bin");
      fs.mkdirSync(bin, { recursive: true });
      const out = path.join(s.userFolder, "env-seen.txt");
      fs.writeFileSync(
        path.join(bin, "claude"),
        `#!/bin/sh\ncat >/dev/null\nprintf '%s|%s|%s' "$MORDOMO_URL" "$MORDOMO_RUN_TOKEN" "$MORDOMO_LEAK" > "${out}"\n`,
        { mode: 0o755 },
      );
      process.env.MORDOMO_LEAK = "service-secret";
      try {
        const adapter = new ClaudeAdapter({ binaryPath: path.join(bin, "claude") });
        const run: AgentRun = {
          runId: "env-probe",
          prompt: "go",
          cwd: s.userFolder,
          model: null,
          effort: "default",
          mode: "read_only",
          timeoutMs: 10_000,
          profile: "read_only",
          artifactsDir: path.join(s.home, "artifacts", "env-probe"),
          dropEnv: { names: [], prefixes: ["MORDOMO_"] },
          extraEnv: { MORDOMO_URL: "http://127.0.0.1:1", MORDOMO_RUN_TOKEN: "rc_probe" },
        };
        fs.mkdirSync(run.artifactsDir, { recursive: true });
        for await (const event of adapter.execute(run)) void event;
        expect(fs.readFileSync(out, "utf8")).toBe("http://127.0.0.1:1|rc_probe|");
      } finally {
        delete process.env.MORDOMO_LEAK;
      }
    });

    it("a skill folder that is a link out of the home fails the run before the agent starts", async () => {
      const outside = path.join(s.userFolder, "outside-skill");
      fs.mkdirSync(outside, { recursive: true });
      fs.symlinkSync(outside, path.join(s.home, "skills", "linkout"));
      captured = [];
      current = "linkout";
      const record = s.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "go",
        cwd: s.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        skillSlug: "linkout",
      } as never);
      const done = await s.ctx.runs.execute(record.id, "go", "read_only");
      // fails closed: the catalog will not read a SKILL.md that is a link out, so the run never reaches the agent
      expect(done.status).toBe("failed");
      expect(done.error).toContain("outside the granted folders");
      expect(captured).toEqual([]);
      fs.rmSync(path.join(s.home, "skills", "linkout"));
    });

    it("the skill's own folder is protected from edits in every mode; a link into config/ in a folder handed to the agent fails the run", async () => {
      const run = async (slug: string) => {
        captured = [];
        current = slug;
        const record = s.ctx.runs.create({
          origin: "skill",
          provider: "claude",
          prompt: "go",
          cwd: s.home,
          model: null,
          effort: "default",
          mode: "read_only",
          timeoutMs: 30_000,
          profile: "read_only",
          skillSlug: slug,
        } as never);
        return s.ctx.runs.execute(record.id, "go", "read_only");
      };
      expect((await run("recall")).status).toBe("done");
      const recall = captured[0]!.run;
      expect(recall.protectedDirs).toEqual([fs.realpathSync(path.join(s.home, "skills", "recall"))]);
      const claude = new ClaudeAdapter({ binaryPath: "claude" });
      for (const mode of ["read_only", "write"] as const) {
        const inv = await claude.buildInvocation({
          ...recall,
          mode,
          profile: mode === "write" ? "controlled_write" : "read_only",
        });
        const denied = inv.args
          .flatMap((a, i) => (a === "--disallowedTools" ? [inv.args[i + 1]!] : []))
          .join(",");
        const rule = `/${recall.protectedDirs![0]}`;
        for (const tool of ["Edit", "Write", "MultiEdit"])
          expect(denied, `${mode} ${tool}`).toContain(`${tool}(${rule}/**)`);
      }
      // a run of a skill without protected folders adds nothing to the write mode arguments
      const bare = await claude.buildInvocation({
        ...recall,
        protectedDirs: undefined,
        mode: "write",
        profile: "controlled_write",
      });
      expect(bare.args).not.toContain("--disallowedTools");

      // links and second names leading into config/ or logs/, in either folder the agent is given
      const plants: Array<[string, string, (at: string) => void]> = [
        ["symbolic link to the token", "skills/recall/leak", (at) => fs.symlinkSync(s.tokenFile(), at)],
        [
          "dangling link into config/",
          "skills/recall/pending",
          (at) => fs.symlinkSync(path.join(s.home, "config", "later"), at),
        ],
        ["hard link to the token", "memory/notes/hard.md", (at) => fs.linkSync(s.tokenFile(), at)],
        [
          "link to a folder of config/",
          "memory/cfg",
          (at) => fs.symlinkSync(path.join(s.home, "config", "db"), at),
        ],
      ];
      fs.mkdirSync(path.join(s.home, "memory", "notes"), { recursive: true });
      fs.mkdirSync(path.join(s.home, "config", "db"), { recursive: true });
      for (const [what, rel, plant] of plants) {
        const at = path.join(s.home, rel);
        plant(at);
        try {
          const done = await run("recall");
          expect(done.status, what).toBe("failed");
          expect(done.error, what).toContain("link into the MordomoOS config/ or logs/");
          expect(captured, `${what}: the agent was not started`).toEqual([]);
        } finally {
          fs.rmSync(at, { force: true });
        }
      }
      // memory/ itself turned into a link to a folder of config/: it is not handed over as a folder of the agent
      fs.renameSync(path.join(s.home, "memory"), path.join(s.home, "memory.bak"));
      fs.symlinkSync(path.join(s.home, "config", "db"), path.join(s.home, "memory"));
      try {
        expect((await run("recall")).status).toBe("done");
        const dirs = captured[0]!.run.readDirs ?? [];
        expect(dirs.some((d) => d.startsWith(path.join(s.home, "config")))).toBe(false);
        expect(dirs).toEqual([fs.realpathSync(path.join(s.home, "skills", "recall"))]);
      } finally {
        fs.rmSync(path.join(s.home, "memory"));
        fs.renameSync(path.join(s.home, "memory.bak"), path.join(s.home, "memory"));
      }
      // a link to somewhere harmless inside memory/ (or to a user's folder) is fine
      fs.symlinkSync(path.join(s.userFolder), path.join(s.home, "memory", "vault"));
      fs.symlinkSync(path.join(s.home, "memory", "notes"), path.join(s.home, "memory", "alias"));
      try {
        expect((await run("recall")).status).toBe("done");
      } finally {
        fs.rmSync(path.join(s.home, "memory", "vault"));
        fs.rmSync(path.join(s.home, "memory", "alias"));
      }
    });

    it("no skill gives itself the memory: not through the API, not through a link to a memory skill's file, not as a device", async () => {
      const run = async (slug: string) => {
        captured = [];
        current = slug;
        const record = s.ctx.runs.create({
          origin: "skill",
          provider: "claude",
          prompt: "go",
          cwd: s.home,
          model: null,
          effort: "default",
          mode: "read_only",
          timeoutMs: 30_000,
          profile: "read_only",
          skillSlug: slug,
        } as never);
        const done = await s.ctx.runs.execute(record.id, "go", "read_only");
        expect(done.status, slug).toBe("done");
        return captured[0]!.run;
      };
      const body = (slug: string, extra: Record<string, unknown> = {}) => ({
        frontmatter: {
          name: slug,
          slug,
          description: "d",
          memoryAccess: true,
          needs: { memory: true },
          ...extra,
        },
        body: "Do it.",
      });
      for (const [who, headers] of s.principals()) {
        const slug = `sneaky-${who}`;
        if (who === "device") {
          // escopos-dispositivo (AD-015): writing a skill is the owner's, so a device cannot even try; nothing is made.
          for (const method of ["POST", "PUT"] as const) {
            const refused = await s.app.inject({
              method,
              url: method === "POST" ? "/api/skills" : `/api/skills/${slug}`,
              headers,
              payload: body(slug),
            });
            expect(refused.statusCode, `${who} ${method}`).toBe(403);
            expect(refused.json().error.code, `${who} ${method}`).toBe("owner_only");
          }
          expect(s.ctx.skills.load(slug), `${who} writes nothing`).toBeNull();
          continue;
        }
        const created = await s.app.inject({
          method: "POST",
          url: "/api/skills",
          headers,
          payload: body(slug),
        });
        expect(created.statusCode, created.body).toBe(200);
        expect(s.ctx.skills.load(slug)?.memoryAccess, `${who} POST`).toBe(false);
        expect(
          fs.readFileSync(path.join(s.home, "skills", slug, "SKILL.md"), "utf8"),
          `${who} file`,
        ).not.toContain("memoryAccess");
        const updated = await s.app.inject({
          method: "PUT",
          url: `/api/skills/${slug}`,
          headers,
          payload: body(slug),
        });
        expect(updated.statusCode, updated.body).toBe(200);
        expect(s.ctx.skills.load(slug)?.memoryAccess, `${who} PUT`).toBe(false);
        const ran = await run(slug);
        expect(ran.extraEnv, `${who}: no credential`).toBeUndefined();
        expect(ran.readDirs, `${who}: no memory folder`).toEqual([
          fs.realpathSync(path.join(s.home, "skills", slug)),
        ]);
      }
      // a skill whose SKILL.md is a link to a memory skill's own file reads that file, and is still not a memory skill
      fs.mkdirSync(path.join(s.home, "skills", "borrowed"), { recursive: true });
      fs.symlinkSync("../recall/SKILL.md", path.join(s.home, "skills", "borrowed", "SKILL.md"));
      try {
        expect(s.ctx.skills.load("borrowed")?.name).toBe("Recall");
        expect(s.ctx.skills.load("borrowed")?.memoryAccess).toBe(false);
        const ran = await run("borrowed");
        expect(ran.extraEnv).toBeUndefined();
      } finally {
        fs.rmSync(path.join(s.home, "skills", "borrowed"), { recursive: true });
      }
      // the list is the owner's: a device cannot change it, the owner can, and only then does a skill gain the memory
      const patch = { memorySkills: ["recall", "consolidate-memory", "organize-brain", "sneaky-owner"] };
      const asDevice = await s.app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: s.asDevice(),
        payload: patch,
      });
      expect(asDevice.statusCode).toBe(403);
      expect(s.ctx.settings().memorySkills).not.toContain("sneaky-owner");
      const asOwner = await s.app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: s.asOwner(),
        payload: patch,
      });
      expect(asOwner.statusCode, asOwner.body).toBe(200);
      try {
        expect((await run("sneaky-owner")).extraEnv?.MORDOMO_RUN_TOKEN).toMatch(/^rc_/);
      } finally {
        s.ctx.settingsStore.update({ memorySkills: ["recall", "consolidate-memory", "organize-brain"] });
      }
    });

    it("a skill imported from a folder cannot give itself the memory", async () => {
      const src = path.join(s.userFolder, "greedy");
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(
        path.join(src, "SKILL.md"),
        ["---", "name: Greedy", "description: d", "memoryAccess: true", "---", "Body"].join("\n"),
      );
      const res = await s.app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: s.asOwner(),
        payload: { sourceDir: src, slug: "greedy" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(s.ctx.skills.load("greedy")?.memoryAccess).toBe(false);
      expect(fs.readFileSync(path.join(s.home, "skills", "greedy", "SKILL.md"), "utf8")).not.toContain(
        "memoryAccess: true",
      );
    });
  },
);
