import { angleDiff } from '../core/math';
import type { RoadEdge, RoadGraph } from '../core/types';
import { drivableDegree, junctionRadius, legPointInto, makePoint, projectOnEdge, type PathPoint } from './lanes';
import { CLASS_RANK, DRIVE, EXIT_CLASS_WEIGHT } from './tuning';

/**
 * Route-following state for the autopilot: which leg the vehicle is on, how far along it is, what comes
 * next, and the path to steer along (lane centre → smooth connector through the junction → next lane).
 * Pure logic over the road graph.
 */

export interface Leg {
  edge: RoadEdge;
  dir: 1 | -1;
}

export const legStart = (edge: RoadEdge, dir: 1 | -1) => (dir === 1 ? edge.a : edge.b);
export const legEnd = (edge: RoadEdge, dir: 1 | -1) => (dir === 1 ? edge.b : edge.a);

/** Signed heading change from the end of one leg into the start of the next (radians, + = left turn). */
export function turnAngle(fromEdge: RoadEdge, fromDir: 1 | -1, toEdge: RoadEdge, toDir: 1 | -1): number {
  const fs = fromEdge.samples;
  const f = fromDir === 1 ? fs[fs.length - 1] : fs[0];
  const ts = toEdge.samples;
  const t = toDir === 1 ? ts[0] : ts[ts.length - 1];
  return angleDiff(Math.atan2(t.tx * toDir, t.tz * toDir), Math.atan2(f.tx * fromDir, f.tz * fromDir));
}

/** May traffic leave `node` along `edge`? Returns the direction of travel, or 0 if not. */
export function exitDir(edge: RoadEdge, node: number): 1 | -1 | 0 {
  if (!edge.drivable) return 0;
  if (edge.a === node) return 1;
  if (edge.b === node && !edge.oneway) return -1;
  return 0;
}

function exitWeight(fromEdge: RoadEdge, fromDir: 1 | -1, edge: RoadEdge, dir: 1 | -1): number {
  let w = EXIT_CLASS_WEIGHT[edge.cls];
  if (Math.abs(turnAngle(fromEdge, fromDir, edge, dir)) < 0.5) w *= 3;
  if (edge.name === fromEdge.name) w *= 1.5;
  return w;
}

/**
 * Wandering: pick the next leg at the end of the current one. Any legal exit (drivable, respecting one-way),
 * weighted towards carrying straight on along bigger roads; a U-turn only at a dead end.
 * Writes the choice to `out` and returns false when there is no way on at all.
 */
export function chooseExit(graph: RoadGraph, fromEdge: RoadEdge, fromDir: 1 | -1, rng: { next(): number }, out: Leg): boolean {
  const node = legEnd(fromEdge, fromDir);
  const edges = graph.nodes[node].edges;
  let total = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = graph.edges[edges[i]];
    if (e === fromEdge) continue;
    const dir = exitDir(e, node);
    if (dir !== 0) total += exitWeight(fromEdge, fromDir, e, dir);
  }
  if (total > 0) {
    let r = rng.next() * total;
    let last: RoadEdge | null = null;
    let lastDir: 1 | -1 = 1;
    for (let i = 0; i < edges.length; i++) {
      const e = graph.edges[edges[i]];
      if (e === fromEdge) continue;
      const dir = exitDir(e, node);
      if (dir === 0) continue;
      const w = exitWeight(fromEdge, fromDir, e, dir);
      if (w <= 0) continue;
      last = e;
      lastDir = dir;
      r -= w;
      if (r <= 0) break;
    }
    if (last) {
      out.edge = last;
      out.dir = lastDir;
      return true;
    }
  }
  // Dead end: turn round if the road allows it.
  if (fromEdge.oneway) return false;
  out.edge = fromEdge;
  out.dir = fromDir === 1 ? -1 : 1;
  return true;
}

const _in = makePoint();
const _out = makePoint();
const _leg: Leg = { edge: null as unknown as RoadEdge, dir: 1 };

export class RouteFollower {
  mode: 'none' | 'route' | 'wander' = 'none';
  /** Current leg. */
  edge: RoadEdge | null = null;
  dir: 1 | -1 = 1;
  /** Distance travelled along the current leg (0 at its start node). */
  u = 0;
  /** The leg after this one, if any. */
  nextEdge: RoadEdge | null = null;
  nextDir: 1 | -1 = 1;
  /** Preferred lane (0 = kerb side); clamped to what each road has. */
  lane = 0;
  /** Restart a finished route from its first leg. */
  loop = false;
  /** True once a (non-looping) route has been driven to its end. */
  finished = false;
  /** True when wandering ran into a dead end and had to turn round (the traffic manager may despawn there). */
  deadEnd = false;

