import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChunkBuilder, LandmarkBuilder, LandmarkPlacement } from '../../../core/types';
import { getProp } from '../../props';
import { LANDMARKS } from '../registry';
import { fakeMaterials, fakeWorld, RecordingBuilder, REAL_BRANDS, signature, type FakeWorldOptions } from '../rural/fakes';
import { CLEAR_RADIUS } from '../rural/kit';
import './index';
import { highfieldMall, northsideMall } from './suburbanmalls';

/** RecordingBuilder that also keeps every collider as a box, so tests can ask what is solid where. */
class SolidBuilder extends RecordingBuilder {
  readonly solids: { inv: THREE.Matrix4; hw: number; hh: number; hd: number }[] = [];

  override collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
    super.collider(frame, cx, cy, cz, w, h, d);
    const m = frame.clone().multiply(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    this.solids.push({ inv: m.invert(), hw: w / 2, hh: h / 2, hd: d / 2 });
  }

  solidAt(x: number, y: number, z: number): boolean {
    const p = new THREE.Vector3();
    return this.solids.some((b) => {
      p.set(x, y, z).applyMatrix4(b.inv);
      return Math.abs(p.x) <= b.hw && Math.abs(p.y) <= b.hh && Math.abs(p.z) <= b.hd;
    });
  }
}

interface Case {
  kind: string;
  builder: LandmarkBuilder;
  x: number;
  z: number;
  heading: number;
  w: number;
  d: number;
  /** Ground mimicking the site: world (x, z) → height. */
  ground: (x: number, z: number) => number;
}

// Northside: about 31 m at the Evans Street front falling to about 22 m at the back (local +z is the front),
// with a little cross-fall so the floor level is not decided by a perfectly even slope.
const NS: Case = {
  kind: 'northside-mall',
  builder: northsideMall,
  x: 290.7,
  z: 4680.7,
  heading: -1.09,
  w: 90,
  d: 68,
  ground: (x, z) => {
    const h = -1.09;
    const lx = (x - 290.7) * Math.cos(h) - (z - 4680.7) * Math.sin(h);
    const lz = (x - 290.7) * Math.sin(h) + (z - 4680.7) * Math.cos(h);
    return 26.5 + (9 / 68) * lz + 0.012 * lx;
  },
};

// Highfield: 38-39 m, falling about 2 m towards the south-west corner (world −x, +z).
const HF: Case = {
  kind: 'highfield-mall',
  builder: highfieldMall,
  x: 0,
  z: 4744.5,
  heading: 3.07,
  w: 88,
  d: 68,
  ground: (x, z) => 39 - Math.min(1, Math.max(0, (44 - x) / 88)) - Math.min(1, Math.max(0, (z - 4710.5) / 68)),
};

function build(c: Case, lod: 0 | 1 = 0) {
  const options: FakeWorldOptions = { ground: c.ground, district: () => 'shops' };
  const world = fakeWorld(options);
  const out = new SolidBuilder(fakeMaterials(), world);
  if (lod === 1) Object.defineProperty(out, 'lod', { value: 1 });
  const placement: LandmarkPlacement = { kind: c.kind, name: 'Test Mall', x: c.x, z: c.z, heading: c.heading, clearRadius: CLEAR_RADIUS[c.kind], footprint: { w: c.w, d: c.d } };
  const slices = c.builder(placement, out as ChunkBuilder);
  if (slices) while (!slices.next().done);
  return { out, placement };
}

