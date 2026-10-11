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

describe("C3 every package.json says SEE LICENSE IN LICENSE", () => {
  const root = JSON.parse(text("package.json")) as { workspaces: string[] };
  const files = ["package.json", ...root.workspaces.map((w) => `${w}/package.json`)];

  it("C3 there are 8 manifests: the root and the 7 workspaces", () => {
    expect(files).toEqual([
      "package.json",
      "contracts/package.json",
      "core/package.json",
      "adapters/claude/package.json",
      "adapters/cursor/package.json",
      "adapters/codex/package.json",
      "apps/api/package.json",
      "apps/command-centre/package.json",
    ]);
  });

  for (const file of files)
    it(`C3 ${file}`, () => {
      expect((JSON.parse(text(file)) as { license?: string }).license).toBe("SEE LICENSE IN LICENSE");
    });

  it("C3 the lockfile says the same for the root and the workspaces, so npm install does not rewrite it", () => {
    const lock = JSON.parse(text("package-lock.json")) as { packages: Record<string, { license?: string }> };
    for (const key of ["", ...root.workspaces])
      expect(lock.packages[key]?.license, key || "root").toBe("SEE LICENSE IN LICENSE");
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
    expect(bom.components).toHaveLength(183);
    expect(fs.existsSync(path.join(payload, "legal", "vendor", "FSL-1.1-ALv2.template.md"))).toBe(true);
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
    expect(f).toContain("O MordomoOS não vê nem guarda a chave ou o login do provedor");
  });
});

// ---- C20 --------------------------------------------------------------------------------------------------------------

interface Trademarks {
  brands: Array<{ name: string; kind: string; probe: string }>;
  watch: { probes: string[] };
  note: string;
}
const marks = JSON.parse(text("legal/trademarks.json")) as Trademarks;

/** The text the product shows or ships, as the sweep reads it (no tests, no dependencies, none of the legal files). */
function citedText(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const add = (file: string) => out.push({ file, text: text(file) });
  const walk = (dir: string, accept: RegExp) => {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) {
        if (!["node_modules", "dist", "build", "release"].includes(d.name)) walk(rel, accept);
      } else if (accept.test(d.name) && !/\.(test|spec)\.|\.d\.ts$/.test(d.name)) add(rel);
    }
  };
  add("README.md");
  for (const d of fs.readdirSync(path.join(ROOT, "docs"), { withFileTypes: true }))
    if (d.isFile() && d.name.endsWith(".md")) add(`docs/${d.name}`);
  for (const dir of [
    "core/src",
    "contracts/src",
    "adapters",
    "apps/api/src",
    "apps/command-centre/src",
    "connectors",
    "routines",
  ])
    walk(dir, /\.(ts|tsx|json|css)$/);
  add("apps/command-centre/index.html");
  return out;
}
/** Names from `names` (regular expressions as strings) that the text cites. */
function citations(content: string, names: string[]): string[] {
  return names.filter((source) => new RegExp(source).test(content));
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("C20 every third-party brand the product cites is listed, and the EULA names them all", () => {
  const files = citedText();

  it("C20 the sweep reads README, docs, the interface, the connectors and the adapters (some 300 files)", () => {
    expect(files.length).toBeGreaterThan(250);
    const names = files.map((f) => f.file);
    for (const file of [
      "README.md",
      "docs/install.md",
      "docs/README.pt-BR.md",
      "connectors/playwright.json",
      "adapters/cursor/src/manifest.ts",
    ])
      expect(names, file).toContain(file);
  });

  it("C20 there are 46 brands and 32 watched names", () => {
    expect(marks.brands).toHaveLength(46);
    expect(marks.watch.probes).toHaveLength(32);
    expect(new Set(marks.brands.map((b) => b.name)).size).toBe(46);
  });

  it("C20 no watched name (a brand the repository does not cite today) appears in the text; if one does it must be added to brands", () => {
    const watched = marks.watch.probes.map((p) => `\\b${escapeRe(p)}\\b`);
    const found: Record<string, string[]> = {};
    for (const f of files) for (const hit of citations(f.text, watched)) (found[hit] ??= []).push(f.file);
    expect(found).toEqual({});
  });

  it("C20 the sweep does find a brand that is added (self-test: Docker and Anthropic in a fixture text)", () => {
    const watched = marks.watch.probes.map((p) => `\\b${escapeRe(p)}\\b`);
    expect(citations("Run it in Docker, with a model from Anthropic.", watched).sort()).toEqual([
      "\\bAnthropic\\b",
      "\\bDocker\\b",
    ]);
    expect(citations("dockerfile, a linear scale", watched)).toEqual([]);
  });

  it("C20 every brand of the list is still cited in the product's text (the list holds nothing stale)", () => {
    const stale = marks.brands
      .filter((b) => !files.some((f) => new RegExp(b.probe).test(f.text)))
      .map((b) => b.name);
    expect(stale).toEqual([]);
  });

  for (const brand of marks.brands)
    it(`C20 ${brand.name} is named in the EULA's trademark section`, () => {
      expect(section("legal/EULA.md", "4.")).toContain(brand.name);
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
