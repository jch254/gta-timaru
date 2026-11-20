import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { LandmarkBuilder, LandmarkPlacement } from '../../../core/types';
import { getProp } from '../../props';
import { fakeMaterials, fakeWorld, REAL_BRANDS, RecordingBuilder, signature } from '../rural/fakes';
import { CLEAR_RADIUS } from '../rural/kit';
import { arcadeMall, RINK_MALL_STAFF } from './rinkmall';
import { royalArcade } from './royalarcade';

/** Recording builder that keeps every collider box (frame and size), to test points against them. */
class BoxRecorder extends RecordingBuilder {
  readonly boxes: { inv: THREE.Matrix4; c: THREE.Vector3; half: THREE.Vector3 }[] = [];

  override collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
    super.collider(frame, cx, cy, cz, w, h, d);
    this.boxes.push({ inv: frame.clone().invert(), c: new THREE.Vector3(cx, cy, cz), half: new THREE.Vector3(w / 2, h / 2, d / 2) });
  }

  /** Is the world point inside any collider? */
  blocked(p: THREE.Vector3): boolean {
    const q = new THREE.Vector3();
    return this.boxes.some((b) => {
      q.copy(p).applyMatrix4(b.inv).sub(b.c);
      return Math.abs(q.x) < b.half.x && Math.abs(q.y) < b.half.y && Math.abs(q.z) < b.half.z;
    });
  }
}

function build(builder: LandmarkBuilder, placement: LandmarkPlacement, ground: (x: number, z: number) => number) {
  const out = new BoxRecorder(fakeMaterials(), fakeWorld({ ground }));
  const slices = builder(placement, out);
  if (slices) while (!slices.next().done);
  return out;
}

/** Placement-frame point → world. */
function world(p: LandmarkPlacement, lx: number, y: number, lz: number): THREE.Vector3 {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  return new THREE.Vector3(p.x + lx * c + lz * s, y, p.z - lx * s + lz * c);
}

/** World → placement frame (x, z). */
function local(p: LandmarkPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  const dx = x - p.x;
  const dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Records (centres and vertices) outside the footprint grown by 1 m, or 3.2 m in front for a verandah. */
function strays(out: RecordingBuilder, p: LandmarkPlacement): string[] {
  const { w, d } = p.footprint!;
  const bad: string[] = [];
  const check = (op: string, x: number, z: number) => {
    const [lx, lz] = local(p, x, z);
    if (Math.abs(lx) > w / 2 + 1 || lz < -d / 2 - 1 || lz > d / 2 + 3.2) bad.push(`${op} at local (${lx.toFixed(2)}, ${lz.toFixed(2)})`);
  };
  for (const r of out.records) {
    check(r.op, r.x, r.z);
    if (r.vertices) for (let i = 0; i < r.vertices.length; i += 3) check(r.op, r.vertices[i], r.vertices[i + 2]);
  }
  return [...new Set(bad)].slice(0, 10);
}

function signTexts(out: RecordingBuilder): string[] {
  return out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text!);
}

function checkSigns(out: RecordingBuilder) {
  const texts = signTexts(out);
  expect(texts.length).toBeGreaterThan(5);
  for (const text of texts) {
    expect(text).not.toMatch(REAL_BRANDS);
    for (const banned of ['STAFFORD MALL', 'MERLIN', 'GALVIN']) expect(text.toUpperCase()).not.toContain(banned);
  }
}

function checkProps(out: RecordingBuilder) {
  const materials = fakeMaterials();
  for (const r of out.records) if (r.op === 'instance') expect(getProp(r.kind!, materials), `prop kind ${r.kind}`).not.toBeNull();
}

const lerpTable = (table: readonly (readonly [number, number])[], v: number) => {
  if (v <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [a, ya] = table[i - 1];
    const [b, yb] = table[i];
    if (v <= b) return ya + ((yb - ya) * (v - a)) / (b - a);
  }
  return table[table.length - 1][1];
};

// ───────────────────────────── The Rink Mall ─────────────────────────────

const MALL: LandmarkPlacement = { kind: 'timaru-arcade-mall', name: 'The Rink Mall', x: 482.7, z: 5122, heading: -Math.PI / 2, clearRadius: CLEAR_RADIUS['timaru-arcade-mall'], footprint: { w: 34, d: 40 } };
/** Stafford Street on top of the bank, falling steeply east to the railway flats; the street rises gently north. */
const BANK = [[462, 15.8], [470, 9], [480, 5.9], [490, 4.3], [500, 4.2]] as const;
const mallGround = (x: number, z: number) => lerpTable(BANK, x) + (5122 - z) * 0.004;
const mallFloor = mallGround(MALL.x - 21, MALL.z);

