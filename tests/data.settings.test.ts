import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SettingsSchema, SettingsStore, type MordomoPaths } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * dados-v2, slice S3 (.specs/features/dados-v2): a settings.json with a field this version cannot read costs that
 * field and nothing else, and what the owner wrote is never lost silently.
 */

const POSIX = process.platform !== "win32";
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function setup(): { paths: MordomoPaths; store: SettingsStore; write(doc: unknown): string } {
  const { paths, cleanup } = makeTempHome("mordomo-dados-settings-");
  cleanups.push(cleanup);
  return {
    paths,
    store: new SettingsStore(paths),
    write(doc) {
      const text = typeof doc === "string" ? doc : JSON.stringify(doc, null, 2);
      fs.writeFileSync(paths.settingsFile, text);
      return text;
    },
  };
}
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const defaults = SettingsSchema.parse({}) as Record<string, unknown>;

/** Every one-leaf change of `node` (a boolean flipped, a number moved, a string or an array changed), at any depth. */
function leafVariants(node: unknown): unknown[] {
  if (typeof node === "boolean") return [!node];
  if (typeof node === "number") return [node + 1, node + 2];
  if (typeof node === "string")
    return [`${node}-x`, "A", "pt-BR", "light", "cursor", "controlled_write", "#112233"];
  if (Array.isArray(node))
    return [
      [...node, "extra-entry"],
      [...node, "https://example.com/index.json"],
      [...node, { path: "/tmp/kept-folder" }],
    ];
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      leafVariants(value).map((changed) => ({ ...(node as object), [key]: changed })),
    );
  }
  return [];
}

/** A value for the field that its schema accepts and that is not the default, so a kept value shows. */
function variantOf(key: string, value: unknown): unknown {
  const shape = SettingsSchema.shape as Record<
    string,
    { safeParse(v: unknown): { success: boolean; data?: unknown } }
  >;
  for (const candidate of leafVariants(value)) {
    const parsed = shape[key]!.safeParse(candidate);
    if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(defaults[key])) return candidate;
  }
  throw new Error(`no non-default valid value found for ${key}`);
}

/** A value that the field's own schema refuses. */
function invalidFor(key: string): unknown {
  const shape = SettingsSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
  for (const candidate of [null, "☃ not valid", -7, [], { __invalid: true }, false]) {
    if (!shape[key]!.safeParse(candidate).success) return candidate;
  }
  throw new Error(`the schema accepts every candidate for ${key}`);
}

