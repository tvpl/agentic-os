import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SkillRegistry,
  canonicalJson,
  ensureSigningKeys,
  generateSigningKeys,
  publishRegistry,
  signIndex,
  verifyIndex,
} from "@mordomo/core";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-publish-"));
}

function seedSkills(dir: string): void {
  fs.mkdirSync(path.join(dir, "hello", "resources"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "hello", "SKILL.md"),
    [
      "---",
      "name: Hello",
      "slug: hello",
      "description: Says hi",
      "version: 2.1.0",
      "---",
      "",
      "Say hi.",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(dir, "hello", "resources", "tone.md"), "# Tone\n\nWarm.\n");
  fs.writeFileSync(path.join(dir, "hello", "NOTES.md"), "# Notes\n\n- **2026-09-05 10:00**: local lesson\n");
  fs.mkdirSync(path.join(dir, "Bad Slug"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Bad Slug", "SKILL.md"), "---\nname: x\nslug: Bad Slug\n---\nbody");
  fs.mkdirSync(path.join(dir, "no-skill"), { recursive: true });
}

describe("registry publisher", () => {
  it("signs and verifies a canonical index; tampering or another key fails", () => {
    const keys = generateSigningKeys();
    const idx = signIndex(
      { name: "r", skills: [{ slug: "a", files: { "SKILL.md": { url: "x", sha256: "0" } } }] },
      keys,
    );
    expect(idx.signature.alg).toBe("ed25519");
    expect(verifyIndex(idx)).toMatchObject({ signed: true, verified: true, publicKey: keys.publicKey });
    expect(verifyIndex(idx, keys.publicKey).verified).toBe(true);
    expect(verifyIndex(idx, generateSigningKeys().publicKey)).toMatchObject({
      verified: false,
      reason: "signed by another key",
    });
    const tampered = JSON.parse(JSON.stringify(idx)) as typeof idx;
    tampered.skills[0]!.files["SKILL.md"]!.sha256 = "1";
    expect(verifyIndex(tampered).verified).toBe(false);
    expect(verifyIndex({ name: "r", skills: [] })).toMatchObject({ signed: false, verified: false });
    // Key order does not matter for the signature.
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it("creates the signing pair once (0600) and reuses it", () => {
    const dir = tmp();
    const a = ensureSigningKeys(dir);
    const b = ensureSigningKeys(dir);
    expect(a).toEqual(b);
    if (process.platform !== "win32")
      expect(fs.statSync(path.join(dir, "registry-signing.json")).mode & 0o777).toBe(0o600);
  });

  it("publishes a folder of skills into a signed file registry the consumer verifies and installs from", async () => {
    const skills = tmp();
    const out = tmp();
    seedSkills(skills);
    const keys = generateSigningKeys();
    const res = publishRegistry({ skillsDir: skills, outDir: out, name: "team", keys });
    expect(res.skills).toEqual([{ slug: "hello", version: "2.1.0", files: 2 }]);
    expect(res.skipped.some((s) => /invalid slug/.test(s.reason))).toBe(true);
    expect(fs.existsSync(path.join(out, "hello", "resources", "tone.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, "hello", "NOTES.md"))).toBe(false); // local lessons never travel
    const doc = JSON.parse(fs.readFileSync(res.indexFile, "utf8")) as {
      name: string;
      signature: { publicKey: string };
    };
    expect(doc.name).toBe("team");
    expect(doc.signature.publicKey).toBe(keys.publicKey);
    expect(res.registryUrl).toBe(`${pathToFileURL(out).href}/index.json#key=${keys.publicKey}`);

    const registry = new SkillRegistry();
    const { entries, errors } = await registry.catalog([res.registryUrl]);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.verified).toBe(true);
    const staged = await registry.stage(entries[0]!);
    expect(fs.readFileSync(path.join(staged, "SKILL.md"), "utf8")).toContain("Say hi.");
    fs.rmSync(staged, { recursive: true, force: true });

    // Pinned to another key: refused. Unpinned: listed as signed-but-unverified-by-you? No — verified by its own key.
    const wrong = `${pathToFileURL(out).href}/index.json#key=${generateSigningKeys().publicKey}`;
    const bad = await registry.catalog([wrong]);
    expect(bad.entries).toEqual([]);
    expect(bad.errors[0]!.error).toMatch(/another key/);
    const unpinned = await new SkillRegistry().catalog([`${pathToFileURL(out).href}/index.json`]);
    expect(unpinned.entries[0]!.verified).toBe(true);

    // Tampering with a published file after signing: the digest check refuses the install.
    fs.appendFileSync(path.join(out, "hello", "SKILL.md"), "\nevil\n");
    await expect(registry.stage(entries[0]!)).rejects.toThrow(/digest mismatch/);

    // An unsigned registry pinned to a key is refused; unpinned it lists with verified: null.
    publishRegistry({ skillsDir: skills, outDir: out, name: "team" });
    const unsignedPinned = await new SkillRegistry().catalog([res.registryUrl]);
    expect(unsignedPinned.errors[0]!.error).toMatch(/unsigned/);
    const unsigned = await new SkillRegistry().catalog([`${pathToFileURL(out).href}/index.json`]);
    expect(unsigned.entries[0]!.verified).toBeNull();
  });
});
