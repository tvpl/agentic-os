/**
 * What a reply points at (refino item 1). The agent writes `@run-3df2` or
 * names a file it touched; the console turns each into a chip that opens
 * the panel. Open panels are matched by `@ref`, by title and by path;
 * anything else that looks like a file the agent wrote is offered as a
 * document to open. Pure and tested.
 */
import type { OpenPanel } from "../panelKinds";

export interface Citation {
  /** What the chip shows. */
  label: string;
  /** An open panel to raise, or a path to open as a document. */
  target: { panelId: string } | { path: string };
}

const FILE_RE =
  /(?:^|[\s(`'"])((?:\/|~\/|\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,6})(?=$|[\s)`'",.;:])/gi;
const REF_RE = /(?:^|[\s(])@([a-z0-9][\w-]*)/gi;
const MAX = 6;

export function citations(text: string, panels: readonly OpenPanel[]): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  const push = (label: string, target: Citation["target"]) => {
    const key = "panelId" in target ? `p:${target.panelId}` : `f:${target.path}`;
    if (seen.has(key) || out.length >= MAX) return;
    seen.add(key);
    out.push({ label, target });
  };
  for (const m of text.matchAll(REF_RE)) {
    const ref = m[1]!.toLowerCase();
    const panel = panels.find((p) => p.ref.toLowerCase() === ref);
    if (panel) push(`@${panel.ref}`, { panelId: panel.id });
  }
  for (const m of text.matchAll(FILE_RE)) {
    const path = m[1]!;
    const base = path.split("/").pop()!;
    const panel = panels.find((p) => p.path === path || p.path?.endsWith(`/${path}`) || p.title === base);
    if (panel) push(panel.title, { panelId: panel.id });
    else if (path.startsWith("/") || path.startsWith("~/")) push(base, { path });
  }
  return out;
}
