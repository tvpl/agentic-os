import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditConflictError, PathAccessError } from "../core/src/errors.js";
import type * as safeFs from "../core/src/security/safeFs.js";
import { homeReadScope } from "../core/src/security/safeFs.js";
import { moveWorkspaceFile } from "../core/src/security/safeWrite.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch B, door 1: `moveWorkspaceFile` at its own layer (checks.md, Test policy
 * row 2), one asserted case per path of the move: the same device, each refusal, another device. The test's own eyes
 * on the disk are `fs`.
 */

// The opener stays the real one; one case swaps the file right after it opened (C39).
const hooks = vi.hoisted(() => ({ afterOpen: null as null | ((candidate: string) => void) }));
vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return {
    ...actual,
    openWorkspaceFile: (scope: safeFs.ReadScope, candidate: string) => {
      const file = actual.openWorkspaceFile(scope, candidate);
      const hook = hooks.afterOpen;
      if (hook) {
        hooks.afterOpen = null;
        hook(candidate);
      }
      return file;
    },
  };
});

let home: string;
let base: string;
let seq = 0;
const hex = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const scope = () => homeReadScope(home, [path.join(home, "memory")]);
/** A fresh folder under memory/ for one case. */
const caseDir = (name: string) => {
  const dir = path.join(home, "memory", "notes", `${name}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
/** Every name under a folder with its bytes (a link as its target text), to show nothing moved. */
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        out[rel] = "dir";
        walk(full);
      } else out[rel] = hex(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
};

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cleanup-move-")));
  home = path.join(base, "home");
  fs.mkdirSync(path.join(home, "memory", "notes"), { recursive: true });
  fs.mkdirSync(path.join(home, "config"), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  hooks.afterOpen = null;
});
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("door 1 moveWorkspaceFile", () => {
  it("C38 on one device the file is renamed: to holds the original bytes and inode, from is gone, missing folders of to are made", () => {
    const dir = caseDir("c38");
    const from = put(path.join(dir, "a.md"), "# A\nconteudo original\n");
    const inode = fs.statSync(from).ino;
    const to = path.join(home, "memory", "archive", "2026-10-30-abcd1234", "notes", "fundo", "a.md");
    expect(fs.existsSync(path.dirname(to))).toBe(false);
    const rename = vi.spyOn(fs, "renameSync");
    const moved = moveWorkspaceFile(scope(), from, to, { expectSha256: hex("# A\nconteudo original\n") });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(moved.how).toBe("rename");
    expect(fs.readFileSync(to, "utf8")).toBe("# A\nconteudo original\n");
    expect(fs.statSync(to).ino).toBe(inode);
    expect(fs.existsSync(from)).toBe(false);
  });

  it("C39 refuses a link as from, a link on the way to to, an existing to (a dangling link too) and other bytes than expectSha256 (a file swapped after open too), leaving both sides as they were", () => {
    const text = "# B\nbytes vistos\n";
    const cases: Array<{
      name: string;
      setup: (dir: string) => { from: string; to: string; expect?: string };
      refused: (e: unknown) => boolean;
    }> = [
      {
        name: "a link as from",
        setup: (dir) => {
          const real = put(path.join(dir, "real.md"), text);
          const from = path.join(dir, "elo.md");
          fs.symlinkSync(real, from);
          return { from, to: path.join(dir, "destino", "elo.md") };
        },
        refused: (e) => e instanceof PathAccessError,
      },
      {
        name: "a link on the way to to",
        setup: (dir) => {
          const from = put(path.join(dir, "b.md"), text);
          const elsewhere = path.join(dir, "outra");
          fs.mkdirSync(elsewhere);
          fs.symlinkSync(elsewhere, path.join(dir, "atalho"));
          return { from, to: path.join(dir, "atalho", "b.md") };
        },
        refused: (e) => e instanceof PathAccessError,
      },
      {
        name: "an existing to",
        setup: (dir) => {
          const from = put(path.join(dir, "b.md"), text);
          const to = put(path.join(dir, "ja", "b.md"), "outro\n");
          return { from, to };
        },
        refused: (e) => (e as NodeJS.ErrnoException).code === "EEXIST",
      },
      {
        name: "a dangling link as to",
        setup: (dir) => {
          const from = put(path.join(dir, "b.md"), text);
          const to = path.join(dir, "pendente.md");
          fs.symlinkSync(path.join(dir, "nada.md"), to);
          return { from, to };
        },
        refused: (e) => (e as NodeJS.ErrnoException).code === "EEXIST",
      },
      {
        name: "other bytes than expectSha256",
        setup: (dir) => {
          const from = put(path.join(dir, "b.md"), `${text}mudou\n`);
          return { from, to: path.join(dir, "destino", "b.md") };
        },
        refused: (e) => e instanceof EditConflictError,
      },
      {
        name: "a file swapped after open",
        setup: (dir) => {
          const from = put(path.join(dir, "b.md"), text);
          const other = put(path.join(dir, "troca.md"), "trocado\n");
          hooks.afterOpen = (candidate) => {
            if (candidate === from) fs.renameSync(other, from);
          };
          return { from, to: path.join(dir, "destino", "b.md") };
        },
        refused: (e) => e instanceof EditConflictError,
      },
    ];
    for (const c of cases) {
      const dir = caseDir("c39");
      const { from, to } = c.setup(dir);
      const before = snapshot(dir);
      let error: unknown = null;
      try {
        moveWorkspaceFile(scope(), from, to, { expectSha256: hex(text) });
      } catch (e) {
        error = e;
      }
      expect(error, c.name).not.toBeNull();
      expect(c.refused(error), `${c.name}: ${String(error)}`).toBe(true);
      // the swap case changed the folder itself before the move was asked; nothing after that
      if (c.name === "a file swapped after open") {
        expect(fs.readFileSync(from, "utf8")).toBe("trocado\n");
        expect(fs.existsSync(to), c.name).toBe(false);
      } else expect(snapshot(dir), c.name).toEqual(before);
    }
  });

  it("C40 on EXDEV the copy is written by writeWorkspaceFile in create mode, its hash checked, and only then from removed; a copy whose hash differs never removes from and leaves no copy at to", async () => {
    const realRename = fs.renameSync.bind(fs);
    const exdev = () =>
      vi.spyOn(fs, "renameSync").mockImplementation(((a: fs.PathLike, b: fs.PathLike) => {
        if (String(a).includes(`${path.sep}c40-`))
          throw Object.assign(new Error("EXDEV: cross-device link"), { code: "EXDEV" });
        return realRename(a, b);
      }) as typeof fs.renameSync);

    // a confirmed copy: create mode (O_EXCL), the copy read back, then the one unlink of from
    const dir = caseDir("c40");
    const text = "# C\ncopia entre dispositivos\n";
    const from = put(path.join(dir, "c.md"), text);
    const to = path.join(dir, "destino", "c.md");
    exdev();
    const order: string[] = [];
    const open = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, flags: number, mode?: number) => {
      if (String(p) === to && typeof flags === "number" && flags & fs.constants.O_EXCL) order.push("create");
      return open(p, flags as never, mode);
    }) as typeof fs.openSync);
    const unlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
      order.push(`unlink ${String(p) === from ? "from" : String(p)}`);
      return unlink(p);
    }) as typeof fs.unlinkSync);
    const moved = moveWorkspaceFile(scope(), from, to, { expectSha256: hex(text) });
    expect(moved.how).toBe("copy");
    expect(order).toEqual(["create", "unlink from"]);
    expect(fs.readFileSync(to, "utf8")).toBe(text);
    expect(fs.existsSync(from)).toBe(false);
    vi.restoreAllMocks();

    // a copy whose bytes differ from the origin's: from stays, to holds nothing
    const dir2 = caseDir("c40");
    const from2 = put(path.join(dir2, "d.md"), text);
    const to2 = path.join(dir2, "destino", "d.md");
    exdev();
    const write = fs.writeSync.bind(fs);
    vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, buffer: Uint8Array, ...rest: unknown[]) => {
      const bad = Buffer.from(buffer);
      bad[0] = bad[0]! ^ 0xff;
      return (write as (...a: unknown[]) => number)(fd, bad, ...rest);
    }) as typeof fs.writeSync);
    const unlinked: string[] = [];
    const unlink2 = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
      unlinked.push(String(p));
      return unlink2(p);
    }) as typeof fs.unlinkSync);
    expect(() => moveWorkspaceFile(scope(), from2, to2, { expectSha256: hex(text) })).toThrow(
      EditConflictError,
    );
    expect(unlinked).not.toContain(from2);
    expect(fs.readFileSync(from2, "utf8")).toBe(text);
    expect(fs.existsSync(to2)).toBe(false);
  });
});
