import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
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
    for (const file of sources("apps/api/src")) {
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
    // The two that are not the bound of a run request: the excerpt a memory search returns, and the description of an objective.
    expect(literals.sort()).toEqual([
      "apps/api/src/routes/memory.ts .max(20000)",
      "apps/api/src/routes/objectives.ts .max(10000)",
    ]);
  });

  /** A source with its imports dropped, every `<path>.events.` read as `events.`, and no whitespace. */
  function comparable(source: string): string {
    const sf = ts.createSourceFile("t.ts", source, ts.ScriptTarget.ES2022, true);
    const kept = sf.statements.filter((s) => !ts.isImportDeclaration(s));
    return kept
      .map((s) => s.getText(sf))
      .join("\n")
      .replace(/(?:[A-Za-z_]\w*\.)*events\./g, "events.")
      .replace(/\s+/g, "");
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
      expect(comparable(head), suite).toBe(comparable(base));
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
