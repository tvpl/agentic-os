import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedHome, type AgentRun } from "@mordomo/core";
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

    it("a skill that talks of the run credential declares it needs one, and the two memory skills do", () => {
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
      ).toEqual(["consolidate-memory", "recall"]);
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
      const credential = s.ctx.runApiAccessFor({ id: live.id })!;
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
