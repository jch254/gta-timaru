import type { LotBuilder } from '../../core/types';
import {
  type Archetype,
  BRICKS,
  CAR_PAINT,
  CLADDING,
  DOOR,
  HOUSE_PAINT,
  IRON,
  RENDER,
  type Site,
  WARM_LIGHT,
  bigDoor,
  box,
  cyl,
  door,
  downpipe,
  flatRoof,
  glow,
  ground,
  level,
  mat,
  pad,
  pane,
  patches,
  poleSign,
  prop,
  roof,
  run,
  seat,
  site,
  slope,
  solid,
  stretches,
  trim,
  walls,
  win,
  winRow,
} from './kit';
import { shedWalls } from './service';
import { CAR_TAGS, CAR_YARDS, FACTORIES, PANEL_BEATERS, PANEL_TAGS, TIMBER_TAGS, TIMBER_YARDS, TRADE, WALL_PAINT, WOOL_STORES, WORKS, board, signMat, wrap } from './names';

/**
 * Industrial strips (Sydenham and Moorhouse Ave, Washdyke, Hornby): iron sheds, saw-tooth brick
 * factories, wool stores, panel beaters, timber yards and car yards behind chain-link and bunting.
 */

const SIDES = [-1, 1] as const;

export interface Stand {
  /** Site raised to the building's own floor level. */
  b: Site;
  cx: number;
  cz: number;
  w: number;
  d: number;
  front: number;
  back: number;
  /** Which side boundary the building sits against; the yard and drive are on the other. */
  side: -1 | 1;
  floor: number;
}

/** Stand a big building at the back of the plot, against one side. */
export function stand(s: Site, w: number, d: number, margin = 1.4, clear = 6): Stand {
  const side = s.rng.pick(SIDES);
  const ww = Math.max(6, Math.min(w, s.lot.width - margin * 2));
  const dd = Math.max(6, Math.min(d, s.lot.depth - margin - clear));
  const cx = side * (s.hw - ww / 2 - margin);
  const back = -s.hd + margin;
  const front = back + dd;
  const { h, floor } = seat(s, cx - ww / 2, cx + ww / 2, front);
  return { b: h, cx, cz: back + dd / 2, w: ww, d: dd, front, back, side, floor };
}

/** Chain-link along the front boundary with a gap for the gate. */
export function yardFence(s: Site, gateX: number, gateW = 6) {
  if (!s.near) return;
  const zf = s.hd - 0.4;
  for (const [a, b] of stretches(-s.hw + 0.3, s.hw - 0.3, [[gateX - gateW / 2, gateX + gateW / 2]])) run(s, 'chainlink-fence', a, zf, b, zf, 3);
}

/**
 * A row of parked cars nose-out along x. Each is a scenery car with its own box (props/physics.ts) that becomes
 * a real vehicle near the player (world/standins.ts), so the row has no collider of its own: one laid over the
 * lot of them would hold the real cars fast.
 */
export function carRow(s: Site, x0: number, x1: number, z: number, yaw = 0, tints: readonly number[] = CAR_PAINT) {
  const n = Math.floor((x1 - x0) / 2.75);
  if (n < 1) return;
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) prop(s, 'car-parked', x0 + (i + 0.5) * step, z, yaw + s.rng.range(-0.07, 0.07), 1, s.rng.pick(tints));
}

/** Loose yard clutter: drums and pallets near a point. */
export function yardJunk(s: Site, x: number, z: number, count: number) {
  if (!s.near) return;
  for (let i = 0; i < count; i++) {
    const kind = s.fx.chance(0.6) ? 'drum' : 'pallet';
    prop(s, kind, x + s.fx.range(-1.6, 1.6), z + s.fx.range(-1.6, 1.6), s.fx.range(0, 3), 1, kind === 'drum' ? s.fx.pick([0x2b4a6b, 0xb5261e, 0x8a8d90, 0x2d6a4f, 0xc9a23a]) : undefined);
  }
}

// ───────────────────────────── Corrugated shed: engineering, transport, joinery ─────────────────────────────

