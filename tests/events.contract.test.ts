import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENT_ENVELOPES,
  EVENT_SCHEMAS,
  EVENT_VERSIONS,
  OS_EVENT_TYPES,
  OsEventSchema,
  RUN_FRAME_SCHEMAS,
  RUN_FRAME_TYPES,
  RUN_FRAME_VERSIONS,
  RunFrameSchema,
  checkBody,
  classifyEvent,
  classifyRunFrame,
  currentEventVersion,
  readOsEvent,
} from "@mordomo/contracts";
import * as registry from "@mordomo/contracts/events";
import { EventBus } from "@mordomo/core/internal";
import { eventsDocument } from "../apps/api/src/eventsDoc.js";
import { SCENARIOS, buildWorld, runScenarios, type World } from "./helpers/contractWorld.js";

/** Versions per event type (.specs/features/contratos-rest, S4): the registry, the schemas, the fixtures, the policy. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests/fixtures/events");
const load = (rel: string) =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, rel), "utf8")) as Record<string, unknown>;
const names = (dir: string) =>
  fs
    .readdirSync(path.join(fixtureDir, dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();

describe("S4 the registry", () => {
  it("C22 every event type has a version list", () => {
    expect(OS_EVENT_TYPES).toHaveLength(25);
    expect(new Set(OS_EVENT_TYPES).size).toBe(25);
    expect(Object.keys(EVENT_VERSIONS).sort()).toEqual([...OS_EVENT_TYPES].sort());
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual([...OS_EVENT_TYPES].sort());
    for (const type of OS_EVENT_TYPES) {
      const versions: readonly number[] = EVENT_VERSIONS[type];
      // Oldest first, contiguous from 1: a version never leaves the list, and none is skipped.
      expect(versions, type).toEqual(versions.map((_, i) => i + 1));
      expect(versions.length, type).toBeGreaterThan(0);
      expect(currentEventVersion(type), type).toBe(versions[versions.length - 1]);
      expect(Object.keys(EVENT_SCHEMAS[type]).map(Number), type).toEqual(versions);
    }
    expect(RUN_FRAME_TYPES).toHaveLength(10);
    for (const type of RUN_FRAME_TYPES) {
      const versions: readonly number[] = RUN_FRAME_VERSIONS[type];
      expect(versions, type).toEqual(versions.map((_, i) => i + 1));
      expect(Object.keys(RUN_FRAME_SCHEMAS[type]).map(Number), type).toEqual(versions);
    }
    // The bus stamps the current version of the type it emits.
    const bus = new EventBus();
    for (const type of OS_EVENT_TYPES) {
      const sent = bus.emit(type, load(`v1/${type}.json`).payload as never);
      expect(sent.v, type).toBe(currentEventVersion(type));
    }
    // The browser's entry point is the same registry, without the schemas.
    expect(Object.keys(registry).sort()).toEqual(
      [
        "EVENT_VERSIONS",
        "OS_EVENT_TYPES",
        "RUN_FRAME_TYPES",
        "RUN_FRAME_VERSIONS",
        "classifyEvent",
        "classifyRunFrame",
        "currentEventVersion",
        "currentRunFrameVersion",
      ].sort(),
    );
    expect(registry.EVENT_VERSIONS).toBe(EVENT_VERSIONS);
  });

  it("C23 the envelope is a union discriminated by type and v", () => {
    for (const type of OS_EVENT_TYPES) {
      const fixture = load(`v1/${type}.json`);
      expect(OsEventSchema.safeParse(fixture).success, type).toBe(true);
      const read = readOsEvent(fixture);
      expect(read, type).toMatchObject({ ok: true, type, v: 1 });
    }
    expect(EVENT_ENVELOPES).toHaveLength(OS_EVENT_TYPES.length);
    // A type with the payload of another is none of the members.
    const created = load("v1/run.created.json");
    const finished = load("v1/run.finished.json");
    const mixed = { ...created, payload: finished.payload };
    expect(OsEventSchema.safeParse(mixed).success).toBe(false);
    expect(readOsEvent(mixed)).toMatchObject({ ok: false, reason: "invalid" });
    // A version the type has not had is none of them either.
    expect(OsEventSchema.safeParse({ ...created, v: 2 }).success).toBe(false);
    expect(OsEventSchema.safeParse({ ...created, v: undefined }).success).toBe(false);
    // The pair (type, v) picks the schema: a payload that is another version's shape would not pass.
    const entry = EVENT_ENVELOPES.find((e) => e.type === "run.created" && e.v === 1)!;
    expect(checkBody(entry.schema, created)).toEqual([]);
    expect(checkBody(entry.schema, { ...created, type: "run.started" })).not.toEqual([]);
  });

  it("C24 run frames have a schema and the stream sends v", () => {
    expect(names("v1/run-frames")).toEqual([...RUN_FRAME_TYPES].sort());
    for (const type of RUN_FRAME_TYPES) {
      const fixture = load(`v1/run-frames/${type}.json`);
      expect(checkBody(RunFrameSchema, fixture), type).toEqual([]);
      expect(classifyRunFrame(fixture), type).toEqual({ kind: "known", type, v: 1 });
      // The version is part of the frame: without it the contract's schema does not accept the frame…
      const { v: _v, ...bare } = fixture;
      expect(RunFrameSchema.safeParse(bare).success, `${type} without v`).toBe(false);
      // …while a client reads a frame from a server that predates it as version 1.
      expect(classifyRunFrame(bare), `${type} legacy`).toEqual({ kind: "known", type, v: 1 });
    }
    expect(classifyRunFrame({ ...load("v1/run-frames/text.json"), v: 2 })).toMatchObject({
      kind: "unsupported_version",
    });
    expect(classifyRunFrame({ type: "run_state_2", v: 1 })).toMatchObject({ kind: "unknown_type" });
  });

  it("C25 a future version or an unknown type is dropped", () => {
    const created = load("v1/run.created.json");
    expect(classifyEvent(created)).toEqual({ kind: "known", type: "run.created", v: 1 });
    // A type the client does not know.
    for (const type of ["x.y", "", 3, null, undefined, {}, "toString", "__proto__", "constructor"]) {
      expect(classifyEvent({ ...created, type }), String(type)).toMatchObject({ kind: "unknown_type" });
    }
    // A version above the highest it knows, and the ones that are no version at all.
    for (const v of [2, 3, 1000])
      expect(classifyEvent({ ...created, v }), String(v)).toMatchObject({
        kind: "unsupported_version",
        type: "run.created",
        v,
      });
    for (const v of [0, -1, 1.5, "1", null, undefined, NaN]) {
      expect(classifyEvent({ ...created, v }), String(v)).toMatchObject({ kind: "unsupported_version" });
    }
    // What is not an event at all.
    for (const junk of [null, undefined, "text", 7, [], [created], true]) {
      expect(classifyEvent(junk), JSON.stringify(junk)).toMatchObject({ kind: "unknown_type" });
    }
    // The reader built on it drops them too, and never throws.
    expect(readOsEvent({ ...created, v: 2 })).toEqual({ ok: false, reason: "unsupported_version" });
    expect(readOsEvent({ ...created, type: "x.y" })).toEqual({ ok: false, reason: "unknown_type" });
    expect(() => readOsEvent(Symbol.iterator)).not.toThrow();
  });

  it("C26 an extra field is accepted", () => {
    for (const type of OS_EVENT_TYPES) {
      const fixture = load(`v1/${type}.json`);
      const payload = fixture.payload as Record<string, unknown>;
      const extended = { ...fixture, added: { later: true }, payload: { ...payload, addedLater: 1 } };
      expect(readOsEvent(extended), type).toMatchObject({ ok: true, type });
      expect(OsEventSchema.safeParse(extended).success, type).toBe(true);
    }
    for (const type of RUN_FRAME_TYPES) {
      const extended = { ...load(`v1/run-frames/${type}.json`), addedLater: 1 };
      expect(RunFrameSchema.safeParse(extended).success, type).toBe(true);
    }
  });

  it("C27 the v1 fixtures keep parsing", () => {
    // The fixtures are frozen: one per type and one directory per version any type has had.
    const versions = [...new Set(OS_EVENT_TYPES.flatMap((t) => [...EVENT_VERSIONS[t]]))].sort();
    const dirs = fs
      .readdirSync(fixtureDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(versions.map((v) => `v${v}`));
    for (const v of versions) {
      for (const type of OS_EVENT_TYPES.filter((t) => (EVENT_VERSIONS[t] as readonly number[]).includes(v))) {
        const fixture = load(`v${v}/${type}.json`);
        expect(fixture.v, `${type} v${v}`).toBe(v);
        const entry = EVENT_ENVELOPES.find((e) => e.type === type && e.v === v);
        expect(entry, `${type} v${v} has a schema`).toBeDefined();
        expect(checkBody(entry!.schema, fixture), `${type} v${v}`).toEqual([]);
      }
      expect(names(`v${v}`).filter((n) => n !== "run-frames")).toEqual(
        OS_EVENT_TYPES.filter((t) => (EVENT_VERSIONS[t] as readonly number[]).includes(v)).sort(),
      );
    }
    // The fixtures say what the wire was, not what the code makes of it: they carry the values a v1 sent.
    expect(load("v1/run.created.json")).toMatchObject({
      type: "run.created",
      v: 1,
      payload: { origin: "manual" },
    });
  });
});

describe("S4 the bus and the document", () => {
  let world: World;
  const seen: Array<{ type: string; v: number }> = [];
  let emit: typeof EventBus.prototype.emit;

  beforeAll(async () => {
    emit = EventBus.prototype.emit;
    // No bus of the process: watch the emissions of whichever bus the scenarios' engine builds.
    EventBus.prototype.emit = function (
      this: InstanceType<typeof EventBus>,
      ...args: Parameters<typeof emit>
    ) {
      const event = emit.apply(this, args);
      seen.push({ type: event.type, v: event.v });
      return event;
    } as typeof emit;
    world = await buildWorld();
    await runScenarios(world);
  }, 180_000);

  afterAll(async () => {
    EventBus.prototype.emit = emit;
    await world.close();
  });

  it("C28 the bus emissions satisfy their schema", () => {
    // The guard of tests/helpers/eventGuard.ts (setupFiles) already failed any test that emitted a departure; here
    // the scenarios of the whole API ran under it, and the types they reached through the real emitters are named.
    const reached = new Set(seen.map((e) => e.type));
    const real = [
      "run.created",
      "run.started",
      "run.event",
      "run.finished",
      "routine.changed",
      "routine.fired",
      "index.started",
      "index.finished",
      "approval.requested",
      "approval.resolved",
      "session.created",
      "session.updated",
      "objective.changed",
      "settings.changed",
      "backup.created",
      "notification.created",
      "notification.read",
    ];
    for (const type of real) expect(reached.has(type), `the API emitted ${type}`).toBe(true);
    // The types the scenarios cannot cause without waiting (a budget, a sentinel, an alert, a restart) are emitted from
    // their frozen examples: the same bus, the same guard.
    const bus = new EventBus();
    for (const type of OS_EVENT_TYPES) {
      const fixture = load(`v1/${type}.json`);
      const sent = bus.emit(type, fixture.payload as never);
      expect(sent.v, type).toBe(currentEventVersion(type));
      const entry = EVENT_ENVELOPES.find((e) => e.type === type && e.v === sent.v)!;
      expect(checkBody(entry.schema, sent), type).toEqual([]);
    }
    expect(Object.keys(SCENARIOS)).toHaveLength(132);
  });

  it("C53 docs/events.md describes the two events of the index worker and the phases of its progress, and equals the generated text", () => {
    const generated = eventsDocument();
    const file = path.join(repoRoot, "docs/events.md");
    expect(fs.readFileSync(file, "utf8")).toBe(generated);
    for (const type of ["index.started", "index.cancelled"]) {
      expect(OS_EVENT_TYPES, type).toContain(type);
      expect(generated, type).toContain(`### \`${type}\``);
    }
    const started = generated.slice(generated.indexOf("### `index.started`"));
    expect(started.slice(0, started.indexOf("\n### ", 5))).toContain(
      '| `mode` | "worker" \\| "inline" | yes |',
    );
    expect(started.slice(0, started.indexOf("\n### ", 5))).toContain("| `runId` | string | yes |");
    const progress = generated.slice(generated.indexOf("### `index.progress`"));
    const section = progress.slice(0, progress.indexOf("\n### ", 5));
    for (const phase of ["scan", "index", "prune", "related", "vectors"])
      expect(section, phase).toContain(phase);
    expect(section).toContain("`runId`");
  });

  it("C29 docs/events.md equals the generated text", () => {
    const generated = eventsDocument();
    const file = path.join(repoRoot, "docs/events.md");
    if (process.env.UPDATE_EVENTS_DOC === "1") fs.writeFileSync(file, generated);
    expect(fs.readFileSync(file, "utf8")).toBe(generated);
    // The three rules of the policy, and a section for every type and every frame.
    expect(generated).toContain("A field added is compatible");
    expect(generated).toContain("An incompatible change adds a version");
    expect(generated).toContain("A client ignores what it does not know");
    for (const type of OS_EVENT_TYPES) expect(generated, type).toContain(`### \`${type}\``);
    for (const type of RUN_FRAME_TYPES) expect(generated, type).toContain(`### \`${type}\``);
    expect(generated).toContain("Versions: 1 (current 1).");
  });
});
