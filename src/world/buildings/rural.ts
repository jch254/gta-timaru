import type { LotBuilder } from '../../core/types';
import {
  type Archetype,
  type Site,
  barrel,
  bigDoor,
  box,
  cyl,
  fence,
  footing,
  glass,
  ground,
  mat,
  patches,
  prop,
  quad,
  raised,
  roof,
  run,
  seat,
  site,
  slope,
  solid,
  stretches,
  trim,
  walls,
  winRow,
} from './kit';
import { FARMS, WALL_PAINT, board } from './names';
import { stateHouse } from './statehouse';
import { type HouseCore, bayVilla, bungalow, cottage } from './villa';

/**
 * The plains between the towns: a farmhouse behind its shelter belt with the tank stand out the back,
 * the woolshed and yards, a hay barn, an implement shed. Sparse; mostly it is paddocks.
 */

const SIDES = [-1, 1] as const;

/** Post-and-wire along the road boundary with a steel gate across the track. */
function roadFence(s: Site, gateX: number, gateW = 4.2) {
  const zf = s.hd - 0.6;
  if (s.near) for (const [a, b] of stretches(-s.hw + 0.4, s.hw - 0.4, [[gateX - gateW / 2, gateX + gateW / 2]])) run(s, 'farm-fence', a, zf, b, zf, 4);
  if (!s.spare(3)) return;
  const gy = ground(s, gateX, zf);
  const steel = trim(s, 0x9a9d9f);
  for (const y of [0.4, 1.05]) box(s, gateX, gy + y, zf, gateW - 0.2, 0.05, 0.05, steel);
  slope(s, gateX - gateW / 2 + 0.1, gy + 0.4, zf, gateX + gateW / 2 - 0.1, gy + 1.05, zf, 0.05, 0.05, steel);
}

/** A row of shelter trees; they are part of the place's outline, so they are planted at any detail level. */
function shelterBelt(s: Site, ax: number, az: number, bx: number, bz: number, kind: string, spacing = 4.6) {
  const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    prop(s, kind, ax + (bx - ax) * t + s.rng.range(-0.5, 0.5), az + (bz - az) * t + s.rng.range(-0.5, 0.5), s.rng.range(0, 6), s.rng.range(0.85, 1.25));
  }
}

/** Gravel track from the gate to a point in the yard, following the ground in two lengths. */
function track(s: Site, x: number, z: number) {
  const zm = (s.hd + z) / 2;
  const gravel = mat(s, 'gravel');
  slope(s, x, ground(s, x, s.hd), s.hd, x, ground(s, x, zm), zm, 3, 0.12, gravel);
  slope(s, x, ground(s, x, zm), zm, x, ground(s, x, z), z, 3, 0.12, gravel);
}

/** Corrugated water tank; on a timber stand when `stand` > 0. Solid. */
function waterTank(s: Site, x: number, z: number, stand: number) {
  const t = raised(s, ground(s, x, z));
  const timber = mat(t, 'timber', 0x6f5a44);
  if (stand > 0) {
    for (const ex of SIDES) for (const ez of SIDES) box(t, x + ex * 1.05, -0.4, z + ez * 1.05, 0.16, stand + 0.4, 0.16, timber);
    box(t, x, stand, z, 2.7, 0.16, 2.7, timber);
  }
  const y = stand > 0 ? stand + 0.16 : -0.3;
  cyl(t, x, y, z, 1.2, stand > 0 ? 2.2 : 2.6, mat(t, 'corrugated', 0xa9a79d), 14);
  if (t.spare()) cyl(t, x, y + (stand > 0 ? 2.2 : 2.6), z, 1.2, 0.3, mat(t, 'corrugated', 0x8f959a), 14, 0.2);
  const top = y + 2.6;
  t.out.collider(t.f, x, top / 2, z, 2.5, top, 2.5);
}

// ───────────────────────────── Farmhouse ─────────────────────────────

