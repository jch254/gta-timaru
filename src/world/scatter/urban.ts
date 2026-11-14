import { Rng, hashInts } from '../../core/rng';
import type { Scatterer } from '../../core/types';
// Registers the chch-* instanced props (punt, skiff, bench, flower bed, rugby posts…).
import '../landmarks/christchurch/props';
import { SCATTERERS } from './registry';

/**
 * City life for Christchurch: punts and rowing skiffs on the Avon with weeping willows on its banks, benches and
 * flower beds in the parks, and rugby and cricket fields in Hagley Park.
 *
 * Deterministic from `area.seed` (every random draw comes from one generator seeded with it, and the draws per
 * grid cell are fixed), cheap (a 3 × 3 district probe rejects squares outside the city; inside it the river is
 * sampled on an 11 × 11 grid and the parks on a 6 × 6 one), and nothing is placed within 9 m of a road centreline
 * or inside any landmark's clear radius.
 */
export const urbanScatter: Scatterer = (area, out) => {
  const world = out.world;
  const m = out.materials;
  const { minX, minZ, size } = area;
  const inCity = (x: number, z: number) => world.districtAt(x, z).city === 'christchurch';

  let any = false;
  for (let j = 0; j < 3 && !any; j++) for (let i = 0; i < 3 && !any; i++) any = inCity(minX + ((i + 0.5) * size) / 3, minZ + ((j + 0.5) * size) / 3);
  if (!any) return;

  const rng = new Rng(hashInts(area.seed, 1995));
  const midX = minX + size / 2;
  const midZ = minZ + size / 2;
  const marks = world.landmarks.filter((l) => Math.hypot(l.x - midX, l.z - midZ) < size * 0.75 + l.clearRadius);
  /** Outside every landmark's clear radius and at least 9 m from any road centreline (further for wide roads). */
  const open = (x: number, z: number, margin = 0): boolean => {
    for (const l of marks) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + margin) return false;
    const hit = world.graph.nearest(x, z, 24);
    return !hit || hit.distance >= Math.max(9, hit.edge.width / 2 + 4) + margin;
  };

  // ── Hagley Park: a rugby or cricket field in some 128 m quarters, wherever a whole field fits ──
  const fields: { x: number; z: number; sin: number; cos: number }[] = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const heading = rng.next() < 0.5 ? 0 : Math.PI / 2;
      const along = rng.range(-8, 8);
      const across = rng.range(-24, 24);
      const rugby = rng.next() < 0.6;
      const wanted = rng.next() < 0.45;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const fx = minX + ((i + 0.5) * size) / 2 + along * sin + across * cos;
      const fz = minZ + ((j + 0.5) * size) / 2 + along * cos - across * sin;
      /** World position `a` metres along the field and `c` metres across it. */
      const at = (a: number, c: number): [number, number] => [fx + a * sin + c * cos, fz + a * cos - c * sin];
      let ok = wanted;
      // The whole field must lie on dry ground inside Hagley Park…
      for (const a of [0, -52, 52]) {
        for (const c of [0, -33, 33]) {
          if (!ok) continue;
          const [x, z] = at(a, c);
          const d = world.districtAt(x, z);
          ok = d.type === 'park' && d.city === 'christchurch' && /hagley/i.test(`${d.name} ${d.id}`) && world.waterDepthAt(x, z) <= 0;
        }
      }
      // …with no road centreline on it or within 9 m of it: one wide probe at the centre, narrower ones towards the ends…
      for (const [a, c, r] of [[0, 0, 60], [-45, -28, 30], [-45, 0, 30], [-45, 28, 30], [45, -28, 30], [45, 0, 30], [45, 28, 30]]) {
        if (!ok) break;
        const [x, z] = at(a, c);
        ok = !world.graph.nearest(x, z, r);
      }
      // …and clear of every landmark's radius, measured to the field's outline.
      for (const l of marks) {
        if (!ok) break;
        const a = (l.x - fx) * sin + (l.z - fz) * cos;
        const c = (l.x - fx) * cos - (l.z - fz) * sin;
        ok = Math.hypot(Math.max(0, Math.abs(a) - 54), Math.max(0, Math.abs(c) - 35)) >= l.clearRadius;
      }
      if (!ok) continue;
      fields.push({ x: fx, z: fz, sin, cos });

      const y = world.heightAt(fx, fz);
      const f = out.frameAt(fx, y, fz, heading);
      const white = m.get('plain', { color: 0xe4e1d6 });
      if (rugby) {
        for (const c of [-32, 32]) out.box(f, c, 0.04, 0, 0.12, 0.02, 94.12, white);
        for (const a of [-47, -25, 0, 25, 47]) out.box(f, 0, 0.04, a, 64, 0.02, 0.12, white);
        for (const a of [-47, 47]) {
          const [px, pz] = at(a, 0);
          out.instance('chch-rugby-posts', px, world.heightAt(px, pz), pz, heading);
        }
      } else {
        // Mown square, the pitch, stumps and a sight screen at each end.
        out.box(f, 0, 0.03, 0, 22, 0.02, 26, m.get('grass', { color: 0x7fb04c }));
        out.box(f, 0, 0.05, 0, 3.05, 0.02, 20.12, m.get('grass', { color: 0xc4ba8a }));
        const screen = m.get('paintedMetal', { color: 0xf1f0ea });
        for (const end of [-1, 1]) {
          out.box(f, 0, 0.4, end * 10.06, 0.23, 0.71, 0.04, white);
          out.box(f, 0, 2.3, end * 46, 5, 3.2, 0.14, screen);
          out.box(f, -2.2, 0.35, end * 46, 0.1, 0.7, 1.4, screen);
          out.box(f, 2.2, 0.35, end * 46, 0.1, 0.7, 1.4, screen);
          out.collider(f, 0, 1.95, end * 46, 5, 3.9, 0.5);
        }
      }
    }
  }

  // ── The Avon: boats in mid-stream, willows on the nearest dry bank ──
  const N = 11;
  const cell = size / N;
  let boats = 0;
  let willows = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = minX + (i + rng.next()) * cell;
      const z = minZ + (j + rng.next()) * cell;
      const roll = rng.next();
      const turn = rng.next() * Math.PI * 2;
      const depth = world.waterDepthAt(x, z);
      if (depth <= 0.3) continue;
      // A river's surface stands above sea level; this skips the sea, the estuary and the harbour.
      const surface = world.heightAt(x, z) + depth;
      if (surface < world.seaLevel + 0.4 || !inCity(x, z)) continue;

      if (roll < 0.2 && boats < 3 && depth > 0.45) {
        // Lie along the stream: the direction with the most water both ahead and astern.
        let best = 0.3;
        let heading = -1;
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 4;
          const fore = world.waterDepthAt(x + Math.sin(a) * 7, z + Math.cos(a) * 7);
          const aft = world.waterDepthAt(x - Math.sin(a) * 7, z - Math.cos(a) * 7);
          if (Math.min(fore, aft) > best) {
            best = Math.min(fore, aft);
            heading = a;
          }
        }
        if (heading >= 0 && open(x, z)) {
          out.instance(roll < 0.12 ? 'chch-punt' : 'chch-skiff', x, surface, z, heading + (turn > Math.PI ? Math.PI : 0));
          boats++;
        }
      } else if (roll < 0.86 && willows < 12) {
        // Step outwards in four directions until one reaches the bank, then stand the tree just back from the edge.
        search: for (const r of [3, 6, 9, 12]) {
          for (let k = 0; k < 4; k++) {
            const a = turn + (k * Math.PI) / 2;
            if (world.waterDepthAt(x + Math.sin(a) * r, z + Math.cos(a) * r) > 0) continue;
            const wx = x + Math.sin(a) * (r + 2.4);
            const wz = z + Math.cos(a) * (r + 2.4);
            if (world.waterDepthAt(wx, wz) <= 0 && inCity(wx, wz) && open(wx, wz, 1)) {
              out.instance('tree-willow', wx, world.heightAt(wx, wz), wz, turn, 0.85 + roll * 0.4);
              willows++;
            }
            break search;
          }
        }
      }
    }
  }

  // ── Parks: benches facing the nearest path or street, and bedding displays ──
  const P = 6;
  const plot = size / P;
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      const x = minX + (i + rng.next()) * plot;
      const z = minZ + (j + rng.next()) * plot;
      const roll = rng.next();
      const turn = rng.next() * Math.PI * 2;
      if (roll > 0.33) continue;
      // Not on a playing field.
      if (fields.some((f) => Math.abs((x - f.x) * f.sin + (z - f.z) * f.cos) < 58 && Math.abs((x - f.x) * f.cos - (z - f.z) * f.sin) < 38)) continue;
      const d = world.districtAt(x, z);
      if (d.type !== 'park' || d.city !== 'christchurch' || world.waterDepthAt(x, z) > 0 || !open(x, z, 1)) continue;
      const y = world.heightAt(x, z);
      if (roll < 0.17) {
        const road = world.graph.nearest(x, z, 30);
        out.instance('chch-bench', x, y, z, road ? Math.atan2(road.x - x, road.z - z) : turn);
      } else if (roll < 0.26) {
        out.instance('chch-flowerbed', x, y, z, turn);
      } else {
        out.instance('picnic-table', x, y, z, turn);
      }
    }
  }

};

SCATTERERS.push(urbanScatter);
