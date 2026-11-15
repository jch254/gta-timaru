// Registers the static cars, sandwich boards and yard kinds.
import { hashInts } from '../../../core/rng';
import '../../props/extra';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { type Batch, bench, flagpole, gableRoof, Geo, picnicTable, Site, sub, walls, windowRow } from './kit';

const hex = (color: number) => '#' + color.toString(16).padStart(6, '0');

// Invented fuel brands (no real oil companies): name, main colour, accent, prices in cents per litre c. 1995.
const FUEL = [
  { name: 'TUSSOCK', main: 0x2f6a3a, accent: 0xe8c23a, prices: ['88.9', '92.9', '54.9'] },
  { name: 'PLAINSMAN', main: 0xb8322a, accent: 0xf2efe6, prices: ['89.9', '93.9', '55.9'] },
  { name: 'BRAIDWATER', main: 0x1f4a8a, accent: 0xe87a2a, prices: ['87.9', '91.9', '53.9'] },
];

/**
 * Country service station: a canopy over two pump islands, a kiosk shop with a two-bay workshop, a price
 * board on a pole (cents per litre) and the odds and ends of a forecourt. The fuel brand is invented and
 * picked by the seed.
 */
export const serviceStation: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const brand = FUEL[s.seed % FUEL.length];
  const main = s.mat('paintedMetal', brand.main);
  const white = s.mat('paintedMetal', 0xf2efe6);
  const concrete = s.mat('concrete');
  const b = s.batch();

  // Forecourt slab.
  const slab = new Geo();
  s.drape(slab, 0, 3, 30, 22, 0.05);
  slab.flush(out, s.ground('concrete', 0xc4c0b4), f);

  // Kiosk and workshop.
  walls(out, f, 0, -12, 20, 3.6, 8, s.mat('plaster', 0xf2efe6));
  out.box(f, 0, 3.95, -11.6, 20.8, 0.9, 9.4, main);
  out.box(f, 0, 3.52, -7.3, 20.8, 0.08, 0.8, s.mat('paintedMetal', brand.accent));
  out.collider(f, 0, 1.8, -12, 20, 3.6, 8);
  out.quad(f, -5.2, 1.6, -7.97, 6.6, 2.2, m.windows('shop'));
  out.box(f, -1, 1.1, -7.96, 1, 2.2, 0.08, s.mat('glass', 0x31424c));
  for (const x of [3.2, 7.4]) out.box(f, x, 1.5, -7.96, 3.4, 3, 0.08, s.mat('paintedMetal', 0xc9ccd0));
  s.sign(f, brand.name, -4.6, 3.95, -6.88, 6.4, 6, { bg: hex(brand.main), fg: hex(brand.accent), style: 'block', border: false });
  s.sign(f, 'LUBE · TYRES · WOF', 5.3, 3.95, -6.88, 6.4, 8, { bg: hex(brand.main), fg: '#f2efe6', style: 'block', border: false });
  s.sign(f, 'PIES · COLD DRINKS · ICE', -5.2, 2.95, -7.95, 5, 9, { bg: '#f2efe6', fg: '#22313a', style: 'paint' });

  // Canopy on four columns over the pumps.
  out.box(f, 0, 4.85, 4, 15, 0.7, 8.6, main);
  out.box(f, 0, 4.46, 4, 15.2, 0.1, 8.8, s.mat('paintedMetal', brand.accent));
  for (const sx of [-5.6, 5.6]) {
    for (const sz of [1.2, 6.8]) {
      out.cylinder(f, sx, 2.2, sz, 0.16, 0.16, 4.5, white, 8);
      out.collider(f, sx, 2.2, sz, 0.4, 4.4, 0.4);
    }
  }
  for (const face of [1, -1]) s.sign(f, brand.name, 0, 4.85, 4 + face * 4.32, 6, 8, { bg: hex(brand.main), fg: hex(brand.accent), style: 'block', border: false }, face === 1 ? 0 : Math.PI);
  const glow = b.g(m.emitter(0xfff4d8, 'night'));
  for (const x of [-3.6, 3.6]) glow.box(x, 4.38, 4, 2.2, 0.06, 0.5);

  // Pump islands.
  const pumpBody = b.g(white);
  const pumpTrim = b.g(main);
  const dark = b.g(s.mat('rubber'));
  for (const ix of [-3.6, 3.6]) {
    out.box(f, ix, 0.02, 4, 3.6, 0.36, 1.3, concrete);
    out.collider(f, ix, 0.8, 4, 3.4, 1.6, 1);
    for (const px of [-0.9, 0.9]) {
      pumpBody.box(ix + px, 0.95, 4, 0.7, 1.5, 0.48);
      pumpTrim.box(ix + px, 1.8, 4, 0.76, 0.24, 0.54).box(ix + px, 0.34, 4, 0.74, 0.3, 0.52);
      for (const face of [-1, 1]) dark.box(ix + px, 1.3, 4 + face * 0.25, 0.5, 0.36, 0.02);
      dark.beam([ix + px + 0.36, 1.2, 4], [ix + px + 0.5, 0.5, 4.1], 0.04);
    }
    b.g(white).post(ix, 0.2, 4, 0.08, 1.2);
  }

  // Price board.
  {
    const px = rng.chance(0.5) ? -12.5 : 12.5;
    const fp = s.at(px, 13);
    out.cylinder(fp, 0, 2.6, 0, 0.14, 0.16, 5.8, white, 8);
    out.box(fp, 0, 5.9, 0, 2.5, 1, 0.24, main);
    out.box(fp, 0, 4.1, 0, 2.5, 2.5, 0.2, white);
    s.signBoard(fp, brand.name, 0, 5.9, 0.07, 2.3, 3, { bg: hex(brand.main), fg: hex(brand.accent), style: 'block', border: false });
    s.signStack(fp, [`91   ${brand.prices[0]}`, `96   ${brand.prices[1]}`, `DIESEL ${brand.prices[2]}`], 0, 4.3, 0.05, 2.3, 0.62, { bg: '#f2efe6', fg: '#1c1c1c', style: 'block' }, 0, true);
    s.signBoard(fp, 'CENTS PER LITRE', 0, 3.08, 0.05, 2.3, 8, { bg: '#f2efe6', fg: '#1c1c1c', style: 'block', border: false });
    out.collider(fp, 0, 2.5, 0, 0.5, 5, 0.5);
    s.light(px, 4.5, 14.5, 0xfff0d0, 1, 16);
  }

  // Forecourt clutter: air and water, gas bottles, oil rack, tyres, bin.
  const g = b.g(s.mat('paintedMetal', 0xc8322a));
  g.post(-9.2, 0, -2.5, 0.28, 1.3);
  dark.beam([-9.05, 1.1, -2.5], [-8.7, 0.25, -2.2], 0.03);
  const cage = b.g(s.mat('metal', 0x8f959a, { roughness: 0.6 }));
  cage.box(9.2, 0.9, -7.5, 1.8, 1.8, 0.7);
  s.sign(f, 'SWAP-A-BOTTLE', 9.2, 1.95, -7.13, 1.7, 5, { bg: '#f2efe6', fg: '#b8322a', style: 'block' });
  const rack = b.g(main);
  rack.box(-8.6, 0.6, -7.6, 1.4, 1.2, 0.4);
  const tyres = b.g(s.mat('rubber'));
  for (let k = 0; k < 4; k++) tyres.lathe(9.4 + (k % 2) * 0.05, 0.11 + k * 0.22, -3.2, [[0.2, -0.1], [0.34, -0.1], [0.34, 0.1], [0.2, 0.1]], 10);
  b.g(s.mat('paintedMetal', 0x3a6a4a)).lathe(-6.6, 0, 7.6, [[0.26, 0], [0.3, 0.85], [0, 0.85]], 8);
  b.flush();
  s.light(0, 4, 4, 0xfff4d8, 1.8, 22);
};

