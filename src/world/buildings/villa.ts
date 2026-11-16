import type { LotBuilder } from '../../core/types';
import {
  ALUMINIUM,
  type Archetype,
  BRICKS,
  DOOR,
  HOUSE_BUDGET,
  HOUSE_PAINT,
  IRON,
  type Mat,
  type Site,
  TILE,
  TRIM_PAINT,
  box,
  chimney,
  cyl,
  door,
  downpipe,
  ground,
  mat,
  pane,
  prism,
  roof,
  screen,
  seat,
  shade,
  site,
  slope,
  solid,
  tent,
  trim,
  walls,
  win,
  winRow,
} from './kit';
import { type FenceKind, type Plot, type YardStyle, yard } from './yard';

/**
 * Older suburbs (Merivale, St Albans, the Timaru hill streets): weatherboard bay villas with verandahs
 * and finials, square-fronted cottages, Californian bungalows, the odd stucco moderne and brick-and-tile.
 */

/** Where a house may go on its plot: centre line, the z its front-most wall may reach, and size limits. */
export interface Spot {
  ox: number;
  front: number;
  maxW: number;
  maxD: number;
}

export type HouseCore = (s: Site, spot: Spot) => Plot;

const SIDES = [-1, 1] as const;

/** A weatherboard house's paint: walls, and the trim colour its facings, bargeboards and verandah share. */
export function scheme(s: Site, paints: readonly number[] = HOUSE_PAINT) {
  const wall = s.rng.pick(paints);
  const trimColor = s.rng.pick(TRIM_PAINT);
  // A dark trim colour goes on the sashes too; with pale trim the sashes are usually white.
  const dark = ((trimColor >> 16) & 255) < 0x90;
  return { wall, trim: dark ? 0xf3eddc : trimColor, accent: trimColor, sash: dark ? trimColor : 0xf6f4ee };
}

/** What a timber house stands on: a band of base boards (or a concrete ring) between the ground and the floor. */
export function skirt(h: Site, cx: number, cz: number, w: number, d: number, fl: number, color: number) {
  if (h.spare()) walls(h, cx, cz, w + 0.05, d + 0.05, fl - 0.06, mat(h, 'timber', color));
}

/** Corner boards on a weatherboard box. */
export function cornerBoards(h: Site, cx: number, cz: number, w: number, d: number, y0: number, y1: number, color: number) {
  if (!h.spare(4)) return;
  const m = trim(h, color);
  for (const ex of SIDES) for (const ez of SIDES) box(h, cx + ex * (w / 2 - 0.02), y0, cz + ez * (d / 2 - 0.02), 0.11, y1 - y0, 0.11, m);
}

/** Verandah on turned posts: deck, sloping iron (optionally bullnosed), beam, posts, brackets and a frieze. */
export function houseVerandah(h: Site, x0: number, x1: number, z: number, depth: number, fl: number, wallTop: number, iron: Mat, bullnose: boolean, paint = 0xf3eddc, lace = true) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const zf = z + depth;
  const tr = trim(h, paint);
  walls(h, cx, z + depth / 2, w, depth, fl, mat(h, 'timber', 0x8a7a66));
  if (bullnose) {
    slope(h, cx, wallTop - 0.5, z, cx, fl + 2.72, zf - 0.35, w, 0.07, iron);
    slope(h, cx, fl + 2.72, zf - 0.35, cx, fl + 2.45, zf + 0.22, w, 0.07, iron);
  } else {
    slope(h, cx, wallTop - 0.45, z, cx, fl + 2.55, zf + 0.25, w, 0.07, iron);
  }
  box(h, cx, fl + 2.28, zf - 0.07, w, 0.2, 0.12, tr);
  const posts = w > 5.5 ? 4 : 3;
  for (let i = 0; i < posts; i++) {
    const px = x0 + 0.1 + ((w - 0.2) * i) / (posts - 1);
    box(h, px, fl, zf - 0.07, 0.11, 2.28, 0.11, tr);
    if (!lace || !h.spare(2)) continue;
    if (i > 0) screen(h, 'fret', px - 0.28, fl + 2.04, zf - 0.07, 0.46, 0.46, 0, paint, 2, 1);
    if (i < posts - 1) screen(h, 'fret', px + 0.28, fl + 2.04, zf - 0.07, 0.46, 0.46, 0, paint, 1, 2);
  }
  if (lace && h.spare()) screen(h, 'fret', cx, fl + 2.16, zf - 0.07, w - 0.2, 0.22, 0, paint, 0);
}

