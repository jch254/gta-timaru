// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChunkBuilder, EdgeSample, RoadEdge, RoadGraph, RoadHit, WorldApi } from '../../core/types';
import { fakeMaterials } from '../landmarks/rural/fakes';
import { compileMap } from '../map';
import { buildMap } from '../mapdata';
import { getProp } from '../props';
import { advisoryFor, chevronScatterer, CURVE_SIGN_KINDS, curveSigns, findBends, HILL_LIMIT, openRoad, signedBends, type CurveSign } from './chevrons';
import { SCATTERERS } from './registry';

// ───────────── Synthetic roads ─────────────

/** An edge laid out from node a heading south (+z) through pieces of [length, curvature] (+ turns left). */
function road(pieces: [number, number][], options: Partial<RoadEdge> = {}, index = 0): RoadEdge {
  const step = 0.05;
  const total = pieces.reduce((sum, [len]) => sum + len, 0);
  const n = Math.round(total / 4);
  const samples: EdgeSample[] = [];
  let x = 0;
  let z = 0;
  let h = 0;
  let s = 0;
  let piece = 0;
  let into = 0;
  const record = () => samples.push({ x, y: 0, z, tx: Math.sin(h), tz: Math.cos(h), s });
  record();
  for (let k = 1; k <= n; k++) {
    const target = (total * k) / n;
    while (s < target - 1e-9) {
      const ds = Math.min(step, target - s);
      const kappa = pieces[Math.min(piece, pieces.length - 1)][1];
      h += kappa * ds;
      x += Math.sin(h) * ds;
      z += Math.cos(h) * ds;
      s += ds;
      into += ds;
      if (piece < pieces.length && into >= pieces[piece][0]) {
        into -= pieces[piece][0];
        piece++;
      }
    }
    record();
  }
  return {
    index,
    name: 'Test Road',
    cls: 'highway',
    a: index * 2,
    b: index * 2 + 1,
    samples,
    length: total,
    width: 9.5,
    lanes: 1,
    speedLimit: 100 / 3.6,
    oneway: false,
    bridge: false,
    tunnel: false,
    footpaths: false,
    drivable: true,
    ...options,
  };
}

/** A world of just these roads, flat and dry, with no landmarks. */
function tinyWorld(edges: RoadEdge[]): WorldApi {
  const nodes = edges.flatMap((e) => [
    { index: e.a, x: e.samples[0].x, y: 0, z: e.samples[0].z, edges: [e.index] },
    { index: e.b, x: e.samples[e.samples.length - 1].x, y: 0, z: e.samples[e.samples.length - 1].z, edges: [e.index] },
  ]);
  const graph = {
    nodes,
    edges,
    pointAt(e: RoadEdge, s: number): EdgeSample {
      const n = e.samples.length - 1;
      const f = Math.min(n, Math.max(0, (s / e.length) * n));
      const i = Math.min(n - 1, Math.floor(f));
      const t = f - i;
      const a = e.samples[i];
      const b = e.samples[i + 1];
      const l = (p: number, q: number) => p + (q - p) * t;
      return { x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), tx: l(a.tx, b.tx), tz: l(a.tz, b.tz), s };
    },
    nearest(x: number, z: number, max = 60, filter?: (e: RoadEdge) => boolean): RoadHit | null {
      let best: RoadHit | null = null;
      for (const e of edges) {
        if (filter && !filter(e)) continue;
        for (let i = 0; i + 1 < e.samples.length; i++) {
          const a = e.samples[i];
          const b = e.samples[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const len = Math.hypot(dx, dz) || 1;
          const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
          const px = a.x + dx * t;
          const pz = a.z + dz * t;
          const distance = Math.hypot(x - px, z - pz);
          if (distance > max || (best && best.distance <= distance)) continue;
          best = { edge: e, s: a.s + (b.s - a.s) * t, distance, offset: ((x - px) * dz - (z - pz) * dx) / len, x: px, y: 0, z: pz };
        }
      }
      return best;
    },
  } as unknown as RoadGraph;
  return { graph, landmarks: [], places: [], waterDepthAt: () => 0, heightAt: () => 0, districtAt: () => ({ type: 'rural' }) } as unknown as WorldApi;
}

const R60 = 1 / 60;
const QUARTER = (Math.PI / 2) * 60;

