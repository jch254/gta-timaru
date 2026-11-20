import type { LandmarkBuilder, SignOptions } from '../../../core/types';
import { GOODS, Interior, type Mat } from '../interior';
import { Batch, Geo, Site, sub, verandah } from '../rural/kit';

/**
 * Timaru's two suburban shopping centres of 1995 (docs/research/11-timaru-landmarks.md, sections 4 and 5).
 * Every tenant name is invented. Local frame as everywhere: +z is the front, facing the street.
 */

const HALF_PI = Math.PI / 2;

const HEALTH = [0x7a9a3a, 0xe8dcb0, 0xc8a050, 0x5a7a2a, 0xa0522d, 0xf0e8d0, 0x3f6f3f, 0xd8b878];
const CARDS = [0xe07aa8, 0xf0d070, 0x5ab0c8, 0xe8e2d0, 0xc8302a, 0x7a3f8f, 0x3f8f4a];
const FLOWERS = [0xe0304a, 0xf0d040, 0xf4f4f0, 0xd060a0, 0xff8030, 0x8040c0, 0xf09ab0];
const BREAD = [0xc8904a, 0xb87a3a, 0xe0b878, 0x8a5a2a, 0xd8a868, 0xf0dcb0];
const SHOES = [0x3a2a1a, 0x1c1c1c, 0x6a4a2a, 0x8a6a4a, 0x5a2a1a, 0xc8b8a0];
const PRODUCE = [0x4a9a3a, 0xc83020, 0xf09020, 0xe8d040, 0x6aaa4a, 0x8a3a6a, 0xd8c890, 0x3a7a2a];
const CHILLED = [0xf2f2ee, 0x3a6ab0, 0xe8d8a0, 0xd83a2a, 0x5a9ad8, 0xf0e070, 0x2a7a4a];
const CAR_TINTS = [0xe8e6df, 0x8f959a, 0x9a1f1c, 0x1f3f7a, 0xc9b78a, 0x2d5a44, 0xd9d6cc, 0x5a3a2a, 0x2a2c30, 0x7a8a6a];

// ───────────────────────────── Shared pieces ─────────────────────────────

