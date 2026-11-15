import { agedLibrary } from '../aged';
import * as THREE from 'three';
import { TAU } from '../../../core/math';
import { hashInts, Rng } from '../../../core/rng';
import type { ChunkBuilder, LandmarkPlacement, MaterialLibrary, MaterialOptions, SignOptions, SurfaceKind } from '../../../core/types';

/**
 * Shared kit for the Timaru and rural landmark builders (and the rural scatterer): a small mesh
 * accumulator for the shapes ChunkBuilder has no primitive for, plus a `Site` that places things in a
 * landmark's local frame and keeps them sitting on the terrain.
 *
 * Local frame: +z is the landmark's front, +y up. Seen from the front, +x is to the viewer's right.
 */

export type V3 = readonly [number, number, number];

/** Clear radius per kind, from docs/CONTRACT.md. Builders keep everything inside it. */
export const CLEAR_RADIUS: Record<string, number> = {
  'timaru-basilica': 45,
  'caroline-bay-soundshell': 40,
  'caroline-bay-carnival': 70,
  'caroline-bay-tearooms': 25,
  'timaru-port': 130,
  'timaru-lighthouse': 14,
  'landing-service-building': 30,
  'timaru-station': 40,
  'timaru-hospital': 60,
  'timaru-police': 35,
  'smithfield-works': 110,
  'washdyke-saleyards': 70,
  'phar-lap-raceway': 150,
  'ashburton-clock-tower': 14,
  'rakaia-salmon': 14,
  woolshed: 30,
  'grain-silo': 25,
  'service-station': 30,
  'country-pub': 25,
  'country-church': 25,
  'war-memorial': 12,
  school: 80,
  'rugby-field': 70,
  'rail-station-small': 30,
  marae: 50,
};

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Placement shared by every `Geo` of a `Batch`, so one `at()` moves a whole multi-material assembly. */
interface Placement {
  m: THREE.Matrix4 | null;
  n: THREE.Matrix3;
}

/**
 * Accumulates triangles with position, normal and metre-scaled UVs, then hands them to the chunk as one
 * `addGeometry` call. Front faces wind counter-clockwise, as everywhere else.
 */
export class Geo {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private idx: number[] = [];

  constructor(private placement: Placement = { m: null, n: new THREE.Matrix3() }) {}

  get empty(): boolean {
    return this.idx.length === 0;
  }

  private get count(): number {
    return this.pos.length / 3;
  }

  /**
   * Everything added inside `fn` is placed by `matrix` (rotations and translations only). Applies to every
   * `Geo` of the same `Batch`, so parts in different materials move together.
   */
  with(matrix: THREE.Matrix4, fn: () => void): this {
    const ctx = this.placement;
    const prev = ctx.m;
    ctx.m = prev ? prev.clone().multiply(matrix) : matrix;
    ctx.n.getNormalMatrix(ctx.m);
    fn();
    ctx.m = prev;
    if (prev) ctx.n.getNormalMatrix(prev);
    return this;
  }