describe('findBends', () => {
  it('finds nothing on a straight', () => {
    expect(findBends(road([[600, 0]]))).toEqual([]);
  });

  it('finds a 90° bend of 60 m radius on a 100 km/h road, on the right hand, with a sensible advisory', () => {
    const bends = findBends(road([[150, 0], [QUARTER, R60], [150, 0]]));
    expect(bends).toHaveLength(1);
    const [b] = bends;
    expect(b.direction).toBe('left');
    expect(b.advisory).toBeGreaterThanOrEqual(45);
    expect(b.advisory).toBeLessThanOrEqual(55);
    expect(b.radius).toBeGreaterThan(50);
    expect(b.radius).toBeLessThan(70);
    expect(Math.abs(b.turn - Math.PI / 2)).toBeLessThan(0.1);
    expect(Math.abs(b.start - 150)).toBeLessThan(10);
    expect(Math.abs(b.end - (150 + QUARTER))).toBeLessThan(10);
    expect(findBends(road([[150, 0], [QUARTER, -R60], [150, 0]]))[0].direction).toBe('right');
  });

  it('leaves a gentle 800 m curve alone', () => {
    expect(findBends(road([[150, 0], [700, 1 / 800], [150, 0]]))).toEqual([]);
  });

  it('leaves town streets alone', () => {
    const bend: [number, number][] = [[100, 0], [(Math.PI / 2) * 30, 1 / 30], [100, 0]];
    expect(findBends(road(bend, { cls: 'street', footpaths: true, speedLimit: 50 / 3.6, width: 9.5 }))).toEqual([]);
    expect(findBends(road(bend, { footpaths: true }))).toEqual([]);
    expect(findBends(road(bend, { bridge: true }))).toEqual([]);
    expect(findBends(road(bend))).toHaveLength(1);
  });

  it('rounds advisories down to a number ending in 5', () => {
    for (const r of [12, 20, 35, 60, 90, 150, 250]) expect(advisoryFor(r) % 10).toBe(5);
    expect(advisoryFor(15)).toBeLessThanOrEqual(25);
    expect(advisoryFor(200)).toBeGreaterThanOrEqual(65);
  });

  it('finds an S-bend as two bends of opposite hands', () => {
    const bends = findBends(road([[150, 0], [QUARTER / 2, R60], [30, 0], [QUARTER / 2, -R60], [150, 0]]));
    expect(bends.map((b) => b.direction)).toEqual(['left', 'right']);
  });
});

describe('curve signs on a single bend', () => {
  const edge = road([[200, 0], [QUARTER, R60], [200, 0]]);
  const world = tinyWorld([edge]);
  const signs = curveSigns(world, edge);
  const [bend] = findBends(edge);
  const offset = (q: CurveSign) => world.graph.nearest(q.x, q.z, 30)!.offset;

  it('signs both directions: a warning on the left verge ahead of the bend, chevrons round the outside', () => {
    for (const dir of [1, -1] as const) {
      const mine = signs.filter((q) => q.dir === dir);
      const warnings = mine.filter((q) => q.role === 'warning');
      const chevrons = mine.filter((q) => q.role !== 'warning');
      expect(warnings).toHaveLength(1);
      expect(chevrons.length).toBeGreaterThanOrEqual(3);
      // Travelling a → b the bend turns left; the other way it turns right.
      const hand = dir === 1 ? 'left' : 'right';
      expect(warnings[0].kind).toBe(`curve-warning-${hand}-${bend.advisory}`);
      for (const c of chevrons) expect(c.kind).toBe(`chevron-pw67-${hand}`);
      // The warning is 60 to 120 m short of the curve, on the left of travel.
      const before = dir === 1 ? bend.start - warnings[0].s : warnings[0].s - bend.end;
      expect(before).toBeGreaterThanOrEqual(60);
      expect(before).toBeLessThanOrEqual(120);
      expect(Math.sign(offset(warnings[0]))).toBe(dir);
      // The outside of a left-hand bend (a → b) is its right side, whichever way you travel.
      for (const c of chevrons) expect(offset(c)).toBeLessThan(-edge.width / 2);
      // Constant offset, equal spacing (give or take a post moved off the other direction's plate), the last at the tangent point.
      for (const c of chevrons) expect(Math.abs(Math.abs(offset(c)) - (edge.width / 2 + 1.5))).toBeLessThan(0.3);
      const gaps = chevrons.slice(1).map((c, i) => Math.abs(c.s - chevrons[i].s));
      for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThan(6.1);
      expect(Math.abs(chevrons[chevrons.length - 1].s - (dir === 1 ? bend.end : bend.start))).toBeLessThan(3.1);
      // Facing the oncoming drivers, a little off square.
      for (const q of mine) {
        const p = world.graph.pointAt(edge, q.s);
        const facing = Math.sin(q.heading) * p.tx * dir + Math.cos(q.heading) * p.tz * dir;
        expect(facing).toBeLessThan(-0.5);
      }
    }
  });

  it('signs only the one direction of a one-way road', () => {
    const oneway = road([[200, 0], [QUARTER, R60], [200, 0]], { oneway: true });
    const plan = curveSigns(tinyWorld([oneway]), oneway);
    expect(plan.length).toBeGreaterThan(3);
    expect(plan.every((q) => q.dir === 1)).toBe(true);
  });

  it('puts a PW-66 board first on a hairpin', () => {
    const hairpin = road([[200, 0], [Math.PI * 18, 1 / 18], [200, 0]]);
    const [b] = findBends(hairpin);
    expect(b.advisory).toBeLessThanOrEqual(35);
    const plan = curveSigns(tinyWorld([hairpin]), hairpin);
    for (const dir of [1, -1]) {
      const chevrons = plan.filter((q) => q.dir === dir && q.role !== 'warning');
      expect(chevrons[0].role).toBe('pw66');
      expect(chevrons.slice(1).every((q) => q.role === 'pw67')).toBe(true);
    }
  });

  it('registers every kind it places, as a single cheap part', () => {
    const materials = fakeMaterials();
    for (const kind of CURVE_SIGN_KINDS) {
      const def = getProp(kind, materials);
      expect(def, kind).not.toBeNull();
      expect(def!.parts).toHaveLength(1);
      expect(def!.castShadow).toBe(false);
    }
    for (const q of signs) expect(CURVE_SIGN_KINDS).toContain(q.kind);
  });
});

