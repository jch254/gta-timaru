import { ROUND3_OFF } from '../../scatter/util';
import { agedLibrary } from '../aged';
import * as THREE from 'three';
import type { ChunkBuilder, LandmarkPlacement, MaterialLibrary, RailLine, SignOptions, WorldApi } from '../../../core/types';
import { mergeGeometries } from '../../props/index';

/**
 * Small construction kit shared by the Christchurch landmark builders.
 *
 * A `Kit` wraps the ChunkBuilder with a local frame (local +z = the landmark's front, +x = to the right
 * when you stand in front of it looking at it) and takes base heights rather than centre heights.
 * Custom geometry goes through `geo()`, which merges everything of one material into a single
 * `addGeometry` call when the builder calls `flush()`.
 */

export type Mat = THREE.Material;
export type Pt2 = [number, number];
import type { V3 } from '../../../core/vec3';
export type { V3 } from '../../../core/vec3';

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** How far ground-standing boxes and cylinders extend below local ground level. */
const SINK = 0.8;

interface Shared {
  bags: Map<Mat, THREE.BufferGeometry[]>;
  lights: number;
  rails: { x: number; z: number }[] | null;
}

export class Kit {
  readonly m: MaterialLibrary;
  readonly world: WorldApi;

  private constructor(
    readonly out: ChunkBuilder,
    readonly p: LandmarkPlacement,
    /** Local → world. */
    readonly f: THREE.Matrix4,
    private readonly shared: Shared,
    /** True while local y = 0 is ground level: boxes and cylinders standing on it are sunk a little into the ground. */
    private readonly grounded = true,
  ) {
    this.m = agedLibrary(out.materials, p, f.elements[13]);
    this.world = out.world;
  }

  /** Kit at the placement (or at an overridden position / heading / height). */
  static at(p: LandmarkPlacement, out: ChunkBuilder, opts: { x?: number; z?: number; y?: number; heading?: number } = {}): Kit {
    const x = opts.x ?? p.x;
    const z = opts.z ?? p.z;
    const y = opts.y ?? out.world.groundAt(x, z);
    return new Kit(out, p, out.frameAt(x, y, z, opts.heading ?? p.heading), { bags: new Map(), lights: 0, rails: null });
  }

  /** Child kit offset and turned about y (its +z is this kit's +z rotated by `yaw` towards +x). Shares the merge bags. */
  sub(x: number, y: number, z: number, yaw = 0): Kit {
    return new Kit(this.out, this.p, this.f.clone().multiply(_m.makeRotationY(yaw).setPosition(x, y, z)), this.shared, this.grounded && y === 0);
  }

  /**
   * Child kit standing on the ground at a local point (its y = 0 is the ground there, or `floor` if that is higher),
   * for parts of a spread-out landmark that should each follow the lie of the land.
   */
  seat(x: number, z: number, yaw = 0, floor = -Infinity): Kit {
    return new Kit(this.out, this.p, this.f.clone().multiply(_m.makeRotationY(yaw).setPosition(x, Math.max(floor, this.ground(x, z)), z)), this.shared, true);
  }

  /**
   * Child kits on the four faces of a footprint, each with +z pointing out of the wall and x running along it.
   * Order: front (+z), right (+x), back (−z), left (−x).
   */
  faces(cx: number, cz: number, w: number, d: number, y = 0): { k: Kit; len: number }[] {
    return [
      { k: this.sub(cx, y, cz + d / 2, 0), len: w },
      { k: this.sub(cx + w / 2, y, cz, Math.PI / 2), len: d },
      { k: this.sub(cx, y, cz - d / 2, Math.PI), len: w },
      { k: this.sub(cx - w / 2, y, cz, -Math.PI / 2), len: d },
    ];
  }

  // ───────────── Queries ─────────────

  /** World heading of this kit's +z. */
  get heading(): number {
    return Math.atan2(this.f.elements[8], this.f.elements[0]);
  }

  /** Ground height at a local point, relative to the local origin. */
  ground(lx: number, lz: number): number {
    _p.set(lx, 0, lz).applyMatrix4(this.f);
    return this.world.groundAt(_p.x, _p.z) - this.f.elements[13];
  }