  /** `with` for the common case: move to a point and turn about the vertical. */
  at(x: number, y: number, z: number, yaw: number, fn: () => void): this {
    return this.with(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z), fn);
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const ctx = this.placement;
    if (ctx.m) {
      _p.set(x, y, z).applyMatrix4(ctx.m);
      _n.set(nx, ny, nz).applyMatrix3(ctx.n).normalize();
      this.pos.push(_p.x, _p.y, _p.z);
      this.nor.push(_n.x, _n.y, _n.z);
    } else {
      this.pos.push(x, y, z);
      this.nor.push(nx, ny, nz);
    }
    this.uvs.push(u, v);
    return this.count - 1;
  }

  /** Flat convex polygon, counter-clockwise seen from the side it faces. */
  poly(pts: readonly V3[], twoSided = false): this {
    const a = pts[0];
    const b = pts[1];
    const c = pts[2];
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return this;
    nx /= len;
    ny /= len;
    nz /= len;
    // u runs level across the face and v up it, so boards, bricks and corrugations sit the right way.
    let ux = nz;
    let uz = -nx;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-4) {
      ux = 1;
      uz = 0;
    } else {
      ux /= ul;
      uz /= ul;
    }
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;
    for (const side of twoSided ? [1, -1] : [1]) {
      const base = this.count;
      for (const p of pts) this.vertex(p[0], p[1], p[2], nx * side, ny * side, nz * side, p[0] * ux + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz);
      for (let i = 1; i < pts.length - 1; i++) {
        if (side === 1) this.idx.push(base, base + i, base + i + 1);
        else this.idx.push(base, base + i + 1, base + i);
      }
    }
    return this;
  }

  /** `poly` for decks and ramps: winds the points whichever way makes the face look up. */
  polyUp(pts: readonly V3[]): this {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a[2] * b[0] - a[0] * b[2];
    }
    return this.poly(area >= 0 ? pts : [...pts].reverse());
  }

  /** Box centred on (cx, cy, cz), optionally turned about its own vertical axis. */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw = 0, bottom = true): this {
    if (yaw !== 0) return this.at(cx, cy, cz, yaw, () => this.box(0, 0, 0, w, h, d, 0, bottom));
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
    this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    if (bottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
    return this;
  }

  /** Upright post standing on y0 (no underside). */
  post(cx: number, y0: number, cz: number, w: number, h: number, d = w): this {
    return this.box(cx, y0 + h / 2, cz, w, h, d, 0, false);
  }

  /** Four-sided frustum: a w0 × d0 base at y0 tapering to w1 × d1 at y0 + h (zero for a pyramid). */
  taper(cx: number, y0: number, cz: number, w0: number, d0: number, w1: number, d1: number, h: number): this {
    const y1 = y0 + h;
    const a0: V3 = [cx - w0 / 2, y0, cz + d0 / 2];
    const b0: V3 = [cx + w0 / 2, y0, cz + d0 / 2];
    const c0: V3 = [cx + w0 / 2, y0, cz - d0 / 2];
    const d0p: V3 = [cx - w0 / 2, y0, cz - d0 / 2];
    const a1: V3 = [cx - w1 / 2, y1, cz + d1 / 2];
    const b1: V3 = [cx + w1 / 2, y1, cz + d1 / 2];
    const c1: V3 = [cx + w1 / 2, y1, cz - d1 / 2];
    const d1p: V3 = [cx - w1 / 2, y1, cz - d1 / 2];
    const side = (p: V3, q: V3, q1: V3, p1: V3) => {
      if (Math.hypot(q1[0] - p1[0], q1[2] - p1[2]) < 1e-6) this.poly([p, q, q1]);
      else this.poly([p, q, q1, p1]);
    };
    side(a0, b0, b1, a1);
    side(b0, c0, c1, b1);
    side(c0, d0p, d1p, c1);
    side(d0p, a0, a1, d1p);
    if (w1 > 1e-6 && d1 > 1e-6) this.poly([a1, b1, c1, d1p]);
    return this;
  }

  /** Flat slab of thickness `t` under the quad a-b-c-d (counter-clockwise seen from above it): sloping roofs, ramps, awnings. */
  slab(a: V3, b: V3, c: V3, d: V3, t: number): this {
    _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _y.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _z.crossVectors(_x, _y).normalize().multiplyScalar(-t);
    const down = (p: V3): V3 => [p[0] + _z.x, p[1] + _z.y, p[2] + _z.z];
    const a2 = down(a);
    const b2 = down(b);
    const c2 = down(c);
    const d2 = down(d);
    this.poly([a, b, c, d]);
    this.poly([d2, c2, b2, a2]);
    this.poly([a2, b2, b, a]);
    this.poly([b2, c2, c, b]);
    this.poly([c2, d2, d, c]);
    this.poly([d2, a2, a, d]);
    return this;
  }

  /** `slab` that works out for itself which way round the corners go, so the top always faces up. */
  slabUp(a: V3, b: V3, c: V3, d: V3, t: number): this {
    const area = a[2] * b[0] - a[0] * b[2] + b[2] * c[0] - b[0] * c[2] + c[2] * d[0] - c[0] * d[2] + d[2] * a[0] - d[0] * a[2];
    return area >= 0 ? this.slab(a, b, c, d, t) : this.slab(d, c, b, a, t);
  }

  /** Rectangular bar from a to b (struts, rails, spokes, jibs). */
  beam(a: V3, b: V3, w: number, h = w): this {
    const len = this.basis(a, b);
    if (len < 1e-6) return this;
    const m = new THREE.Matrix4().makeBasis(_x, _y, _z).setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return this.with(m, () => this.box(0, 0, 0, w, h, len));
  }

  /** Round bar from a to b, optionally tapering. */
  tube(a: V3, b: V3, r0: number, r1 = r0, segs = 8, caps = true): this {
    const len = this.basis(a, b);
    if (len < 1e-6) return this;
    // The lathe axis is local y, so swing the basis round: y → along the bar.
    const m = new THREE.Matrix4().makeBasis(_y, _z, _x).setPosition(a[0], a[1], a[2]);
    const profile: [number, number][] = caps ? [[0, 0], [r0, 0], [r1, len], [0, len]] : [[r0, 0], [r1, len]];
    return this.with(m, () => this.lathe(0, 0, 0, profile, segs));
  }

  /** Orthonormal basis with _z along a → b; returns the length. */
  private basis(a: V3, b: V3): number {
    _z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _z.length();
    if (len < 1e-6) return 0;
    _z.multiplyScalar(1 / len);
    if (Math.abs(_z.y) > 0.999) _x.set(1, 0, 0);
    else _x.set(_z.z, 0, -_z.x).normalize(); // up × z
    _y.crossVectors(_z, _x);
    return len;
  }

  /**
   * Surface of revolution about the vertical through (cx, cz). `profile` is [radius, height] pairs running
   * up the outside (bottom cap → wall → top), so faces point away from the axis. Angles sweep from +x
   * towards +z; a partial sweep gives apses and half domes.
   */
  lathe(cx: number, cy: number, cz: number, profile: readonly (readonly [number, number])[], segs = 12, a0 = 0, a1 = TAU, smooth = false, inside = false): this {
    const n = profile.length;
    const sn: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) {
      const dr = profile[i + 1][0] - profile[i][0];
      const dy = profile[i + 1][1] - profile[i][1];
      const l = Math.hypot(dr, dy) || 1;
      sn.push([dy / l, -dr / l]);
    }
    const blend = (p: [number, number], q: [number, number]): [number, number] => {
      const l = Math.hypot(p[0] + q[0], p[1] + q[1]) || 1;
      return [(p[0] + q[0]) / l, (p[1] + q[1]) / l];
    };
    let rMax = 0;
    for (const p of profile) rMax = Math.max(rMax, p[0]);
    const flip = inside ? -1 : 1;
    let v = 0;
    for (let i = 0; i < n - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      const len = Math.hypot(r1 - r0, y1 - y0);
      if (len < 1e-6) continue;
      let n0 = sn[i];
      let n1 = sn[i];
      if (smooth) {
        if (i > 0) n0 = blend(sn[i - 1], sn[i]);
        if (i < n - 2) n1 = blend(sn[i], sn[i + 1]);
      }
      const base = this.count;
      for (let j = 0; j <= segs; j++) {
        const t = a0 + ((a1 - a0) * j) / segs;
        const c = Math.cos(t);
        const s = Math.sin(t);
        const u = t * rMax;
        this.vertex(cx + r0 * c, cy + y0, cz + r0 * s, n0[0] * c * flip, n0[1] * flip, n0[0] * s * flip, u, v);
        this.vertex(cx + r1 * c, cy + y1, cz + r1 * s, n1[0] * c * flip, n1[1] * flip, n1[0] * s * flip, u, v + len);
      }
      for (let j = 0; j < segs; j++) {
        const a = base + j * 2;
        const b = a + 1;
        const d = a + 2;
        const c = a + 3;
        if (r1 > 1e-6) {
          if (inside) this.idx.push(a, c, b);
          else this.idx.push(a, b, c);
        }
        if (r0 > 1e-6) {
          if (inside) this.idx.push(a, d, c);
          else this.idx.push(a, c, d);
        }
      }
      v += len;
    }
    return this;
  }

  /**
   * Like `lathe` but with flat facets: `sides` faces round the axis, each lit as a plane (hexagonal
   * towers, octagonal drums, tent walls).
   */
  prism(cx: number, cy: number, cz: number, profile: readonly (readonly [number, number])[], sides: number, a0 = 0): this {
    for (let j = 0; j < sides; j++) {
      const t0 = a0 + (TAU * j) / sides;
      const t1 = a0 + (TAU * (j + 1)) / sides;
      const pt = (i: number, t: number): V3 => [cx + profile[i][0] * Math.cos(t), cy + profile[i][1], cz + profile[i][0] * Math.sin(t)];
      for (let i = 0; i < profile.length - 1; i++) {
        const lower = profile[i][0] > 1e-6;
        const upper = profile[i + 1][0] > 1e-6;
        if (lower && upper) this.poly([pt(i, t0), pt(i + 1, t0), pt(i + 1, t1), pt(i, t1)]);
        else if (lower) this.poly([pt(i, t0), pt(i + 1, t0), pt(i, t1)]);
        else if (upper) this.poly([pt(i, t0), pt(i + 1, t0), pt(i + 1, t1)]);
      }
    }
    return this;
  }

  /**
   * Ring segment standing in the local x–y plane, `depth` thick along z: arches, wheel rims, hoops.
   * Angles run from +x towards +y (0…π is an arch springing from both sides).
   */
  arch(cx: number, cy: number, cz: number, rInner: number, rOuter: number, depth: number, a0 = 0, a1 = Math.PI, segs = 10): this {
    const zf = cz + depth / 2;
    const zb = cz - depth / 2;
    const pt = (r: number, t: number, z: number): V3 => [cx + r * Math.cos(t), cy + r * Math.sin(t), z];
    for (let j = 0; j < segs; j++) {
      const t0 = a0 + ((a1 - a0) * j) / segs;
      const t1 = a0 + ((a1 - a0) * (j + 1)) / segs;
      this.poly([pt(rInner, t0, zf), pt(rOuter, t0, zf), pt(rOuter, t1, zf), pt(rInner, t1, zf)]);
      this.poly([pt(rInner, t1, zb), pt(rOuter, t1, zb), pt(rOuter, t0, zb), pt(rInner, t0, zb)]);
      this.poly([pt(rOuter, t0, zf), pt(rOuter, t0, zb), pt(rOuter, t1, zb), pt(rOuter, t1, zf)]);
      if (rInner > 1e-6) this.poly([pt(rInner, t1, zf), pt(rInner, t1, zb), pt(rInner, t0, zb), pt(rInner, t0, zf)]);
    }
    if (Math.abs(a1 - a0) < TAU - 1e-6 && rInner > 1e-6) {
      this.poly([pt(rInner, a0, zf), pt(rInner, a0, zb), pt(rOuter, a0, zb), pt(rOuter, a0, zf)]);
      this.poly([pt(rOuter, a1, zf), pt(rOuter, a1, zb), pt(rInner, a1, zb), pt(rInner, a1, zf)]);
    }
    return this;
  }

  /** Disc facing local +z (clock dials, round windows). */
  disc(cx: number, cy: number, cz: number, r: number, segs = 16): this {
    const pts: V3[] = [];
    for (let j = 0; j < segs; j++) {
      const t = (TAU * j) / segs;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t), cz]);
    }
    return this.poly(pts);
  }

  /**
   * Smooth sheet through a grid of (ni + 1) × (nj + 1) points. It faces the side where
   * (step in i) × (step in j) points; pass `twoSided` for shells seen from both sides.
   */
  sheet(ni: number, nj: number, point: (i: number, j: number) => V3, twoSided = false): this {
    const cols = nj + 1;
    const P: V3[] = [];
    for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) P.push(point(i, j));
    const at = (i: number, j: number) => P[Math.min(ni, Math.max(0, i)) * cols + Math.min(nj, Math.max(0, j))];
    const U = new Float64Array(P.length);
    const V = new Float64Array(P.length);
    const N: number[] = [];
    for (let i = 0; i <= ni; i++) {
      for (let j = 0; j <= nj; j++) {
        const k = i * cols + j;
        const p = P[k];
        if (i > 0) {
          const q = P[k - cols];
          U[k] = U[k - cols] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        }
        if (j > 0) {
          const q = P[k - 1];
          V[k] = V[k - 1] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        }
        const i0 = at(i - 1, j);
        const i1 = at(i + 1, j);
        const j0 = at(i, j - 1);
        const j1 = at(i, j + 1);
        _x.set(i1[0] - i0[0], i1[1] - i0[1], i1[2] - i0[2]);
        _y.set(j1[0] - j0[0], j1[1] - j0[1], j1[2] - j0[2]);
        _z.crossVectors(_x, _y);
        if (_z.lengthSq() < 1e-12) _z.set(0, 1, 0);
        else _z.normalize();
        N.push(_z.x, _z.y, _z.z);
      }
    }
    for (const side of twoSided ? [1, -1] : [1]) {
      const base = this.count;
      for (let k = 0; k < P.length; k++) this.vertex(P[k][0], P[k][1], P[k][2], N[k * 3] * side, N[k * 3 + 1] * side, N[k * 3 + 2] * side, U[k], V[k]);
      for (let i = 0; i < ni; i++) {
        for (let j = 0; j < nj; j++) {
          const p00 = base + i * cols + j;
          const p10 = p00 + cols;
          const p01 = p00 + 1;
          const p11 = p10 + 1;
          if (side === 1) this.idx.push(p00, p10, p11, p00, p11, p01);
          else this.idx.push(p00, p11, p10, p00, p01, p11);
        }
      }
    }
    return this;
  }

  /** Send everything gathered so far to the chunk as one mesh piece and start again. */
  flush(out: ChunkBuilder, material: THREE.Material, frame?: THREE.Matrix4): void {
    if (this.empty) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.idx);
    out.addGeometry(g, material, frame);
    g.dispose();
    this.pos = [];
    this.nor = [];
    this.uvs = [];
    this.idx = [];
  }
}

