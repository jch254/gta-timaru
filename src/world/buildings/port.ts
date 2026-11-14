import type { LotBuilder } from '../../core/types';
import { type Archetype, BRICKS, CLADDING, DOOR, type Mat, type Site, WARM_LIGHT, bigDoor, box, cyl, door, downpipe, flatRoof, footing, glow, ground, mat, pad, pane, patches, poleSign, prop, propAt, roof, seat, site, slope, solid, trim, walls } from './kit';
import { stand, yardFence, yardJunk } from './industrial';
import { shedWalls } from './service';
import { COOLSTORES, FISHERIES, FISH_TAGS, SHIPPERS, TANK_FARMS, TRADE, WALL_PAINT, board, signMat, wrap } from './names';

/**
 * Port land (Timaru's breakwater, Lyttelton's reclamations): transit sheds with loading docks, white
 * coolstores, tank farms behind bunds, stacks of boxes, and the fishing companies' iron sheds.
 */

const SIDES = [-1, 1] as const;
const BOX_PAINT = [0x8a2f2a, 0x2b4a6b, 0x2d5f3b, 0xb86a2a, 0x8a8d90, 0xd8d2c0, 0x6b3a2a, 0x1f4a4a, 0xa33a2a];
/** ISO box sizes in metres. */
const BOX_W = 2.44;
const BOX_H = 2.6;
const TWENTY = 6.06;
const FORTY = 12.2;

/** Raised concrete dock along a front wall with a row of doors opening onto it and an awning over. */
function dock(b: Site, cx: number, front: number, w: number, doors: number, paint: number, awning: Mat) {
  walls(b, cx, front + 1.1, w, 2.2, 1.2, mat(b, 'concrete', 0xbcb8ad));
  for (let i = 0; i < doors; i++) {
    const x = cx - w / 2 + ((i + 0.5) * w) / doors;
    bigDoor(b, x, 1.2, front + 0.02, 3.4, 3.6, paint, i === 1);
    // Rubber dock bumpers under each door, a tube light under the awning.
    if (b.spare()) box(b, x, 0.55, front + 2.24, 2.6, 0.5, 0.1, trim(b, 0x1c1c1c));
    if (b.spare()) glow(b, x, 5.3, front + 1.4, 1.3, 0.16, WARM_LIGHT, 3, 0, true);
  }
  slope(b, cx, 5.7, front, cx, 5.25, front + 2.8, w, 0.08, awning);
  // Yellow kerb along the dock edge, steps up one end.
  if (b.spare()) box(b, cx, 1.2, front + 2.14, w, 0.06, 0.12, trim(b, 0xd9a21a));
  if (b.spare(2)) for (let i = 0; i < 2; i++) box(b, cx + w / 2 + 0.5, 0, front + 0.6 + i * 0.8, 1, 0.8 - i * 0.4, 0.8, mat(b, 'concrete', 0xbcb8ad));
}

// ───────────────────────────── Transit shed / warehouse ─────────────────────────────

