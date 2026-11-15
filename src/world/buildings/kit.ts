import * as THREE from 'three';
import { hashInts, Rng } from '../../core/rng';
import type { ChunkBuilder, CityId, Lot, LotBuilder, MaterialLibrary, SurfaceKind, WorldApi } from '../../core/types';
import { type Wear, weathered } from './weathering';

/**
 * Shared kit for the building archetypes: a per-lot `Site`, primitive wrappers that work in the lot's
 * local frame (x across the frontage, +z towards the road, y up from the footpath), and the parts every
 * street shares: pitched roofs with ridge caps and gutters, parapets, verandahs, shopfronts, windows in
 * their surrounds, doors, fences.
 *
 * Rules the kit is written around:
 *  - A small palette of materials. Walls and roofs are colour-only variants of the standard surfaces
 *    (they merge into one batch per surface); every opening, light and piece of fretwork is a `pane` of
 *    the one facade-detail material (`MaterialLibrary.windows`, see render/glazing.ts), which draws
 *    frames, glass, interiors and night lighting in its shader. So a street costs one draw call per
 *    surface however many buildings stand on it.
 *  - A triangle budget per lot (`BUDGET`, `HOUSE_BUDGET`); fine detail asks `site.spare(n)` first, which is
 *    false at reduced detail or once the lot's budget is spent.
 *  - Structure is driven by `site.rng`, decoration by `site.fx`, so a reduced-detail chunk keeps the
 *    same massing as the full-detail one.
 */

/** Triangle budgets per lot. Decoration stops at the soft limit so the structure never passes the hard one. */
export const BUDGET = 3300;
export const HOUSE_BUDGET = 1300;

export type Rand = Parameters<LotBuilder>[2];
export type Mat = THREE.Material;

/** What `windows()` draws (mirrors GlazingStyle in render/glazing.ts; the kit talks to it through the material library only). */
export type PaneStyle = 'glass' | 'sash' | 'casement' | 'shop' | 'office' | 'curtain' | 'door' | 'shopdoor' | 'roller' | 'lamp' | 'steel' | 'louvre' | 'fret' | 'picket' | 'leaded' | 'fitting' | 'aerial';
export interface PaneSpec {
  w: number;
  h: number;
  color?: number;
  lit?: number;
  variant?: number;
  wall?: number;
}
type Glazier = { windows(kind: PaneStyle, spec: PaneSpec): Mat };

/** One entry in a district's archetype table. */
export interface Archetype {
  weight: number;
  build: LotBuilder;
  /** Stable id, for tests and debugging. */
  name: string;
  /** Extra weight multiplier for a particular lot (corner sites, city, plot size). 0 rules it out. */
  fit?: (lot: Lot) => number;
}

/** How a building's windows are made; set once per building and used by every `win`. */
export interface Joinery {
  style: 'sash' | 'casement' | 'alu';
  /** 0 / 1: one-over-one or two-over-two sashes; two or three casement lights. */
  variant: number;
  /** Paint on the sashes and frames. */
  frame: number;
  /** Facings and sills on a timber wall; the sill on a masonry one. */
  trim: number;
  /** 'timber': facings proud of the boards. 'masonry' / 'stone' / 'concrete': glass set back in a reveal over a sill. 'plain': a bare frame (sheds). */
  wall: 'timber' | 'masonry' | 'stone' | 'concrete' | 'plain';
  /** Material for masonry sills and hoods (default: pale concrete). */
  sill?: Mat;
}

export interface Site {
  lot: Lot;
  out: ChunkBuilder;
  m: MaterialLibrary;
  /** Structural randomness (massing, colours). */
  rng: Rand;
  /** Decoration-only randomness (props, trim). */
  fx: Rand;
  /** Local → world. */
  f: THREE.Matrix4;
  /** Height of this frame's origin above the lot's own y (see `raised`). */
  y0: number;
  /** Half width / half depth of the plot. */
  hw: number;
  hd: number;
  /** Full detail. */
  near: boolean;
  /** True when `n` more decorative primitives (about a box each) fit: full detail and budget left. */
  spare(n?: number): boolean;
  /** Triangles emitted for this lot so far. */
  used(): number;
  city: CityId | null;
  timaru: boolean;
  /** How far a verandah may reach forward of the front boundary. */
  apron: number;
  sin: number;
  cos: number;
  /** Window joinery for this building (shared by raised copies of the site). */
  j: Joinery;
  /** How this building has weathered: every surface `mat` hands out carries it (see weathering.ts). */
  wear: Wear;
  /** Walls sheltered by eaves: no dirt washes down them from the top. */
  eaves?: boolean;
  /** Set once the building has its television aerial. */
  aerials?: number;
}

/** Forwards to the chunk builder while counting the triangles a lot emits. */
class Tally implements ChunkBuilder {
  count = 0;
  readonly materials: MaterialLibrary;
  readonly world: WorldApi;
  readonly lod: 0 | 1;
  constructor(private readonly target: ChunkBuilder) {
    this.materials = target.materials;
    this.world = target.world;
    this.lod = target.lod;
  }
  addGeometry(geometry: THREE.BufferGeometry, material: Mat, matrix?: THREE.Matrix4) {
    this.count += (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
    this.target.addGeometry(geometry, material, matrix);
  }
  box(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: Mat) {
    this.count += 12;
    this.target.box(frame, cx, cy, cz, w, h, d, material);
  }
  gable(frame: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, material: Mat, hip?: number) {
    this.count += 6;
    this.target.gable(frame, cx, y, cz, w, d, rise, material, hip);
  }
  cylinder(frame: THREE.Matrix4, cx: number, cy: number, cz: number, radiusTop: number, radiusBottom: number, h: number, material: Mat, segments = 12) {
    this.count += segments * (radiusTop > 0 && radiusBottom > 0 ? 4 : 3);
    this.target.cylinder(frame, cx, cy, cz, radiusTop, radiusBottom, h, material, segments);
  }
  quad(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, material: Mat, yaw?: number, uvMetres?: boolean) {
    this.count += 2;
    this.target.quad(frame, cx, cy, cz, w, h, material, yaw, uvMetres);
  }
  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number) {
    this.target.collider(frame, cx, cy, cz, w, h, d);
  }
  instance(kind: string, x: number, y: number, z: number, heading?: number, scale?: number, tint?: number) {
    this.target.instance(kind, x, y, z, heading, scale, tint);
  }
  light(x: number, y: number, z: number, color: number, intensity: number, range: number) {
    this.target.light(x, y, z, color, intensity, range);
  }
  frameAt(x: number, y: number, z: number, heading: number): THREE.Matrix4 {
    return this.target.frameAt(x, y, z, heading);
  }
}

export function site(lot: Lot, target: ChunkBuilder, rng: Rand, budget = BUDGET): Site {
  const out = new Tally(target);
  const near = target.lod === 0;
  return {
    lot,
    out,
    m: out.materials,
    rng,
    fx: new Rng((rng.next() * 0x100000000) >>> 0),
    f: out.frameAt(lot.x, lot.y, lot.z, lot.heading),
    y0: 0,
    hw: lot.width / 2,
    hd: lot.depth / 2,
    near,
    spare: (n = 1) => near && out.count + n * 12 <= budget,
    used: () => out.count,
    city: lot.district.city,
    timaru: lot.district.city === 'timaru',
    apron: lot.edge.footpaths || lot.edge.cls === 'pedestrian' ? 2.9 : 1.6,
    sin: Math.sin(lot.heading),
    cos: Math.cos(lot.heading),
    j: { style: 'sash', variant: 0, frame: 0xf2efe6, trim: 0xf3eddc, wall: 'timber' },
    wear: { ground: lot.y, seed: hashInts(lot.seed, 77) & 63, age: ageOf(lot) },
    eaves: budget === HOUSE_BUDGET,
  };
}