const works: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(WORKS);
  const { b, cx, cz, w, d, front, side } = stand(s, lot.width * rng.range(0.5, 0.7), lot.depth * rng.range(0.42, 0.56));
  const H = rng.range(5.2, 7.5);
  const cladding = rng.pick(CLADDING);
  const skin = mat(b, 'corrugated', cladding);
  const sheet = mat(b, 'corrugated', rng.chance(0.6) ? 0xa9a79d : rng.pick(CLADDING));
  const alongX = w >= d;
  const rise = (alongX ? d : w) * 0.11;
  b.j = { style: 'alu', variant: 0, frame: 0xd8d8d4, trim: 0xd8d8d4, wall: 'masonry' };

  walls(b, cx, cz, w, d, H, skin);
  solid(b, cx, cz, w, d, H);
  shedWalls(b, cx, cz, w, d, H, skin);
  roof(b, cx, H, cz, w, d, rise, sheet, { axis: alongX ? 'x' : 'z', eave: 0.2 });
  // A concrete nib wall under the iron, as these sheds have.
  if (b.spare()) walls(b, cx, cz, w + 0.06, d + 0.06, 0.45, mat(b, 'concrete', 0xa9a69c));

  // Roller doors towards the yard end of the front wall, a block office on the other corner.
  const doors = w > 19 ? 2 : 1;
  const dh = Math.min(4.3, H - 1.6);
  const paint = rng.pick([0x55606a, 0x8a2f2a, 0x2b4a6b, 0xb9b4a8, 0x2d5f3b]);
  for (let i = 0; i < doors; i++) bigDoor(b, cx - side * (w / 2 - 3 - i * 5.2), -0.3, front + 0.02, 4.2, dh + 0.3, paint, i === 0 && rng.chance(0.5));
  const mid = cx - side * (w / 2 - 3 - (doors - 1) * 2.6);
  board(b, wrap(name), mid, H - 0.72, front + 0.08, H > 6 ? 3.6 : 3, 3, TRADE);
  pad(b, mid, front + 2.8, doors * 5.2 + 1.5, 5.6, mat(b, 'concrete', 0xbcb8ad));

  const ow = Math.min(6.2, w - 5.5);
  if (ow > 3.5) {
    const od = 4;
    const ox = cx + side * (w / 2 - ow / 2 - 0.2);
    walls(b, ox, front + od / 2 - 0.15, ow, od + 0.3, 3.1, rng.chance(0.5) ? mat(b, 'brick', rng.pick(BRICKS)) : mat(b, 'plaster', rng.pick(RENDER)));
    box(b, ox, 3.1, front + od / 2, ow + 0.3, 0.14, od + 0.5, trim(b, 0x8a8d90));
    winRow(b, ox - ow / 2 + 0.4, front + od, ox + ow / 2 - 0.4, front + od, 1.65, 2, Math.min(1.6, ow / 2 - 1), 1.2, 0, 0.3, true);
    door(b, ox - (side * ow) / 2, 0, front + od / 2, rng.pick(DOOR), (-side * Math.PI) / 2, 0.92, 2.05, 1);
  }
  // Translucent sheets let into the wall high up, a bulkhead light over each door, the odd replaced sheet.
  if (b.spare(2)) pane(b, 'steel', cx - side * w * 0.1, H - 0.9, front + 0.03, Math.min(w * 0.5, 9), 1, 0, { nx: Math.max(2, Math.round(Math.min(w * 0.5, 9) / 2.4)), color: 0x6a6d70, variant: 1, lit: 1 });
  for (let i = 0; i < doors; i++) if (b.spare()) glow(b, cx - side * (w / 2 - 3 - i * 5.2), dh + 0.55, front + 0.1, 0.5, 0.18, WARM_LIGHT, 2);
  patches(b, cx - w / 2 + 0.5, cx + w / 2 - 0.5, front, 0.5, H, cladding, 4);
  patches(b, front - 0.5, front - d + 0.5, cx - side * (w / 2), 0.5, H, cladding, 3, (-side * Math.PI) / 2);
  if (b.spare(2)) downpipe(b, cx + side * (w / 2 - 0.2), front, 0, H - 0.1, 0, 0x8a8d90);

  // Decoration.
  if (b.spare(2)) {
    for (const t of [-0.25, 0.25]) cyl(b, cx + (alongX ? t * w : 0), H + rise - 0.15, cz + (alongX ? 0 : t * d), 0.36, 0.7, sheet, 8);
  }
  if (s.spare()) {
    const kx = cx - side * (w / 2 + 2.2);
    if (Math.abs(kx) < s.hw - 2) box(s, kx, ground(s, kx, front - 3), front - 3, 1.7, 1.25, 3.4, trim(s, rng.pick([0x2d5f3b, 0x2b4a6b, 0x8a2f2a])));
  }
  yardJunk(s, cx - side * (w / 2 - 6.5), front + 1.3, 3);
  yardFence(s, mid);
};

