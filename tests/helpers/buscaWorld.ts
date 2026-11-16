import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppContext } from "../../apps/api/src/context.js";
import { makeTempHome } from "../helpers.js";
import { memoriaWorld, type MemoriaWorld } from "./memoriaWorld.js";

export { code, type Json } from "./memoriaWorld.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

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

/** The Portuguese evaluation corpus of S1 (G10): 40 notes, indexed as a folder, and its 60 questions. */
export const PT_CORPUS = path.join(repoRoot, "tests", "fixtures", "pt-corpus");
export const PT_QUERIES = path.join(repoRoot, "tests", "fixtures", "pt-queries.json");

/** Every copied note's modification time: fixed, so the recall's tie by date is the same on every run. */
const FIXED_MTIME = new Date("2026-11-16T10:00:00");

export interface CorpusHome {
  ctx: AppContext;
  home: string;
  /** The indexed folder outside the home that holds the notes. */
  folder: string;
  /** Close the context (a spawned CLI then opens the home alone); `cleanup` also removes the folders. */
  close: () => void;
  cleanup: () => void;
}

/**
 * A home whose one indexed folder holds these notes (by default a copy of the corpus), indexed with the `hash` provider
 * or with the semantic search off. The engine of the home stays open until `close`.
 */
export async function corpusHome(
  embeddings: "hash" | "off",
  notes?: Record<string, string>,
): Promise<CorpusHome> {
  const temp = makeTempHome("mordomo-busca-eval-");
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-busca-corpus-")));
  const files =
    notes ??
    Object.fromEntries(
      fs
        .readdirSync(PT_CORPUS)
        .sort()
        .map((name) => [name, fs.readFileSync(path.join(PT_CORPUS, name), "utf8")]),
    );
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(folder, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, FIXED_MTIME, FIXED_MTIME);
  }
  const ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.indexedFolders = [{ path: folder, area: null, enabled: true }];
  settings.memory.embeddings = {
    ...settings.memory.embeddings,
    enabled: embeddings === "hash",
    provider: "hash",
  };
  ctx.settingsStore.save(settings);
  await ctx.indexer.indexAllAsync();
  let open = true;
  const close = () => {
    if (open) ctx.close();
    open = false;
  };
  return {
    ctx,
    home: temp.paths.home,
    folder,
    close,
    cleanup: () => {
      close();
      temp.cleanup();
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
