/**
 * What nobody reaches and nobody uses (.specs/features/limpeza-legado, C1, C2, C3, C9, C14, C16, C24, C25).
 * The reader is `testing/sourceGraph.ts`: the TypeScript syntax tree, never lines.
 */
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import {
  deadExports,
  declaredExports,
  edgesOf,
  importersOf,
  loadTree,
  reachable,
  resolveSpecifier,
  syntax,
  unreached,
  visit,
  wholeModuleImports,
  type Tree,
} from "./testing/sourceGraph";

// Reading and parsing the whole tree takes from 1 s to 6 s as the machine is loaded (one run at load 14 passed the
// 5 s default); the guards are a reading of the source, not a race, so the limit says so (round 1, F5).
vi.setConfig({ testTimeout: 30_000 });

const tree = loadTree();
const made = (files: Record<string, string>): Tree => new Map(Object.entries(files));
const names = (dead: Array<{ file: string; name: string }>) => dead.map((d) => `${d.file} :: ${d.name}`);

/** C1: the files of production no entry reaches, each with the reason it stays (design.md, lista fechada). */
const UNREACHED: Record<string, string> = {
  "nucleo/entity/harness.tsx":
    "the development page of the Entity, served by `vite dev` only (harness.html); no build input names it",
  "commands/testkit.tsx": "test material: imported by specs only",
  "components/markdown.corpus.ts": "the text the Markdown renderer is held to: imported by specs only",
  "commands/testserver.ts": "test material: imported by specs only",
  "ui/testkit.tsx": "test material: imported by specs only",
  // cerebro-contextos, batch C: the work-context specs' providers and their stub of the network
  "contexts/testkit.tsx": "test material: imported by specs only",
  "contexts/testnet.ts": "test material: imported by specs only",
  "commands/listenersAllowlist.ts":
    "the list of key listeners outside the registry, read by the registry's source check and probe (C16)",
  "testing/canvasText.ts": "a reader of the design-system guards: specs only",
  "testing/cssUsage.ts": "a reader of the legacy guards (stylesheets): specs only",
  "testing/fontSize.ts": "a reader of the design-system guards: specs only",
  "testing/missingKeys.setup.ts":
    "the setup of every spec: fails a file that asked for a translation key no dictionary has",
  "testing/sizeScan.ts": "a reader of the design-system guards: specs only",
  "testing/stateScan.ts": "a reader of the design-system guards: specs only",
  "testing/sourceGraph.ts": "a reader of the legacy guards: specs only",
};

describe("C1 what no entry reaches", () => {
  it("C1 the production files that no entry reaches are exactly the closed list", () => {
    expect(unreached(tree)).toEqual(Object.keys(UNREACHED).sort());
  });

  it("C1 the walk follows the worker URL, a dynamic import and a stylesheet import", () => {
    const hit = reachable(tree);
    expect(hit.has("brain/engine/force.worker.ts")).toBe(true);
    expect(hit.has("views/SecondBrain.tsx")).toBe(true);
    expect(hit.has("desktop/desktop.css")).toBe(true);
    expect(hit.has("gallery/gallery.css")).toBe(true);
  });

  it("C1 the walk reads import(), new URL(), export from and @import in a tree it was handed", () => {
    const t = made({
      "main.tsx":
        'import "./a.css"; import { x } from "./b"; export { y } from "./c"; const w = () => import("./d"); new Worker(new URL("./e.worker.ts", import.meta.url));',
      "a.css": '@import "./f.css";',
      "f.css": "",
      "b.ts": "export const x = 1;",
      "c.ts": "export const y = 1;",
      "d.tsx": "export default 1;",
      "e.worker.ts": "",
      "orphan.ts": "export const z = 1;",
      "orphan.test.ts": 'import "./orphan";',
    });
    expect(unreached(t, ["main.tsx"])).toEqual(["orphan.ts"]);
    expect(edgesOf(t, "main.tsx").map((e) => `${e.how}:${e.to}`)).toEqual([
      "static:a.css",
      "static:b.ts",
      "static:c.ts",
      "dynamic:d.tsx",
      "url:e.worker.ts",
    ]);
    expect(resolveSpecifier(t, "main.tsx", "./nothing")).toBeNull();
    expect(resolveSpecifier(t, "main.tsx", "react")).toBeNull();
  });
});