/** One `Geo` per material in a single frame; `flush` emits one `addGeometry` call for each. */
export class Batch {
  private geos = new Map<THREE.Material, Geo>();
  private placement: Placement = { m: null, n: new THREE.Matrix3() };

  constructor(
    private out: ChunkBuilder,
    readonly frame: THREE.Matrix4,
  ) {}

  g(material: THREE.Material): Geo {
    let geo = this.geos.get(material);
    if (!geo) this.geos.set(material, (geo = new Geo(this.placement)));
    return geo;
  }

  /** Place everything added inside `fn`, whatever its material, at a point turned `yaw` about the vertical. */
  at(x: number, y: number, z: number, yaw: number, fn: () => void): void {
    const first = this.geos.values().next().value ?? new Geo(this.placement);
    first.at(x, y, z, yaw, fn);
  }

  flush(): void {
    for (const [material, geo] of this.geos) geo.flush(this.out, material, this.frame);
    this.geos.clear();
  }
}

/** Frame nested in another: move to (x, y, z), then turn `yaw` about the vertical. */
export const sub = (f: THREE.Matrix4, x: number, y: number, z: number, yaw = 0) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z).premultiply(f);

const decals = new WeakMap<THREE.Material, Map<number, THREE.Material>>();

/**
 * Copy of a library material nudged towards the camera, for ground cover laid on the terrain (car parks,
 * painted lines), the same way the road meshes are. Registered with the library so shadows still apply.
 */
