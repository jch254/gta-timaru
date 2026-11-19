import type { LotBuilder } from '../../core/types';
import {
  type Archetype,
  BRICKS,
  CREAM,
  DOOR,
  HOUSE_PAINT,
  IRON,
  type Mat,
  type ParapetKind,
  RENDER,
  SHOP_PAINT,
  type Site,
  TRIM_PAINT,
  box,
  chimney,
  cornice,
  cyl,
  door,
  downpipe,
  flatRoof,
  frame,
  ground,
  lamp,
  mat,
  parapet,
  prop,
  quad,
  roof,
  screen,
  shade,
  shopfront,
  site,
  slope,
  solid,
  trim,
  verandah,
  walls,
  win,
  winRow,
} from './kit';
import { flankKind, flankView, serviceWall } from './service';
import { CHALK, CLASSIC, GHOST_SIGNS, ICE_CREAM, ICE_CREAM_LOOK, NEON, PUB_BOARDS, PUB_NEON, PUB_TAGS, PUBS, STONE, type StreetItem, type Trade, WALL_PAINT, board, pickTrade, signMat, tradeName, wrap } from './names';

/**
 * Verandah shopfronts: the suburban strip, the small-town main street and the lower end of the central
 * city all come out of `terrace` (a row of one or more shop units under one parapet) and `hotel`.
 */

// ───────────────────────────── Footpath clutter ─────────────────────────────

/** A-frame sandwich board on the footpath, readable from both directions. */
export function sandwichBoard(s: Site, x: number, z: number, text: string, yaw: number) {
  const m = signMat(s, text, 1, CHALK);
  const y = ground(s, x, z) + 0.4;
  s.out.quad(frame(s, x, y, z, yaw, -0.2), 0, 0, 0.14, 0.72, 0.78, m);
  s.out.quad(frame(s, x, y, z, yaw + Math.PI, -0.2), 0, 0, 0.14, 0.72, 0.78, m);
}

/** A giant ice-cream cone, the mark of a proper dairy. */
function iceCream(s: Site, x: number, y: number, z: number) {
  const scoop = trim(s, s.fx.pick([0xf2c6cf, 0xf6efd8, 0xc9e2c0, 0xe9c98a]));
  cyl(s, x, y, z, 0.04, 0.6, trim(s, 0xc99a5a), 8, 0.24);
  cyl(s, x, y + 0.55, z, 0.26, 0.3, scoop, 8, 0.2);
  cyl(s, x, y + 0.85, z, 0.18, 0.2, scoop, 8, 0.08);
}

function crates(s: Site, x: number, z: number) {
  const y = ground(s, x, z);
  box(s, x, y, z, 0.62, 0.34, 0.42, mat(s, 'timber'));
  box(s, x + 0.06, y + 0.34, z, 0.56, 0.3, 0.4, trim(s, s.fx.pick([0x2f5d3a, 0xb5261e, 0x2b4a6b, 0xc9a23a])));
}

/** What a trade leaves on the footpath between x0 and x1; `z` is the shop's wall plane. */
export function clutter(s: Site, items: readonly StreetItem[], boards: readonly string[], x0: number, x1: number, z: number, vy: number | null, fz: number | null) {
  let placed = 0;
  for (const item of items) {
    if (placed >= 2 || x1 - x0 < 1.6 || !s.fx.chance(0.5)) continue;
    const x = s.fx.range(x0 + 0.7, x1 - 0.7);
    if (item === 'board') {
      if (!s.spare(2)) continue;
      sandwichBoard(s, x, z + Math.min(s.apron - 0.5, s.fx.range(1, 1.6)), s.fx.pick(boards), Math.PI / 2 + s.fx.range(-0.25, 0.25));
    } else if (item === 'cone') {
      if (vy === null || fz === null || !s.spare(3)) continue;
      iceCream(s, x, vy + 0.3, fz - 0.4);
    } else if (item === 'crates') {
      if (!s.spare(2)) continue;
      crates(s, x, z + 0.5);
    } else if (!s.near) {
      continue;
    } else if (item === 'bench') prop(s, 'bench', x, z + 0.6);
    else if (item === 'bin') prop(s, 'bin', x, z + s.apron - 0.45);
    else if (item === 'postbox') prop(s, 'postbox', x, z + s.apron - 0.5, Math.PI);
    else if (item === 'phone') prop(s, 'phone-box', x, z + Math.max(0.9, s.apron - 0.8), Math.PI);
    placed++;
  }
}

