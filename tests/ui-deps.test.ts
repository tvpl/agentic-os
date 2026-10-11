/**
 * The dependencies of the primitives (.specs/features/primitivas, C1 and C2):
 * six Radix packages, at exact versions, and the closure they bring into the
 * lockfile is made of licences the product can ship under (the list printed
 * here is what the NOTICE of the distribution feature starts from).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const PINNED: Record<string, string> = {
  "@radix-ui/react-dialog": "1.1.23",
  "@radix-ui/react-dropdown-menu": "2.1.24",
  "@radix-ui/react-popover": "1.1.23",
  "@radix-ui/react-switch": "1.3.7",
  "@radix-ui/react-tabs": "1.1.21",
  "@radix-ui/react-tooltip": "1.2.16",
};
const LICENCES = new Set(["MIT", "ISC", "0BSD", "BSD-3-Clause"]);

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dependencies?: Record<string, string>;
}
const json = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, file), "utf8")) as T;
const manifest = () => json<Manifest>("apps/command-centre/package.json");
const lock = () => json<{ packages: Record<string, LockEntry> }>("package-lock.json").packages;

/**
 * The app's dependencies as the feature found them (chore/tlc-spec-lean-skill at 9c82fc1), kept here so the
 * check needs no git history (a shallow clone has none). A feature that adds a dependency adds it here,
 * in the commit that does it: the six below are the only ones this feature brought.
 */
const AT_START: Required<Manifest> = {
  dependencies: {
    "@mordomo/contracts": "0.8.0",
    "@tanstack/react-query": "^5.102.8",
    "@tanstack/react-virtual": "^3.14.10",
    "d3-force": "^3.0.0",
    "lucide-react": "^0.468.0",
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.0",
  },
  devDependencies: {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.6",
    "@types/d3-force": "^3.0.10",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^6.1.1",
    jsdom: "^30.0.1",
    vite: "^8.2.2",
  },
};

/** Everything the six need, by walking `dependencies` through the lockfile (npm hoisted it all to the root). */
function closure(packages: Record<string, LockEntry>): string[] {
  const seen = new Set<string>();
  const queue = Object.keys(PINNED);
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = packages[`node_modules/${name}`];
    if (!entry) throw new Error(`${name} is needed and the lockfile does not have it`);
    queue.push(...Object.keys(entry.dependencies ?? {}));
  }
  return [...seen].sort();
}

describe("C1 the six primitives are pinned", () => {
  it("C1 the six Radix packages are dependencies at exactly these versions, with no range", () => {
    const deps = manifest().dependencies ?? {};
    for (const [name, version] of Object.entries(PINNED)) {
      expect(deps[name], name).toBe(version);
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("C1 no other Radix package is a direct dependency of the app, in either list", () => {
    const m = manifest();
    const radix = [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.devDependencies ?? {})].filter(
      (n) => n.startsWith("@radix-ui/") || n === "radix-ui",
    );
    expect(radix.sort()).toEqual(Object.keys(PINNED).sort());
  });

  it("C1 against the start of the feature, the six are the only dependency added, and none of the others changed", () => {
    const now = manifest();
    for (const list of ["dependencies", "devDependencies"] as const) {
      const before = AT_START[list];
      const after = now[list] ?? {};
      const added = Object.keys(after).filter((name) => !(name in before));
      expect(added.sort(), `${list} added`).toEqual(
        list === "dependencies" ? Object.keys(PINNED).sort() : [],
      );
      expect(
        Object.keys(before).filter((name) => after[name] !== before[name]),
        `${list} changed or removed`,
      ).toEqual([]);
    }
  });
});

describe("C2 the lockfile and the licences", () => {
  it("C2 the lockfile holds the six at the pinned version, with where they came from and their integrity", () => {
    const packages = lock();
    for (const [name, version] of Object.entries(PINNED)) {
      const entry = packages[`node_modules/${name}`];
      expect(entry?.version, name).toBe(version);
      expect(entry?.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry?.integrity, name).toMatch(/^sha512-/);
    }
    // The workspace's own entry asks for the same versions (what `npm ci` checks).
    const own =
      (packages["apps/command-centre"] as { dependencies?: Record<string, string> }).dependencies ?? {};
    for (const [name, version] of Object.entries(PINNED)) expect(own[name], name).toBe(version);
  });

  it("C2 everything the six pull in has a licence the product can ship under", () => {
    const packages = lock();
    const all = closure(packages);
    expect(all.length).toBeGreaterThan(30);
    const rows = all.map((name) => ({
      name,
      version: packages[`node_modules/${name}`]!.version,
      licence: packages[`node_modules/${name}`]!.license,
    }));
    // For the NOTICE of the distribution feature: name, version, licence.
    console.info(
      `NOTICE input (${rows.length} packages):\n${rows.map((r) => `${r.name}@${r.version} ${r.licence}`).join("\n")}`,
    );
    expect(rows.filter((r) => !r.licence || !LICENCES.has(r.licence))).toEqual([]);
    // The reader sees a package whose licence is not on the list.
    expect(LICENCES.has("GPL-3.0")).toBe(false);
  });
});