export function decal(materials: MaterialLibrary, material: THREE.Material, factor = -2): THREE.Material {
  if (typeof material.clone !== 'function') return material;
  let byFactor = decals.get(material);
  if (!byFactor) decals.set(material, (byFactor = new Map()));
  let copy = byFactor.get(factor);
  if (!copy) {
    copy = material.clone();
    copy.polygonOffset = true;
    copy.polygonOffsetFactor = factor;
    copy.polygonOffsetUnits = factor * 2;
    byFactor.set(factor, materials.register(copy));
  }
  return copy;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}

export interface FenceOptions {
  /** Height of the top rail. */
  height?: number;
  /** Distance between posts. */
  spacing?: number;
  /** Number of rails, evenly spread below the top one. */
  rails?: number;
  /** Post thickness. */
  post?: number;
  /** Rail size: [vertical, horizontal]. */
  rail?: [number, number];
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Posts stand this much taller than the top rail. */
  proud?: number;
}

/** A landmark being built: its frame, seeded variation and terrain-aware placement helpers. */
export class Site {
  readonly m: MaterialLibrary;
  /** Frame at the placement, standing on the ground at its centre. */
  readonly f: THREE.Matrix4;
  /** World height of the frame origin. */
  readonly y: number;
  readonly seed: number;
  readonly rng: Rng;
  private readonly sin: number;
  private readonly cos: number;

