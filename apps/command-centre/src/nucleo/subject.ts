/**
 * The item being asked about (conceito em todo o sistema, S7). "Ask the
 * agent" on a focused thing — a pendência, a run, a skill, a connector —
 * makes it the subject: the shell lists it among what the voice line can
 * point at, so its `@ref` resolves like a lâmina's, and the line opens with
 * that reference in it. A lâmina (an artifact) is already referenceable and
 * uses its own `@ref`.
 */
import { useSyncExternalStore } from "react";
import type { PanelKind } from "../desktop/panelKinds";
import { CONSOLE_DRAFT_EVENT, readConsoleDraft, storeConsoleDraft } from "../desktop/consoleDraft";

export interface Subject {
  /** Stable id, e.g. `subject:run:<id>`. */
  id: string;
  kind: PanelKind;
  /** The one-word `@name` the line resolves. */
  ref: string;
  /** How the agent is told about it. */
  title: string;
  /** A file the agent can read, when there is one. */
  path?: string;
}

let current: Subject | null = null;
const listeners = new Set<() => void>();

export function setSubject(next: Subject | null): void {
  current = next;
  for (const fn of listeners) fn();
}
export function getSubject(): Subject | null {
  return current;
}
export function useSubject(): Subject | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSubject,
    () => null,
  );
}

/** Put words on the voice line and hand the focus to it (the conversation opens). */
export function askAgent(text: string): void {
  const draft = readConsoleDraft();
  storeConsoleDraft({ ...draft, text });
  window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>(".cons-input");
    input?.focus();
    input?.setSelectionRange(text.length, text.length);
  });
}

/** A word safe for an `@reference`: letters, digits and dashes. */
export function refWord(...parts: string[]): string {
  return parts
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Make the item the subject and open the conversation with its reference in the line. */
export function askAbout(subject: Subject, lead = ""): void {
  setSubject(subject);
  askAgent(`@${subject.ref} ${lead}`);
}
