/**
 * The pieces of a work context (.specs/features/cerebro-contextos, door 1) that the settings and the route table share.
 * Not exported from the package root: only `CONTEXT_ID`, `CONTEXT_LIMITS` and the `WorkContext` type are (settings.ts).
 */
import { z } from "zod";

/**
 * A work context (.specs/features/cerebro-contextos, door 1): a named scope the owner defines, one to eight absolute
 * folders (the first is the main one), each an indexed folder, a subfolder of one or a folder of `memory/`. The `id`
 * never changes once made. An entry this version cannot read is dropped and the others are kept (AD-013).
 */
export const CONTEXT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const CONTEXT_LIMITS = { contexts: 50, paths: 8, nameChars: 60 } as const;
/** Absolute on POSIX (`/…`) or on Windows (`C:\…`, `\\server\…`); the contract is read in a browser too, so no `node:path`. */
export const isAbsolutePath = (p: string): boolean => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p);
const contextName = z
  .string()
  .regex(/^[^\r\n]*$/, "a name holds no line break")
  .refine((name) => name.trim().length >= 1, "a name is not empty")
  .refine((name) => name.trim().length <= CONTEXT_LIMITS.nameChars, "a name holds at most 60 characters");
export const WorkContextSchema = z.object({
  id: z
    .string()
    .regex(CONTEXT_ID, "1-40 lowercase letters, digits or dashes, starting with a letter or a digit"),
  name: contextName,
  paths: z
    .array(z.string().min(1).max(4096).refine(isAbsolutePath, "a context path is absolute"))
    .min(1)
    .max(CONTEXT_LIMITS.paths)
    .refine((paths) => new Set(paths).size === paths.length, "a context names a path once"),
});
export type WorkContext = z.infer<typeof WorkContextSchema>;
/** The name rule of a context, for the request bodies of the routes. */
export const ContextNameSchema = contextName;
