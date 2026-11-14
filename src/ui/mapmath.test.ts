import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  arrowAngle,
  clampToCircle,
  clampToSquare,
  clampView,
  minimapMatrix,
  minimapReach,
  northUpAngle,
  scaleBar,
  simplifyPolyline,
  worldToMinimap,
  zoomAbout,
  type Point,
} from './mapmath';

const NORTH = Math.PI; // heading that faces -z
const SOUTH = 0;
const EAST = Math.PI / 2; // forward = (1, 0)
const WEST = -Math.PI / 2;

function at(wx: number, wz: number, heading: number, scale = 1, px = 0, pz = 0): Point {
  return worldToMinimap(wx, wz, px, pz, heading, scale, { x: 0, y: 0 });
}

describe('worldToMinimap', () => {
  it('is north-up when the camera faces north', () => {
    const north = at(0, -10, NORTH);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(-10); // up the screen
    const east = at(10, 0, NORTH);
    expect(east.x).toBeCloseTo(10); // to the right
    expect(east.y).toBeCloseTo(0);
  });

  it('puts whatever is ahead of the camera at the top', () => {
    const aheadSouth = at(0, 10, SOUTH);
    expect(aheadSouth.x).toBeCloseTo(0);
    expect(aheadSouth.y).toBeCloseTo(-10);
    const aheadEast = at(10, 0, EAST);
    expect(aheadEast.x).toBeCloseTo(0);
    expect(aheadEast.y).toBeCloseTo(-10);
    const aheadWest = at(-10, 0, WEST);
    expect(aheadWest.x).toBeCloseTo(0);
    expect(aheadWest.y).toBeCloseTo(-10);
  });

  it('keeps left and right the right way round (no mirroring)', () => {
    // Facing south, east is on your left.
    expect(at(10, 0, SOUTH).x).toBeCloseTo(-10);
    // Facing east, north is on your left and south on your right.
    expect(at(0, -10, EAST).x).toBeCloseTo(-10);
    expect(at(0, 10, EAST).x).toBeCloseTo(10);
    // Facing west, north is on your right.
    expect(at(0, -10, WEST).x).toBeCloseTo(10);
  });

  it('is relative to the player and scales', () => {
    const p = at(110, -220, NORTH, 0.5, 100, -200);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(-10);
  });

  it('preserves distance under any rotation', () => {
    for (const h of [0.3, 1.1, 2.7, -2.2, 5.9]) {
      const p = at(30, -40, h, 2);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100);
    }
  });
});

describe('minimapMatrix', () => {
  it('agrees with worldToMinimap for arbitrary headings', () => {
    const m: number[] = [];
    const out = { x: 0, y: 0 };
    for (const h of [0, 0.7, NORTH, -1.9, 4.4]) {
      minimapMatrix(120, -340, h, 0.8, 100, 90, m);
      for (const [wx, wz] of [
        [120, -340],
        [200, -300],
        [-50, 75],
      ]) {
        const expected = at(wx, wz, h, 0.8, 120, -340);
        applyMatrix(m, wx, wz, out);
        expect(out.x).toBeCloseTo(100 + expected.x);
        expect(out.y).toBeCloseTo(90 + expected.y);
      }
    }
  });

  it('is a pure rotation and scale (positive determinant)', () => {
    const m = minimapMatrix(0, 0, 1.234, 1.5, 0, 0, []);
    expect(m[0] * m[3] - m[1] * m[2]).toBeCloseTo(1.5 * 1.5);
  });

  it('is the identity when facing north at scale 1', () => {
    const m = minimapMatrix(0, 0, NORTH, 1, 0, 0, []);
    expect(m[0]).toBeCloseTo(1);
    expect(m[1]).toBeCloseTo(0);
    expect(m[2]).toBeCloseTo(0);
    expect(m[3]).toBeCloseTo(1);
  });
});

describe('rim clamping', () => {
  it('leaves points inside the square alone', () => {
    const p = { x: 30, y: -40 };
    expect(clampToSquare(p, 50)).toBe(false);
    expect(p).toEqual({ x: 30, y: -40 });
  });

  it('pulls far points back to the edge along the same bearing', () => {
    const p = { x: 200, y: -100 };
    expect(clampToSquare(p, 50)).toBe(true);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(-25);
    const q = { x: -30, y: 300 };
    clampToSquare(q, 60);
    expect(q.x).toBeCloseTo(-6);
    expect(q.y).toBeCloseTo(60);
  });

  it('clamps to a circle', () => {
    const p = { x: 300, y: 400 };
    expect(clampToCircle(p, 100)).toBe(true);
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(80);
    expect(clampToCircle({ x: 3, y: 4 }, 100)).toBe(false);
    expect(clampToCircle({ x: 0, y: 0 }, 100)).toBe(false);
  });
});

