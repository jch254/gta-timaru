import { ALUMINIUM, type Archetype, BRICKS, DOOR, IRON, type Mat, type Site, TILE, box, chimney, cyl, door, downpipe, ground, mat, pane, raised, roof, seat, shade, slope, solid, trim, walls, win, winRow } from './kit';
import { type HouseCore, cornerBoards, houseLot } from './villa';
import type { YardStyle } from './yard';

/**
 * State-house suburbs (Linwood, Waltham, the Timaru flats): plain, well-built 1940s–50s houses in
 * weatherboard, brick veneer or stucco under hipped tile roofs, with a small porch, a hedge and two
 * concrete strips for a drive. At New Brighton the same streets are mostly fibrolite baches.
 */

const STATE_PAINT = [0xf1ead8, 0xe9e2c8, 0xd8e2d0, 0xcfdde6, 0xf0dcc8, 0xf0e6b4, 0xdcd6cc, 0xc6d4be, 0xe6d2d0];
const SIDES = [-1, 1] as const;

interface Cladding {
  wall: Mat;
  /** Weatherboard for gable ends (brick houses still have timber gables). */
  gable: Mat;
  roof: Mat;
  /** Paint on fascias, porch and joinery. */
  trim: number;
  boards: boolean;
}

function cladding(h: Site): Cladding {
  const rng = h.rng;
  const kind = rng.pick(['board', 'board', 'board', 'brick', 'brick', 'stucco'] as const);
  const paint = rng.pick(STATE_PAINT);
  const board = mat(h, 'weatherboard', paint);
  const trimColor = rng.pick([0xf6f4ee, 0xf6f4ee, 0xf3eddc, 0x2f4a3a, 0x6a2a24]);
  h.j = { style: 'casement', variant: 0, frame: 0xf6f4ee, trim: trimColor, wall: kind === 'board' ? 'timber' : 'masonry', sill: kind === 'brick' ? mat(h, 'brick', 0xb9a090) : undefined };
  return {
    wall: kind === 'board' ? board : kind === 'brick' ? mat(h, 'brick', rng.pick(BRICKS)) : mat(h, 'plaster', paint),
    gable: board,
    roof: rng.chance(0.85) ? mat(h, 'rooftile', rng.pick(TILE)) : mat(h, 'corrugated', rng.pick(IRON)),
    trim: trimColor,
    boards: kind === 'board',
  };
}

/** The concrete foundation ring every state house sits on. */
function foundation(h: Site, cx: number, cz: number, w: number, d: number, fl: number) {
  if (!h.spare()) return;
  walls(h, cx, cz, w + 0.05, d + 0.05, fl - 0.08, mat(h, 'concrete', 0xb7b3a8));
  // Cast vents to the space under the floor, along the front and down each side.
  if (!h.spare(2) || fl < 0.4) return;
  for (const t of [-0.3, 0.3]) {
    pane(h, 'fitting', cx + t * w, fl - 0.27, cz + d / 2 + 0.035, 0.36, 0.15, 0, { color: 0x5a5852, variant: 1 });
    for (const e of SIDES) pane(h, 'fitting', cx + e * (w / 2 + 0.035), fl - 0.27, cz + t * d, 0.36, 0.15, (e * Math.PI) / 2, { color: 0x5a5852, variant: 1 });
  }
}

/** Concrete landing and a flat or gabled hood over a front door at (x, F). */
function porch(h: Site, x: number, F: number, fl: number, c: Cladding, gabled: boolean) {
  const base = Math.min(-0.35, ground(h, x, F + 1.1) - 0.2);
  box(h, x, base, F + 0.55, 1.7, fl - base, 1.1, mat(h, 'concrete', 0xc4c0b4));
  if (gabled) roof(h, x, fl + 2.1, F + 0.6, 1.9, 1.2, 0.5, c.roof, { axis: 'z', gable: c.gable, eave: 0.1, bare: true });
  else box(h, x, fl + 2.12, F + 0.62, 1.9, 0.08, 1.25, trim(h, c.trim));
  if (h.spare()) box(h, x + 0.8, fl, F + 1.05, 0.05, gabled ? 2.1 : 2.12, 0.05, trim(h, 0x3a3f44));
  if (h.spare()) box(h, x, base, F + 1.3, 1.3, fl * 0.5 - base, 0.4, mat(h, 'concrete', 0xc4c0b4));
}

