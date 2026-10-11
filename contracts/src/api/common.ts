/** Pieces several routes share: identifiers, pagination, the small acknowledgements, and the error shorthand. */
import { z } from "zod";
import type { ErrorDoc } from "./route.js";

/**
 * Strict identifier for every `:id` / `:slug` / `:name` route parameter. No path separators, no `..`, bounded
 * length - so `path.join(dir, id)` can never leave `dir` even if a store forgets to check.
 */
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export const IdParam = z
  .string()
  .regex(ID_RE, "must be 1-81 characters of letters, digits, '.', '_' or '-'")
  .refine((v) => !v.includes(".."), { message: "must not contain '..'" });

export const UuidParam = z.string().uuid();

export const BackupNameParam = z.string().regex(/^full-[A-Za-z0-9-]{1,80}$/, "invalid backup name");

export const IdParams = z.object({ id: IdParam });
export const SlugParams = z.object({ slug: IdParam });
export const UuidParams = z.object({ id: UuidParam });
export const BackupNameParams = z.object({ name: BackupNameParam });

/**
 * The bounds every request that starts a run is held to: the HTTP routes here and the engine's own schemas
 * (`core/src/execution/schemas.ts`) use the same numbers. They bound what a caller asks for; the default timeout in
 * the settings is not held to them.
 */
export const RUN_LIMITS = {
  promptMaxChars: 20_000,
  timeoutMinMs: 10_000,
  timeoutMaxMs: 3_600_000,
} as const;

/** A `timeoutMs` a caller asks for. */
export const RunTimeout = z.number().int().min(RUN_LIMITS.timeoutMinMs).max(RUN_LIMITS.timeoutMaxMs);

/** The prompt of a run. */
export const RunPrompt = z.string().min(1).max(RUN_LIMITS.promptMaxChars);

const FLAG_VALUES = { "1": true, true: true, "0": false, false: false } as const;

/**
 * A flag in a query string. `1` and `true` set it, `0` and `false` clear it, and a key that is absent is absent (the
 * handler's own default decides: `record` records unless it is cleared). Any other text is a `400 validation`:
 * `z.coerce.boolean()` read `"0"` and `"false"` as true, and a flag that cannot be switched off is no flag. The
 * document describes it as the four texts; a client (`apiCall`) may pass a boolean, which is sent as `1` or `0`.
 */
export const QueryFlag = z.preprocess(
  (value) =>
    typeof value === "string" && value in FLAG_VALUES
      ? FLAG_VALUES[value as keyof typeof FLAG_VALUES]
      : value,
  z.boolean().optional(),
) as unknown as z.ZodType<
  boolean | undefined,
  z.ZodTypeDef,
  boolean | "1" | "true" | "0" | "false" | undefined
>;

/** The texts a `QueryFlag` accepts. */
export const QUERY_FLAG_TEXTS = ["1", "true", "0", "false"] as const;

/** `limit` and `offset` of a list that answers a plain array with the total in `x-total-count`. */
export const PageQuery = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
};

/** `{ ok: true }`: the acknowledgement of a command that has nothing else to say. */
export const OkSchema = z.object({ ok: z.literal(true) });

/** `{ deleted: id }`. */
export const DeletedSchema = z.object({ deleted: z.string() });

/** Shorthand for an entry of `errors`. */
export const err = (status: number, code: string, description: string): ErrorDoc => ({
  status,
  code,
  description,
});

/** The statuses `404`/`409`/… without an `error.code` of their own carry the code of their status. */
export const notFound = (what: string): ErrorDoc => err(404, "not_found", `${what} does not exist`);
