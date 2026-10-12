import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/**
 * The documents say what the product is (.specs/features/limpeza-legado, C29 to C33, C35, C39): the README and the
 * guides name the two interfaces and the licence, list the commands the CLI has, link only to what exists, name
 * only scripts that exist; the internal papers are in their own folder and the installer does not carry `docs/`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

/** The README and the guides of the product: `docs/*.md`, not the history in `docs/internal/`. */
const PRODUCT_DOCS = [
  "README.md",
  ...fs
    .readdirSync(path.join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

describe("C29 the README describes the product that exists", () => {
  it("C29 it names the two interfaces and the licence", () => {
    const readme = read("README.md");
    expect(readme).toContain("app frame");
    expect(readme).toContain("Núcleo");
    expect(readme).toContain("FSL-1.1-ALv2");
    expect(readme).toContain("Settings › Theme › Interface");
  });

  const STALE = ["drag-and-drop widgets", "snap to a grid", "Back to the OS", "Ctrl/⌘ M"];
  it.each(STALE)("C29 no README or guide says %s (the desktop of September, which is gone)", (phrase) => {
    for (const file of PRODUCT_DOCS)
      expect(read(file).toLowerCase(), file).not.toContain(phrase.toLowerCase());
  });

  it("C29 the Portuguese quick guide and the user manual name the two interfaces too", () => {
    expect(read("docs/README.pt-BR.md")).toContain("moldura de app");
    expect(read("docs/README.pt-BR.md")).toContain("Núcleo");
    expect(read("docs/user-manual.md")).toContain("app frame");
    expect(read("docs/user-manual.md")).toContain("Núcleo");
  });
});

/** The `COMMANDS` the CLI registers, read off its syntax tree. */
function cliCommands(): string[] {
  const sf = ts.createSourceFile("cli.ts", read("apps/api/src/cli.ts"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === "COMMANDS" &&
      n.initializer &&
      ts.isAsExpression(n.initializer) &&
      ts.isArrayLiteralExpression(n.initializer.expression)
    )
      for (const e of n.initializer.expression.elements) if (ts.isStringLiteral(e)) found.push(e.text);
    n.forEachChild(visit);
  };
  visit(sf);
  return found;
}

/** The commands the README's table lists: the first word after `mordomo` of each code span in the first column. */
function readmeCommands(readme: string): string[] {
  const start = readme.indexOf("\n## Commands");
  const end = readme.indexOf("\n## ", start + 5);
  const out = new Set<string>();
  for (const line of readme.slice(start, end).split("\n")) {
    if (!line.startsWith("| `")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const span of firstCell.matchAll(/`([^`]+)`/g)) {
      const words = span[1]!.trim().split(/\s+/);
      out.add(words[0] === "mordomo" ? words[1]! : words[0]!);
    }
  }
  return [...out];
}

describe("C30 the commands of the README are the commands of the CLI", () => {
  it("C30 the README lists exactly the commands the CLI registers, but help", () => {
    const registered = cliCommands();
    expect(registered.length).toBeGreaterThan(15);
    expect(registered).toContain("help");
    expect(readmeCommands(read("README.md")).sort()).toEqual(registered.filter((c) => c !== "help").sort());
  });

  it("C30 the reader of the table takes a code span with the prefix, one without, and ignores a cell with none", () => {
    const table = [
      "## Commands",
      "| a | b |",
      "| `mordomo start` / `stop` / `status` | x |",
      "| `mordomo skills publish` / `mordomo skills key` | y |",
      "| plain | z |",
      "## Next",
    ].join("\n");
    expect(readmeCommands(`\n${table}`).sort()).toEqual(["skills", "start", "status", "stop"]);
  });
});

const slugOf = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

/** The relative targets of a Markdown text: `](target)`, with the anchor split off. */
function linksOf(text: string): Array<{ file: string; anchor: string }> {
  const noCode = text.replace(/```[\s\S]*?```/g, "");
  const out: Array<{ file: string; anchor: string }> = [];
  for (const m of noCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]!;
    if (/^(https?:|mailto:)/i.test(target)) continue;
    const [file = "", anchor = ""] = target.split("#");
    out.push({ file: decodeURIComponent(file), anchor });
  }
  return out;
}

describe("C31 the links and the scripts of the README and the guides", () => {
  it("C31 every relative link points to a file that exists, and every anchor to a heading of it", () => {
    const broken: string[] = [];
    for (const doc of PRODUCT_DOCS) {
      const dir = path.dirname(doc);
      for (const { file, anchor } of linksOf(read(doc))) {
        const target = file === "" ? doc : path.join(dir, file).split(path.sep).join("/");
        if (!exists(target)) {
          broken.push(`${doc}: ${file}`);
          continue;
        }
        if (anchor && target.endsWith(".md")) {
          const slugs = [...read(target).matchAll(/^#{1,6}\s+(.+)$/gm)].map((h) => slugOf(h[1]!));
          if (!slugs.includes(anchor)) broken.push(`${doc}: ${file}#${anchor}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("C31 the reader finds a broken file, a broken anchor, and passes an address and a mail link", () => {
    const text =
      '[a](docs/x.md) [b](#top) [c](https://example.com) [d](mailto:a@b.c) [e](docs/y.md#sec "t")\n```\n[no](nope)\n```';
    expect(linksOf(text)).toEqual([
      { file: "docs/x.md", anchor: "" },
      { file: "", anchor: "top" },
      { file: "docs/y.md", anchor: "sec" },
    ]);
    expect(slugOf("Building a distributable")).toBe("building-a-distributable");
    expect(slugOf("5.1 The `Console` (talk)")).toBe("51-the-console-talk");
  });

  it("C31 every `npm run <script>` they name is a script of the package.json it runs in", () => {
    const rootScripts = Object.keys(
      (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
    );
    const workspaceScripts = new Set<string>();
    for (const ws of ["apps/command-centre", "apps/api", "core", "contracts"]) {
      if (!exists(`${ws}/package.json`)) continue;
      for (const s of Object.keys(
        (JSON.parse(read(`${ws}/package.json`)) as { scripts?: Record<string, string> }).scripts ?? {},
      ))
        workspaceScripts.add(s);
    }
    const unknown: string[] = [];
    for (const doc of PRODUCT_DOCS)
      for (const line of read(doc).split("\n"))
        for (const m of line.matchAll(/npm run ([\w:-]+)([^\n`]*)/g)) {
          const inWorkspace = /\s(-w|--workspace)[\s=]/.test(m[2]!);
          const ok = inWorkspace ? workspaceScripts.has(m[1]!) : rootScripts.includes(m[1]!);
          if (!ok) unknown.push(`${doc}: npm run ${m[1]}`);
        }
    expect(unknown).toEqual([]);
  });
});

/** The papers that are history, not documentation (design.md, door 5). */
const INTERNAL = [
  "analysis-2026-09",
  "audit-2026-09",
  "plan-2026-09",
  "execution-2026-09-06",
  "review-2026-09-06",
  "plans",
  "analise-engine-ui-2026-09-12.md",
  "validation-report.md",
];

describe("C32 the internal papers have a folder of their own", () => {
  it.each(INTERNAL)("C32 %s lives in docs/internal, not in docs/", (name) => {
    expect(exists(`docs/internal/${name}`), `docs/internal/${name}`).toBe(true);
    expect(exists(`docs/${name}`), `docs/${name}`).toBe(false);
  });

  it("C32 docs/internal/README.md gives the old path and the new one of each, and says what the folder is not", () => {
    const readme = read("docs/internal/README.md");
    for (const name of INTERNAL) {
      expect(readme, name).toContain(`\`docs/${name}${name.includes(".") ? "" : "/"}\``);
      expect(readme, name).toContain(name);
    }
    expect(readme).toContain("not documentation of the product");
  });

  it("C32 the repository README links the folder from one line, the one that calls it the project history", () => {
    const lines = read("README.md")
      .split("\n")
      .filter((l) => l.includes("docs/internal"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Project history");
    for (const file of PRODUCT_DOCS.filter((f) => f !== "README.md"))
      expect(read(file), file).not.toContain("docs/internal");
  });

  it("C32 nothing the product ships cites the old paths of the moved papers", () => {
    const stale = INTERNAL.map((n) => `docs/${n}`);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (
            ![
              "node_modules",
              "dist",
              "build",
              ".git",
              ".specs",
              "internal",
              "test-results",
              "coverage",
            ].includes(entry.name)
          )
            walk(rel);
        } else if (
          /\.(ts|tsx|mjs|md|json|ya?ml)$/.test(entry.name) &&
          !/CHANGELOG|package-lock/.test(entry.name)
        ) {
          const text = read(rel);
          for (const s of stale)
            if (
              new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text) &&
              rel !== "tests/docs.drift.test.ts"
            )
              offenders.push(`${rel}: ${s}`);
        }
      }
    };
    for (const top of [
      "README.md",
      "docs",
      "apps",
      "core",
      "contracts",
      "adapters",
      "scripts",
      "tests",
      "legal",
      "skills",
      "routines",
      "connectors",
    ])
      if (fs.statSync(path.join(root, top)).isDirectory()) walk(top);
      else if (read(top).includes("docs/"))
        for (const s of stale) if (read(top).includes(s)) offenders.push(`${top}: ${s}`);
    expect(offenders).toEqual([]);
  });
});

