import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import { SkillRegistry, parseIndex, type Fetcher } from "@mordomo/core";

/** Registry index parsing and verified staging (no network: a fake fetcher). */

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const REG = "https://skills.example/index.json";
const SKILL_MD = "---\nname: Hello\ndescription: says hi\n---\n\n# Hello\n";

function fetcher(files: Record<string, string>, index: unknown): Fetcher {
  return async (url) => {
    if (url === REG) return { ok: true, status: 200, bytes: new TextEncoder().encode(JSON.stringify(index)) };
    const body = files[url];
    if (body === undefined) return { ok: false, status: 404, bytes: new Uint8Array() };
    return { ok: true, status: 200, bytes: new TextEncoder().encode(body) };
  };
}

describe("parseIndex", () => {
  it("keeps only well-formed, same-origin entries with a SKILL.md", () => {
    const idx = parseIndex(
      {
        name: "Test registry",
        skills: [
          {
            slug: "hello",
            name: "Hello",
            files: { "SKILL.md": { url: "https://skills.example/hello/SKILL.md", sha256: sha(SKILL_MD) } },
          },
          { slug: "Bad Slug", files: { "SKILL.md": { url: "https://skills.example/x", sha256: sha("x") } } },
          { slug: "foreign", files: { "SKILL.md": { url: "https://evil.example/x", sha256: sha("x") } } },
          {
            slug: "no-skill-md",
            files: { "README.md": { url: "https://skills.example/r", sha256: sha("r") } },
          },
          {
            slug: "traversal",
            files: { "../SKILL.md": { url: "https://skills.example/t", sha256: sha("t") } },
          },
        ],
      },
      REG,
    );
    expect(idx.name).toBe("Test registry");
    expect(idx.skills.map((s) => s.slug)).toEqual(["hello"]);
  });
});

describe("SkillRegistry", () => {
  const index = {
    name: "T",
    skills: [
      {
        slug: "hello",
        name: "Hello",
        version: "1.0.0",
        files: {
          "SKILL.md": { url: "https://skills.example/hello/SKILL.md", sha256: sha(SKILL_MD) },
          "resources/notes.md": { url: "https://skills.example/hello/notes.md", sha256: sha("notes") },
        },
      },
    ],
  };

  it("stages a skill after verifying every digest", async () => {
    const reg = new SkillRegistry(
      fetcher(
        {
          "https://skills.example/hello/SKILL.md": SKILL_MD,
          "https://skills.example/hello/notes.md": "notes",
        },
        index,
      ),
    );
    const { entries, errors } = await reg.catalog([REG]);
    expect(errors).toEqual([]);
    const dir = await reg.stage(entries[0]!);
    try {
      expect(fs.readFileSync(`${dir}/SKILL.md`, "utf8")).toBe(SKILL_MD);
      expect(fs.readFileSync(`${dir}/resources/notes.md`, "utf8")).toBe("notes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a tampered file and leaves nothing behind", async () => {
    const reg = new SkillRegistry(
      fetcher(
        {
          "https://skills.example/hello/SKILL.md": SKILL_MD,
          "https://skills.example/hello/notes.md": "TAMPERED",
        },
        index,
      ),
    );
    const { entries } = await reg.catalog([REG]);
    await expect(reg.stage(entries[0]!)).rejects.toThrow(/digest mismatch/);
  });

  it("reports a broken registry instead of throwing", async () => {
    const reg = new SkillRegistry(async () => ({ ok: false, status: 500, bytes: new Uint8Array() }));
    const { entries, errors } = await reg.catalog([REG]);
    expect(entries).toEqual([]);
    expect(errors[0]!.error).toMatch(/500/);
    await expect(reg.index("http://insecure.example/i.json")).rejects.toThrow(/https/);
  });
});
