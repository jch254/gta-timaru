import * as THREE from 'three';
import type { LandmarkBuilder, SignOptions } from '../../../core/types';
import { ESCALATOR_FLAT } from '../../escalators';
import { retainCut } from '../cut';
import { CLOTHES, Interior } from '../interior';
import { Geo, Site, sub, type V3 } from '../rural/kit';

/**
 * Stockmans, the department store on Stafford Street (the Farmers people remember), in the 1902 Coronation
 * Buildings: a symmetrical two-storey front with a big arched opening under a pediment carrying the name and
 * date, end bays with their own pediments and oriel windows, and in 1995 a verandah hung from the facade (the
 * posts came back in 1997). Inside, two floors joined by a pair of escalators, which local lore has as the
 * first in Timaru (docs/research/11-timaru-landmarks.md: an escalator there c. 1990 is on record; "first" is not).
 *
 * Local frame: floor at y = 0 (the platform the world cuts level with the footpath), front wall on z = +20, plan
 * 34 × 40. The ground floor runs 4 m to the underside of the first floor; the first floor is at 4.3.
 */

/** Where the counter staff stand (local; `upstairs` on the first floor), facing the customers. */
export const STOCKMANS_STAFF: { x: number; z: number; heading: number; upstairs?: boolean }[] = [
  { x: -6.2, z: 12.6, heading: 0 },
  { x: 6.2, z: 12.6, heading: 0 },
  { x: 4.4, z: 2.6, heading: Math.PI / 2 },
  { x: -10.8, z: -8.6, heading: -Math.PI / 2, upstairs: true },
  { x: 9.6, z: 12.2, heading: Math.PI, upstairs: true },
];

const W = 34;
const D = 40;
/** How far beyond the footprint's back and sides the world cuts the ground down (TerrainModel's CUT_MARGIN). */
const CUT = 4.5;
const T = 0.3;
const HX = W / 2 - 0.15;
const FZ = D / 2 - 0.15;
/** Underside of the first floor, its top, the first-floor ceiling, the roof and the parapet. */
const H0 = 4.0;
const F1 = 4.3;
const H1 = 7.9;
const ROOF = 8.2;
/** Escalators: the pair runs back from the foot at z = +5, up to the first floor at the back of the well. */
const FOOT = 5;
const RUN = ESCALATOR_FLAT * 2 + F1 / Math.tan((30 * Math.PI) / 180);
const HEAD = FOOT - RUN;
const UP_X = -1.05;
const DOWN_X = 1.05;
/** The well in the first floor over the escalators: [x0, z0, x1, z1]. */
const WELL: [number, number, number, number] = [-2.05, HEAD, 2.05, 1.9];
/** The hole over the back stair (in the stockrooms), which climbs along +x to the first floor at x = -8.6. */
const STAIRWELL: [number, number, number, number] = [-13.6, -19.4, -8.6, -17.85];

const RED = 0xb3201e;
const BRAND: SignOptions = { bg: '#b3201e', fg: '#ffffff', style: 'block', border: false };
const DEPT: SignOptions = { bg: '#f4f0e6', fg: '#b3201e', style: 'block', aspect: 5 };
const CREAM = '#efe6cf';

const PERFUME = [0xf0d8e0, 0xd8b8c8, 0xe8d090, 0xc0d8e8, 0xf4f0e6, 0xb06080, 0x8a6ab0];
const SHOES = [0x2a2018, 0x5a3a24, 0x1c1c22, 0x8a5a3a, 0xe8e2d8, 0x6a2a2a];
const CROCKERY = [0xf4f2ec, 0xe8e4d8, 0x5a7ab0, 0x2f5f8a, 0xd8c8a8, 0x9ab8a8];
const TOWELS = [0xf2eee4, 0xe8b8c8, 0xa8c8e8, 0xd8e8c8, 0xf0d8a0, 0xc8a8d8, 0x8ab8b8];
const TOYS = [0xc8302a, 0x2f5fa8, 0xe5b52b, 0x3f8f4a, 0xd8642a, 0x5ab0c8, 0xe07aa8];

export const deptStore: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const it = new Interior(out, s.f, s.seed);
  // The footpath may climb along the frontage: keep the verandah's clearance at its high end.
  const lift = Math.min(0.5, Math.max(0, ...[-15, 0, 15].map((x) => s.gy(x, D / 2 + 1.6))));
  shell(s, it);
  groundFloor(it);
  firstFloor(it);
  escalators(s, it);
  facade(s, it, lift);
  margins(s, it);
  it.flush();
  // One light on each floor; the verandah's lamps glow on their own and the street has its lamps.
  it.light(0, 3.6, 8, 0xf2f6ff, 170, 26);
};

