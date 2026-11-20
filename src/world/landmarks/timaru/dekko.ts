import type { ChunkBuilder, LandmarkBuilder, LandmarkPlacement, SignOptions } from '../../../core/types';
import { retainCut } from '../cut';
import { CLOTHES, GOODS, Interior } from '../interior';
import { Geo, Site, sub, type V3 } from '../rural/kit';

/**
 * Dekko, the yellow-signed discount variety store on Stafford Street (the DEKA people remember from the 1990
 * photos), and the first shop you can walk into. A two-storey Edwardian block with a plastered front, a
 * suspended verandah with the yellow fascia and hanging signs, real glass windows dressed with goods, and the
 * automatic doors standing open. Inside: terrazzo floor, suspended ceiling with fluorescent fittings, gondola
 * aisles, wall shelving, a clothing corner, three checkouts by the door and a stockroom out the back.
 *
 * Local frame: floor at y = 0 (the platform the world cuts to footpath height), front wall on z = +16, plan
 * 24 × 32. The ground behind is a storey or so higher, so the cut's back and open side get retaining walls.
 */

/** Where the shop assistants stand behind the tills (local), facing the customers in the lanes. */
export const DEKKO_STAFF: { x: number; z: number; heading: number }[] = [
  { x: 2.5, z: 10.2, heading: Math.PI / 2 },
  { x: 5.6, z: 10.2, heading: Math.PI / 2 },
  { x: 8.7, z: 10.2, heading: Math.PI / 2 },
];

const W = 24;
const D = 32;
/** How far beyond the footprint's back and sides the world cuts the ground down (TerrainModel's CUT_MARGIN). */
const CUT = 4.5;
const T = 0.3;
/** Outside and inside faces of the side walls, the front wall's line and its faces. */
const OX = W / 2 - 0.05;
const IX = OX - T;
const FZ = D / 2 - 0.2;
const OZ = FZ + T / 2;
const IZ = FZ - T / 2;
/** Shop ceiling, top of the upper storey, the stockroom partition. */
const H = 3.6;
const RY = 8.3;
const PZ = -12;
const DOOR = 2.2;

const YELLOW = 0xf4c400;
const NAVY = 0x1b2340;
const BRAND: SignOptions = { bg: '#f4c400', fg: '#1b2340', style: 'block', border: false };
const DEPT: SignOptions = { bg: '#f4c400', fg: '#1b2340', style: 'block', aspect: 5 };
const RED: SignOptions = { bg: '#d0262a', fg: '#ffffff', style: 'block' };

const LINEN = [0xf2eee4, 0xe8d8e0, 0xc8d8e8, 0xe8d6c0, 0xd2e2cc, 0xf4f0e6, 0xb8c8d8, 0xe0c8b0];
const SWEETS = [0xc8302a, 0xe5b52b, 0x7a3f8f, 0xe07aa8, 0xd8642a, 0x2f5fa8, 0x3f8f4a, 0xf0d070];
const TOYS = [0xc8302a, 0x2f5fa8, 0xe5b52b, 0x3f8f4a, 0xd8642a, 0x5ab0c8, 0xe07aa8];
const PARTY = [0xe07aa8, 0x7a3f8f, 0xf0d070, 0x5ab0c8, 0xc8302a, 0xe8e2d0];
const STATIONERY = [0x2f5fa8, 0xe8e2d0, 0x2a2a2a, 0xc8302a, 0x5ab0c8, 0xf0d070];
const HARDWARE = [0x6a6a6a, 0xc8302a, 0xe5b52b, 0x2a2a2a, 0x3f8f4a, 0x8a5a3a];
const CARTONS = [0xa8865a, 0x9a7a50, 0xb8946a, 0x8e6e48, 0xc4a478];

/**
 * Which side the department store next door is on, and how far its footprint is from our centre line: that
 * side is a party wall and gets no retaining wall (their building holds the bank up there). Map data decides;
 * with no neighbour found it is the −x side.
 */
