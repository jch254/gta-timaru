import { hashInts } from '../../core/rng';
import type { ChunkBuilder, LandmarkPlacement, Scatterer, WorldApi } from '../../core/types';
// Registers picnic-table, bus-parked, chch-lamp-standard… and tussock, rock…
import { cathedralSquareAnnex } from '../landmarks/christchurch/cathedral';
import '../landmarks/christchurch/props';
import { Geo, Site } from '../landmarks/rural/kit';
import '../landmarks/rural/props';
import { SCATTERERS } from './registry';
import { junctionReach } from './streets';
import { type Area, DRESSING_OFF, edgesIn, Keep, Lights } from './util';

/**
 * Hand-authored dressing for particular places, outside any landmark's clear radius: the Caroline Bay foreshore,
 * the Bay Hill lookout, New Brighton's seafront, Lyttelton's wharf apron, the Timaru port lock-up yard.
 *
 * Each piece is written in world coordinates and clipped to the chunk being built: instanced things are placed
 * by the chunk they stand in, long ground covers are cut at the chunk's edge, and one-off structures belong to
 * the chunk that holds their centre. So a piece may straddle chunks and still appears exactly once.
 */

const EAST = Math.PI / 2;
const MARRAM = [0xb5b98c, 0xa9b080, 0xc2c296];

class Ctx {
  readonly world: WorldApi;
  readonly keep: Keep;
  readonly lights: Lights;
  private flat = new Map<number, number>();

  constructor(
    readonly out: ChunkBuilder,
    readonly area: Area,
  ) {
    this.world = out.world;
    this.keep = new Keep(out.world, area, 12);
    this.lights = new Lights(out, 3);
  }

  /** The part of [a, b] along z that lies in this chunk, or null. */
  spanZ(a: number, b: number): [number, number] | null {
    const lo = Math.max(a, this.area.minZ);
    const hi = Math.min(b, this.area.minZ + this.area.size);
    return hi - lo > 0.5 ? [lo, hi] : null;
  }

  spanX(a: number, b: number): [number, number] | null {
    const lo = Math.max(a, this.area.minX);
    const hi = Math.min(b, this.area.minX + this.area.size);
    return hi - lo > 0.5 ? [lo, hi] : null;
  }

  /** Instanced prop on the ground, if this chunk owns the spot and it is clear by radius `r`. */
  put(kind: string, x: number, z: number, heading = 0, r = 0.5, scale = 1, tint?: number): boolean {
    if (!this.keep.inArea(x, z) || this.keep.inLandmark(x, z, r) || !this.keep.offRoad(x, z, r)) return false;
    this.out.instance(kind, x, this.world.heightAt(x, z), z, heading, scale, tint);
    return true;
  }

  /** A site frame for static geometry at a world point (heading 0: local x east, local z south). */
  site(x: number, z: number, heading = 0): Site {
    const p: LandmarkPlacement = { kind: 'dressing', name: '', x, z, heading, clearRadius: 0 };
    return new Site(p, this.out);
  }

  /** True when this chunk owns a one-off structure centred here and nothing else claims the ground. */
  owns(x: number, z: number, r: number): boolean {
    return this.keep.inArea(x, z) && !this.keep.inLandmark(x, z, r) && this.keep.offRoad(x, z, r);
  }

  /**
   * Where the flat ground behind an east-facing shore ends, on the latitude z: the last x (scanning east from
   * `from`) before the land falls away to the water.
   */
  brink(z: number, from: number): number {
    const key = Math.round(z * 4);
    let x = this.flat.get(key);
    if (x === undefined) {
      const top = this.world.heightAt(from, z);
      x = from;
      while (x < from + 120 && this.world.heightAt(x + 2, z) > top - 0.6) x += 2;
      this.flat.set(key, x);
    }
    return x;
  }
}

interface Seafront {
  /** Latitudes covered. */
  z0: number;
  z1: number;
  /** A point on the flat ground behind the shore, to scan east from. */
  from: number;
  /** West and east limits of the mown reserve (null: none). */
  lawn: [number, number] | null;
  /** Row of Norfolk pines: x on a latitude, and their spacing. */
  pines?: (z: number) => number;
  seed: number;
}

/**
 * A seaside promenade along an east-facing shore: a mown reserve, a row of Norfolk pines, a sealed walk a few
 * metres back from the top of the bank with seats and lamp standards, a white post-and-rail fence along the
 * brink and marram grass and flax between the two.
 */