  constructor(
    readonly p: LandmarkPlacement,
    readonly out: ChunkBuilder,
  ) {
    this.y = out.world.groundAt(p.x, p.z);
    // Set dressing (`kind: 'dressing'`, see scatter/setpieces.ts) keeps the library as it is.
    this.m = p.kind === 'dressing' ? out.materials : agedLibrary(out.materials, p, this.y);
    this.f = out.frameAt(p.x, this.y, p.z, p.heading);
    this.sin = Math.sin(p.heading);
    this.cos = Math.cos(p.heading);
    this.seed = hashInts(Math.round(p.x), Math.round(p.z), hashString(p.kind));
    this.rng = new Rng(this.seed);
  }

  /** Library material, optionally recoloured. */
  mat(surface: SurfaceKind, color?: number, extra?: MaterialOptions): THREE.MeshStandardMaterial {
    if (color === undefined && !extra) return this.m.get(surface);
    return this.m.get(surface, color === undefined ? extra : { color, ...extra });
  }

  /** Ground-cover version of a material (see `decal`). */
  ground(surface: SurfaceKind, color?: number, factor = -2): THREE.Material {
    return decal(this.m, this.mat(surface, color), factor);
  }

  wx(lx: number, lz: number): number {
    return this.p.x + lx * this.cos + lz * this.sin;
  }

  wz(lx: number, lz: number): number {
    return this.p.z - lx * this.sin + lz * this.cos;
  }

  /** Terrain height at a local point, relative to the site origin. */
  gy(lx: number, lz: number): number {
    return this.out.world.groundAt(this.wx(lx, lz), this.wz(lx, lz)) - this.y;
  }

  /** Frame standing on the terrain at a local point, turned `yaw` from the site's front. */
  at(lx: number, lz: number, yaw = 0, lift = 0): THREE.Matrix4 {
    const x = this.wx(lx, lz);
    const z = this.wz(lx, lz);
    return this.out.frameAt(x, this.out.world.groundAt(x, z) + lift, z, this.p.heading + yaw);
  }