  /** Water depth at a local point. */
  water(lx: number, lz: number): number {
    _p.set(lx, 0, lz).applyMatrix4(this.f);
    return this.world.waterDepthAt(_p.x, _p.z);
  }

  /**
   * True when a local point is dry, off every carriageway and rail / tram line (by `margin` metres) and,
   * optionally, outside every other landmark's clear radius. Used for street furniture on shared ground.
   */
  free(lx: number, lz: number, margin = 1, avoidLandmarks = false): boolean {
    _p.set(lx, 0, lz).applyMatrix4(this.f);
    const x = _p.x;
    const z = _p.z;
    if (this.world.waterDepthAt(x, z) > 0.05) return false;
    const hit = this.world.graph.nearest(x, z, 30);
    if (hit) {
      // Malls and squares are wide 'pedestrian' edges: only their middle is kept clear for foot traffic.
      const half = hit.edge.cls === 'pedestrian' ? Math.min(hit.edge.width / 2, 2.5) : hit.edge.width / 2;
      if (hit.distance < half + margin) return false;
    }
    if (!this.shared.rails) {
      const reach = this.p.clearRadius + 12;
      this.shared.rails = [];
      for (const line of this.world.railways) {
        for (const q of line.points) if (Math.hypot(q.x - this.p.x, q.z - this.p.z) < reach) this.shared.rails.push({ x: q.x, z: q.z });
      }
    }
    for (const q of this.shared.rails) if (Math.hypot(q.x - x, q.z - z) < margin + 4.6) return false;
    if (avoidLandmarks) {
      for (const l of this.world.landmarks) if (l !== this.p && Math.hypot(l.x - x, l.z - z) < l.clearRadius + margin) return false;
    }
    return true;
  }

