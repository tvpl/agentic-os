import fs from "node:fs";
import path from "node:path";

/** Dependency-free `which`: locate an executable on PATH. */
export function findOnPath(name: string): string | null {
  const pathVar = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Extract `--flag` tokens from a CLI's --help output for capability probing. */
export function parseHelpFlags(helpText: string): string[] {
  const flags = new Set<string>();
  for (const match of helpText.matchAll(/(?:^|\s)(--[a-z][a-z0-9-]+)/gim)) {
    flags.add(match[1]!.toLowerCase());
  }
  return [...flags].sort();
}