function neighbour(p: LandmarkPlacement, out: ChunkBuilder): { side: 1 | -1; edge: number } {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  let best: { side: 1 | -1; edge: number } | null = null;
  for (const l of out.world.landmarks ?? []) {
    if (l === p || l.kind !== 'timaru-dept-store') continue;
    const dx = l.x - p.x;
    const dz = l.z - p.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lz) > D || Math.abs(lx) > 60) continue;
    const across = l.footprint ? (Math.abs(Math.cos(l.heading - p.heading)) > 0.7 ? l.footprint.w : l.footprint.d) : l.clearRadius * 2;
    const edge = Math.abs(lx) - across / 2;
    if (edge < W / 2 - 0.5 || edge > W / 2 + CUT + 1) continue;
    if (!best || edge < best.edge) best = { side: lx > 0 ? 1 : -1, edge };
  }
  return best ?? { side: -1, edge: W / 2 + 1 };
}

export const discountStore: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const next = neighbour(p, out);
  const open = -next.side as 1 | -1;
  // The footpath outside may climb along the frontage: keep the verandah's clearance at its high end.
  const lift = Math.min(0.5, Math.max(0, ...[-11, 0, 11].map((x) => s.gy(x, D / 2 + 1.6))));
  const it = new Interior(out, s.f, s.seed);
  shop(s, it, open);
  facade(s, it, lift, open);
  backyard(s, it, next, open);
  it.flush();
  it.light(0, 3.3, 1.5, 0xf2f6ff, 170, 24);
  s.light(0, 2.9 + lift, D / 2 + 1.4, 0xfff0d0, 120, 14);
};

