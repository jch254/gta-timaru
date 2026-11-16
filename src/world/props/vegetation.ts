import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import { Rng as CoreRng, noise2 } from '../../core/rng';
import { registerTexturePreload } from '../../render/phototextures';
import { farLeafMaterial, foliageCell, foliageWind, hasFoliageCell, leafMaterial, loadFoliage, plantField, woodMaterial, type FoliageCell, type PlantModel, type PlantShape } from './foliage';
import type { PropDef, PropFactory } from './index';

export { foliageWind };

/**
 * Trees and plants. Every kind is a `PropDef` (base at y = 0, scale 1) and, behind it, a `PlantModel`
 * (./foliage.ts): two or three shapes of the plant, picked per instance, and a cheap stand-in for distance.
 * A shape is at most two parts:
 *
 *  - wood: trunk and limbs as tapered tubes that actually branch, in the photographic `bark` surface;
 *  - leaves: flat cards carrying pictures from the foliage atlas, set in clumps on the limb ends. Cards are
 *    alpha-tested (no blending, nothing to sort) and cast alpha-tested shadows.
 *
 * Three things keep the cards from reading as flat planes. Their normals are bent away from the middle of
 * the crown, so a tree shades like one rounded mass rather than a heap of facets. Every card is indexed
 * twice, once per winding, in a single-sided material: both faces draw, but the back face keeps the same
 * bent normal instead of the flipped one a double-sided material would give it (which would light half the
 * cards on the sunny side as if they faced away); one of each pair is always culled, so the doubling costs
 * index entries, not fill. And each card knows its own stem and width axis, so the leaf material can swing
 * it round to face the camera when it would otherwise be seen edge on.
 *
 * Vertex colours carry the species tint, a little card-to-card variation and a darkening towards the
 * inside of the crown; the per-instance tint from `ChunkBuilder.instance` multiplies on top.
 *
 * The stand-in is one part in the stand-in leaf material: a dozen big cards and a plain trunk (a tube that
 * samples the atlas's blank `solid` cell, coloured by its vertices), a twentieth of the triangles.
 *
 * Shapes are grown from fixed seeds, so shape 2 of an oak is always the same oak; which shape a tree is,
 * and how it is sized, leant and toned, comes from where it stands (`plantVariation`).
 */

type V3 = [number, number, number];

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const UP: V3 = [0, 1, 0];
/** Unit vector at `az` round the y axis, raised `el` above the horizontal. */
const polar = (az: number, el = 0): V3 => [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface Rng {
  (): number;
  range(lo: number, hi: number): number;
  unit(): V3;
}

function rng(seed: number): Rng {
  const r = new CoreRng(seed);
  const next = () => r.next();
  const unit = (): V3 => {
    const y = r.range(-1, 1);
    const az = r.range(0, Math.PI * 2);
    const rad = Math.sqrt(1 - y * y);
    return [Math.cos(az) * rad, y, Math.sin(az) * rad];
  };
  return Object.assign(next, { range: (lo: number, hi: number) => r.range(lo, hi), unit });
}

// ───────────────────────────── Wood ─────────────────────────────

/** Trunks start a little below y = 0, so on a slope the downhill side still meets the ground. */
const SUNK = -0.35;

/** Metres one repeat of the bark texture covers (see the texture manifest). */
const BARK_TILE = 2.15;

type Path = { p: V3; r: number }[];

/** Rings of a tapered tube through `path`: calls `vertex` for each point round each ring, `quad` for each face. */
function tubeRings(path: Path, sides: number, vertex: (p: V3, outward: V3, round: number, along: number) => void, first: number, index: number[]) {
  let ref: V3 = Math.abs(path[1].p[1] - path[0].p[1]) > 0.9 * len(sub(path[1].p, path[0].p)) ? [1, 0, 0] : UP;
  let v = 0;
  for (let i = 0; i < path.length; i++) {
    const tangent = norm(sub(path[Math.min(path.length - 1, i + 1)].p, path[Math.max(0, i - 1)].p));
    ref = norm(sub(ref, mul(tangent, dot(ref, tangent))));
    const bin = cross(tangent, ref);
    if (i > 0) v += len(sub(path[i].p, path[i - 1].p));
    const base = first + i * (sides + 1);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const d = add(mul(ref, Math.cos(a)), bin, Math.sin(a));
      vertex(add(path[i].p, d, path[i].r), d, k / sides, v);
    }
    if (i === 0) continue;
    const below = base - (sides + 1);
    for (let k = 0; k < sides; k++) index.push(below + k, below + k + 1, base + k + 1, below + k, base + k + 1, base + k);
  }
}

class Wood {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  /** A tapered tube through `path` (centre and radius at each point), `sides` round. Open at both ends. */
  tube(path: Path, sides: number) {
    const repeats = Math.max(1, Math.round((2 * Math.PI * path[0].r) / BARK_TILE));
    tubeRings(
      path,
      sides,
      (p, d, round, along) => {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(d[0], d[1], d[2]);
        this.uv.push(round * repeats * BARK_TILE, along);
      },
      this.pos.length / 3,
      this.idx,
    );
  }

