import { z } from "zod";

/**
 * Strict identifier for every `:id` / `:slug` / `:name` route parameter.
 * No path separators, no `..`, bounded length — so `path.join(dir, id)` can
 * never leave `dir` even if a store forgets to check (defense in depth with
 * the stores' own validation).
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
