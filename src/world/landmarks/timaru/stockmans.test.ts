import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LandmarkPlacement } from '../../../core/types';
import { fakeMaterials, fakeWorld, PRIMITIVE_OPS, REAL_BRANDS, RecordingBuilder, signature } from '../rural/fakes';
import { deptStore, STOCKMANS_STAFF } from './stockmans';

/** Records colliders (as local AABBs), conveyors and floors as well. */
class Recorder extends RecordingBuilder {
  readonly boxes: THREE.Vector3[][] = [];
  readonly conveyors: { from: THREE.Vector3; to: THREE.Vector3; width: number; speed: number }[] = [];
  readonly floors: { x: number; y: number; z: number; w: number; d: number }[] = [];

  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
    super.collider(frame, cx, cy, cz, w, h, d);
    const corners: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2).applyMatrix4(frame));
    this.boxes.push(corners);
  }

  conveyor(frame: THREE.Matrix4, from: readonly [number, number, number], to: readonly [number, number, number], width: number, speed: number): void {
    this.conveyors.push({ from: new THREE.Vector3(...from).applyMatrix4(frame), to: new THREE.Vector3(...to).applyMatrix4(frame), width, speed });
  }

  floor(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, d: number): void {
    const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(frame);
    this.floors.push({ x: p.x, y: p.y, z: p.z, w, d });
  }
}

const STOCKMANS: LandmarkPlacement = { kind: 'timaru-dept-store', name: 'Stockmans', x: 425.2, z: 5128, heading: Math.PI / 2, clearRadius: 27, footprint: { w: 34, d: 40, level: true } };
const FLOOR = 15.6;
const F1 = 4.3;

/** World → the placement's frame: x across the front (north here), z towards Stafford Street. */
function local(x: number, z: number): [number, number] {
  const c = Math.cos(STOCKMANS.heading);
  const s = Math.sin(STOCKMANS.heading);
  const dx = x - STOCKMANS.x;
  const dz = z - STOCKMANS.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** The town rising inland, with the platform cut into it as the world does (4.5 m round the back and sides). */
function ground(x: number, z: number): number {
  const [lx, lz] = local(x, z);
  const natural = FLOOR + Math.max(0, -lz - 18) * 0.18 + Math.max(0, lx - 18) * 0.4;
  return Math.abs(lx) < 21.5 && lz > -24.5 && lz < 19.6 ? Math.min(natural, FLOOR - 0.04) : natural;
}

function build() {
  const out = new Recorder(fakeMaterials(), fakeWorld({ ground }));
  const slices = deptStore(STOCKMANS, out);
  if (slices) while (!slices.next().done);
  return out;
}

/** Collider AABBs in the local frame, y above the shop floor. */
function boxes(out: Recorder): number[][] {
  const y0 = FLOOR - 0.04;
  return out.boxes.map((corners) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const v of corners) {
      const [lx, lz] = local(v.x, v.z);
      b[0] = Math.min(b[0], lx);
      b[1] = Math.min(b[1], v.y - y0);
      b[2] = Math.min(b[2], lz);
      b[3] = Math.max(b[3], lx);
      b[4] = Math.max(b[4], v.y - y0);
      b[5] = Math.max(b[5], lz);
    }
    return b;
  });
}
const hits = (b: number[], q: number[]) => b[0] < q[3] && b[3] > q[0] && b[1] < q[4] && b[4] > q[1] && b[2] < q[5] && b[5] > q[2];