const farmhouse: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const core: HouseCore = rng.pick([cottage, cottage, bungalow, bayVilla, stateHouse]);
  const setback = rng.range(11, 15);
  const side = rng.pick(SIDES);
  const p = core(s, { ox: side * rng.range(1.5, 4), front: s.hd - setback, maxW: 12.5, maxD: lot.depth - setback - 9 });
  const driveX = -side * (s.hw - 6);

  // Shelter belt across the back and down the weather side; track to a car shed behind the house.
  const belt = rng.pick(['tree-pine', 'tree-pine', 'tree-poplar']);
  shelterBelt(s, -s.hw + 2, -s.hd + 2, s.hw - 2, -s.hd + 2, belt);
  shelterBelt(s, side * (s.hw - 2), -s.hd + 6.5, side * (s.hw - 2), s.hd - 8, belt);
  const shedZ = Math.max(-s.hd + 8.5, p.back - 4);
  track(s, driveX, shedZ + 3);
  const g = raised(s, ground(s, driveX, shedZ));
  const skin = mat(g, 'corrugated', rng.pick([0x9aa0a4, 0x8b3027, 0xb9b4a8]));
  walls(g, driveX, shedZ - 0.4, 6.4, 6, 2.6, skin);
  solid(g, driveX, shedZ - 0.4, 6.4, 6, 2.6);
  slope(g, driveX, 3.3, shedZ + 2.8, driveX, 2.65, shedZ - 3.6, 6.8, 0.08, mat(g, 'corrugated', 0xa9a79d));
  bigDoor(g, driveX - 1.5, -0.3, shedZ + 2.62, 2.6, 2.6, 0x55606a, rng.chance(0.5));
  waterTank(s, side > 0 ? p.x1 + 2.4 : p.x0 - 2.4, p.back + 1.6, 2.6);

  // House garden: a path from the track, a fence round the front lawn, the name on the gate.
  if (s.spare()) slope(s, driveX + side * 1.5, ground(s, driveX, p.doorZ + 2), p.doorZ + 2, p.doorX, p.floor, p.doorZ, 1, 0.1, mat(s, 'concrete', 0xc4c0b4));
  const zl = p.front + 6;
  if (s.near && zl < s.hd - 2) {
    const kind = s.fx.pick(['picket-fence', 'hedge', 'hedge']);
    const unit = kind === 'hedge' ? 2 : 2.4;
    const a = Math.min(p.x0 - 3, p.x1 + 3);
    const b = Math.max(p.x0 - 3, p.x1 + 3);
    for (const [u, v] of stretches(a, b, [[p.doorX - 0.7, p.doorX + 0.7]])) run(s, kind, u, zl, v, zl, unit);
    for (const x of [a, b]) if (Math.abs(x - driveX) > 2.5) run(s, kind, x, zl, x, p.front - 1, unit);
  }
  const zf = s.hd - 0.6;
  if (s.spare(3)) {
    const mx = driveX + 2.7;
    const gy = ground(s, mx, zf);
    box(s, mx, gy - 0.3, zf + 0.2, 0.1, 1.4, 0.1, mat(s, 'timber'));
    box(s, mx, gy + 1.05, zf + 0.25, 0.3, 0.25, 0.5, trim(s, s.fx.pick([0xb5261e, 0x8a8d90, 0xe8e6df])));
    board(s, rng.pick(FARMS), driveX - 3.4, gy + 0.85, zf + 0.06, 1.8, 3, WALL_PAINT);
  }
  roadFence(s, driveX);
  if (s.near) {
    const fx = s.fx;
    prop(s, 'washing-line', p.doorX - side * 6, p.back - 2.5, fx.range(0, 1.5));
    for (let i = 0; i < 4; i++) prop(s, fx.pick(['bush', 'flax', 'bush', 'tree-cabbage']), fx.range(p.x0 - 2, p.x1 + 2), p.front + fx.range(0.8, 4.5), fx.range(0, 6), fx.range(0.75, 1.1));
    if (fx.chance(0.6)) prop(s, 'drum', driveX + 3.6, shedZ + 2, 0, 1, 0xb5261e);
  }
  // Dog kennels by the shed.
  const kx = driveX - side * 4.2;
  if (s.spare(2)) for (const k of [0, 1.4]) box(s, kx, ground(s, kx, shedZ - 1 + k), shedZ - 1 + k, 0.9, 0.8, 1.1, mat(s, 'corrugated', 0x8f959a));
};

// ───────────────────────────── Woolshed and yards ─────────────────────────────