  get triangles() {
    return this.idx.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// ───────────────────────────── Leaf cards ─────────────────────────────

type Tint = [number, number, number];

/** sRGB hex to the linear colour vertex colours are written in. */
function lin(hex: number): Tint {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

interface CardOptions {
  stretch?: number;
  shade?: number;
  mirror?: boolean;
  /** Whether the card may swing round its stem to face the camera (default: the builder's `turn`). */
  turn?: boolean;
}

class Leaves {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private leaf: number[] = [];
  private axis: number[] = [];
  private stem: number[] = [];
  /** How far normals lean away from `centre` (0 = the card's own flat normal, 1 = fully radial). */
  bend = 0.8;
  /** Brightness at the middle of the crown, rising to 1 at `radius` from `centre`. */
  core = 0.5;
  /** Extra pull of the normals towards straight up (grasses and low plants shade like the ground). */
  upward = 0;
  /** Card-to-card swing between yellower and bluer green (±). */
  hue = 0.04;
  /** Lowest a card may reach. */
  floor = 0.04;
  /** How freely the cards move in the wind (1 = a leafy bough; stiff plants less, hanging shoots more). */
  sway = 1;
  /** Cards swing to face the camera when seen edge on. Off for cards that stand for a surface (a hedge face). */
  turn = true;

  constructor(
    private centre: V3,
    private radius: number,
    private r: Rng,
    /** Species colour, as a multiplier on the atlas (linear). */
    private tint: Tint = [1, 1, 1],
    /** Card-to-card brightness variation (±). */
    private vary = 0.1,
  ) {}

  /** `across` and `offset`: the card's width axis and how far along it this vertex is from the stem (0: never turns). */
  private vertex(p: V3, face: V3, u: number, v: number, tint: Tint, sway: number, across: V3, offset: number, stem: V3) {
    const out = sub(p, this.centre);
    const d = len(out);
    const n = norm(add(add(mul(face, 1 - this.bend), out, this.bend / (d || 1)), UP, this.upward));
    const t = Math.min(1, d / this.radius);
    const rim = t * t * (3 - 2 * t);
    const shade = this.core + (1 - this.core) * rim;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
    this.leaf.push(sway * this.sway, rim);
    this.axis.push(across[0], across[1], across[2], offset);
    this.stem.push(stem[0], stem[1], stem[2]);
  }

  private cardTint(scale = 1): Tint {
    const b = (1 + this.r.range(-this.vary, this.vary)) * scale;
    const hue = this.r.range(-this.hue, this.hue);
    return [this.tint[0] * b * (1 + hue), this.tint[1] * b, this.tint[2] * b * (1 - hue)];
  }

  /** The card's flat normal, turned to face away from the crown centre. */
  private facing(right: V3, up: V3, at: V3): V3 {
    const n = norm(cross(right, up));
    return dot(n, sub(at, this.centre)) < 0 ? mul(n, -1) : n;
  }

  /**
   * One flat card. `at` is where the picture's anchor (its stem end, see `FoliageCell.anchor`) goes;
   * `up` and `right` are the picture's axes in the world; `h` is its height in metres (width follows from
   * the cell's shape times `stretch`).
   */
  card(cell: FoliageCell, at: V3, right: V3, up: V3, h: number, o: CardOptions = {}) {
    right = norm(right);
    up = norm(sub(up, mul(right, dot(up, right))));
    const w = h * cell.aspect * (o.stretch ?? 1);
    // Rectangle in picture space relative to the anchor: x right, y up.
    let x0 = -w / 2;
    let y0 = 0;
    if (cell.anchor === 'top') y0 = -h;
    else if (cell.anchor === 'centre') y0 = -h / 2;
    else if (cell.anchor === 'left') {
      x0 = 0;
      y0 = -h / 2;
    }
    // Nothing goes underground: a card that would is lifted clear.
    const lowest = at[1] + Math.min(x0 * right[1], (x0 + w) * right[1]) + Math.min(y0 * up[1], (y0 + h) * up[1]);
    if (lowest < this.floor) at = [at[0], at[1] + this.floor - lowest, at[2]];
    const corner = (x: number, y: number) => add(add(at, right, x), up, y);
    const face = this.facing(right, up, corner(x0 + w / 2, y0 + h / 2));
    const tint = this.cardTint(o.shade);
    const mirror = o.mirror ?? this.r() < 0.5;
    const ua = mirror ? cell.u1 : cell.u0;
    const ub = mirror ? cell.u0 : cell.u1;
    const base = this.pos.length / 3;
    // Wind moves the far edge of the picture, not the edge it is attached by.
    const [bl, br, tr, tl] = cell.anchor === 'bottom' ? [0, 0, 1, 1] : cell.anchor === 'top' ? [1, 1, 0, 0] : cell.anchor === 'left' ? [0, 1, 1, 0] : [0.3, 0.3, 0.3, 0.3];
    // A frond turns about its midrib, everything else about the line up through its stem.
    const frond = cell.anchor === 'left';
    const turn = (o.turn ?? this.turn) ? 1 : 0;
    const put = (x: number, y: number, u: number, v: number, sway: number) => this.vertex(corner(x, y), face, u, v, tint, sway, frond ? up : right, (frond ? y : x) * turn, frond ? right : up);
    put(x0, y0, ua, cell.v1, bl);
    put(x0 + w, y0, ub, cell.v1, br);
    put(x0 + w, y0 + h, ub, cell.v0, tr);
    put(x0, y0 + h, ua, cell.v0, tl);
    this.quad(base, base + 1, base + 2, base + 3);
  }

  /**
   * A card bent along its length: a ribbon through `spine`, `width` across, flat along `across` at each point.
   * The picture runs along the spine from its anchor edge (left for fronds, top for hanging curtains).
   */
  ribbon(cell: FoliageCell, spine: { p: V3; across: V3; width: number }[], o: { shade?: number; mirror?: boolean } = {}) {
    const tint = this.cardTint(o.shade);
    const mirror = o.mirror ?? this.r() < 0.5;
    const turn = this.turn ? 1 : 0;
    let total = 0;
    for (let i = 1; i < spine.length; i++) total += len(sub(spine[i].p, spine[i - 1].p));
    let run = 0;
    const base = this.pos.length / 3;
    for (let i = 0; i < spine.length; i++) {
      if (i > 0) run += len(sub(spine[i].p, spine[i - 1].p));
      const t = run / total;
      const along = norm(sub(spine[Math.min(spine.length - 1, i + 1)].p, spine[Math.max(0, i - 1)].p));
      const s = spine[i];
      // Square to the spine, whatever was asked for.
      const across = norm(sub(s.across, mul(along, dot(s.across, along))));
      const face = this.facing(across, along, s.p);
      const a = add(s.p, across, -s.width / 2);
      const b = add(s.p, across, s.width / 2);
      const half = (s.width / 2) * turn;
      if (cell.anchor === 'left') {
        // Along u; across is the picture's vertical.
        const u = cell.u0 + (cell.u1 - cell.u0) * t;
        this.vertex(a, face, u, mirror ? cell.v0 : cell.v1, tint, t, across, -half, along);
        this.vertex(b, face, u, mirror ? cell.v1 : cell.v0, tint, t, across, half, along);
      } else {
        // Hanging from the top edge: along v, downwards.
        const v = cell.v0 + (cell.v1 - cell.v0) * t;
        this.vertex(a, face, mirror ? cell.u1 : cell.u0, v, tint, t, across, -half, along);
        this.vertex(b, face, mirror ? cell.u0 : cell.u1, v, tint, t, across, half, along);
      }
      if (i > 0) this.quad(base + i * 2 - 2, base + i * 2 - 1, base + i * 2 + 1, base + i * 2);
    }
  }

  /** Both windings, so the card shows from either side with the same (bent) normals. */
  private quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d, a, c, b, a, d, c);
  }

  /**
   * The foliage on the end of a limb: `count` boughs springing from `at`, where the crown's surface faces
   * `out`. Most lie against that surface like shingles (so from outside they are seen face on, not as
   * streaks); `fins` of them (0..1) stand any way up, which is what gives the crown a leafy outline when
   * the shingles are edge on. Boughs grow towards `lean` (plus a random direction, plus a little outwards).
   */
  clump(cells: FoliageCell[], at: V3, out: V3, count: number, size: [number, number], o: { lean?: V3; fins?: number; flare?: number } = {}) {
    // Each limb's foliage is a shade of its own, so the crown is patchy at the scale of its boughs.
    const shade = 1 + this.r.range(-this.vary, this.vary) * 0.8;
    for (let k = 0; k < count; k++) {
      const fin = this.r() < (o.fins ?? 0.3);
      const n = norm(add(out, this.r.unit(), fin ? 2.2 : this.r.range(0.25, 0.75)));
      const grow = add(add(this.r.unit(), o.lean ?? UP, 0.7), out, o.flare ?? 0.35);
      const up = norm(sub(grow, mul(n, dot(grow, n))));
      const right = cross(up, n);
      const h = this.r.range(size[0], size[1]);
      this.card(cells[k % cells.length], add(at, up, -h * 0.1), right, up, h, { shade });
    }
  }

  // Plain surfaces in the same material: trunks of the distant stand-ins, the heart of a hedge. They sample
  // the middle of the atlas's blank cell, so their colour is exactly the vertex colour given.

  private plain(p: V3, n: V3, color: Tint) {
    const blank = foliageCell('solid');
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push((blank.u0 + blank.u1) / 2, (blank.v0 + blank.v1) / 2);
    this.col.push(color[0], color[1], color[2]);
    this.leaf.push(0, 0.15);
    this.axis.push(1, 0, 0, 0);
    this.stem.push(0, 1, 0);
  }

  /** A tapered tube of one flat colour (linear RGB). */
  solidTube(path: Path, sides: number, color: Tint) {
    tubeRings(path, sides, (p, d) => this.plain(p, d, color), this.pos.length / 3, this.idx);
  }

  /** A box of one flat colour standing on y = `y0`, without its underside. */
  solidBox(cx: number, cz: number, w: number, y0: number, h: number, d: number, color: Tint) {
    const faces: [V3, V3, V3][] = [
      [[0, 0, 1], [1, 0, 0], UP],
      [[0, 0, -1], [-1, 0, 0], UP],
      [[1, 0, 0], [0, 0, -1], UP],
      [[-1, 0, 0], [0, 0, 1], UP],
      [UP, [1, 0, 0], [0, 0, -1]],
    ];
    const half: V3 = [w / 2, h / 2, d / 2];
    const mid: V3 = [cx, y0 + h / 2, cz];
    for (const [n, right, up] of faces) {
      const base = this.pos.length / 3;
      const o = add(mid, [n[0] * half[0], n[1] * half[1], n[2] * half[2]]);
      const rx = Math.abs(dot(right, half));
      const ux = Math.abs(dot(up, half));
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.plain(add(add(o, right, sx * rx), up, sy * ux), n, color);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leaf, 2));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.axis, 4));
    g.setAttribute('aStem', new THREE.Float32BufferAttribute(this.stem, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const cells = (...names: string[]) => names.map((name) => foliageCell(name));

// ───────────────────────────── Putting a kind together ─────────────────────────────

/** A shape as built: its wood (if any, with the bark colour) and its leaves. */
interface Built {
  wood?: Wood | null;
  bark?: number;
  leaves: Leaves;
  /** Size and colour of this shape's stand-in against the kind's stand-in geometry. */
  far?: [number, number];
  farTint?: Tint;
}

interface Kind {
  shapes: PlantShape[];
  /** The stand-in: leaf cards and plain tubes only. */
  far: Leaves | null;
  pick?: PlantModel['pick'];
  near?: number;
  reach?: number;
  vary?: Partial<PlantModel['vary']>;
  fine?: boolean;
  farShadow?: boolean;
  collider?: PropDef['collider'];
  castShadow?: boolean;
  minor?: boolean;
}

const shapeCache = new WeakMap<MaterialLibrary, Map<string, PlantShape>>();

/** A shape built once per material library, however many kinds include it (so they share its draw calls). */
function shape(m: MaterialLibrary, key: string, build: () => Built): PlantShape {
  let cache = shapeCache.get(m);
  if (!cache) shapeCache.set(m, (cache = new Map()));
  let made = cache.get(key);
  if (!made) {
    const b = build();
    const parts: PlantShape['parts'] = [];
    if (b.wood) parts.push({ geometry: b.wood.geometry(), material: woodMaterial(m, b.bark) });
    parts.push({ geometry: b.leaves.geometry(), material: leafMaterial(m) });
    made = { parts, far: b.far, farTint: b.farTint };
    cache.set(key, made);
  }
  return made;
}

/** The same buffers under a geometry of its own: the world's instances of a kind are told apart by it. */
function alias(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
  g.setIndex(geometry.getIndex());
  return g;
}

const DEFAULT_VARY: PlantModel['vary'] = { size: 0.1, height: 0.08, lean: 0.05, tone: 0.1 };

const models = new WeakMap<MaterialLibrary, Map<string, PlantModel>>();

/** The model behind a kind, once its prop has been built with `materials` (tests and tools). */
export function plantModel(kind: string, materials: MaterialLibrary): PlantModel | undefined {
  return models.get(materials)?.get(kind);
}

function plant(kind: string, build: (m: MaterialLibrary) => Kind): PropFactory {
  return (m) => {
    const k = build(m);
    const first = k.shapes[0];
    // What the world instances: the first shape, under geometries no other kind uses.
    const parts = first.parts.map((part) => ({ geometry: alias(part.geometry), material: part.material }));
    const model: PlantModel = {
      shapes: k.shapes,
      pick: k.pick,
      far: k.far ? k.far.geometry() : null,
      farMaterial: k.far ? farLeafMaterial(m) : null,
      near: k.near ?? 120,
      reach: k.reach,
      castShadow: k.castShadow !== false,
      farShadow: k.farShadow,
      vary: { ...DEFAULT_VARY, ...k.vary },
      fine: k.fine,
    };
    plantField.register(parts.map((part) => part.geometry), model);
    let known = models.get(m);
    if (!known) models.set(m, (known = new Map()));
    known.set(kind, model);
    return { parts, collider: k.collider, castShadow: k.castShadow, minor: k.minor };
  };
}

/** Two upright cards crossing at the foot: the stand-in for anything small. */
function crossed(leaves: Leaves, cell: FoliageCell, h: number, o: { at?: V3; stretch?: number; count?: number; turn?: number } = {}) {
  const count = o.count ?? 2;
  for (let i = 0; i < count; i++) leaves.card(cell, o.at ?? [0, 0, 0], polar((o.turn ?? 0.4) + (i * Math.PI) / count), UP, h, { stretch: o.stretch, turn: false, mirror: i % 2 === 1 });
}

// ───────────────────────────── Broad crowns ─────────────────────────────

interface CrownSpec {
  seed: number;
  /** Trunk path up to the fork. */
  trunk: Path;
  trunkSides: number;
  /** Middle and radii (horizontal, vertical) of the shell the limb ends reach. */
  centre: V3;
  rx: number;
  ry: number;
  /** Limb ends, spread over the shell from `low` to the top (sine of elevation, -1..1). */
  ends: number;
  low: number;
  sectors: number;
  /** Radius of a main limb where it leaves the trunk. */
  limb: number;
  /** Sides of a main limb (default 5). */
  limbSides?: number;
  /** Twigs from the main limbs to the limb ends: bent (default), straight, or left out where foliage hides them. */
  twigs?: 'bent' | 'straight' | 'none';
  /** One side of the crown is fuller: shell radius × (1 ± lopsided) round the compass. */
  lopsided: number;
  cells: FoliageCell[];
  cardsPerEnd: number;
  cardSize: [number, number];
  /** Share of the cards that stand any way up rather than lying against the crown's surface. */
  fins?: number;
  /** How strongly boughs reach outwards past the limb ends. */
  flare?: number;
  /** Cards on the main limbs, inside the crown, so there is no clear view through the middle. */
  inner: number;
  /** Leaf colour and how it varies; how dark the heart of the crown is; how far normals pull upward. */
  tint: Tint;
  vary: number;
  hue?: number;
  core?: number;
  upward?: number;
  bark?: number;
}

const crownLeaves = (spec: CrownSpec, r: Rng): Leaves => {
  const leaves = new Leaves([spec.centre[0], spec.centre[1] - spec.ry * 0.28, spec.centre[2]], Math.max(spec.rx, spec.ry) * 1.6, r, spec.tint, spec.vary);
  leaves.hue = spec.hue ?? 0.04;
  leaves.core = spec.core ?? 0.5;
  leaves.upward = spec.upward ?? 0.35;
  return leaves;
};

/**
 * A spreading crown: main limbs leave the top of the trunk for the sectors of the compass, fork to
 * limb ends spread over a lumpy shell, and each end carries a clump of cards.
 */
function crown(spec: CrownSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  const leaves = crownLeaves(spec, r);
  const fork = spec.trunk[spec.trunk.length - 1];
  // The trunk closes over in a shoulder where the limbs leave it.
  wood.tube([...spec.trunk, { p: add(fork.p, UP, fork.r * 0.7), r: fork.r * 0.72 }, { p: add(fork.p, UP, fork.r * 1.25), r: fork.r * 0.2 }], spec.trunkSides);
  const heavy = r.range(0, Math.PI * 2);
  const ends: { p: V3; out: V3; az: number; top: boolean }[] = [];
  for (let i = 0; i < spec.ends; i++) {
    const sinEl = spec.low + (0.98 - spec.low) * ((i + 0.5) / spec.ends);
    const az = i * GOLDEN + r.range(-0.25, 0.25);
    const flat = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const k = r.range(0.86, 1.12) * (1 + spec.lopsided * Math.cos(az - heavy));
    const p: V3 = [spec.centre[0] + Math.cos(az) * flat * spec.rx * k, spec.centre[1] + sinEl * spec.ry * k, spec.centre[2] + Math.sin(az) * flat * spec.rx * k];
    ends.push({ p, out: norm(sub(p, spec.centre)), az: ((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), top: sinEl > 0.78 });
  }
  const groups: (typeof ends)[] = Array.from({ length: spec.sectors + 1 }, () => []);
  for (const e of ends) groups[e.top ? spec.sectors : Math.floor((e.az / (Math.PI * 2)) * spec.sectors) % spec.sectors].push(e);
  for (const group of groups) {
    if (!group.length) continue;
    let mean: V3 = [0, 0, 0];
    for (const e of group) mean = add(mean, e.p, 1 / group.length);
    // The limb rises steeply out of the fork, then leans out towards its ends.
    const elbow = add(mix(fork.p, mean, 0.55), UP, 0.35);
    const knee = add(mix(fork.p, elbow, 0.45), UP, len(sub(elbow, fork.p)) * 0.16);
    const root = add(fork.p, UP, -fork.r * 0.8);
    wood.tube([{ p: root, r: spec.limb * 1.15 }, { p: mix(root, knee, 0.45), r: spec.limb }, { p: knee, r: spec.limb * 0.8 }, { p: elbow, r: spec.limb * 0.55 }], spec.limbSides ?? 5);
    for (const e of group) {
      const tip = mix(elbow, e.p, 0.85);
      const sag = add(mix(elbow, tip, 0.5), r.unit(), 0.22);
      if (spec.twigs !== 'none') wood.tube(spec.twigs === 'straight' ? [{ p: elbow, r: spec.limb * 0.42 }, { p: tip, r: spec.limb * 0.12 }] : [{ p: elbow, r: spec.limb * 0.42 }, { p: sag, r: spec.limb * 0.28 }, { p: tip, r: spec.limb * 0.12 }], 3);
      // Boughs on the underside of the crown hang; the rest reach up and out.
      const lean: V3 = e.out[1] < 0.1 ? [e.out[0] * 0.8, -0.5, e.out[2] * 0.8] : UP;
      leaves.clump(spec.cells, tip, e.out, spec.cardsPerEnd, spec.cardSize, { lean, fins: spec.fins, flare: spec.flare });
    }
    if (spec.inner) leaves.clump(spec.cells, elbow, norm(add(sub(elbow, spec.centre), UP, 0.6)), spec.inner, spec.cardSize, { fins: 0.6 });
  }
  return { wood, bark: spec.bark, leaves };
}

/** Big cards over a crown's shell and a few standing through its middle: the leaves of a stand-in. */
function farShell(leaves: Leaves, r: Rng, pictures: FoliageCell[], centre: V3, rx: number, ry: number, low: number, count: number, size: number) {
  leaves.turn = false;
  for (let i = 0; i < count; i++) {
    const sinEl = low + (0.94 - low) * ((i + 0.5) / count);
    const az = i * GOLDEN + r.range(-0.3, 0.3);
    const flat = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const p: V3 = [centre[0] + Math.cos(az) * flat * rx * 0.86, centre[1] + sinEl * ry * 0.86, centre[2] + Math.sin(az) * flat * rx * 0.86];
    const out = norm(sub(p, centre));
    const n = norm(add(out, r.unit(), 0.3));
    const grow: V3 = out[1] < 0 ? [out[0] * 0.8, -0.6, out[2] * 0.8] : add(UP, out, 0.4);
    const up = norm(sub(grow, mul(n, dot(grow, n))));
    const h = size * r.range(0.9, 1.12);
    leaves.card(pictures[i % pictures.length], add(p, up, -h * 0.5), cross(up, n), up, h);
  }
  // Seen from the side these carry the outline.
  const tall = ry * 2.25;
  for (let i = 0; i < 3; i++) {
    const picture = pictures[i % pictures.length];
    leaves.card(picture, [centre[0], centre[1] - ry * 1.08, centre[2]], polar(0.5 + (i * Math.PI) / 3), UP, tall, { stretch: (rx * 2.3) / (tall * picture.aspect), shade: 0.85 });
  }
}

function crownFar(spec: CrownSpec, count = 11): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = crownLeaves(spec, r);
  const fork = spec.trunk[spec.trunk.length - 1];
  const bark = mul(lin(spec.bark ?? 0x5c4a3a), 0.75);
  leaves.solidTube([spec.trunk[0], spec.trunk[1], { p: fork.p, r: fork.r }, { p: add(fork.p, UP, spec.ry * 0.5), r: fork.r * 0.5 }], 4, bark);
  farShell(leaves, r, spec.cells, spec.centre, spec.rx, spec.ry, Math.max(spec.low, -0.3), count, Math.max(spec.rx, spec.ry) * 1.25);
  return leaves;
}

// English oak: broad and heavy-limbed, a deep, slightly dusty midsummer green well below the lawn in
// brightness, patchy from bough to bough.
const OAK: CrownSpec = {
  seed: 101,
  trunk: [{ p: [0, SUNK, 0], r: 0.68 }, { p: [0.02, 0.45, 0], r: 0.5 }, { p: [0.1, 1.7, -0.04], r: 0.44 }, { p: [0.18, 3, 0.05], r: 0.4 }],
  trunkSides: 8,
  centre: [0.2, 6.5, 0],
  rx: 3.5,
  ry: 3.3,
  ends: 26,
  low: -0.25,
  sectors: 5,
  limb: 0.24,
  lopsided: 0.12,
  cells: cells('oak-a', 'oak-b'),
  cardsPerEnd: 5,
  cardSize: [2.2, 2.9],
  fins: 0.22,
  inner: 3,
  tint: [0.7, 0.58, 0.84],
  vary: 0.17,
  hue: 0.1,
};
/** A taller oak that has grown up in company: a longer bole, a narrower head carried to one side. */
const OAK_TALL: CrownSpec = {
  ...OAK,
  seed: 137,
  trunk: [{ p: [0, SUNK, 0], r: 0.6 }, { p: [-0.02, 0.45, 0], r: 0.45 }, { p: [-0.12, 2.1, 0.06], r: 0.39 }, { p: [-0.26, 3.9, 0.12], r: 0.35 }],
  centre: [-0.5, 7.7, 0.2],
  rx: 3.1,
  ry: 3.6,
  low: -0.3,
  lopsided: 0.24,
  limb: 0.22,
};
/** An old open-grown oak: short in the bole, wider than it is high, the lowest limbs nearly level. */
const OAK_WIDE: CrownSpec = {
  ...OAK,
  seed: 173,
  trunk: [{ p: [0, SUNK, 0], r: 0.8 }, { p: [0.03, 0.45, 0], r: 0.6 }, { p: [0.05, 1.4, 0.05], r: 0.54 }, { p: [0.0, 2.5, 0.1], r: 0.5 }],
  centre: [0, 5.9, 0.1],
  rx: 4.3,
  ry: 3.0,
  ends: 28,
  low: -0.15,
  sectors: 6,
  limb: 0.28,
  lopsided: 0.16,
};

// Common lime, the avenue tree: a tall dense dome on a straight grey bole, a fresher green than the oaks.
const LIME: CrownSpec = {
  seed: 211,
  trunk: [{ p: [0, SUNK, 0], r: 0.56 }, { p: [0, 0.45, 0], r: 0.42 }, { p: [0.03, 1.6, 0.02], r: 0.38 }, { p: [0.05, 2.8, 0], r: 0.35 }],
  trunkSides: 8,
  centre: [0.05, 7.3, 0],
  rx: 3.0,
  ry: 4.3,
  ends: 28,
  low: -0.5,
  sectors: 5,
  limb: 0.2,
  lopsided: 0.07,
  cells: cells('poplar', 'oak-b'),
  cardsPerEnd: 5,
  cardSize: [2.3, 2.9],
  fins: 0.2,
  inner: 3,
  tint: [0.7, 0.66, 0.7],
  vary: 0.14,
  hue: 0.07,
  bark: 0x6f675c,
};
const LIME_TALL: CrownSpec = { ...LIME, seed: 239, centre: [-0.1, 8.3, 0.1], rx: 2.75, ry: 4.9, low: -0.55, lopsided: 0.12, trunk: [{ p: [0, SUNK, 0], r: 0.6 }, { p: [0, 0.45, 0], r: 0.45 }, { p: [-0.04, 1.9, 0.03], r: 0.4 }, { p: [-0.08, 3.3, 0.05], r: 0.36 }] };

// London plane: a high open crown on a pale, flaking bole, with big maple-like leaves in a yellower green.
const PLANE: CrownSpec = {
  seed: 307,
  trunk: [{ p: [0, SUNK, 0], r: 0.7 }, { p: [0.02, 0.45, 0], r: 0.52 }, { p: [0.08, 2.4, 0.04], r: 0.46 }, { p: [0.14, 4.3, 0.02], r: 0.42 }],
  trunkSides: 8,
  centre: [0.2, 8.5, 0],
  rx: 4.0,
  ry: 3.5,
  ends: 24,
  low: -0.35,
  sectors: 5,
  limb: 0.27,
  lopsided: 0.2,
  cells: [foliageCell('plane', 'oak-a'), foliageCell('plane', 'oak-b')],
  cardsPerEnd: 5,
  cardSize: [2.3, 3.0],
  fins: 0.25,
  inner: 2,
  tint: [0.72, 0.68, 0.66],
  vary: 0.15,
  hue: 0.08,
  core: 0.5,
  bark: 0xa39a86,
};
const PLANE_LEANING: CrownSpec = { ...PLANE, seed: 331, centre: [-0.6, 7.9, 0.3], rx: 3.6, ry: 3.9, low: -0.3, lopsided: 0.22, trunk: [{ p: [0, SUNK, 0], r: 0.64 }, { p: [-0.02, 0.45, 0], r: 0.48 }, { p: [-0.16, 2.0, 0.08], r: 0.43 }, { p: [-0.34, 3.7, 0.16], r: 0.39 }] };

const broadleaf = (m: MaterialLibrary, key: string, spec: CrownSpec, far?: [number, number], farTint?: Tint) => shape(m, key, () => ({ ...crown(spec), far, farTint }));
/** The colour of `spec`'s leaves as a multiple of `other`'s: what its stand-in is tinted by when it borrows `other`'s. */
const against = (spec: CrownSpec, other: CrownSpec): Tint => [0, 1, 2].map((c) => (spec.tint[c] * spec.cells[0].mean[c]) / (other.tint[c] * other.cells[0].mean[c])) as Tint;
const oaks = (m: MaterialLibrary) => [broadleaf(m, 'oak', OAK), broadleaf(m, 'oak-tall', OAK_TALL, [0.92, 1.1]), broadleaf(m, 'oak-wide', OAK_WIDE, [1.2, 0.9])];
// As stand-ins the limes and planes borrow the oak's (see `broadleaves`), stretched and tinted to suit.
const limes = (m: MaterialLibrary) => [broadleaf(m, 'lime', LIME, [0.9, 1.18], against(LIME, OAK)), broadleaf(m, 'lime-tall', LIME_TALL, [0.84, 1.32], against(LIME, OAK))];
const planes = (m: MaterialLibrary) => [broadleaf(m, 'plane', PLANE, [1.12, 1.22], against(PLANE, OAK)), broadleaf(m, 'plane-leaning', PLANE_LEANING, [1.05, 1.2], against(PLANE, OAK))];

const TREE_VARY = { size: 0.12, height: 0.1, lean: 0.06, tone: 0.12 };

/**
 * `tree-oak` is what the world plants wherever it wants a big deciduous park or street tree, so it is not
 * only oaks: the species changes from one neighbourhood to the next (an avenue of limes, a stand of planes,
 * oaks through the park), and within a species each tree takes one of its shapes.
 */
const broadleaves = plant('tree-oak', (m) => {
  const all = [...oaks(m), ...limes(m), ...planes(m)];
  return {
    shapes: all,
    far: crownFar(OAK),
    pick: (x, z, h) => {
      const species = noise2(x / 150 + 31.7, z / 150 - 8.3);
      if (species < 0.47) return Math.floor(h * 3);
      return species < 0.6 ? 3 + Math.floor(h * 2) : 5 + Math.floor(h * 2);
    },
    vary: TREE_VARY,
    collider: { radius: 0.45, height: 4 },
  };
});
const englishOak = plant('tree-english-oak', (m) => ({ shapes: oaks(m), far: crownFar(OAK), vary: TREE_VARY, collider: { radius: 0.45, height: 4 } }));
const lime = plant('tree-lime', (m) => ({
  shapes: limes(m).map((s, i) => ({ parts: s.parts, far: i ? ([0.93, 1.12] as [number, number]) : undefined })),
  far: crownFar(LIME),
  vary: TREE_VARY,
  collider: { radius: 0.4, height: 4 },
}));
const plane = plant('tree-plane', (m) => ({
  shapes: planes(m).map((s) => ({ parts: s.parts })),
  far: crownFar(PLANE),
  vary: TREE_VARY,
  collider: { radius: 0.45, height: 4 },
}));

// ───────────────────────────── Willow ─────────────────────────────

interface WillowSpec extends CrownSpec {
  /** Rings of hanging curtains: distance from the trunk, how many, how far short of the ground they stop. */
  rings: [radius: number, count: number, foot: [number, number]][];
}

const WILLOW: WillowSpec = {
  seed: 202,
  trunk: [{ p: [0, SUNK, 0], r: 0.72 }, { p: [0.04, 0.5, 0], r: 0.55 }, { p: [0.24, 1.6, 0.1], r: 0.5 }, { p: [0.4, 2.5, 0.12], r: 0.46 }],
  trunkSides: 8,
  centre: [0.3, 5.2, 0.1],
  rx: 3.2,
  ry: 2.8,
  ends: 13,
  low: 0.3,
  sectors: 5,
  limb: 0.25,
  lopsided: 0.1,
  cells: cells('willow-bough'),
  cardsPerEnd: 3,
  cardSize: [2.3, 2.9],
  inner: 0,
  tint: [0.84, 0.76, 0.9],
  vary: 0.14,
  core: 0.6,
  upward: 0.3,
  rings: [
    [1.9, 6, [2.2, 3.4]],
    [3.1, 10, [0.9, 2.2]],
    [4.2, 15, [0.4, 1.5]],
  ],
};
/** A willow leaning out from a bank: the bole goes over at a slant and the whole head hangs to that side. */
const WILLOW_LEANING: WillowSpec = {
  ...WILLOW,
  seed: 227,
  trunk: [{ p: [0, SUNK, 0], r: 0.66 }, { p: [0.1, 0.5, 0], r: 0.5 }, { p: [0.62, 1.7, 0.14], r: 0.45 }, { p: [1.2, 2.7, 0.24], r: 0.41 }],
  centre: [1.5, 5.4, 0.3],
  rx: 3.4,
  ry: 2.6,
  lopsided: 0.2,
  rings: [
    [2.0, 6, [2.4, 3.6]],
    [3.2, 10, [1.2, 2.6]],
    [4.4, 14, [0.5, 2.0]],
  ],
};

function willowCurtains(spec: WillowSpec, leaves: Leaves, r: Rng, thin = 1) {
  const curtain = foliageCell('willow-curtain');
  const centre = spec.centre;
  for (const [radius, count, foot] of spec.rings) {
    const n = Math.max(2, Math.round(count * thin));
    for (let i = 0; i < n; i++) {
      const az = ((i + r.range(0.15, 0.85)) / n) * Math.PI * 2;
      const rho = radius * r.range(0.9, 1.1) * (spec.rx / 3.2);
      const top = centre[1] + spec.ry * Math.sqrt(Math.max(0.04, 1 - (rho / (spec.rx * 1.48)) ** 2));
      const drop = top - r.range(foot[0], foot[1]);
      const out: V3 = [Math.cos(az), 0, Math.sin(az)];
      // The hanging plane is turned a little off square to the trunk so the rings do not read as cylinders.
      const across = polar(az + Math.PI / 2 + r.range(-0.55, 0.55));
      const width = drop * curtain.aspect * r.range(0.95, 1.25) / Math.sqrt(thin);
      const at = (along: number, sag: number): V3 => [centre[0] + out[0] * (rho + along), top - drop * sag, centre[2] + out[2] * (rho + along)];
      if (thin < 1) leaves.card(curtain, add(at(0, 0), UP, 0.2), across, UP, drop, { stretch: width / (drop * curtain.aspect) });
      else
        leaves.ribbon(curtain, [
          { p: add(at(-0.7, 0), UP, 0.3), across, width },
          { p: at(0, 0.14), across, width },
          { p: at(0.28, 0.55), across, width },
          { p: at(0.2, 1), across, width },
        ]);
    }
  }
}

/** Weeping willow: a low dome on wide limbs, hung with curtains that trail almost to the ground. */
function willowShape(spec: WillowSpec): Built {
  const built = crown(spec);
  willowCurtains(spec, built.leaves, rng(spec.seed + 1));
  return built;
}

function willowFar(spec: WillowSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = crownLeaves(spec, r);
  const fork = spec.trunk[spec.trunk.length - 1];
  leaves.solidTube([spec.trunk[0], spec.trunk[1], { p: fork.p, r: fork.r }, { p: add(fork.p, UP, spec.ry * 0.8), r: fork.r * 0.4 }], 4, mul(lin(0x5c4a3a), 0.75));
  farShell(leaves, r, spec.cells, spec.centre, spec.rx, spec.ry, 0.25, 7, spec.rx * 1.2);
  willowCurtains({ ...spec, rings: spec.rings.slice(1) }, leaves, r, 0.4);
  return leaves;
}

const willow = plant('tree-willow', (m) => ({
  shapes: [shape(m, 'willow', () => willowShape(WILLOW)), shape(m, 'willow-leaning', () => ({ ...willowShape(WILLOW_LEANING), far: [1.08, 1] }))],
  far: willowFar(WILLOW),
  vary: { size: 0.12, height: 0.08, lean: 0.07, tone: 0.1 },
  collider: { radius: 0.5, height: 3 },
}));

// ───────────────────────────── Macrocarpa ─────────────────────────────

/** Old macrocarpa: several heavy stems, a broad flat-topped crown of dark plates, one side wind-pruned. */
const MACROCARPA: CrownSpec = {
  seed: 303,
  trunk: [{ p: [0, SUNK, 0], r: 0.95 }, { p: [0.04, 0.5, 0], r: 0.72 }, { p: [0.14, 1.5, 0.05], r: 0.66 }],
  trunkSides: 5,
  centre: [0.5, 5.9, 0],
  rx: 4.4,
  ry: 3.4,
  ends: 21,
  low: -0.42,
  sectors: 4,
  limb: 0.34,
  limbSides: 4,
  twigs: 'none',
  lopsided: 0.3,
  cells: cells('macrocarpa'),
  cardsPerEnd: 4,
  cardSize: [2.6, 3.4],
  inner: 0,
  tint: [1, 1, 1],
  vary: 0.1,
  upward: 0.4,
  bark: 0x57483a,
};
/** A shelter-belt macrocarpa: drawn up by its neighbours, taller than wide, still shorn on the weather side. */
const MACROCARPA_TALL: CrownSpec = { ...MACROCARPA, seed: 353, trunk: [{ p: [0, SUNK, 0], r: 0.85 }, { p: [0.03, 0.5, 0], r: 0.64 }, { p: [0.1, 2.2, 0.04], r: 0.56 }], centre: [0.3, 7.4, 0], rx: 3.5, ry: 4.4, low: -0.55, lopsided: 0.2 };

const macrocarpa = plant('tree-macrocarpa', (m) => ({
  shapes: [shape(m, 'macrocarpa', () => crown(MACROCARPA)), shape(m, 'macrocarpa-tall', () => ({ ...crown(MACROCARPA_TALL), far: [0.84, 1.26] }))],
  far: crownFar(MACROCARPA, 10),
  vary: { size: 0.12, height: 0.1, lean: 0.05, tone: 0.08 },
  collider: { radius: 0.7, height: 3 },
}));

// ───────────────────────────── Columns and spires ─────────────────────────────

interface PoplarSpec {
  seed: number;
  height: number;
  cards: number;
  /** Width of the column against the standard one. */
  girth: number;
  /** Where up the tree (0..1) it is fattest. */
  belly: number;
}

const POPLAR: PoplarSpec = { seed: 404, height: 16.5, cards: 84, girth: 1, belly: 0.3 };
const POPLAR_SHORT: PoplarSpec = { seed: 433, height: 13, cards: 72, girth: 1.22, belly: 0.4 };
const POPLAR_TALL: PoplarSpec = { seed: 457, height: 19.5, cards: 92, girth: 0.9, belly: 0.25 };

const poplarLeaves = (spec: PoplarSpec, r: Rng) => {
  const leaves = new Leaves([0, spec.height * 0.5, 0], spec.height * 0.52, r, [0.74, 0.64, 0.86], 0.15);
  leaves.bend = 0.7;
  leaves.core = 0.62;
  leaves.upward = 0.3;
  return leaves;
};
/** How wide the column is at `t` up it: drawn in to a point at the top and a little at the foot. */
const poplarGirth = (spec: PoplarSpec, t: number) => Math.min(1, 0.55 + (t / spec.belly) * 0.66) * (1 - Math.max(0, t - spec.belly - 0.15) ** 1.6 * 1.25) * spec.girth;

/** Lombardy poplar: a tall narrow column of steeply rising branches. */
function poplarShape(spec: PoplarSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  const h = spec.height;
  wood.tube([{ p: [0, SUNK, 0], r: 0.42 }, { p: [0, 0.5, 0], r: 0.32 }, { p: [0.06, h * 0.3, 0.03], r: 0.24 }, { p: [0.02, h * 0.64, -0.04], r: 0.15 }, { p: [0, h - 1, 0], r: 0.04 }], 6);
  const leaves = poplarLeaves(spec, r);
  const cell = foliageCell('poplar');
  for (let i = 0; i < spec.cards; i++) {
    const t = i / (spec.cards - 1);
    const y = 1.1 + t * (h - 4.3);
    const az = i * GOLDEN;
    const girth = poplarGirth(spec, t);
    const out = polar(az);
    const up = norm(add(UP, out, r.range(0.16, 0.4) * girth));
    const right = norm(cross(up, add(out, r.unit(), 0.9)));
    leaves.card(cell, [out[0] * 0.25 * girth, y, out[2] * 0.25 * girth], right, up, r.range(3, 3.8) * (0.62 + 0.38 * Math.min(1, girth)), { stretch: 0.8 + 0.3 * girth });
  }
  return { wood, bark: 0x6a655a, leaves };
}

function poplarFar(spec: PoplarSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = poplarLeaves(spec, r);
  leaves.turn = false;
  const h = spec.height;
  leaves.solidTube([{ p: [0, SUNK, 0], r: 0.36 }, { p: [0, 1.6, 0], r: 0.26 }, { p: [0, h * 0.5, 0], r: 0.12 }], 4, mul(lin(0x6a655a), 0.8));
  const cell = foliageCell('poplar');
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = 0.9 + t * (h - 5.2);
    const girth = poplarGirth(spec, t);
    const tall = 4.6 * (0.7 + 0.3 * Math.min(1, girth));
    for (let k = 0; k < 2; k++) leaves.card(cell, [0, y, 0], polar(i * 1.1 + (k * Math.PI) / 2), UP, tall, { stretch: (2.5 * girth) / (tall * cell.aspect) });
  }
  return leaves;
}

const poplar = plant('tree-poplar', (m) => ({
  shapes: [shape(m, 'poplar', () => poplarShape(POPLAR)), shape(m, 'poplar-short', () => ({ ...poplarShape(POPLAR_SHORT), far: [1.2, 0.79] })), shape(m, 'poplar-tall', () => ({ ...poplarShape(POPLAR_TALL), far: [0.9, 1.18] }))],
  far: poplarFar(POPLAR),
  vary: { size: 0.1, height: 0.1, lean: 0.03, tone: 0.1 },
  collider: { radius: 0.35, height: 3 },
}));

interface PineSpec {
  seed: number;
  height: number;
  /** Where the green starts, and how many boughs carry it. */
  clear: number;
  boughs: number;
  /** Reach of the lowest boughs, and how fast it falls off towards the top (1 = a straight cone; less = a broad head). */
  reach: number;
  taper: number;
  lean: V3;
  /** Dead stubs below the green: height and compass bearing of each. */
  stubs: [number, number][];
}

const PINE: PineSpec = { seed: 505, height: 14.5, clear: 2.4, boughs: 34, reach: 3.2, taper: 0.75, lean: [0.5, 0, 0.15], stubs: [[1.5, 0.6], [2.1, 2.9], [2.6, 4.7]] };
/** An old radiata that has shed its lower limbs: a long bare bole and a broad, rounded head. */
const PINE_OLD: PineSpec = { seed: 541, height: 17.5, clear: 6.5, boughs: 30, reach: 3.9, taper: 0.45, lean: [-0.7, 0, 0.3], stubs: [[2.6, 1.2], [3.8, 3.6], [4.9, 5.4], [5.7, 0.2]] };
/** A younger, bushier tree, green almost to the ground. */
const PINE_YOUNG: PineSpec = { seed: 577, height: 11.5, clear: 1.3, boughs: 32, reach: 3.0, taper: 0.9, lean: [0.2, 0, -0.2], stubs: [[0.9, 2.2]] };

const pineLeaves = (spec: PineSpec, r: Rng) => {
  const leaves = new Leaves([0.2, spec.clear + (spec.height - spec.clear) * 0.4, 0], spec.height * 0.55, r, [1, 1, 1]);
  leaves.core = 0.5;
  leaves.upward = 0.4;
  return leaves;
};
const pineSpine = (spec: PineSpec) => (y: number): V3 => [spec.lean[0] * (y / spec.height) ** 2, y, spec.lean[2] * (y / spec.height) ** 2];
const pineReach = (spec: PineSpec, t: number, az: number) => (0.45 + (spec.reach - 0.45) * (1 - t) ** spec.taper) * (1 + 0.2 * Math.cos(az - 0.3));

/** Radiata pine as it grows in a shelter belt: a dark, dense spire, heavier on one side, dead stubs below. */
function pineShape(spec: PineSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  const h = spec.height;
  const spine = pineSpine(spec);
  wood.tube([{ p: [0, SUNK, 0], r: 0.56 }, { p: spine(0.5), r: 0.42 }, { p: spine(h * 0.28), r: 0.33 }, { p: spine(h * 0.62), r: 0.2 }, { p: spine(h - 1), r: 0.05 }], 6);
  for (const [y, az] of spec.stubs) {
    const out = polar(az, 0.15);
    wood.tube([{ p: spine(y), r: 0.07 }, { p: add(spine(y), out, r.range(0.9, 1.5)), r: 0.03 }], 3);
  }
  const leaves = pineLeaves(spec, r);
  const cell = foliageCell('pine-a');
  for (let i = 0; i < spec.boughs; i++) {
    const t = i / (spec.boughs - 1);
    const y = spec.clear + t * (h - spec.clear - 1.2);
    const az = i * GOLDEN + r.range(-0.2, 0.2);
    // Widest at the foot of the green and fuller to leeward; the lowest boughs sag, the top ones reach up.
    const reach = pineReach(spec, t, az);
    const out = polar(az);
    const dir = polar(az, -0.12 + t * 0.85 + r.range(-0.08, 0.12));
    const size = Math.min(3.5, 1.3 + reach * 0.8);
    leaves.clump([cell], add(spine(y), dir, reach * 0.5), norm(add(out, UP, 0.2 + t * 1.1)), 3, [size * 0.9, size * 1.1], { lean: dir, fins: 0.34, flare: 0.6 });
  }
  return { wood, bark: 0x5a4636, leaves };
}

function pineFar(spec: PineSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = pineLeaves(spec, r);
  leaves.turn = false;
  const h = spec.height;
  const spine = pineSpine(spec);
  leaves.solidTube([{ p: [0, SUNK, 0], r: 0.5 }, { p: spine(h * 0.3), r: 0.32 }, { p: spine(h * 0.75), r: 0.12 }], 4, mul(lin(0x5a4636), 0.7));
  const cell = foliageCell('pine-a');
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const reach = pineReach(spec, t, 1.9);
    const tall = Math.min(6, 3.2 + reach);
    const y = spec.clear - 0.9 + t * (h - spec.clear - tall * 0.5);
    // Three to a tier, and wider than the boughs they stand for: a belt of these has to be a wall, not a row of spikes.
    for (let k = 0; k < 3; k++) leaves.card(cell, spine(y), polar(i * 1.3 + (k * Math.PI) / 3), UP, tall, { stretch: (reach * 3) / (tall * cell.aspect), shade: 0.92 });
  }
  return leaves;
}