const warehouse: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(SHIPPERS);
  const { b, cx, cz, w, d, front, side } = stand(s, lot.width * rng.range(0.68, 0.84), lot.depth * rng.range(0.5, 0.62), 1.6, 8);
  const H = rng.range(7.5, 10);
  const tilt = rng.chance(0.45);
  const cladding = rng.pick(CLADDING);
  const skin = tilt ? mat(b, 'concrete', rng.pick([0xb7b3a8, 0xc4c0b4, 0xa9a69c])) : mat(b, 'corrugated', cladding);
  const sheet = mat(b, 'corrugated', 0xa9a79d);
  const band = trim(b, rng.pick([0x1f3f7a, 0xb5261e, 0x2d5f3b, 0xf0c33a]));
  const alongX = w >= d;
  const rise = (alongX ? d : w) * 0.09;

  walls(b, cx, cz, w, d, H, skin);
  solid(b, cx, cz, w, d, H);
  b.j = { style: 'alu', variant: 0, frame: 0xd8d8d4, trim: 0xd8d8d4, wall: 'masonry' };
  shedWalls(b, cx, cz, w, d, H, skin);
  roof(b, cx, H, cz, w, d, rise, sheet, { axis: alongX ? 'x' : 'z', eave: 0.2 });
  const dw = w - 5;
  dock(b, cx - side * 2.3, front, dw, Math.max(2, Math.min(5, Math.round(dw / 8))), rng.pick([0x55606a, 0xb9b4a8, 0x2b4a6b]), sheet);
  box(b, cx, H - 1.75, front + 0.03, w, 0.4, 0.06, band);
  board(b, name, cx - side * w * 0.12, H - 0.68, front + 0.07, Math.min(w * 0.5, 8), 8, TRADE);
  board(b, `SHED ${rng.int(1, 4)}`, cx + side * (w / 2 - 2.4), H - 0.68, front + 0.07, 2.4, 3, WALL_PAINT);
  // Office door at ground level on the boundary end.
  const ox = cx + side * (w / 2 - 1.5);
  door(b, ox, 0, front + 0.02, rng.pick(DOOR), 0, 0.95, 2.05, 1);
  pane(b, 'casement', ox - side * 1.5, 1.7, front + 0.03, 1.4, 1.1, 0, { color: 0xd8d8d4, variant: 2, lit: 2 });
  if (!tilt) {
    patches(b, cx - w / 2 + 0.5, cx + w / 2 - 0.5, front, 5.8, H, cladding, 4);
    patches(b, front - 0.5, front - d + 0.5, cx - side * (w / 2), 0.4, H, cladding, 4, (-side * Math.PI) / 2);
  } else if (b.spare(3)) {
    // Joints between the tilt slabs.
    const slabs = Math.max(3, Math.round(w / 6));
    for (let i = 1; i < slabs; i++) box(b, cx - w / 2 + (w * i) / slabs, 0, front + 0.01, 0.05, H, 0.03, trim(b, 0x6a665e));
  }
  if (b.spare(2)) for (const e of SIDES) downpipe(b, cx + e * (w / 2 - 0.25), front, 1.2, H - 0.1, 0, 0x6a6d70);

  // Decoration: a forklift on the apron, pallets on the dock, a couple of boxes waiting.
  if (b.spare(4)) {
    const fx = cx - side * (w / 2 - 3);
    const fz = front + 5.2;
    const gy = ground(b, fx, fz);
    const paint = trim(b, 0xd9a21a);
    box(b, fx, gy + 0.25, fz, 1.2, 0.9, 2, paint);
    box(b, fx, gy + 1.15, fz - 0.3, 1.1, 1.1, 1, trim(b, 0x2a2c2e));
    box(b, fx, gy + 0.1, fz + 1.15, 0.9, 2.6, 0.12, trim(b, 0x3a3f44));
    box(b, fx, gy + 0.1, fz + 1.7, 1, 0.08, 1, trim(b, 0x3a3f44));
  }
  if (s.near) for (let i = 0; i < 3; i++) propAt(b, 'pallet', cx - side * 2.3 + s.fx.range(-dw / 2 + 1, dw / 2 - 1), 1.2, front + s.fx.range(0.8, 1.7), s.fx.range(0, 3));
  const lx = cx - side * (w / 2 + 2.6);
  if (Math.abs(lx) < s.hw - 2.2 && s.spare(2)) {
    const gy = ground(s, lx, front - 5);
    box(s, lx, gy, front - 5, BOX_W, BOX_H, TWENTY, mat(s, 'corrugated', rng.pick(BOX_PAINT)));
    box(s, lx, gy, front - 12, BOX_W, BOX_H, TWENTY, mat(s, 'corrugated', rng.pick(BOX_PAINT)));
  }
  yardFence(s, cx - side * (w / 2 - 4), 7);
};

// ───────────────────────────── Coolstore ─────────────────────────────

