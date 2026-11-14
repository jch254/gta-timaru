import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChunkBuilder, District, LandmarkPlacement, MaterialLibrary, RoadGraph, WorldApi } from '../../../core/types';
import { hashInts } from '../../../core/rng';
import { urbanScatter } from '../../scatter/urban';

/**
 * A toy Christchurch: the Avon meandering east–west through z ≈ 0, Hagley Park west of x = −300, a small park
 * round (600, −400), one north–south street at x = 100 and one landmark on the river bank.
 */
const river = (x: number) => 30 * Math.sin(x / 90);
const depthAt = (x: number, z: number) => (Math.abs(z - river(x)) < 9 ? 1.3 : 0);
const ROAD_X = 100;
const MARK: LandmarkPlacement = { kind: 'antigua-boatsheds', name: 'Boat sheds', x: -100, z: -12, heading: 0, clearRadius: 30 };

const HAGLEY: District = { id: 'hagley', name: 'Hagley Park', city: 'christchurch', type: 'park' };
const LATIMER: District = { id: 'latimer', name: 'Latimer Square', city: 'christchurch', type: 'park' };
const CITY: District = { id: 'central', name: 'Central City', city: 'christchurch', type: 'cbd' };
const PLAINS: District = { id: 'plains', name: 'Canterbury Plains', city: null, type: 'rural' };
const TIMARU: District = { id: 'timaru', name: 'Timaru', city: 'timaru', type: 'park' };

function districtAt(x: number, z: number): District {
  if (z > 3000) return TIMARU;
  if (Math.abs(x) > 1500 || Math.abs(z) > 1500) return PLAINS;
  if (x < -300) return HAGLEY;
  if (Math.hypot(x - 600, z + 400) < 120) return LATIMER;
  return CITY;
}

interface Item {
  what: string;
  x: number;
  y: number;
  z: number;
}

function run(minX: number, minZ: number, seed = hashInts(minX, minZ)) {
  const queries = { water: 0, district: 0, road: 0, height: 0 };
  const graph = {
    nodes: [],
    edges: [],
    nearest: (x: number, z: number, max = 60) => {
      queries.road++;
      const distance = Math.abs(x - ROAD_X);
      return distance <= max ? { edge: { width: 10, cls: 'street' }, s: 0, distance, offset: 0, x: ROAD_X, y: 8, z } : null;
    },
  } as unknown as RoadGraph;
  const world = {
    seaLevel: 0,
    graph,
    landmarks: [MARK],
    railways: [],
    places: [],
    heightAt: (x: number, z: number) => (queries.height++, 8 - depthAt(x, z)),
    groundAt: (x: number, z: number) => (queries.height++, 8 - depthAt(x, z)),
    waterDepthAt: (x: number, z: number) => (queries.water++, depthAt(x, z)),
    districtAt: (x: number, z: number) => (queries.district++, districtAt(x, z)),
  } as unknown as WorldApi;
  const material = (key: string) => ({ key }) as unknown as THREE.MeshStandardMaterial;
  const materials: MaterialLibrary = {
    get: (surface, options) => material(`${surface}${JSON.stringify(options ?? {})}`),
    windows: () => material('windows'),
    emitter: () => material('emitter'),
    sign: () => material('sign'),
    register: (m) => m,
    release: () => undefined,
  };
  const items: Item[] = [];
  const v = new THREE.Vector3();
  const record = (what: string, frame: THREE.Matrix4, cx: number, cy: number, cz: number) => {
    v.set(cx, cy, cz).applyMatrix4(frame);
    items.push({ what, x: v.x, y: v.y, z: v.z });
  };
  const out = {
    materials,
    world,
    lod: 0,
    frameAt: (x: number, y: number, z: number, heading: number) => new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z),
    box: (f: THREE.Matrix4, cx: number, cy: number, cz: number) => record('box', f, cx, cy, cz),
    gable: (f: THREE.Matrix4, cx: number, cy: number, cz: number) => record('gable', f, cx, cy, cz),
    cylinder: (f: THREE.Matrix4, cx: number, cy: number, cz: number) => record('cylinder', f, cx, cy, cz),
    quad: (f: THREE.Matrix4, cx: number, cy: number, cz: number) => record('quad', f, cx, cy, cz),
    collider: (f: THREE.Matrix4, cx: number, cy: number, cz: number) => record('collider', f, cx, cy, cz),
    addGeometry: () => items.push({ what: 'geometry', x: NaN, y: NaN, z: NaN }),
    instance: (kind: string, x: number, y: number, z: number) => items.push({ what: kind, x, y, z }),
    light: (x: number, y: number, z: number) => items.push({ what: 'light', x, y, z }),
  } as unknown as ChunkBuilder;
  urbanScatter({ minX, minZ, size: 256, seed }, out);
  const total = queries.water + queries.district + queries.road + queries.height;
  return { items, queries, total, digest: items.map((i) => `${i.what}:${i.x.toFixed(3)},${i.y.toFixed(3)},${i.z.toFixed(3)}`).join('|') };
}

