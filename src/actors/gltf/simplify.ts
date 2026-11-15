/**
 * Progressive mesh simplification for the figure's distant versions.
 *
 * Edges are collapsed one endpoint on to the other (never to a new point), so every level of detail draws a
 * subset of the original vertices: the levels share the full mesh's vertex buffers and differ only in their
 * index lists. Collapses are ordered by quadric error. Vertices that sit at the same place but carry
 * different attributes (texture seams, the cut between two selectable parts) are treated as one point with
 * several "wedges", and a collapse is only allowed where each wedge has somewhere to go, which keeps seams
 * and part outlines closed. Each triangle belongs to a class with its own budget, so a face can keep more
 * of its triangles than a hand.
 */

export interface SimplifyInput {
  /** xyz per vertex. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  /** Budget class of each triangle. */
  triClass: ArrayLike<number>;
  /** Four joints and four weights per vertex (optional): collapses across differently weighted points cost more. */
  skinIndex?: ArrayLike<number>;
  skinWeight?: ArrayLike<number>;
  /**
   * Stand-in for each vertex (optional): vertices that are duplicates in all but name can be pointed at one
   * of their number, so they count as a single wedge and do not pin the mesh the way a real seam does.
   */
  wedgeOf?: ArrayLike<number>;
}

/** Class for triangles that take no part: they are dropped before simplification starts. */
export const SKIP = 0xffff;

export interface SimplifyLevel {
  /** Corner vertices per original triangle (3 each); meaningful where `alive` is 1. */
  corners: Uint32Array;
  alive: Uint8Array;
  triangles: number;
}

const Q = 10; // a symmetric 4 × 4 matrix: xx xy xz xw yy yz yw zz zw ww

class Heap {
  private cost: number[] = [];
  private item: number[] = [];
  get size() {
    return this.cost.length;
  }
  clear() {
    this.cost.length = this.item.length = 0;
  }
  push(cost: number, item: number) {
    const c = this.cost;
    const it = this.item;
    let i = c.length;
    c.push(cost);
    it.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p];
      it[i] = it[p];
      i = p;
    }
    c[i] = cost;
    it[i] = item;
  }
  pop(): number {
    const c = this.cost;
    const it = this.item;
    const top = it[0];
    const cost = c.pop()!;
    const item = it.pop()!;
    const n = c.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let k = i * 2 + 1;
        if (k >= n) break;
        if (k + 1 < n && c[k + 1] < c[k]) k++;
        if (c[k] >= cost) break;
        c[i] = c[k];
        it[i] = it[k];
        i = k;
      }
      c[i] = cost;
      it[i] = item;
    }
    return top;
  }
}

/** Points welded by position: `of[v]` is the point a vertex sits at. */
export function weld(positions: ArrayLike<number>, count: number): { of: Uint32Array; points: number } {
  const of = new Uint32Array(count);
  const seen = new Map<string, number>();
  let points = 0;
  for (let v = 0; v < count; v++) {
    const key = `${Math.round(positions[v * 3] * 2e4)},${Math.round(positions[v * 3 + 1] * 2e4)},${Math.round(positions[v * 3 + 2] * 2e4)}`;
    let p = seen.get(key);
    if (p === undefined) seen.set(key, (p = points++));
    of[v] = p;
  }
  return { of, points };
}

export class Simplifier {
  private pointOf: Uint32Array;
  private pos: Float64Array;
  private corners: Uint32Array;
  private alive: Uint8Array;
  private triClass: ArrayLike<number>;
  /** Triangles at each point (dead ones are dropped as the lists are read). */
  private tris: number[][];
  private quadric: Float64Array;
  private border: Uint8Array;
  private gone: Uint8Array;
  private version: Uint32Array;
  private count: Int32Array;
  private initial: Int32Array;
  private floor: Int32Array;
  private skin: { index: ArrayLike<number>; weight: ArrayLike<number>; vertex: Uint32Array } | null = null;
  private heap = new Heap();
  private candU: number[] = [];
  private candV: number[] = [];
  private candVersion: number[] = [];
  private mark: Uint32Array;
  private stamp = 0;
  private live = 0;