/** How run-down a building is, 1 (looked after) to 7: sheds and wharves the worst, the city's offices the best. */
function ageOf(lot: Lot): number {
  const type = lot.district.type;
  const base = type === 'industrial' || type === 'port' ? 4 : type === 'rural' || type === 'township' ? 3.4 : type === 'cbd' ? 2 : type === 'shops' ? 3 : 2.6;
  return Math.max(1, Math.min(7, Math.round(base + ((hashInts(lot.seed, 78) % 1000) / 1000) * 3.2 - 1)));
}

// ───────────────────────────── Palette ─────────────────────────────

export const CREAM = 0xf3eddc;
export const FRAME = 0xefe9dc;
/** Painted weatherboard / stucco house colours of the period. */
export const HOUSE_PAINT = [0xf1ead8, 0xe6dcc0, 0xd8e2d0, 0xcfdde6, 0xeed6c8, 0xf0e2a8, 0xdcd6cc, 0xc6d4be, 0xe9dfd0, 0xd9cdb4, 0xbfd0cc, 0xf2e6c4, 0xf4f1e8, 0xe2c8b8, 0xb9c8b0, 0xd4c8a0];
/** Joinery and trim paint: mostly white and cream, the odd heritage green, oxblood or brown. */
export const TRIM_PAINT = [0xf3eddc, 0xf3eddc, 0xf6f4ee, 0xf6f4ee, 0xf6f4ee, 0xe8dcc0, 0x2f4a3a, 0x6a2a24, 0x5a4634, 0x3a4a5a];
/** Painted corrugated iron. */
export const IRON = [0x8b3027, 0x35603f, 0x8f959a, 0x6f3a2c, 0x5c6268, 0x9a4a32, 0xa9a79d, 0x7c2a22];
export const TILE = [0xa5502f, 0x8a4a34, 0x735848, 0x6a6e68, 0x9a4a32];
export const DOOR = [0x5a2e22, 0x234a3a, 0x2a3a5a, 0x6a1f1f, 0x1f2326, 0x7a5a2a, 0x8a2f2a];
/** Shop paintwork: awnings, fascias, stall risers. */
export const SHOP_PAINT = [0x8a2f2a, 0x2f5d3a, 0x2b4a6b, 0xb9b4a8, 0x3a3f44, 0xd8cfb4, 0x6b3a2a, 0x1f4a4a, 0xc9a23a];
/** Rendered commercial fronts. */
export const RENDER = [0xe8e0cf, 0xd9d2bf, 0xcfc8b8, 0xdfd0b4, 0xc9cfc4, 0xe6d8c0, 0xbfc4c8, 0xe9dcc8, 0xd6c3a6];
export const BRICKS = [0xffffff, 0xe6d6cc, 0xf2c9b0, 0xcdb9ac];
/** Factory-finish steel cladding. */
export const CLADDING = [0x9aa0a4, 0xb9b4a8, 0x6f8a9a, 0x8a7a66, 0xc8c2a8, 0x7d8a78, 0xa8563c, 0x4f6a7a];
export const CAR_PAINT = [0xb5261e, 0xe8e6df, 0x1f3f7a, 0x2d5f3b, 0xc9b27a, 0x7a1f2a, 0x8f959a, 0xd9c23a, 0x2a2a2e, 0x5f8fb5, 0xb86a2a, 0xe0d6c0];
/** Anodised aluminium joinery. */
export const ALUMINIUM = 0x9da1a4;
export const BRONZE = 0x4a3c30;
/** Warm fluorescent / incandescent light and signal-red neon, for `glow`. */
export const WARM_LIGHT = 0xfff0d0;
export const NEON_RED = 0xff5a3c;

/** A surface in the lot's material library; colour-only variants batch together. */
export const mat = (s: Site, surface: SurfaceKind, color?: number): Mat => {
  const m = weathered(s.m, surface, color, s.wear) ?? (color === undefined ? s.m.get(surface) : s.m.get(surface, { color }));
  MADE_OF.set(m, { surface, color });
  return m;
};
/** Paint on timber and steel: fascias, posts, sills, pipes. */
export const trim = (s: Site, color = CREAM): Mat => (WEATHER_TRIM ? weathered(s.m, 'plain', color, s.wear) : null) ?? s.m.get('plain', { color });
/** Paintwork weathers too (it costs one more batch in a chunk where other things use the plain surface). */
const WEATHER_TRIM = true;

/**
 * The same surface as `mt` with rain running down it from `top` (site height): a parapet, a wall that stops
 * at a flat roof. `datum` moves the ground it stands on (site height) when that is not the site's own.
 */
export function under(s: Site, mt: Mat, top: number, datum = 0): Mat {
  const made = MADE_OF.get(mt);
  if (!made) return mt;
  const m = weathered(s.m, made.surface, made.color, { ...s.wear, ground: s.wear.ground + datum, top: top - datum });
  if (!m) return mt;
  MADE_OF.set(m, made);
  return m;
}

/** The library's own clean material for what `mt` is made of: ground slabs, which must take the rain like the road. */
export function unweathered(s: Site, mt: Mat): Mat {
  const made = MADE_OF.get(mt);
  if (!made) return mt;
  return made.color === undefined ? s.m.get(made.surface) : s.m.get(made.surface, { color: made.color });
}

/** What each wall material handed out by `mat` is, so `tone` can ask for the same surface a shade off. */
const MADE_OF = new WeakMap<Mat, { surface: SurfaceKind; color?: number }>();
/** Colour a surface has when none is asked for (photographic brick and stone are their own colour: white). */
const UNTINTED: Partial<Record<SurfaceKind, number>> = { plaster: 0xe8e0cf, concrete: 0xb7b3a8, weatherboard: 0xf1ead8, corrugated: 0x9aa0a4 };

/**
 * The same surface as `mt`, darker (k < 1) or lighter: infill where an opening was bricked up, a tarred
 * plinth, a patch of newer render. It merges into the wall's own batch. Anything not made by `mat` comes back as it is.
 */
export function tone(s: Site, mt: Mat, k: number): Mat {
  const made = MADE_OF.get(mt);
  if (!made) return mt;
  return mat(s, made.surface, shade(made.color ?? UNTINTED[made.surface] ?? 0xffffff, k));
}

/** A colour darkened or lightened by `k`, snapped coarsely so the set of colours in use stays small. */
export function shade(color: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((v * k) / 8) * 8));
  return (c((color >> 16) & 255) << 16) | (c((color >> 8) & 255) << 8) | c(color & 255);
}

/** A pane material of the facade-detail shader. Sizes snap to 5 cm so the handles are shared widely. */
export function paneMat(s: Site, style: PaneStyle, spec: PaneSpec): Mat {
  const snap = (v: number) => Math.max(0.05, Math.round(v * 20) / 20);
  return (s.m as unknown as Glazier).windows(style, { ...spec, w: snap(spec.w), h: snap(spec.h) });
}

/** Plain dark glass for any primitive (box, cylinder, quad). */
export const glass = (s: Site): Mat => paneMat(s, 'glass', { w: 1, h: 1 });
/** A surface that glows `color` after dark (level 1 dim … 3 bright), for any primitive. */
export const glowMat = (s: Site, color = WARM_LIGHT, level = 2): Mat => paneMat(s, 'lamp', { w: 1, h: 1, color, lit: level });

// ───────────────────────────── Frames ─────────────────────────────

const EULER = new THREE.Euler();

/** A child frame at a local position: yaw about y, then pitch about the new x (+pitch dips the +z end), then roll about z. */
export function frame(s: Site, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(EULER.set(pitch, yaw, roll, 'YXZ')).setPosition(x, y, z).premultiply(s.f);
}