const PUBS = ["DROVER'S REST HOTEL", "THE NOR'WESTER HOTEL", 'MUSTERERS ARMS HOTEL', 'PLOUGH & PADDOCK HOTEL', 'THE GOLDEN TUSSOCK'];
const PUB_WALLS = [0xf1ead8, 0xe6dcc0, 0xd8e2d0, 0xeed6c8];
const PUB_ROOFS = [0x8b3027, 0x35603f, 0x6f3a2c, 0x5c6268];

/**
 * Country pub: a two-storey weatherboard hotel (20 × 10 m) with a verandah and balcony across the front,
 * hipped iron roof, two brick chimneys, a kitchen lean-to and a couple of tables out the side.
 */
export const countryPub: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const wallColor = rng.pick(PUB_WALLS);
  const roofColor = rng.pick(PUB_ROOFS);
  const wall = s.mat('weatherboard', wallColor);
  const roof = s.mat('corrugated', roofColor, { metalness: 0.3 });
  const trim = s.mat('plain', 0xf7f3e8, { roughness: 0.6 });
  const accent = s.mat('plain', roofColor, { roughness: 0.6 });
  const name = s.label(rng.pick(PUBS));
  const b = s.batch();

  walls(out, f, 0, -3, 20, 6.9, 10, wall);
  out.gable(f, 0, 6.9, -3, 21, 11, 2.5, roof, 5);
  out.collider(f, 0, 3.45, -3, 20, 6.9, 10);
  out.box(f, 0, 3.45, -3, 20.15, 0.2, 10.15, trim);
  for (const x of [-6, 5.5]) {
    out.box(f, x, 8.9, -4.2, 0.9, 2.6, 0.9, s.mat('brick'));
    out.box(f, x, 10.25, -4.2, 1.1, 0.14, 1.1, s.mat('concrete'));
  }

  // Verandah below, balcony above, under one lean-to roof.
  const posts = b.g(trim);
  const deck = b.g(s.mat('timber', 0x7a6a56));
  deck.box(0, 0.08, 3.3, 20.6, 0.16, 2.6);
  deck.box(0, 3.4, 3.3, 20.6, 0.14, 2.6);
  b.g(roof).slab([-10.5, 5.75, 4.75], [10.5, 5.75, 4.75], [10.5, 6.45, 2], [-10.5, 6.45, 2], 0.08);
  for (let i = 0; i <= 6; i++) {
    const x = -10.1 + (20.2 * i) / 6;
    posts.post(x, 0, 4.45, 0.14, 5.72);
    if (i < 6) {
      const x1 = x + 20.2 / 6;
      posts.box((x + x1) / 2, 4.35, 4.45, 20.2 / 6, 0.07, 0.06).box((x + x1) / 2, 3.62, 4.45, 20.2 / 6, 0.07, 0.06);
      for (let k = 1; k < 9; k++) posts.box(x + ((x1 - x) * k) / 9, 3.98, 4.45, 0.04, 0.7, 0.04);
      b.g(accent).box((x + x1) / 2, 3.2, 4.45, 20.2 / 6, 0.22, 0.05);
    }
  }
  for (const side of [-1, 1]) posts.box(side * 10.25, 3.98, 3.3, 0.06, 0.8, 2.4);

  // Doors and windows.
  const doorX = rng.pick([-3.3, 0, 3.3]);
  out.box(f, doorX, 1.2, 2.04, 1.5, 2.4, 0.08, s.mat('timber', 0x4a2f20));
  out.quad(f, doorX, 2.7, 2.05, 1.5, 0.5, m.windows('shop'));
  for (let i = 0; i < 6; i++) {
    const x = -8.25 + i * 3.3;
    if (Math.abs(x - doorX) > 1.4) out.quad(f, x, 1.75, 2.03, 1.3, 1.9, m.windows('house'));
    out.quad(f, x, 5.0, 2.03, 1.1, 2.2, m.windows('house'));
  }
  for (const side of [-1, 1]) {
    for (const z of [-5.5, -1]) {
      out.quad(f, side * 10.03, 1.75, z, 1.3, 1.9, m.windows('house'), (side * Math.PI) / 2);
      out.quad(f, side * 10.03, 5.0, z, 1.1, 1.9, m.windows('house'), (side * Math.PI) / 2);
    }
  }
  windowRow(out, f, -9, 9, 5, 5, -8.03, 1.1, 1.7, m.get('glass'), Math.PI);

  // Signs: the name along the balcony, the bars over the doors, a painted gable-end advertisement.
  s.sign(f, name, 0, 6.05, 4.82, 11, 11, { bg: hex(wallColor), fg: hex(roofColor & 0x7f7f7f), style: 'paint' });
  s.sign(f, 'PUBLIC BAR', doorX, 3.05, 2.06, 2.2, 5.5, { bg: '#1c1c1c', fg: '#e8c23a', style: 'block' });
  const far = doorX > 0 ? -6.6 : 6.6;
  s.sign(f, 'BOTTLE STORE', far, 3.05, 2.06, 2.4, 5.5, { bg: hex(roofColor), fg: '#f2ead6', style: 'block' });
  const adSide = rng.chance(0.5) ? 1 : -1;
  s.signStack(f, ['ACCOMMODATION', 'COUNTER MEALS'], adSide * 10.04, 3.4, -3.2, 4.6, 0.8, { bg: hex(wallColor), fg: '#22313a', style: 'paint' }, (adSide * Math.PI) / 2);

  // Kitchen lean-to, kegs by the back door, tables beside.
  out.box(f, -3, 0.7, -9.6, 11, 4.4, 3.2, wall);
  b.g(roof).slab([-8.7, 2.5, -11.4], [-8.7, 3.5, -8], [2.7, 3.5, -8], [2.7, 2.5, -11.4], 0.08);
  out.collider(f, -3, 1.4, -9.6, 11, 2.8, 3.2);
  const kegs = b.g(s.mat('metal', 0xa9adb0, { roughness: 0.4 }));
  for (const [kx, kz] of [[4, -9], [4.7, -9.3], [4.3, -9.8]] as const) kegs.lathe(kx, 0, kz, [[0.2, 0], [0.24, 0.3], [0.2, 0.6], [0, 0.6]], 8);
  const tables = b.g(s.mat('timber', 0x7a5a3c));
  const tSide = -adSide;
  for (const z of [-5.5, -1]) {
    const x = tSide * 13.6;
    const y = s.gy(x, z);
    picnicTable(tables, x, y, z, Math.PI / 2);
    out.collider(f, x, y + 0.4, z, 1.6, 0.8, 1.8);
  }
  const lamp = b.g(m.emitter(0xffe6a8, 'night'));
  for (const x of [-6.7, 0, 6.7]) lamp.box(x, 3.28, 3.3, 0.3, 0.08, 0.3);
  b.flush();
  s.light(0, 2.8, 4, 0xffdca0, 1.4, 18);
  s.light(adSide * 12, 4, -3, 0xffdca0, 0.8, 14);

  // The forecourt: utes and cars nosed in towards the verandah, a board out by the road, crates and empties by
  // the bottle store. Nothing stands near a mission marker or on anybody's carriageway.
  const clear = (lx: number, lz: number, r: number): boolean => {
    const x = s.wx(lx, lz);
    const z = s.wz(lx, lz);
    if (out.world.places.some((q) => Math.hypot(q.x - x, q.z - z) < r + 5)) return false;
    const hit = out.world.graph.nearest(x, z, 24);
    return !hit || hit.distance > hit.edge.width / 2 + r + 1.5;
  };
  const TINTS = [0xe8e6df, 0x8f959a, 0x9a1f1c, 0x1f3f7a, 0xc9b78a, 0x2d5a44, 0x6f3a2c, 0xd9d6cc];
  for (let i = 0; i < 7; i++) {
    const x = -8.7 + i * 2.9;
    const kind = rng.pick(['car-parked', 'car-parked', 'car-parked-wagon', 'van-parked']);
    // (Not `rng.pick`: four draws a car line the generator's low bits up, and every car comes out the same colour.)
    const tint = TINTS[hashInts(s.seed, i, 311) % TINTS.length];
    const skew = rng.range(-0.06, 0.06);
    if (rng.chance(0.45) || Math.abs(x - doorX) < 1.7 || !clear(x, 10.4, 2.4)) continue;
    s.prop(kind, x, 10.4 + rng.range(-0.3, 0.3), Math.PI + skew, 1, tint);
  }
  if (clear(far * 0.6, 15.5, 0.6)) s.prop('sandwich-board', far * 0.6, 15.5, Math.PI / 2 + 0.2, 1, 0x2a2c2e);
  s.prop('pallet', far + 2.4, 2.9, 0.3);
  for (const [dx, dz] of [[1.2, 2.7], [1.75, 2.75], [1.45, 3.2]] as const) s.prop('drum', far + dx - 3.6, dz, 0, 0.62, 0xb4b8bc);
};

