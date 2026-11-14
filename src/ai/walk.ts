import type { RoadEdge, RoadGraph } from '../core/types';
import { segmentsCross } from './junction';
import { makePoint, sampleEdge, type PathPoint } from './lanes';
import { PEDS } from './tuning';

/**
 * Footpath navigation for pedestrians. Pure geometry: where the footpath is, where it stops short of a
 * junction, and which ways a walker standing at a street corner may go (round the corner, or across exactly
 * one road).
 */

/** Pedestrians use roads with footpaths (not bridges or tunnels, which have none built), and paved malls / squares. */
export const walkable = (edge: RoadEdge) => (edge.footpaths || edge.cls === 'pedestrian') && !edge.bridge && !edge.tunnel;

/**
 * Sideways distance of a walker from the centreline; `side` 1 = left of a → b. `jitter` (−1..1) spreads
 * people across the footpath (or across the paving of a mall).
 */
export function walkOffset(edge: RoadEdge, side: 1 | -1, jitter: number): number {
  if (!edge.footpaths) return side * Math.max(0.6, (edge.width / 2 - 1) * (0.2 + 0.8 * Math.abs(jitter)));
  return side * (edge.width / 2 + PEDS.footpathOffset + jitter * PEDS.footpathJitter);
}

/** Footpath point (allocation-free equivalent of `RoadGraph.footpathPoint`, plus jitter). Tangent runs a → b. */
export function footpathInto(edge: RoadEdge, s: number, side: 1 | -1, jitter: number, out: PathPoint): PathPoint {
  sampleEdge(edge, s, out);
  const offset = walkOffset(edge, side, jitter);
  out.x += out.tz * offset;
  out.z -= out.tx * offset;
  return out;
}

/** How far from `node` the footpath of `edge` stops (the road mesher trims it at the junction). */
export function walkTrim(graph: RoadGraph, edge: RoadEdge, node: number): number {
  let r = 0;
  const edges = graph.nodes[node].edges;
  for (let i = 0; i < edges.length; i++) {
    const e = graph.edges[edges[i]];
    if (e !== edge && e.width / 2 + 0.4 > r) r = e.width / 2 + 0.4;
  }
  return Math.min(r + 0.8, edge.length * 0.45);
}

/**
 * How many carriageways meeting at `node` the straight walk a → b crosses. A path that passes over the
 * middle of the junction counts as many (pedestrians do not cut diagonally across).
 */