const coolstore: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(COOLSTORES);
  const { b, cx, cz, w, d, front, side } = stand(s, lot.width * rng.range(0.56, 0.72), lot.depth * rng.range(0.48, 0.6), 1.6, 8);
  const H = rng.range(9, 12.5);
  const panel = mat(b, 'corrugated', 0xeceae2);
  const band = trim(b, rng.pick([0x2b6a9a, 0x1f3f7a, 0x3a8a9a]));

  // Tall white insulated box, flat roof, a blue band round the top.
  walls(b, cx, cz, w, d, H, panel);
  solid(b, cx, cz, w, d, H);
  b.j = { style: 'alu', variant: 0, frame: 0xd8d8d4, trim: 0xd8d8d4, wall: 'masonry' };
  shedWalls(b, cx, cz, w, d, H, panel, false);
  flatRoof(b, cx, cz, w, d, H, 0xd4d2ca);
  box(b, cx, H - 1.3, front + 0.03, w, 0.7, 0.06, band);
  board(b, name, cx, H - 2.6, front + 0.07, Math.min(w * 0.6, 9), 8, [{ bg: '#f4f6f8', fg: '#1f3f7a', style: 'block' }]);
  const dw = w * 0.7;
  dock(b, cx - side * w * 0.12, front, dw, Math.max(2, Math.min(4, Math.round(dw / 7))), 0xd8d8d4, mat(b, 'corrugated', 0xa9a79d));

  // Engine room on the open side, condensers on the roof.
  const ex = cx - side * (w / 2 + 2.6);
  if (Math.abs(ex) + 2.6 < s.hw - 1) {
    const ez = front - 4;
    walls(b, ex, ez, 5.2, 6, 4.4, rng.chance(0.5) ? mat(b, 'brick', rng.pick(BRICKS)) : mat(b, 'concrete'));
    box(b, ex, 4.4, ez, 5.5, 0.14, 6.3, trim(b, 0x8a8d90));
    pane(b, 'louvre', ex + side * 0.6, 2.6, ez + 3.03, 2.4, 1.4, 0, { color: 0x6a6d70 });
    door(b, ex - side * 1.6, 0, ez + 3.02, rng.pick(DOOR), 0, 0.92, 2.05, 0);
  }
  for (const t of [-0.22, 0.2]) box(b, cx + t * w, H, cz - d * 0.15, 2.6, 1.5, 1.5, trim(b, 0x9a9d9f));

  // Decoration: panel joints, fans on the condensers.
  if (b.spare(4)) {
    const joints = Math.max(3, Math.min(8, Math.round(w / 4.8)));
    for (let i = 1; i < joints; i++) box(b, cx - w / 2 + (w * i) / joints, 5.8, front + 0.012, 0.05, H - 5.8, 0.03, trim(b, 0xc9c8c0));
  }
  if (b.spare(2)) for (const t of [-0.22, 0.2]) cyl(b, cx + t * w, H + 1.5, cz - d * 0.15, 0.55, 0.2, trim(b, 0x3a3f44), 10);
  if (b.spare()) box(b, cx - side * (w / 2 - 0.4), 0, front + 0.1, 0.16, H, 0.16, trim(b, 0x8a8d90));
  if (s.near) for (let i = 0; i < 3; i++) propAt(b, 'pallet', cx - side * w * 0.12 + s.fx.range(-dw / 2 + 1, dw / 2 - 1), 1.2, front + s.fx.range(0.8, 1.7), s.fx.range(0, 3));
  yardJunk(s, cx - side * (w / 2 - 2), front + 5, 2);
  yardFence(s, cx - side * (w / 2 - 4), 7);
};

// ───────────────────────────── Tank farm ─────────────────────────────