  // ───────────── Primitives (y0 = base height) ─────────────

  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, mat: Mat): this {
    // Anything standing on the ground gets a buried footing, so it never floats where the land dips.
    const sink = this.grounded && y0 === 0 ? SINK : 0;
    this.out.box(this.f, cx, y0 - sink + (h + sink) / 2, cz, w, h + sink, d, mat);
    return this;
  }

  collide(cx: number, y0: number, cz: number, w: number, h: number, d: number): this {
    this.out.collider(this.f, cx, y0 + h / 2, cz, w, h, d);
    return this;
  }

  /** Box with a matching collider. */
  solid(cx: number, y0: number, cz: number, w: number, h: number, d: number, mat: Mat): this {
    return this.box(cx, y0, cz, w, h, d, mat).collide(cx, y0, cz, w, h, d);
  }

  /** Gable roof: `len` along the ridge, `span` across it, eaves at y. The ridge runs along local x, or z when `alongZ`. */
  roof(cx: number, y: number, cz: number, len: number, span: number, rise: number, mat: Mat, alongZ = false, hip = 0): this {
    if (alongZ) this.out.gable(this.sub(cx, y, cz, Math.PI / 2).f, 0, 0, 0, len, span, rise, mat, hip);
    else this.out.gable(this.f, cx, y, cz, len, span, rise, mat, hip);
    return this;
  }

  cyl(cx: number, y0: number, cz: number, rTop: number, rBottom: number, h: number, mat: Mat, segments = 12): this {
    const sink = this.grounded && y0 === 0 ? SINK : 0;
    this.out.cylinder(this.f, cx, y0 - sink + (h + sink) / 2, cz, rTop, rBottom, h + sink, mat, segments);
    return this;
  }

  /** Flat quad centred at (cx, cy, cz) facing local +z turned by `yaw`. */
  quad(cx: number, cy: number, cz: number, w: number, h: number, mat: Mat, yaw = 0, metres = false): this {
    this.out.quad(this.f, cx, cy, cz, w, h, mat, yaw, metres);
    return this;
  }

  /** Painted sign board. */
  sign(text: string, cx: number, cy: number, cz: number, w: number, h: number, yaw = 0, options: SignOptions = {}): this {
    return this.quad(cx, cy, cz, w, h, this.m.sign(text, { aspect: Math.max(1, Math.round((w / h) * 2) / 2), ...options }), yaw);
  }

  /** Night-only point light. A landmark gets at most two; further calls are ignored. */
  light(lx: number, ly: number, lz: number, color: number, intensity: number, range: number): this {
    if (this.shared.lights >= 2) return this;
    this.shared.lights++;
    _p.set(lx, ly, lz).applyMatrix4(this.f);
    // Builders written before the light pool was calibrated pass intensities around 1; the pool wants candela
    // (a street lamp is 170).
    this.out.light(_p.x, _p.y, _p.z, color, intensity < 12 ? intensity * 110 : intensity, range);
    return this;
  }

  /** Instanced prop standing on the ground at a local point (or at local height `ly` when given). */
  prop(kind: string, lx: number, lz: number, yaw = 0, scale = 1, tint?: number, ly?: number): this {
    _p.set(lx, 0, lz).applyMatrix4(this.f);
    const y = ly === undefined ? this.world.groundAt(_p.x, _p.z) : this.f.elements[13] + ly;
    const x = _p.x;
    const z = _p.z;
    const h = this.heading + yaw;
    this.out.instance(kind, x, y, z, h, scale, tint);
    // A tub is stood with its planting; an oval bed with three drifts of bedding on its soil.
    if (ROUND3_OFF) return this;
    if (kind === 'chch-planter') this.out.instance('planter-plants', x, y, z, h, scale);
    if (kind === 'chch-flowerbed') {
      for (const [lx2, lz2] of [[-1.45, 0], [0.75, -0.42], [0.75, 0.42]]) this.out.instance('flower-bed', x + lx2 * Math.cos(h) + lz2 * Math.sin(h), y + 0.1, z - lx2 * Math.sin(h) + lz2 * Math.cos(h), h);
    }
    return this;
  }

  // ───────────── Custom geometry (merged per material at flush) ─────────────

  private bag(mat: Mat): THREE.BufferGeometry[] {
    let list = this.shared.bags.get(mat);
    if (!list) this.shared.bags.set(mat, (list = []));
    return list;
  }

  /** Custom geometry in this kit's frame, optionally offset and turned about y. The geometry is copied. */
  geo(geometry: THREE.BufferGeometry, mat: Mat, x = 0, y = 0, z = 0, yaw = 0): this {
    _m.makeRotationY(yaw).setPosition(x, y, z).premultiply(this.f);
    this.bag(mat).push(geometry.clone().applyMatrix4(_m));
    return this;
  }

  /** Small detail box (merged with other custom geometry rather than costing a primitive call). */
  dbox(cx: number, y0: number, cz: number, w: number, h: number, d: number, mat: Mat): this {
    return this.geo(boxGeo(w, h, d), mat, cx, y0, cz);
  }

  /** Thin member between two local points. */
  beam(a: V3, b: V3, t: number, mat: Mat): this {
    return this.geo(beam(a, b, t), mat);
  }

  /** `n` flat panes evenly spaced along local x over `len`, centred at height cy, facing +z. UVs span each pane. */
  panes(mat: Mat, len: number, cy: number, n: number, w: number, h: number, z = 0.04, cx = 0): this {
    const pane = new THREE.PlaneGeometry(w, h);
    for (let i = 0; i < n; i++) this.geo(pane, mat, cx - len / 2 + ((i + 0.5) * len) / n, cy, z);
    return this;
  }

  /**
   * `n` pointed-arch windows evenly spaced along local x over `len`, sills at y0, facing +z. With `frame`, each sits
   * in a dressed-stone surround of that material.
   */
  lancets(mat: Mat, len: number, y0: number, n: number, w: number, h: number, z = 0.04, cx = 0, frame?: Mat): this {
    const g = lancet(w, h);
    const surround = frame ? lancet(w + 0.36, h + 0.3) : null;
    for (let i = 0; i < n; i++) {
      const x = cx - len / 2 + ((i + 0.5) * len) / n;
      if (surround && frame) this.geo(surround, frame, x, y0 - 0.12, z);
      this.geo(g, mat, x, y0, z + (frame ? 0.025 : 0));
    }
    return this;
  }

  /** Stone gable-end wall: triangle `span` wide and `rise` high standing on y0, `t` thick, facing local +z turned by yaw. */
  pediment(cx: number, y0: number, cz: number, span: number, rise: number, t: number, mat: Mat, yaw = 0): this {
    return this.geo(prism([[-span / 2, 0], [span / 2, 0], [0, rise]], t), mat, cx, y0, cz, yaw);
  }

  // ───────────── Ground cover draped on the terrain ─────────────

  /**
   * Paving / lawn on a grid of local breakpoints. `pick` chooses each cell's material (null leaves a hole), so
   * bands and bay lines are cells of the same layer rather than overlapping decals. Cells in water are skipped.
   */
  pave(xs: number[], zs: number[], pick: (i: number, j: number, cx: number, cz: number) => Mat | null, lift = 0.025): this {
    // World position of a local point on the ground; shared corners are sampled once.
    const samples = new Map<string, V3>();
    const at = (lx: number, lz: number): V3 => {
      const key = `${Math.round(lx * 100)}|${Math.round(lz * 100)}`;
      let v = samples.get(key);
      if (!v) {
        _p.set(lx, 0, lz).applyMatrix4(this.f);
        samples.set(key, (v = [_p.x, this.world.groundAt(_p.x, _p.z) + lift, _p.z]));
      }
      return v;
    };
    const parts = new Map<Mat, { pos: number[]; uv: number[] }>();
    const cell = (part: { pos: number[]; uv: number[] }, x0: number, x1: number, z0: number, z1: number, depth: number) => {
      const a = at(x0, z0);
      const b = at(x0, z1);
      const c = at(x1, z1);
      const d = at(x1, z0);
      if (depth < 3 && (x1 - x0 > 4.5 || z1 - z0 > 4.5)) {
        // Where the ground curves under a cell, split it so the paving neither floats nor sinks.
        const mid = at((x0 + x1) / 2, (z0 + z1) / 2);
        if (Math.abs(mid[1] - (a[1] + b[1] + c[1] + d[1]) / 4) > 0.012) {
          if (x1 - x0 >= z1 - z0) {
            cell(part, x0, (x0 + x1) / 2, z0, z1, depth + 1);
            cell(part, (x0 + x1) / 2, x1, z0, z1, depth + 1);
          } else {
            cell(part, x0, x1, z0, (z0 + z1) / 2, depth + 1);
            cell(part, x0, x1, (z0 + z1) / 2, z1, depth + 1);
          }
          return;
        }
      }
      // Two triangles, counter-clockwise seen from above.
      part.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      part.uv.push(x0, z0, x0, z1, x1, z1, x0, z0, x1, z1, x1, z0);
    };
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        const cz = (zs[j] + zs[j + 1]) / 2;
        const mat = pick(i, j, cx, cz);
        if (!mat || this.water(cx, cz) > 0.05) continue;
        let part = parts.get(mat);
        if (!part) parts.set(mat, (part = { pos: [], uv: [] }));
        cell(part, xs[i], xs[i + 1], zs[j], zs[j + 1], 0);
      }
    }
    for (const [mat, part] of parts) this.bag(mat).push(flatGround(part.pos, part.uv));
    return this;
  }

  /** Uniform draped rectangle of one material. */
  drape(cx: number, cz: number, w: number, d: number, mat: Mat, lift = 0.025, cell = 9): this {
    return this.pave(steps(cx - w / 2, cx + w / 2, cell), steps(cz - d / 2, cz + d / 2, cell), () => mat, lift);
  }

  /**
   * Draped ellipse made of concentric bands, each with its own material: `bands` lists [outer fraction 0..1, material]
   * from the centre outwards (null material = gap).
   */
  disc(cx: number, cz: number, rx: number, rz: number, bands: [number, Mat | null][], lift = 0.025, segments = 32): this {
    const parts = new Map<Mat, { pos: number[]; uv: number[] }>();
    const at = (f: number, a: number): V3 => {
      const lx = cx + Math.cos(a) * rx * f;
      const lz = cz + Math.sin(a) * rz * f;
      _p.set(lx, 0, lz).applyMatrix4(this.f);
      return [_p.x, this.world.groundAt(_p.x, _p.z) + lift, _p.z];
    };
    let inner = 0;
    for (const [outer, mat] of bands) {
      const f0 = inner;
      inner = outer;
      if (!mat) continue;
      // Wide bands are split into rings so they follow the ground.
      const rings = Math.max(1, Math.ceil(((outer - f0) * Math.max(rx, rz)) / 14));
      let part = parts.get(mat);
      if (!part) parts.set(mat, (part = { pos: [], uv: [] }));
      for (let r = 0; r < rings; r++) {
        const a0 = f0 + ((outer - f0) * r) / rings;
        const a1 = f0 + ((outer - f0) * (r + 1)) / rings;
        for (let s = 0; s < segments; s++) {
          const t0 = (s / segments) * Math.PI * 2;
          const t1 = ((s + 1) / segments) * Math.PI * 2;
          const mid = (t0 + t1) / 2;
          const fm = (a0 + a1) / 2;
          if (this.water(cx + Math.cos(mid) * rx * fm, cz + Math.sin(mid) * rz * fm) > 0.05) continue;
          // Angle increases from +x towards +z, so (inner t0, inner t1, outer t1, outer t0) faces up.
          const quad: [number, number][] = [[a0, t0], [a0, t1], [a1, t1], [a0, t0], [a1, t1], [a1, t0]];
          for (let q = a0 === 0 ? 3 : 0; q < 6; q++) {
            const [f, a] = quad[q];
            part.pos.push(...at(f, a));
            part.uv.push(cx + Math.cos(a) * rx * f, cz + Math.sin(a) * rz * f);
          }
        }
      }
    }
    for (const [mat, part] of parts) if (part.pos.length) this.bag(mat).push(flatGround(part.pos, part.uv));
    return this;
  }

  /** Draped path strip along a local polyline. */
  ribbon(pts: Pt2[], width: number, mat: Mat, lift = 0.035, closed = false): this {
    // Resample so the strip follows the ground.
    const line: Pt2[] = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7));
      for (let k = 0; k < count; k++) line.push([a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count]);
    }
    line.push(closed ? line[0] : pts[pts.length - 1]);
    const pos: number[] = [];
    const uv: number[] = [];
    const edge: V3[][] = [];
    let s = 0;
    for (let i = 0; i < line.length; i++) {
      const prev = line[i === 0 ? (closed ? line.length - 2 : 0) : i - 1];
      const next = line[i === line.length - 1 ? (closed ? 1 : i) : i + 1];
      const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
      const nx = (next[1] - prev[1]) / len;
      const nz = -(next[0] - prev[0]) / len;
      const side = (sign: number): V3 => {
        _p.set(line[i][0] + nx * sign * (width / 2), 0, line[i][1] + nz * sign * (width / 2)).applyMatrix4(this.f);
        return [_p.x, this.world.groundAt(_p.x, _p.z) + lift, _p.z];
      };
      if (i > 0) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      edge.push([side(1), side(-1), [s, 0, 0]]);
    }
    for (let i = 0; i < edge.length - 1; i++) {
      const [l0, r0, s0] = edge[i];
      const [l1, r1, s1] = edge[i + 1];
      // Left of the direction of travel is (tz, −tx); (l0, r0, r1) winds counter-clockwise seen from above.
      pos.push(...l0, ...r0, ...r1, ...l0, ...r1, ...l1);
      uv.push(0, s0[0], width, s0[0], width, s1[0], 0, s0[0], width, s1[0], 0, s1[0]);
    }
    this.bag(mat).push(flatGround(pos, uv));
    return this;
  }

  /** Foundation block from below the lowest ground under a footprint up to `top`, so nothing floats on a slope. */
  footing(cx: number, cz: number, w: number, d: number, top: number, mat: Mat, extra = 0.6): this {
    const lo =
      Math.min(0, this.ground(cx, cz), this.ground(cx - w / 2, cz - d / 2), this.ground(cx + w / 2, cz - d / 2), this.ground(cx - w / 2, cz + d / 2), this.ground(cx + w / 2, cz + d / 2)) -
      extra;
    return this.box(cx, lo, cz, w, top - lo, d, mat);
  }

  /** Emit the merged custom geometry. Call once, at the end of the builder. */
  flush(): void {
    for (const [mat, list] of this.shared.bags) {
      if (list.length) this.out.addGeometry(list.length === 1 ? list[0] : mergeGeometries(list), mat);
    }
    this.shared.bags.clear();
  }
}