const pine = plant('tree-pine', (m) => ({
  shapes: [shape(m, 'pine', () => pineShape(PINE)), shape(m, 'pine-old', () => ({ ...pineShape(PINE_OLD), far: [1.12, 1.2] })), shape(m, 'pine-young', () => ({ ...pineShape(PINE_YOUNG), far: [0.95, 0.8] }))],
  far: pineFar(PINE),
  pick: (_x, _z, h) => (h < 0.5 ? 0 : h < 0.75 ? 1 : 2),
  vary: { size: 0.12, height: 0.1, lean: 0.06, tone: 0.08 },
  collider: { radius: 0.4, height: 3 },
}));

interface NorfolkSpec {
  seed: number;
  height: number;
  tiers: number;
  reach: number;
}

const NORFOLK: NorfolkSpec = { seed: 606, height: 20, tiers: 13, reach: 5.4 };
const NORFOLK_YOUNG: NorfolkSpec = { seed: 631, height: 14.5, tiers: 11, reach: 4.4 };

const norfolkLeaves = (spec: NorfolkSpec, r: Rng) => {
  const leaves = new Leaves([0, spec.height * 0.45, 0], spec.height * 0.5, r, [1, 1, 1]);
  leaves.bend = 0.55;
  leaves.upward = 0.5;
  leaves.core = 0.55;
  leaves.sway = 0.5;
  return leaves;
};

