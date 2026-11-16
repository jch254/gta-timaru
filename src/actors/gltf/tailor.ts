import * as THREE from 'three';
import type { Parts } from './lods';

/**
 * Makes the clothes hang like cloth. The shipped models wear shells grown straight off the body, so a shirt
 * follows every muscle under it as if it were painted on. Here, once at load, each garment is re-cut in the
 * bind pose: every cross-section of the torso, sleeves, seat and legs is replaced by its convex outline
 * (cloth spans a hollow, it does not dip into it), the torso is let fall from the chest and shoulder blades
 * instead of following the waist in, and the result is smoothed and given a little ease. Only the top is
 * re-cut (trunk and sleeves); trousers are left as shipped. Vertices keep their skin weights and texture
 * coordinates; only positions and normals change.
 */

const SECTORS = 48;
const TAU = Math.PI * 2;

/** A surface as radius over (row, angle): rows run along a limb or up the trunk. */
class Polar {
  readonly r: Float32Array;
  private n: Uint16Array;
  /** Centre of each row's cross-section (two coordinates), filled by the caller before `add`. */
  readonly centre: Float32Array;

  constructor(
    readonly rows: number,
    readonly from: number,
    readonly step: number,
  ) {
    this.r = new Float32Array(rows * SECTORS);
    this.n = new Uint16Array(rows * SECTORS);
    this.centre = new Float32Array(rows * 2);
  }

  row(t: number): number {
    return THREE.MathUtils.clamp((t - this.from) / this.step, 0, this.rows - 1);
  }

  /** Centre of the cross-section at fractional row `f`. */
  middle(f: number, k: 0 | 1): number {
    const i = Math.min(this.rows - 2, Math.floor(f));
    const u = f - i;
    return this.centre[i * 2 + k] * (1 - u) + this.centre[(i + 1) * 2 + k] * u;
  }

  add(f: number, angle: number, radius: number) {
    const i = Math.round(f);
    const s = ((Math.round((angle / TAU) * SECTORS) % SECTORS) + SECTORS) % SECTORS;
    const k = i * SECTORS + s;
    if (radius > this.r[k]) this.r[k] = radius;
    this.n[k]++;
  }

  /** Give empty cells the radius of their nearest measured neighbours round the row, then rows with nothing at all a neighbour row's. */
  fill() {
    for (let i = 0; i < this.rows; i++) {
      const o = i * SECTORS;
      let any = false;
      for (let s = 0; s < SECTORS; s++) any ||= this.n[o + s] > 0;
      if (!any) continue;
      for (let s = 0; s < SECTORS; s++) {
        if (this.n[o + s]) continue;
        let a = 1;
        let b = 1;
        while (!this.n[o + ((s - a + SECTORS) % SECTORS)]) a++;
        while (!this.n[o + ((s + b) % SECTORS)]) b++;
        this.r[o + s] = (this.r[o + ((s - a + SECTORS) % SECTORS)] * b + this.r[o + ((s + b) % SECTORS)] * a) / (a + b);
      }
      for (let s = 0; s < SECTORS; s++) this.n[o + s] = 1;
    }
    for (let pass = 0; pass < this.rows; pass++) {
      for (let i = 0; i < this.rows; i++) {
        if (this.n[i * SECTORS]) continue;
        const near = i > 0 && this.n[(i - 1) * SECTORS] ? i - 1 : i < this.rows - 1 && this.n[(i + 1) * SECTORS] ? i + 1 : -1;
        if (near < 0) continue;
        for (let s = 0; s < SECTORS; s++) {
          this.r[i * SECTORS + s] = this.r[near * SECTORS + s];
          this.n[i * SECTORS + s] = 1;
        }
        this.centre[i * 2] = this.centre[near * 2];
        this.centre[i * 2 + 1] = this.centre[near * 2 + 1];
      }
    }
  }

  /** Replace every row's outline by its convex hull (support function of the points, then back to radii). */
  hull() {
    const support = new Float32Array(SECTORS);
    const cos = new Float32Array(SECTORS);
    for (let s = 0; s < SECTORS; s++) cos[s] = Math.cos((s / SECTORS) * TAU);
    for (let i = 0; i < this.rows; i++) {
      const o = i * SECTORS;
      for (let j = 0; j < SECTORS; j++) {
        let h = 0;
        for (let s = 0; s < SECTORS; s++) h = Math.max(h, this.r[o + s] * cos[(s - j + SECTORS) % SECTORS]);
        support[j] = h;
      }
      for (let s = 0; s < SECTORS; s++) {
        let radius = Infinity;
        for (let j = 0; j < SECTORS; j++) {
          const c = cos[(j - s + SECTORS) % SECTORS];
          if (c > 0.2) radius = Math.min(radius, support[j] / c);
        }
        this.r[o + s] = radius;
      }
    }
  }