/** The shop itself: shell, floor and ceiling, fittings, stock, tills and the stockroom. */
function shop(s: Site, it: Interior, open: 1 | -1): void {
  const brick = s.mat('brick');
  const door = open * 9;
  it.room({
    w: OX * 2 - T,
    d: FZ * 2,
    h: H,
    t: T,
    floor: it.paint(0xd6cfc0, 'concrete'),
    wall: it.paint(0xf1ede2, 'plaster'),
    outer: brick,
    ceiling: it.paint(0xf3f1ea, 'plaster'),
    plinth: 1.5,
    openings: [
      { side: 'front', at: 0, width: DOOR, height: 2.4 },
      { side: 'front', at: -1.75, width: 1.3, height: 2.4, glass: it.glass },
      { side: 'front', at: 1.75, width: 1.3, height: 2.4, glass: it.glass },
      { side: 'front', at: -6.95, width: 8.7, sill: 0.45, height: 2.45, glass: it.glass },
      { side: 'front', at: 6.95, width: 8.7, sill: 0.45, height: 2.45, glass: it.glass },
      { side: 'back', at: door, width: 1.0, height: 2.1 },
    ],
  });
  it.slidingDoors(0, FZ, DOOR, 2.3);

  // Floor: a darker vinyl runner up the main aisle, a mat inside the door, the threshold plate.
  it.g(it.paint(0x8c857a, 'concrete')).box(0, 0.004, 1.3, 2.0, 0.008, 26.2);
  it.g(it.paint(0x34363a, 'cloth')).box(0, 0.006, 15.0, 2.0, 0.012, 1.2);
  it.g(it.paint(0x9a9ea2, 'metal')).box(0, 0.005, FZ, DOOR, 0.01, T);

  // Suspended ceiling: the T-bar grid and the fluorescent fittings.
  const tbar = it.g(it.paint(0xd2cdc2, 'paintedMetal'));
  for (let x = -10.8; x < 10.9; x += 1.2) tbar.box(x, H - 0.008, 0, 0.03, 0.016, 31.2);
  for (let z = -15; z < 15.2; z += 1.2) tbar.box(0, H - 0.01, z, IX * 2 - 0.1, 0.016, 0.03);
  it.fluoros(-11.2, -11.6, 11.2, 15.2, H);
  it.fluoros(-11, -15.4, 11, -12.4, H, 5.5, 3);

  // Yellow band round the walls under the ceiling.
  const band = it.g(it.paint(YELLOW, 'paintedMetal'));
  for (const sx of [-1, 1]) band.box(sx * (IX - 0.01), 3.2, (PZ + IZ) / 2, 0.02, 0.3, IZ - PZ);
  band.box(0, 3.2, PZ + 0.16, IX * 2, 0.3, 0.02).box(0, 3.2, IZ - 0.01, IX * 2, 0.3, 0.02);

  // Stockroom partition with the staff doorway.
  it.wall(-IX, PZ, IX, PZ, { h: H, t: 0.3, inner: it.paint(0xe6e0d0, 'plaster'), holes: [{ along: door + IX, width: 1.4, sill: 0, height: 2.2 }] });

  // Wall shelving: linen down the left, party and toys down the right.
  it.gondola(-IX + 0.225, -3.1, 17, Math.PI / 2, { single: true, h: 1.9, shelves: 4, colors: LINEN });
  it.gondola(IX - 0.225, -1.5, 20.2, -Math.PI / 2, { single: true, h: 1.9, shelves: 4, colors: TOYS });

  // Gondola aisles: four runs either side of a cross aisle, end caps on the front of each.
  const stock = [
    [STATIONERY, SWEETS],
    [GOODS, GOODS],
    [HARDWARE, GOODS],
    [PARTY, TOYS],
  ];
  [-6, -2, 2, 6].forEach((x, i) => {
    it.gondola(x, -6.7, 6.2, Math.PI / 2, { h: 1.65, shelves: 4, colors: stock[i][0] });
    it.gondola(x, 1.3, 6.2, Math.PI / 2, { h: 1.65, shelves: 4, colors: stock[i][1] });
    it.gondola(x, 4.63, 0.9, 0, { single: true, h: 1.4, shelves: 3, colors: stock[i][1], frame: YELLOW });
  });
  for (const x of [-8.8, 8.8]) for (const z of [-6.7, 1.3]) dumpBin(it, x, z, x < 0 ? LINEN : TOYS);

  const departments: [string, number, number][] = [
    ['MANCHESTER', -8.8, 1.3],
    ['CONFECTIONERY', -4, 1.3],
    ['HOMEWARES', 0, 1.3],
    ['TOYS', 4, 1.3],
    ['PARTY', 8.8, 1.3],
    ['STATIONERY', -4, -6.7],
    ['KITCHEN', 0, -6.7],
    ['HARDWARE', 4, -6.7],
    ['MENSWEAR', -8.2, 9.4],
    ['KIDSWEAR', -4.6, 9.4],
  ];
  for (const [text, x, z] of departments) it.hangingSign(text, x, 2.85, z, 2.0, 0, H, DEPT);

  // Clothing corner, front left: round and straight rails, tables of folded knitwear, a dummy by the wall.
  it.rack(-9.7, 7.6, 1.6, 0, CLOTHES, true);
  it.rack(-9.7, 11.2, 1.6, 0, CLOTHES, true);
  it.rack(-6.6, 7.6, 1.8, Math.PI / 2);
  it.rack(-6.6, 11.2, 1.8, Math.PI / 2);
  it.table(-3.9, 7.6, 1.4, 0.9, Math.PI / 2);
  it.table(-3.9, 11.2, 1.4, 0.9, Math.PI / 2);
  it.mannequin(-11.0, 9.4, Math.PI / 2, CLOTHES[1]);

  // Checkouts by the door: customers come down the lanes towards the street, the operator faces them.
  const navy = it.paint(NAVY, 'paintedMetal');
  const top = it.paint(0xe9e4d6);
  DEKKO_STAFF.forEach((st, i) => {
    const x = st.x + 0.7;
    it.counter(x, 10.6, 2.4, Math.PI / 2, { till: true, front: navy, top });
    it.g(it.paint(0x2a2c2e)).box(x, 0.96, 11.3, 0.5, 0.012, 0.9);
    it.hangingSign(`CHECKOUT ${i + 1}`, x, 2.75, 10.6, 1.2, 0, H, { ...DEPT, aspect: 4 });
  });

  // Price boards on the walls.
  it.sign('EVERYDAY LOW PRICES', -open * 3.5, 2.5, PZ + 0.17, 5, 0, { ...RED, aspect: 8 });
  it.sign('STAFF ONLY', door, 2.55, PZ + 0.17, 1.1, 0, { bg: '#1b2340', fg: '#ffffff', style: 'block', aspect: 4 });
  it.sign('NOBODY BEATS A DEKKO PRICE', IX - 0.02, 2.4, 11.4, 3.6, -Math.PI / 2, { ...BRAND, aspect: 7 });
  it.sign('THANK YOU FOR SHOPPING AT DEKKO', 0, 2.72, IZ - 0.02, 3.2, Math.PI, { ...BRAND, aspect: 10 });

  // Window displays on felt-covered beds behind the glass, open to the shop.
  const felt = it.paint(0x7a2228, 'cloth');
  for (const sx of [-1, 1]) it.solid(felt, sx * 6.95, 0.2, 14.95, 8.7, 0.4, 1.3);
  const win = new Interior(s.out, sub(s.f, 0, 0.4, 0), s.seed + 7);
  win.mannequin(-9.9, 15.0, 0.2, CLOTHES[1]);
  win.mannequin(-8.5, 14.8, -0.15, CLOTHES[4]);
  win.mannequin(-3.6, 15.0, -0.3, CLOTHES[9]);
  win.table(-6.2, 14.95, 1.4, 0.8, 0);
  for (const cx of [4.2, 9.4]) {
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 3 - row; k++) {
        const c = TOYS[win.rng.int(0, TOYS.length - 1)];
        win.g(win.paint(c)).box(cx + (k - (2 - row) / 2) * 0.52, 0.2 + row * 0.4, 14.95, 0.48, 0.38, 0.42);
      }
    }
    win.collide(cx, 0.6, 14.95, 1.6, 1.2, 0.5);
  }
  win.table(6.9, 14.95, 1.4, 0.8, 0, GOODS);
  win.sign('NEW SEASON KNITWEAR', -6.2, 1.25, 15.5, 1.5, 0, { bg: '#f2ead6', fg: '#1b2340', style: 'script', aspect: 4 });
  win.sign('TOYS FROM $1.99', 6.9, 1.25, 15.5, 1.5, 0, { ...BRAND, aspect: 4 });
  win.flush();
  // Posters stuck on the inside of the glass, reading out to the street.
  it.sign('SALE NOW ON', -9.4, 2.55, FZ - 0.03, 1.6, 0, { ...RED, aspect: 4 });
  it.sign('$2 BIN', 9.6, 2.55, FZ - 0.03, 1.2, 0, { ...RED, aspect: 3 });
  it.sign('OPEN 7 DAYS', 1.75, 1.7, FZ - 0.03, 0.9, 0, { bg: '#1b2340', fg: '#ffffff', style: 'block', aspect: 3 });

  // Stockroom: steel shelving of cartons, a pallet waiting to be broken down, the smoko table.
  it.gondola(-open * 2, -15.425 + 0.04, 10, 0, { single: true, h: 2.2, shelves: 3, colors: CARTONS, frame: 0x5a6a7a, fill: 0.9 });
  const ply = it.paint(0xb89a6a, 'timber');
  const px = -open * 9.4;
  it.g(ply).box(px, 0.07, -13.7, 1.2, 0.14, 1.0);
  for (let k = 0; k < 6; k++) {
    const c = CARTONS[it.rng.int(0, CARTONS.length - 1)];
    it.g(it.paint(c)).box(px + ((k % 2) - 0.5) * 0.58, 0.14 + 0.22 + Math.floor(k / 2) * 0.44, -13.7, 0.56, 0.43, 0.9);
  }
  it.collide(px, 0.75, -13.7, 1.2, 1.5, 1.0);
  it.table(open * 5.5, -13.5, 1.2, 0.8, 0, [0xe8e2d0, 0xc8302a, 0x2f5fa8]);
  // The back door, shut.
  it.solid(it.paint(0x4a5a4a, 'paintedMetal'), door, 1.05, -D / 2 + 0.2, 1.0, 2.1, 0.06);
}