/** Norfolk Island pine: a dead-straight trunk with flat, evenly spaced tiers of fronds, tips turned up. */
function norfolkShape(spec: NorfolkSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  const h = spec.height;
  wood.tube([{ p: [0, SUNK, 0], r: 0.52 }, { p: [0, 0.6, 0], r: 0.4 }, { p: [0, h * 0.35, 0], r: 0.28 }, { p: [0, h * 0.7, 0], r: 0.15 }, { p: [0, h, 0], r: 0.03 }], 7);
  const leaves = norfolkLeaves(spec, r);
  const cell = foliageCell('norfolk');
  const gap = (h - 5.2) / spec.tiers;
  let y = 3.4;
  for (let tier = 0; tier < spec.tiers; tier++) {
    const t = tier / (spec.tiers - 1);
    const reach = 0.7 + (spec.reach - 0.7) * (1 - t) ** 0.8;
    const branches = t > 0.75 ? 5 : 6;
    for (let b = 0; b < branches; b++) {
      const az = ((b + (tier % 2) * 0.5) / branches) * Math.PI * 2 + r.range(-0.12, 0.12);
      const out = polar(az);
      const roll = r.range(-0.4, 0.4);
      const flat = polar(az + Math.PI / 2);
      const across = norm(add(mul(flat, Math.cos(roll)), UP, Math.sin(roll)));
      const width = reach * 0.66 + 0.25;
      const droop = 0.1 + 0.06 * (1 - t);
      leaves.ribbon(cell, [
        { p: [out[0] * 0.1, y, out[2] * 0.1], across, width: width * 0.9 },
        { p: [out[0] * reach * 0.55, y - reach * droop, out[2] * reach * 0.55], across, width },
        { p: [out[0] * reach, y + reach * 0.06, out[2] * reach], across, width: width * 0.9 },
      ]);
    }
    y += gap * (1.32 - t * 0.64);
  }
  // The leader.
  for (const az of [0.3, 1.87]) leaves.card(foliageCell('macrocarpa'), [0, h - 1.9, 0], polar(az), UP, 2.1, { stretch: 0.4, shade: 0.7 });
  return { wood, bark: 0x5e5044, leaves };
}