/**
 * Files whose exports may have no taker, with the reason. One: the primitives' barrel is the folder's public
 * surface, its value list is pinned by `primitivas` C3 (`ui.source.test.ts`), and a prop type is part of what a
 * component promises before the first consumer names it.
 */
const PUBLIC_SURFACE: Record<string, string> = {
  "ui/index.ts": "the primitives' public surface (primitivas, C3)",
};

describe("C2 the exports nobody uses", () => {
  it("C2 no exported symbol of a source file is left without a use", () => {
    expect(names(deadExports(tree).filter((d) => !(d.file in PUBLIC_SURFACE)))).toEqual([]);
  });

  it("C2 the one file on the list still has an export nobody takes, so the exception is not stale", () => {
    const dead = deadExports(tree).map((d) => d.file);
    for (const file of Object.keys(PUBLIC_SURFACE)) expect(dead, file).toContain(file);
  });
});

/**
 * Round 1, F3: C2 counts a spec as a user, so an export that only a test takes passes it. These are those
 * (production files; the test material of C1 is not production). Each is a pure function a spec holds to its
 * behaviour; none is reached by the product. The list is a ledger, not a verdict: taking one out of the module
 * is the owner's call (STATE, "Perguntas ao dono — limpeza-legado", 6), and a new entry, or one that gains a
 * production user or leaves the file, fails the guard so that the change is seen. A taker outside the product
 * (the dev harness, a test kit) does not count as production (F9). Each entry carries its one-line reason.
 */
const ONLY_A_SPEC_USES_IT: Record<string, string> = {
  "brain/engine/world.ts :: setMatched":
    "search-match marker; `brain/engine/engine.test.ts` holds it to its behaviour",
  "brain/render/labels.ts :: rankLabels":
    "label ranking; `brain/engine/engine.test.ts` holds it to its behaviour",
  "components/paletteMatch.ts :: highlightRange":
    "match-range helper; `components/paletteMatch.test.ts` is its only taker",
  "desktop/apps.tsx :: appLocationOf":
    "no spec names it either: only `moldura/moldura.test.tsx`'s `import type * as` of the module keeps it off the default C2 list; nothing calls it",
  "desktop/decision.ts :: pendingDecisions": "pure filter; `desktop/decision.test.ts` is its only taker",
  "desktop/defaultLayout.ts :: orderedIds":
    "layout helper; `desktop/defaultLayout.test.ts` is its only taker",
  "desktop/defaultLayout.ts :: isWidgetId":
    "layout helper; `desktop/defaultLayout.test.ts` is its only taker",
  "desktop/defaultLayout.ts :: shouldStack":
    "layout helper; `desktop/defaultLayout.test.ts` is its only taker",
  "desktop/panelKinds.ts :: requestPanelAction":
    "panel action request; `moldura/moldura.test.tsx` is its only taker",
  "desktop/registry.tsx :: hasSurface": "registry lookup; `desktop/registry.test.ts` is its only taker",
  "desktop/signal.ts :: isLit": "signal predicate; `desktop/signal.test.ts` is its only taker",
  "hooks/useNotifications.ts :: initialNotificationsState":
    "reducer seed; `hooks/useNotifications.test.ts` is its only taker",
  "i18n.ts :: ownKeys":
    "the key lists the pt-BR parity guard reads without the English fallback (F11); `i18n.test.ts` and `i18n.orphans.test.ts` are its takers by design",
  "nucleo/entity/Entity.tsx :: SPEAK_EVENT":
    "re-export; its only taker is the dev harness `nucleo/entity/harness.tsx`, which is outside the product (F9)",
  "nucleo/entity/entityParams.ts :: orbitPoint":
    "orbit geometry; `nucleo/entity/entityParams.test.ts` is its only taker",
  "nucleo/scenes.ts :: ringOffset": "ring geometry; `nucleo/shell.test.ts` is its only taker",
  "nucleo/scenes.ts :: travelBetween": "scene travel; `nucleo/shell.test.ts` is its only taker",
  "nucleo/scenes/brainCurve.ts :: bezierTangent":
    "curve maths; `nucleo/scenes/brainCurve.test.ts` is its only taker",
  "nucleo/scenes/brainCurve.ts :: curveLength":
    "curve maths; `nucleo/scenes/brainCurve.test.ts` is its only taker",
  "nucleo/scenes/brainCurve.ts :: quad2": "curve maths; `nucleo/scenes/brainCurve.test.ts` is its only taker",
  "nucleo/scenes/brainDimensions.ts :: bowCentre":
    "layout maths; `nucleo/scenes/brainDimensions.test.ts` is its only taker",
  "nucleo/scenes/brainEgo.ts :: egoAll":
    "ego-network helper; `nucleo/scenes/brainEgo.test.ts` is its only taker",
  "nucleo/scenes/brainSpace.ts :: centroid":
    "3D helper; `nucleo/scenes/brainSpace.test.ts` is its only taker",
  "nucleo/scenes/brainSpace.ts :: frameDistance":
    "3D helper; `nucleo/scenes/brainSpace.test.ts` is its only taker",
  "nucleo/scenes/brainSpace.ts :: pick": "3D helper; `nucleo/scenes/brainSpace.test.ts` is its only taker",
  "nucleo/scenes/brainSpace.ts :: project": "3D helper; `nucleo/scenes/brainSpace.test.ts` is its only taker",
  "nucleo/scenes/brainSpace.ts :: reach": "3D helper; `nucleo/scenes/brainSpace.test.ts` is its only taker",
  "nucleo/scenes/brainTimeline.ts :: ageDays":
    "timeline helper; `nucleo/scenes/brainTimeline.test.ts` is its only taker",
  "nucleo/scenes/brainTour.ts :: shortestPath":
    "graph search; `nucleo/scenes/brainTour.test.ts` is its only taker",
  "nucleo/scenes/brainZoom.ts :: levelName":
    "zoom label; `nucleo/scenes/brainZoom.test.ts` is its only taker",
  "runs/sparkline.ts :: sumBy": "series helper; `runs/sparkline.test.ts` is its only taker",
  "theme.ts :: nextPreset": "preset cycling; `theme.test.ts` is its only taker",
  "views/Settings.tsx :: isValidMicroAppHref": "href check; `views/Settings.href.test.ts` is its only taker",
};