function steps(h: Site, x: number, z: number, fl: number, w = 1.5) {
  const stone = mat(h, 'concrete', 0xc4c0b4);
  const base = Math.min(-0.35, ground(h, x, z + 0.3) - 0.2);
  box(h, x, base, z + 0.2, w, fl * 0.55 - base, 0.4, stone);
  if (fl > 0.36 && h.spare()) box(h, x, base, z + 0.55, w, fl * 0.2 - base, 0.34, stone);
}

// ───────────────────────────── Bay villa ─────────────────────────────

export const bayVilla: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW, rng.range(10.4, 12.4));
  const p = 1.8; // bay projection = verandah depth
  const d = Math.max(6, Math.min(spot.maxD - p, rng.range(8.4, 10.2)));
  const F = spot.front - p;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.45;
  const top = fl + 3.3;
  const eave = 0.4;
  const pitch = 0.55;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const c = scheme(h);
  const wall = mat(h, 'weatherboard', c.wall);
  const iron = mat(h, 'corrugated', rng.pick(IRON));
  const tr = trim(h, c.trim);
  const bs = rng.pick(SIDES);
  const bw = Math.min(rng.range(3.9, 4.4), w * 0.42);
  const bx = ox + bs * (w / 2 - bw / 2 - eave);
  const gabled = rng.chance(0.55);
  const rise = pitch * (d / 2 + eave);
  h.j = { style: 'sash', variant: rng.chance(0.5) ? 1 : 0, frame: c.sash, trim: c.trim, wall: 'timber' };

  walls(h, ox, cz, w, d, top, wall);
  walls(h, bx, F + p / 2 - 0.25, bw, p + 0.5, top, wall);
  solid(h, ox, cz, w, d, top);
  if (gabled) roof(h, ox, top, cz, w, d, rise, iron, { gable: wall, eave, fascia: c.trim });
  else roof(h, ox, top, cz, w, d, rise, iron, { hip: d / 2, eave, fascia: c.trim });
  // The bay's gable runs back until it dies into the main roof.
  const brise = gabled ? Math.min(rise - 0.15, 0.82 * (bw / 2 + eave)) : 0.92 * pitch * (bw / 2 + eave);
  const bz0 = gabled ? cz : F - bw / 2 - 0.3;
  roof(h, bx, top, (F + p + bz0) / 2, bw, F + p - bz0, brise, iron, { axis: 'z', gable: wall, eave, fascia: c.trim });

  // Verandah from the bay to the far end, front door beside the bay.
  const bayInner = bx - (bs * bw) / 2;
  const farEnd = ox - (bs * w) / 2;
  houseVerandah(h, Math.min(bayInner, farEnd), Math.max(bayInner, farEnd), F, p, fl, top, iron, rng.chance(0.35), c.trim);
  const doorX = bayInner - bs * 1.15;
  door(h, doorX, fl, F + 0.02, rng.pick(DOOR), 0, 0.92, 2.1, 2);
  const span = Math.abs(farEnd - doorX);
  const sashes = span > 5 ? 2 : 1;
  for (let i = 0; i < sashes; i++) win(h, doorX + ((farEnd - doorX) * (i + 0.62)) / (sashes + 0.1), fl + 1.72, F, 1, 1.95, 0, 0.5);
  // The bay itself: a faceted window under its own little roof, or a pair of sashes flat on the gable wall.
  const zb = F + p;
  if (rng.chance(0.6)) {
    const a = Math.min(1.3, bw / 2 - 0.45);
    const k = 0.5;
    const pts: [number, number][] = [
      [bx - a, zb],
      [bx - a + k, zb + k],
      [bx + a - k, zb + k],
      [bx + a, zb],
    ];
    const hood = fl + 2.95;
    prism(h, pts, Math.min(-0.4, ground(h, bx, zb + k) - 0.3), hood, wall, tr);
    tent(h, [[bx - a - 0.12, zb], [bx - a + k - 0.08, zb + k + 0.14], [bx + a - k + 0.08, zb + k + 0.14], [bx + a + 0.12, zb]], hood, [bx, hood + 0.55, zb], iron);
    win(h, bx, fl + 1.72, zb + k, 2 * (a - k) - 0.3, 1.95, 0, 0.5);
    for (const e of SIDES) win(h, bx + e * (a - k / 2), fl + 1.72, zb + k / 2, 0.42, 1.95, (e * Math.PI) / 4, 0.5, false);
  } else {
    for (const e of SIDES) win(h, bx + e * 0.62, fl + 1.72, zb, 0.95, 1.95, 0, 0.5);
  }
  for (const side of SIDES) winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.7, ox + (side * w) / 2, cz - d / 2 + 1.7, fl + 1.72, 2, 1, 1.95, (side * Math.PI) / 2, { lit: 0.4, hood: true });
  chimney(h, ox - bs * w * 0.2, cz + 0.5, top, rise + 0.9, mat(h, 'brick'), true);
  chimney(h, ox + bs * w * 0.12, cz - d * 0.28, top, rise * 0.55 + 1, mat(h, 'brick'));
  steps(h, doorX, F + p, fl);
  skirt(h, ox, cz, w, d, fl, shade(c.wall, 0.78));
  cornerBoards(h, ox, cz, w, d, fl - 0.1, top, c.trim);

  // Decoration: a fretwork truss and a finial in the bay gable.
  if (h.spare(2)) {
    box(h, bx, top + brise - 0.15, zb + 0.06, 0.07, 1, 0.07, tr);
    screen(h, 'fret', bx, top + brise * 0.62, zb + 0.07, (bw + eave * 2) * 0.36, 0.3, 0, c.trim, 0);
  }
  if (h.spare()) downpipe(h, farEnd - bs * 0.1, F + 0.02, fl - 0.3, top - 0.1, 0, c.trim);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + p, back: F - d, doorX, doorZ: F + p + 0.75, floor };
};