// ───────────────────────────── Saw-tooth factory ─────────────────────────────

const factory: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(FACTORIES);
  const { b, cx, cz, w, d, front, back, side } = stand(s, lot.width * rng.range(0.62, 0.8), lot.depth * rng.range(0.5, 0.62), 1.5, 9.5);
  const H = rng.range(5.2, 6.4);
  const wall = mat(b, 'brick', rng.pick(BRICKS));
  const sheet = mat(b, 'corrugated', 0xa9a79d);
  const r = 1.9;

  walls(b, cx, cz, w, d, H, wall);
  solid(b, cx, cz, w, d, H + r);
  // Saw-tooth roof: each bay a sheet rising towards the street with a glazed face; brick ends hide the zigzag.
  const teeth = Math.max(3, Math.min(5, Math.round(d / 6.5)));
  const bay = d / teeth;
  for (let i = 0; i < teeth; i++) {
    const zp = front - i * bay;
    slope(b, cx, H + r, zp - 0.04, cx, H + 0.02, zp - bay, w - 0.5, 0.08, sheet);
    pane(b, 'steel', cx, H + r / 2 + 0.05, zp - 0.02, w - 0.7, r - 0.25, 0, { nx: Math.max(2, Math.round((w - 0.7) / 3)), color: 0x55585a, lit: 1 });
  }
  for (const e of SIDES) box(b, cx + e * (w / 2 - 0.14), H, cz, 0.28, r + 0.06, d, wall);

  // Rendered two-storey office block on the street front.
  const ow = Math.min(12, w * 0.45);
  const od = 4.6;
  const oh = 6.6;
  const ox = cx + side * (w / 2 - ow / 2 - 0.8);
  const render = mat(b, 'plaster', rng.pick(RENDER));
  b.j = { style: 'casement', variant: 1, frame: rng.pick([0xf6f4ee, 0x2f4a3a, 0x6a2a24]), trim: 0xf3eddc, wall: 'masonry' };
  shedWalls(b, cx, cz, w, d, H, wall, false);
  walls(b, ox, front + od / 2 - 0.1, ow, od + 0.2, oh, render);
  flatRoof(b, ox, front + od / 2, ow, od, oh);
  const cols = Math.max(2, Math.min(4, Math.round(ow / 3)));
  for (const y of [1.75, 4.75]) winRow(b, ox - ow / 2 + 0.3, front + od, ox + ow / 2 - 0.3, front + od, y, cols, Math.min(1.9, ow / cols - 0.9), 1.3, 0, 0.25);
  door(b, ox - (side * ow) / 2, 0, front + od / 2, rng.pick(DOOR), (-side * Math.PI) / 2, 1.1, 2.1, 1);
  board(b, wrap(name), ox, oh - 0.75, front + od + 0.06, Math.min(ow - 1, 3.3), 3, TRADE);

  // Goods door and painted lettering on the bare brick beside the office.
  const gx = cx - side * (w / 2 - 3.2);
  bigDoor(b, gx, -0.3, front + 0.02, 4, 4.4, rng.pick([0x55606a, 0x6b3a2a, 0x2b4a6b]));
  const bare = w - ow - 8.5;
  if (bare > 4) board(b, name, cx - side * (w / 2 - 6.4 - bare / 2), H - 0.9, front + 0.06, Math.min(bare, 8), 8, WALL_PAINT);
  // Boiler stack rising through the back of the roof.
  const sx = cx - side * (w / 2 - 2.2);
  cyl(b, sx, H - 0.5, back + 2.4, 0.9, rng.range(13, 17), wall, 10, 0.62);

  // Steel windows in the brick along the street wall, between the office and the goods door.
  if (bare > 4 && b.spare(2)) pane(b, 'steel', cx - side * (w / 2 - 6.4 - bare / 2), 2.2, front + 0.03, Math.min(bare, 8), 1.8, 0, { nx: Math.max(1, Math.round(Math.min(bare, 8) / 2.4)), color: 0x3c4044, lit: 1 });

  // Decoration.
  if (b.spare()) slope(b, gx, 4.9, front, gx, 4.6, front + 2.2, 5.2, 0.08, sheet);
  if (b.spare(2)) for (const e of SIDES) downpipe(b, cx + e * (w / 2 - 0.3), front, 0, H - 0.1, 0, 0x4a4d50);
  if (b.spare()) box(b, ox, -0.3, front + od + 0.5, 2.4, 0.5, 1, mat(b, 'concrete', 0xc4c0b4));
  yardJunk(s, gx - side * 1.5, front + 4.5, 3);
  yardFence(s, cx - side * (w / 2 - 3));
};