// ───────────── The real map ─────────────

const CHUNK = 256;

function realWorld(): WorldApi {
  const map = compileMap(buildMap());
  return {
    bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
    graph: map.graph,
    places: map.places,
    landmarks: map.landmarks,
    heightAt: (x: number, z: number) => map.terrain.height(x, z),
    districtAt: (x: number, z: number) => map.districtAt(x, z),
    waterDepthAt: (x: number, z: number) => map.terrain.waterDepth(x, z),
  } as unknown as WorldApi;
}

interface Placed {
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  chunk: string;
}

function dress(world: WorldApi): Placed[] {
  const placed: Placed[] = [];
  const { minX, maxX, minZ, maxZ } = world.bounds;
  for (let cz = Math.floor(minZ / CHUNK); cz * CHUNK < maxZ; cz++) {
    for (let cx = Math.floor(minX / CHUNK); cx * CHUNK < maxX; cx++) {
      const chunk = `${cx},${cz}`;
      const out = {
        world,
        materials: fakeMaterials(),
        lod: 0,
        instance: (kind: string, x: number, y: number, z: number, heading = 0) => placed.push({ kind, x, y, z, heading, chunk }),
      } as unknown as ChunkBuilder;
      chevronScatterer({ minX: cx * CHUNK, minZ: cz * CHUNK, size: CHUNK, seed: 0 }, out);
    }
  }
  return placed;
}

describe('curve signs on the real map', () => {
  it('is registered', () => {
    expect(SCATTERERS).toContain(chevronScatterer);
  });

  it('signs the bends of the open road, each sign once, cheaply and deterministically', () => {
    const world = realWorld();
    const edges = world.graph.edges;
    let bends = 0;
    const byRoad = new Map<string, number>();
    let planned = 0;
    for (const e of edges) {
      if (!openRoad(e, HILL_LIMIT)) continue;
      planned += curveSigns(world, e).length;
      const found = signedBends(world, e);
      bends += found.length;
      if (found.length) byRoad.set(e.name, (byRoad.get(e.name) ?? 0) + found.length);
    }
    const placed = dress(world);
    const roles = { warning: 0, pw67: 0, pw66: 0 };
    const perChunk = new Map<string, Placed[]>();
    for (const q of placed) {
      if (q.kind.startsWith('curve-warning')) roles.warning++;
      else if (q.kind.startsWith('chevron-pw66')) roles.pw66++;
      else roles.pw67++;
      perChunk.set(q.chunk, [...(perChunk.get(q.chunk) ?? []), q]);
    }
    let worst = 0;
    let worstKinds = 0;
    let worstAt = '';
    for (const [key, list] of perChunk) {
      if (list.length > worst) [worst, worstAt] = [list.length, key];
      worstKinds = Math.max(worstKinds, new Set(list.map((q) => q.kind)).size);
    }
    console.log(
      `curve signs: ${bends} bends on ${byRoad.size} roads; ${roles.warning} warnings, ${roles.pw67} PW-67 chevrons, ${roles.pw66} PW-66 boards ` +
        `in ${perChunk.size} chunks; worst chunk ${worstAt} has ${worst} signs, at most ${worstKinds} kinds (draw calls) in a chunk`,
    );
    console.log([...byRoad].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(', '));

    expect(bends).toBeGreaterThan(5);
    expect(roles.warning).toBeGreaterThan(5);
    // Three or more plates per direction, but for the odd one kept clear of a mission marker.
    expect(roles.pw67 + roles.pw66).toBeGreaterThanOrEqual(roles.warning * 2.75);
    expect(worst).toBeLessThan(60);
    // Every planned sign is put down by exactly one chunk.
    expect(placed.length).toBe(planned);
    for (const q of placed) {
      expect(Number.isFinite(q.x + q.y + q.z + q.heading)).toBe(true);
      const hit = world.graph.nearest(q.x, q.z, 30);
      expect(!hit || hit.distance >= hit.edge.width / 2 + 0.8, `${q.kind} on ${hit?.edge.name}`).toBe(true);
      expect(CURVE_SIGN_KINDS).toContain(q.kind);
    }

    // A second world from the same map places the very same signs.
    const again = dress(realWorld());
    expect(again).toEqual(placed);
  }, 120_000);
});
