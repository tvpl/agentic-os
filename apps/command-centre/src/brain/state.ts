/**
 * Second Brain UI state: the persisted preferences (`BrainSettings`) plus the
 * transient view state, and the pure codecs between that state, the URL hash
 * query (`#/brain?sel=..&layout=..`) and the server / localStorage blobs
 * (items 37, 38). No React here so every rule is unit tested.
 */
import {
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  EDGE_KINDS,
  LAYOUTS,
  type BrainFilters,
  type BrainSettings,
  type EdgeKind,
  type LayoutKind,
  type ModifiedRange,
  type QueryGroup,
  type SizeRange,
  type ViewKind,
  type WorkspaceState,
} from "./engine/world";

export interface BrainUi extends BrainSettings {
  /** Local mode: only N hops around the selection stay visible. */
  local: boolean;
  /** Selected file id. */
  sel: number | null;
  filters: BrainFilters;
  groups: QueryGroup[];
  filterGroup: string | null;
  query: string;
  /** Workspace mode: pins and collapsed hubs are saved to the server as they change. */
  workspaceMode: boolean;
}

export const STORAGE_KEY = "mordomo.brain.settings";
export const MODIFIED_RANGES: readonly ModifiedRange[] = ["24h", "7d", "30d", "all"];
export const SIZE_RANGES: readonly SizeRange[] = ["any", "small", "medium", "large"];
export const GROUP_PALETTE = ["#f97316", "#22d3ee", "#4ade80", "#f472b6"];

export function defaultUi(settings: BrainSettings = DEFAULT_SETTINGS): BrainUi {
  return {
    ...settings,
    edgeKinds: [...settings.edgeKinds],
    local: false,
    sel: null,
    filters: { ...DEFAULT_FILTERS },
    groups: [],
    filterGroup: null,
    query: "",
    workspaceMode: false,
  };
}

const isLayout = (v: unknown): v is LayoutKind =>
  typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);
const isView = (v: unknown): v is ViewKind => v === "areas" || v === "folders";
const isKind = (v: unknown): v is EdgeKind =>
  typeof v === "string" && (EDGE_KINDS as readonly string[]).includes(v);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

/** Validate an untrusted blob (server `settings.brain`, localStorage) into a partial settings object. */
export function parseBrainSettings(raw: unknown): Partial<BrainSettings> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<BrainSettings> = {};
  if (isLayout(r.layout)) out.layout = r.layout;
  if (isView(r.view)) out.view = r.view;
  const spin = num(r.spin, 0, 1);
  if (spin !== undefined) out.spin = spin;
  if (typeof r.showNames === "boolean") out.showNames = r.showNames;
  const linkSpring = num(r.linkSpring, 0.01, 0.2);
  if (linkSpring !== undefined) out.linkSpring = linkSpring;
  const nodeScale = num(r.nodeScale, 0.4, 2);
  if (nodeScale !== undefined) out.nodeScale = nodeScale;
  const clusterSize = num(r.clusterSize, 0.5, 1.8);
  if (clusterSize !== undefined) out.clusterSize = clusterSize;
  if (Array.isArray(r.edgeKinds)) out.edgeKinds = r.edgeKinds.filter(isKind);
  const hops = num(r.localHops, 1, 3);
  if (hops !== undefined) out.localHops = Math.round(hops);
  if (typeof r.focusMode === "boolean") out.focusMode = r.focusMode;
  const ws = r.workspace;
  if (ws && typeof ws === "object") {
    const o = ws as Record<string, unknown>;
    const pinned = Array.isArray(o.pinned)
      ? o.pinned
          .filter(
            (p): p is { id: number; x: number; y: number } =>
              !!p &&
              typeof p === "object" &&
              typeof (p as { id?: unknown }).id === "number" &&
              typeof (p as { x?: unknown }).x === "number" &&
              typeof (p as { y?: unknown }).y === "number",
          )
          .map((p) => ({ id: p.id, x: p.x, y: p.y }))
      : [];
    const collapsed = Array.isArray(o.collapsed)
      ? o.collapsed.filter((c): c is string => typeof c === "string")
      : [];
    out.workspace = { pinned, collapsed };
  }
  return out;
}

/** The persisted subset of the UI state. */
export function settingsFromUi(ui: BrainUi, workspace?: WorkspaceState): BrainSettings {
  const s: BrainSettings = {
    layout: ui.layout,
    view: ui.view,
    spin: ui.spin,
    showNames: ui.showNames,
    linkSpring: ui.linkSpring,
    nodeScale: ui.nodeScale,
    clusterSize: ui.clusterSize,
    edgeKinds: [...ui.edgeKinds],
    localHops: ui.localHops,
    focusMode: ui.focusMode,
  };
  const ws = workspace ?? ui.workspace;
  if (ws) s.workspace = { pinned: ws.pinned.map((p) => ({ ...p })), collapsed: [...ws.collapsed] };
  return s;
}

