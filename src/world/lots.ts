import { hashInts, Rng } from '../core/rng';
import type { DistrictType, LandmarkPlacement, Lot, RoadClass, RoadEdge } from '../core/types';
import { WORLD_BOUNDS } from './height';
import { packCell } from './mapsource';
import type { CompiledMap } from './map';

interface LotRule {
  frontage: [number, number];
  depth: [number, number];
  /** Probability a slot is built on. */
  fill: number;
  /** Gap between neighbouring plots. */
  gap: [number, number];
}

const RULES: Record<DistrictType, LotRule | null> = {
  cbd: { frontage: [16, 30], depth: [20, 28], fill: 0.97, gap: [0, 0] },
  shops: { frontage: [7, 13], depth: [14, 20], fill: 0.96, gap: [0, 0] },
  township: { frontage: [9, 15], depth: [14, 20], fill: 0.85, gap: [0, 3] },
  villa: { frontage: [15, 19], depth: [24, 28], fill: 0.95, gap: [0, 1] },
  statehouse: { frontage: [16, 20], depth: [24, 28], fill: 0.95, gap: [0, 1] },
  industrial: { frontage: [28, 46], depth: [30, 40], fill: 0.85, gap: [2, 8] },
  port: { frontage: [30, 50], depth: [30, 44], fill: 0.8, gap: [4, 10] },
  rural: { frontage: [34, 44], depth: [34, 44], fill: 0.035, gap: [40, 160] },
  park: null,
  beach: null,
};

const CLASS_ORDER: RoadClass[] = ['pedestrian', 'arterial', 'street', 'highway', 'lane', 'gravel'];
export const CHUNK = 256;
export const chunkKey = packCell;
export const chunkOf = (v: number) => Math.floor(v / CHUNK);

interface Placed {
  x: number;
  z: number;
  ax: number; // unit axis along frontage
  az: number;
  hw: number;
  hd: number;
}

function overlaps(a: Placed, b: Placed): boolean {
  // Separating-axis test for two oriented rectangles.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [
    [a.ax, a.az],
    [-a.az, a.ax],
    [b.ax, b.az],
    [-b.az, b.ax],
  ]) {
    const ra = a.hw * Math.abs(a.ax * ux + a.az * uz) + a.hd * Math.abs(-a.az * ux + a.ax * uz);
    const rb = b.hw * Math.abs(b.ax * ux + b.az * uz) + b.hd * Math.abs(-b.az * ux + b.ax * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb - 0.3) return false;
  }
  return true;
}

/** Lays building plots along every road edge. Deterministic; runs once at load. */
export function generateLots(map: CompiledMap): Map<number, Lot[]> {
  const { graph, terrain } = map;
  const byChunk = new Map<number, Lot[]>();
  const placed = new Map<number, Placed[]>();
  const CELL = 48;
  const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 1024) * 4096 + (Math.floor(z / CELL) + 1024);

  const nearLandmark = (x: number, z: number, r: number) => map.landmarks.some((l: LandmarkPlacement) => Math.hypot(l.x - x, l.z - z) < l.clearRadius + r);
  const roadClear = (x: number, z: number) => {
    const hit = graph.nearest(x, z, 30);
    return !hit || hit.distance >= hit.edge.width / 2 + (hit.edge.footpaths ? 3.1 : 1.4);
  };
  const free = (p: Placed) => {
    const reach = Math.ceil((Math.max(p.hw, p.hd) * 1.5) / CELL);
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        for (const q of placed.get((cx + a + 1024) * 4096 + (cz + b + 1024)) ?? []) if (overlaps(p, q)) return false;
      }
    }
    return true;
  };

  const edges = [...graph.edges].sort((a, b) => CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || a.index - b.index);
  for (const edge of edges) {
    if (edge.bridge || edge.tunnel) continue;
    const rng = new Rng(hashInts(edge.index, 77));
    const junction = (node: number) => {
      let r = 0;
      for (const ei of graph.nodes[node].edges) if (ei !== edge.index) r = Math.max(r, graph.edges[ei].width / 2 + (graph.edges[ei].footpaths ? 3.4 : 1.6));
      return r;
    };
    const start = junction(edge.a);
    const end = edge.length - junction(edge.b);
    for (const side of [1, -1] as const) {
      let s = start;
      while (s < end) {
        const probe = graph.pointAt(edge, s);
        const reach = edge.width / 2 + (edge.footpaths ? 3.2 : 2.2);
        const district = map.districtAt(probe.x + probe.tz * (reach + 10) * side, probe.z - probe.tx * (reach + 10) * side);
        const rule = RULES[district.type];
        if (!rule) {
          s += 12;
          continue;
        }
        const width = rng.range(rule.frontage[0], rule.frontage[1]);
        const depth = rng.range(rule.depth[0], rule.depth[1]);
        const sc = s + width / 2;
        if (sc + width / 2 > end) break;
        s += width + rng.range(rule.gap[0], rule.gap[1]);
        if (!rng.chance(rule.fill)) continue;

        const c = graph.pointAt(edge, sc);
        // Left of travel is (tz, -tx).
        const nx = c.tz * side;
        const nz = -c.tx * side;
        const off = reach + depth / 2;
        const x = c.x + nx * off;
        const z = c.z + nz * off;
        if (x < WORLD_BOUNDS.minX + 20 || x > WORLD_BOUNDS.maxX - 20 || z < WORLD_BOUNDS.minZ + 20 || z > WORLD_BOUNDS.maxZ - 20) continue;

        const p: Placed = { x, z, ax: c.tx, az: c.tz, hw: width / 2, hd: depth / 2 };
        let ok = true;
        // Corners, back edge midpoint and centre must be clear of other roads and on dry, fairly level land.
        const yFront = terrain.height(c.x + nx * reach, c.z + nz * reach);
        for (const [u, v] of [
          [0, 0],
          [-1, 1],
          [1, 1],
          [0, 1],
          [-1, 0],
          [1, 0],
          [-1, -0.8],
          [1, -0.8],
        ]) {
          const px = x + c.tx * u * (width / 2 - 0.4) + nx * v * (depth / 2 - 0.4);
          const pz = z + c.tz * u * (width / 2 - 0.4) + nz * v * (depth / 2 - 0.4);
          const h = terrain.natural(px, pz);
          if (h < 1.6 || Math.abs(terrain.height(px, pz) - yFront) > 2.6 || (v > -0.5 && !roadClear(px, pz)) || terrain.waterDepth(px, pz) > 0) {
            ok = false;
            break;
          }
        }
        if (!ok || nearLandmark(x, z, Math.max(width, depth) * 0.5) || !free(p)) continue;

        const key = cellKey(x, z);
        placed.set(key, [...(placed.get(key) ?? []), p]);
        const lot: Lot = {
          x,
          z,
          y: yFront,
          heading: Math.atan2(-nx, -nz), // front faces back towards the road
          width,
          depth,
          district,
          edge: edge as RoadEdge,
          seed: hashInts(edge.index, Math.round(sc), side),
          corner: sc - width / 2 < start + 2 || sc + width / 2 > end - 2,
        };
        const ck = chunkKey(chunkOf(x), chunkOf(z));
        let list = byChunk.get(ck);
        if (!list) byChunk.set(ck, (list = []));
        list.push(lot);
      }
    }
  }
  return byChunk;
}