// ───────────────────────────── Wool store ─────────────────────────────

const woolStore: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(WOOL_STORES);
  const { b, cx, cz, w, d, front, side } = stand(s, lot.width * rng.range(0.7, 0.85), lot.depth * rng.range(0.55, 0.66), 1.5, 7);
  const H = rng.range(8.5, 11);
  const wall = mat(b, 'brick', rng.pick(BRICKS));
  const sheet = mat(b, 'corrugated', rng.pick([0xa9a79d, 0x8f959a, 0x8b3027]));
  b.j = { style: 'sash', variant: 1, frame: rng.pick([0xe8e2d0, 0x3a2f22, 0x2f4a3a]), trim: 0xe8e2d0, wall: 'stone', sill: mat(b, 'concrete', 0xbcb8ad) };

  walls(b, cx, cz, w, d, H, wall);
  // Parallel gabled roofs running back from the street, each with a brick gable front.
  const gables = Math.max(2, Math.min(4, Math.round(w / 11)));
  const gw = w / gables;
  const rise = gw * 0.24;
  solid(b, cx, cz, w, d, H + rise * 0.5);
  shedWalls(b, cx, cz, w, d, H, wall, false);
  for (let i = 0; i < gables; i++) roof(b, cx - w / 2 + (i + 0.5) * gw, H, cz, gw, d, rise, sheet, { axis: 'z', gable: wall, eave: 0.1 });

  // Loading bank across the front with sliding doors opening onto it.
  loadingBank(b, cx, front, w);
  for (const e of SIDES) bigDoor(b, cx + e * w * 0.24, 1.1, front + 0.02, 3.2, 3.5, 0x6b4a32, false, 0, true);
  board(b, name, cx, H - 1.15, front + 0.07, Math.min(w * 0.72, 13), 8, WALL_PAINT);
  for (let i = 0; i < gables; i++) {
    const gx = cx - w / 2 + (i + 0.5) * gw;
    winRow(b, gx - gw / 2 + 0.6, front, gx + gw / 2 - 0.6, front, H - 3.1, 2, 1.2, 1.5, 0, 0.05);
  }

  // Decoration: dock canopy, wool bales, a second row of windows, side windows.
  if (b.spare()) slope(b, cx, 5.4, front, cx, 5, front + 2.4, w * 0.8, 0.08, sheet);
  if (b.spare(3)) {
    const bale = trim(b, 0xd8cfb8);
    const bx = cx - side * w * 0.05;
    box(b, bx, 1.1, front + 1.1, 1.3, 0.8, 0.9, bale);
    box(b, bx + 1.4, 1.1, front + 1.1, 1.3, 0.8, 0.9, bale);
    box(b, bx + 0.7, 1.9, front + 1.1, 1.3, 0.8, 0.9, bale);
  }
  if (b.spare(gables)) for (let i = 0; i < gables; i++) win(b, cx - w / 2 + (i + 0.5) * gw, H + rise * 0.32, front, 1.1, 1.1, 0, 0.05, false);
  if (b.spare(4)) for (const e of SIDES) winRow(b, cx + (e * w) / 2, cz + d / 2 - 3, cx + (e * w) / 2, cz - d / 2 + 3, H - 3.1, 2, 1.2, 1.5, (e * Math.PI) / 2, 0.05);
  yardFence(s, cx - side * (w / 2 - 4));
};

/** Concrete loading bank (1.1 m high) along a front wall. */
function loadingBank(b: Site, cx: number, front: number, w: number) {
  walls(b, cx, front + 1, w * 0.86, 2, 1.1, mat(b, 'concrete', 0xbcb8ad));
}

// ───────────────────────────── Panel beater ─────────────────────────────

