// @vitest-environment jsdom
/**
 * Design-system C16: a past fire on the Routines timeline is told by shape, in
 * four ways, for every status the scheduler or a run can record, and its
 * words (the dot's title and aria-label) exist in both languages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionaries, tf, type TKey } from "../i18n";
import { pastFire } from "./RoutinesTimeline";

/** Every status of a run (`runStatus`) and of a history entry (`status`), and the shape each is drawn as. */
const TABLE: Array<[runStatus: string | null, status: string, tone: string]> = [
  ["done", "fired", "ok"],
  [null, "fired", "ok"],
  [null, "caught_up", "ok"],
  [null, "manual", "ok"],
  ["failed", "fired", "bad"],
  ["timed_out", "fired", "bad"],
  [null, "failed_to_fire", "bad"],
  ["running", "fired", "live"],
  ["queued", "fired", "live"],
  ["waiting_approval", "fired", "live"],
  [null, "skipped", "skip"],
  ["cancelled", "fired", "skip"],
  ["interrupted", "fired", "skip"],
];

describe("routines timeline dots (C16)", () => {
  it.each(TABLE)("run %s / history %s is a %s dot", (runStatus, status, tone) => {
    expect(pastFire({ runStatus, status }).tone).toBe(tone);
  });

  it("says every status in words, in both languages", () => {
    for (const [runStatus, status] of TABLE) {
      const { statusKey } = pastFire({ runStatus, status });
      expect(statusKey in dictionaries.en, statusKey).toBe(true);
      for (const lang of ["en", "pt-BR"] as const) {
        const said = tf(lang, statusKey as TKey);
        expect(said, `${lang} ${statusKey}`).not.toBe(statusKey);
        expect(said).not.toMatch(/^status\./);
      }
    }
  });

  it("draws each of the four shapes differently in the CSS", () => {
    const css = readFileSync(join(__dirname, "apps.css"), "utf8");
    const rule = (tone: string) =>
      new RegExp(`\\.rt-dot\\.past\\.${tone}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    const shapes = ["ok", "bad", "live", "skip"].map((tone) =>
      rule(tone)
        .replace(/var\(--[\w-]+\)/g, "C")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(shapes.every(Boolean)).toBe(true);
    expect(new Set(shapes).size).toBe(4);
    expect(rule("bad")).toContain("rotate(45deg)");
  });
});