/** The same site with its origin lifted (or dropped) by `y`: houses sit on their own ground rather than at footpath level. */
export function raised(s: Site, y: number): Site {
  return { ...s, f: frame(s, 0, y, 0), y0: s.y0 + y, wear: { ...s.wear, ground: s.wear.ground + y } };
}

/** Local plot coordinates → world x/z. */
export function worldX(s: Site, lx: number, lz: number): number {
  return s.lot.x + lx * s.cos + lz * s.sin;
}
export function worldZ(s: Site, lx: number, lz: number): number {
  return s.lot.z - lx * s.sin + lz * s.cos;
}

/** Terrain height at a local point, relative to this site's origin. */
export function ground(s: Site, lx: number, lz: number): number {
  return s.out.world.heightAt(worldX(s, lx, lz), worldZ(s, lx, lz)) - s.lot.y - s.y0;
}

/** Depth to start a wall at so it meets the lowest ground under a rectangle. */
export function footing(s: Site, cx: number, cz: number, w: number, d: number): number {
  const hx = w / 2;
  const hz = d / 2;
  const lo = Math.min(ground(s, cx - hx, cz - hz), ground(s, cx + hx, cz - hz), ground(s, cx - hx, cz + hz), ground(s, cx + hx, cz + hz));
  return Math.max(-7, Math.min(-0.5, lo - 0.3));
}

/** Highest ground along a line (used to seat a house so its front door clears the lawn). */
export function highGround(s: Site, x0: number, x1: number, z: number): number {
  return Math.max(ground(s, x0, z), ground(s, (x0 + x1) / 2, z), ground(s, x1, z));
}

/** Lift the site so a set-back building stands on the ground it actually has rather than at footpath level. */
export function seat(s: Site, x0: number, x1: number, z: number): { h: Site; floor: number } {
  const floor = Math.max(-2.6, Math.min(2.6, highGround(s, x0, x1, z)));
  return { h: raised(s, floor), floor };
}

// ───────────────────────────── Primitives (y is the BASE of the shape) ─────────────────────────────

export function box(s: Site, x: number, y: number, z: number, w: number, h: number, d: number, mt: Mat) {
  s.out.box(s.f, x, y + h / 2, z, w, h, d, mt);
}

/** Flat panel facing local +z turned by `yaw`; (x, y, z) is its centre. */
export function quad(s: Site, x: number, y: number, z: number, w: number, h: number, mt: Mat, yaw = 0, metres = false) {
  s.out.quad(s.f, x, y, z, w, h, mt, yaw, metres);
}

const q = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

/** Upright cylinder / cone; sizes are snapped so the shared geometry cache stays small. */
export function cyl(s: Site, x: number, y: number, z: number, r: number, h: number, mt: Mat, segments = 10, rTop = r) {
  const hh = q(h, 0.1);
  s.out.cylinder(s.f, x, y + hh / 2, z, rTop === 0 ? 0 : q(rTop, 0.02), q(r, 0.02), hh, mt, segments);
}

/** Cylinder lying on its side along local x (yaw 0) or z (yaw π/2): drums, tanks, bales, wheels. `y` is its base. */
export function barrel(s: Site, x: number, y: number, z: number, r: number, len: number, mt: Mat, yaw = 0, segments = 12) {
  const rr = q(r, 0.02);
  const ll = q(len, 0.1);
  s.out.cylinder(frame(s, x, y + rr, z, yaw, 0, Math.PI / 2), 0, 0, 0, rr, rr, ll, mt, segments);
}

/** A straight slab between two points (centre line), `w` wide and `t` thick: lean-to roofs, ramps, paths, rods. */
export function slope(s: Site, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, t: number, mt: Mat) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const run = Math.hypot(dx, dz);
  s.out.box(frame(s, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, Math.atan2(dx, dz), Math.atan2(-dy, run)), 0, 0, 0, w, t, Math.hypot(run, dy), mt);
}

/** Wall block from the ground up to `top`. */
export function walls(s: Site, cx: number, cz: number, w: number, d: number, top: number, mt: Mat, bottom?: number) {
  const y = bottom ?? footing(s, cx, cz, w, d);
  // The wall weathers from the ground it actually stands on, and (under a parapet) from its own top down.
  const hx = w / 2;
  const hz = d / 2;
  const g = (ground(s, cx - hx, cz - hz) + ground(s, cx + hx, cz - hz) + ground(s, cx - hx, cz + hz) + ground(s, cx + hx, cz + hz)) / 4;
  s.out.box(s.f, cx, (y + top) / 2, cz, w, top - y, d, under(s, mt, s.eaves ? g : top, g));
}

/** The one static collider for a building body. */
export function solid(s: Site, cx: number, cz: number, w: number, d: number, top: number) {
  s.out.collider(s.f, cx, (top - 0.6) / 2, cz, w, top + 0.6, d);
}

/** Thin ground slab (yard, apron, forecourt) that reaches down far enough to meet falling ground. */
export function pad(s: Site, cx: number, cz: number, w: number, d: number, mt: Mat, top = 0.04) {
  const y = Math.max(-3, footing(s, cx, cz, w, d) + 0.2);
  s.out.box(s.f, cx, (y + top) / 2, cz, w, top - y, d, unweathered(s, mt));
}

/** True when the plot is close enough to level for a whole-yard slab to sit well. */
export function level(s: Site, tolerance = 0.45): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]] as const) {
    const g = ground(s, u * (s.hw - 1), v * (s.hd - 1));
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return hi - lo < tolerance;
}

// ───────────────────────────── Free-form geometry ─────────────────────────────

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Accumulates triangles in the site's local frame and hands them to the chunk builder as one piece. */
class Shape {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  /** Flat polygon (3 or 4 corners, counter-clockwise seen from outside) with its own UVs. */
  face(pts: readonly (readonly [number, number, number])[], uvs: readonly (readonly [number, number])[]) {
    const base = this.pos.length / 3;
    _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
    _b.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]);
    _a.cross(_b).normalize();
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.nor.push(_a.x, _a.y, _a.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
    }
    this.idx.push(base, base + 1, base + 2);
    if (pts.length === 4) this.idx.push(base, base + 2, base + 3);
  }

  emit(s: Site, mt: Mat) {
    if (!this.idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    s.out.addGeometry(g, mt, s.f);
  }
}

/**
 * Walls standing on a polyline footprint from `y0` to `y1`: bay windows, canted corners, turrets. Points
 * run left to right as seen from outside; `cap` closes the top with a flat lid.
 */
export function prism(s: Site, pts: readonly (readonly [number, number])[], y0: number, y1: number, mt: Mat, cap?: Mat) {
  const shape = new Shape();
  let u = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    shape.face(
      [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      [
        [u, 0],
        [u + len, 0],
        [u + len, y1 - y0],
        [u, y1 - y0],
      ],
    );
    u += len;
  }
  shape.emit(s, mt);
  if (cap && pts.length >= 3) {
    const lid = new Shape();
    for (let i = 1; i + 1 < pts.length; i++) {
      lid.face(
        [
          [pts[0][0], y1, pts[0][1]],
          [pts[i][0], y1, pts[i][1]],
          [pts[i + 1][0], y1, pts[i + 1][1]],
        ],
        [
          [pts[0][0], pts[0][1]],
          [pts[i][0], pts[i][1]],
          [pts[i + 1][0], pts[i + 1][1]],
        ],
      );
    }
    lid.emit(s, cap);
  }
}

