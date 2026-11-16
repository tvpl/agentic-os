import path from "node:path";
import { memoriaWorld, type MemoriaWorld } from "./memoriaWorld.js";

export { code, type Json } from "./memoriaWorld.js";

/**
 * The world of `.specs/features/cerebro-busca-significado`: the memoria world (a real home, a server over it, owner,
 * device and run headers, `put`, `update`, `index`) plus the notes of `memory/` by name and the search's answer.
 */
export interface BuscaWorld extends MemoriaWorld {
  /** A note `memory/<name>.md` with this text. */
  note: (name: string, text: string) => string;
  /** `GET /api/memory/search` as the owner: the status and the names of the files listed, in order. */
  search: (q: string, mode?: "text" | "semantic" | "auto") => Promise<{ status: number; names: string[] }>;
}

export async function buscaWorld(prefix: string): Promise<BuscaWorld> {
  const base = await memoriaWorld(prefix);
  return Object.assign(base, {
    note: (name: string, text: string) => base.put(path.join(base.memory, `${name}.md`), text),
    async search(q: string, mode: "text" | "semantic" | "auto" = "text") {
      const res = await base.call("GET", `/api/memory/search?q=${encodeURIComponent(q)}&mode=${mode}`);
      const names =
        res.status === 200 ? (res.body as unknown as Array<{ name: string }>).map((h) => h.name) : [];
      return { status: res.status, names };
    },
  });
}
