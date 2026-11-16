import type * as THREE from 'three';
import type { ChunkBuilder, LandmarkPlacement, MaterialLibrary, Place, RoadClass, RoadEdge, RoadGraph, RoadNode, WorldApi } from '../../core/types';
import { batchHint, setBatchHint } from '../../render/materials';

/** The warm sodium-white every street lamp, porch light and lit window shares. */
export const LAMP_WARM = 0xffe2b0;

/**
 * Measurement switch: load the game with `?nodress` in the URL and the round-2 dressing is left out, so its cost
 * in draw calls and triangles can be read off against the same scene (`node scripts/shot.mjs --url
 * "http://localhost:5195/?nodress" --fps 5 …`).
 */
export const DRESSING_OFF = typeof location !== 'undefined' && /[?&]nodress\b/.test(location.search);

/**
 * The same for round 3: `?dress3=0` leaves out what the art pass added (the shop-street furniture, parked cars and
 * meters, signs and signals at the limit lines, street names, transformers and service lines, shelter hedges and
 * long grass, the extra park planting, the tubs' plants and the bedding), so its cost can be read off against
 * the same scene: see scripts in shots/round3/dressing-report.md.
 */
export const ROUND3_OFF = typeof location !== 'undefined' && /[?&]dress3=0\b/.test(location.search);

/** Scatter areas are the world's 256 m chunks. */
const CELL = 256;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 512) * 1024 + Math.floor(z / CELL) + 512;

interface RoadIndex {
  edges: Map<number, RoadEdge[]>;
  nodes: Map<number, RoadNode[]>;
}

const indexes = new WeakMap<RoadGraph, RoadIndex>();

/** Road edges (by any centreline sample) and junction nodes per 256 m cell, built once per graph. */
export function roadIndex(graph: RoadGraph): RoadIndex {
  let index = indexes.get(graph);
  if (!index) {
    index = { edges: new Map(), nodes: new Map() };
    for (const edge of graph.edges) {
      let last = -1;
      for (const s of edge.samples) {
        const key = cellKey(s.x, s.z);
        if (key === last) continue;
        last = key;
        let list = index.edges.get(key);
        if (!list) index.edges.set(key, (list = []));
        if (!list.includes(edge)) list.push(edge);
      }
    }
    for (const node of graph.nodes) {
      const key = cellKey(node.x, node.z);
      let list = index.nodes.get(key);
      if (!list) index.nodes.set(key, (list = []));
      list.push(node);
    }
    indexes.set(graph, index);
  }
  return index;
}

export interface Area {
  minX: number;
  minZ: number;
  size: number;
  seed: number;
}

/** Edges with a centreline sample inside the area, in index order (deterministic). */
export function edgesIn(graph: RoadGraph, area: Area): RoadEdge[] {
  return (roadIndex(graph).edges.get(cellKey(area.minX + 1, area.minZ + 1)) ?? []).slice().sort((a, b) => a.index - b.index);
}

export function nodesIn(graph: RoadGraph, area: Area): RoadNode[] {
  return roadIndex(graph).nodes.get(cellKey(area.minX + 1, area.minZ + 1)) ?? [];
}

/** FNV-1a over a street name, so a whole street shares its character. */
export { hashString as hashName } from '../../core/rng';

/** What set dressing must keep clear of in one area: landmark radii, mission markers, carriageways. */
export class Keep {
  readonly marks: LandmarkPlacement[];
  readonly places: Place[];

  constructor(
    readonly world: WorldApi,
    readonly area: Area,
    reach = 0,
  ) {
    const { minX, minZ, size } = area;
    const near = (x: number, z: number, r: number) => Math.hypot(Math.max(minX - x, 0, x - minX - size), Math.max(minZ - z, 0, z - minZ - size)) < r;
    this.marks = world.landmarks.filter((l) => near(l.x, l.z, l.clearRadius + 6 + reach));
    this.places = world.places.filter((p) => near(p.x, p.z, 8 + reach));
  }

  /** The point belongs to this area (so exactly one chunk places anything standing there). */
  inArea(x: number, z: number): boolean {
    return x >= this.area.minX && x < this.area.minX + this.area.size && z >= this.area.minZ && z < this.area.minZ + this.area.size;
  }

  /** Inside a landmark's clear radius (grown by `pad`). */
  inLandmark(x: number, z: number, pad = 0): boolean {
    for (const l of this.marks) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + pad) return true;
    return false;
  }

  /** Within `r` metres of a mission marker, shop door or spawn point. */
  nearPlace(x: number, z: number, r = 3.5): boolean {
    for (const p of this.places) if (Math.hypot(p.x - x, p.z - z) < r) return true;
    return false;
  }

  /**
   * True when something `r` metres wide may stand here: off every carriageway and mall (by `r`), away from mission
   * markers, and on dry ground. Says nothing about landmarks (see `inLandmark`).
   */
  offRoad(x: number, z: number, r = 0.4): boolean {
    const hit = this.world.graph.nearest(x, z, 24);
    if (hit && hit.distance < hit.edge.width / 2 + r) return false;
    return !this.nearPlace(x, z, 3 + r) && this.world.waterDepthAt(x, z) <= 0;
  }
}

/** Night light, but only a few per area: the pool of real lights is small and street lamps need it too. */
export class Lights {
  private used = 0;
  constructor(
    private out: ChunkBuilder,
    private max: number,
  ) {}
  add(x: number, y: number, z: number, color = LAMP_WARM, intensity = 130, range = 16): void {
    if (this.used++ < this.max) this.out.light(x, y, z, color, intensity, range);
  }
}

