import { describe, expect, it } from 'vitest';
import type { LandmarkPlacement } from '../../core/types';
import { fakeMaterials, fakeWorld, type FakeWorldOptions, RecordingBuilder, signature } from '../landmarks/rural/fakes';
import { PROP } from '../landmarks/rural/props';
import { getProp } from '../props';
import { SCATTERERS } from './registry';
import { ruralScatterer } from './rural';

const SIZE = 256;
// SH1 running north–south with a gravel side road joining it, as on the plains.
const ROADS: FakeWorldOptions['roads'] = [
  [-40, -800, 60, 800, 'highway'],
  [-420, 70, 20, 40, 'gravel'],
];

function scatter(cx: number, cz: number, options: FakeWorldOptions = {}) {
  const world = fakeWorld({ roads: ROADS, ...options });
  const out = new RecordingBuilder(fakeMaterials(), world);
  const before = world.queries;
  ruralScatterer({ minX: cx * SIZE, minZ: cz * SIZE, size: SIZE, seed: (cx + 512) * 1024 + cz + 512 }, out);
  return { out, world, queries: world.queries - before };
}

/** Distance from a point to the nearest test road centreline. */
function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of ROADS!) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const t = Math.min(1, Math.max(0, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - x0 - dx * t, z - z0 - dz * t));
  }
  return best;
}

const AREAS: [number, number][] = [];
for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) AREAS.push([cx, cz]);

