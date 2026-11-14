import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { MaterialLibrary } from '../../core/types';
import { METALLIC } from './paints';

/**
 * Building kit for the procedural vehicle models.
 *
 * A model is described as triangles queued against a handful of surfaces, and `finish()` turns each
 * surface into ONE indexed mesh with smoothed normals:
 *
 *   paint   the vehicle's own clear-coated body colour (returned as `bodyMaterial`)
 *   glass   see-through tinted glazing and clear lamp lenses (per-vertex tint and opacity)
 *   trim    everything else that is opaque: one vertex-coloured material whose finish (matte plastic,
 *           rubber, chrome, alloy…) is picked per part through a tiny roughness / metalness lookup
 *   head, tail   the emissive lamp materials the game drives
 *
 * plus any library material handed over directly (number plates, signwriting, timber). A car is therefore
 * about six meshes and four wheels however much detail it carries.
 *
 * Geometry that does not change between vehicles of a kind is built once (`cached`) and replayed as typed
 * arrays, so spawning traffic costs almost nothing.
 *
 * Conventions: the model faces +z, origin on the ground under the centre, +x is the vehicle's left and
 * the driver sits at x < 0.
 */

export type V3 = readonly [x: number, y: number, z: number];
export type Pt = readonly [a: number, b: number];
export type Fn = (t: number) => number;

/** Dice for optional details (a dog on the tray, signwriting, plates). Deterministic per session. */
export const dice = new Rng(0x1995);

// ───────────────────────────── Surfaces ─────────────────────────────

/** Finishes of the shared trim material: [roughness, metalness]. */
const FINISHES = {
  matte: [0.86, 0],
  rubber: [0.93, 0],
  cloth: [1, 0],
  satin: [0.55, 0],
  gloss: [0.16, 0],
  chrome: [0.07, 1],
  // Bright plating that is not a mirror: its sun glint is broad instead of a point that blooms like a lit lamp.
  polished: [0.17, 1],
  alloy: [0.3, 1],
  steel: [0.5, 0.75],
} as const;
export type Finish = keyof typeof FINISHES;
const FINISH_NAMES = Object.keys(FINISHES) as Finish[];

/** A colour and finish of the shared trim material. */
export class Tint {
  /** Linear RGB, as vertex colours want it. */
  readonly rgb: readonly number[];
  /** Lookup coordinate of the finish. */
  readonly u: number;
  constructor(
    readonly hex: number,
    readonly finish: Finish,
  ) {
    const c = new THREE.Color(hex);
    this.rgb = [c.r, c.g, c.b];
    this.u = (FINISH_NAMES.indexOf(finish) + 0.5) / FINISH_NAMES.length;
  }
}

/** Glazing: `reflect` is how mirror-like it is (0.04 = plain glass), `shade` how much it darkens what is behind. */
export class Glaze {
  readonly rgba: readonly number[];
  constructor(reflect: number, shade: number, hex = 0xffffff) {
    const c = new THREE.Color(hex);
    this.rgba = [c.r * reflect, c.g * reflect, c.b * reflect, shade];
  }
}

const tints = new Map<string, Tint>();
export function tint(hex: number, finish: Finish = 'matte'): Tint {
  const key = hex + finish;
  let t = tints.get(key);
  if (!t) tints.set(key, (t = new Tint(hex, finish)));
  return t;
}

/** Named surfaces every kit knows. */
export const PAINT = 'paint';
export const HEAD = 'head';
export const TAIL = 'tail';
export type Surface = string | Tint | Glaze | THREE.Material;

export const DARK = tint(0x0d0e10, 'matte');
export const BLACK = tint(0x0a0a0b, 'gloss');
export const PLASTIC = tint(0x24262a, 'matte');
export const GREY = tint(0x45484c, 'matte');
export const RUBBER = tint(0x121212, 'rubber');
export const CHROME = tint(0xf0f0f0, 'chrome');
export const ALLOY = tint(0xc9ccd0, 'alloy');
export const STEEL = tint(0x9fa4a8, 'steel');
export const RED_LENS = tint(0x8f1611, 'gloss');
export const AMBER = tint(0xe58a16, 'gloss');
export const CLEAR_LENS = tint(0xe8ecee, 'gloss');
/** Side and screen glass. */
export const WINDOW = new Glaze(0.12, 0.3, 0xdff0ea);
/** Darker glass (rear screens of the sporty cars, bus windows). */
export const SMOKED = new Glaze(0.12, 0.5, 0xdff0ea);
/**
 * Lamp lenses. The lit elements behind them are the game's shared emitter materials, whose base colour is
 * the colour of the light: bare, they look switched on in sunshine. A lens with some shade takes them down
 * to glass in daylight and still lets the night-time glow through.
 */
export const LENS = new Glaze(0.24, 0.42);
export const TAIL_LENS = new Glaze(0.16, 0.36, 0xffb0a0);

interface Shared {
  glass: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  baked: Map<string, Map<Surface, Chunk>>;
}
const shared = new WeakMap<MaterialLibrary, Shared>();

