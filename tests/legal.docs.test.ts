import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The legal texts of .specs/features/licenca-comercial (C1-C6, C18-C22, C28-C32). Every one of those texts is a
 * DRAFT for the owner's legal review: these tests prove that a text exists, agrees with the code and invents no
 * data. They do not prove that a text is legally sufficient.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const text = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const PLACEHOLDER = /\[A PREENCHER PELO DONO: ([^\]]+)\]/g;
/** The draft notice and its three marks, in the first lines of a file. */
const firstLines = (file: string, n = 12) => text(file).split("\n").slice(0, n).join("\n");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---- C1, C2 -----------------------------------------------------------------------------------------------------------

const TEMPLATE_SHA = "36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177";
const VENDORED: Record<string, string> = {
  "legal/vendor/FSL-1.1-ALv2.template.md": TEMPLATE_SHA,
  "legal/vendor/DCO-1.1.txt": "f7ac75b443f4ca16b503241344b41aeff9503b0c30bedc2b119551d83cb0fa90",
  "legal/vendor/fonts/JetBrainsMono-OFL.txt":
    "a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697",
  "legal/vendor/fonts/Rajdhani-OFL.txt": "f62ef357d3a1c3d27edd35a6e1ba350e8a8d13499797964eeadefbf0b3b15d1f",
};
const OWNER_LINE = "[A PREENCHER PELO DONO: titular dos direitos autorais]";

describe("C1 LICENSE is the canonical FSL-1.1-ALv2", () => {
  const template = text("legal/vendor/FSL-1.1-ALv2.template.md");
  const license = text("LICENSE");
  const end = license.indexOf("-->\n\n");
  const body = license.slice(end + 5);

  it("C1 a draft block opens the file, and the rest is the template with the year and the licensor filled", () => {
    expect(license.startsWith("<!--\nMINUTA PARA REVISÃO DO DONO.")).toBe(true);
    expect(end).toBeGreaterThan(0);
    expect(template.split("${year}")).toHaveLength(2);
    expect(template.split("${licensor name}")).toHaveLength(2);
    expect(body).toBe(template.replace("${year}", "2026").replace("${licensor name}", OWNER_LINE));
  });

  it("C1 the terms, from '## Terms and Conditions' to the end, are byte for byte the template's", () => {
    const from = (s: string) => s.slice(s.indexOf("## Terms and Conditions"));
    expect(from(body)).toBe(from(template));
    expect(from(template).length).toBeGreaterThan(3000);
  });

  it("C1 exactly one line differs from the template: the Notice", () => {
    const a = template.split("\n");
    const b = body.split("\n");
    expect(b).toHaveLength(a.length);
    const different = b.filter((line, i) => line !== a[i]);
    expect(different).toEqual([`Copyright 2026 ${OWNER_LINE}`]);
  });

  it("C1 the abbreviation and the future license are the ones the owner chose (AD-007)", () => {
    expect(body).toContain("FSL-1.1-ALv2");
    expect(body).toContain("Apache License, Version 2.0");
    expect(body).toContain("second anniversary");
  });

  it("C1 the old MIT text is gone", () => {
    expect(license).not.toMatch(/MIT License|Permission is hereby granted, free of charge/);
  });
});

describe("C2 the canonical texts are pinned", () => {
  const readme = text("legal/README.md");

  for (const [file, expected] of Object.entries(VENDORED))
    it(`C2 ${file} has the SHA-256 recorded in the test and in legal/README.md`, () => {
      expect(sha256(text(file))).toBe(expected);
      expect(readme).toContain(expected);
    });

  it("C2 changing one letter of the template changes the hash (the pin can fail)", () => {
    const template = text("legal/vendor/FSL-1.1-ALv2.template.md");
    expect(sha256(template.replace("Licensor", "Licensar"))).not.toBe(TEMPLATE_SHA);
  });

  it("C2 the policy points to the font texts that the pins cover", () => {
    const policy = JSON.parse(text("legal/license-policy.json")) as { bundled: Array<{ textFile?: string }> };
    for (const item of policy.bundled)
      if (item.textFile) expect(Object.keys(VENDORED)).toContain(item.textFile);
  });
});

// ---- C3 ---------------------------------------------------------------------------------------------------------------

describe("C3 every package.json says FSL-1.1-ALv2, the abbreviation of the LICENSE", () => {
  const root = JSON.parse(text("package.json")) as { workspaces: string[] };
  const files = ["package.json", ...root.workspaces.map((w) => `${w}/package.json`)];

  it("C3 there are 9 manifests: the root and the 8 workspaces (the 8th is apps/desktop: distribuicao)", () => {
    expect(files).toEqual([
      "package.json",
      "contracts/package.json",
      "core/package.json",
      "adapters/claude/package.json",
      "adapters/cursor/package.json",
      "adapters/codex/package.json",
      "apps/api/package.json",
      "apps/command-centre/package.json",
      "apps/desktop/package.json",
    ]);
  });

  for (const file of files)
    it(`C3 ${file}`, () => {
      expect((JSON.parse(text(file)) as { license?: string }).license).toBe("FSL-1.1-ALv2");
    });

  it("C3 the lockfile says the same for the root and the workspaces, so npm install does not rewrite it", () => {
    const lock = JSON.parse(text("package-lock.json")) as { packages: Record<string, { license?: string }> };
    for (const key of ["", ...root.workspaces])
      expect(lock.packages[key]?.license, key || "root").toBe("FSL-1.1-ALv2");
  });
});

// ---- C4, C29 ----------------------------------------------------------------------------------------------------------

/** The part of a markdown file under a `## ` heading that starts with `name`, up to the next `## `. */
function section(file: string, name: string): string {
  const lines = text(file).split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.slice(3).startsWith(name));
  expect(start, `${file} has a "## ${name}" section`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => l.startsWith("## "));
  return (next < 0 ? rest : rest.slice(0, next)).join("\n");
}
const flat = (s: string) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|[\s(])_|_(?=[\s).,;:]|$)/g, "$1")
    .replace(/\s+/g, " ");

describe("C4 the README license section", () => {
  const license = section("README.md", "License");
  const f = flat(license);

  it("C4 names FSL-1.1-ALv2 and the conversion to Apache-2.0 on the second anniversary", () => {
    expect(f).toContain("Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)");
    expect(f).toContain("Apache License 2.0 on the second anniversary of the date it was released");
  });

  it("C4 says the legal texts are drafts for the owner's review and not legal advice", () => {
    expect(f).toContain("drafts for the owner's legal review, not legal advice");
    expect(f).toContain("[A PREENCHER PELO DONO: …]");
  });

  it("C4 links the license, the EULA, the privacy policy and the third-party notices", () => {
    for (const target of [
      "(LICENSE)",
      "(legal/EULA.md)",
      "(legal/PRIVACY.md)",
      "(legal/THIRD_PARTY_NOTICES.md)",
    ])
      expect(license, target).toContain(target);
    for (const target of ["LICENSE", "legal/EULA.md", "legal/PRIVACY.md", "legal/THIRD_PARTY_NOTICES.md"])
      expect(fs.existsSync(path.join(ROOT, target)), target).toBe(true);
  });

  it("C4 says the product orchestrates the CLIs without bundling them, and has no telemetry", () => {
    expect(f).toContain("orchestrates Claude Code, Cursor Agent and OpenAI Codex CLI");
    expect(f).toContain("does not bundle, redistribute or sublicense them");
    expect(f).toContain("no telemetry");
  });

  it("C4 no line of the section calls the product MIT", () => {
    expect(license).not.toMatch(/\bMIT\b/);
    expect(text("README.md")).not.toMatch(/MIT — see|MIT License|licensed under the MIT/i);
  });
});

