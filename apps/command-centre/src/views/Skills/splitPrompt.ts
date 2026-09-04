/**
 * "Split assistant": a prompt that asks the agent to turn a thick SKILL.md
 * into a short router plus resource files. Pure, unit-tested.
 */
import type { Skill } from "../../api";

export const ROUTER_TARGET_LINES = 60;

/** Top-level and second-level headings of the body, in order (used to suggest the split). */
export function sectionHeadings(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (m) out.push(m[2]!);
  }
  return out;
}

export function buildSplitPrompt(skill: Pick<Skill, "name" | "slug" | "skillFile" | "bodyLineCount" | "body" | "resources">): string {
  const headings = sectionHeadings(skill.body);
  const existing = skill.resources.length > 0 ? skill.resources.map((r) => `  - ${r}`).join("\n") : "  (none yet)";
  const sections = headings.length > 0 ? headings.map((h) => `  - ${h}`).join("\n") : "  (no headings found — split by topic)";
  return [
    `Split the MordomoOS skill "${skill.name}" (/${skill.slug}) into a short router plus reference files.`,
    ``,
    `Skill file: ${skill.skillFile}`,
    `Current body: ${skill.bodyLineCount} lines. Target: a SKILL.md body under ${ROUTER_TARGET_LINES} lines.`,
    ``,
    `Sections found in the body:`,
    sections,
    ``,
    `Existing resource files (keep them, reuse where sensible):`,
    existing,
    ``,
    `Do this:`,
    `1. Keep the YAML frontmatter exactly as it is (only bump \`version\` and add a \`changelog\` entry).`,
    `2. Move every reference, template, checklist and long example into files under resources/ (one topic per file, kebab-case names, markdown unless the content is HTML/CSS/data).`,
    `3. Rewrite the SKILL.md body as a router: the goal in two lines, the procedure as numbered steps, and for each step the exact resource file to read ("Read resources/<file>.md before step N"). Nothing the agent does not need for every run stays in the body.`,
    `4. Preserve every guardrail and success criterion; do not change behaviour, only where the text lives.`,
    `5. Report the new body line count and the list of files you created or changed, with full paths.`,
  ].join("\n");
}