function sharedFor(m: MaterialLibrary): Shared {
  let s = shared.get(m);
  if (s) return s;
  const data = new Uint8Array(FINISH_NAMES.length * 4);
  FINISH_NAMES.forEach((name, i) => data.set([0, Math.round(FINISHES[name][0] * 255), Math.round(FINISHES[name][1] * 255), 255], i * 4));
  const lut = new THREE.DataTexture(data, FINISH_NAMES.length, 1, THREE.RGBAFormat);
  lut.magFilter = lut.minFilter = THREE.NearestFilter;
  lut.generateMipmaps = false;
  lut.needsUpdate = true;
  // Opaque trim: colour per vertex, finish through the lookup (roughness in G, metalness in B).
  const trim = m.register(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut, envMapIntensity: 1.1 }));
  // Glass: only reflects (metalness 1, so no diffuse term) and its alpha is how much it shades what is
  // behind. Blended "one, one-minus-alpha" so reflections keep full strength on a nearly clear pane.
  const glass = m.register(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.03,
      metalness: 1,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      envMapIntensity: 1.5,
    }),
  );
  s = { glass, trim, baked: new Map() };
  shared.set(m, s);
  return s;
}

/**
 * Clear-coated car paint. The vehicle system recolours it through `color` and, when the car is wrecked,
 * sets `roughness` to 0.95: that also burns the lacquer off here, so a wreck is not left glossy.
 */
function makePaint(m: MaterialLibrary, color: number): THREE.MeshPhysicalMaterial {
  const flake = METALLIC.has(color);
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: flake ? 0.42 : 0.55,
    metalness: flake ? 0.62 : 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.15,
    // An open shell: let both faces throw the shadow so the roof and far flank count.
    shadowSide: THREE.DoubleSide,
  });
  let roughness = paint.roughness;
  Object.defineProperty(paint, 'roughness', {
    get: () => roughness,
    set: (value: number) => {
      roughness = value;
      if (value >= 0.9) {
        paint.clearcoat = 0;
        paint.metalness = 0.1;
      }
    },
    enumerable: true,
    configurable: true,
  });
  return m.register(paint);
}

// ───────────────────────────── Curves ─────────────────────────────

/** Smooth function through knots [t, value] (monotone cubic: no overshoot). Clamped outside the knots. */
export function curve(knots: Pt[]): Fn {
  const n = knots.length;
  if (n === 1) return () => knots[0][1];
  const x = knots.map((k) => k[0]);
  const y = knots.map((k) => k[1]);
  const d: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) s.push((y[i + 1] - y[i]) / (x[i + 1] - x[i] || 1e-9));
  for (let i = 0; i < n; i++) {
    if (i === 0) d.push(s[0]);
    else if (i === n - 1) d.push(s[n - 2]);
    else if (s[i - 1] * s[i] <= 0) d.push(0);
    else {
      const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]);
      const w2 = x[i + 1] - x[i] + 2 * (x[i] - x[i - 1]);
      d.push((w1 + w2) / (w1 / s[i - 1] + w2 / s[i]));
    }
  }
  return (t: number) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const u = (t - x[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * d[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * d[i + 1];
  };
}

/** Straight-line function through knots. */
export function line(knots: Pt[]): Fn {
  return (t: number) => {
    if (t <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      if (t <= knots[i][0]) {
        const [a, b] = [knots[i - 1], knots[i]];
        return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1e-9);
      }
    }
    return knots[knots.length - 1][1];
  };
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (a: number, b: number, t: number) => {
  const u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: V3): V3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ───────────────────────────── Baking ─────────────────────────────

interface Part {
  /** Triangle soup: nine numbers per triangle. */
  pos: number[];
  /** Two numbers per corner, or null for a constant. */
  uv: number[] | null;
  tint: Tint | Glaze | null;
  /** Corners smooth only with others of the same group; negative = always faceted. */
  group: number;
}

/** A finished, indexed piece of one surface. Shared between vehicles; never mutated. */
interface Chunk {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array | null;
  colSize: number;
  idx: Uint32Array | Uint16Array;
  cast: boolean;
}

const CREASE = Math.cos((48 * Math.PI) / 180);

function bake(parts: Part[], colSize: number, cast: boolean): Chunk {
  let corners = 0;
  for (const p of parts) corners += p.pos.length / 3;
  const P = new Float32Array(corners * 3);
  const UV = new Float32Array(corners * 2);
  const COL = colSize ? new Float32Array(corners * colSize) : null;
  const G = new Int32Array(corners);
  let at = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    P.set(p.pos, at * 3);
    if (p.uv) UV.set(p.uv, at * 2);
    else if (p.tint instanceof Tint) for (let i = 0; i < n; i++) (UV[(at + i) * 2] = p.tint.u), (UV[(at + i) * 2 + 1] = 0.5);
    if (COL) {
      const c = p.tint instanceof Tint ? p.tint.rgb : p.tint instanceof Glaze ? p.tint.rgba : [1, 1, 1, 1];
      for (let i = 0; i < n; i++) for (let j = 0; j < colSize; j++) COL[(at + i) * colSize + j] = c[j];
    }
    G.fill(p.group, at, at + n);
    at += n;
  }
  // Face normals: FA area-weighted, FU unit.
  const tris = corners / 3;
  const FA = new Float32Array(tris * 3);
  const FU = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const ux = P[o + 3] - P[o];
    const uy = P[o + 4] - P[o + 1];
    const uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o];
    const vy = P[o + 7] - P[o + 1];
    const vz = P[o + 8] - P[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    FA.set([nx, ny, nz], t * 3);
    FU.set([nx / l, ny / l, nz / l], t * 3);
  }
  // Corners that share a position, as linked lists.
  const first = new Map<number, number>();
  const next = new Int32Array(corners).fill(-1);
  for (let c = 0; c < corners; c++) {
    const key = ((Math.round(P[c * 3] * 4000) + 32768) * 65536 + Math.round(P[c * 3 + 1] * 4000) + 32768) * 65536 + Math.round(P[c * 3 + 2] * 4000) + 32768;
    const head = first.get(key);
    if (head !== undefined) next[c] = head;
    first.set(key, c);
  }
  const N = new Float32Array(corners * 3);
  const id = new Int32Array(corners).fill(-1);
  const cluster: number[] = [];
  let verts = 0;
  for (const head of first.values()) {
    cluster.length = 0;
    for (let c = head; c >= 0; c = next[c]) cluster.push(c);
    for (const a of cluster) {
      const fa = Math.floor(a / 3) * 3;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (G[a] < 0) {
        nx = FU[fa];
        ny = FU[fa + 1];
        nz = FU[fa + 2];
      } else {
        for (const b of cluster) {
          if (G[b] !== G[a]) continue;
          const fb = Math.floor(b / 3) * 3;
          if (FU[fa] * FU[fb] + FU[fa + 1] * FU[fb + 1] + FU[fa + 2] * FU[fb + 2] < CREASE) continue;
          nx += FA[fb];
          ny += FA[fb + 1];
          nz += FA[fb + 2];
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
      }
      N[a * 3] = nx;
      N[a * 3 + 1] = ny;
      N[a * 3 + 2] = nz;
    }
    // Weld corners of the cluster that ended up identical.
    for (let i = 0; i < cluster.length; i++) {
      const a = cluster[i];
      for (let j = 0; j < i; j++) {
        const b = cluster[j];
        if (Math.abs(N[a * 3] - N[b * 3]) + Math.abs(N[a * 3 + 1] - N[b * 3 + 1]) + Math.abs(N[a * 3 + 2] - N[b * 3 + 2]) > 0.004) continue;
        if (UV[a * 2] !== UV[b * 2] || UV[a * 2 + 1] !== UV[b * 2 + 1]) continue;
        if (COL) {
          let same = true;
          for (let k = 0; k < colSize; k++) if (COL[a * colSize + k] !== COL[b * colSize + k]) same = false;
          if (!same) continue;
        }
        id[a] = id[b];
        break;
      }
      if (id[a] < 0) id[a] = verts++;
    }
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = COL ? new Float32Array(verts * colSize) : null;
  const idx = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const v = id[c];
    idx[c] = v;
    pos[v * 3] = P[c * 3];
    pos[v * 3 + 1] = P[c * 3 + 1];
    pos[v * 3 + 2] = P[c * 3 + 2];
    nor[v * 3] = N[c * 3];
    nor[v * 3 + 1] = N[c * 3 + 1];
    nor[v * 3 + 2] = N[c * 3 + 2];
    uv[v * 2] = UV[c * 2];
    uv[v * 2 + 1] = UV[c * 2 + 1];
    if (col && COL) for (let k = 0; k < colSize; k++) col[v * colSize + k] = COL[c * colSize + k];
  }
  return { pos, nor, uv, col, colSize, idx: verts > 65535 ? idx : new Uint16Array(idx), cast };
}