/** Both floors' walls, floors and ceilings, with the shop doors, the side door and the escalator well. */
function shell(s: Site, it: Interior): void {
  const brick = s.mat('brick');
  const plaster = it.paint(0xf1ede2, 'plaster');
  it.room({
    w: HX * 2,
    d: FZ * 2,
    h: H0,
    t: T,
    floor: it.paint(0xcfc6b4, 'concrete'),
    wall: plaster,
    outer: brick,
    plinth: 1.5,
    noCeiling: true,
    openings: [
      { side: 'front', at: 0, width: 3.2, height: 2.6 },
      { side: 'front', at: -6.6, width: 8.4, sill: 0.5, height: 2.6, glass: it.glass },
      { side: 'front', at: 6.6, width: 8.4, sill: 0.5, height: 2.6, glass: it.glass },
      { side: 'front', at: -13.6, width: 3.8, sill: 0.5, height: 2.6, glass: it.glass },
      { side: 'front', at: 13.6, width: 3.8, sill: 0.5, height: 2.6, glass: it.glass },
      // Out to the delivery lane down the side.
      { side: 'right', at: -17, width: 1.6, height: 2.4 },
      { side: 'right', at: 4, width: 2.2, sill: 2.2, height: 1.2, glass: it.glass },
      { side: 'right', at: 12, width: 2.2, sill: 2.2, height: 1.2, glass: it.glass },
    ],
  });
  // First floor: its slab (the ground floor's ceiling underneath, carpet on top) with the escalator well.
  it.slab(0, F1, 0, HX * 2 - T, FZ * 2 - T, it.paint(0xeeeae0, 'plaster'), [WELL, STAIRWELL], 0.3, true, it.paint(0x8a6a5a, 'cloth'));
  it.room({
    y: F1,
    w: HX * 2,
    d: FZ * 2,
    h: H1 - F1,
    t: T,
    floor: it.paint(0x8a6a5a, 'cloth'),
    wall: it.paint(0xeee6d8, 'plaster'),
    outer: s.mat('plaster', 0xe2d6bc),
    noFloor: true,
    noCeiling: true,
    openings: [
      // The big arched opening in the middle of the front, the end bays' oriels, the plain windows between.
      { side: 'front', at: 0, width: 5.2, sill: 0.7, height: 2.6, glass: it.glass },
      ...[-12.2, -6, 6, 12.2].map((at) => ({ side: 'front' as const, at, width: 2.1, sill: 0.8, height: 2.2, glass: it.glass })),
      ...[-6, 2, 10].map((at) => ({ side: 'right' as const, at, width: 2, sill: 1, height: 1.6, glass: it.glass })),
    ],
  });
  // The first-floor ceiling, and the roof over it.
  it.slab(0, H1, 0, HX * 2 - T, FZ * 2 - T, it.paint(0xf3f1ea, 'plaster'), [], 0.3);
  it.fluoros(-16, -14, 16, 18.8, H0, 3.4, 2.8);
  it.fluoros(-16, -14, 16, 18.8, H1, 3.4, 2.8);
  // Stockroom across the back of both floors.
  for (const y of [0, F1]) {
    it.wall(-HX, -14.5, HX, -14.5, { y0: y, h: (y ? H1 : H0) - y, t: 0.2, inner: it.paint(0xe6e0d0, 'plaster'), holes: [{ along: HX - 9, width: 1.4, sill: 0, height: 2.2 }, { along: HX + 14, width: 1.6, sill: 0, height: 2.3 }] });
  }
  // The back stair, in the stockroom, for staff (and anyone who walks through the STAFF ONLY door).
  it.stairs(-15.6, -18.6, 1.4, F1, 7, Math.PI / 2, { side: it.paint(0xd8d4c8, 'plaster') });
}

/** A run of chrome pipe rail at waist height between floor-level points [x, z, y], with a collider. */
function rail(it: Interior, pts: [number, number, number][], height = 1.0): void {
  const chrome = it.g(it.m.get('chrome'));
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, ay] = pts[i];
    const [bx, bz, by] = pts[i + 1];
    chrome.tube([ax, ay + height, az], [bx, by + height, bz], 0.03, 0.03, 6, false);
    chrome.tube([ax, ay + height * 0.5, az], [bx, by + height * 0.5, bz], 0.015, 0.015, 4, false);
    const len = Math.hypot(bx - ax, bz - az);
    for (let k = 0; k <= Math.ceil(len / 1.5); k++) {
      const t = k / Math.ceil(len / 1.5);
      chrome.post(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0.04, height);
    }
    it.collide((ax + bx) / 2, (ay + by) / 2 + 0.6, (az + bz) / 2, Math.abs(bx - ax) + 0.08, 1.2, Math.abs(bz - az) + 0.08);
  }
}

