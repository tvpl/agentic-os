import { afterAll, afterEach, beforeAll } from "vitest";
import { EVENT_ENVELOPES, checkBody } from "@mordomo/contracts";

/**
 * Every event that any bus announces during a test file is checked against the schema of its type and version
 * (.specs/features/contratos-rest, AC 28): with no key the schema does not name. A test that emits an event the
 * contract does not describe fails here, whichever suite it is in. Loaded by `setupFiles`.
 *
 * There is no bus of the process (every engine builds its own), so the guard wraps `EventBus.prototype.emit`: each
 * event is checked where it is made, on whichever bus. The class is reached from `beforeAll`, with a dynamic import,
 * and not at the top of this file: a setup file runs before the test file, so a static import of the engine here
 * would load it (and `node:child_process`) before the test's own `vi.mock` is registered, and the mock would never
 * apply to it.
 */
const violations: string[] = [];

beforeAll(async () => {
  const { EventBus } = await import("@mordomo/core/internal");
  const emit = EventBus.prototype.emit;
  EventBus.prototype.emit = function (this: InstanceType<typeof EventBus>, type, payload) {
    const event = emit.call(this, type, payload);
    const entry = EVENT_ENVELOPES.find((e) => e.type === event.type && e.v === event.v);
    const problems = entry
      ? checkBody(entry.schema, event)
      : [`no schema for ${event.type} version ${String(event.v)}`];
    if (problems.length > 0)
      violations.push(`${event.type} v${String(event.v)}: ${problems.slice(0, 4).join(", ")}`);
    return event;
  } as typeof emit;
});

afterEach(() => {
  if (violations.length === 0) return;
  const found = violations.splice(0);
  throw new Error(`an event departs from its schema: ${found.join("; ")}`);
});

// An event announced after the last test of a file (a timer, a delivery that ends late) has no `afterEach` left to
// fail: the file fails here, so it cannot slip through.
afterAll(() => {
  if (violations.length === 0) return;
  const found = violations.splice(0);
  throw new Error(`an event departs from its schema after the last test: ${found.join("; ")}`);
});
