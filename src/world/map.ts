import * as THREE from 'three';
import { laneOffset } from '../core/lanes';
import { clamp, lerp } from '../core/math';
import type { District, EdgeSample, LandmarkPlacement, Place, RoadClass, RoadEdge, RoadGraph, RoadHit, RoadNode } from '../core/types';
import { SEA_LEVEL, TerrainModel, type RiverPath } from './height';
import { inShape, segSegIntersect, type DistrictSource, type MapSource, type Pt, type RailSource, type RoadSource } from './mapsource';

const CLASS_DEFAULTS: Record<RoadClass, { width: number; lanes: number; speed: number; footpaths: boolean; drivable: boolean; grade: number }> = {
  highway: { width: 9.5, lanes: 1, speed: 100, footpaths: false, drivable: true, grade: 0.06 },
  arterial: { width: 15, lanes: 2, speed: 60, footpaths: true, drivable: true, grade: 0.08 },
  street: { width: 9.5, lanes: 1, speed: 50, footpaths: true, drivable: true, grade: 0.13 },
  lane: { width: 6, lanes: 1, speed: 30, footpaths: false, drivable: true, grade: 0.15 },
  gravel: { width: 5.5, lanes: 1, speed: 70, footpaths: false, drivable: true, grade: 0.13 },
  pedestrian: { width: 11, lanes: 1, speed: 10, footpaths: false, drivable: false, grade: 0.13 },
};

const SAMPLE_STEP = 4;
const CELL = 64;

function smoothPolyline(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const n = Math.max(2, Math.round(curve.getLength() / 12));
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
}

function resample(pts: Pt[], step: number): { x: number; z: number; s: number }[] {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out: { x: number; z: number; s: number }[] = [];
  let seg = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (seg < pts.length - 2 && lens[seg + 1] < s) seg++;
    const t = (s - lens[seg]) / (lens[seg + 1] - lens[seg] || 1);
    out.push({ x: lerp(pts[seg][0], pts[seg + 1][0], t), z: lerp(pts[seg][1], pts[seg + 1][1], t), s });
  }
  return out;
}


class Graph implements RoadGraph {
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  private cells = new Map<number, number[]>(); // packed (edge << 12 | sample)

  index() {
    this.cells.clear();
    for (const e of this.edges) {
      e.samples.forEach((s, i) => {
        const key = (Math.floor(s.x / CELL) + 512) * 1024 + (Math.floor(s.z / CELL) + 512);
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(e.index * 4096 + i);
      });
    }
  }

