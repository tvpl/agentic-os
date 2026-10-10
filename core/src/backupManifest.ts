import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_FILE_MODE } from "./paths.js";

/**
 * The manifest of a backup: the SHA-256 and size of every file in it and the target of every link, written at its
 * root as `manifest.json` when the backup is made, so that a restore can tell a backup that is whole from one that
 * a full disk truncated, a hand edit changed or a stray tool added to.
 *
 * It detects damage and accidental edits. Whoever can rewrite the files in `config/backups/` can rewrite the
 * manifest as well; a signature would need a key outside the home (feature `distribuicao`).
 */

export const MANIFEST_NAME = "manifest.json";

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}
export interface ManifestLink {
  path: string;
  target: string;
}
export interface BackupManifest {
  version: 1;
  algorithm: "sha256";
  createdAt: number;
  files: ManifestFile[];
  links: ManifestLink[];
}

export type ProblemKind = "checksum" | "size" | "missing" | "unexpected" | "link";
export interface BackupProblem {
  /** Path inside the backup, with `/`. */
  path: string;
  kind: ProblemKind;
}

/**
 * Where a part of the backup is, for the check: `rel` is its path inside the backup, `actual` the file or folder
 * that holds it now (a staged copy, or the backup itself), `null` when there is none.
 */
export interface Mount {
  rel: string;
  actual: string | null;
}

/** The manifest of `root`, `"absent"` when there is none, `"invalid"` when it is not a manifest. */
export function readManifest(root: string): BackupManifest | "absent" | "invalid" {
  const file = path.join(root, MANIFEST_NAME);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "invalid";
  }
  try {
    const raw = JSON.parse(text) as Partial<BackupManifest> | null;
    if (
      raw === null ||
      raw.version !== 1 ||
      raw.algorithm !== "sha256" ||
      typeof raw.createdAt !== "number" ||
      !Array.isArray(raw.files) ||
      !Array.isArray(raw.links) ||
      !raw.files.every(
        (f) => typeof f?.path === "string" && Number.isInteger(f.size) && /^[0-9a-f]{64}$/.test(f.sha256),
      ) ||
      !raw.links.every((l) => typeof l?.path === "string" && typeof l.target === "string")
    ) {
      return "invalid";
    }
    return raw as BackupManifest;
  } catch {
    return "invalid";
  }
}

export function writeManifest(root: string, manifest: BackupManifest): void {
  fs.writeFileSync(path.join(root, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n", {
    mode: PRIVATE_FILE_MODE,
  });
}

/** Size and SHA-256 of a file, read in 1 MiB pieces. */
export function hashFile(file: string): { size: number; sha256: string } {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let size = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      size += read;
    }
    return { size, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}

type Entry = { kind: "file" } | { kind: "link"; target: string };

/** Every file and link under `dir`, by path relative to it (folders hold nothing of their own). */
function listTree(dir: string, prefix = ""): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const walk = (current: string, rel: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const name = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) out.set(name, { kind: "link", target: fs.readlinkSync(full) });
      else if (entry.isDirectory()) walk(full, name);
      else if (entry.isFile()) out.set(name, { kind: "file" });
    }
  };
  walk(dir, prefix);
  return out;
}

/** `root`'s contents as a manifest. A generator so a caller can yield to its event loop between files. */
function* manifestSteps(root: string): Generator<void, BackupManifest> {
  const files: ManifestFile[] = [];
  const links: ManifestLink[] = [];
  for (const [rel, entry] of [...listTree(root)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (rel === MANIFEST_NAME) continue;
    if (entry.kind === "link") links.push({ path: rel, target: entry.target });
    else {
      files.push({ path: rel, ...hashFile(path.join(root, ...rel.split("/"))) });
      yield;
    }
  }
  return { version: 1, algorithm: "sha256", createdAt: Date.now(), files, links };
}

function drain<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

async function drainAsync<T>(steps: Generator<void, T>): Promise<T> {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function buildManifest(root: string): BackupManifest {
  return drain(manifestSteps(root));
}
export function buildManifestAsync(root: string): Promise<BackupManifest> {
  return drainAsync(manifestSteps(root));
}

const under = (rel: string, mountRel: string): boolean => rel === mountRel || rel.startsWith(`${mountRel}/`);

/**
 * Compare what each mount holds with what the manifest lists under it. A part of the manifest that no mount
 * covers is not part of the restore and is not judged. Every difference is a problem:
 *  - `missing`    listed, and not there (or the mount has no copy at all)
 *  - `unexpected` there, and not listed
 *  - `size`       a different length (not hashed: it cannot match)
 *  - `checksum`   same length, different SHA-256
 *  - `link`       a link where a file was listed or the other way round, or a link to somewhere else
 */
function* problemSteps(manifest: BackupManifest, mounts: readonly Mount[]): Generator<void, BackupProblem[]> {
  const problems: BackupProblem[] = [];
  const expectedFiles = new Map(manifest.files.map((f) => [f.path, f]));
  const expectedLinks = new Map(manifest.links.map((l) => [l.path, l]));
  for (const mount of mounts) {
    const actual = new Map<string, Entry>();
    let base: string | null = null;
    let isFolder = false;
    if (mount.actual !== null) {
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(mount.actual);
        base = mount.actual;
      } catch {
        /* nothing there: every listed file under the mount is missing */
      }
      if (stat?.isSymbolicLink())
        actual.set(mount.rel, { kind: "link", target: fs.readlinkSync(mount.actual) });
      else if (stat?.isDirectory()) {
        isFolder = true;
        for (const [rel, entry] of listTree(mount.actual, mount.rel)) actual.set(rel, entry);
      } else if (stat?.isFile()) actual.set(mount.rel, { kind: "file" });
    }
    const here = (rel: string) => under(rel, mount.rel);
    for (const file of manifest.files.filter((f) => here(f.path))) {
      const found = actual.get(file.path);
      if (found === undefined || base === null) problems.push({ path: file.path, kind: "missing" });
      else if (found.kind === "link") problems.push({ path: file.path, kind: "link" });
      else {
        const full = isFolder ? path.join(base, ...file.path.slice(mount.rel.length + 1).split("/")) : base;
        const { size, sha256 } = hashFile(full);
        if (size !== file.size) problems.push({ path: file.path, kind: "size" });
        else if (sha256 !== file.sha256) problems.push({ path: file.path, kind: "checksum" });
        yield;
      }
    }
    for (const link of manifest.links.filter((l) => here(l.path))) {
      const found = actual.get(link.path);
      if (found === undefined) problems.push({ path: link.path, kind: "missing" });
      else if (found.kind !== "link" || found.target !== link.target)
        problems.push({ path: link.path, kind: "link" });
    }
    for (const [rel, entry] of actual) {
      const listed = entry.kind === "file" ? expectedFiles.has(rel) : expectedLinks.has(rel);
      const listedOther = entry.kind === "file" ? expectedLinks.has(rel) : expectedFiles.has(rel);
      if (!listed && !listedOther) problems.push({ path: rel, kind: "unexpected" });
    }
  }
  return problems;
}

export function verifyMounts(manifest: BackupManifest, mounts: readonly Mount[]): BackupProblem[] {
  return drain(problemSteps(manifest, mounts));
}
export function verifyMountsAsync(
  manifest: BackupManifest,
  mounts: readonly Mount[],
): Promise<BackupProblem[]> {
  return drainAsync(problemSteps(manifest, mounts));
}