  /** Node at the end of the current leg. */
  node = -1;
  /** Three or more drivable roads meet at that node, so give-way applies. */
  junction = false;
  /** Rank of the biggest road at that node (a driver arriving on a smaller one approaches with care). */
  majorRank = 0;
  /** Signed heading change into the next leg (+ = left). */
  turn = 0;
  /** How far before the end node the lane path stops (the junction box), and where it resumes on the next leg. */
  trimEnd = 0;
  nextTrimStart = 0;
  /** Where this leg's lane path began (the far side of the previous junction). */
  trimStart = 0;
  /** Connector through the junction: quadratic curve from (inX, inZ) via (midX, midZ) to (outX, outZ). */
  inX = 0;
  inZ = 0;
  inY = 0;
  midX = 0;
  midZ = 0;
  outX = 0;
  outZ = 0;
  outY = 0;
  connLength = 0;
  /** Straight-line distance between the connector's ends (for turn speed). */
  chord = 0;
  /** Distance already covered along the connector (0 until inside the junction). */
  private conn = 0;

  private legs: Leg[] | null = null;
  private index = 0;

  get length(): number {
    return this.edge ? this.edge.length : 0;
  }

  /** Distance left to the junction boundary (negative once inside the junction). */
  get remaining(): number {
    return this.edge ? this.edge.length - this.trimEnd - this.u : 0;
  }

  /** Distance from node a, as the contract's `Autopilot.s` wants it. */
  get s(): number {
    if (!this.edge) return 0;
    return this.dir === 1 ? this.u : this.edge.length - this.u;
  }

  clear() {
    this.mode = 'none';
    this.edge = null;
    this.nextEdge = null;
    this.legs = null;
    this.finished = false;
    this.deadEnd = false;
    this.loop = false;
    this.trimStart = 0;
    this.nextTrimStart = 0;
  }

  /** Follow a fixed list of legs. `startS` is the distance from node a on the first edge. */
  startRoute(graph: RoadGraph, legs: Leg[], startS: number | undefined, x: number, z: number, rng: { next(): number }, loop = false) {
    this.clear();
    if (!legs.length) {
      this.finished = true;
      return;
    }
    this.mode = 'route';
    this.loop = loop;
    this.legs = legs;
    this.index = 0;
    const first = legs[0];
    const s = startS ?? projectOnEdge(first.edge, x, z);
    this.enter(graph, first.edge, first.dir, first.dir === 1 ? s : first.edge.length - s, rng);
  }

  /** Wander from a known position on an edge. */
  startWander(graph: RoadGraph, edge: RoadEdge, dir: 1 | -1, s: number, rng: { next(): number }) {
    this.clear();
    this.mode = 'wander';
    this.enter(graph, edge, dir, dir === 1 ? s : edge.length - s, rng);
  }

  private enter(graph: RoadGraph, edge: RoadEdge, dir: 1 | -1, u: number, rng: { next(): number }) {
    this.edge = edge;
    this.dir = dir;
    this.u = Math.max(0, Math.min(edge.length, u));
    this.trimStart = this.nextTrimStart;
    this.node = legEnd(edge, dir);
    this.pickNext(graph, rng);
    this.buildConnector(graph);
  }

  private pickNext(graph: RoadGraph, rng: { next(): number }) {
    this.nextEdge = null;
    this.deadEnd = false;
    if (this.mode === 'route' && this.legs) {
      let i = this.index + 1;
      if (i >= this.legs.length && this.loop) i = 0;
      if (i < this.legs.length) {
        this.nextEdge = this.legs[i].edge;
        this.nextDir = this.legs[i].dir;
      }
    } else if (this.mode === 'wander' && this.edge) {
      if (chooseExit(graph, this.edge, this.dir, rng, _leg)) {
        this.nextEdge = _leg.edge;
        this.nextDir = _leg.dir;
        this.deadEnd = _leg.edge === this.edge;
      } else this.deadEnd = true;
    }
  }