describe('The Rink Mall', () => {
  const out = build(arcadeMall, MALL, mallGround);

  it('builds cleanly inside its footprint and budget', () => {
    expect(out.problems).toEqual([]);
    expect(out.count('collider')).toBeGreaterThan(30);
    expect(out.count('light')).toBeLessThanOrEqual(2);
    expect(out.triangles).toBeLessThan(45000);
    expect(strays(out, MALL)).toEqual([]);
    checkProps(out);
    console.log(`Rink Mall: ${out.triangles} triangles, ${out.count('collider')} colliders, ${out.records.length} ops, ${new Set(signTexts(out)).size} signs`);
  });

  it('is deterministic', () => {
    expect(signature(build(arcadeMall, MALL, mallGround))).toBe(signature(out));
  });

  it('names only invented businesses, and has the tenants it should', () => {
    checkSigns(out);
    const texts = signTexts(out).join('|');
    for (const name of ['THE RINK MALL', 'WIZARDS MUSIC & MAGIC', 'BARGAIN BIN', 'TOTE AGENCY', 'FOR LEASE', 'THEATRE ROYAL', 'STARLIGHT MILK BAR', 'SOLE MAN', 'JEWELLERS']) expect(texts).toContain(name);
    expect(signTexts(out)).toEqual(expect.arrayContaining(['M', 'A', 'L']));
  });

  it('keeps the street door and the arcade open from the footpath to the court', () => {
    for (let lz = 22; lz >= -3; lz -= 0.25) {
      for (const lx of [-1.5, 0, 1.5]) {
        for (const h of [0.3, 1, 1.8]) {
          const p = world(MALL, lx, mallFloor + h, lz);
          expect(out.blocked(p), `blocked at local (${lx}, ${h}, ${lz})`).toBe(false);
        }
      }
    }
    // ...and the floor is there to walk on.
    for (let lz = 19; lz >= -3; lz -= 2) expect(out.blocked(world(MALL, 0, mallFloor - 0.1, lz))).toBe(true);
  });

  it('lets you walk into the music shop', () => {
    for (let lz = -3; lz >= -16; lz -= 0.25) expect(out.blocked(world(MALL, 0, mallFloor + 1, lz)), `at z ${lz}`).toBe(false);
  });

  it('gives the shopkeepers room to stand inside the footprint', () => {
    expect(RINK_MALL_STAFF.length).toBeGreaterThanOrEqual(3);
    for (const st of RINK_MALL_STAFF) {
      expect(Math.abs(st.x)).toBeLessThan(17);
      expect(Math.abs(st.z)).toBeLessThan(20);
      for (const h of [0.2, 1, 1.7]) expect(out.blocked(world(MALL, st.x, mallFloor + h, st.z)), `staff at (${st.x}, ${st.z})`).toBe(false);
      // A counter within reach in front of them.
      const ahead = world(MALL, st.x + Math.sin(st.heading) * 0.9, mallFloor + 0.6, st.z + Math.cos(st.heading) * 0.9);
      expect(out.blocked(ahead), `counter in front of (${st.x}, ${st.z})`).toBe(true);
    }
  });

  it('carries the building down to the low ground behind', () => {
    const back = out.records.filter((r) => r.op === 'collider' && local(MALL, r.x, r.z)[1] < -18);
    expect(Math.min(...back.map((r) => r.y))).toBeLessThan(10);
  });

  it('has a stair from the court passage down to a back door on the low ground', () => {
    const at = (lx: number, ly: number, lz: number) => out.blocked(world(MALL, lx, mallFloor + ly, lz));
    const yb = mallGround(world(MALL, 9, 0, -20.6).x, world(MALL, 9, 0, -20.6).z) - mallFloor;
    expect(yb).toBeLessThan(-10);
    // Court → passage → door into the stairwell.
    for (const [x, z] of [[6.5, -13], [6.5, -16.9], [8, -16.9], [9, -16.9]]) expect(at(x, 1, z), `passage at (${x}, ${z})`).toBe(false);
    // Four flights, alternately along the two lanes of the scissor.
    const step = -yb / 4;
    const flights = [
      { z: -14.9, x0: 9.8, x1: 15, y0: 0 },
      { z: -18.95, x0: 15, x1: 9.8, y0: -step },
      { z: -14.9, x0: 9.8, x1: 15, y0: -2 * step },
      { z: -18.95, x0: 15, x1: 9.8, y0: -3 * step },
    ];
    for (const [k, fl] of flights.entries()) {
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const x = fl.x0 + (fl.x1 - fl.x0) * t;
        const y = fl.y0 - step * t;
        expect(at(x, y - 0.12, fl.z), `tread under flight ${k} at x ${x.toFixed(1)}`).toBe(true);
        for (const h of [0.4, 1.5]) expect(at(x, y + h, fl.z), `headroom on flight ${k} at x ${x.toFixed(1)}`).toBe(false);
      }
    }
    // Out through the back door.
    expect(at(9, yb - 0.1, -19)).toBe(true);
    for (const z of [-19, -19.85, -20.4]) expect(at(9, yb + 1, z), `back door at z ${z}`).toBe(false);
  });
});