// ───────────────────────────── The standard state house ─────────────────────────────

export const stateHouse: HouseCore = (s, spot) => {
  const rng = s.rng;
  const form = rng.pick(['hip', 'hip', 'gable', 'wing', 'wing'] as const);
  const wp = form === 'wing' ? 1.5 : 0;
  const reach = Math.max(wp, 1.15);
  const w = Math.min(spot.maxW - 0.2, rng.range(9.2, 11));
  const d = Math.max(5.5, Math.min(spot.maxD - reach, rng.range(6.8, 7.6)));
  const F = spot.front - reach;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.5;
  const top = fl + 2.5;
  const eave = 0.45;
  const pitch = 0.52;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const c = cladding(h);
  const rise = pitch * (d / 2 + eave);

  walls(h, ox, cz, w, d, top, c.wall);
  solid(h, ox, cz, w, d, top);
  if (form === 'gable') roof(h, ox, top, cz, w, d, rise, c.roof, { gable: c.gable, eave, fascia: c.trim });
  else roof(h, ox, top, cz, w, d, rise, c.roof, { hip: d / 2, eave, fascia: c.trim });

  let doorX = ox + rng.range(-0.16, 0.16) * w;
  let left: [number, number] = [ox - w / 2, doorX - 0.6];
  let right: [number, number] = [doorX + 0.6, ox + w / 2];
  if (form === 'wing') {
    // Short front wing with its gable to the street, door in the angle.
    const ws = rng.pick(SIDES);
    const ww = Math.min(3.9, w * 0.4);
    const wx = ox + ws * (w / 2 - ww / 2 - eave);
    const z0 = F - ww / 2 - 0.3;
    walls(h, wx, F + wp / 2 - 0.25, ww, wp + 0.5, top, c.wall);
    roof(h, wx, top, (F + wp + z0) / 2, ww, F + wp - z0, 0.92 * pitch * (ww / 2 + eave), c.roof, { axis: 'z', gable: c.gable, eave, fascia: c.trim });
    win(h, wx, fl + 1.5, F + wp, Math.min(1.8, ww - 1.4), 1.25, 0, 0.5);
    doorX = wx - ws * (ww / 2 + 0.95);
    const inner = wx - (ws * ww) / 2;
    const span: [number, number] = ws > 0 ? [ox - w / 2, doorX - 0.6] : [doorX + 0.6, ox + w / 2];
    left = span;
    right = [inner, inner];
  }
  porch(h, doorX, F, fl, c, rng.chance(0.3));
  door(h, doorX, fl, F + 0.02, rng.pick(DOOR), 0, 0.92, 2.03);
  for (const [a, b] of [left, right]) {
    const span = b - a;
    if (span < 2.3) continue;
    const count = span > 5.6 ? 2 : 1;
    for (let i = 0; i < count; i++) win(h, a + (span * (i + 0.5)) / count, fl + 1.5, F, Math.min(1.6, span / count - 1.1), 1.25, 0, 0.5);
  }
  for (const side of SIDES) winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.5, ox + (side * w) / 2, cz - d / 2 + 1.5, fl + 1.5, 2, 1.2, 1.2, (side * Math.PI) / 2, 0.4);
  chimney(h, ox + rng.pick(SIDES) * w * 0.2, cz - d * 0.12, top, rise * 0.75 + 0.8, mat(h, 'brick'), true);
  foundation(h, ox, cz, w, d, fl);
  if (c.boards) cornerBoards(h, ox, cz, w, d, fl - 0.1, top, c.trim);
  const pipeSide = rng.pick(SIDES);
  if (h.spare()) downpipe(h, ox + (w / 2 - 0.12) * pipeSide, F + 0.02, fl - 0.4, top - 0.1, 0, c.trim);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + reach, back: F - d, doorX, doorZ: F + 1.55, floor };
};