const panelBeater: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(PANEL_BEATERS);
  const { b, cx, cz, w, d, front, side } = stand(s, Math.min(lot.width * 0.55, rng.range(15, 20)), Math.min(lot.depth * 0.45, rng.range(11, 15)), 1.4, 9);
  const H = 5;
  const wall = mat(b, 'plaster', rng.pick([0xd9d2bf, 0xc9cfc4, 0xe6d8c0, 0xbfc4c8]));
  const stripe = trim(b, rng.pick([0xb5261e, 0x1f3f7a, 0xf0c33a, 0x2d5f3b]));

  // Concrete-block workshop with a signboard parapet and a coloured band.
  walls(b, cx, cz, w, d, H, wall);
  solid(b, cx, cz, w, d, H);
  b.j = { style: 'alu', variant: 0, frame: 0xd8d8d4, trim: 0xd8d8d4, wall: 'masonry' };
  shedWalls(b, cx, cz, w, d, H, wall, false);
  flatRoof(b, cx, cz, w, d, H);
  box(b, cx, H, front - 0.12, w, 0.9, 0.24, wall);
  box(b, cx, H - 0.5, front + 0.03, w, 0.3, 0.06, stripe);
  board(b, name, cx, H + 0.45, front + 0.02, Math.min(w - 1.5, 6.4), 8, TRADE);
  const bays = w > 17 ? 3 : 2;
  const open = rng.int(0, bays - 1);
  for (let i = 0; i < bays; i++) bigDoor(b, cx - side * (w / 2 - 2.6 - i * 4.4), -0.3, front + 0.02, 3.6, 3.9, 0xb9b4a8, i === open);
  const ox = cx + side * (w / 2 - 1.3);
  door(b, ox, 0, front + 0.02, rng.pick(DOOR), 0, 0.92, 2.05, 1);
  pane(b, 'shop', ox - side * 1.6, 1.65, front + 0.04, 1.5, 1.2, 0, { color: 0xd8d8d4, variant: 1, lit: 2 });
  board(b, rng.pick(PANEL_TAGS), ox - side * 1, 3.1, front + 0.06, 3.2, 8, TRADE);
  pad(b, cx, front + 3, w, 6, mat(b, 'concrete', 0xbcb8ad));

  // Customers' cars lined up down the open side: some in primer, one with the bonnet colour wrong.
  const rowX = -side * (s.hw - 3.2);
  const x0 = Math.min(rowX, cx - side * (w / 2 + 1.2));
  const x1 = Math.max(rowX, cx - side * (w / 2 + 1.2));
  const primer = [...CAR_PAINT, 0x9a9a96, 0x9a9a96, 0x7a6a5a];
  if (x1 - x0 > 3) carRow(s, x0, x1, front - 3, 0, primer);
  const fa = cx + side * (w / 2 - 6.4);
  const fb = cx + side * (w / 2 - 0.4);
  carRow(s, Math.min(fa, fb), Math.max(fa, fb), s.hd - 3.6, 0, primer);

  // Decoration.
  for (let i = 0; i < bays; i++) if (b.spare()) glow(b, cx - side * (w / 2 - 2.6 - i * 4.4), 4.25, front + 0.1, 1.2, 0.14, WARM_LIGHT, 2);
  if (b.spare()) cyl(b, cx + side * w * 0.3, H, cz - d * 0.2, 0.3, 2.6, trim(b, 0x8a8d90), 8);
  if (b.spare(2)) {
    const tx = cx - side * (w / 2 - 0.5);
    cyl(b, tx, 0, front + 0.9, 0.34, 0.8, trim(b, 0x1c1c1c), 10);
    cyl(b, tx - side * 0.8, 0, front + 0.7, 0.34, 0.5, trim(b, 0x1c1c1c), 10);
  }
  yardJunk(s, cx + side * (w / 2 - 3), front + 5, 2);
  yardFence(s, cx - side * (w / 2 - 2));
};

// ───────────────────────────── Timber yard ─────────────────────────────