// ───────────────────────────── The Royal Arcade ─────────────────────────────

const ARCADE: LandmarkPlacement = { kind: 'royal-arcade', name: 'Royal Arcade', x: 418.3, z: 5048, heading: Math.PI / 2, clearRadius: CLEAR_RADIUS['royal-arcade'], footprint: { w: 14, d: 54 } };
/** 17.7 m on Stafford Street (x 445.3) up to 22.3 m on Sophia Street (x 391.3), not quite evenly. */
const arcadeGround = (x: number) => 17.7 + ((445.3 - x) * 4.6) / 54 + 0.3 * Math.sin(((445.3 - x) / 54) * Math.PI);

describe('The Royal Arcade', () => {
  const out = build(royalArcade, ARCADE, arcadeGround);

  it('builds cleanly inside its footprint and budget', () => {
    expect(out.problems).toEqual([]);
    expect(out.count('collider')).toBeGreaterThan(20);
    expect(out.count('light')).toBeLessThanOrEqual(2);
    expect(out.triangles).toBeLessThan(45000);
    expect(strays(out, ARCADE)).toEqual([]);
    checkProps(out);
    console.log(`Royal Arcade: ${out.triangles} triangles, ${out.count('collider')} colliders, ${out.records.length} ops, ${new Set(signTexts(out)).size} signs`);
  });

  it('is deterministic', () => {
    expect(signature(build(royalArcade, ARCADE, arcadeGround))).toBe(signature(out));
  });

  it('names only invented businesses, with the restoration boards', () => {
    checkSigns(out);
    const texts = signTexts(out).join('|');
    for (const name of ['ROYAL ARCADE', 'REOPENING 1996', 'HERITAGE', 'THE RAG TRADE']) expect(texts).toContain(name);
  });

  it('keeps at least 2 m of the lane clear from Stafford Street to Sophia Street', () => {
    for (let lz = -27; lz <= 27; lz += 0.25) {
      const ground = arcadeGround(world(ARCADE, 0, 0, lz).x);
      let run = 0;
      let best = 0;
      for (let lx = -2.2; lx <= 2.2001; lx += 0.1) {
        const clear = [0.5, 1.2, 1.9].every((h) => !out.blocked(world(ARCADE, lx, ground + h, lz)));
        run = clear ? run + 0.1 : 0;
        best = Math.max(best, run);
      }
      expect(best, `clear width at z ${lz}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('has a walking surface the length of the lane, climbing from Stafford to Sophia', () => {
    for (let lz = -26.5; lz <= 26.5; lz += 1) {
      const ground = arcadeGround(world(ARCADE, 0, 0, lz).x);
      expect(out.blocked(world(ARCADE, 0, ground - 0.08, lz)), `surface at z ${lz}`).toBe(true);
      expect(out.blocked(world(ARCADE, 0, ground + 0.3, lz)), `headroom at z ${lz}`).toBe(false);
    }
  });

  it('walls the lane in on both sides', () => {
    for (let lz = -25.5; lz <= 26; lz += 2) {
      const ground = arcadeGround(world(ARCADE, 0, 0, lz).x);
      for (const lx of [-4.5, 4.5]) expect(out.blocked(world(ARCADE, lx, ground + 1.5, lz)), `wall at (${lx}, ${lz})`).toBe(true);
    }
  });
});