function seafront(c: Ctx, o: Seafront): void {
  const span = c.spanZ(o.z0, o.z1);
  if (!span || !c.spanX(o.from - 60, o.from + 130)) return;
  const [za, zb] = span;
  const s = c.site(o.from, (za + zb) / 2);
  const lx = (x: number) => x - o.from;
  const lz = (z: number) => z - (za + zb) / 2;
  const m = c.out.materials;

  if (o.lawn) {
    const grass = new Geo();
    s.drape(grass, lx((o.lawn[0] + o.lawn[1]) / 2), 0, o.lawn[1] - o.lawn[0], zb - za, 0.05, 0, 8);
    grass.flush(c.out, s.ground('grass', 0x6f9a4a), s.f);
  }

  // The walk and the rail follow the brink, sampled every 12 m (on a grid of latitudes, so chunks agree).
  const walk: [number, number][] = [];
  const rail: [number, number][] = [];
  for (let z = Math.floor(za / 12) * 12; z <= zb + 12; z += 12) {
    const zz = Math.min(zb, Math.max(za, z));
    const edge = c.brink(zz, o.from);
    walk.push([lx(edge - 9), lz(zz)]);
    rail.push([lx(edge - 1.3), lz(zz)]);
    if (zz === zb) break;
  }
  if (walk.length > 1) {
    const path = new Geo();
    s.ribbon(path, walk, 3.2, 0.07);
    path.flush(c.out, s.ground('concrete', 0xd2cbb8), s.f);
    const posts = new Geo();
    s.fence(posts, rail, { height: 1.0, rails: 2, spacing: 3, post: 0.12, rail: [0.1, 0.06] });
    posts.flush(c.out, m.get('plain', { color: 0xf0efe8 }), s.f);
  }

  for (let z = Math.ceil(o.z0 / 4) * 4; z <= o.z1; z += 4) {
    if (z < za || z >= zb) continue;
    const k = Math.round(z / 4);
    const h = hashInts(k, o.seed);
    const edge = c.brink(z, o.from);
    // Marram on the bank top, between the walk and the rail.
    for (let i = 0; i < 2; i++) {
      const g = hashInts(k, i, o.seed + 5);
      c.put('tussock', edge - 1.9 - ((g >>> 4) % 100) / 22, z + ((g >>> 12) % 40) / 10, (g % 628) / 100, 0.2, 1 + ((g >>> 18) % 100) / 160, MARRAM[g % MARRAM.length]);
    }
    if (k % 6 === 0) c.put('bench', edge - 11.2, z, EAST, 0.9);
    if (k % 12 === 9) c.put('chch-lamp-standard', edge - 6.9, z, 0, 0.3);
    if (k % 9 === 4 && h % 3 !== 0) c.put('flax', edge - 5.4 + (h % 3), z + 1, (h % 628) / 100, 0.6, 0.8 + ((h >>> 8) % 40) / 100);
    if (o.pines && k % 4 === 0) c.put('tree-norfolk-pine', o.pines(z), z, (h % 628) / 100, 1.2, 0.88 + ((h >>> 8) % 100) / 500);
    if (o.lawn && k % 13 === 5) c.put('picnic-table', o.lawn[0] + 5 + ((h >>> 6) % 100) * (o.lawn[1] - o.lawn[0] - 10) * 0.01, z, (h % 314) / 100, 1.4);
  }
}

