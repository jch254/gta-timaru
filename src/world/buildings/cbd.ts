import type { Lot, LotBuilder } from '../../core/types';
import {
  ALUMINIUM,
  type Archetype,
  BRICKS,
  BRONZE,
  IRON,
  type Mat,
  NEON_RED,
  type ParapetKind,
  RENDER,
  SHOP_PAINT,
  type Site,
  WARM_LIGHT,
  box,
  cornice,
  cyl,
  door,
  flagpole,
  flatRoof,
  footing,
  glow,
  glowMat,
  ground,
  lamp,
  mat,
  pane,
  parapet,
  pediment,
  pole,
  quad,
  roof,
  shade,
  site,
  solid,
  tone,
  trim,
  verandah,
  walls,
  win,
  winRow,
} from './kit';
import { BANKS, BUILDING_NAMES, CHALK, CINEMAS, CITY_HOTELS, CLASSIC, DEPARTMENT_STORES, DEPARTMENT_TAGS, NEON, OFFICES, STONE, TIMARU_HOTELS, TRADE, type Trade, WALL_PAINT, board, pickTrade, tradeName, wrap } from './names';
import { flankKind, flankView, serviceWall } from './service';
import { flankFor, hotel, terrace } from './shops';

/**
 * Central city. Christchurch: grey stone, limestone, brick and render Edwardian blocks among 1960s–80s
 * concrete and glass. Timaru: bluestone and brick fronts with ornate parapets, as on Stafford St, and
 * nothing much over four floors.
 */

const isTimaru = (lot: Lot) => lot.district.city === 'timaru';
const isChristchurch = (lot: Lot) => lot.district.city === 'christchurch';
const SIDES = [-1, 1] as const;

/** A run of different trades for the shop units along one frontage. */
function tradeRun(s: Site, count: number): Trade[] {
  const list: Trade[] = [];
  for (let i = 0; i < count; i++) list.push(pickTrade(s.rng, 2, s.lot.corner && i === 0, list[i - 1]));
  return list;
}

// ───────────────────────────── Edwardian and inter-war commercial blocks ─────────────────────────────

const edwardian: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const kind = rng.pick(s.timaru ? (['bluestone', 'bluestone', 'brick', 'brick', 'lime'] as const) : (['greystone', 'lime', 'brick', 'render', 'lime', 'brick'] as const));
  let wall: Mat;
  let dress: Mat;
  if (kind === 'bluestone') {
    wall = mat(s, 'bluestone');
    dress = mat(s, 'limestone');
  } else if (kind === 'greystone') {
    wall = mat(s, 'bluestone', 0xd6d0c6);
    dress = mat(s, 'limestone');
  } else if (kind === 'lime') {
    wall = mat(s, 'limestone');
    dress = mat(s, 'limestone', 0xe2d9c6);
  } else if (kind === 'brick') {
    wall = mat(s, 'brick', rng.pick(BRICKS));
    dress = rng.chance(0.5) ? mat(s, 'limestone') : mat(s, 'plaster', 0xece5d3);
  } else {
    wall = mat(s, 'plaster', rng.pick(RENDER));
    dress = mat(s, 'plaster', 0xf4efe2);
  }
  const storeys = s.timaru ? rng.int(2, 3) : rng.int(2, 4);
  const units = Math.max(2, Math.min(storeys > 3 ? 3 : 4, Math.round(lot.width / 7.5)));
  const parapets: ParapetKind[] = s.timaru ? ['ornate', 'ornate', 'pediment'] : ['ornate', 'pediment', 'stepped', 'flat'];
  terrace(s, {
    storeys,
    wall,
    dress,
    parapet: rng.pick(parapets),
    parapetH: rng.range(1.1, 1.4),
    verandah: rng.pick(s.timaru ? (['posts', 'bullnose', 'hung'] as const) : (['hung', 'hung', 'posts', null] as const)),
    awning: rng.pick(SHOP_PAINT),
    units: tradeRun(s, units),
    classical: true,
    roof: 'hip',
    ground: 4.3,
    upper: 3.7,
    depth: lot.depth - rng.range(2.5, 5),
    title: rng.chance(0.75) ? rng.pick(BUILDING_NAMES) : null,
    post: rng.pick([0x2f3a34, 0x1f2326, 0x3a2a22]),
    plain: true,
    flank: flankFor(s, 'masonry'),
    joinery: 'stone',
  });
};