/** Every chunk of the toy city. */
const CHUNKS: [number, number][] = [];
for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) CHUNKS.push([cx * 256, cz * 256]);

describe('urban scatterer', () => {
  const all = CHUNKS.map(([x, z]) => ({ x, z, ...run(x, z) }));
  const items = all.flatMap((c) => c.items);
  const of = (pattern: RegExp) => items.filter((i) => pattern.test(i.what));

  it('is deterministic for a given area and seed', () => {
    for (const [x, z] of CHUNKS.slice(0, 40)) expect(run(x, z).digest).toBe(run(x, z).digest);
    expect(run(0, -128, 1).digest).not.toBe(run(0, -128, 2).digest);
  });

  it('adds nothing outside Christchurch, and almost no work', () => {
    for (const [x, z] of [[2048, 0], [-2048, 512], [0, 4096], [512, 2048]]) {
      const far = run(x, z);
      expect(far.items).toEqual([]);
      expect(far.total).toBeLessThanOrEqual(9);
    }
  });

  it('stays cheap: a few hundred world queries per chunk at most', () => {
    const worst = Math.max(...all.map((c) => c.total));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.what] = (counts[i.what] ?? 0) + 1;
    console.log(`urban scatterer: worst chunk ${worst} queries; ${items.length} items over ${CHUNKS.length} chunks: ${JSON.stringify(counts)}`);
    expect(worst).toBeLessThanOrEqual(400);
  });

  it('floats boats on the river and stands willows on its banks', () => {
    const boats = of(/punt|skiff/);
    const willows = of(/willow/);
    expect(boats.length).toBeGreaterThan(3);
    expect(willows.length).toBeGreaterThan(10);
    for (const b of boats) {
      expect(depthAt(b.x, b.z)).toBeGreaterThan(0.3);
      // Afloat: at the water surface, not on the bed.
      expect(b.y).toBeCloseTo(8, 5);
    }
    for (const w of willows) {
      expect(depthAt(w.x, w.z)).toBe(0);
      expect(Math.abs(w.z - river(w.x))).toBeLessThan(26);
    }
  });

  it('furnishes parks and lays out fields in Hagley Park only', () => {
    const park = of(/bench|flowerbed/);
    expect(park.length).toBeGreaterThan(10);
    for (const i of park) expect(districtAt(i.x, i.z).type).toBe('park');
    const posts = of(/rugby-posts/);
    const pitchParts = of(/^box$|^collider$/);
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.length % 2).toBe(0);
    expect(pitchParts.length).toBeGreaterThan(0);
    for (const i of [...posts, ...pitchParts]) expect(districtAt(i.x, i.z).id).toBe('hagley');
  });

  it('keeps clear of road centrelines and landmark radii', () => {
    expect(items.length).toBeGreaterThan(40);
    for (const i of items) {
      expect(Math.abs(i.x - ROAD_X), i.what).toBeGreaterThanOrEqual(9);
      expect(Math.hypot(i.x - MARK.x, i.z - MARK.z), i.what).toBeGreaterThanOrEqual(MARK.clearRadius);
    }
  });
});