describe('arrows', () => {
  it('points the player arrow up when walking the way the camera looks', () => {
    expect(arrowAngle(1.2, 1.2)).toBeCloseTo(0);
  });

  it('turns the arrow anticlockwise when the player has turned left of the camera', () => {
    // Increasing heading turns left; a left turn is a negative (anticlockwise) screen rotation.
    expect(arrowAngle(1, 1 + Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it('gives compass angles on the north-up map', () => {
    expect(northUpAngle(NORTH)).toBeCloseTo(0);
    expect(northUpAngle(EAST)).toBeCloseTo(Math.PI / 2);
    expect(northUpAngle(SOUTH)).toBeCloseTo(Math.PI);
  });
});

describe('minimapReach', () => {
  it('is steady on foot and pulls out with speed', () => {
    expect(minimapReach(0)).toBe(150);
    expect(minimapReach(3)).toBe(150);
    expect(minimapReach(21)).toBeGreaterThan(150);
    expect(minimapReach(21)).toBeLessThan(330);
    expect(minimapReach(50)).toBe(330);
    expect(minimapReach(-50)).toBe(330);
  });
});

describe('simplifyPolyline', () => {
  it('collapses a straight run to its ends', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 50; i++) pts.push(i * 4, 10);
    expect(Array.from(simplifyPolyline(pts, 0.5))).toEqual([0, 10, 200, 10]);
  });

  it('keeps corners', () => {
    const out = simplifyPolyline([0, 0, 50, 0, 100, 0, 100, 50, 100, 100], 0.5);
    expect(Array.from(out)).toEqual([0, 0, 100, 0, 100, 100]);
  });

  it('keeps a curve within tolerance', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 0.5;
      pts.push(Math.cos(a) * 200, Math.sin(a) * 200);
    }
    const out = simplifyPolyline(pts, 1);
    expect(out.length).toBeLessThan(pts.length / 3);
    expect(out.length).toBeGreaterThan(4);
    // Every original point lies within tolerance of the simplified line.
    for (let i = 0; i < pts.length; i += 2) {
      let best = Infinity;
      for (let j = 0; j < out.length - 2; j += 2) {
        const ax = out[j];
        const az = out[j + 1];
        const dx = out[j + 2] - ax;
        const dz = out[j + 3] - az;
        const t = Math.min(1, Math.max(0, ((pts[i] - ax) * dx + (pts[i + 1] - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(pts[i] - ax - dx * t, pts[i + 1] - az - dz * t));
      }
      expect(best).toBeLessThanOrEqual(1.01);
    }
  });

  it('passes short lines through', () => {
    expect(Array.from(simplifyPolyline([1, 2, 3, 4], 1))).toEqual([1, 2, 3, 4]);
    expect(Array.from(simplifyPolyline([], 1))).toEqual([]);
  });
});

describe('map view', () => {
  it('zooms about the cursor', () => {
    const view = { x: 100, z: 200, scale: 1 };
    // Cursor 50 px right and 20 px below the centre: world point (150, 220).
    zoomAbout(view, 2, 50, 20, 0.1, 8);
    expect(view.scale).toBe(2);
    expect(view.x + 50 / view.scale).toBeCloseTo(150);
    expect(view.z + 20 / view.scale).toBeCloseTo(220);
  });

  it('respects zoom limits', () => {
    const view = { x: 0, z: 0, scale: 1 };
    zoomAbout(view, 100, 10, 10, 0.1, 4);
    expect(view.scale).toBe(4);
    zoomAbout(view, 0.0001, 10, 10, 0.1, 4);
    expect(view.scale).toBe(0.1);
  });

  it('keeps a zoomed-in view over the world, with a little overhang allowed', () => {
    // 1000 × 600 px at 1 px/m: half-extents 500 m × 300 m, 30% slack.
    const view = { x: 9000, z: -9000, scale: 1 };
    clampView(view, 500, 300, -3072, 3072, -6144, 6144, 0.3);
    expect(view.x).toBeCloseTo(3072 - 500 + 150);
    expect(view.z).toBeCloseTo(-6144 + 300 - 90);
    const inside = { x: 100, z: -200, scale: 1 };
    clampView(inside, 500, 300, -3072, 3072, -6144, 6144, 0.3);
    expect(inside).toEqual({ x: 100, z: -200, scale: 1 });
  });

  it('centres an axis once the whole world fits on it', () => {
    // 0.1 px/m: the view is 10 km wide, wider than the 6.1 km island, but not as tall as it.
    const view = { x: 2000, z: 5000, scale: 0.1 };
    clampView(view, 500, 300, -3072, 3072, -6144, 6144, 0.3);
    expect(view.x).toBe(0);
    expect(view.z).toBeCloseTo(6144 - 3000 + 900);
  });

  it('centres the island when zoomed right out (default slack)', () => {
    // The map's widest zoom shows the island at 90% of the viewport height.
    const scale = (0.9 * 1080) / 12288;
    const view = { x: 6, z: -4286, scale };
    clampView(view, 960, 540, -3072, 3072, -6144, 6144);
    expect(view.x).toBe(0);
    expect(view.z).toBe(0);
  });

  it('picks a round scale bar', () => {
    expect(scaleBar(0.1, 150)).toEqual({ metres: 1000, label: '1 km' });
    expect(scaleBar(1, 150)).toEqual({ metres: 100, label: '100 m' });
    expect(scaleBar(0.02, 150)).toEqual({ metres: 5000, label: '5 km' });
    expect(scaleBar(10, 150)).toEqual({ metres: 50, label: '50 m' });
  });
});