  nearest(x: number, z: number, maxDistance = 60, filter?: (edge: RoadEdge) => boolean): RoadHit | null {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    // Slack of one sample step: the projected distance (refined below) can be shorter than to any sample.
    let bestD2 = (maxDistance + 3) * (maxDistance + 3);
    let bestEdge = -1;
    let bestI = 0;
    const reach = maxDistance > CELL - 8 ? 2 : 1;
    for (let a = cx - reach; a <= cx + reach; a++) {
      for (let b = cz - reach; b <= cz + reach; b++) {
        const list = this.cells.get((a + 512) * 1024 + (b + 512));
        if (!list) continue;
        for (const packed of list) {
          const ei = Math.floor(packed / 4096);
          const e = this.edges[ei];
          const s = e.samples[packed - ei * 4096];
          const dx = s.x - x;
          const dz = s.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2 && (!filter || filter(e))) {
            bestD2 = d2;
            bestEdge = ei;
            bestI = packed - ei * 4096;
          }
        }
      }
    }
    if (bestEdge < 0) return null;
    const edge = this.edges[bestEdge];
    // Refine: project onto the two segments either side of the nearest sample.
    let best: RoadHit | null = null;
    for (const i of [bestI - 1, bestI]) {
      if (i < 0 || i >= edge.samples.length - 1) continue;
      const a = edge.samples[i];
      const b = edge.samples[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance) {
        const len = Math.hypot(dx, dz) || 1;
        // + = left of travel a→b. left = (tz, -tx).
        const offset = ((x - px) * dz - (z - pz) * dx) / len;
        best = { edge, s: lerp(a.s, b.s, t), distance, offset, x: px, y: lerp(a.y, b.y, t), z: pz };
      }
    }
    if (!best) {
      const s = edge.samples[bestI];
      best = { edge, s: s.s, distance: Math.sqrt(bestD2), offset: 0, x: s.x, y: s.y, z: s.z };
    }
    return best.distance <= maxDistance ? best : null;
  }

  pointAt(edge: RoadEdge, s: number): EdgeSample {
    const n = edge.samples.length - 1;
    const f = clamp((s / edge.length) * n, 0, n);
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const a = edge.samples[i];
    const b = edge.samples[i + 1];
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t), s: clamp(s, 0, edge.length) };
  }

  lanePoint(edge: RoadEdge, s: number, dir: 1 | -1, lane = 0) {
    const p = this.pointAt(edge, s);
    const tx = p.tx * dir;
    const tz = p.tz * dir;
    const offset = laneOffset(edge, lane);
    return { x: p.x + tz * offset, y: p.y, z: p.z - tx * offset, heading: Math.atan2(tx, tz) };
  }

  footpathPoint(edge: RoadEdge, s: number, side: 1 | -1) {
    const p = this.pointAt(edge, s);
    const offset = (edge.width / 2 + 1.7) * side;
    return { x: p.x + p.tz * offset, y: p.y, z: p.z - p.tx * offset };
  }

  endNode(edge: RoadEdge, dir: 1 | -1): RoadNode {
    return this.nodes[dir === 1 ? edge.b : edge.a];
  }

  nearestNode(x: number, z: number): RoadNode {
    let best = this.nodes[0];
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  route(fromNode: number, toNode: number): { edge: RoadEdge; dir: 1 | -1 }[] | null {
    const n = this.nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const via = new Int32Array(n).fill(-1);
    const viaDir = new Int8Array(n);
    const heap: number[] = [];
    const push = (node: number) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (cost[heap[p]] <= cost[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l;
          if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    cost[fromNode] = 0;
    push(fromNode);
    while (heap.length) {
      const u = pop();
      if (u === toNode) break;
      for (const ei of this.nodes[u].edges) {
        const e = this.edges[ei];
        if (!e.drivable) continue;
        const dir: 1 | -1 = e.a === u ? 1 : -1;
        if (e.oneway && dir === -1) continue;
        const v = dir === 1 ? e.b : e.a;
        const c = cost[u] + e.length / e.speedLimit;
        if (c < cost[v]) {
          cost[v] = c;
          via[v] = ei;
          viaDir[v] = dir;
          push(v);
        }
      }
    }
    if (via[toNode] < 0) return fromNode === toNode ? [] : null;
    const out: { edge: RoadEdge; dir: 1 | -1 }[] = [];
    let at = toNode;
    while (at !== fromNode) {
      const e = this.edges[via[at]];
      const dir = viaDir[at] as 1 | -1;
      out.push({ edge: e, dir });
      at = dir === 1 ? e.a : e.b;
    }
    return out.reverse();
  }
}

export interface RailPath {
  source: RailSource;
  samples: { x: number; y: number; z: number; tx: number; tz: number; s: number }[];
}

export interface CompiledMap {
  graph: Graph;
  terrain: TerrainModel;
  rivers: RiverPath[];
  rails: RailPath[];
  places: Place[];
  landmarks: LandmarkPlacement[];
  districtAt(x: number, z: number): District;
}

const RURAL: District = { id: 'plains', name: 'Canterbury Plains', city: null, type: 'rural', teReo: 'Kā Pākihi-whakatekateka-a-Waitaha' };

/** Turns authored polylines into a connected road graph with heights, plus rivers, rails and districts. */
export function compileMap(src: MapSource): CompiledMap {
  const terrain = new TerrainModel(src.terrain);
  const graph = new Graph();

  // 1. Polylines (optionally smoothed) with cut points where roads meet.
  interface Line {
    road: RoadSource;
    pts: Pt[];
    lens: number[];
    cuts: number[]; // distances along the polyline
  }
  const lines: Line[] = src.roads.map((road) => {
    const pts = road.smooth ? smoothPolyline(road.pts) : road.pts.map((p) => [p[0], p[1]] as Pt);
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { road, pts, lens, cuts: [0, lens[lens.length - 1]] };
  });
  const bbox = lines.map((l) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of l.pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { minX: minX - 3, maxX: maxX + 3, minZ: minZ - 3, maxZ: maxZ + 3 };
  });
  const grade = (l: Line) => l.road.bridge || l.road.tunnel;

  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const A = bbox[a];
      const B = bbox[b];
      if (A.minX > B.maxX || B.minX > A.maxX || A.minZ > B.maxZ || B.minZ > A.maxZ) continue;
      const la = lines[a];
      const lb = lines[b];
      for (let i = 0; i < la.pts.length - 1; i++) {
        const [x1, z1] = la.pts[i];
        const [x2, z2] = la.pts[i + 1];
        for (let j = 0; j < lb.pts.length - 1; j++) {
          const [x3, z3] = lb.pts[j];
          const [x4, z4] = lb.pts[j + 1];
          const hit = segSegIntersect(x1, z1, x2, z2, x3, z3, x4, z4, 1e-6);
          if (!hit) continue;
          const { ua, ub } = hit;
          const lenA = la.lens[i + 1] - la.lens[i];
          const lenB = lb.lens[j + 1] - lb.lens[j];
          // Tolerate near-misses of up to 2.5 m so T-junctions drawn "close enough" still connect.
          const ea = 2.5 / (lenA || 1);
          const eb = 2.5 / (lenB || 1);
          if (ua < -ea || ua > 1 + ea || ub < -eb || ub > 1 + eb) continue;
          const sa = la.lens[i] + clamp(ua, 0, 1) * lenA;
          const sb = lb.lens[j] + clamp(ub, 0, 1) * lenB;
          const endA = sa < 1 || sa > la.lens[la.lens.length - 1] - 1;
          const endB = sb < 1 || sb > lb.lens[lb.lens.length - 1] - 1;
          // Bridges and tunnels pass over / under other roads unless they meet end-on.
          if ((grade(la) && !endA) || (grade(lb) && !endB)) continue;
          la.cuts.push(sa);
          lb.cuts.push(sb);
        }
      }
    }
  }

  // 2. Nodes (deduplicated within 2.5 m) and edges between consecutive cuts.
  const nodeCells = new Map<number, number[]>();
  const nodeAt = (x: number, z: number): number => {
    const cx = Math.floor(x / 8);
    const cz = Math.floor(z / 8);
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cz - 1; b <= cz + 1; b++) {
        for (const i of nodeCells.get((a + 2048) * 4096 + (b + 2048)) ?? []) {
          if (Math.hypot(graph.nodes[i].x - x, graph.nodes[i].z - z) < 3) return i;
        }
      }
    }
    const index = graph.nodes.length;
    graph.nodes.push({ index, x, y: 0, z, edges: [] });
    const key = (cx + 2048) * 4096 + (cz + 2048);
    nodeCells.set(key, [...(nodeCells.get(key) ?? []), index]);
    return index;
  };
  const pointOn = (l: Line, s: number): Pt => {
    let seg = 0;
    while (seg < l.pts.length - 2 && l.lens[seg + 1] < s) seg++;
    const t = clamp((s - l.lens[seg]) / (l.lens[seg + 1] - l.lens[seg] || 1), 0, 1);
    return [lerp(l.pts[seg][0], l.pts[seg + 1][0], t), lerp(l.pts[seg][1], l.pts[seg + 1][1], t)];
  };

  for (const l of lines) {
    const cuts = [...new Set(l.cuts.map((c) => Math.round(c * 2) / 2))].sort((a, b) => a - b);
    const merged: number[] = [];
    for (const c of cuts) if (!merged.length || c - merged[merged.length - 1] > 3) merged.push(c);
    const def = CLASS_DEFAULTS[l.road.cls];
    for (let i = 0; i < merged.length - 1; i++) {
      const s0 = merged[i];
      const s1 = merged[i + 1];
      const p0 = pointOn(l, s0);
      const p1 = pointOn(l, s1);
      const a = nodeAt(p0[0], p0[1]);
      const b = nodeAt(p1[0], p1[1]);
      if (a === b) continue;
      // Shape points strictly between the cuts, ends snapped to the shared nodes.
      const shape: Pt[] = [[graph.nodes[a].x, graph.nodes[a].z]];
      l.pts.forEach((p, k) => {
        if (l.lens[k] > s0 + 0.5 && l.lens[k] < s1 - 0.5) shape.push(p);
      });
      shape.push([graph.nodes[b].x, graph.nodes[b].z]);
      const pts = resample(shape, SAMPLE_STEP);
      const samples: EdgeSample[] = pts.map((p, k) => {
        const q0 = pts[Math.max(0, k - 1)];
        const q1 = pts[Math.min(pts.length - 1, k + 1)];
        const len = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
        return { x: p.x, y: 0, z: p.z, tx: (q1.x - q0.x) / len, tz: (q1.z - q0.z) / len, s: p.s };
      });
      const edge: RoadEdge = {
        index: graph.edges.length,
        name: l.road.name,
        cls: l.road.cls,
        a,
        b,
        samples,
        length: samples[samples.length - 1].s,
        width: l.road.width ?? def.width,
        lanes: l.road.lanes ?? def.lanes,
        speedLimit: (l.road.speed ?? def.speed) / 3.6,
        oneway: !!l.road.oneway,
        bridge: !!l.road.bridge,
        tunnel: !!l.road.tunnel,
        footpaths: l.road.footpaths ?? def.footpaths,
        drivable: def.drivable,
      };
      graph.edges.push(edge);
      graph.nodes[a].edges.push(edge.index);
      graph.nodes[b].edges.push(edge.index);
    }
  }

  // 3. Heights: nodes take the natural ground height, relaxed so no edge is steeper than its class allows.
  for (const n of graph.nodes) n.y = Math.max(SEA_LEVEL + 1.4, terrain.natural(n.x, n.z));
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (const e of graph.edges) {
      const a = graph.nodes[e.a];
      const b = graph.nodes[e.b];
      const limit = (e.bridge ? 0.025 : CLASS_DEFAULTS[e.cls].grade) * e.length;
      const diff = b.y - a.y;
      if (Math.abs(diff) > limit) {
        const fix = (Math.abs(diff) - limit) * 0.5 * Math.sign(diff);
        a.y += fix;
        b.y -= fix;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const e of graph.edges) {
    const a = graph.nodes[e.a];
    const b = graph.nodes[e.b];
    const n = e.samples.length;
    // Follow the land between the nodes (smoothed), pinned to the node heights at each end.
    const residual = e.samples.map((s) => {
      if (e.bridge || e.tunnel) return 0;
      return Math.max(SEA_LEVEL + 1.4, terrain.natural(s.x, s.z)) - lerp(a.y, b.y, s.s / e.length);
    });
    const window = 9;
    e.samples.forEach((s, i) => {
      let sum = 0;
      let count = 0;
      for (let k = i - window; k <= i + window; k++) {
        sum += residual[clamp(k, 0, n - 1)];
        count++;
      }
      const taper = clamp(Math.min(s.s, e.length - s.s) / 36, 0, 1);
      s.y = lerp(a.y, b.y, s.s / e.length) + (sum / count) * taper * taper * (3 - 2 * taper);
    });
  }
  graph.index();

  // 4. Rivers and rails.
  const rivers: RiverPath[] = src.rivers.map((r) => {
    const pts = resample(smoothPolyline(r.pts), 8);
    const raw = pts.map((p) => terrain.natural(p.x, p.z));
    // Rivers must run downhill: bank height is the smoothed running minimum from source to mouth.
    let run = Infinity;
    const samples = pts.map((p, i) => {
      let sum = 0;
      let count = 0;
      for (let k = i - 6; k <= i + 6; k++) {
        sum += raw[clamp(k, 0, raw.length - 1)];
        count++;
      }
      run = Math.min(run, sum / count);
      const q0 = pts[Math.max(0, i - 1)];
      const q1 = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
      return { x: p.x, z: p.z, y: Math.max(SEA_LEVEL + 0.4, run), tx: (q1.x - q0.x) / len, tz: (q1.z - q0.z) / len, s: p.s };
    });
    return { name: r.name, width: r.width, braided: !!r.braided, depth: r.depth ?? (r.braided ? 2.2 : 1.3), samples };
  });
  terrain.attach(graph, rivers);

  const rails: RailPath[] = src.rails.map((source) => {
    const pts = resample(source.pts.length > 2 ? smoothPolyline(source.pts) : source.pts, 6);
    const samples = pts.map((p, i) => {
      const q0 = pts[Math.max(0, i - 1)];
      const q1 = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
      return { x: p.x, y: 0, z: p.z, tx: (q1.x - q0.x) / len, tz: (q1.z - q0.z) / len, s: p.s };
    });
    return { source, samples };
  });

  // 5. Districts.
  const districts = [...src.districts].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const asDistrict = (d: DistrictSource): District => ({ id: d.id, name: d.name, city: d.city, type: d.type, teReo: d.teReo });
  const resolved = districts.map(asDistrict);
  const districtAt = (x: number, z: number): District => {
    for (let i = 0; i < districts.length; i++) if (inShape(districts[i].shape, x, z)) return resolved[i];
    return RURAL;
  };

  return { graph, terrain, rivers, rails, places: src.places, landmarks: src.landmarks, districtAt };
}