// ───────────── Geometry helpers (all have position, normal and uv) ─────────────

function flatGround(pos: number[], uv: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Evenly spaced breakpoints from a to b, no further apart than `cell`. */
export function steps(a: number, b: number, cell: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / cell));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

/**
 * Breakpoints for a banded pavement: narrow bands of width `band` centred every `pitch` metres (through `offset`),
 * with the panels between them split to at most `maxCell`. `isBand[i]` describes the interval at[i]..at[i+1].
 */
export function tartan(min: number, max: number, pitch: number, band: number, offset = 0, maxCell = 12): { at: number[]; isBand: boolean[] } {
  const at: number[] = [min];
  const isBand: boolean[] = [];
  const fill = (to: number) => {
    const from = at[at.length - 1];
    if (to - from < 1e-6) return;
    const pts = steps(from, to, maxCell);
    for (let i = 1; i < pts.length; i++) {
      at.push(pts[i]);
      isBand.push(false);
    }
  };
  for (let c = offset + Math.ceil((min - offset) / pitch) * pitch; c < max; c += pitch) {
    const b0 = c - band / 2;
    const b1 = c + band / 2;
    if (b0 <= min || b1 >= max) continue;
    fill(b0);
    at.push(b1);
    isBand.push(true);
  }
  fill(max);
  return { at, isBand };
}