/** Round paddling pool with a concrete apron and a painted toadstool fountain in the middle. */
function paddlingPool(c: Ctx, x: number, z: number, r: number): void {
  if (!c.owns(x, z, r + 2)) return;
  const s = c.site(x, z);
  const b = s.batch();
  b.g(s.mat('concrete', 0xcfc9bb)).lathe(0, 0, 0, [[r + 2.2, -0.3], [r + 2.2, 0.1], [r + 0.4, 0.1], [r + 0.4, 0.32], [r, 0.32], [r, 0.14]], 28);
  b.g(s.mat('plain', 0x9fd0d6, { roughness: 0.3 })).lathe(0, 0, 0, [[r, 0.02], [0, 0.02]], 28);
  b.g(s.mat('glass', 0x4aa8b8)).lathe(0, 0, 0, [[r, 0.22], [0, 0.22]], 28);
  b.g(s.mat('plaster', 0xf2efe6)).lathe(0, 0, 0, [[0.28, 0], [0.22, 1.1]], 8);
  b.g(s.mat('plain', 0xc8322a, { roughness: 0.5 })).lathe(0, 0, 0, [[1.1, 1.05], [0.9, 1.4], [0.3, 1.62], [0, 1.66]], 12);
  b.flush();
  c.out.collider(s.f, 0, 0.7, 0, 0.6, 1.4, 0.6);
  for (const a of [0.5, 2.1, 3.7, 5.3]) c.put('bench', x + Math.sin(a) * (r + 3.2), z + Math.cos(a) * (r + 3.2), a + Math.PI, 0.9);
  c.put('tree-phoenix-palm', x + r + 4.5, z - r - 1, 1, 1, 0.9);
  c.put('tree-phoenix-palm', x + r + 4.5, z + r + 1, 2, 1, 0.95);
  c.lights.add(x, s.y + 4.5, z + r + 1, 0xffe2b0, 130, 20);
}

/** The Bay's aviary: an eight-sided wire flight under a green iron roof, on a low wall, with a keeper's door. */
function aviary(c: Ctx, x: number, z: number): void {
  if (!c.owns(x, z, 7)) return;
  const s = c.site(x, z);
  const b = s.batch();
  const R = 5;
  b.g(s.mat('concrete', 0xc9c3b4)).lathe(0, 0, 0, [[R + 0.15, -0.4], [R + 0.15, 0.6], [R - 0.15, 0.6]], 8);
  const frame = b.g(s.mat('paintedMetal', 0x2f5a44));
  const mesh = b.g(s.m.get('metal', { color: 0xb8bcc0, transparent: true, opacity: 0.28, doubleSided: true }));
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const p0: [number, number] = [Math.cos(a0) * R, Math.sin(a0) * R];
    const p1: [number, number] = [Math.cos(a1) * R, Math.sin(a1) * R];
    frame.post(p0[0], 0.5, p0[1], 0.1, 3.2);
    frame.beam([p0[0], 3.65, p0[1]], [p1[0], 3.65, p1[1]], 0.1);
    mesh.poly([[p0[0], 0.6, p0[1]], [p1[0], 0.6, p1[1]], [p1[0], 3.6, p1[1]], [p0[0], 3.6, p0[1]]], true);
  }
  b.g(s.mat('corrugated', 0x3f6a54)).lathe(0, 0, 0, [[R + 0.5, 3.7], [0.4, 5.3], [0, 5.5]], 8);
  // Perches and a few bright birds.
  const perch = b.g(s.mat('timber', 0x6f5a44));
  perch.post(0, 0, 0, 0.12, 3).beam([-1.6, 2.2, 0], [1.6, 2.2, 0], 0.05).beam([0, 1.5, -1.4], [0, 1.5, 1.4], 0.05);
  const birds: [number, number, number, number][] = [[-1.1, 2.3, 0, 0xe8c83a], [0.6, 2.3, 0, 0x4aa85a], [1.3, 2.3, 0, 0x5a8fd0], [0, 1.6, 0.9, 0xe8c83a], [0, 1.6, -0.7, 0xd0503a]];
  for (const [bxp, byp, bzp, color] of birds) b.g(s.mat('plain', color, { roughness: 0.8 })).box(bxp, byp, bzp, 0.1, 0.16, 0.2);
  b.flush();
  s.sign(s.f, 'AVIARY', 0, 3.2, R * 0.93 + 0.06, 2.2, 5, { bg: '#2f5a44', fg: '#f2ead6', style: 'block' });
  c.out.collider(s.f, 0, 1.8, 0, R * 1.85, 3.6, R * 1.85);
  c.put('bench', x - 2.5, z + R + 3, 0, 0.9);
  c.put('bench', x + 2.5, z + R + 3, 0, 0.9);
}