/** Cosmetics and perfume by the doors, womenswear one side, menswear and shoes the other, the service desk. */
function groundFloor(it: Interior): void {
  const glassTop = it.glass;
  const white = it.paint(0xf2f0ea);
  // Perfume and cosmetics: glass-topped counters in a U either side of the doors, a mirrored pillar each.
  for (const sx of [-1, 1]) {
    const cx = sx * 6.2;
    for (const [x, z, w, yaw] of [[cx, 13.6, 4.2, 0], [cx + sx * 2.45, 12.0, 2.4, Math.PI / 2], [cx - sx * 2.45, 12.0, 2.4, Math.PI / 2]] as const) {
      it.counter(x, z, w, yaw, { front: white, top: glassTop, h: 0.95, d: 0.6 });
      it.b.at(x, 0, z, yaw, () => {
        for (let k = 0; k < Math.floor(w / 0.22); k++) it.g(it.paint(PERFUME[it.rng.int(0, PERFUME.length - 1)])).box(-w / 2 + 0.15 + k * 0.22, 0.98, 0.05, 0.08, 0.1 + it.rng.range(0, 0.08), 0.08);
      });
    }
    it.solid(it.m.get('chrome'), cx, 1.2, 10.0, 0.6, 2.4, 0.6);
    it.hangingSign(sx < 0 ? 'COSMETICS' : 'FRAGRANCE', cx, 3.2, 12.4, 2.2, 0, H0, DEPT);
  }
  // Womenswear, right: rails and round racks, a few dummies.
  for (const [x, z] of [[9, 7], [12.5, 7], [9, 3], [12.5, 3], [9, -1], [12.5, -1]] as const) it.rack(x, z, 1.6, (x + z) % 2 ? 0 : Math.PI / 2, CLOTHES, (x + z) % 3 === 0);
  it.mannequin(15.2, 9.4, -Math.PI / 2, CLOTHES[1]);
  it.mannequin(15.2, 4.4, -Math.PI / 2, CLOTHES[9]);
  it.gondola(HX - 0.25, -6.5, 10, -Math.PI / 2, { single: true, h: 2, colors: CLOTHES, frame: 0xe8e4dc });
  it.hangingSign('LADIES FASHIONS', 10.8, 3.2, 3, 2.6, Math.PI / 2, H0, DEPT);
  // Menswear and shoes, left.
  for (const [x, z] of [[-9, 6], [-12.5, 6], [-9, 1.5], [-12.5, 1.5]] as const) it.rack(x, z, 1.6, Math.PI / 2, [0x2c3a5c, 0x6a6a72, 0x1c1c22, 0xd8c8a8, 0x3c5a3a]);
  it.table(-9.5, -3, 1.6, 0.9, 0);
  it.mannequin(-15.2, 8.4, Math.PI / 2, 0x2c3a5c);
  it.hangingSign('MENSWEAR', -10.8, 3.2, 3.6, 2.4, Math.PI / 2, H0, DEPT);
  it.gondola(-HX + 0.25, -8.6, 10, Math.PI / 2, { single: true, h: 1.9, shelves: 5, colors: SHOES, frame: 0xd8d0c0 });
  for (const z of [-7, -10.5]) it.g(it.paint(0x7a4a3a, 'cloth')).box(-12.6, 0.22, z, 2.2, 0.44, 0.7);
  for (const z of [-7, -10.5]) it.collide(-12.6, 0.22, z, 2.2, 0.44, 0.7);
  it.hangingSign('FOOTWEAR', -12, 3.2, -8.8, 2.2, Math.PI / 2, H0, DEPT);
  // Haberdashery and hosiery at the back, by the stockroom door.
  it.gondola(6.5, -10.5, 6, 0, { h: 1.5, colors: [0xe8e2d0, 0x2a2a2a, 0xd8b8a8, 0xc8302a, 0x2f5fa8] });
  it.gondola(-1, -10.5, 4.5, 0, { h: 1.5, colors: [0xe8d8c8, 0x2a2a2a, 0xd8b8a8, 0x6a6a72] });
  it.hangingSign('HABERDASHERY', 4, 3.2, -10.5, 2.4, 0, H0, DEPT);
  // Service desk beside the escalators, with the till.
  it.counter(STOCKMANS_STAFF[2].x + 1.0, 2.6, 2.6, Math.PI / 2, { till: true, front: it.paint(RED, 'paintedMetal') });
  it.hangingSign('ENQUIRIES · LAY-BY', 5.4, 3.2, 2.6, 2.2, Math.PI / 2, H0, DEPT);
  it.sign('STAFF ONLY', -9, 2.5, -14.38, 1.1, 0, { bg: '#1d2a44', fg: '#ffffff', style: 'block' });
  // Stockroom: cartons on steel shelves.
  it.gondola(4, -19.45, 18, 0, { single: true, h: 2.4, shelves: 3, colors: [0xa8865a, 0x9a7a50, 0xb8946a], frame: 0x5a6a7a, fill: 0.9 });
}

