import { describe, expect, it } from "vitest";
import {
  categoryOf,
  groupSectors,
  nextRotation,
  paginate,
  inscribedBox,
  ringGeometry,
  ringLayout,
  SECTOR_GAP,
  type SectorItem,
} from "./skillsRing";

const cat = (slug: string, name: string, triggers: string[] = [], description = "") =>
  categoryOf({ slug, names: [name], triggers, descriptions: [description] });

describe("categoryOf", () => {
  it("reads the real skills into sectors", () => {
    expect(
      cat("agent-usage-report", "Agent Usage Report", ["agent usage"], "how agents and subagents are used"),
    ).toBe("agents");
    expect(cat("claude-optimize", "Claude Code Resource Optimizer")).toBe("agents");
    expect(cat("harness-analysis", "Project Harness Analysis", [], "Analyze a project's agent harness")).toBe(
      "agents",
    );
    expect(cat("code-review", "Code Review", ["revisar código"])).toBe("code");
    expect(cat("sdd-plan", "SDD Coding Plan")).toBe("code");
    expect(
      cat("gauntlet-loop", "gauntlet-loop", [], "Executa ciclos de implementação, revisão adversarial"),
    ).toBe("code");
    expect(cat("consolidate-memory", "Consolidate Memory")).toBe("memory");
    expect(cat("recall", "Recall", [], "Answer a question from the second brain")).toBe("memory");
    expect(cat("workspace-digest", "Workspace Digest")).toBe("memory");
    expect(cat("daily-tech-news", "Daily Tech & AI News", [], "Search today's technology and AI news")).toBe(
      "research",
    );
    expect(cat("brainstorm", "Structured Brainstorm")).toBe("think");
    expect(cat("pixel-icon", "Pixel Icon Maker")).toBe("create");
    expect(cat("single-html-explainer", "Single-File HTML Explainer")).toBe("create");
  });

  it("matches at word starts only and falls back to other", () => {
    // "latest" does not contain the word "test"
    expect(cat("x", "Latest things")).toBe("other");
    expect(cat("weather", "Weather")).toBe("other");
  });
});

const item = (slug: string, category: SectorItem["category"], favorite = false): SectorItem => ({
  slug,
  category,
  favorite,
  name: slug,
});

describe("groupSectors", () => {
  it("keeps the category order and puts favourites first", () => {
    const sectors = groupSectors([
      item("zeta", "code"),
      item("beta", "memory"),
      item("alpha", "code"),
      item("omega", "code", true),
      item("agent", "agents"),
    ]);
    expect(sectors.map((s) => s.category)).toEqual(["agents", "code", "memory"]);
    expect(sectors[1]!.items.map((i) => i.slug)).toEqual(["omega", "alpha", "zeta"]);
  });
});

describe("ringLayout", () => {
  it("spreads one sector evenly with no gap", () => {
    const l = ringLayout([4]);
    expect(l.rings).toBe(1);
    expect(l.slots.map((s) => s.angle)).toEqual([45, 135, 225, 315]);
    expect(l.sectors).toEqual([{ start: 0, end: 360, mid: 180 }]);
  });

  it("leaves a gap between sectors and centres their labels", () => {
    const l = ringLayout([2, 2]);
    const step = 360 / (4 + 2 * SECTOR_GAP);
    expect(l.slots[0]!.angle).toBeCloseTo((SECTOR_GAP / 2 + 0.5) * step);
    expect(l.sectors[1]!.start).toBeCloseTo((SECTOR_GAP / 2 + 2 + SECTOR_GAP) * step);
    expect(l.sectors[0]!.mid).toBeCloseTo((l.slots[0]!.angle + l.slots[1]!.angle) / 2);
    // ends where the next sector begins, minus the gap, all the way round
    expect(l.sectors[1]!.end + (SECTOR_GAP / 2) * step).toBeCloseTo(360);
  });

  it("alternates two rings past the single-ring maximum", () => {
    const l = ringLayout([30]);
    expect(l.rings).toBe(2);
    expect(l.slots.slice(0, 4).map((s) => s.ring)).toEqual([0, 1, 0, 1]);
    expect(ringLayout([24]).slots.every((s) => s.ring === 0)).toBe(true);
  });

  it("is empty for nothing", () => {
    expect(ringLayout([]).slots).toEqual([]);
  });
});