const woolshed: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(FARMS);
  const w = rng.range(16, 21);
  const d = rng.range(8.5, 10.5);
  const side = rng.pick(SIDES);
  const cx = -side * rng.range(1, 3.5); // off-centre, leaving the `side` end free for the yards
  const front = s.hd - rng.range(10.5, 13);
  const cz = front - d / 2;
  const { h: b } = seat(s, cx - w / 2, cx + w / 2, front);
  const fl = 1.2; // slatted floor on piles
  const H = fl + 3.6;
  const cladding = rng.pick([0x8b3027, 0x8b3027, 0x9aa0a4, 0x7c2a22, 0xa9a79d]);
  const skin = mat(b, 'corrugated', cladding);
  const sheet = mat(b, 'corrugated', 0xa9a79d);
  const timber = mat(b, 'timber', 0x7a6650);
  const dark = trim(b, 0x1c1a18);
  b.j = { style: 'casement', variant: 0, frame: 0xe8e2d0, trim: 0xe8e2d0, wall: 'plain' };

  walls(b, cx, cz, w, d, H, skin);
  solid(b, cx, cz, w, d, H);
  roof(b, cx, H, cz, w, d, d * 0.26, sheet, { eave: 0.25 });
  // Covered pens under a lean-to along the back.
  walls(b, cx, cz - d / 2 - 1.9, w * 0.8, 4, 2.7, skin);
  slope(b, cx, H - 0.6, cz - d / 2 + 0.1, cx, 2.75, cz - d / 2 - 4.2, w * 0.8 + 0.4, 0.08, sheet);

  // Bale door and landing at the drive end; the sheep ramp and porthole doors at the yards end.
  const bx = cx - side * (w / 2 - 2.6);
  const base = Math.min(-0.4, ground(b, bx, front + 1.8) - 0.3);
  bigDoor(b, bx, fl, front + 0.02, 2.6, 2.7, 0x6b4a32, false, 0, true);
  box(b, bx, base, front + 0.9, 3.6, fl - base, 1.8, timber);
  const rx = cx + side * (w / 2 - 1.4);
  slope(b, rx, 0, front + 5, rx, fl, front + 0.2, 1.2, 0.12, timber);
  const ports = Math.max(2, Math.min(4, Math.round((w - 9) / 2.2)));
  for (let i = 0; i < ports; i++) quad(b, cx + side * (w / 2 - 4 - i * 2.2), fl + 0.42, front + 0.05, 0.62, 0.8, dark);
  winRow(b, cx - w / 2 + 2, front, cx + w / 2 - 2, front, H - 0.6, 3, 1.3, 0.6, 0, 0.05);
  board(b, name, cx + side * (w / 2 - 4 - (ports - 1) * 1.1), fl + 1.85, front + 0.06, 2.4, 3, WALL_PAINT);

  // Sheep yards: close-boarded pens off the ramp.
  const shedEnd = side * cx + w / 2;
  const reach = Math.max(1.5, Math.min(5, (s.hw - 1.5 - shedEnd) / 2 - 0.3));
  const yx = side * (shedEnd + 0.6 + reach);
  const rail = mat(s, 'timber', 0x8f867a);
  const y0 = front - 4.5;
  const y1 = Math.min(front + 7, s.hd - 3);
  const xa = yx - reach;
  const xb = yx + reach;
  if (s.spare(8)) {
    fence(s, xa, y1, xb, y1, 1.1, 0.06, rail);
    fence(s, xa, y0, xb, y0, 1.1, 0.06, rail);
    fence(s, xa, y0, xa, y1, 1.1, 0.06, rail);
    fence(s, xb, y0, xb, y1, 1.1, 0.06, rail);
  }
  if (s.spare(4)) {
    fence(s, yx, y0, yx, y1, 1.1, 0.06, rail);
    fence(s, xa, (y0 + y1) / 2, xb, (y0 + y1) / 2, 1.1, 0.06, rail);
  }
  waterTank(s, cx - side * (w * 0.4 + 1.7), cz - d / 2 - 2, 0);

  // Decoration: bales on the landing, the dark under-floor, trees, the track and gate.
  if (b.spare(2)) {
    const bale = trim(b, 0xd8cfb8);
    box(b, bx - 0.9, fl, front + 1.1, 1.2, 0.8, 0.8, bale);
    box(b, bx + 0.5, fl, front + 1.2, 1.2, 0.8, 0.8, bale);
  }
  if (b.spare()) box(b, cx + side * 1.6, -0.5, front + 0.03, w - 6.5, fl + 0.3, 0.05, dark);
  patches(b, cx - w / 2 + 0.5, cx + w / 2 - 0.5, front, fl + 0.4, H - 0.9, cladding, 5);
  const driveX = -side * Math.min(s.hw - 5, Math.abs(bx) + 2);
  track(s, driveX, front + 3);
  roadFence(s, driveX);
  shelterBelt(s, -s.hw + 3, -s.hd + 2.2, s.hw - 3, -s.hd + 2.2, rng.pick(['tree-pine', 'tree-poplar']), 5.2);
};

// ───────────────────────────── Hay barn ─────────────────────────────

