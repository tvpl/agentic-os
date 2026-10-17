import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Atomic write: write to a temp file in the same dir, then rename over.
 *
 * The temporary name is random and created exclusively (`wx`: `O_EXCL`, which does not follow a link either), so a
 * link planted at a guessed name in a folder an agent can write to (`routines/`, `connectors/`) fails the write
 * instead of being written through. The final `rename` replaces the NAME `filePath`, a link there included, and
 * never follows it.
 */
export function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o666); // throws before creating anything when the name is taken
  try {
    try {
      fs.writeFileSync(fd, content, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true }); // a failed write must not leave its temporary file behind
    throw err;
  }
}