describe("nextRotation", () => {
  it("brings the angle to the top", () => {
    expect(nextRotation(0, 0)).toBe(-90);
    expect(nextRotation(0, 90)).toBe(-180);
  });
  it("turns the short way round", () => {
    // from the top at 350° to 10°: +20° of travel the other way, not −340°
    const at350 = nextRotation(0, 350);
    const to10 = nextRotation(at350, 10);
    expect(Math.abs(to10 - at350)).toBeCloseTo(20);
    expect(((to10 % 360) + 360) % 360).toBeCloseTo(260);
  });
});

describe("paginate", () => {
  it("breaks at sector edges and cuts oversize sectors", () => {
    const s = (category: SectorItem["category"], n: number) => ({
      category,
      items: Array.from({ length: n }, (_, i) => item(`${category}-${i}`, category)),
    });
    const pages = paginate([s("agents", 3), s("code", 3), s("memory", 7)], 6);
    expect(pages.map((p) => p.map((x) => `${x.category}:${x.items.length}`))).toEqual([
      ["agents:3", "code:3"],
      ["memory:6"],
      ["memory:1"],
    ]);
    expect(paginate([s("agents", 3)], 6)).toHaveLength(1);
  });
});

describe("ringGeometry", () => {
  it("widens into an ellipse on a wide stage, within the stage", () => {
    const g = ringGeometry(988, 518, 1);
    const o = g.orbits[0]!;
    expect(o.rx).toBeGreaterThan(o.ry);
    // a side name (glyph offset + half its width) stays on the stage
    expect(o.rx + 70 + 54).toBeLessThanOrEqual(988 / 2 + 1);
    expect(o.ry + 36 + 17).toBeLessThanOrEqual(518 / 2);
    expect(g.compact).toBe(false);
    // a short stage gives the labels' room to the middle
    expect(g.label).toBeNull();
    const tall = ringGeometry(988, 700, 1);
    const label = tall.label!;
    expect(label.rx).toBeLessThan(o.rx);
    // the centre box's corner stays inside the label ellipse
    const x = tall.centre.w / 2;
    const y = tall.centre.h / 2;
    expect((x / label.rx) ** 2 + (y / label.ry) ** 2).toBeLessThan(1);
  });
  it("stays near a circle on a square stage and caps the stretch", () => {
    const sq = ringGeometry(700, 700, 1).orbits[0]!;
    expect(sq.rx / sq.ry).toBeLessThan(1.15);
    const wide = ringGeometry(3000, 500, 1).orbits[0]!;
    expect(wide.rx / wide.ry).toBeCloseTo(1.9);
  });
  it("adds an inner orbit with names inside for two rings", () => {
    const g = ringGeometry(884, 518, 2);
    expect(g.orbits).toHaveLength(2);
    expect(g.orbits[1]!.out).toBe(-1);
    expect(g.orbits[1]!.rx).toBeLessThan(g.label!.rx);
    expect(g.compact).toBe(true);
  });
  it("gives the labels' room to the middle on a small stage, then goes compact", () => {
    const mid = ringGeometry(620, 518, 1);
    expect(mid.label).toBeNull();
    const tiny = ringGeometry(420, 400, 1);
    expect(tiny.label).toBeNull();
    expect(tiny.compact).toBe(true);
  });
});

describe("inscribedBox", () => {
  it("trades width for height along the ellipse", () => {
    expect(inscribedBox(100, 50, 100, 200)).toEqual({ w: 0, h: 100 });
    const b = inscribedBox(100, 50, 80, 200);
    expect(b.w).toBeCloseTo(120);
    expect(b.h).toBeCloseTo(80);
    // a roomy ellipse is capped in width and gets taller than asked
    const roomy = inscribedBox(400, 300, 100, 150);
    expect(roomy.w).toBe(300);
    expect(roomy.h).toBeGreaterThan(100);
  });
});