describe('rural scatterer', () => {
  it('is registered', () => {
    expect(SCATTERERS).toContain(ruralScatterer);
  });

  it('dresses the plains within the query budget and without colliders', () => {
    const totals = new Map<string, number>();
    const materials = fakeMaterials();
    for (const [cx, cz] of AREAS) {
      const { out, queries } = scatter(cx, cz);
      expect(out.problems).toEqual([]);
      // Round 2: raised from 600 so road fences can ask about their own spot where the lattice is mixed.
      expect(queries, `area ${cx},${cz}`).toBeLessThanOrEqual(1200);
      expect(out.count('collider', 'light', 'box', 'gable', 'cylinder', 'quad')).toBe(0);
      expect(out.count('geometry')).toBeLessThanOrEqual(3);
      expect(out.triangles).toBeLessThan(6000);
      for (const r of out.records) {
        if (r.op !== 'instance') continue;
        totals.set(r.kind!, (totals.get(r.kind!) ?? 0) + 1);
        expect(getProp(r.kind!, materials), r.kind).not.toBeNull();
        // Everything belongs to the area that asked for it and stands on the ground. A gate sits mid-span, so
        // it and its letterbox may hang just over the edge; a shelter belt stands a few metres off its fence.
        const slack = r.kind === PROP.gate || r.kind === PROP.letterbox ? 12 : r.kind!.startsWith('tree-') || r.kind === 'tussock' ? 5 : 0;
        expect(r.x).toBeGreaterThanOrEqual(cx * SIZE - slack);
        expect(r.x).toBeLessThan((cx + 1) * SIZE + slack);
        expect(r.z).toBeGreaterThanOrEqual(cz * SIZE - slack);
        expect(r.z).toBeLessThan((cz + 1) * SIZE + slack);
        // Round 2: rank grass and the highway's edge marker posts are sunk a few centimetres, and the marker
        // posts stand on the shoulder (1.25 m outside the seal) rather than back at the fence line; the grass grows
        // on the verge between the two.
        const soft = r.kind === 'tussock' || r.kind === 'marker-post';
        if (soft) expect(Math.abs(r.y - 10)).toBeLessThan(0.08);
        else expect(r.y).toBeCloseTo(10, 5);
        expect(roadDistance(r.x, r.z), `${r.kind} near a road`).toBeGreaterThanOrEqual(r.kind === 'marker-post' ? 5 : r.kind === 'tussock' ? 6 : 8);
      }
    }
    // Sixteen areas of plains with SH1 through them: all the furniture turns up.
    for (const kind of [PROP.post, PROP.sheep, PROP.bale, PROP.gate, PROP.letterbox, PROP.pole, PROP.trough, 'tree-pine']) expect(totals.get(kind) ?? 0, kind).toBeGreaterThan(0);
    expect((totals.get(PROP.cow) ?? 0) + (totals.get(PROP.friesian) ?? 0)).toBeGreaterThan(0);
    expect(totals.get(PROP.sheep)!).toBeGreaterThan(totals.get(PROP.cow) ?? 0);
  });

  it('is deterministic, and neighbouring areas never double up along their shared edge', () => {
    const a = scatter(0, 0);
    expect(signature(scatter(0, 0).out)).toBe(signature(a.out));
    const seen = new Set<string>();
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      for (const r of scatter(cx, cz).out.records) {
        if (r.op !== 'instance' || r.kind === PROP.post) continue;
        const key = `${r.kind}:${r.x.toFixed(2)},${r.z.toFixed(2)}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('puts paddock fences on the patchwork grid the terrain is tinted with', () => {
    const { out } = scatter(-2, 1);
    const posts = out.records.filter((r) => r.kind === PROP.post && roadDistance(r.x, r.z) > 14);
    expect(posts.length).toBeGreaterThan(20);
    for (const p of posts) {
      const fx = (((p.x + 5000) % 190) + 190) % 190;
      const fz = (((p.z + 9000) % 150) + 150) % 150;
      expect(Math.min(fx, 190 - fx, fz, 150 - fz)).toBeLessThan(0.01);
    }
  });

  it('does nothing outside rural districts', () => {
    const { out, queries } = scatter(0, 0, { district: () => 'villa' });
    expect(out.records).toEqual([]);
    expect(queries).toBeLessThanOrEqual(9);
  });

  it('stays out of water, off shingle and sand, and outside landmark clear radii', () => {
    const landmark: LandmarkPlacement = { kind: 'woolshed', name: 'Test Woolshed', x: -150, z: 100, heading: 0, clearRadius: 30 };
    const options: FakeWorldOptions = {
      // A river running north–south through the area, shingle either side of the water, and a beach strip.
      water: (x) => (Math.abs(x - 150) < 14 ? 1.5 : 0),
      surface: (x, z) => (Math.abs(x - 150) < 14 ? 'water' : Math.abs(x - 150) < 40 ? 'shingle' : z > 200 ? 'sand' : 'grass'),
      landmarks: [landmark],
    };
    let placed = 0;
    for (const [cx, cz] of [[0, 0], [-1, 0]] as const) {
      const { out, queries } = scatter(cx, cz, options);
      expect(queries).toBeLessThanOrEqual(600);
      for (const r of out.records) {
        if (r.op === 'instance') {
          placed++;
          expect(Math.abs(r.x - 150), `${r.kind} on the riverbed`).toBeGreaterThanOrEqual(40);
          expect(r.z, `${r.kind} on the beach`).toBeLessThanOrEqual(200);
          expect(Math.hypot(r.x - landmark.x, r.z - landmark.z), `${r.kind} inside the landmark`).toBeGreaterThanOrEqual(landmark.clearRadius);
        } else if (r.vertices) {
          for (let i = 0; i < r.vertices.length; i += 3) {
            expect(Math.abs(r.vertices[i] - 150)).toBeGreaterThanOrEqual(40);
            expect(Math.hypot(r.vertices[i] - landmark.x, r.vertices[i + 2] - landmark.z)).toBeGreaterThanOrEqual(landmark.clearRadius);
          }
        }
      }
    }
    expect(placed).toBeGreaterThan(20);
  });

  it('follows rolling ground with exact heights where interpolation would float or bury things', () => {
    const ground = (x: number, z: number) => 20 + Math.sin(x / 55) * 4 + Math.cos(z / 70) * 3;
    const { out, queries } = scatter(-2, -1, { ground });
    expect(queries).toBeLessThanOrEqual(600);
    const instances = out.records.filter((r) => r.op === 'instance');
    expect(instances.length).toBeGreaterThan(10);
    for (const r of instances) expect(Math.abs(r.y - ground(r.x, r.z)), r.kind).toBeLessThan(0.12);
  });
});
