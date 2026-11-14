import { clamp } from '../core/math';
import type { RoadEdge, RoadGraph } from '../core/types';

/**
 * Allocation-free road geometry for the AI: lane centres, edge projection, bend speeds and junction sizes.
 * Pure maths over `RoadEdge.samples`; nothing here needs Three or Rapier.
 *
 * `lanePointInto` gives the same answer as `RoadGraph.lanePoint` for two-way roads without creating objects,
 * so it can run every frame for every vehicle. (For one-way roads it centres the lanes on the carriageway.)
 */

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  /** Unit direction of travel. */
  tx: number;
  tz: number;
}

export const makePoint = (): PathPoint => ({ x: 0, y: 0, z: 0, tx: 0, tz: 1 });

/** Centreline point at distance `s` from node a (clamped). Tangent runs a → b. */
export function sampleEdge(edge: RoadEdge, s: number, out: PathPoint): PathPoint {
  const samples = edge.samples;
  const n = samples.length - 1;
  const f = clamp((s / (edge.length || 1)) * n, 0, n);
  const i = Math.min(n - 1, Math.floor(f));
  const t = f - i;
  const a = samples[i];
  const b = samples[i + 1];
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.tx = a.tx + (b.tx - a.tx) * t;
  out.tz = a.tz + (b.tz - a.tz) * t;
  return out;
}

/** Offset of a lane centre from the centreline, positive = left of the direction of travel. Lane 0 is kerb-side. */
export function laneOffset(edge: RoadEdge, lane: number): number {
  const lanes = Math.max(1, edge.lanes);
  const k = clamp(lane, 0, lanes - 1);
  const laneWidth = edge.width / (lanes * 2);
  // One-way: the whole carriageway is split into `lanes` lanes.
  if (edge.oneway) return (lanes - 1 - 2 * k) * laneWidth;
  return (lanes - 0.5 - k) * laneWidth;
}

/**
 * Lane centre at distance `s` from node a for traffic travelling in `dir`, moved `shift` metres to the RIGHT
 * (towards the centre line; used to squeeze past parked cars). `out.tx/tz` is the direction of travel.
 */
export function lanePointInto(edge: RoadEdge, s: number, dir: 1 | -1, lane: number, shift: number, out: PathPoint): PathPoint {
  sampleEdge(edge, s, out);
  const tx = out.tx * dir;
  const tz = out.tz * dir;
  const offset = laneOffset(edge, lane) - shift;
  // Left of (tx, tz) is (tz, -tx).
  out.x += tz * offset;
  out.z -= tx * offset;
  out.tx = tx;
  out.tz = tz;
  return out;
}

/** Same, addressed by distance travelled `u` from the start of the leg. */
export function legPointInto(edge: RoadEdge, dir: 1 | -1, u: number, lane: number, shift: number, out: PathPoint): PathPoint {
  return lanePointInto(edge, dir === 1 ? u : edge.length - u, dir, lane, shift, out);
}

/** Result of the last `projectOnEdge` call. */
export const projection = { s: 0, offset: 0, distance: 0 };

/**
 * Closest point on an edge's centreline. With `hintS` only ±`window` samples around it are searched
 * (cheap enough to run per frame); without it the whole edge is scanned.
 * Returns `s`; `projection` also carries the signed offset (+ = left of a → b) and the distance.
 */
export function projectOnEdge(edge: RoadEdge, x: number, z: number, hintS = -1, window = 8): number {
  const samples = edge.samples;
  const n = samples.length - 1;
  let i0 = 0;
  let i1 = n - 1;
  if (hintS >= 0) {
    const c = Math.floor((clamp(hintS, 0, edge.length) / (edge.length || 1)) * n);
    i0 = Math.max(0, c - window);
    i1 = Math.min(n - 1, c + window);
  }
  let best = Infinity;
  for (let i = i0; i <= i1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) {
      best = d2;
      projection.s = a.s + (b.s - a.s) * t;
      projection.offset = ((x - px) * dz - (z - pz) * dx) / Math.sqrt(len2);
    }
  }
  projection.distance = Math.sqrt(best);
  return projection.s;
}

/** Number of edges at a node that traffic can use. */
export function drivableDegree(graph: RoadGraph, node: number): number {
  let count = 0;
  const edges = graph.nodes[node].edges;
  for (let i = 0; i < edges.length; i++) if (graph.edges[edges[i]].drivable) count++;
  return count;
}

/** Half width of the widest drivable road meeting at a node: the size of the junction box. */
export function junctionRadius(graph: RoadGraph, node: number): number {
  let r = 0;
  const edges = graph.nodes[node].edges;
  for (let i = 0; i < edges.length; i++) {
    const e = graph.edges[edges[i]];
    if (e.drivable && e.width / 2 > r) r = e.width / 2;
  }
  return r;
}

const curvatureCache = new WeakMap<RoadEdge, Float32Array>();

/** Curvature (1 / radius) at every centreline sample, cached per edge. */
export function edgeCurvature(edge: RoadEdge): Float32Array {
  let c = curvatureCache.get(edge);
  if (c) return c;
  const s = edge.samples;
  const n = s.length;
  c = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) {
    const a = s[i - 1];
    const b = s[i + 1];
    const cross = a.tx * b.tz - a.tz * b.tx;
    const dot = a.tx * b.tx + a.tz * b.tz;
    c[i] = Math.abs(Math.atan2(cross, dot)) / Math.max(1e-3, b.s - a.s);
  }
  if (n > 2) {
    c[0] = c[1];
    c[n - 1] = c[n - 2];
  }
  curvatureCache.set(edge, c);
  return c;
}

/**
 * Fastest speed allowed right now so that every bend in the next `look` metres of a leg can be taken at
 * `lateral` m/s² after braking at `brake` m/s². `u` is the distance travelled along the leg; `lead` is how
 * far away the leg's start still is (0 when already on it). Returns Infinity on a straight.
 */
export function curveLimit(edge: RoadEdge, dir: 1 | -1, u: number, lead: number, look: number, lateral: number, brake: number): number {
  const curvature = edgeCurvature(edge);
  const samples = edge.samples;
  const n = samples.length - 1;
  const len = edge.length || 1;
  const s0 = dir === 1 ? u : len - u;
  let i = clamp(Math.round((s0 / len) * n), 0, n);
  let best = Infinity;
  for (;;) {
    const d = lead + Math.abs(samples[i].s - s0);
    if (d > look) break;
    const k = curvature[i];
    if (k > 0.0012) {
      const v2 = lateral / k + 2 * brake * d;
      if (v2 < best) best = v2;
    }
    i += dir;
    if (i < 0 || i > n) break;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}
