import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { defaultSettings, type Settings } from "../core/src/config/schema.js";
import {
  NoteTooLargeError,
  NoteValidationError,
  StructureFixedError,
  createNote,
  folderSegments,
} from "../core/src/memory/notes.js";
import { PathAccessError } from "../core/src/errors.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-vista-notas, batch A, the decisions at their own layer (checks.md, Test policy rows 1 and 2),
 * with no HTTP: a new note's folder and the fixed structure (`folderSegments`, `createNote`). The HTTP side of each
 * claim is in `notesview.create.test.ts`.
 */

const POSIX = process.platform !== "win32";
let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let work: string;
let memory: string;

beforeAll(() => {
  temp = makeTempHome("mordomo-notes-layer-");
  ctx = new AppContext(temp.paths.home);
  memory = temp.paths.memory;
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-work-")));
});
afterAll(() => {
  ctx.close();
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

function settingsWith(change: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  change(s);
  return s;
}
const env = (settings: Settings = settingsWith()) => ({ paths: temp.paths, settings });
function thrown(fn: () => unknown): Error & { code?: string; statusCode?: number } {
  try {
    fn();
  } catch (err) {
    return err as Error & { code?: string; statusCode?: number };
  }
  throw new Error("expected the call to throw");
}

describe("doors 2 and 5 at their own layer: a new note's folder and the fixed structure", () => {
  it.skipIf(!POSIX)(
    "C25 own layer: folderSegments refuses 5 levels, an empty level, .., a level that keeps no letter and an absolute path (400 validation); createNote refuses a link on the way (403) and a content past the limit (413)",
    () => {
      expect(folderSegments("clientes/acme")).toEqual(["clientes", "acme"]);
      expect(folderSegments("Clientes Grandes/ÁCME")).toEqual(["clientes-grandes", "acme"]);
      expect(folderSegments("a/b/c/d")).toEqual(["a", "b", "c", "d"]);
      for (const bad of ["a/b/c/d/e", "a//b", "../x", "..", "!!!", "/etc"]) {
        const err = thrown(() => folderSegments(bad));
        expect(err, bad).toBeInstanceOf(NoteValidationError);
        expect([err.statusCode, err.code], bad).toEqual([400, "validation"]);
      }
      const notes = path.join(memory, "notes");
      fs.mkdirSync(notes, { recursive: true });
      const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-alvo-")));
      try {
        fs.symlinkSync(target, path.join(notes, "c25-link"));
        const link = thrown(() => createNote(env(), { title: "Pelo link", folder: "c25-link/nova" }));
        expect(link).toBeInstanceOf(PathAccessError);
        expect(fs.readdirSync(target)).toEqual([]);
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
      }
      const big = thrown(() =>
        createNote(env(), { title: "Grande", folder: "c25-grande", content: "x".repeat(1024 * 1024 + 1) }),
      );
      expect(big).toBeInstanceOf(NoteTooLargeError);
      expect([big.statusCode, big.code]).toEqual([413, "note_too_large"]);
      expect(fs.existsSync(path.join(notes, "c25-grande"))).toBe(false);
    },
  );

  it("C26 own layer: with fixedStructure on, a new folder, an area without its folder and no folder are StructureFixedError (409 structure_fixed); a folder that exists is written", () => {
    const settings = settingsWith((s) => {
      s.memory.notes.fixedStructure = true;
      s.areas = ["Área C26"];
    });
    const notes = path.join(memory, "notes");
    fs.mkdirSync(path.join(notes, "c26-existe"), { recursive: true });
    for (const [what, input] of [
      ["new folder", { title: "Nova", folder: "c26-nova" }],
      ["area without folder", { title: "Área", area: "Área C26" }],
      ["straight into notes/", { title: "Solta" }],
    ] as const) {
      const err = thrown(() => createNote(env(settings), input));
      expect(err, what).toBeInstanceOf(StructureFixedError);
      expect([err.statusCode, err.code], what).toEqual([409, "structure_fixed"]);
    }
    expect(fs.existsSync(path.join(notes, "c26-nova"))).toBe(false);
    expect(fs.existsSync(path.join(notes, "area-c26"))).toBe(false);
    expect(fs.existsSync(path.join(notes, "solta.md"))).toBe(false);
    const ok = createNote(env(settings), { title: "Dentro", folder: "c26-existe" });
    expect(ok.path).toBe(path.join(notes, "c26-existe", "dentro.md"));
    // off, the same three are written
    const off = settingsWith((s) => {
      s.areas = ["Área C26"];
    });
    expect(createNote(env(off), { title: "Nova", folder: "c26-nova" }).path).toBe(
      path.join(notes, "c26-nova", "nova.md"),
    );
    expect(createNote(env(off), { title: "Solta" }).path).toBe(path.join(notes, "solta.md"));
  });
});