/** Wire dump bin heaped with odds and ends, with its price on a stick. */
function dumpBin(it: Interior, x: number, z: number, colors: readonly number[]): void {
  it.solid(it.paint(0xc8302a, 'paintedMetal'), x, 0.3, z, 1.0, 0.6, 1.4);
  for (let i = 0; i < 9; i++) {
    const c = colors[it.rng.int(0, colors.length - 1)];
    it.g(it.paint(c)).box(x + it.rng.range(-0.36, 0.36), 0.64 + it.rng.range(0, 0.08), z + it.rng.range(-0.52, 0.52), it.rng.range(0.16, 0.3), it.rng.range(0.08, 0.18), it.rng.range(0.14, 0.3), it.rng.range(0, Math.PI));
  }
  it.g(it.m.get('chrome')).post(x, 0.6, z, 0.03, 0.8);
  it.hangingSign('$2 BIN', x, 1.56, z, 0.8, 0, 0, { ...RED, aspect: 2.5 });
}

/** Street front and the upper storey: plastered Edwardian facade, shopfront, verandah and signs, flat roof. */
function facade(s: Site, it: Interior, lift: number, open: 1 | -1): void {
  const f = s.f;
  const g = (m: Parameters<Interior['g']>[0]) => it.g(m);
  const plaster = s.mat('plaster', 0xd8cdb4);
  const trim = s.mat('plaster', 0xb9aa8c);
  const brick = s.mat('brick');
  const alu = s.mat('metal', 0xa9adb1);
  const tile = s.mat('plain', 0x1f2b27, { roughness: 0.25 });
  const yellow = s.mat('paintedMetal', YELLOW);
  const dark = s.mat('paintedMetal', 0x2c2f33);

  // Upper storey: one brick mass on the shop's walls (nobody goes up there), a plaster front on it.
  g(brick).box(0, (H + RY) / 2, 0, OX * 2, RY - H, OZ * 2, 0, false);
  s.out.collider(f, 0, (H + RY) / 2, 0, OX * 2, RY - H, OZ * 2);
  g(plaster).box(0, (H + RY) / 2, OZ + 0.075, OX * 2, RY - H, 0.15);
  g(plaster).box(0, 3.25, OZ + 0.025, OX * 2, 0.7, 0.05);
  // Pilasters: full height at the ends, from the sign up between the bays.
  for (const sx of [-1, 1]) {
    g(plaster).box(sx * (OX - 0.325), (RY - 0.6) / 2, OZ + 0.13, 0.65, RY + 0.6, 0.26);
    g(plaster).box(sx * 4, (5.05 + RY) / 2, OZ + 0.2, 0.5, RY - 5.05, 0.1);
  }
  // String course, cornice, parapet with a pediment and the building's name.
  g(trim).box(0, 5.12, OZ + 0.21, OX * 2, 0.16, 0.12);
  g(trim).box(0, RY - 0.05, OZ + 0.2, OX * 2 + 0.06, 0.3, 0.42);
  g(plaster).box(0, RY + 0.5, OZ + 0.05, OX * 2, 1.0, 0.2);
  g(trim).box(0, RY + 1.03, OZ + 0.05, OX * 2 + 0.06, 0.06, 0.3);
  g(plaster).box(0, RY + 1.3, OZ + 0.05, 5, 0.5, 0.2);
  pediment(g(trim), 0, RY + 1.55, OZ + 0.16, 5.4, 1.0, 0.3);
  for (const x of [-OX + 0.325, -4, 4, OX - 0.325]) g(trim).box(x, RY + 0.75, OZ + 0.06, 0.6, 1.5, 0.3);
  s.sign(f, 'ORMOND BUILDINGS', 0, RY + 0.48, OZ + 0.16, 5.6, 10, { bg: '#d8cdb4', fg: '#6e5e48', style: 'paint', border: false });
  s.sign(f, '1908', 0, RY + 1.85, OZ + 0.17, 1.0, 2.6, { bg: '#b9aa8c', fg: '#5e4e3a', style: 'paint', border: false });

  // First-floor windows with moulded heads and sills.
  const house = s.m.windows('house');
  for (const x of [-9.6, -6.1, -1.6, 1.6, 6.1, 9.6]) {
    s.out.quad(f, x, 6.3, OZ + 0.16, 1.3, 1.9, house);
    g(trim).box(x, 7.4, OZ + 0.2, 1.6, 0.2, 0.12).box(x, 5.28, OZ + 0.22, 1.5, 0.1, 0.16);
  }
  // The big yellow sign across the front between the verandah and the windows.
  g(yellow).box(0, 4.55, OZ + 0.25, 15.5, 1.0, 0.16);
  s.sign(f, 'DEKKO', 0, 4.55, OZ + 0.34, 15.2, 15.2 / 0.92, BRAND);
  // Painted up the open side wall, over the roofs next door.
  s.sign(f, 'DEKKO', open * (OX + 0.02), 6.4, 3, 9, 9 / 2.2, BRAND, (open * Math.PI) / 2);

  // Shopfront: tiled stallrisers, aluminium frames and mullions.
  for (const sx of [-1, 1]) {
    const cx = sx * 6.95;
    g(tile).box(cx, 0.125, OZ + 0.02, 8.7, 0.65, 0.04);
    g(alu).box(cx, 2.9, FZ, 8.7, 0.06, 0.32).box(cx, 0.46, FZ + 0.06, 8.7, 0.05, 0.2);
    for (let k = 0; k <= 4; k++) g(alu).box(cx - 4.35 + k * 2.175, 1.675, FZ, k % 4 === 0 ? 0.08 : 0.05, 2.45, 0.12);
    g(alu).box(sx * 2.5, 1.45, FZ, 0.2, 2.9, 0.32).box(sx * 1.1, 1.2, FZ, 0.06, 2.4, 0.32);
    g(alu).box(sx * 1.75, 2.42, FZ, 1.3, 0.05, 0.12);
  }

  // Suspended verandah: hung on tie rods from the facade, yellow fascia round its edge, lamps under it.
  const vs = 3.05 + lift;
  const edge = D / 2 + 2.7;
  const depth = edge - OZ + 0.02;
  const vz = (edge + OZ - 0.02) / 2;
  g(s.mat('corrugated', 0x9aa0a4)).box(0, vs + 0.18, vz, OX * 2, 0.32, depth);
  g(s.mat('paintedMetal', 0xece8de)).box(0, vs + 0.01, vz, OX * 2 - 0.1, 0.02, depth - 0.1);
  s.out.collider(f, 0, vs + 0.17, vz, OX * 2, 0.34, depth);
  g(yellow).box(0, vs + 0.3, edge - 0.05, OX * 2, 0.6, 0.1);
  for (const sx of [-1, 1]) g(yellow).box(sx * (OX - 0.05), vs + 0.3, vz, 0.1, 0.6, depth);
  s.sign(f, 'DEKKO', 0, vs + 0.3, edge + 0.01, 5.0, 10, BRAND);
  for (const sx of [-1, 1]) {
    s.sign(f, 'EVERYDAY LOW PRICES', sx * 8.2, vs + 0.3, edge + 0.01, 6, 14, BRAND);
    s.sign(f, 'DEKKO', sx * (OX + 0.01), vs + 0.3, vz, 2.4, 4.8, BRAND, (sx * Math.PI) / 2);
  }
  const rod = g(dark);
  for (const x of [-10.8, -4, 4, 10.8]) rod.tube([x, vs + 0.5, edge - 0.2], [x, 5.7, Math.abs(x) === 4 ? OZ + 0.25 : OZ + 0.16], 0.025, 0.025, 6, false);
  const lamp = g(s.m.emitter(0xfff0d0, 'night'));
  for (const x of [-9.5, 0, 9.5]) lamp.box(x, vs - 0.02, D / 2 + 1.5, 0.5, 0.04, 0.25);
  // Hanging signs under the verandah, end-on to the footpath.
  for (const x of [-6.5, 6.5]) {
    const y = vs - 0.33;
    g(yellow).box(x, y, D / 2 + 1.5, 0.08, 0.56, 2.0);
    for (const dz of [-0.7, 0.7]) rod.post(x, y + 0.27, D / 2 + 1.5 + dz, 0.02, vs - y - 0.26);
    s.signBoard(f, 'DEKKO', x, y, D / 2 + 1.5, 1.9, 1.9 / 0.5, BRAND, Math.PI / 2);
  }

  // Flat roof: membrane, parapet round the sides and back, the air-conditioning unit, back windows.
  g(s.mat('asphalt')).box(0, RY + 0.02, 0, OX * 2 - 0.4, 0.04, OZ * 2 - 0.5);
  for (const sx of [-1, 1]) g(brick).box(sx * (OX - 0.12), RY + 0.3, -0.05, 0.24, 0.6, OZ * 2 - 0.1);
  g(brick).box(0, RY + 0.3, -OZ + 0.12, OX * 2, 0.6, 0.24);
  g(s.mat('paintedMetal', 0xb8bcb8)).box(-open * 4, RY + 0.55, -8, 2.4, 1.1, 1.6);
  g(dark).box(-open * 4, RY + 1.12, -8, 1.2, 0.04, 1.2);
  for (const x of [-6, 0, 6]) s.out.quad(f, x, 6.2, -OZ - 0.02, 1.2, 1.6, house, Math.PI);
  // Downpipe off the back corner.
  rod.tube([open * (OX - 0.5), -0.2, -OZ - 0.08], [open * (OX - 0.5), RY + 0.1, -OZ - 0.08], 0.05, 0.05, 6, false);
}

