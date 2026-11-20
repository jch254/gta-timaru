import type * as THREE from 'three';
import { CUT_MARGIN } from '../height';
import type { Interior } from './interior';
import type { Site } from './rural/kit';

/** Terrain cell size: the ground under a building's cut climbs back to the natural bank over one of these. */
const CELL = 4;

/**
 * Retaining walls round the ground the world cut level for a building (`footprint.level`; see
 * `TerrainModel.setCuts`). The ground can only climb back to the bank over a whole terrain cell, so a thin wall
 * would leave either a ramp of earth against it in the yard or a gully behind it: the wall is a block filling that
 * cell, its face where the flat ends, its top at the bank. Built in pieces about 2 m long along the line a → b
 * (site frame), each probing outward along `n` (unit, local) for where the cut stops. Pieces with no bank behind
 * them are left out.
 */
export function retainCut(s: Site, it: Interior, a: readonly [number, number], b: readonly [number, number], n: readonly [number, number], o: { wall: THREE.Material; cap?: THREE.Material; rail?: THREE.Material }): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.1) return;
  const count = Math.max(1, Math.round(len / 2));
  const yaw = Math.atan2(n[0], n[1]);
  const along = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const piece = len / count;
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) * piece;
    const mx = a[0] + along[0] * u;
    const mz = a[1] + along[1] * u;
    const at = (t: number, du = 0) => s.gy(mx + n[0] * t + along[0] * du, mz + n[1] * t + along[1] * du);
    const base = at(0);
    // The last flat point before the ground starts climbing (a cut vertex), within the cut's reach.
    let t0 = 0;
    for (let t = 0; t <= CUT_MARGIN + 0.5; t += 0.25) if (at(t) < base + 0.05) t0 = t;
    const far = t0 + CELL + 0.15;
    const top = Math.max(at(far, -piece / 2), at(far), at(far, piece / 2)) - base + 0.08;
    if (top < 0.35) continue;
    const depth = far - t0 + 0.1;
    const cx = mx + n[0] * (t0 - 0.05 + depth / 2);
    const cz = mz + n[1] * (t0 - 0.05 + depth / 2);
    const y0 = base - 0.6;
    const h = top + 0.6;
    it.b.at(cx, base + (h / 2 - 0.6), cz, yaw, () => {
      it.g(o.wall).box(0, 0, 0, piece + 0.02, h, depth);
      if (o.cap) it.g(o.cap).box(0, h / 2 + 0.04, -depth / 2 + 0.2, piece + 0.04, 0.08, 0.44);
      // Pipe rail along the top of the face.
      if (o.rail) {
        const r = it.g(o.rail);
        r.box(0, h / 2 + 1.0, -depth / 2 + 0.2, piece, 0.05, 0.05).box(0, h / 2 + 0.55, -depth / 2 + 0.2, piece, 0.04, 0.04);
        r.post(-piece / 2 + 0.05, h / 2, -depth / 2 + 0.2, 0.05, 1.02);
      }
    });
    it.collide(cx, y0 + h / 2, cz, piece + 0.02, h, depth, yaw);
    if (o.rail) it.collide(cx - n[0] * (depth / 2 - 0.2), base + top + 0.55, cz - n[1] * (depth / 2 - 0.2), piece, 1.1, 0.1, yaw);
  }
}