// ───────────────────────────── Square-fronted villa / cottage ─────────────────────────────

export const cottage: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW, rng.range(8.4, 10.4));
  const p = 1.7;
  const d = Math.max(5.5, Math.min(spot.maxD - p, rng.range(7.6, 9.4)));
  const F = spot.front - p;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.45;
  const top = fl + 3.1;
  const eave = 0.4;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const c = scheme(h);
  const wall = mat(h, 'weatherboard', c.wall);
  const iron = mat(h, 'corrugated', rng.pick(IRON));
  const rise = 0.55 * (Math.min(w, d) / 2 + eave);
  h.j = { style: 'sash', variant: rng.chance(0.5) ? 1 : 0, frame: c.sash, trim: c.trim, wall: 'timber' };

  walls(h, ox, cz, w, d, top, wall);
  solid(h, ox, cz, w, d, top);
  if (w >= d) roof(h, ox, top, cz, w, d, rise, iron, { hip: d / 2, eave, fascia: c.trim });
  else roof(h, ox, top, cz, w, d, rise, iron, { axis: 'z', hip: w / 2, eave, fascia: c.trim });
  houseVerandah(h, ox - w / 2, ox + w / 2, F, p, fl, top, iron, rng.chance(0.5), c.trim);
  door(h, ox, fl, F + 0.02, rng.pick(DOOR), 0, 0.92, 2.1, 2);
  const wx = Math.max(1.45, w * 0.29);
  for (const side of SIDES) {
    win(h, ox + side * wx, fl + 1.65, F, Math.min(1, w * 0.14), 1.85, 0, 0.5);
    winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.6, ox + (side * w) / 2, cz - d / 2 + 1.6, fl + 1.65, d > 7 ? 2 : 1, 1, 1.85, (side * Math.PI) / 2, { lit: 0.4, hood: true });
  }
  chimney(h, ox - w * 0.22, cz, top, rise + 0.8, mat(h, 'brick'), true);
  if (rng.chance(0.6)) chimney(h, ox + w * 0.24, cz - d * 0.2, top, rise * 0.6 + 0.9, mat(h, 'brick'));
  steps(h, ox, F + p, fl);
  skirt(h, ox, cz, w, d, fl, shade(c.wall, 0.78));
  cornerBoards(h, ox, cz, w, d, fl - 0.1, top, c.trim);
  // A lean-to across the back, as every cottage grew one.
  const leanTo = rng.chance(0.6);
  const leanSide = rng.pick(SIDES);
  if (leanTo && h.spare(4)) {
    const lw = w * 0.6;
    const lx = ox + leanSide * (w - lw) * 0.5;
    walls(h, lx, cz - d / 2 - 1.2, lw, 2.4, fl + 2.3, wall);
    slope(h, lx, top - 0.5, cz - d / 2 + 0.05, lx, fl + 2.3, cz - d / 2 - 2.6, lw + 0.3, 0.07, iron);
  }
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + p, back: F - d, doorX: ox, doorZ: F + p + 0.75, floor };
};