/** The modules a production `import()` takes whole: every export of one counts as used (F4). */
const WHOLE_MODULE_IMPORTS: Record<string, string> = {
  "plugins/pixel/PixelStudio.tsx":
    'the manifest\'s `load: () => import("./PixelStudio")` is read by the host, which takes the default export',
};

describe("C2 what only a test keeps alive, and what an import() of a whole module hides", () => {
  it("C2 the exports that no production file takes are exactly the listed ones", () => {
    const test = new Set(unreached(tree));
    const found = names(
      deadExports(tree, { specsUse: false }).filter((d) => !(d.file in PUBLIC_SURFACE) && !test.has(d.file)),
    ).sort((a, b) => a.localeCompare(b));
    expect(found).toEqual(Object.keys(ONLY_A_SPEC_USES_IT).sort((a, b) => a.localeCompare(b)));
  });

  it("C2 every entry of the ledger carries a reason of one line", () => {
    for (const [entry, reason] of Object.entries(ONLY_A_SPEC_USES_IT))
      expect(reason.trim().length > 10 && !reason.includes("\n"), entry).toBe(true);
  });

  it("C2 the modules taken whole by an import() are exactly the listed ones", () => {
    expect(wholeModuleImports(tree)).toEqual(Object.keys(WHOLE_MODULE_IMPORTS));
  });
});

