import matter from "gray-matter";

/**
 * The one way a SKILL.md is parsed. `gray-matter` picks its engine from the first line of the file
 * (`---js`, `---javascript`, `---coffee`, `---cson`), and its JavaScript engine `eval`s the block: a SKILL.md from
 * an imported folder, a registry or an agent that can write into `skills/` would run code as the owner the moment
 * the catalog is listed. Every engine that executes anything is replaced by one that refuses, and the options are
 * always passed (without options `gray-matter` answers from a cache keyed by the text, which would skip them).
 * Only YAML (the default) and JSON frontmatter remain.
 */
function refuse(): never {
  throw Object.assign(
    new Error("A SKILL.md frontmatter must be YAML or JSON: executable frontmatter engines are refused"),
    { statusCode: 400, code: "invalid_frontmatter" },
  );
}

const OPTIONS = {
  engines: {
    js: refuse,
    javascript: refuse,
    coffee: refuse,
    coffeescript: refuse,
    cson: refuse,
  },
};

export interface ParsedSkillFile {
  data: Record<string, unknown>;
  content: string;
}

export function parseSkillFile(raw: string): ParsedSkillFile {
  const parsed = matter(raw, OPTIONS);
  return { data: parsed.data as Record<string, unknown>, content: parsed.content };
}