/** Lower retail rows with modernised fronts. */
const shopRow: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const brick = rng.chance(0.35);
  const units = Math.max(2, Math.min(4, Math.round(lot.width / 6.5)));
  terrace(s, {
    storeys: rng.chance(0.7) ? 2 : 1,
    wall: brick ? mat(s, 'brick', rng.pick(BRICKS)) : mat(s, 'plaster', rng.pick(RENDER)),
    dress: mat(s, 'plaster', 0xf4efe2),
    parapet: rng.pick(s.timaru ? (['pediment', 'ornate', 'stepped'] as const) : (['flat', 'flat', 'stepped', 'pediment'] as const)),
    parapetH: rng.range(0.9, 1.3),
    verandah: rng.pick(['hung', 'hung', 'posts'] as const),
    awning: rng.pick(SHOP_PAINT),
    units: tradeRun(s, units),
    classical: brick && rng.chance(0.5),
    roof: 'flat',
    depth: lot.depth - rng.range(2.5, 6),
    plain: true,
    flank: flankFor(s, brick ? 'masonry' : 'render'),
    joinery: brick ? 'stone' : 'masonry',
  });
};

// ───────────────────────────── 1960s–80s office blocks ─────────────────────────────

const WALL_TINTS = [0xb7b3a8, 0xc4c0b4, 0xa9a69c, 0xcfc8b8, 0xd9d2bf, 0xbfc4c8, 0xe6d8c0, 0xc9cfc4, 0x9a8f80, 0xd8d4c8];

type OfficeStyle = 'grid' | 'ribbon' | 'fins' | 'curtain' | 'shades' | 'podium';

/** The glazed and panelled skin of one face of an office block, with whatever stands proud of it. */
function officeFace(s: Site, style: OfficeStyle, x: number, z: number, yaw: number, width: number, y: number, levels: number, bay: number, storey: number, wall: Mat, color: number, tint: number, finish: number, relief: boolean) {
  // Whole bays, stretched a little to fill the width exactly.
  const bays = Math.max(1, Math.round(width / bay));
  const fw = width;
  bay = width / bays;
  const h = levels * storey;
  const sx = Math.sin(yaw);
  const cz = Math.cos(yaw);
  const along = (t: number, outBy: number): [number, number] => [x + cz * t + sx * outBy, z - sx * t + cz * outBy];
  const side = Math.abs(sx) > 0.5;
  const [px, pz] = along(0, 0.03);
  if (style === 'curtain') pane(s, 'curtain', px, y + h / 2, pz, fw, h, yaw, { nx: bays, ny: levels, color: 0x3a3f44, variant: tint, wall: finish, lit: 2 });
  else pane(s, 'office', px, y + h / 2, pz, fw, h, yaw, { nx: bays, ny: levels, color: shade(color, 0.82), variant: style === 'ribbon' ? 1 : style === 'fins' ? 2 : style === 'shades' ? 3 : 0, wall: finish, lit: 2 });
  if (!relief) return fw;
  const rib = (t: number, w: number, depth: number, y0: number, y1: number) => {
    const [rx, rz] = along(t, depth / 2);
    box(s, rx, y0, rz, side ? depth : w, y1 - y0, side ? w : depth, wall);
  };
  const band = (yy: number, t: number, depth: number) => {
    const [rx, rz] = along(0, depth / 2);
    box(s, rx, yy, rz, side ? depth : fw + 0.3, t, side ? fw + 0.3 : depth, wall);
  };
  if (style === 'grid' || style === 'podium') {
    // Piers standing proud on the bay lines.
    const step = bays > 9 ? 2 : 1;
    for (let k = 0; k <= bays; k += step) rib(-fw / 2 + k * bay, 0.34, 0.24, y - 0.2, y + h + 0.3);
  } else if (style === 'fins') {
    const step = bays > 11 ? 2 : 1;
    for (let k = 0; k <= bays; k += step) rib(-fw / 2 + k * bay, 0.16, 0.55, y, y + h + 0.2);
  } else if (style === 'ribbon') {
    const step = levels > 8 ? 2 : 1;
    for (let i = 0; i <= levels; i += step) band(y + i * storey - 0.08, 0.16, 0.22);
  } else if (style === 'shades') {
    const step = levels > 8 ? 2 : 1;
    for (let i = 0; i < levels; i += step) band(y + (i + 1) * storey - 0.62, 0.1, 0.75);
  } else {
    // Curtain wall: slab edges top and bottom frame the glass.
    band(y - 0.2, 0.2, 0.12);
    band(y + h, 0.2, 0.12);
  }
  return fw;
}

