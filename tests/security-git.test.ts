import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findOnPath } from "@mordomo/core/internal";
import { startSecureServer, type SecureServer } from "./helpers/securityHarness.js";

/**
 * Security P1, round 3 (.specs/features/seguranca-p1, C39-C40): what git reads on the diff route is decided by
 * the path the filter judged and by a location the repository cannot move. The proofs run the real git behind
 * the real route, as a paired device and as the owner, against a repository that is hostile in the two ways
 * the round-2 verifier used: a pathspec that is a pattern, and a `.git/config` that moves the work tree.
 */

const POSIX = process.platform !== "win32";
const gitPath = findOnPath("git");

describe.skipIf(!POSIX || !gitPath)(
  "C39-C40 the run diff reads only what the filter judged, from where we say",
  () => {
    let s: SecureServer;
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(gitPath!, ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    let counter = 0;
    /** A repository in the user's folder: committed once, then every file changed. */
    const repoWith = (files: Record<string, string>, changed: Record<string, string>) => {
      const repo = path.join(s.userFolder, `repo-${++counter}`);
      fs.mkdirSync(repo);
      git(repo, "init", "-q");
      for (const [name, text] of Object.entries(files)) write(path.join(repo, name), text);
      git(repo, "add", "-f", ".");
      git(repo, "commit", "-q", "-m", "init");
      for (const [name, text] of Object.entries(changed)) write(path.join(repo, name), text);
      return repo;
    };
    const runIn = (cwd: string) =>
      s.ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "diff",
        cwd,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        status: "waiting_approval",
      });
    const diff = (runId: string, file: string, headers: Record<string, string>) =>
      s.app.inject({
        method: "GET",
        url: `/api/runs/${runId}/diff?file=${encodeURIComponent(file)}`,
        headers,
      });

    beforeAll(async () => {
      s = await startSecureServer("mordomo-git-");
    });
    afterAll(async () => {
      await s.close();
    });

    it("C39 a pathspec that is a pattern, a magic prefix or a directory does not read a file the filter blocks", async () => {
      const repo = repoWith(
        {
          ".env": "API_KEY=first-secret\n",
          "server.pem": "-----BEGIN PRIVATE KEY-----\nfirst\n",
          "ok.txt": "one\n",
          "sub/.env": "SUB_KEY=first-sub-secret\n",
          "sub/fine.txt": "fine\n",
          "pub/fine.txt": "fine\n",
        },
        {
          ".env": "API_KEY=HUNTER2-CHANGED\n",
          "server.pem": "-----BEGIN PRIVATE KEY-----\nHUNTER2-PEM\n",
          "ok.txt": "two\n",
          "sub/.env": "SUB_KEY=HUNTER2-SUB\n",
          "sub/fine.txt": "fine two\n",
          "pub/fine.txt": "fine two\n",
        },
      );
      const run = runIn(repo);
      const SECRET = /HUNTER2|first-secret|first-sub-secret|BEGIN PRIVATE KEY/;
      const attacks = [
        path.join(repo, "*"),
        path.join(repo, "*.pem"),
        path.join(repo, ".en?"),
        path.join(repo, "?env"),
        path.join(repo, "[.]env"),
        path.join(repo, ":(top).env"),
        path.join(repo, ":(top,glob)**/.env"),
        path.join(repo, ":(glob)**/.env"),
        path.join(repo, ":/.env"),
        path.join(repo, ":!ok.txt"),
        "*",
        "?env",
        "[.]env",
        ":(top).env",
        ":(glob)**/.env",
        // a directory is every file under it
        path.join(repo, "sub"),
        "sub",
      ];
      for (const [who, headers] of s.principals()) {
        for (const file of attacks) {
          const res = await diff(run.id, file, headers);
          expect(res.body, `${who} ${file}`).not.toMatch(SECRET);
          expect([200, 403], `${who} ${file}`).toContain(res.statusCode);
        }
        // the literal names stay refused, and an ordinary file and a directory of ordinary files still diff
        for (const secret of [".env", "server.pem", "sub/.env"]) {
          const res = await diff(run.id, secret, headers);
          expect(res.json().kind, `${who} ${secret}`).toBe("unavailable");
        }
        const dir = await diff(run.id, "sub", headers);
        expect(dir.json().kind, `${who} sub`).toBe("unavailable");
        const fine = await diff(run.id, "ok.txt", headers);
        expect(fine.json().kind, who).toBe("git");
        expect(fine.json().diff, who).toContain("+two");
        const pub = await diff(run.id, "pub", headers);
        expect(pub.json().kind, `${who} pub`).toBe("git");
        expect(pub.json().diff, `${who} pub`).toContain("+fine two");
      }
    });

    it("C39 a secret that was renamed and staged is still a blocked file in the diff of its folder", async () => {
      const repo = repoWith({ "d/.env": "API_KEY=HUNTER2-RENAMED-SECRET\n", "d/keep.txt": "keep\n" }, {});
      // `.env` becomes `notes.txt` (same content): git sees a rename once staged
      fs.renameSync(path.join(repo, "d", ".env"), path.join(repo, "d", "notes.txt"));
      git(repo, "add", "-A");
      const run = runIn(repo);
      for (const [who, headers] of s.principals()) {
        for (const file of ["d", path.join(repo, "d")]) {
          const res = await diff(run.id, file, headers);
          expect(res.statusCode, `${who} ${file}`).toBe(200);
          expect(res.body, `${who} ${file}`).not.toContain("HUNTER2-RENAMED-SECRET");
          expect(res.json().kind, `${who} ${file}`).toBe("unavailable");
        }
      }
    });

    it("C39 a list of files cut short by the output cap is not judged whole: the diff is unavailable", async () => {
      const names = Array.from(
        { length: 5200 },
        (_, i) => `${String(i).padStart(5, "0")}-${"x".repeat(200)}.txt`,
      );
      const files = Object.fromEntries(names.map((n) => [`big/${n}`, "one\n"]));
      const changed = Object.fromEntries(names.map((n) => [`big/${n}`, "two\n"]));
      const repo = repoWith(files, changed);
      const run = runIn(repo);
      for (const [who, headers] of s.principals()) {
        const res = await diff(run.id, "big", headers);
        expect(res.statusCode, who).toBe(200);
        expect(res.json().kind, who).toBe("unavailable");
      }
    }, 60_000);

    it("C39 a changed link that points outside the granted folders (or into config/) makes the folder's diff unavailable", async () => {
      const repo = repoWith({ "d/ok.txt": "one\n" }, {});
      const outside = path.join(s.userFolder, "..", `outside-${++counter}.txt`);
      fs.writeFileSync(outside, "outside\n");
      const elsewhere = `${outside}.other`;
      fs.writeFileSync(elsewhere, "elsewhere\n");
      for (const target of [outside, s.tokenFile()]) {
        fs.rmSync(path.join(repo, "d", "link"), { force: true });
        fs.symlinkSync(target, path.join(repo, "d", "link"));
        git(repo, "add", "-f", "d/link");
        git(repo, "commit", "-q", "-m", `link to ${path.basename(target)}`);
        fs.rmSync(path.join(repo, "d", "link"));
        fs.symlinkSync(elsewhere, path.join(repo, "d", "link"));
        write(path.join(repo, "d", "ok.txt"), `two-${path.basename(target)}\n`);
        const run = runIn(repo);
        for (const [who, headers] of s.principals()) {
          const res = await diff(run.id, "d", headers);
          expect(res.statusCode, `${who} ${target}`).toBe(200);
          expect(res.json().kind, `${who} ${target}`).toBe("unavailable");
          expect(res.body, `${who} ${target}`).not.toContain(s.ownerToken);
        }
      }
      fs.rmSync(outside);
      fs.rmSync(elsewhere);
    });

    it("C39 a repository with no commit yet is diffed against its index", async () => {
      const repo = path.join(s.userFolder, `fresh-${++counter}`);
      fs.mkdirSync(repo);
      git(repo, "init", "-q");
      write(path.join(repo, "a.txt"), "one\n");
      git(repo, "add", "a.txt");
      write(path.join(repo, "a.txt"), "two\n");
      const run = runIn(repo);
      for (const [who, headers] of s.principals()) {
        const res = await diff(run.id, "a.txt", headers);
        expect(res.json().kind, who).toBe("git");
        expect(res.json().diff, who).toContain("+two");
      }
    });

    it("C39 a file whose name looks like a pathspec is diffed as that file, and only that file", async () => {
      const repo = repoWith(
        { "star*.txt": "star one\n", "starx.txt": "other one\n" },
        { "star*.txt": "star two\n", "starx.txt": "other two\n" },
      );
      const run = runIn(repo);
      for (const [who, headers] of s.principals()) {
        const res = await diff(run.id, "star*.txt", headers);
        expect(res.json().kind, who).toBe("git");
        expect(res.json().diff, who).toContain("+star two");
        expect(res.json().diff, who).not.toContain("other two");
      }
    });

    /** A repository tracking `token` whose `.git/config` moves the work tree onto the home's config/. */
    const worktreeAttack = (extraConfig: string) => {
      const repo = repoWith({ token: "committed-placeholder\n" }, {});
      fs.appendFileSync(
        path.join(repo, ".git", "config"),
        extraConfig.replaceAll("<config>", path.join(s.home, "config")),
      );
      return repo;
    };
    const noTokenAnywhere = async (repo: string, label: string) => {
      const run = runIn(repo);
      for (const [who, headers] of s.principals()) {
        for (const file of [path.join(repo, "token"), "token"]) {
          const res = await diff(run.id, file, headers);
          expect(res.body, `${label} ${who} ${file}`).not.toContain(s.ownerToken);
        }
      }
    };

    it("C40 core.worktree (with or without bare) does not move the work tree git compares", async () => {
      await noTokenAnywhere(worktreeAttack(`[core]\n\tworktree = <config>\n`), "core.worktree");
      await noTokenAnywhere(
        worktreeAttack(`[core]\n\tworktree = <config>\n\tbare = true\n`),
        "worktree+bare",
      );
      // control: the same attack on the git a verifier runs by hand does read the token, so the proof above is not vacuous
      const control = worktreeAttack(`[core]\n\tworktree = <config>\n`);
      const raw = execFileSync(gitPath!, ["diff", "HEAD", "--", "token"], { cwd: control, env }).toString();
      expect(raw, "git without --work-tree follows core.worktree").toContain(s.ownerToken);
      // the diff of the repository's own file is still the file's
      const run = runIn(control);
      const res = await diff(run.id, path.join(control, "token"), s.asOwner());
      expect(res.statusCode).toBe(200);
    });

    it("C40 a config that includes a file, a gitfile and a git symlink are not followed: the answer is a plain snapshot", async () => {
      // [include] path = the token: git would parse the token as config and say what it holds
      await noTokenAnywhere(worktreeAttack(`[include]\n\tpath = <config>/token\n`), "include");
      await noTokenAnywhere(
        worktreeAttack(`[includeIf "gitdir:**"]\n\tpath = <config>/token\n`),
        "includeIf",
      );
      // `.git` as a file that says `gitdir: <elsewhere>`, where the config moves the work tree
      const elsewhere = worktreeAttack(`[core]\n\tworktree = <config>\n`);
      const gitfileRepo = path.join(s.userFolder, `gitfile-${++counter}`);
      fs.mkdirSync(gitfileRepo);
      write(path.join(gitfileRepo, "token"), "committed-placeholder\n");
      write(path.join(gitfileRepo, ".git"), `gitdir: ${path.join(elsewhere, ".git")}\n`);
      await noTokenAnywhere(gitfileRepo, "gitfile");
      // `.git` as a symlink to a git dir elsewhere
      const linked = path.join(s.userFolder, `gitlink-${++counter}`);
      fs.mkdirSync(linked);
      write(path.join(linked, "token"), "committed-placeholder\n");
      fs.symlinkSync(path.join(elsewhere, ".git"), path.join(linked, ".git"));
      await noTokenAnywhere(linked, "git symlink");
      // what falls back is a plain snapshot of the file, never a diff of something else
      const run = runIn(gitfileRepo);
      const res = await diff(run.id, path.join(gitfileRepo, "token"), s.asOwner());
      expect(res.json().kind).toBe("snapshot");
      expect(res.json().content).toBe("committed-placeholder\n");
    });
  },
);
