import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { makeTempHome } from "./helpers.js";
import { organizeWorld, type Json, type OrganizeWorld } from "./helpers/organizeWorld.js";

/**
 * .specs/features/cerebro-organizar, batch A, S1 and the prose of S5: the skill `organize-brain` as the catalog lists
 * it, the files it ships (parsed from a seeded home, as `recall` and `consolidate-memory` are in
 * `tests/builtin-context.test.ts`), and the prompt a run of it is handed, read at the Claude adapter while the fake
 * CLI runs. Each test is written from its check in `checks.md`.
 */

const SLUG = "organize-brain";
const POSIX = process.platform !== "win32";

/** The text under a heading, up to the next heading of the same or a higher level. */
function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const level = heading.match(/^#+/)![0].length;
  const start = lines.findIndex((l) => l.trim() === heading);
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced ? line.match(/^(#+) /) : null;
    if (m && m[1]!.length <= level) break;
    out.push(line);
  }
  return out.join("\n");
}
/** The same text with its line breaks folded, for a sentence wrapped across lines. */
const flat = (text: string) => text.replace(/\s+/g, " ");
/** The backticked values of the first column of the Markdown tables in `text`, header and rule rows left out. */
function firstColumn(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.split("|")[1]!.trim())
    .filter((cell) => cell.startsWith("`"))
    .map((cell) => cell.replace(/^`|`$/g, ""));
}

const DOOR2_NOTES = [
  "perfil",
  "estrategia",
  "cliente-ideal",
  "marca",
  "voz",
  "oferta",
  "organizacao",
  "stakeholders",
  "dores",
  "crencas",
  "respostas",
  "metas",
];
const THEMES = [...DOOR2_NOTES, "estrutura", "escopo", "preferencias"];

/**
 * The rule of AC 5 for one section of the question bank: 3 to 8 numbered questions and the note it fills. Returns
 * what is wrong with it, or null.
 */
