import type { LotBuilder } from '../../core/types';
import {
  type Archetype,
  BRICKS,
  CLADDING,
  DOOR,
  HOUSE_PAINT,
  IRON,
  RENDER,
  SHOP_PAINT,
  type Site,
  WARM_LIGHT,
  bigDoor,
  box,
  cyl,
  door,
  flagpole,
  glow,
  ground,
  lamp,
  mat,
  pad,
  pane,
  poleSign,
  prop,
  quad,
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
import { CHURCH_HALLS, CLASSIC, FUEL_BRAND, GARAGES, GARAGE_TAGS, GROCERS, GROCER_TAGS, HALLS, type Look, PUBS, STOCK_AGENTS, STOCK_TAGS, STONE, TRADE, TRADES, type Trade, board, locality, signMat, wrap } from './names';
import { hotel, shopLot, terrace } from './shops';
import { cottage, houseLot } from './villa';
import type { YardStyle } from './yard';

/**
 * Small-town main street (Temuka's King St, Ashburton's East St, Rakaia): timber and brick shops under
 * post verandahs, the two-storey pub with its balcony, the stock agent, the garage with two pumps,
 * tearooms, the hall, and a few cottages between.
 */

const SIDES = [-1, 1] as const;

// ───────────────────────────── Country pub ─────────────────────────────

const countryPub: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const timber = rng.chance(0.55);
  hotel(s, {
    name: rng.pick(PUBS),
    storeys: 2,
    wall: timber ? mat(s, 'weatherboard', rng.pick([0xf1ead8, 0xe6dcc0, 0xf0e2a8, 0xdcd6cc])) : mat(s, 'plaster', rng.pick(RENDER)),
    dress: trim(s),
    iron: rng.pick(IRON),
    balcony: true,
    timber,
    inset: Math.max(1.4, (lot.width - 13) / 2),
    depth: Math.min(lot.depth - 3.5, rng.range(9.5, 12.5)),
  });
};

// ───────────────────────────── Shops with a fixed trade ─────────────────────────────

const STOCK: Trade = { id: 'stock', mix: [0, 0, 0], names: STOCK_AGENTS, tags: STOCK_TAGS, looks: TRADE };
const GROCER: Trade = {
  id: 'grocer',
  mix: [0, 0, 0],
  names: GROCERS,
  tags: GROCER_TAGS,
  looks: [{ bg: '#b5261e', fg: '#fff6e0', style: 'block' }],
  boards: ['PIES\n& MILK', 'SPUDS\n10 KG'],
  street: ['crates', 'bin', 'bench', 'board', 'phone'],
  light: 0.7,
};
const TEAROOMS = TRADES.find((t) => t.id === 'tearooms') ?? TRADES[0];

const stockAgent: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const two = rng.chance(0.35);
  const { top, front, w } = terrace(s, {
    storeys: two ? 2 : 1,
    wall: rng.chance(0.65) ? mat(s, 'brick', rng.pick(BRICKS)) : mat(s, 'plaster', rng.pick(RENDER)),
    dress: mat(s, 'plaster', 0xece5d3),
    parapet: rng.pick(['stepped', 'pediment', 'stepped'] as const),
    parapetH: 1.3,
    verandah: rng.pick(['posts', 'bullnose', 'hung'] as const),
    awning: rng.pick([0x2f5d3a, 0x3a3f44, 0x6b3a2a, 0x8a2f2a]),
    units: [STOCK],
    classical: two,
    depth: lot.depth - rng.range(3, 6),
    title: two ? 'ESTD 1898' : null,
  });
  if (s.spare(2)) flagpole(s, w / 2 - 2.2, top + 0.8, front - 0.3, 3.6, 0x2f5d3a);
};

