/**
 * `scripts/package.mjs --payload <dir>` empties <dir> before it writes the payload there. This says whether <dir> is a
 * place it may empty: not the repository, not one of its parents, not the working directory, not the home folder, and
 * not a folder that holds something else. A missing or empty folder, or a payload this script wrote earlier (its
 * `package.json` carries `packagedAt`, beside `lib/mordomo.mjs`), is fine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const inside = (parent, child) =>
  child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Throws an Error saying why `dir` must not be emptied; returns when it may be. */
export function assertEmptiablePayloadDir(dir, { root, cwd = process.cwd(), home = os.homedir() } = {}) {
  const target = path.resolve(dir);
  const refuse = (why) => {
    throw new Error(`refusing to empty ${target}: ${why}`);
  };
  if (target === path.parse(target).root) refuse("it is the root of the file system");
  if (root && inside(target, path.resolve(root))) refuse("it is the repository or one of its parent folders");
  if (inside(target, path.resolve(cwd))) refuse("it is the working directory or one of its parents");
  if (home && inside(target, path.resolve(home))) refuse("it is the home folder or one of its parents");
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return; // missing: nothing to empty
  }
  if (!stat.isDirectory()) refuse("it is not a folder");
  if (fs.readdirSync(target).length === 0) return;
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  } catch {
    // not a payload
  }
  const ours =
    manifest !== null &&
    manifest.name === "mordomo-os" &&
    manifest.private === true &&
    typeof manifest.packagedAt === "string" &&
    fs.existsSync(path.join(target, "lib", "mordomo.mjs"));
  if (!ours)
    refuse(
      "it is not empty and is not a payload this script wrote (no package.json with packagedAt beside lib/mordomo.mjs)",
    );
}