  /**
   * Let the surface hang: going from row `start` towards row `end`, a row is never narrower than the one
   * before it less `slack` (how much cloth can come in per row).
   */
  drape(start: number, end: number, slack: number) {
    const step = end > start ? 1 : -1;
    for (let i = start + step; i !== end + step; i += step) {
      for (let s = 0; s < SECTORS; s++) this.r[i * SECTORS + s] = Math.max(this.r[i * SECTORS + s], this.r[(i - step) * SECTORS + s] - slack);
    }
  }

  blur(passes: number) {
    const next = new Float32Array(this.r.length);
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < this.rows; i++) {
        const up = Math.max(0, i - 1) * SECTORS;
        const down = Math.min(this.rows - 1, i + 1) * SECTORS;
        const o = i * SECTORS;
        for (let s = 0; s < SECTORS; s++) {
          const l = (s + SECTORS - 1) % SECTORS;
          const r = (s + 1) % SECTORS;
          next[o + s] = (this.r[o + s] * 4 + (this.r[o + l] + this.r[o + r] + this.r[up + s] + this.r[down + s]) * 2 + this.r[up + l] + this.r[up + r] + this.r[down + l] + this.r[down + r]) / 16;
        }
      }
      this.r.set(next);
    }
  }

  sample(f: number, angle: number): number {
    const i = Math.min(this.rows - 2, Math.floor(f));
    const u = f - i;
    const a = (((angle / TAU) * SECTORS) % SECTORS + SECTORS) % SECTORS;
    const s = Math.floor(a);
    const v = a - s;
    const s1 = (s + 1) % SECTORS;
    const top = this.r[i * SECTORS + s] * (1 - v) + this.r[i * SECTORS + s1] * v;
    const bottom = this.r[(i + 1) * SECTORS + s] * (1 - v) + this.r[(i + 1) * SECTORS + s1] * v;
    return top * (1 - u) + bottom * u;
  }
}

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

interface Region {
  /** Position along the rows (metres) and the two cross-section coordinates of a point. */
  along(x: number, y: number, z: number): number;
  across(x: number, y: number, z: number): [number, number];
  /** Write a cross-section point back. */
  place(out: THREE.Vector3, t: number, a: number, b: number): void;
  /** 0..1: how much of the new shape a vertex here takes. */
  weight(x: number, y: number, z: number): number;
  from: number;
  to: number;
  shape(grid: Polar): void;
  ease(t: number): number;
}

const smooth = THREE.MathUtils.smoothstep;
const _p = new THREE.Vector3();

/** Re-cut one region of a garment. `vertices` are the shell's vertices (rims that stay on the skin left out). */
function recut(position: Attribute, vertices: number[], region: Region) {
  const step = 0.015;
  const rows = Math.max(3, Math.ceil((region.to - region.from) / step) + 1);
  const grid = new Polar(rows, region.from, step);
  const inside: number[] = [];
  const count = new Uint16Array(rows);
  for (const v of vertices) {
    _p.fromBufferAttribute(position, v);
    const t = region.along(_p.x, _p.y, _p.z);
    if (t < region.from - step || t > region.to + step || region.weight(_p.x, _p.y, _p.z) <= 0) continue;
    inside.push(v);
    const i = Math.round(grid.row(t));
    const [a, b] = region.across(_p.x, _p.y, _p.z);
    grid.centre[i * 2] += a;
    grid.centre[i * 2 + 1] += b;
    count[i]++;
  }
  for (let i = 0; i < rows; i++) {
    if (!count[i]) continue;
    grid.centre[i * 2] /= count[i];
    grid.centre[i * 2 + 1] /= count[i];
  }
  // Rows nobody landed on borrow a centre, then the centre line is smoothed so it does not wander with the muscles.
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < rows; i++) if (!count[i]) for (const n of [i - 1, i + 1]) if (n >= 0 && n < rows && count[n]) {
    grid.centre[i * 2] = grid.centre[n * 2];
    grid.centre[i * 2 + 1] = grid.centre[n * 2 + 1];
    count[i] = 1;
  }
  for (let pass = 0; pass < 6; pass++) {
    const c = grid.centre.slice();
    for (let i = 1; i < rows - 1; i++) for (let k = 0; k < 2; k++) grid.centre[i * 2 + k] = (c[(i - 1) * 2 + k] + c[i * 2 + k] * 2 + c[(i + 1) * 2 + k]) / 4;
  }
  for (const v of inside) {
    _p.fromBufferAttribute(position, v);
    const f = grid.row(region.along(_p.x, _p.y, _p.z));
    const [a, b] = region.across(_p.x, _p.y, _p.z);
    const da = a - grid.middle(f, 0);
    const db = b - grid.middle(f, 1);
    grid.add(f, Math.atan2(da, db), Math.hypot(da, db));
  }
  grid.fill();
  region.shape(grid);
  for (const v of inside) {
    _p.fromBufferAttribute(position, v);
    const w = region.weight(_p.x, _p.y, _p.z);
    const t = region.along(_p.x, _p.y, _p.z);
    const f = grid.row(t);
    const [a, b] = region.across(_p.x, _p.y, _p.z);
    const ca = grid.middle(f, 0);
    const cb = grid.middle(f, 1);
    const radius = Math.hypot(a - ca, b - cb);
    if (radius < 1e-5) continue;
    const want = grid.sample(f, Math.atan2(a - ca, b - cb)) + region.ease(t);
    const k = 1 + (want / radius - 1) * w;
    region.place(_p, t, ca + (a - ca) * k, cb + (b - cb) * k);
    position.setXYZ(v, _p.x, _p.y, _p.z);
  }
}