/** Lowest and highest ground over a rectangle of the site frame, relative to the site origin. */
function groundRange(s: Site, x0: number, z0: number, x1: number, z1: number, step = 4): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const nx = Math.max(1, Math.ceil((x1 - x0) / step));
  const nz = Math.max(1, Math.ceil((z1 - z0) / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const y = s.gy(x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return [lo, hi];
}

/** Instanced prop standing `ly` above the site origin (on a floor or a raised walk rather than the terrain). */
function propOn(s: Site, kind: string, lx: number, ly: number, lz: number, yaw = 0, scale = 1, tint?: number): void {
  s.out.instance(kind, s.wx(lx, lz), s.y + ly, s.wz(lx, lz), s.p.heading + yaw, scale, tint);
}

/**
 * Ramp from a raised walk (top at the interior's floor, `floor` above the site origin) down to the car park,
 * leaving the kerb at z = `edge` towards +z (`dir` 1) or −z, no steeper than 1 in 10. Nothing when the kerb
 * is too low to need one.
 */
function kerbRamp(I: Interior, s: Site, floor: number, mat: Mat, x: number, edge: number, width: number, dir: 1 | -1 = 1): void {
  if (s.gy(x, edge) - floor > -0.05) return;
  let run = 0.2;
  while (run < 12 && -0.1 * run > s.gy(x, edge + dir * run) - floor) run += 0.2;
  const drop = 0.1 * run;
  const zf = edge + dir * run;
  const hw = width / 2;
  I.g(mat).slabUp([x - hw, 0, edge], [x + hw, 0, edge], [x + hw, -drop, zf], [x - hw, -drop, zf], 0.4);
  I.ramp(x, zf, width, drop, run, dir === 1 ? Math.PI : 0, -drop);
}

/** Supermarket trolley, handle towards local −z. */
function trolley(g: Geo, x: number, y: number, z: number, yaw: number): void {
  g.at(x, y, z, yaw, () => {
    g.box(0, 0.62, 0.02, 0.52, 0.02, 0.8, 0, false);
    for (const sx of [-1, 1]) g.box(sx * 0.26, 0.84, 0.02, 0.015, 0.42, 0.8, 0, false);
    g.box(0, 0.84, 0.42, 0.52, 0.42, 0.015, 0, false);
    g.box(0, 0.86, -0.38, 0.52, 0.46, 0.015, 0, false);
    g.box(0, 1.08, -0.46, 0.56, 0.035, 0.035, 0, false);
    for (const sx of [-1, 1]) g.box(sx * 0.22, 0.32, -0.32, 0.03, 0.62, 0.03, 0, false);
    g.box(0, 0.1, 0.02, 0.46, 0.03, 0.72, 0, false);
  });
}

/** A nest of trolleys pushed into one another, the first at (x, z), the rest nosed in ahead of it along `yaw`. */
function trolleyNest(g: Geo, x: number, y: number, z: number, yaw: number, n: number): void {
  for (let i = 0; i < n; i++) trolley(g, x + Math.sin(yaw) * i * 0.3, y, z + Math.cos(yaw) * i * 0.3, yaw);
}

/** Trolley return bay on the car park: two rails, a little roof with its sign, a few trolleys left in it. */
function trolleyBay(s: Site, b: Batch, x: number, z: number, yaw: number, sign: Mat): void {
  const y = s.gy(x, z);
  const steel = s.mat('paintedMetal', 0x2f5d8a);
  const chrome = s.mat('chrome');
  b.at(x, y, z, yaw, () => {
    const g = b.g(steel);
    for (const sx of [-0.7, 0.7]) {
      for (const sz of [-2.4, 2.4]) g.post(sx, -0.2, sz, 0.08, 2.5);
      g.box(sx, 0.85, 0, 0.05, 0.05, 4.8);
      g.box(sx, 0.45, 0, 0.05, 0.05, 4.8);
    }
    g.box(0, 2.34, 0, 1.7, 0.08, 5.1);
  });
  b.at(x, y, z, yaw, () => trolleyNest(b.g(chrome), 0, 0, 1.6, Math.PI, 3));
  const f = s.at(x, z, yaw);
  s.out.quad(f, 0, 2.6, 2.56, 1.6, 0.4, sign, 0);
  s.out.quad(f, 0, 2.6, -2.56, 1.6, 0.4, sign, Math.PI);
  s.out.collider(f, 0, 0.6, 0, 1.6, 1.2, 5);
}

/** Raised kerbed island following the ground. */
function island(s: Site, g: Geo, cx: number, cz: number, w: number, d: number): void {
  const pt = (x: number, z: number): [number, number, number] => [x, s.gy(x, z) + 0.15, z];
  g.slabUp(pt(cx - w / 2, cz + d / 2), pt(cx + w / 2, cz + d / 2), pt(cx + w / 2, cz - d / 2), pt(cx - w / 2, cz - d / 2), 0.6);
}

interface Slot {
  x: number;
  z: number;
  yaw: number;
}

/** Bay centres of a row as `s.bays` paints it (yaw 0: noses to −z, π: noses to +z), with a nose-in car's heading. */
function slots(list: Slot[], cx: number, cz: number, n: number, yaw: number, bayW = 2.6): void {
  for (let i = 0; i < n; i++) list.push({ x: cx - (n * bayW) / 2 + (i + 0.5) * bayW, z: cz, yaw: yaw === 0 ? Math.PI : 0 });
}

function parkCars(s: Site, list: readonly Slot[], share: number): void {
  const rng = s.rng;
  for (const b of list) {
    if (!rng.chance(share)) continue;
    const kind = rng.pick(['car-parked', 'car-parked', 'car-parked', 'car-parked-wagon', 'van-parked']);
    const tint = kind === 'van-parked' ? rng.pick([0xe8e6df, 0xd9d6cc, 0x8f959a]) : rng.pick(CAR_TINTS);
    s.prop(kind, b.x + rng.range(-0.18, 0.18), b.z + rng.range(-0.2, 0.2), b.yaw + rng.range(-0.04, 0.04), 1, tint);
  }
}

/** Free-standing pylon sign on two posts, the boards stacked and readable from both sides, faces along `yaw`. */
function pylon(s: Site, b: Batch, x: number, z: number, yaw: number, boards: readonly { text: string; h: number; look: SignOptions }[], width = 4.4): void {
  const y = s.gy(x, z);
  const f = s.at(x, z, yaw);
  const total = boards.reduce((sum, q) => sum + q.h + 0.1, 0);
  const top = 2.6 + total;
  b.at(x, y, z, yaw, () => {
    const g = b.g(s.mat('paintedMetal', 0x3a3f44));
    for (const sx of [-1, 1]) g.post((sx * width) / 2 - sx * 0.2, -0.3, 0, 0.2, top + 0.5);
    g.box(0, 2.6 + total / 2, 0, width + 0.1, total + 0.1, 0.1);
  });
  let yy = top;
  for (const q of boards) {
    yy -= q.h / 2 + 0.05;
    s.signBoard(f, q.text, 0, yy, 0, width - 0.1, (width - 0.1) / q.h, q.look);
    yy -= q.h / 2 + 0.05;
  }
  s.out.collider(f, 0, top / 2, 0, width, top, 0.3);
}

// ───────────────────────────── Northside Mall ─────────────────────────────

type UnitKind = 'health' | 'bank' | 'cards' | 'florist' | 'hair' | 'bakery' | 'shoes';

interface Unit {
  name: string;
  kind: UnitKind;
  look: SignOptions;
  /** Inside faces on plan. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The shopfront is on x1 (+1) or x0 (−1). */
  front: 1 | -1;
}

/** Fittings of a concourse shop: what you see through its window. */
function fitUnit(I: Interior, u: Unit): void {
  const depth = u.x1 - u.x0;
  const span = u.z1 - u.z0;
  const zc = (u.z0 + u.z1) / 2;
  // `at(d)`: x at distance d in from the shopfront. `face`: yaw that faces the shopfront.
  const at = (d: number) => (u.front > 0 ? u.x1 - d : u.x0 + d);
  const face = u.front * HALF_PI;
  const dark = I.paint(0x2a2c2e);
  switch (u.kind) {
    case 'health':
      I.gondola(at(depth - 0.25), zc, span - 0.8, face, { single: true, h: 1.9, colors: HEALTH });
      I.gondola(at(depth / 2 + 0.6), u.z0 + 0.25, depth - 3.2, 0, { single: true, h: 1.6, colors: HEALTH });
      I.counter(at(1.4), u.z0 + 0.9, 1.8, 0, { till: true });
      I.table(at(depth / 2), zc + 0.7, 1.4, 0.8, 0, HEALTH);
      break;
    case 'bank': {
      const w = span - 1.6;
      I.counter(at(depth - 2.4), zc - 0.3, w, face, { h: 1.1, front: I.paint(0x2f4f6f, 'timber') });
      I.b.at(at(depth - 2.4), 0, zc - 0.3, face, () => I.g(I.glass).box(0, 1.6, -0.15, w, 1, 0.02));
      I.collide(at(depth - 2.4), 1.6, zc - 0.3, w, 1, 0.1, face);
      I.solid(dark, at(depth - 0.55), 0.7, u.z0 + 0.9, 0.8, 1.4, 0.8);
      I.table(at(1.8), u.z0 + 1.1, 1.2, 0.6, 0, [0xe8e2d0, 0x2f4f6f]);
      I.sign('HOME LOANS', at(depth - 0.14), 2.2, zc + 1.2, 1.6, face, { bg: '#2f4f6f', fg: '#f2ead6', style: 'block', aspect: 3 });
      break;
    }
    case 'cards':
      I.gondola(at(depth - 0.25), zc, span - 0.8, face, { single: true, h: 1.7, colors: CARDS, shelves: 5 });
      I.gondola(at(depth / 2 + 0.5), zc - 0.4, depth - 3.6, 0, { h: 1.4, colors: CARDS });
      I.counter(at(1.3), u.z0 + 0.8, 1.6, 0, { till: true });
      break;
    case 'florist': {
      for (let k = 0; k < 3; k++) I.table(at(2 + k * 2), zc, 1.4, 0.8, HALF_PI, FLOWERS);
      const bucket = I.paint(0x3a5a4a, 'paintedMetal');
      for (let k = 0; k < 6; k++) {
        const x = at(depth - 0.4);
        const z = u.z0 + 0.6 + (k * (span - 1.2)) / 5;
        I.g(bucket).box(x, 0.2, z, 0.34, 0.4, 0.34);
        I.g(I.paint(FLOWERS[k % FLOWERS.length], 'cloth')).box(x, 0.62, z, 0.46, 0.44, 0.46);
        I.g(I.paint(0x3a7a2a, 'cloth')).box(x, 0.45, z, 0.4, 0.1, 0.4);
      }
      I.collide(at(depth - 0.4), 0.45, zc, 0.5, 0.9, span - 0.8);
      I.counter(at(1.3), u.z0 + 0.8, 1.6, 0, { till: true });
      break;
    }
    case 'hair': {
      const chair = I.paint(0x7a1f3a);
      const chrome = I.m.get('chrome');
      I.g(chrome).box(at(depth - 0.14), 1.45, zc - 0.4, 0.02, 1.1, span - 2.2);
      I.g(I.paint(0xe8e2d8)).box(at(depth - 0.35), 0.85, zc - 0.4, 0.4, 0.06, span - 2.2);
      for (let k = 0; k < 3; k++) {
        const z = u.z0 + 1 + k * 1.5;
        const x = at(depth - 1.3);
        I.b.at(x, 0, z, face + Math.PI, () => {
          I.g(chrome).post(0, 0, 0, 0.08, 0.42);
          I.g(chrome).box(0, 0.02, 0, 0.5, 0.04, 0.5);
          I.g(chair).box(0, 0.5, 0, 0.55, 0.16, 0.55);
          I.g(chair).box(0, 0.85, -0.25, 0.55, 0.6, 0.1);
        });
        I.collide(x, 0.55, z, 0.6, 1.1, 0.6);
      }
      I.solid(I.paint(0xf2f2ee), at(2.4), 0.45, u.z1 - 0.35, 0.9, 0.9, 0.5);
      I.counter(at(1.2), u.z0 + 0.7, 1.4, 0, { till: true, front: I.paint(0x1c1c22) });
      break;
    }
    case 'bakery': {
      const w = span - 2;
      const x = at(2.8);
      I.counter(x, u.z0 + 0.25 + w / 2, w, face, { h: 0.9, front: I.paint(0xd8c8a8) });
      I.b.at(x, 0, u.z0 + 0.25 + w / 2, face, () => {
        I.g(I.glass).box(0, 1.15, 0.05, w - 0.1, 0.5, 0.55);
        for (let k = 0; k < Math.floor((w - 0.4) / 0.32); k++) I.g(I.paint(BREAD[k % BREAD.length])).box(-w / 2 + 0.3 + k * 0.32, 1.0, 0.05, 0.24, 0.12, 0.3);
      });
      I.gondola(at(depth - 0.25), zc, span - 0.8, face, { single: true, h: 1.8, colors: BREAD, shelves: 4 });
      break;
    }
    case 'shoes': {
      const w = span - 2;
      I.counter(at(2.4), u.z0 + 0.25 + w / 2, w, face, { till: true, front: I.paint(0x5a3a2a, 'timber') });
      I.gondola(at(depth - 0.25), zc, span - 0.8, face, { single: true, h: 1.8, colors: SHOES, shelves: 4 });
      I.solid(I.paint(0x6a7a6a, 'paintedMetal'), at(depth - 1.2), 1.05, u.z1 - 0.5, 0.5, 0.3, 0.4);
      I.solid(I.paint(0x8a6a4a, 'timber'), at(depth - 1.2), 0.45, u.z1 - 0.5, 1.4, 0.9, 0.6);
      break;
    }
  }
}

/**
 * Northside Mall, Evans Street, Waimataitai: the look-alike of Northtown Mall. A long, low 1970s mall of brick
 * and precast concrete with a deep fascia, a walk-in concourse of seven small shops, the supermarket anchor at
 * the south end, outward-facing shops at the north end and a marked car park of 60 bays down to Evans Street.
 *
 * The ground falls about 9 m from Evans Street to the back street, so the floor is set a kerb above the car
 * park at the entrance and the building stands on a plinth that is a full storey high at the back, where the
 * tavern and the supermarket's dock open onto the service yard. Footprint 90 × 68.
 */
export const northsideMall: LandmarkBuilder = function* (p, out) {
  const s = new Site(p, out);
  const rng = s.rng;
  const full = out.lod === 0;
  // Front and back wall lines, wall thickness, the concourse's centre line.
  const ZF = -4;
  const ZB = -30;
  const T = 0.25;
  const H = T / 2;
  const CX = -3;

  // Floor a kerb above the car park at the entrance, and clear of the ground everywhere under the building and walk.
  const [lowAll] = groundRange(s, -44, -34, 44, 2);
  const [, highUnder] = groundRange(s, -44, ZB - H, 44, 2);
  const F = Math.max(s.gy(CX, 2) + 0.15, highUnder + 0.1);
  const I = new Interior(out, sub(s.f, 0, F, 0), s.seed);
  const foot = lowAll - F - 0.6;

  const brick = s.mat('brick');
  const pier = s.mat('brick', 0x8a4e3a);
  const precast = s.mat('concrete', 0xddd5c2);
  const plinthMat = s.mat('concrete', 0xb3ac9e);
  const roofMat = s.mat('concrete', 0x77736c);
  const paving = s.mat('footpath');
  const dark = s.mat('paintedMetal', 0x34383c);
  const doorGlass = s.mat('glass', 0x2a3a42);
  const shopWin = s.m.windows('shop');
  const alu = I.paint(0xb8bcbe, 'metal');
  const tile = I.paint(0x4a4440);
  const corridorWall = I.paint(0xe9e1cd, 'plaster');
  const unitWall = I.paint(0xf0ece2, 'plaster');
  const smWall = I.paint(0xf2f0e8, 'plaster');
  const terrazzo = I.paint(0xd2c8b2);
  const ceiling = I.paint(0xf2f0ea);

  // ── Plinth and the front walk ──
  out.box(I.f, 0, foot / 2, -17, 88, -foot, 26.25, plinthMat);
  out.collider(I.f, 0, foot / 2, -17, 88, -foot, 26.25);
  const [walkLow] = groundRange(s, -44, ZF + H, 44, 2, 2);
  const wb = walkLow - F - 0.4;
  out.box(I.f, 0, wb / 2, (ZF + H + 2) / 2, 88, -wb, 2 - (ZF + H), paving);
  out.collider(I.f, 0, wb / 2, (ZF + H + 2) / 2, 88, -wb, 2 - (ZF + H));
  kerbRamp(I, s, F, paving, CX, 2, 3);
  kerbRamp(I, s, F, paving, 39, 2, 3);

  // ── North wing: four shops facing the car park, not walk-in ──
  const ax0 = -44;
  const ax1 = -14 - H;
  out.box(I.f, (ax0 + ax1) / 2, 2.1, -17, ax1 - ax0, 4.2, 26.25, brick);
  out.collider(I.f, (ax0 + ax1) / 2, 2.1, -17, ax1 - ax0, 4.2, 26.25);
  const wing: [string, SignOptions][] = [
    ['NIGHT OWL VIDEO', { bg: '#1d2a44', fg: '#f0c33a', style: 'block' }],
    ['THE HUNGRY WEKA', { bg: '#8a1f1f', fg: '#f6edd0', style: 'paint' }],
    ['SUDS LAUNDRETTE', { bg: '#d8e6e2', fg: '#1f4a4a', style: 'paint' }],
    ['LONG HAUL TRAVEL', { bg: '#f6f2e6', fg: '#1f3f7a', style: 'block' }],
  ];
  const uw = (ax1 - ax0) / wing.length;
  const zFace = ZF + H + 0.01;
  wing.forEach(([name, look], i) => {
    const x0 = ax0 + i * uw;
    const winC = x0 + 0.5 + (uw - 2.4) / 2;
    const winW = uw - 2.4;
    const doorC = x0 + uw - 1.1;
    I.g(pier).box(x0 + 0.175, 1.65, zFace + 0.04, 0.35, 3.3, 0.08);
    I.g(tile).box(winC, 0.25, zFace + 0.03, winW, 0.5, 0.06);
    out.quad(I.f, winC, 1.58, zFace, winW, 2.1, shopWin);
    I.g(alu).box(winC, 2.67, zFace + 0.03, winW + 0.1, 0.08, 0.06).box(doorC, 2.3, zFace + 0.03, 1.3, 0.08, 0.06);
    out.quad(I.f, doorC, 1.1, zFace, 1.2, 2.2, doorGlass);
    s.sign(I.f, name, x0 + uw / 2, 4.0, -3.264, 5.6, 7, look);
  });
  I.g(pier).box(ax1 - 0.175, 1.65, zFace + 0.04, 0.35, 3.3, 0.08);
  verandah(I.b, s.mat('corrugated', 0xc8c4b8), dark, ax0 + 0.1, ax1, ZF + H, 3.4, 3.1, 2.9, 4);
  for (let k = 0; k < 4; k++) out.quad(I.f, ax0 + uw * (k + 0.5), 2.6, ZB - H - 0.01, 2.4, 0.9, s.m.windows('office'), Math.PI);
  yield;

  // ── Concourse block: outer walls, corridor walls and shop partitions ──
  const lz = [-4, -10.5, -17, -23.5, -30];
  I.wall(-14 - H, ZF, 8, ZF, {
    h: 4.2,
    inner: unitWall,
    outer: brick,
    holes: [
      { along: CX + 14 + H, width: 5, sill: 0, height: 2.6 },
      { along: -10.5 + 14 + H, width: 4.5, sill: 0.6, height: 1.9, glass: I.glass },
      { along: 4 + 14 + H, width: 5, sill: 0.6, height: 1.9, glass: I.glass },
    ],
  });
  I.wall(8, ZB, -14 - H, ZB, { h: 4.2, inner: unitWall, outer: brick });
  I.wall(-14, ZB + H, -14, ZF - H, { h: 3.4, inner: unitWall });

  const units: Unit[] = [];
  const leftNames: [string, UnitKind, SignOptions][] = [
    ['NORTHSIDE NUTRITION', 'health', { bg: '#2f5d3a', fg: '#f2ead6', style: 'paint' }],
    ['PLAINS SAVINGS BANK', 'bank', { bg: '#1d3f6a', fg: '#f2ead6', style: 'block' }],
    ['THE CARD CUPBOARD', 'cards', { bg: '#f2d9d9', fg: '#6a1f3a', style: 'script' }],
    ['THE POSY PLACE', 'florist', { bg: '#d8e6e2', fg: '#1f4a4a', style: 'script' }],
  ];
  // Corridor's west wall, traced from the entrance inwards: the shopfronts of the four units on that side.
  const leftHoles: { along: number; width: number; sill: number; height: number; glass?: Mat }[] = [];
  leftNames.forEach(([name, kind, look], i) => {
    const zHi = lz[i] - H;
    const zLo = lz[i + 1] + H;
    const u0 = ZF - H - zHi;
    const u1 = ZF - H - zLo;
    leftHoles.push({ along: u0 + 0.4 + 0.85, width: 1.7, sill: 0, height: 2.3 });
    leftHoles.push({ along: (u0 + 2.4 + u1 - 0.4) / 2, width: u1 - 0.4 - (u0 + 2.4), sill: 0.35, height: 2.25, glass: I.glass });
    units.push({ name, kind, look, x0: -14 + H, x1: -6 - H, z0: zLo, z1: zHi, front: 1 });
  });
  I.wall(-6, ZF - H, -6, ZB + H, { h: 3.4, inner: unitWall, outer: corridorWall, holes: leftHoles });

  // East side: hair studio, the lobby into the supermarket, bakery, shoe repairs.
  const rightNames: ([string, UnitKind, SignOptions] | null)[] = [
    ['NORTHSIDE HAIR STUDIO', 'hair', { bg: '#1c1c22', fg: '#e07aa8', style: 'block' }],
    null,
    ['RISE & SHINE BAKERY', 'bakery', { bg: '#6b3a2a', fg: '#f2e2b8', style: 'script' }],
    ['SOLE MAN SHOE REPAIRS', 'shoes', { bg: '#f2ead6', fg: '#1d2a44', style: 'block' }],
  ];
  const rightHoles: { along: number; width: number; sill: number; height: number; glass?: Mat }[] = [];
  rightNames.forEach((entry, i) => {
    const zHi = lz[i] - H;
    const zLo = lz[i + 1] + H;
    const u0 = zLo - (ZB + H);
    const u1 = zHi - (ZB + H);
    if (!entry) {
      rightHoles.push({ along: (u0 + u1) / 2, width: u1 - u0, sill: 0, height: 3.4 });
      return;
    }
    const [name, kind, look] = entry;
    rightHoles.push({ along: u1 - 0.4 - 0.85, width: 1.7, sill: 0, height: 2.3 });
    rightHoles.push({ along: (u0 + 0.4 + u1 - 2.4) / 2, width: u1 - 2.4 - (u0 + 0.4), sill: 0.35, height: 2.25, glass: I.glass });
    units.push({ name, kind, look, x0: H, x1: 8 - H, z0: zLo, z1: zHi, front: -1 });
  });
  I.wall(0, ZB + H, 0, ZF - H, { h: 3.4, inner: unitWall, outer: corridorWall, holes: rightHoles });
  for (const z of lz.slice(1, 4)) {
    I.wall(-14 + H, z, -6 - H, z, { h: 3.4, inner: unitWall });
    I.wall(H, z, 8 - H, z, { h: 3.4, inner: unitWall });
  }

  // Ceiling, roof, fascia with the name, entrance canopy.
  I.slab(-3, 3.4, -17, 21.75, 25.75, ceiling);
  out.box(I.f, -3.0625, 3.925, -17, 22.125, 0.55, 26.25, roofMat);
  I.g(precast).box(-18, 4.0, -3.575, 52, 1.4, 0.6);
  s.sign(I.f, 'NORTHSIDE MALL', CX, 4.0, -3.264, 13, 13, { bg: '#ddd5c2', fg: '#7a2a1f', style: 'block', border: false });
  I.g(precast).box(CX, 3.125, -0.64, 11, 0.35, 5.27);
  for (const x of [CX - 5, CX + 5]) {
    out.cylinder(I.f, x, 1.475, 1.6, 0.14, 0.14, 2.95, dark, 8);
    out.collider(I.f, x, 1.475, 1.6, 0.3, 2.95, 0.3);
  }
  const downlight = I.m.emitter(0xfff2d8, 'night');
  for (const x of [-2.5, 2.5]) for (const z of [-2, 0.6]) I.g(downlight).box(CX + x, 2.94, z, 0.9, 0.02, 0.3);
  s.sign(I.f, 'NORTHSIDE MALL', CX, 3.125, 2.0, 4.6, 14, { bg: '#7a2a1f', fg: '#f2ead6', style: 'block', border: false });
  I.slidingDoors(CX, ZF, 5, 2.6);
  I.light(CX, 2.7, -0.5, 0xfff0d8, 150, 20);
  yield;

  // ── Concourse floor, lights, signs and shop fittings ──
  I.g(terrazzo).box(CX, 0.006, -17, 5.75, 0.012, 25.75, 0, false);
  I.g(terrazzo).box(4, 0.006, -13.75, 7.75, 0.012, 6.25, 0, false);
  I.g(I.paint(0x3a3430)).box(CX, 0.016, -5.3, 5, 0.008, 2.2, 0, false);
  I.fluoros(CX - 2, -29.5, CX + 2, -4.5, 3.4, 4, 2.8);
  I.fluoros(1, -16.5, 7, -11, 3.4, 3, 2.8);
  for (const u of units) {
    const zc = (u.z0 + u.z1) / 2;
    const w = Math.min(5, u.z1 - u.z0 - 0.8);
    const x = u.front > 0 ? -6 + H + 0.01 : -H - 0.01;
    I.sign(u.name, x, 3.0, zc, w, u.front * HALF_PI, { ...u.look, aspect: w / 0.6 });
    I.g(I.paint(u.kind === 'bank' ? 0x5a4a3a : u.kind === 'hair' ? 0xe8e2d8 : 0xc8c0b0)).box((u.x0 + u.x1) / 2, 0.006, zc, u.x1 - u.x0, 0.012, u.z1 - u.z0, 0, false);
    if (full) {
      I.fluoros(u.x0 + 0.5, u.z0 + 0.5, u.x1 - 0.5, u.z1 - 0.5, 3.4, 3.2, 3);
      fitUnit(I, u);
    }
  }
  I.hangingSign('MIGHTY TROLLEY FOODS', CX, 2.85, -9, 3.2, 0, 3.4, { bg: '#c8202a', fg: '#ffe23a', style: 'block' });
  I.sign('MIGHTY TROLLEY FOODS', 8 - H - 0.01, 3.0, -13.75, 4, -HALF_PI, { bg: '#c8202a', fg: '#ffe23a', style: 'block', aspect: 8 });
  out.quad(I.f, CX, 1.05, ZB + H + 0.01, 1.8, 2.1, I.paint(0x5a6a5a, 'paintedMetal'));
  I.sign('FIRE EXIT', CX, 2.4, ZB + H + 0.01, 1.2, 0, { bg: '#1f7a3a', fg: '#ffffff', style: 'block', aspect: 4 });
  I.sign('MALL HOURS\nMON-FRI 9-5.30\nTHURS 9-9  SAT 9-1', CX + 2.2, 1.7, ZB + H + 0.01, 1.2, 0, { bg: '#f2ead6', fg: '#1d2a44', style: 'paint', aspect: 1.4 });
  if (full) {
    // Benches and the bin stand in front of shop windows, clear of the doors.
    propOn(s, 'bench', CX - 2.3, F, -21.3, HALF_PI);
    propOn(s, 'bench', CX + 2.3, F, -27.8, -HALF_PI);
    propOn(s, 'bin', CX + 2.4, F, -21);
    I.solid(s.mat('concrete', 0xc8bca4), CX, 0.3, -22.5, 1.4, 0.6, 1.4);
    propOn(s, 'bush', CX, F + 0.6, -22.5, 0, 0.8);
    trolleyNest(I.g(I.m.get('chrome')), 1.2, 0, -11.2, HALF_PI, 5);
  }
  yield;

  // ── Supermarket: walls, roof and fascia ──
  I.wall(8, ZF, 44, ZF, {
    h: 5.6,
    inner: smWall,
    outer: precast,
    holes: [
      { along: 7, width: 10, sill: 0.5, height: 2.4, glass: I.glass },
      { along: 19, width: 12, sill: 0.5, height: 2.4, glass: I.glass },
      { along: 31, width: 4, sill: 0, height: 2.6 },
    ],
  });
  I.wall(44 - H, ZF - H, 44 - H, ZB + H, { h: 5.6, inner: smWall, outer: precast });
  I.wall(44, ZB, 8, ZB, { h: 5.6, inner: smWall, outer: precast });
  I.wall(8, ZB + H, 8, ZF - H, { h: 5.6, inner: smWall, outer: unitWall, holes: [{ along: -13.75 - (ZB + H), width: 4, sill: 0, height: 2.6 }] });
  I.slab(26, 4.6, -17, 36 - T, 26 - T, ceiling);
  out.box(I.f, 26, 5.225, -17, 36, 0.75, 26.25, roofMat);
  I.g(s.mat('paintedMetal', 0x9aa0a4)).box(30, 6.1, -21, 4, 1, 2.5).box(18, 6.0, -24, 2.4, 0.8, 2);
  I.g(precast).box(26, 5.3, -3.575, 36, 2.2, 0.6);
  s.sign(I.f, 'MIGHTY TROLLEY FOODS', 24.5, 5.3, -3.264, 24, 15, { bg: '#c8202a', fg: '#ffe23a', style: 'block' });
  s.sign(I.f, 'OPEN 7 DAYS', 40.5, 5.3, -3.264, 5.4, 4.5, { bg: '#ffe23a', fg: '#c8202a', style: 'block' });
  I.g(precast).box(39, 3.125, -0.64, 7, 0.35, 5.27);
  for (const x of [36, 42]) {
    out.cylinder(I.f, x, 1.475, 1.6, 0.14, 0.14, 2.95, dark, 8);
    out.collider(I.f, x, 1.475, 1.6, 0.3, 2.95, 0.3);
  }
  I.slidingDoors(39, ZF, 4, 2.6);
  for (const [x, text] of [[13, 'SPECIALS'], [28, 'LOW PRICES EVERY DAY']] as const) {
    I.sign(text, x, 2.2, ZF + 0.03, 3.2, 0, { bg: '#ffe23a', fg: '#c8202a', style: 'block', aspect: 3.2 });
  }
  I.light(26, 4.2, -10, 0xf4f6ff, 160, 22);
  yield;

  // ── Supermarket floor: checkouts at the front, aisles, chillers on the back wall, produce by the door ──
  I.g(I.paint(0xdcd8c8)).box(26, 0.006, -17, 36 - T, 0.012, 26 - T, 0, false);
  I.fluoros(9, -29.5, 43.5, -4.5, 4.6, 5, 4);
  if (full) {
    const red = I.paint(0xc8202a);
    const belt = I.paint(0x2a2a2a);
    const pole = I.paint(0xb8bcbe, 'metal');
    const lamp = I.m.emitter(0xff5a3a, 'always');
    for (let k = 0; k < 5; k++) {
      const x = 13 + k * 4;
      I.counter(x, -8.6, 2.8, HALF_PI, { till: true, d: 0.8, h: 0.9, front: red, top: belt });
      I.g(pole).post(x - 0.3, 0, -7.1, 0.05, 2.2);
      I.g(lamp).box(x - 0.3, 2.35, -7.1, 0.34, 0.3, 0.08);
    }
    I.counter(33, -7.6, 3, 0, { front: red, top: I.paint(0xd8d0bc) });
    for (let k = 0; k < 5; k++) I.gondola(14 + k * 5, -21.6, 10, HALF_PI, { h: 1.8, shelves: 4, fill: 0.8 });
    I.gondola(26, -29.4, 30, 0, { single: true, h: 2, shelves: 4, colors: CHILLED, frame: 0xe8eef2, fill: 0.75 });
    I.gondola(8.4, -23, 10, HALF_PI, { single: true, h: 1.8, shelves: 4, colors: GOODS });
    for (let k = 0; k < 3; k++) I.table(40.5, -14 - k * 3.4, 1.8, 1, HALF_PI, PRODUCE);
    trolleyNest(I.g(I.m.get('chrome')), 42.7, 0, -4.9, Math.PI, 6);
    const look: SignOptions = { bg: '#c8202a', fg: '#ffffff', style: 'block' };
    I.hangingSign('GROCERY', 16.5, 3.6, -17.4, 2.6, 0, 4.6, look);
    I.hangingSign('HOUSEHOLD', 26.5, 3.6, -17.4, 2.6, 0, 4.6, look);
    I.hangingSign('FRESH PRODUCE', 40.5, 3.6, -17.4, 2.8, HALF_PI, 4.6, { bg: '#2f7a3a', fg: '#ffffff', style: 'block' });
  }
  yield;

  // ── The back: the plinth is a storey high over the service yard; the tavern and the dock open onto it ──
  const zb = ZB - H;
  const tar = new Geo();
  s.drape(tar, 0, (zb - 34) / 2, 88, 34 + zb, 0.05);
  const [tavLo, tavHi] = groundRange(s, -42, zb - 1, -22, zb, 2);
  const tavern = { bg: '#1f3a2a', fg: '#f0d070', style: 'paint' as const };
  if (F - tavHi >= 3.6) {
    const g0 = tavHi - F;
    const base = tavLo - F - 0.3;
    I.g(pier).box(-32, (base - 0.3) / 2, zb - 0.075, 20, -0.3 - base, 0.15);
    for (const x of [-39, -35.5, -28.5, -25]) out.quad(I.f, x, g0 + 1.5, zb - 0.16, 2.6, 1.4, shopWin, Math.PI);
    out.quad(I.f, -32, g0 + 1.1, zb - 0.16, 1.6, 2.2, doorGlass, Math.PI);
    I.g(dark).box(-32, g0 + 2.4, zb - 0.9, 3, 0.15, 1.5);
    s.sign(I.f, 'NORTHSIDE TAVERN', -32, g0 + 3.0, zb - 0.165, 7, 7, tavern, Math.PI);
    s.sign(I.f, 'BOTTLE STORE', -25, g0 + 2.6, zb - 0.165, 3, 6, tavern, Math.PI);
  } else {
    out.quad(I.f, -32, 1.1, zb - 0.01, 1.6, 2.2, doorGlass, Math.PI);
    s.sign(I.f, 'NORTHSIDE TAVERN', -32, 2.9, zb - 0.01, 7, 7, tavern, Math.PI);
  }
  const [dockLo, dockHi] = groundRange(s, 24, zb - 2.2, 36, zb, 2);
  const roller = s.mat('paintedMetal', 0x8f959a);
  if (F - dockHi >= 3.8) {
    const top = dockHi - F + 1.15;
    const base = dockLo - F - 0.3;
    out.box(I.f, 30, (top + base) / 2, zb - 1.05, 12, top - base, 2.1, s.mat('concrete'));
    out.collider(I.f, 30, (top + base) / 2, zb - 1.05, 12, top - base, 2.1);
    for (const x of [27, 33]) out.quad(I.f, x, top + 1.3, zb - 0.01, 3.6, 2.6, roller, Math.PI);
  } else {
    for (const x of [27, 33]) out.quad(I.f, x, 1.4, zb - 0.01, 3.6, 2.8, roller, Math.PI);
  }
  s.prop('skip-bin', -8, -32.2, HALF_PI, 1, 0x2f5d3a);
  s.prop('skip-bin', 14, -32.2, HALF_PI, 1, 0xc9a23a);
  for (const [x, tint] of [[-19, 0x2b4a6b], [-18, 0xb5261e], [40, 0x8a8d90]] as const) s.prop('drum', x, -32.6, 0, 1, tint);
  s.prop('pallet', 19, -32.4, 0.2);
  s.prop('pallet', 41, -32.3, 1.4);
  yield;

  // ── Car park: 60 marked bays between the mall and Evans Street, the apron at the footpath ──
  s.drape(tar, 0, 16.3, 88, 28.6, 0.05);
  s.drape(tar, 8, 32.3, 10, 3.4, 0.05);
  tar.flush(out, s.ground('asphalt'), s.f);
  const crossing = new Geo();
  s.drape(crossing, 8, 33.1, 10, 1.8, 0.08);
  crossing.flush(out, s.ground('concrete', 0xc8c2b4, -3), s.f);
  const paint = new Geo();
  const bays: Slot[] = [];
  s.bays(paint, -24, 4.6, 8, 0);
  s.bays(paint, 20, 4.6, 8, 0);
  s.bays(paint, 0, 16.3, 22, Math.PI);
  s.bays(paint, 0, 21.5, 22, 0);
  slots(bays, -24, 4.6, 8, 0);
  slots(bays, 20, 4.6, 8, 0);
  slots(bays, 0, 16.3, 22, Math.PI);
  slots(bays, 0, 21.5, 22, 0);
  for (let z = 2.6; z < 13; z += 1) s.drape(paint, CX, z, 4, 0.5, 0.1);
  s.line(paint, -44, 30.6, 3, 30.6, 0.2);
  s.line(paint, 13, 30.6, 44, 30.6, 0.2);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), s.f);

  const sb = s.batch();
  const kerb = new Geo();
  for (const x of [-30.1, 30.1]) island(s, kerb, x, 18.9, 2.8, 10.2);
  kerb.flush(out, s.ground('concrete', 0xc8c2b4, -3), s.f);
  for (const x of [-30.1, 30.1]) {
    s.prop('lamp', x, 14.6, HALF_PI);
    s.prop('lamp', x, 23.2, HALF_PI);
    s.prop('tree-cabbage', x, 18.9, x, 0.9);
  }
  const trolleys = s.m.sign('TROLLEYS', { bg: '#2f5d8a', fg: '#ffffff', style: 'block', aspect: 4 });
  trolleyBay(s, sb, -34.5, 18.9, 0, trolleys);
  trolleyBay(s, sb, 34.5, 18.9, 0, trolleys);
  pylon(s, sb, 16, 32.3, HALF_PI, [
    { text: 'NORTHSIDE MALL', h: 0.9, look: { bg: '#7a2a1f', fg: '#f2ead6', style: 'block' } },
    { text: 'MIGHTY TROLLEY FOODS', h: 0.8, look: { bg: '#c8202a', fg: '#ffe23a', style: 'block' } },
    { text: 'BANK  BAKERY  HAIR  VIDEO', h: 0.45, look: { bg: '#f2ead6', fg: '#1d2a44', style: 'block' } },
  ], 3);
  sb.flush();
  s.prop('bus-shelter', -32, 32.7, 0);
  s.prop('lamp', -18, 31, 0);
  s.prop('lamp', 30, 31, 0);
  for (let x = -42.5; x < 2; x += 2.1) if (x < -35 || x > -29) s.prop('hedge', x, 31.8);
  for (let x = 18.5; x < 43; x += 2.1) s.prop('hedge', x, 31.8);
  for (const x of [-30, -21, 13, 25]) {
    I.solid(s.mat('concrete', 0xc8bca4), x, 0.3, 0.9, 1.6, 0.6, 1.0);
    propOn(s, 'flax', x, F + 0.6, 0.9, rng.range(0, 3), 0.7);
  }
  propOn(s, 'bench', -10.5, F, 0.9, Math.PI);
  propOn(s, 'bin', -7.2, F, 1.2);
  propOn(s, 'bin', 33.6, F, 1.2);
  propOn(s, 'phone-box', 5.5, F, 0.6, Math.PI);
  parkCars(s, bays, 0.35);
  I.flush();
};