const tankFarm: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(TANK_FARMS);
  const fw = lot.width - 8;
  const fd = lot.depth - 14;
  const fz = -s.hd + 3 + fd / 2;
  const { h: b } = seat(s, -fw / 2, fw / 2, fz + fd / 2);
  const cols = fw > 34 ? 3 : 2;
  const rows = fd > 24 && rng.chance(0.6) ? 2 : 1;
  // Sizes snapped coarsely: every tank on the map then shares a handful of cylinder shapes.
  const r = Math.floor(Math.max(3, Math.min(6.4, Math.min(fw / cols, fd / rows) / 2 - 1.3)) * 5) / 5;
  const h = rng.range(7, 11);
  const paint = trim(b, rng.pick([0xe8e6df, 0xc9ccce, 0xcfdccc, 0xe6dcc0]));
  const steel = trim(b, 0x6a6d70);

  // Tanks, each on its own collider.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (cols * rows > 2 && rng.chance(0.12)) continue;
      const x = -fw / 2 + ((i + 0.5) * fw) / cols;
      const z = fz - fd / 2 + ((j + 0.5) * fd) / rows;
      const th = Math.round(h * rng.range(0.85, 1) * 2) / 2;
      const base = Math.floor(footing(b, x, z, r * 2, r * 2) * 2) / 2;
      cyl(b, x, base, z, r, th - base, paint, 18);
      cyl(b, x, th, z, r, 0.7, paint, 18, 0.4);
      b.out.collider(b.f, x, th / 2, z, r * 1.75, th, r * 1.75);
      if (b.spare()) box(b, x + r * 0.7, 0, z + r * 0.73, 0.5, th + 1, 0.12, steel);
    }
  }
  // Bund wall round the lot of them.
  const bund = mat(b, 'concrete', 0xb7b3a8);
  for (const e of SIDES) {
    walls(b, 0, fz + (e * fd) / 2, fw + 0.5, 0.25, 0.9, bund);
    walls(b, (e * fw) / 2, fz, 0.25, fd + 0.5, 0.9, bund);
  }
  // Pump house and loading gantry out the front.
  const side = rng.pick(SIDES);
  const px = side * (fw / 2 - 2.6);
  const pz = fz + fd / 2 + 3.4;
  const brick = mat(b, 'brick', rng.pick(BRICKS));
  walls(b, px, pz, 4.4, 3.4, 3, brick);
  solid(b, px, pz, 4.4, 3.4, 3);
  box(b, px, 3, pz, 4.8, 0.14, 3.8, trim(b, 0x8a8d90));
  door(b, px - side * 1, 0, pz + 1.72, rng.pick(DOOR), 0, 0.92, 2.05, 0);
  box(b, 0, 0.45, fz + fd / 2 + 0.7, fw * 0.8, 0.22, 0.22, steel);
  box(b, -side * (fw / 2 - 5), 4.2, pz, 6, 0.3, 3.6, steel);
  for (const e of SIDES) box(b, -side * (fw / 2 - 5) + e * 2.8, -0.4, pz, 0.22, 4.6, 0.22, steel);
  poleSign(s, side * (s.hw - 2.5), s.hd - 1.8, 3.4, 3.3, 1.1, signMat(s, wrap(name), 3, TRADE), 0);

  // Decoration.
  if (b.spare(2)) for (const e of SIDES) box(b, e * fw * 0.2, 0.45, fz + fd / 2 + 1.6, 0.22, 0.22, 2, steel);
  yardJunk(s, -side * (fw / 2 - 9), pz + 0.5, 2);
  yardFence(s, -side * (fw / 2 - 5), 7);
};

// ───────────────────────────── Container stacks ─────────────────────────────

