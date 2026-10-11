/**
 * `checkResponse`: does a real response satisfy the contract of the route that answered it? Used by the test suite
 * and by the development server (`validateResponses`); the production server never calls it.
 *
 * A response satisfies the contract when
 *  - its status is a success status of the entry, or an error `(status, error.code)` the entry or `COMMON_ERRORS` lists;
 *  - its JSON body satisfies the schema of that status (the envelope, for an error);
 *  - it has every key the schema names (a key with a default is mandatory here: the schema checked is the output type);
 *  - and the body has no key the schema does not name. The schemas themselves are tolerant (a client must not break on
 *    an additive field); this is where a field added to a response without a change of the contract is caught.
 */
import { ErrorEnvelope, declaredErrors } from "./errors.js";
import { isRawResponse, type RouteDefinition } from "./route.js";
import type { z } from "zod";
import { wireSchema } from "./wireSchema.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The body as a client reads it: through JSON, so a key set to `undefined` is gone and a `Date` is its string. */
export function toWire(body: unknown): unknown {
  return body === undefined ? undefined : JSON.parse(JSON.stringify(body));
}

/** The paths of the keys in `wire` that `parsed` (what the schema made of it) dropped. */
function droppedKeys(parsed: unknown, wire: unknown, at: string, out: string[]): void {
  if (Array.isArray(wire) && Array.isArray(parsed)) {
    wire.forEach((item, i) => droppedKeys(parsed[i], item, `${at}[${i}]`, out));
    return;
  }
  if (!isPlainObject(wire) || !isPlainObject(parsed)) return;
  for (const [key, value] of Object.entries(wire)) {
    if (!(key in parsed)) out.push(`${at}.${key}`);
    else droppedKeys(parsed[key], value, `${at}.${key}`, out);
  }
}

const pathOf = (path: ReadonlyArray<string | number>): string =>
  `$${path.map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`)).join("")}`;

/** What is wrong, without the value that was wrong: a problem is logged and answered, and a body may hold private text. */
function describe(issue: z.ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `expected ${issue.expected}, received ${issue.received}`;
    case "invalid_enum_value":
      return "not one of the allowed values";
    case "invalid_literal":
      return "not the literal value the contract names";
    case "invalid_union": {
      // The member that came closest says what is missing, which is what whoever reads this needs to fix.
      const closest = [...issue.unionErrors].sort((a, b) => a.issues.length - b.issues.length)[0]?.issues[0];
      return closest
        ? `matches no member of the union (closest: ${pathOf(closest.path)}: ${describe(closest)})`
        : "matches no member of the union";
    }
    case "invalid_union_discriminator":
      return "matches no member of the union";
    case "unrecognized_keys":
      return "has keys the contract does not name";
    default:
      return issue.code;
  }
}

/** Problems of `body` against `schema`, as `path: what` strings; empty when it satisfies it and names every key. */
export function checkBody(schema: z.ZodTypeAny, body: unknown): string[] {
  const wire = toWire(body);
  // What is checked is what is on the wire: the output type, so a key the schema would fill in (a default, a catch) is
  // required, and a key that is missing is a problem (`wireSchema`).
  const result = wireSchema(schema).safeParse(wire);
  if (!result.success) {
    return result.error.issues.map((issue) => `${pathOf(issue.path)}: ${describe(issue)}`);
  }
  const dropped: string[] = [];
  droppedKeys(result.data, wire, "$", dropped);
  return dropped.map((path) => `${path}: the contract does not name this key`);
}

/** Problems of one real response against the entry that should have answered it; empty when it conforms. */
export function checkResponse(route: RouteDefinition, status: number, body: unknown): string[] {
  if (status >= 200 && status < 300) {
    const spec = route.responses[status];
    if (!spec) {
      const declared = Object.keys(route.responses).join(", ");
      return [
        `status ${status} is not a success status of ${route.method} ${route.path} (declared: ${declared})`,
      ];
    }
    return isRawResponse(spec) ? [] : checkBody(spec, body);
  }
  if (status >= 400) {
    const shape = checkBody(ErrorEnvelope, body);
    if (shape.length > 0) return shape.map((p) => `error body is not the envelope: ${p}`);
    const { error, message } = body as ErrorEnvelope;
    if (message !== error.message) return ["error body: message differs from error.message"];
    if (!declaredErrors(route).some((e) => e.status === status && e.code === error.code)) {
      return [`error ${status} ${error.code} is not declared by ${route.method} ${route.path}`];
    }
    return [];
  }
  return [`status ${status} is neither a success nor an error of the contract`];
}