/** Concatenate chunks of one surface. */
function merge(chunks: Chunk[], cast: boolean): Chunk {
  if (chunks.length === 1) return chunks[0].cast === cast ? chunks[0] : { ...chunks[0], cast };
  let verts = 0;
  let indices = 0;
  for (const k of chunks) {
    verts += k.pos.length / 3;
    indices += k.idx.length;
  }
  const colSize = chunks[0].colSize;
  const out: Chunk = { pos: new Float32Array(verts * 3), nor: new Float32Array(verts * 3), uv: new Float32Array(verts * 2), col: colSize ? new Float32Array(verts * colSize) : null, colSize, idx: verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), cast };
  let v = 0;
  let i = 0;
  for (const k of chunks) {
    out.pos.set(k.pos, v * 3);
    out.nor.set(k.nor, v * 3);
    out.uv.set(k.uv, v * 2);
    if (out.col && k.col) out.col.set(k.col, v * colSize);
    for (let j = 0; j < k.idx.length; j++) out.idx[i + j] = k.idx[j] + v;
    v += k.pos.length / 3;
    i += k.idx.length;
  }
  return out;
}

/** A fresh geometry over a chunk (the arrays are shared, not copied: chunks are never mutated). */
function toGeometry(c: Chunk): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
  if (c.col) geo.setAttribute('color', new THREE.BufferAttribute(c.col, c.colSize));
  geo.setIndex(new THREE.BufferAttribute(c.idx, 1));
  return geo;
}

// ───────────────────────────── The kit ─────────────────────────────

interface Batch {
  parts: Part[];
  chunks: Chunk[];
  cast: boolean;
}

export interface PartOptions {
  /** Smooth together with other parts of the same name (default: each part on its own). */
  group?: string;
  /** Never smooth: every triangle faceted. */
  flat?: boolean;
  cast?: boolean;
  uv?: number[];
}

export interface GridOptions extends PartOptions {
  /** A point the surface faces away from (decides the winding). */
  out: V3;
  /** Face towards `out` instead. */
  inward?: boolean;
  /** Also emit the copy mirrored in x. */
  mirror?: boolean;
}