const hayBarn: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const w = rng.range(12, 16);
  const d = rng.range(8, 10);
  const side = rng.pick(SIDES);
  const cx = side * rng.range(0, 5);
  const front = s.hd - rng.range(11, 15);
  const cz = front - d / 2;
  const { h: b } = seat(s, cx - w / 2, cx + w / 2, front);
  const H = 5.2;
  const pole = mat(b, 'timber', 0x6f5a44);
  const sheet = mat(b, 'corrugated', rng.pick([0xa9a79d, 0x8b3027, 0x9aa0a4]));
  const hay = mat(b, 'weatherboard', 0xcdb768);

  // Pole barn: two rows of posts under a low gable, clad on the weather side and one end.
  const base = footing(b, cx, cz, w, d);
  for (let i = 0; i < 4; i++) {
    const px = cx - w / 2 + 0.15 + ((w - 0.3) * i) / 3;
    for (const ez of SIDES) box(b, px, base, cz + ez * (d / 2 - 0.15), 0.22, H - base, 0.22, pole);
  }
  roof(b, cx, H, cz, w, d, d * 0.16, sheet, { eave: 0.3 });
  box(b, cx, 0.9, cz - d / 2 + 0.05, w, H - 0.9, 0.08, sheet);
  box(b, cx + side * (w / 2 - 0.05), 0.9, cz, 0.08, H - 0.9, d, sheet);

  // The stack: most of the barn full to the rafters, stepping down where they have been feeding out.
  const sw = w * rng.range(0.5, 0.68);
  const sx = cx + side * (w / 2 - sw / 2 - 0.4);
  box(b, sx, base, cz - 0.2, sw, 4.2 - base, d - 1, hay);
  box(b, sx - side * (sw / 2 + 1.1), base, cz - 0.6, 2.2, 2 - base, d - 2.2, hay);
  b.out.collider(b.f, sx - side * 1.1, 2, cz - 0.2, sw + 2.2, 4.6, d - 1);

  // Decoration: loose bales, big round bales in the paddock.
  if (b.spare(2)) {
    box(b, cx - side * (w / 2 - 1.5), 0, cz + 1.2, 1, 0.45, 0.5, hay);
    box(b, cx - side * (w / 2 - 2.3), 0, cz + 2.1, 0.5, 0.45, 1, hay);
  }
  if (s.spare(3)) {
    const rx = cx - side * (w / 2 + 3);
    for (let i = 0; i < 3; i++) {
      const z = front - 2 - i * 1.7;
      barrel(s, rx, ground(s, rx, z), z, 0.76, 1.2, mat(s, 'weatherboard', 0xbfa95e), 0, 12);
    }
  }
  const driveX = -side * Math.min(s.hw - 5, 6);
  track(s, driveX, front + 2.5);
  roadFence(s, driveX);
  shelterBelt(s, side * (s.hw - 2), -s.hd + 3, side * (s.hw - 2), cz + 2, 'tree-pine', 5.4);
};

// ───────────────────────────── Implement shed ─────────────────────────────

/** A plain tractor, nose to +z. */
function tractor(b: Site, x: number, z: number, paint: number) {
  const tyre = trim(b, 0x1c1c1c);
  const body = trim(b, paint);
  for (const e of SIDES) {
    barrel(b, x + e * 0.78, 0, z - 0.6, 0.76, 0.45, tyre, 0, 12);
    barrel(b, x + e * 0.62, 0, z + 1.35, 0.38, 0.25, tyre, 0, 10);
  }
  box(b, x, 0.6, z + 0.55, 0.72, 0.72, 2.1, body);
  box(b, x, 0.85, z - 0.65, 1.05, 0.75, 1, body);
  if (b.spare()) box(b, x, 1.6, z - 0.65, 1, 0.9, 0.95, glass(b));
  if (b.spare()) cyl(b, x + 0.25, 1.3, z + 1.1, 0.04, 0.9, trim(b, 0x3a3f44), 6);
}

/** Galvanised grain silo on a concrete ring, with a conical lid. Solid. */
function silo(b: Site, x: number, z: number, r: number, h: number) {
  const base = Math.min(-0.3, ground(b, x, z) - 0.3);
  cyl(b, x, base, z, r + 0.1, 0.5 - base, mat(b, 'concrete', 0xb7b3a8), 12);
  cyl(b, x, 0.5, z, r, h, mat(b, 'corrugated', 0xb9bcbe), 12);
  cyl(b, x, 0.5 + h, z, r + 0.05, 0.9, mat(b, 'corrugated', 0xa9a79d), 12, 0.15);
  if (b.spare()) box(b, x + r * 0.72, 0.5, z + r * 0.72, 0.4, h + 0.3, 0.06, trim(b, 0x8a8d90));
  b.out.collider(b.f, x, (h + 1) / 2, z, r * 1.8, h + 1, r * 1.8);
}