/** Roof planes rising from each edge of a polyline at `y` to one apex: bay-window hoods, turret caps. */
export function tent(s: Site, pts: readonly (readonly [number, number])[], y: number, apex: readonly [number, number, number], mt: Mat) {
  const shape = new Shape();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const up = Math.hypot(apex[1] - y, Math.hypot(apex[0] - (ax + bx) / 2, apex[2] - (az + bz) / 2));
    shape.face(
      [
        [ax, y, az],
        [bx, y, bz],
        [apex[0], apex[1], apex[2]],
      ],
      [
        [0, 0],
        [len, 0],
        [len / 2, up],
      ],
    );
  }
  shape.emit(s, mt);
}

// ───────────────────────────── Panes of the facade-detail material ─────────────────────────────

const PANE = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();
const _scale = new THREE.Vector3();

export interface PaneOptions {
  color?: number;
  /** 0 never lit at night … 3 nearly always. */
  lit?: number;
  variant?: number;
  wall?: number;
  /** Cells across and up when the quad is a grid of identical openings (default one). */
  nx?: number;
  ny?: number;
  /** Tilt back from vertical in radians: π/2 faces straight down (soffit lights). */
  pitch?: number;
}

/**
 * One quad of the facade-detail material, centred at (x, y, z) on a wall facing `yaw`, `w` × `h` overall.
 * Each quad carries its own random seed (from where it is on the lot), so no two windows furnish or light
 * themselves alike.
 */
export function pane(s: Site, style: PaneStyle, x: number, y: number, z: number, w: number, h: number, yaw = 0, o: PaneOptions = {}) {
  const nx = o.nx ?? 1;
  const ny = o.ny ?? 1;
  const mt = paneMat(s, style, { w: w / nx, h: h / ny, color: o.color, lit: o.lit, variant: o.variant, wall: o.wall });
  const seed = hashInts(s.lot.seed, Math.round(x * 8), Math.round((y + s.y0) * 8), Math.round(z * 8), Math.round(yaw * 4));
  const u0 = (seed & 15) * 64;
  const v0 = ((seed >> 4) & 15) * 64;
  const uv = PANE.getAttribute('uv');
  uv.setXY(0, u0, v0);
  uv.setXY(1, u0 + nx, v0);
  uv.setXY(2, u0 + nx, v0 + ny);
  uv.setXY(3, u0, v0 + ny);
  const m = new THREE.Matrix4().makeRotationFromEuler(EULER.set(o.pitch ?? 0, yaw, 0, 'YXZ')).scale(_scale.set(w, h, 1)).setPosition(x, y, z).premultiply(s.f);
  s.out.addGeometry(PANE, mt, m);
}

const LEDGE = (() => {
  // Front, top and underside of a unit box: what shows of a sill or a hood mould against a wall.
  const g = new THREE.BufferGeometry();
  const p = [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5];
  const n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0];
  const uv = [0, 0, 1, 0, 1, 0.1, 0, 0.1, 0, 0.1, 1, 0.1, 1, 0.2, 0, 0.2, 0, 0.2, 1, 0.2, 1, 0.3, 0, 0.3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  return g;
})();

/**
 * A sill, hood mould or string course on a wall facing `yaw`: `w` long, `h` high, standing `d` out, centred
 * at (x, y, z). Half the triangles of a box: the ends and the back are left off, which at 10 cm nobody sees.
 */
export function ledge(s: Site, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, mt: Mat) {
  s.out.addGeometry(LEDGE, mt, new THREE.Matrix4().makeRotationY(yaw).scale(_scale.set(w, h, d)).setPosition(x, y, z).premultiply(s.f));
}

/** A cut-out pane seen from both sides (balustrades, friezes, lattice). */
export function screen(s: Site, style: 'fret' | 'picket', x: number, y: number, z: number, w: number, h: number, yaw: number, color: number, variant = 0, mirror = variant) {
  pane(s, style, x, y, z, w, h, yaw, { color, variant });
  pane(s, style, x, y, z, w, h, yaw + Math.PI, { color, variant: mirror });
}

/** A light fitting that glows after dark: a flat panel on a wall (`yaw`) or under a soffit (`down`). */
export function glow(s: Site, x: number, y: number, z: number, w: number, h: number, color = WARM_LIGHT, level = 2, yaw = 0, down = false) {
  pane(s, 'lamp', x, y, z, w, h, yaw, { color, lit: level, pitch: down ? Math.PI / 2 : 0 });
}

// ───────────────────────────── Roofs ─────────────────────────────

export interface RoofOptions {
  /** Ridge direction: 'x' runs along the street (default), 'z' runs back from it. */
  axis?: 'x' | 'z';
  /** Hip length at each end (0 = gable). */
  hip?: number;
  eave?: number;
  /** Wall material for the gable ends (omit for a shed where the ends are the roof sheeting). */
  gable?: Mat;
  /** Fascia and bargeboard paint (default cream); `null` leaves the edges bare (sheds). */
  fascia?: number | null;
  /** Leave off the ridge capping and gutters (lean-tos, porch hoods). */
  bare?: boolean;
}

/**
 * Pitched roof over a w × d plan whose walls stop at `y`. A gabled roof with `gable` set is two prisms:
 * the wall-coloured gable, and the roof sheet just above it, held back from the ends so the gable shows.
 * Full detail adds what makes it read as a roof rather than a prism: ridge capping, fascia and gutter
 * along the eaves, bargeboards up the gables, a lining under the overhang.
 */
export function roof(s: Site, cx: number, y: number, cz: number, w: number, d: number, rise: number, mt: Mat, o: RoofOptions = {}) {
  const eave = o.eave ?? 0.45;
  const alongZ = o.axis === 'z';
  const f = alongZ ? frame(s, cx, 0, cz, Math.PI / 2) : s.f;
  const x = alongZ ? 0 : cx;
  const z = alongZ ? 0 : cz;
  const len = alongZ ? d : w;
  const span = alongZ ? w : d;
  let ridge = len;
  let sheet = len + 0.3;
  if (o.hip) {
    const hip = Math.min(o.hip + eave, len / 2 + eave - 0.05);
    s.out.gable(f, x, y, z, len + eave * 2, span + eave * 2, rise, mt, hip);
    ridge = len + eave * 2 - hip * 2;
    sheet = len + eave * 2;
  } else if (o.gable) {
    // The sheet always sits a little proud of the gable so the two never share a plane.
    const e = Math.max(eave, 0.1);
    s.out.gable(f, x, y, z, len, span, (rise * (span / 2)) / (span / 2 + e), o.gable);
    s.out.gable(f, x, y, z, len - 0.1, span + e * 2, rise, mt);
    sheet = len;
  } else {
    s.out.gable(f, x, y, z, len + 0.3, span + eave * 2, rise, mt);
  }
  const paint = o.fascia === undefined ? CREAM : o.fascia;
  const dressed = !o.bare && (o.hip !== undefined || o.gable !== undefined);
  // The roof prism has no underside, so line the eaves: otherwise you see sky looking up from the lawn.
  if (eave >= 0.25 && dressed && s.spare()) {
    s.out.box(f, x, y - 0.03, z, o.hip ? len + eave * 2 : len - 0.1, 0.06, span + eave * 2, trim(s, FRAME));
  }
  if (o.bare || !s.spare(3)) return;
  // Ridge capping.
  if (ridge > 0.6) s.out.box(f, x, y + rise + 0.01, z, ridge + 0.1, 0.09, 0.3, mt);
  if (!dressed || paint === null) return;
  // Fascia board with the gutter on it, along both eaves.
  const gutter = trim(s, paint);
  const ez = span / 2 + Math.max(eave, o.hip ? 0 : 0.1);
  for (const side of [-1, 1]) s.out.box(f, x, y + 0.02, z + side * (ez + 0.035), sheet - (o.hip ? 0 : 0.1), 0.17, 0.09, gutter);
  if (o.hip) {
    if (s.spare(2)) for (const side of [-1, 1]) s.out.box(f, x + side * (sheet / 2 + 0.035), y + 0.02, z, 0.09, 0.17, span + eave * 2, gutter);
  } else if (o.gable && s.spare(4)) {
    // Bargeboards up each gable.
    const e = Math.max(eave, 0.1);
    const half = span / 2 + e;
    const run = Math.hypot(half, rise) + 0.06;
    const a = Math.atan2(rise, half);
    for (const end of alongZ ? [-1] : [-1, 1]) {
      // The gable ends face ±x in the roof's frame (−x is the street when the ridge runs back from it); a
      // street-facing roof only dresses the street end.
      const ex = x + end * (sheet / 2 + 0.02);
      for (const side of [-1, 1]) {
        const m = new THREE.Matrix4().makeRotationFromEuler(EULER.set(side * a, 0, 0, 'YXZ')).setPosition(ex, y + rise / 2 - 0.06, z + (side * half) / 2).premultiply(f);
        s.out.box(m, 0, 0, 0, 0.05, 0.2, run, gutter);
      }
    }
  }
}

