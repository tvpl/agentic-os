import { describe, expect, it } from "vitest";
import { edgeAlpha, icosahedron, icosphere, project, rotate } from "./icosphere";

describe("icosphere geometry", () => {
  it("icosahedron has 12 unit vertices and 20 faces", () => {
    const { vertices, faces } = icosahedron();
    expect(vertices).toHaveLength(12);
    expect(faces).toHaveLength(20);
    for (const v of vertices) expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });

  it("one subdivision yields 42 vertices and 120 unique edges on the unit sphere", () => {
    const mesh = icosphere(1);
    expect(mesh.vertices).toHaveLength(42);
    expect(mesh.edges).toHaveLength(120);
    for (const v of mesh.vertices) expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    const keys = new Set(mesh.edges.map(([a, b]) => `${a}-${b}`));
    expect(keys.size).toBe(120);
    for (const [a, b] of mesh.edges) {
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(42);
    }
  });

  it("level 0 is the bare icosahedron (30 edges)", () => {
    expect(icosphere(0).edges).toHaveLength(30);
  });

  it("rotation preserves length and a full turn is the identity", () => {
    const v = rotate([0.3, 0.5, -0.8], 0.7, 1.3);
    expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(0.3, 0.5, -0.8), 6);
    const back = rotate([1, 0, 0], 0, Math.PI * 2);
    expect(back[0]).toBeCloseTo(1, 6);
    expect(back[2]).toBeCloseTo(0, 6);
  });

  it("projection maps the centre to (cx, cy) and nearer points scale larger", () => {
    const c = project([0, 0, 0], 100, 50, 40);
    expect(c.x).toBe(100);
    expect(c.y).toBe(50);
    const near = project([1, 0, 0.9], 0, 0, 40);
    const far = project([1, 0, -0.9], 0, 0, 40);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.depth).toBeGreaterThan(far.depth);
    expect(near.x).toBeGreaterThan(far.x);
  });

  it("edge alpha is monotonic in depth and bounded", () => {
    expect(edgeAlpha(0, 0)).toBeCloseTo(0.08, 6);
    expect(edgeAlpha(1, 1)).toBeCloseTo(0.7, 6);
    expect(edgeAlpha(0.5, 0.5)).toBeGreaterThan(edgeAlpha(0.2, 0.2));
  });
});