describe("C33 the installer does not carry the documents", () => {
  const WALK_SKIP = new Set(["node_modules"]);
  const filesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (WALK_SKIP.has(e.name)) return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? [p, ...filesUnder(p)] : [p];
    });

  it("C33 scripts/package.mjs and scripts/legal-stage.mjs never name the docs folder as something to copy", () => {
    for (const file of ["scripts/package.mjs", "scripts/legal-stage.mjs"]) {
      const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const named: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isStringLiteralLike(n) && /(^|[\\/])docs([\\/]|$)/.test(n.text)) named.push(n.text);
        n.forEachChild(visit);
      };
      visit(sf);
      expect(named, file).toEqual([]);
    }
  });

  it("C33 what stageLegal puts in the payload has no docs folder, and the notices cite no internal paper", async () => {
    const { stageLegal } = (await import(
      pathToFileURL(path.join(root, "scripts", "legal-stage.mjs")).href
    )) as {
      stageLegal: (root: string, payload: string) => void;
    };
    const payload = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-payload-"));
    try {
      stageLegal(root, payload);
      const all = filesUnder(payload).map((p) => path.relative(payload, p).split(path.sep).join("/"));
      expect(all.length).toBeGreaterThan(5);
      expect(all.filter((p) => /(^|\/)docs(\/|$)/.test(p))).toEqual([]);
      for (const file of ["legal/THIRD_PARTY_NOTICES.md", "legal/sbom.cdx.json"])
        expect(fs.readFileSync(path.join(payload, file), "utf8"), file).not.toContain("docs/internal");
    } finally {
      fs.rmSync(payload, { recursive: true, force: true });
    }
  });
});