describe("C29 the other docs say the same", () => {
  const files = ["README.md", "docs/README.pt-BR.md", "docs/install.md"];

  it("C29 none of the three calls the product MIT", () => {
    for (const file of files) expect(text(file), file).not.toMatch(/\bMIT\b/);
  });

  it("C29 docs/README.pt-BR.md has the license, the CLIs and the links in Portuguese", () => {
    const f = flat(section("docs/README.pt-BR.md", "Licença e termos"));
    expect(f).toContain("Functional Source License 1.1 com licença futura Apache-2.0 (FSL-1.1-ALv2)");
    expect(f).toContain("segunda data de aniversário");
    expect(f).toContain("minutas para revisão do dono, não aconselhamento jurídico");
    expect(f).toContain("não os inclui, não os redistribui nem os sublicencia");
    expect(f).toContain("não tem telemetria");
    for (const target of [
      "../LICENSE",
      "../legal/EULA.md",
      "../legal/PRIVACY.md",
      "../legal/THIRD_PARTY_NOTICES.md",
    ]) {
      expect(f, target).toContain(target.replace("../", ""));
      expect(fs.existsSync(path.join(ROOT, "docs", target)), target).toBe(true);
    }
  });

  it("C29 docs/install.md says what the installer carries and that the CLIs are not bundled or sublicensed", () => {
    const f = flat(section("docs/install.md", "License and terms"));
    expect(f).toContain("Functional Source License 1.1");
    expect(f).toContain("legal/ folder");
    expect(f).toContain("CycloneDX SBOM");
    expect(f).toContain("drafts for the owner's review, not legal advice");
    expect(f).toContain("does not bundle or sublicense them");
    expect(fs.existsSync(path.join(ROOT, "docs", "../LICENSE"))).toBe(true);
  });

  it("C29 the installer's own README.txt says the same in both languages", () => {
    const source = text("scripts/package.mjs");
    expect(source).toContain("License: LICENSE (Functional Source License 1.1, Apache-2.0 future license)");
    expect(source).toContain("Licença: LICENSE (Functional Source License 1.1, licença futura Apache-2.0)");
  });
});

// ---- C5 ---------------------------------------------------------------------------------------------------------------

describe("C5 CONTRIBUTING.md", () => {
  const contributing = text("CONTRIBUTING.md");

  it("C5 carries the DCO 1.1 text, word for word, with its four clauses", () => {
    const dco = text("legal/vendor/DCO-1.1.txt").trim();
    expect(contributing).toContain(dco);
    for (const clause of [
      "(a) The contribution was created",
      "(b) The contribution is based upon",
      "(c) The contribution was provided directly",
      "(d) I understand and agree",
    ])
      expect(dco.replace(/\s+/g, " ")).toContain(clause);
    expect(dco).toMatch(/^Developer Certificate of Origin\nVersion 1\.1/);
  });

  it("C5 requires Signed-off-by on every commit", () => {
    expect(contributing).toContain("Signed-off-by:");
    expect(contributing).toContain("git commit -s");
    expect(flat(contributing)).toContain("em cada commit");
  });

  it("C5 says the contribution enters under FSL-1.1-ALv2 and that there is no CLA", () => {
    const f = flat(contributing);
    expect(f).toContain("entra sob a mesma licença do projeto: FSL-1.1-ALv2");
    expect(f).toContain("Não há CLA");
  });

  it("C5 is a draft and leaves the choice to the owner", () => {
    expect(firstLines("CONTRIBUTING.md")).toContain("MINUTA para revisão do dono");
    expect(contributing).toContain("[A PREENCHER PELO DONO: política de contribuições externas");
  });
});

// ---- C6 ---------------------------------------------------------------------------------------------------------------

describe("C6 the installer carries the legal side", () => {
  it("C6 stageLegal puts LICENSE, legal/ and a valid SBOM in the payload", async () => {
    const { stageLegal } = (await import("../scripts/legal-stage.mjs")) as unknown as {
      stageLegal: (root: string, payload: string) => void;
    };
    const payload = fs.mkdtempSync(path.join(os.tmpdir(), "legal-stage-"));
    dirs.push(payload);
    stageLegal(ROOT, payload);
    for (const file of [
      "LICENSE",
      "legal/EULA.md",
      "legal/PRIVACY.md",
      "legal/NOTICE.md",
      "legal/THIRD_PARTY_NOTICES.md",
      "legal/sbom.cdx.json",
    ])
      expect(fs.existsSync(path.join(payload, file)), file).toBe(true);
    for (const file of [
      "LICENSE",
      "legal/EULA.md",
      "legal/PRIVACY.md",
      "legal/NOTICE.md",
      "legal/THIRD_PARTY_NOTICES.md",
    ])
      expect(fs.readFileSync(path.join(payload, file), "utf8"), file).toBe(
        fs.readFileSync(path.join(ROOT, file), "utf8"),
      );
    const bom = JSON.parse(fs.readFileSync(path.join(payload, "legal", "sbom.cdx.json"), "utf8")) as {
      bomFormat: string;
      components: unknown[];
    };
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.components).toHaveLength(190 + 4);
    expect(fs.existsSync(path.join(payload, "legal", "vendor", "FSL-1.1-ALv2.template.md"))).toBe(true);
    // The CycloneDX schemas are test fixtures of the repository, not part of what the installer carries.
    expect(fs.existsSync(path.join(payload, "legal", "vendor", "cyclonedx"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "legal", "vendor", "cyclonedx", "bom-1.5.schema.json"))).toBe(true);
  });

  it("C6 scripts/package.mjs calls stageLegal(ROOT, payload) and still copies the Node LICENSE next to the runtime", () => {
    const source = text("scripts/package.mjs")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).toContain('import { stageLegal } from "./legal-stage.mjs";');
    expect(source).toMatch(/^stageLegal\(ROOT, payload\);$/m);
    expect(source).toContain('path.join(unpacked, "LICENSE"), path.join(dest, "LICENSE")');
  });

  it("C6 the CI packager smoke checks the legal folder of the stage", () => {
    const ci = text(".github/workflows/ci.yml");
    for (const file of [
      "LICENSE",
      "legal/EULA.md",
      "legal/PRIVACY.md",
      "legal/NOTICE.md",
      "legal/THIRD_PARTY_NOTICES.md",
      "legal/sbom.cdx.json",
    ])
      expect(ci, file).toContain(`test -f "$res/${file}"`);
    expect(ci).toContain('res="$stage/MordomoOS.app/Contents/Resources"');
  });
});

// ---- C18, C19 ---------------------------------------------------------------------------------------------------------

