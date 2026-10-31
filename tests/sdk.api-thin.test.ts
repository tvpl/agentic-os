import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { API } from "@mordomo/contracts";
import { RUN_LIMITS } from "@mordomo/core/internal";

/**
 * The HTTP API and the CLI are clients of `engine.execution` (.specs/features/sdk-core, S3): the rules that decide
 * whether a run may start live in the core once, and the code that answers HTTP does not start runs of its own.
 */

const root = path.resolve(import.meta.dirname, "..");
const BASE = "795306e";

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(root, dir));
  return out;
}

const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");

const STARTS = new Set(["create", "execute"]);
/** What takes a run from "decided" to "handed to its provider", or parks it: only the execution service may call them. */
const LAUNCHERS = new Set(["gateAndLaunchSkill", "launchSkillRun", "launchPromptRun"]);

function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

/** The text of a member name written as `.name` or `["name"]`; `null` for a key computed at run time. */
function memberName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const key = unwrap(node.argumentExpression);
  return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key) ? key.text : null;
}

/**
 * What a source file does, by what the syntax tree says and not by what the text looks like: starts a run
 * (`runs.create`, `runs.execute`, through a cast, an element access, an alias of `runs` or a destructuring), parks or
 * launches one (`gateWrite`, `gateAndLaunchSkill`, `launchSkillRun`, `launchPromptRun`), writes a receipt. A member
 * named by a key computed at run time counts as the worst it could be. Not seen: a `runs` handed in through a
 * parameter under another name, and what is built by `eval` or a string of code (a declared blind spot).
 */
function calls(file: string) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found = { runStarts: 0, gates: 0, receiptWrites: 0, launches: 0 };
  const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  // The names that stand for the run manager: `runs`, and whatever it was given to (`const r = ctx.runs`,
  // `const { runs: r } = ctx`, `r2 = r`), until nothing new is found.
  const aliases = new Set<string>(["runs"]);
  const isRuns = (expression: ts.Expression): boolean => {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return memberName(node) === "runs";
    return false;
  };
  for (let grew = true; grew;) {
    grew = false;
    const learn = (name: string) => {
      if (!aliases.has(name)) {
        aliases.add(name);
        grew = true;
      }
    };
    walk(sf, (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name) && isRuns(node.initializer)) learn(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const from = element.propertyName?.getText(sf) ?? element.name.getText(sf);
            if (from.replace(/['"]/g, "") === "runs" && ts.isIdentifier(element.name))
              learn(element.name.text);
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        isRuns(node.right)
      )
        learn(node.left.text);
    });
  }
  walk(sf, (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node);
      if (isRuns(node.expression) && (name === null || STARTS.has(name))) found.runStarts++;
      if (name === "gateWrite") found.gates++;
      if (name !== null && LAUNCHERS.has(name)) found.launches++;
    }
    // `const { create } = ctx.runs`: the method taken off the manager without being called yet.
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectBindingPattern(node.name) &&
      isRuns(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const taken = (element.propertyName ?? element.name).getText(sf).replace(/['"]/g, "");
        if (STARTS.has(taken) || element.dotDotDotToken) found.runStarts++;
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(unwrap(node.expression))) {
      const callee = (unwrap(node.expression) as ts.Identifier).text;
      if (callee === "gateWrite") found.gates++;
      if (LAUNCHERS.has(callee)) found.launches++;
    }
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      /(INSERT INTO|UPDATE|DELETE FROM)\s+(prompt_submissions|run_action_receipts)/i.test(node.getText(sf))
    ) {
      found.receiptWrites++;
    }
  });
  return found;
}