// ───────────────────────────── Semi-detached pair ─────────────────────────────

export const stateDuplex: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW - 0.2, rng.range(13.4, 15.6));
  const d = Math.max(5.5, Math.min(spot.maxD - 1.15, rng.range(7, 7.8)));
  const F = spot.front - 1.15;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.5;
  const top = fl + 2.5;
  const eave = 0.45;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const c = cladding(h);
  const rise = 0.52 * (d / 2 + eave);

  walls(h, ox, cz, w, d, top, c.wall);
  solid(h, ox, cz, w, d, top);
  roof(h, ox, top, cz, w, d, rise, c.roof, { hip: d / 2, eave, fascia: c.trim });
  // Mirror-image halves: doors at the outer ends or paired in the middle.
  const outer = rng.chance(0.55);
  const dx = outer ? w / 2 - 1.5 : 1;
  const gabled = rng.chance(0.3);
  const paint = rng.pick(DOOR);
  for (const side of SIDES) {
    porch(h, ox + side * dx, F, fl, c, gabled);
    door(h, ox + side * dx, fl, F + 0.02, paint, 0, 0.92, 2.03, 0);
    const a = outer ? 0.5 : dx + 1;
    const b = outer ? dx - 1 : w / 2 - 0.5;
    win(h, ox + side * (a + (b - a) * 0.3), fl + 1.5, F, Math.min(1.5, (b - a) * 0.36), 1.25, 0, 0.5);
    win(h, ox + side * (a + (b - a) * 0.76), fl + 1.5, F, Math.min(1.5, (b - a) * 0.36), 1.25, 0, 0.5);
    winRow(h, ox + (side * w) / 2, cz + d / 2 - 1.5, ox + (side * w) / 2, cz - d / 2 + 1.5, fl + 1.5, 2, 1.2, 1.2, (side * Math.PI) / 2, 0.4);
    chimney(h, ox + side * w * 0.16, cz - d * 0.1, top, rise * 0.8 + 0.8, mat(h, 'brick'), true);
  }
  foundation(h, ox, cz, w, d, fl);
  if (c.boards) cornerBoards(h, ox, cz, w, d, fl - 0.1, top, c.trim);
  // The party line shows as a downpipe up the middle of the front.
  if (h.spare()) downpipe(h, ox, F + 0.02, fl - 0.4, top - 0.1, 0, c.trim);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + 1.15, back: F - d, doorX: ox - dx, doorZ: F + 1.55, floor };
};

// ───────────────────────────── Two-storey block of four flats ─────────────────────────────