  batch(frame: THREE.Matrix4 = this.f): Batch {
    return new Batch(this.out, frame);
  }

  /** Instanced prop standing on the terrain at a local point. */
  prop(kind: string, lx: number, lz: number, yaw = 0, scale = 1, tint?: number): void {
    const x = this.wx(lx, lz);
    const z = this.wz(lx, lz);
    this.out.instance(kind, x, this.out.world.groundAt(x, z), z, this.p.heading + yaw, scale, tint);
  }

  /** Night light at a local point, `ly` above the site origin. */
  light(lx: number, ly: number, lz: number, color: number, intensity: number, range: number): void {
    // Intensities around 1 date from before the light pool was calibrated; it wants candela (a street lamp is 170).
    this.out.light(this.wx(lx, lz), this.y + ly, this.wz(lx, lz), color, intensity < 12 ? intensity * 110 : intensity, range);
  }

  /** Sign text from the placement (`params.sign`), else a fallback. */
  label(fallback: string): string {
    const custom = this.p.params?.sign;
    return typeof custom === 'string' && custom.length > 0 ? custom.toUpperCase() : fallback;
  }

  /** Painted board, `width` wide, facing local +z turned by `yaw`. */
  sign(f: THREE.Matrix4, text: string, cx: number, cy: number, cz: number, width: number, aspect: number, options: SignOptions = {}, yaw = 0): void {
    this.out.quad(f, cx, cy, cz, width, width / aspect, this.m.sign(text, { aspect, ...options }), yaw);
  }

  /** Board readable from both sides (name boards, price boards). */
  signBoard(f: THREE.Matrix4, text: string, cx: number, cy: number, cz: number, width: number, aspect: number, options: SignOptions = {}, yaw = 0): void {
    const off = 0.06;
    const sx = Math.sin(yaw) * off;
    const sz = Math.cos(yaw) * off;
    this.sign(f, text, cx + sx, cy, cz + sz, width, aspect, options, yaw);
    this.sign(f, text, cx - sx, cy, cz - sz, width, aspect, options, yaw + Math.PI);
  }

  /**
   * Several lines of lettering as a stack of one-line boards (each line gets its own full-height cell in
   * the sign atlas, so price boards and notices stay sharp). `cy` is the middle of the stack; `both` adds
   * the back faces for a free-standing board.
   */
  signStack(f: THREE.Matrix4, lines: readonly string[], cx: number, cy: number, cz: number, width: number, lineHeight: number, options: SignOptions = {}, yaw = 0, both = false): void {
    lines.forEach((text, i) => {
      const y = cy + ((lines.length - 1) / 2 - i) * lineHeight;
      const opts = { border: false, ...options };
      if (both) this.signBoard(f, text, cx, y, cz, width, width / lineHeight, opts, yaw);
      else this.sign(f, text, cx, y, cz, width, width / lineHeight, opts, yaw);
    });
  }

  /**
   * Rectangle of ground cover draped over the terrain (site frame). `lift` keeps it clear of the grass;
   * use a `ground()` material so it never z-fights.
   */
  drape(g: Geo, cx: number, cz: number, w: number, d: number, lift = 0.06, yaw = 0, step = 5): void {
    const nw = Math.max(1, Math.ceil(w / step));
    const nd = Math.max(1, Math.ceil(d / step));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // i runs along z and j along x so the sheet faces up.
    g.sheet(nd, nw, (i, j) => {
      const u = -w / 2 + (w * j) / nw;
      const v = -d / 2 + (d * i) / nd;
      const lx = cx + u * c + v * s;
      const lz = cz - u * s + v * c;
      return [lx, this.gy(lx, lz) + lift, lz];
    });
  }

  /** Ribbon of ground cover along a path (site frame [x, z] points): tracks, paths, painted lines. */
  ribbon(g: Geo, pts: readonly (readonly [number, number])[], width: number, lift = 0.09, closed = false, step = 5): void {
    const path = this.resample(pts, step, closed);
    const n = path.length;
    if (n < 2) return;
    const lanes = Math.max(1, Math.ceil(width / (step * 1.6)));
    g.sheet(n - 1, lanes, (i, j) => {
      const prev = path[closed ? (i - 1 + (n - 1)) % (n - 1) : Math.max(0, i - 1)];
      const next = path[closed ? (i + 1) % (n - 1) : Math.min(n - 1, i + 1)];
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      // j runs from the right edge to the left so the sheet faces up.
      const off = -width / 2 + (width * j) / lanes;
      const lx = path[i][0] + (dz / l) * off;
      const lz = path[i][1] - (dx / l) * off;
      return [lx, this.gy(lx, lz) + lift, lz];
    });
  }