const containerYard: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const rows = Math.max(1, Math.min(4, Math.floor((lot.depth - 12) / 5.6)));
  const slots = Math.max(1, Math.floor((lot.width - 4) / (FORTY + 0.5)));
  const x0 = -(slots * (FORTY + 0.5)) / 2;
  let placed = 0;
  for (let j = 0; j < rows; j++) {
    const z = -s.hd + 3 + j * 5.6;
    // The whole row stands level on its highest ground; the bottom boxes reach down to meet the rest.
    const gy = Math.max(ground(s, x0, z), ground(s, -x0, z), ground(s, 0, z)) + 0.1;
    let tallest = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < slots; i++) {
      const cx = x0 + (i + 0.5) * (FORTY + 0.5);
      const high = rng.chance(0.14) ? 0 : rng.int(1, 3);
      const base = Math.min(gy - 0.3, footing(s, cx, z, FORTY + 0.1, BOX_W));
      for (let k = 0; k < high && placed < 46; k++) {
        const y = k === 0 ? base : gy + k * BOX_H;
        const hgt = k === 0 ? gy + BOX_H - base : BOX_H;
        if (rng.chance(0.55)) {
          box(s, cx, y, z, FORTY, hgt, BOX_W, mat(s, 'corrugated', rng.pick(BOX_PAINT)));
          placed++;
        } else {
          for (const e of SIDES) box(s, cx + e * (TWENTY / 2 + 0.04), y, z, TWENTY, hgt, BOX_W, mat(s, 'corrugated', rng.pick(BOX_PAINT)));
          placed += 2;
        }
        tallest = Math.max(tallest, k + 1);
        lo = Math.min(lo, cx - FORTY / 2);
        hi = Math.max(hi, cx + FORTY / 2);
      }
    }
    if (tallest > 0) s.out.collider(s.f, (lo + hi) / 2, gy + (tallest * BOX_H) / 2, z, hi - lo, tallest * BOX_H, BOX_W);
  }

  // Gatehouse by the entrance (always there, so the lot is never empty), and a lighting tower.
  const side = rng.pick(SIDES);
  const gx = side * (s.hw - 4);
  const gz = s.hd - 4.5;
  const { h: g } = seat(s, gx - 1.6, gx + 1.6, gz + 2);
  const hut = mat(g, 'plaster', 0xd9d2bf);
  walls(g, gx, gz, 3.2, 4, 2.7, hut);
  solid(g, gx, gz, 3.2, 4, 2.7);
  box(g, gx, 2.7, gz, 3.8, 0.14, 4.6, trim(g, 0x8a8d90));
  pane(g, 'casement', gx - side * 1.63, 1.6, gz + 0.4, 1.8, 1, (-side * Math.PI) / 2, { color: 0xd8d8d4, variant: 3, lit: 3 });
  door(g, gx, 0, gz + 2.02, rng.pick(DOOR), 0, 0.9, 2.05, 1);
  const tx = -side * (s.hw - 3);
  const tz = s.hd - 3;
  const ty = ground(s, tx, tz);
  box(s, tx, ty - 0.4, tz, 0.3, 16, 0.3, trim(s, 0x8a8d90));
  box(s, tx, ty + 15.4, tz, 2.4, 0.5, 0.7, trim(s, 0x4a4d50));
  if (s.spare()) glow(s, tx, ty + 15.39, tz, 2.2, 0.5, WARM_LIGHT, 3, 0, true);

  // Decoration: a couple of twenty-footers left at an angle near the gate.
  if (s.spare(2)) {
    for (const t of [-0.25, 0.2]) {
      const lx = t * lot.width * 0.5;
      const lz = s.hd - 8 - rng.range(0, 2);
      const fr = s.out.frameAt(s.lot.x + lx * s.cos + lz * s.sin, s.lot.y + ground(s, lx, lz), s.lot.z - lx * s.sin + lz * s.cos, s.lot.heading + rng.range(-0.5, 0.5));
      s.out.box(fr, 0, BOX_H / 2 - 0.15, 0, TWENTY, BOX_H + 0.3, BOX_W, mat(s, 'corrugated', rng.pick(BOX_PAINT)));
    }
  }
  if (s.near && s.fx.chance(0.6)) prop(s, 'drum', gx - side * 2.4, gz + 1.6, 0, 1, 0x2b4a6b);
  yardFence(s, gx - side * 5, 7);
};

// ───────────────────────────── Fishing company shed ─────────────────────────────