/** Triangular pediment seen from the street: base `w` wide at height `y`, `t` thick. */
export function pediment(s: Site, cx: number, y: number, z: number, w: number, rise: number, t: number, mt: Mat) {
  s.out.gable(frame(s, cx, 0, z, Math.PI / 2), 0, y, 0, t, w, rise, mt);
}

/** Pair of bargeboards up a street-facing gable. */
export function bargeboards(s: Site, cx: number, y: number, z: number, span: number, rise: number, mt: Mat, depth = 0.2) {
  const half = span / 2;
  const len = Math.hypot(half, rise) + 0.1;
  const a = Math.atan2(rise, half);
  s.out.box(frame(s, cx - half / 2, y + rise / 2, z, 0, 0, a), 0, 0, 0, len, depth, 0.06, mt);
  s.out.box(frame(s, cx + half / 2, y + rise / 2, z, 0, 0, -a), 0, 0, 0, len, depth, 0.06, mt);
}

/** Roof deck on a parapet building (seen from the hills and upper floors). */
export function flatRoof(s: Site, cx: number, cz: number, w: number, d: number, y: number, color = 0x6f6d68) {
  box(s, cx, y, cz, Math.max(0.5, w - 0.7), 0.07, Math.max(0.5, d - 0.7), mat(s, 'concrete', color));
  if (s.near) rooftop(s, cx, cz, w - 1.6, d - 1.6, y + 0.07);
}

/** Low parapet wall round the edge of a flat roof (four thin boxes) with a capping line. */
export function upstand(s: Site, cx: number, cz: number, w: number, d: number, y: number, h: number, mt: Mat) {
  const t = 0.3;
  box(s, cx, y, cz + d / 2 - t / 2, w, h, t, mt);
  box(s, cx, y, cz - d / 2 + t / 2, w, h, t, mt);
  for (const side of [-1, 1]) box(s, cx + side * (w / 2 - t / 2), y, cz, t, h, d - t * 2, mt);
}

export function chimney(s: Site, x: number, z: number, y: number, h: number, mt: Mat, pot = false) {
  box(s, x, y, z, 0.62, h, 0.62, mt);
  if (!s.spare(3)) return;
  // Corbelled cap, then a pot or two.
  box(s, x, y + h - 0.16, z, 0.74, 0.1, 0.74, mt);
  box(s, x, y + h, z, 0.68, 0.07, 0.68, mat(s, 'concrete', 0x9a968c));
  if (pot) cyl(s, x, y + h + 0.07, z, 0.11, 0.4, trim(s, 0xa5502f), 6, 0.09);
  // The aerial goes on the chimney, strapped to the side away from the weather.
  if (s.fx.chance(0.5) && !s.aerials) {
    s.aerials = 1;
    aerial(s, x + 0.36, y + h - 0.9, z + 0.1, s.fx.range(2.2, 3.1), s.fx.range(0, 3));
  }
}

/**
 * Television aerial on a mast whose foot is at (x, y, z); the boom points along `yaw`. Four cut-out panes
 * (boom and elements, each seen from both sides), so it reads as an aerial from anywhere for eight triangles.
 */
export function aerial(s: Site, x: number, y: number, z: number, h = 2.2, yaw = 0, color = 0xb4b8ba) {
  for (let i = 0; i < 4; i++) pane(s, 'aerial', x, y + h / 2, z, i % 2 ? 1.1 : 1.5, h, yaw + (i * Math.PI) / 2, { color, variant: i % 2 });
}

/** What ends up on a flat commercial roof (deck at `y`, centred on cx, cz): vent pipes, a skylight, a tank, a condenser, an aerial. */
export function rooftop(s: Site, cx: number, cz: number, w: number, d: number, y: number) {
  if (w < 4 || d < 5) return;
  const r = s.fx;
  const at = (): [number, number] => [cx + r.range(-0.36, 0.36) * w, cz + r.range(-0.3, 0.36) * d];
  // Soil and vent pipes: grey stacks with a cowl.
  const pipes = r.int(1, 3);
  for (let i = 0; i < pipes && s.spare(1); i++) {
    const [px, pz] = at();
    const h = r.range(0.9, 1.9);
    box(s, px, y, pz, 0.11, h, 0.11, trim(s, r.pick([0x6f6d68, 0x8a8d90, 0x4a4d50])));
    if (s.spare(1)) box(s, px, y + h, pz, 0.24, 0.07, 0.24, trim(s, 0x4a4d50));
  }
  // A skylight over the back shop: a kerb with a pitched pane of wired glass.
  if (r.chance(0.45) && s.spare(3)) {
    const [px, pz] = at();
    const sw = r.range(1.2, 2.2);
    box(s, px, y, pz, sw + 0.16, 0.3, 1.36, trim(s, 0x8f8b82));
    pane(s, 'steel', px, y + 0.42, pz, sw, 1.24, 0, { color: 0x5a5d60, lit: 1, variant: 1, pitch: -1.33 });
  }
  // A header tank on bearers, or a condenser with its louvres.
  if (r.chance(0.3) && s.spare(5)) {
    const [px, pz] = at();
    box(s, px, y, pz, 1.5, 0.35, 0.2, trim(s, 0x5a4634));
    cyl(s, px, y + 0.35, pz, 0.72, 1.2, mat(s, 'corrugated', 0xa9a79d), 9);
  } else if (r.chance(0.4) && s.spare(2)) {
    const [px, pz] = at();
    const yaw = r.pick([0, Math.PI / 2, Math.PI]);
    s.out.box(frame(s, px, y, pz, yaw), 0, 0.42, 0, 1.1, 0.74, 0.6, trim(s, 0xbfc2c0));
    pane(s, 'louvre', px + Math.sin(yaw) * 0.305, y + 0.44, pz + Math.cos(yaw) * 0.305, 0.9, 0.56, yaw, { color: 0x8a8d90 });
  }
  if (r.chance(0.4) && s.spare(1)) {
    const [px, pz] = at();
    aerial(s, px, y, pz, r.range(2.6, 3.6), r.range(0, 3));
  }
}

/** Round downpipe on a wall facing `yaw`, from `y0` up to `y1`, with a rainhead at the top. */
export function downpipe(s: Site, x: number, z: number, y0: number, y1: number, yaw = 0, color = 0x6f6d68) {
  const ox = Math.sin(yaw) * 0.07;
  const oz = Math.cos(yaw) * 0.07;
  const m = trim(s, color);
  box(s, x + ox, y0, z + oz, 0.085, y1 - y0, 0.085, m);
  if (s.spare()) box(s, x + ox * 1.4, y1 - 0.25, z + oz * 1.4, 0.24, 0.25, 0.18, m);
}