// ───────────────────────────── Highfield Shopping Centre ─────────────────────────────

/**
 * Highfield Shopping Centre, Wai-iti Road: the 1971 supermarket and a row of eight shops under one continuous
 * verandah, with about 100 marked bays out the front and service lanes down both sides. Shopfronts are
 * glazed with the library's shop windows; nothing here is walk-in. Footprint 88 × 68.
 */
export const highfieldMall: LandmarkBuilder = function* (p, out) {
  const s = new Site(p, out);
  const rng = s.rng;
  const ZW = -6;
  const ZK = -1.5;
  const [, hi] = groundRange(s, -38, -34, 38, ZK);
  const F = hi + 0.12;
  const I = new Interior(out, sub(s.f, 0, F, 0), s.seed);
  const [lo] = groundRange(s, -44, -34, 44, ZK);
  const foot = lo - F - 0.5;

  const brick = s.mat('brick');
  const pier = s.mat('brick', 0x7a4a36);
  const block = s.mat('plaster', 0xe6dcc6);
  const fascia = s.mat('plaster', 0xf0e8d4);
  const precast = s.mat('concrete', 0xd8d0bc);
  const roofMat = s.mat('concrete', 0x77736c);
  const paving = s.mat('footpath');
  const dark = s.mat('paintedMetal', 0x34383c);
  const doorGlass = s.mat('glass', 0x2a3a42);
  const shopWin = s.m.windows('shop');
  const alu = I.paint(0xb8bcbe, 'metal');
  const tile = I.paint(0x3a4a44);

  // ── Walk along the front, level with the shop floors ──
  const [walkLow] = groundRange(s, -38, ZW, 38, ZK, 2);
  const wb = walkLow - F - 0.4;
  out.box(I.f, 0, wb / 2, (ZW + ZK) / 2, 76, -wb, ZK - ZW, paving);
  out.collider(I.f, 0, wb / 2, (ZW + ZK) / 2, 76, -wb, ZK - ZW);
  for (const x of [-15.6, 4.4, 24.5]) kerbRamp(I, s, F, paving, x, ZK, 2.6);

  // ── Supermarket (1971): painted block, a deep fascia, a roof light over the sales floor ──
  out.box(I.f, -23, (5.2 + foot) / 2, -20, 30, 5.2 - foot, 28, block);
  out.collider(I.f, -23, (5.2 + foot) / 2, -20, 30, 5.2 - foot, 28);

  I.g(precast).box(-23, 4.55, -5.7, 30, 2.1, 0.6);
  I.g(roofMat).box(-23, 5.7, -20, 20, 1, 12);
  I.g(s.mat('glass', 0x9ab0b8)).box(-23, 5.7, -13.98, 19.6, 0.7, 0.04);
  s.sign(I.f, 'HIGHFIELD FOOD MARKET', -23, 4.55, -5.39, 20, 13, { bg: '#1f4a36', fg: '#f6edd0', style: 'block' });
  for (const [x, w] of [[-32.3, 8.8], [-23.1, 8.8], [-10.6, 3.6]] as const) {
    I.g(tile).box(x, 0.25, -5.95, w, 0.5, 0.06);
    out.quad(I.f, x, 1.65, -5.93, w, 2.3, shopWin);
    I.g(alu).box(x, 2.85, -5.94, w + 0.1, 0.1, 0.06);
  }
  for (const x of [-27.7, -18.5, -12.6]) I.g(alu).box(x, 1.45, -5.94, 0.1, 2.9, 0.06);
  for (const x of [-16.55, -14.65]) out.quad(I.f, x, 1.15, -5.93, 1.8, 2.3, doorGlass);
  I.g(alu).box(-15.6, 2.35, -5.94, 4, 0.1, 0.06).box(-15.6, 1.15, -5.94, 0.08, 2.3, 0.06);
  for (const [x, text] of [[-32.3, 'SPECIALS'], [-23.1, 'FRESH MEAT DAILY']] as const) {
    s.sign(I.f, text, x, 1.9, -5.92, 3, 3, { bg: '#f0d040', fg: '#b5261e', style: 'block' });
  }
  // Loading dock on the east side, off the service lane from the car park.
  const [dLo, dHi] = groundRange(s, -40, -31, -38, -25, 2);
  const dockTop = dHi - F + 1.1;
  out.box(I.f, -39, (dockTop + dLo - F - 0.3) / 2, -28, 2, dockTop - (dLo - F - 0.3), 6, s.mat('concrete'));
  out.collider(I.f, -39, (dockTop + dLo - F - 0.3) / 2, -28, 2, dockTop - (dLo - F - 0.3), 6);
  out.quad(I.f, -38.01, dockTop + 1.4, -28, 3.4, 2.8, s.mat('paintedMetal', 0x8f959a), -HALF_PI);
  I.light(-15.6, 2.5, -4, 0xfff0d8, 140, 18);
  yield;

  // ── The shops: one brick block, a shopfront each, names on the parapet and on the verandah fascia ──
  out.box(I.f, 15, (3.9 + foot) / 2, -14, 46, 3.9 - foot, 16, brick);
  out.collider(I.f, 15, (3.9 + foot) / 2, -14, 46, 3.9 - foot, 16);
  I.g(fascia).box(15, 3.75, -5.9, 46, 1.6, 0.2);
  const shops: [string, string, SignOptions][] = [
    ['PESTLE & MORTAR PHARMACY', 'PRESCRIPTIONS', { bg: '#f4f1e6', fg: '#1f4a36', style: 'paint' }],
    ['POST SHOP', 'POSTAGE & BILL PAYMENTS', { bg: '#b5261e', fg: '#fff6e0', style: 'block' }],
    ['HIGHFIELD DAIRY', 'ICE CREAMS  MILK  PAPERS', { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' }],
    ["CRUSTY'S BAKEHOUSE", 'HOT PIES DAILY', { bg: '#6b3a2a', fg: '#f2e2b8', style: 'script' }],
    ['LUCKY STAR TAKEAWAYS', 'FISH & CHIPS  BURGERS', { bg: '#8a1f1f', fg: '#f6edd0', style: 'paint' }],
    ['REWIND VIDEO', 'NEW RELEASES $5', { bg: '#1d2a44', fg: '#f0c33a', style: 'block' }],
    ["SNIP 'N' SET", 'HAIRDRESSING', { bg: '#f2d9d9', fg: '#6a1f3a', style: 'script' }],
    ['QUARTER ACRE REALTY', 'REAL ESTATE', { bg: '#f6f2e6', fg: '#1f3f7a', style: 'block' }],
  ];
  const sw = 46 / shops.length;
  const back = s.mat('paintedMetal', 0x5a6a5a);
  const step = s.mat('concrete');
  shops.forEach(([name, tag, look], i) => {
    const x0 = -8 + i * sw;
    const xc = x0 + sw / 2;
    const winC = x0 + 0.3 + 2.05;
    I.g(pier).box(x0 + 0.15, 1.45, -5.96, 0.3, 2.9, 0.08);
    I.g(tile).box(winC, 0.25, -5.97, 4.1, 0.5, 0.06);
    out.quad(I.f, winC, 1.6, -5.99, 4.1, 2.1, shopWin);
    I.g(alu).box(xc, 2.72, -5.97, sw - 0.3, 0.1, 0.06).box(x0 + 4.45, 1.36, -5.97, 0.08, 2.72, 0.06);
    out.quad(I.f, x0 + 5.0, 1.1, -5.99, 1.0, 2.2, doorGlass);
    s.sign(I.f, name, xc, 3.75, -5.79, 5.0, 6.2, look);
    s.sign(I.f, tag, xc, 2.55, -2.335, 4.6, 13.5, { ...look, border: false });
    // Back door and step onto the service yard.
    out.quad(I.f, x0 + 1.5, 1.05, -22.01, 1, 2.1, back, Math.PI);
    out.quad(I.f, x0 + 3.8, 1.8, -22.01, 1.2, 0.8, s.m.windows('house'), Math.PI);
    const gb = s.gy(x0 + 1.5, -22.8) - F;
    if (gb < -0.2) {
      I.g(step).box(x0 + 1.5, (gb - 0.3) / 2, -22.6, 1.6, -0.3 - gb, 1.2);
      I.collide(x0 + 1.5, (gb - 0.3) / 2, -22.6, 1.6, -0.3 - gb, 1.2);
    }
  });
  I.g(pier).box(38 - 0.15, 1.45, -5.96, 0.3, 2.9, 0.08);
  verandah(I.b, s.mat('corrugated', 0xb8bcb4), dark, -38, 38, ZW, 3.6, 2.9, 2.75, 16);
  I.g(fascia).box(0, 2.55, -2.38, 76, 0.42, 0.08);
  for (const [x, text] of [[-8 + sw * 5 + 3.4, 'VIDEO'], [-8 + sw * 4 + 3.4, 'OPEN']] as const) {
    s.sign(I.f, text, x, 1.9, -5.97, 0.9, 2.2, { bg: '#10161c', fg: text === 'OPEN' ? '#ff5a4a' : '#4ad8ff', style: 'neon' });
  }
  out.box(I.f, 15, 4.05, -14, 46.1, 0.3, 16.1, roofMat);
  I.light(10, 2.5, -4, 0xfff0d8, 140, 18);
  yield;

  // ── Street furniture on the walk ──
  const shopX = (i: number) => -8 + (i + 0.5) * sw;
  propOn(s, 'postbox', shopX(1) + 1.6, F, -2.0, Math.PI);
  propOn(s, 'news-billboard', shopX(2) - 1.4, F, -3.4, 0);
  propOn(s, 'shop-crates', shopX(2) + 1.2, F, -5.5, 0);
  propOn(s, 'sandwich-board', shopX(3), F, -2.9, 0.2);
  propOn(s, 'sandwich-board', shopX(4) + 1, F, -2.9, -0.15);
  propOn(s, 'bench', shopX(0) - 0.6, F, -2.0, Math.PI);
  propOn(s, 'bench', -27, F, -2.0, Math.PI);
  propOn(s, 'bin', -20.5, F, -2.2);
  propOn(s, 'bin', shopX(5) + 2, F, -2.2);
  propOn(s, 'phone-box', 36.6, F, -3.6, -HALF_PI);
  trolleyNest(I.g(s.mat('chrome')), -11.4, 0, -5.4, HALF_PI, 5);
  yield;

  // ── Car park: 100 bays in four rows, an apron onto Wai-iti Road, service lanes down both sides ──
  const tar = new Geo();
  s.drape(tar, 0, (ZK + 32.3) / 2, 88, 32.3 - ZK, 0.05);
  s.drape(tar, 0, 33.15, 7.6, 1.7, 0.05);
  s.drape(tar, -41, (-34 + ZK) / 2, 6, ZK + 34, 0.05);
  s.drape(tar, 18, -28, 52, 12, 0.05);
  s.drape(tar, 41, (-22 + ZK) / 2, 6, ZK + 22, 0.05);
  tar.flush(out, s.ground('asphalt'), s.f);
  const crossing = new Geo();
  s.drape(crossing, 0, 33.15, 7.6, 1.7, 0.08);
  crossing.flush(out, s.ground('concrete', 0xc8c2b4, -3), s.f);
  const paint = new Geo();
  const bays: Slot[] = [];
  const rows: [number, number, number, number][] = [
    [-27.2, 1.1, 6, 0],
    [11.6, 1.1, 18, 0],
    [0, 12.8, 26, Math.PI],
    [0, 18, 26, 0],
    [-19.4, 29.7, 12, Math.PI],
    [19.4, 29.7, 12, Math.PI],
  ];
  for (const [x, z, n, yaw] of rows) {
    s.bays(paint, x, z, n, yaw);
    slots(bays, x, z, n, yaw);
  }
  s.line(paint, -44, 32.4, -3.8, 32.4, 0.2);
  s.line(paint, 3.8, 32.4, 44, 32.4, 0.2);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), s.f);

  const sb = s.batch();
  const kerb = new Geo();
  for (const x of [-35.1, 35.1]) island(s, kerb, x, 15.4, 2.6, 10.2);
  kerb.flush(out, s.ground('concrete', 0xc8c2b4, -3), s.f);
  for (const x of [-35.1, 35.1]) {
    s.prop('lamp', x, 11.2, HALF_PI);
    s.prop('tree-cabbage', x, 18.4, x, 0.85);
  }
  const trolleys = s.m.sign('TROLLEYS', { bg: '#1f4a36', fg: '#ffffff', style: 'block', aspect: 4 });
  trolleyBay(s, sb, -37.6, 15.4, 0, trolleys);
  trolleyBay(s, sb, 37.6, 15.4, 0, trolleys);
  pylon(s, sb, 7.6, 33.2, 0, [
    { text: 'HIGHFIELD SHOPPING CENTRE', h: 0.75, look: { bg: '#f6edd0', fg: '#1f4a36', style: 'block' } },
    { text: 'HIGHFIELD FOOD MARKET', h: 0.75, look: { bg: '#1f4a36', fg: '#f6edd0', style: 'block' } },
    { text: '8 SHOPS  FREE PARKING', h: 0.45, look: { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' } },
  ], 3.2);
  sb.flush();
  s.prop('bus-shelter', -22, 33.1, 0);
  for (const x of [-12, 20, -41.5]) s.prop('lamp', x, 32.6, 0);
  for (let x = -42.9; x < -4; x += 2.1) if (x < -25 || x > -19) s.prop('hedge', x, 33.3);
  for (let x = 10.4; x < 43; x += 2.1) s.prop('hedge', x, 33.3);
  s.prop('skip-bin', 24, -31.6, HALF_PI, 1, 0x2f5d3a);
  s.prop('car-parked', 8, -30.5, HALF_PI + rng.range(-0.05, 0.05), 1, rng.pick(CAR_TINTS));
  s.prop('van-parked', 13, -30.5, HALF_PI, 1, 0xe8e6df);
  for (const [x, tint] of [[30, 0x2b4a6b], [31, 0xb5261e]] as const) s.prop('drum', x, -32.8, 0, 1, tint);
  s.prop('pallet', -2, -32.5, 0.3);
  parkCars(s, bays, 0.34);
  I.flush();
};