// ───────────────────────────── Californian bungalow ─────────────────────────────

export const bungalow: HouseCore = (s, spot) => {
  const rng = s.rng;
  const eave = 0.65;
  const w = Math.min(spot.maxW - 0.6, rng.range(9.4, 11.2));
  const pd = 2.1; // porch depth
  const d = Math.max(6, Math.min(spot.maxD - pd, rng.range(9.6, 11.6)));
  const F = spot.front - pd;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.4;
  const top = fl + 2.75;
  const pitch = 0.42;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const c = scheme(h);
  const wall = mat(h, 'weatherboard', c.wall);
  const shingle = mat(h, 'weatherboard', rng.pick([0x7a5a40, 0x5f6a4a, 0x8a3a2a, 0x6a6258, 0x9a7a52]));
  const roofing = rng.chance(0.7) ? mat(h, 'corrugated', rng.pick(IRON)) : mat(h, 'rooftile', rng.pick(TILE));
  const tr = trim(h, c.trim);
  const rise = pitch * (w / 2 + eave);
  h.j = { style: 'casement', variant: 0, frame: c.sash, trim: c.trim, wall: 'timber' };

  // One broad low gable facing the street.
  walls(h, ox, cz, w, d, top, wall);
  solid(h, ox, cz, w, d, top);
  roof(h, ox, top, cz, w, d, rise, roofing, { axis: 'z', gable: shingle, eave, fascia: c.accent });

  // Gabled porch on squat piers to one side.
  const ps = rng.pick(SIDES);
  const pw = Math.min(3.9, w * 0.42);
  const px = ox + ps * (w / 2 - pw / 2 - 0.25);
  const pier = rng.chance(0.5) ? mat(h, 'brick') : mat(h, 'plaster', 0xe4dccb);
  walls(h, px, F + pd / 2, pw, pd, fl, mat(h, 'concrete', 0xc4c0b4));
  roof(h, px, top - 0.3, F + pd / 2, pw, pd + 0.6, pitch * (pw / 2 + 0.45), roofing, { axis: 'z', gable: shingle, eave: 0.45, fascia: c.accent });
  for (const side of SIDES) {
    const x = px + side * (pw / 2 - 0.3);
    box(h, x, -0.4, F + pd - 0.3, 0.55, fl + 1.4, 0.55, pier);
    box(h, x, fl + 1, F + pd - 0.3, 0.2, top - 0.52 - fl - 1, 0.2, tr);
    if (h.spare()) box(h, x, fl + 1, F + pd - 0.3, 0.66, 0.08, 0.66, mat(h, 'concrete', 0xc4c0b4));
  }
  box(h, px, top - 0.52, F + pd - 0.3, pw, 0.22, 0.22, tr);
  door(h, px, fl, F + 0.02, rng.pick(DOOR), 0, 1, 2.1, 1);

  // Bow window with a hood on the other side.
  const bx = ox - ps * w * 0.24;
  box(h, bx, fl + 0.5, F + 0.3, 2.7, 1.8, 0.6, wall);
  box(h, bx, fl + 2.3, F + 0.35, 3, 0.1, 0.8, roofing);
  win(h, bx, fl + 1.5, F + 0.6, 2.3, 1.25, 0, 0.5);
  if (h.spare(2)) for (const e of SIDES) win(h, bx + e * 1.35, fl + 1.5, F + 0.3, 0.42, 1.25, (e * Math.PI) / 2, 0.5, false);
  for (const side of SIDES) winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.8, ox + (side * w) / 2, cz - d / 2 + 1.8, fl + 1.5, 2, 1.3, 1.2, (side * Math.PI) / 2, { lit: 0.4, hood: true });
  chimney(h, ox - ps * (w / 2 - 0.7), cz + d * 0.1, top, 1.9, mat(h, 'brick'));
  steps(h, px, F + pd, fl, 1.4);
  skirt(h, ox, cz, w, d, fl, shade(c.wall, 0.78));
  cornerBoards(h, ox, cz, w, d, fl - 0.1, top, c.trim);

  // Decoration: gable vent, sidelight, brackets under the deep eaves.
  if (h.spare()) pane(h, 'louvre', ox, top + rise * 0.48, F + 0.03, 0.7, 0.55, 0, { color: c.accent });
  if (h.spare()) win(h, px - ps * 0.95, fl + 1.45, F, 0.45, 1.1, 0, 0.5, false);
  if (h.spare(3)) for (const t of [-0.6, 0, 0.6]) slope(h, ox + t * (w / 2), top + rise * (1 - Math.abs(t)) - 0.32, F - 0.02, ox + t * (w / 2), top + rise * (1 - Math.abs(t)) - 0.12, F + eave - 0.05, 0.1, 0.12, tr);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + pd, back: F - d, doorX: px, doorZ: F + pd + 0.75, floor };
};