/** A slender pole (flagpole, aerial, vent) standing on `y`. */
export function pole(s: Site, x: number, y: number, z: number, h: number, color = 0xe8e6df, r = 0.05) {
  cyl(s, x, y, z, r, h, trim(s, color), 5);
}

/** Flagpole with a flag flying from it. */
export function flagpole(s: Site, x: number, y: number, z: number, h: number, flag?: number) {
  pole(s, x, y, z, h);
  if (flag !== undefined && s.spare()) box(s, x + 0.62, y + h - 0.85, z, 1.15, 0.7, 0.02, trim(s, flag));
}

// ───────────────────────────── Openings ─────────────────────────────

export interface WinOptions {
  /** Chance-like figure 0..1 that the room lights up at night (0.45 = an ordinary house window). */
  lit?: number;
  /** Give it a surround (facings and sill, or sill and hood). */
  framed?: boolean;
  /** Override the building's joinery. */
  style?: Joinery['style'];
  variant?: number;
  /** Stone hood mould over the head (masonry walls). */
  hood?: boolean;
}

/**
 * A window on a wall facing `yaw` (0 front, π back, ±π/2 sides); (x, y, z) is its centre on the wall plane.
 * The glass, frame, curtains and night lighting are drawn by the pane; what is built here is what gives
 * it depth: timber facings and a sill standing proud of weatherboards, or a stone sill (and hood) under a
 * window set back into masonry.
 */
export function win(s: Site, x: number, y: number, z: number, w: number, h: number, yaw = 0, lit: number | WinOptions = 0.45, framed = true) {
  const o: WinOptions = typeof lit === 'number' ? { lit, framed } : { framed, ...lit };
  const j = s.j;
  const sx = Math.sin(yaw);
  const cz = Math.cos(yaw);
  const style = o.style ?? j.style;
  const level = Math.max(0, Math.min(3, Math.round((o.lit ?? 0.45) / 0.22)));
  const surround = (o.framed ?? true) && s.spare(2);
  const paneStyle: PaneStyle = style === 'sash' ? 'sash' : 'casement';
  const variant = style === 'alu' ? 2 + ((o.variant ?? (w > 1.9 ? 1 : 0)) & 1) : style === 'sash' ? (o.variant ?? j.variant) & 1 : w > 1.75 ? 1 : 0;
  let proud = 0.02;
  let reveal = 0;
  if (j.wall === 'timber') {
    proud = surround ? 0.056 : 0.02;
    if (surround) {
      // Facing boards as one flat panel 47 mm proud of the weatherboards, and a sill under it.
      const facing = trim(s, j.trim);
      s.out.quad(s.f, x + sx * 0.047, y, z + cz * 0.047, w + 0.2, h + 0.18, facing, yaw);
      ledge(s, x + sx * 0.06, y - h / 2 - 0.1, z + cz * 0.06, w + 0.32, 0.05, 0.13, yaw, facing);
      // A sun hood on brackets over a window that faces north (-z in the world), where the summer sun gets in.
      if (o.hood && Math.cos(s.lot.heading + yaw) < -0.45 && s.spare(3)) {
        const top = y + h / 2 + 0.1;
        slope(s, x + sx * 0.02, top + 0.26, z + cz * 0.02, x + sx * 0.5, top + 0.06, z + cz * 0.5, w + 0.36, 0.04, mat(s, 'corrugated', 0x8f959a));
        for (const e of [-1, 1]) {
          const bx = x + e * cz * (w / 2 + 0.08);
          const bz = z - e * sx * (w / 2 + 0.08);
          slope(s, bx + sx * 0.03, top - 0.22, bz + cz * 0.03, bx + sx * 0.42, top + 0.06, bz + cz * 0.42, 0.045, 0.045, facing);
        }
      }
    }
  } else if (j.wall !== 'plain') {
    reveal = j.wall === 'masonry' ? 1 : j.wall === 'stone' ? 2 : 3;
    if (surround && j.wall !== 'concrete') {
      const dress = j.sill ?? mat(s, 'concrete', 0xcfcabd);
      ledge(s, x + sx * 0.06, y - h / 2 - 0.09, z + cz * 0.06, w + 0.26, 0.1, 0.16, yaw, dress);
      if (o.hood && s.spare()) ledge(s, x + sx * 0.05, y + h / 2 + 0.11, z + cz * 0.05, w + 0.34, 0.16, 0.14, yaw, dress);
    }
  }
  pane(s, paneStyle, x + sx * proud, y, z + cz * proud, w, h, yaw, { color: j.frame, lit: level, variant, wall: reveal });
}

/** `n` windows evenly spaced along a wall from (ax, az) to (bx, bz). */
export function winRow(s: Site, ax: number, az: number, bx: number, bz: number, y: number, n: number, w: number, h: number, yaw = 0, lit: number | WinOptions = 0.45, framed = true) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    win(s, ax + (bx - ax) * t, y, az + (bz - az) * t, w, h, yaw, lit, framed);
  }
}

/**
 * Panelled door standing on `y`, on a wall facing `yaw`, in its architrave. `kind`: 0 four panels,
 * 1 half glazed, 2 with a fanlight over (the opening is 0.42 m taller), 3 a double door.
 */
export function door(s: Site, x: number, y: number, z: number, color: number, yaw = 0, w = 0.92, h = 2.1, kind?: number) {
  const k = kind ?? (hashInts(s.lot.seed, Math.round(x * 4), Math.round(z * 4)) % 5 < 2 ? 1 : 0);
  const sx = Math.sin(yaw);
  const cz = Math.cos(yaw);
  const full = h + 0.07 + (k === 2 ? 0.42 : 0);
  pane(s, 'door', x + sx * 0.03, y + full / 2, z + cz * 0.03, w + 0.14, full, yaw, { color, variant: k, lit: 2 });
}

/**
 * Big roller door (or, with `timber`, a ledged sliding door); `open` rolls it part or all of the way up
 * on a dim interior.
 */
export function bigDoor(s: Site, x: number, y: number, z: number, w: number, h: number, color: number, open = false, yaw = 0, timber = false) {
  const sx = Math.sin(yaw);
  const cz = Math.cos(yaw);
  const side = Math.abs(sx) > 0.5;
  // Steel surround standing a little proud of the cladding.
  if (s.spare()) s.out.box(s.f, x + sx * 0.02, y + h / 2 + 0.06, z + cz * 0.02, side ? 0.08 : w + 0.24, h + 0.12, side ? w + 0.24 : 0.08, trim(s, 0x3c4044));
  const up = open ? 1 + (hashInts(s.lot.seed, Math.round(x * 4), Math.round(z * 4)) & 1) : 0;
  pane(s, 'roller', x + sx * 0.065, y + h / 2, z + cz * 0.065, w, h, yaw, { color, variant: timber ? 3 : up, lit: 1 });
}

// ───────────────────────────── Street-front parts ─────────────────────────────

export type ParapetKind = 'flat' | 'stepped' | 'pediment' | 'ornate';

/**
 * Parapet along the top of a front wall whose face is at `z`. Returns the height of its centre panel
 * above `y` (where a name board can go).
 */
