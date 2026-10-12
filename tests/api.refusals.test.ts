import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type * as ChildProcess from "node:child_process";
import type * as Instances from "../apps/api/src/instances.js";
import type * as SafeFs from "../core/src/security/safeFs.js";
import { API, declaredErrors, routeKey, type RouteDefinition } from "@mordomo/contracts";
import { buildWorld, runScenarios, SCENARIOS, type Result } from "./helpers/contractWorld.js";

/**
 * The refusals of the path filter and of the safe reader (.specs/features/contratos-rest, round 3 of the fixes): the
 * routes that may answer `403 forbidden_path`, `404 not_a_file` and `413 file_too_large` are not listed by hand and
 * trusted. Each of the 132 routes is called as its scenario calls it, in a world where every call into the path
 * filter or the safe reader (`core/src/security/safeFs.ts`, the only place those errors come from) refuses in the
 * way a hostile file would: outside the granted folders, a folder or a link out in place of a file, a file past its
 * cap. The routes that answer the refusal are the routes that must declare it; the contract is compared with them.
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
const state = vi.hoisted(() => ({ fault: "none" as Fault, calls: 0 }));

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
      if (state.fault !== "none" && throwing(a).includes(state.fault)) {
        state.calls++;
        const at = pathOf(a);
        if (state.fault === "forbidden_path") throw new PathAccessError(at);
        if (state.fault === "not_a_file") throw new actual.NotRegularFileError(at);
        throw new actual.FileTooLargeError(at, 10_000_000, 1);
      }
      return fn(...a);
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

/** For each fault, what each route answered when its scenario ran in a world that refuses that way. */
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

beforeAll(async () => {
  for (const fault of FAULTS) {
    // The world is built clean; the refusal starts with the first scenario. The answers are read raw: a response the
    // contract does not describe must show here, and not turn into `500 response_contract_violation`.
    const world = await buildWorld({ validateResponses: false });
    // Creating something that already exists reads it first: the ids the creating scenarios use are taken.
    await world.call("POST", "/api/routines", { ...ROUTINE, id: "contract-routine" });
    await world.call("POST", "/api/connectors", { ...CONNECTOR, id: "contract-connector" });
    // Only the request is refused: what a scenario sets up around it with the engine itself runs clean.
    const { call, stream } = world;
    const during =
      <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
      async (...a: A): Promise<R> => {
        state.fault = fault;
        try {
          return await fn(...a);
        } finally {
          state.fault = "none";
        }
      };
    world.call = during(call);
    world.stream = during(stream);
    state.calls = 0;
    try {
      answered[fault] = await runScenarios(world);
      injected[fault] = state.calls;
    } finally {
      world.call = call;
      world.stream = stream;
      await world.close();
    }
  }
}, 600_000);

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
    .sort();
}

const declares = (entry: RouteDefinition, fault: (typeof FAULTS)[number]): boolean =>
  declaredErrors(entry).some((e) => e.status === STATUS[fault] && e.code === fault);

describe("S1 the refusals of the file readers", () => {
  it("C45 the probe runs one scenario for each route, and the refusals reach the routes", () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(132);
    for (const fault of FAULTS) {
      expect(answered[fault], fault).toHaveLength(132);
      expect(injected[fault], `${fault} injected`).toBeGreaterThan(20);
      // A probe that finds nothing would pass every comparison below.
      expect(answering(fault).length, `${fault} answered`).toBeGreaterThan(5);
    }
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
});
