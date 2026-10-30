import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type * as ChildProcess from "node:child_process";
import type * as Instances from "../apps/api/src/instances.js";
import type * as SafeFs from "../core/src/security/safeFs.js";
import { API, declaredErrors, routeKey, type RouteDefinition } from "@mordomo/contracts";
import { buildWorld, entryOf, SCENARIOS, type Result, type World } from "./helpers/contractWorld.js";
import { CEREBRO_V2_ROUTES } from "./helpers/routeScopes.js";

/**
 * The refusals of the path filter and of the safe reader, and of a settings file the engine will not replace
 * (.specs/features/contratos-rest, the fixes after round 3): the routes that may answer `403 forbidden_path`, `404
 * not_a_file`, `413 file_too_large`, `409 settings_newer` and `409 settings_unpreserved` are not listed by hand and
 * trusted. Each of the 139 routes is called as its scenario calls it. For the file refusals the call is made once for
 * each kind of read the scenario makes, and in each call one kind of read (`core/src/security/safeFs.ts`, the only
 * place those errors come from) refuses in the way a hostile file would: outside the granted folders, a folder or a
 * link out in place of a file, a file past its cap. For the settings refusals the whole table runs over a
 * `config/settings.json` that cannot be replaced. The routes that answer the refusal are the routes that must declare
 * it; the contract is compared with them, in both directions.
 */

// A restart child is faked so the test never restarts anything; reaping never signals a process of this machine.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, args: readonly string[] = [], ...rest: unknown[]) => {
      if (args.includes("restart")) {
        const fake = new EventEmitter() as EventEmitter & { unref: () => void };
        fake.unref = () => undefined;
        return fake;
      }
      return (actual.spawn as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
  };
});
vi.mock("../apps/api/src/instances.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Instances>()),
  terminate: async () => [],
}));

type Fault = "none" | "forbidden_path" | "not_a_file" | "file_too_large";
const state = vi.hoisted(() => ({
  fault: "none" as Fault,
  calls: 0,
  /** The home of the world being probed, to name a path by where it lies in it. */
  home: "",
  /** The scenario that is running, and the one kind of read (see `kindOf`) it may be refused; null refuses every kind. */
  scenario: "",
  only: null as string | null,
  /** While recording: for each fault, each scenario and each kind of read that scenario makes and can be refused. */
  recording: null as null | Record<string, Map<string, Set<string>>>,
}));

/**
 * Every function of safeFs the rest of the engine calls to resolve, stat, open, list or read a path. While a fault is
 * set, each one that can really throw that refusal does: all of them the path refusal; the openers and the readers
 * the folder in place of a file; the readers that were asked for `strict` the file past its cap (a reader that
 * truncates never throws it).
 */
vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SafeFs>();
  const { PathAccessError } = await import("../core/src/errors.js");
  const wrap =
    <A extends unknown[], R>(
      fn: (...a: A) => R,
      throwing: (a: A) => Fault[],
      pathOf: (a: A) => string,
    ): ((...a: A) => R) =>
    (...a: A): R => {
      if (state.recording) {
        const kind = kindOf(pathOf(a));
        for (const fault of throwing(a)) {
          const kinds = state.recording[fault]!;
          kinds.set(state.scenario, (kinds.get(state.scenario) ?? new Set()).add(kind));
        }
      }
      if (
        state.fault !== "none" &&
        throwing(a).includes(state.fault) &&
        (state.only === null || state.only === kindOf(pathOf(a)))
      ) {
        state.calls++;
        const at = pathOf(a);
        if (state.fault === "forbidden_path") throw new PathAccessError(at);
        if (state.fault === "not_a_file") throw new actual.NotRegularFileError(at);
        throw new actual.FileTooLargeError(at, 10_000_000, 1);
      }
      return fn(...a);
    };
  /**
   * What a path is for, by where it lies in the home: `skills||SKILL.md` (what the catalogue of skills reads first),
   * `skills|resources|` (what a sync reads once the catalogue has them), `memory||`, `routines||`, `CLAUDE.md||`. The
   * ids of the world differ from one run to the next; the kind does not. The `.claude/` of the sync target is the same
   * kind as the folder it mirrors.
   */
  const kindOf = (candidate: string): string => {
    const relative = path.relative(state.home, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return "outside||";
    const parts = relative.split(path.sep);
    if (parts[0] === ".claude") parts.shift();
    return `${parts[0] ?? ""}|${parts.includes("resources") ? "resources" : ""}|${parts[parts.length - 1] === "SKILL.md" ? "SKILL.md" : ""}`;
  };
  const second = (a: unknown[]): string => String(a[1]);
  const strictOf = (a: unknown[]): boolean => Boolean((a[2] as { strict?: boolean } | undefined)?.strict);
  const anywhere = (): Fault[] => ["forbidden_path"];
  const reader = (a: unknown[]): Fault[] => [
    "forbidden_path",
    "not_a_file",
    ...(strictOf(a) ? (["file_too_large"] as Fault[]) : []),
  ];
  const opener = (): Fault[] => ["forbidden_path", "not_a_file"];
  return {
    ...actual,
    inspectPath: wrap(actual.inspectPath, anywhere, second),
    resolveReadable: wrap(actual.resolveReadable, anywhere, second),
    resolveWorkspaceCwd: wrap(actual.resolveWorkspaceCwd, anywhere, second),
    statWorkspacePath: wrap(actual.statWorkspacePath, anywhere, second),
    assertWritablePath: wrap(actual.assertWritablePath, anywhere, second),
    assertHoldsNoPrivateFolder: wrap(actual.assertHoldsNoPrivateFolder, anywhere, second),
    listWorkspaceDir: wrap(actual.listWorkspaceDir, anywhere, second),
    openWorkspaceFile: wrap(actual.openWorkspaceFile, opener, second),
    readWorkspaceFile: wrap(actual.readWorkspaceFile, reader, second),
    readWorkspaceText: wrap(actual.readWorkspaceText, reader, second),
  };
});