function themeProblem(name: string, body: string): string | null {
  const questions = body.split("\n").filter((l) => /^\d+\. \S/.test(l)).length;
  if (questions < 3 || questions > 8) return `${name}: ${questions} questions`;
  const fills = body.match(/^Preenche: `([^`]+)`$/m)?.[1];
  if (!fills) return `${name}: no note it fills`;
  if (DOOR2_NOTES.includes(name))
    return fills === `notes/negocio/${name}.md` ? null : `${name}: fills ${fills}`;
  if (name === "contexto") return fills === "notes/<id>/_resumo.md" ? null : `${name}: fills ${fills}`;
  return DOOR2_NOTES.some((n) => fills === `notes/negocio/${n}.md`) ? null : `${name}: fills ${fills}`;
}
/** The `## <name>` sections of the question bank, in order. */
function themes(md: string): Array<{ name: string; body: string }> {
  return [...md.matchAll(/^## (\S+)$/gm)].map((m) => ({ name: m[1]!, body: section(md, `## ${m[1]}`) }));
}

describe.skipIf(!POSIX)("S1 the skill organize-brain, its guide and its question bank", () => {
  let w: OrganizeWorld;
  let dir: string;
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

  beforeAll(async () => {
    w = await organizeWorld("mordomo-organize-skill-");
    const skill = w.ctx.skills.load(SLUG);
    expect(skill, "organize-brain is in the seeded home").not.toBeNull();
    dir = skill!.dir;
  });
  afterAll(async () => {
    await w.close();
  });

  /** Start organize-brain through the route and wait for it; the prompt is what the adapter was handed. */
  async function runIt(
    body: Json,
  ): Promise<{ run: Json; prompt: string; env: Record<string, string> | undefined }> {
    const res = await w.call("POST", `/api/skills/${SLUG}/run`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { run, agent } = await w.finished(res.body.runId as string);
    expect(agent, "the agent was handed the run").toBeDefined();
    return { run, prompt: agent!.prompt, env: agent!.extraEnv };
  }

  it("C1 GET /api/skills/organize-brain gives mode write, providers [claude], the inputs etapa then folder, and the pt-BR name", async () => {
    const res = await w.call("GET", `/api/skills/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("write");
    expect(res.body.providers).toEqual(["claude"]);
    const inputs = res.body.inputs as Json[];
    expect(inputs.map((i) => i.name)).toEqual(["etapa", "folder"]);
    expect(inputs[0]).toMatchObject({
      name: "etapa",
      type: "select",
      options: ["entrevista", "aplicar", "indexar"],
      required: false,
      placeholder: "entrevista",
    });
    expect(inputs[1]).toMatchObject({ name: "folder", type: "path", required: false });
    expect(res.body.i18n["pt-BR"].name).toBe("Organizar o Cérebro");
  });

  it("C2 the catalog lists exactly the two markdown resources and the resource route serves each", async () => {
    const res = await w.call("GET", `/api/skills/${SLUG}`);
    expect(res.body.resources).toEqual(["resources/guia.md", "resources/perguntas.md"]);
    expect((res.body.resourceFiles as Json[]).map((r) => [r.rel, r.kind])).toEqual([
      ["resources/guia.md", "markdown"],
      ["resources/perguntas.md", "markdown"],
    ]);
    for (const rel of ["resources/guia.md", "resources/perguntas.md"]) {
      const served = await w.app.inject({
        method: "GET",
        url: `/api/skills/${SLUG}/resource?rel=${encodeURIComponent(rel)}`,
        headers: { "x-mordomo-token": w.ctx.token() },
      });
      expect(served.statusCode, rel).toBe(200);
      expect(served.body, rel).toBe(read(rel));
    }
  });

  it("C3 the guide names the 11 types, 5 statuses, 5 naturezas, 3 escopos, review_every, the 5 callouts, and that the owner may add types and statuses", () => {
    const guide = read("resources/guia.md");
    expect(new Set(firstColumn(section(guide, "### type")))).toEqual(
      new Set([
        "context",
        "guide",
        "project",
        "decision",
        "reference",
        "log",
        "goals",
        "profile",
        "index",
        "inbox",
        "brief",
      ]),
    );
    expect(firstColumn(section(guide, "### type"))).toHaveLength(11);
    expect(firstColumn(section(guide, "### status"))).toEqual([
      "active",
      "draft",
      "paused",
      "done",
      "archived",
    ]);
    const natureza = section(guide, "### natureza");
    expect(firstColumn(natureza)).toEqual(["fato", "opiniao", "plano", "hipotese", "relato"]);
    expect(flat(natureza)).toMatch(/sem `natureza` não está classificada/);
    expect(firstColumn(section(guide, "### escopo"))).toEqual(["pessoal", "equipe", "externo"]);
    const review = section(guide, "### review_every");
    for (const value of ["30d", "90d", "never"]) expect(review, value).toContain(`\`${value}\``);
    expect(firstColumn(section(guide, "### Callouts"))).toEqual([
      "> [!fato]",
      "> [!opiniao]",
      "> [!plano]",
      "> [!hipotese]",
      "> [!relato]",
    ]);
    expect(flat(guide)).toMatch(/dono pode acrescentar valores de `type` e de `status` na entrevista/);
  });

  it("C4 the guide's rules section holds the 7 rules of AC 4 and the exception of the context's brief", () => {
    const rules = section(read("resources/guia.md"), "## Regras");
    expect(rules.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(7);
    const text = flat(rules);
    const expected: Array<[string, RegExp]> = [
      ["write only under the memory folder", /Escreva só dentro da pasta de memória/],
      ["no file at the top of notes/", /Nunca crie um arquivo no topo de `notes\/`/],
      [
        "nothing moved, renamed, edited or deleted outside",
        /Nunca mova, renomeie, edite ou apague um arquivo fora da pasta de memória/,
      ],
      [
        "no overwrite without generated-by",
        /Nunca sobrescreva um arquivo cujo front matter não tem `generated-by: organize-brain`/,
      ],
      ["pointers, not copied content", /nota-índice guarda ponteiros, não conteúdo copiado/],
      [
        "a plan or opinion never written as a fact",
        /plano ou uma opinião nunca é escrito como fato: leva `natureza: plano` ou `natureza: opiniao`, ou o callout `> \[!plano\]` ou `> \[!opiniao\]`/,
      ],
      [
        "classifying outside is a proposal",
        /Classificar uma nota que já existe fora da pasta de memória é uma proposta no relatório, nunca uma escrita/,
      ],
      [
        "the exception of the run's context brief",
        /Exceção: o `_resumo\.md` do contexto de trabalho da execução\. A etapa `aplicar` só preenche uma seção vazia e nunca reescreve o texto de uma seção; um resumo que falta é criado com `type: brief`, `status: active` e as quatro seções `## O que é`, `## O que importa`, `## Metas` e `## O que ignorar`/,
      ],
    ];
    for (const [what, pattern] of expected) expect(text, what).toMatch(pattern);
  });

  it("C5 the question bank has exactly the 15 themes, each with 3 to 8 questions and the note it fills, and the section contexto", () => {
    // The rule itself refuses a section with 2 questions and one with 9.
    const fixture = (n: number) =>
      `Preenche: \`notes/negocio/voz.md\`\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. Pergunta ${i}?`).join("\n")}`;
    expect(themeProblem("voz", fixture(2))).toBe("voz: 2 questions");
    expect(themeProblem("voz", fixture(9))).toBe("voz: 9 questions");
    expect(themeProblem("voz", fixture(3))).toBeNull();
    expect(themeProblem("voz", fixture(8))).toBeNull();
    expect(themeProblem("voz", fixture(5).replace("voz.md", "marca.md"))).toBe(
      "voz: fills notes/negocio/marca.md",
    );

    const bank = themes(read("resources/perguntas.md"));
    expect(bank.map((t) => t.name)).toEqual([...THEMES, "contexto"]);
    for (const theme of bank) expect(themeProblem(theme.name, theme.body), theme.name).toBeNull();
  });

  it("C6 SKILL.md has one procedure section per etapa, runs entrevista without one, and says what each reads and writes", () => {
    const skill = read("SKILL.md");
    expect([...skill.matchAll(/^## Etapa (\S+)$/gm)].map((m) => m[1])).toEqual([
      "entrevista",
      "aplicar",
      "indexar",
    ]);
    expect(flat(skill)).toMatch(/Sem `etapa`, roda `entrevista`/);

    const interview = flat(section(skill, "## Etapa entrevista"));
    expect(interview).toMatch(
      /Escreve só `<pasta de memória>\/inbox\/entrevista-AAAA-MM-DD\.md` \(a data de hoje\), com as perguntas ainda sem resposta/,
    );
    const apply = flat(section(skill, "## Etapa aplicar"));
    expect(apply).toMatch(/Lê a nota de entrevista mais recente de `<pasta de memória>\/inbox\/`/);
    expect(apply).toMatch(/escreve `<pasta de memória>\/notes\/negocio\/\*\.md`/);
    const index = section(skill, "## Etapa indexar");
    expect(flat(index)).toMatch(/Chama `GET \$MORDOMO_URL\/api\/memory\/maps`/);
    expect(flat(index)).toMatch(/`x-mordomo-token: \$MORDOMO_RUN_TOKEN`/);
    expect(flat(index)).toMatch(
      /escreve `_index\.md` no `indexPath` de cada entrada só quando o seu `state` é `missing` ou `stale`/,
    );
    const yaml = index.match(/```yaml\n([\s\S]*?)```/)?.[1] ?? "";
    const keys = yaml
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "---");
    expect(keys.map((l) => l.split(":")[0])).toEqual([
      "type",
      "status",
      "tags",
      "source",
      "children-digest",
      "generated-by",
      "updated",
      "last_reviewed",
    ]);
    expect(keys).toEqual(
      expect.arrayContaining(["type: index", "status: active", "generated-by: organize-brain"]),
    );
  });

  it("C7 the entrevista section skips a question a business note already answers and lists it under Já respondido", () => {
    const interview = flat(section(read("SKILL.md"), "## Etapa entrevista"));
    expect(interview).toMatch(
      /pule a pergunta que uma nota de `notes\/negocio\/` já responde e liste-a sob o título `## Já respondido` da nota da entrevista/,
    );
  });

  it("C8 the prompt of a run with folder holds the memory lines and the folder line; without folder no folder line", async () => {
    const clientes = w.dir("clientes");
    const memory = w.ctx.paths.memory;
    const withFolder = await runIt({ inputs: { etapa: "indexar", folder: clientes } });
    const lines = withFolder.prompt.split("\n");
    for (const line of [
      `Memory folder (an added folder of this run): ${memory}`,
      `  long-term memory: ${path.join(memory, "MEMORY.md")}`,
      `  daily journal: ${path.join(memory, "journal")}/YYYY-MM-DD.md`,
      `Folder to organize (read-only): ${fs.realpathSync(clientes)}`,
    ])
      expect(lines, line).toContain(line);
    const without = await runIt({ inputs: { etapa: "entrevista" } });
    expect(without.prompt).toContain(`Memory folder (an added folder of this run): ${memory}`);
    expect(without.prompt).not.toContain("Folder to organize");
  });

  it("C9 a new home's memorySkills names the three memory skills, and a stored list of two is read as it is", async () => {
    const fresh = makeTempHome("mordomo-organize-c9-");
    try {
      const first = new AppContext(fresh.paths.home);
      expect(first.settings().memorySkills).toEqual(["recall", "consolidate-memory", "organize-brain"]);
      first.settingsStore.save(first.settings());
      first.close();
      const stored = JSON.parse(fs.readFileSync(fresh.paths.settingsFile, "utf8")) as Json;
      stored.memorySkills = ["recall", "consolidate-memory"];
      fs.writeFileSync(fresh.paths.settingsFile, JSON.stringify(stored, null, 2));
      const again = new AppContext(fresh.paths.home);
      expect(again.settings().memorySkills).toEqual(["recall", "consolidate-memory"]);
      again.close();
    } finally {
      fresh.cleanup();
    }
    // The service of the world (a new home too): GET /api/skills marks organize-brain as a memory skill.
    const listed = await w.call("GET", "/api/skills");
    expect((listed.body as unknown as Json[]).find((s) => s.slug === SLUG)?.memoryAccess).toBe(true);
  });

  it("C10 without organize-brain in memorySkills the run has no memory line, no credential, and a line saying how to add it", async () => {
    w.update((s) => {
      s.memorySkills = ["recall", "consolidate-memory"];
    });
    try {
      const { prompt, env } = await runIt({ inputs: { etapa: "entrevista" } });
      expect(prompt).not.toContain("Memory folder");
      expect(env?.MORDOMO_RUN_TOKEN).toBeUndefined();
      const hint = prompt.split("\n").find((l) => l.includes("memorySkills"));
      expect(hint, "a line about memorySkills").toBeDefined();
      expect(hint).toContain(`"${SLUG}" is not in`);
      expect(hint).toContain("PUT /api/settings");
    } finally {
      w.update((s) => {
        s.memorySkills = ["recall", "consolidate-memory", SLUG];
      });
    }
  });

  it("C12 under controlled_write the run answers 200 queued, keeps the profile and ends done; under review_before_write 202 and no agent", async () => {
    const started = await w.call("POST", `/api/skills/${SLUG}/run`, { inputs: { etapa: "entrevista" } });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("queued");
    const { run, agent } = await w.finished(started.body.runId as string);
    expect(run.permissionProfile).toBe("controlled_write");
    expect(run.status).toBe("done");
    expect(agent).toBeDefined();

    w.update((s) => {
      s.securityProfile = "review_before_write";
    });
    try {
      const parked = await w.call("POST", `/api/skills/${SLUG}/run`, { inputs: { etapa: "entrevista" } });
      expect(parked.status).toBe(202);
      expect(parked.body.status).toBe("waiting_approval");
      await new Promise((r) => setTimeout(r, 50));
      expect(w.handed.has(parked.body.runId as string)).toBe(false);
    } finally {
      w.update((s) => {
        s.securityProfile = "controlled_write";
      });
    }
  });

  it("C47 the SKILL.md context section names the id, the context interview, and the brief with type brief and a plano Metas", () => {
    const ctxSection = flat(section(read("SKILL.md"), "## Com um contexto de trabalho"));
    expect(ctxSection).toMatch(/Quando o prompt começa com `Work context:`/);
    expect(ctxSection).toMatch(/Tire o `<id>` do nome do arquivo da linha `Map of the context`/);
    expect(ctxSection).toMatch(
      /`entrevista` escreve `<pasta de memória>\/inbox\/entrevista-<id>-AAAA-MM-DD\.md`, com as perguntas da seção `contexto` de `resources\/perguntas\.md` \(o que é, o que importa, metas, o que ignorar\)/,
    );
    expect(ctxSection).toMatch(
      /`aplicar` lê a nota `entrevista-<id>-\*\.md` mais recente e escreve em `<pasta de memória>\/notes\/<id>\/_resumo\.md`, sob os seus quatro títulos `## O que é`, `## O que importa`, `## Metas` e `## O que ignorar`; mantém `type: brief`; marca a seção `## Metas` com o callout `> \[!plano\]`/,
    );
    // the section of the bank it names asks the four things
    const contexto = themes(read("resources/perguntas.md")).find((t) => t.name === "contexto")!;
    const questions = contexto.body.split("\n").filter((l) => /^\d+\. /.test(l));
    for (const [i, topic] of ["O que é", "O que importa", "metas", "O que ignorar"].entries())
      expect(questions[i], topic).toContain(topic);
  });

  it("C48 the prompt of a run with contextId starts with the context block and holds the folder and memory lines", async () => {
    const first = w.dir("contexto-c48");
    const created = await w.call("POST", "/api/contexts", { name: "Cliente C48", paths: [first] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const memory = w.ctx.paths.memory;
    const { prompt } = await runIt({ contextId: id, inputs: { etapa: "entrevista" } });
    const lines = prompt.split("\n");
    expect(lines[0]).toBe("Work context: Cliente C48");
    expect(lines).toContain(
      `Map of the context (its key files): ${path.join(memory, "contexts", `${id}.md`)}`,
    );
    expect(lines).toContain(`Folder to organize (read-only): ${fs.realpathSync(first)}`);
    expect(lines).toContain(`Memory folder (an added folder of this run): ${memory}`);
    expect(lines).toContain(`  long-term memory: ${path.join(memory, "MEMORY.md")}`);
    expect(lines).toContain(`  daily journal: ${path.join(memory, "journal")}/YYYY-MM-DD.md`);
  });
});
