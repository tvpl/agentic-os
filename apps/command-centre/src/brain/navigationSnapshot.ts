import { clampZoom } from "./engine/world";

const KEY = "mordomo.brainNavigation.v1";
interface Snapshot {
  version: 1;
  params: string;
  camera: { x: number; y: number; k: number };
}

/** Per-tab navigation context. Explicit deep links take precedence over it. */
export function loadBrainNavigation(): Snapshot | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Snapshot | null;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.params !== "string" ||
      value.params.length > 32_768 ||
      !value.camera ||
      ![value.camera.x, value.camera.y, value.camera.k].every(Number.isFinite)
    )
      return null;
    return { ...value, camera: { ...value.camera, k: clampZoom(value.camera.k) } };
  } catch {
    return null;
  }
}

export function saveBrainNavigation(params: URLSearchParams, camera: Snapshot["camera"]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 1, params: params.toString(), camera }));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}