/** Homewares, manchester, toys and the electronics corner upstairs, and the tearooms looking over the street. */
function firstFloor(it: Interior): void {
  const up = new Interior(it.out, sub(it.f, 0, F1, 0), it.rng.int(1, 1e6));
  // The well round the escalators gets a glass balustrade, open where you step off the up escalator and onto the
  // down one; the top of each escalator meets the floor at the back edge of the well.
  balustrade(up, [[WELL[0], HEAD + 0.2], [WELL[0], WELL[3]], [WELL[2], WELL[3]], [WELL[2], HEAD + 0.2]]);
  // And round the stairwell, open at the top of the stair.
  rail(up, [[STAIRWELL[0], STAIRWELL[3], 0], [STAIRWELL[2], STAIRWELL[3], 0]]);
  rail(up, [[STAIRWELL[0], STAIRWELL[1], 0], [STAIRWELL[0], STAIRWELL[3], 0]]);
  // Homewares: gondolas of crockery and glassware, right.
  for (const x of [6, 9.5, 13]) up.gondola(x, -4, 7, Math.PI / 2, { h: 1.5, colors: CROCKERY });
  up.hangingSign('HOMEWARES', 9.5, 2.9, 0.4, 2.4, 0, H1 - F1, DEPT);
  // Manchester: tables stacked with towels and sheets, left.
  for (const [x, z] of [[-6.5, 3], [-10, 3], [-6.5, -1], [-10, -1]] as const) up.table(x, z, 1.8, 1, 0, TOWELS);
  up.gondola(-HX + 0.25, 3, 10, Math.PI / 2, { single: true, h: 2, colors: TOWELS });
  up.hangingSign('MANCHESTER', -8.2, 2.9, 1, 2.4, 0, H1 - F1, DEPT);
  // Toys and the electronics corner: televisions on the wall, game consoles on a stand.
  up.gondola(-6, -8.6, 6, 0, { h: 1.5, colors: TOYS });
  up.counter(STOCKMANS_STAFF[3].x - 1.0, -8.6, 2.6, -Math.PI / 2, { till: true });
  const screen = up.m.emitter(0x5a8ab0, 'always');
  const tv = up.paint(0x1c1c1e);
  for (let k = 0; k < 5; k++) {
    const z = -12.6 + k * 1.2;
    up.g(tv).box(-HX + 0.4, 1.6, z, 0.5, 0.62, 0.78);
    up.g(screen).box(-HX + 0.66, 1.6, z, 0.01, 0.48, 0.62, 0, false);
  }
  up.collide(-HX + 0.4, 1.3, -10.2, 0.6, 2.6, 6.2);
  up.solid(up.paint(0xe8e4dc, 'paintedMetal'), -13.2, 0.45, -5.2, 1.6, 0.9, 0.8);
  for (let k = 0; k < 3; k++) up.g(tv).box(-13.7 + k * 0.5, 0.95, -5.2, 0.36, 0.08, 0.28);
  up.sign('GAME CONSOLES · NOW IN STOCK', -13.2, 1.5, -4.78, 1.6, 0, { bg: '#1c1c1e', fg: '#e5b52b', style: 'block', aspect: 6 });
  up.hangingSign('TOYS · ELECTRONICS', -9, 2.9, -8.6, 2.8, 0, H1 - F1, DEPT);
  // The tearooms at the front, by the big arched window.
  const cloth = up.paint(0xf2e6d8, 'cloth');
  const chair = up.paint(0x6a4a3a, 'timber');
  for (const [x, z] of [[-4.5, 16.4], [4.5, 16.4], [-8.5, 14.2], [8.5, 14.6], [-12.5, 16.4], [12.5, 16.6]] as const) {
    up.g(cloth).box(x, 0.74, z, 1.0, 0.04, 1.0);
    up.g(chair).post(x, 0, z, 0.06, 0.72);
    for (const dz of [-0.75, 0.75]) up.g(chair).box(x, 0.44, z + dz, 0.42, 0.06, 0.42);
    up.collide(x, 0.4, z, 1.0, 0.8, 2.0);
  }
  up.counter(STOCKMANS_STAFF[4].x, STOCKMANS_STAFF[4].z - 1.0, 4, Math.PI, { till: true, front: up.paint(0xe8dcc0, 'timber') });
  up.g(up.glass).box(STOCKMANS_STAFF[4].x - 1.2, 1.15, STOCKMANS_STAFF[4].z - 1.0, 1.4, 0.36, 0.5);
  for (let k = 0; k < 4; k++) up.g(up.paint([0xe8c8a0, 0x8a5a3a, 0xf0e0c8, 0xc8302a][k])).box(STOCKMANS_STAFF[4].x - 1.7 + k * 0.33, 1.02, STOCKMANS_STAFF[4].z - 1.0, 0.24, 0.08, 0.24);
  up.hangingSign('STOCKMANS TEAROOMS', STOCKMANS_STAFF[4].x, 2.7, STOCKMANS_STAFF[4].z - 1.0, 2.8, 0, H1 - F1, { bg: CREAM, fg: '#6b3a2a', style: 'script', aspect: 5 });
  up.sign('DEVONSHIRE TEA $3.50', STOCKMANS_STAFF[4].x + 1.2, 1.3, STOCKMANS_STAFF[4].z - 1.32, 0.9, Math.PI, { bg: CREAM, fg: '#6b3a2a', style: 'paint', aspect: 3 });
  up.flush();
  it.out.light(...lightAt(it, 0, F1 + 3.2, 12), 0xfff2e0, 120, 18);
}

/** World position of a local point, spread for `out.light`. */
function lightAt(it: Interior, x: number, y: number, z: number): [number, number, number] {
  const p = it.world(x, y, z);
  return [p.x, p.y, p.z];
}