export function crossingCount(graph: RoadGraph, node: number, ax: number, az: number, bx: number, bz: number): number {
  const n = graph.nodes[node];
  let roads = 0;
  for (let i = 0; i < n.edges.length; i++) if (graph.edges[n.edges[i]].drivable) roads++;
  // At a real junction, passing within a metre of its middle means cutting diagonally across.
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (roads >= 3 && len2 > 1e-6) {
    let t = ((n.x - ax) * dx + (n.z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - n.x;
    const qz = az + dz * t - n.z;
    if (qx * qx + qz * qz < 1) return 9;
  }
  let count = 0;
  const edges = n.edges;
  for (let i = 0; i < edges.length; i++) {
    const e = graph.edges[edges[i]];
    if (!e.drivable) continue;
    // Outward direction of the road from this node, taken a little way along so curves do not matter.
    const samples = e.samples;
    const away = e.a === node ? samples[Math.min(samples.length - 1, 3)] : samples[Math.max(0, samples.length - 4)];
    let rx = away.x - n.x;
    let rz = away.z - n.z;
    const rl = Math.hypot(rx, rz) || 1;
    const reach = Math.min(e.length, 45);
    rx = (rx / rl) * reach;
    rz = (rz / rl) * reach;
    if (segmentsCross(ax, az, bx, bz, n.x, n.z, n.x + rx, n.z + rz)) count++;
  }
  return count;
}

export interface PedMove {
  edge: RoadEdge;
  side: 1 | -1;
  /** Direction of walking along the new edge (away from the node). */
  dir: 1 | -1;
  /** Where the walk along the new edge starts. */
  s: number;
  x: number;
  z: number;
  /** The way there crosses a road. */
  crossing: boolean;
}

export const makeMove = (): PedMove => ({ edge: null as unknown as RoadEdge, side: 1, dir: 1, s: 0, x: 0, z: 0, crossing: false });

const _p = makePoint();

function moveWeight(
  graph: RoadGraph,
  from: RoadEdge,
  fromSide: 1 | -1,
  node: number,
  px: number,
  pz: number,
  edge: RoadEdge,
  side: 1 | -1,
  jitter: number,
  crossChance: number,
  uTurnChance: number,
  awayX: number,
  awayZ: number,
): number {
  const trim = walkTrim(graph, edge, node);
  const atA = edge.a === node;
  footpathInto(edge, atA ? trim : edge.length - trim, side, jitter, _p);
  let w: number;
  if (edge === from && side === fromSide) w = uTurnChance;
  else {
    const crossings = crossingCount(graph, node, px, pz, _p.x, _p.z);
    w = crossings === 0 ? 1 : crossings === 1 ? crossChance : 0;
  }
  if (w > 0 && (awayX !== 0 || awayZ !== 0)) {
    // Fleeing: favour ways that lead away from the danger.
    const dir = atA ? 1 : -1;
    const hx = _p.x - px + _p.tx * dir * 12;
    const hz = _p.z - pz + _p.tz * dir * 12;
    w *= hx * awayX + hz * awayZ > 0 ? 3 : 0.1;
  }
  return w;
}

/**
 * Choose where a walker goes on reaching the end of a footpath at `node`: any side of any walkable road
 * there that can be reached without crossing (weight 1) or by crossing a single road (`crossChance`), or
 * back the way they came (`uTurnChance`). `(awayX, awayZ)` biases the choice away from a threat when
 * fleeing (pass 0, 0 otherwise). Returns false if there is nowhere to go.
 */
export function choosePedMove(
  graph: RoadGraph,
  from: RoadEdge,
  fromSide: 1 | -1,
  node: number,
  px: number,
  pz: number,
  jitter: number,
  rng: { next(): number },
  crossChance: number,
  uTurnChance: number,
  awayX: number,
  awayZ: number,
  out: PedMove,
): boolean {
  const edges = graph.nodes[node].edges;
  let total = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = graph.edges[edges[i]];
    if (!walkable(e)) continue;
    total += moveWeight(graph, from, fromSide, node, px, pz, e, 1, jitter, crossChance, uTurnChance, awayX, awayZ);
    total += moveWeight(graph, from, fromSide, node, px, pz, e, -1, jitter, crossChance, uTurnChance, awayX, awayZ);
  }
  if (total <= 0) return false;
  let r = rng.next() * total;
  let found = false;
  for (let i = 0; i < edges.length && r > 0; i++) {
    const e = graph.edges[edges[i]];
    if (!walkable(e)) continue;
    for (let k = 0; k < 2 && r > 0; k++) {
      const side: 1 | -1 = k === 0 ? 1 : -1;
      const w = moveWeight(graph, from, fromSide, node, px, pz, e, side, jitter, crossChance, uTurnChance, awayX, awayZ);
      if (w <= 0) continue;
      r -= w;
      // moveWeight left the candidate's start point in _p.
      const atA = e.a === node;
      const trim = walkTrim(graph, e, node);
      out.edge = e;
      out.side = side;
      out.dir = atA ? 1 : -1;
      out.s = atA ? trim : e.length - trim;
      out.x = _p.x;
      out.z = _p.z;
      out.crossing = !(e === from && side === fromSide) && crossingCount(graph, node, px, pz, _p.x, _p.z) > 0;
      found = true;
    }
  }
  return found;
}