const grocer: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  terrace(s, {
    storeys: 1,
    wall: rng.chance(0.5) ? mat(s, 'plaster', rng.pick(RENDER)) : mat(s, 'brick', rng.pick(BRICKS)),
    dress: mat(s, 'plaster', 0xf4efe2),
    parapet: rng.pick(['stepped', 'flat'] as const),
    parapetH: 1.4,
    verandah: rng.pick(['hung', 'posts'] as const),
    awning: 0x8a2f2a,
    units: [GROCER],
    depth: lot.depth - rng.range(2.5, 4.5),
  });
};

const tearooms: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  terrace(s, {
    storeys: 1,
    wall: mat(s, 'weatherboard', rng.pick(HOUSE_PAINT)),
    dress: trim(s),
    parapet: rng.pick(['stepped', 'flat'] as const),
    parapetH: 1.8,
    verandah: rng.pick(['bullnose', 'posts'] as const),
    awning: rng.pick(SHOP_PAINT),
    units: [TEAROOMS],
    roof: 'gable',
    ground: 3.7,
    depth: lot.depth - rng.range(4, 7),
    post: 0xf3eddc,
  });
};

// ───────────────────────────── Garage with two pumps ─────────────────────────────

const BRAND: readonly Look[] = [{ bg: '#f0c33a', fg: '#1f4a36', style: 'block' }];

const garage: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const name = rng.pick(GARAGES);
  const green = trim(s, 0x2d6a4f);
  const white = trim(s);

  // Workshop across the back of the section.
  const w = lot.width - 1;
  const d = Math.min(8.5, lot.depth * 0.45);
  const front = -s.hd + 0.6 + d;
  const cz = front - d / 2;
  const h = 4.2;
  const iron = rng.chance(0.5);
  const skin = iron ? mat(s, 'corrugated', rng.pick(CLADDING)) : mat(s, 'plaster', rng.pick(RENDER));
  walls(s, 0, cz, w, d, h, skin);
  solid(s, 0, cz, w, d, h);
  roof(s, 0, h, cz, w, d, 1.2, mat(s, 'corrugated', 0x9aa0a4), { eave: 0.15 });
  box(s, 0, h, front - 0.1, w * 0.7, 1.15, 0.2, skin);
  board(s, wrap(name), 0, h + 0.58, front + 0.02, Math.min(w * 0.6, 2.85), 3, TRADE);
  const doors = w > 11.5 ? 2 : 1;
  const paint = rng.pick([0x55606a, 0x8a2f2a, 0x2b4a6b, 0xb9b4a8]);
  for (let i = 0; i < doors; i++) bigDoor(s, -w / 2 + 2.3 + i * 4, -0.3, front + 0.02, 3.4, 3.6, paint, i === 0 && rng.chance(0.6));
  door(s, w / 2 - 2.7, -0.3, front + 0.02, rng.pick(DOOR), 0, 0.92, 2.4);
  pane(s, 'shop', w / 2 - 1.2, 1.6, front + 0.04, 1.5, 1.3, 0, { color: 0xf3eddc, lit: 3 });
  board(s, rng.pick(GARAGE_TAGS), w / 2 - 1.9, 2.75, front + 0.06, 2.6, 8, TRADE);

  // Forecourt: concrete, a canopy on two posts, the pump island under it.
  const yardD = s.hd - front;
  const fz = front + yardD * 0.55;
  pad(s, 0, front + yardD / 2, w, yardD, mat(s, 'concrete', 0xbcb8ad));
  const cw = Math.min(w - 2, 7.5);
  box(s, 0, 3.6, fz, cw, 0.32, Math.min(4.2, yardD - 1.5), white);
  box(s, 0, 3.55, fz, cw + 0.06, 0.14, Math.min(4.26, yardD - 1.44), green);
  for (const side of SIDES) box(s, side * 2.3, -0.3, fz, 0.2, 3.9, 0.2, white);
  box(s, 0, -0.2, fz, 3.4, 0.36, 1, mat(s, 'concrete', 0xd4d0c4));
  for (const side of SIDES) {
    box(s, side * 0.85, 0.16, fz, 0.55, 1.3, 0.4, white);
    box(s, side * 0.85, 1.46, fz, 0.6, 0.3, 0.44, green);
  }
  poleSign(s, rng.pick(SIDES) * (w / 2 - 1.2), s.hd - 1, 4.4, 2.2, 1.1, signMat(s, FUEL_BRAND, 2, BRAND), Math.PI / 2);

  // Decoration.
  if (s.spare(4)) {
    const m = signMat(s, FUEL_BRAND, 2, BRAND);
    for (const side of SIDES) {
      quad(s, side * 0.85, 1.61, fz + 0.23, 0.5, 0.25, m);
      quad(s, side * 0.85, 1.61, fz - 0.23, 0.5, 0.25, m, Math.PI);
    }
  }
  if (s.spare()) for (const side of SIDES) glow(s, side * cw * 0.22, 3.54, fz, 1.3, 0.3, WARM_LIGHT, 3, 0, true);
  if (s.spare(2)) {
    const tx = -w / 2 + 0.9;
    cyl(s, tx, ground(s, tx, front + 0.6), front + 0.6, 0.34, 0.7, trim(s, 0x1c1c1c), 10);
    cyl(s, tx + 0.8, ground(s, tx + 0.8, front + 0.5), front + 0.5, 0.34, 0.4, trim(s, 0x1c1c1c), 10);
  }
  if (s.near) {
    prop(s, 'drum', w / 2 - 0.6, front + 0.6, 0, 1, rng.pick([0x2d6a4f, 0xb5261e, 0x2b4a6b]));
    lamp(s, 0, 3.3, fz, 0xfff0d0, 160, 14);
  }
};