/** Lancet window on a wall whose outward direction is local +z. */
function lancet(glass: Geo, frame: Geo, x: number, y: number, w: number, h: number): void {
  glass.box(x, y + h / 2, 0.05, w, h, 0.06);
  glass.poly([[x - w / 2, y + h, 0.08], [x + w / 2, y + h, 0.08], [x, y + h + w * 1.1, 0.08]]);
  frame.box(x, y - 0.06, 0.07, w + 0.3, 0.1, 0.14);
  for (const side of [-1, 1]) frame.box(x + side * (w / 2 + 0.05), y + h / 2, 0.06, 0.08, h, 0.1);
}

const SAINTS = ["ST ANDREW'S", "ST JOHN'S", "ST MARY'S", "ST PAUL'S", "ST COLUMBA'S", "ST AIDAN'S"];

/**
 * Country church: a small weatherboard Gothic church (nave 13 × 6.4 m) with a steep iron roof, a gabled
 * porch, a chancel, lancet windows and a bell cote (or a little spire) on the front gable. Some have a
 * few headstones beside them.
 */
export const countryChurch: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const rng = s.rng;
  const wallColor = rng.pick([0xf4f1e8, 0xf1ead8, 0xe9e0c8]);
  const wall = s.mat('weatherboard', wallColor);
  const roof = s.mat('corrugated', rng.pick([0x8b3027, 0x35603f, 0x6f6a62]), { metalness: 0.3 });
  const trim = s.mat('plain', 0xf7f3e8, { roughness: 0.6 });
  const stained = s.mat('glass', rng.pick([0x3a4a7a, 0x5a3a5a, 0x2f4a5a]), { roughness: 0.3 });
  const b = s.batch();

  // Nave: ridge runs front to back, so the roof is built in a frame turned a quarter.
  const fr = sub(f, 0, 0, -2, Math.PI / 2);
  const br = s.batch(fr);
  walls(out, f, 0, -2, 6.4, 3.4, 13, wall);
  gableRoof(out, br.g(wall), fr, 0, 3.4, 0, 13, 6.4, 4.4, roof, 0.35);
  out.collider(f, 0, 3, -2, 6.4, 6, 13);
  // Chancel.
  walls(out, f, 0, -10.5, 4.6, 2.9, 4, wall);
  gableRoof(out, br.g(wall), fr, 8.5, 2.9, 0, 4, 4.6, 3.2, roof, 0.3);
  out.collider(f, 0, 2.2, -10.5, 4.6, 4.4, 4);
  // Porch.
  const porchSide = rng.chance(0.6);
  const fp = porchSide ? sub(f, 3.2 + 1.2, 0, 1.5, Math.PI / 2) : sub(f, 0, 0, 4.5 + 1.2, 0);
  const bp = s.batch(sub(fp, 0, 0, 0, Math.PI / 2));
  walls(out, fp, 0, 0, 2.6, 2.4, 2.4, wall);
  gableRoof(out, bp.g(wall), sub(fp, 0, 0, 0, Math.PI / 2), 0, 2.4, 0, 2.4, 2.6, 1.7, roof, 0.3);
  out.box(fp, 0, 1.05, 1.22, 1.1, 2.1, 0.08, s.mat('timber', 0x4a2f20));
  out.collider(fp, 0, 1.2, 0, 2.6, 2.4, 2.4);
  bp.flush();
  br.flush();

  // Windows: lancets down both sides, a group of three in the front gable, one in the chancel.
  const glass = b.g(stained);
  const frame = b.g(trim);
  for (const side of [-1, 1]) {
    for (const z of [-7, -4, -1, 2]) {
      if (porchSide && side === 1 && z === 2) continue;
      b.at(side * 3.2, 0, z, (side * Math.PI) / 2, () => lancet(glass, frame, 0, 1.3, 0.6, 1.5));
    }
  }
  b.at(0, 0, 4.5, 0, () => {
    if (porchSide) lancet(glass, frame, 0, 1.4, 0.7, 2.3);
    for (const x of [-1.1, 1.1]) lancet(glass, frame, x, porchSide ? 1.4 : 3.3, 0.5, porchSide ? 1.7 : 1.1);
    if (!porchSide) lancet(glass, frame, 0, 3.4, 0.6, 1.6);
  });
  b.at(0, 0, -12.5, Math.PI, () => lancet(glass, frame, 0, 1.3, 0.7, 1.6));

  // Bell cote or spirelet over the front gable.
  const ridge = 7.5;
  if (rng.chance(0.6)) {
    const g = b.g(wall);
    for (const side of [-1, 1]) g.box(side * 0.42, ridge + 0.55, 4.3, 0.16, 1.5, 0.5);
    b.g(roof).taper(0, ridge + 1.3, 4.3, 1.3, 0.8, 0.2, 0.8, 0.7);
    b.g(s.mat('metal', 0x8a6a3a, { roughness: 0.5, metalness: 0.7 })).lathe(0, ridge + 0.45, 4.3, [[0.26, 0], [0.2, 0.3], [0.08, 0.5], [0, 0.52]], 8);
    frame.box(0, ridge + 2.45, 4.3, 0.07, 0.9, 0.07).box(0, ridge + 2.6, 4.3, 0.5, 0.07, 0.07);
  } else {
    b.g(wall).box(0, ridge + 0.3, 3.6, 1.2, 1.6, 1.2);
    b.g(roof).taper(0, ridge + 1.1, 3.6, 1.5, 1.5, 0, 0, 3.4);
    frame.box(0, ridge + 4.9, 3.6, 0.06, 0.9, 0.06).box(0, ridge + 5.05, 3.6, 0.45, 0.06, 0.06);
  }

  // Picket fence with a gate gap, notice board, headstones, trees.
  s.fence(frame, [[-1.2, 15], [-11, 15], [-11, -14], [11, -14], [11, 15], [1.2, 15]], { height: 0.95, spacing: 1.6, rails: 2, post: 0.09, rail: [0.07, 0.03] });
  const saint = s.label(rng.pick(SAINTS) + ' CHURCH');
  const nx = rng.chance(0.5) ? -5 : 5;
  s.signStack(f, [saint, 'SUNDAY SERVICE 10 AM'], nx, s.gy(nx, 13.6) + 1.35, 13.6, 2.6, 0.5, { bg: '#22313a', fg: '#f2ead6', style: 'paint' }, 0, true);
  for (const sx of [-1.15, 1.15]) b.g(s.mat('timber', 0x4f4338)).post(nx + sx, s.gy(nx + sx, 13.6) - 0.2, 13.6, 0.09, 2.2);
  if (rng.chance(0.6)) {
    const stones = b.g(s.mat('concrete', 0x9a9890));
    const side = porchSide ? -1 : rng.pick([-1, 1]);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        if (rng.chance(0.25)) continue;
        const x = side * (5.4 + r * 1.9);
        const z = -8 + k * 3.2 + rng.range(-0.3, 0.3);
        const y = s.gy(x, z);
        const h = rng.range(0.6, 1.1);
        if (rng.chance(0.25)) stones.box(x, y + 0.6, z, 0.1, 1.4, 0.1).box(x, y + 0.95, z, 0.1, 0.1, 0.6);
        else stones.box(x, y + h / 2 - 0.1, z, 0.12, h + 0.2, 0.55);
      }
    }
  }
  b.flush();
  s.prop(rng.pick(['tree-oak', 'tree-cabbage']), rng.pick([-7.5, 7.5]), -10.5, rng.range(0, 6), 0.8);
  if (rng.chance(0.5)) s.prop('tree-cabbage', rng.pick([-8, 8]), 11, rng.range(0, 6), 0.9);
  s.light(porchSide ? 6 : 0, 2.4, porchSide ? 1.5 : 8, 0xffe2b0, 0.9, 14);
};

