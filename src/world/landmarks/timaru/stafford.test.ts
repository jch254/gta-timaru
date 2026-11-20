import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LandmarkBuilder, LandmarkPlacement } from '../../../core/types';
import { CUT_DROP } from '../../height';
import { fakeMaterials, fakeWorld, type FakeWorldOptions, PRIMITIVE_OPS, REAL_BRANDS, RecordingBuilder, signature } from '../rural/fakes';
import { DEKKO_STAFF, discountStore } from './dekko';
import { MILLSTONE_DOOR, nightclub } from './millstone';

/** Recording builder that also keeps each collider's eight corners (world space), for clearance checks. */
class ColliderRecorder extends RecordingBuilder {
  readonly boxes: THREE.Vector3[][] = [];

  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
    super.collider(frame, cx, cy, cz, w, h, d);
    const corners: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2).applyMatrix4(frame));
    this.boxes.push(corners);
  }
}

function build(builder: LandmarkBuilder, placement: LandmarkPlacement, world: FakeWorldOptions = {}) {
  const w = fakeWorld(world);
  const out = new ColliderRecorder(fakeMaterials(), w);
  const slices = builder(placement, out);
  if (slices) while (!slices.next().done);
  // A shop on a cut platform stands on the platform, just above the cut ground (see Site).
  return { out, siteY: w.groundAt(placement.x, placement.z) + (placement.footprint?.level ? CUT_DROP : 0) };
}

/** World point → the placement's local frame (x across the front, z towards the front). */
function local(p: LandmarkPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  const dx = x - p.x;
  const dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Every primitive centre and custom-geometry vertex, in the local frame. */
function points(out: RecordingBuilder, p: LandmarkPlacement): { lx: number; lz: number; op: string }[] {
  const pts: { lx: number; lz: number; op: string }[] = [];
  for (const r of out.records) {
    const [lx, lz] = local(p, r.x, r.z);
    pts.push({ lx, lz, op: r.op });
    if (r.vertices) {
      for (let i = 0; i < r.vertices.length; i += 3) {
        const [vx, vz] = local(p, r.vertices[i], r.vertices[i + 2]);
        pts.push({ lx: vx, lz: vz, op: r.op });
      }
    }
  }
  return pts;
}

/** Local axis-aligned bounds of each collider ([x0, y0, z0, x1, y1, z1], y relative to the site). */
function localBoxes(out: ColliderRecorder, p: LandmarkPlacement, siteY: number): number[][] {
  return out.boxes.map((corners) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const v of corners) {
      const [lx, lz] = local(p, v.x, v.z);
      const ly = v.y - siteY;
      b[0] = Math.min(b[0], lx);
      b[1] = Math.min(b[1], ly);
      b[2] = Math.min(b[2], lz);
      b[3] = Math.max(b[3], lx);
      b[4] = Math.max(b[4], ly);
      b[5] = Math.max(b[5], lz);
    }
    return b;
  });
}

const overlaps = (b: number[], q: number[]) => b[0] < q[3] && b[3] > q[0] && b[1] < q[4] && b[4] > q[1] && b[2] < q[5] && b[5] > q[2];

function signTexts(out: RecordingBuilder): string[] {
  return out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text!);
}

// ───────────────────────────── Dekko ─────────────────────────────

const DEKKO: LandmarkPlacement = { kind: 'timaru-discount-store', name: 'Dekko', x: 429, z: 5152, heading: Math.PI / 2, clearRadius: 20, footprint: { w: 24, d: 32, level: true } };

/** The town rising inland behind Stafford Street, with the shop's platform cut into it as the world does. */
function dekkoGround(): (x: number, z: number) => number {
  const natural = (x: number, z: number) => 10 + Math.max(0, 445 - x) * 0.16 + (5152 - z) * 0.01;
  const cut = natural(DEKKO.x + Math.sin(DEKKO.heading) * 17.5, DEKKO.z + Math.cos(DEKKO.heading) * 17.5);
  return (x, z) => {
    const [lx, lz] = local(DEKKO, x, z);
    const h = natural(x, z);
    return Math.abs(lx) < 16.5 && lz > -20.5 && lz < 15.6 ? Math.min(h, cut - CUT_DROP) : h;
  };
}

const STOCKMANS: LandmarkPlacement = { kind: 'timaru-dept-store', name: 'Stockmans', x: 425.4, z: 5121, heading: Math.PI / 2, clearRadius: 27, footprint: { w: 34, d: 40, level: true } };