const office: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const floors = isChristchurch(lot) ? rng.pick([4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 12]) : rng.int(3, 5);
  const style = rng.pick(['grid', 'grid', 'ribbon', 'fins', 'curtain', 'shades', 'podium'] as const);
  const setback = rng.range(0.3, 1.4);
  const w = lot.width - rng.range(0.2, 1.6);
  const d = Math.max(8, lot.depth - rng.range(3, 6));
  const front = s.hd - setback;
  const cz = front - d / 2;
  const g = 4.4;
  const bay = rng.pick([2.4, 2.7, 3, 3.3]);
  const storey = rng.pick([3.2, 3.2, 3.4]);
  const color = rng.pick(WALL_TINTS);
  const wall = rng.chance(0.6) ? mat(s, 'concrete', color) : mat(s, 'plaster', color);
  const dark = mat(s, 'concrete', 0x6a665e);
  const name = rng.pick(OFFICES);
  const tint = rng.int(0, 3);
  const finish = style === 'curtain' ? rng.pick([0, 1, 1, 3]) : rng.pick([0, 0, 1, 2]);

  // Massing: a slab, or a tower set back on a two-storey podium.
  let tw = w;
  let td = d;
  let tz = cz;
  let base = g;
  let top: number;
  if (style === 'podium') {
    const podium = g + storey + 0.6;
    walls(s, 0, cz, w, d, podium, wall);
    flatRoof(s, 0, cz, w, d, podium);
    officeFace(s, 'ribbon', 0, front, 0, w - 1.2, g, 1, bay, storey, wall, color, tint, finish, false);
    tw = Math.max(10, w * 0.68);
    td = Math.max(8, d * 0.72);
    tz = cz - (d - td) / 2 + 0.6;
    base = podium + 0.3;
    top = base + (floors - 1) * storey + 0.9;
    walls(s, 0, tz, tw, td, top, wall, podium - 0.2);
  } else {
    top = g + floors * storey + 0.9;
    walls(s, 0, cz, w, d, top, wall);
  }
  solid(s, 0, cz, w, d, top);
  const levels = style === 'podium' ? floors - 1 : floors;
  const tf = tz + td / 2;
  const margin = style === 'curtain' ? 0.5 : 1.1;

  // Skin: full relief on the street front, the same pattern flat on the back, and on the flanks either the
  // pattern again or a mostly blank wall with a strip of stair windows.
  officeFace(s, style, 0, tf, 0, tw - margin, base, levels, bay, storey, wall, color, tint, finish, true);
  officeFace(s, style, 0, tz - td / 2, Math.PI, tw - margin, base, levels, bay, storey, wall, color, tint, finish, false);
  const blankSides = style === 'curtain' || rng.chance(0.3);
  // A flank that looks onto a street is never the blank one.
  const views = SIDES.map((side) => flankView(s, side));
  const open = views.map((v) => v === 'street');
  SIDES.forEach((side, i) => {
    const yaw = (side * Math.PI) / 2;
    if (blankSides && !open[i]) {
      officeFace(s, 'grid', side * (tw / 2), tz - td * 0.2, yaw, bay, base, levels, bay, storey, wall, color, tint, finish, false);
      // The end wall was poured a floor at a time: a joint shows at each slab.
      const joint = tone(s, wall, 0.84);
      if (s.spare(3)) for (let l = 0; l <= levels; l += levels > 8 ? 2 : 1) quad(s, side * (tw / 2 + 0.012), base + l * storey - 0.05, tz, td - 0.06, 0.1, joint, yaw, true);
    } else officeFace(s, style, side * (tw / 2), tz, yaw, td - margin, base, levels, bay, storey, wall, color, tint, finish, false);
  });

  // Roof: deck, plant room with louvres, lift overrun, a tank.
  flatRoof(s, 0, tz, tw, td, top);
  const plantW = tw * 0.34;
  const plantD = td * 0.34;
  const px = tw * 0.16;
  const pz = tz - td * 0.16;
  box(s, px, top, pz, plantW, 2.4, plantD, mat(s, 'corrugated', 0xbcbcb6));
  box(s, -tw * 0.24, top, tz + td * 0.12, 3.2, 3.4, 3.6, wall);
  if (s.spare(2)) {
    pane(s, 'louvre', px, top + 1.3, pz + plantD / 2 + 0.02, Math.min(plantW - 0.6, 3.2), 1.5, 0, { color: 0x8a8d90 });
    door(s, -tw * 0.24, top, tz + td * 0.12 + 1.82, 0x55606a, 0, 0.9, 2.05, 0);
  }

  // Ground floor: piers, shop windows or a foyer between them, the entrance in the middle.
  const piers = w > 22 ? 6 : 4;
  const gap = (w - 0.8) / (piers - 1);
  const door0 = Math.floor((piers - 1) / 2);
  const retail = rng.chance(0.6);
  const tenants = Array.from({ length: piers }, () => wrap(tradeName(s, pickTrade(s.rng, 2, false))));
  const joinery = finish === 1 ? BRONZE : ALUMINIUM;
  for (let i = 0; i < piers; i++) {
    const x = -w / 2 + 0.4 + gap * i;
    const by = Math.min(-0.5, ground(s, x, front) - 0.3);
    box(s, x, by, front + 0.12, 0.7, g - 0.3 - by, 0.4, dark);
    if (i === piers - 1) break;
    const mx = x + gap / 2;
    const gw = gap - 0.8;
    if (i === door0) {
      const dw = Math.min(2.6, gw);
      pane(s, 'shopdoor', mx, 1.45, front + 0.06, dw, 2.9, 0, { color: joinery, variant: 2, lit: 3 });
      if (gw - dw > 1.2) for (const e of SIDES) pane(s, 'shop', mx + e * (dw / 2 + (gw - dw) / 4), 1.6, front + 0.06, (gw - dw) / 2 - 0.05, 2.6, 0, { color: joinery, variant: 1, lit: 3 });
    } else {
      pane(s, 'shop', mx, 1.75, front + 0.06, gw, 2.7, 0, { color: joinery, variant: 1, lit: retail ? 3 : 2 });
      if (s.spare()) box(s, mx, -0.3, front + 0.08, gw, 0.7, 0.08, dark);
    }
  }
  box(s, 0, 3.2, front + 0.14, w - 0.6, 0.9, 0.36, wall);
  const ex = -w / 2 + 0.4 + gap * (door0 + 0.5);
  const cd = Math.min(2.2, s.apron + setback - 0.1);
  const awning = rng.chance(0.55);
  let signZ = front + 0.34;
  if (awning) {
    // Footpath verandah the length of the block.
    const rods = [-w / 2 + 0.4 + gap, -w / 2 + 0.4 + gap * (piers - 2)];
    signZ = verandah(s, { x0: -w / 2, x1: w / 2, z: front + 0.3, depth: Math.max(1, cd - 0.3), y: 3.3, kind: 'hung', roof: wall, fascia: trim(s, shade(color, 0.8)), rods }) + 0.03;
    board(s, name, ex, 3.28, signZ, Math.min(4.6, w * 0.3), 8, TRADE);
  } else {
    box(s, ex, 3.35, front + cd / 2, Math.min(6, w * 0.4), 0.24, cd, wall);
    if (s.spare()) glow(s, ex, 3.34, front + cd / 2, Math.min(4, w * 0.3), 0.3, WARM_LIGHT, 2, 0, true);
    board(s, name, ex, 3.88, front + cd - 0.05, Math.min(4.6, w * 0.3), 8, TRADE);
  }

  // The ground-floor tenants' names: on the verandah fascia, or on the band above their windows.
  if (retail) {
    for (let i = 0; i < piers - 1; i++) {
      if (i === door0 || !s.spare()) continue;
      const mx = -w / 2 + 0.4 + gap * (i + 0.5);
      if (awning) board(s, tenants[i].replace('\n', ' '), mx, 3.28, signZ, Math.min(gap - 1.2, 3.4), 8, CLASSIC);
      else board(s, tenants[i], mx, 3.65, signZ, Math.min(gap - 0.8, 2.4), 3, CLASSIC);
    }
  }

  // Street level round the sides and back: the shop windows carry on down a side street; elsewhere it is
  // fire doors, a loading dock and the odd high window.
  s.j = { style: 'alu', variant: 0, frame: joinery, trim: 0xcfcabd, wall: 'concrete' };
  SIDES.forEach((side, i) => serviceWall(s, { x: side * (w / 2), z: cz, yaw: (side * Math.PI) / 2, len: d, top: g, ground: g, upper: storey, rows: 0, wall, ...flankKind(views[i]), shop: 'all', room: (lot.width - w) / 2, pipes: false, paint: 0x55606a }));
  serviceWall(s, { x: 0, z: cz - d / 2, yaw: Math.PI, len: w, top: g, ground: g, upper: storey, rows: 0, wall, kind: 'back', doors: 2, room: cz - d / 2 + s.hd, pipes: false, paint: 0x55606a });

  // Decoration.
  if (s.spare()) board(s, name, 0, top - 0.48, tf + 0.07, Math.min(tw * 0.6, 5.6), 8, TRADE);
  if (s.spare(3) && s.fx.chance(0.6)) cyl(s, -tw * 0.3, top, tz - td * 0.25, 0.9, 1.6, trim(s, 0x9a9d9f), 10);
  if (s.spare(2)) {
    if (s.fx.chance(0.5)) pole(s, px, top + 2.4, pz, 5, 0x8a8d90, 0.06);
    else flagpole(s, tw / 2 - 2.6, top, tf - 0.8, 5.5, s.fx.pick([0x1f3f7a, 0x8a2f2a, 0xe8e6df]));
  }
  if (s.spare(3) && s.fx.chance(0.3)) {
    // Sky sign on the parapet.
    const sw = Math.min(tw * 0.5, 7);
    for (const e of SIDES) box(s, e * (sw / 2 - 0.3), top, tf - 0.5, 0.1, 1.7, 0.1, trim(s, 0x3a3f44));
    board(s, name, 0, top + 1.1, tf - 0.44, sw, 5, NEON);
  }
  const signSide = s.fx.pick(SIDES);
  if (blankSides && !open[signSide < 0 ? 0 : 1] && s.spare() && s.fx.chance(0.6)) {
    const side = signSide;
    board(s, name, side * (tw / 2 + 0.02), base + levels * storey * 0.7, tz + td * 0.18, Math.min(td * 0.5, 6.4), 8, WALL_PAINT, (side * Math.PI) / 2);
  }
  if (s.near && s.fx.chance(0.4)) lamp(s, ex, 3, front + 1.2, 0xfff0d0, 120, 12);
};