function norfolkFar(spec: NorfolkSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = norfolkLeaves(spec, r);
  leaves.turn = false;
  const h = spec.height;
  leaves.solidTube([{ p: [0, SUNK, 0], r: 0.46 }, { p: [0, h * 0.4, 0], r: 0.26 }, { p: [0, h - 1, 0], r: 0.05 }], 4, mul(lin(0x5e5044), 0.75));
  const cell = foliageCell('norfolk');
  const tiers = 6;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / (tiers - 1);
    const reach = 0.9 + (spec.reach - 0.9) * (1 - t) ** 0.8;
    const y = 3.6 + t * (h - 6.2);
    for (let b = 0; b < 3; b++) {
      const az = ((b + (tier % 2) * 0.5) / 3) * Math.PI * 2;
      const out = polar(az);
      // A whole tier's worth of fronds in three broad fans.
      leaves.card(cell, [out[0] * 0.05, y, out[2] * 0.05], norm([out[0], -0.06, out[2]]), norm(add(polar(az + Math.PI / 2), UP, tier % 2 ? 0.25 : -0.25)), reach * 1.5, { stretch: reach / (reach * 1.5 * cell.aspect) });
    }
  }
  return leaves;
}

const norfolkPine = plant('tree-norfolk-pine', (m) => ({
  shapes: [shape(m, 'norfolk', () => norfolkShape(NORFOLK)), shape(m, 'norfolk-young', () => ({ ...norfolkShape(NORFOLK_YOUNG), far: [0.82, 0.73] }))],
  far: norfolkFar(NORFOLK),
  pick: (_x, _z, h) => (h < 0.65 ? 0 : 1),
  vary: { size: 0.1, height: 0.08, lean: 0.015, tone: 0.06 },
  collider: { radius: 0.4, height: 4 },
}));

// ───────────────────────────── Tufts and fountains ─────────────────────────────

interface CabbageSpec {
  seed: number;
  /** The trunk, to where it first forks. */
  trunk: Path;
  /** Arms: which arm (or -1 for the trunk's fork) each springs from, bearing, elevation, length, thickness. */
  arms: [from: number, az: number, el: number, length: number, radius: number][];
  /** Which arm ends carry a head of leaves (-1: the top of the trunk itself). */
  heads: number[];
  /** Size of a head. */
  tuft: [number, number];
}

const CABBAGE: CabbageSpec = {
  seed: 707,
  trunk: [{ p: [0, SUNK, 0], r: 0.3 }, { p: [0.01, 0.4, 0], r: 0.22 }, { p: [0.12, 2.4, 0.05], r: 0.19 }, { p: [0.22, 4.5, 0.06], r: 0.17 }],
  arms: [
    [-1, 0.4, 0.75, 1.5, 0.13],
    [-1, 2.6, 0.55, 1.3, 0.12],
    [-1, 4.5, 0.85, 1.0, 0.12],
    [0, 1.3, 0.6, 0.8, 0.09],
    [0, 5.8, 0.7, 0.9, 0.09],
    [2, 3.6, 0.6, 0.7, 0.09],
    [2, 5.2, 0.9, 0.9, 0.09],
  ],
  heads: [3, 4, 1, 5, 6],
  tuft: [1.75, 2.15],
};
/** A young tree that has not flowered yet, so has not branched: one stem, one big head. */
const CABBAGE_YOUNG: CabbageSpec = {
  seed: 733,
  trunk: [{ p: [0, SUNK, 0], r: 0.24 }, { p: [0, 0.4, 0], r: 0.17 }, { p: [-0.05, 1.5, 0.03], r: 0.15 }, { p: [-0.08, 2.7, 0.02], r: 0.14 }],
  arms: [],
  heads: [-1],
  tuft: [2.3, 2.6],
};
/** An old one: tall, leaning, a few heads on long bare arms. */
const CABBAGE_OLD: CabbageSpec = {
  seed: 761,
  trunk: [{ p: [0, SUNK, 0], r: 0.36 }, { p: [0.03, 0.4, 0], r: 0.26 }, { p: [0.3, 3.0, 0.1], r: 0.22 }, { p: [0.75, 5.6, 0.2], r: 0.19 }],
  arms: [
    [-1, 0.2, 0.9, 2.0, 0.14],
    [-1, 3.0, 0.5, 1.9, 0.13],
    [-1, 4.9, 1.0, 1.4, 0.12],
    [1, 2.2, 0.7, 1.1, 0.09],
    [1, 3.9, 0.6, 1.0, 0.09],
  ],
  heads: [0, 3, 4, 2],
  tuft: [1.7, 2.0],
};

const cabbageLeaves = (spec: CabbageSpec, r: Rng) => {
  const top = spec.trunk[spec.trunk.length - 1].p;
  const leaves = new Leaves([top[0], top[1] + 1, top[2]], 2.8, r, [1, 1, 1], 0.08);
  leaves.bend = 0.5;
  leaves.core = 0.75;
  return leaves;
};

/** The ends of a cabbage tree's arms, in the order of `spec.arms`; `tube` draws each. */
function cabbageArms(spec: CabbageSpec, tube: (path: Path) => void): V3[] {
  const fork = spec.trunk[spec.trunk.length - 1].p;
  const ends: V3[] = [];
  for (const [from, az, el, length, radius] of spec.arms) {
    const start = from < 0 ? fork : ends[from];
    const dir = polar(az, el);
    const mid = add(add(start, dir, length * 0.5), UP, length * 0.12);
    const end = add(add(start, dir, length), UP, length * 0.3);
    tube([{ p: start, r: radius }, { p: mid, r: radius * 0.85 }, { p: end, r: radius * 0.7 }]);
    ends.push(end);
  }
  return ends;
}

/** Tī kōuka, the cabbage tree: a bare corky trunk forking near the top into a few spiky heads. */
function cabbageShape(spec: CabbageSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  wood.tube(spec.trunk, 6);
  const ends = cabbageArms(spec, (path) => wood.tube(path, 5));
  const leaves = cabbageLeaves(spec, r);
  const cell = foliageCell('cabbage');
  for (const index of spec.heads) {
    const head = index < 0 ? spec.trunk[spec.trunk.length - 1].p : ends[index];
    const size = r.range(spec.tuft[0], spec.tuft[1]);
    const turn = r.range(0, Math.PI);
    for (let k = 0; k < 3; k++) leaves.card(cell, add(head, UP, 0.1), polar(turn + (k * Math.PI) / 3), UP, size, { mirror: k === 1 });
    // One more across the top, so the tuft is full from above and below.
    const tilt = norm(add(UP, r.unit(), 0.35));
    const flat = norm(cross(tilt, polar(turn)));
    leaves.card(cell, add(head, UP, 0.25), flat, norm(cross(flat, tilt)), size * 0.9, { turn: false });
  }
  return { wood, bark: 0x9a8c78, leaves };
}

function cabbageFar(spec: CabbageSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = cabbageLeaves(spec, r);
  leaves.turn = false;
  const bark = mul(lin(0x9a8c78), 0.7);
  leaves.solidTube([spec.trunk[0], spec.trunk[spec.trunk.length - 1]], 3, bark);
  // Only the arms thick enough to show at that distance.
  const ends = cabbageArms(spec, (path) => path[0].r > 0.1 && leaves.solidTube([path[0], path[2]], 3, bark));
  const cell = foliageCell('cabbage');
  spec.heads.forEach((index, n) => {
    const head = index < 0 ? spec.trunk[spec.trunk.length - 1].p : ends[index];
    for (let k = 0; k < 2; k++) leaves.card(cell, add(head, UP, 0.1), polar(n + (k * Math.PI) / 2), UP, spec.tuft[1]);
  });
  return leaves;
}

const cabbageTree = plant('tree-cabbage', (m) => ({
  shapes: [shape(m, 'cabbage', () => cabbageShape(CABBAGE)), shape(m, 'cabbage-young', () => ({ ...cabbageShape(CABBAGE_YOUNG), far: [0.9, 0.62] })), shape(m, 'cabbage-old', () => ({ ...cabbageShape(CABBAGE_OLD), far: [1.1, 1.25] }))],
  far: cabbageFar(CABBAGE),
  pick: (_x, _z, h) => (h < 0.5 ? 0 : h < 0.72 ? 1 : 2),
  near: 100,
  vary: { size: 0.14, height: 0.12, lean: 0.1, tone: 0.08 },
  collider: { radius: 0.25, height: 2.6 },
}));

interface PalmSpec {
  seed: number;
  /** Height of the crown of the trunk. */
  top: number;
  /** Fronds in the upright, spreading and drooping ranks. */
  fronds: [number, number, number];
}

const PALM: PalmSpec = { seed: 808, top: 5.4, fronds: [10, 15, 15] };
const PALM_TALL: PalmSpec = { seed: 839, top: 7.6, fronds: [9, 14, 13] };

const palmLeaves = (spec: PalmSpec, r: Rng) => {
  const leaves = new Leaves([0, spec.top - 1, 0], 5.6, r, [1, 1, 1]);
  leaves.bend = 0.45;
  leaves.upward = 0.5;
  leaves.core = 0.62;
  leaves.sway = 0.6;
  return leaves;
};
const palmTrunk = (top: number): Path => [{ p: [0, SUNK, 0], r: 0.7 }, { p: [0, 0.5, 0], r: 0.54 }, { p: [0, top - 1.8, 0], r: 0.5 }, { p: [0, top - 0.6, 0], r: 0.64 }, { p: [0, top, 0], r: 0.7 }, { p: [0, top + 0.3, 0], r: 0.25 }];

/** Canary Island date palm: a stout trunk, a pineapple of old leaf bases, a fountain of arching fronds. */
function palmShape(spec: PalmSpec): Built {
  const r = rng(spec.seed);
  const wood = new Wood();
  const top = spec.top;
  wood.tube(palmTrunk(top), 9);
  const leaves = palmLeaves(spec, r);
  const cell = foliageCell('palm');
  const frond = (az: number, el: number, length: number) => {
    const out = polar(az);
    const roll = r.range(-0.5, 0.5);
    const flat = polar(az + Math.PI / 2);
    const across = norm(add(mul(flat, Math.cos(roll)), UP, Math.sin(roll)));
    const width = length * 0.4;
    // Leaves the crown at `el`, then arcs over under its own weight.
    const spine: { p: V3; across: V3; width: number }[] = [];
    let p: V3 = [out[0] * 0.25, top + 0.05, out[2] * 0.25];
    let angle = el;
    const segments = 3;
    for (let i = 0; i <= segments; i++) {
      spine.push({ p, across, width: width * (i === 0 ? 0.6 : 1) });
      p = add(p, add(mul(out, Math.cos(angle)), UP, Math.sin(angle)), length / segments);
      angle -= 0.36 + (1.2 - el) * 0.14;
    }
    leaves.ribbon(cell, spine);
  };
  for (let i = 0; i < spec.fronds[0]; i++) frond(i * GOLDEN, r.range(1, 1.35), r.range(3.8, 4.4));
  for (let i = 0; i < spec.fronds[1]; i++) frond(i * GOLDEN + 0.7, r.range(0.5, 0.85), r.range(4.4, 5));
  for (let i = 0; i < spec.fronds[2]; i++) frond(i * GOLDEN + 1.9, r.range(-0.05, 0.32), r.range(4.2, 4.8));
  return { wood, bark: 0x7a6a55, leaves };
}

