/**
 * The schema of what is on the wire: the OUTPUT type of a schema, with nothing left to fill in.
 *
 * A route's schema describes what a handler returns. Zod parses INPUT: a key with `.default()` or `.catch()`, or a
 * value behind `preprocess`/`transform`, may be absent or odd and the parse repairs it, which is right for a request and
 * wrong for a response: the server always sends the key, and a client that reads the document must see it as required.
 * `wireSchema` rebuilds a schema so that
 *  - a `.default(x)` or `.catch(x)` is its inner type: the key is required, there is nothing to fill in;
 *  - a `preprocess` or a `transform` is its inner schema (what the server hands over is already the normalised value);
 *  - a refinement stays (it checks a value, it does not make one);
 *  - everything else keeps its shape, with the same rule applied underneath.
 * The same schema is the one the response check parses with and the one the document is generated from, so the two
 * cannot disagree about which keys are mandatory. It is memoised: the same schema gives the same result, so a named
 * schema used in several places is one object (the document points at it).
 *
 * A node whose children it does not know how to rebuild is an error, not a pass-through: a schema left as it was would
 * keep a `.default()` underneath that the rest of the contract believes is gone. The nodes no schema of the
 * contract uses (`readonly`, `brand`, `nativeEnum`, an object with a `catchall`) are in that case on purpose: they stop
 * the build with the type's name, so a schema that starts using one is a rebuild to write and a test for it, not a
 * rule that silently goes wrong.
 */
import { z } from "zod";

const memo = new WeakMap<z.ZodTypeAny, z.ZodTypeAny>();

type Def = Record<string, unknown> & { typeName?: string; description?: string };

/** `schema` with `def` instead of its own definition (same class, same methods). */
function rebuild(schema: z.ZodTypeAny, def: Def): z.ZodTypeAny {
  const Ctor = schema.constructor as new (def: Def) => z.ZodTypeAny;
  return new Ctor(def);
}

function build(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as Def;
  const wire = wireSchema;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodDefault:
    case z.ZodFirstPartyTypeKind.ZodCatch: {
      const inner = wire(def.innerType as z.ZodTypeAny);
      return def.description && !inner.description ? inner.describe(def.description) : inner;
    }
    case z.ZodFirstPartyTypeKind.ZodEffects: {
      const inner = wire(def.schema as z.ZodTypeAny);
      const effect = def.effect as { type: string };
      if (effect.type === "refinement") return rebuild(schema, { ...def, schema: inner });
      return def.description && !inner.description ? inner.describe(def.description) : inner;
    }
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const mapped = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, wire(value)]));
      // The catch-all of an object is `never` (no other key) unless `.catchall(x)` made it a schema, which is a node
      // this does not rebuild: no schema of the contract has one, and the day one does it is a decision, not a default.
      const catchall = def.catchall as z.ZodTypeAny | undefined;
      if (catchall && (catchall._def as Def).typeName !== z.ZodFirstPartyTypeKind.ZodNever)
        throw new Error("wireSchema: an object with a catchall schema has no output-type rebuild");
      return rebuild(schema, { ...def, shape: () => mapped });
    }
    case z.ZodFirstPartyTypeKind.ZodArray:
      return rebuild(schema, { ...def, type: wire(def.type as z.ZodTypeAny) });
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return rebuild(schema, { ...def, innerType: wire(def.innerType as z.ZodTypeAny) });
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return rebuild(schema, { ...def, valueType: wire(def.valueType as z.ZodTypeAny) });
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return rebuild(schema, { ...def, options: (def.options as z.ZodTypeAny[]).map(wire) });
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = (def.options as z.ZodTypeAny[]).map(wire);
      const bySource = new Map((def.options as z.ZodTypeAny[]).map((option, i) => [option, options[i]!]));
      const optionsMap = new Map(
        [...(def.optionsMap as Map<unknown, z.ZodTypeAny>)].map(([value, option]) => [
          value,
          bySource.get(option)!,
        ]),
      );
      return rebuild(schema, { ...def, options, optionsMap });
    }
    case z.ZodFirstPartyTypeKind.ZodIntersection:
      return rebuild(schema, {
        ...def,
        left: wire(def.left as z.ZodTypeAny),
        right: wire(def.right as z.ZodTypeAny),
      });
    case z.ZodFirstPartyTypeKind.ZodTuple:
      return rebuild(schema, {
        ...def,
        items: (def.items as z.ZodTypeAny[]).map(wire),
        ...(def.rest ? { rest: wire(def.rest as z.ZodTypeAny) } : {}),
      });
    case z.ZodFirstPartyTypeKind.ZodLazy:
      return rebuild(schema, { ...def, getter: () => wire((def.getter as () => z.ZodTypeAny)()) });
    case z.ZodFirstPartyTypeKind.ZodSet:
      return rebuild(schema, { ...def, valueType: wire(def.valueType as z.ZodTypeAny) });
    case z.ZodFirstPartyTypeKind.ZodMap:
      return rebuild(schema, {
        ...def,
        keyType: wire(def.keyType as z.ZodTypeAny),
        valueType: wire(def.valueType as z.ZodTypeAny),
      });
    case z.ZodFirstPartyTypeKind.ZodPipeline: {
      // `a.pipe(b)`: the value that leaves is `b`'s output; what `a` made of the input is already behind it.
      const out = wire(def.out as z.ZodTypeAny);
      return def.description && !out.description ? out.describe(def.description) : out;
    }
    default:
      if (LEAVES.has(def.typeName as string)) return schema;
      throw new Error(
        `wireSchema: ${String(def.typeName)} has no output-type rebuild, so the contract cannot say what it sends`,
      );
  }
}

/** The zod types with nothing underneath: they are their own output type. */
const LEAVES: ReadonlySet<string> = new Set([
  z.ZodFirstPartyTypeKind.ZodString,
  z.ZodFirstPartyTypeKind.ZodNumber,
  z.ZodFirstPartyTypeKind.ZodNaN,
  z.ZodFirstPartyTypeKind.ZodBigInt,
  z.ZodFirstPartyTypeKind.ZodBoolean,
  z.ZodFirstPartyTypeKind.ZodDate,
  z.ZodFirstPartyTypeKind.ZodSymbol,
  z.ZodFirstPartyTypeKind.ZodUndefined,
  z.ZodFirstPartyTypeKind.ZodNull,
  z.ZodFirstPartyTypeKind.ZodAny,
  z.ZodFirstPartyTypeKind.ZodUnknown,
  z.ZodFirstPartyTypeKind.ZodNever,
  z.ZodFirstPartyTypeKind.ZodVoid,
  z.ZodFirstPartyTypeKind.ZodLiteral,
  z.ZodFirstPartyTypeKind.ZodEnum,
]);

/** The schema of the output type of `schema`: what a response carries, with nothing left to fill in. */
export function wireSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const hit = memo.get(schema);
  if (hit) return hit;
  const built = build(schema);
  memo.set(schema, built);
  return built;
}