// ───────────────────────────── Bank ─────────────────────────────

const bank: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const w = Math.min(lot.width - 0.6, rng.range(15, 22));
  const d = Math.max(8, Math.min(lot.depth - 4.5, rng.range(15, 20)));
  const porch = 2;
  const front = s.hd - 1 - porch;
  const cz = front - d / 2;
  const h = rng.range(9, 11);
  const blue = s.timaru && rng.chance(0.55);
  const stone = blue ? mat(s, 'bluestone') : mat(s, 'limestone');
  const dress = blue ? mat(s, 'limestone') : mat(s, 'limestone', 0xe6decb);
  const name = rng.pick(BANKS);
  s.j = { style: 'sash', variant: 1, frame: rng.pick([0x3a2f22, 0x2f3a34, 0xe8e2d0]), trim: 0xe8e2d0, wall: 'stone', sill: dress };

  walls(s, 0, cz, w, d, h, stone);
  solid(s, 0, cz, w, d, h);
  flatRoof(s, 0, cz, w, d, h);
  const plinth = footing(s, 0, front, w, 0.4);
  box(s, 0, plinth, front + 0.07, w, 1.1 - plinth, 0.22, dress);
  cornice(s, -w / 2, w / 2, h, front, dress, 0.36);
  box(s, 0, h, front - 0.2, w, 0.9, 0.4, stone);
  for (const side of SIDES) box(s, side * (w / 2 - 0.4), 1, front + 0.1, 0.8, h - 1.5, 0.24, dress);

  // Portico: steps, columns, entablature, pediment.
  const columns = w > 18.5 ? 6 : 4;
  const gap = 2.6;
  const pw = (columns - 1) * gap + 1.2;
  const pz = front + porch / 2;
  const step = footing(s, 0, pz + 0.3, pw + 1.2, porch + 0.6);
  box(s, 0, step, pz + 0.3, pw + 1.2, 0.3 - step, porch + 0.6, stone);
  box(s, 0, 0.3, pz, pw + 0.4, 0.3, porch, stone);
  const colH = h - 2.3;
  for (let i = 0; i < columns; i++) {
    const x = -pw / 2 + 0.6 + i * gap;
    cyl(s, x, 0.6, front + porch - 0.55, 0.42, colH, dress, 10, 0.36);
    if (s.spare(2)) {
      box(s, x, 0.6, front + porch - 0.55, 1, 0.22, 1, dress);
      box(s, x, 0.6 + colH - 0.2, front + porch - 0.55, 0.96, 0.2, 0.96, dress);
    }
  }
  box(s, 0, h - 1.7, pz, pw + 0.3, 1.2, porch, dress);
  pediment(s, 0, h - 0.5, pz, pw + 0.5, 2, porch + 0.1, dress);
  board(s, name, 0, h - 1.1, front + porch + 0.02, Math.min(pw - 0.4, 6.4), 8, STONE);

  // Door and tall windows behind the colonnade, more windows on the wings.
  door(s, 0, 0.6, front + 0.02, rng.pick([0x3a2f22, 0x2a3a2e, 0x4a1f1f]), 0, 2.2, 3.1, 3);
  for (let i = 0; i < columns - 1; i++) {
    const x = -pw / 2 + 0.6 + (i + 0.5) * gap;
    if (Math.abs(x) < 1.3) continue;
    win(s, x, 3.4, front, 1.3, 3.6, 0, 0.2, false);
  }
  const wing = (w - pw) / 2;
  if (wing > 2.5) {
    for (const side of SIDES) {
      const x = side * (pw / 2 + wing / 2 - 0.3);
      win(s, x, 3.2, front, Math.min(1.5, wing - 1.7), 3, 0, { lit: 0.2, hood: true });
      win(s, x, h - 2.3, front, Math.min(1.5, wing - 1.7), 1.4, 0, 0.2);
    }
  }
  // Tall windows down the flanks.
  const sideN = Math.max(2, Math.min(4, Math.round(d / 4.5)));
  if (s.spare(sideN * 6)) for (const side of SIDES) winRow(s, side * (w / 2), front - 1.6, side * (w / 2), front - d + 1.6, 4, sideN, 1.3, 3.4, (side * Math.PI) / 2, { lit: 0.2, framed: s.lot.corner });

  // Decoration.
  if (s.spare()) pane(s, 'sash', 0, 4.4, front + 0.03, 2.2, 0.8, 0, { color: s.j.frame, variant: 1, wall: 2, lit: 1 });
  if (s.spare(2)) for (const side of SIDES) box(s, side * 1.7, 2.9, front + 0.2, 0.3, 0.5, 0.3, glowMat(s, WARM_LIGHT, 3));
  if (s.spare()) box(s, 0, h + 0.9, front - 0.2, w + 0.1, 0.1, 0.5, dress);
  if (s.spare(2)) flagpole(s, 0, h + 1.4, front - 1.2, 4.5, 0x1f3f7a);
  // The back: the staff door, strong-room windows, pipes.
  serviceWall(s, { x: 0, z: cz - d / 2, yaw: Math.PI, len: w, top: h, ground: 4.6, upper: h - 5, rows: 1, wall: stone, kind: 'back', doors: 1, dock: false, room: cz - d / 2 + s.hd });
};