describe("C3 the reader of dead exports", () => {
  const dead = (files: Record<string, string>) => names(deadExports(made(files)));

  it("C3 can leave the specs out of the users, and tells an import() of a whole module from a lazy default", () => {
    const t = made({
      "main.tsx": 'import "./app"; import "./load";',
      "lib.ts": "export const used = 1; export const onlyTested = 2; export const none = 3;",
      "app.ts": 'import { used } from "./lib"; export const a = used;',
      "lib.test.ts": 'import { onlyTested } from "./lib"; export const b = onlyTested;',
      "m.ts": "export default 1; export const z = 1;",
      "n.ts": "export default 1; export const w = 1;",
      "load.ts":
        'export const m = () => import("./m"); export const n = lazyRoute(() => import("./n")); export const p = lazy(() => import("./n"));',
    });
    expect(names(deadExports(t)).filter((d) => d.startsWith("lib.ts"))).toEqual(["lib.ts :: none"]);
    expect(names(deadExports(t, { specsUse: false })).filter((d) => d.startsWith("lib.ts"))).toEqual([
      "lib.ts :: none",
      "lib.ts :: onlyTested",
    ]);
    expect(wholeModuleImports(t)).toEqual(["m.ts"]);
    expect(names(deadExports(t)).filter((d) => /^[mn]\.ts/.test(d))).toEqual(["n.ts :: w"]);
  });

  it("C3 a file the entry does not reach (a dev harness) does not keep a name alive, but a whole-module take of it still does (F9)", () => {
    const t = made({
      "main.tsx": 'import { a } from "./app"; export const m = a;',
      "app.ts": "export const a = 1; export const harnessOnly = 2; export const viaNamespace = 3;",
      "harness.tsx": 'import { harnessOnly } from "./app"; export const h = harnessOnly;',
      "kit.ts": 'import type * as App from "./other"; export type K = typeof App;',
      "other.ts": "export const o = 1;",
    });
    expect(names(deadExports(t)).filter((d) => d.startsWith("app.ts"))).toEqual(["app.ts :: viaNamespace"]);
    expect(names(deadExports(t, { specsUse: false })).filter((d) => d.startsWith("app.ts"))).toEqual([
      "app.ts :: harnessOnly",
      "app.ts :: viaNamespace",
    ]);
    // `other.ts` is taken whole by a file outside the product: the take stays honoured (conservative).
    expect(names(deadExports(t, { specsUse: false })).filter((d) => d.startsWith("other.ts"))).toEqual([]);
  });

  it("C3 finds a function, a constant, a class, an interface, a type and a default that nobody uses", () => {
    expect(
      dead({
        "lib.ts": [
          "export function fn() { return 1; }",
          "export const value = 1;",
          "export class Thing {}",
          "export interface Shape { a: number }",
          "export type Alias = string;",
          "export default function main() {}",
        ].join("\n"),
        "other.ts": "export const x = 1;\nexport function useX() { return x; }",
      }),
    ).toEqual(
      expect.arrayContaining([
        "lib.ts :: fn",
        "lib.ts :: value",
        "lib.ts :: Thing",
        "lib.ts :: Shape",
        "lib.ts :: Alias",
        "lib.ts :: default",
      ]),
    );
  });

  it("C3 finds a re-export of a barrel that nobody takes, and the symbol behind it", () => {
    const found = dead({
      "barrel.ts": 'export { a, b } from "./impl";',
      "impl.ts": "export const a = 1;\nexport const b = 2;",
      "user.ts": 'import { a } from "./barrel"; export const c = a;',
    });
    expect(found).toContain("barrel.ts :: b");
    expect(found).toContain("impl.ts :: b");
    expect(found).not.toContain("barrel.ts :: a");
    expect(found).not.toContain("impl.ts :: a");
  });

  it("C3 does not flag what is taken by name, by a namespace, by a dynamic import or by JSX", () => {
    expect(
      dead({
        "by-name.ts": "export const one = 1;",
        "by-namespace.ts": "export const two = 2;",
        "by-dynamic.ts": "export const three = 3;\nexport default 4;",
        "Widget.tsx": "export function Widget() { return null; }",
        "user.tsx": [
          'import { one } from "./by-name";',
          'import * as ns from "./by-namespace";',
          'import { Widget } from "./Widget";',
          'export const load = () => import("./by-dynamic");',
          "export const view = <Widget />;",
          "export const sum = one + ns.two;",
        ].join("\n"),
      }),
    ).toEqual(["user.tsx :: load", "user.tsx :: view", "user.tsx :: sum"]);
  });

  it("C3 does not flag a symbol the file itself uses, and flags one only its own body mentions", () => {
    const found = dead({
      "self.ts": [
        "export const limit = 3;",
        "export function check(n: number) { return n > limit; }",
        "export function loop(n: number): number { return n <= 0 ? 0 : loop(n - 1); }",
      ].join("\n"),
      "user.ts": 'import { check } from "./self"; export const ok = check(1);',
    });
    expect(found).toContain("self.ts :: loop");
    expect(found).not.toContain("self.ts :: limit");
    expect(found).not.toContain("self.ts :: check");
  });

  it("C3 reads a local list export, an alias and a destructured constant", () => {
    const found = dead({
      "list.ts":
        "const a = 1;\nconst b = 2;\nexport { a, b as c };\nexport const { d, e: f } = { d: 1, e: 2 };",
      "user.ts": 'import { a, f } from "./list"; export const g = a + f;',
    });
    expect(found).toContain("list.ts :: c");
    expect(found).toContain("list.ts :: d");
    expect(found).not.toContain("list.ts :: a");
    expect(found).not.toContain("list.ts :: f");
  });

  it("C3 counts a spec as a user, and does not report the exports of a spec", () => {
    expect(
      dead({
        "lib.ts": "export const helper = 1;",
        "lib.test.ts": 'import { helper } from "./lib"; export const t = helper;',
      }),
    ).toEqual([]);
  });
});