const implementShed: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const bays = rng.int(3, 4);
  const bw = 4.2;
  const w = bays * bw;
  const d = 7;
  const side = rng.pick(SIDES);
  const cx = side * rng.range(0, 4);
  const front = s.hd - rng.range(11, 14.5);
  const cz = front - d / 2;
  const { h: b } = seat(s, cx - w / 2, cx + w / 2, front);
  const skin = mat(b, 'corrugated', rng.pick([0x9aa0a4, 0xb9b4a8, 0x8b3027, 0x7d8a78]));
  const sheet = mat(b, 'corrugated', 0xa9a79d);
  const pole = mat(b, 'timber', 0x6f5a44);

  // Open-fronted lean-to: three walls, a skillion falling to the back, posts between the bays.
  const base = footing(b, cx, cz, w, d);
  box(b, cx, base, front - d + 0.06, w, 3.4 - base, 0.12, skin);
  for (const e of SIDES) box(b, cx + e * (w / 2 - 0.06), base, cz, 0.12, 3.8 - base, d, skin);
  slope(b, cx, 4.55, front + 0.5, cx, 3.45, front - d - 0.2, w + 0.4, 0.08, sheet);
  for (let i = 0; i <= bays; i++) box(b, cx - w / 2 + 0.1 + ((w - 0.2) * i) / bays, base, front - 0.1, 0.2, 4.4 - base, 0.2, pole);
  box(b, cx, 4.15, front - 0.1, w, 0.25, 0.14, pole);
  b.out.collider(b.f, cx, 1.9, cz, w, 4.4, d);

  // A pair of grain silos beside the shed on some farms.
  const silos = rng.chance(0.45) && Math.abs(cx - side * (w / 2 + 2.6)) + 2 < s.hw;
  if (silos) for (const k of [0, 1]) silo(b, cx - side * (w / 2 + 2.6), front - 1.8 - k * 3.4, 1.5, 4.6 + k * 0.6);

  // What is parked in it.
  const order = rng.int(0, bays - 1);
  tractor(b, cx - w / 2 + (order + 0.5) * bw, cz + 0.3, rng.pick([0xb5261e, 0x1f5a8a, 0x2d6a3f, 0xc9a21a]));
  const other = (order + 1 + rng.int(0, bays - 2)) % bays;
  const ox = cx - w / 2 + (other + 0.5) * bw;
  const steel = trim(b, rng.pick([0x8a2f2a, 0x55606a, 0x2b4a6b]));
  box(b, ox, 0.55, cz, 2.2, 0.5, 4.2, steel);
  for (const e of SIDES) barrel(b, ox + e * 1.25, 0, cz - 0.4, 0.4, 0.25, trim(b, 0x1c1c1c), 0, 10);

  // Decoration: overhead fuel tank on a stand beside the shed, drums.
  if (!silos && b.spare(3)) {
    const fx = cx - side * (w / 2 + 1.6);
    for (const ez of [-0.6, 0.6]) box(b, fx, -0.4, front - 2 + ez, 1.1, 2.3, 0.12, trim(b, 0x6a6d70));
    barrel(b, fx, 1.9, front - 2, 0.6, 1.9, trim(b, 0xd8d8d4), Math.PI / 2, 12);
  }
  if (s.near) {
    for (let i = 0; i < 3; i++) prop(s, 'drum', cx + side * (w / 2 + 1 + s.fx.range(0, 1.6)), front - 1 - i * 0.9, 0, 1, s.fx.pick([0xb5261e, 0x2b4a6b, 0x8a8d90]));
    prop(s, 'pallet', cx - side * (w / 2 + 3.4), front - 4.5, s.fx.range(0, 3));
  }
  const driveX = -side * Math.min(s.hw - 5, 5);
  track(s, driveX, front + 3);
  roadFence(s, driveX);
  shelterBelt(s, -s.hw + 3, -s.hd + 2.5, s.hw - 3, -s.hd + 2.5, rng.pick(['tree-pine', 'tree-poplar']), 5.4);
};

export const RURAL: Archetype[] = [
  { name: 'farmhouse', weight: 5, build: farmhouse },
  { name: 'woolshed', weight: 2, build: woolshed },
  { name: 'hay-barn', weight: 2, build: hayBarn },
  { name: 'implement-shed', weight: 2, build: implementShed },
];