describe("S3 settings tolerate an invalid field", () => {
  it("C19 an invalid value in any top-level field costs only that field", () => {
    const keys = Object.keys(SettingsSchema.shape);
    expect(keys).toHaveLength(27);
    const good: Record<string, unknown> = {};
    for (const key of keys) good[key] = key === "version" ? defaults.version : variantOf(key, defaults[key]);
    // The base document is itself accepted as written.
    expect(SettingsSchema.parse(good)).toMatchObject(JSON.parse(JSON.stringify(good)));

    for (const key of keys) {
      const { store, write } = setup();
      write({ ...good, [key]: invalidFor(key) });
      const loaded = store.load() as unknown as Record<string, unknown>;
      expect(loaded[key], `${key} reads as its default`).toEqual(defaults[key]);
      for (const other of keys.filter((k) => k !== key)) {
        expect(loaded[other], `${other} keeps its value when ${key} is invalid`).toEqual(
          (SettingsSchema.parse(good) as Record<string, unknown>)[other],
        );
      }
    }
  });

  it("C20 a nested invalid value costs only that value", () => {
    const { store, write } = setup();
    write({
      version: 2,
      providers: { claude: { enabled: true, binaryPath: 42 }, cursor: { defaultModel: "composer" } },
      indexedFolders: [{ path: "/tmp/a", label: "a" }, { label: "no path" }, { path: "/tmp/c", label: "c" }],
      limits: { maxConcurrentRuns: 99, logRetentionDays: 7 },
    });
    const settings = store.load();
    expect(settings.providers.claude.enabled).toBe(true);
    expect(settings.providers.claude.binaryPath).toBeNull();
    expect(settings.providers.cursor.defaultModel).toBe("composer");
    expect(settings.indexedFolders.map((f) => f.path)).toEqual(["/tmp/a", "/tmp/c"]);
    expect(settings.limits.maxConcurrentRuns).toBe(3);
    expect(settings.limits.logRetentionDays).toBe(7);
  });

  it("C21 the original is preserved and never overwritten", () => {
    const { paths, store, write } = setup();
    const first = write({ version: 2, port: "abc", systemName: "Casa" });
    store.load();
    const invalid = `${paths.settingsFile}.invalid`;
    expect(fs.readFileSync(invalid, "utf8")).toBe(first);
    if (POSIX) expect(fs.statSync(invalid).mode & 0o777).toBe(0o600);

    // The same file read again, or the same bytes written again: nothing new.
    store.load();
    store.invalidate();
    store.load();
    write(first);
    store.invalidate();
    store.load();
    expect(fs.readdirSync(paths.config).filter((n) => n.includes(".invalid"))).toEqual([
      "settings.json.invalid",
    ]);

    // Other bytes: a second file named by their hash; the first is untouched.
    const second = write({ version: 2, port: "xyz", systemName: "Casa" });
    store.invalidate();
    store.load();
    const hash = crypto.createHash("sha256").update(second).digest("hex").slice(0, 12);
    expect(fs.readFileSync(invalid, "utf8")).toBe(first);
    expect(fs.readFileSync(`${invalid}.${hash}`, "utf8")).toBe(second);
    expect(
      fs
        .readdirSync(paths.config)
        .filter((n) => n.includes(".invalid"))
        .sort(),
    ).toEqual(["settings.json.invalid", `settings.json.invalid.${hash}`].sort());
  });

  it("C22 load never rewrites settings.json", () => {
    const { paths, store } = setup();
    // Tabs, keys out of order, no trailing newline: a re-serialised copy would differ from this.
    const text =
      '{\n\t"systemName": "Casa",\n\t"port": "abc",\n\t"limits": {\n\t\t"maxConcurrentRuns": 99\n\t},\n\t"version": 2}';
    fs.writeFileSync(paths.settingsFile, text);
    const before = { sha: sha(paths.settingsFile), mtime: fs.statSync(paths.settingsFile).mtimeMs };
    const loaded = store.load();
    expect(loaded.systemName).toBe("Casa");
    expect(loaded.port).toBe(4777);
    expect(sha(paths.settingsFile)).toBe(before.sha);
    expect(fs.statSync(paths.settingsFile).mtimeMs).toBe(before.mtime);
  });

  it("C23 each dropped field is logged once per file version", () => {
    const { paths, store, write } = setup();
    write({ version: 2, port: "abc", limits: { maxConcurrentRuns: 99 } });
    store.load();
    const logFile = path.join(paths.logs, "settings.jsonl");
    const lines = () =>
      fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { path: string; reason: string });
    expect(
      lines()
        .map((l) => l.path)
        .sort(),
    ).toEqual(["limits.maxConcurrentRuns", "port"]);
    for (const line of lines()) expect(line.reason.length).toBeGreaterThan(0);

    store.load();
    store.load();
    expect(lines()).toHaveLength(2);

    write({ version: 2, port: "abc", theme: "neon" });
    store.load();
    expect(lines().map((l) => l.path)).toEqual(expect.arrayContaining(["theme"]));
    expect(lines()).toHaveLength(4);
  });

  it("C24 save and update keep what they replace", () => {
    const { paths, store, write } = setup();
    const withInvalid = write({ version: 2, port: "abc", systemName: "Casa" });
    store.update({ systemName: "X" });
    expect(JSON.parse(fs.readFileSync(paths.settingsFile, "utf8")).systemName).toBe("X");
    expect(fs.readFileSync(`${paths.settingsFile}.invalid`, "utf8")).toBe(withInvalid);

    // `save()` straight over a file that is not JSON (no `load()` before it).
    const other = setup();
    const broken = other.write("{ this is not json");
    other.store.save(SettingsSchema.parse({ systemName: "Fresh" }));
    expect(JSON.parse(fs.readFileSync(other.paths.settingsFile, "utf8")).systemName).toBe("Fresh");
    expect(fs.readFileSync(`${other.paths.settingsFile}.invalid`, "utf8")).toBe(broken);
  });

  it("C25 a file that is not a JSON object still stops with the cause", () => {
    for (const text of ["{", "[]", "null"]) {
      const { paths, store, write } = setup();
      write(text);
      expect(() => store.load(), text).toThrow(/settings\.json is invalid.*Fix or delete settings\.json/s);
      const copies = fs.readdirSync(paths.config).filter((n) => n.startsWith("settings.json.corrupt."));
      expect(copies, text).toHaveLength(1);
      expect(fs.readFileSync(path.join(paths.config, copies[0]!), "utf8")).toBe(text);
    }
  });

  it("C26 backupRetention is an integer from 1 with default 10", async () => {
    for (const bad of [0, -1, 1.5, "x"]) {
      const { store, write } = setup();
      write({ version: 2, limits: { backupRetention: bad, logRetentionDays: 7 } });
      const settings = store.load();
      expect(settings.limits.backupRetention, String(bad)).toBe(10);
      expect(settings.limits.logRetentionDays).toBe(7);
    }

    const { paths, cleanup } = makeTempHome("mordomo-dados-retention-");
    cleanups.push(cleanup);
    const ctx = new AppContext(paths.home);
    const app = await buildServer(ctx);
    try {
      const headers = { "x-mordomo-token": ctx.token() };
      const refused = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers,
        payload: { limits: { backupRetention: 0 } },
      });
      expect(refused.statusCode).toBe(400);
      const accepted = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers,
        payload: { limits: { backupRetention: 3 } },
      });
      expect(accepted.statusCode).toBe(200);
      expect(ctx.settings().limits.backupRetention).toBe(3);
    } finally {
      await app.close();
      ctx.close();
    }
  });
});