// ───────────────────────────── Brick and tile ─────────────────────────────

export const brickTile: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW - 0.4, rng.range(11, 13.4));
  const wp = 2.6; // how far the front wing projects
  const d = Math.max(5.5, Math.min(spot.maxD - wp, rng.range(7.2, 8.2)));
  const F = spot.front - wp;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.3;
  const top = fl + 2.45;
  const eave = 0.5;
  const pitch = 0.5;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const wall = mat(h, 'brick', rng.pick(BRICKS));
  const tile = mat(h, 'rooftile', rng.pick(TILE));
  const ws = rng.pick(SIDES);
  const ww = Math.min(4.8, w * 0.4);
  const wx = ox + ws * (w / 2 - ww / 2 - eave);
  const alu = rng.chance(0.6);
  const fascia = rng.pick([0xf3eddc, 0x5a4634, 0x2f4a3a, 0xf6f4ee]);
  h.j = { style: alu ? 'alu' : 'casement', variant: 0, frame: alu ? ALUMINIUM : 0xf6f4ee, trim: 0xf6f4ee, wall: 'masonry', sill: mat(h, 'brick', 0xb9a090) };

  // L plan under hipped tiles.
  walls(h, ox, cz, w, d, top, wall);
  walls(h, wx, F + wp / 2 - 0.25, ww, wp + 0.5, top, wall);
  solid(h, ox, cz, w, d, top);
  roof(h, ox, top, cz, w, d, pitch * (d / 2 + eave), tile, { hip: d / 2, eave, fascia });
  const z0 = F - ww / 2 - 0.3;
  roof(h, wx, top, (F + wp + z0) / 2, ww, F + wp - z0, 0.92 * pitch * (ww / 2 + eave), tile, { axis: 'z', hip: ww / 2, eave, fascia });

  // Door in the angle under a flat canopy; wide windows.
  const doorX = wx - ws * (ww / 2 + 0.95);
  const farEnd = ox - (ws * w) / 2;
  const pb = Math.min(-0.35, ground(h, doorX, F + 1.2) - 0.2);
  box(h, doorX, pb, F + 0.6, 1.8, fl - pb, 1.2, mat(h, 'concrete', 0xc4c0b4));
  box(h, doorX, fl + 2.12, F + 0.65, 2, 0.09, 1.3, trim(h, fascia));
  door(h, doorX, fl, F + 0.02, rng.pick(DOOR), 0, 0.92, 2.03, 1);
  win(h, wx, fl + 1.42, F + wp, Math.min(2.4, ww - 1.4), 1.35, 0, 0.5);
  const span = Math.abs(farEnd - doorX) - 0.6;
  const count = span > 6.2 ? 2 : 1;
  for (let i = 0; i < count; i++) win(h, doorX + ((farEnd - doorX) * (i + 0.62)) / (count + 0.1), fl + 1.42, F, Math.min(1.9, span / count - 1), 1.3, 0, 0.5);
  for (const side of SIDES) winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.6, ox + (side * w) / 2, cz - d / 2 + 1.6, fl + 1.42, 2, 1.5, 1.2, (side * Math.PI) / 2, 0.4);
  chimney(h, ox - ws * w * 0.2, cz - 0.6, top, pitch * (d / 2 + eave) + 0.5, wall);
  if (h.spare()) box(h, doorX - ws * 0.9, fl, F + 1.2, 0.06, 2.12, 0.06, trim(h, 0x2a2c2e));
  // Concrete foundation showing under the brick, and a downpipe in the angle.
  if (h.spare()) walls(h, ox, cz, w + 0.04, d + 0.04, fl - 0.05, mat(h, 'concrete', 0xb7b3a8));
  if (h.spare()) downpipe(h, farEnd - ws * 0.15, F + 0.02, fl - 0.3, top - 0.1, 0, fascia);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + wp, back: F - d, doorX, doorZ: F + 1.5, floor };
};