/** Low stone memorial wall with bronze plaques, facing `heading`. */
function memorialWall(c: Ctx, x: number, z: number, heading: number, len: number): void {
  if (!c.owns(x, z, 3)) return;
  const s = c.site(x, z, heading);
  const b = s.batch();
  b.g(s.mat('bluestone')).box(0, 0.45, 0, len, 1.7, 0.5);
  b.g(s.mat('limestone', 0xd9d4c6)).box(0, 1.36, 0, len + 0.2, 0.14, 0.62);
  const bronze = b.g(s.mat('metal', 0x56604a));
  for (let i = 0; i < Math.floor(len / 2.2); i++) bronze.box(-len / 2 + 1.1 + i * 2.2, 0.85, 0.26, 1.3, 0.5, 0.03);
  b.flush();
  c.out.collider(s.f, 0, 0.7, 0, len, 1.4, 0.5);
  c.put('flax', x + Math.cos(heading) * (len / 2 + 1), z - Math.sin(heading) * (len / 2 + 1), 1, 0.5);
  c.put('flax', x - Math.cos(heading) * (len / 2 + 1), z + Math.sin(heading) * (len / 2 + 1), 2, 0.5);
}

/** Surf lifesaving lookout on the dune: a hut on timber legs with a ladder and patrol flags. */
function surfLookout(c: Ctx, x: number, z: number): void {
  if (!c.owns(x, z, 3)) return;
  const s = c.site(x, z);
  const b = s.batch();
  const legs = b.g(s.mat('timber', 0x7a6248));
  for (const px of [-1.3, 1.3]) for (const pz of [-1.3, 1.3]) legs.post(px, -0.4, pz, 0.2, 3.6);
  legs.box(0, 3.2, 0, 3.4, 0.16, 3.4);
  legs.beam([-1.3, 0.3, 1.3], [1.3, 2.9, 1.3], 0.1).beam([-1.3, 0.3, -1.3], [1.3, 2.9, -1.3], 0.1);
  legs.beam([-2.2, 0, 0.4], [-1.75, 3.2, 0.4], 0.08).beam([-2.2, 0, -0.4], [-1.75, 3.2, -0.4], 0.08);
  for (let i = 1; i < 8; i++) legs.box(-2.2 + i * 0.056, i * 0.4, 0, 0.06, 0.05, 0.8);
  b.g(s.mat('weatherboard', 0xf2efe6)).box(0.2, 4.3, 0, 2.6, 2.1, 2.6);
  b.g(s.mat('glass', 0x23323c)).box(1.52, 4.6, 0, 0.04, 0.9, 2.0);
  b.g(s.mat('corrugated', 0xb8322a)).box(0.2, 5.42, 0, 3.2, 0.14, 3.2);
  const pole = b.g(s.mat('paintedMetal', 0xe9e6dc));
  for (const pz of [-9, 9]) {
    pole.post(4, 0, pz, 0.06, 3.2);
    b.g(s.mat('cloth', 0xc8322a)).box(4.42, 2.95, pz, 0.8, 0.5, 0.03);
    b.g(s.mat('cloth', 0xe8c83a)).box(4.42, 2.45, pz, 0.8, 0.5, 0.03);
  }
  b.flush();
  s.sign(s.f, 'SURF PATROL', -1.12, 4.9, 0, 2.2, 5.5, { bg: '#f2efe6', fg: '#b8322a', style: 'block' }, -Math.PI / 2);
  c.out.collider(s.f, 0, 1.6, 0, 3, 3.2, 3);
}

/** The Bay Hill and streets like it: a white balustrade along the open side, with seats looking out over it. */
function lookoutStreet(c: Ctx, name: string): void {
  const graph = c.world.graph;
  const rails = new Geo();
  for (const e of edgesIn(graph, c.area)) {
    if (e.name !== name || !e.footpaths) continue;
    const from = junctionReach(graph, e, e.a) + 1;
    const to = e.length - junctionReach(graph, e, e.b) - 1;
    for (const side of [1, -1]) {
      let prev: [number, number, number] | null = null;
      for (let i = 0; i < e.samples.length; i++) {
        const p = e.samples[i];
        const off = side * (e.width / 2 + 3.75);
        const x = p.x + p.tz * off;
        const z = p.z - p.tx * off;
        const open = p.s >= from && p.s <= to && c.world.districtAt(p.x + p.tz * side * 16, p.z - p.tx * side * 16).type === 'beach' && c.keep.offRoad(x, z, 0.5) && !c.keep.inLandmark(x, z, 1);
        const here: [number, number, number] | null = open ? [x, c.world.heightAt(x, z), z] : null;
        if (here && prev && c.keep.inArea(prev[0], prev[2])) {
          for (const h of [0.5, 1.0]) rails.beam([prev[0], prev[1] + h, prev[2]], [here[0], here[1] + h, here[2]], 0.07, 0.1);
          rails.post(prev[0], prev[1] - 0.3, prev[2], 0.13, 1.45);
        }
        if (here && i % 5 === 2) {
          const bx = p.x + p.tz * side * (e.width / 2 + 2.9);
          const bz = p.z - p.tx * side * (e.width / 2 + 2.9);
          c.put('bench', bx, bz, Math.atan2(p.tz * side, -p.tx * side), 0.3);
        }
        prev = here;
      }
    }
  }
  rails.flush(c.out, c.out.materials.get('plain', { color: 0xf0efe8 }));
}