const timberYard: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(TIMBER_YARDS);
  const side = rng.pick(SIDES);
  const timber = mat(s, 'timber', 0xc9a66a);
  const pale = mat(s, 'timber', 0xdcc08a);
  const sheet = mat(s, 'corrugated', 0xa9a79d);

  // Trade counter: a weatherboard office at the front corner.
  const ow = 9;
  const od = 6;
  const ox = side * (s.hw - ow / 2 - 1.5);
  const oFront = s.hd - 3;
  const { h: o } = seat(s, ox - ow / 2, ox + ow / 2, oFront);
  const board1 = mat(o, 'weatherboard', rng.pick(HOUSE_PAINT));
  walls(o, ox, oFront - od / 2, ow, od, 3.1, board1);
  solid(o, ox, oFront - od / 2, ow, od, 3.1);
  roof(o, ox, 3.1, oFront - od / 2, ow, od, 1.3, mat(o, 'corrugated', rng.pick(IRON)), { gable: board1, eave: 0.3 });
  slope(o, ox, 2.9, oFront, ox, 2.55, oFront + 1.5, ow, 0.07, sheet);
  door(o, ox - side * 2.2, 0, oFront + 0.02, rng.pick(DOOR), 0, 0.95, 2.05, 1);
  pane(o, 'shop', ox + side * 1.2, 1.6, oFront + 0.04, 3.2, 1.3, 0, { color: 0xf3eddc, lit: 2 });
  board(o, wrap(name), ox, 3.75, oFront + 0.32, 3, 3, TRADE);

  // Open-fronted racking shed down the same side, stacked with sawn timber.
  const rl = Math.max(8, lot.depth - od - 9);
  const rz = oFront - od - 2 - rl / 2;
  const rx = side * (s.hw - 3.2);
  const { h: r } = seat(s, rx - 2, rx + 2, rz + rl / 2);
  slope(r, rx + side * 2.1, 4.6, rz, rx - side * 2.3, 5.4, rz, rl, 0.08, sheet);
  walls(r, rx + side * 2, rz, 0.1, rl, 4.6, mat(r, 'corrugated', rng.pick(CLADDING)));
  const posts = Math.max(3, Math.min(5, Math.round(rl / 4.5) + 1));
  for (let i = 0; i < posts; i++) {
    const pz = rz - rl / 2 + 0.2 + ((rl - 0.4) * i) / (posts - 1);
    const base = Math.min(-0.5, ground(r, rx - side * 1.9, pz) - 0.3);
    box(r, rx - side * 1.9, base, pz, 0.18, 5.3 - base, 0.18, timber);
  }
  r.out.collider(r.f, rx + side * 0.4, 2.2, rz, 3.4, 5.4, rl);
  const stacks = Math.max(3, Math.min(6, Math.floor(rl / 3)));
  for (let i = 0; i < stacks; i++) {
    const len = rng.range(3.6, Math.min(6, rl / 2));
    const z = rz - rl / 2 + 1 + len / 2 + rng.range(0, Math.max(0.1, rl - len - 2));
    const lvl = i % 3;
    box(r, rx + side * (0.9 - (i % 2) * 1.4), 0.15 + lvl * 1.35, z, rng.range(0.9, 1.3), rng.range(0.6, 1.1), len, i % 2 ? timber : pale);
  }

  // Loose packets in the yard and a saw shed at the back.
  for (let i = 0; i < 3; i++) {
    const px = -side * rng.range(2, s.hw - 3);
    const pz = rng.range(-s.hd + 9, s.hd - 9);
    box(s, px, ground(s, px, pz) + 0.12, pz, rng.range(1, 1.3), rng.range(0.5, 1.2), rng.range(3.6, 5.4), i % 2 ? pale : timber);
  }
  const sw = Math.min(11, lot.width * 0.34);
  const sx = -side * (s.hw - sw / 2 - 1.6);
  const sz = -s.hd + 1.6 + 3.5;
  const { h: g } = seat(s, sx - sw / 2, sx + sw / 2, sz + 3.5);
  const skin = mat(g, 'corrugated', rng.pick(CLADDING));
  walls(g, sx, sz, sw, 7, 4.4, skin);
  solid(g, sx, sz, sw, 7, 4.4);
  roof(g, sx, 4.4, sz, sw, 7, 0.9, sheet, { eave: 0.2 });
  bigDoor(g, sx, -0.3, sz + 3.52, 4, 3.9, 0x55606a, rng.chance(0.6));

  // Decoration.
  if (s.spare(4)) poleSign(s, -side * (s.hw - 2.5), s.hd - 1.2, 3.6, 3, 1, signMat(s, rng.pick(TIMBER_TAGS), 3, TRADE), Math.PI / 2);
  if (level(s) && s.spare()) pad(s, -side * 2.5, 0, lot.width - 13, lot.depth - 5, mat(s, 'gravel'), 0.03);
  yardJunk(s, -side * 4, s.hd - 7, 2);
  yardFence(s, -side * Math.min(4, s.hw - 6), 7);
};