  /** Straight painted line on the ground. */
  line(g: Geo, x0: number, z0: number, x1: number, z1: number, width = 0.12, lift = 0.1): void {
    this.ribbon(g, [[x0, z0], [x1, z1]], width, lift);
  }

  /** Row of marked parking bays: `n` bays side by side along local x (turned by `yaw`), noses towards -z. */
  bays(g: Geo, cx: number, cz: number, n: number, yaw = 0, bayW = 2.6, bayD = 5.2): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const pt = (u: number, v: number): [number, number] => [cx + u * c + v * s, cz - u * s + v * c];
    const w = n * bayW;
    for (let i = 0; i <= n; i++) {
      const u = -w / 2 + i * bayW;
      const a = pt(u, -bayD / 2);
      const b = pt(u, bayD / 2);
      this.line(g, a[0], a[1], b[0], b[1]);
    }
    const a = pt(-w / 2, -bayD / 2);
    const b = pt(w / 2, -bayD / 2);
    this.line(g, a[0], a[1], b[0], b[1]);
  }

  /**
   * Post-and-rail fence along a path in the site frame, following the terrain. Rails run straight between
   * points at most 20 m apart, so long runs cost few triangles.
   */
  fence(g: Geo, pts: readonly (readonly [number, number])[], options: FenceOptions = {}): void {
    const height = options.height ?? 1.2;
    const spacing = options.spacing ?? 2.5;
    const rails = options.rails ?? 3;
    const post = options.post ?? 0.12;
    const [rv, rh] = options.rail ?? [0.1, 0.05];
    const proud = options.proud ?? 0.08;
    const path = this.resample(pts, 20, options.closed ?? false);
    const ys = path.map((q) => this.gy(q[0], q[1]));
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      for (let r = 0; r < rails; r++) {
        const h = height - (r * (height - 0.25)) / Math.max(1, rails);
        g.beam([ax, ys[i] + h - rv / 2, az], [bx, ys[i + 1] + h - rv / 2, bz], rh, rv);
      }
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        g.post(ax + (bx - ax) * t, ys[i] + (ys[i + 1] - ys[i]) * t - 0.2, az + (bz - az) * t, post, height + proud + 0.2);
      }
    }
    const last = path.length - 1;
    if (!options.closed && last > 0) g.post(path[last][0], ys[last] - 0.2, path[last][1], post, height + proud + 0.2);
  }

  /** Break a path into pieces no longer than `step`, keeping the corners. Closed paths repeat the first point at the end. */
  private resample(pts: readonly (readonly [number, number])[], step: number, closed: boolean): [number, number][] {
    const src = closed ? [...pts, pts[0]] : pts;
    const out: [number, number][] = [];
    for (let i = 0; i < src.length - 1; i++) {
      const [ax, az] = src[i];
      const [bx, bz] = src[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    const end = src[src.length - 1];
    out.push([end[0], end[1]]);
    return out;
  }
}

// ───────────────────────────── Building pieces ─────────────────────────────

/** Walls as one box, carried `below` under the frame so sloping ground never shows a gap. */
export function walls(out: ChunkBuilder, f: THREE.Matrix4, cx: number, cz: number, w: number, h: number, d: number, material: THREE.Material, below = 1.5): void {
  out.box(f, cx, (h - below) / 2, cz, w, h + below, d, material);
}

/**
 * Gable roof with wall-coloured gable ends. The ridge runs along the frame's x; `w` and `d` are the wall
 * size. The roof oversails the side walls by `eave` and sits almost flush at the gable ends, where `ends`
 * gets the wall infill (leaving a barge-board edge of roof colour).
 */
export function gableRoof(out: ChunkBuilder, ends: Geo, f: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, roof: THREE.Material, eave = 0.4): void {
  const rw = w + 0.06;
  const rd = d + eave * 2;
  out.gable(f, cx, y, cz, rw, rd, rise, roof);
  const inset = 0.2;
  const k = (rd / 2 - inset) / (rd / 2);
  for (const side of [1, -1]) {
    const x = cx + side * (rw / 2 + 0.015);
    const a: V3 = [x, y, cz + (rd / 2 - inset) * side];
    const b: V3 = [x, y, cz - (rd / 2 - inset) * side];
    const c: V3 = [x, y + rise * k - 0.04, cz];
    ends.poly([a, b, c]);
  }
}

/** Evenly spaced windows along a wall facing `yaw` (0 = +z, π/2 = +x…). `along` is the wall's own axis coordinate. */
export function windowRow(out: ChunkBuilder, f: THREE.Matrix4, from: number, to: number, n: number, y: number, face: number, w: number, h: number, material: THREE.Material, yaw = 0): void {
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * (i + 0.5)) / n;
    if (yaw === 0) out.quad(f, t, y, face, w, h, material, 0);
    else if (Math.abs(yaw - Math.PI) < 1e-6) out.quad(f, t, y, face, w, h, material, Math.PI);
    else out.quad(f, face, y, t, w, h, material, yaw);
  }
}

