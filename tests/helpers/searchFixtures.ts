import path from "node:path";
import type { Json } from "./notesViewWorld.js";
import type { MemoriaWorld } from "./memoriaWorld.js";

/**
 * Two worlds in which the weight bm25 gives a word depends on files the caller may not see (plan amendment 7, round 1
 * finding 4), shared by the proofs of C113, C120 and C163 so that each fails when a device or a run is ranked over the
 * index of the whole home.
 */

export const filler = (n: number, word = "palavra"): string =>
  Array.from({ length: n }, () => word).join(" ");

export interface Fixture {
  name: string;
  query: string;
  visible: Array<[string, string]>;
  hidden: Array<[string, string]>;
  /** What the unmodified shared index would order. */
  twin: string[];
}

/**
 * Two worlds in which the weight bm25 gives a word depends on files the caller may not see:
 * - `idf`: two words; 40 hidden notes hold the first (its document frequency rises, its weight falls to the floor and the
 *   second decides), so over the whole index `b` leads and without the hidden notes `a` does;
 * - `avgdl`: one word; 30 hidden notes of 500 words, with no such word, raise the average length, so a long note holding
 *   it twice overtakes a short one holding it once.
 */
export const FIXTURES: Fixture[] = [
  {
    name: "idf",
    query: "zebra gato",
    visible: [
      ["a.md", `# A\n\n${[...Array(3).fill("zebra"), ...Array(2).fill("gato")].join(" ")} ${filler(25)}\n`],
      ["b.md", `# B\n\n${[...Array(1).fill("zebra"), ...Array(3).fill("gato")].join(" ")} ${filler(26)}\n`],
      ...Array.from(
        { length: 8 },
        (_, i) => [`cheio-${i}.md`, `# Cheio ${i}\n\n${filler(29)}\n`] as [string, string],
      ),
    ],
    hidden: Array.from(
      { length: 40 },
      (_, i) => [`h${i}.md`, `# H${i}\n\nzebra ${filler(29)}\n`] as [string, string],
    ),
    twin: ["a.md", "b.md"],
  },
  {
    name: "avgdl",
    query: "zebra",
    visible: [
      ["a.md", `# A\n\nzebra ${filler(8)}\n`],
      ["b.md", `# B\n\nzebra zebra ${filler(76)}\n`],
      ...Array.from(
        { length: 8 },
        (_, i) => [`cheio-${i}.md`, `# Cheio ${i}\n\n${filler(18)}\n`] as [string, string],
      ),
    ],
    hidden: Array.from(
      { length: 30 },
      (_, i) => [`h${i}.md`, `# H${i}\n\n${filler(498)}\n`] as [string, string],
    ),
    twin: ["a.md", "b.md"],
  },
];

export const order = (body: unknown, dir: string): string[] =>
  (body as Json[])
    .map((hit) => path.relative(dir, hit.path as string))
    .filter((p) => p === "a.md" || p === "b.md");

/** The visible notes in `notes/outra/` and the hidden ones in `notes/fin/`, indexed. */
export async function seedFixture(
  w: MemoriaWorld,
  fixture: Fixture,
): Promise<{ fin: string; outra: string }> {
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  for (const [name, body] of fixture.visible) w.put(path.join(outra, name), body);
  for (const [name, body] of fixture.hidden) w.put(path.join(fin, name), body);
  await w.index();
  return { fin, outra };
}