/** Settings keys the URL takes precedence over (URL → server → localStorage). */
export function urlControlledKeys(params: URLSearchParams): Set<keyof BrainSettings> {
  const keys = new Set<keyof BrainSettings>();
  if (params.has("layout")) keys.add("layout");
  if (params.has("view")) keys.add("view");
  if (params.has("kinds")) keys.add("edgeKinds");
  if (params.has("hops")) keys.add("localHops");
  return keys;
}

const list = (v: string | null): string[] =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/** Overlay the hash query on a base state. Unknown or malformed values are ignored. */
export function uiFromParams(params: URLSearchParams, base: BrainUi): BrainUi {
  const ui: BrainUi = {
    ...base,
    filters: { ...base.filters },
    edgeKinds: [...base.edgeKinds],
    groups: [...base.groups],
  };
  const sel = params.get("sel");
  if (sel !== null && /^\d+$/.test(sel)) ui.sel = Number(sel);
  const layout = params.get("layout");
  if (isLayout(layout)) ui.layout = layout;
  const view = params.get("view");
  if (isView(view)) ui.view = view;
  if (params.get("local") === "1") ui.local = true;
  const hops = Number(params.get("hops"));
  if (hops >= 1 && hops <= 3) ui.localHops = Math.round(hops);
  const kinds = params.get("kinds");
  if (kinds !== null) ui.edgeKinds = list(kinds).filter(isKind);
  const exts = list(params.get("ext"));
  if (exts.length) ui.filters.exts = exts;
  const tags = list(params.get("tag"));
  if (tags.length) ui.filters.tags = tags;
  const mod = params.get("mod");
  if (mod && (MODIFIED_RANGES as readonly string[]).includes(mod)) ui.filters.modified = mod as ModifiedRange;
  const size = params.get("size");
  if (size && (SIZE_RANGES as readonly string[]).includes(size)) ui.filters.size = size as SizeRange;
  const q = params.get("q");
  if (q) ui.query = q;
  const group = params.get("group");
  if (group) ui.filterGroup = group;
  const groups = params.get("groups");
  if (groups) ui.groups = decodeGroups(groups);
  return ui;
}

/** Only the non-default view state goes to the URL so links stay short. */
export function paramsFromUi(ui: BrainUi): URLSearchParams {
  const p = new URLSearchParams();
  if (ui.sel !== null) p.set("sel", String(ui.sel));
  if (ui.layout !== DEFAULT_SETTINGS.layout) p.set("layout", ui.layout);
  if (ui.view !== DEFAULT_SETTINGS.view) p.set("view", ui.view);
  if (ui.local) p.set("local", "1");
  if (ui.localHops !== DEFAULT_SETTINGS.localHops) p.set("hops", String(ui.localHops));
  const kinds = [...ui.edgeKinds].sort().join(",");
  if (kinds !== [...DEFAULT_SETTINGS.edgeKinds].sort().join(",")) p.set("kinds", kinds);
  if (ui.filters.exts.length) p.set("ext", ui.filters.exts.join(","));
  if (ui.filters.tags.length) p.set("tag", ui.filters.tags.join(","));
  if (ui.filters.modified !== "all") p.set("mod", ui.filters.modified);
  if (ui.filters.size !== "any") p.set("size", ui.filters.size);
  if (ui.query.trim()) p.set("q", ui.query.trim());
  if (ui.filterGroup) p.set("group", ui.filterGroup);
  const groups = encodeGroups(ui.groups);
  if (groups) p.set("groups", groups);
  return p;
}

/** `query~rrggbb|query~rrggbb` — the separators are stripped from queries. */
export function encodeGroups(groups: QueryGroup[]): string {
  return groups
    .filter((g) => g.query.trim())
    .map((g) => `${g.query.replace(/[|~]/g, "").trim()}~${g.color.replace("#", "").toLowerCase()}`)
    .join("|");
}

export function decodeGroups(raw: string): QueryGroup[] {
  return raw
    .split("|")
    .map((part) => {
      const [query = "", color = ""] = part.split("~");
      const hex = /^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : GROUP_PALETTE[0]!;
      return { query: query.trim(), color: hex };
    })
    .filter((g) => g.query !== "")
    .slice(0, 4);
}

export function sameParams(a: URLSearchParams, b: URLSearchParams): boolean {
  const ea = [...a.entries()].sort().join("&");
  const eb = [...b.entries()].sort().join("&");
  return ea === eb;
}

export function loadLocalSettings(): Partial<BrainSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseBrainSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveLocalSettings(settings: BrainSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / blocked storage */
  }
}
