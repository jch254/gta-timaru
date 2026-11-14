import type { ChunkBuilder, DistrictType, Lot, LotBuilder } from '../../core/types';

/** Baseline archetypes used by the vertical slice. Richer period buildings live alongside this file. */

const WALLS = [0xf1ead8, 0xe6dcc0, 0xd8e2d0, 0xcfdde6, 0xeed6c8, 0xf0e2a8, 0xdcd6cc, 0xc6d4be];
const ROOFS = [0x8b3027, 0x35603f, 0x8f959a, 0x6f3a2c, 0x5c6268, 0x9a4a32];
const TRIM = 0xf7f3e8;

const SHOP_NAMES = [
  'CORNER DAIRY',
  'FISH & CHIPS',
  'VIDEO HIRE',
  'TAB',
  'BAKERY',
  'BUTCHERY',
  "MENSWEAR",
  'BOOK EXCHANGE',
  'TAKEAWAYS',
  'HARDWARE',
  'CHEMIST',
  'SPORTS & TROPHIES',
  'HAIR BY SHAZ',
  'APPLIANCES',
  'TEAROOMS',
  'SECOND-HAND',
];

type R = Parameters<LotBuilder>[2];

const house: LotBuilder = (lot: Lot, out: ChunkBuilder, rng: R) => {
  const m = out.materials;
  const f = out.frameAt(lot.x, lot.y, lot.z, lot.heading);
  const w = Math.min(lot.width - 4.5, rng.range(9, 12.5));
  const d = rng.range(7.5, 9.5);
  const front = lot.depth / 2 - rng.range(5, 7.5);
  const cz = front - d / 2;
  const wall = m.get('weatherboard', { color: rng.pick(WALLS) });
  const roof = m.get('corrugated', { color: rng.pick(ROOFS), metalness: 0.25, roughness: 0.6 });
  const trim = m.get('plain', { color: TRIM, roughness: 0.6 });
  const wallH = 3;
  out.box(f, 0, wallH / 2 - 0.3, cz, w, wallH + 0.6, d, wall);
  out.gable(f, 0, wallH, cz, w + 0.9, d + 0.9, 2.1, roof, rng.chance(0.5) ? d * 0.4 : 0);
  out.collider(f, 0, 1.6, cz, w, 4, d);
  // Verandah.
  const doorX = rng.range(-w * 0.2, w * 0.2);
  out.box(f, doorX, 2.55, front + 0.95, w * 0.55, 0.1, 1.9, roof);
  for (const px of [doorX - w * 0.26, doorX + w * 0.26]) out.box(f, px, 1.25, front + 1.8, 0.11, 2.5, 0.11, trim);
  out.box(f, doorX, 0.08, front + 0.95, w * 0.55, 0.16, 1.9, m.get('timber'));
  // Door and windows (some lit at night).
  out.box(f, doorX, 1.05, front + 0.04, 0.9, 2.05, 0.08, m.get('plain', { color: rng.pick([0x5a2e22, 0x234a3a, 0x2a3a5a, 0x6a1f1f]), roughness: 0.5 }));
  const win = () => (rng.chance(0.55) ? m.windows('house') : m.get('glass'));
  for (const px of [doorX - 2.3, doorX + 2.3]) {
    if (Math.abs(px) < w / 2 - 0.9) out.quad(f, px, 1.65, front + 0.03, 1.5, 1.25, win());
  }
  out.quad(f, w / 2 + 0.03, 1.65, cz, 1.4, 1.2, win(), Math.PI / 2);
  out.quad(f, -w / 2 - 0.03, 1.65, cz, 1.4, 1.2, win(), -Math.PI / 2);
  // Chimney, path, front fence, letterbox.
  out.box(f, w * 0.28, wallH + 1.5, cz - d * 0.15, 0.7, 2.2, 0.7, m.get('brick'));
  out.box(f, doorX, 0.03, (front + lot.depth / 2) / 2 + 1, 1, 0.05, lot.depth / 2 - front - 1, m.get('concrete'));
  const fence = m.get('timber', { color: rng.pick([0xf1ead8, 0x8a6a48, 0xdcd6cc]) });
  const gate = doorX;
  const fz = lot.depth / 2 - 0.2;
  const leftW = gate - 0.8 + lot.width / 2 - 0.3;
  const rightW = lot.width / 2 - 0.3 - gate - 0.8;
  if (leftW > 0.5) out.box(f, -lot.width / 2 + 0.3 + leftW / 2, 0.45, fz, leftW, 0.9, 0.08, fence);
  if (rightW > 0.5) out.box(f, lot.width / 2 - 0.3 - rightW / 2, 0.45, fz, rightW, 0.9, 0.08, fence);
  out.box(f, gate + 1.05, 0.55, fz, 0.09, 1.1, 0.09, m.get('timber'));
  out.box(f, gate + 1.05, 1.15, fz, 0.32, 0.22, 0.45, m.get('paintedMetal', { color: rng.pick([0xc0271f, TRIM, 0x2a5a3a]) }));
  // Garden.
  if (rng.chance(0.7)) out.instance(rng.pick(['tree-cabbage', 'tree-oak', 'bush', 'bush']), -lot.width / 2 + 2.5 + lot.x * 0, lot.y, 0, 0, 1);
  const tx = rng.range(-lot.width / 2 + 2, lot.width / 2 - 2);
  const tz = rng.range(front + 1.5, lot.depth / 2 - 1.5);
  const sin = Math.sin(lot.heading);
  const cos = Math.cos(lot.heading);
  out.instance(rng.pick(['bush', 'flax', 'bush', 'tree-cabbage']), lot.x + tx * cos + tz * sin, lot.y, lot.z - tx * sin + tz * cos, rng.range(0, 6), rng.range(0.8, 1.2));
};