describe("S3 the API and the CLI start nothing of their own", () => {
  it("C28 only the engine's execution, the scheduler and the triage start a run; the API starts none", () => {
    const files = [...sources("core/src"), ...sources("apps/api/src")];
    const byFile = new Map(files.map((file) => [rel(file), calls(file)]));
    const where = (key: "runStarts" | "gates" | "receiptWrites" | "launches") =>
      [...byFile].filter(([, found]) => found[key] > 0).map(([file]) => file);

    expect(where("runStarts")).toEqual([
      "core/src/engine.ts",
      "core/src/execution/launch.ts",
      "core/src/execution/service.ts",
      "core/src/routines/scheduler.ts",
      "core/src/sentinels/triage.ts",
    ]);
    expect(where("gates")).toEqual(["core/src/execution/service.ts"]);
    expect(where("receiptWrites")).toEqual(["core/src/execution/service.ts"]);
    // Handing a decided run to its provider is the service's. The one thing outside it is the dispatch of an
    // objective's step, which repeats a request the engine stored itself (`Objective step: ...`), once, through the
    // service's own `gateAndLaunchSkill` - so that the gate and the budget of the skill still apply.
    expect(where("launches").sort()).toEqual([
      "apps/api/src/routes/objectives.ts",
      "core/src/execution/service.ts",
    ]);
    expect(byFile.get("apps/api/src/routes/objectives.ts")?.launches).toBe(1);
    for (const file of byFile.keys()) {
      if (file.startsWith("apps/api/src/"))
        expect(byFile.get(file), file).toEqual({
          runStarts: 0,
          gates: 0,
          receiptWrites: 0,
          launches: file === "apps/api/src/routes/objectives.ts" ? 1 : 0,
        });
    }
  });

  it("C28 the reader sees the shapes it claims to forbid", () => {
    const tmp = path.join(root, "tests", ".tmp");
    fs.mkdirSync(tmp, { recursive: true });
    const read = (name: string, lines: string[]) => {
      const probe = path.join(tmp, `api-thin-${name}.ts`);
      fs.writeFileSync(probe, ["declare const ctx: any;", ...lines].join("\n"));
      try {
        return calls(probe);
      } finally {
        fs.rmSync(probe, { force: true });
      }
    };
    const none = { runStarts: 0, gates: 0, receiptWrites: 0, launches: 0 };
    expect(
      read("plain", [
        "ctx.runs.create({});",
        "await ctx.runs.execute('id', 'p', 'read_only');",
        "ctx.gateWrite('write', 'manual', 'd', {});",
        "gateWrite();",
        "ctx.db.prepare('INSERT INTO prompt_submissions(id) VALUES (?)');",
        "const sql = `UPDATE run_action_receipts SET response = ?`;",
        "ctx.runs.list();",
        "ctx.db.prepare('SELECT * FROM prompt_submissions');",
      ]),
    ).toEqual({ ...none, runStarts: 2, gates: 2, receiptWrites: 2 });
    // F41: the method named by a string, behind a cast.
    expect(read("element", ["(ctx.runs as any)['create']({});"])).toEqual({ ...none, runStarts: 1 });
    expect(read("element-runs", ["ctx['runs'].execute('id', 'p', 'write');"])).toEqual({
      ...none,
      runStarts: 1,
    });
    // A key computed at run time is the worst it could be.
    expect(read("computed", ["const m = 'cre' + 'ate';", "ctx.runs[m]({});"])).toEqual({
      ...none,
      runStarts: 1,
    });
    // F42: the manager kept under another name, one hop or two, or taken apart.
    expect(read("alias", ["const r = ctx.runs;", "r.create({});"])).toEqual({ ...none, runStarts: 1 });
    expect(read("alias-2", ["const a = ctx.runs;", "let b;", "b = a;", "b.execute('i', 'p', 'm');"])).toEqual(
      {
        ...none,
        runStarts: 1,
      },
    );
    expect(read("from-ctx", ["const { runs: manager } = ctx;", "manager.create({});"])).toEqual({
      ...none,
      runStarts: 1,
    });
    expect(read("taken-off", ["const { create } = ctx.runs;", "create({});"])).toEqual({
      ...none,
      runStarts: 1,
    });
    expect(read("assigned-only", ["const f = ctx.runs.create;"])).toEqual({ ...none, runStarts: 1 });
    // F43: a decided run handed to its provider without the rules of the service.
    expect(
      read("launch", [
        "ctx.execution.gateAndLaunchSkill({}, 'd', () => {});",
        "launchPromptRun({}, {}, () => {});",
        "ctx.execution['gateAndLaunchSkill']({});",
      ]),
    ).toEqual({ ...none, launches: 3 });
    expect(read("gate-element", ["ctx['gateWrite']('write', 'manual', 'd', {});"])).toEqual({
      ...none,
      gates: 1,
    });
    // What is not a start: another object with the same method names, and reading the list.
    expect(
      read("others", ["ctx.sessions.create({});", "const x = ctx.runs;", "x.list();", "x.get('id');"]),
    ).toEqual(none);
  });

  it("C68 the routes take the bounds of a run request from RUN_LIMITS, not from numbers of their own", () => {
    const bounds = new Set<number>(Object.values(RUN_LIMITS));
    const literals: string[] = [];
    for (const file of [...sources("apps/api/src"), ...sources("contracts/src/api")]) {
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["min", "max"].includes(node.expression.name.text) &&
          node.arguments[0] &&
          ts.isNumericLiteral(node.arguments[0]) &&
          bounds.has(Number(node.arguments[0].text.replace(/_/g, "")))
        )
          literals.push(`${rel(file)} .${node.expression.name.text}(${node.arguments[0].text})`);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    // The route bodies live in the contract since contratos-rest (`contracts/src/api`, which takes the bounds of a run
    // request from the same `RUN_LIMITS`), so the scan reads both places. The two that are not the bound of a run
    // request: the excerpt a memory search returns, and the description of an objective.
    expect(literals.sort()).toEqual([
      "contracts/src/api/memory.ts .max(20000)",
      "contracts/src/api/routines.ts .max(10000)",
    ]);
  });

  it("C68 the request schemas take their bounds from RUN_LIMITS through RunTimeout and RunPrompt, and nothing else", () => {
    const flat = (text: string) => text.replace(/\s+/g, "");
    const parse = (file: string) =>
      ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.ES2022, true);
    // The definitions: one place each, written in terms of RUN_LIMITS.
    const definition = (file: string, name: string): string => {
      const sf = parse(file);
      let found = "";
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name && node.initializer)
          found = flat(node.initializer.getText(sf));
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return found;
    };
    expect(definition("contracts/src/api/common.ts", "RunTimeout")).toBe(
      flat("z.number().int().min(RUN_LIMITS.timeoutMinMs).max(RUN_LIMITS.timeoutMaxMs)"),
    );
    expect(definition("contracts/src/api/common.ts", "RunPrompt")).toBe(
      flat("z.string().min(1).max(RUN_LIMITS.promptMaxChars)"),
    );
    expect(definition("core/src/execution/schemas.ts", "Timeout")).toBe(
      flat("z.number().int().min(RUN_LIMITS.timeoutMinMs).max(RUN_LIMITS.timeoutMaxMs)"),
    );
    // The users: every request field of the contract's routes named `timeoutMs`, `prompt` or `prompts` is built from
    // them (the responses in `wire.ts` describe what is stored, not what is asked).
    const used: string[] = [];
    const wrong: string[] = [];
    for (const file of sources("contracts/src/api")) {
      if (path.basename(file) === "wire.ts") continue;
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          ["timeoutMs", "prompt", "prompts"].includes(node.name.getText(sf))
        ) {
          const name = node.name.getText(sf);
          const code = flat(node.initializer.getText(sf));
          const wanted = name === "timeoutMs" ? "RunTimeout" : "RunPrompt";
          used.push(`${rel(file)} ${name}`);
          if (!code.includes(wanted) || /\d_?\d{3}/.test(code)) wrong.push(`${rel(file)} ${name}: ${code}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(wrong).toEqual([]);
    expect(used.sort()).toEqual([
      "contracts/src/api/routines.ts prompt",
      "contracts/src/api/routines.ts prompt",
      "contracts/src/api/routines.ts timeoutMs",
      "contracts/src/api/runs.ts prompt",
      "contracts/src/api/runs.ts prompt",
      "contracts/src/api/runs.ts prompts",
      "contracts/src/api/runs.ts timeoutMs",
      "contracts/src/api/runs.ts timeoutMs",
      "contracts/src/api/skills.ts timeoutMs",
    ]);
  });

  it("C74 the schemas the routes parse with hold the bounds: 20 000 characters, 10 000 to 3 600 000 ms, in the ten fields", () => {
    // The text of the schema can say RUN_LIMITS and still not bound anything (`RunTimeout.or(z.number())`): this reads
    // the schema that is parsed.
    const long = (n: number) => "p".repeat(n);
    const step = (kind: "prompt" | "system", prompt: string) => ({
      title: "Step",
      request: { version: 1, kind, prompt, mode: "read_only" },
    });
    const fields: Array<{
      label: string;
      schema: { safeParse(value: unknown): { success: boolean } };
      prompt?: (n: number) => unknown;
      timeout?: (ms: number) => unknown;
    }> = [
      {
        label: "runs.create",
        schema: API["runs.create"].body,
        prompt: (n) => ({ prompt: long(n) }),
        timeout: (ms) => ({ prompt: "x", timeoutMs: ms }),
      },
      {
        label: "runs.children.create",
        schema: API["runs.children.create"].body,
        prompt: (n) => ({ prompts: [long(n)] }),
        timeout: (ms) => ({ prompts: ["x"], timeoutMs: ms }),
      },
      {
        label: "sessions.continue",
        schema: API["sessions.continue"].body,
        prompt: (n) => ({ prompt: long(n) }),
        timeout: (ms) => ({ prompt: "x", timeoutMs: ms }),
      },
      { label: "skills.run", schema: API["skills.run"].body, timeout: (ms) => ({ timeoutMs: ms }) },
      {
        label: "objectives.create (prompt step)",
        schema: API["objectives.create"].body,
        prompt: (n) => ({ title: "O", steps: [step("prompt", long(n))] }),
      },
      {
        label: "objectives.create (system step)",
        schema: API["objectives.create"].body,
        prompt: (n) => ({ title: "O", steps: [step("system", long(n))] }),
      },
      {
        label: "objectives.dispatch",
        schema: API["objectives.dispatch"].body,
        timeout: (ms) => ({ timeoutMs: ms }),
      },
    ];
    let checked = 0;
    for (const { label, schema, prompt, timeout } of fields) {
      if (prompt) {
        expect(schema.safeParse(prompt(RUN_LIMITS.promptMaxChars)).success, `${label}: 20 000`).toBe(true);
        expect(schema.safeParse(prompt(RUN_LIMITS.promptMaxChars + 1)).success, `${label}: 20 001`).toBe(
          false,
        );
        expect(schema.safeParse(prompt(0)).success, `${label}: empty`).toBe(false);
        checked += 1;
      }
      if (timeout) {
        expect(schema.safeParse(timeout(RUN_LIMITS.timeoutMinMs)).success, `${label}: 10 000`).toBe(true);
        expect(schema.safeParse(timeout(RUN_LIMITS.timeoutMaxMs)).success, `${label}: 3 600 000`).toBe(true);
        expect(schema.safeParse(timeout(RUN_LIMITS.timeoutMinMs - 1)).success, `${label}: 9 999`).toBe(false);
        expect(schema.safeParse(timeout(RUN_LIMITS.timeoutMaxMs + 1)).success, `${label}: 3 600 001`).toBe(
          false,
        );
        expect(
          schema.safeParse(timeout(1.5 * RUN_LIMITS.timeoutMinMs + 0.5)).success,
          `${label}: fraction`,
        ).toBe(false);
        checked += 1;
      }
    }
    // Five prompts (runs, children, continue, the two kinds of step) and five timeouts (runs, children, continue,
    // skills run, dispatch): the fields of the contract that carry the bounds of a run request.
    expect(checked).toBe(10);
  });

  it("C74 RunTimeout and RunPrompt are used as they are: nothing but .optional() is chained to them anywhere", () => {
    const misuse: string[] = [];
    for (const file of [...sources("contracts/src"), ...sources("apps/api/src"), ...sources("core/src")]) {
      const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && (node.text === "RunTimeout" || node.text === "RunPrompt")) {
          const parent = node.parent;
          if (
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            parent.name.text !== "optional"
          )
            misuse.push(`${rel(file)}: ${parent.getText(sf)}`);
          if (ts.isElementAccessExpression(parent) && parent.expression === node)
            misuse.push(`${rel(file)}: ${parent.getText(sf)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(misuse).toEqual([]);
  });

  /** Every `<path>.events.` read as `events.`, and no whitespace. */
  const squash = (code: string): string =>
    code.replace(/(?:[A-Za-z_]\w*\.)*events\./g, "events.").replace(/\s+/g, "");

  /** A source with its imports dropped, every `<path>.events.` read as `events.`, and no whitespace. */
  function comparable(source: string): string {
    const sf = ts.createSourceFile("t.ts", source, ts.ScriptTarget.ES2022, true);
    const kept = sf.statements.filter((s) => !ts.isImportDeclaration(s));
    return squash(kept.map((s) => s.getText(sf)).join("\n"));
  }

  /**
   * What contratos-rest changed in these suites, and nothing else: a route registered under `/api` must be bound to an
   * entry of the route table, and an event the bus announces must be one the contract describes. Each amendment is a
   * piece of the base (`base`) and what it became (`head`); the comparison applies them to the base before it
   * compares, and each must match exactly once, so an assertion that changed anywhere else still fails.
   */
  const AMENDMENTS: Array<{ suite: string; why: string; base: string[]; head: string[]; times?: number }> = [
    {
      suite: "tests/api.hardening.test.ts",
      why: "a route that throws, registered by hand for the file",
      base: [
        "  // A route that throws an internal error, to assert the 500 envelope hides details.",
        '  app.get("/api/__boom", { config: { scope: "owner" } }, async () => {',
        "    throw new Error(`secret path ${home}/config/token`);",
        "  });",
      ],
      head: [],
    },
    {
      suite: "tests/api.hardening.test.ts",
      why: "the route that throws is registered through bindEntry for the one test that reads it",
      base: [
        '    const res = await app.inject({ method: "GET", url: "/api/__boom", headers: auth() });',
        "    expect(res.statusCode).toBe(500);",
        "    expect(res.json()).toEqual({",
        '      error: { code: "internal", message: "Internal error" },',
        '      message: "Internal error",',
        "    });",
        '    expect(res.body).not.toContain("secret path");',
        "    expect(res.body).not.toContain(home);",
      ],
      head: [
        "    // A route that throws an internal error, to assert the 500 envelope hides details. Registered through the test",
        "    // helper, as the table is frozen: its entry belongs to this server alone and goes with it.",
        "    const boomApp = await buildServer(ctx);",
        "    const boom = route({",
        '      method: "GET",',
        '      path: "/api/__boom",',
        '      scope: "owner",',
        '      summary: "A route that throws an internal error",',
        '      tag: "test",',
        "      responses: { 200: z.object({}) },",
        "    });",
        "    try {",
        '      registerSyntheticEntry(boomApp, "zz.boom", boom, async () => {',
        "        throw new Error(`secret path ${home}/config/token`);",
        "      });",
        '      const res = await boomApp.inject({ method: "GET", url: "/api/__boom", headers: auth() });',
        "      expect(res.statusCode).toBe(500);",
        "      expect(res.json()).toEqual({",
        '        error: { code: "internal", message: "Internal error" },',
        '        message: "Internal error",',
        "      });",
        '      expect(res.body).not.toContain("secret path");',
        "      expect(res.body).not.toContain(home);",
        "    } finally {",
        "      await boomApp.close();",
        "    }",
      ],
    },
    {
      suite: "tests/api.hardening.test.ts",
      why: "the settings.changed events carry the payload the contract describes",
      base: [
        '    const a = ctx.events.emit("settings.changed", { keys: ["a"] });',
        '    const b = ctx.events.emit("settings.changed", { keys: ["b"] });',
      ],
      head: [
        "    // Payloads as the service sends them (the settings document); the system name tells the two events apart.",
        '    const a = ctx.events.emit("settings.changed", { settings: { ...ctx.settings(), systemName: "event-a" } });',
        '    const b = ctx.events.emit("settings.changed", { settings: { ...ctx.settings(), systemName: "event-b" } });',
      ],
    },
    {
      suite: "tests/api.hardening.test.ts",
      why: "\u2026and the test reads the field that tells them apart",
      base: ['    expect(out.text).toContain(\'"keys":["b"]\');'],
      head: ['    expect(out.text).toContain(\'"systemName":"event-b"\');'],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "a route registered by hand under /api is refused for the contract it lacks, public or scoped",
      base: [
        '      expect(() => fresh.get("/api/zz-public", { config: { public: true } }, async () => ({}))).not.toThrow();',
        "      expect(() =>",
        '        fresh.get("/api/zz-monitor", { config: { scope: "monitor" } }, async () => ({})),',
        "      ).not.toThrow();",
      ],
      head: [
        "      // A scope is not enough since contratos-rest: every route also names its entry of the route table (bind), so a",
        "      // public or scoped route registered by hand is refused for the contract it lacks.",
        '      expect(() => fresh.get("/api/zz-public", { config: { public: true } }, async () => ({}))).toThrow(',
        "        /declares no contract/,",
        "      );",
        '      expect(() => fresh.get("/api/zz-monitor", { config: { scope: "monitor" } }, async () => ({}))).toThrow(',
        "        /declares no contract/,",
        "      );",
      ],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "the route at exactly /api is registered through bindEntry",
      base: ['      fresh.get("/api", { config: { scope: "owner" } }, async () => ({ root: true }));'],
      head: [
        "      // Registered through the test helper: the table is frozen, so the entry belongs to this server alone.",
        "      const rootEntry = route({",
        '        method: "GET",',
        '        path: "/api" as never,',
        '        scope: "owner",',
        '        summary: "A route at exactly /api",',
        '        tag: "test",',
        "        responses: { 200: z.object({ root: z.literal(true) }) },",
        "      });",
        '      registerSyntheticEntry(fresh, "zz.root", rootEntry, async () => ({ root: true }));',
      ],
    },
    // cerebro-v2 added five routes (a note, two writes, the links of a note, the cancel of a pass): only the totals the
    // suite pins moved, and a migration (the links between notes) and one (the vectors) joined the later ones.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: five routes more under /api",
      base: ["    expect(routes).toHaveLength(125);"],
      head: ["    expect(routes).toHaveLength(130);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([63, 62]);"],
      head: ["    expect([owners, scoped]).toEqual([66, 64]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(125);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(130);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 63, monitor: 33, content: 22, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 66, monitor: 33, content: 24, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(125);"],
      head: ["    expect(apiRoutes()).toHaveLength(130);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2 and cerebro-correcoes: the migrations after the scopes one include the links between notes, the vectors and the end of the old link table",
      base: [
        "      // Two later migrations (round 1) also run over these rows: who a push subscription and a retry receipt belong to.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        "      ]);",
      ],
      head: [
        "      // Later migrations also run over these rows: who a push subscription and a retry receipt belong to (round 1), and",
        "      // the table of links between notes (cerebro-v2) and the end of the old link table (cerebro-correcoes), which touch",
        "      // none of them.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        "      ]);",
      ],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-v2: the operations of the route document",
      base: ["    expect(operations).toBe(127);"],
      head: ["    expect(operations).toBe(132);"],
    },
    // cerebro-contextos added four routes (the work contexts: one list for content, three writes for the owner): only
    // the totals the suite pins moved again, on top of the ones above.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: four routes more under /api",
      base: ["    expect(routes).toHaveLength(130);"],
      head: ["    expect(routes).toHaveLength(134);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([66, 64]);"],
      head: ["    expect([owners, scoped]).toEqual([69, 65]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(130);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(134);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 66, monitor: 33, content: 24, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 69, monitor: 33, content: 25, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(130);"],
      head: ["    expect(apiRoutes()).toHaveLength(134);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: the operations of the route document",
      base: ["    expect(operations).toBe(132);"],
      head: ["    expect(operations).toBe(136);"],
    },
    // cerebro-contextos, batch B: migration 23 (the work context of a run and of a conversation) runs over the old rows
    // too, and the run credential reaches the search (door 8), read as its recall is.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: migration 23 after the scopes one",
      base: [
        "      // Later migrations also run over these rows: who a push subscription and a retry receipt belong to (round 1), and",
        "      // the table of links between notes (cerebro-v2) and the end of the old link table (cerebro-correcoes), which touch",
        "      // none of them.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        "      ]);",
      ],
      head: [
        "      // Later migrations also run over these rows: who a push subscription and a retry receipt belong to (round 1), and",
        "      // the table of links between notes (cerebro-v2) and the end of the old link table (cerebro-correcoes), which touch",
        "      // none of them, and the work context of a run (cerebro-contextos), a column that reads NULL on the old run.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        "      ]);",
      ],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-contextos: the run credential reaches the search (door 8)",
      base: ['      "GET /api/memory/recall/stats",', '      "GET /api/memory/journal",'],
      head: [
        '      "GET /api/memory/recall/stats",',
        "      // cerebro-contextos, door 8: the search, read as the recall is",
        '      "GET /api/memory/search",',
        '      "GET /api/memory/journal",',
      ],
    },
    // cerebro-organizar added one route (the folder map, for content and for a run's credential): only the totals the
    // suite pins moved, and the run credential's list of reads gained it.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: one route more under /api",
      base: ["    expect(routes).toHaveLength(134);"],
      head: ["    expect(routes).toHaveLength(135);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([69, 65]);"],
      head: ["    expect([owners, scoped]).toEqual([69, 66]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(134);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(135);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 69, monitor: 33, content: 25, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 69, monitor: 33, content: 26, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(134);"],
      head: ["    expect(apiRoutes()).toHaveLength(135);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: the operations of the route document",
      base: ["    expect(operations).toBe(136);"],
      head: ["    expect(operations).toBe(137);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-organizar: the run credential reaches the folder map (door 10)",
      base: ['      "GET /api/memory/facts",', "    ];", "    const WRITES"],
      head: [
        '      "GET /api/memory/facts",',
        "      // cerebro-organizar, door 10: the folder map, read as memory/notes/ and the run's folders",
        '      "GET /api/memory/maps",',
        "    ];",
        "    const WRITES",
      ],
    },
    // cerebro-vista-notas added two routes (the notes tree for content, the properties of a note for the owner): only the
    // totals the suite pins moved.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: two routes more under /api",
      base: ["    expect(routes).toHaveLength(135);"],
      head: ["    expect(routes).toHaveLength(137);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([69, 66]);"],
      head: ["    expect([owners, scoped]).toEqual([70, 67]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(135);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(137);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 69, monitor: 33, content: 26, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 70, monitor: 33, content: 27, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(135);"],
      head: ["    expect(apiRoutes()).toHaveLength(137);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-vista-notas: the operations of the route document",
      base: ["    expect(operations).toBe(137);"],
      head: ["    expect(operations).toBe(139);"],
    },
    // cerebro-faxina-guiada added three routes (the inventory and a scan for content, the start of a scan for the owner)
    // and migration 24 (the signatures and decisions of the cleanup): only the totals and the list of later migrations
    // the suite pins moved.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: three routes more under /api",
      base: ["    expect(routes).toHaveLength(137);"],
      head: ["    expect(routes).toHaveLength(140);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([70, 67]);"],
      head: ["    expect([owners, scoped]).toEqual([71, 69]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(137);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(140);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 70, monitor: 33, content: 27, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 71, monitor: 33, content: 29, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(137);"],
      head: ["    expect(apiRoutes()).toHaveLength(140);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: the operations of the route document",
      base: ["    expect(operations).toBe(139);"],
      head: ["    expect(operations).toBe(142);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada: migration 24 after the scopes one",
      base: [
        "      // none of them, and the work context of a run (cerebro-contextos), a column that reads NULL on the old run.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        "      ]);",
      ],
      head: [
        "      // none of them, and the work context of a run (cerebro-contextos), a column that reads NULL on the old run, and",
        "      // the signatures and decisions of the cleanup (cerebro-faxina-guiada), two new tables.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        "      ]);",
      ],
    },
    // cerebro-faxina-guiada, batch B, added three owner routes (the decisions, the apply and the undo): only the totals
    // the suite pins moved again, on top of batch A's.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: three routes more under /api",
      base: ["    expect(routes).toHaveLength(140);"],
      head: ["    expect(routes).toHaveLength(143);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([71, 69]);"],
      head: ["    expect([owners, scoped]).toEqual([74, 69]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(140);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(143);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 71, monitor: 33, content: 29, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 74, monitor: 33, content: 29, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(140);"],
      head: ["    expect(apiRoutes()).toHaveLength(143);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-faxina-guiada batch B: the operations of the route document",
      base: ["    expect(operations).toBe(142);"],
      head: ["    expect(operations).toBe(145);"],
    },
    // cerebro-natureza added migration 25 (the passages of a note and the review state of a file): only the list of
    // later migrations the suite pins moved, on top of cerebro-faxina-guiada's.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza: migration 25 after the scopes one",
      base: [
        "      // the signatures and decisions of the cleanup (cerebro-faxina-guiada), two new tables.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        "      ]);",
      ],
      head: [
        "      // the signatures and decisions of the cleanup (cerebro-faxina-guiada), two new tables, and the passages of a",
        "      // note and the review state of a file (cerebro-natureza), two more.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        '        "natureza",',
        "      ]);",
      ],
    },
    // cerebro-natureza, batch B, added the review queue (content) and the decision on it (owner): only the totals the
    // suite pins moved again, on top of cerebro-faxina-guiada's.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: two routes more under /api",
      base: ["    expect(routes).toHaveLength(143);"],
      head: ["    expect(routes).toHaveLength(145);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([74, 69]);"],
      head: ["    expect([owners, scoped]).toEqual([75, 70]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(143);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(145);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 74, monitor: 33, content: 29, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 75, monitor: 33, content: 30, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(143);"],
      head: ["    expect(apiRoutes()).toHaveLength(145);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-natureza batch B: the operations of the route document",
      base: ["    expect(operations).toBe(145);"],
      head: ["    expect(operations).toBe(147);"],
    },
    // cerebro-paineis, batch A, added migration 26 (the tasks of a note, the snapshots and series of the dashboards)
    // and six routes of the dashboards (two content, four owner): only the list of later migrations and the totals
    // the suite pins moved, on top of cerebro-natureza's.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis: migration 26 after the scopes one",
      base: [
        "      // note and the review state of a file (cerebro-natureza), two more.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        '        "natureza",',
        "      ]);",
      ],
      head: [
        "      // note and the review state of a file (cerebro-natureza), two more, and the tasks of a note and the snapshots",
        "      // and series of the dashboards (cerebro-paineis), three more.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        '        "natureza",',
        '        "dashboards",',
        "      ]);",
      ],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: six routes more under /api",
      base: ["    expect(routes).toHaveLength(145);"],
      head: ["    expect(routes).toHaveLength(151);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: owners and scoped routes",
      base: ["    expect([owners, scoped]).toEqual([75, 70]);"],
      head: ["    expect([owners, scoped]).toEqual([79, 72]);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: the registered routes",
      base: ["    expect(Object.keys(registered)).toHaveLength(145);"],
      head: ["    expect(Object.keys(registered)).toHaveLength(151);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: the routes of each scope, in the router and in the document",
      times: 2,
      base: ["toEqual({ owner: 75, monitor: 33, content: 30, run: 6, approve: 1 });"],
      head: ["toEqual({ owner: 79, monitor: 33, content: 32, run: 6, approve: 1 });"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: the routes after the pairing passes",
      base: ["    expect(apiRoutes()).toHaveLength(145);"],
      head: ["    expect(apiRoutes()).toHaveLength(151);"],
    },
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch A: the operations of the route document",
      base: ["    expect(operations).toBe(147);"],
      head: ["    expect(operations).toBe(153);"],
    },
    // cerebro-paineis, batch B, added migration 27 (the reminder kind of the inbox, door 8) on top of batch A's.
    {
      suite: "tests/device-scopes.test.ts",
      why: "cerebro-paineis batch B: migration 27 after 26",
      base: [
        "      // note and the review state of a file (cerebro-natureza), two more, and the tasks of a note and the snapshots",
        "      // and series of the dashboards (cerebro-paineis), three more.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        '        "natureza",',
        '        "dashboards",',
        "      ]);",
      ],
      head: [
        "      // note and the review state of a file (cerebro-natureza), two more, and the tasks of a note and the snapshots",
        "      // and series of the dashboards (cerebro-paineis), three more, and the reminder kind of the inbox (cerebro-paineis",
        "      // batch B), a table made again with the same rows.",
        "      expect(MIGRATIONS.filter((m) => m.version > target).map((m) => m.name)).toEqual([",
        '        "push-subscription-device",',
        '        "run-action-receipt-requester",',
        '        "note-links",',
        '        "file-vectors",',
        '        "drop-file-links",',
        '        "run-context",',
        '        "cleanup",',
        '        "natureza",',
        '        "dashboards",',
        '        "notification-reminder",',
        "      ]);",
      ],
    },
  ];

  function amended(suite: string, comparableBase: string): string {
    let out = comparableBase;
    for (const a of AMENDMENTS.filter((x) => x.suite === suite)) {
      const from = squash(a.base.join("\n"));
      const to = squash(a.head.join("\n"));
      expect(out.split(from).length - 1, `${suite}: ${a.why}`).toBe(a.times ?? 1);
      out = out.split(from).join(to);
    }
    return out;
  }

  const SUITES = [
    "tests/api.profiles.test.ts",
    "tests/api.submission.test.ts",
    "tests/api.run-retry.test.ts",
    "tests/api.hardening.test.ts",
    "tests/device-scopes.test.ts",
    "tests/api.sessions.test.ts",
    "tests/api.objectives.test.ts",
    "tests/cli.write-gate.test.ts",
  ];

  it("C29 the eight suites of the routes keep every assertion of the base", () => {
    for (const suite of SUITES) {
      const base = execFileSync("git", ["show", `${BASE}:${suite}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const head = fs.readFileSync(path.join(root, suite), "utf8");
      expect(comparable(head), suite).toBe(amended(suite, comparable(base)));
    }
  });

  it("C29 the comparison sees a changed assertion and ignores imports and the way to the bus", () => {
    const base =
      'import { events } from "@mordomo/core";\nit("x", () => { expect(events.lastId).toBe(1); });';
    const moved =
      'import type { A } from "x";\nimport { B } from "y";\nit("x", () => { expect(ctx.events.lastId).toBe(1); });';
    const weakened =
      'import { events } from "@mordomo/core";\nit("x", () => { expect(events.lastId).toBeGreaterThan(0); });';
    expect(comparable(moved)).toBe(comparable(base));
    expect(comparable(weakened)).not.toBe(comparable(base));
  });
});
