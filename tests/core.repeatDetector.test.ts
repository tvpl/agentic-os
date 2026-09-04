import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  NotificationStore,
  detectRepeatedPrompts,
  defaultSettings,
  groupPrompts,
  isoWeek,
  jaccard,
  normalizeTokens,
  openDb,
  repeatDedupeKey,
  repeatNotification,
  skillCoversGroup,
  type Db,
  type MordomoPaths,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

/**
 * "You did this twice — make it a skill?" (Onda 4, item 2). The grouping is
 * lexical and deterministic, so it can be pinned down exactly.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

let tmp: { paths: MordomoPaths; cleanup: () => void };
let db: Db;

beforeEach(() => {
  tmp = makeTempHome();
  db = openDb(tmp.paths).db;
});
afterEach(() => {
  db.close();
  tmp.cleanup();
});

describe("prompt normalization", () => {
  it("lowercases, drops punctuation, dedupes and stops at 40 tokens", () => {
    expect(normalizeTokens("Rename the FILES, please -- the files!")).toEqual([
      "rename",
      "the",
      "files",
      "please",
    ]);
    expect(normalizeTokens(Array.from({ length: 60 }, (_, i) => `w${i}`).join(" "))).toHaveLength(40);
    expect(normalizeTokens("   ")).toEqual([]);
  });

  it("scores overlap with Jaccard", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["a", "b", "d"]))).toBeCloseTo(0.5);
    expect(jaccard(new Set<string>(), new Set(["a"]))).toBe(0);
  });
});

describe("groupPrompts", () => {
  const run = (id: string, prompt: string, ageDays = 0) => ({
    id,
    prompt,
    createdAt: NOW - ageDays * DAY,
  });

  it("groups near-identical prompts and keeps the newest one as the seed text", () => {
    const groups = groupPrompts([
      run("r1", "summarise the invoices in my downloads folder", 3),
      run("r2", "summarise the invoices in my downloads folder again", 1),
      run("r3", "book a flight to Lisbon", 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.runIds).toEqual(["r2", "r1"]);
    expect(groups[0]!.prompt).toContain("again");
    expect(groups[0]!.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("keeps unrelated prompts apart and drops groups of one", () => {
    expect(
      groupPrompts([run("r1", "book a flight to Lisbon"), run("r2", "clean up the desktop folder")]),
    ).toEqual([]);
  });

  it("honours the similarity threshold and the minimum group size", () => {
    const runs = [
      run("r1", "tidy the downloads folder by extension"),
      run("r2", "tidy the downloads folder by date", 1),
      run("r3", "tidy the downloads folder by size", 2),
    ];
    expect(groupPrompts(runs, { similarity: 0.6 })[0]!.count).toBe(3);
    expect(groupPrompts(runs, { similarity: 0.99 })).toEqual([]);
    expect(groupPrompts(runs, { minRuns: 4 })).toEqual([]);
  });

  it("is stable whatever order the runs arrive in", () => {
    const runs = [
      run("r1", "weekly report of the finance folder", 5),
      run("r2", "weekly report of the finance folder now", 1),
    ];
    const a = groupPrompts(runs);
    const b = groupPrompts([...runs].reverse());
    expect(a[0]!.hash).toBe(b[0]!.hash);
    expect(a[0]!.runIds).toEqual(b[0]!.runIds);
  });
});

describe("skill coverage and the row", () => {
  const group = { tokens: normalizeTokens("summarise the invoices in my downloads folder") };

  it("considers a group covered when a skill shares three meaningful tokens", () => {
    expect(
      skillCoversGroup(group, [
        { name: "Invoices digest", description: "summarise the invoices in the downloads folder" },
      ]),
    ).toBe(true);
    // Two real words in common is not coverage…
    expect(
      skillCoversGroup(group, [{ name: "Invoices digest", description: "summarise invoices monthly" }]),
    ).toBe(false);
    // …and neither are three stopwords.
    expect(
      skillCoversGroup(group, [{ name: "Flight booking", description: "book the flight in my name" }]),
    ).toBe(false);
    expect(skillCoversGroup(group, [])).toBe(false);
  });

  it("builds one row per group per ISO week with the prompt in the href", () => {
    const groups = groupPrompts([
      { id: "r1", prompt: "tidy the downloads folder", createdAt: NOW },
      { id: "r2", prompt: "tidy the downloads folder now", createdAt: NOW - DAY },
    ]);
    const row = repeatNotification(groups[0]!, NOW);
    expect(row.kind).toBe("system");
    expect(row.tone).toBe("info");
    expect(row.title).toBe("You did this twice — make it a skill?");
    expect(row.body).toContain("tidy the downloads folder");
    expect(row.href).toContain("/skills?new=1&prompt=");
    expect(decodeURIComponent(row.href!.split("prompt=")[1]!)).toContain("tidy the downloads folder");
    expect(row.dedupeKey).toBe(repeatDedupeKey(groups[0]!.hash, NOW));
    expect(isoWeek(NOW)).toBe("2026-W36");
  });
});

describe("detectRepeatedPrompts", () => {
  const insert = (
    id: string,
    prompt: string,
    ageDays: number,
    origin = "manual",
    skill: string | null = null,
  ) =>
    db
      .prepare(
        `INSERT INTO runs (id, created_at, origin, provider, status, prompt_summary, skill_slug, effort)
         VALUES (?, ?, ?, 'claude', 'done', ?, ?, 'default')`,
      )
      .run(id, NOW - ageDays * DAY, origin, prompt, skill);

  it("writes one row a week and ignores skill runs, old runs and covered groups", () => {
    const store = new NotificationStore(db);
    const settings = defaultSettings();
    const deps = {
      db,
      getSettings: () => settings,
      skills: { list: () => [] as Array<{ name: string; description: string }> },
      notifications: store,
      now: () => NOW,
    };
    insert("r1", "tidy the downloads folder by extension", 1);
    insert("r2", "tidy the downloads folder by date", 2);
    insert("skill", "tidy the downloads folder by size", 3, "skill", "tidy");
    insert("ancient", "tidy the downloads folder by name", 90);

    const written = detectRepeatedPrompts(deps);
    expect(written).toHaveLength(1);
    expect(written[0]!.body).toContain("2×");
    // The dedupe key holds the row to one a week.
    expect(detectRepeatedPrompts(deps)).toEqual([]);

    // A skill that already covers the vocabulary silences it entirely.
    store.markAllRead();
    const covered = {
      ...deps,
      skills: { list: () => [{ name: "Tidy downloads", description: "tidy the downloads folder" }] },
    };
    expect(detectRepeatedPrompts(covered)).toEqual([]);
  });

  it("does nothing when the detector is switched off", () => {
    const settings = defaultSettings();
    settings.sentinels.repeatDetector.enabled = false;
    insert("r1", "tidy the downloads folder by extension", 1);
    insert("r2", "tidy the downloads folder by date", 2);
    expect(
      detectRepeatedPrompts({
        db,
        getSettings: () => settings,
        skills: { list: () => [] },
        notifications: new NotificationStore(db),
        now: () => NOW,
      }),
    ).toEqual([]);
  });
});
