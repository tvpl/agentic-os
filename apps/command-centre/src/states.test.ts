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

/** Colour-only in the CSS, marked in the markup: the state's group name -> where the mark is. */
const MARKED_ELSEWHERE: Record<string, string> = {
  ".sentinel-row.off": "the row swaps its Eye icon for EyeOff (SentinelsWidget)",
  ".rts-row.off": "the row says its status in words, `.rts-st` (RoutinesScene)",
  ".rts-lane.off": "the dial lane repeats a routine whose list row says Paused",
  ".rts-pdot:not(.on)": "a past-run dot of a routine that is not the focused one; its row names it",
  ".rts-item.on": "the row opens its detail panel (`aria-expanded`)",
  ".rts-mark.on": "the dial mark of the focused routine; the dial's centre names it in words",
  ".rts-mark.on.next": "the same mark when it is the next routine; the centre says Next in words",
  ".sse-dot.off": "decorative (`aria-hidden`); the service banner says it in words",
  "canvas.dimmed": "a canvas dimmed behind an open panel: decoration, the panel is the state",
  ".palette-row.selected": "the chevron follows the row, which is filled by `.launcher-result.selected`",
  '.tabs [role="tab"][aria-selected="true"]':
    "the 2px bottom border every tab has (transparent) becomes the underline",
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
    // …and one that also changes something a person can see is not.
    expect(probe("a.on { color: red; text-decoration: underline; }")).toEqual([]);
    expect(probe("a.off { opacity: .5; text-decoration: line-through; }")).toEqual([]);
    expect(probe('a[aria-current="page"] { color: red; font-weight: 600; }')).toEqual([]);
    expect(probe("a.on { color: red; box-shadow: inset 2px 0 0 red; }")).toEqual([]);
    expect(probe("a.on { color: red; } a.on::before { content: '✓'; }")).toEqual([]);
    expect(probe("a.on { color: red; } a.on .name { font-weight: 700; }")).toEqual([]);
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