/** Flat-shaded mesh builder with metre UVs (u runs horizontally along each face, v up it). */
export class Facets {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];

  /** Flat convex polygon, counter-clockwise seen from outside. */
  face(...pts: V3[]): this {
    const a = pts[0];
    // Newell's method: still well defined when an edge has collapsed (a wedge that tapers to nothing).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Horizontal tangent t = up × n; bitangent = n × t runs up the face.
    let tx = nz;
    let tz = -nx;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-4) {
      tx = 1;
      tz = 0;
    } else {
      tx /= tl;
      tz /= tl;
    }
    const bx = ny * tz;
    const by = nz * tx - nx * tz;
    const bz = -ny * tx;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const q of [a, pts[i], pts[i + 1]]) {
        this.pos.push(q[0], q[1], q[2]);
        this.nor.push(nx, ny, nz);
        this.uv.push(q[0] * tx + q[2] * tz, q[0] * bx + q[1] * by + q[2] * bz);
      }
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Box centred on x / z with its base at y = 0 and metre UVs. */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z (four vertices each).
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) uv.setXY(face * 4 + i, uv.getX(face * 4 + i) * dims[face][0], uv.getY(face * 4 + i) * dims[face][1]);
  }
  return g.translate(0, h / 2, 0);
}

/** Four-sided pyramid roof / spire: base w × d centred at y = 0, apex at h. */
export function pyramid(w: number, d: number, h: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const apex: V3 = [0, h, 0];
  return new Facets()
    .face([-x, 0, z], [x, 0, z], apex)
    .face([x, 0, z], [x, 0, -z], apex)
    .face([x, 0, -z], [-x, 0, -z], apex)
    .face([-x, 0, -z], [-x, 0, z], apex)
    .build();
}