export const stateFlats: HouseCore = (s, spot) => {
  const rng = s.rng;
  const w = Math.min(spot.maxW - 0.2, rng.range(12, 14.5));
  const d = Math.max(5.5, Math.min(spot.maxD - 1.15, rng.range(7.2, 7.8)));
  const F = spot.front - 1.15;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.4;
  const upper = fl + 2.75;
  const top = fl + 5.3;
  const eave = 0.45;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const brick = rng.chance(0.6);
  const wall = brick ? mat(h, 'brick', rng.pick(BRICKS)) : mat(h, 'plaster', rng.pick(STATE_PAINT));
  const tile = mat(h, 'rooftile', rng.pick(TILE));
  const rise = 0.5 * (d / 2 + eave);
  const alu = rng.chance(0.4);
  h.j = { style: alu ? 'alu' : 'casement', variant: 0, frame: alu ? ALUMINIUM : 0xf6f4ee, trim: 0xf6f4ee, wall: 'masonry', sill: brick ? mat(h, 'brick', 0xb9a090) : undefined };

  walls(h, ox, cz, w, d, top, wall);
  solid(h, ox, cz, w, d, top);
  roof(h, ox, top, cz, w, d, rise, tile, { hip: d / 2, eave });
  // Two stair entries, each serving a flat up and a flat down.
  const paint = rng.pick(DOOR);
  for (const side of SIDES) {
    const ex = ox + (side * w) / 4;
    const base = Math.min(-0.35, ground(h, ex, F + 1) - 0.2);
    box(h, ex, base, F + 0.5, 1.6, fl - base, 1, mat(h, 'concrete', 0xc4c0b4));
    box(h, ex, fl + 2.15, F + 0.55, 1.8, 0.09, 1.1, trim(h));
    door(h, ex, fl, F + 0.02, paint, 0, 0.92, 2.03, 1);
    win(h, ex, upper + 1.3, F, 0.7, 1.7, 0, 0.6, false);
    for (const y of [fl + 1.45, upper + 1.45]) {
      win(h, ox + side * (w / 2 - 1.5), y, F, 1.5, 1.25, 0, 0.5);
      win(h, ox + side * Math.max(0.85, w / 4 - 2.1), y, F, 1.3, 1.25, 0, 0.5, false);
      win(h, ox + (side * w) / 2, y, cz, 1.3, 1.2, (side * Math.PI) / 2, 0.4, false);
    }
    chimney(h, ox + side * w * 0.3, cz - d * 0.1, top, rise * 0.7 + 0.8, mat(h, 'brick'));
  }
  if (h.spare()) box(h, ox, upper - 0.1, F + 0.03, w + 0.04, 0.16, 0.08, trim(h));
  if (h.spare()) downpipe(h, ox, F + 0.02, fl - 0.4, top - 0.1, 0, 0xe4dccb);
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + 1.15, back: F - d, doorX: ox - w / 4, doorZ: F + 1.4, floor };
};

// ───────────────────────────── Fibrolite bach ─────────────────────────────

const BACH_PAINT = [0xe8d8c8, 0xcfe0d8, 0xd6e2ec, 0xf0e6b8, 0xe6c8c0, 0xdfe8d0, 0xf2ede0, 0xbfd8d8, 0xe8c9a0];