// ───────────────────────────── Stucco moderne ─────────────────────────────

export const moderne: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW, rng.range(9.4, 11.4));
  const r = 1.7; // radius of the round sun-room bay
  const d = Math.max(5.5, Math.min(spot.maxD - r, rng.range(7.8, 9.2)));
  const F = spot.front - r;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.3;
  const top = fl + 3;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const wall = mat(h, 'plaster', rng.pick([0xf2ede0, 0xe9dfd0, 0xeed6c8, 0xd8e2d0, 0xf0e2a8]));
  const accentColor = rng.pick([0x1f4a4a, 0x8a2f2a, 0x2b4a6b, 0x3a3f44, 0x2f5d3a]);
  const accent = trim(h, accentColor);
  h.j = { style: 'alu', variant: 0, frame: accentColor, trim: 0xf6f4ee, wall: 'masonry' };

  // Flat-roofed box with a coping, and a faceted bay wrapped in a ribbon of steel windows.
  walls(h, ox, cz, w, d, top, wall);
  solid(h, ox, cz, w, d, top);
  box(h, ox, top, cz, w + 0.08, 0.1, d + 0.08, mat(h, 'concrete', 0x8f8b82));
  const bs = rng.pick(SIDES);
  const bx = ox + bs * (w / 2 - r - 0.3);
  const base = Math.min(-0.6, ground(h, bx, F + r) - 0.3);
  cyl(h, bx, base, F, r, top - 0.35 - base, wall, 12);
  cyl(h, bx, top - 0.35, F, r + 0.08, 0.1, accent, 12);
  // The ribbon: one pane per facet round the front half of the drum.
  const facet = 2 * r * Math.sin(Math.PI / 12);
  const apothem = r * Math.cos(Math.PI / 12);
  for (let i = -2; i <= 3; i++) {
    const a = ((i - 0.5) * Math.PI) / 6;
    pane(h, 'casement', bx + Math.sin(a) * (apothem + 0.015), fl + 1.45, F + Math.cos(a) * (apothem + 0.015), facet - 0.02, 1.2, a, { color: accentColor, variant: 2, lit: 2 });
  }

  const doorX = bx - bs * (r + 0.9);
  const farEnd = ox - (bs * w) / 2;
  door(h, doorX, fl, F + 0.02, rng.pick(DOOR), 0, 0.92, 2.03, 1);
  box(h, doorX, fl + 2.2, F + 0.55, 1.9, 0.1, 1.1, accent);
  const pb = Math.min(-0.35, ground(h, doorX, F + 1) - 0.2);
  box(h, doorX, pb, F + 0.5, 1.5, fl - pb, 0.9, mat(h, 'concrete', 0xc4c0b4));
  const span = Math.abs(farEnd - doorX) - 0.6;
  if (span > 2) win(h, (doorX - bs * 0.6 + farEnd) / 2, fl + 1.5, F, Math.min(2.2, span - 1), 1.2, 0, 0.5);
  for (const side of SIDES) winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.5, ox + (side * w) / 2, cz - d / 2 + 1.5, fl + 1.5, 2, 1.6, 1.1, (side * Math.PI) / 2, 0.4);

  // Decoration: speed stripes and a porthole.
  const flat = Math.abs(farEnd - (bx - bs * r)) - 0.4;
  if (flat > 1.5 && h.spare(3)) {
    for (let i = 0; i < 3; i++) box(h, (bx - bs * r + farEnd) / 2, top - 0.5 - i * 0.17, F + 0.02, flat, 0.06, 0.05, accent);
  }
  if (span > 3 && h.spare()) pane(h, 'glass', doorX - bs * 1.05, fl + 1.6, F + 0.02, 0.5, 0.5, 0, { lit: 1 });
  if (h.spare()) downpipe(h, farEnd - bs * 0.15, F + 0.02, fl - 0.3, top, 0, 0xe4dccb);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + r, back: F - d, doorX, doorZ: F + 1.15, floor };
};