/** Stacked shipping containers: `n` long along the heading, up to `high` tall; colours and gaps from the seed. */
function containers(c: Ctx, x: number, z: number, heading: number, n: number, high: number, seed: number): void {
  if (!c.owns(x, z, 4)) return;
  const s = c.site(x, z, heading);
  const b = s.batch();
  const COLORS = [0x8a2f2a, 0x2b4a6b, 0x2f5d3a, 0xb86a2a, 0x8f959a, 0x6f3a2c, 0xc9a23a, 0x3a5a6a];
  for (let i = 0; i < n; i++) {
    const tall = 1 + (hashInts(seed, i) % high);
    for (let k = 0; k < tall; k++) {
      const color = COLORS[hashInts(seed, i, k) % COLORS.length];
      b.g(s.mat('corrugated', color)).box(0, 1.3 + k * 2.6, (i - (n - 1) / 2) * 6.3, 2.44, 2.59, 6.06);
    }
    c.out.collider(s.f, 0, tall * 1.3, (i - (n - 1) / 2) * 6.3, 2.44, tall * 2.6, 6.06);
  }
  b.flush();
}

/** Steel light mast with a cluster of floodlights (the heads glow at night). */
function lightMast(c: Ctx, x: number, z: number, lit: boolean): void {
  if (!c.owns(x, z, 0.6)) return;
  const s = c.site(x, z);
  const b = s.batch();
  b.g(s.mat('metal', 0x8f9498)).tube([0, -0.3, 0], [0, 16, 0], 0.16, 0.09, 7).box(0, 16, 0, 2.2, 0.12, 0.12);
  const heads = b.g(s.m.emitter(0xfff0c8, 'night'));
  for (const hx of [-0.9, -0.3, 0.3, 0.9]) heads.box(hx, 15.75, 0.12, 0.42, 0.3, 0.2);
  b.flush();
  c.out.collider(s.f, 0, 2, 0, 0.4, 4, 0.4);
  if (lit) c.lights.add(x, s.y + 13, z + 3, 0xfff0d0, 260, 40);
}

/** A pile of export logs lying along the heading: `rows` logs on the ground, narrowing as it rises. */
function logStack(c: Ctx, x: number, z: number, heading: number, rows: number, len: number): void {
  if (!c.owns(x, z, 3)) return;
  const s = c.site(x, z, heading);
  const g = new Geo();
  const r = 0.3;
  let layer = 0;
  for (let n = rows; n >= Math.max(1, rows - 2); n--, layer++) {
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * r * 2.05;
      const jitter = ((i * 7 + layer * 3) % 5) * 0.12 - 0.24;
      g.tube([lx, r + layer * r * 1.78, -len / 2 + jitter], [lx, r + layer * r * 1.78, len / 2 + jitter], r, r * 0.92, 7);
    }
  }
  g.flush(c.out, s.mat('bark', 0xa98a62), s.f);
  c.out.collider(s.f, 0, r * 2.2, 0, rows * r * 2.05, r * 4.4, len);
}

