/**
 * The agent's live activity as the entity shows it: each humanized event of
 * the running turn becomes a satellite with a kind (its glyph) and the
 * moment it was first seen. Pure, so the mapping is tested.
 */
import type { HumanEvent } from "../runs/humanize";
import type { EntityActivity } from "./entity/Entity";

const KINDS: Array<[RegExp, EntityActivity["kind"]]> = [
  [/\b(edit|escrev|wrote|write|cri(ei|ou)|created|alter)/i, "write"],
  [/\b(execut|ran|run|rod(ei|ou)|comando|command)/i, "run"],
  [/\b(busc|busq|search|grep|procur|find|encontr)/i, "search"],
  [/\b(web|http|fetch|site|url|naveg)/i, "web"],
  [/\b(li\b|leu|read|abri|open|olh)/i, "read"],
  [/\b(pens|think|plan)/i, "think"],
];

export function activityKind(text: string): EntityActivity["kind"] {
  for (const [re, kind] of KINDS) if (re.test(text)) return kind;
  return "other";
}

/**
 * Merge the latest events into the known satellites: an event already seen
 * keeps its id and birth time; a new one is born `now`. Newest last, at most
 * `max`.
 */
export function mergeActivity(
  known: readonly EntityActivity[],
  events: readonly HumanEvent[],
  now: number,
  max = 6,
): EntityActivity[] {
  const byKey = new Map(known.map((a) => [a.id, a]));
  const out: EntityActivity[] = [];
  events.forEach((e, i) => {
    const id = `${i}:${e.text}:${e.subject ?? ""}`;
    const prev = byKey.get(id);
    out.push(
      prev ?? {
        id,
        label: (e.subject ?? e.text).split("/").pop()!.slice(0, 28),
        kind: activityKind(e.text),
        at: now,
      },
    );
  });
  return out.slice(-max);
}