  constructor(input: SimplifyInput) {
    const vertices = input.positions.length / 3;
    const triangles = input.index.length / 3;
    const { of, points } = weld(input.positions, vertices);
    this.pointOf = of;
    this.pos = new Float64Array(points * 3);
    const first = new Uint32Array(points).fill(0xffffffff);
    for (let v = vertices - 1; v >= 0; v--) first[of[v]] = v;
    for (let p = 0; p < points; p++) for (let k = 0; k < 3; k++) this.pos[p * 3 + k] = input.positions[first[p] * 3 + k];
    if (input.skinIndex && input.skinWeight) this.skin = { index: input.skinIndex, weight: input.skinWeight, vertex: first };
    this.corners = Uint32Array.from(input.index);
    if (input.wedgeOf) for (let i = 0; i < this.corners.length; i++) this.corners[i] = input.wedgeOf[this.corners[i]];
    this.alive = new Uint8Array(triangles);
    this.triClass = input.triClass;
    this.tris = Array.from({ length: points }, () => []);
    this.quadric = new Float64Array(points * Q);
    this.border = new Uint8Array(points);
    this.gone = new Uint8Array(points);
    this.version = new Uint32Array(points);
    this.mark = new Uint32Array(points);
    let classes = 0;
    for (let t = 0; t < triangles; t++) if (input.triClass[t] !== SKIP) classes = Math.max(classes, input.triClass[t] + 1);
    this.count = new Int32Array(classes);
    this.floor = new Int32Array(classes);
    for (let t = 0; t < triangles; t++) {
      const a = of[this.corners[t * 3]];
      const b = of[this.corners[t * 3 + 1]];
      const c = of[this.corners[t * 3 + 2]];
      if (a === b || b === c || a === c || input.triClass[t] === SKIP) continue;
      this.alive[t] = 1;
      this.live++;
      this.count[input.triClass[t]]++;
      this.tris[a].push(t);
      this.tris[b].push(t);
      this.tris[c].push(t);
    }
    this.initial = this.count.slice();
    this.buildQuadrics(points);
  }

  /** Triangles left in each class. */
  get classCounts(): Int32Array {
    return this.count;
  }

  private addPlane(p: number, nx: number, ny: number, nz: number, d: number, w: number) {
    const q = this.quadric;
    const o = p * Q;
    q[o] += nx * nx * w;
    q[o + 1] += nx * ny * w;
    q[o + 2] += nx * nz * w;
    q[o + 3] += nx * d * w;
    q[o + 4] += ny * ny * w;
    q[o + 5] += ny * nz * w;
    q[o + 6] += ny * d * w;
    q[o + 7] += nz * nz * w;
    q[o + 8] += nz * d * w;
    q[o + 9] += d * d * w;
  }

  /** Face planes weighted by area, plus stiff planes along open edges and seams so their outlines hold. */
  private buildQuadrics(points: number) {
    const P = this.pos;
    const of = this.pointOf;
    const edges = new Map<number, { n: number; t: number; a: number; b: number; seam: boolean }>();
    const n = [0, 0, 0];
    for (let t = 0; t < this.alive.length; t++) {
      if (!this.alive[t]) continue;
      const c = this.corners;
      const p0 = of[c[t * 3]];
      const p1 = of[c[t * 3 + 1]];
      const p2 = of[c[t * 3 + 2]];
      const area = this.normal(p0, p1, p2, n);
      if (area > 0) {
        const d = -(n[0] * P[p0 * 3] + n[1] * P[p0 * 3 + 1] + n[2] * P[p0 * 3 + 2]);
        for (const p of [p0, p1, p2]) this.addPlane(p, n[0], n[1], n[2], d, area);
      }
      for (let k = 0; k < 3; k++) {
        let va = c[t * 3 + k];
        let vb = c[t * 3 + ((k + 1) % 3)];
        if (of[va] > of[vb]) [va, vb] = [vb, va];
        const key = of[va] * points + of[vb];
        const e = edges.get(key);
        if (!e) edges.set(key, { n: 1, t, a: va, b: vb, seam: false });
        else {
          e.n++;
          if (e.a !== va || e.b !== vb) e.seam = true;
        }
      }
    }
    const m = [0, 0, 0];
    for (const e of edges.values()) {
      if (e.n === 1) this.border[of[e.a]] = this.border[of[e.b]] = 1;
      else if (!e.seam && e.n === 2) continue;
      const pa = of[e.a];
      const pb = of[e.b];
      const c = this.corners;
      if (this.normal(of[c[e.t * 3]], of[c[e.t * 3 + 1]], of[c[e.t * 3 + 2]], n) <= 0) continue;
      const ex = P[pb * 3] - P[pa * 3];
      const ey = P[pb * 3 + 1] - P[pa * 3 + 1];
      const ez = P[pb * 3 + 2] - P[pa * 3 + 2];
      m[0] = ey * n[2] - ez * n[1];
      m[1] = ez * n[0] - ex * n[2];
      m[2] = ex * n[1] - ey * n[0];
      const l = Math.hypot(m[0], m[1], m[2]);
      if (l < 1e-12) continue;
      const w = (ex * ex + ey * ey + ez * ez) * 8;
      const d = -(m[0] * P[pa * 3] + m[1] * P[pa * 3 + 1] + m[2] * P[pa * 3 + 2]) / l;
      this.addPlane(pa, m[0] / l, m[1] / l, m[2] / l, d, w);
      this.addPlane(pb, m[0] / l, m[1] / l, m[2] / l, d, w);
    }
  }