export function parapet(s: Site, x0: number, x1: number, y: number, z: number, kind: ParapetKind, wall: Mat, dress: Mat, h = 1): number {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const zc = z - 0.19;
  // Nothing shelters a parapet: the dirt on it starts at its own top.
  wall = under(s, wall, y + (kind === 'ornate' ? 1.2 : kind === 'stepped' ? h * 1.4 : kind === 'pediment' ? h * 0.7 : h));
  if (kind === 'ornate') {
    // Open balustrade between piers, a pediment over the middle, urns on the ends.
    box(s, cx, y, zc, w, 0.3, 0.4, dress);
    box(s, cx, y + 0.82, zc, w, 0.18, 0.42, dress);
    const piers = Math.max(3, Math.min(5, Math.round(w / 3.2)));
    for (let i = 0; i < piers; i++) {
      const px = x0 + 0.3 + ((w - 0.6) * i) / (piers - 1);
      if (Math.abs(px - cx) < w * 0.16) continue;
      box(s, px, y + 0.3, zc, 0.5, 0.52, 0.42, dress);
    }
    box(s, cx, y + 0.3, zc, w * 0.34, 0.9, 0.44, wall);
    pediment(s, cx, y + 1.2, zc, w * 0.38, Math.min(1.3, w * 0.1), 0.48, dress);
    if (s.spare(2)) {
      // Stone balusters either side of the centre panel.
      const bw = (w - w * 0.34) / 2 - 0.5;
      if (bw > 0.8) for (const side of [-1, 1]) pane(s, 'picket', cx + side * (w * 0.17 + bw / 2 + 0.1), y + 0.56, z - 0.02, bw, 0.52, 0, { color: 0xd8d0bc, variant: 0 });
    }
    if (s.spare(2)) {
      for (const px of [x0 + 0.3, x1 - 0.3]) cyl(s, px, y + 1.0, zc, 0.1, 0.5, dress, 6, 0.22);
    }
    return 0.75;
  }
  if (kind === 'stepped') {
    box(s, cx, y, zc, w, h * 0.65, 0.4, wall);
    box(s, cx, y + h * 0.65, zc, w * 0.52, h * 0.75, 0.4, wall);
    if (s.spare(3)) {
      box(s, cx, y + h * 1.4, zc, w * 0.52 + 0.16, 0.1, 0.5, dress);
      for (const side of [-1, 1]) box(s, cx + side * w * 0.38, y + h * 0.65, zc, w * 0.24 + 0.08, 0.08, 0.48, dress);
    }
    return h * 0.9;
  }
  if (kind === 'pediment') {
    box(s, cx, y, zc, w, h * 0.7, 0.4, wall);
    pediment(s, cx, y + h * 0.7, zc, w * 0.5, h * 0.95, 0.44, dress);
    if (s.spare()) box(s, cx, y + h * 0.7 - 0.1, zc, w + 0.16, 0.1, 0.5, dress);
    return h * 0.38;
  }
  box(s, cx, y, zc, w, h, 0.4, wall);
  if (s.spare()) box(s, cx, y + h, zc, w + 0.14, 0.1, 0.5, dress);
  return h * 0.5;
}

/** Projecting cornice in two steps along a front wall whose face is at `z`; its top is at `y`. */
export function cornice(s: Site, x0: number, x1: number, y: number, z: number, dress: Mat, depth = 0.3) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  box(s, cx, y - 0.2, z + depth / 2, w + depth, 0.2, depth, dress);
  if (s.spare()) box(s, cx, y - 0.42, z + depth * 0.3, w + depth * 0.5, 0.22, depth * 0.6, dress);
}

export interface VerandahOptions {
  x0: number;
  x1: number;
  /** Wall plane it hangs off, and how far it reaches forward. */
  z: number;
  depth: number;
  /** Underside height at the street edge. */
  y: number;
  /** 'hung' = flat cantilevered awning on tie rods; 'posts' = sloping iron on posts; 'bullnose' = curved-edge iron on posts. */
  kind: 'hung' | 'posts' | 'bullnose';
  roof: Mat;
  fascia: Mat;
  posts?: number;
  post?: Mat;
  /** Paint for brackets and frieze on a post verandah (omit for none). */
  lace?: number;
  /** Where the tie rods of a hung verandah go (x positions); default a fifth of the way in from each end. */
  rods?: readonly number[];
}

/** Footpath verandah. Returns the z of its street face (for fascia signs). */
export function verandah(s: Site, o: VerandahOptions): number {
  const w = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const zf = o.z + o.depth;
  if (o.kind === 'hung') {
    // Deck, a lined soffit with tube lights, a deep fascia, tie rods back to the wall.
    box(s, cx, o.y, o.z + o.depth / 2 - 0.03, w - 0.04, 0.16, o.depth - 0.06, o.roof);
    box(s, cx, o.y - 0.26, zf - 0.04, w, 0.46, 0.08, o.fascia);
    if (s.spare(2)) {
      box(s, cx, o.y - 0.05, o.z + o.depth / 2 - 0.05, w - 0.1, 0.05, o.depth - 0.14, trim(s, 0xe4dfd0));
      const tubes = Math.max(1, Math.min(4, Math.round(w / 5)));
      for (let i = 0; i < tubes; i++) glow(s, o.x0 + (w * (i + 0.5)) / tubes, o.y - 0.06, o.z + o.depth * 0.5, 1.25, 0.14, WARM_LIGHT, 2, 0, true);
    }
    if (s.spare(2)) {
      for (const rx of o.rods ?? [o.x0 + w * 0.2, o.x1 - w * 0.2]) slope(s, rx, o.y + 1.7, o.z + 0.05, rx, o.y + 0.15, o.z + o.depth * 0.72, 0.05, 0.05, trim(s, 0x2a2c2e));
    }
    return zf;
  }
  const lip = o.kind === 'bullnose' ? 0.55 : 0;
  slope(s, cx, o.y + 0.62, o.z, cx, o.y + 0.2, zf - lip, w, 0.07, o.roof);
  if (lip) slope(s, cx, o.y + 0.2, zf - lip, cx, o.y - 0.12, zf, w, 0.07, o.roof);
  box(s, cx, o.y - 0.14, zf - 0.14, w, 0.3, 0.1, o.fascia);
  const n = o.posts ?? 0;
  const post = o.post ?? o.fascia;
  for (let i = 0; i < n; i++) {
    const px = n === 1 ? cx : o.x0 + 0.14 + ((w - 0.28) * i) / (n - 1);
    const base = Math.min(0, ground(s, px, zf - 0.14)) - 0.3;
    box(s, px, base, zf - 0.14, 0.11, o.y - 0.14 - base, 0.11, post);
    if (s.spare()) box(s, px, base, zf - 0.14, 0.2, 0.45 - base, 0.2, post);
    if (o.lace !== undefined && s.spare()) {
      // A pair of fretwork brackets under the beam.
      if (i > 0) screen(s, 'fret', px - 0.3, o.y - 0.4, zf - 0.14, 0.5, 0.5, 0, o.lace, 2, 1);
      if (i < n - 1) screen(s, 'fret', px + 0.3, o.y - 0.4, zf - 0.14, 0.5, 0.5, 0, o.lace, 1, 2);
    }
  }
  return zf - 0.09;
}

export interface ShopfrontOptions {
  x0: number;
  x1: number;
  /** Wall plane. */
  z: number;
  /** Floor level and glazing head height above it. */
  y?: number;
  head?: number;
  /** Door position: -1 left, 0 centre, 1 right, null for none. */
  door: -1 | 0 | 1 | null;
  riser?: Mat;
  doorColor?: number;
  /** Display windows glow at night. */
  lit?: boolean;
  /** Joinery paint; omit for aluminium. */
  paint?: number;
  /** The door stands at the back of a tiled recess between splayed windows (older shops). */
  recessed?: boolean;
  /** Leadlight toplights above a transom. */
  toplights?: boolean;
  /** What is in the window: 0 general goods, 1 drapery, 2 paper (cards, books, notices), 3 food. */
  display?: number;
}