// ───────────────────────────── One shop ─────────────────────────────

/** What a trade puts in its window (see the shop pane in render/glazing.ts): 1 drapery, 2 paper, 3 food; anything else general goods. */
const DISPLAY: Record<string, number> = {
  opshop: 1,
  drapery: 1,
  wool: 1,
  shoes: 1,
  post: 2,
  tab: 2,
  books: 2,
  realty: 2,
  travel: 2,
  stock: 2,
  chippy: 3,
  takeaways: 3,
  bakery: 3,
  butcher: 3,
  tearooms: 3,
  fruit: 3,
};

interface UnitPlace {
  x0: number;
  x1: number;
  /** Wall plane. */
  z: number;
  /** Verandah underside and the z of its fascia, when there is one. */
  vy: number | null;
  fz: number | null;
  /** Centre height and height of the name board. */
  signY: number;
  signH: number;
  /** Fewer extras in the central city, where several units share a lot. */
  plain: boolean;
  /** An old front: painted timber joinery, a recessed door, leadlight toplights. */
  period: boolean;
}

function shopUnit(s: Site, t: Trade, c: UnitPlace) {
  const w = c.x1 - c.x0;
  const cx = (c.x0 + c.x1) / 2;
  const looks = t.looks ?? CLASSIC;
  const name = wrap(tradeName(s, t));
  const tag = s.rng.pick(t.tags);
  const paint = s.rng.pick(SHOP_PAINT);
  const side = s.rng.pick([-1, 0, 1] as const);
  // Half the old fronts were redone in aluminium some time after 1965.
  const original = c.period && s.rng.chance(0.6);
  shopfront(s, {
    x0: c.x0,
    x1: c.x1,
    z: c.z,
    door: side,
    riser: original ? trim(s, paint) : mat(s, 'plaster', s.rng.pick([0xd8d2c4, 0x8a9aa0, 0x6a2a24, 0x2a2c2e, 0xc9b98a])),
    doorColor: original ? s.rng.pick(DOOR) : undefined,
    paint: original ? shade(paint, 0.9) : undefined,
    recessed: w > 3.6 && s.rng.chance(original ? 0.7 : 0.25),
    toplights: original && s.rng.chance(0.5),
    lit: s.rng.chance(0.75),
    display: DISPLAY[t.id] ?? 0,
  });
  board(s, name, cx, c.signY, c.z + 0.07, Math.min(w - 0.7, c.signH * 3), 3, looks);
  if (c.fz !== null && c.vy !== null && w > 3.3) board(s, tag, cx, c.vy - 0.02, c.fz + 0.03, Math.min(w - 0.5, 2.9), 8, looks);

  // Decoration from here on.
  if (t.neon && s.fx.chance(0.7) && s.spare()) {
    const nx = side > 0 ? c.x0 + 1.3 : c.x1 - 1.3;
    quad(s, nx, 2.12, c.z + 0.13, 1.2, 0.4, signMat(s, s.fx.pick(t.neon), 3, NEON));
  }
  if (!c.plain && c.vy !== null && s.fx.chance(0.55) && s.spare(2)) {
    // Hanging board under the verandah for people on the footpath.
    const hx = cx + s.fx.range(-0.3, 0.3) * w;
    const m = signMat(s, name, 3, looks);
    quad(s, hx + 0.02, c.vy - 0.42, c.z + 1.25, 1.05, 0.35, m, Math.PI / 2);
    quad(s, hx - 0.02, c.vy - 0.42, c.z + 1.25, 1.05, 0.35, m, -Math.PI / 2);
  }
  if (t.id === 'dairy' && s.fx.chance(0.65) && s.spare()) {
    // The tin ice-cream sign every dairy has by the door.
    quad(s, side < 0 ? c.x1 - 0.75 : c.x0 + 0.75, 2.83, c.z + 0.13, 0.84, 0.42, signMat(s, ICE_CREAM, 2, ICE_CREAM_LOOK));
  }
  if (!c.plain || s.fx.chance(0.4)) clutter(s, t.street ?? [], t.boards ?? ['OPEN'], c.x0, c.x1, c.z, c.vy, c.fz);
  if (s.near && s.fx.chance(t.light ?? 0.2)) lamp(s, cx, 2.7, c.z + 1.2);
}

