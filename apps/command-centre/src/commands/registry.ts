/**
 * The command registry (.specs/features/comandos-atalhos): every named action
 * the palette, a shortcut and the shortcuts sheet show, registered by the
 * component that owns it for as long as it is mounted, and the one keydown
 * listener (`CommandsProvider`) that sends a key to a command.
 *
 * Scope semantics (door 2), innermost first:
 *   `modal` > `overlay` > `view:<app>` > shell (`moldura` | `nucleo`) > `global`
 *
 * - A scope is *active* while a component has commands registered in it. A
 *   key goes to the first active scope that has a live command for it (its
 *   `when()` is not false and, in a text field, a modifier or `allowInInput`),
 *   and the scopes below do not get it. A command whose keys fall through
 *   this way is skipped, not consumed.
 * - `modal` and `overlay` are layers: while one is up, nothing under it is
 *   active — the screen behind a dialog is inert, so its keys must not fire.
 *   `modal` is up while a dialog of `components/dialog.tsx` is open or the key
 *   comes from inside a `role="dialog"` that is modal (not a popover); `overlay`
 *   is held with `useCommandScope` (the focus mode). A layer's own commands
 *   (a dialog closing itself with its toggle key) are registered in it.
 * - Of several mounted instances of one screen (`exclusive`), the newest owns
 *   the keys; a screen on its way out stands down (`CommandsGate`).
 *
 * The same combination in the same scope twice throws in development and test
 * builds (both ids in the message) and only warns in production, so a
 * collision never takes down the interface of someone who bought it.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import type { TKey } from "../i18n";
import { getDialogDepth } from "../components/dialog";
import { canonicalCombo, hasModifier, isMac, isTypingTarget, matchesCombo } from "./keys";

export type CommandScope = "global" | "moldura" | "nucleo" | `view:${string}` | "overlay" | "modal";
export type CommandGroup = "apps" | "actions" | "navigation" | "view";

/** Door 1. `keys` are written `"Mod+K"`, `"Shift+1"`, `"["`, `"Escape"` (see ./keys). */
export interface Command {
  id: string;
  title: TKey;
  group: CommandGroup;
  scope: CommandScope;
  keys?: string[];
  keywords?: string[];
  icon?: LucideIcon;
  /** Listed in the palette's "Apps" (group `apps`) or "Actions" (any other group). */
  palette?: boolean;
  /** Bare keys stay letters in a field; this one answers there too. */
  allowInInput?: boolean;
  /** While false the command is skipped: its keys fall through and the palette hides it. */
  when?: () => boolean;
  run: () => void;
}

const RANK = { global: 0, moldura: 1, nucleo: 1, view: 2, overlay: 3, modal: 4 } as const;
export function scopeRank(scope: CommandScope): number {
  return scope.startsWith("view:") ? RANK.view : RANK[scope as keyof typeof RANK];
}
const isLayer = (scope: CommandScope) => scope === "modal" || scope === "overlay";

/** The commands' order everywhere they are listed: outer scopes first, then registration order. */
function ordered(entries: ReadonlyArray<{ commands: readonly Command[] }>): Command[] {
  const all = entries.flatMap((e) => e.commands);
  return all
    .map((c, i) => ({ c, i }))
    .sort((a, b) => scopeRank(a.c.scope) - scopeRank(b.c.scope) || a.i - b.i)
    .map((x) => x.c);
}

/** Dev and test builds refuse a collision; a production build only says so (plan Assumptions). */
const STRICT = import.meta.env.MODE !== "production";

export class CommandRegistry {
  private entries: Array<{ token: symbol; commands: readonly Command[] }> = [];
  private layers = new Map<CommandScope, number>();
  private instances = new Map<string, symbol[]>();
  private listeners = new Set<() => void>();
  private snapshot: readonly Command[] = [];

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Every registered command, outer scopes first and in registration order within one. */
  list = (): readonly Command[] => this.snapshot;

  private changed() {
    this.snapshot = ordered(this.entries);
    for (const fn of this.listeners) fn();
  }

  /** Throws (dev, test) when one of `commands` takes a combination another command holds in its scope. */
  private check(token: symbol, commands: readonly Command[]) {
    const mac = isMac();
    const taken = new Map<string, Command>();
    for (const e of this.entries) {
      if (e.token === token) continue;
      for (const c of e.commands)
        for (const k of c.keys ?? []) taken.set(`${c.scope} ${canonicalCombo(k, mac)}`, c);
    }
    for (const c of commands) {
      for (const k of new Set((c.keys ?? []).map((x) => canonicalCombo(x, mac)))) {
        const slot = `${c.scope} ${k}`;
        const other = taken.get(slot);
        if (other && other !== c) {
          const msg = `Key "${k}" is registered twice in scope "${c.scope}": ${other.id} and ${c.id}`;
          if (STRICT) throw new Error(msg);
          console.warn(msg);
        }
        taken.set(slot, c);
      }
    }
  }

  /**
   * Register `commands`; the returned function takes them away again. A
   * caller that keeps `token` can `replace` them later without moving them.
   */
  register(commands: readonly Command[], token: symbol = Symbol("commands")): () => void {
    this.check(token, commands);
    this.entries.push({ token, commands });
    this.changed();
    return () => {
      this.entries = this.entries.filter((e) => e.token !== token);
      this.changed();
    };
  }

  /** Swap what one registration holds without moving it in the order. */
  replace(token: symbol, commands: readonly Command[]) {
    const entry = this.entries.find((e) => e.token === token);
    if (!entry || entry.commands === commands) return;
    this.check(token, commands);
    entry.commands = commands;
    this.changed();
  }