describe("C9 the box that served the run composer", () => {
  it("C9 runs/policy.ts and its two specs are gone, and no file takes one of its three names", () => {
    for (const file of ["runs/policy.ts", "runs/policy.test.ts", "runs/policy.delegation.test.ts"])
      expect(tree.has(file), file).toBe(false);
    const gone = new Set(["writePolicyFor", "followUpPrompt", "cwdSuggestions"]);
    const users: string[] = [];
    for (const file of tree.keys()) {
      if (!/\.tsx?$/.test(file)) continue;
      visit(syntax(tree, file), (n) => {
        if (ts.isIdentifier(n) && gone.has(n.text)) users.push(`${file}: ${n.text}`);
      });
    }
    // This very file names them once, in the list above.
    expect(users.filter((u) => !u.startsWith("legacy.graph.test.ts"))).toEqual([]);
  });
});

describe("C14 nothing in the interface reads or writes the hud preference", () => {
  /**
   * The files that spell a `hud` that is not the preference, with how many sites each has: the Entity's own HUD
   * canvas (the engine keeps a `hud: EntityHud` and a palette key), and the test double that mimics the server's
   * whole answer, `hud` included (C1's closed list). Round 1, F4: a count, not a folder, so a new site in these
   * files is seen too.
   */
  const OWN_HUD_SITES: Record<string, number> = {
    "commands/testserver.ts": 1,
    "nucleo/entity/entityEngine.ts": 8,
  };
  const hudSites = (file: string, code: string): string[] => {
    const found: string[] = [];
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(sf, (n) => {
      const hit =
        (ts.isPropertyAccessExpression(n) && n.name.text === "hud") ||
        (ts.isPropertyAssignment(n) &&
          (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
          n.name.text === "hud") ||
        (ts.isShorthandPropertyAssignment(n) && n.name.text === "hud") ||
        (ts.isBindingElement(n) &&
          ts.isObjectBindingPattern(n.parent) &&
          ((n.propertyName ?? n.name) as ts.Identifier).text === "hud");
      if (hit) found.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    });
    return found;
  };

  it("C14 no source file names the preference by property, key, shorthand or destructuring", () => {
    const sites: Record<string, number> = {};
    for (const [f, code] of tree) {
      if (!/\.tsx?$/.test(f) || /\.(test|typetest)\.tsx?$/.test(f)) continue;
      const n = hudSites(f, code).length;
      if (n > 0) sites[f] = n;
    }
    expect(sites).toEqual(OWN_HUD_SITES);
  });

  it("C14 the reader finds each spelling and passes a variable, a string and a class name", () => {
    expect(
      hudSites(
        "a.ts",
        "const a = prefs.hud; const b = prefs?.hud; f({ hud: x }); f({ hud }); const { hud: y } = p; const { hud } = p;",
      ),
    ).toHaveLength(6);
    expect(
      hudSites(
        "b.ts",
        'const hud = 1; f(hud * 2); const c = "hud"; const d = "hud-orange"; g({ "hud": 1 });',
      ),
    ).toHaveLength(1);
  });

  it("C14 desktop/hud.ts exports only what the palette asks for", () => {
    expect(
      declaredExports(tree, "desktop/hud.ts")
        .names.map((x) => x.name)
        .sort(),
    ).toEqual(["HUD_CATALOGUE", "hudTitleKey"]);
  });
});

describe("C16 one function turns the Markdown tree into elements", () => {
  const switches = (file: string, code: string): boolean => {
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = false;
    visit(sf, (n) => {
      if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text === "paragraph")
        found = true;
    });
    return found;
  };

  it("C16 only components/Markdown.tsx switches over the block types, and the three old renderers are gone", () => {
    const files = [...tree]
      .filter(([f, code]) => /\.tsx?$/.test(f) && !/\.(test|typetest)\.tsx?$/.test(f) && switches(f, code))
      .map(([f]) => f);
    expect(files).toEqual(["components/Markdown.tsx"]);
    for (const gone of ["views/Skills/Markdown.tsx", "nucleo/scenes/BrainSceneMarkdown.tsx"])
      expect(tree.has(gone), gone).toBe(false);
    const preview = tree.get("brain/PreviewPanel.tsx")!;
    expect(preview).not.toMatch(/\brenderInline\b|\brenderBlocks\b/);
  });

  it("C16 the reader tells a switch over the block types from a mention", () => {
    expect(switches("a.ts", 'switch (b.type) { case "paragraph": return 1; }')).toBe(true);
    expect(switches("b.ts", 'const x = "paragraph"; if (b.type === "paragraph") f();')).toBe(false);
  });
});

