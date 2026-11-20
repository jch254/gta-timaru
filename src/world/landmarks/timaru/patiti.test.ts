// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WorldApi } from '../../../core/types';
import { compileMap } from '../../map';
import { buildMap } from '../../mapdata';
import { getProp } from '../../props';
import { LANDMARKS } from '../registry';
import { buildLandmark, fakeMaterials, RecordingBuilder, REAL_BRANDS, signature } from '../rural/fakes';
import { CLEAR_RADIUS } from '../rural/kit';
import './index';
import { patitiPoint } from './patiti';

const KIND = 'patiti-point';
const RADIUS = CLEAR_RADIUS[KIND];
/** Where the map puts it, and where South Street ends (just outside the clear circle, up the front). */
const REAL = { x: 762, z: 5480, heading: -1.6030432092301505 };
const ROAD_END = { x: 702, z: 5478 };
const MACRONS = /[āēīōūĀĒĪŌŪ]/;

/** Clifftop at 10.5 m for local z > −10, a bank down to a 1 m berm by z = −22, the sea beyond z = −40. */
const COAST = {
  ground: (_x: number, z: number) => (z > -10 ? 10.5 : z > -22 ? 10.5 + ((z + 10) * 9.5) / 12 : z > -40 ? 1 : 1 + (z + 40) * 0.2),
  water: (_x: number, z: number) => (z < -40 ? -(z + 40) * 0.2 : 0),
};

function check(out: RecordingBuilder, x: number, z: number) {
  expect(out.problems).toEqual([]);
  expect(out.count('light')).toBeLessThanOrEqual(2);
  expect(out.triangles).toBeLessThan(30000);
  expect(out.count('collider')).toBeGreaterThan(5);
  const reach = out.reach(x, z);
  expect(reach.distance, `${reach.record?.op} at ${reach.distance.toFixed(1)} m`).toBeLessThanOrEqual(RADIUS * 1.1);
  const materials = fakeMaterials();
  for (const r of out.records) {
    if (r.op === 'instance') expect(getProp(r.kind!, materials), `prop kind ${r.kind}`).not.toBeNull();
    if (r.material?.kind === 'sign') {
      expect(r.material.text).not.toMatch(REAL_BRANDS);
      expect(r.material.text).not.toMatch(MACRONS);
    }
  }
}

const texts = (out: RecordingBuilder) => out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text!);

/** Nothing stands on the end of South Street: no record centred there, and only the car park seal reaches it. */
function clearOfRoadEnd(out: RecordingBuilder) {
  for (const r of out.records) {
    expect(Math.hypot(r.x - ROAD_END.x, r.z - ROAD_END.z), `${r.op} ${r.kind ?? r.material?.key ?? ''}`).toBeGreaterThan(5);
    if (r.op !== 'geometry' || r.material?.key.startsWith('asphalt')) continue;
    const v = r.vertices!;
    for (let i = 0; i < v.length; i += 3) expect(Math.hypot(v[i] - ROAD_END.x, v[i + 2] - ROAD_END.z), r.material?.key).toBeGreaterThan(5);
  }
}

describe('Patiti Point', () => {
  it('is registered', () => {
    expect(LANDMARKS[KIND]).toBe(patitiPoint);
  });

  it('builds on flat ground without a railing or anything below a cliff', () => {
    const { out, placement } = buildLandmark(patitiPoint, KIND, RADIUS);
    check(out, placement.x, placement.z);
    expect(texts(out)).toContain('PATITI POINT');
    expect(texts(out)).not.toContain('SOUTH BEACH');
    expect(texts(out)).not.toContain('SKUX');
  });

  it('finds the cliff on a fake coast: railing, rocks, the shell and the beach track', () => {
    const flat = buildLandmark(patitiPoint, KIND, RADIUS);
    const { out, placement } = buildLandmark(patitiPoint, KIND, RADIUS, {}, COAST);
    check(out, placement.x, placement.z);
    expect(out.count('collider')).toBeGreaterThan(flat.out.count('collider') + 20);
    const t = texts(out);
    for (const text of ['PATITI POINT', 'SOUTH BEACH', 'SKUX', 'TIMA RULES', 'HOONS', '03', 'WHALING STATION 1839']) expect(t).toContain(text);
    // Railing colliders stand on the clifftop just back from the bank, never out over the drop.
    const top = out.records.filter((r) => r.op === 'collider' && r.y > 10 && r.y < 12 && r.z < -5);
    expect(top.length).toBeGreaterThan(15);
    for (const r of top) expect(r.z).toBeGreaterThan(-10);
    // Rocks and the shell sit down on the berm, dry.
    const low = out.records.filter((r) => r.op === 'collider' && r.y < 5);
    expect(low.length).toBeGreaterThan(4);
    for (const r of low) expect(r.z).toBeGreaterThan(-41);
  });

  it('is deterministic', () => {
    for (const world of [{}, COAST]) {
      const a = buildLandmark(patitiPoint, KIND, RADIUS, REAL, world);
      const b = buildLandmark(patitiPoint, KIND, RADIUS, REAL, world);
      expect(signature(a.out)).toBe(signature(b.out));
    }
  });

  it('leaves the end of South Street clear at the real placement', () => {
    const { out } = buildLandmark(patitiPoint, KIND, RADIUS, REAL);
    check(out, REAL.x, REAL.z);
    clearOfRoadEnd(out);
    // The seal does run out to meet the road end.
    const seal = out.records.filter((r) => r.op === 'geometry' && r.material?.key.startsWith('asphalt'));
    let nearest = Infinity;
    for (const r of seal) for (let i = 0; i < r.vertices!.length; i += 3) nearest = Math.min(nearest, Math.hypot(r.vertices![i] - ROAD_END.x, r.vertices![i + 2] - ROAD_END.z));
    expect(nearest).toBeLessThan(2);
  });

  it('builds on the real map terrain', () => {
    const map = compileMap(buildMap());
    const placement = map.landmarks.find((l) => l.kind === KIND)!;
    expect(Math.hypot(placement.x - REAL.x, placement.z - REAL.z)).toBeLessThan(1);
    const world = {
      bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
      seaLevel: 0,
      graph: map.graph,
      places: map.places,
      landmarks: map.landmarks,
      railways: [],
      heightAt: (x: number, z: number) => map.terrain.height(x, z),
      groundAt: (x: number, z: number) => map.terrain.height(x, z),
      waterDepthAt: (x: number, z: number) => map.terrain.waterDepth(x, z),
      surfaceAt: (x: number, z: number) => map.terrain.surface(x, z),
      districtAt: (x: number, z: number) => map.districtAt(x, z),
    } as unknown as WorldApi;
    const out = new RecordingBuilder(fakeMaterials(), world);
    patitiPoint(placement, out);
    check(out, placement.x, placement.z);
    clearOfRoadEnd(out);
    const t = texts(out);
    for (const text of ['SOUTH BEACH', 'SKUX']) expect(t).toContain(text);
    // Railing along the clifftop (about 10.5 m), rocks down on the berm (about 2 m), nothing solid out at sea.
    expect(out.records.filter((r) => r.op === 'collider' && r.y > 10 && r.y < 12.5).length).toBeGreaterThan(25);
    expect(out.records.filter((r) => r.op === 'collider' && r.y < 5).length).toBeGreaterThan(4);
    for (const r of out.records) if (r.op === 'collider' || r.op === 'instance') expect(map.terrain.waterDepth(r.x, r.z), `${r.op} ${r.kind ?? ''}`).toBeLessThan(1.2);
  }, 60000);
});