describe("C35 the changelog", () => {
  it("C35 Unreleased has the entry of the cleanup, with what went and what stayed", () => {
    const changelog = read("CHANGELOG.md");
    const unreleased = changelog.slice(
      changelog.indexOf("## Unreleased"),
      changelog.indexOf("\n## ", changelog.indexOf("## Unreleased") + 5),
    );
    const entry = unreleased.slice(unreleased.indexOf("Legacy cleanup"));
    expect(unreleased).toContain("Legacy cleanup (limpeza-legado)");
    expect(entry).toMatch(/removed/i);
    expect(entry).toMatch(/kept|stays|stay/i);
  });
});

describe("C39 the inventory of design.md is true", () => {
  const design = read(".specs/features/limpeza-legado/design.md");
  /** The first column of the table under a `###` heading, as backticked path-like tokens. */
  const pathsUnder = (heading: string): string[] => {
    const start = design.indexOf(`### ${heading}`);
    expect(start, heading).toBeGreaterThan(0);
    const end = design.indexOf("\n### ", start + 5);
    const body = design.slice(start, end === -1 ? undefined : end);
    const out: string[] = [];
    for (const line of body.split("\n")) {
      if (!line.startsWith("| `")) continue;
      const cell = line.split("|")[1] ?? "";
      for (const m of cell.matchAll(/`([^`]+)`/g))
        if (/^[\w./@-]+(\*)?$/.test(m[1]!) && /[./]/.test(m[1]!)) out.push(m[1]!);
    }
    return out;
  };
  /** A path of the table: under the interface's `src` or from the repository root; a trailing `*` is a prefix. */
  const here = (p: string) =>
    [`apps/command-centre/src/${p}`, p].some((rel) => {
      if (!rel.endsWith("*")) return exists(rel);
      const dir = path.dirname(rel);
      return (
        exists(dir) &&
        fs.readdirSync(path.join(root, dir)).some((f) => `${dir}/${f}`.startsWith(rel.slice(0, -1)))
      );
    });

  it("C39 every path of Mantido and of the closed list exists", () => {
    const kept = [
      ...pathsUnder("Mantido, com a prova de que é alcançável"),
      ...pathsUnder("Lista fechada: arquivos de produção que nenhuma entrada alcança (AC 1)"),
    ];
    expect(kept.length).toBeGreaterThan(15);
    expect(kept.filter((p) => !here(p))).toEqual([]);
  });

  it("C39 every file of Sai is gone", () => {
    const gone = pathsUnder("Sai, com a prova de que não é alcançável").filter((p) =>
      /\.(tsx?|css|md|json)$/.test(p),
    );
    expect(gone.length).toBeGreaterThan(3);
    expect(gone.filter((p) => here(p))).toEqual([]);
  });
});