  /** Unit normal of a triangle of points into `out`; returns its area. `as` moves point `from` to where `to` is. */
  private normal(p0: number, p1: number, p2: number, out: number[], from = -1, to = -1): number {
    const P = this.pos;
    if (p0 === from) p0 = to;
    if (p1 === from) p1 = to;
    if (p2 === from) p2 = to;
    const ax = P[p1 * 3] - P[p0 * 3];
    const ay = P[p1 * 3 + 1] - P[p0 * 3 + 1];
    const az = P[p1 * 3 + 2] - P[p0 * 3 + 2];
    const bx = P[p2 * 3] - P[p0 * 3];
    const by = P[p2 * 3 + 1] - P[p0 * 3 + 1];
    const bz = P[p2 * 3 + 2] - P[p0 * 3 + 2];
    const x = ay * bz - az * by;
    const y = az * bx - ax * bz;
    const z = ax * by - ay * bx;
    const l = Math.hypot(x, y, z);
    if (l < 1e-14) {
      out[0] = out[1] = out[2] = 0;
      return 0;
    }
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
    return l / 2;
  }

  /** How differently two points are bound to the skeleton: 0 the same, 1 nothing in common. */
  private skinDifference(u: number, v: number): number {
    const s = this.skin;
    if (!s) return 0;
    const a = s.vertex[u] * 4;
    const b = s.vertex[v] * 4;
    let common = 0;
    for (let i = 0; i < 4; i++) {
      const wi = s.weight[a + i];
      if (wi <= 0) continue;
      for (let k = 0; k < 4; k++) if (s.index[b + k] === s.index[a + i] && s.weight[b + k] > 0) common += Math.min(wi, s.weight[b + k]);
    }
    let ta = 0;
    let tb = 0;
    for (let i = 0; i < 4; i++) {
      ta += s.weight[a + i];
      tb += s.weight[b + i];
    }
    const total = Math.max(ta, tb);
    return total > 0 ? 1 - common / total : 0;
  }

  /** Cost of moving point u on to point v. */
  private cost(u: number, v: number): number {
    const q = this.quadric;
    const P = this.pos;
    const a = u * Q;
    const b = v * Q;
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    const z = P[v * 3 + 2];
    const s = (i: number) => q[a + i] + q[b + i];
    const error = x * (s(0) * x + 2 * s(1) * y + 2 * s(2) * z + 2 * s(3)) + y * (s(4) * y + 2 * s(5) * z + 2 * s(6)) + z * (s(7) * z + 2 * s(8)) + s(9);
    const dx = P[u * 3] - x;
    const dy = P[u * 3 + 1] - y;
    const dz = P[u * 3 + 2] - z;
    // A little for the edge's length, so flat areas thin out evenly; more across joints, where the mesh has to bend.
    return (Math.max(0, error) + 1e-7 * (dx * dx + dy * dy + dz * dz)) * (1 + 3 * this.skinDifference(u, v));
  }

  /** Live triangles at a point (the list is tidied on the way). */
  private around(p: number): number[] {
    const list = this.tris[p];
    let n = 0;
    for (let i = 0; i < list.length; i++) if (this.alive[list[i]]) list[n++] = list[i];
    list.length = n;
    return list;
  }

  private push(u: number, v: number) {
    const cost = this.cost(u, v);
    if (!Number.isFinite(cost)) return;
    this.candU.push(u);
    this.candV.push(v);
    this.candVersion.push(this.version[u] + this.version[v] * 65536);
    this.heap.push(cost, this.candU.length - 1);
  }

  /** Queue both directions of every edge at a point. */
  private pushAround(p: number) {
    const stamp = ++this.stamp;
    const of = this.pointOf;
    const c = this.corners;
    this.mark[p] = stamp;
    for (const t of this.around(p)) {
      for (let k = 0; k < 3; k++) {
        const n = of[c[t * 3 + k]];
        if (this.mark[n] === stamp) continue;
        this.mark[n] = stamp;
        this.push(p, n);
        this.push(n, p);
      }
    }
  }

  private mapFrom: number[] = [];
  private mapTo: number[] = [];
  private shared: number[] = [];
  private n0 = [0, 0, 0];
  private n1 = [0, 0, 0];