// ───────────────────────────── Halls ─────────────────────────────

/** Front path and a low fence either side of it for a set-back public building. */
function forecourt(s: Site, doorZ: number, floor: number) {
  const zf = s.hd - 0.3;
  if (s.spare()) slope(s, 0, ground(s, 0, zf + 0.3), zf + 0.3, 0, floor, doorZ, 1.6, 0.1, mat(s, 'concrete', 0xc4c0b4));
  if (!s.near) return;
  const kind = s.fx.pick(['picket-fence', 'hedge', 'none']);
  if (kind === 'none') return;
  for (const [a, b] of stretches(-s.hw + 0.2, s.hw - 0.2, [[-1.1, 1.1]])) run(s, kind, a, zf, b, zf, kind === 'hedge' ? 2 : 2.4);
}

const hall: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const setback = rng.range(2.5, 4);
  const pd = 1.8;
  const w = Math.min(lot.width - 2.4, rng.range(8, 10.5));
  const d = Math.max(7, Math.min(lot.depth - setback - pd - 1.5, rng.range(13, 17)));
  const F = s.hd - setback - pd;
  const cz = F - d / 2;
  const { h, floor } = seat(s, -w / 2, w / 2, F + pd);
  const fl = 0.5;
  const top = fl + 4.2;
  const boards = rng.chance(0.6);
  const wall = boards ? mat(h, 'weatherboard', rng.pick([0xf1ead8, 0xe6dcc0, 0xd8e2d0, 0xdcd6cc])) : mat(h, 'plaster', rng.pick(RENDER));
  const iron = mat(h, 'corrugated', rng.pick(IRON));
  const rise = 0.6 * (w / 2 + 0.35);
  const place = locality(s, 9);
  const name = place && rng.chance(0.5) ? `${place} HALL` : rng.pick(HALLS);
  h.j = { style: 'sash', variant: 1, frame: 0xf6f4ee, trim: 0xf3eddc, wall: boards ? 'timber' : 'masonry' };

  // Long gabled hall end-on to the street, a gabled lobby on the front.
  walls(h, 0, cz, w, d, top, wall);
  solid(h, 0, cz, w, d, top);
  roof(h, 0, top, cz, w, d, rise, iron, { axis: 'z', gable: wall, eave: 0.35 });
  const pw = Math.min(4.2, w * 0.5);
  walls(h, 0, F + pd / 2 - 0.25, pw, pd + 0.5, fl + 2.9, wall);
  roof(h, 0, fl + 2.9, F + pd / 2 - 0.05, pw, pd + 0.3, 0.6 * (pw / 2 + 0.25), iron, { axis: 'z', gable: wall, eave: 0.25 });
  door(h, 0, fl, F + pd + 0.01, rng.pick(DOOR), 0, 1.7, 2.2, 3);
  const base = Math.min(-0.35, ground(h, 0, F + pd + 0.9) - 0.2);
  box(h, 0, base, F + pd + 0.45, 2.6, fl - base, 0.9, mat(h, 'concrete', 0xc4c0b4));
  const wing = (w - pw) / 2;
  if (wing > 1.7) for (const side of SIDES) win(h, side * (pw / 2 + wing / 2), fl + 2.2, F, Math.min(1, wing - 0.8), 2.2, 0, 0.25);
  const count = Math.max(2, Math.min(4, Math.round(d / 3.8)));
  for (const side of SIDES) winRow(h, (side * w) / 2, cz + d / 2 - 1.8, (side * w) / 2, cz - d / 2 + 1.8, fl + 2.3, count, 1, 2.2, (side * Math.PI) / 2, 0.25);
  board(h, wrap(name), 0, top + rise * 0.42, F + 0.06, Math.min(2.4, w * 0.3), 3, CLASSIC);

  // Decoration.
  if (h.spare(2)) flagpole(h, -w / 2 + 0.4, Math.min(-0.3, ground(h, -w / 2 + 0.4, F + pd + 1) - 0.2), F + pd + 1, 7, 0x1f3f7a);
  forecourt(s, F + pd + 0.9, floor);
  if (s.near && s.fx.chance(0.5)) prop(s, 'bench', (pw / 2 + 0.9) * s.fx.pick(SIDES), F + pd - 0.4);
};

