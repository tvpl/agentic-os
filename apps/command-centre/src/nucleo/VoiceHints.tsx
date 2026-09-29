/**
 * Intents (immersive shell): what you could ask the agent here, above the
 * voice line while it is empty — three sentences that fit the scene you are
 * in and what is going on in it. A click puts the sentence on the line;
 * Enter sends it. They step away as soon as you type.
 */
import { useMemo } from "react";
import { useT, type TKey } from "../i18n";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "../desktop/consoleDraft";
import type { SceneId } from "./scenes";
import type { PendingItem } from "./pending/model";
import { describePending } from "./pending/describe";

const BY_SCENE: Partial<Record<SceneId, TKey[]>> = {
  nucleo: ["nucleo.hint.away", "nucleo.hint.plan", "nucleo.hint.can"],
  brain: ["nucleo.hint.brainWeek", "nucleo.hint.brainLinks", "nucleo.hint.brainGaps"],
  runs: ["nucleo.hint.runsFailed", "nucleo.hint.runsCost", "nucleo.hint.runsSlow"],
  skills: ["nucleo.hint.skillsWhich", "nucleo.hint.skillsNew", "nucleo.hint.skillsBest"],
  routines: ["nucleo.hint.routinesTonight", "nucleo.hint.routinesNew", "nucleo.hint.routinesHealth"],
};

export default function VoiceHints({ scene, pending }: { scene: SceneId; pending: readonly PendingItem[] }) {
  const t = useT();
  const hints = useMemo(() => {
    const out: string[] = [];
    // What is broken comes first: asking about it is the most useful thing to say.
    const broken = pending.find((i) => i.kind === "failure" || i.kind === "routine");
    if (broken)
      out.push(
        t("nucleo.hint.why", {
          what: broken.routine ? broken.routine.name : describePending(broken, t).title,
        }),
      );
    for (const key of BY_SCENE[scene] ?? ["nucleo.hint.can"]) out.push(t(key));
    return out.slice(0, 3);
  }, [scene, pending, t]);
  const put = (text: string) => {
    const draft = readConsoleDraft();
    storeConsoleDraft({ ...draft, text });
    window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".cons-input");
      input?.focus();
      input?.setSelectionRange(text.length, text.length);
    });
  };
  return (
    <div className="nu-hints" key={scene}>
      {hints.map((h, i) => (
        <button
          key={h}
          type="button"
          className="nu-hint"
          style={{ animationDelay: `${i * 70}ms` }}
          onClick={() => put(h)}
        >
          {h}
        </button>
      ))}
    </div>
  );
}