  /** Whether u may be moved on to v; fills the wedge map and the list of triangles the move removes. */
  private allowed(u: number, v: number): boolean {
    const of = this.pointOf;
    const c = this.corners;
    const from = this.mapFrom;
    const to = this.mapTo;
    const shared = this.shared;
    from.length = to.length = shared.length = 0;
    const list = this.around(u);
    // Triangles on the edge go; each says where a wedge of u continues at v.
    const thirds = ++this.stamp;
    let thirdCount = 0;
    for (const t of list) {
      let a = -1;
      let b = -1;
      let third = -1;
      for (let k = 0; k < 3; k++) {
        const vertex = c[t * 3 + k];
        const p = of[vertex];
        if (p === u) a = vertex;
        else if (p === v) b = vertex;
        else third = p;
      }
      if (b < 0) continue;
      shared.push(t);
      if (this.mark[third] !== thirds) {
        this.mark[third] = thirds;
        thirdCount++;
      }
      const i = from.indexOf(a);
      if (i < 0) {
        from.push(a);
        to.push(b);
      } else if (to[i] !== b) return false;
    }
    if (shared.length === 0) return false;
    // An open edge may only slide along itself.
    if (this.border[u] && shared.length !== 1) return false;
    for (const t of shared) if (this.count[this.triClass[t]] - 1 < this.floor[this.triClass[t]]) return false;
    // Everything else at u must have a wedge to follow, must not turn over, and u and v may share no
    // neighbours other than the ones across the vanishing triangles (or the surface would pinch).
    const mine = ++this.stamp;
    for (const t of list) {
      let a = -1;
      let hasV = false;
      for (let k = 0; k < 3; k++) {
        const vertex = c[t * 3 + k];
        const p = of[vertex];
        if (p === u) a = vertex;
        else if (p === v) hasV = true;
        else if (this.mark[p] !== thirds) this.mark[p] = mine;
      }
      if (hasV) continue;
      if (from.indexOf(a) < 0) return false;
      const p0 = of[c[t * 3]];
      const p1 = of[c[t * 3 + 1]];
      const p2 = of[c[t * 3 + 2]];
      const before = this.normal(p0, p1, p2, this.n0);
      const after = this.normal(p0, p1, p2, this.n1, u, v);
      if (after < 1e-12 || (before > 0 && this.n0[0] * this.n1[0] + this.n0[1] * this.n1[1] + this.n0[2] * this.n1[2] < 0.2)) return false;
    }
    for (const t of this.around(v)) {
      for (let k = 0; k < 3; k++) {
        const p = of[c[t * 3 + k]];
        if (p !== v && p !== u && this.mark[p] === mine) return false;
      }
    }
    return thirdCount > 0;
  }

  private collapse(u: number, v: number) {
    const of = this.pointOf;
    const c = this.corners;
    for (const t of this.shared) {
      this.alive[t] = 0;
      this.live--;
      this.count[this.triClass[t]]--;
    }
    const target = this.tris[v];
    for (const t of this.tris[u]) {
      if (!this.alive[t]) continue;
      for (let k = 0; k < 3; k++) {
        const vertex = c[t * 3 + k];
        if (of[vertex] === u) c[t * 3 + k] = this.mapTo[this.mapFrom.indexOf(vertex)];
      }
      target.push(t);
    }
    this.tris[u] = [];
    for (let i = 0; i < Q; i++) this.quadric[v * Q + i] += this.quadric[u * Q + i];
    if (this.border[u]) this.border[v] = 1;
    this.gone[u] = 1;
    this.version[v]++;
    this.pushAround(v);
  }

  /**
   * Simplify until every class is down to `fractions[class]` of its original triangles (or nothing more can
   * be removed without breaking a seam or turning a face over), and return the mesh as it then stands.
   * Call with successively smaller fractions for successive levels.
   */
  run(fractions: ArrayLike<number>): SimplifyLevel {
    let open = 0;
    for (let k = 0; k < this.count.length; k++) {
      this.floor[k] = Math.ceil(this.initial[k] * Math.max(0, fractions[k] ?? 1));
      if (this.count[k] > this.floor[k]) open++;
    }
    this.heap.clear();
    this.candU.length = this.candV.length = this.candVersion.length = 0;
    for (let p = 0; p < this.gone.length; p++) {
      if (this.gone[p]) continue;
      const stamp = ++this.stamp;
      for (const t of this.around(p)) {
        for (let k = 0; k < 3; k++) {
          const n = this.pointOf[this.corners[t * 3 + k]];
          if (n === p || this.mark[n] === stamp) continue;
          this.mark[n] = stamp;
          this.push(p, n);
        }
      }
    }
    while (open > 0 && this.heap.size > 0) {
      const i = this.heap.pop();
      const u = this.candU[i];
      const v = this.candV[i];
      if (this.gone[u] || this.gone[v] || this.candVersion[i] !== this.version[u] + this.version[v] * 65536) continue;
      if (!this.allowed(u, v)) continue;
      this.collapse(u, v);
      open = 0;
      for (let k = 0; k < this.count.length; k++) if (this.count[k] > this.floor[k]) open++;
    }
    return { corners: this.corners.slice(), alive: this.alive.slice(), triangles: this.live };
  }
}