const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class Kit {
  readonly group = new THREE.Group();
  /** The one body-paint material of this vehicle (returned as `bodyMaterial`). */
  readonly paint: THREE.MeshStandardMaterial;
  readonly headlights: THREE.MeshStandardMaterial;
  readonly taillights: THREE.MeshStandardMaterial;
  private lib: Shared;
  private roles = new Map<string, THREE.Material>();
  private batches = new Map<Surface, Batch>();
  private groups = new Map<string, number>();
  private nextGroup = 1;

  /** Pass `paint` to build a second group (a steering assembly, say) in the same body colour. */
  constructor(
    readonly m: MaterialLibrary,
    readonly color: number,
    paint?: THREE.MeshStandardMaterial,
  ) {
    this.lib = sharedFor(m);
    this.paint = paint ?? makePaint(m, color);
    this.headlights = m.emitter(0xfff3cf, 'night');
    this.taillights = m.emitter(0xff2a1a, 'night');
    this.roles.set(PAINT, this.paint);
    this.roles.set(HEAD, this.headlights);
    this.roles.set(TAIL, this.taillights);
  }

  /** Name a per-vehicle material so cached geometry can refer to it (police beacons). */
  role(name: string, material: THREE.Material) {
    this.roles.set(name, material);
  }

  private batch(surface: Surface): Batch {
    const key = surface instanceof Tint ? 'trim' : surface instanceof Glaze ? 'glass' : surface;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { parts: [], chunks: [], cast: false }));
    return b;
  }

  private groupId(o?: PartOptions): number {
    if (o?.flat) return -1;
    if (!o?.group) return this.nextGroup++;
    let id = this.groups.get(o.group);
    if (!id) this.groups.set(o.group, (id = this.nextGroup++));
    return id;
  }

  /** Queue raw triangles (nine numbers each). */
  tris(surface: Surface, pos: number[], o?: PartOptions): void {
    if (!pos.length) return;
    const b = this.batch(surface);
    b.parts.push({ pos, uv: o?.uv ?? null, tint: surface instanceof Tint || surface instanceof Glaze ? surface : null, group: this.groupId(o) });
    b.cast ||= o?.cast ?? false;
  }

  /** Queue a three.js geometry that is already in model space. */
  geo(surface: Surface, g: THREE.BufferGeometry, o?: PartOptions): void {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    const index = g.index;
    const count = index ? index.count : p.count;
    const pos: number[] = new Array(count * 3);
    const uv: number[] | undefined = u && !(surface instanceof Tint || surface instanceof Glaze) ? new Array(count * 2) : undefined;
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      pos[i * 3] = p.getX(v);
      pos[i * 3 + 1] = p.getY(v);
      pos[i * 3 + 2] = p.getZ(v);
      if (uv) {
        uv[i * 2] = u.getX(v);
        uv[i * 2 + 1] = u.getY(v);
      }
    }
    this.tris(surface, pos, uv ? { ...o, uv } : o);
  }

  /**
   * Surface through a lattice of points: `rows[i][j]`, every row the same length. Zero-area cells are
   * dropped, so rows may pinch together.
   */
  grid(surface: Surface, rows: V3[][], o: GridOptions): void {
    const pos: number[] = [];
    let facing = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < rows[i].length - 1; j++) {
        const a = rows[i][j];
        const b = rows[i][j + 1];
        const c = rows[i + 1][j + 1];
        const d = rows[i + 1][j];
        const n = cross3(sub3(c, a), sub3(d, b));
        facing += n[0] * ((a[0] + c[0]) / 2 - o.out[0]) + n[1] * ((a[1] + c[1]) / 2 - o.out[1]) + n[2] * ((a[2] + c[2]) / 2 - o.out[2]);
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      }
    }
    const flip = facing < 0 !== (o.inward ?? false);
    this.tris(surface, wound(pos, flip, o.mirror ?? false), o);
  }

  /** One flat polygon (fan) facing away from `out`. */
  poly(surface: Surface, points: V3[], out: V3, o?: PartOptions & { mirror?: boolean; inward?: boolean }): void {
    const pos: number[] = [];
    for (let i = 1; i < points.length - 1; i++) pos.push(...points[0], ...points[i], ...points[i + 1]);
    const n = cross3(sub3(points[1], points[0]), sub3(points[points.length - 1], points[0]));
    const flip = dot3(n, sub3(points[0], out)) < 0 !== (o?.inward ?? false);
    this.tris(surface, wound(pos, flip, o?.mirror ?? false), { flat: true, ...o });
  }

  /** Axis-aligned (or rotated) box centred on x, y, z. */
  box(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3, cast = false): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rot) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(rot[0], rot[1], rot[2])));
    this.geo(surface, geo.translate(x, y, z), { flat: true, cast });
  }

  /** The same box on both sides of the vehicle (x and −x). */
  boxes(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3, cast = false): void {
    this.box(surface, w, h, d, x, y, z, rot, cast);
    this.box(surface, w, h, d, -x, y, z, rot ? [rot[0], -rot[1], -rot[2]] : undefined, cast);
  }

  /** Box with softened edges (`r`), smooth-shaded so it reads as a moulding or a cushion. */
  pad(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, r: number, rot?: V3, cast = false): void {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const rr = Math.min(r, hx, hy, hz) * 0.999;
    const pos: number[] = [];
    // Each face is a quad inset by r; edges and corners close the gaps.
    const P = (sx: number, sy: number, sz: number, ax: number): V3 => [sx * (hx - (ax === 0 ? 0 : rr)), sy * (hy - (ax === 1 ? 0 : rr)), sz * (hz - (ax === 2 ? 0 : rr))];
    const quad = (a: V3, b: V3, c: V3, d2: V3) => {
      const n = cross3(sub3(c, a), sub3(d2, b));
      const out = dot3(n, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]) >= 0;
      if (out) pos.push(...a, ...b, ...c, ...a, ...c, ...d2);
      else pos.push(...a, ...c, ...b, ...a, ...d2, ...c);
    };
    for (const s of [1, -1]) {
      quad(P(s, -1, -1, 0), P(s, 1, -1, 0), P(s, 1, 1, 0), P(s, -1, 1, 0));
      quad(P(-1, s, -1, 1), P(1, s, -1, 1), P(1, s, 1, 1), P(-1, s, 1, 1));
      quad(P(-1, -1, s, 2), P(1, -1, s, 2), P(1, 1, s, 2), P(-1, 1, s, 2));
      for (const t of [1, -1]) {
        quad(P(s, t, -1, 0), P(s, t, 1, 0), P(s, t, 1, 1), P(s, t, -1, 1));
        quad(P(s, -1, t, 0), P(s, 1, t, 0), P(s, 1, t, 2), P(s, -1, t, 2));
        quad(P(-1, s, t, 1), P(1, s, t, 1), P(1, s, t, 2), P(-1, s, t, 2));
        for (const u of [1, -1]) {
          const a = P(s, t, u, 0);
          const b = P(s, t, u, 1);
          const c = P(s, t, u, 2);
          const n = cross3(sub3(b, a), sub3(c, a));
          if (dot3(n, a) >= 0) pos.push(...a, ...b, ...c);
          else pos.push(...a, ...c, ...b);
        }
      }
    }
    if (rot) _m.makeRotationFromEuler(_e.set(rot[0], rot[1], rot[2]));
    for (let i = 0; i < pos.length; i += 3) {
      if (rot) {
        _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(_m);
        pos[i] = _v.x;
        pos[i + 1] = _v.y;
        pos[i + 2] = _v.z;
      }
      pos[i] += x;
      pos[i + 1] += y;
      pos[i + 2] += z;
    }
    this.tris(surface, pos, { cast });
  }

  private span(geo: THREE.BufferGeometry, a: V3, b: V3): THREE.BufferGeometry {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    geo.applyQuaternion(_q.setFromUnitVectors(_up, _v));
    return geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }

  /** Rectangular bar from a to b. */
  beam(surface: Surface, a: V3, b: V3, w: number, d: number, cast = false): void {
    this.geo(surface, this.span(new THREE.BoxGeometry(w, len3(sub3(b, a)), d), a, b), { flat: true, cast });
  }

  /** Round tube from a to b (`radiusB` at b for a taper). */
  tube(surface: Surface, a: V3, b: V3, radius: number, segments = 6, cast = false, radiusB = radius, open = false): void {
    this.geo(surface, this.span(new THREE.CylinderGeometry(radiusB, radius, len3(sub3(b, a)), segments, 1, open), a, b), { cast });
  }

  /** Tube through several points, mitred at the bends. */
  pipe(surface: Surface, points: V3[], radius: number, segments = 6, cast = false): void {
    for (let i = 0; i < points.length - 1; i++) this.tube(surface, points[i], points[i + 1], radius, segments, cast, radius, true);
    for (let i = 1; i < points.length - 1; i++) this.geo(surface, new THREE.SphereGeometry(radius, segments, 3).translate(points[i][0], points[i][1], points[i][2]), {});
  }

  /** Cylinder with its axis along x, y or z. */
  drum(surface: Surface, radius: number, length: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', segments = 10, cast = false): void {
    const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    else if (axis === 'z') geo.rotateX(Math.PI / 2);
    this.geo(surface, geo.translate(x, y, z), { cast });
  }

  /** Ball (a helmet, a lamp bowl): `sy` and `sz` squash it. */
  ball(surface: Surface, radius: number, x: number, y: number, z: number, sy = 1, sz = 1, segments = 8): void {
    this.geo(surface, new THREE.SphereGeometry(radius, segments, Math.max(4, Math.round(segments * 0.6))).scale(1, sy, sz).translate(x, y, z), {});
  }

  /**
   * Section swept along a path. `frames[i]` is [origin, side, up]: the section's [a, b] points land at
   * origin + side·a + up·b. An open section is a strip; `closed` joins its ends.
   */
  sweep(surface: Surface, frames: [V3, V3, V3][], section: Pt[], o: GridOptions & { closed?: boolean; caps?: 'start' | 'both' }): void {
    const rows = frames.map(([p, s, u]) => {
      const row = section.map(([a, b]): V3 => [p[0] + s[0] * a + u[0] * b, p[1] + s[1] * a + u[1] * b, p[2] + s[2] * a + u[2] * b]);
      if (o.closed) row.push(row[0]);
      return row;
    });
    this.grid(surface, rows, o);
    if (o.caps) {
      const ends = [[rows[0], rows[1]]];
      if (o.caps === 'both') ends.push([rows[rows.length - 1], rows[rows.length - 2]]);
      for (const [row, other] of ends) {
        this.poly(surface, o.closed ? row.slice(0, -1) : row, other[0], { mirror: o.mirror, cast: o.cast });
      }
    }
  }

  /**
   * Thin ribbon lying on a surface: through `points`, `width` wide across `across` (a direction, or one
   * per point), centred on the points.
   */
  ribbon(surface: Surface, points: V3[], across: V3 | V3[], width: number, out: V3, mirror = false): void {
    const rows = points.map((p, i) => {
      const w = (Array.isArray(across[0]) ? (across as V3[])[i] : (across as V3)) as V3;
      return [add3(p, w, -width / 2), add3(p, w, width / 2)];
    });
    this.grid(surface, rows, { out, mirror, flat: true });
  }

  /** Flat board carrying a `materials.sign` texture. `yaw` 0 faces +z, π/2 faces +x (the left flank). */
  board(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    const geo = new THREE.PlaneGeometry(w, h);
    if (pitch) geo.rotateX(pitch);
    if (yaw) geo.rotateY(yaw);
    this.geo(mat, geo.translate(x, y, z), { flat: true });
  }

  /** Front and rear number plates (one shared sign material per registration). A NaN `frontZ` skips the front. */
  plates(frontZ: number, frontY: number, rearZ: number, rearY: number, era: 'old' | 'new' | 'any' = 'any', scale = 1, tilt = 0): void {
    const old = era === 'old' || (era === 'any' && dice.chance(0.35));
    // Plates issued before 1987 are black with silver characters; later ones white with black.
    const text = dice.pick(old ? OLD_PLATES : NEW_PLATES);
    const mat = this.m.sign(text, old ? { bg: '#0d0d0d', fg: '#d6d6cf', style: 'block', aspect: 3.1 } : { bg: '#f3f2ea', fg: '#111111', style: 'block', aspect: 3.1 });
    if (Number.isFinite(frontZ)) this.board(mat, 0.36 * scale, 0.116 * scale, 0, frontY, frontZ);
    this.board(mat, 0.36 * scale, 0.116 * scale, 0, rearY, rearZ, Math.PI, tilt);
  }

  /**
   * Geometry that is the same for every vehicle built with `key`: `build` runs once per material library
   * and its baked result is replayed afterwards. `build` must only draw on the kit it is given.
   */
  cached(key: string, build: (k: Kit) => void): void {
    let baked = this.lib.baked.get(key);
    if (!baked) {
      const sub = new Kit(this.m, 0, this.paint);
      build(sub);
      baked = sub.bakeAll();
      this.lib.baked.set(key, baked);
    }
    for (const [surface, chunk] of baked) {
      const b = this.batch(surface);
      b.chunks.push(chunk);
      b.cast ||= chunk.cast;
    }
  }

  private bakeAll(): Map<Surface, Chunk> {
    const out = new Map<Surface, Chunk>();
    for (const [surface, b] of this.batches) {
      const chunks = [...b.chunks];
      if (b.parts.length) chunks.push(bake(b.parts, surface === 'trim' ? 3 : surface === 'glass' ? 4 : 0, b.cast));
      if (chunks.length) out.set(surface, merge(chunks, b.cast));
    }
    this.batches.clear();
    return out;
  }

  /** One mesh for a cached piece on its own (wheels). */
  mesh(key: string, build: (k: Kit) => void, cast = true): THREE.Mesh {
    let baked = this.lib.baked.get(key);
    if (!baked) {
      const sub = new Kit(this.m, 0, this.paint);
      build(sub);
      baked = sub.bakeAll();
      this.lib.baked.set(key, baked);
    }
    const chunk = baked.get('trim')!;
    const mesh = new THREE.Mesh(toGeometry(chunk), this.lib.trim);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Merge every queued piece into one mesh per surface. Call once, last. */
  finish(): THREE.Group {
    for (const [surface, chunk] of this.bakeAll()) {
      const material = surface === 'trim' ? this.lib.trim : surface === 'glass' ? this.lib.glass : typeof surface === 'string' ? this.roles.get(surface) : (surface as THREE.Material);
      if (!material) throw new Error(`No material for surface "${String(surface)}"`);
      const mesh = new THREE.Mesh(toGeometry(chunk), material);
      mesh.castShadow = surface === PAINT || (surface !== 'glass' && chunk.cast);
      mesh.receiveShadow = surface !== 'glass';
      // Glass draws after anything else see-through nearby (rain, smoke stay behind the pane they are behind).
      if (surface === 'glass') mesh.renderOrder = 2;
      this.group.add(mesh);
    }
    return this.group;
  }

  // ── Timber (the `timber` library surface: a 1.6 m tile of eight planks, grain along v) ──

  /** Timber board: its own plank shade, grain along its length. */
  plank(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): void {
    this.geo(mat, timberGeometry(w, h, d, dice.int(0, 7)).translate(x, y, z), { flat: true, cast: true });
  }

  /** Planked timber slab (a truck deck): the texture runs in metres across it. */
  slab(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): void {
    this.geo(mat, timberGeometry(w, h, d, -1).translate(x, y, z), { flat: true, cast: true });
  }

  /** Timber board from a to b (a diagonal brace). */
  brace(mat: THREE.Material, a: V3, b: V3, w: number, d: number): void {
    this.geo(mat, this.span(timberGeometry(w, len3(sub3(b, a)), d, dice.int(0, 7)), a, b), { flat: true, cast: true });
  }
}

