/**
 * Expanding and collapsing memory hubs: relayout, directed fan (explosion)
 * and the burst effect. Pure over the world so the view stays declarative.
 */
import { applyPlan, planExplosion } from "./explosion";
import { layoutFiles } from "./layouts";
import type { Hub, World } from "./world";

export interface HubToggleOptions {
  /** Focus mode: opening a hub closes every other open hub. */
  focusMode: boolean;
  /** World clock for the burst effect (seconds). */
  now: number;
}

/**
 * Toggle one hub. Every hub whose state changed gets a deterministic fan
 * (files leave from / return to the hub disc). Returns those hubs.
 */
export function toggleHub(w: World, hub: Hub, opts: HubToggleOptions): Hub[] {
  const changed: Hub[] = [hub];
  hub.expanded = !hub.expanded;
  if (hub.expanded) {
    hub.everExpanded = true;
    if (opts.focusMode) {
      for (const other of w.hubs) {
        if (other === hub || !other.expanded) continue;
        other.expanded = false;
        changed.push(other);
      }
    }
  }
  fan(w, changed);
  w.effects.push({ x: hub.x, y: hub.y, start: opts.now, color: hub.color });
  return changed;
}

/** Expand or collapse every hub at once; returns the hubs that changed. */
export function setHubsExpanded(w: World, expanded: boolean): Hub[] {
  const changed = w.hubs.filter((h) => h.expanded !== expanded);
  for (const h of changed) {
    h.expanded = expanded;
    if (expanded) h.everExpanded = true;
  }
  if (changed.length > 0) fan(w, changed);
  return changed;
}

function fan(w: World, hubs: Hub[]): void {
  layoutFiles(w);
  for (const hub of hubs) applyPlan(w, planExplosion(w, hub));
}
