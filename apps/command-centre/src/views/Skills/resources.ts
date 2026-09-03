/** Pure helpers for skill resources (URL building, sizing, kind detection). Unit-tested. */
import { getToken, type Skill, type SkillResource, type SkillResourceKind } from "../../api";

const KIND_BY_EXT: Record<string, SkillResourceKind> = {
  md: "markdown", markdown: "markdown", mdx: "markdown",
  html: "html", htm: "html",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image",
  pdf: "pdf",
};

/** Same classification the core catalog applies (used for older servers that only send `resources: string[]`). */
export function kindOf(name: string): SkillResourceKind {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "other";
  return KIND_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? "other";
}

/** Rich resource list: `resourceFiles` when the server sends it, else derived from the legacy `resources` paths. */
export function resourcesOf(skill: Pick<Skill, "resources" | "resourceFiles">): SkillResource[] {
  if (skill.resourceFiles) return skill.resourceFiles;
  return (skill.resources ?? []).map((rel) => {
    const name = rel.split("/").pop() ?? rel;
    return { name, rel, kind: kindOf(name), size: 0 };
  });
}

/** `GET /api/skills/:slug/resource?rel=` — `withToken` for src attributes (img/iframe cannot send headers). */
export function resourceUrl(slug: string, rel: string, withToken = false): string {
  const base = `/api/skills/${encodeURIComponent(slug)}/resource?rel=${encodeURIComponent(rel)}`;
  return withToken && getToken() ? `${base}&token=${encodeURIComponent(getToken())}` : base;
}

/** Inline preview cap for text (markdown) resources. */
export const MAX_INLINE_TEXT_BYTES = 512 * 1024;

export function canPreviewInline(r: SkillResource): boolean {
  if (r.kind === "markdown") return r.size <= MAX_INLINE_TEXT_BYTES;
  return r.kind === "html" || r.kind === "image";
}

/** Group by top-level folder ("resources", "brand", …; "" for files at the root), keeping order. */
export function groupByFolder(list: SkillResource[]): Array<{ folder: string; items: SkillResource[] }> {
  const groups = new Map<string, SkillResource[]>();
  for (const r of list) {
    const i = r.rel.indexOf("/");
    const folder = i === -1 ? "" : r.rel.slice(0, i);
    const arr = groups.get(folder);
    if (arr) arr.push(r);
    else groups.set(folder, [r]);
  }
  return [...groups.entries()].map(([folder, items]) => ({ folder, items }));
}