/** Apply winding (and the x-mirror) to a triangle soup, dropping triangles with no area. */
function wound(p: number[], flip: boolean, mirror: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i];
    const uy = p[i + 4] - p[i + 1];
    const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i];
    const vy = p[i + 7] - p[i + 1];
    const vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) continue;
    if (flip) out.push(p[i], p[i + 1], p[i + 2], p[i + 6], p[i + 7], p[i + 8], p[i + 3], p[i + 4], p[i + 5]);
    else out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]);
    if (mirror) {
      if (flip) out.push(-p[i], p[i + 1], p[i + 2], -p[i + 3], p[i + 4], p[i + 5], -p[i + 6], p[i + 7], p[i + 8]);
      else out.push(-p[i], p[i + 1], p[i + 2], -p[i + 6], p[i + 7], p[i + 8], -p[i + 3], p[i + 4], p[i + 5]);
    }
  }
  return out;
}

function timberGeometry(w: number, h: number, d: number, tone: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const size = [w, h, d];
  const long = w >= h && w >= d ? 0 : h >= d ? 1 : 2;
  const p = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const u0 = (tone % 8) * 0.2 + 0.1;
  for (let i = 0; i < p.count; i++) {
    const pos = [p.getX(i), p.getY(i), p.getZ(i)];
    const facing = Math.abs(nrm.getX(i)) > 0.5 ? 0 : Math.abs(nrm.getY(i)) > 0.5 ? 1 : 2;
    const across = facing === long ? (long + 1) % 3 : 3 - long - facing;
    const along = facing === long ? (long + 2) % 3 : long;
    if (tone < 0) uv.setXY(i, pos[across], pos[along]);
    else uv.setXY(i, u0 + (pos[across] / (size[across] || 1)) * 0.14, pos[along] + tone * 0.37);
  }
  return geo;
}

