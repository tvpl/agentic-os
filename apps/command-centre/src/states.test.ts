/**
 * Design-system C16 (design.md, Cor): a state is never told by colour alone.
 * Every rule that styles a state is grouped by the element it styles, and each
 * group must change something a person who cannot tell the hues apart can see
 * (weight, underline, strike-through, a ring or bar, a fill, a glyph), or be
 * listed below with the mark that lives elsewhere (an icon swap, a word).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssFiles } from "./testing/sizeScan";
import { colourOnlyStates, stateGroups } from "./testing/stateScan";

const DOT =
  "a status dot sits beside the words that say the same: ProviderGate, Setup and the providers list name the login, the diagnostics list prints the check's status; the app's `sse-dot` is `aria-hidden` and the service banner says it";
const STEP_CHECK =
  "a finished step swaps its number for a check icon (`<Check />` in Setup and in the connector wizard)";
const LABELLED =
  "the element carries its own label (a badge, a button or a link says what it is); the hue only reinforces it";
const SENTENCE = "a sentence the person reads; the hue only reinforces what the words say";
const STATUS_WORD =
  "the element is the status word itself (failed / error / done); the colour only reinforces it";

/** Colour-only in the CSS, marked in the markup: the state's group name -> where the mark is. */
const MARKED_ELSEWHERE: Record<string, string> = {
  ".sentinel-row.off": "the row swaps its Eye icon for EyeOff (SentinelsWidget)",
  ".rts-row.off": "the row says its status in words, `.rts-st` (RoutinesScene)",
  ".rts-pdot:not(.on)": "a past-run dot of a routine that is not the focused one; its row names it",
  ".rts-item.on": "the row opens its detail panel (`aria-expanded`)",
  ".rts-mark.on": "the dial mark of the focused routine; the dial's centre names it in words",
  ".rts-mark.on.next": "the same mark when it is the next routine; the centre says Next in words",
  ".sse-dot.off": "decorative (`aria-hidden`); the service banner says it in words",
  "canvas.dimmed": "a canvas dimmed behind an open panel: decoration, the panel is the state",
  ".palette-row.selected": "the chevron follows the row, which is filled by `.launcher-result.selected`",
  ".stepper li.done": STEP_CHECK,
  ".conn-steps li.done": STEP_CHECK,
  ".dot.ok": DOT,
  ".dot.warn": DOT,
  ".dot.danger": DOT,
  ".dot.dim": DOT,
  '[data-status="failed"]': STATUS_WORD,
  '[data-status="error"]': STATUS_WORD,
  '[data-status="done"]': STATUS_WORD,
  '.cx-card:has(.cx-orb[data-state="ok"])':
    "the `.cx-state` label is the word (Connected / Off) and the orb sits beside it",
  '.nu-dialog-pulse[data-state="idle"]':
    "decorative pulse (slower, fainter when idle); the dialog's header says the state in words",
  ".deck-card.running":
    "no element carries it today: the deck has no `.deck-card`, only a `.btn` inside one is focused by a shortcut",
  ".console-link.danger":
    "a button whose label says what it does (Stop); the hue marks the destructive variant",
  ".cost-gauge.warn":
    "the gauge head prints the percentage and the budget, and the fill's length is the amount; the hue only reinforces it",
  ".cost-gauge.danger":
    "the gauge head prints the percentage and the budget, and the fill's length is the amount; the hue only reinforces it",
  ".mt .bad": "the tile's value is the success rate as a number; the hue only reinforces it",
  ".cons.busy":
    "the console frame while a turn runs; the running turn streams its own bubble and shows a Stop button",
  ".cons-note.warn": SENTENCE,
  ".rw.stale": "the stale rows sit under their own heading (Older failures, n) that names the group",
  ".health-check.ok": "the row prints the check's status word (`.tg`) and its label",
  ".nu-viz.segs i.on": "decorative (`aria-hidden`); the card beside it prints the pending count in words",
  ".rts-mark.done": "a dial mark that has already passed today: its place against the now hand says it",
  ".rts-lane-dot.done": "a dial dot that has already passed today: its place against the now hand says it",
  ".rts-lane.bad":
    "the lane repeats a routine whose row and centre say it is failing in words (`.rts-st`, `.rts-bad`)",
  ".rts-centre h2.bad": "the heading is followed by the word Failing (`.rts-bad`)",
  ".rts-row.bad": "the row says its status in words (`.rts-st`) and the reason (`.rts-reason`)",
  ".rts-act.danger": LABELLED,
  ".rs-link.warn":
    "a link whose label is the count of pending approvals; the hue only marks it as one to look at",
  ".sks-tags .tg.paused": "the tag is the word Paused",
  ".btn.danger": LABELLED,
  ".badge.ok": LABELLED,
  ".badge.warn": LABELLED,
  ".badge.danger": LABELLED,
  ".badge.meta.ok": LABELLED,
  ".badge.meta.warn": LABELLED,
  ".badge.meta.danger": LABELLED,
  ".toast.ok": SENTENCE,
  ".toast.danger": SENTENCE + " (an alert, announced by the platform)",
  ".run-outcome.failed":
    "the card prints the outcome in words (Completed, or the failure message and its code badge)",
  ".ev-result.ok": "the row swaps its icon (a check for an x) and prints the exit code",
  ".ev-result.bad": "the row swaps its icon (a check for an x) and prints the exit code",
  ".notice.warn": SENTENCE,
  ".hint.warn": SENTENCE,
  '.cx-orb[data-state="ok"]': "the orb sits beside the `.cx-state` word (Connected / Off)",
  '.cx-orb[data-state="warn"]': "the orb sits beside the `.cx-state` word",
  '.cx-orb[data-state="danger"]': "the orb sits beside the `.cx-state` word",
};