function palmFar(spec: PalmSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = palmLeaves(spec, r);
  leaves.turn = false;
  const top = spec.top;
  leaves.solidTube([{ p: [0, SUNK, 0], r: 0.62 }, { p: [0, top - 1.2, 0], r: 0.5 }, { p: [0, top + 0.2, 0], r: 0.6 }], 5, mul(lin(0x7a6a55), 0.7));
  const cell = foliageCell('palm');
  for (let i = 0; i < 9; i++) {
    const az = i * GOLDEN;
    const el = i < 3 ? 0.9 : i < 6 ? 0.35 : -0.25;
    const out = polar(az, el);
    const length = 4.6;
    leaves.card(cell, [out[0] * 0.2, top + 0.1, out[2] * 0.2], out, norm(add(polar(az + Math.PI / 2), UP, r.range(-0.4, 0.4))), length / cell.aspect, { stretch: 1.25 });
  }
  return leaves;
}

const phoenixPalm = plant('tree-phoenix-palm', (m) => ({
  shapes: [shape(m, 'palm', () => palmShape(PALM)), shape(m, 'palm-tall', () => ({ ...palmShape(PALM_TALL), far: [1, 1.36] }))],
  far: palmFar(PALM),
  vary: { size: 0.1, height: 0.1, lean: 0.04, tone: 0.06 },
  collider: { radius: 0.5, height: 5 },
}));

// ───────────────────────────── Low plants ─────────────────────────────

/** Upright cards crossing near one point: `count` of them, turned evenly round the compass. */
function fans(leaves: Leaves, r: Rng, cell: FoliageCell, count: number, height: [number, number], o: { at?: V3; offset?: number; lean?: number; turn?: number; stretch?: number } = {}) {
  const at = o.at ?? [0, 0, 0];
  const turn = o.turn ?? r.range(0, Math.PI);
  for (let i = 0; i < count; i++) {
    const az = turn + (i / count) * Math.PI + r.range(-0.12, 0.12);
    const right = polar(az);
    const side = polar(az + Math.PI / 2);
    const s = i % 2 ? 1 : -1;
    const up = norm(add(UP, side, s * (o.lean ?? 0)));
    leaves.card(cell, add(at, side, s * (o.offset ?? 0) * r.range(0.4, 1)), right, up, r.range(height[0], height[1]), { stretch: o.stretch });
  }
}

/** A plant that is only a few fans of one or two pictures: flax, toetoe, tussock, grass. */
interface FanSpec {
  seed: number;
  /** Each: picture, how many cards, their height, how far off centre they stand, how far they lean out. */
  fans: [cell: string, count: number, height: [number, number], offset: number, lean: number][];
}

function fanLeaves(r: Rng, o: { centre: V3; radius: number; tint?: Tint; vary?: number; bend?: number; upward?: number; core?: number; sway?: number }): Leaves {
  const leaves = new Leaves(o.centre, o.radius, r, o.tint ?? [1, 1, 1], o.vary ?? 0.1);
  leaves.bend = o.bend ?? 0.6;
  leaves.upward = o.upward ?? 0.3;
  leaves.core = o.core ?? 0.7;
  leaves.sway = o.sway ?? 1;
  return leaves;
}

function fanShape(spec: FanSpec, look: Parameters<typeof fanLeaves>[1]): Built {
  const r = rng(spec.seed);
  const leaves = fanLeaves(r, look);
  for (const [cell, count, height, offset, lean] of spec.fans) fans(leaves, r, foliageCell(cell, 'grass'), count, height, { offset, lean });
  return { leaves };
}

function fanFar(seed: number, look: Parameters<typeof fanLeaves>[1], cell: string, h: number, extra?: [cell: string, h: number]): Leaves {
  const leaves = fanLeaves(rng(seed + 7), look);
  leaves.turn = false;
  crossed(leaves, foliageCell(cell, 'grass'), h);
  if (extra) leaves.card(foliageCell(extra[0]), [0, 0, 0], polar(2.1), UP, extra[1], { turn: false });
  return leaves;
}

const FLAX_LOOK = { centre: [0, -0.6, 0] as V3, radius: 2.8, vary: 0.12 };
/** Harakeke: a clump of stiff sword leaves with kōrari (flower stalks) standing well above them. */
const flax = plant('flax', (m) => ({
  shapes: [
    shape(m, 'flax', () => fanShape({ seed: 909, fans: [['flax', 5, [1.9, 2.3], 0.3, 0.14], ['flax', 3, [1.5, 1.8], 0.55, 0.32], ['flax-flower', 2, [3.1, 3.6], 0.1, 0.06]] }, FLAX_LOOK)),
    // A bigger clump that is not flowering this year.
    shape(m, 'flax-plain', () => ({ ...fanShape({ seed: 937, fans: [['flax', 6, [2.1, 2.6], 0.35, 0.16], ['flax', 4, [1.6, 2.0], 0.7, 0.36]] }, FLAX_LOOK), far: [1.15, 0.78] })),
    // A smaller, yellower one with a single stalk.
    shape(m, 'flax-small', () => ({ ...fanShape({ seed: 953, fans: [['flax', 4, [1.4, 1.7], 0.22, 0.14], ['flax', 3, [1.1, 1.4], 0.45, 0.34], ['flax-flower', 1, [2.4, 2.7], 0.05, 0.05]] }, { ...FLAX_LOOK, tint: [1.1, 1.02, 0.8] }), far: [0.75, 0.76], farTint: [1.1, 1.02, 0.8] })),
  ],
  far: fanFar(909, FLAX_LOOK, 'flax', 2.1, ['flax-flower', 3.3]),
  near: 70,
  reach: 520,
  vary: { size: 0.15, height: 0.1, lean: 0.06, tone: 0.1 },
  farShadow: false,
  minor: true,
}));

const TOETOE_LOOK = { centre: [0, -1, 0] as V3, radius: 3.2, upward: 0.5, core: 0.75 };
/** Toetoe: a big arching tussock with tall cream plumes; riverbeds, drains and swampy corners. */
const toetoe = plant('toetoe', (m) => ({
  shapes: [
    shape(m, 'toetoe', () => fanShape({ seed: 1212, fans: [['toetoe', 4, [2.5, 3], 0.2, 0.12], ['toetoe', 2, [1.9, 2.3], 0.5, 0.3]] }, TOETOE_LOOK)),
    shape(m, 'toetoe-wide', () => ({ ...fanShape({ seed: 1237, fans: [['toetoe', 4, [2.1, 2.5], 0.35, 0.2], ['toetoe', 3, [1.7, 2.1], 0.7, 0.36]] }, TOETOE_LOOK), far: [1.2, 0.85] })),
  ],
  far: fanFar(1212, TOETOE_LOOK, 'toetoe', 2.8),
  near: 70,
  reach: 520,
  vary: { size: 0.15, height: 0.1, lean: 0.05, tone: 0.08 },
  minor: true,
  castShadow: false,
}));

const TUFT: FanSpec['fans'] = [['grass', 3, [0.75, 0.95], 0.12, 0.2], ['grass', 2, [0.6, 0.75], 0.45, 0.35]];
const TUFT_FULL: FanSpec['fans'] = [['grass', 4, [0.8, 1.05], 0.15, 0.18], ['grass', 3, [0.6, 0.8], 0.5, 0.4]];
const TUFT_LOW: FanSpec['fans'] = [['grass', 3, [0.5, 0.65], 0.2, 0.3], ['grass', 3, [0.4, 0.55], 0.5, 0.5]];
const TUFT_LOOK = { centre: [0, -2, 0] as V3, radius: 3, bend: 0.7, upward: 1, core: 0.85 };

/** A tuft of long seeding grass for road verges, fence lines and anywhere the mower misses. */
const grassTuft = plant('grass-tuft', (m) => ({
  shapes: [
    shape(m, 'grass-tuft', () => fanShape({ seed: 1313, fans: TUFT }, TUFT_LOOK)),
    shape(m, 'grass-tuft-full', () => ({ ...fanShape({ seed: 1327, fans: TUFT_FULL }, TUFT_LOOK), far: [1.2, 1.1] })),
    shape(m, 'grass-tuft-low', () => ({ ...fanShape({ seed: 1361, fans: TUFT_LOW }, TUFT_LOOK), far: [1.1, 0.68] })),
  ],
  far: fanFar(1313, TUFT_LOOK, 'grass', 0.9),
  near: 55,
  reach: 260,
  vary: { size: 0.2, height: 0.15, lean: 0.08, tone: 0.12 },
  minor: true,
  castShadow: false,
}));

/**
 * The same tufts with their own straw colour cancelled, so the instance tint is the colour (pale tussock on
 * the hills, marram on the dunes, green rank grass by a drain).
 */
const tussock = plant('tussock', (m) => {
  const mean = foliageCell('grass').mean;
  const k = 0.62;
  const look = { ...TUFT_LOOK, tint: [k / mean[0], k / mean[1], k / mean[2]] as Tint };
  return {
    shapes: [
      shape(m, 'tussock', () => fanShape({ seed: 1313, fans: TUFT }, look)),
      shape(m, 'tussock-full', () => ({ ...fanShape({ seed: 1327, fans: TUFT_FULL }, look), far: [1.2, 1.1] })),
      shape(m, 'tussock-low', () => ({ ...fanShape({ seed: 1361, fans: TUFT_LOW }, look), far: [1.1, 0.68] })),
    ],
    far: fanFar(1313, look, 'grass', 0.9),
    near: 55,
    reach: 300,
    vary: { size: 0.22, height: 0.15, lean: 0.08, tone: 0.14 },
    minor: true,
    castShadow: false,
  };
});

const LUPIN_LOOK = { centre: [0, -1.5, 0] as V3, radius: 3, vary: 0.06, upward: 0.8, core: 0.9 };
/** Russell lupins: a mound of hand-shaped leaves under purple, blue, pink and white spikes. Braided riverbeds. */
const lupin = plant('lupin', (m) => ({
  shapes: [
    shape(m, 'lupin', () => fanShape({ seed: 1515, fans: [['lupin', 3, [1.05, 1.25], 0.15, 0.1], ['lupin', 2, [0.85, 1], 0.5, 0.25]] }, LUPIN_LOOK)),
    shape(m, 'lupin-wide', () => ({ ...fanShape({ seed: 1543, fans: [['lupin', 3, [0.9, 1.1], 0.3, 0.2], ['lupin', 3, [0.75, 0.9], 0.7, 0.3]] }, LUPIN_LOOK), far: [1.25, 0.86] })),
  ],
  far: fanFar(1515, LUPIN_LOOK, 'lupin', 1.15),
  near: 60,
  reach: 320,
  vary: { size: 0.18, height: 0.12, lean: 0.05, tone: 0.06 },
  minor: true,
  castShadow: false,
}));

/**
 * A run of rank grass 2 m long, lying along x: the strip the mower and the stock cannot reach under a fence,
 * along a kerbless verge or down a riverbank. Laid end to end like a hedge. Fine detail: near the camera
 * only, and only at High quality and above.
 */
const grassRun = plant('grass-long', (m) => {
  const cell = foliageCell('grass-long', 'grass');
  const build = (seed: number, height: number, tint: Tint): Built => {
    const r = rng(seed);
    const leaves = fanLeaves(r, { ...TUFT_LOOK, tint, vary: 0.12 });
    const wide = hasFoliageCell('grass-long') ? 2.15 / (height * cell.aspect) : 1;
    // Three rows, staggered, each leaning its own way, and two short ones across the ends.
    for (const [z, lean, shift] of [[-0.14, -0.22, -0.3], [0.02, 0.06, 0.25], [0.16, 0.26, -0.1]]) {
      leaves.card(cell, [shift, 0, z], [1, 0, r.range(-0.12, 0.12)], norm([0, 1, lean]), height * r.range(0.85, 1.1), { stretch: wide });
    }
    for (const x of [-0.7, 0.75]) leaves.card(foliageCell('grass'), [x, 0, 0], [r.range(-0.3, 0.3), 0, 1], norm([r.range(-0.2, 0.2), 1, 0]), height * 1.05);
    return { leaves };
  };
  return {
    shapes: [shape(m, 'grass-long', () => build(1616, 0.72, [1, 1, 1])), shape(m, 'grass-long-green', () => build(1637, 0.6, [0.82, 1.02, 0.8]))],
    far: null,
    near: 75,
    reach: 75,
    vary: { size: 0.12, height: 0.2, lean: 0.03, tone: 0.12 },
    fine: true,
    minor: true,
    castShadow: false,
  };
});