describe("C24 and C25 the Pixel Studio plugin", () => {
  const inside = (file: string) => file.startsWith("plugins/pixel/");

  it("C24 outside its folder only desktop/apps.tsx imports the plugin, and only its manifest", () => {
    expect(importersOf(tree, inside).map((e) => `${e.from} -> ${e.to} (${e.how})`)).toEqual([
      "desktop/apps.tsx -> plugins/pixel/index.ts (static)",
    ]);
  });

  it("C24 the view is reached by the manifest's import() and by nothing static", () => {
    const edges = [...tree.keys()].flatMap((from) =>
      edgesOf(tree, from)
        .filter((e) => e.to === "plugins/pixel/PixelStudio.tsx")
        .map((e) => `${from} -> ${e.how}`),
    );
    expect(edges.filter((e) => !/\.test\.tsx? /.test(e))).toEqual(["plugins/pixel/index.ts -> dynamic"]);
  });

  /** The modules of the app a plugin may import (design.md), and the contract file it is written against. */
  const HOST = [
    "ui/index.ts",
    "commands/registry.ts",
    "commands/keys.ts",
    "i18n.ts",
    "apiCall.ts",
    "components/ui.tsx",
    "hooks/useConfirm.tsx",
    "views/shared.ts",
  ];
  const CONTRACT = "plugins/types.ts";
  const PACKAGES = ["react", "react-router-dom", "lucide-react"];

  /** What a plugin file reaches outside its folder: modules of the app (resolved) and packages. */
  const reachesOf = (file: string, t: Tree): { host: string[]; packages: string[]; unresolved: string[] } => {
    const out = { host: [] as string[], packages: [] as string[], unresolved: [] as string[] };
    const sf = syntax(t, file);
    const add = (spec: string) => {
      if (!spec.startsWith(".")) return void out.packages.push(spec);
      const to = resolveSpecifier(t, file, spec);
      if (to === null) out.unresolved.push(spec);
      else if (!inside(to)) out.host.push(to);
    };
    visit(sf, (n) => {
      if (
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)
      )
        add(n.moduleSpecifier.text);
    });
    return out;
  };

  it("C25 the plugin's files import from the app only the listed modules, and from packages only the listed ones", () => {
    const files = [...tree.keys()].filter((f) => inside(f) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.sort()).toEqual(["plugins/pixel/PixelStudio.tsx", "plugins/pixel/index.ts"]);
    const host = new Set<string>();
    for (const file of files) {
      const r = reachesOf(file, tree);
      expect(r.unresolved, `${file} imports a relative path that resolves to nothing`).toEqual([]);
      for (const p of r.packages) expect(PACKAGES, `${file} imports ${p}`).toContain(p);
      for (const h of r.host) {
        expect([...HOST, CONTRACT], `${file} imports ${h}`).toContain(h);
        host.add(h);
      }
    }
    // The list is not slack: every module on it is used by the plugin.
    expect([...host].sort()).toEqual([...HOST, CONTRACT].sort());
  });

  it("C25 the reader names a ninth module, a package and a path that goes nowhere", () => {
    const t = new Map<string, string>([
      [
        "plugins/pixel/a.ts",
        'import { x } from "../../views/Settings"; import y from "lodash"; import z from "./b"; import w from "../nope";',
      ],
      ["plugins/pixel/b.ts", ""],
      ["views/Settings.tsx", ""],
    ]);
    expect(reachesOf("plugins/pixel/a.ts", t)).toEqual({
      host: ["views/Settings.tsx"],
      packages: ["lodash"],
      unresolved: ["../nope"],
    });
  });
});
