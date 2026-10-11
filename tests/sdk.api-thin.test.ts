import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

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

/** Calls in a source file by what the syntax tree says, not by what the text looks like. */
function calls(file: string) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found = { runStarts: 0, gates: 0, receiptWrites: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const receiver = callee.expression.getText(sf);
        if ((method === "create" || method === "execute") && /(^|\.)runs$/.test(receiver)) found.runStarts++;
        if (method === "gateWrite") found.gates++;
      } else if (ts.isIdentifier(callee) && callee.text === "gateWrite") found.gates++;
    }
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      /(INSERT INTO|UPDATE|DELETE FROM)\s+(prompt_submissions|run_action_receipts)/i.test(node.getText(sf))
    ) {
      found.receiptWrites++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("S3 the API and the CLI start nothing of their own", () => {
  it("C28 only the engine's execution, the scheduler and the triage start a run; the API starts none", () => {
    const files = [...sources("core/src"), ...sources("apps/api/src")];
    const byFile = new Map(files.map((file) => [rel(file), calls(file)]));
    const where = (key: "runStarts" | "gates" | "receiptWrites") =>
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
    for (const file of byFile.keys()) {
      if (file.startsWith("apps/api/src/"))
        expect(byFile.get(file), file).toEqual({ runStarts: 0, gates: 0, receiptWrites: 0 });
    }
  });

  it("C28 the reader sees the shapes it claims to forbid", () => {
    const tmp = path.join(root, "tests", ".tmp");
    fs.mkdirSync(tmp, { recursive: true });
    const probe = path.join(tmp, "api-thin-probe.ts");
    fs.writeFileSync(
      probe,
      [
        "declare const ctx: any;",
        "ctx.runs.create({});",
        "await ctx.runs.execute('id', 'p', 'read_only');",
        "ctx.gateWrite('write', 'manual', 'd', {});",
        "gateWrite();",
        "ctx.db.prepare('INSERT INTO prompt_submissions(id) VALUES (?)');",
        "const sql = `UPDATE run_action_receipts SET response = ?`;",
        "ctx.runs.list();",
        "ctx.db.prepare('SELECT * FROM prompt_submissions');",
      ].join("\n"),
    );
    try {
      expect(calls(probe)).toEqual({ runStarts: 2, gates: 2, receiptWrites: 2 });
    } finally {
      fs.rmSync(probe, { force: true });
    }
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
