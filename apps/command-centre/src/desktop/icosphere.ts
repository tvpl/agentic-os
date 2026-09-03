/**
 * Wireframe icosphere geometry for the desktop wallpaper: an icosahedron
 * subdivided once (42 vertices, 120 unique edges), plus rotation and a
 * perspective projection. Pure maths, unit-tested; no canvas here.
 */

export type Vec3 = [number, number, number];
export type Edge = [number, number];

export interface Mesh {
  vertices: Vec3[];
  edges: Edge[];
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Unit icosahedron: 12 vertices, 20 faces. */
export function icosahedron(): { vertices: Vec3[]; faces: Array<[number, number, number]> } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices: raw.map(normalize), faces };
}

/** Icosahedron subdivided `level` times, projected back onto the unit sphere; unique undirected edges. */
export function icosphere(level = 1): Mesh {
  let { vertices, faces } = icosahedron();
  for (let l = 0; l < level; l++) {
    const cache = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const va = vertices[a]!;
      const vb = vertices[b]!;
      vertices.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
      const idx = vertices.length - 1;
      cache.set(key, idx);
      return idx;
    };
    const next: Array<[number, number, number]> = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
    vertices = vertices.slice();
  }
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const [a, b, c] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as Edge[]) {
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(p < q ? [p, q] : [q, p]);
    }
  }
  return { vertices, edges };
}

/** Rotate around X then Y (radians). */
export function rotate(v: Vec3, ax: number, ay: number): Vec3 {
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const y1 = v[1] * cx - v[2] * sx;
  const z1 = v[1] * sx + v[2] * cx;
  const x2 = v[0] * cy + z1 * sy;
  const z2 = -v[0] * sy + z1 * cy;
  return [x2, y1, z2];
}

export interface Projected {
  x: number;
  y: number;
  /** 0 = farthest, 1 = nearest (after rotation). */
  depth: number;
  /** Perspective scale applied to this vertex. */
  scale: number;
}

/**
 * Perspective projection of a unit-sphere point scaled by `radius` around
 * (cx, cy); `fov` is the camera distance in radii (larger = flatter).
 */
export function project(v: Vec3, cx: number, cy: number, radius: number, fov = 4): Projected {
  const scale = fov / (fov - v[2]);
  return { x: cx + v[0] * radius * scale, y: cy + v[1] * radius * scale, depth: (v[2] + 1) / 2, scale };
}

/** Alpha for an edge from the mean depth of its ends: near bright, far faint. */
export function edgeAlpha(depthA: number, depthB: number, min = 0.08, max = 0.7): number {
  const d = (depthA + depthB) / 2;
  return min + (max - min) * d * d;
}