// ───────────────────────────── A row of shops under one parapet ─────────────────────────────

export interface TerraceStyle {
  storeys: number;
  wall: Mat;
  dress: Mat;
  parapet: ParapetKind;
  parapetH?: number;
  verandah: 'hung' | 'posts' | 'bullnose' | null;
  /** Awning / fascia colour. */
  awning: number;
  units: readonly Trade[];
  /** Masonry front: pilasters between units, a cornice and sill courses. */
  classical?: boolean;
  /** 'gable' = iron roof behind a timber false front; 'hip' = iron behind a parapet; default flat deck. */
  roof?: 'flat' | 'hip' | 'gable';
  ground?: number;
  upper?: number;
  depth?: number;
  /** Building name on the parapet. */
  title?: string | null;
  post?: number;
  plain?: boolean;
  /** What the flanks and back are built of when it is not the street-front material (common brick, iron). */
  flank?: Mat;
  /** How the upper windows sit in the front wall. */
  joinery?: 'timber' | 'masonry' | 'stone';
}

export function terrace(s: Site, o: TerraceStyle) {
  const x0 = -s.hw + 0.05;
  const x1 = s.hw - 0.05;
  const w = x1 - x0;
  const front = s.hd - 0.2;
  const d = Math.min(o.depth ?? s.lot.depth - 3, s.lot.depth - 0.5);
  const cz = front - d / 2;
  const g = o.ground ?? 4.1;
  const u = o.upper ?? 3.5;
  const rows = o.storeys - 1;
  const top = rows === 0 ? g + 0.4 : g + rows * u;
  const n = o.units.length;
  const timber = o.joinery === 'timber';
  s.j = { style: 'sash', variant: s.rng.chance(o.classical ? 0.6 : 0.3) ? 1 : 0, frame: s.rng.pick(TRIM_PAINT), trim: CREAM, wall: o.joinery ?? (o.classical ? 'stone' : 'masonry'), sill: o.dress };

  // The street front is the good material; round the side it is whatever was cheap.
  const flank = !s.lot.corner && o.flank ? o.flank : o.wall;
  if (flank === o.wall) {
    walls(s, 0, cz, w, d, top, o.wall);
  } else {
    walls(s, 0, cz - 0.15, w, d - 0.3, top, flank);
    walls(s, 0, front - 0.15, w, 0.3, top, o.wall);
  }
  solid(s, 0, cz, w, d, top);
  if (o.roof === 'gable') roof(s, 0, top, cz - 0.25, w - 0.3, d - 0.5, 1.5, mat(s, 'corrugated', s.rng.pick(IRON)), { axis: 'z', eave: 0 });
  else if (o.roof === 'hip') roof(s, 0, top, cz - 0.3, w - 0.6, d - 0.8, 1.1, mat(s, 'corrugated', 0x8f959a), { hip: Math.min(w, d) / 2 - 0.6, eave: 0, bare: true });
  else flatRoof(s, 0, cz - 0.2, w, d - 0.4, top);

  const ph = o.parapetH ?? (o.roof === 'gable' ? 1.8 : 1);
  const panel = parapet(s, x0, x1, top, front, o.parapet, o.wall, o.dress, ph);
  if (o.classical) {
    cornice(s, x0, x1, top, front, o.dress);
    for (let i = 0; i <= n; i++) {
      const px = i === 0 ? x0 + 0.3 : i === n ? x1 - 0.3 : x0 + (w * i) / n;
      const base = Math.min(-0.4, ground(s, px, front) - 0.3);
      box(s, px, base, front + 0.09, 0.56, top - 0.42 - base, 0.22, o.dress);
      if (rows > 0 && s.spare()) box(s, px, top - 0.78, front + 0.11, 0.72, 0.34, 0.3, o.dress);
    }
  } else if (!timber && rows > 0 && s.spare()) {
    // A plain front still has a capping course where the wall meets the parapet.
    box(s, 0, top - 0.1, front + 0.04, w, 0.14, 0.12, o.dress);
  }

  const vy = 3.05;
  let fz: number | null = null;
  if (o.verandah) {
    fz = verandah(s, {
      x0,
      x1,
      z: front,
      depth: s.apron + 0.1,
      y: vy,
      kind: o.verandah,
      roof: mat(s, 'corrugated', o.awning),
      fascia: trim(s, o.verandah === 'hung' ? o.awning : CREAM),
      posts: o.verandah === 'hung' ? 0 : Math.max(2, Math.min(5, Math.round(w / 4.6) + 1)),
      post: trim(s, o.post ?? 0x2f3a34),
      lace: o.verandah !== 'hung' && (timber || o.classical) && s.rng.chance(0.6) ? (o.post ?? 0x2f3a34) : undefined,
      // Tie rods come down between the shops, clear of their name boards.
      rods: n > 1 ? [x0 + w / n, x1 - w / n] : [x0 + 0.5, x1 - 0.5],
    });
  }

  // Upper-floor sashes line up with the units below.
  const sash = Math.min(1.95, u - 1.5);
  if (rows > 0) {
    let per = Math.max(1, Math.min(3, Math.round(w / n / 3.1)));
    while (per > 1 && per * n * rows > 14) per--;
    for (let r = 0; r < rows; r++) winRow(s, x0 + 0.45, front, x1 - 0.45, front, g + r * u + 0.9 + sash / 2, per * n, 1.05, sash, 0, { lit: 0.3, hood: o.classical && r === 0 });
  }

  const signH = rows === 0 ? 0.85 : Math.min(0.75, g - vy - 0.35);
  const signY = rows === 0 ? (vy + 0.85 + top + (o.parapet === 'ornate' ? 0.25 : 0.6 * ph)) / 2 : vy + 0.85 + signH / 2;
  const period = timber || o.classical === true || s.rng.chance(0.35);
  for (let i = 0; i < n; i++) {
    const inset = o.classical ? 0.3 : 0.08;
    shopUnit(s, o.units[i], { x0: x0 + (w * i) / n + inset, x1: x0 + (w * (i + 1)) / n - inset, z: front, vy: o.verandah ? vy : null, fz, signY, signH, plain: o.plain ?? false, period });
    // A pier between neighbouring shopfronts.
    if (!o.classical && i > 0 && s.spare()) box(s, x0 + (w * i) / n, -0.4, front + 0.05, 0.3, vy + 0.4, 0.12, o.dress);
  }

  // Decoration.
  // Chimneys from the days of a fire in every upstairs room, standing clear of the parapet on a side wall.
  if (rows > 0 && !o.plain && o.roof !== 'gable') {
    const stack = mat(s, 'brick', shade(0xe6d6cc, 0.9));
    for (const side of [-1, 1]) {
      if (s.fx.chance(0.55) && s.spare(4)) chimney(s, side * (w / 2 - 0.5), cz + s.fx.range(-0.25, 0.2) * d, top, ph + s.fx.range(1, 1.7), stack, s.fx.chance(0.6));
    }
  }
  if (o.title && rows > 0 && s.spare()) {
    const th = o.parapet === 'ornate' ? 0.7 : ph * 0.55;
    const aspect = o.title.length > 8 ? 5 : 3;
    board(s, o.title, 0, top + panel, front + 0.07, Math.min(w * (o.parapet === 'flat' ? 0.5 : 0.32), th * aspect), aspect, STONE);
  }
  if (o.classical && rows > 0 && s.spare(rows)) {
    for (let r = 0; r < rows; r++) box(s, 0, g + r * u + 0.72, front + 0.07, w - 0.3, 0.14, 0.2, o.dress);
  }
  // Rainwater: a pipe down the front by one end.
  if (!timber && s.spare(2)) downpipe(s, s.fx.pick([x0 + 0.12, x1 - 0.12]), front, o.verandah ? vy + 0.6 : 0, top - 0.1, 0);
  // A painted sign going ghostly on a side wall that does not face a street.
  const views = [-1, 1].map((side) => flankView(s, side));
  const open = views[0] === 'open' ? -1 : views[1] === 'open' ? 1 : 0;
  const either = s.fx.pick([-1, 1]);
  // It goes where it can be read: on the flank with nothing built beside it, if there is one.
  const ghost = rows > 0 && s.fx.chance(open ? 0.9 : 0.5) && s.spare() ? open || either : 0;
  const gw = Math.min(d * 0.5, 5.6);
  const signed = ghost !== 0 && views[ghost < 0 ? 0 : 1] !== 'street';
  if (signed) board(s, s.fx.pick(GHOST_SIGNS), ghost * (w / 2 + 0.025), g + (rows * u) / 2 + 0.2, front - 1.2 - gw / 2, gw, 3, WALL_PAINT, (ghost * Math.PI) / 2);
  // The flanks and the back: what shows down a side street, over a lower neighbour, and from the yard behind.
  [-1, 1].forEach((side, i) => {
    // Along a flank, t runs from the street end (negative on the +x side) to the back.
    const mid = side * (cz - (front - 1.2 - gw / 2));
    serviceWall(s, { x: side * (w / 2), z: cz, yaw: (side * Math.PI) / 2, len: d, top, ground: g, upper: u, rows, wall: flank, ...flankKind(views[i]), shop: true, clear: signed && ghost === side ? [mid - gw / 2, mid + gw / 2] : undefined });
  });
  serviceWall(s, { x: 0, z: front - d, yaw: Math.PI, len: w, top, ground: g, upper: u, rows, wall: flank, kind: 'back', doors: n, room: front - d + s.hd });
  return { front, top, d, cz, w };
}