const shop: LotBuilder = (lot, out, rng) => {
  const m = out.materials;
  const f = out.frameAt(lot.x, lot.y, lot.z, lot.heading);
  const w = lot.width - 0.1;
  const d = lot.depth - 3;
  const front = lot.depth / 2 - 0.4;
  const cz = front - d / 2;
  const floors = rng.chance(0.65) ? 2 : 1;
  const h = floors * 3.5 + 0.8;
  const wall = rng.chance(0.45) ? m.get('brick') : m.get('plaster', { color: rng.pick(WALLS) });
  out.box(f, 0, h / 2 - 0.3, cz, w, h + 0.6, d, wall);
  out.box(f, 0, h + 0.45, front - 0.2, w, 0.9, 0.4, wall);
  out.collider(f, 0, h / 2, cz, w, h, d);
  // Verandah over the footpath.
  const awning = m.get('corrugated', { color: rng.pick([0x8a2f2a, 0x2f5d3a, 0x2b4a6b, 0xb9b4a8]), metalness: 0.2, roughness: 0.6 });
  out.box(f, 0, 3.15, front + 1.45, w, 0.14, 2.9, awning);
  out.box(f, 0, 2.95, front + 2.85, w, 0.34, 0.06, m.get('plain', { color: TRIM, roughness: 0.6 }));
  for (const px of [-w / 2 + 0.3, w / 2 - 0.3]) out.box(f, px, 1.55, front + 2.75, 0.12, 3.1, 0.12, m.get('paintedMetal', { color: 0x3a3a3a }));
  // Shopfront, door and sign.
  out.quad(f, -w * 0.22, 1.5, front + 0.03, w * 0.42, 1.9, m.windows('shop'));
  out.quad(f, w * 0.27, 1.5, front + 0.03, w * 0.3, 1.9, m.windows('shop'));
  out.box(f, w * 0.03, 1.1, front + 0.03, 1, 2.2, 0.08, m.get('glass'));
  const name = rng.pick(SHOP_NAMES);
  const palette = rng.pick([
    ['#f2ead6', '#1d2a44'],
    ['#8a1f1f', '#f6edd0'],
    ['#1f4a36', '#f6edd0'],
    ['#f0c33a', '#1c1c1c'],
    ['#1d2a44', '#f6edd0'],
  ]);
  out.quad(f, 0, 3.72, front + 0.04, Math.min(w * 0.86, 7), Math.min(w * 0.86, 7) / 5, m.sign(name, { bg: palette[0], fg: palette[1], aspect: 5, style: rng.pick(['paint', 'block', 'paint']) }));
  if (floors === 2) {
    for (const px of [-w * 0.25, w * 0.25]) out.quad(f, px, 5.4, front + 0.03, 1.3, 1.6, rng.chance(0.4) ? m.windows('house') : m.get('glass'));
  }
};