// Invented registrations in the two-letters-four-digits format of the day.
const OLD_PLATES = ['JK4127', 'KD9306', 'LW5571', 'MB2084', 'MX7719', 'LE3662'];
const NEW_PLATES = ['NA1047', 'NT8825', 'PF3390', 'PY6102', 'RH4476', 'SB7251', 'SU2938', 'TD5814'];

// ───────────────────────────── Wheels ─────────────────────────────

/**
 * hubcap: steel wheel under a full chrome cover · steel: painted steel wheel with a centre cap ·
 * alloy: five broad spokes · mesh: many fine spokes · truck: deep steel rim with a proud hub (front axle
 * of trucks and buses) · dual: dished outer wheel of a twin pair, with the inboard tyre behind it.
 */
export type WheelStyle = 'hubcap' | 'steel' | 'alloy' | 'mesh' | 'truck' | 'dual';

const TYRE = tint(0x121212, 'rubber');
const TREAD = tint(0x1b1b1a, 'rubber');
const WELL = tint(0x08080a, 'matte');

/**
 * Surface of revolution about the x axis from [radius, x] points; `side` flips x so the dressed face
 * points outwards. List the profile so that, drawn with x to the right and radius up, the outside of the
 * solid is on the left of the direction of travel.
 */
function lathe(k: Kit, surface: Surface, points: Pt[], segments: number, side: number, o?: PartOptions): void {
  const rows: V3[][] = [];
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const n = Math.sin(a);
    rows.push(points.map(([r, x]): V3 => [side * x, r * c, r * n]));
  }
  const pos: number[] = [];
  for (let j = 0; j < points.length - 1; j++) {
    for (let s = 0; s < segments; s++) {
      const a = rows[s][j];
      const b = rows[s][j + 1];
      const c = rows[s + 1][j + 1];
      const d = rows[s + 1][j];
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    }
  }
  k.tris(surface, wound(pos, side > 0, false), o);
}