/**
 * War memorial: three steps, then either an obelisk on a pedestal or a plain cenotaph, with bronze
 * inscription panels, a wreath, a chain on bollards, a flagpole and two seats. About 8.5 m (obelisk).
 */
export const warMemorial: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const rng = s.rng;
  const granite = s.mat('concrete', rng.pick([0x9a9890, 0x8a8a86, 0xb9b4a8]));
  const step = s.mat('concrete', 0xc4c0b4);
  const bronze = { bg: '#3a3226', fg: '#d9b46a', style: 'paint' as const };
  const b = s.batch();
  const g = b.g(granite);

  [6, 4.8, 3.6].forEach((w, i) => {
    out.box(f, 0, i * 0.25 - 0.4, 0, w, 1.3, w, step);
    out.collider(f, 0, i * 0.25 + 0.125, 0, w, 0.25, w);
  });
  const base = 0.75;
  if (rng.chance(0.55)) {
    // Obelisk.
    g.box(0, base + 0.9, 0, 1.7, 1.8, 1.7);
    g.box(0, base + 1.9, 0, 2.0, 0.2, 2.0);
    g.taper(0, base + 2.0, 0, 1.1, 1.1, 0.62, 0.62, 5.2);
    g.taper(0, base + 7.2, 0, 0.62, 0.62, 0, 0, 0.75);
    s.sign(f, 'LEST WE FORGET', 0, base + 1.25, 0.86, 1.4, 3.5, bronze);
    s.signStack(f, ['1914 – 1918', '1939 – 1945'], 0, base + 0.55, 0.86, 1.4, 0.3, bronze);
    s.signStack(f, ['THEIR NAME LIVETH', 'FOR EVERMORE'], 0, base + 0.9, -0.86, 1.4, 0.4, bronze, Math.PI);
    out.collider(f, 0, base + 4, 0, 1.7, 8, 1.7);
  } else {
    // Cenotaph.
    g.taper(0, base, 0, 2.6, 1.4, 2.3, 1.2, 4.2);
    g.box(0, base + 4.35, 0, 2.6, 0.3, 1.5);
    g.box(0, base + 4.65, 0, 1.9, 0.3, 1.1);
    g.box(0, base + 5.05, 0, 1.2, 0.5, 0.7);
    s.sign(f, 'LEST WE FORGET', 0, base + 2.9, 0.68, 1.8, 3.5, bronze);
    s.signStack(f, ['1914 – 1918', '1939 – 1945'], 0, base + 1.9, 0.7, 1.6, 0.34, bronze);
    s.signStack(f, ['THEIR NAME LIVETH', 'FOR EVERMORE'], 0, base + 2.4, -0.69, 1.8, 0.45, bronze, Math.PI);
    out.collider(f, 0, base + 2.6, 0, 2.6, 5.2, 1.4);
  }
  // Poppy wreath leaning on the top step.
  b.g(s.mat('plain', 0xb0271f, { roughness: 0.9 })).arch(0.3, base + 0.42, 1.0, 0.22, 0.4, 0.12, 0, TAU, 12);

  // Chain on bollards, with an opening at the front.
  const iron = b.g(s.mat('paintedMetal', 0x2a2c2e));
  const ring: [number, number][] = [[-1.6, 4.4], [-4.4, 4.4], [-4.4, 0], [-4.4, -4.4], [0, -4.4], [4.4, -4.4], [4.4, 0], [4.4, 4.4], [1.6, 4.4]];
  ring.forEach(([x, z], i) => {
    const y = s.gy(x, z);
    iron.post(x, y - 0.2, z, 0.14, 1.0);
    if (i === ring.length - 1) return;
    const [nx, nz] = ring[i + 1];
    const y2 = s.gy(nx, nz);
    const mid: [number, number, number] = [(x + nx) / 2, (y + y2) / 2 + 0.42, (z + nz) / 2];
    iron.beam([x, y + 0.72, z], mid, 0.04).beam(mid, [nx, y2 + 0.72, nz], 0.04);
  });
  const fx = rng.chance(0.5) ? -6.2 : 6.2;
  flagpole(b.g(s.mat('paintedMetal', 0xf2efe6)), fx, s.gy(fx, -3), -3, 9);
  const seats = b.g(s.mat('timber', 0x4a3a2a));
  for (const side of [-1, 1]) bench(seats, side * 6.4, s.gy(side * 6.4, 3), 3, (-side * Math.PI) / 2);
  b.flush();
  for (const [x, z] of [[-5.6, -5.8], [5.6, -5.8]] as const) s.prop('bush', x, z, x, 0.9);
  s.light(0, 1.5, 3.4, 0xfff0d0, 0.9, 14);
};