const entries = Object.entries(API) as Array<[string, RouteDefinition]>;
const FAULTS = ["forbidden_path", "not_a_file", "file_too_large"] as const;
const STATUS: Record<(typeof FAULTS)[number], number> = {
  forbidden_path: 403,
  not_a_file: 404,
  file_too_large: 413,
};

const ROUTINE = { name: "Seed", prompt: "say hi", kind: "every", every: { value: 1, unit: "hours" } };
const CONNECTOR = { name: "Seed", kind: "api", origin: "test", maintainer: "test" };

/**
 * For each fault, what each route answered when its scenario ran in a world that refuses one kind of read (see
 * `kindOf`), once for each kind the scenario makes. Only one kind at a time: a hostile file is one file, and a refusal
 * that exists only after an earlier read succeeded (the catalogue of skills reads every SKILL.md before a sync reads
 * their resources) is not seen in a world where the earlier read refuses as well.
 */
const answered: Record<(typeof FAULTS)[number], Result[]> = {
  forbidden_path: [],
  not_a_file: [],
  file_too_large: [],
};
/** For each fault, how many calls into safeFs it refused (a probe that never refuses would prove nothing). */
const injected: Record<(typeof FAULTS)[number], number> = {
  forbidden_path: 0,
  not_a_file: 0,
  file_too_large: 0,
};
/** How many scenarios ran clean to learn the kinds of read they make. */
let scenariosSeen = 0;

/**
 * A world with the two ids that the creating scenarios use already taken (creating something that exists reads it
 * first). The answers are read raw: a response the contract does not describe must show here, and not turn into `500
 * response_contract_violation`.
 */
async function probeWorld(): Promise<World> {
  const world = await buildWorld({ validateResponses: false });
  state.home = world.home;
  await world.call("POST", "/api/routines", { ...ROUTINE, id: "contract-routine" });
  await world.call("POST", "/api/connectors", { ...CONNECTOR, id: "contract-connector" });
  return world;
}

/**
 * The scenarios of `refused`, in order, against one world, each with `fault` armed for the kind of read it names (the
 * others, when `everyScenario`, run clean: what they leave behind is the same in every pass). `recording` runs clean
 * and writes down the kinds of read each scenario makes.
 */
async function runPass(
  fault: (typeof FAULTS)[number],
  refused: ReadonlyMap<string, string>,
  options: { everyScenario: boolean; recording?: Record<string, Map<string, Set<string>>> },
): Promise<{ results: Result[]; refusals: number }> {
  const world = await probeWorld();
  state.calls = 0;
  state.recording = options.recording ?? null;
  const results: Result[] = [];
  try {
    for (const [scenarioKey, scenario] of Object.entries(SCENARIOS)) {
      const kind = refused.get(scenarioKey);
      if (!options.everyScenario && kind === undefined) continue;
      const { id, entry } = entryOf(scenarioKey);
      state.scenario = scenarioKey;
      state.only = kind ?? null;
      const { call, stream } = world;
      if (kind !== undefined) {
        // Only the request is refused: the call is wrapped, what the scenario sets up around it is not.
        world.call = async (...a) => {
          state.fault = fault;
          return call(...a);
        };
        world.stream = async (...a) => {
          state.fault = fault;
          return stream(...a);
        };
      }
      try {
        results.push({ key: scenarioKey, id, entry, answer: await scenario.run(world) });
      } finally {
        state.fault = "none";
        world.call = call;
        world.stream = stream;
      }
    }
    return { results, refusals: state.calls };
  } finally {
    state.recording = null;
    state.only = null;
    await world.close();
  }
}