// ───────────────────────────── Shrubs ─────────────────────────────

interface MoundSpec {
  seed: number;
  pictures: string[];
  /** Middle of the dome and its radii. */
  centre: V3;
  rx: number;
  ry: number;
  /** Clumps over the dome, cards in each, their size. */
  ends: number;
  cards: number;
  size: [number, number];
  /** Lowest clump, as the sine of its elevation from the middle (default 0: the dome's waist). */
  low?: number;
  fins?: number;
  tint?: Tint;
  vary?: number;
  core?: number;
  sway?: number;
  /** A few woody stems showing at the foot. */
  stems?: number;
  bark?: number;
}

const moundLeaves = (spec: MoundSpec, r: Rng) => {
  const leaves = new Leaves([spec.centre[0], spec.centre[1] - spec.ry * 0.5, spec.centre[2]], Math.max(spec.rx, spec.ry) * 1.7, r, spec.tint ?? [1, 1, 1], spec.vary ?? 0.14);
  leaves.core = spec.core ?? 0.52;
  leaves.upward = 0.4;
  leaves.sway = spec.sway ?? 0.5;
  leaves.hue = 0.06;
  return leaves;
};

/**
 * A shrub as a rounded mass: clumps of cards shingled over a dome, their normals bent out from its middle so
 * it lights as one rounded thing, with a darker heart showing between them.
 */
function mound(spec: MoundSpec): Built {
  const r = rng(spec.seed);
  const leaves = moundLeaves(spec, r);
  const pictures = spec.pictures.map((name) => foliageCell(name, 'shrub'));
  const low = spec.low ?? 0;
  for (let i = 0; i < spec.ends; i++) {
    const sinEl = low + (0.97 - low) * ((i + 0.5) / spec.ends);
    const az = i * GOLDEN + r.range(-0.3, 0.3);
    const flat = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const k = r.range(0.85, 1.1);
    const p: V3 = [spec.centre[0] + Math.cos(az) * flat * spec.rx * k, spec.centre[1] + sinEl * spec.ry * k, spec.centre[2] + Math.sin(az) * flat * spec.rx * k];
    const out = norm(sub(p, spec.centre));
    leaves.clump(pictures, mix(spec.centre, p, 0.62), out, spec.cards, spec.size, { lean: add(UP, out, 0.5), fins: spec.fins ?? 0.25, flare: 0.5 });
  }
  let wood: Wood | null = null;
  if (spec.stems) {
    wood = new Wood();
    for (let i = 0; i < spec.stems; i++) {
      const az = (i / spec.stems) * Math.PI * 2 + r.range(-0.4, 0.4);
      const out = polar(az);
      const reach = spec.rx * r.range(0.35, 0.6);
      wood.tube([{ p: [out[0] * 0.05, SUNK * 0.4, out[2] * 0.05], r: 0.035 }, { p: [out[0] * reach * 0.4, spec.centre[1] * 0.5, out[2] * reach * 0.4], r: 0.028 }, { p: [out[0] * reach, spec.centre[1] * 0.95, out[2] * reach], r: 0.014 }], 3);
    }
  }
  return { wood, bark: spec.bark ?? 0x5a4a3c, leaves };
}

function moundFar(spec: MoundSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = moundLeaves(spec, r);
  leaves.turn = false;
  const picture = foliageCell(spec.pictures[0], 'shrub');
  const tall = (spec.centre[1] + spec.ry) * 1.12;
  crossed(leaves, picture, tall, { stretch: (spec.rx * 2.5) / (tall * picture.aspect) });
  // And one over the top, for looking down on it.
  leaves.card(picture, [0, spec.centre[1] + spec.ry * 0.3, spec.rx * 1.1], [1, 0, 0], [0, 0.12, -1], spec.rx * 2.2, { turn: false });
  return leaves;
}

/** A garden shrub of no particular kind: small dark leaves, clipped by nobody. */
const SHRUB: MoundSpec = { seed: 1010, pictures: ['shrub'], centre: [0, 0.62, 0], rx: 0.72, ry: 0.62, ends: 9, cards: 2, size: [0.8, 1.05], tint: [0.8, 0.74, 0.86], stems: 3 };
/** The same, grown tall and loose. */
const SHRUB_TALL: MoundSpec = { ...SHRUB, seed: 1033, centre: [0.05, 0.95, 0], rx: 0.56, ry: 0.95, ends: 10, size: [0.85, 1.1], fins: 0.4, low: -0.45 };
/** Hydrangea: a broad low mound of big leaves under mop heads of blue and mauve. */
const HYDRANGEA: MoundSpec = { seed: 1061, pictures: ['hydrangea'], centre: [0, 0.55, 0], rx: 0.85, ry: 0.55, ends: 9, cards: 2, size: [0.8, 1.0], fins: 0.2, stems: 0, core: 0.6 };
/** Rhododendron: a big dark dome, trusses of pink flower over it. */
const RHODODENDRON: MoundSpec = { seed: 1087, pictures: ['rhododendron'], centre: [0, 0.85, 0], rx: 0.95, ry: 0.85, ends: 11, cards: 2, size: [0.9, 1.2], fins: 0.2, stems: 3, core: 0.5, low: -0.3 };

const moundShape = (m: MaterialLibrary, key: string, spec: MoundSpec, far?: [number, number], farTint?: Tint) => shape(m, key, () => ({ ...mound(spec), far, farTint }));
// As stand-ins among other bushes these two borrow the plain shrub's, stretched and tinted to suit.
const hydrangeaShape = (m: MaterialLibrary) => moundShape(m, 'hydrangea', HYDRANGEA, [1.15, 0.9], [0.95, 1, 1.25]);
const rhododendronShape = (m: MaterialLibrary) => moundShape(m, 'rhododendron', RHODODENDRON, [1.3, 1.35], [1.05, 0.9, 1]);
const SHRUB_VARY = { size: 0.18, height: 0.14, lean: 0.04, tone: 0.12 };

/**
 * `bush` is whatever grows in a front garden: mostly plain shrubs, round or leggy, with a hydrangea or a
 * rhododendron among them.
 */
const bush = plant('bush', (m) => ({
  shapes: [moundShape(m, 'shrub', SHRUB), moundShape(m, 'shrub-tall', SHRUB_TALL, [0.8, 1.5]), hydrangeaShape(m), rhododendronShape(m)],
  far: moundFar(SHRUB),
  pick: (_x, _z, h) => (h < 0.42 ? 0 : h < 0.66 ? 1 : h < 0.84 ? 2 : 3),
  near: 70,
  reach: 520,
  vary: SHRUB_VARY,
  farShadow: false,
  minor: true,
}));
const hydrangea = plant('shrub-hydrangea', (m) => ({ shapes: [{ parts: hydrangeaShape(m).parts }], far: moundFar(HYDRANGEA), near: 70, reach: 520, vary: SHRUB_VARY, farShadow: false, minor: true }));
const rhododendron = plant('shrub-rhododendron', (m) => ({ shapes: [{ parts: rhododendronShape(m).parts }], far: moundFar(RHODODENDRON), near: 70, reach: 520, vary: SHRUB_VARY, farShadow: false, minor: true }));

/** Gorse in flower: a dense, dark, prickly mound; hillsides, riverbeds and neglected fence lines. */
const GORSE: MoundSpec = { seed: 1414, pictures: ['gorse'], centre: [0, 0.75, 0], rx: 0.95, ry: 0.78, ends: 9, cards: 2, size: [1.15, 1.5], fins: 0.3, vary: 0.1, core: 0.55, sway: 0.4 };
const GORSE_TALL: MoundSpec = { ...GORSE, seed: 1447, centre: [0.1, 1.1, 0], rx: 0.8, ry: 1.1, ends: 10, size: [1.2, 1.6], low: -0.5 };
const gorse = plant('gorse', (m) => ({
  shapes: [moundShape(m, 'gorse', GORSE), moundShape(m, 'gorse-tall', GORSE_TALL, [0.86, 1.42])],
  far: moundFar(GORSE),
  near: 70,
  reach: 600,
  vary: { size: 0.22, height: 0.15, lean: 0.04, tone: 0.1 },
  farShadow: false,
  minor: true,
}));

/** Broom: whippy green stems standing straight up, yellow with flower from top to bottom in early summer. */
const BROOM: MoundSpec = { seed: 1717, pictures: ['broom', 'gorse'], centre: [0, 1.05, 0], rx: 0.6, ry: 1.0, ends: 9, cards: 2, size: [1.3, 1.7], fins: 0.45, vary: 0.1, core: 0.6, sway: 0.9, low: -0.75 };
const BROOM_SPREADING: MoundSpec = { ...BROOM, seed: 1741, centre: [0, 0.85, 0], rx: 0.9, ry: 0.8, size: [1.2, 1.5], low: -0.45 };
const broom = plant('broom', (m) => ({
  shapes: [moundShape(m, 'broom', BROOM), moundShape(m, 'broom-spreading', BROOM_SPREADING, [1.4, 0.8])],
  far: moundFar(BROOM),
  near: 70,
  reach: 600,
  vary: { size: 0.22, height: 0.15, lean: 0.06, tone: 0.1 },
  farShadow: false,
  minor: true,
}));

/** A bush rose in flower. The shapes are the colours: a bed of them comes up mixed. */
const rose = (colour: string, seed: number): MoundSpec => ({ seed, pictures: [`rose-${colour}`], centre: [0, 0.55, 0], rx: 0.5, ry: 0.55, ends: 7, cards: 2, size: [0.7, 0.9], fins: 0.4, stems: 3, bark: 0x4f5a36, core: 0.62, vary: 0.1 });
const roseBush = plant('rose-bush', (m) => ({
  shapes: [moundShape(m, 'rose-red', rose('red', 1818)), moundShape(m, 'rose-pink', rose('pink', 1831)), moundShape(m, 'rose-yellow', rose('yellow', 1847))],
  far: moundFar(rose('pink', 1831)),
  near: 60,
  reach: 320,
  vary: { size: 0.14, height: 0.12, lean: 0.04, tone: 0.06 },
  farShadow: false,
  minor: true,
}));

// ───────────────────────────── Bedding ─────────────────────────────

const BEDDING = ['red', 'gold', 'blue', 'white'];

const bedLeaves = (r: Rng, radius: number) => {
  const leaves = new Leaves([0, -0.6, 0], radius, r, [1, 1, 1], 0.08);
  leaves.bend = 0.5;
  leaves.upward = 1.2;
  leaves.core = 0.9;
  leaves.sway = 0.25;
  leaves.floor = 0.01;
  return leaves;
};

/**
 * Bedding plants massed in a drift about `a` by `b` metres (half-axes along x and z), `height` high. Every
 * card stands on the soil and leans out from the middle, more steeply ring by ring, so they lap over one
 * another like the plants do: from above you look down onto their faces, from the side along their tops.
 * The inner rings start a little higher, so the drift domes up in the middle. `y0` lifts the lot (for a tub).
 */
function bedding(leaves: Leaves, r: Rng, picture: FoliageCell, a: number, b: number, height: number, y0 = 0, rings: [number, number, number, number][] = BED_RINGS) {
  for (const [rho, count, lean, lift] of rings) {
    const turn = r.range(0, 6.3);
    for (let i = 0; i < count; i++) {
      const az = turn + ((i + r.range(-0.2, 0.2)) / count) * Math.PI * 2;
      const out = norm([Math.cos(az) / a, 0, Math.sin(az) / b]);
      const tall = height * r.range(1.15, 1.4);
      // Every other card stands nearly upright: those are what a low camera sees, the leaning ones what a high one does.
      const tilt = i % 2 ? 0.3 : lean * r.range(0.9, 1.1);
      leaves.card(picture, [Math.cos(az) * a * rho, y0 + lift * height * (i % 2 ? 0.5 : 1), Math.sin(az) * b * rho], cross(UP, out), norm(add(UP, out, tilt)), tall * (i % 2 ? 0.9 : 1), { turn: false });
    }
  }
}
/** Rings of a bed, outside in: distance out (0..1), cards, lean (tangent of the angle from upright), lift (in bed heights). */
const BED_RINGS: [number, number, number, number][] = [[0.95, 12, 1.3, 0], [0.64, 10, 1.7, 0.3], [0.34, 6, 1.7, 0.5], [0.08, 3, 1.3, 0.62]];

/**
 * A drift of summer bedding, about 2.2 m by 1.3 m and ankle high, to be set out side by side in a dug bed:
 * scarlet salvias, marigolds, blue lobelia or white alyssum, one colour to a drift.
 */