describe("C18 the EULA has the sections of a license agreement", () => {
  const eula = text("legal/EULA.md");
  const headings = eula.split("\n").filter((l) => l.startsWith("## "));

  it("C18 opens with the draft notice", () => {
    const top = firstLines("legal/EULA.md", 8);
    expect(top).toContain("MINUTA para revisão do dono");
    expect(top).toContain("Não é aconselhamento jurídico");
  });

  it("C18 has object and license, use, CLIs, trademarks, no warranty, liability, support, term, law and venue, in that order", () => {
    const wanted = [
      /Objeto e rela/,
      /O que se pode fazer/,
      /CLIs de terceiros/,
      /Marcas de terceiros/,
      /Sem garantia/,
      /Limita..o de responsabilidade/,
      /Suporte e atualiza/,
      /Vig.ncia e t.rmino/,
      /Lei aplic.vel e foro/,
    ];
    let from = 0;
    for (const re of wanted) {
      const at = headings.findIndex((h, i) => i >= from && re.test(h));
      expect(at, String(re)).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
    expect(headings.length).toBeGreaterThanOrEqual(9);
  });

  it("C18 says which text prevails over the source code: the LICENSE", () => {
    expect(flat(eula)).toContain("prevalece o LICENSE");
    expect(flat(eula)).toContain("Este contrato não restringe nada que o LICENSE permite");
  });

  it("C18 says there is no license key or activation, which the code confirms (C27)", () => {
    expect(flat(eula)).toContain("não tem hoje chave de licença, ativação nem verificação online de licença");
  });

  it("C18 says the app does not update itself and the version check is off by default", () => {
    expect(flat(eula)).toContain("não se atualiza sozinho");
    expect(flat(eula)).toContain("updates.check");
  });
});

describe("C19 the EULA says what the product does with the CLIs", () => {
  const f = flat(section("legal/EULA.md", "3."));

  it("C19 names the three CLIs", () => {
    for (const name of ["Claude Code", "Codex", "Cursor Agent"]) expect(f, name).toContain(name);
  });

  it("C19 orchestrates; does not include, redistribute or sublicense", () => {
    expect(f).toContain("orquestra programas de linha de comando de terceiros");
    expect(f).toContain("não inclui, não redistribui e não sublicencia");
    expect(f).toContain("Nada deles está no instalador");
  });

  it("C19 each follows its supplier's terms and the person uses their own account", () => {
    expect(f).toContain("Cada CLI segue os termos do seu fornecedor");
    expect(f).toContain("a própria conta");
    expect(f).toContain("O MordomoOS não lê nem grava o conteúdo das suas credenciais do provedor");
    expect(f).toContain(
      "o ambiente do processo dele (inclusive ANTHROPIC_API_KEY e OPENAI_API_KEY, se você as definiu) é repassado ao CLI que ele inicia",
    );
  });
});

// ---- C20, C37 ------------------------------------------------------------------------------------------------------------

interface Trademarks {
  brands: Array<{ name: string; kind: string; probe: string }>;
  watch: { probes: string[] };
  note: string;
}
const marks = JSON.parse(text("legal/trademarks.json")) as Trademarks;

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|sh|ps1|swift|yml|yaml|webmanifest|plist)$/;
/** Folders that are never the product's text, wherever they are. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "release", "coverage", ".git"]);
/**
 * Folders of the repository root that are not the product's text: the legal texts themselves, the specs, the tests,
 * the agents' folders, and the runtime state a checkout can hold (`config`, `logs`, `memory`, `workspace`, `artifacts`).
 * Only at the root: `core/src/memory`, `core/src/config` and `core/src/logs` are code and are read.
 */
const SKIP_ROOT_DIRS = new Set([
  ".specs",
  ".claude",
  ".agents",
  ".cursor",
  ".windsurf",
  "legal",
  "tests",
  "test-results",
  "playwright-report",
  "logs",
  "config",
  "artifacts",
  "memory",
  "workspace",
]);
/**
 * Build output and generated copies that the desktop shell leaves in the tree (git-ignored, see `.gitignore`): the payload
 * holds a copy of `legal/` and of the sources, `target` is Cargo's. The sweep must give the same answer with or without
 * them, so they are not read; a test below keeps this list equal to the ignored folders of `apps/desktop`.
 */
const SKIP_PATHS = new Set([
  "apps/desktop/target",
  "apps/desktop/payload",
  "apps/desktop/src-tauri/gen",
  "apps/desktop/src-tauri/permissions/autogenerated",
]);
const SKIP_FILES = /^(package-lock\.json|LICENSE|CONTRIBUTING\.md|CHANGELOG\.md)$|\.(test|spec)\.|\.d\.ts$/;

/** All the text the product shows or ships, as the sweep reads it: README, docs/** (every folder), code, skills, scripts, public files, connectors. */
function citedText(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && !(dir === "" && SKIP_ROOT_DIRS.has(d.name)) && !SKIP_PATHS.has(rel))
          walk(rel);
      } else if (TEXT_EXT.test(d.name) && !SKIP_FILES.test(d.name)) out.push({ file: rel, text: text(rel) });
    }
  };
  walk("");
  return out;
}
/** Names from `names` (regular expressions as strings) that the text cites. */
function citations(content: string, names: string[]): string[] {
  return names.filter((source) => new RegExp(source).test(content));
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const watchProbe = (name: string) => `(?<![\\w.-])${escapeRe(name)}(?![\\w-])`;

/** The names the EULA lists in section 4, one `- Kind: A, B, C.` line per kind. */
function eulaBrands(): Array<{ kind: string; names: string[] }> {
  return section("legal/EULA.md", "4.")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const [kind, rest] = [l.slice(2, l.indexOf(":")), l.slice(l.indexOf(":") + 1)];
      return { kind, names: rest.trim().replace(/\.$/, "").split(", ") };
    });
}