afterAll(() => {
  state.fault = "none";
});

/** The routes whose scenario answered `fault`, as `METHOD /path`. */
function answering(fault: (typeof FAULTS)[number]): string[] {
  return answered[fault]
    .filter((r) => {
      const body = r.answer.body as { error?: { code?: string } } | undefined;
      return r.answer.status === STATUS[fault] && body?.error?.code === fault;
    })
    .map((r) => r.key)
    .filter((k, i, all) => all.indexOf(k) === i)
    .sort();
}

const declares = (entry: RouteDefinition, fault: (typeof FAULTS)[number]): boolean =>
  declaredErrors(entry).some((e) => e.status === STATUS[fault] && e.code === fault);

describe("S1 the refusals of the file readers", () => {
  beforeAll(async () => {
    // A clean pass first, to learn which kinds of read each scenario makes and each fault can refuse.
    const seen: Record<string, Map<string, Set<string>>> = {
      forbidden_path: new Map(),
      not_a_file: new Map(),
      file_too_large: new Map(),
    };
    scenariosSeen = (await runPass("forbidden_path", new Map(), { everyScenario: true, recording: seen }))
      .results.length;
    for (const fault of FAULTS) {
      const kinds = seen[fault]!;
      const most = Math.max(...[...kinds.values()].map((k) => k.size));
      for (let n = 0; n < most; n++) {
        const refused = new Map<string, string>();
        for (const [scenarioKey, set] of kinds) {
          const kind = [...set].sort()[n];
          if (kind !== undefined) refused.set(scenarioKey, kind);
        }
        // The first pass runs every scenario, so that each leaves what the next reads; the rest run only the scenarios
        // that make more than n kinds of read, which are reads of the world as it was built.
        const pass = await runPass(fault, refused, { everyScenario: n === 0 });
        answered[fault].push(...pass.results);
        injected[fault] += pass.refusals;
      }
    }
  }, 900_000);

  it("C45 the probe runs one scenario for each route, and the refusals reach the routes", () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(139);
    expect(scenariosSeen).toBe(139);
    for (const fault of FAULTS) {
      expect(injected[fault], `${fault} injected`).toBeGreaterThan(20);
      // A probe that finds nothing would pass every comparison below.
      expect(answering(fault).length, `${fault} answered`).toBeGreaterThan(5);
    }
  });

  it("C53 the probe has a scenario for each of the five routes of the second brain, and finds the refusals exactly where the contract lists them", () => {
    for (const key of Object.keys(CEREBRO_V2_ROUTES)) expect(Object.keys(SCENARIOS), key).toContain(key);
    for (const fault of FAULTS) {
      const here = answering(fault).filter((k) => k in CEREBRO_V2_ROUTES);
      const declaredHere = Object.keys(CEREBRO_V2_ROUTES).filter((k) =>
        declares(API[CEREBRO_V2_ROUTES[k]!.id]!, fault),
      );
      expect(here, fault).toEqual(declaredHere.sort());
    }
    // the note reader is the route of the five that opens a file the person names
    expect(answering("forbidden_path")).toContain("GET /api/memory/note");
    expect(answering("not_a_file")).toContain("GET /api/memory/note");
  });

  for (const fault of FAULTS) {
    it(`C46 the routes that answer ${STATUS[fault]} ${fault} are the routes that declare it`, () => {
      const answers = answering(fault);
      const declared = entries
        .filter(([, e]) => declares(e, fault))
        .map(([, e]) => routeKey(e))
        .sort();
      // Both ways: an undeclared answer is a lie of the contract; a declaration nobody answers is noise in the
      // document (and a mutant that drops a route from the list shows as a difference on either side).
      expect(
        answers.filter((k) => !declared.includes(k)),
        "answered, not declared",
      ).toEqual([]);
      expect(
        declared.filter((k) => !answers.includes(k)),
        "declared, never answered",
      ).toEqual([]);
    });
  }
});