/** Faceted cone / tapered drum: `sides` flat faces from radius r0 at y = 0 to r1 at y = h (r1 = 0 gives a spire). */
export function cone(r0: number, h: number, sides = 8, r1 = 0, phase = 0): THREE.BufferGeometry {
  const f = new Facets();
  const ring = (r: number, y: number, i: number): V3 => {
    const a = phase + (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const top: V3[] = [];
  for (let i = 0; i < sides; i++) {
    if (r1 <= 0) f.face(ring(r0, 0, i + 1), ring(r0, 0, i), [0, h, 0]);
    else f.face(ring(r0, 0, i + 1), ring(r0, 0, i), ring(r1, h, i), ring(r1, h, i + 1));
    top.push(ring(r1, h, sides - i));
  }
  if (r1 > 0) f.face(...top);
  return f.build();
}

/**
 * Block with sloping top and bottom: w × d centred on x / z; the bottom runs from y = b0 at the back (−z) to b1 at
 * the front (+z), the top from t0 to t1. Covers lean-to roofs, ramps, raked seating and sloped slabs.
 */
export function wedge(w: number, d: number, b0: number, t0: number, b1: number, t1: number): THREE.BufferGeometry {
  const x = w / 2;
  const z = d / 2;
  const f = new Facets();
  f.face([-x, t1, z], [x, t1, z], [x, t0, -z], [-x, t0, -z]);
  f.face([-x, b0, -z], [x, b0, -z], [x, b1, z], [-x, b1, z]);
  if (t1 - b1 > 1e-4) f.face([-x, b1, z], [x, b1, z], [x, t1, z], [-x, t1, z]);
  if (t0 - b0 > 1e-4) f.face([x, b0, -z], [-x, b0, -z], [-x, t0, -z], [x, t0, -z]);
  f.face([x, b1, z], [x, b0, -z], [x, t0, -z], [x, t1, z]);
  f.face([-x, b0, -z], [-x, b1, z], [-x, t1, z], [-x, t0, -z]);
  return f.build();
}

/** Outline (x, y) extruded `depth` along z, centred on z = 0. Flat-shaded, metre UVs. */
export function prism(outline: Pt2[], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -depth / 2);
}

/** Like `prism`, but the outline is a plan (x, z) and the solid stands `height` tall on y = 0. */
export function plinth(plan: Pt2[], height: number): THREE.BufferGeometry {
  // Extruding (x, −z) along +z and tipping it up keeps the plan the right way round.
  const shape = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x, -z)));
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2);
}