/** "Hinds Railway Station" → "HINDS". */
function stationName(name: string): string {
  const trimmed = name.replace(/\b(railway|rail|station)\b/gi, '').replace(/\s+/g, ' ').trim();
  return (trimmed || 'Station').toUpperCase();
}

/**
 * Small rail station: a weatherboard station building with a bracketed platform verandah, a 30 m platform
 * with a name board, and a corrugated goods shed with a loading bank. Track side is -z.
 */
export const railStationSmall: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const wallColor = rng.pick([0xe9e0c8, 0xf1ead8, 0xd8cdb0]);
  const wall = s.mat('weatherboard', wallColor);
  const roof = s.mat('corrugated', rng.pick([0x8b3027, 0x6f3a2c, 0x5c6268]), { metalness: 0.3 });
  const trim = s.mat('plain', rng.pick([0x6a2a22, 0x2f5a44, 0x4a3a2a]), { roughness: 0.6 });
  const white = s.mat('plain', 0xf7f3e8, { roughness: 0.6 });
  const b: Batch = s.batch();

  // Platform with ramped ends and a white edge.
  out.box(f, -7, -0.1, -7, 30, 1.8, 4, s.mat('asphalt'));
  out.collider(f, -7, 0.4, -7, 30, 0.8, 4);
  out.box(f, -7, 0.81, -8.85, 30, 0.02, 0.25, white);
  const ramps = b.g(s.mat('asphalt'));
  ramps.polyUp([[-22, 0.8, -5], [-22, 0.8, -9], [-24.4, -0.05, -9], [-24.4, -0.05, -5]]);
  ramps.polyUp([[8, 0.8, -5], [8, 0.8, -9], [10.4, -0.05, -9], [10.4, -0.05, -5]]);

  // Station building.
  out.box(f, -7, 1.0, -2.5, 12, 4.6, 5, wall);
  gableRoof(out, b.g(wall), f, -7, 3.3, -2.5, 12, 5, 1.8, roof, 0.4);
  out.collider(f, -7, 1.6, -2.5, 12, 3.4, 5);
  b.g(roof).slab([-13.6, 3.25, -5], [-0.4, 3.25, -5], [-0.4, 2.9, -7.7], [-13.6, 2.9, -7.7], 0.07);
  const brackets = b.g(white);
  for (let x = -12.6; x <= -1.3; x += 2.8) brackets.beam([x, 2.2, -5.05], [x, 2.95, -7.2], 0.08).beam([x, 3.0, -5.1], [x, 2.9, -7.5], 0.08);
  b.g(trim).box(-7, 2.85, -7.72, 13.2, 0.26, 0.05);
  // Road side: door under a small hood, sash windows.
  out.box(f, -7, 1.05, 0.04, 1, 2.1, 0.08, trim);
  b.g(roof).slab([-8, 2.3, 1.2], [-6, 2.3, 1.2], [-6, 2.6, 0], [-8, 2.6, 0], 0.06);
  for (const x of [-11, -3]) out.quad(f, x, 1.7, 0.03, 1.1, 1.6, m.windows('house'));
  // Platform side: doors, ticket window, a seat.
  out.box(f, -10, 1.85, -5.04, 1, 2.1, 0.08, trim);
  out.box(f, -3.4, 1.85, -5.04, 1, 2.1, 0.08, trim);
  out.quad(f, -6.8, 2.1, -5.03, 1.2, 1, m.windows('shop'), Math.PI);
  for (const side of [-1, 1]) out.quad(f, -7 + side * 6.03, 1.9, -2.5, 1, 1.5, m.windows('house'), (side * Math.PI) / 2);
  bench(b.g(s.mat('timber', 0x6a4a30)), -1.2, 0.8, -5.5, Math.PI);
  out.box(f, -10.4, 5.2, -2.2, 0.7, 1.7, 0.7, s.mat('brick'));

  // Name board on the platform.
  const title = s.label(stationName(p.name));
  s.signBoard(f, title, 4.2, 2.5, -6, 3.4, 4.5, { bg: '#f2efe6', fg: '#1c1c1c', style: 'block' });
  for (const sx of [-1.55, 1.55]) b.g(white).post(4.2 + sx, 0.8, -6, 0.1, 2.2);
  const lampPost = b.g(s.mat('paintedMetal', 0x3a3f44));
  lampPost.post(-16.5, 0.8, -5.6, 0.1, 3.2);
  b.g(m.emitter(0xffe6a8, 'night')).box(-16.5, 4.05, -5.6, 0.34, 0.3, 0.34);

  // Goods shed with sliding doors and a loading bank on the track side.
  const iron = s.mat('corrugated', rng.pick([0x8a5a3c, 0x8b3027, 0xa9adb0]), { metalness: 0.35 });
  walls(out, f, 20, -5.5, 14, 4.2, 7, iron);
  gableRoof(out, b.g(iron), f, 20, 4.2, -5.5, 14, 7, 1.9, s.mat('corrugated', 0x8f959a, { metalness: 0.35 }), 0.3);
  out.collider(f, 20, 2.1, -5.5, 14, 4.2, 7);
  for (const face of [1, -1]) out.box(f, 20, 2.3, -5.5 + face * 3.53, 3.2, 3.2, 0.08, s.mat('timber', 0x6a5a48));
  out.box(f, 20, 0.2, -9.7, 13.6, 1.8, 1.4, s.mat('timber', 0x6a5a48));
  out.collider(f, 20, 0.55, -9.7, 13.6, 1.1, 1.4);
  s.sign(f, 'GOODS', 20, 3.7, -1.96, 2.6, 4, { bg: '#f2efe6', fg: '#1c1c1c', style: 'block' });

  // Water vat on a stand (some stations), fence along the yard, gravel forecourt.
  if (rng.chance(0.5)) {
    const tx = -19.5;
    const y = s.gy(tx, -1.5);
    const stand = b.g(s.mat('timber', 0x4f4338));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) stand.post(tx + sx * 1.1, y - 0.3, -1.5 + sz * 1.1, 0.2, 3.3);
    stand.box(tx, y + 3.05, -1.5, 2.8, 0.14, 2.8);
    b.g(s.mat('corrugated', 0x6f3a2c, { metalness: 0.3 })).lathe(tx, y + 3.12, -1.5, [[0, 0], [1.4, 0], [1.4, 2], [0, 2.3]], 12);
    out.collider(f, tx, y + 2.6, -1.5, 2.8, 5.2, 2.8);
  }
  s.fence(b.g(white), [[-25, 2.6], [-14, 2.6]], { height: 1.05, spacing: 2.2, rails: 2, post: 0.1 });
  s.fence(b.g(white), [[0.5, 2.6], [12, 2.6]], { height: 1.05, spacing: 2.2, rails: 2, post: 0.1 });
  const gravel = new Geo();
  s.drape(gravel, -4, 7, 26, 9, 0.05);
  s.drape(gravel, 19, 3.5, 16, 10, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  b.flush();
  s.light(-7, 2.7, -6.5, 0xffe2b0, 1.1, 18);
};