describe("S1 real hostile files answer what the contract declares", () => {
  it("C48 real hostile files in the stores of routines and connectors answer what the contract declares", async () => {
    // The nine routes the verifier found answering `413`, `404` or `403` that the entry did not declare, called with the
    // file a person (or a sync tool) can really leave in `routines/` and `connectors/`: a file past the cap, a folder
    // named like a file, a link out of the folders. The server validates the responses: an undeclared answer is a 500.
    const world = await buildWorld({ validateResponses: true });
    try {
      const outside = path.join(world.workspace, "plan.md");
      const hostile: Array<[string, number, string]> = [
        ["big", 413, "file_too_large"],
        ["dir", 404, "not_a_file"],
        ["link", 403, "forbidden_path"],
      ];
      for (const store of ["routines", "connectors"] as const) {
        const dir = path.join(world.home, store);
        fs.writeFileSync(path.join(dir, "hostile-big.json"), "x".repeat(1024 * 1024 + 1));
        fs.mkdirSync(path.join(dir, "hostile-dir.json"));
        fs.symlinkSync(outside, path.join(dir, "hostile-link.json"));
      }
      const asked: string[] = [];
      for (const [kind, status, code] of hostile) {
        const id = `hostile-${kind}`;
        const calls: Array<[string, string, unknown?]> = [
          ["POST", "/api/routines", { ...ROUTINE, id }],
          ["PUT", `/api/routines/${id}`, ROUTINE],
          ["POST", `/api/routines/${id}/toggle`],
          ["POST", `/api/routines/${id}/duplicate`],
          ["POST", `/api/routines/${id}/run`],
          ["POST", "/api/connectors", { ...CONNECTOR, id }],
          ["PUT", `/api/connectors/${id}`, CONNECTOR],
          ["GET", `/api/connectors/${id}/data`],
          ["GET", `/api/connectors/${id}/setup`],
        ];
        for (const [method, url, body] of calls) {
          const answer = await world.call(method, url, body);
          const error = (answer.body as { error?: { code?: string } }).error;
          expect([answer.status, error?.code], `${method} ${url}`).toEqual([status, code]);
          asked.push(`${method} ${url}`);
        }
      }
      expect(asked).toHaveLength(27);
    } finally {
      await world.close();
    }
  }, 120_000);

  it("C52 a skill resource past the cap makes the sync answer 413, which the routes declare; a folder or a link there is skipped", async () => {
    // `desiredFiles` reads every resource of every skill and does not catch the refusal: the one hostile file the
    // catalogue (which lists only regular files and swallows a SKILL.md it refuses) does not hide.
    const world = await buildWorld({ validateResponses: true });
    try {
      const resource = path.join(world.home, "skills", "brainstorm", "resources", "methods.md");
      fs.rmSync(resource);
      fs.writeFileSync(resource, "x".repeat(2 * 1024 * 1024 + 1));
      const asked: string[] = [];
      for (const [method, url] of [
        ["GET", "/api/sync/plan"],
        ["POST", "/api/sync/apply"],
      ] as const) {
        const answer = await world.call(method, url, method === "POST" ? {} : undefined);
        const error = (answer.body as { error?: { code?: string } }).error;
        expect([method, url, answer.status, error?.code]).toEqual([method, url, 413, "file_too_large"]);
        asked.push(`${method} ${url}`);
      }
      expect(asked).toHaveLength(2);
      // Not a file the sync can read, and not one it is asked to: a folder, and a link out of the folders.
      for (const replace of [
        () => fs.mkdirSync(resource),
        () => fs.symlinkSync(path.join(world.workspace, "plan.md"), resource),
      ]) {
        fs.rmSync(resource, { recursive: true });
        replace();
        expect((await world.call("GET", "/api/sync/plan")).status).toBe(200);
        expect((await world.call("POST", "/api/sync/apply", {})).status).toBe(200);
      }
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe("S1 the refusals of a settings file the engine will not replace", () => {
  /**
   * The 139 routes, called as their scenarios call them, against a `config/settings.json` that cannot be replaced: one
   * written by a newer version, and one that holds values this version drops with every name for the copy that must be
   * kept aside taken by something else. The routes that answer `409 settings_newer` and `409 settings_unpreserved`
   * are the routes that list them, both ways.
   */
  // The one approval that saves settings when it is approved: the scenario of the route denies the one it is given.
  const exposePort = (w: World) => {
    const approval = w.ctx.approvals.request("expose_port", "Bind the server to every address", {
      bindAddress: "0.0.0.0",
    });
    return w.call("POST", `/api/approvals/${approval.id}/resolve`, { decision: "approved" });
  };
  const runOf = (key: string, w: World) =>
    key === "POST /api/approvals/:id/resolve" ? exposePort(w) : SCENARIOS[key]!.run(w);

  // The settings of the world as they are, with one change: the file keeps everything the routes read from it.
  const changed = (file: string, change: Record<string, unknown>): string => {
    const text =
      JSON.stringify({ ...(JSON.parse(fs.readFileSync(file, "utf8")) as object), ...change }, null, 2) + "\n";
    fs.writeFileSync(file, text);
    return text;
  };
  const seeds: Record<string, (file: string) => string> = {
    // A version this build does not know.
    settings_newer: (file) => changed(file, { version: 99, somethingNew: true }),
    // A field of the wrong type, which this version would drop, and every name for the copy taken by a folder.
    settings_unpreserved: (file) => {
      const text = changed(file, { systemName: 42 });
      // The copy goes to `<file>.invalid`, then `<file>.invalid.<hash>`, then eight numbered names.
      const first = `${file}.invalid`;
      const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
      for (const name of [
        first,
        `${first}.${hash}`,
        ...Array.from({ length: 8 }, (_, i) => `${first}.${hash}-${i + 1}`),
      ])
        fs.mkdirSync(name);
      return text;
    },
  };
  const answers: Record<string, string[]> = {};

  beforeAll(async () => {
    for (const [code, seed] of Object.entries(seeds)) {
      const world = await probeWorld();
      try {
        const text = seed(world.ctx.paths.settingsFile);
        // A scenario that sets up its own state with the settings store (the engine, not a request) cannot run over a
        // file the store refuses to replace: it is the scenario that stops there, not a route that answers.
        const results: Result[] = [];
        const stopped: string[] = [];
        for (const scenarioKey of Object.keys(SCENARIOS)) {
          const { id, entry } = entryOf(scenarioKey);
          try {
            results.push({ key: scenarioKey, id, entry, answer: await runOf(scenarioKey, world) });
          } catch {
            stopped.push(scenarioKey);
          }
        }
        // Most of the routes ran: a world that stops everywhere would find nothing and agree with an empty list.
        expect(
          stopped.length,
          `${code} scenarios that stopped in their own setup: ${stopped.join(", ")}`,
        ).toBeLessThan(15);
        answers[code] = results
          .filter(
            (r) =>
              r.answer.status === 409 &&
              (r.answer.body as { error?: { code?: string } })?.error?.code === code,
          )
          .map((r) => r.key)
          .sort();
        // The file is as the person left it: neither refusal wrote anything.
        expect(fs.readFileSync(world.ctx.paths.settingsFile, "utf8")).toBe(text);
      } finally {
        await world.close();
      }
    }
  }, 300_000);

  for (const code of Object.keys(seeds)) {
    it(`C53 the routes that answer 409 ${code} are the routes that declare it`, () => {
      const declared = entries
        .filter(([, e]) => declaredErrors(e).some((d) => d.status === 409 && d.code === code))
        .map(([, e]) => routeKey(e))
        .sort();
      // A probe that finds nothing would pass both comparisons below.
      expect(answers[code]!.length, `${code} answered`).toBeGreaterThan(3);
      expect(
        answers[code]!.filter((k) => !declared.includes(k)),
        "answered, not declared",
      ).toEqual([]);
      expect(
        declared.filter((k) => !answers[code]!.includes(k)),
        "declared, never answered",
      ).toEqual([]);
    });
  }

  it("C53 with the response check on, a route over a settings file from a newer version answers 409, not 500", async () => {
    const world = await buildWorld({ validateResponses: true });
    try {
      const text = seeds.settings_newer!(world.ctx.paths.settingsFile);
      const asked: string[] = [];
      for (const key of [
        "PUT /api/settings",
        "PUT /api/providers/default",
        "POST /api/providers/:id/detect",
        "POST /api/skills/:slug/favorite",
        "POST /api/approvals/:id/resolve",
      ]) {
        const answer = await runOf(key, world);
        const error = (answer.body as { error?: { code?: string } }).error;
        expect([key, answer.status, error?.code]).toEqual([key, 409, "settings_newer"]);
        asked.push(key);
      }
      expect(asked).toHaveLength(5);
      expect(fs.readFileSync(world.ctx.paths.settingsFile, "utf8")).toBe(text);
    } finally {
      await world.close();
    }
  }, 120_000);
});