/** Common brick or corrugated iron for the sides of a shop whose front is something better. */
export function flankFor(s: Site, kind: 'timber' | 'masonry' | 'render'): Mat {
  const r = s.rng.next();
  if (kind === 'timber') return r < 0.55 ? mat(s, 'corrugated', s.rng.pick([0x8f959a, 0xa9a79d, 0x7c2a22, 0x6f3a2c])) : mat(s, 'weatherboard', s.rng.pick(HOUSE_PAINT));
  if (kind === 'masonry') return mat(s, 'brick', shade(s.rng.pick(BRICKS), 0.88));
  return r < 0.6 ? mat(s, 'brick', shade(s.rng.pick(BRICKS), 0.88)) : mat(s, 'plaster', shade(s.rng.pick(RENDER), 0.92));
}

/** One or two shops on a plot, for a column of the trade mix: 0 = suburban strip, 1 = township main street. */
export function shopLot(column: 0 | 1): LotBuilder {
  return (lot, out, rng) => {
    const s = site(lot, out, rng);
    const timber = rng.chance(column === 1 ? 0.45 : 0.18);
    const storeys = !timber && rng.chance(column === 1 ? 0.3 : 0.5) ? 2 : 1;
    const first = pickTrade(rng, column, lot.corner);
    const units = lot.width >= 10.5 && rng.chance(0.45) ? [first, pickTrade(rng, column, false, first)] : [first];
    const masonry = !timber && rng.chance(0.5);
    const stone = masonry && s.timaru && rng.chance(0.4);
    const wall = timber
      ? mat(s, 'weatherboard', rng.pick(HOUSE_PAINT))
      : stone
        ? mat(s, 'bluestone')
        : masonry
          ? mat(s, 'brick', rng.pick(BRICKS))
          : mat(s, 'plaster', rng.pick(RENDER));
    const dress = timber ? trim(s) : mat(s, 'plaster', masonry ? 0xece5d3 : 0xf4efe2);
    const kinds: ParapetKind[] = timber ? ['stepped', 'flat', 'stepped'] : masonry && (s.timaru || rng.chance(0.25)) ? ['ornate', 'pediment', 'ornate'] : ['flat', 'stepped', 'pediment', 'flat'];
    const verandahs = timber ? (['posts', 'bullnose', 'posts'] as const) : (['hung', 'hung', 'posts', 'bullnose', null] as const);
    terrace(s, {
      storeys,
      wall,
      dress,
      parapet: rng.pick(kinds),
      parapetH: timber ? 1.8 : rng.range(0.8, 1.25),
      verandah: rng.pick(verandahs),
      awning: rng.pick(SHOP_PAINT),
      units,
      classical: masonry && storeys === 2 && rng.chance(0.6),
      roof: timber ? 'gable' : 'flat',
      ground: timber ? 3.7 : 4.1,
      depth: lot.depth - rng.range(2.5, 5.5),
      title: masonry && rng.chance(0.3) ? rng.pick(['1903', '1911', 'A.D. 1906', 'ESTD 1898']) : null,
      post: rng.pick([0x2f3a34, 0xf3eddc, 0x3a2a22]),
      flank: flankFor(s, timber ? 'timber' : masonry ? 'masonry' : 'render'),
      joinery: timber ? 'timber' : masonry ? 'stone' : 'masonry',
    });
  };
}