const office: LotBuilder = (lot, out, rng) => {
  const m = out.materials;
  const f = out.frameAt(lot.x, lot.y, lot.z, lot.heading);
  const w = lot.width - 1.2;
  const d = lot.depth - 4;
  const front = lot.depth / 2 - 0.5;
  const cz = front - d / 2;
  const floors = rng.int(3, 9);
  const h = floors * 3.2 + 4.4;
  const wall = rng.pick([m.get('concrete'), m.get('plaster', { color: rng.pick(WALLS) }), m.get('limestone'), m.get('brick')]);
  out.box(f, 0, h / 2 - 0.3, cz, w, h + 0.6, d, wall);
  out.collider(f, 0, h / 2, cz, w, h, d);
  out.box(f, 0, h + 0.3, cz, w + 0.5, 0.5, d + 0.5, wall);
  out.box(f, w * 0.2, h + 1.4, cz - d * 0.2, w * 0.3, 1.8, d * 0.3, m.get('paintedMetal', { color: 0xbcbcb6 }));
  // Window bands on all four faces (grid texture in metres).
  const win = m.windows('office');
  const y = 4.2 + (floors * 3.2) / 2;
  const snap = (v: number, step: number) => Math.max(step, Math.floor(v / step) * step);
  out.quad(f, 0, y, front + 0.04, snap(w - 1.5, 2.5), floors * 3.2, win, 0, true);
  out.quad(f, 0, y, cz - d / 2 - 0.04, snap(w - 1.5, 2.5), floors * 3.2, win, Math.PI, true);
  out.quad(f, w / 2 + 0.04, y, cz, snap(d - 1.5, 2.5), floors * 3.2, win, Math.PI / 2, true);
  out.quad(f, -w / 2 - 0.04, y, cz, snap(d - 1.5, 2.5), floors * 3.2, win, -Math.PI / 2, true);
  // Ground floor: glazed frontage under a flat canopy.
  out.quad(f, 0, 1.7, front + 0.04, w * 0.8, 2.6, m.windows('shop'));
  out.box(f, 0, 3.5, front + 1.2, w, 0.25, 2.4, m.get('concrete', { color: 0x9a968c }));
};

const shed: LotBuilder = (lot, out, rng) => {
  const m = out.materials;
  const f = out.frameAt(lot.x, lot.y, lot.z, lot.heading);
  const w = lot.width * rng.range(0.55, 0.8);
  const d = lot.depth * rng.range(0.5, 0.7);
  const cz = -lot.depth / 2 + d / 2 + 2;
  const h = rng.range(5, 8);
  const skin = m.get('corrugated', { color: rng.pick([0x9aa0a4, 0xb9b4a8, 0x6f8a9a, 0x8a6a48, 0xc8c2a8]), metalness: 0.3 });
  out.box(f, 0, h / 2 - 0.3, cz, w, h + 0.6, d, skin);
  out.gable(f, 0, h, cz, w + 0.6, d + 0.6, 1.6, skin);
  out.collider(f, 0, h / 2, cz, w, h, d);
  out.box(f, -w * 0.2, 2.1, cz + d / 2 + 0.03, 4.4, 4.2, 0.1, m.get('paintedMetal', { color: 0x55606a }));
  out.quad(f, w * 0.22, h - 1.2, cz + d / 2 + 0.05, Math.min(8, w * 0.4), Math.min(8, w * 0.4) / 4, m.sign(rng.pick(['ENGINEERING', 'PANEL & PAINT', 'WOOL STORE', 'FREIGHT', 'TYRES', 'FARM SUPPLIES', 'JOINERY']), { style: 'block', bg: '#e9e4d6', fg: '#222' }));
  // Yard.
  out.box(f, 0, 0.02, lot.depth / 2 - (lot.depth - d - 2) / 2, lot.width - 1, 0.04, lot.depth - d - 2, m.get('gravel'));
};

export const BASIC_BUILDERS: Partial<Record<DistrictType, { weight: number; build: LotBuilder }[]>> = {
  cbd: [
    { weight: 3, build: office },
    { weight: 1, build: shop },
  ],
  shops: [{ weight: 1, build: shop }],
  township: [
    { weight: 2, build: shop },
    { weight: 1, build: house },
  ],
  villa: [{ weight: 1, build: house }],
  statehouse: [{ weight: 1, build: house }],
  industrial: [{ weight: 1, build: shed }],
  port: [{ weight: 1, build: shed }],
  rural: [{ weight: 1, build: house }],
};
