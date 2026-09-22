/**
 * No English on a Portuguese desktop (refino item 30). A `desktop.*` string
 * whose pt-BR value equals its English value is untranslated unless the word
 * is the same in both languages — those are listed here on purpose.
 */
import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";

/** Product words and glyph-only strings that read the same in both languages. */
const SHARED = new Set([
  "skills",
  "skill",
  "prompt",
  "prompts",
  "pixel studio",
  "pixel",
  "mcp",
  "hud",
  "ok",
  "esc",
  "trace",
  "micro apps",
  "workspace",
  "console",
  "apps",
  "ops",
  "desktop",
  "tokens",
  "24 h",
  "agenda",
  "tokens/h",
  "mem",
  "@",
  "/",
  "+",
  "—",
  "…",
  "·",
  "↑",
  "↓",
  "×",
]);

describe("desktop locale", () => {
  it("translates every desktop string that has a Portuguese form", () => {
    const en = dictionaries.en as Record<string, string>;
    const pt = dictionaries["pt-BR"] as Record<string, string>;
    const same: string[] = [];
    for (const key of Object.keys(en)) {
      if (!key.startsWith("desktop.")) continue;
      const a = en[key]!.trim();
      const b = pt[key]!.trim();
      if (a !== b) continue;
      const bare = a
        .toLowerCase()
        .replace(/[{}\w.]+\}/g, "")
        .trim();
      // Placeholders and punctuation only, or a shared product word.
      if (/^[^a-z]*$/i.test(bare) || SHARED.has(bare)) continue;
      same.push(`${key} = "${a}"`);
    }
    expect(same, same.join("\n")).toEqual([]);
  });
});