/**
 * Outline of an arched opening, counter-clockwise from its bottom-left corner: `w` wide, `h` to the crown, the
 * arch itself `rise` high (w / 2 = semicircular, more = pointed Gothic).
 */
export function archOutline(cx: number, y0: number, w: number, h: number, rise = w / 2, segments = 5): Pt2[] {
  const half = w / 2;
  const spring = y0 + h - rise;
  // Each side is an arc centred `c` beyond the centreline on the springing line.
  const c = (rise * rise - half * half) / w;
  const r = half + c;
  const phi = Math.acos(Math.min(1, Math.max(-1, c / r)));
  const pts: Pt2[] = [[cx - half, y0], [cx + half, y0]];
  for (let i = 0; i <= segments; i++) pts.push([cx - c + r * Math.cos((phi * i) / segments), spring + r * Math.sin((phi * i) / segments)]);
  for (let i = segments - 1; i >= 0; i--) pts.push([cx + c - r * Math.cos((phi * i) / segments), spring + r * Math.sin((phi * i) / segments)]);
  return pts;
}

export interface Opening {
  cx: number;
  w: number;
  h: number;
  /** Height of the arched head (default semicircular). */
  rise?: number;
}

/**
 * Wall `w` wide and `h` high (centred on x, standing on y = 0) pierced by arched openings that reach the ground,
 * `t` thick. `top` optionally replaces the flat top with points listed from right to left (gables, stepped attics).
 */
export function arcade(w: number, h: number, t: number, openings: Opening[], top?: Pt2[]): THREE.BufferGeometry {
  const pts: Pt2[] = [[-w / 2, 0]];
  for (const o of [...openings].sort((a, b) => a.cx - b.cx)) {
    const arch = archOutline(o.cx, 0, o.w, o.h, o.rise ?? o.w / 2);
    pts.push(arch[0], ...arch.slice(2).reverse(), arch[1]);
  }
  pts.push([w / 2, 0], ...(top ?? [[w / 2, h], [-w / 2, h]]));
  return prism(pts, t);
}