// ───────────────────────────── Corner hotel ─────────────────────────────

const cityHotel: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const kind = rng.pick(s.timaru ? (['bluestone', 'brick', 'render'] as const) : (['render', 'render', 'brick'] as const));
  hotel(s, {
    name: rng.pick(s.timaru ? TIMARU_HOTELS : CITY_HOTELS),
    storeys: s.timaru ? rng.int(2, 3) : 3,
    wall: kind === 'bluestone' ? mat(s, 'bluestone') : kind === 'brick' ? mat(s, 'brick', rng.pick(BRICKS)) : mat(s, 'plaster', rng.pick([0xe6d8c0, 0xdfd0b4, 0xd8c3b0, 0xc9cfc4, 0xe9dcc8])),
    dress: kind === 'render' ? mat(s, 'plaster', 0xf4efe2) : mat(s, 'limestone'),
    iron: rng.pick(IRON),
    parapet: rng.pick(['ornate', 'pediment', 'ornate'] as const),
    verandah: rng.pick(['hung', 'posts', 'bullnose'] as const),
    awning: rng.pick(SHOP_PAINT),
    turret: lot.corner && rng.chance(0.75),
    depth: lot.depth - rng.range(3, 5),
  });
};

// ───────────────────────────── Cinema ─────────────────────────────