/** Glass balustrade on a floor along plan points [x, z] (open between the first and last). */
function balustrade(it: Interior, pts: [number, number][]): void {
  const glass = it.glass;
  const chrome = it.g(it.m.get('chrome'));
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const w = Math.max(0.05, Math.abs(bx - ax));
    const d = Math.max(0.05, Math.abs(bz - az));
    it.g(glass).box(cx, 0.52, cz, w, 0.9, d);
    chrome.box(cx, 1.0, cz, w + 0.06, 0.06, d + 0.06);
    it.collide(cx, 0.6, cz, w + 0.04, 1.2, d + 0.04);
  }
}

/** The pair of escalators: truss, balustrades with their black handrails, comb plates; the world moves the steps. */
function escalators(s: Site, it: Interior): void {
  const steel = it.paint(0xb8bcbe, 'metal');
  const skirt = it.paint(0x8a8e92, 'metal');
  const rubber = it.paint(0x18181a, 'plain');
  const clad = it.paint(0xd8d2c4, 'plaster');
  const plate = it.paint(0xa8aaac, 'metal');
  const climb = RUN - ESCALATOR_FLAT * 2;
  const z1 = FOOT - ESCALATOR_FLAT;
  const z2 = HEAD + ESCALATOR_FLAT;
  /** Tread height at a point along the run (z). */
  const tread = (z: number) => (z >= z1 ? 0 : z <= z2 ? F1 : (F1 * (z1 - z)) / climb);
  for (const [x, upward] of [[UP_X, true], [DOWN_X, false]] as const) {
    const from: [number, number, number] = upward ? [x, 0, FOOT] : [x, F1, HEAD];
    const to: [number, number, number] = upward ? [x, F1, HEAD] : [x, 0, FOOT];
    it.out.conveyor?.(it.f, from, to, 0.95, 0.65);
    // What people actually stand on: the tilted climb, and the top landing over the well.
    it.ramp(x, z1, 1.0, F1, climb, Math.PI);
    it.collide(x, F1 - 0.15, (z2 + HEAD) / 2, 1.0, 0.3, ESCALATOR_FLAT + 0.05);
    const g = it.g(steel);
    for (const side of [-1, 1]) {
      const sx = x + side * 0.58;
      // Balustrade: a stainless skirt and a solid panel along the run, the handrail on top, newel ends.
      const at = (z: number, dy: number): V3 => [sx, tread(z) + dy, z];
      const zs = [FOOT + 0.6, z1, z2, HEAD - 0.6];
      for (let k = 0; k < zs.length - 1; k++) {
        const a = zs[k];
        const b = zs[k + 1];
        it.g(skirt).slabUp(at(a, 0.02), at(b, 0.02), [sx + side * 0.06, tread(b) + 0.02, b], [sx + side * 0.06, tread(a) + 0.02, a], 0.12);
        g.slab(at(a, 0.95), at(b, 0.95), at(b, 0.1), at(a, 0.1), 0.04);
        it.g(rubber).beam(at(a, 1.0), at(b, 1.0), 0.09, 0.06);
        // Collider along each stretch so nobody steps off the side.
        const mid = (a + b) / 2;
        const len = Math.hypot(b - a, tread(b) - tread(a));
        const pitch = Math.atan2(tread(b) - tread(a), a - b);
        const frame = sub(it.f, sx, tread(mid) + 0.55, mid, Math.PI).multiply(rotX(-pitch));
        it.out.collider(frame, 0, 0, 0, 0.12, 1.1, len);
      }
      for (const z of [FOOT + 0.6, HEAD - 0.6]) it.g(rubber).tube(at(z, 0.9), at(z, 1.0), 0.06, 0.06, 8);
    }
    // Truss cladding underneath, from the floor up to the first floor.
    const bx0 = x - 0.68;
    const bx1 = x + 0.68;
    it.g(clad).slabUp([bx0, tread(z1) - 0.05, z1], [bx1, tread(z1) - 0.05, z1], [bx1, F1 - 0.4, z2], [bx0, F1 - 0.4, z2], 0.6);
    for (const bxs of [bx0, bx1]) it.g(clad).poly(bxs < x ? [[bxs, 0, z1], [bxs, F1 - 0.4, z2], [bxs, F1 - 0.4, z2 - 0.3], [bxs, 0, z1 + 0.3]] : [[bxs, 0, z1 + 0.3], [bxs, F1 - 0.4, z2 - 0.3], [bxs, F1 - 0.4, z2], [bxs, 0, z1]]);
    // Comb plates at each end.
    it.g(plate).box(x, 0.006, FOOT + 0.45, 1.1, 0.012, 0.9, 0, false);
    it.g(plate).box(x, F1 + 0.006, HEAD - 0.45, 1.1, 0.012, 0.9, 0, false);
  }
  // Under the up escalator's foot: the notice the town was proud of, and an arrow on each.
  it.sign("TIMARU'S FIRST ESCALATOR · PLEASE HOLD THE HANDRAIL", -2.6, 1.2, FOOT + 0.8, 1.6, Math.PI / 2, { bg: CREAM, fg: '#b3201e', style: 'paint', aspect: 4 });
  it.g(it.paint(0x2a2c2e, 'paintedMetal')).post(-2.6, 0, FOOT + 0.8, 0.05, 0.9);
  it.sign('UP · FIRST FLOOR', UP_X, 2.6, FOOT + 0.3, 1.1, 0, { ...BRAND, aspect: 3 });
  it.sign('DOWN · GROUND FLOOR', DOWN_X, F1 + 2.4, HEAD - 0.3, 1.1, Math.PI, { ...BRAND, aspect: 3 });
  it.sign('FIRST FLOOR · HOMEWARES · TOYS · TEAROOMS', 0, 3.4, FOOT + 1.0, 3.2, 0, { ...DEPT, aspect: 8 });
  void s;
}