describe('Dekko discount store', () => {
  const ground = dekkoGround();
  const { out, siteY } = build(discountStore, DEKKO, { ground });

  it('builds cleanly within budget', () => {
    expect(out.problems).toEqual([]);
    expect(out.records.length).toBeGreaterThan(100);
    expect(out.count('collider')).toBeGreaterThan(20);
    expect(out.count('light')).toBeLessThanOrEqual(2);
    expect(out.triangles).toBeLessThan(40000);
    expect(out.count(...PRIMITIVE_OPS)).toBeLessThan(400);
  });

  it('stays in its footprint, allowing for the verandah and the retaining walls', () => {
    // The walls fill the terrain cell beyond the cut (CUT_MARGIN + a 4 m cell).
    for (const q of points(out, DEKKO)) {
      expect(Math.abs(q.lx), `${q.op} at x ${q.lx.toFixed(2)}`).toBeLessThanOrEqual(12 + 9.5);
      expect(q.lz, `${q.op} at z ${q.lz.toFixed(2)}`).toBeLessThanOrEqual(16 + 3.2);
      expect(q.lz, `${q.op} at z ${q.lz.toFixed(2)}`).toBeGreaterThanOrEqual(-16 - 9.5);
    }
  });

  it('builds the same every time', () => {
    expect(signature(build(discountStore, DEKKO, { ground }).out)).toBe(signature(out));
  });

  it('uses invented names only', () => {
    const texts = signTexts(out);
    expect(texts).toContain('DEKKO');
    for (const t of texts) {
      expect(t).not.toMatch(REAL_BRANDS);
      expect(t).not.toMatch(/DEKA/);
    }
  });

  it('leaves the doorway open and the floor inside it clear', () => {
    const boxes = localBoxes(out, DEKKO, siteY);
    const doorway = [-1.0, 0.05, 15.3, 1.0, 2.2, 16.4];
    const lobby = [-1.2, 0.05, 12.6, 1.2, 2.2, 15.6];
    expect(boxes.filter((b) => overlaps(b, doorway))).toEqual([]);
    expect(boxes.filter((b) => overlaps(b, lobby))).toEqual([]);
    // And it is a real enclosure: walls either side of the door, a floor and a ceiling.
    expect(boxes.some((b) => overlaps(b, [1.3, 0.5, 15.7, 11, 1, 15.9]))).toBe(true);
    expect(boxes.some((b) => b[4] <= 0.01 && b[4] > -0.01 && b[3] - b[0] > 20)).toBe(true);
    expect(boxes.some((b) => b[1] >= 3.5 && b[1] < 3.7 && b[3] - b[0] > 20)).toBe(true);
  });

  it('puts the shop assistants on clear floor behind the tills, customers in front of them', () => {
    const boxes = localBoxes(out, DEKKO, siteY);
    const free = (x: number, z: number) => !boxes.some((b) => overlaps(b, [x - 0.2, 0.3, z - 0.2, x + 0.2, 1.6, z + 0.2]));
    expect(DEKKO_STAFF.length).toBeGreaterThanOrEqual(2);
    for (const st of DEKKO_STAFF) {
      expect(free(st.x, st.z), `staff at ${st.x}, ${st.z}`).toBe(true);
      const ax = st.x + Math.sin(st.heading) * 1.4;
      const az = st.z + Math.cos(st.heading) * 1.4;
      expect(free(ax, az), `customer side of ${st.x}, ${st.z}`).toBe(true);
      expect(Math.abs(st.x)).toBeLessThan(11.6);
      expect(Math.abs(st.z)).toBeLessThan(15.6);
    }
  });

  it('holds up the bank behind the cut', () => {
    const boxes = localBoxes(out, DEKKO, siteY);
    const back = boxes.filter((b) => b[2] < -20.3 && b[5] > -21.2 && b[4] > 3);
    expect(back.length).toBeGreaterThan(3);
  });

  it('treats the side next to Stockmans as a party wall when the map has it', () => {
    const next = build(discountStore, DEKKO, { ground, landmarks: [DEKKO, STOCKMANS] });
    expect(next.out.problems).toEqual([]);
    // Stockmans is north of Dekko on the map, local +x; its footprint starts 14 m out.
    for (const q of points(next.out, DEKKO)) expect(q.lx, `${q.op} at x ${q.lx.toFixed(2)}`).toBeLessThan(14);
    const boxes = localBoxes(next.out, DEKKO, next.siteY);
    expect(boxes.some((b) => b[0] < -16 && b[4] > 2)).toBe(true);
  });

  it('builds on flat ground too', () => {
    const flat = build(discountStore, DEKKO);
    expect(flat.out.problems).toEqual([]);
    expect(flat.out.count('collider')).toBeGreaterThan(20);
  });
});