/** Vertices used by the parts whose names start with `prefix`, without the rims that sit on the skin. */
function shell(geometry: THREE.BufferGeometry, parts: Parts, prefix: string): number[] {
  const index = geometry.index!;
  const color = geometry.getAttribute('color');
  const seen = new Set<number>();
  for (const [name, [start, count]] of Object.entries(parts)) {
    if (!name.startsWith(prefix)) continue;
    for (let i = start; i < start + count; i++) {
      const v = index.getX(i);
      // The inner edge of a rim is painted darkest (see `lips` in the build script); it stays where the skin is.
      if (color.getX(v) >= 0.4) seen.add(v);
    }
  }
  return [...seen];
}

/** Smooth normals for the parts whose names start with `prefix`, shared between vertices at the same place. */
function renormal(geometry: THREE.BufferGeometry, parts: Parts, prefix: string) {
  const index = geometry.index!;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  const sums = new Map<string, THREE.Vector3>();
  const keyOf = (v: number) => `${Math.round(position.getX(v) * 2e4)},${Math.round(position.getY(v) * 2e4)},${Math.round(position.getZ(v) * 2e4)},${color.getX(v) < 0.9 ? 1 : 0}`;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const used = new Map<number, string>();
  for (const [name, [start, count]] of Object.entries(parts)) {
    if (!name.startsWith(prefix)) continue;
    for (let i = start; i < start + count; i += 3) {
      const v = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      a.fromBufferAttribute(position, v[0]);
      b.fromBufferAttribute(position, v[1]).sub(a);
      c.fromBufferAttribute(position, v[2]).sub(a);
      b.cross(c);
      for (const vertex of v) {
        let key = used.get(vertex);
        if (key === undefined) used.set(vertex, (key = keyOf(vertex)));
        const sum = sums.get(key);
        if (sum) sum.add(b);
        else sums.set(key, b.clone());
      }
    }
  }
  for (const [vertex, key] of used) {
    const n = sums.get(key)!;
    const l = n.length();
    if (l > 1e-12) normal.setXYZ(vertex, n.x / l, n.y / l, n.z / l);
  }
}

/**
 * The dark rims under a garment's openings, as [vertex on the skin, vertex on the cloth edge it hangs from].
 * Read before the cloth is moved, while each skin-side vertex is still nearest its own partner.
 */
function rims(geometry: THREE.BufferGeometry, parts: Parts, prefix: string): [inner: number, outer: number][] {
  const index = geometry.index!;
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const best = new Map<number, [outer: number, distance: number]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const [name, [start, count]] of Object.entries(parts)) {
    if (!name.startsWith(prefix)) continue;
    for (let i = start; i < start + count; i += 3) {
      const v = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (v.some((vertex) => color.getX(vertex) >= 0.9)) continue;
      for (const inner of v) {
        if (color.getX(inner) >= 0.4) continue;
        for (const outer of v) {
          if (color.getX(outer) < 0.4) continue;
          const d = a.fromBufferAttribute(position, inner).distanceTo(b.fromBufferAttribute(position, outer));
          if (d < (best.get(inner)?.[1] ?? Infinity)) best.set(inner, [outer, d]);
        }
      }
    }
  }
  return [...best].map(([inner, [outer]]) => [inner, outer]);
}