const cinema: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const w = lot.width - 0.2;
  const front = s.hd - 0.2;
  const fd = Math.min(7, lot.depth * 0.3);
  const fh = rng.range(10.5, 13);
  const wall = mat(s, 'plaster', rng.pick([0xe9dcc8, 0xe6c9b8, 0xcfd8c8, 0xd9d2bf, 0xe8d9a8]));
  const stripeColor = rng.pick([0x8a2f2a, 0x1f4a4a, 0x2b4a6b, 0x6b3a2a]);
  const stripe = trim(s, stripeColor);
  const name = rng.pick(CINEMAS);
  s.j = { style: 'casement', variant: 0, frame: stripeColor, trim: 0xf3eddc, wall: 'masonry' };

  // Foyer block on the street, the auditorium barn behind it.
  walls(s, 0, front - fd / 2, w, fd, fh, wall);
  const ad = Math.max(4, lot.depth - fd - 2.5);
  const aw = w - 1.6;
  const ah = fh - 2.2;
  const az = front - fd - ad / 2;
  const barn = mat(s, 'brick', shade(rng.pick(BRICKS), 0.88));
  walls(s, 0, az, aw, ad, ah, barn);
  roof(s, 0, ah, az, aw, ad, 2, mat(s, 'corrugated', 0x8f959a), { axis: 'z', eave: 0.2 });
  solid(s, 0, front - (fd + ad) / 2, w, fd + ad, fh);

  // Stepped moderne skyline with a centre pylon carrying three neon tubes.
  box(s, 0, fh, front - 0.5, w * 0.62, 1.1, 1, wall);
  box(s, 0, fh + 1.1, front - 0.5, w * 0.3, 1.5, 1, wall);
  for (const x of [-0.75, 0, 0.75]) {
    box(s, x, 6.6, front + 0.04, 0.2, fh + 2.3 - 6.6, 0.1, stripe);
    glow(s, x, (6.6 + fh + 2.3) / 2, front + 0.1, 0.1, fh + 2.3 - 6.8, NEON_RED, 3);
  }
  for (const y of [7, 7.7]) box(s, 0, y, front + 0.02, w - 0.4, 0.18, 0.08, stripe);
  board(s, name, 0, 5.4, front + 0.09, Math.min(w * 0.6, 7.5), 5, NEON);
  for (const side of SIDES) winRow(s, side * 2.2, front, side * (w / 2 - 0.8), front, 9.2, 2, 0.9, 2.2, 0, 0.25);

  // Marquee over the footpath, doors and poster cases under it.
  const md = Math.min(2.7, s.apron);
  const mw = w * 0.82;
  box(s, 0, 3.3, front + md / 2, mw, 0.75, md, stripe);
  glow(s, 0, 3.29, front + md / 2, mw - 0.7, md - 0.7, WARM_LIGHT, 3, 0, true);
  board(s, 'NOW SHOWING', 0, 3.68, front + md + 0.02, Math.min(mw - 1, 5.2), 8, CLASSIC);
  const dw = Math.min(6, w * 0.4);
  const leaves = Math.max(1, Math.round(dw / 1.7));
  pane(s, 'shopdoor', 0, 1.3, front + 0.07, dw, 2.6, 0, { nx: leaves, color: stripeColor, variant: 2, lit: 3 });
  board(s, 'COMING\nSOON', -Math.min(5, w * 0.32), 1.7, front + 0.07, 1.3, 1, CHALK);
  board(s, 'TONIGHT\n8 PM', Math.min(5, w * 0.32), 1.7, front + 0.07, 1.3, 1, CHALK);
  if (s.spare(2)) for (const side of SIDES) box(s, side * (dw / 2 + 0.35), -0.3, front + 0.06, 0.4, 3.3, 0.14, stripe);
  // Down the sides and round the back: the foyer's flank, then the brick barn with its exit doors.
  for (const side of SIDES) {
    const yaw = (side * Math.PI) / 2;
    serviceWall(s, { x: side * (w / 2), z: front - fd / 2, yaw, len: fd, top: fh, ground: 5, upper: fh - 5, rows: 1, wall, ...flankKind(flankView(s, side)), room: 0.1, paint: stripeColor });
    serviceWall(s, { x: side * (aw / 2), z: az, yaw, len: ad, top: ah, ground: ah, upper: 3, rows: 0, wall: barn, kind: 'back', doors: 1, dock: false, room: (w - aw) / 2 + 0.1, paint: stripeColor });
  }
  serviceWall(s, { x: 0, z: az - ad / 2, yaw: Math.PI, len: aw, top: ah, ground: ah, upper: 3, rows: 0, wall: barn, kind: 'back', doors: 1, dock: false, room: az - ad / 2 + s.hd, paint: stripeColor });
  if (s.near) lamp(s, 0, 2.9, front + 1.3, 0xffe2b0, 150, 13);
};

