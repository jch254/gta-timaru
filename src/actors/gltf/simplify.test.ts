import { describe, expect, it } from 'vitest';
import { SKIP, Simplifier } from './simplify';

/** A grid of quads, optionally rolled into a tube with a seam of duplicated vertices where it closes. */
function sheet(columns: number, rows: number, tube = false) {
  const positions: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      if (tube) {
        const a = (c / columns) * Math.PI * 2;
        positions.push(Math.cos(a) * 0.1, r * 0.02, Math.sin(a) * 0.1);
      } else positions.push(c * 0.02, Math.sin(c * 0.7) * 0.004 + Math.cos(r * 0.9) * 0.004, r * 0.02);
    }
  }
  const at = (c: number, r: number) => r * (columns + 1) + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) index.push(at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
  }
  return { positions, index };
}

function area(positions: number[], corners: ArrayLike<number>, alive: ArrayLike<number>): number {
  let total = 0;
  for (let t = 0; t < alive.length; t++) {
    if (!alive[t]) continue;
    const [a, b, c] = [corners[t * 3] * 3, corners[t * 3 + 1] * 3, corners[t * 3 + 2] * 3];
    const u = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const v = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    total += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return total;
}

describe('figure mesh simplification', () => {
  it('reaches each class budget and only ever uses the original vertices', () => {
    const { positions, index } = sheet(24, 24);
    const classes = new Uint16Array(index.length / 3).map((_, t) => (t < index.length / 6 ? 0 : 1));
    const s = new Simplifier({ positions, index, triClass: classes });
    const level = s.run([0.5, 0.1]);
    const counts = [0, 0];
    for (let t = 0; t < level.alive.length; t++) if (level.alive[t]) counts[classes[t]]++;
    expect(counts[0]).toBeLessThanOrEqual(Math.ceil(576 * 0.5) + 2);
    expect(counts[0]).toBeGreaterThanOrEqual(Math.floor(576 * 0.5) - 2);
    expect(counts[1]).toBeLessThanOrEqual(Math.ceil(576 * 0.1) + 2);
    expect(level.triangles).toBe(counts[0] + counts[1]);
    for (const vertex of level.corners) expect(vertex).toBeLessThan(positions.length / 3);
  });

  it('keeps an open edge where it is: the sheet still covers the same ground', () => {
    const { positions, index } = sheet(20, 20);
    const flat = positions.map((v, i) => (i % 3 === 1 ? 0 : v));
    const s = new Simplifier({ positions: flat, index, triClass: new Uint16Array(index.length / 3) });
    const level = s.run([0.08]);
    expect(level.triangles).toBeLessThan(800 * 0.12);
    expect(area(flat, level.corners, level.alive)).toBeCloseTo(0.4 * 0.4, 5);
  });

  it('is progressive: a later level is a coarser version of the same mesh', () => {
    const { positions, index } = sheet(16, 16);
    const s = new Simplifier({ positions, index, triClass: new Uint16Array(index.length / 3) });
    const one = s.run([0.5]);
    const two = s.run([0.2]);
    expect(two.triangles).toBeLessThan(one.triangles);
    for (let t = 0; t < two.alive.length; t++) if (two.alive[t]) expect(one.alive[t]).toBe(1);
  });

  it('keeps a seam closed: both copies of a seam point stay on triangles that meet there', () => {
    const { positions, index } = sheet(16, 12, true);
    const s = new Simplifier({ positions, index, triClass: new Uint16Array(index.length / 3) });
    const level = s.run([0.25]);
    expect(level.triangles).toBeLessThan(384 * 0.3);
    // Column 0 and column 16 are the same points with different vertices. Every seam point still in use
    // must be in use from both sides, or the tube would have opened.
    const used = new Set<number>();
    for (let t = 0; t < level.alive.length; t++) if (level.alive[t]) for (let k = 0; k < 3; k++) used.add(level.corners[t * 3 + k]);
    for (let r = 0; r <= 12; r++) expect(used.has(r * 17)).toBe(used.has(r * 17 + 16));
  });

  it('leaves skipped triangles out and treats stand-ins as one vertex', () => {
    const { positions, index } = sheet(8, 8);
    const classes = new Uint16Array(index.length / 3);
    classes[0] = SKIP;
    const s = new Simplifier({ positions, index, triClass: classes });
    expect(s.run([1]).alive[0]).toBe(0);
    // Triangle soup (every corner its own vertex) cannot be simplified at all, until each vertex is pointed
    // back at the first one that sits in the same place.
    const soup: number[] = [];
    const split = index.map((v, i) => {
      soup.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      return i;
    });
    const firstAt = new Map<number, number>();
    const wedgeOf = Uint32Array.from(index, (v, i) => {
      if (!firstAt.has(v)) firstAt.set(v, i);
      return firstAt.get(v)!;
    });
    const pinned = new Simplifier({ positions: soup, index: split, triClass: new Uint16Array(split.length / 3) }).run([0.2]);
    const free = new Simplifier({ positions: soup, index: split, triClass: new Uint16Array(split.length / 3), wedgeOf }).run([0.2]);
    expect(free.triangles).toBeLessThanOrEqual(Math.ceil(128 * 0.2) + 2);
    expect(pinned.triangles).toBeGreaterThan(free.triangles);
  });
});