const flowerBed = plant('flower-bed', (m) => {
  const build = (colour: string, seed: number) =>
    shape(m, `bed-${colour}`, () => {
      const r = rng(seed);
      const leaves = bedLeaves(r, 2.4);
      bedding(leaves, r, foliageCell(`bed-${colour}`, 'lupin'), 1.1, 0.65, 0.34);
      return { leaves };
    });
  const far = bedLeaves(rng(1907), 2.4);
  far.turn = false;
  // The white bed stands in for all four: tinted, its flowers take the colour.
  const picture = foliageCell('bed-white', 'lupin');
  far.card(picture, [0, 0.24, 0.7], [1, 0, 0], [0, 0.04, -1], 1.4, { stretch: 2.3 / (1.4 * picture.aspect), turn: false });
  crossed(far, picture, 0.36, { stretch: 1.6 / (0.36 * picture.aspect), turn: 0 });
  return {
    shapes: BEDDING.map((colour, i) => ({ ...build(colour, 1901 + i * 13), farTint: ([[1.1, 0.28, 0.24], [1.15, 0.8, 0.2], [0.4, 0.42, 1.1], [1, 1, 1]] as Tint[])[i] })),
    far,
    near: 60,
    reach: 300,
    vary: { size: 0.08, height: 0.15, lean: 0, tone: 0.05 },
    minor: true,
    castShadow: false,
    farShadow: false,
  };
});

/** Height of the soil in a street planter tub: `planter-plants` grow from here, not from the ground. */
export const PLANTER_SOIL = 0.62;

/**
 * What grows in a street planter: a shrub in the middle and bedding round it, for a tub about 1.8 m across
 * and 0.7 m high. Place it on the same spot as the tub; it starts at the soil (`PLANTER_SOIL`).
 */
const planterPlants = plant('planter-plants', (m) => {
  const build = (key: string, seed: number, centrepiece: MoundSpec | null, colour: string) =>
    shape(m, `planter-${key}`, () => {
      const r = rng(seed);
      let built: Built;
      if (centrepiece) built = mound({ ...centrepiece, seed, centre: add(centrepiece.centre, [0, PLANTER_SOIL - 0.05, 0]), stems: 0 });
      else {
        // A young cabbage tree's worth of flax instead of a shrub.
        const leaves = fanLeaves(r, { centre: [0, PLANTER_SOIL - 0.6, 0], radius: 2.6, vary: 0.12 });
        leaves.floor = PLANTER_SOIL;
        fans(leaves, r, foliageCell('flax'), 4, [1.25, 1.55], { at: [0, PLANTER_SOIL, 0], offset: 0.12, lean: 0.16 });
        built = { leaves };
      }
      built.leaves.floor = PLANTER_SOIL;
      bedding(built.leaves, r, foliageCell(`bed-${colour}`, 'lupin'), 0.78, 0.78, 0.26, PLANTER_SOIL, [[0.95, 10, 1.3, 0], [0.5, 6, 1.4, 0.25]]);
      return { leaves: built.leaves };
    });
  const far = moundLeaves({ ...SHRUB, centre: [0, PLANTER_SOIL + 0.5, 0] }, rng(2011));
  far.turn = false;
  far.floor = PLANTER_SOIL;
  crossed(far, foliageCell('shrub'), 1.25, { at: [0, PLANTER_SOIL, 0], stretch: 1.3 });
  return {
    shapes: [
      build('shrub', 2003, { ...SHRUB, rx: 0.5, ry: 0.5, centre: [0, 0.5, 0], ends: 7, size: [0.6, 0.8] }, 'red'),
      build('hydrangea', 2017, { ...HYDRANGEA, rx: 0.55, ry: 0.42, centre: [0, 0.42, 0], ends: 7, size: [0.6, 0.78] }, 'white'),
      build('flax', 2029, null, 'gold'),
      build('rose', 2039, { ...rose('pink', 2039), rx: 0.45, ry: 0.5, centre: [0, 0.5, 0] }, 'blue'),
    ],
    far,
    near: 60,
    reach: 320,
    vary: { size: 0.06, height: 0.1, lean: 0, tone: 0.06 },
    farShadow: false,
  };
});

// ───────────────────────────── Hedges ─────────────────────────────

const X: V3 = [1, 0, 0];
const Z: V3 = [0, 0, 1];

interface HedgeSpec {
  seed: number;
  /** Size of the clipped block: length along x, height, thickness. */
  length: number;
  height: number;
  thick: number;
  /** Picture of the face, how tall one copy of it stands, and of the sprigs that break the outline. */
  face: string;
  tile: number;
  sprig: string;
  sprigSize: [number, number];
  sprigs: number;
  /** How far the top edge is from level (the shaggier, the more). */
  ragged: number;
  /** Layers of cards on each face (default 1). */
  courses?: number;
  heart: number;
  tint: Tint;
}

const hedgeLeaves = (spec: HedgeSpec, r: Rng) => {
  const leaves = new Leaves([0, spec.height * 0.15, 0], Math.max(spec.height, spec.thick) * 1.1, r, spec.tint, 0.1);
  leaves.bend = 0.35;
  leaves.core = 0.8;
  leaves.sway = 0.12;
  leaves.turn = false;
  return leaves;
};

/**
 * A length of clipped hedge along x. A plain dark heart keeps it solid; leaf cards stand just proud of every
 * face and overhang the edges, and bosses and sprigs stand out of those, so the outline is leaves rather
 * than a box and the faces are not planes.
 */
function hedgeShape(spec: HedgeSpec): Built {
  const r = rng(spec.seed);
  const leaves = hedgeLeaves(spec, r);
  const { length: l, height: h, thick: d } = spec;
  leaves.solidBox(0, 0, l - 0.02, 0, h - 0.04, d - 0.02, lin(spec.heart));
  const face = foliageCell(spec.face);
  const tuft = foliageCell(spec.sprig);
  // The picture's leaves stop short of its edges (a ragged top, ragged ends), so every card is bigger than the
  // face it covers: the leaves, not the card, end at the corner. In a run the overhang laps onto the next unit.
  const rows = Math.max(1, Math.round(h / spec.tile));
  const cols = Math.max(1, Math.round(l / (spec.tile * face.aspect * 0.8)));
  const tall = (h / rows) * 1.38;
  const wide = (l / cols) * 1.25;
  for (const s of [1, -1]) {
    // A second course of cards, laid like bricks over the joints of the first, where the picture has open corners.
    for (let k = 0; k < (spec.courses ?? 1) - 1; k++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = (col / cols - 0.5) * l * 0.92;
          leaves.card(face, [x, Math.min(h - tall * 0.8, ((row + 0.5) / rows) * h), s * (d / 2 + 0.2)], norm([s, 0, 0]), norm([0, 1, -s * 0.05]), tall * 0.95, { stretch: wide / (tall * face.aspect), shade: 1.05 });
        }
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ((col + 0.5) / cols - 0.5) * l;
        // A touch off vertical so the hedge is narrower at the top, the way they are clipped, and turned a hair
        // so where two cards overlap one lies clearly in front.
        leaves.card(face, [x, (row / rows) * h * 0.98, s * (d / 2 + 0.1 - row * 0.03)], norm([s, 0, 0.035 * (col % 2 ? -1 : 1)]), norm([0, 1, -s * 0.06]), tall, { stretch: wide / (tall * face.aspect), mirror: (row + col) % 2 === 1 });
      }
    }
  }
  // Top: two cards a side, each with its foot on the middle line and its ragged edge hanging over the face.
  for (let col = 0; col < cols; col++) {
    const x = ((col + 0.5) / cols - 0.5) * l;
    const deep = d / 2 + 0.3;
    for (const s of [1, -1]) leaves.card(face, [x, h + 0.02 + (s > 0 ? 0.012 : 0), -s * 0.06], mul(X, -s), [0, -0.04, s], deep, { stretch: wide / (deep * face.aspect) });
  }
  // Ends.
  for (const s of [1, -1]) for (let row = 0; row < rows; row++) leaves.card(face, [s * (l / 2 + 0.02), (row / rows) * h * 0.98, 0], mul(Z, -s), UP, tall, { stretch: (d + 0.43) / (tall * face.aspect) });
  // Sprigs standing out of the top and bosses out of the faces to break the planes.
  for (let i = 0; i < spec.sprigs; i++) {
    const x = (-0.5 + (i + 0.5) / spec.sprigs) * (l - 0.3) + r.range(-0.1, 0.1);
    const s = i % 2 ? 1 : -1;
    const size = r.range(spec.sprigSize[0], spec.sprigSize[1]);
    leaves.card(tuft, [x, h - size * 0.62 + r.range(-0.5, 1) * spec.ragged, s * d * 0.3], polar(r.range(-0.5, 0.5)), norm([r.range(-0.2, 0.2), 1, s * 0.35]), size);
    const y = r.range(0.25, 0.7) * h;
    leaves.card(tuft, [x + r.range(-0.3, 0.3), y - size * 0.45, -s * (d / 2 + 0.02)], norm([1, 0, r.range(-0.2, 0.2)]), norm([r.range(-0.2, 0.2), 1, -s * 0.5]), size * 0.9, { shade: 1.08 });
  }
  return { leaves };
}

function hedgeFar(spec: HedgeSpec): Leaves {
  const r = rng(spec.seed + 7);
  const leaves = hedgeLeaves(spec, r);
  const { length: l, height: h, thick: d } = spec;
  leaves.solidBox(0, 0, l - 0.04, 0, h - 0.06, d - 0.04, mul(lin(spec.heart), 1.6));
  const face = foliageCell(spec.face);
  for (const s of [1, -1]) leaves.card(face, [0, 0, s * (d / 2 + 0.08)], [s, 0, 0], norm([0, 1, -s * 0.05]), h * 1.36, { stretch: (l * 1.25) / (h * 1.36 * face.aspect), mirror: false });
  for (const s of [1, -1]) leaves.card(face, [0, h + 0.02, -s * 0.06], mul(X, -s), [0, -0.04, s], d / 2 + 0.28, { stretch: (l * 1.25) / ((d / 2 + 0.28) * face.aspect) });
  return leaves;
}

/** 2 m of clipped garden hedge along x. */
const HEDGE: HedgeSpec = { seed: 1111, length: 2, height: 1.2, thick: 0.64, face: 'hedge', tile: 1.2, sprig: 'shrub', sprigSize: [0.55, 0.7], sprigs: 6, ragged: 0.04, heart: 0x1f3a1c, tint: [0.66, 0.6, 0.7] };
/** The same hedge a month after its last cut. */
const HEDGE_SHAGGY: HedgeSpec = { ...HEDGE, seed: 1129, sprigSize: [0.62, 0.85], sprigs: 7, ragged: 0.1 };
const hedge = plant('hedge', (m) => ({
  shapes: [shape(m, 'hedge', () => hedgeShape(HEDGE)), shape(m, 'hedge-shaggy', () => hedgeShape(HEDGE_SHAGGY))],
  far: hedgeFar(HEDGE),
  // Whole runs are one or the other: who cuts a hedge changes from one garden to the next, not along it.
  pick: (x, z) => (noise2(x / 23 + 5.1, z / 23 + 77.7) < 0.55 ? 0 : 1),
  near: 70,
  reach: 620,
  vary: { size: 0, height: 0.06, lean: 0, tone: 0.07 },
}));

/**
 * 4 m of a Canterbury shelter hedge along x: macrocarpa clipped square, 5 m high and 2 m through, the dark
 * green walls that divide the plains. Laid end to end like the garden hedge.
 */
const SHELTER: HedgeSpec = { seed: 2121, length: 4, height: 5, thick: 2, face: 'macrocarpa', tile: 2.5, sprig: 'macrocarpa', sprigSize: [1.6, 2.2], sprigs: 6, ragged: 0.35, courses: 2, heart: 0x1c3020, tint: [0.92, 0.95, 0.9] };
const SHELTER_TOPPED: HedgeSpec = { ...SHELTER, seed: 2143, height: 4.3, ragged: 0.2 };
const shelterHedge = plant('hedge-shelter', (m) => ({
  shapes: [shape(m, 'hedge-shelter', () => hedgeShape(SHELTER)), shape(m, 'hedge-shelter-topped', () => ({ ...hedgeShape(SHELTER_TOPPED), far: [1, 0.86] }))],
  far: hedgeFar(SHELTER),
  pick: (x, z) => (noise2(x / 90 + 15.1, z / 90 + 7.7) < 0.6 ? 0 : 1),
  near: 110,
  vary: { size: 0, height: 0.05, lean: 0, tone: 0.07 },
  collider: { radius: 0.95, height: 4 },
}));

/**
 * Every plant kind, by the name placement code uses. The first ten are the contract kinds (registered in
 * ./index.ts and ./extra.ts); the next six came in round 2; the rest are new in round 3.
 */
export const VEGETATION: Record<string, PropFactory> = {
  'tree-oak': broadleaves,
  'tree-willow': willow,
  'tree-cabbage': cabbageTree,
  'tree-pine': pine,
  'tree-poplar': poplar,
  bush,
  flax,
  hedge,
  'tree-norfolk-pine': norfolkPine,
  'tree-phoenix-palm': phoenixPalm,
  'tree-macrocarpa': macrocarpa,
  toetoe,
  'grass-tuft': grassTuft,
  tussock,
  gorse,
  lupin,
  'tree-english-oak': englishOak,
  'tree-lime': lime,
  'tree-plane': plane,
  'shrub-hydrangea': hydrangea,
  'shrub-rhododendron': rhododendron,
  broom,
  'rose-bush': roseBush,
  'flower-bed': flowerBed,
  'planter-plants': planterPlants,
  'hedge-shelter': shelterHedge,
  'grass-long': grassRun,
};

// The atlas is fetched with the other photographic textures, before the world is built.
registerTexturePreload(loadFoliage);
