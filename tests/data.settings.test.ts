import { afterEach, describe, expect, it } from "vitest";
import { EMBEDDINGS_KEY_ENV } from "@mordomo/contracts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SETTINGS_FAIL_CLOSED,
  SecurityProfile,
  SettingsSchema,
  SettingsStore,
  parseTolerant,
  type MordomoPaths,
} from "@mordomo/core/internal";
import { chooseProvider } from "../core/src/memory/embeddings.js";
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
      [...node, { id: "kept-context", name: "Kept", paths: ["/tmp/kept-folder"] }],
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

/**
 * What a top-level field reads as when it is dropped whole and holds security fields (the test's own statement of
 * the closed values, independent of the table in the engine): the default with the closed leaves applied.
 */
const d = defaults as Record<string, any>;
const CLOSED_WHEN_DROPPED: Record<string, unknown> = {
  securityProfile: "read_only",
  memorySkills: [],
  limits: { ...d.limits, dailyBudgetUsd: 0.01, approvalTtlDays: 1 },
  remote: { ...d.remote, deviceTtlDays: 1 },
  sentinels: {
    ...d.sentinels,
    repeatedFailure: { ...d.sentinels.repeatedFailure, enabled: false },
    silentRoutine: { ...d.sentinels.silentRoutine, enabled: false },
    connectorDelta: { ...d.sentinels.connectorDelta, enabled: false },
    repeatDetector: { ...d.sentinels.repeatDetector, enabled: false },
    triage: { ...d.sentinels.triage, enabled: false, dailyBudgetUsd: 0 },
  },
  channels: {
    ...d.channels,
    telegram: { ...d.channels.telegram, allowedUserIds: [], enabled: false, inbound: false },
  },
};

