/**
 * The words nobody says (.specs/features/limpeza-legado, C7, C8): a translation key that no production source
 * spells, literally or by a prefix a template builds. The reader is `testing/sourceGraph.ts` (the syntax tree).
 * The parity of `en` and `pt-BR` is `i18n.test.ts`'s and is run here too, as the second half of C7.
 */
import { describe, expect, it } from "vitest";
import { dictionaries, ownKeys } from "./i18n";
import { loadTree, productionFiles, spelledIn, type Tree } from "./testing/sourceGraph";

const tree = loadTree();
/** The files that define keys: a key spelled as an object key there is a definition, not a use. */
const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
const spelled = spelledIn(tree, productionFiles(tree), defines);
const keys = Object.keys(dictionaries.en);

/**
 * Prefixes a template or a concatenation builds, with the site that builds them. A key under one of these is
 * "used" without being spelled whole; the scan cannot tell which suffixes the code can produce, so the list is
 * the reviewed set of places where a key is chosen by data (a status, a kind, a level…).
 */
const DYNAMIC_PREFIXES: Record<string, string> = {
  "apps.settings.scope.":
    "views/settings/security.tsx: the scope of a device (`${scope}` and `${scope}.hint`)",
  "apps.settings.sentinel.":
    "desktop/widgets/SentinelsWidget.tsx: the sentinel id (`${s.id}` and `${s.id}Hint`)",
  "apps.skills.kind.": "views/Skills/SkillDetail.tsx: the kind of a resource file",
  "backend.delivery.": "views/Routines.tsx: how a routine delivers",
  "backend.kind.":
    "views/Routines.tsx, nucleo/scenes/RoutinesSceneDetail.tsx: the kind of a routine (`${k}` and `${kind}Hint`)",
  "backend.outcome.": "views/Routines.tsx, nucleo/scenes/RoutinesSceneDetail.tsx: how a fire ended",
  "backend.runner.": "views/Routines.tsx, nucleo/scenes/RoutinesSceneDetail.tsx: who runs a routine",
  "concept.runs.tab.": "nucleo/scenes/RunsSceneRun.tsx: the tab of a run",
  "desktop.console.effort.": "desktop/console/ConsoleControls.tsx: the effort of a choice",
  "desktop.core.": "nucleo/Telemetry.tsx, nucleo/NucleoScene.tsx: the state of the core",
  "desktop.next.": "desktop/NowPanel.tsx: the next step (`${step}` and `${step}Body`)",
  "desktop.objectives.": "desktop/NowPanel.tsx: the status of the focused objective",
  "doctor.status.": "views/settings/diagnostics.tsx: the status of a check",
  "gate.state.": "desktop/console/Console.tsx, ConsoleControls.tsx: the problem a provider has",
  "brain.index.phase.": "brain/BrainChrome.tsx: the phase of an index pass (`brain.index.phase.${phase}`)",
  "note.state.": "brain/NoteEditor.tsx: the state of the editor (`note.state.${kind}`)",
  "nucleo.pending.level.": "nucleo/pending/FocusMode.tsx: the level of a pending item",
  "profile.": "views/Routines.tsx, views/settings/security.tsx: the security profile",
  "scene.routines.st.": "nucleo/scenes/RoutinesScene.tsx, RoutinesSceneDial.tsx: the outcome of a fire",
  "scene.runs.count.": "nucleo/scenes/RunsScene.tsx: the count of a filter",
  "scene.runs.lane.": "nucleo/scenes/RunsScene.tsx, RunsSceneList.tsx: the lane of a run (and `.short.`)",
  "scene.runs.range.": "nucleo/scenes/RunsScene.tsx: the range of the river (and `.short.`)",
  "scene.skills.cat.": "nucleo/scenes/SkillsSceneFocus.tsx, SkillsSceneRing.tsx: the category of a skill",
  "scene.skills.mode.": "nucleo/scenes/SkillsSceneTools.tsx: the mode filter",
  "status.": "components/ui.tsx, desktop/SkillDeck.tsx: the status of a run",
};

const underAPrefix = (key: string) => Object.keys(DYNAMIC_PREFIXES).some((p) => key.startsWith(p));

describe("C7 the keys of the dictionaries", () => {
  it("C7 every key of the en dictionary is spelled by the production source or sits under a dynamic prefix", () => {
    const orphans = keys.filter((k) => !spelled.words.has(k) && !underAPrefix(k));
    expect(orphans).toEqual([]);
  });

  it("C7 pt-BR has exactly the keys of en, in both directions", () => {
    const en = new Set(keys);
    // The own keys: `dictionaries["pt-BR"]` starts from the English base and could never miss one (F11).
    const pt = new Set(ownKeys["pt-BR"]);
    expect([...en].filter((k) => !pt.has(k))).toEqual([]);
    expect([...pt].filter((k) => !en.has(k))).toEqual([]);
  });
});

describe("C8 the dynamic prefixes and the reader of the keys", () => {
  it("C8 a prefix on the list is built by the production source and covers a key nobody spells whole", () => {
    const useless = Object.keys(DYNAMIC_PREFIXES).filter(
      (p) => !spelled.prefixes.has(p) || !keys.some((k) => k.startsWith(p) && !spelled.words.has(k)),
    );
    expect(useless).toEqual([]);
  });

  const read = (code: string) => {
    const t: Tree = new Map([["use.tsx", code]]);
    return spelledIn(t, ["use.tsx"]);
  };

  it("C8 the reader finds a prefix in a template, a template cast to a key, a concatenation and a template with a tail", () => {
    expect(read("t(`a.${x}`);").prefixes.has("a.")).toBe(true);
    expect(read("t(`b.${x}` as TKey);").prefixes.has("b.")).toBe(true);
    expect(read('t("c." + x);').prefixes.has("c.")).toBe(true);
    expect(read("t(`d.${x}Hint`);").prefixes.has("d.")).toBe(true);
  });

  it("C8 the reader takes a whole literal as a word and does not take the key of a dictionary as a use", () => {
    expect(read('t("e.f");').words.has("e.f")).toBe(true);
    const t: Tree = new Map([["locales/x.ts", 'export const en = { "g.h": "text", other: t("i.j") };']]);
    const s = spelledIn(t, ["locales/x.ts"], defines);
    expect(s.words.has("g.h")).toBe(false);
    expect(s.words.has("i.j")).toBe(true);
  });

  it("C8 a key that nobody spells and no prefix covers is reported", () => {
    const t: Tree = new Map([["use.tsx", 't("k.used"); t(`k.dyn.${x}`);']]);
    const s = spelledIn(t, ["use.tsx"]);
    const prefixes = ["k.dyn."];
    const orphans = ["k.used", "k.dyn.a", "k.lost"].filter(
      (k) => !s.words.has(k) && !prefixes.some((p) => k.startsWith(p)),
    );
    expect(orphans).toEqual(["k.lost"]);
  });
});
