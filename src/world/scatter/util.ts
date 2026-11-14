import type { ChunkBuilder, LandmarkPlacement, Place, RoadEdge, RoadGraph, RoadNode, WorldApi } from '../../core/types';

/**
 * Measurement switch: load the game with `?nodress` in the URL and the round-2 dressing is left out, so its cost
 * in draw calls and triangles can be read off against the same scene (`node scripts/shot.mjs --url
 * "http://localhost:5195/?nodress" --fps 5 …`).
 */
export const DRESSING_OFF = typeof location !== 'undefined' && /[?&]nodress\b/.test(location.search);

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

/** FNV-1a over a string: one stable number per street name, so a whole street shares its character. */
export function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
  add(x: number, y: number, z: number, color = 0xffe2b0, intensity = 130, range = 16): void {
    if (this.used++ < this.max) this.out.light(x, y, z, color, intensity, range);
  }
}