describe("S3 settings tolerate an invalid field", () => {
  it("C19 an invalid value in any top-level field costs only that field", () => {
    const keys = Object.keys(SettingsSchema.shape);
    expect(keys).toHaveLength(28);
    const good: Record<string, unknown> = {};
    for (const key of keys) good[key] = key === "version" ? defaults.version : variantOf(key, defaults[key]);
    // The base document is itself accepted as written.
    expect(SettingsSchema.parse(good)).toMatchObject(JSON.parse(JSON.stringify(good)));

    for (const key of keys) {
      const { store, write } = setup();
      write({ ...good, [key]: invalidFor(key) });
      const loaded = store.load() as unknown as Record<string, unknown>;
      expect(loaded[key], `${key} reads as its default, or closed when it is a security field`).toEqual(
        key in CLOSED_WHEN_DROPPED ? CLOSED_WHEN_DROPPED[key] : defaults[key],
      );
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
    // A pinned binary that cannot be read is not run through PATH instead: the provider is switched off.
    expect(settings.providers.claude.enabled).toBe(false);
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

  /**
   * The test's own statement of each security field: its valid values from the most restrictive to the most
   * permissive, and what a value that cannot be read must read as (the first one). `0` is not on the budget
   * lists: it is the permissive extreme (no alert, no ceiling), not a restrictive value.
   */
  const DIRECTION: Array<{
    name: string;
    /** A document with this field holding an unreadable value, around a valid sibling to keep. */
    broken(bad: unknown): Record<string, unknown>;
    read(s: ReturnType<SettingsStore["load"]>): unknown;
    restrictiveToPermissive: unknown[];
    /** The value written is the value read (so every value on the list can be checked as written). */
    direct?: true;
  }> = [
    {
      name: "securityProfile",
      direct: true,
      broken: (bad) => ({ securityProfile: bad }),
      read: (s) => s.securityProfile,
      restrictiveToPermissive: [
        "read_only",
        "review_before_write",
        "controlled_write",
        "approved_automation",
      ],
    },
    {
      name: "indexedFolders[].enabled",
      broken: (bad) => ({ indexedFolders: [{ path: "/tmp/granted", enabled: bad }] }),
      read: (s) => s.indexedFolders[0]?.enabled,
      restrictiveToPermissive: [false, true],
    },
    {
      name: "providers.claude.binaryPath (the provider runs only if enabled)",
      broken: (bad) => ({ providers: { claude: { enabled: true, binaryPath: bad } } }),
      read: (s) => s.providers.claude.enabled,
      restrictiveToPermissive: [false, true],
    },
    {
      name: "channels.telegram.allowedUserIds (empty means anybody in the chat, so the channel is what closes)",
      broken: (bad) => ({ channels: { telegram: { enabled: true, inbound: true, allowedUserIds: bad } } }),
      read: (s) => s.channels.telegram.enabled && s.channels.telegram.inbound,
      restrictiveToPermissive: [false, true],
    },
    {
      name: "memorySkills",
      direct: true,
      broken: (bad) => ({ memorySkills: bad }),
      read: (s) => s.memorySkills,
      restrictiveToPermissive: [[], ["recall"], ["recall", "consolidate-memory"]],
    },
    {
      name: "limits.dailyBudgetUsd",
      direct: true,
      broken: (bad) => ({ limits: { dailyBudgetUsd: bad } }),
      read: (s) => s.limits.dailyBudgetUsd,
      restrictiveToPermissive: [0.01, 1, 100],
    },
    {
      name: "limits.approvalTtlDays",
      direct: true,
      broken: (bad) => ({ limits: { approvalTtlDays: bad } }),
      read: (s) => s.limits.approvalTtlDays,
      restrictiveToPermissive: [1, 7, 30],
    },
    {
      name: "remote.deviceTtlDays",
      direct: true,
      broken: (bad) => ({ remote: { deviceTtlDays: bad } }),
      read: (s) => s.remote.deviceTtlDays,
      restrictiveToPermissive: [1, 90, 365],
    },
    ...(["triage", "connectorDelta", "repeatedFailure", "silentRoutine", "repeatDetector"] as const).map(
      (sentinel) => ({
        name: `sentinels.${sentinel}.enabled (it switches something on)`,
        direct: true as const,
        broken: (bad: unknown) => ({ sentinels: { [sentinel]: { enabled: bad } } }),
        read: (s: ReturnType<SettingsStore["load"]>) => s.sentinels[sentinel].enabled,
        restrictiveToPermissive: [false, true],
      }),
    ),
    {
      name: "sentinels.triage.dailyBudgetUsd",
      direct: true,
      broken: (bad) => ({ sentinels: { triage: { dailyBudgetUsd: bad } } }),
      read: (s) => s.sentinels.triage.dailyBudgetUsd,
      restrictiveToPermissive: [0, 0.25, 5],
    },
  ];

  it("C44 a security field that cannot be read never reads as more permissive than any value it could have had", () => {
    expect(SecurityProfile.options).toEqual(DIRECTION[0]!.restrictiveToPermissive);
    for (const field of DIRECTION) {
      // Every value on the list is one the schema accepts, so the list is the field's real range.
      if (field.direct) {
        for (const valid of field.restrictiveToPermissive) {
          const { store, write } = setup();
          write({ version: 2, ...field.broken(valid) });
          expect(field.read(store.load()), `${field.name} = ${JSON.stringify(valid)} is readable`).toEqual(
            valid,
          );
        }
      }
      for (const bad of [null, "not valid", -7, 1.5, "5", {}, [1.5], ["BAD name"], [false], 42, "false", 0]) {
        const { store, write } = setup();
        const doc = { version: 2, ...field.broken(bad) };
        // A value the schema accepts is not an unreadable one.
        if (SettingsSchema.safeParse(doc).success) continue;
        write(doc);
        const read = store.load();
        expect(field.read(read), `${field.name} unreadable as ${JSON.stringify(bad)}`).toEqual(
          field.restrictiveToPermissive[0],
        );
      }
    }
  });

  it("C45 an element, or the parent, that cannot be read closes the security fields below it too", () => {
    const element = setup();
    element.write({
      version: 2,
      channels: { telegram: { enabled: true, inbound: true, chatId: "1", allowedUserIds: [7, 1.5] } },
      indexedFolders: [
        { path: "/tmp/a", enabled: "false" },
        { path: "/tmp/b", enabled: true },
      ],
      memorySkills: ["recall", "BAD NAME"],
    });
    const s1 = element.store.load();
    expect(s1.channels.telegram).toMatchObject({ enabled: false, inbound: false, chatId: "1" });
    expect(s1.indexedFolders.map((f) => [f.path, f.enabled])).toEqual([
      ["/tmp/a", false],
      ["/tmp/b", true],
    ]);
    expect(s1.memorySkills).toEqual([]);

    // Each parent dropped whole.
    for (const [key, check] of [
      ["limits", (s: any) => [s.limits.dailyBudgetUsd, s.limits.approvalTtlDays]],
      ["remote", (s: any) => [s.remote.deviceTtlDays]],
      ["sentinels", (s: any) => [s.sentinels.triage.dailyBudgetUsd]],
      ["channels", (s: any) => [s.channels.telegram.enabled, s.channels.telegram.inbound]],
    ] as const) {
      const { store, write } = setup();
      write({ version: 2, [key]: "not an object" });
      const expected = {
        limits: [0.01, 1],
        remote: [1],
        sentinels: [0],
        channels: [false, false],
      }[key];
      expect(check(store.load()), key).toEqual(expected);
    }
    const providers = setup();
    providers.write({ version: 2, providers: 7 });
    const loaded = providers.store.load();
    expect(Object.values(loaded.providers).every((p) => p.enabled === false && p.binaryPath === null)).toBe(
      true,
    );
  });

  it("C62 a list of the owner's exclusions that cannot be read keeps what can be read and is never smaller than the defaults", () => {
    const read = (excludes: unknown) => {
      const { store, write } = setup();
      write({ version: 2, excludes });
      return store.load().excludes;
    };
    const defaultList = d.excludes as string[];
    // A lone string is a one-entry list; anything else unreadable is the defaults.
    expect(read("private-notes")).toEqual([...defaultList, "private-notes"]);
    expect(read([5])).toEqual(defaultList);
    expect(read(7)).toEqual(defaultList);
    expect(read({ a: 1 })).toEqual(defaultList);
    expect(read(["mine/*", 5, "also-mine"])).toEqual([...defaultList, "mine/*", "also-mine"]);
    // A list that is all readable is the owner's, as written (they may shorten the defaults on purpose).
    expect(read(["only-this"])).toEqual(["only-this"]);
    expect(read([])).toEqual([]);
  });

  it("C63 an unreadable flag never reads on: every boolean that is on by default reads off", () => {
    const onByDefault: string[] = [];
    const walk = (node: unknown, trail: string[]) => {
      if (typeof node === "boolean") {
        if (node) onByDefault.push(trail.join("."));
      } else if (node !== null && typeof node === "object" && !Array.isArray(node)) {
        for (const [key, value] of Object.entries(node)) walk(value, [...trail, key]);
      } else if (Array.isArray(node) && typeof node[0] === "object") walk(node[0], [...trail, "0"]);
    };
    walk(SettingsSchema.parse({ indexedFolders: [{ path: "/tmp/x" }] }), []);
    expect(onByDefault.sort()).toEqual([
      "indexedFolders.0.enabled",
      "sentinels.connectorDelta.enabled",
      "sentinels.repeatDetector.enabled",
      "sentinels.repeatedFailure.enabled",
      "sentinels.silentRoutine.enabled",
      "sentinels.triage.enabled",
    ]);
    for (const leaf of onByDefault) {
      for (const bad of ["false", 0, null, "off", {}, []]) {
        const { store, write } = setup();
        const doc: Record<string, any> = { version: 2 };
        const keys = leaf.split(".");
        if (keys[0] === "indexedFolders") {
          doc.indexedFolders = [{ path: "/tmp/x", enabled: bad }];
        } else {
          let node = doc;
          for (const key of keys.slice(0, -1)) node = node[key] = {};
          node[keys[keys.length - 1]!] = bad;
        }
        write(doc);
        const loaded = store.load() as any;
        const value = keys.reduce((acc: any, key) => acc?.[key], loaded);
        expect(value, `${leaf} = ${JSON.stringify(bad)}`).toBe(false);
      }
    }
  });

  it("C46 every leaf of the settings is either a security field with a closed value or one that opens nothing, one by one", () => {
    const leaves = new Set<string>();
    const walk = (node: unknown, trail: string[]) => {
      if (node !== null && typeof node === "object" && !Array.isArray(node)) {
        for (const [key, value] of Object.entries(node)) walk(value, [...trail, key]);
      } else if (Array.isArray(node) && node.length > 0 && typeof node[0] === "object") {
        walk(node[0], [...trail, "*"]);
      } else leaves.add(trail.join("."));
    };
    // The defaults, with a sample element where the schema has a list of objects or a record.
    walk(SettingsSchema.parse({ indexedFolders: [{ path: "/tmp/x" }], providers: { claude: {} } }), []);
    const normalized = new Set(
      [...leaves].map((leaf) => leaf.replace(/^providers\.(claude|cursor|codex)\./, "providers.*.")),
    );
    const closed = SETTINGS_FAIL_CLOSED.map((r) => new RegExp(`^${r.path.replace(/\*/g, "[^.]+")}$`));
    /**
     * Every other leaf, by its exact name, and why it opens nothing. A leaf that is not here, or here and no
     * longer in the schema, fails: a field added to the schema (under `providers.`, `channels.push.`, `memory.`
     * or anywhere) has to be decided one way or the other.
     */
    const OPENS_NOTHING: Record<string, string> = {
      version: "bookkeeping",
      systemName: "a label",
      language: "presentation",
      theme: "presentation",
      accentColor: "presentation",
      port: "where the loopback listener is; no value widens who may connect",
      bindAddress: "default is loopback, the narrowest; anything else needs an approval to take effect",
      timezone: "scheduling",
      autostart: "default off; an unreadable value reads off",
      setupCompleted: "whether the wizard ran",
      defaultProvider: "which provider a run uses by default; it still has to be enabled",
      "providers.*.enabled": "default off; an unreadable value reads off",
      "providers.*.defaultModel": "a model name",
      "providers.*.defaultEffort": "how hard a model thinks",
      "remote.enabled": "default off; an unreadable value reads off",
      "remote.allowedHosts": "default empty: nobody",
      "remote.tls.enabled": "default off; only removes a listener, the http one stays where bindAddress says",
      "remote.tls.port": "a port for the listener above",
      "marketplace.registries": "default empty: no registry",
      "updates.check": "default off: no outbound request",
      "indexedFolders.*.path": "names a folder; an entry without a readable path is removed whole",
      "indexedFolders.*.area": "a label",
      areas: "labels",
      contexts:
        "work contexts only narrow what a read sees; an entry this version cannot read is dropped whole (cerebro-contextos AC 8)",
      "limits.maxConcurrentRuns": "resource use, not permission",
      "limits.skillNotesMax": "size",
      "limits.defaultTimeoutMs": "size",
      "limits.logRetentionDays": "retention (never closed to a shorter one: that would delete data)",
      "limits.logMaxFileBytes": "size",
      "limits.maxIndexedFileBytes": "size",
      "limits.previewMaxBytes": "size",
      "limits.runRetentionDays": "retention (never closed to a shorter one: that would delete data)",
      "limits.runRetentionMax": "retention (never closed to a smaller one: that would delete data)",
      "limits.backupRetention": "retention; sealed backups only",
      "limits.routineHistoryRetentionDays":
        "retention (never closed to a shorter one: that would delete data)",
      "limits.toolApprovalTimeoutMs": "how long a prompt waits before it is denied",
      favoriteSkills: "labels",
      "routines.allowWebhooks": "default off; an unreadable value reads off",
      "routines.heartbeatIntervalMinutes": "scheduling",
      "routines.heartbeatOkToken": "a token a quiet heartbeat prints",
      "connectors.dataCacheTtlMs": "cache",
      "connectors.dataTimeoutMs": "timeout",
      "connectors.allowedCommands": "default empty: only the base allowlist",
      "memory.journalBudgetTokens": "a token budget",
      "memory.agentStance":
        "what the compiled AGENTS.md asks of an agent about the owner's goals; an unreadable value reads neutral (cerebro-organizar door 7)",
      "memory.notes.fixedStructure":
        "where a new note may go, not who may read or write; an unreadable value reads off (cerebro-vista-notas door 5)",
      "sentinels.fsWatch.enabled": "default off; an unreadable value reads off",
      "sentinels.fsWatch.debounceMs": "timing",
      "sentinels.repeatedFailure.threshold": "a count for a notification",
      "sentinels.repeatedFailure.windowHours": "a window for a notification",
      "sentinels.silentRoutine.factor": "a factor for a notification",
      "sentinels.connectorDelta.maxItems":
        "items read per check, while the sentinel is on (its switch is closed)",
      "sentinels.repeatDetector.days": "a window for a notification",
      "sentinels.repeatDetector.minRuns": "a count for a notification",
      "sentinels.repeatDetector.similarity": "a threshold for a notification",
      "sentinels.triage.model": "a model alias",
      "sentinels.triage.timeoutMs": "timeout",
      "channels.telegram.enabled": "default off; an unreadable value reads off",
      "channels.telegram.botTokenEnv": "the name of a variable",
      "channels.telegram.chatId":
        "default empty: nowhere; an unreadable id reads empty and the channel does not start",
      "channels.telegram.minTone": "what is worth a message",
      "channels.telegram.inbound": "default off; an unreadable value reads off",
      "channels.push.enabled": "default off; an unreadable value reads off",
      "channels.push.minTone": "what is worth a message",
      "channels.push.subject": "a contact address for the push service",
    };
    const unclassified = [...normalized].filter(
      (leaf) => !closed.some((re) => re.test(leaf)) && !(leaf in OPENS_NOTHING),
    );
    expect(
      unclassified,
      "a settings leaf nobody classified: add it to SETTINGS_FAIL_CLOSED or say why it opens nothing",
    ).toEqual([]);
    const stale = Object.keys(OPENS_NOTHING).filter(
      (leaf) => !normalized.has(leaf) || closed.some((re) => re.test(leaf)),
    );
    expect(stale, "listed as opening nothing but gone from the schema, or also closed").toEqual([]);
  });

  it("C47 more invalid values than a file can reasonably hold are read as the closed defaults, without failing", () => {
    const wrap = (areas: unknown[]) => ({ version: 2, systemName: "Casa", areas });
    // 1100 invalid among valid ones: all of them go in one pass, the valid ones stay in order.
    const some = setup();
    const elements: unknown[] = [];
    for (let i = 0; i < 1100; i++) elements.push(i % 2 === 0 ? { not: "a string" } : `area-${i}`);
    some.write(wrap(elements));
    const started = Date.now();
    const settings = some.store.load();
    expect(settings.areas).toHaveLength(550);
    expect(settings.areas[0]).toBe("area-1");
    expect(settings.areas.at(-1)).toBe("area-1099");
    expect(settings.systemName).toBe("Casa");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(fs.readdirSync(some.paths.config).filter((n) => n.includes(".corrupt."))).toEqual([]);

    // 50 000 invalid: the file is kept, the document reads as the closed defaults, one line says why.
    const many = setup();
    many.write(wrap(Array.from({ length: 50_000 }, (_, i) => (i % 2 ? { bad: i } : `a${i}`))));
    const t0 = Date.now();
    const closedRead = many.store.load();
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(closedRead.systemName).toBe("MordomoOS");
    expect(closedRead.securityProfile).toBe("read_only");
    expect(closedRead.limits.dailyBudgetUsd).toBe(0.01);
    expect(closedRead.memorySkills).toEqual([]);
    expect(fs.readdirSync(many.paths.config).filter((n) => n.includes(".corrupt."))).toEqual([]);
    expect(fs.readFileSync(`${many.paths.settingsFile}.invalid`, "utf8")).toBe(
      fs.readFileSync(many.paths.settingsFile, "utf8"),
    );
    const line = JSON.parse(fs.readFileSync(path.join(many.paths.logs, "settings.jsonl"), "utf8").trim()) as {
      path: string;
    };
    expect(line.path).toBe("(document)");

    // Past the cap the owner's exclusions are not lost with the rest: the entries that can be read are kept (a
    // read of fewer exclusions than the owner wrote would index and serve what they asked to keep out).
    const lost = setup();
    lost.write({
      version: 2,
      excludes: [...Array.from({ length: 6000 }, (_, i) => i), "mine/*", "also-mine"],
    });
    const kept = lost.store.load();
    expect(kept.excludes).toEqual([...(d.excludes as string[]), "mine/*", "also-mine"]);
    expect(kept.securityProfile).toBe("read_only");
    expect(kept.limits.dailyBudgetUsd).toBe(0.01);

    // The cap is a parameter of the parser, and a pass over many invalid values is linear.
    const direct = parseTolerant(SettingsSchema, wrap(Array.from({ length: 4000 }, () => 1)), {
      failClosed: SETTINGS_FAIL_CLOSED,
    });
    expect(direct.overflow).toBe(false);
    expect(direct.value.areas).toEqual([]);
  }, 60_000);

  it("C48 a name taken by a folder, a link or other bytes never loses the original or stops the load", () => {
    const folder = setup();
    const text = folder.write({ version: 2, port: "abc", systemName: "Casa" });
    fs.mkdirSync(`${folder.paths.settingsFile}.invalid`);
    expect(folder.store.load().systemName).toBe("Casa");
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    expect(fs.readFileSync(`${folder.paths.settingsFile}.invalid.${hash}`, "utf8")).toBe(text);
    expect(fs.readdirSync(folder.paths.config).filter((n) => n.includes(".corrupt."))).toEqual([]);

    if (POSIX) {
      const link = setup();
      const t2 = link.write({ version: 2, port: "abc" });
      fs.symlinkSync(path.join(link.paths.config, "nowhere"), `${link.paths.settingsFile}.invalid`);
      expect(link.store.load().port).toBe(4777);
      const h2 = crypto.createHash("sha256").update(t2).digest("hex").slice(0, 12);
      expect(fs.readFileSync(`${link.paths.settingsFile}.invalid.${h2}`, "utf8")).toBe(t2);
      expect(fs.existsSync(path.join(link.paths.config, "nowhere"))).toBe(false);
    }

    // The hashed name is taken too, by other bytes: the next free name keeps the original.
    const taken = setup();
    const t3 = taken.write({ version: 2, port: "abc" });
    const h3 = crypto.createHash("sha256").update(t3).digest("hex").slice(0, 12);
    fs.writeFileSync(`${taken.paths.settingsFile}.invalid`, "other");
    fs.writeFileSync(`${taken.paths.settingsFile}.invalid.${h3}`, "someone else");
    expect(taken.store.load().port).toBe(4777);
    expect(fs.readFileSync(`${taken.paths.settingsFile}.invalid.${h3}-1`, "utf8")).toBe(t3);
    expect(fs.readFileSync(`${taken.paths.settingsFile}.invalid`, "utf8")).toBe("other");

    // Nothing can be written at all: the load still works, and a save refuses to replace what it could not keep.
    if (POSIX) {
      const blocked = setup();
      blocked.write({ version: 2, port: "abc", systemName: "Casa" });
      const h4 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(blocked.paths.settingsFile, "utf8"))
        .digest("hex")
        .slice(0, 12);
      for (const name of [
        ".invalid",
        `.invalid.${h4}`,
        ...Array.from({ length: 8 }, (_, i) => `.invalid.${h4}-${i + 1}`),
      ]) {
        fs.mkdirSync(`${blocked.paths.settingsFile}${name}`);
      }
      expect(blocked.store.load().systemName).toBe("Casa");
      const before = fs.readFileSync(blocked.paths.settingsFile, "utf8");
      let thrown: unknown;
      try {
        blocked.store.update({ systemName: "X" });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string }).code).toBe("settings_unpreserved");
      expect(fs.readFileSync(blocked.paths.settingsFile, "utf8")).toBe(before);
    }
  });

  it("C49 the log says it once per version of the file, across instances", () => {
    const { paths, write } = setup();
    write({ version: 2, port: "abc", limits: { maxConcurrentRuns: 99 } });
    for (let i = 0; i < 3; i++) new SettingsStore(paths).load();
    const logFile = path.join(paths.logs, "settings.jsonl");
    expect(fs.readFileSync(logFile, "utf8").trim().split("\n")).toHaveLength(2);
    write({ version: 2, port: "abc", theme: "neon" });
    for (let i = 0; i < 3; i++) new SettingsStore(paths).load();
    expect(fs.readFileSync(logFile, "utf8").trim().split("\n")).toHaveLength(4);
  });

  it("C50 an unreadable file is kept once and only the newest copies stay, and a version that is not a number is not migrated", () => {
    const { paths, store, write } = setup();
    write("{ not json");
    for (let i = 0; i < 3; i++) expect(() => store.load()).toThrow(/settings\.json is invalid/);
    expect(fs.readdirSync(paths.config).filter((n) => n.includes(".corrupt."))).toHaveLength(1);

    for (let i = 0; i < 8; i++) {
      write(`{ not json ${i}`);
      expect(() => store.load()).toThrow();
    }
    expect(fs.readdirSync(paths.config).filter((n) => n.includes(".corrupt.")).length).toBeLessThanOrEqual(5);

    const stranger = setup();
    const text = stranger.write({ version: "abc", systemName: "Casa" });
    const before = fs.statSync(stranger.paths.settingsFile).mtimeMs;
    expect(stranger.store.load().systemName).toBe("Casa");
    expect(fs.readFileSync(stranger.paths.settingsFile, "utf8")).toBe(text);
    expect(fs.statSync(stranger.paths.settingsFile).mtimeMs).toBe(before);
    expect(fs.existsSync(`${stranger.paths.settingsFile}.v1.bak`)).toBe(false);
  });

  it("C69 copies of an unreadable file are told apart by what is in them, and only the ones this code wrote are touched", async () => {
    const { paths, store, write } = setup();
    // The same bytes, read again later (a new millisecond): still one copy.
    write("{ not json");
    expect(() => store.load()).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(() => store.load()).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(() => new SettingsStore(paths).load()).toThrow();
    const copies = () => fs.readdirSync(paths.config).filter((n) => n.startsWith("settings.json.corrupt."));
    expect(copies()).toHaveLength(1);

    // What the owner keeps next to it is theirs: a folder with a copy's name, a note, a link.
    fs.mkdirSync(path.join(paths.config, "settings.json.corrupt.1"));
    fs.writeFileSync(path.join(paths.config, "settings.json.corrupt.notes"), "my notes");
    if (POSIX)
      fs.symlinkSync(
        path.join(paths.config, "settings.json.corrupt.notes"),
        path.join(paths.config, "settings.json.corrupt.2"),
      );
    for (let i = 0; i < 8; i++) {
      write(`{ not json ${i}`);
      expect(() => store.load(), "the load still stops with the cause, not with a failure to prune").toThrow(
        /settings\.json is invalid.*Fix or delete/s,
      );
    }
    expect(fs.statSync(path.join(paths.config, "settings.json.corrupt.1")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(paths.config, "settings.json.corrupt.notes"), "utf8")).toBe("my notes");
    if (POSIX)
      expect(fs.lstatSync(path.join(paths.config, "settings.json.corrupt.2")).isSymbolicLink()).toBe(true);
    const mine = fs
      .readdirSync(paths.config)
      .filter(
        (n) => /^settings\.json\.corrupt\.\d+$/.test(n) && fs.lstatSync(path.join(paths.config, n)).isFile(),
      );
    expect(mine.length).toBeLessThanOrEqual(5);
  });

  it("C70 a link is not a copy, a failed copy is told once per process, and the log says which fields read closed", () => {
    // A link to a file that holds the very same bytes does not count as having kept them.
    if (POSIX) {
      const { paths, store, write } = setup();
      const text = write({ version: 2, port: "abc" });
      const elsewhere = path.join(paths.config, "elsewhere.txt");
      fs.writeFileSync(elsewhere, text);
      fs.symlinkSync(elsewhere, `${paths.settingsFile}.invalid`);
      store.load();
      const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
      expect(fs.readFileSync(`${paths.settingsFile}.invalid.${hash}`, "utf8")).toBe(text);
      expect(fs.lstatSync(`${paths.settingsFile}.invalid`).isSymbolicLink()).toBe(true);
    }

    // When no name can hold the original, the same file read again by the same process is not logged again.
    if (POSIX) {
      const blocked = setup();
      const text = blocked.write({ version: 2, port: "abc" });
      const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
      for (const name of [
        ".invalid",
        `.invalid.${hash}`,
        ...Array.from({ length: 8 }, (_, i) => `.invalid.${hash}-${i + 1}`),
      ]) {
        fs.mkdirSync(`${blocked.paths.settingsFile}${name}`);
      }
      blocked.store.load();
      blocked.store.invalidate();
      blocked.store.load();
      blocked.store.invalidate();
      blocked.store.load();
      const lines = fs
        .readFileSync(path.join(blocked.paths.logs, "settings.jsonl"), "utf8")
        .trim()
        .split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ path: "port", preserved: null });
    }

    // The log marks the fields that read closed, and only those.
    const { paths, store, write } = setup();
    write({ version: 2, port: "abc", securityProfile: "nope", limits: "gone", memorySkills: [1] });
    store.load();
    const records = fs
      .readFileSync(path.join(paths.logs, "settings.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { path: string; closed?: true });
    const closed = Object.fromEntries(records.map((r) => [r.path, r.closed === true]));
    expect(closed).toEqual({ port: false, securityProfile: true, limits: true, "memorySkills.0": true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// cerebro-v2, S4: the settings of the semantic search read OFF when they cannot be read

describe("C52 memory.embeddings", () => {
  const EMBEDDINGS_LEAVES = [
    "enabled",
    "provider",
    "endpoint",
    "model",
    "apiKeyEnv",
    "dimensions",
    "sendRemote",
  ];

  it("C52 the schema has exactly the seven leaves, off by default, and the two that open something are closed", () => {
    const embeddings = (SettingsSchema.parse({}) as any).memory.embeddings;
    expect(embeddings).toEqual({ enabled: false, provider: "hash", sendRemote: false });
    // Every leaf is accepted as written, and nothing else is kept: the schema has exactly these seven.
    const all = {
      enabled: true,
      provider: "http",
      endpoint: "http://127.0.0.1:11434/v1/embeddings",
      model: "nomic",
      apiKeyEnv: "KEY",
      dimensions: 768,
      sendRemote: true,
    };
    const parsed = (SettingsSchema.parse({ memory: { embeddings: { ...all, extra: 1 } } }) as any).memory
      .embeddings;
    expect(parsed).toEqual(all);
    expect(Object.keys(parsed).sort()).toEqual([...EMBEDDINGS_LEAVES].sort());
    const closed = SETTINGS_FAIL_CLOSED.filter((rule) => rule.path.startsWith("memory.embeddings.")).map(
      (rule) => [rule.path, rule.closed],
    );
    expect(closed).toEqual([
      ["memory.embeddings.enabled", false],
      ["memory.embeddings.sendRemote", false],
      ["memory.embeddings.provider", "hash"],
    ]);
  });

  it("C52 a value that cannot be read leaves the search off (or without an endpoint it may use) and keeps the file as settings.json.invalid", () => {
    const bad: unknown[] = [
      "yes",
      7,
      { enabled: "yes" },
      { enabled: 1, provider: "http", endpoint: "https://example.com", sendRemote: "true" },
      { enabled: true, provider: 7 },
      { enabled: true, provider: "http", dimensions: "many" },
      { enabled: true, provider: "http", endpoint: 5 },
    ];
    for (const value of bad) {
      const { paths, store, write } = setup();
      const original = write({ version: 2, memory: { embeddings: value } });
      const loaded = store.load();
      // Off, or on without an endpoint or a length it can use: in neither case is a note embedded or sent anywhere.
      expect(chooseProvider(loaded.memory.embeddings).state, JSON.stringify(value)).not.toBe("ready");
      expect(loaded.memory.embeddings.sendRemote, JSON.stringify(value)).toBe(false);
      expect(fs.readFileSync(`${paths.settingsFile}.invalid`, "utf8")).toBe(original);
      expect(fs.readFileSync(paths.settingsFile, "utf8")).toBe(original);
    }
  });

  it("C52 apiKeyEnv names a conventional environment variable (capital letters, digits, _; not MORDOMO_*) and nothing else; empty means no key", () => {
    const read = (apiKeyEnv: string) => SettingsSchema.safeParse({ memory: { embeddings: { apiKeyEnv } } });
    for (const name of ["OPENAI_API_KEY", "KEY", "A", "EMBEDDINGS_KEY_2", "X".repeat(64), ""]) {
      const parsed = read(name);
      expect(parsed.success, name).toBe(true);
      expect((parsed.data as any).memory.embeddings.apiKeyEnv, name).toBe(name);
    }
    const refused = [
      "lower",
      "Mixed_Case",
      "1KEY",
      "_KEY",
      "MORDOMO_TOKEN",
      "MORDOMO_",
      "MORDOMO_TEST_EMBEDDINGS_KEY",
      "KEY WITH SPACE",
      " KEY",
      "KEY\n",
      "A-B",
      "KEY=1",
      "$HOME",
      "KÉY",
      "X".repeat(65),
    ];
    for (const name of refused) expect(read(name).success, JSON.stringify(name)).toBe(false);
    // the predicate the request is made through says the same
    expect(refused.filter((name) => EMBEDDINGS_KEY_ENV.test(name))).toEqual([]);
    expect(["OPENAI_API_KEY", "KEY"].every((name) => EMBEDDINGS_KEY_ENV.test(name))).toBe(true);
  });

  it("C52 a settings.json whose apiKeyEnv is not a conventional name reads as no key, keeps the other fields, and the file as settings.json.invalid", () => {
    for (const name of ["MORDOMO_TOKEN", "lower case", "x".repeat(300)]) {
      const { paths, store, write } = setup();
      const original = write({
        version: 2,
        memory: {
          embeddings: {
            enabled: true,
            provider: "http",
            endpoint: "http://127.0.0.1:11434/v1/embeddings",
            model: "m",
            dimensions: 8,
            apiKeyEnv: name,
          },
        },
      });
      const loaded = store.load();
      expect(loaded.memory.embeddings.apiKeyEnv, name).toBeUndefined();
      expect(loaded.memory.embeddings, name).toMatchObject({
        enabled: true,
        provider: "http",
        model: "m",
        dimensions: 8,
      });
      expect(fs.readFileSync(`${paths.settingsFile}.invalid`, "utf8")).toBe(original);
    }
  });

  it("C52 a field that is fine is kept: only the value that cannot be read costs anything", () => {
    const { store, write } = setup();
    write({
      memory: {
        embeddings: {
          enabled: true,
          provider: "http",
          endpoint: "http://127.0.0.1:11434/v1/embeddings",
          model: "m",
          dimensions: "x",
        },
      },
    });
    const loaded = store.load();
    expect(loaded.memory.embeddings).toMatchObject({ enabled: true, provider: "http", model: "m" });
    expect(loaded.memory.embeddings.dimensions).toBeUndefined();
  });
});