/** Seaside bach: fibrolite sheets and cover battens on a light frame, a low iron roof, a glazed sun porch across the front. */
export const bach: HouseCore = (s, spot) => {
  const rng = s.rng;
  const pd = 1.9; // sun porch depth
  const w = Math.min(spot.maxW - 0.4, rng.range(6.8, 8.8));
  const d = Math.max(4.6, Math.min(spot.maxD - pd, rng.range(5.2, 6.6)));
  const F = spot.front - pd;
  const ox = spot.ox;
  const cz = F - d / 2;
  const fl = 0.4;
  const top = fl + 2.35;
  const { h, floor } = seat(s, ox - w / 2, ox + w / 2, spot.front);
  const paint = rng.pick(BACH_PAINT);
  const wall = mat(h, 'plaster', paint);
  const trimColor = rng.pick([0xf6f4ee, 0xf6f4ee, 0x2f5d6a, 0x8a2f2a, 0x2f5d3a, 0xe8c23a]);
  const tr = trim(h, trimColor);
  const iron = mat(h, 'corrugated', rng.pick([0x8f959a, 0xa9a79d, 0x8b3027, 0x35603f, 0x9a8a7a]));
  const gabled = rng.chance(0.45);
  h.j = { style: 'casement', variant: 0, frame: 0xf6f4ee, trim: trimColor, wall: 'timber' };

  // Living box on piles, with the roof either a shallow gable or a single fall to the back.
  walls(h, ox, cz, w, d, top, wall);
  solid(h, ox, cz + pd / 2, w, d + pd, top);
  if (gabled) roof(h, ox, top, cz, w, d, 0.9, iron, { gable: wall, eave: 0.3, fascia: trimColor });
  else {
    slope(h, ox, top + 0.75, F + pd + 0.3, ox, top + 0.05, cz - d / 2 - 0.3, w + 0.5, 0.08, iron);
    box(h, ox, top, F - 0.1, w, 0.7, 0.2, wall);
    if (h.spare()) box(h, ox, top + 0.56, F + pd + 0.3, w + 0.5, 0.18, 0.05, tr);
  }
  // Sun porch: a lean-to glazed from end to end above a fibrolite dado.
  const pTop = gabled ? top - 0.25 : top + 0.5;
  walls(h, ox, F + pd / 2, w, pd, fl + 0.95, wall);
  if (gabled) slope(h, ox, top - 0.05, F, ox, pTop - 0.05, F + pd + 0.25, w + 0.3, 0.07, iron);
  const side = rng.pick(SIDES);
  const glazed = w - 1.5;
  const lights = Math.max(3, Math.round(glazed / 0.75));
  pane(h, 'casement', ox - side * 0.6, (fl + 0.95 + pTop - 0.15) / 2, F + pd + 0.01, glazed, pTop - 0.15 - fl - 0.95, 0, { nx: lights, color: 0xf6f4ee, variant: 0, lit: 2 });
  for (const e of SIDES) {
    box(h, ox + e * (w / 2 - 0.06), fl + 0.95, F + pd - 0.06, 0.12, pTop - 0.1 - fl - 0.95, 0.12, tr);
    pane(h, 'casement', ox + e * (w / 2 + 0.01), (fl + 0.95 + pTop - 0.15) / 2, F + pd / 2, pd - 0.3, pTop - 0.15 - fl - 0.95, (e * Math.PI) / 2, { nx: 2, color: 0xf6f4ee, variant: 0, lit: 2 });
  }
  box(h, ox, pTop - 0.15, F + pd - 0.06, w, 0.14, 0.12, tr);
  const doorX = ox + side * (w / 2 - 0.65);
  door(h, doorX, fl, F + pd + 0.01, rng.pick(DOOR), 0, 0.82, 2, 1);
  const base = Math.min(-0.3, ground(h, doorX, F + pd + 0.7) - 0.2);
  box(h, doorX, base, F + pd + 0.4, 1.2, fl * 0.6 - base, 0.7, mat(h, 'timber', 0x8a7a66));

  // Cover battens over the sheet joints, piles showing under the floor.
  const battens = Math.max(2, Math.round(w / 1.2));
  if (h.spare(battens * 2)) {
    const bm = trim(h, shade(paint, 0.9));
    for (let i = 1; i < battens; i++) {
      const x = ox - w / 2 + (w * i) / battens;
      box(h, x, fl, F + pd + 0.012, 0.045, 0.95, 0.02, bm);
      box(h, x, fl, cz - d / 2 - 0.012, 0.045, top - fl, 0.02, bm);
    }
    for (const e of SIDES) for (const t of [-0.3, 0.1, 0.4]) box(h, ox + e * (w / 2 + 0.012), fl, cz + t * d, 0.02, top - fl, 0.045, bm);
  }
  if (h.spare()) walls(h, ox, cz + pd / 2, w - 0.3, d + pd - 0.3, fl - 0.12, trim(h, 0x4a443c));
  for (const e of SIDES) win(h, ox + (e * w) / 2, fl + 1.45, cz - d * 0.1, 1.2, 1, (e * Math.PI) / 2, 0.45);
  win(h, ox - side * w * 0.2, fl + 1.5, cz - d / 2, 1.1, 0.9, Math.PI, 0.4);

  // Flue for the pot-belly, and the tank that catches the roof water.
  if (h.spare(2)) {
    cyl(h, ox - side * w * 0.25, top + 0.1, cz - d * 0.15, 0.08, 1.5, trim(h, 0x3a3f44), 6);
    cyl(h, ox - side * w * 0.25, top + 1.6, cz - d * 0.15, 0.16, 0.1, trim(h, 0x3a3f44), 6, 0.05);
  }
  const tx = ox - side * (w / 2 + 1.05);
  if (Math.abs(tx) + 1 < h.hw && rng.chance(0.7)) {
    const t = raised(h, ground(h, tx, cz - d * 0.25));
    box(t, tx, -0.3, cz - d * 0.25, 1.7, 0.9, 1.7, mat(t, 'timber', 0x6f5a44));
    cyl(t, tx, 0.6, cz - d * 0.25, 0.85, 1.7, mat(t, 'corrugated', 0xa9a79d), 10);
    t.out.collider(t.f, tx, 1.1, cz - d * 0.25, 1.7, 2.6, 1.7);
  }
  return { x0: ox - w / 2, x1: ox + w / 2, front: F + pd, back: F - d, doorX, doorZ: F + pd + 0.85, floor };
};