describe('Stockmans department store', () => {
  const out = build();
  const local3 = (v: THREE.Vector3) => [...local(v.x, v.z), v.y - (FLOOR - 0.04)];

  it('builds cleanly within budget', () => {
    expect(out.problems).toEqual([]);
    expect(out.triangles).toBeLessThan(40000);
    expect(out.count('light')).toBeLessThanOrEqual(2);
    expect(out.count('collider')).toBeGreaterThan(60);
    expect(out.count(...PRIMITIVE_OPS)).toBeLessThan(500);
  });

  it('builds the same every time', () => {
    expect(signature(build())).toBe(signature(out));
  });

  it('stays in its footprint, allowing for the verandah, oriels and the retaining walls', () => {
    for (const r of out.records) {
      const pts: [number, number][] = [local(r.x, r.z)];
      if (r.vertices) for (let i = 0; i < r.vertices.length; i += 3) pts.push(local(r.vertices[i], r.vertices[i + 2]));
      for (const [lx, lz] of pts) {
        expect(Math.abs(lx), `${r.op} at x ${lx.toFixed(1)}`).toBeLessThanOrEqual(17 + 9.5);
        expect(lz, `${r.op} at z ${lz.toFixed(1)}`).toBeLessThanOrEqual(20 + 3.2);
        expect(lz, `${r.op} at z ${lz.toFixed(1)}`).toBeGreaterThanOrEqual(-20 - 9.5);
      }
    }
  });

  it('uses invented names only', () => {
    const texts = out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text!);
    expect(texts).toContain('STOCKMANS');
    for (const t of texts) {
      expect(t).not.toMatch(REAL_BRANDS);
      expect(t).not.toMatch(/FARMERS|\bFTC\b|HAY'?S/);
    }
  });

  it('has a pair of escalators between the floors, one up and one down', () => {
    expect(out.conveyors).toHaveLength(2);
    const rises = out.conveyors.map((c) => c.to.y - c.from.y).sort((a, b) => a - b);
    expect(rises[0]).toBeCloseTo(-F1, 2);
    expect(rises[1]).toBeCloseTo(F1, 2);
    for (const c of out.conveyors) {
      expect(c.speed).toBeGreaterThan(0.3);
      expect(c.width).toBeGreaterThan(0.8);
      for (const p of [c.from, c.to]) {
        const [lx, lz] = local(p.x, p.z);
        expect(Math.abs(lx)).toBeLessThan(16);
        expect(Math.abs(lz)).toBeLessThan(19);
      }
      // Climbing at no more than 31 degrees.
      const run = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
      expect(F1 / (run - 2.2)).toBeLessThan(Math.tan((31 * Math.PI) / 180));
    }
  });

  it('gives each escalator something to stand on all the way up', () => {
    const b = boxes(out);
    for (const c of out.conveyors) {
      const [fx, fz] = local(c.from.x, c.from.z);
      const [tx, tz] = local(c.to.x, c.to.z);
      for (const t of [0.3, 0.5, 0.7]) {
        const x = fx + (tx - fx) * t;
        const z = fz + (tz - fz) * t;
        const covered = b.some((q) => q[0] < x && q[3] > x && q[2] < z && q[5] > z && q[1] < F1 * 0.5 && q[4] > F1 * 0.4);
        expect(covered, `ramp under ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true);
      }
    }
  });

  it('leaves the doors, the way in to the escalators and the staff spots open', () => {
    const b = boxes(out);
    const clear = (q: number[], what: string) => expect(b.filter((x) => hits(x, q)).length, what).toBe(0);
    clear([-1.3, 0.3, 17, 1.3, 2.2, 21], 'front doorway');
    clear([-0.6, 0.3, 6.5, 0.6, 1.8, 17], 'aisle to the escalators');
    for (const st of STOCKMANS_STAFF) {
      const y = st.upstairs ? F1 : 0;
      clear([st.x - 0.25, y + 0.3, st.z - 0.25, st.x + 0.25, y + 1.6, st.z + 0.25], `staff at ${st.x}, ${st.z}`);
    }
  });

  it('registers both floors for people to stand on, with the escalator well left open upstairs', () => {
    const upper = out.floors.filter((f) => f.y - FLOOR > 4);
    const lower = out.floors.filter((f) => Math.abs(f.y - FLOOR) < 0.2);
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.length).toBeGreaterThan(1);
    const c = out.conveyors[0];
    const mid = new THREE.Vector3().lerpVectors(c.from, c.to, 0.5);
    const covers = (f: { x: number; z: number; w: number; d: number }) => {
      const [lx, lz] = local(mid.x, mid.z);
      const [fx, fz] = local(f.x, f.z);
      return Math.abs(lx - fx) < f.w / 2 && Math.abs(lz - fz) < f.d / 2;
    };
    expect(upper.some(covers)).toBe(false);
    void local3;
  });
});
