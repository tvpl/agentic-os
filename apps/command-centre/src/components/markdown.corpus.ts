/**
 * The Markdown the renderers are held to (.specs/features/limpeza-legado, C15): the same text drawn by the three
 * surfaces, the files a reference can resolve to and the skills a `/token` can name.
 */
export const FILES = [
  { id: 7, rel: "docs/guide.md", name: "guide.md" },
  { id: 9, rel: "notes/ideas.md", name: "ideas.md" },
];
export const KNOWN_SKILLS = ["deploy-site"];

/** Every kind of block and of inline the parser produces, but a table and a `mailto:` or `#` link. */
export const COMMON = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "### Heading three",
  "",
  "#### Heading four",
  "",
  "##### Heading five",
  "",
  "###### Heading six",
  "",
  "A paragraph with **strong**, *em*, `code`, a [web link](https://example.com/a?b=1&c=2), a [plain http link](http://example.com), a [note link](docs/guide.md), a [dangling link](missing/page.md), a path docs/guide.md, an unresolved path nowhere/x.md, the skill /deploy-site and an unknown skill /ghost-skill.",
  "",
  "> A quote with **strong** and a [note link](notes/ideas.md).",
  "",
  "---",
  "",
  "```ts",
  'const x = "<b>not html</b>";',
  "```",
  "",
  "```",
  "no language",
  "```",
  "",
  "- first item",
  "- Skills: /deploy-site, /ghost-skill",
  "- Files: docs/guide.md",
  "- [ ] open task",
  "- [x] done task",
  "",
  "1. one",
  "2. two **bold**",
].join("\n");

/** A pipe table with inline content in its cells. */
export const TABLE = [
  "| Name | Link |",
  "| --- | --- |",
  "| a | [x](https://example.com) |",
  "| b | `c` and docs/guide.md |",
].join("\n");