// ───────────────────────────── Lots ─────────────────────────────

export function stateYard(s: Site): YardStyle {
  const r = s.rng;
  return {
    fence: r.pick(['hedge', 'hedge', 'rail', 'rail', 'block', 'paling', 'none', 'none'] as const),
    fenceTint: r.pick([0xffffff, 0xdfe8d0, 0xc8d8b8]),
    drive: r.chance(0.62) ? r.pick(SIDES) : 0,
    driveKind: r.pick(['strips', 'strips', 'strips', 'slab', 'gravel'] as const),
    shelter: r.pick(['garage', 'none', 'none', 'carport'] as const),
    shed: r.chance(0.5) ? mat(s, 'weatherboard', r.pick(STATE_PAINT)) : mat(s, 'corrugated', 0xb9b4a8),
    shedRoof: mat(s, 'corrugated', r.pick(IRON)),
    washing: r.chance(0.95),
    planting: r.range(0.15, 0.6),
    boundary: true,
  };
}

const sharedYard = (s: Site): YardStyle => ({ ...stateYard(s), drive: 0, shelter: 'none' });

function bachYard(s: Site): YardStyle {
  const r = s.rng;
  return {
    fence: r.pick(['rail', 'paling', 'none', 'none', 'picket', 'wire'] as const),
    fenceTint: r.pick([0xffffff, 0xd8d0c0]),
    drive: r.chance(0.5) ? r.pick(SIDES) : 0,
    driveKind: 'gravel',
    shelter: r.pick(['none', 'none', 'carport', 'garage'] as const),
    shed: mat(s, 'corrugated', r.pick([0xb9b4a8, 0x9aa0a4, 0x8a7a66])),
    shedRoof: mat(s, 'corrugated', 0x8f959a),
    washing: r.chance(0.9),
    planting: r.range(0.05, 0.4),
    boundary: r.chance(0.6),
  };
}

/** New Brighton's streets, where the baches are. */
const seaside = (name: string) => /brighton|beach|sumner|bay hill/i.test(name);

export const STATEHOUSE: Archetype[] = [
  { name: 'state-house', weight: 7, build: houseLot(stateHouse, stateYard) },
  { name: 'state-duplex', weight: 1.8, build: houseLot(stateDuplex, sharedYard), fit: (lot) => (lot.width < 15.8 ? 0 : 1) },
  { name: 'state-flats', weight: 0.7, build: houseLot(stateFlats, sharedYard, [5.5, 7.5]), fit: (lot) => (lot.width < 14.6 ? 0 : 1) },
  { name: 'bach', weight: 16, build: houseLot(bach, bachYard, [4.5, 8]), fit: (lot) => (seaside(lot.district.name) ? 1 : 0) },
];