/** Glazed shopfront: stall riser, display windows either side of a door. */
export function shopfront(s: Site, o: ShopfrontOptions) {
  const y = o.y ?? 0;
  const head = o.head ?? 2.6;
  const sill = 0.5;
  const x0 = o.x0 + 0.25;
  const x1 = o.x1 - 0.25;
  const cx = (x0 + x1) / 2;
  const span = x1 - x0;
  const modern = o.paint === undefined;
  const color = o.paint ?? ALUMINIUM;
  const dw = Math.min(o.recessed ? 1.5 : 1.05, Math.max(0.9, span - 1.6));
  const dx = o.door === null || span < dw + 0.4 ? null : o.door === 0 ? cx : o.door < 0 ? x0 + dw / 2 + 0.06 : x1 - dw / 2 - 0.06;
  const level = o.lit === false ? 1 : 3;
  if (o.riser && s.spare()) {
    box(s, cx, y - 0.3, o.z + 0.03, span, sill + 0.3, 0.1, o.riser);
    if (s.spare()) box(s, cx, y + sill - 0.02, o.z + 0.06, span + 0.04, 0.05, 0.18, trim(s, shade(color, 0.9)));
  }
  // The glass stands in a frame with some depth to it: a post each side and a head rail over the top, so
  // the window has a reveal and throws a shadow instead of lying flat on the wall.
  if (s.spare(3)) {
    const fm = trim(s, modern ? 0x8a8d90 : shade(color, 0.82));
    const jw = modern ? 0.07 : 0.13;
    const out = modern ? 0.13 : 0.17;
    for (const jx of [x0 - jw / 2 + 0.01, x1 + jw / 2 - 0.01]) box(s, jx, y - 0.3, o.z + out / 2, jw, head + 0.3, out, fm);
    box(s, cx, y + head, o.z + out / 2 + 0.02, span + jw * 2, modern ? 0.1 : 0.17, out + 0.04, fm);
  }
  const spans: [number, number][] = dx === null ? [[x0, x1]] : [[x0, dx - dw / 2 - 0.04], [dx + dw / 2 + 0.04, x1]];
  for (const [a, b] of spans) {
    if (b - a < 0.6) continue;
    pane(s, 'shop', (a + b) / 2, y + (sill + head) / 2 + 0.01, o.z + 0.09, b - a, head - sill - 0.02, 0, { color, lit: level, variant: (modern ? 1 : 0) + (o.toplights ? 2 : 0), wall: o.display });
  }
  if (dx !== null) {
    pane(s, 'shopdoor', dx, y + head / 2, o.z + 0.08, dw, head, 0, { color: o.doorColor ?? color, lit: level, variant: modern ? (o.recessed ? 3 : 2) : o.recessed ? 1 : 0 });
  }
}

// ───────────────────────────── Wall dressing ─────────────────────────────

/** Odd sheets on a corrugated wall: replaced panels a shade off, a few gone rusty. `yaw` is the way the wall faces. */
export function patches(s: Site, x0: number, x1: number, z: number, y0: number, y1: number, color: number, count: number, yaw = 0) {
  if (!s.spare(count)) return;
  const along = Math.abs(Math.sin(yaw)) > 0.5;
  for (let i = 0; i < count; i++) {
    const t = s.fx.range(0.06, 0.94);
    const h = Math.min(y1 - y0, s.fx.pick([2.4, 2.4, 3, 1.8]));
    const y = s.fx.chance(0.6) ? y0 + h / 2 : y1 - h / 2;
    const rusty = s.fx.chance(0.3);
    const tone = rusty ? 0x8a5a3a : shade(color, s.fx.pick([0.86, 0.93, 1.08]));
    const p = x0 + (x1 - x0) * t;
    // A sheet that has gone rusty all over, or a newer one that has not had time to weather.
    const sheet = mat(rusty ? s : { ...s, wear: { ...s.wear, fresh: true } }, 'corrugated', tone);
    quad(s, along ? z + Math.sin(yaw) * 0.012 : p, y, along ? p : z + Math.cos(yaw) * 0.012, 0.76 * s.fx.int(1, 2), h, sheet, yaw, true);
  }
}

// ───────────────────────────── Props, fences, lights ─────────────────────────────

/** Instanced prop standing on the terrain at a local point. */
export function prop(s: Site, kind: string, lx: number, lz: number, yaw = 0, scale = 1, tint?: number) {
  const x = worldX(s, lx, lz);
  const z = worldZ(s, lx, lz);
  s.out.instance(kind, x, s.out.world.heightAt(x, z), z, s.lot.heading + yaw, scale, tint);
}

/** Instanced prop at an explicit local height (on a dock, a deck, a roof). */
export function propAt(s: Site, kind: string, lx: number, ly: number, lz: number, yaw = 0, scale = 1, tint?: number) {
  s.out.instance(kind, worldX(s, lx, lz), s.lot.y + s.y0 + ly, worldZ(s, lx, lz), s.lot.heading + yaw, scale, tint);
}

/** Panel props (fence, hedge; authored along their local x, `unit` metres long) repeated along a run, stretched to fit unless `scale` is fixed. */
export function run(s: Site, kind: string, ax: number, az: number, bx: number, bz: number, unit: number, tint?: number, scale?: number) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < unit * 0.6) return;
  const n = Math.max(1, Math.round(len / unit));
  const yaw = Math.atan2(-(bz - az), bx - ax);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    prop(s, kind, ax + (bx - ax) * t, az + (bz - az) * t, yaw, scale ?? len / (n * unit), tint);
  }
}

/** Solid wall or fence following the ground between two points; steps down a slope in panels. `lift` floats a rail. */
export function fence(s: Site, ax: number, az: number, bx: number, bz: number, h: number, t: number, mt: Mat, lift = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.4) return;
  const fall = Math.abs(ground(s, ax, az) - ground(s, bx, bz));
  const n = Math.max(1, Math.min(4, Math.ceil(fall / 0.45)));
  const yaw = Math.atan2(-(bz - az), bx - ax);
  const sink = lift ? 0 : 0.35;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const mx = ax + (bx - ax) * u;
    const mz = az + (bz - az) * u;
    s.out.box(frame(s, mx, ground(s, mx, mz) + lift - sink, mz, yaw), 0, (h + sink) / 2, 0, len / n, h + sink, t, mt);
  }
}

/** Cut gaps (gates, driveways) out of a run a..b; returns the remaining stretches. */
export function stretches(a: number, b: number, gaps: [number, number][]): [number, number][] {
  const sorted = gaps.filter((g) => g[1] > a && g[0] < b).sort((p, r) => p[0] - r[0]);
  const result: [number, number][] = [];
  let at = a;
  for (const [g0, g1] of sorted) {
    if (g0 - at > 0.5) result.push([at, g0]);
    at = Math.max(at, g1);
  }
  if (b - at > 0.5) result.push([at, b]);
  return result;
}

/** Budgeted night light at a local point (shopfronts only). */
export function lamp(s: Site, lx: number, ly: number, lz: number, color = 0xffe2b0, intensity = 110, range = 11) {
  s.out.light(worldX(s, lx, lz), s.lot.y + s.y0 + ly, worldZ(s, lx, lz), color, intensity, range);
}

/** Free-standing pole sign: a board on one or two legs, readable from both directions along the street. */
export function poleSign(s: Site, x: number, z: number, h: number, w: number, bh: number, board: Mat, yaw = 0) {
  const base = ground(s, x, z) - 0.3;
  const leg = trim(s, 0x4a4d50);
  box(s, x, base, z, 0.16, h - base, 0.16, leg);
  const fr = frame(s, x, 0, z, yaw);
  s.out.box(fr, 0, h + bh / 2, 0, w + 0.1, bh + 0.1, 0.12, leg);
  s.out.quad(fr, 0, h + bh / 2, 0.07, w, bh, board);
  s.out.quad(fr, 0, h + bh / 2, -0.07, w, bh, board, Math.PI);
}