export interface Fit {
  /** Where the sleeves start, the short sleeve ends and the cuff is (|x| in the T-pose, metres). */
  armholeX: number;
  shortX: number;
  cuffX: number;
  hemY: number;
  collarY: number;
  armpitY: number;
  waistY: number;
  crotchY: number;
  shortsY: number;
  ankleY: number;
  /** The neck opening as a sphere through its edge: centre height, centre z, radius. */
  neck: [y: number, z: number, radius: number];
}

/** Measure the garments (bind pose: standing, arms straight out to the sides). */
export function measure(geometry: THREE.BufferGeometry, parts: Parts): Fit {
  const position = geometry.getAttribute('position');
  const range = (vertices: number[], pick: (v: number) => number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vertices) {
      const value = pick(v);
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    return [lo, hi];
  };
  const absX = (v: number) => Math.abs(position.getX(v));
  const y = (v: number) => position.getY(v);
  const torso = shell(geometry, parts, 'topTorso');
  const armholeX = range(shell(geometry, parts, 'topShort'), absX)[0];
  const [hemY, collarY] = range(torso, y);
  const legs = shell(geometry, parts, 'legs');
  const [ankleY, waistY] = range(legs, y);
  return {
    armholeX,
    shortX: range(shell(geometry, parts, 'topShort'), absX)[1],
    cuffX: range(shell(geometry, parts, 'topLong'), absX)[1],
    hemY,
    collarY,
    // The underside of the armhole: the lowest point of the torso shell out at the sleeve seam.
    armpitY: range(torso.filter((v) => absX(v) > armholeX - 0.015), y)[0],
    waistY,
    crotchY: range(legs.filter((v) => absX(v) < 0.012), y)[0],
    shortsY: range(shell(geometry, parts, 'legsUpper'), y)[0],
    ankleY,
    neck: [collarY, 0, 0.07],
  };
}

/** Re-cut the top of a body in place and return the garments' measurements. */
export function tailor(geometry: THREE.BufferGeometry, parts: Parts): Fit {
  const position = geometry.getAttribute('position');
  const fit = measure(geometry, parts);
  const top = shell(geometry, parts, 'top');
  const topRims = rims(geometry, parts, 'top');
  const { armholeX, cuffX, hemY, collarY, armpitY } = fit;

  // Trunk: convex slices, hanging straight from the chest and shoulder blades, loosest at the hem.
  recut(position, top, {
    from: hemY,
    to: collarY,
    along: (_x, y) => y,
    across: (x, _y, z) => [x, z],
    place: (out, t, a, b) => out.set(a, t, b),
    weight: (x) => 1 - smooth(Math.abs(x), armholeX - 0.06, armholeX - 0.008),
    shape(grid) {
      grid.hull();
      grid.drape(Math.round(grid.row(armpitY - 0.02)), 0, 0.0009);
      grid.blur(3);
    },
    ease: (t) => 0.004 + 0.012 * (1 - smooth(t, hemY, armpitY)),
  });
  // Sleeves: smooth tubes, not upper arms.
  for (const side of [1, -1]) {
    recut(position, top, {
      from: armholeX - 0.005,
      to: cuffX,
      along: (x) => x * side,
      across: (_x, y, z) => [y, z],
      place: (out, t, a, b) => out.set(t * side, a, b),
      weight: (x) => smooth(x * side, armholeX - 0.005, armholeX + 0.045),
      shape(grid) {
        grid.hull();
        grid.blur(4);
      },
      ease: () => 0.006,
    });
  }
  // (Trousers and shorts are left as shipped: re-cutting the seat and legs this way tore the crotch and hems.)
  // The rims under the hem and the sleeve ends ran from the cloth edge down and in to the skin, which shows
  // as a dark flap now the cloth stands off the body. Lay them flat across the opening instead.
  const edge = new THREE.Vector3();
  for (const [inner, outer] of topRims) {
    edge.fromBufferAttribute(position, outer);
    if (Math.abs(edge.x) > armholeX + 0.03) position.setX(inner, edge.x - Math.sign(edge.x) * 0.003);
    else if (edge.y < hemY + 0.08) position.setY(inner, edge.y + 0.003);
  }
  // The neck opening, for the collar painted round it: centre and mean radius of its edge.
  const ring = topRims.map(([, outer]) => new THREE.Vector3().fromBufferAttribute(position, outer)).filter((p) => Math.abs(p.x) < armholeX - 0.03 && p.y > hemY + 0.3);
  if (ring.length > 6) {
    const centre = ring.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring.length);
    centre.x = 0;
    fit.neck = [centre.y, centre.z, ring.reduce((sum, p) => sum + p.distanceTo(centre), 0) / ring.length];
  }
  renormal(geometry, parts, 'top');
  return fit;
}