/** Lean-to verandah along a wall facing +z: roof slab falling away from the wall on posts. */
export function verandah(b: Batch, roof: THREE.Material, posts: THREE.Material, x0: number, x1: number, zWall: number, depth: number, yWall: number, yEave: number, bays: number): void {
  b.g(roof).slab([x0, yEave, zWall + depth], [x1, yEave, zWall + depth], [x1, yWall, zWall], [x0, yWall, zWall], 0.08);
  const g = b.g(posts);
  for (let i = 0; i <= bays; i++) g.post(x0 + 0.12 + ((x1 - x0 - 0.24) * i) / bays, 0, zWall + depth - 0.15, 0.12, yEave - 0.06);
  g.box((x0 + x1) / 2, yEave - 0.16, zWall + depth - 0.15, x1 - x0, 0.16, 0.06);
}

/** Rugby goal: two uprights and a crossbar across local x. */
export function rugbyPosts(g: Geo, x: number, y: number, z: number, yaw: number, height = 9, width = 5.6): void {
  g.at(x, y, z, yaw, () => {
    for (const side of [-1, 1]) g.tube([(side * width) / 2, -0.3, 0], [(side * width) / 2, height, 0], 0.07, 0.05, 6);
    g.tube([-width / 2, 3, 0], [width / 2, 3, 0], 0.05, 0.05, 6);
  });
}

/** Flagpole with a ball finial. */
export function flagpole(g: Geo, x: number, y: number, z: number, height = 8): void {
  g.tube([x, y - 0.3, z], [x, y + height, z], 0.06, 0.035, 6);
  g.lathe(x, y + height, z, [[0, 0], [0.09, 0.07], [0.09, 0.13], [0, 0.2]], 6);
}

/** Picnic table with bench seats, long axis along local x. */
export function picnicTable(g: Geo, x: number, y: number, z: number, yaw = 0): void {
  g.at(x, y, z, yaw, () => {
    g.box(0, 0.74, 0, 1.8, 0.06, 0.75);
    for (const side of [-1, 1]) {
      g.box(0, 0.44, side * 0.68, 1.8, 0.05, 0.26);
      g.post(side * 0.7, 0, 0, 0.08, 0.72, 1.3);
    }
  });
}

/** Slatted park bench facing local +z. */
export function bench(g: Geo, x: number, y: number, z: number, yaw = 0, length = 1.8): void {
  g.at(x, y, z, yaw, () => {
    g.box(0, 0.45, 0, length, 0.06, 0.42);
    g.box(0, 0.78, -0.2, length, 0.36, 0.05);
    for (const side of [-1, 1]) g.post(side * (length / 2 - 0.12), 0, 0, 0.07, 0.45, 0.4);
  });
}

/**
 * Clock dial with hour marks and hands. The face stands at (cx, cy, cz) in a frame turned `yaw` about the
 * vertical (0 faces +z), so one call per side dresses a four-faced tower.
 */
export function clockFace(dial: Geo, marks: Geo, yaw: number, cx: number, cy: number, cz: number, r: number, hour: number, minute: number): void {
  const base = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeTranslation(cx, cy, cz));
  dial.with(base, () => dial.disc(0, 0, 0, r, 20));
  // Clockwise from twelve o'clock, seen from in front.
  const turned = (angle: number) => base.clone().multiply(new THREE.Matrix4().makeRotationZ(-angle));
  for (let i = 0; i < 12; i++) {
    const big = i % 3 === 0;
    const r0 = r * (big ? 0.72 : 0.8);
    const r1 = r * 0.93;
    marks.with(turned((TAU * i) / 12), () => marks.box(0, (r0 + r1) / 2, 0.03, r * (big ? 0.08 : 0.045), r1 - r0, 0.03));
  }
  const hand = (angle: number, length: number, width: number) => marks.with(turned(angle), () => marks.box(0, length * 0.42, 0.06, width, length * 1.16, 0.03));
  hand((TAU * (hour + minute / 60)) / 12, r * 0.5, r * 0.1);
  hand((TAU * minute) / 60, r * 0.78, r * 0.065);
}