const fishingShed: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(FISHERIES);
  const { b, cx, cz, w, d, front, back, side } = stand(s, Math.min(lot.width * 0.6, rng.range(16, 24)), Math.min(lot.depth * 0.5, rng.range(13, 18)), 1.6, 9);
  const H = rng.range(5, 6.5);
  const cladding = rng.pick([0x4f6a7a, 0x6f8a9a, 0x7d8a78, 0xa8563c, 0x8f959a]);
  const skin = mat(b, 'corrugated', cladding);
  const sheet = mat(b, 'corrugated', rng.pick([0x9a8a7a, 0xa9a79d, 0x8a5a48]));
  const alongX = w >= d;
  const rise = (alongX ? d : w) * 0.14;

  walls(b, cx, cz, w, d, H, skin);
  solid(b, cx, cz, w, d, H);
  roof(b, cx, H, cz, w, d, rise, sheet, { axis: alongX ? 'x' : 'z', eave: 0.2 });
  // Lean-to along the open side.
  const lw = Math.min(4, s.hw * 2 - w - 4);
  if (lw > 2) {
    const lx = cx - side * (w / 2 + lw / 2);
    walls(b, lx, cz, lw, d * 0.7, 3, skin);
    slope(b, cx - side * (w / 2 - 0.1), 4.1, cz, cx - side * (w / 2 + lw + 0.2), 3.05, cz, d * 0.7 + 0.3, 0.08, sheet);
  }
  const gx = cx - side * (w / 2 - 3.2);
  bigDoor(b, gx, -0.3, front + 0.02, 4.2, 4.3, rng.pick([0x55606a, 0x2b4a6b, 0x6b3a2a]), rng.chance(0.55));
  door(b, cx + side * (w / 2 - 1.6), 0, front + 0.02, rng.pick(DOOR), 0, 0.92, 2.05, 1);
  patches(b, cx - w / 2 + 0.5, cx + w / 2 - 0.5, front, 0.3, H, cladding, 5);
  if (b.spare()) glow(b, gx, 4.75, front + 0.1, 0.5, 0.18, WARM_LIGHT, 2);
  if (b.spare(2)) pane(b, 'steel', cx + side * w * 0.12, 3.4, front + 0.03, Math.min(4.8, w * 0.3), 1.1, 0, { nx: 2, color: 0x3c4044, lit: 1 });
  board(b, name, cx + side * w * 0.1, H - 0.75, front + 0.07, Math.min(w * 0.55, 7), 8, TRADE);
  board(b, rng.pick(FISH_TAGS), cx + side * (w / 2 - 3.4), 2.9, front + 0.07, 3.2, 8, TRADE);
  pad(b, cx, front + 2.6, w, 5.2, mat(b, 'concrete', 0xbcb8ad));

  // Ice plant: a tall narrow tower at the back with a chute.
  const ix = cx + side * (w / 2 - 1.6);
  box(b, ix, H - 0.4, back + 1.8, 2.6, 4.2, 2.6, mat(b, 'corrugated', 0xdedcd2));
  // Fish bins stacked on the apron.
  const binPaint = [0x2b5a8a, 0xd9742a, 0x8a8d90, 0x2b5a8a];
  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const lvl = Math.floor(i / 3);
    if (lvl === 1 && rng.chance(0.35)) continue;
    box(b, cx + side * 1.2 + col * 1.3, 0.04 + lvl * 0.78, front + 3.4, 1.2, 0.76, 1, trim(b, rng.pick(binPaint)));
  }

  // Decoration: craypots, floats.
  if (b.spare(3)) {
    const pot = mat(b, 'timber', 0x8a7458);
    const px = cx - side * (w / 2 - 0.8);
    box(b, px, 0.04, front + 1, 0.9, 0.45, 0.65, pot);
    box(b, px + 0.95, 0.04, front + 1, 0.9, 0.45, 0.65, pot);
    box(b, px + 0.5, 0.49, front + 1, 0.9, 0.45, 0.65, pot);
  }
  if (b.spare(3)) for (let i = 0; i < 3; i++) cyl(b, gx + 2.8 + i * 0.5, 0.04, front + 0.5 + (i % 2) * 0.4, 0.2, 0.5, trim(b, i === 1 ? 0xf2f0e6 : 0xe8622a), 8);
  yardJunk(s, cx - side * (w / 2 + 1.5), front + 2, 3);
  yardFence(s, gx, 7);
};

export const PORT: Archetype[] = [
  { name: 'warehouse', weight: 4, build: warehouse },
  { name: 'coolstore', weight: 2, build: coolstore },
  { name: 'tank-farm', weight: 1.2, build: tankFarm },
  { name: 'container-yard', weight: 2.5, build: containerYard },
  { name: 'fishing-shed', weight: 2, build: fishingShed, fit: (lot) => (lot.district.city === 'timaru' || lot.district.city === 'lyttelton' ? 1.5 : 1) },
];
