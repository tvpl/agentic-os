/**
 * What the agent remembered (refino items 8 and 34), read off the trace: a
 * call to the `recall` tool asks a question; its result lists the sections
 * it was handed as `## <path> § <section> (score N)`. Learned facts come the
 * same way from `facts_assert`. Pure and tested.
 */
import type { RunEventView } from "./useRunStream";
import { toolInput } from "./humanize";

export interface Recalled {
  question: string;
  paths: Array<{ path: string; section: string; score: number }>;
}

export interface LearnedFact {
  id: number | null;
  text: string;
}

const RECALL_TOOL = /(^|__)recall$/i;
const FACT_TOOL = /(^|__)facts_assert$/i;
const SECTION_RE = /^##\s+(.+?)\s+§\s+(.+?)\s+\(score\s+([\d.]+)\)/gm;

export function recallFromEvents(events: readonly RunEventView[]): Recalled[] {
  const out: Recalled[] = [];
  const pending = new Map<string, Recalled>();
  for (const e of events) {
    if (e.type !== "tool_use") continue;
    const tool = String(e.tool ?? "");
    const callId = typeof e.callId === "string" ? e.callId : "";
    if (RECALL_TOOL.test(tool) && e.phase !== "end") {
      const input = toolInput(e.detail);
      const r: Recalled = { question: typeof input.question === "string" ? input.question : "", paths: [] };
      out.push(r);
      if (callId) pending.set(callId, r);
      continue;
    }
    if (tool === "tool_result" && callId && pending.has(callId)) {
      const text = unquote(String(e.detail ?? ""));
      const r = pending.get(callId)!;
      for (const m of text.matchAll(SECTION_RE))
        r.paths.push({ path: m[1]!, section: m[2]!, score: Number(m[3]) });
      pending.delete(callId);
    }
  }
  return out;
}

export function factsFromEvents(events: readonly RunEventView[]): LearnedFact[] {
  const out: LearnedFact[] = [];
  const pending = new Map<string, LearnedFact>();
  for (const e of events) {
    if (e.type !== "tool_use") continue;
    const tool = String(e.tool ?? "");
    const callId = typeof e.callId === "string" ? e.callId : "";
    if (FACT_TOOL.test(tool) && e.phase !== "end") {
      const input = toolInput(e.detail);
      const text = [input.subject, input.predicate, input.object]
        .filter((v): v is string => typeof v === "string")
        .join(" ");
      const fact: LearnedFact = { id: null, text };
      out.push(fact);
      if (callId) pending.set(callId, fact);
      continue;
    }
    if (tool === "tool_result" && callId && pending.has(callId)) {
      const m = /fact #(\d+)/.exec(unquote(String(e.detail ?? "")));
      if (m) pending.get(callId)!.id = Number(m[1]);
      pending.delete(callId);
    }
  }
  return out;
}

/** The adapter stores results as JSON-encoded strings; a bare string stays as is. */
function unquote(s: string): string {
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.replace(/\\n/g, "\n").replace(/^"|"$/g, "");
    }
  }
  return s;
}