// ───────────────────────────── The Millstone ─────────────────────────────

const MILL: LandmarkPlacement = { kind: 'timaru-nightclub', name: 'The Millstone', x: 510, z: 5214.8, heading: Math.PI, clearRadius: 21, footprint: { w: 34, d: 22 } };

/** North Street dropping down the bank to the railway, the bank rising behind the mill. */
function millGround(x: number, z: number): number {
  const road = 9.5 - ((x - 493) * 3.9) / 34;
  const bank = Math.min(4.4, Math.max(0, (527 - x) * 0.13)) * Math.min(1, Math.max(0, (z - 5202) / 8));
  return road + bank + Math.max(0, z - 5203.8) * 0.1;
}

describe('The Millstone nightclub', () => {
  const { out, siteY } = build(nightclub, MILL, { ground: millGround });

  it('builds cleanly within budget', () => {
    expect(out.problems).toEqual([]);
    expect(out.records.length).toBeGreaterThan(40);
    expect(out.count('collider')).toBeGreaterThanOrEqual(8);
    expect(out.count('light')).toBeLessThanOrEqual(2);
    expect(out.triangles).toBeLessThan(40000);
    expect(out.count(...PRIMITIVE_OPS)).toBeLessThan(200);
  });

  it('stays in its footprint, allowing for the door canopy and the eaves', () => {
    for (const q of points(out, MILL)) {
      expect(Math.abs(q.lx), `${q.op} at x ${q.lx.toFixed(2)}`).toBeLessThanOrEqual(17 + 1);
      expect(q.lz, `${q.op} at z ${q.lz.toFixed(2)}`).toBeLessThanOrEqual(11 + 3.2);
      expect(q.lz, `${q.op} at z ${q.lz.toFixed(2)}`).toBeGreaterThanOrEqual(-11 - 1);
    }
  });

  it('builds the same every time', () => {
    expect(signature(build(nightclub, MILL, { ground: millGround }).out)).toBe(signature(out));
  });

  it('has the neon, the ghost sign and invented names only', () => {
    const texts = signTexts(out);
    expect(texts).toContain('THE MILLSTONE');
    expect(texts).toContain('ROLLER FLOUR MILLS');
    const neon = out.records.find((r) => r.material?.text === 'THE MILLSTONE')!;
    expect(neon.material!.key).toContain('"style":"neon"');
    for (const t of texts) {
      expect(t).not.toMatch(REAL_BRANDS);
      expect(t).not.toMatch(/BELFORD/);
    }
  });

  it('stands its walls on the ground, down the bank as well as up it', () => {
    for (const corners of out.boxes) {
      const h = corners.reduce((m, v) => Math.max(m, v.y), -Infinity) - corners.reduce((m, v) => Math.min(m, v.y), Infinity);
      if (h < 3) continue;
      const bottom = corners.reduce((m, v) => Math.min(m, v.y), Infinity);
      for (const v of corners) expect(bottom).toBeLessThanOrEqual(millGround(v.x, v.z) + 0.01);
    }
  });

  it('leaves the spot outside the door clear, on the street side of the front wall', () => {
    const boxes = localBoxes(out, MILL, siteY);
    const { x, z, heading } = MILLSTONE_DOOR;
    const [wx, wz] = [MILL.x + x * Math.cos(MILL.heading) + z * Math.sin(MILL.heading), MILL.z - x * Math.sin(MILL.heading) + z * Math.cos(MILL.heading)];
    const y = millGround(wx, wz) - siteY;
    expect(z).toBeGreaterThan(11);
    expect(heading).toBe(0);
    expect(boxes.filter((b) => overlaps(b, [x - 0.3, y + 0.3, z - 0.3, x + 0.3, y + 1.7, z + 0.3]))).toEqual([]);
  });

  it('builds on flat ground too', () => {
    const flat = build(nightclub, MILL);
    expect(flat.out.problems).toEqual([]);
  });
});