/** World point → placement frame (x across the frontage, z towards the front). */
function local(p: LandmarkPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  const dx = x - p.x;
  const dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

function world(p: LandmarkPlacement, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}

const NOT_OURS = /NORTHTOWN|NEW WORLD|\bPAK\b|COUNTDOWN|WOOLWORTHS|FOODTOWN|SUPER ?VALUE|TRUST ?BANK|FOUR SQUARE|NZ POST/;

describe('suburban malls', () => {
  it('registers both kinds', () => {
    expect(LANDMARKS['northside-mall']).toBe(northsideMall);
    expect(LANDMARKS['highfield-mall']).toBe(highfieldMall);
  });

  for (const c of [NS, HF]) {
    it(`${c.kind}: builds cleanly inside its footprint and budget`, () => {
      const { out, placement } = build(c);
      expect(out.problems).toEqual([]);
      expect(out.count('light')).toBeLessThanOrEqual(2);
      expect(out.count('collider')).toBeGreaterThan(10);
      expect(out.triangles).toBeLessThan(45000);
      const hw = c.w / 2 + 1;
      const hd = c.d / 2 + 1;
      const outside: string[] = [];
      for (const r of out.records) {
        const pts: [number, number][] = [[r.x, r.z]];
        if (r.vertices) for (let i = 0; i < r.vertices.length; i += 3) pts.push([r.vertices[i], r.vertices[i + 2]]);
        for (const [x, z] of pts) {
          const [lx, lz] = local(placement, x, z);
          if (Math.abs(lx) > hw || Math.abs(lz) > hd) {
            outside.push(`${r.op} ${r.kind ?? r.material?.key ?? ''} at ${lx.toFixed(1)}, ${lz.toFixed(1)}`);
            break;
          }
        }
      }
      expect(outside).toEqual([]);
      const materials = fakeMaterials();
      for (const r of out.records) {
        if (r.op === 'instance') expect(getProp(r.kind!, materials), `prop kind ${r.kind}`).not.toBeNull();
        if (r.material?.kind === 'sign') {
          expect(r.material.text).not.toMatch(REAL_BRANDS);
          expect(r.material.text!.toUpperCase()).not.toMatch(NOT_OURS);
        }
      }
      console.log(`${c.kind}: ${out.triangles} triangles, ${out.count('collider')} colliders, ${out.records.length} ops, ${out.count('instance')} props`);
    });

    it(`${c.kind}: is deterministic, and builds at reduced detail`, () => {
      expect(signature(build(c).out)).toBe(signature(build(c).out));
      const far = build(c, 1).out;
      expect(far.problems).toEqual([]);
      // Only Northside has fittings to leave out.
      if (c === NS) expect(far.triangles).toBeLessThan(build(c).out.triangles * 0.6);
      else expect(far.triangles).toBeLessThanOrEqual(build(c).out.triangles);
    });
  }

  it('northside-mall: the concourse is open from the entrance inwards, over a level floor', () => {
    const { out, placement } = build(NS);
    const signs = new Set(out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text));
    for (const text of ['NORTHSIDE MALL', 'MIGHTY TROLLEY FOODS', 'NORTHSIDE TAVERN', 'NORTHSIDE NUTRITION', 'PLAINS SAVINGS BANK', 'NORTHSIDE HAIR STUDIO']) expect(signs).toContain(text);
    const [ex, ez] = world(placement, -3, -8);
    const base = NS.ground(ex, ez);
    const floors: number[] = [];
    for (const lx of [-4, -3, -2]) {
      for (let lz = -3.9; lz >= -14; lz -= 0.5) {
        const [x, z] = world(placement, lx, lz);
        // Walk up from well below: the floor is the top of the first solid with 2.4 m of headroom over it.
        let floor: number | null = null;
        let wasSolid = false;
        for (let y = base - 8; y < base + 10; y += 0.05) {
          const solid = out.solidAt(x, y, z);
          if (wasSolid && !solid) {
            let clear = true;
            for (let k = y; k < y + 2.4; k += 0.05) if (out.solidAt(x, k, z)) clear = false;
            if (clear) {
              floor = y;
              break;
            }
          }
          wasSolid = solid;
        }
        expect(floor, `headroom at ${lx}, ${lz.toFixed(1)}`).not.toBeNull();
        floors.push(floor!);
      }
    }
    expect(Math.max(...floors) - Math.min(...floors)).toBeLessThan(0.11);
  });

  it('northside-mall: the entrance is a kerb or a ramp from the car park, never a wall', () => {
    const { out, placement } = build(NS);
    // From the car park towards the doors along the entrance's centre line: the standing height never jumps
    // by more than 0.4 m between steps 0.25 m apart.
    let last: number | null = null;
    for (let lz = 6; lz >= -5; lz -= 0.25) {
      const [x, z] = world(placement, -3, lz);
      let top = NS.ground(x, z);
      for (let y = top - 1; y < top + 1.5; y += 0.02) if (out.solidAt(x, y, z) && !out.solidAt(x, y + 1.6, z)) top = Math.max(top, y);
      if (last !== null) expect(Math.abs(top - last), `step at ${lz}`).toBeLessThan(0.4);
      last = top;
    }
  });
});
