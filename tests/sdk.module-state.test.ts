import { describe, expect, it } from "vitest";
import { moduleState } from "./support/moduleState.js";

/**
 * The reader of module-level state (tests/support/moduleState.ts) against small sources: each shape it must accuse
 * and each it must let pass (.specs/features/sdk-core, C49). A reader that accuses nothing, or everything, would
 * make the closed list of C30 mean nothing.
 */

const names = (source: string) => moduleState(source).map((finding) => finding.name);

describe("C49 the reader of module-level state", () => {
  const accused: Array<[string, string, string[]]> = [
    ["let", "let counter = 0;", ["counter"]],
    ["var", "var legacy;", ["legacy"]],
    ["export let", "export let current = null;", ["current"]],
    ["new Map", "const cache = new Map<string, number>();", ["cache"]],
    [
      "new Set read only",
      "const seen = new Set<string>();\nexport const has = (k: string) => seen.has(k);",
      ["seen"],
    ],
    ["new Set added to", "const seen = new Set<string>();\nseen.add('a');", ["seen"]],
    ["new WeakMap", "const keyed = new WeakMap<object, number>();", ["keyed"]],
    ["a filled Set added to", "const names = new Set(['a']);\nnames.add('b');", ["names"]],
    [
      "a filled Map set into",
      "const table = new Map([['a', 1]]);\nexport function put() { table.set('b', 2); }",
      ["table"],
    ],
    ["a class instance", "const bus = new EventBus();", ["bus"]],
    ["a cast class instance", "const bus = new EventBus() as unknown as Bus;", ["bus"]],
    ["object assigned to", "const state = { n: 0 };\nexport function bump() { state.n = 1; }", ["state"]],
    ["object indexed", "const table = {};\nexport function put(k: string) { table[k] = 1; }", ["table"]],
    ["object compound", "const totals = { n: 0 };\nexport function add() { totals.n += 1; }", ["totals"]],
    ["object deleted from", "const live = { a: 1 };\nexport function drop() { delete live.a; }", ["live"]],
    ["object assigned by Object.assign", "const base = {};\nObject.assign(base, { a: 1 });", ["base"]],
    [
      "array pushed to",
      "const queue: number[] = [];\nexport function add(n: number) { queue.push(n); }",
      ["queue"],
    ],
    ["array spliced", "const queue = [1, 2];\nexport function take() { queue.splice(0, 1); }", ["queue"]],
    ["array indexed", "const slots = [0];\nexport function set() { slots[0] = 1; }", ["slots"]],
    ["a static property with a value", "class Pool { static open = new Map(); }", ["Pool.open"]],
    [
      "a registry kept on globalThis",
      "const KEY = Symbol.for('x');\nexport function held() { return ((globalThis as any)[KEY] ??= new Map()); }",
      ["globalThis"],
    ],
    [
      "globalThis read in a function",
      "export const now = () => globalThis.performance.now();",
      ["globalThis"],
    ],
  ];
  for (const [label, source, expected] of accused) {
    it(`accuses ${label}`, () => {
      expect(names(source)).toEqual(expected);
    });
  }

  const allowed: Array<[string, string]> = [
    [
      "a table that is only read",
      "const TABLE = [1, 2, 3];\nexport const double = () => TABLE.map((n) => n * 2);",
    ],
    ["an object that is only read", "const LIMITS = { max: 3 };\nexport const max = () => LIMITS.max;"],
    [
      "a table copied before it is sorted",
      "const NAMES = ['b', 'a'];\nexport const sorted = () => [...NAMES].sort();",
    ],
    [
      "a push on another array",
      "const TABLE = [1];\nexport function f(out: number[]) { out.push(TABLE[0]!); }",
    ],
    [
      "a Set of entries that is only read",
      "const WORDS = new Set(['a', 'b']);\nconst LOWER = new Set(['A'].map((w) => w.toLowerCase()));\nexport const has = (w: string) => WORDS.has(w) || LOWER.has(w);",
    ],
    ["a regular expression", "const PATTERN = /x+/g;"],
    [
      "a date, an error and a url",
      "const D = new Date(0);\nconst E = new Error('x');\nconst U = new URL('http://a');",
    ],
    ["a function", "const f = () => 1;\nfunction g() { return 2; }"],
    [
      "a class without static state",
      "class Holder { items = new Map(); static make() { return new Holder(); } }",
    ],
    ["a word globalThis in a string", "export const note = 'not globalThis at all';"],
    [
      "a let inside a function",
      "export function f() { let n = 0; const m = new Map(); n += 1; return m.size + n; }",
    ],
    [
      "a let in a block of a function",
      "export function f() { for (let i = 0; i < 2; i++) { var x = i; } return 0; }",
    ],
  ];
  for (const [label, source] of allowed) {
    it(`lets pass ${label}`, () => {
      expect(names(source)).toEqual([]);
    });
  }

  it("names the file and the line of a finding", () => {
    const found = moduleState("const a = 1;\n\nlet b = 2;", "core/src/x.ts");
    expect(found).toEqual([{ file: "core/src/x.ts", name: "b", line: 3, why: "let or var" }]);
  });
});