// ───────────────────────────── Lots ─────────────────────────────

const pickFence = (s: Site, kinds: readonly FenceKind[]) => s.rng.pick(kinds);

export function villaYard(s: Site): YardStyle {
  const r = s.rng;
  return {
    fence: pickFence(s, ['picket', 'picket', 'picket', 'block', 'brick', 'hedge', 'hedge', 'paling', 'none']),
    fenceTint: r.pick([0xffffff, 0xffffff, 0xe6dcc0, 0xc9bfa8]),
    drive: r.chance(0.82) ? r.pick(SIDES) : 0,
    driveKind: r.pick(['slab', 'strips', 'slab', 'gravel'] as const),
    shelter: r.pick(['garage', 'garage', 'carport', 'none'] as const),
    shed: r.chance(0.5) ? mat(s, 'weatherboard', r.pick(HOUSE_PAINT)) : mat(s, 'corrugated', 0xb9b4a8),
    shedRoof: mat(s, 'corrugated', r.pick(IRON)),
    washing: r.chance(0.85),
    planting: r.range(0.45, 1),
    boundary: true,
  };
}

/** A detached house on its section: pick the garden, fit the house beside the drive, then lay the garden out. */
export function houseLot(core: HouseCore, style: (s: Site) => YardStyle, setback: readonly [number, number] = [4.8, 7.2]): LotBuilder {
  return (lot, out, rng) => {
    const s = site(lot, out, rng, HOUSE_BUDGET);
    const y = style(s);
    if (lot.width - 4.9 < 7.4) y.drive = 0;
    const near = 1.2;
    const far = y.drive !== 0 ? 3.7 : 1.2;
    const back = rng.range(setback[0], setback[1]);
    const plot = core(s, { ox: (-y.drive * (far - near)) / 2, front: s.hd - back, maxW: lot.width - near - far, maxD: lot.depth - back - 3.5 });
    yard(s, plot, y);
  };
}

export const VILLA: Archetype[] = [
  { name: 'bay-villa', weight: 5, build: houseLot(bayVilla, villaYard), fit: (lot) => (lot.width < 14.5 ? 0 : 1) },
  { name: 'cottage', weight: 2, build: houseLot(cottage, villaYard) },
  { name: 'bungalow', weight: 3.2, build: houseLot(bungalow, villaYard) },
  {
    name: 'brick-and-tile',
    weight: 1.6,
    build: houseLot(brickTile, (s) => ({ ...villaYard(s), fence: s.rng.pick(['block', 'brick', 'brick', 'hedge', 'none'] as const), driveKind: 'slab' })),
    fit: (lot) => (lot.width < 15 ? 0 : 1),
  },
  { name: 'moderne', weight: 0.6, build: houseLot(moderne, (s) => ({ ...villaYard(s), fence: s.rng.pick(['block', 'block', 'hedge', 'none'] as const) })) },
];
