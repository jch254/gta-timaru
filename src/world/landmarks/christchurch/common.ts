import type { MaterialLibrary } from '../../../core/types';
import { type Kit, type Mat, cone, disc, lancet, ring, sphere, tartan } from './kit';

/** Materials shared by the grey-stone Gothic Revival buildings. */
export interface StoneSet {
  /** Port Hills basalt walling. */
  grey: Mat;
  /** Cream limestone dressings. */
  dress: Mat;
  slate: Mat;
  glass: Mat;
  /** Leaded windows that glow warm after dark. */
  glow: Mat;
  door: Mat;
  /** Dark leadwork, louvres and ironwork. */
  lead: Mat;
}

export function stoneSet(m: MaterialLibrary): StoneSet {
  return {
    grey: m.get('bluestone'),
    dress: m.get('limestone'),
    slate: m.get('slate'),
    glass: m.get('glass', { color: 0x1a232c }),
    glow: m.emitter(0x54401f, 'night'),
    door: m.get('timber', { color: 0x4a3324 }),
    lead: m.get('paintedMetal', { color: 0x3c4046 }),
  };
}

export const bronze = (m: MaterialLibrary) => m.get('metal', { color: 0x56604a });
export const asphalt = (m: MaterialLibrary) => m.get('asphalt');
export const whiteLine = (m: MaterialLibrary) => m.get('plain', { color: 0xe4e1d6 });
export const lawn = (m: MaterialLibrary) => m.get('grass', { color: 0x6f9a4a });

export interface RangeOptions {
  /** Run the range along local z instead of x. Positions then run towards +z and the range's "front" faces −x. */
  alongZ?: boolean;
  /** Positions along the range (from its centre) of cross gables on the front (+z; −x when alongZ) side. */
  gables?: number[];
  /** Same, on the back (−z; +x when alongZ). */
  gablesBack?: number[];
  /** Stone gable walls at the ends: both (default), 'a' = low end only, 'b' = high end only, 'none'. */
  ends?: 'both' | 'a' | 'b' | 'none';
  windows?: boolean;
}

/**
 * A Gothic Revival range: grey stone walls with a limestone string course, steep slate roof, stone gable ends,
 * rows of lancet windows and optional cross gables. The workhorse of the Arts Centre and the museum.
 */
export function gothicRange(k: Kit, cx: number, cz: number, len: number, depth: number, wallH: number, rise: number, s: StoneSet, o: RangeOptions = {}): void {
  const r = k.sub(cx, 0, cz, o.alongZ ? -Math.PI / 2 : 0);
  r.solid(0, 0, 0, len, wallH, depth, s.grey);
  r.roof(0, wallH, 0, len + 0.5, depth + 0.7, rise, s.slate);
  r.box(0, wallH * 0.5, 0, len + 0.14, 0.28, depth + 0.14, s.dress);
  const ends = o.ends ?? 'both';
  if (ends === 'both' || ends === 'b') r.pediment(len / 2 + 0.03, wallH, 0, depth + 0.3, rise + 0.5, 0.5, s.grey, Math.PI / 2);
  if (ends === 'both' || ends === 'a') r.pediment(-len / 2 - 0.03, wallH, 0, depth + 0.3, rise + 0.5, 0.5, s.grey, -Math.PI / 2);
  const twoFloors = wallH >= 7.5;
  const sides: [Kit, number[]][] = [
    [r.sub(0, 0, depth / 2, 0), o.gables ?? []],
    [r.sub(0, 0, -depth / 2, Math.PI), (o.gablesBack ?? []).map((g) => -g)],
  ];
  for (const [side, gables] of sides) {
    if (o.windows !== false) {
      const n = Math.max(1, Math.floor(len / 3.6));
      // Lancets in limestone surrounds, a few of them lit after dark.
      const low = lancet(1.0, 2.5);
      const lowFrame = lancet(1.36, 2.8);
      const high = lancet(0.9, 2.1);
      const highFrame = lancet(1.26, 2.4);
      for (let i = 0; i < n; i++) {
        const x = -len / 2 + ((i + 0.5) * len) / n;
        if (gables.some((g) => Math.abs(g - x) < 2.2)) continue;
        side.geo(lowFrame, s.dress, x, 0.98, 0.03).geo(low, i % 3 === 1 ? s.glow : s.glass, x, 1.1, 0.055);
        if (twoFloors) side.geo(highFrame, s.dress, x, wallH * 0.5 + 0.68, 0.03).geo(high, i % 4 === 2 ? s.glow : s.glass, x, wallH * 0.5 + 0.8, 0.055);
      }
    }
    for (const g of gables) {
      // Cross gable: a stone gable standing just proud of the wall and a short roof running back to the main ridge.
      side.pediment(g, wallH, -0.2, 5.4, 4.2, 0.5, s.grey);
      side.roof(g, wallH, -depth / 4 - 0.05, depth / 2 - 0.1, 5.6, 3.9, s.slate, true);
      const tall = twoFloors ? 4.6 : 3.2;
      const sill = twoFloors ? wallH * 0.5 + 0.6 : 1.1;
      side.geo(lancet(2.1, tall + 0.32), s.dress, g, sill - 0.14, 0.03).geo(lancet(1.7, tall), s.glow, g, sill, 0.055);
      side.geo(lancet(0.6, 1.5), s.glass, g, wallH + 0.6, 0.07);
    }
  }
}