const churchHall: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const setback = rng.range(3, 5);
  const pd = 1.6;
  const w = Math.min(lot.width - 2.6, rng.range(6.8, 8.4));
  const d = Math.max(6.5, Math.min(lot.depth - setback - pd - 1.5, rng.range(11.5, 15)));
  const F = s.hd - setback - pd;
  const cz = F - d / 2;
  const { h, floor } = seat(s, -w / 2, w / 2, F + pd);
  const fl = 0.45;
  const top = fl + 3.4;
  const kind = rng.pick(s.timaru || s.city === 'temuka' ? (['board', 'brick', 'bluestone'] as const) : (['board', 'board', 'brick'] as const));
  const wall = kind === 'board' ? mat(h, 'weatherboard', rng.pick([0xf4f0e4, 0xf1ead8, 0xe6dcc0])) : kind === 'brick' ? mat(h, 'brick') : mat(h, 'bluestone');
  const dress = kind === 'board' ? trim(h) : mat(h, 'limestone');
  const roofing = rng.chance(0.3) ? mat(h, 'slate') : mat(h, 'corrugated', rng.pick([0x8b3027, 0x35603f, 0x5c6268, 0x7c2a22]));
  const rise = 0.95 * (w / 2 + 0.3);

  // Steep-roofed nave end-on to the street with a little gabled porch.
  walls(h, 0, cz, w, d, top, wall);
  solid(h, 0, cz, w, d, top);
  roof(h, 0, top, cz, w, d, rise, roofing, { axis: 'z', gable: wall, eave: 0.3 });
  const pw = 2.6;
  walls(h, 0, F + pd / 2 - 0.25, pw, pd + 0.5, fl + 2.5, wall);
  roof(h, 0, fl + 2.5, F + pd / 2 - 0.05, pw, pd + 0.3, 0.95 * (pw / 2 + 0.2), roofing, { axis: 'z', gable: wall, eave: 0.2 });
  door(h, 0, fl, F + pd + 0.01, rng.pick([0x5a2e22, 0x234a3a, 0x6a1f1f]), 0, 1.3, 2.1, 3);
  const base = Math.min(-0.35, ground(h, 0, F + pd + 0.8) - 0.2);
  box(h, 0, base, F + pd + 0.4, 2, fl - base, 0.8, mat(h, 'concrete', 0xc4c0b4));
  // Lancets: a tall one in the gable over the porch, a row down each side.
  const surround = kind === 'board' ? 0xf3eddc : 0xd8d0bc;
  pane(h, 'leaded', 0, top + rise * 0.36, F + 0.03, 0.9, Math.min(2.2, rise * 0.5), 0, { color: surround, lit: 1 });
  const count = Math.max(2, Math.min(4, Math.round(d / 3.4)));
  for (const side of SIDES) {
    for (let i = 0; i < count; i++) pane(h, 'leaded', side * (w / 2 + 0.03), fl + 1.9, cz + d / 2 - 1.5 - ((d - 3) * (i + 0.5)) / count, 0.7, 2.1, (side * Math.PI) / 2, { color: surround, lit: 1 });
  }
  // Bell-cote on the ridge at the street end.
  box(h, 0, top + rise - 0.5, F - 0.7, 0.9, 1.5, 0.9, wall);
  h.out.gable(h.f, 0, top + rise + 1, F - 0.7, 1.2, 1.2, 0.9, roofing, 0.59);

  // Decoration: finial, corner buttresses, the notice board by the gate.
  if (h.spare()) box(h, 0, top + rise + 1.85, F - 0.7, 0.06, 0.8, 0.06, trim(h, 0x2a2c2e));
  if (kind !== 'board' && h.spare(2)) for (const side of SIDES) box(h, side * (w / 2 - 0.2), -0.5, F + 0.15, 0.5, top - 0.2, 0.5, dress);
  if (s.spare(3)) {
    const nx = rng.pick(SIDES) * Math.min(s.hw - 1.4, 3.2);
    const nz = s.hd - 1;
    const gy = ground(s, nx, nz);
    for (const side of SIDES) box(s, nx + side * 0.75, gy - 0.3, nz, 0.08, 1.9, 0.08, trim(s));
    board(s, wrap(rng.pick(CHURCH_HALLS)), nx, gy + 1.2, nz + 0.01, 1.5, 3, STONE);
  }
  forecourt(s, F + pd + 0.8, floor);
};