/** Lyttelton: the wharf apron between Norwich Quay and the water, either side of the way out from Gladstone Quay. */
function lytteltonWharf(c: Ctx): void {
  const w = c.world;
  const quayZ = new Map<number, number>();
  /** Latitude of the quay face on a meridian: the last dry, level ground going north from the yard. */
  const quay = (x: number): number => {
    let z = quayZ.get(x);
    if (z === undefined) {
      z = -2262;
      while (z < -2120 && w.waterDepthAt(x, z + 2) <= 0 && w.heightAt(x, z + 2) > 2.5) z += 2;
      quayZ.set(x, z);
    }
    return z;
  };
  // Containers east of the way out, in paired rows with truck lanes between.
  for (const [x, n, seed] of [[1478, 5, 11], [1531, 5, 23]] as const) {
    for (const z of [-2323.5, -2320.9, -2303, -2300.4]) containers(c, x, z, EAST, n, 3, seed + Math.round(z));
  }
  containers(c, 1500, -2264, EAST, 6, 2, 41);
  containers(c, 1500, -2261.4, EAST, 6, 2, 43);
  // A short stack and loose cargo right by the way out, so the apron reads as a working wharf from the lane.
  containers(c, 1449, -2313, 0, 2, 2, 57);
  for (const [x, z, yaw] of [[1441, -2302, 0.3], [1443.2, -2304.4, 1.2], [1412, -2281, 0.8], [1437, -2268, 2.1], [1411, -2262, 0.2]] as const) c.put('pallet', x, z, yaw, 0.8);
  for (const [x, z, tint] of [[1410.6, -2283.2, 0x2b4a6b], [1411.3, -2283.9, 0xb5261e], [1438.6, -2270, 0x8a8d90], [1439.2, -2269.2, 0x2d6a4f]] as const) c.put('drum', x, z, 0, 0.4, 1, tint);
  // Logs and sawn timber west of it.
  for (const [x, z, rows] of [[1362, -2318, 6], [1362, -2306, 5], [1384, -2318, 6], [1384, -2306, 6], [1352, -2270, 5]] as const) logStack(c, x, z, EAST, rows, 11);
  if (c.owns(1380, -2272, 4)) {
    const s = c.site(1380, -2272);
    const packs = new Geo();
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2 + (i % 2); k++) packs.box(-4.5 + i * 3, 0.5 + k * 0.95, 0, 1.15, 0.85, 4.8);
    packs.flush(c.out, s.mat('timber', 0xd2b48a), s.f);
    c.out.collider(s.f, 0, 1.2, 0, 11, 2.4, 4.8);
  }
  // Wharf office at the foot of Gladstone Quay, staff cars beside it, a forklift left where it stopped.
  if (c.owns(1399, -2302, 3)) {
    const s = c.site(1399, -2302, EAST);
    const b = s.batch();
    c.out.box(s.f, 0, 1.0, 0, 5.2, 3.6, 3.4, s.mat('weatherboard', 0xd8d2c0));
    c.out.box(s.f, 0, 2.9, 0, 5.8, 0.16, 4, s.mat('corrugated', 0x6f3a2c));
    c.out.quad(s.f, -0.9, 1.6, 1.71, 1.6, 1.0, s.m.windows('house'));
    b.g(s.mat('paintedMetal', 0x2f5a44)).box(1.5, 1.05, 1.72, 0.9, 2.1, 0.06);
    b.flush();
    s.sign(s.f, 'WHARF OFFICE', 0, 2.55, 1.72, 3.4, 6, { bg: '#f2ead6', fg: '#1d2a44', style: 'block' });
    c.out.collider(s.f, 0, 1.4, 0, 5.2, 2.8, 3.4);
    c.lights.add(1402.5, s.y + 3, -2302, 0xffe2b0, 110, 14);
  }
  const CARS = [0x8f959a, 0x1f3f7a, 0xe8e6df];
  CARS.forEach((tint, i) => c.put('car-parked', 1396 + i * 2.9, -2291, 0.04 * (i - 1), 1.3, 1, tint));
  if (c.owns(1447, -2289, 2)) {
    const s = c.site(1447, -2289, 2.3);
    const b = s.batch();
    b.g(s.mat('paintedMetal', 0xd9a21e)).box(0, 0.75, -0.3, 1.15, 0.8, 1.9).box(0, 1.25, -1.0, 1.1, 0.5, 0.5);
    b.g(s.mat('paintedMetal', 0x2a2c2e)).box(0, 1.5, 0.75, 0.9, 2.9, 0.12).box(0, 2.05, -0.3, 1.1, 0.06, 1.3).box(0, 0.12, 1.35, 0.9, 0.06, 1.1).box(-0.5, 0.3, 0.3, 0.2, 0.6, 0.6).box(0.5, 0.3, 0.3, 0.2, 0.6, 0.6).box(-0.5, 0.25, -0.9, 0.2, 0.5, 0.5).box(0.5, 0.25, -0.9, 0.2, 0.5, 0.5);
    for (const px of [-0.5, 0.5]) for (const pz of [-0.9, 0.3]) b.g(s.mat('paintedMetal', 0x2a2c2e)).post(px, 1.15, pz, 0.06, 0.9);
    b.flush();
    c.out.collider(s.f, 0, 1, 0, 1.2, 2, 2.6);
    c.put('pallet', 1445.6, -2286.8, 0.7, 0.8);
  }
  // Bollards along the quay face, loose cargo behind them, floodlight masts over the apron.
  const span = c.spanX(1396, 1566);
  if (span) {
    const iron = new Geo();
    for (let x = Math.ceil(span[0] / 13) * 13; x < span[1]; x += 13) {
      const z = quay(x) - 1.4;
      if (!c.keep.inArea(x, z) || c.keep.inLandmark(x, z, 1) || w.waterDepthAt(x, z) > 0) continue;
      iron.lathe(x, w.heightAt(x, z), z, [[0.24, -0.2], [0.21, 0.42], [0.36, 0.5], [0.36, 0.62], [0, 0.66]], 8);
      const h = hashInts(x, 977);
      if (Math.abs(x - 1424) < 16) continue;
      if (h % 3 === 0) c.put('pallet', x + 3, z - 5 - (h % 4), (h % 628) / 100, 0.8);
      else if (h % 3 === 1) for (let i = 0; i < 3; i++) c.put('drum', x + 2 + i * 0.7, z - 4.5 - (i % 2) * 0.62, 0, 0.4, 1, [0x2b4a6b, 0xb5261e, 0x8a8d90, 0x2d6a4f][(h + i) % 4]);
    }
    iron.flush(c.out, c.out.materials.get('paintedMetal', { color: 0x2a2c2e }));
  }
  lightMast(c, 1452, -2284, true);
  lightMast(c, 1348, -2290, false);
  lightMast(c, 1520, -2236, true);
  lightMast(c, 1404, -2232, false);
}