/** Clock dial facing local +z turned by yaw: pale face, dark rim, hour marks and hands. */
export function clockFace(k: Kit, cx: number, cy: number, cz: number, r: number, yaw: number, hour = 10, minute = 9): void {
  const c = k.sub(cx, cy, cz, yaw);
  const face = k.m.get('plain', { color: 0xf1ead4 });
  const dark = k.m.get('paintedMetal', { color: 0x1d1d1f });
  c.geo(disc(r, 20), face, 0, 0, 0.03);
  c.geo(ring(r, r * 0.07, 20), dark, 0, 0, 0.05);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beam([Math.sin(a) * r * 0.78, Math.cos(a) * r * 0.78, 0.05], [Math.sin(a) * r * 0.9, Math.cos(a) * r * 0.9, 0.05], r * 0.05, dark);
  }
  const ha = ((hour % 12) / 12 + minute / 720) * Math.PI * 2;
  const ma = (minute / 60) * Math.PI * 2;
  c.beam([0, 0, 0.07], [Math.sin(ha) * r * 0.5, Math.cos(ha) * r * 0.5, 0.07], r * 0.08, dark);
  c.beam([0, 0, 0.09], [Math.sin(ma) * r * 0.74, Math.cos(ma) * r * 0.74, 0.09], r * 0.06, dark);
}

/** A generic bronze figure on a stone plinth (no likeness, no name). Faces local +z turned by yaw. */
export function statue(k: Kit, x: number, z: number, yaw: number, plinthH = 2.8, pose: 'standing' | 'robed' = 'standing'): void {
  const s = k.sub(x, 0, z, yaw);
  const stone = k.m.get('limestone', { color: 0xd9d4c6 });
  const metal = bronze(k.m);
  s.box(0, -0.3, 0, 3.4, 0.6, 3.4, k.m.get('bluestone'));
  s.solid(0, 0.3, 0, 2.0, plinthH, 2.0, stone);
  s.box(0, 0.3 + plinthH, 0, 2.3, 0.25, 2.3, stone);
  s.box(0, 0.3, 0, 2.3, 0.35, 2.3, stone);
  const y = plinthH + 0.55;
  if (pose === 'robed') {
    s.geo(cone(0.62, 1.5, 8, 0.3), metal, 0, y, 0);
  } else {
    s.dbox(-0.17, y, 0, 0.24, 1.05, 0.28, metal).dbox(0.17, y, 0.06, 0.24, 1.05, 0.28, metal);
    s.dbox(0, y + 0.85, 0, 0.72, 0.5, 0.36, metal);
  }
  s.dbox(0, y + 1.2, 0, 0.66, 0.78, 0.36, metal);
  s.geo(sphere(0.19, 8), metal, 0, y + 2.2, 0.02);
  // One arm at the side, the other holding a rolled paper forward.
  s.beam([-0.4, y + 1.9, 0], [-0.46, y + 1.05, 0.05], 0.17, metal);
  s.beam([0.4, y + 1.9, 0], [0.5, y + 1.5, 0.3], 0.17, metal);
  s.beam([0.5, y + 1.5, 0.3], [0.38, y + 1.45, 0.62], 0.15, metal);
}

/** Flagpole with a flag flying towards local +x. */
export function flagpole(k: Kit, x: number, z: number, h: number, color: number): void {
  const pole = k.m.get('paintedMetal', { color: 0xe8e8e2 });
  k.beam([x, k.ground(x, z), z], [x, h, z], 0.12, pole);
  k.geo(sphere(0.12, 6), pole, x, h, z);
  k.dbox(x + 0.95, h - 1.25, z, 1.8, 1.1, 0.03, k.m.get('cloth', { color }));
}

/**
 * Sealed car park with painted bays: rows of bays along local x, each row `bay` deep, separated by aisles.
 * `rows` lists the z of each row's centre.
 */
export function carPark(k: Kit, cx: number, cz: number, w: number, d: number, rows: number[], bay = 5): void {
  const seal = asphalt(k.m);
  const line = whiteLine(k.m);
  const tx = tartan(cx - w / 2, cx + w / 2, 2.6, 0.12, cx - w / 2 + 1.4, 30);
  const cuts = new Set<number>([cz - d / 2, cz + d / 2]);
  for (const r of rows) {
    cuts.add(Math.max(cz - d / 2, r - bay / 2));
    cuts.add(Math.min(cz + d / 2, r + bay / 2));
  }
  const zs = [...cuts].sort((a, b) => a - b);
  k.pave(tx.at, zs, (i, _j, _x, z) => (tx.isBand[i] && rows.some((r) => Math.abs(z - r) < bay / 2) ? line : seal));
}
