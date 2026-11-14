import type { EdgeSample, RoadClass, RoadEdge, RoadGraph, RoadHit, RoadNode } from '../core/types';

/**
 * A tiny road graph for unit tests (not used by the game). Roads are polylines; ends that coincide share a
 * node. `lanePoint`, `footpathPoint` and `pointAt` copy the formulas of the real graph in world/map.ts so
 * the AI's allocation-free versions can be checked against them.
 */

export interface TestRoad {
  name?: string;
  cls?: RoadClass;
  pts: [x: number, z: number][];
  oneway?: boolean;
  lanes?: number;
  width?: number;
  footpaths?: boolean;
  drivable?: boolean;
  /** km/h */
  speed?: number;
}

const DEFAULTS: Record<RoadClass, { width: number; lanes: number; speed: number; footpaths: boolean; drivable: boolean }> = {
  highway: { width: 9.5, lanes: 1, speed: 100, footpaths: false, drivable: true },
  arterial: { width: 15, lanes: 2, speed: 60, footpaths: true, drivable: true },
  street: { width: 9.5, lanes: 1, speed: 50, footpaths: true, drivable: true },
  lane: { width: 6, lanes: 1, speed: 30, footpaths: false, drivable: true },
  gravel: { width: 5.5, lanes: 1, speed: 70, footpaths: false, drivable: true },
  pedestrian: { width: 11, lanes: 1, speed: 10, footpaths: false, drivable: false },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function buildGraph(roads: TestRoad[]): RoadGraph {
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const nodeAt = (x: number, z: number): number => {
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 0.5) return n.index;
    nodes.push({ index: nodes.length, x, y: 0, z, edges: [] });
    return nodes.length - 1;
  };
  for (const road of roads) {
    const cls = road.cls ?? 'street';
    const def = DEFAULTS[cls];
    const lens = [0];
    for (let i = 1; i < road.pts.length; i++) lens.push(lens[i - 1] + Math.hypot(road.pts[i][0] - road.pts[i - 1][0], road.pts[i][1] - road.pts[i - 1][1]));
    const total = lens[lens.length - 1];
    const n = Math.max(1, Math.round(total / 4));
    const pts: { x: number; z: number; s: number }[] = [];
    let seg = 0;
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * total;
      while (seg < road.pts.length - 2 && lens[seg + 1] < s) seg++;
      const t = (s - lens[seg]) / (lens[seg + 1] - lens[seg] || 1);
      pts.push({ x: lerp(road.pts[seg][0], road.pts[seg + 1][0], t), z: lerp(road.pts[seg][1], road.pts[seg + 1][1], t), s });
    }
    const samples: EdgeSample[] = pts.map((p, k) => {
      const q0 = pts[Math.max(0, k - 1)];
      const q1 = pts[Math.min(pts.length - 1, k + 1)];
      const len = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
      return { x: p.x, y: 0, z: p.z, tx: (q1.x - q0.x) / len, tz: (q1.z - q0.z) / len, s: p.s };
    });
    const first = road.pts[0];
    const last = road.pts[road.pts.length - 1];
    const a = nodeAt(first[0], first[1]);
    const b = nodeAt(last[0], last[1]);
    const edge: RoadEdge = {
      index: edges.length,
      name: road.name ?? `Road ${edges.length}`,
      cls,
      a,
      b,
      samples,
      length: total,
      width: road.width ?? def.width,
      lanes: road.lanes ?? def.lanes,
      speedLimit: (road.speed ?? def.speed) / 3.6,
      oneway: !!road.oneway,
      bridge: false,
      tunnel: false,
      footpaths: road.footpaths ?? def.footpaths,
      drivable: road.drivable ?? def.drivable,
    };
    edges.push(edge);
    nodes[a].edges.push(edge.index);
    nodes[b].edges.push(edge.index);
  }

  const pointAt = (edge: RoadEdge, s: number): EdgeSample => {
    const n = edge.samples.length - 1;
    const f = clamp((s / edge.length) * n, 0, n);
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const a = edge.samples[i];
    const b = edge.samples[i + 1];
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t), s: clamp(s, 0, edge.length) };
  };

  const graph: RoadGraph = {
    nodes,
    edges,
    nearest(x, z, maxDistance = 60, filter) {
      let best: RoadHit | null = null;
      for (const edge of edges) {
        if (filter && !filter(edge)) continue;
        for (let i = 0; i < edge.samples.length - 1; i++) {
          const a = edge.samples[i];
          const b = edge.samples[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          const px = a.x + dx * t;
          const pz = a.z + dz * t;
          const distance = Math.hypot(x - px, z - pz);
          if (distance <= maxDistance && (!best || distance < best.distance)) {
            const len = Math.hypot(dx, dz) || 1;
            best = { edge, s: lerp(a.s, b.s, t), distance, offset: ((x - px) * dz - (z - pz) * dx) / len, x: px, y: 0, z: pz };
          }
        }
      }
      return best;
    },
    pointAt,
    lanePoint(edge, s, dir, lane = 0) {
      const p = pointAt(edge, s);
      const tx = p.tx * dir;
      const tz = p.tz * dir;
      const laneWidth = edge.width / (edge.lanes * 2);
      const offset = (edge.lanes - 0.5 - lane) * laneWidth;
      return { x: p.x + tz * offset, y: p.y, z: p.z - tx * offset, heading: Math.atan2(tx, tz) };
    },
    footpathPoint(edge, s, side) {
      const p = pointAt(edge, s);
      const offset = (edge.width / 2 + 1.7) * side;
      return { x: p.x + p.tz * offset, y: p.y, z: p.z - p.tx * offset };
    },
    endNode(edge, dir) {
      return nodes[dir === 1 ? edge.b : edge.a];
    },
    route(fromNode, toNode) {
      const cost = new Array<number>(nodes.length).fill(Infinity);
      const via: ({ edge: RoadEdge; dir: 1 | -1 } | null)[] = new Array(nodes.length).fill(null);
      cost[fromNode] = 0;
      const open = [fromNode];
      while (open.length) {
        open.sort((p, q) => cost[p] - cost[q]);
        const u = open.shift()!;
        if (u === toNode) break;
        for (const ei of nodes[u].edges) {
          const e = edges[ei];
          if (!e.drivable) continue;
          const dir: 1 | -1 = e.a === u ? 1 : -1;
          if (e.oneway && dir === -1) continue;
          const v = dir === 1 ? e.b : e.a;
          const c = cost[u] + e.length / e.speedLimit;
          if (c < cost[v]) {
            cost[v] = c;
            via[v] = { edge: e, dir };
            open.push(v);
          }
        }
      }
      if (fromNode === toNode) return [];
      if (!via[toNode]) return null;
      const out: { edge: RoadEdge; dir: 1 | -1 }[] = [];
      let at = toNode;
      while (at !== fromNode) {
        const leg = via[at]!;
        out.push(leg);
        at = leg.dir === 1 ? leg.edge.a : leg.edge.b;
      }
      return out.reverse();
    },
    nearestNode(x, z) {
      let best = nodes[0];
      for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < Math.hypot(best.x - x, best.z - z)) best = n;
      return best;
    },
  };
  return graph;
}

/**
 * A crossroads at the origin with four 120 m arms, plus a ring of streets joining their far ends.
 * Arms: 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). Each arm's edge runs from the centre out.
 */
export function crossroads(options: { ewClass?: RoadClass; nsClass?: RoadClass } = {}): RoadGraph {
  const ns = options.nsClass ?? 'street';
  const ew = options.ewClass ?? 'street';
  return buildGraph([
    { name: 'North Road', cls: ns, pts: [[0, 0], [0, -120]] },
    { name: 'East Road', cls: ew, pts: [[0, 0], [120, 0]] },
    { name: 'South Road', cls: ns, pts: [[0, 0], [0, 120]] },
    { name: 'West Road', cls: ew, pts: [[0, 0], [-120, 0]] },
    { name: 'Ring NE', pts: [[0, -120], [120, -120], [120, 0]] },
    { name: 'Ring SE', pts: [[120, 0], [120, 120], [0, 120]] },
    { name: 'Ring SW', pts: [[0, 120], [-120, 120], [-120, 0]] },
    { name: 'Ring NW', pts: [[-120, 0], [-120, -120], [0, -120]] },
  ]);
}