/** Triangular pediment facing +z: face on z, sloping tops running `depth` back. */
function pediment(g: Geo, cx: number, y: number, z: number, span: number, rise: number, depth: number): void {
  const l: V3 = [cx - span / 2, y, z];
  const r: V3 = [cx + span / 2, y, z];
  const t: V3 = [cx, y + rise, z];
  const back = (q: V3): V3 => [q[0], q[1], q[2] - depth];
  g.poly([l, r, t]);
  g.poly([l, t, back(t), back(l)]);
  g.poly([t, r, back(r), back(t)]);
}

/** Behind and beside the shop: the concrete yard and the retaining walls holding up the uncut bank. */
function backyard(s: Site, it: Interior, next: { side: 1 | -1; edge: number }, open: 1 | -1): void {
  const f = s.f;
  const back = -D / 2 - CUT;
  const xOpen = open * (W / 2 + CUT + 0.4);
  // Next door builds its own wall across half the gap between us.
  const xParty = next.side * (next.edge - 1);
  const wall = s.mat('concrete', 0xb3ad9f);
  const cap = s.mat('concrete', 0x9a958a);
  const pipe = s.mat('metal', 0x9aa0a4, { roughness: 0.6 });
  retainCut(s, it, [xParty, -D / 2], [xOpen, -D / 2], [0, -1], { wall, cap, rail: pipe });
  retainCut(s, it, [open * (W / 2), -D / 2 - CUT], [open * (W / 2), D / 2 - 0.6], [open, 0], { wall, cap, rail: pipe });

  const yard = new Geo();
  s.drape(yard, 0, (-D / 2 + back + 0.2) / 2, W - 0.1, -D / 2 - back - 0.2, 0.03);
  s.drape(yard, open * (W / 2 + CUT / 2 - 0.05), (back + 0.2 + D / 2 - 0.6) / 2, CUT - 0.1, D / 2 - 0.6 - back - 0.2, 0.03);
  yard.flush(s.out, s.ground('concrete', 0xa8a294), f);

  // Skip bin and a stack of pallets by the back door.
  const skip = s.mat('paintedMetal', 0x3c6a3c);
  const by = s.gy(-open * 5, -18.2);
  it.g(skip).box(-open * 5, by + 0.65, -18.2, 1.9, 1.1, 1.3);
  it.g(skip).box(-open * 5, by + 0.08, -18.2, 1.6, 0.16, 1.0);
  s.out.collider(f, -open * 5, by + 0.65, -18.2, 1.9, 1.3, 1.3);
  const ply = s.mat('timber', 0xa88a5a);
  for (let k = 0; k < 5; k++) it.g(ply).box(-open * 1.5, by + 0.07 + k * 0.15, -18.4, 1.2, 0.13, 1.0, k * 0.06);
  s.out.collider(f, -open * 1.5, by + 0.38, -18.4, 1.2, 0.76, 1.0);
  s.sign(f, 'STAFF ONLY', open * 9, 2.4, -OZ - 0.02, 0.9, 3.5, { bg: '#ffffff', fg: '#b0271f', style: 'block' }, Math.PI);
  it.g(s.m.emitter(0xfff0d0, 'night')).box(open * 9, 2.75, -OZ - 0.08, 0.3, 0.12, 0.12);
}