describe("C20 every third-party brand the product cites is listed, and the EULA names exactly those", () => {
  const files = citedText();

  it("C20 the sweep reads the README, every folder of docs/, the interface, the connectors, the skills, the scripts and the public files", () => {
    expect(files.length).toBeGreaterThan(500);
    const names = files.map((f) => f.file);
    for (const file of [
      "README.md",
      "docs/install.md",
      "docs/README.pt-BR.md",
      "docs/internal/analysis-2026-09/README.md",
      "docs/internal/review-2026-09-06/README.md",
      "connectors/playwright.json",
      "adapters/cursor/src/manifest.ts",
      "skills/claude-mobile-optimize/SKILL.md",
      "scripts/package.mjs",
      "apps/command-centre/public/sw.js",
      "apps/command-centre/src/hooks/systemNotify.ts",
      "apps/api/src/server.ts",
      ".github/workflows/ci.yml",
    ])
      expect(names, file).toContain(file);
    for (const file of names)
      expect(file, "not the legal texts, the specs, the tests or a dependency").not.toMatch(
        /^(legal|tests|\.specs)\/|node_modules/,
      );
  });

  it("C20 the sweep does not depend on the build output: the folders of apps/desktop that .gitignore lists are the ones it skips, and none of their files is read", () => {
    const ignored = text(".gitignore")
      .split("\n")
      .map((l) => l.trim().replace(/\/$/, ""))
      .filter((l) => l.startsWith("apps/desktop/"));
    expect([...SKIP_PATHS].sort()).toEqual(ignored.sort());
    for (const file of files.map((f) => f.file))
      for (const dir of SKIP_PATHS) expect(file.startsWith(`${dir}/`), file).toBe(false);
  });

  it("C48 the runtime-state folders (config, memory, logs, workspace, artifacts) are skipped at the root only: the code folders core/src/memory, core/src/config and core/src/logs are read", () => {
    const names = files.map((f) => f.file);
    for (const file of ["core/src/memory/facts.ts", "core/src/config/store.ts", "core/src/logs/jsonl.ts"])
      expect(names, file).toContain(file);
    for (const dir of ["core/src/memory/", "core/src/config/", "core/src/logs/"])
      expect(names.filter((n) => n.startsWith(dir)).length, dir).toBeGreaterThan(0);
    // Not read: a state folder at the root, the specs and the legal texts.
    expect(
      names.filter((n) => /^(memory|config|logs|workspace|artifacts|\.specs|legal|tests)\//.test(n)),
    ).toEqual([]);
  });

  it("C20 there are as many entries as the list holds and no name twice", () => {
    expect(marks.brands.length).toBeGreaterThanOrEqual(88);
    expect(new Set(marks.brands.map((b) => b.name)).size).toBe(marks.brands.length);
    expect(marks.watch.probes.length).toBeGreaterThanOrEqual(70);
    expect(new Set(marks.watch.probes).size).toBe(marks.watch.probes.length);
  });

  it("C20 no watched name (a brand the repository does not cite today) appears in the text; if one does it must move to brands", () => {
    const found: Record<string, string[]> = {};
    for (const f of files)
      for (const hit of citations(f.text, marks.watch.probes.map(watchProbe)))
        (found[hit] ??= []).push(f.file);
    expect(found).toEqual({});
  });

  it("C20 the sweep does find a brand that is added (self-test: Docker and Anthropic in a fixture text)", () => {
    const watched = marks.watch.probes.map(watchProbe);
    expect(citations("Run it in Docker, with a model from Anthropic.", watched).sort().length).toBe(1); // Docker is a brand now; Anthropic is watched
    expect(citations("Run it with Redis and Kubernetes.", watched)).toHaveLength(2);
    expect(citations("dockerfile, a linear scale, redistribute", watched)).toEqual([]);
  });

  it("C20 every brand of the list is still cited in the product's text, as a name of its own (the list holds nothing stale)", () => {
    const stale = marks.brands
      .filter((b) => !files.some((f) => new RegExp(b.probe).test(f.text)))
      .map((b) => b.name);
    expect(stale).toEqual([]);
  });

  it("C20 the brands the first sweep missed are in the list (Android, Edge, iPhone, iPad, Xcode, Gradle, Kotlin, Docker, Notion, Slack, WhatsApp, Discord…)", () => {
    const names = new Set(marks.brands.map((b) => b.name));
    for (const name of [
      "Android",
      "Microsoft Edge",
      "iPhone",
      "iPad",
      "Xcode",
      "Gradle",
      "Kotlin",
      "Metro",
      "Watchman",
      "Dart",
      "Docker",
      "Notion",
      "Slack",
      "WhatsApp",
      "Discord",
      "Stripe",
      "PayPal",
      "YouTube",
      "Tauri",
      "Debian",
    ])
      expect(names.has(name), name).toBe(true);
  });

  it("C20 the section says the names are cited to identify compatibility, without endorsement and without logos", () => {
    const f = flat(section("legal/EULA.md", "4."));
    expect(f).toContain("marcas ou nomes de produto dos respectivos titulares");
    expect(f).toContain("só para identificar com o que o MordomoOS funciona");
    expect(f).toContain("Nenhum titular patrocina, endossa");
    expect(f).toContain("não usa os logotipos");
  });

  it("C20 the list says the owner of each mark and its use policy still need confirming", () => {
    expect(section("legal/EULA.md", "4.")).toContain(
      "[A PREENCHER PELO DONO: confirmar o titular e a política de uso de marca",
    );
    expect(marks.note).toContain("MINUTA");
  });
});

describe("C37 the list is not presented as complete, the EULA matches it name by name, and a brand inside another brand's name is not enough", () => {
  it("C37 the EULA says the list is not exhaustive, and does not say the names below are all the names cited", () => {
    const f = flat(section("legal/EULA.md", "4."));
    expect(f).toContain("A lista abaixo não é exaustiva");
    expect(f).not.toMatch(/Os nomes abaixo, citados no reposit/);
  });

  it("C37 the names of the EULA are exactly the names of legal/trademarks.json, grouped by the same kinds, each name once", () => {
    const listed = eulaBrands();
    const flatNames = listed.flatMap((l) => l.names);
    expect(flatNames.length).toBe(new Set(flatNames).size);
    expect([...flatNames].sort()).toEqual(marks.brands.map((b) => b.name).sort());
    for (const { kind, names } of listed) {
      const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      expect(
        names.every((n) => capital(marks.brands.find((b) => b.name === n)!.kind) === kind),
        kind,
      ).toBe(true);
    }
  });

  it("C37 a short name that is only part of a longer brand does not satisfy the EULA (self-test: Claude inside 'Claude Code', Vite inside 'Vitest')", () => {
    const only = ["Claude Code", "Vitest", "Google Calendar", "Cursor Agent"];
    for (const name of ["Claude", "Vite", "Google", "Cursor"]) expect(only.includes(name), name).toBe(false);
    // The old check was substring-based; the new one compares whole names.
    expect(only.some((n) => n.includes("Vite"))).toBe(true);
    expect(only.includes("Vite")).toBe(false);
  });

  const BY_NAME = Object.fromEntries(marks.brands.map((b) => [b.name, b.probe]));
  it("C37 the probes of Claude, Cursor, Google and Vite find the name alone and not as part of another brand", () => {
    const alone = (name: string, content: string) => new RegExp(BY_NAME[name]!).test(content);
    expect(alone("Claude", "uses Claude Code and Claude Code")).toBe(false);
    expect(alone("Claude", "ask Claude to")).toBe(true);
    expect(alone("Claude", "Claude Code, then Claude.")).toBe(true);
    expect(alone("Cursor", "the Cursor Agent CLI")).toBe(false);
    expect(alone("Cursor", "the Cursor editor")).toBe(true);
    expect(alone("Google", "Google Calendar and Google Calendar")).toBe(false);
    expect(alone("Google", "a Google account")).toBe(true);
    expect(alone("Vite", "tests with Vitest")).toBe(false);
    expect(alone("Vite", "built with Vite 8")).toBe(true);
    expect(alone("Claude Code", "Claude Code")).toBe(true);
    expect(alone("Codex", "OpenAI Codex CLI")).toBe(true);
  });

  it("C37 each of those four is cited alone somewhere in the product (not only inside another name)", () => {
    const files = citedText();
    for (const name of ["Claude", "Cursor", "Google", "Vite"])
      expect(
        files.some((f) => new RegExp(BY_NAME[name]!).test(f.text)),
        name,
      ).toBe(true);
  });
});

// ---- C21 --------------------------------------------------------------------------------------------------------------

const LEGAL_TEXTS = [
  "LICENSE",
  "CONTRIBUTING.md",
  "legal/EULA.md",
  "legal/PRIVACY.md",
  "legal/NOTICE.md",
  "legal/README.md",
];

describe("C21 the legal texts invent no person, company, address or number", () => {
  const all = LEGAL_TEXTS.map((f) => ({ file: f, text: text(f) }));

  it("C21 no e-mail address, CNPJ, CPF, CEP or street in any of them", () => {
    for (const { file, text: t } of all) {
      const withoutPlaceholders = t.replace(PLACEHOLDER, "");
      expect(withoutPlaceholders, `${file} e-mail`).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(withoutPlaceholders, `${file} CNPJ`).not.toMatch(
        /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/,
      );
      expect(withoutPlaceholders, `${file} CPF`).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
      expect(withoutPlaceholders, `${file} CEP`).not.toMatch(/\bCEP\b|\b\d{5}-\d{3}\b/);
      expect(withoutPlaceholders, `${file} street`).not.toMatch(
        /\b(Rua|Avenida|Av\.|Alameda|Rodovia|Travessa)\s+[A-Z]/,
      );
    }
  });

  it("C21 the name the old MIT text carried is not copied into the new ones (the owner decides who the licensor is)", () => {
    for (const { file, text: t } of all) expect(t, file).not.toMatch(/Thiago|Lopes/);
  });

  it("C21 the detector does see an e-mail, a CNPJ and a street (self-test)", () => {
    expect("fale com a@b.com.br").toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect("CNPJ 12.345.678/0001-90").toMatch(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
    expect("Rua Augusta, 100").toMatch(/\b(Rua|Avenida|Av\.|Alameda|Rodovia|Travessa)\s+[A-Z]/);
  });

  const OWNER_FIELDS = [
    "titular dos direitos autorais",
    "documento do titular (CNPJ ou CPF)",
    "endereço do titular",
    "e-mail de contato jurídico e de privacidade",
    "e-mail de suporte",
    "preço e modelo de venda (por usuário, por máquina, assinatura)",
    "lei aplicável e foro",
    "garantia legal e prazos aplicáveis",
  ];
  for (const field of OWNER_FIELDS)
    it(`C21 the owner's ${field} is a marked blank somewhere`, () => {
      const labels = all.flatMap((a) => [...a.text.matchAll(PLACEHOLDER)].map((m) => m[1]!));
      expect(
        labels.some((l) => l.startsWith(field)),
        field,
      ).toBe(true);
    });
});

// ---- C22, C28 ---------------------------------------------------------------------------------------------------------

describe("C22 the privacy policy says where the data is, what leaves, and who talks to the provider", () => {
  const privacy = text("legal/PRIVACY.md");
  const f = flat(privacy);

  it("C22 opens with the draft notice", () => {
    const top = firstLines("legal/PRIVACY.md", 8);
    expect(top).toContain("MINUTA para revisão do dono");
    expect(top).toContain("Não é aconselhamento jurídico");
  });

  it("C22 gives the four places of the home: macOS, Linux, Windows and MORDOMO_HOME", () => {
    for (const where of [
      "~/Library/Application Support/MordomoOS",
      "$XDG_DATA_HOME/mordomo-os",
      "%LOCALAPPDATA%\\MordomoOS",
      "MORDOMO_HOME",
    ])
      expect(privacy, where).toContain(where);
    expect(f).toContain("A partir do código-fonte");
  });

  it("C22 never cites ~/.mordomo, which the code does not use", () => {
    expect(privacy).not.toContain("~/.mordomo");
    const install = text("docs/install.md");
    expect(install).toContain("Library/Application Support/MordomoOS");
    expect(install).toContain("~/.local/share/mordomo-os");
  });

  it("C22 says the product sends nothing to the licensor's servers and has no account", () => {
    expect(f).toContain("não envia nada a servidores do licenciante");
    expect(f).toContain("não há conta, cadastro, servidor nem serviço nosso");
  });

  it("C22 says the CLIs, not MordomoOS, talk to the provider, under the provider's terms", () => {
    const cli = flat(section("legal/PRIVACY.md", "5."));
    expect(cli).toContain("Quem fala com o provedor é o CLI");
    expect(cli).toContain("sob os termos e a política de privacidade dele, não desta");
    expect(cli).toContain(
      "o prompt, os arquivos que o CLI ler e o resultado passam pelo servidor do provedor",
    );
  });

  it("C22 says how to delete everything and how to turn each destination off", () => {
    expect(f).toContain("mordomo uninstall --purge");
    expect(f).toContain("MORDOMO_SKIP_NPM_AUDIT=1");
  });

  it("C22 leaves the legal bases to the owner and the lawyer", () => {
    for (const label of [
      "encarregado pelo tratamento de dados (LGPD)",
      "o que o suporte guarda",
      "o advogado deve dizer se são necessárias cláusulas",
    ])
      expect(privacy, label).toContain(label);
  });
});

describe("C28 the privacy policy says there is no telemetry and what a future one would have to be", () => {
  const f = flat(section("legal/PRIVACY.md", "6."));
  const top = flat(section("legal/PRIVACY.md", "1."));

  it("C28 'Nenhuma telemetria', in the summary and in its own section", () => {
    expect(top).toContain("Nenhuma telemetria");
    expect(f).toContain("Nenhuma. O MordomoOS não tem telemetria de uso, de erros nem de desempenho");
    expect(f).toContain("não envia identificador de instalação, de máquina ou de pessoa");
  });

  it("C28 states the test that holds it", () => {
    expect(f).toContain("tests/legal.network.test.ts");
  });

  it("C28 a future telemetry: opt-in, off by default, minimal, no personal identifier, consent screen, documented first, same commit", () => {
    for (const phrase of [
      "opt-in e desligada por padrão",
      "sem identificador pessoal",
      "uma tela de consentimento",
      "documentada aqui antes de existir",
      "no mesmo commit",
    ])
      expect(f, phrase).toContain(phrase);
  });

  it("C28 the owner is asked whether they ever want it, with 'do not implement' as the adopted default", () => {
    expect(f).toContain(
      "[A PREENCHER PELO DONO: o dono quer, algum dia, telemetria opt-in? O padrão adotado é não implementar.]",
    );
  });
});

// ---- C30, C31, C32 ----------------------------------------------------------------------------------------------------

describe("C30 every legal text says it is a draft", () => {
  const TEXTS = [...LEGAL_TEXTS, "legal/THIRD_PARTY_NOTICES.md"];
  for (const file of TEXTS)
    it(`C30 ${file} carries MINUTA, 'aconselhamento jurídico' and the owner's review in its first 12 lines`, () => {
      const top = firstLines(file);
      expect(top).toMatch(/MINUTA/);
      expect(top).toMatch(/aconselhamento jur[ií]dico/i);
      expect(top).toMatch(/revis[aã]o (jur[ií]dica )?do dono|revis[aã]o é do dono/i);
    });

  for (const file of ["legal/license-policy.json", "legal/network-policy.json", "legal/trademarks.json"])
    it(`C30 ${file} says so in its note`, () => {
      const note = (JSON.parse(text(file)) as { note: string }).note;
      expect(note).toMatch(/MINUTA/);
      expect(note).toMatch(/aconselhamento jur[ií]dico/i);
      expect(note).toMatch(/revis[aã]o (jur[ií]dica )?do dono|revis[aã]o do dono/i);
    });

  it("C30 a text with no notice would fail (self-test)", () => {
    expect(firstLines("legal/vendor/DCO-1.1.txt")).not.toMatch(/MINUTA/);
  });
});

describe("C31 the owner's blanks are all listed in STATE.md", () => {
  const files = [
    "LICENSE",
    "CONTRIBUTING.md",
    ...fs
      .readdirSync(path.join(ROOT, "legal"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `legal/${f}`),
  ];
  const labels = [
    ...new Set(
      files.flatMap((f) => [...text(f).matchAll(PLACEHOLDER)].map((m) => m[1]!)).filter((l) => l !== "…"),
    ),
  ].sort();
  const state = text(".specs/STATE.md");
  const heading = state.indexOf("\n#### revisão jurídica do dono");
  const after = state.slice(heading + 10);
  const end = after.search(/\n### /);
  const block = end < 0 ? after : after.slice(0, end);

  it("C31 the texts hold at least 20 distinct blanks, and STATE.md has a 'revisão jurídica do dono' section", () => {
    expect(labels.length).toBeGreaterThanOrEqual(20);
    expect(heading).toBeGreaterThan(0);
    expect(block).toContain("não é aconselhamento jurídico");
  });

  for (const label of labels)
    it(`C31 STATE.md lists: ${label.slice(0, 70)}`, () => {
      expect(block).toContain(`[A PREENCHER PELO DONO: ${label}]`);
    });

  it("C31 STATE.md asks the owner the open questions (CLA, English, 'Sobre' screen, telemetry, relicensing, AI authorship)", () => {
    for (const topic of [
      "CLA",
      "inglês",
      "Sobre",
      "telemetria",
      "relicenci",
      "Claude <noreply@anthropic.com>",
    ])
      expect(block, topic).toContain(topic);
  });
});

describe("C32 the changelog", () => {
  it("C32 Unreleased has the licenca-comercial entry: FSL-1.1-ALv2, the generated notice, the network sweep and no telemetry", () => {
    const changelog = text("CHANGELOG.md");
    const start = changelog.indexOf("## Unreleased");
    const next = changelog.indexOf("\n## ", start + 5);
    const unreleased = flat(changelog.slice(start, next < 0 ? undefined : next));
    expect(unreleased).toContain("(licenca-comercial)");
    for (const phrase of [
      "FSL-1.1-ALv2",
      "THIRD_PARTY_NOTICES.md",
      "npm run network:scan",
      "There is no telemetry",
    ])
      expect(unreleased, phrase).toContain(phrase);
  });
});

// ---- round 1 ----------------------------------------------------------------------------------------------------------

describe("C38 the legal texts invent no company, value, contact or link, and the sentences about the licensor hold only the owner's mark", () => {
  const MARK = "⟦⟧";
  const dco = text("legal/vendor/DCO-1.1.txt").trim();
  const bodyOf = (file: string) => {
    let t = text(file);
    if (file === "CONTRIBUTING.md") t = t.replace(dco, "");
    return t.replace(PLACEHOLDER, MARK);
  };
  const FILES = [
    "LICENSE",
    "CONTRIBUTING.md",
    "legal/EULA.md",
    "legal/PRIVACY.md",
    "legal/NOTICE.md",
    "legal/README.md",
  ];
  const COMPANY =
    /\b(Ltda\.?|S\.A\.|S\/A|EIRELI|LLC|Inc\.?|Corp\.?|GmbH|Ltd\.?|B\.V\.|S\.r\.l\.|Pty|Co\.)(?![\w])/;
  const MONEY = /R\$|US\$|€|£|\$\s?\d|\b(USD|BRL|EUR|GBP)\b|\d+\s*(reais|dólares|euros)\b/i;
  const PHONE = /\(\d{2}\)\s?\d{4,5}-?\d{4}|\+\d{2}\s?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/;
  const ALLOWED_URL_HOSTS = new Set([
    "fsl.software",
    "developercertificate.org",
    "www.conventionalcommits.org",
    "raw.githubusercontent.com",
    "github.com",
    "cursor.com",
    "www.apache.org",
  ]);
  const urlHosts = (t: string) =>
    [...t.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]!.toLowerCase());

  it("C38 the detectors see an invented company, a value, a phone and a link (self-test)", () => {
    expect("Acme Software Ltda").toMatch(COMPANY);
    expect("Foo Inc.").toMatch(COMPANY);
    expect("teto de R$ 100,00").toMatch(MONEY);
    expect("pague US$ 5").toMatch(MONEY);
    expect("1.000 reais").toMatch(MONEY);
    expect("(11) 91234-5678").toMatch(PHONE);
    expect(urlHosts("veja https://acme.example.com/x e http://b.test")).toEqual([
      "acme.example.com",
      "b.test",
    ]);
    expect("$XDG_DATA_HOME e ${year}").not.toMatch(MONEY);
  });

  for (const file of FILES)
    it(`C38 ${file}: no company name, monetary value, phone, e-mail or link outside the allowlist`, () => {
      const t = bodyOf(file);
      expect(t, "company").not.toMatch(COMPANY);
      expect(t, "money").not.toMatch(MONEY);
      expect(t, "phone").not.toMatch(PHONE);
      expect(t, "e-mail").not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(
        urlHosts(t).filter((h) => !ALLOWED_URL_HOSTS.has(h)),
        "links",
      ).toEqual([]);
    });

  const skeleton = (file: string, from: string, to: string) => {
    const t = bodyOf(file);
    const a = t.indexOf(from);
    const b = t.indexOf(to, a);
    expect(a, `${file} has "${from}"`).toBeGreaterThanOrEqual(0);
    return t.slice(a, b).replace(/`/g, "").replace(/\s+/g, " ").trim();
  };

  it("C38 the EULA names the licensor with the owner's marks and nothing else", () => {
    expect(skeleton("legal/EULA.md", "1.3. O titular", "## 2.")).toBe(
      `1.3. O titular dos direitos e licenciante é ${MARK}, inscrito sob o documento ${MARK}, com endereço em ${MARK}. Contato jurídico e de privacidade: ${MARK}.`,
    );
  });

  it("C38 the privacy policy does the same, and the notice carries the copyright line as a mark", () => {
    expect(skeleton("legal/PRIVACY.md", "Licenciante:", "Como o licenciante")).toBe(
      `Licenciante: ${MARK}, documento ${MARK}, endereço ${MARK}. Contato de privacidade: ${MARK}. ${MARK}`,
    );
    expect(bodyOf("legal/NOTICE.md")).toContain(`MordomoOS\nCopyright 2026 ${MARK}\n`);
    expect(bodyOf("LICENSE")).toContain(`Copyright 2026 ${MARK}\n`);
  });

  it("C38 the old licensor name and the repository's own handle are not in the texts as a licensor", () => {
    for (const file of FILES) expect(bodyOf(file), file).not.toMatch(/Thiago|Lopes/);
  });
});

describe("C40 the SPDX identifier", () => {
  it("C40 FSL-1.1-ALv2 is the abbreviation in LICENSE and the license field of the 8 manifests; FSL-1.1-Apache-2.0 is neither", () => {
    const license = text("LICENSE");
    expect(license).toMatch(/## Abbreviation\n\nFSL-1\.1-ALv2\n/);
    const root = JSON.parse(text("package.json")) as { workspaces: string[] };
    for (const f of ["package.json", ...root.workspaces.map((w) => `${w}/package.json`)]) {
      const m = JSON.parse(text(f)) as { license: string };
      expect(m.license, f).toBe("FSL-1.1-ALv2");
      expect(m.license, f).not.toBe("FSL-1.1-Apache-2.0");
    }
  });

  it("C40 the identifier is in the SPDX list that the vendored CycloneDX schema carries; the name of the request is not", () => {
    const spdx = (JSON.parse(text("legal/vendor/cyclonedx/spdx.schema.json")) as { enum: string[] }).enum;
    expect(spdx).toContain("FSL-1.1-ALv2");
    expect(spdx).toContain("FSL-1.1-MIT");
    expect(spdx).not.toContain("FSL-1.1-Apache-2.0");
  });

  it("C40 the two published packages say the same and ship a copy of the LICENSE", () => {
    for (const dir of ["core", "contracts"]) {
      expect((JSON.parse(text(`${dir}/package.json`)) as { license: string }).license, dir).toBe(
        "FSL-1.1-ALv2",
      );
      expect(text(`${dir}/LICENSE`), dir).toBe(text("LICENSE"));
    }
  });

  it("C40 no text still says the identifier could not be confirmed, or that SEE LICENSE IN LICENSE is the value", () => {
    for (const file of ["legal/README.md", "CHANGELOG.md", "README.md", "legal/EULA.md", "legal/PRIVACY.md"])
      expect(text(file), file).not.toMatch(/SEE LICENSE IN LICENSE|não conseguiu confirmar/);
    expect(flat(text("legal/README.md"))).toContain("é um identificador SPDX");
    const state = text(".specs/STATE.md");
    expect(state).not.toMatch(/Padrão: `SEE LICENSE IN LICENSE` nos oito/);
  });
});

describe("C41 the EULA quotes the FSL literally where it says it does, and says what it adds", () => {
  const eula = text("legal/EULA.md");
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const license = collapse(text("LICENSE"));
  const quotes = eula
    .split("\n")
    .filter((l) => l.startsWith("> FSL: "))
    .map((l) => collapse(l.slice("> FSL: ".length)));

  it("C41 there are at least 15 literal passages and every one of them is in the LICENSE", () => {
    expect(quotes.length).toBeGreaterThanOrEqual(15);
    for (const q of quotes) expect(license, q.slice(0, 60)).toContain(q);
  });

  it("C41 a passage that is not in the LICENSE would be caught (self-test)", () => {
    expect(license).not.toContain("the Licensor may terminate this license");
    expect(license).not.toContain("loss of data, profit or opportunity");
    expect(license).not.toContain("cease distributing");
  });

  it("C41 the Competing Use passage carries the 'exists as of the date' qualifier, and the Portuguese summary says it", () => {
    expect(quotes.some((q) => q.includes("that exists as of the date we make the Software available"))).toBe(
      true,
    );
    expect(flat(eula)).toContain("e que já exista na data em que a versão foi disponibilizada");
  });

  it("C41 the liability passage is the FSL's, and loss of data, profit and opportunity is marked as an additional term", () => {
    expect(quotes.some((q) => q.startsWith("IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU"))).toBe(true);
    const paragraph = eula
      .split("\n\n")
      .map((p) => p.replace(/\s+/g, " "))
      .find((p) => p.includes("perda de dados, de lucro ou de oportunidade"))!;
    expect(paragraph).toContain("**Termo adicional (a revisar)");
    expect(paragraph).toContain("Essa lista não está no `LICENSE`");
  });

  it("C41 the licence has no termination clause or duty to stop distributing, and the EULA says so instead of attributing one to it", () => {
    expect(license).not.toMatch(/terminat|cease distribut|stop distribut/i);
    const s9 = flat(section("legal/EULA.md", "9."));
    expect(s9).toContain(
      "O LICENSE não tem cláusula de término do contrato nem dever de parar de distribuir o software",
    );
    expect(s9).not.toMatch(/perde o direito|pode exigir que pare/);
    expect(s9).toContain("Termo adicional (a revisar)");
  });

  it("C41 the THIRD_PARTY_NOTICES duty is marked as coming from the third-party licenses and not from the LICENSE", () => {
    const s2 = flat(section("legal/EULA.md", "2."));
    expect(s2).toContain("Essa exigência não vem do LICENSE");
    expect(s2).not.toMatch(/como o próprio `?LICENSE`? exige/);
  });

  it("C41 the EULA never says 'as the LICENSE says' about a text the LICENSE does not hold", () => {
    const outsideQuotes = eula
      .split("\n")
      .filter((l) => !l.startsWith("> FSL: "))
      .join("\n");
    expect(outsideQuotes).not.toMatch(/como (o próprio )?`?LICENSE`? (diz|exige)|como diz o `?LICENSE/);
  });

  it("C41 the section on liability and on term each carry an additional-term mark", () => {
    for (const n of ["2.", "7.", "9."]) expect(section("legal/EULA.md", n), n).toContain("Termo adicional");
  });
});

describe("C42 the runtime set is not presented as the content of the installer", () => {
  const TEXTS = [
    "README.md",
    "docs/install.md",
    "docs/README.pt-BR.md",
    "legal/README.md",
    "legal/NOTICE.md",
    "legal/EULA.md",
    "legal/PRIVACY.md",
  ];

  it("C42 no text says that the notice lists everything the installer carries, or that the 184 are the installer's", () => {
    for (const file of TEXTS)
      expect(flat(text(file)), file).not.toMatch(
        /(every|all) (the )?components? (that )?the installer carries|184 (packages|pacotes) (the installer carries|que o instalador leva)/i,
      );
    const changelog = text("CHANGELOG.md");
    const unreleased = changelog.slice(
      changelog.indexOf("## Unreleased"),
      changelog.indexOf("\n## ", changelog.indexOf("## Unreleased") + 5),
    );
    expect(flat(unreleased)).not.toMatch(/184 packages the installer carries/);
  });

  it("C42 the README, the CHANGELOG and the notice say 'runtime dependency set' and 'superset'", () => {
    expect(flat(section("README.md", "License"))).toMatch(/runtime dependency set/);
    expect(flat(section("README.md", "License"))).toContain(
      "superset of what the installer's bundles contain",
    );
    const changelog = text("CHANGELOG.md");
    expect(
      flat(
        changelog.slice(
          changelog.indexOf("## Unreleased"),
          changelog.indexOf("\n## ", changelog.indexOf("## Unreleased") + 5),
        ),
      ),
    ).toContain("a superset of what the installer's bundles contain");
    const notice = flat(text("legal/THIRD_PARTY_NOTICES.md"));
    expect(notice).toContain("Pacotes npm de runtime: 191");
    expect(notice).toContain("superconjunto do que o instalador leva");
    expect(notice).toContain("o aviso não afirma que cada um está dentro do instalador");
  });

  it("C50 no text or script comment hard-codes the number of packages: the proofs of legal.licenses assert it, a copy would go stale with the next dependency", () => {
    const COUNT = /\b\d{3}\b(?:\s+\w+){0,3}\s+(packages|pacotes|dependências|dependencies)\b/i;
    const changelog = text("CHANGELOG.md");
    const unreleased = changelog.slice(
      changelog.indexOf("## Unreleased"),
      changelog.indexOf("\n## ", changelog.indexOf("## Unreleased") + 5),
    );
    const state = text(".specs/STATE.md");
    const decisions = state
      .split("\n")
      .filter((l) => /^\| AD-0(21|23|26) /.test(l))
      .join("\n");
    const owner = state.slice(state.indexOf("### licenca-comercial"), state.indexOf("### contratos-rest"));
    for (const [name, content] of Object.entries({
      "CHANGELOG.md (Unreleased)": unreleased,
      "scripts/licenses.mjs": text("scripts/licenses.mjs"),
      "scripts/sbom.mjs": text("scripts/sbom.mjs"),
      "STATE.md (AD-021, AD-023, AD-026)": decisions,
      "STATE.md (licenca-comercial)": owner,
    }))
      expect(flat(content).match(COUNT), name).toBeNull();
    // The guard sees the sentences it is about.
    expect(COUNT.test("the 184 npm packages of the lockfile")).toBe(true);
    expect(COUNT.test("184 pacotes de runtime")).toBe(true);
    expect(COUNT.test("omite 23 dos 184 pacotes")).toBe(true);
    expect(COUNT.test("the npm packages of the lockfile")).toBe(false);
  });

  it("C42 the first sentence of the SBOM doc and the notice section agree: runtime, not 'distributed'", () => {
    expect(text("legal/THIRD_PARTY_NOTICES.md")).toContain("## 2. Pacotes npm de runtime");
    expect(text("legal/THIRD_PARTY_NOTICES.md")).not.toContain("## 2. Pacotes npm distribuídos");
  });
});

describe("C45 no text says the opposite of what the privacy text says about the credentials", () => {
  it("C45 the EULA 3.3 and the privacy text say the same: the content of the credentials is not read or stored, the environment is passed to the CLI", () => {
    const eula = flat(section("legal/EULA.md", "3."));
    const privacy = flat(text("legal/PRIVACY.md"));
    for (const sentence of [
      "não lê nem grava o conteúdo das suas credenciais do provedor",
      "o ambiente do processo dele (inclusive ANTHROPIC_API_KEY e OPENAI_API_KEY, se você as definiu) é repassado ao CLI que ele inicia",
    ]) {
      expect(eula, sentence).toContain(sentence);
      expect(privacy, sentence).toContain(sentence);
    }
  });

  it("C45 none of the legal texts, the README or the guides says that the MordomoOS does not see, or does not keep, the key or the login", () => {
    const CLAIM =
      /n[ãa]o v[êe] (nem guarda )?(a |as )?(sua |suas )?(chave|credenciais|login)|n[ãa]o guarda (a |as )?(sua |suas )?(chave|credenciais)|never (sees|stores) (your |the )?(provider )?(api )?(key|credentials)/i;
    for (const file of [
      ...LEGAL_TEXTS,
      "README.md",
      "docs/install.md",
      "docs/README.pt-BR.md",
      "docs/security.md",
    ])
      expect(flat(text(file)), file).not.toMatch(CLAIM);
    // The guard sees the sentence the EULA used to have.
    expect("O MordomoOS não vê nem guarda a chave ou o login do provedor.").toMatch(CLAIM);
    expect("O MordomoOS não lê nem grava o conteúdo das suas credenciais").not.toMatch(CLAIM);
  });
});

describe("C43 traceability and the wording of the privacy text", () => {
  const SPECS = [".specs/features/licenca-comercial/plan.md", ".specs/features/licenca-comercial/checks.md"];
  const stateLicense = () => {
    const state = text(".specs/STATE.md");
    return (
      state
        .split("\n")
        .filter((l) => l.startsWith("| AD-021") || l.startsWith("| AD-022"))
        .join("\n") + state.slice(state.indexOf("### licenca-comercial"))
    );
  };

  it("C43 the specs cite no commit that the integration left out (40fee52, a678a34, 4ffa643, 9a91385, 61ef40f)", () => {
    for (const file of SPECS)
      for (const h of ["40fee52", "a678a34", "4ffa643", "9a91385", "61ef40f"])
        expect(text(file), `${file} ${h}`).not.toContain(h);
    for (const h of ["40fee52", "a678a34", "4ffa643", "9a91385", "61ef40f"])
      expect(stateLicense(), h).not.toContain(h);
  });

  it("C43 the Landing row of door 4 keeps its original title and the amendments are recorded below the table", () => {
    const plan = text(".specs/features/licenca-comercial/plan.md");
    expect(plan).toMatch(/^\| 4\. SBOM\s+\|/m);
    expect(plan).not.toContain("a forma mudou na construção");
    expect(plan).toContain("**Emendas da rodada 1");
    expect(plan.indexOf("**Emendas da rodada 1")).toBeGreaterThan(plan.indexOf("| 7. SBOM"));
  });

  it("C43 the privacy text does not say 'no product identifier' beside the user-agent header; it says what the header is", () => {
    const privacy = text("legal/PRIVACY.md");
    expect(privacy).not.toMatch(/nenhum identificador do produto/);
    expect(privacy).toContain("`user-agent: mordomo-os` (o nome do produto, sem versão)");
    expect(privacy).toContain("nenhum identificador da instalação, da máquina ou da pessoa");
  });

  it("C43 the privacy text says the provider credentials in the environment are passed to the CLI, and does not say MordomoOS never sees them", () => {
    const privacy = flat(text("legal/PRIVACY.md"));
    expect(privacy).toContain(
      "o ambiente do processo dele (inclusive ANTHROPIC_API_KEY e OPENAI_API_KEY, se você as definiu) é repassado ao CLI",
    );
    expect(privacy).not.toMatch(/não vê (a sua )?chave/);
    const code = text("core/src/spawn/safeSpawn.ts");
    expect(code).toContain("{ ...process.env }");
    expect(text("adapters/claude/src/index.ts")).toContain("process.env.ANTHROPIC_API_KEY");
    expect(text("adapters/codex/src/index.ts")).toContain("process.env.OPENAI_API_KEY");
  });
});

describe("C52 the edits made to approved items after the approval are recorded, and the value of license is a question to the owner", () => {
  const state = text(".specs/STATE.md");
  const owner = state.slice(state.indexOf("### licenca-comercial"), state.indexOf("### contratos-rest"));

  it("C52 AD-026 names the Landing row of door 1, C3, C15, C16 and C20, and the change of license from SEE LICENSE IN LICENSE to FSL-1.1-ALv2 in the publishable packages", () => {
    const row = state.split("\n").find((l) => l.startsWith("| AD-026 "));
    expect(row, "AD-026 row").toBeTruthy();
    for (const piece of [
      "porta 1",
      "C3, C15, C16 e C20",
      "SEE LICENSE IN LICENSE",
      "FSL-1.1-ALv2",
      "`core` e `contracts`",
      "pergunta ao dono",
    ])
      expect(row, piece).toContain(piece);
  });

  it("C52 the owner questions of licenca-comercial ask for the value of license (point 10) and about the Apache-2.0 text next to the CycloneDX schemas (point 11)", () => {
    expect(owner).toMatch(/^10\. \*\*Valor de `license` dos pacotes/m);
    expect(owner).toMatch(/^11\. \*\*Esquemas do CycloneDX sem o texto da Apache-2\.0/m);
    expect(owner).toContain("`SEE LICENSE IN LICENSE`");
  });

  it("C52 the manifests of the publishable packages say what AD-026 says they say", () => {
    for (const file of ["core/package.json", "contracts/package.json"])
      expect((JSON.parse(text(file)) as { license: string }).license, file).toBe("FSL-1.1-ALv2");
  });
});