  /** Work out the junction box and the curve through it for the coming transition. */
  private buildConnector(graph: RoadGraph) {
    const edge = this.edge!;
    const next = this.nextEdge;
    this.junction = drivableDegree(graph, this.node) >= 3;
    this.majorRank = 0;
    const meeting = graph.nodes[this.node].edges;
    for (let i = 0; i < meeting.length; i++) {
      const e = graph.edges[meeting[i]];
      if (e.drivable && CLASS_RANK[e.cls] > this.majorRank) this.majorRank = CLASS_RANK[e.cls];
    }
    this.turn = 0;
    this.trimEnd = 0;
    this.nextTrimStart = 0;
    this.connLength = 0;
    this.chord = 0;
    this.conn = 0;
    if (!next) return;
    this.turn = turnAngle(edge, this.dir, next, this.nextDir);
    if (this.junction || Math.abs(this.turn) > DRIVE.straightAngle) {
      const r = junctionRadius(graph, this.node) + DRIVE.junctionPad;
      this.trimEnd = Math.min(r, edge.length * 0.45);
      this.nextTrimStart = Math.min(r, next.length * 0.45);
    }
    legPointInto(edge, this.dir, edge.length - this.trimEnd, this.lane, 0, _in);
    legPointInto(next, this.nextDir, this.nextTrimStart, this.lane, 0, _out);
    this.inX = _in.x;
    this.inZ = _in.z;
    this.inY = _in.y;
    this.outX = _out.x;
    this.outZ = _out.z;
    this.outY = _out.y;
    const cx = _out.x - _in.x;
    const cz = _out.z - _in.z;
    this.chord = Math.hypot(cx, cz);
    // Control point: where the two lane lines meet, so the curve leaves and joins each lane tangentially.
    let mx = (_in.x + _out.x) / 2;
    let mz = (_in.z + _out.z) / 2;
    const cross = _in.tx * _out.tz - _in.tz * _out.tx;
    if (Math.abs(cross) > 0.2) {
      // in + a·Tin = out − b·Tout
      const a = (cx * _out.tz - cz * _out.tx) / cross;
      const b = (_in.tx * cz - _in.tz * cx) / cross;
      if (a > 0 && b > 0 && a < this.chord * 3 && b < this.chord * 3) {
        mx = _in.x + _in.tx * a;
        mz = _in.z + _in.tz * a;
      }
    } else if (_in.tx * _out.tx + _in.tz * _out.tz < -0.5) {
      // Doubling back: swing out ahead before coming round.
      mx += _in.tx * Math.max(4, this.chord);
      mz += _in.tz * Math.max(4, this.chord);
    }
    this.midX = mx;
    this.midZ = mz;
    const polygon = Math.hypot(mx - _in.x, mz - _in.z) + Math.hypot(_out.x - mx, _out.z - mz);
    this.connLength = (this.chord + polygon) / 2;
  }

  /**
   * Update progress from the vehicle's position. Returns true when it moved on to the next leg this call.
   */
  track(graph: RoadGraph, x: number, z: number, rng: { next(): number }): boolean {
    const edge = this.edge;
    if (!edge || this.finished) return false;
    const s = projectOnEdge(edge, x, z, this.dir === 1 ? this.u : edge.length - this.u);
    this.u = this.dir === 1 ? s : edge.length - s;
    const next = this.nextEdge;
    if (!next) {
      if (this.mode === 'route' && edge.length - this.u < 3.5) this.finished = true;
      return false;
    }
    if (this.remaining > 0) {
      this.conn = 0;
      return false;
    }
    // Inside the junction box progress is measured across it, from the entry point towards the exit point
    // (projecting on to the road we came in on would stall half-way round a turn).
    let t = 1;
    if (this.chord > 1e-3) {
      t = ((x - this.inX) * (this.outX - this.inX) + (z - this.inZ) * (this.outZ - this.inZ)) / (this.chord * this.chord);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    if (t < 0.5) {
      this.conn = t * this.connLength;
      return false;
    }
    // Step on to the next leg.
    if (this.mode === 'route' && this.legs) {
      this.index++;
      if (this.index >= this.legs.length) this.index = 0;
    }
    const nu = projectOnEdge(next, x, z, this.nextDir === 1 ? 0 : next.length);
    this.enter(graph, next, this.nextDir, this.nextDir === 1 ? nu : next.length - nu, rng);
    return true;
  }

  /**
   * Point on the path `d` metres ahead of the current position: along this lane to the junction boundary,
   * through the connector, then along the next lane. `shift` moves lane points to the right.
   */
  pathPoint(d: number, shift: number, out: PathPoint): PathPoint {
    const edge = this.edge!;
    const rem = this.remaining;
    const next = this.nextEdge;
    if (d <= rem || !next) {
      // While still inside the previous junction, aim no nearer than where this lane really starts.
      const u = Math.max(this.u + d, Math.min(this.trimStart + 1, edge.length));
      return legPointInto(edge, this.dir, Math.min(u, edge.length), this.lane, shift, out);
    }
    const dd = rem > 0 ? d - rem : d + this.conn;
    if (dd < this.connLength) {
      const t = dd / this.connLength;
      const a = (1 - t) * (1 - t);
      const b = 2 * t * (1 - t);
      const c = t * t;
      out.x = a * this.inX + b * this.midX + c * this.outX;
      out.z = a * this.inZ + b * this.midZ + c * this.outZ;
      out.y = this.inY + (this.outY - this.inY) * t;
      const tx = (1 - t) * (this.midX - this.inX) + t * (this.outX - this.midX);
      const tz = (1 - t) * (this.midZ - this.inZ) + t * (this.outZ - this.midZ);
      const len = Math.hypot(tx, tz) || 1;
      out.tx = tx / len;
      out.tz = tz / len;
      return out;
    }
    return legPointInto(next, this.nextDir, Math.min(next.length, this.nextTrimStart + dd - this.connLength), this.lane, shift, out);
  }
}