const rotX = (a: number) => new THREE.Matrix4().makeRotationX(a);

/**
 * The street front: the plastered Coronation Buildings face over the brick shell, the suspended verandah with the
 * red fascia and hanging signs, the shopfront frames, the parapet with its three pediments, and the flat roof.
 */
function facade(s: Site, it: Interior, lift: number): void {
  const f = s.f;
  const g = (m: THREE.Material) => it.g(m);
  const plaster = s.mat('plaster', 0xe2d6bc);
  const trim = s.mat('plaster', 0xc4b494);
  const brick = s.mat('brick');
  const alu = s.mat('metal', 0x8e9296);
  const tile = s.mat('plain', 0x2a1e1c, { roughness: 0.25 });
  const red = s.mat('paintedMetal', RED);
  const dark = s.mat('paintedMetal', 0x2c2f33);
  const OZ = D / 2;
  const top = ROOF + 1.4;

  // The plaster face from the verandah up: the first floor's own walls are rendered (see `shell`); this is the band
  // between the verandah and the first floor, and the parapet above the roof.
  g(plaster).box(0, (H0 + F1 + 0.3) / 2, OZ + 0.06, W, F1 + 0.3 - H0, 0.12);
  g(plaster).box(0, (ROOF + top) / 2, OZ + 0.06, W, top - ROOF, 0.12);
  g(plaster).box(0, 3.35, OZ + 0.02, W, 0.7, 0.04);
  for (const x of [-W / 2 + 0.35, -9.4, -2.9, 2.9, 9.4, W / 2 - 0.35]) g(plaster).box(x, (H0 + top) / 2, OZ + 0.16, 0.6, top - H0, 0.2);
  g(trim).box(0, F1 + 0.35, OZ + 0.2, W + 0.06, 0.2, 0.16);
  g(trim).box(0, ROOF - 0.1, OZ + 0.22, W + 0.1, 0.34, 0.44);
  g(trim).box(0, top + 0.05, OZ + 0.08, W + 0.06, 0.1, 0.3);

  // The big arched opening over the middle bay: the window below the springing, the moulded arch over a filled
  // tympanum above it.
  const arch = g(trim);
  arch.arch(0, F1 + 3.3, OZ + 0.18, 2.6, 3.0, 0.2, 0, Math.PI, 12);
  g(plaster).poly([[-2.9, F1 + 3.3, OZ + 0.13], [2.9, F1 + 3.3, OZ + 0.13], [2.9, ROOF - 0.3, OZ + 0.13], [-2.9, ROOF - 0.3, OZ + 0.13]]);
  for (const x of [-2.6, 2.6]) g(trim).box(x, F1 + 1.95, OZ + 0.18, 0.3, 2.7, 0.2);
  for (const x of [-0.9, 0.9]) g(alu).box(x, F1 + 2.0, OZ - 0.13, 0.06, 2.6, 0.06);
  g(trim).box(0, F1 + 0.66, OZ + 0.2, 5.8, 0.12, 0.24);
  // End bays: oriel windows standing out on brackets, each under its own small pediment; plain windows between.
  const sash = s.mat('paintedMetal', 0xece6d6);
  for (const sx of [-1, 1]) {
    const x = sx * 12.2;
    for (const cx of [x - 1.3, x + 1.3]) g(plaster).box(cx, F1 + 1.85, OZ + 0.45, 0.16, 2.6, 0.9);
    g(trim).box(x, F1 + 0.48, OZ + 0.5, 2.8, 0.16, 1.0).box(x, F1 + 3.22, OZ + 0.5, 2.8, 0.16, 1.0);
    it.g(it.glass).box(x, F1 + 1.85, OZ + 0.86, 2.44, 2.56, 0.03);
    for (const mx of [x - 0.6, x + 0.6]) g(sash).box(mx, F1 + 1.85, OZ + 0.88, 0.06, 2.56, 0.05);
    g(sash).box(x, F1 + 2.5, OZ + 0.88, 2.44, 0.06, 0.05);
    for (const cx of [x - 0.9, x + 0.9]) g(trim).box(cx, F1 + 0.25, OZ + 0.4, 0.2, 0.4, 0.4);
    pediment(g(trim), x, top + 0.1, OZ + 0.18, 4.4, 0.9, 0.3);
    g(trim).box(sx * 6, F1 + 3.15, OZ + 0.2, 2.4, 0.18, 0.12).box(sx * 6, F1 + 0.72, OZ + 0.22, 2.3, 0.1, 0.16);
    g(sash).box(sx * 6, F1 + 1.9, OZ - 0.13, 2.1, 0.06, 0.06);
  }
  // The middle pediment with the name and the date in relief.
  g(plaster).box(0, top + 0.45, OZ + 0.06, 8.2, 0.8, 0.2);
  pediment(g(trim), 0, top + 0.85, OZ + 0.18, 8.6, 1.5, 0.3);
  // Between the middle bay's pilasters (inner faces at ±2.6), which stand proud of it.
  s.sign(f, 'CORONATION BUILDINGS', 0, top - 0.55, OZ + 0.18, 5.0, 12, { bg: '#e2d6bc', fg: '#7a6a50', style: 'paint', border: false });
  s.sign(f, '1902', 0, top + 1.25, OZ + 0.2, 1.2, 2.6, { bg: '#c4b494', fg: '#6a5a40', style: 'paint', border: false });
  // The store's own board across the middle, and its name up the open side over the lane.
  g(red).box(0, H0 + 0.6, OZ + 0.3, 13, 0.95, 0.12);
  s.sign(f, 'STOCKMANS', 0, H0 + 0.6, OZ + 0.37, 12.6, 12.6 / 0.85, BRAND);
  s.sign(f, 'STOCKMANS', W / 2 + 0.02, 6.2, 4, 10, 10 / 1.8, BRAND, Math.PI / 2);
  s.sign(f, 'FAMILY DEPARTMENT STORE', W / 2 + 0.02, 4.9, 4, 7, 14, { bg: '#f4f0e6', fg: '#b3201e', style: 'block', border: false }, Math.PI / 2);

  // Shopfront: dark tiled stallrisers, aluminium frames, recessed double doors standing open.
  for (const [cx, w] of [[-6.6, 8.4], [6.6, 8.4], [-13.6, 3.8], [13.6, 3.8]] as const) {
    g(tile).box(cx, 0.15, OZ + 0.02, w, 0.7, 0.04);
    g(alu).box(cx, 3.12, FZ, w, 0.06, 0.32).box(cx, 0.52, FZ + 0.06, w, 0.05, 0.2);
    const n = Math.max(1, Math.round(w / 2.1));
    for (let k = 0; k <= n; k++) g(alu).box(cx - w / 2 + (k * w) / n, 1.8, FZ, 0.06, 2.6, 0.12);
  }
  for (const sx of [-1, 1]) {
    g(alu).box(sx * 1.6, 1.3, FZ, 0.12, 2.6, 0.32);
    it.g(it.glass).box(sx * 1.75, 1.25, FZ - 0.35, 0.05, 2.4, 0.75);
  }
  g(alu).box(0, 2.66, FZ, 3.2, 0.12, 0.32);
  g(s.mat('metal', 0x9a9ea2)).box(0, 0.006, FZ, 3.2, 0.012, 0.3, 0, false);
  g(s.mat('cloth', 0x2a2c2e)).box(0, 0.006, FZ - 1.2, 3, 0.012, 1.6, 0, false);
  // Window displays behind the glass: dummies in the season's colours, open to the shop behind.
  const felt = it.paint(0x2a3a5a, 'cloth');
  for (const sx of [-1, 1]) it.solid(felt, sx * 6.6, 0.25, FZ - 0.85, 8.2, 0.5, 1.4);
  const win = new Interior(s.out, sub(f, 0, 0.5, 0), s.seed + 11);
  [-9.2, -7.2, -4.4, 4.4, 6.8, 9.6].forEach((x, i) => win.mannequin(x, FZ - 0.85, (i % 3) * 0.2 - 0.2, CLOTHES[(i * 5) % CLOTHES.length]));
  win.sign('NEW SEASON FASHIONS', -6.6, 1.4, FZ - 0.4, 1.8, 0, { bg: CREAM, fg: '#b3201e', style: 'script', aspect: 4 });
  win.sign('WINTER WOOLLENS NOW IN', 6.6, 1.4, FZ - 0.4, 1.8, 0, { bg: CREAM, fg: '#1d2a44', style: 'paint', aspect: 4 });
  win.flush();

  // Suspended verandah, hung on tie rods, red fascia with the name, lamps underneath.
  const vs = 3.1 + lift;
  const edge = OZ + 2.7;
  const depth = edge - OZ;
  const vz = (edge + OZ) / 2;
  g(s.mat('corrugated', 0x9aa0a4)).box(0, vs + 0.18, vz, W, 0.32, depth);
  g(s.mat('paintedMetal', 0xece8de)).box(0, vs + 0.01, vz, W - 0.1, 0.02, depth - 0.1);
  s.out.collider(f, 0, vs + 0.17, vz, W, 0.34, depth);
  g(red).box(0, vs + 0.3, edge - 0.05, W, 0.6, 0.1);
  for (const sx of [-1, 1]) g(red).box(sx * (W / 2 - 0.05), vs + 0.3, vz, 0.1, 0.6, depth);
  s.sign(f, 'STOCKMANS', 0, vs + 0.3, edge + 0.01, 5, 10, BRAND);
  for (const sx of [-1, 1]) s.sign(f, 'FASHION · HOMEWARES · TOYS', sx * 10.5, vs + 0.3, edge + 0.01, 8, 16, BRAND);
  const rod = g(dark);
  for (const x of [-14.5, -6, 6, 14.5]) rod.tube([x, vs + 0.5, edge - 0.2], [x, F1 + 1.2, OZ + 0.25], 0.025, 0.025, 6, false);
  const lamp = g(s.m.emitter(0xfff0d0, 'night'));
  for (const x of [-12, -4, 4, 12]) lamp.box(x, vs - 0.02, OZ + 1.4, 0.5, 0.04, 0.25);
  for (const x of [-9, 9]) {
    const y = vs - 0.33;
    g(red).box(x, y, OZ + 1.4, 0.08, 0.56, 2);
    for (const dz of [-0.7, 0.7]) rod.post(x, y + 0.27, OZ + 1.4 + dz, 0.02, vs - y - 0.26);
    s.signBoard(f, 'STOCKMANS', x, y, OZ + 1.4, 1.9, 1.9 / 0.5, BRAND, Math.PI / 2);
  }

  // Flat roof: membrane, parapets round the sides and back, plant, the back wall's windows.
  g(s.mat('asphalt')).box(0, ROOF + 0.02, 0, W - 0.4, 0.04, D - 0.5);
  for (const sx of [-1, 1]) g(brick).box(sx * (W / 2 - 0.12), ROOF + 0.45, 0, 0.24, 0.9, D - 0.1);
  g(brick).box(0, ROOF + 0.45, -D / 2 + 0.12, W, 0.9, 0.24);
  g(brick).box(0, (H1 + ROOF) / 2, 0, W, ROOF - H1 + 0.02, D);
  s.out.collider(f, 0, (H1 + ROOF + 0.3) / 2, 0, W, ROOF - H1 + 0.3, D);
  g(s.mat('paintedMetal', 0xb8bcb8)).box(-6, ROOF + 0.6, -10, 3, 1.2, 2);
  g(s.mat('corrugated', 0x9a9e9a)).box(8, ROOF + 1.1, -14, 4.2, 2.2, 3.4);
  for (const x of [-10, -2, 6, 13]) s.out.quad(f, x, F1 + 2, -OZ - 0.02, 1.4, 1.6, s.m.windows('house'), Math.PI);
  rod.tube([W / 2 - 0.5, -0.2, -OZ - 0.08], [W / 2 - 0.5, ROOF + 0.1, -OZ - 0.08], 0.05, 0.05, 6, false);
}