// ───────────────────────────── Department store ─────────────────────────────

const department: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const w = lot.width - 0.1;
  const front = s.hd - 0.2;
  const d = lot.depth - rng.range(2.5, 4);
  const cz = front - d / 2;
  const storeys = s.timaru ? 2 : rng.int(2, 3);
  const g = 4.6;
  const u = 4;
  const top = g + (storeys - 1) * u;
  const kind = rng.pick(['render', 'brick', 'lime'] as const);
  const wall = kind === 'brick' ? mat(s, 'brick', rng.pick(BRICKS)) : kind === 'lime' ? mat(s, 'limestone') : mat(s, 'plaster', rng.pick(RENDER));
  const dress = kind === 'render' ? mat(s, 'plaster', 0xf4efe2) : mat(s, 'limestone', 0xe6decb);
  const name = rng.pick(DEPARTMENT_STORES);
  const paint = rng.pick(SHOP_PAINT);
  s.j = { style: 'casement', variant: 1, frame: rng.pick([0xf6f4ee, 0x2f3a34, 0x3a2a22]), trim: 0xf3eddc, wall: 'stone', sill: dress };

  const flank = lot.corner ? wall : flankFor(s, kind === 'render' ? 'render' : 'masonry');
  if (flank === wall) walls(s, 0, cz, w, d, top, wall);
  else {
    walls(s, 0, cz - 0.15, w, d - 0.3, top, flank);
    walls(s, 0, front - 0.15, w, 0.3, top, wall);
  }
  solid(s, 0, cz, w, d, top);
  roof(s, 0, top, cz - 0.3, w - 0.6, d - 0.8, 1.2, mat(s, 'corrugated', 0x8f959a), { hip: Math.min(w, d) / 2 - 0.6, eave: 0, bare: true });
  const panel = parapet(s, -w / 2, w / 2, top, front, rng.pick(['stepped', 'flat', 'stepped'] as const), wall, dress, 1.5);
  cornice(s, -w / 2, w / 2, top, front, dress);
  const aspect = name.length > 12 ? 8 : 5;
  board(s, name, 0, top + panel, front + 0.07, Math.min(w * 0.46, 0.9 * aspect), aspect, STONE);

  // Piers divide the front into display-window bays; the middle one is the entrance.
  const bays = Math.max(3, Math.min(5, Math.round(w / 5.2)));
  const bw = w / bays;
  for (let i = 0; i <= bays; i++) {
    const px = i === 0 ? -w / 2 + 0.35 : i === bays ? w / 2 - 0.35 : -w / 2 + i * bw;
    const by = Math.min(-0.4, ground(s, px, front) - 0.3);
    box(s, px, by, front + 0.1, 0.7, top - 0.45 - by, 0.24, dress);
  }
  const entrance = Math.floor(bays / 2);
  for (let i = 0; i < bays; i++) {
    const bx = -w / 2 + (i + 0.5) * bw;
    if (i === entrance) pane(s, 'shopdoor', bx, 1.45, front + 0.07, Math.min(3.2, bw - 1.2), 2.9, 0, { color: shade(paint, 0.8), variant: 3, lit: 3 });
    else pane(s, 'shop', bx, 1.9, front + 0.07, bw - 1.1, 2.6, 0, { color: shade(paint, 0.8), variant: 2, lit: 3 });
    for (let r = 1; r < storeys; r++) win(s, bx, g + (r - 1) * u + 2.1, front, bw - 1.7, 2.3, 0, { lit: 0.2, hood: r === 1 });
  }
  const fz = verandah(s, { x0: -w / 2, x1: w / 2, z: front, depth: s.apron + 0.1, y: 3.25, kind: 'hung', roof: mat(s, 'corrugated', paint), fascia: trim(s, paint) });
  board(s, rng.pick(DEPARTMENT_TAGS), -w * 0.22, 3.23, fz + 0.03, Math.min(w * 0.4, 3.6), 8, CLASSIC);

  // Decoration.
  if (s.spare()) board(s, name, w * 0.22, 3.23, fz + 0.03, Math.min(w * 0.3, 2.6), 8, CLASSIC);
  if (s.spare()) box(s, 0, -0.3, front + 0.03, w - 0.8, 0.85, 0.1, trim(s, paint));
  if (s.spare(4)) for (const side of SIDES) flagpole(s, side * (w / 2 - 2.4) - 0.6, top + 0.9, front - 0.25, 4, side < 0 ? 0x8a2f2a : 0x1f3f7a);
  // The store's name painted high on a side wall that does not face a street, then the side and back
  // elevations: display windows down a side street, the goods entrance behind.
  const views = SIDES.map((side) => flankView(s, side));
  const open = views.map((v) => v === 'street');
  const signSide = views[0] === 'open' ? -1 : views[1] === 'open' ? 1 : s.fx.pick(SIDES);
  const signW = Math.min(d * 0.4, 5.6);
  const signed = storeys > 1 && !open[signSide < 0 ? 0 : 1] && s.spare() && s.fx.chance(0.7);
  if (signed) board(s, name, (w / 2 + 0.025) * signSide, top - 1.6, front - 4, signW, aspect, WALL_PAINT, (signSide * Math.PI) / 2);
  SIDES.forEach((side, i) => {
    const mid = side * (cz - (front - 4));
    serviceWall(s, { x: side * (w / 2), z: cz, yaw: (side * Math.PI) / 2, len: d, top, ground: g, upper: u, rows: storeys - 1, wall: flank, ...flankKind(views[i]), shop: 'all', clear: signed && signSide === side ? [mid - signW / 2, mid + signW / 2] : undefined });
  });
  serviceWall(s, { x: 0, z: cz - d / 2, yaw: Math.PI, len: w, top, ground: g, upper: u, rows: storeys - 1, wall: flank, kind: 'back', doors: 2, room: cz - d / 2 + s.hd });
  if (s.near) lamp(s, 0, 2.9, front + 1.3, 0xfff0d0, 140, 13);
};

const mix = (christchurch: number, timaru: number, other = timaru) => (lot: Lot) => (isChristchurch(lot) ? christchurch : isTimaru(lot) ? timaru : other);

export const CBD: Archetype[] = [
  { name: 'office', weight: 1, build: office, fit: mix(5, 0.9, 0.6) },
  { name: 'edwardian', weight: 1, build: edwardian, fit: mix(4, 7) },
  { name: 'shop-row', weight: 1, build: shopRow, fit: mix(2.6, 3) },
  { name: 'department-store', weight: 1, build: department, fit: mix(0.9, 1.1) },
  { name: 'bank', weight: 1, build: bank, fit: (lot) => (lot.width < 15 ? 0 : mix(0.8, 1)(lot)) },
  { name: 'city-hotel', weight: 1, build: cityHotel, fit: (lot) => mix(0.6, 0.9)(lot) * (lot.corner ? 4 : 1) },
  { name: 'cinema', weight: 1, build: cinema, fit: (lot) => (lot.depth < 18 ? 0 : mix(0.45, 0.6)(lot)) },
];