/** A row of iron lock-up units with roller doors, facing `heading`, behind a sealed apron. */
function lockUps(c: Ctx, x: number, z: number, heading: number): void {
  if (!c.keep.inArea(x, z)) return;
  const s = c.site(x, z, heading);
  const b = s.batch();
  const iron = s.mat('corrugated', 0x7d8a92);
  c.out.box(s.f, 0, 1.2, 0, 18, 3.9, 8, iron);
  c.out.box(s.f, 0, 3.3, 0.2, 18.6, 0.14, 8.8, s.mat('corrugated', 0x5c6268));
  const DOORS = [0x8a2f2a, 0xd8cfb4, 0x2f5d3a];
  DOORS.forEach((color, i) => {
    const dx = -6 + i * 6;
    b.g(s.mat('paintedMetal', color)).box(dx, 1.3, 4.02, 4.2, 2.6, 0.06);
    s.sign(s.f, String(i + 1), dx, 2.9, 4.04, 0.5, 1, { bg: '#f2ead6', fg: '#1a1a1a', style: 'block' });
  });
  b.g(s.m.emitter(0xffe6a8, 'night')).box(0, 3.05, 4.1, 0.5, 0.14, 0.2);
  b.flush();
  c.out.collider(s.f, 0, 1.6, 0, 18, 3.2, 8);
  const apron = new Geo();
  s.drape(apron, 0, 11, 24, 14, 0.05, 0, 6);
  apron.flush(c.out, s.ground('asphalt'), s.f);
  const at = (lx: number, lz: number): [number, number] => [x + lx * Math.cos(heading) + lz * Math.sin(heading), z - lx * Math.sin(heading) + lz * Math.cos(heading)];
  const stuff: [string, number, number, number, number | undefined][] = [['drum', -9.8, 5, 0, 0x2b4a6b], ['drum', -10.5, 5.5, 0, 0xb5261e], ['drum', -9.9, 5.9, 0, 0x8a8d90], ['pallet', 10.4, 5.6, 0.4, undefined], ['pallet', 11.2, 8, 1.3, undefined], ['car-parked', -6.5, 9, 2.9, 0x8f959a]];
  for (const [kind, lx, lz, yaw, tint] of stuff) {
    const [px, pz] = at(lx, lz);
    c.put(kind, px, pz, heading + yaw, 0.5, 1, tint);
  }
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      const [px, pz] = at(side * 12.5, -2.5 + i * 3);
      c.put('chainlink-fence', px, pz, heading + Math.PI / 2, 0.2);
    }
  }
  const [lx, lz] = at(0, 7);
  c.lights.add(lx, s.y + 3.2, lz, 0xffe2b0, 140, 18);
}