// ───────────── Reading the road the way the road painter does (see ../roadmesh.ts) ─────────────
// The painter keeps these to itself, so they are repeated here: what stands at the kerb has to agree with
// the limit lines, parking bays and crossings painted on the seal.

const ROAD_RANK: Record<RoadClass, number> = { highway: 4, arterial: 3, street: 2, lane: 1, gravel: 0, pedestrian: -1 };

/** Unit direction of an edge as it leaves a node. */
export function leaving(o: RoadEdge, node: number): [number, number] {
  const n = o.samples.length;
  const a = o.a === node ? o.samples[0] : o.samples[n - 1];
  const b = o.a === node ? o.samples[Math.min(2, n - 1)] : o.samples[Math.max(0, n - 3)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.x - a.x) / len, (b.z - a.z) / len];
}

/** How far from `node` the kerb on one side of `self` stops to clear a road leaving on that side (side 1 = left of a → b). */
export function sideTrim(graph: RoadGraph, node: number, self: RoadEdge, side: number, pad = 0.4): number {
  const d = leaving(self, node);
  const want = node === self.a ? side : -side;
  let r = 0;
  for (const ei of graph.nodes[node].edges) {
    if (ei === self.index) continue;
    const other = graph.edges[ei];
    const od = leaving(other, node);
    const lateral = od[0] * d[1] - od[1] * d[0];
    if (lateral * want > 0.2) r = Math.max(r, (other.width / 2 + pad) / Math.max(0.5, Math.abs(lateral)));
  }
  return r;
}

/** Radius round a node taken up by the other roads' carriageways: limit lines are painted 0.6 m short of it. */
export function junctionRadius(graph: RoadGraph, node: number, self: RoadEdge, pad = 0.4): number {
  let r = 0;
  for (const ei of graph.nodes[node].edges) if (ei !== self.index) r = Math.max(r, graph.edges[ei].width / 2 + pad);
  return r;
}

export type Control = 'none' | 'giveway' | 'stop' | 'signal';

/** How traffic arriving along `e` at `node` is controlled: the rule the limit lines are painted by. */
export function approachControl(graph: RoadGraph, e: RoadEdge, node: number): Control {
  if (ROAD_RANK[e.cls] < 1 || e.cls === 'lane' || (e.oneway && node === e.a)) return 'none';
  const others = graph.nodes[node].edges.filter((i) => i !== e.index).map((i) => graph.edges[i]).filter((o) => ROAD_RANK[o.cls] >= 1);
  if (others.length < 2) return 'none';
  const rank = ROAD_RANK[e.cls];
  const top = Math.max(...others.map((o) => ROAD_RANK[o.cls]));
  if (rank < top) return top - rank >= 2 ? 'stop' : 'giveway';
  const dir = leaving(e, node);
  const through = others.some((o) => {
    const d = leaving(o, node);
    return ROAD_RANK[o.cls] >= rank && dir[0] * d[0] + dir[1] * d[1] < -0.8;
  });
  if (!through) return 'giveway';
  return others.filter((o) => ROAD_RANK[o.cls] === rank).length >= 3 ? 'signal' : 'none';
}

/** A street name as it is lettered on a blade: capitals, the kind of road shortened. */
export function bladeName(name: string): string {
  const SHORT: Record<string, string> = { street: 'ST', road: 'RD', avenue: 'AVE', terrace: 'TCE', place: 'PL', crescent: 'CRES', parade: 'PDE', drive: 'DR', highway: 'HWY', boulevard: 'BLVD', square: 'SQ' };
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase();
  if (words.length > 1 && SHORT[last]) words[words.length - 1] = SHORT[last];
  return words.join(' ').toUpperCase();
}

// ───────────── Small static pieces that cost a chunk at most one draw call and nothing in the shadow passes ─────────────

/**
 * The plain surface, flagged transparent the way the power lines are (see ./streets.ts): a material flagged so
 * casts no shadow. It is the very material the wires are in (one dark colour: a transparent material does not
 * merge by colour), so where a street has wires these pieces cost no draw call at all. For slender dark things
 * whose own shadow nobody would miss: sign posts, the backs of the blades, a transformer can.
 */
export const unshadowed = (materials: MaterialLibrary): THREE.Material => materials.get('plain', { color: 0x2b2d2e, transparent: true, opacity: 0.999 });

const bladePages = new WeakMap<THREE.Material, THREE.Material>();

/**
 * A painted sign as a street-name blade: the same cell of the sign atlas, on a copy of its page that casts no
 * shadow, so the blades of a chunk are one draw call however many streets meet there, and none in the cascades.
 * A test double's sign (no atlas behind it) comes back as it is.
 */
export function bladeSign(materials: MaterialLibrary, sign: THREE.Material): THREE.Material {
  const hint = batchHint(sign);
  const page = hint?.base as THREE.MeshStandardMaterial | undefined;
  if (!hint || !page || !hint.uv || typeof page.clone !== 'function') return sign;
  let copy = bladePages.get(page);
  if (!copy) {
    const made = page.clone();
    made.transparent = true;
    made.opacity = 0.999;
    made.name = 'street-names';
    copy = materials.register(made);
    bladePages.set(page, copy);
  }
  const blade = { isMaterial: true, type: 'StreetName' } as unknown as THREE.Material;
  setBatchHint(blade, { base: copy, uv: hint.uv });
  return blade;
}