// ───────────────────────────── Pubs and hotels ─────────────────────────────

export interface HotelStyle {
  name: string;
  storeys: number;
  wall: Mat;
  dress: Mat;
  iron: number;
  /** Country pub: a two-level verandah across the front and round the corners. */
  balcony?: boolean;
  /** Parapet front (town); omit for a hipped roof you can see (country). */
  parapet?: ParapetKind;
  verandah?: 'hung' | 'posts' | 'bullnose' | null;
  /** Corner cupola. */
  turret?: boolean;
  /** Gap left each side of the building. */
  inset?: number;
  depth?: number;
  awning?: number;
  /** Weatherboard walls: windows in timber facings rather than set into masonry. */
  timber?: boolean;
}

export function hotel(s: Site, o: HotelStyle) {
  // Never let the side gaps squeeze the building below a workable width on an undersized plot.
  const inset = Math.max(0.05, Math.min(o.inset ?? 0.05, (s.lot.width - 6.5) / 2));
  const w = s.lot.width - inset * 2;
  const x0 = -w / 2;
  const x1 = w / 2;
  const front = s.hd - 0.2;
  const d = Math.min(o.depth ?? s.lot.depth - 3.5, s.lot.depth - 0.9);
  const cz = front - d / 2;
  const g = 4;
  const u = 3.4;
  const rows = o.storeys - 1;
  const top = g + rows * u;
  const iron = mat(s, 'corrugated', o.iron);
  const paint = trim(s);
  const darkPaint = s.rng.pick([0x3a2a22, 0x1f3a2e, 0x4a1f1f, 0x23303a]);
  const dark = trim(s, darkPaint);
  s.j = { style: 'sash', variant: 1, frame: s.rng.pick([0xf6f4ee, 0xf3eddc, darkPaint]), trim: CREAM, wall: o.timber ? 'timber' : 'stone', sill: o.dress };

  walls(s, 0, cz, w, d, top, o.wall);
  solid(s, 0, cz, w, d, top);
  if (o.parapet) {
    roof(s, 0, top, cz - 0.3, w - 0.6, d - 0.8, 1.2, iron, { hip: Math.min(w, d) / 2 - 0.6, eave: 0, bare: true });
    const panel = parapet(s, x0, x1, top, front, o.parapet, o.wall, o.dress, 1.15);
    cornice(s, x0, x1, top, front, o.dress, 0.28);
    const th = o.parapet === 'ornate' ? 0.7 : 0.62;
    board(s, wrap(o.name), 0, top + panel, front + 0.07, Math.min(w * 0.32, th * 3), 3, STONE);
  } else {
    roof(s, 0, top, cz, w, d, 2.3, iron, { hip: Math.min(w, d) / 2, eave: Math.min(0.35, inset - 0.05) });
  }

  // Ground floor: a door in the middle bay, bar windows either side.
  const bays = Math.max(3, Math.min(5, Math.round(w / 3.2)));
  const doorBay = Math.floor(bays / 2);
  for (let i = 0; i < bays; i++) {
    const bx = x0 + (w * (i + 0.5)) / bays;
    if (i === doorBay) door(s, bx, 0, front + 0.02, darkPaint, 0, 1.7, 2.3, 3);
    else win(s, bx, 2, front, Math.min(1.9, w / bays - 0.9), 1.9, 0, { lit: 0.66, hood: !o.timber });
  }
  for (let r = 0; r < rows; r++) winRow(s, x0 + 0.4, front, x1 - 0.4, front, g + r * u + 1.85, bays, 1.05, 1.8, 0, { lit: 0.35, hood: !o.timber && !o.balcony });

  let vy: number | null = null;
  let fz: number | null = null;
  if (o.balcony) {
    // Deck on posts over the footpath, balustrade, and a second run of posts carrying the iron above.
    const vd = Math.min(s.apron + 0.1, 2.6);
    const deckY = g - 0.3;
    const zf = front + vd;
    const wrapBy = inset >= 1 ? Math.min(inset - 0.15, 1.5) : 0;
    const bw = w + wrapBy * 2;
    const ry = deckY + 2.55;
    const deck = mat(s, 'timber');
    const lace = s.rng.pick([CREAM, CREAM, darkPaint]);
    const rails = s.rng.pick([0, 0, 3, 2]);
    box(s, 0, deckY, front + vd / 2, bw, 0.14, vd, deck);
    box(s, 0, deckY - 0.3, zf - 0.06, bw, 0.3, 0.1, paint);
    box(s, 0, ry - 0.2, zf - 0.06, bw, 0.2, 0.1, paint);
    // Balustrade and a spindle frieze under the eave, both cut-out screens.
    screen(s, 'picket', 0, deckY + 0.14 + 0.48, zf - 0.06, bw, 0.96, 0, lace, rails);
    if (s.spare(2)) screen(s, 'fret', 0, ry - 0.36, zf - 0.06, bw, 0.3, 0, lace, 0);
    if (wrapBy > 0.6) {
      // Returns down each side, under one hipped skirt of iron that wraps the corners. The skirt is a
      // hip prism whose middle is buried in the building; a lining under it closes the view from below.
      const rl = Math.min(d * 0.6, 6);
      const lift = top - 0.25 - (ry + 0.1);
      const span = rl + vd + 0.15;
      const rise = (lift * (span / 2)) / (vd + 0.15);
      s.out.gable(s.f, 0, ry + 0.1, front - rl + span / 2, bw + 0.3, span, rise, iron, (rise * (wrapBy + 0.15)) / lift);
      box(s, 0, ry - 0.06, front + vd / 2, bw, 0.06, vd, paint);
      for (const side of [-1, 1]) {
        const ex = side * (w / 2 + wrapBy - 0.06);
        box(s, side * (w / 2 + wrapBy / 2), deckY, front - rl / 2, wrapBy, 0.14, rl, deck);
        box(s, side * (w / 2 + wrapBy / 2), ry - 0.06, front - rl / 2, wrapBy, 0.06, rl, paint);
        screen(s, 'picket', ex, deckY + 0.14 + 0.48, front - rl / 2, rl, 0.96, (side * Math.PI) / 2, lace, rails);
        const base = Math.min(0, ground(s, ex, front - rl)) - 0.3;
        box(s, ex, base, front - rl + 0.1, 0.14, deckY - base, 0.14, paint);
        box(s, ex, deckY + 0.14, front - rl + 0.1, 0.1, ry - 0.2 - deckY, 0.1, paint);
      }
    } else {
      slope(s, 0, top - 0.25, front, 0, ry + 0.1, zf + 0.15, bw, 0.07, iron);
    }
    const posts = Math.max(3, Math.min(5, Math.round(bw / 3.6) + 1));
    for (let i = 0; i < posts; i++) {
      const px = -bw / 2 + 0.12 + ((bw - 0.24) * i) / (posts - 1);
      const base = Math.min(0, ground(s, px, zf)) - 0.3;
      box(s, px, base, zf - 0.06, 0.14, deckY - 0.3 - base, 0.14, paint);
      box(s, px, deckY + 0.14, zf - 0.06, 0.1, ry - 0.34 - deckY, 0.1, paint);
      if (s.spare(2)) {
        if (i > 0) screen(s, 'fret', px - 0.32, deckY - 0.58, zf - 0.06, 0.55, 0.55, 0, lace, 2, 1);
        if (i < posts - 1) screen(s, 'fret', px + 0.32, deckY - 0.58, zf - 0.06, 0.55, 0.55, 0, lace, 1, 2);
      }
    }
    // The name goes on the balustrade, where a country pub always has it.
    board(s, o.name, 0, deckY + 0.6, zf + 0.02, Math.min(bw - 1, 5.2), 8, CLASSIC);
    vy = deckY - 0.3;
    fz = zf - 0.01;
  } else if (o.verandah) {
    vy = 3.05;
    fz = verandah(s, {
      x0,
      x1,
      z: front,
      depth: s.apron + 0.1,
      y: vy,
      kind: o.verandah,
      roof: mat(s, 'corrugated', o.awning ?? o.iron),
      fascia: o.verandah === 'hung' ? trim(s, o.awning ?? o.iron) : paint,
      posts: o.verandah === 'hung' ? 0 : Math.max(2, Math.min(5, Math.round(w / 4.6) + 1)),
      post: paint,
      lace: o.verandah === 'hung' ? undefined : CREAM,
    });
    board(s, s.rng.pick(PUB_TAGS), 0, vy - 0.02, fz + 0.03, Math.min(w - 0.6, 3.4), 8, CLASSIC);
    if (!o.parapet) board(s, wrap(o.name), 0, vy + 1.25, front + 0.07, 2.4, 3, CLASSIC);
  } else if (!o.parapet) {
    board(s, wrap(o.name), 0, 3.5, front + 0.07, 2.4, 3, CLASSIC);
  }

  const cy = top + (o.parapet ? 0 : 0.2);
  chimney(s, -w * 0.28, cz + d * 0.18, cy, o.parapet ? 2.2 : 2.9, mat(s, 'brick'), true);
  chimney(s, w * 0.3, cz - d * 0.2, cy, o.parapet ? 2.2 : 2.9, mat(s, 'brick'), true);
  if (o.turret) {
    // Drum and cupola over one front corner.
    const side = s.rng.pick([-1, 1]);
    const tx = side * (w / 2 - 1.5);
    cyl(s, tx, top - 0.2, front - 1.5, 1.45, 2.4, o.wall, 8);
    cyl(s, tx, top + 2.2, front - 1.5, 1.65, 2.2, mat(s, 'slate'), 8, 0);
    if (s.spare()) cyl(s, tx, top + 4.4, front - 1.5, 0.05, 1, trim(s, 0x3a3a3a), 5);
  }

  // Decoration.
  // Round the sides (bar windows and the bottle-store door where a street or open ground shows them) and
  // the back (kitchen and cellar doors, the fire escape from the bedrooms).
  for (const side of [-1, 1]) {
    serviceWall(s, { x: side * (w / 2), z: cz, yaw: (side * Math.PI) / 2, len: d, top, ground: g, upper: u, rows, wall: o.wall, ...(inset >= 0.8 ? { kind: 'street' as const } : flankKind(flankView(s, side))), room: inset, paint: darkPaint });
  }
  serviceWall(s, { x: 0, z: front - d, yaw: Math.PI, len: w, top, ground: g, upper: u, rows, wall: o.wall, kind: 'back', doors: 2, room: front - d + s.hd, paint: darkPaint });
  // Dado of dark paint (or tiles) along the bar front.
  if (s.spare()) box(s, 0, -0.4, front + 0.03, w - 0.2, 1.3, 0.08, dark);
  if (s.spare()) quad(s, x0 + (w * (doorBay + 0.5)) / bays, 3.05, front + 0.11, 1.5, 0.5, signMat(s, s.fx.pick(PUB_NEON), 3, NEON));
  if (s.fx.chance(0.5) && s.spare()) board(s, 'TOTE', x1 - 0.9, 3.05, front + 0.07, 0.9, 2, [{ bg: '#1d2a44', fg: '#f0c33a', style: 'block' }]);
  if (s.spare(2)) downpipe(s, x1 - 0.14, front, vy === null ? 0 : vy + 0.6, top - 0.1, 0);
  clutter(s, ['bench', 'bin', 'board'], PUB_BOARDS, x0, x1, front, vy, fz);
  if (s.near) lamp(s, 0, 2.8, front + 1.2, 0xffd9a0, 130, 12);
}

const pub: LotBuilder = (lot, out, rng) => {
  const s = site(lot, out, rng);
  const brick = rng.chance(0.4);
  hotel(s, {
    name: rng.pick(PUBS),
    storeys: 2,
    wall: brick ? mat(s, 'brick', rng.pick(BRICKS)) : mat(s, 'plaster', rng.pick(RENDER)),
    dress: mat(s, 'plaster', 0xece5d3),
    iron: rng.pick(IRON),
    parapet: rng.pick(['flat', 'pediment', 'stepped'] as const),
    verandah: rng.pick(['hung', 'posts', 'bullnose'] as const),
    awning: rng.pick(SHOP_PAINT),
    depth: lot.depth - rng.range(3, 5),
  });
};

export const SHOPS: Archetype[] = [
  { name: 'shop', weight: 12, build: shopLot(0) },
  { name: 'pub', weight: 0.7, build: pub, fit: (lot) => (lot.width < 9 ? 0 : lot.corner ? 5 : 1) },
];
