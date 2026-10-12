import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IndexWorkerHost } from "../core/src/memory/indexHost.js";
import { AppContext } from "../apps/api/src/context.js";
import { makeTempHome } from "./helpers.js";
import { repoRoot } from "./helpers/childBundle.js";

/**
 * .specs/features/cerebro-v2, C54: what the installer carries. The script is run for real (`--skip-build`, system
 * Node, no archive) over the compiled tree, and the worker it writes is started from where it lands.
 */

const PACKAGE = path.join(repoRoot, "scripts", "package.mjs");
const built =
  fs.existsSync(path.join(repoRoot, "core", "dist", "memory", "indexWorker.js")) &&
  fs.existsSync(path.join(repoRoot, "apps", "api", "dist", "cli.js")) &&
  fs.existsSync(path.join(repoRoot, "apps", "command-centre", "dist", "index.html"));
if (!built) console.warn("[memory.packaging] skipping: run npm run build first");

describe.skipIf(!built)("C54 the installer carries the index worker", () => {
  it("C54 lib/indexWorker.mjs is written next to lib/mordomo.mjs, and a pass runs in it from there", async () => {
    const out = spawnSync(process.execPath, [PACKAGE, "--skip-build", "--node", "none", "--no-archive"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 240_000,
    });
    expect(out.status, out.stderr + out.stdout).toBe(0);
    const stage = path.join(repoRoot, "build", "package");
    const payload = fs
      .readdirSync(stage)
      .map((name) => path.join(stage, name))
      .find((dir) => fs.existsSync(path.join(dir, "lib", "mordomo.mjs")))!;
    const worker = path.join(payload, "lib", "indexWorker.mjs");
    expect(fs.existsSync(worker)).toBe(true);
    expect(fs.existsSync(path.join(payload, "lib", "node_modules", "better-sqlite3"))).toBe(true);
    // the bundle names the file it looks for, next to itself
    expect(fs.readFileSync(path.join(payload, "lib", "mordomo.mjs"), "utf8")).toContain("indexWorker.mjs");
    // the worker is a script of its own: nothing of the service is inside it
    const text = fs.readFileSync(worker, "utf8");
    for (const service of [
      "EngineLockedError",
      "restore.lock",
      "engine.lock",
      "RunManager",
      "MigrationError",
    ])
      expect(text, service).not.toContain(service);

    // a pass in the packaged worker, over a real home
    const temp = makeTempHome("mordomo-pkg-");
    const ctx = new AppContext(temp.paths.home);
    try {
      const corpus = path.join(temp.paths.home, "corpus");
      fs.mkdirSync(corpus, { recursive: true });
      for (let i = 0; i < 5; i++)
        fs.writeFileSync(path.join(corpus, `n${i}.md`), `# N${i}\n\n[[n${(i + 1) % 5}]] texto ${i}\n`);
      const settings = ctx.settings();
      settings.indexedFolders = [{ path: corpus, area: null, enabled: true }];
      ctx.settingsStore.save(settings);
      const host = new IndexWorkerHost({
        paths: ctx.paths,
        db: ctx.db,
        bus: ctx.events,
        getSettings: () => ctx.settings(),
        indexer: ctx.indexer,
        workerEntry: worker,
      });
      const stats = await host.run();
      expect(stats.added).toBe(5);
      expect((ctx.db.prepare("SELECT COUNT(*) AS c FROM note_links").get() as { c: number }).c).toBe(5);
    } finally {
      ctx.close();
      temp.cleanup();
    }
  }, 300_000);
});