// ───────────────────────────── Car yard ─────────────────────────────

const carYard: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const christchurch = lot.district.city === 'christchurch';
  const name = christchurch && rng.chance(0.3) ? 'MOORHOUSE MILE MOTORS' : rng.pick(CAR_YARDS);

  // Glass-fronted sales office at the back.
  const ow = Math.min(11, lot.width * 0.34);
  const od = 5.5;
  const oz = -s.hd + 2 + od / 2;
  const front = oz + od / 2;
  const { h: o } = seat(s, -ow / 2, ow / 2, front);
  const wall = mat(o, 'plaster', rng.pick(RENDER));
  walls(o, 0, oz, ow, od, 3.2, wall);
  solid(o, 0, oz, ow, od, 3.2);
  box(o, 0, 3.2, oz + 0.6, ow + 0.6, 0.2, od + 1.6, trim(o));
  pane(o, 'shop', -1, 1.5, front + 0.04, ow - 3.4, 2.4, 0, { color: 0x9da1a4, variant: 1, lit: 3 });
  pane(o, 'shopdoor', ow / 2 - 1.1, 1.2, front + 0.04, 1, 2.4, 0, { color: 0x9da1a4, variant: 2, lit: 3 });
  box(o, 0, 3.4, front - 0.2, Math.min(ow, 6.6), 1, 0.14, trim(o, 0x4a4d50));
  board(o, name, 0, 3.9, front - 0.11, Math.min(ow - 0.4, 6.2), 8, TRADE);

  // Two rows of stock facing the street, split by the drive-in.
  const gate = 2.6;
  for (const z of [s.hd - 3.4, s.hd - 9.8]) {
    if (z < front + 5) continue;
    carRow(s, -s.hw + 1.6, -gate, z, rng.range(-0.25, 0.25));
    carRow(s, gate, s.hw - 1.6, z, rng.range(-0.25, 0.25));
  }

  // Bunting strung between poles along the frontage, and the big sign on the corner.
  const zf = s.hd - 0.7;
  const spans = Math.max(2, Math.min(6, Math.round((lot.width - 2) / 7)));
  const pole = trim(s, 0xe8e6df);
  for (let i = 0; i <= spans; i++) {
    const px = -s.hw + 1 + ((lot.width - 2) * i) / spans;
    const gy = ground(s, px, zf);
    box(s, px, gy - 0.3, zf, 0.09, 4.9, 0.09, pole);
  }
  if (s.near) run(s, 'bunting', -s.hw + 1, zf, s.hw - 1, zf, 7);
  poleSign(s, rng.pick(SIDES) * (s.hw - 2.2), s.hd - 2, 4.8, 3.3, 1.1, signMat(s, wrap(rng.pick(CAR_TAGS)), 3, TRADE), Math.PI / 2);

  // Decoration.
  if (level(s) && s.spare()) pad(s, 0, 1.5, lot.width - 2, lot.depth - 4, mat(s, 'asphalt'), 0.03);
  if (s.spare(2)) {
    board(s, 'TRADE-INS', -s.hw + 2.6, ground(s, -s.hw + 2.6, s.hd - 1) + 0.6, s.hd - 1, 1.4, 3, TRADE);
    board(s, 'OPEN SAT', s.hw - 2.6, ground(s, s.hw - 2.6, s.hd - 1) + 0.6, s.hd - 1, 1.4, 3, TRADE);
  }
};

export const INDUSTRIAL: Archetype[] = [
  { name: 'works', weight: 5, build: works },
  { name: 'sawtooth-factory', weight: 1.6, build: factory },
  { name: 'wool-store', weight: 1.1, build: woolStore },
  { name: 'panel-beater', weight: 1.6, build: panelBeater },
  { name: 'timber-yard', weight: 1.1, build: timberYard },
  { name: 'car-yard', weight: 1.5, build: carYard, fit: (lot) => (lot.district.city === 'christchurch' ? 1.5 : 1) },
];