const sources = () => cssFiles().map((file) => ({ file, css: readFileSync(file, "utf8") }));
const probe = (css: string, exempt: Record<string, string> = {}) =>
  colourOnlyStates([{ file: "probe.css", css }], exempt);

describe("states", () => {
  it("C16 a state is never told by colour alone", () => {
    // Self-test: a state that only changes hue, strength or glow is found…
    expect(probe('a[aria-pressed="true"] { color: red; }')).toHaveLength(1);
    expect(probe("li.read { opacity: 0.5; }")).toHaveLength(1);
    expect(probe(".item.on { color: red; filter: drop-shadow(0 0 4px red); }")).toHaveLength(1);
    expect(probe('.t[aria-selected="true"] { border-bottom-color: red; }')).toHaveLength(1);
    expect(probe(".row.dimmed .name { color: gray; } .row.dimmed { opacity: .4 }")).toHaveLength(1);
    // the wider vocabulary: expanded, selected, data-state, data-active, location, status dots
    expect(probe('b[aria-expanded="true"] { color: red; }')).toHaveLength(1);
    expect(probe(".tab.is-selected { color: red; }")).toHaveLength(1);
    expect(probe('i[data-state="ok"] { color: green; }')).toHaveLength(1);
    expect(probe("i[data-active] { opacity: 1; }")).toHaveLength(1);
    expect(probe('a[aria-current="location"] { color: red; }')).toHaveLength(1);
    expect(probe(".dot.ok { background: green; box-shadow: 0 0 8px green; }")).toHaveLength(1);
    // the status words, and the other state selectors
    for (const sel of [".bad", ".ok", ".warn", ".danger", ".failed", ".done", ".paused", ".live", ".running"])
      expect(probe(`.zz${sel} { color: red; }`), sel).toHaveLength(1);
    expect(probe("input:checked { color: red; }")).toHaveLength(1);
    expect(probe("details[open] { color: red; }")).toHaveLength(1);
    expect(probe(".zz.is-on { color: red; }")).toHaveLength(1);
    expect(probe('.zz[class*="active"] { color: red; }')).toHaveLength(1);
    // a dot that is a fill in two colours is a fill in two colours, whatever the fill
    expect(
      probe(
        ".zz-dot { width: 8px; border: 1px solid grey; background: transparent; } .zz-dot.ok { background: var(--ok); } .zz-dot.bad { background: var(--danger); }",
      ),
    ).toHaveLength(2);
    // a border or a fill the element already has, recoloured, is not a mark…
    expect(probe(".zz { border: 1px solid grey; } .zz.on { border: 1px solid var(--accent); }")).toHaveLength(
      1,
    );
    expect(probe(".zz { background: var(--bg); } .zz.on { background: var(--accent); }")).toHaveLength(1);
    expect(probe(".zz { border: 1px solid grey; } .zz.on { border-color: red; }")).toHaveLength(1);
    // …a dash behind round caps is not either (they close the gaps)
    expect(probe(".zz.off { opacity: .4; } .zz.off path { stroke-dasharray: 3 5; }")).toHaveLength(1);
    expect(
      probe(".zz.off { opacity: .4; } .zz.off path { stroke-dasharray: 3 5; stroke-linecap: round; }"),
    ).toHaveLength(1);
    // a glow is not a mark, and neither are pointer-events, z-index or a gradient
    expect(probe("a.on { color: red; box-shadow: 0 0 12px red; }")).toHaveLength(1);
    expect(probe("a.on { color: red; pointer-events: none; z-index: 2; }")).toHaveLength(1);
    expect(probe("a.on { background-image: linear-gradient(red, blue); }")).toHaveLength(1);
    // a rule that moves no colour says nothing a person would miss
    expect(probe("a.on { transition-delay: 1s; }")).toEqual([]);
    // …and one that also changes something a person can see is not.
    expect(probe("a.on { color: red; text-decoration: underline; }")).toEqual([]);
    expect(probe("a.off { opacity: .5; text-decoration: line-through; }")).toEqual([]);
    expect(probe('a[aria-current="page"] { color: red; font-weight: 600; }')).toEqual([]);
    expect(probe("a.on { color: red; box-shadow: inset 2px 0 0 red; }")).toEqual([]);
    expect(probe("a.on { color: red; } a.on::before { content: '✓'; }")).toEqual([]);
    expect(probe("a.on { color: red; } a.on .name { font-weight: 700; }")).toEqual([]);
    expect(probe('b[aria-expanded="true"] { color: red; text-decoration: underline; }')).toEqual([]);
    expect(probe("a.on { color: red; box-shadow: inset 0 -2px 0 currentColor; }")).toEqual([]);
    expect(probe("a.on { color: red; box-shadow: 0 0 0 1px red; }")).toEqual([]);
    expect(probe("a.on { display: block; } a.on { opacity: 1 }")).toEqual([]);
    expect(probe("p.on { stroke: red; stroke-width: 2; }")).toEqual([]);
    expect(probe(".dot.ok { color: green; } .dot.ok::before { content: '✓'; }")).toEqual([]);
    // a pseudo-element with a fill is a bar
    expect(probe("a.on { color: red; } a.on::before { content: ''; background: red; width: 2px; }")).toEqual(
      [],
    );
    // …but a border or a fill the element did not have is
    expect(probe(".zz { border: 0; } .zz.on { border: 1px solid var(--accent); }")).toEqual([]);
    expect(probe(".zz { background: transparent; } .zz.on { background: var(--accent); }")).toEqual([]);
    expect(probe(".zz { border: 1px solid grey; } .zz.on { border-bottom-width: 3px; color: red; }")).toEqual(
      [],
    );
    // a dash with butt caps is
    expect(
      probe(".zz.off { opacity: .4; } .zz.off path { stroke-dasharray: 3 5; stroke-linecap: butt; }"),
    ).toEqual([]);
    // siblings of one status that differ in shape are told apart; in colour alone they are not
    expect(
      probe(
        ".zz-dot.ok { background: var(--ok); } .zz-dot.bad { background: var(--danger); transform: rotate(45deg); }",
      ),
    ).toEqual([]);
    expect(
      probe(".zz.ok::before { content: '✓'; color: green; } .zz.bad::before { content: '✕'; color: red; }"),
    ).toEqual([]);
    // hover and focus are not states of the data
    expect(probe("a:hover { color: red; } a.on:focus { color: red; }")).toEqual([]);
    // an explanation silences exactly the group it names
    expect(probe("a.on { color: red; }", { "a.on": "an icon says it" })).toEqual([]);

    const offenders = colourOnlyStates(sources(), MARKED_ELSEWHERE);
    expect(offenders, offenders.join("\n")).toEqual([]);

    // Not vacuous: the list is not empty, the groups exist, and no explanation has gone stale.
    const groups = stateGroups(sources());
    expect(groups.length).toBeGreaterThan(50);
    const stale = Object.keys(MARKED_ELSEWHERE).filter((k) => !groups.some((g) => g.key === k && !g.marked));
    expect(stale, `no longer colour-only (drop the entry): ${stale.join(", ")}`).toEqual([]);
  });

  it("C16 the states the design names carry their mark", () => {
    const g = (key: string) => stateGroups(sources()).find((x) => x.key === key)!;
    // off, dimmed (the legend), read and the current page: each with the mark the design relies on.
    expect(g(".brain2-legend .lg-row button.dimmed").props.has("text-decoration")).toBe(true);
    expect(
      g('.brain2-legend .lg-row button[aria-pressed="false"].kind-off').props.has("text-decoration"),
    ).toBe(true);
    expect(g(".inbox-row.read").props.has("font-weight")).toBe(true);
    expect(g('.mold-link[aria-current="page"]').props.has("font-weight")).toBe(true);
    expect(g(".cons-conversations li.on").props.has("box-shadow")).toBe(true);
  });
});