/** Triangular pediment facing +z: face on z, sloping tops running `depth` back. */
function pediment(g: Geo, cx: number, y: number, z: number, span: number, rise: number, depth: number): void {
  const l: V3 = [cx - span / 2, y, z];
  const r: V3 = [cx + span / 2, y, z];
  const t: V3 = [cx, y + rise, z];
  const back = (q: V3): V3 => [q[0], q[1], q[2] - depth];
  g.poly([l, r, t]);
  g.poly([l, t, back(t), back(l)]);
  g.poly([t, r, back(r), back(t)]);
}

/**
 * The ground the world cut level round the store: the delivery lane down the open (+x) side, in off Stafford
 * Street, and the yard at the back, with retaining walls holding up the uncut bank where it stands higher.
 */
function margins(s: Site, it: Interior): void {
  const f = s.f;
  const back = -D / 2;
  const wall = s.mat('concrete', 0xb3ad9f);
  const cap = s.mat('concrete', 0x9a958a);
  const pipe = s.mat('metal', 0x9aa0a4, { roughness: 0.6 });
  retainCut(s, it, [-W / 2 - 1, back], [W / 2 + CUT, back], [0, -1], { wall, cap, rail: pipe });
  retainCut(s, it, [W / 2, back - CUT], [W / 2, D / 2 - 1], [1, 0], { wall, cap, rail: pipe });
  const side = W / 2 + CUT;

  const yard = new Geo();
  s.drape(yard, 0, back - CUT / 2 + 0.1, W - 0.1, CUT - 0.2, 0.03);
  s.drape(yard, (W / 2 + side) / 2, (back - CUT + D / 2) / 2, CUT - 0.2, D + CUT, 0.03);
  yard.flush(s.out, s.ground('concrete', 0xa8a294), f);
  // The lane: the goods door, the no-parking boards, a skip.
  s.sign(f, 'GOODS INWARDS', W / 2 + 0.05, 2.8, -17, 2.2, 5.5, { bg: '#ffffff', fg: '#b3201e', style: 'block' }, Math.PI / 2);
  s.sign(f, 'NO PARKING · DELIVERIES ONLY', W / 2 + 0.05, 2.2, 14, 2.2, 5, { bg: '#ffffff', fg: '#b3201e', style: 'block' }, Math.PI / 2);
  const skip = s.mat('paintedMetal', 0x3c5a7a);
  const sx = W / 2 + 1.2;
  const by = s.gy(sx, -11);
  it.g(skip).box(sx, by + 0.65, -11, 1.3, 1.1, 1.9);
  s.out.collider(f, sx, by + 0.65, -11, 1.3, 1.3, 1.9);
  it.g(s.m.emitter(0xfff0d0, 'night')).box(W / 2 + 0.08, 3.2, -17, 0.12, 0.12, 0.3);
}
