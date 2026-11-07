import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { seedHome } from "../core/src/paths.js";
import { makeTempHome } from "./helpers.js";

/**
 * cerebro-memoria-confiavel S3, what ships (C72-C74): the `consolidate-memory` skill as the skill loader reads it from a
 * seeded home, its heuristics, the bundled routine against the feature's base (`a5b332e`), `seedHome` over a fresh home
 * and over one that keeps its own copy, and what `docs/memory-guide.md` says.
 */

const repo = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), "utf8");
const BASE = "a5b332e";

describe("C72 the skill proposes and only reads", () => {
  it("C72 the loader reads mode read_only and version 2.0.0, the changelog ends with 2.0.0, the procedure names proposal.json, v 1 and the five ops, and no line tells it to write MEMORY.md or to POST a fact", () => {
    const home = makeTempHome("mordomo-memoria-skill-");
    try {
      seedHome(home.paths, repo);
      const ctx = new AppContext(home.paths.home);
      try {
        const skill = ctx.skills.load("consolidate-memory");
        expect(skill).not.toBeNull();
        expect(skill!.mode).toBe("read_only");
        expect(skill!.version).toBe("2.0.0");
        expect(skill!.changelog.at(-1)!.startsWith("2.0.0")).toBe(true);
      } finally {
        ctx.close();
      }
    } finally {
      home.cleanup();
    }
    const text = read("skills/consolidate-memory/SKILL.md");
    expect(text).toContain("proposal.json");
    expect(text).toContain('"v": 1');
    for (const op of ["add", "supersede", "close_loop", "move_to_topic", "fact"]) {
      expect(text, op).toContain(`"op": "${op}"`);
    }
    for (const line of text.split("\n")) {
      expect(line).not.toMatch(/\b(write|append|create|add)\b[^.]*\bMEMORY\.md\b/i);
      expect(line).not.toMatch(/POST[^\n]*\/api\/memory\/facts/);
    }
    // what version 1 told it to do, gone
    expect(text).not.toContain("Append only");
    expect(text).not.toContain("write one line into the long-term memory file");
  });
});

describe("C73 the heuristics", () => {
  it("C73 a journal line ending in (autor:: agente) is never promoted by the Decisions rule", () => {
    expect(read("skills/consolidate-memory/resources/heuristics.md")).toContain(
      'A journal line ending in `(autor:: agente)` is never promoted by the "Decisions" rule',
    );
  });
});

describe("C74 the nightly routine is off for new homes", () => {
  it("C74 the bundled routine has enabled false and its other 31 keys as at the feature's base", () => {
    const now = JSON.parse(read("routines/nightly-consolidation.json")) as Record<string, unknown>;
    const before = JSON.parse(
      execFileSync("git", ["show", `${BASE}:routines/nightly-consolidation.json`], {
        cwd: repo,
        encoding: "utf8",
      }),
    ) as Record<string, unknown>;
    expect(before.enabled).toBe(true);
    expect(now.enabled).toBe(false);
    const { enabled: _a, ...rest } = now;
    const { enabled: _b, ...restBefore } = before;
    expect(Object.keys(rest)).toHaveLength(31);
    expect(rest).toEqual(restBefore);
  });

  it("C74 seedHome writes it with enabled false on a fresh home and leaves true on a home whose copy says true", () => {
    const fresh = makeTempHome("mordomo-memoria-seed-");
    const kept = makeTempHome("mordomo-memoria-seed-kept-");
    try {
      seedHome(fresh.paths, repo);
      const seeded = JSON.parse(
        fs.readFileSync(path.join(fresh.paths.routines, "nightly-consolidation.json"), "utf8"),
      );
      expect(seeded.enabled).toBe(false);
      const own = path.join(kept.paths.routines, "nightly-consolidation.json");
      fs.mkdirSync(path.dirname(own), { recursive: true });
      const copy = { ...JSON.parse(read("routines/nightly-consolidation.json")), enabled: true };
      fs.writeFileSync(own, JSON.stringify(copy, null, 2));
      seedHome(kept.paths, repo);
      expect(JSON.parse(fs.readFileSync(own, "utf8")).enabled).toBe(true);
    } finally {
      fresh.cleanup();
      kept.cleanup();
    }
  });

  it("C74 docs/memory-guide.md says the routine is off by default and leaves a proposal in Revisões, and no longer that it writes MEMORY.md", () => {
    const guide = read("docs/memory-guide.md");
    expect(guide).toContain("is **disabled by default** on a new install");
    expect(guide).toContain("Its output is a proposal in **Revisões**, never a write to\n`MEMORY.md`.");
    expect(guide).not.toContain("appends the survivors to `memory/MEMORY.md`");
    expect(guide).not.toContain("proposes the\nnew `MEMORY.md` as an artifact instead of writing it");
  });
});