// ───────────────────────────── Lots ─────────────────────────────

function townYard(s: Site): YardStyle {
  const r = s.rng;
  return {
    fence: r.pick(['picket', 'picket', 'hedge', 'paling', 'none'] as const),
    fenceTint: 0xffffff,
    drive: 0,
    driveKind: 'gravel',
    shelter: 'none',
    washing: r.chance(0.8),
    planting: r.range(0.4, 1),
    boundary: r.chance(0.6),
  };
}

export const TOWNSHIP: Archetype[] = [
  { name: 'town-shop', weight: 6, build: shopLot(1) },
  { name: 'country-pub', weight: 0.9, build: countryPub, fit: (lot) => (lot.width < 11 ? 0 : lot.corner ? 3 : 1) },
  { name: 'stock-agent', weight: 0.7, build: stockAgent },
  { name: 'garage', weight: 0.8, build: garage, fit: (lot) => (lot.width < 10.5 || lot.depth < 15 ? 0 : 1) },
  { name: 'tearooms', weight: 0.8, build: tearooms },
  { name: 'grocer', weight: 0.8, build: grocer, fit: (lot) => (lot.width < 10 ? 0 : 1) },
  { name: 'hall', weight: 0.6, build: hall, fit: (lot) => (lot.width < 10.5 || lot.depth < 16 ? 0 : 1) },
  { name: 'church-hall', weight: 0.5, build: churchHall, fit: (lot) => (lot.depth < 15 ? 0 : 1) },
  { name: 'town-cottage', weight: 1.6, build: houseLot(cottage, townYard, [2.6, 4.2]) },
];