  /** Make a scope active with no command of its own (a layer that only hides what is under it). */
  activate(scope: CommandScope): () => void {
    this.layers.set(scope, (this.layers.get(scope) ?? 0) + 1);
    return () => this.layers.set(scope, (this.layers.get(scope) ?? 1) - 1);
  }

  /** One of several mounted instances answers: the newest. */
  claim(key: string, token: symbol): () => void {
    this.instances.set(key, [...(this.instances.get(key) ?? []), token]);
    this.changed();
    return () => {
      this.instances.set(
        key,
        (this.instances.get(key) ?? []).filter((t) => t !== token),
      );
      this.changed();
    };
  }
  newest(key: string): symbol | undefined {
    return this.instances.get(key)?.at(-1);
  }

  /** The active scopes for a key pressed on `target`, innermost first. */
  activeScopes(target: EventTarget | null = null): CommandScope[] {
    const last = new Map<CommandScope, number>([["global", -1]]);
    this.entries.forEach((e, i) => {
      for (const c of e.commands) last.set(c.scope, i);
    });
    for (const [scope, n] of this.layers) if (n > 0 && !last.has(scope)) last.set(scope, -1);
    // A dialog is up (the stack in components/dialog), or the key came from inside one. A popover
    // (`aria-modal="false"`: the frame's bell) is not a modal: the screen behind it stays live.
    const inDialog =
      target instanceof Element && target.closest('[role="dialog"]:not([aria-modal="false"])') !== null;
    if ((getDialogDepth() > 0 || inDialog) && !last.has("modal")) last.set("modal", -1);
    const scopes = [...last.keys()].sort(
      (a, b) => scopeRank(b) - scopeRank(a) || last.get(b)! - last.get(a)!,
    );
    const layer = scopes.findIndex(isLayer);
    return layer >= 0 ? [scopes[layer]!] : scopes;
  }

  /** Run the command `e` belongs to, if any. True when one ran. */
  handle(e: KeyboardEvent): boolean {
    // A key that belongs to someone else: already handled (`defaultPrevented`), part of an IME
    // composition (`isComposing`, and keyCode 229, which is all Safari says for the key that
    // ends one), or the guided tour's (it owns the keyboard while it is up).
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
    if (document.documentElement.dataset.onboarding) return false;
    const mac = isMac();
    const typing = isTypingTarget(e.target);
    for (const scope of this.activeScopes(e.target)) {
      for (const c of this.snapshot) {
        if (c.scope !== scope) continue;
        const combo = c.keys?.find((k) => matchesCombo(k, e, mac));
        if (!combo) continue;
        if (typing && !c.allowInInput && !hasModifier(combo)) continue;
        if (c.when && !c.when()) continue;
        e.preventDefault();
        c.run();
        return true;
      }
    }
    return false;
  }
}

const RegistryContext = createContext<CommandRegistry | null>(null);
/** False inside something on its way out (a scene leaving, a lâmina dissolving): its commands stand down. */
const EnabledContext = createContext(true);

export function CommandsProvider({
  children,
  registry: given,
}: {
  children: ReactNode;
  registry?: CommandRegistry;
}) {
  const [registry] = useState(() => given ?? new CommandRegistry());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => registry.handle(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);
  return createElement(RegistryContext.Provider, { value: registry }, children);
}

export function CommandsGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return createElement(EnabledContext.Provider, { value: enabled }, children);
}

/**
 * Outside a provider (a view rendered on its own: a unit test, the gallery)
 * there is no keyboard to answer: the hooks below do nothing there.
 */
const NONE = new CommandRegistry();

export function useCommandRegistry(): CommandRegistry | null {
  return useContext(RegistryContext);
}

/** The registered commands, live. */
export function useRegisteredCommands(): readonly Command[] {
  const registry = useCommandRegistry() ?? NONE;
  return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
}

export interface UseCommandsOptions {
  enabled?: boolean;
  /**
   * Several mounted instances of one screen (a run in a lâmina and in the
   * Runs scene): only the newest registers, the others wait their turn.
   */
  exclusive?: string;
}

/**
 * Register `commands` while the calling component is mounted (and enabled).
 * A new array updates them in place; keep it memoised so the order holds.
 */
export function useCommands(commands: readonly Command[], opts: UseCommandsOptions = {}): void {
  const provided = useCommandRegistry();
  const registry = provided ?? NONE;
  const gate = useContext(EnabledContext);
  const on = provided !== null && (opts.enabled ?? true) && gate;
  const [token] = useState(() => Symbol("commands"));
  const exclusive = opts.exclusive;
  useLayoutEffect(() => {
    if (!on || !exclusive) return;
    return registry.claim(exclusive, token);
  }, [registry, exclusive, token, on]);
  const newest = useSyncExternalStore(
    registry.subscribe,
    () => !exclusive || registry.newest(exclusive) === token,
    () => true,
  );
  const live = on && newest;
  const latest = useRef(commands);
  latest.current = commands;
  useLayoutEffect(() => {
    if (!live) return;
    return registry.register(latest.current, token);
  }, [registry, token, live]);
  useLayoutEffect(() => {
    if (live) registry.replace(token, commands);
  }, [registry, token, live, commands]);
}

/** Hold a layer scope (`overlay`, `modal`) active while mounted, whether or not it has commands. */
export function useCommandScope(scope: CommandScope, active = true): void {
  const registry = useCommandRegistry();
  useLayoutEffect(
    () => (registry && active ? registry.activate(scope) : undefined),
    [registry, scope, active],
  );
}