/** Small flat disc (a vent hole, a wheel nut) on a wheel face at radius `at`, angle `a`. */
function spot(k: Kit, surface: Surface, side: number, x: number, at: number, a: number, r: number, sides = 6): void {
  const pos: number[] = [];
  const cy = at * Math.cos(a);
  const cz = at * Math.sin(a);
  for (let i = 0; i < sides; i++) {
    const t0 = (i / sides) * Math.PI * 2;
    const t1 = ((i + 1) / sides) * Math.PI * 2;
    pos.push(side * x, cy, cz, side * x, cy + r * Math.cos(t0), cz + r * Math.sin(t0), side * x, cy + r * Math.cos(t1), cz + r * Math.sin(t1));
  }
  k.tris(surface, wound(pos, side < 0, false), { flat: true });
}

function buildWheel(k: Kit, R: number, width: number, side: number, style: WheelStyle, rim: number, twinGap: number) {
  const w = width / 2;
  // The tyre's outline is what gives a wheel away as a polygon, so it gets the most segments.
  const round = 24;
  const seg = 16;
  const sh = Math.min(0.05, width * 0.24);
  const rr = R * (style === 'alloy' || style === 'mesh' ? 0.66 : style === 'truck' || style === 'dual' ? 0.58 : 0.61);
  const tyre = (off: number, back: boolean) => {
    // Inner sidewall (plain), tread, rounded outer shoulder, sidewall with a little bulge, bead.
    lathe(k, TYRE, [[rr - 0.01, off - w + 0.012], [R - sh, off - w], [R, off - w + sh]], round, side, { group: 'tyre' + off });
    lathe(k, TREAD, [[R, off - w + sh], [R, off + w - sh]], round, side, { group: 'tyre' + off });
    lathe(k, TYRE, [[R, off + w - sh], [R - sh * 0.3, off + w - sh * 0.3], [R - sh, off + w], [rr + 0.014, off + w + 0.004], [rr, off + w - 0.012]], round, side, { group: 'tyre' + off });
    if (back) lathe(k, WELL, [[0, off - w + 0.03], [rr - 0.01, off - w + 0.012]], 12, side, { flat: true });
  };
  tyre(0, true);
  if (style === 'dual') tyre(-twinGap, false);
  const paint = tint(rim, 'satin');
  const face = w - 0.012;
  if (style === 'hubcap') {
    // Full cover: stepped chrome dish with a ring of dark slots.
    lathe(k, CHROME, [[rr, face], [rr * 0.94, w + 0.004], [rr * 0.66, w + 0.014], [rr * 0.34, w + 0.016], [rr * 0.22, w + 0.032], [0, w + 0.036]], seg, side);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const c = Math.cos(a);
      const n = Math.sin(a);
      const x = side * (w + 0.0105);
      const at = (r: number, t: number): number[] => [x, r * c - t * n, r * n + t * c];
      const h = rr * 0.035;
      k.tris(DARK, wound([...at(rr * 0.74, -h), ...at(rr * 0.88, -h), ...at(rr * 0.88, h), ...at(rr * 0.74, -h), ...at(rr * 0.88, h), ...at(rr * 0.74, h)], side < 0, false), { flat: true });
    }
  } else if (style === 'steel') {
    // Painted wheel: rim, dished centre with round vents, small bright cap.
    lathe(k, paint, [[rr, face], [rr * 0.9, face - 0.02], [rr * 0.82, face - 0.028], [rr * 0.5, face - 0.006], [rr * 0.36, face + 0.012]], seg, side);
    lathe(k, CHROME, [[rr * 0.36, face + 0.012], [rr * 0.3, face + 0.03], [0, face + 0.034]], 12, side);
    for (let i = 0; i < 8; i++) spot(k, DARK, side, face - 0.013, rr * 0.67, ((i + 0.5) / 8) * Math.PI * 2, rr * 0.085);
  } else if (style === 'alloy' || style === 'mesh') {
    // Machined lip, dark barrel, brake disc, spokes and a centre cap.
    const recess = Math.min(0.07, width * 0.3);
    lathe(k, ALLOY, [[rr, face], [rr * 0.95, face + 0.004], [rr * 0.9, face - 0.012]], seg, side);
    lathe(k, WELL, [[rr * 0.9, face - 0.012], [rr * 0.86, face - recess], [0, face - recess]], seg, side, { flat: true });
    lathe(k, STEEL, [[rr * 0.62, face - recess + 0.012], [rr * 0.22, face - recess + 0.012]], 12, side, { flat: true });
    const spokes = style === 'alloy' ? 5 : 10;
    const sw = style === 'alloy' ? rr * 0.3 : rr * 0.09;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.02, rr * 0.74, sw);
      // Taper towards the rim on the broad spokes.
      const p = g.getAttribute('position');
      for (let v = 0; v < p.count; v++) if (p.getY(v) > 0) p.setZ(v, p.getZ(v) * (style === 'alloy' ? 0.62 : 1));
      k.geo(ALLOY, g.translate(side * (face - 0.014), rr * 0.55, 0).rotateX(a), { flat: true });
    }
    lathe(k, ALLOY, [[rr * 0.24, face - 0.02], [rr * 0.2, face + 0.008], [0, face + 0.01]], 10, side);
  } else {
    // Truck steel: `truck` stands proud at the hub, `dual` is dished deep with the hub recessed.
    const deep = style === 'dual' ? Math.min(0.16, width * 0.6) : 0.05;
    const hub = style === 'dual' ? face - deep + 0.05 : w + 0.06;
    lathe(k, paint, [[rr, face], [rr * 0.93, face - 0.015], [rr * 0.8, face - deep], [rr * 0.46, face - deep], [rr * 0.34, hub], [0, hub + 0.004]], seg, side);
    for (let i = 0; i < 8; i++) spot(k, DARK, side, face - deep + 0.002, rr * 0.62, (i / 8) * Math.PI * 2, 0.018);
  }
}

