/**
 * The promise of a space is that what you left is what you find, so that is
 * what these pin — including the first switch, where there is nothing saved
 * yet and the arrangement could quietly be lost.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SPACE, MAX_SPACES, addSpace, listSpaces, removeSpace, switchSpace } from "./spaces";
import type { WindowMap } from "./windowModel";

const box = (x: number): WindowMap => ({ now: { x, y: 0, w: 300, h: 200, z: 1, visible: true } });
const empty: WindowMap = {};

describe("switching", () => {
  it("saves the arrangement being left, even on the very first switch", () => {
    const out = switchSpace({}, DEFAULT_SPACE, box(10), "research", box(999));
    expect(out.spaces[DEFAULT_SPACE]!.layout).toEqual(box(10));
    expect(out.activeSpace).toBe("research");
    // A space that did not exist starts from the fallback composition.
    expect(out.layout).toEqual(box(999));
  });

  it("gives back exactly what that space had", () => {
    const first = switchSpace({}, DEFAULT_SPACE, box(10), "research", empty);
    const moved = switchSpace(first.spaces, "research", box(77), DEFAULT_SPACE, empty);
    expect(moved.layout).toEqual(box(10));
    expect(moved.spaces.research!.layout).toEqual(box(77));
  });

  it("switching to the space you are already in changes nothing", () => {
    const out = switchSpace({}, DEFAULT_SPACE, box(5), DEFAULT_SPACE, empty);
    expect(out.activeSpace).toBe(DEFAULT_SPACE);
    expect(out.layout).toEqual(box(5));
  });
});

describe("adding and removing", () => {
  it("names a space and derives a usable id", () => {
    const out = addSpace({}, DEFAULT_SPACE, "  Deep Work  ", box(1));
    expect(Object.keys(out.spaces)).toEqual(["deep-work"]);
    expect(out.spaces["deep-work"]!.name).toBe("Deep Work");
    expect(out.activeSpace).toBe("deep-work");
  });

  it("does not collide two spaces with the same name", () => {
    const one = addSpace({}, DEFAULT_SPACE, "Ops", box(1));
    const two = addSpace(one.spaces, one.activeSpace, "Ops", box(2));
    expect(Object.keys(two.spaces).sort()).toEqual(["ops", "ops-2"]);
  });

  it("refuses an empty name and stops at the ceiling", () => {
    expect(addSpace({}, DEFAULT_SPACE, "   ", box(1)).spaces).toEqual({});
    let spaces = {};
    for (let i = 0; i < MAX_SPACES; i++) spaces = addSpace(spaces, DEFAULT_SPACE, `s${i}`, box(i)).spaces;
    expect(Object.keys(spaces)).toHaveLength(MAX_SPACES);
    expect(Object.keys(addSpace(spaces, DEFAULT_SPACE, "one more", box(0)).spaces)).toHaveLength(MAX_SPACES);
  });

  it("never leaves you in no space at all", () => {
    const two = addSpace(addSpace({}, DEFAULT_SPACE, "a", box(1)).spaces, "a", "b", box(2));
    const out = removeSpace(two.spaces, "b", "b", empty);
    expect(out.activeSpace).toBe("a");
    expect(out.layout).toEqual(box(1));
    // The last space cannot be removed.
    const one = removeSpace(out.spaces, "a", "a", empty);
    expect(Object.keys(one.spaces)).toEqual(["a"]);
  });

  it("removing a space you are not in leaves you where you are", () => {
    const two = addSpace(addSpace({}, DEFAULT_SPACE, "a", box(1)).spaces, "a", "b", box(2));
    const out = removeSpace(two.spaces, "b", "a", empty);
    expect(out.activeSpace).toBe("b");
    expect(Object.keys(out.spaces)).toEqual(["b"]);
  });
});

describe("listing", () => {
  it("always shows the space you are in, even before it is saved", () => {
    expect(listSpaces({}, DEFAULT_SPACE)).toEqual([{ id: DEFAULT_SPACE, name: "Work" }]);
  });

  it("keeps the default space first", () => {
    const spaces = addSpace({}, DEFAULT_SPACE, "Ops", box(1)).spaces;
    const list = listSpaces({ ...spaces, [DEFAULT_SPACE]: { name: "Work", layout: empty } }, "ops");
    expect(list[0]!.id).toBe(DEFAULT_SPACE);
  });
});