/** Flat pointed-arch window facing +z, centred on x with its sill at y = 0. */
export function lancet(w: number, h: number, rise = w * 0.9): THREE.BufferGeometry {
  return new THREE.ShapeGeometry(new THREE.Shape(archOutline(0, 0, w, h, Math.min(rise, h - 0.05), 4).map(([x, y]) => new THREE.Vector2(x, y))));
}

/** Disc facing +z (`flat` lays it facing up instead). */
export function disc(r: number, segments = 20, flat = false): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, segments);
  return flat ? g.rotateX(-Math.PI / 2) : g;
}

/** Ring facing +z (`flat` lays it down). */
export function ring(r: number, tube: number, segments = 20, flat = false): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 5, segments);
  return flat ? g.rotateX(-Math.PI / 2) : g;
}

/** Half-sphere dome of radius r and height h standing on y = 0. */
export function dome(r: number, h = r, segments = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, segments, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1);
}

export function sphere(r: number, segments = 10): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, segments, Math.max(5, Math.round(segments * 0.7)));
}

/** Cylinder lying along z (wheels, drums, dishes), centred on the origin. */
export function drum(r: number, len: number, segments = 12): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, segments).rotateX(Math.PI / 2);
}

/** Upright drum with an elliptical plan (semi-axes rx, rz), base at y = 0, metre UVs on the wall. */
export function ellipseDrum(rx: number, rz: number, h: number, segments = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, h, segments);
  const uv = g.getAttribute('uv');
  const around = Math.PI * (rx + rz);
  // The side wall comes first: (segments + 1) × 2 vertices.
  for (let i = 0; i < (segments + 1) * 2; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
  for (let i = (segments + 1) * 2; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx * 2, uv.getY(i) * rz * 2);
  return g.scale(rx, 1, rz).translate(0, h / 2, 0);
}

/** Square-section member from a to b. */
export function beam(a: V3, b: V3, t: number): THREE.BufferGeometry {
  _p.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _p.length();
  const g = new THREE.BoxGeometry(t, t, len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z_AXIS, _p.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

// ───────────── Map helpers ─────────────

/** Numeric placement parameter with a default. */
export function num(p: LandmarkPlacement, key: string, fallback: number): number {
  const v = p.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Nearest point on a railway / tram line within `maxDistance`, with the line's unit tangent there. */
export function nearestRail(world: WorldApi, x: number, z: number, maxDistance: number, kind?: RailLine['kind']): { x: number; z: number; tx: number; tz: number; distance: number } | null {
  let best: { x: number; z: number; tx: number; tz: number; distance: number } | null = null;
  for (const line of world.railways) {
    if (kind && line.kind !== kind) continue;
    const pts = line.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.x - x) > maxDistance + 12 || Math.abs(a.z - z) > maxDistance + 12) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        const len = Math.sqrt(len2);
        best = { x: px, z: pz, tx: dx / len, tz: dz / len, distance };
      }
    }
  }
  return best;
}

/**
 * Which way the water lies: compares water found ahead (+z) and behind (−z) of a placement and returns the heading
 * to use so that local +z faces the water (the placement's own heading when it already does, or when there is none).
 */
export function headingTowardsWater(p: LandmarkPlacement, world: WorldApi, reach: number): number {
  const sin = Math.sin(p.heading);
  const cos = Math.cos(p.heading);
  let ahead = 0;
  let behind = 0;
  for (let i = 1; i <= 6; i++) {
    const d = (reach * i) / 6;
    for (const side of [-0.35, 0, 0.35]) {
      // Local (side·d, d) and its mirror through the origin.
      const lx = side * d;
      const wx = lx * cos + d * sin;
      const wz = -lx * sin + d * cos;
      if (world.waterDepthAt(p.x + wx, p.z + wz) > 0.2) ahead++;
      if (world.waterDepthAt(p.x - wx, p.z - wz) > 0.2) behind++;
    }
  }
  return behind > ahead ? p.heading + Math.PI : p.heading;
}