/** One road wheel: a pivot (positioned and spun by the vehicle system) holding a single mesh. */
export function makeRoadWheel(k: Kit, radius: number, width: number, side: 1 | -1, style: WheelStyle, rim = 0xc9ccce, twinGap = 0): THREE.Group {
  const pivot = new THREE.Group();
  pivot.add(k.mesh(`wheel|${radius}|${width}|${side}|${style}|${rim}|${twinGap}`, (w) => buildWheel(w, radius, width, side, style, rim, twinGap)));
  return pivot;
}

/**
 * Wheel pivots in physics order (FL, FR, RL, RR, then any extra rear pair), added to the kit's group at
 * rest height. `twin` gives the rear axle a second, inboard tyre: it is modelled into the outer wheel's
 * mesh and the extra pivots the physics expects are left empty.
 */
export function mountWheels(
  k: Kit,
  o: { radius: number; width: number; wheelbase: number; track: number; rearTrack?: number; front: WheelStyle; rear?: WheelStyle; rim?: number; twin?: boolean },
): THREE.Object3D[] {
  const wheels: THREE.Object3D[] = [];
  const put = (x: number, z: number, style: WheelStyle | null) => {
    const wheel = style ? makeRoadWheel(k, o.radius, o.width, x > 0 ? 1 : -1, style, o.rim, o.width + 0.03) : new THREE.Group();
    wheel.position.set(x, o.radius, z);
    k.group.add(wheel);
    wheels.push(wheel);
  };
  const front = o.track / 2;
  const rear = (o.rearTrack ?? o.track) / 2;
  put(front, o.wheelbase / 2, o.front);
  put(-front, o.wheelbase / 2, o.front);
  put(rear, -o.wheelbase / 2, o.rear ?? o.front);
  put(-rear, -o.wheelbase / 2, o.rear ?? o.front);
  if (o.twin) {
    put(rear - o.width - 0.03, -o.wheelbase / 2, null);
    put(-(rear - o.width - 0.03), -o.wheelbase / 2, null);
  }
  return wheels;
}