/** Local → world for a placement's frame (local +z = its heading). */
const worldOf = (p: LandmarkPlacement, lx: number, lz: number): [number, number] => [p.x + lx * Math.cos(p.heading) + lz * Math.sin(p.heading), p.z - lx * Math.sin(p.heading) + lz * Math.cos(p.heading)];

export const setPieces: Scatterer = (area, out) => {
  if (DRESSING_OFF) return;
  const within = (x0: number, x1: number, z0: number, z1: number) => area.minX < x1 && area.minX + area.size > x0 && area.minZ < z1 && area.minZ + area.size > z0;
  let c: Ctx | null = null;
  const ctx = () => (c ??= new Ctx(out, area));

  // ── Christchurch: the block south-west of Cathedral Square (car park and a grove; see the landmark's notes) ──
  const square = out.world.landmarks.find((l) => l.kind === 'cathedral-square');
  if (square) {
    const [ax, az] = worldOf(square, 45, 92);
    if (ax >= area.minX && ax < area.minX + area.size && az >= area.minZ && az < area.minZ + area.size) {
      const k = ctx();
      // Outside every landmark's radius (the Square's own and the tram stop's), off the walks and the tram line.
      cathedralSquareAnnex(square, out, (x, z, r) => !k.keep.inLandmark(x, z, r) && k.keep.offRoad(x, z, r) && !k.world.railways.some((line) => line.points.some((q) => Math.hypot(q.x - x, q.z - z) < r + 3.3)));
    }
  }

  // ── Caroline Bay, Timaru: the foreshore reserve between Virtue Avenue and the top of the bank ──
  if (within(580, 720, 4430, 4800)) {
    const k = ctx();
    const road = (z: number) => 600 + ((4700 - z) * 6) / 220;
    seafront(k, { z0: 4452, z1: 4792, from: 632, lawn: [613, 648], pines: (z) => (z < 4700 ? road(z) + 9.2 : 9999), seed: 311 });
    paddlingPool(k, 630, 4618, 8);
    aviary(k, 629, 4572);
    memorialWall(k, 628, 4716, 0, 13);
    k.lights.add(650, k.world.heightAt(650, 4655) + 4, 4655, 0xffe2b0, 120, 22);
  }
  if (within(400, 600, 4700, 4820)) lookoutStreet(ctx(), 'The Bay Hill');

  // ── New Brighton: the reserve and dunes behind Marine Parade, either side of the mall's axis ──
  if (within(2536, 2680, -4540, -4290)) {
    const k = ctx();
    seafront(k, { z0: -4530, z1: -4296, from: 2585, lawn: [2569, 2597], pines: () => 2571.5, seed: 733 });
    surfLookout(k, 2604, -4412);
    // The gap in the houses opposite the mall: a lawn and the path through to the beach.
    if (k.keep.inArea(2554, -4404)) {
      const s = k.site(2554, -4404);
      const grass = new Geo();
      s.drape(grass, 0, 0, 30, 34, 0.05, 0, 8);
      grass.flush(out, s.ground('grass', 0x6f9a4a), s.f);
      const path = new Geo();
      s.ribbon(path, [[-15, -6], [46, -6]], 3, 0.08);
      path.flush(out, s.ground('concrete', 0xd2cbb8), s.f);
    }
    for (const x of [2548, 2562]) {
      k.put('bench', x, -4407.4, Math.PI, 0.9);
      k.put('chch-lamp-standard', x + 6, -4412.6, 0, 0.3);
    }
  }

  // ── Lyttelton: the wharf apron ──
  if (within(1330, 1570, -2340, -2150)) lytteltonWharf(ctx());

  // ── Timaru port: the lock-ups on Ritchie Street ──
  const lockup = out.world.places.find((q) => q.id === 'timaru-port-lockup');
  if (lockup && within(lockup.x - 30, lockup.x + 30, lockup.z - 50, lockup.z + 10)) lockUps(ctx(), lockup.x + 2, lockup.z - 27, 0);
};

SCATTERERS.push(setPieces);

