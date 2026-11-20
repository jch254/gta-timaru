import { clamp, lerp, smooth } from '../core/math';
import { fbm, ridged } from '../core/rng';
import type { GroundSurface, RoadGraph, RoadHit } from '../core/types';
import { packCell, type Pt, type TerrainSource } from './mapsource';

export const WORLD_BOUNDS = { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 };
export const SEA_LEVEL = 0;
/** How far onto built land (0..1, see `TerrainModel.quay`) the quay wall stands. */
const QUAY_LINE = 0.5;

export interface RiverPath {
  name: string;
  width: number;
  braided: boolean;
  depth: number;
  /** Samples every ~8 m with the smoothed bank height. */
  samples: { x: number; z: number; y: number; tx: number; tz: number; s: number }[];
}

function distToPolyline(x: number, z: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}

/** 1 at the centre of a rotated ellipse falling to 0 at its edge (negative outside). */
function ellipse(x: number, z: number, e: { x: number; z: number; rx: number; rz: number; rot?: number }): number {
  const c = Math.cos(e.rot ?? 0);
  const s = Math.sin(e.rot ?? 0);
  const dx = x - e.x;
  const dz = z - e.z;
  const lx = (dx * c - dz * s) / e.rx;
  const lz = (dx * s + dz * c) / e.rz;
  return 1 - (lx * lx + lz * lz);
}

interface RiverHit {
  river: RiverPath;
  d: number;
  s: number;
  y: number;
  lateral: number;
}

/**
 * Analytic terrain: natural landform → rivers carved → blended to road profiles.
 * Deterministic and resolution-independent, so any chunk can be generated on demand.
 */
/**
 * Cross-section of the open coast by distance seaward of the nominal shoreline (m): the land ends in a low
 * bank or dune face, then about 25 m of dry sand, a swash zone where the waterline sits, and a shallow shelf
 * before the sea bed falls away.
 */
function strand(d: number, land: number): number {
  const berm = Math.min(land, 2.2);
  if (d <= -30) return land;
  if (d < -14) return lerp(land, berm, smooth(-30, -14, d));
  if (d < 12) return lerp(berm, Math.min(berm, 0.25), (d + 14) / 26);
  if (d < 42) return lerp(Math.min(berm, 0.25), -1.3, smooth(12, 42, d));
  if (d < 150) return lerp(-1.3, -5.5, (d - 42) / 108);
  return lerp(-5.5, -14, smooth(150, 300, d));
}

export class TerrainModel {
  private graph: RoadGraph | null = null;
  /** Where a tunnel's cutting can reach, so roads crossing over it are only checked near one. */
  private bores: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  rivers: RiverPath[] = [];
  private riverCells = new Map<number, { river: RiverPath; i: number }[]>();
  private readonly RC = 128;

  constructor(private src: TerrainSource) {
    src.coast.sort((a, b) => a[0] - b[0]);
  }

  attach(graph: RoadGraph, rivers: RiverPath[]) {
    this.graph = graph;
    this.rivers = rivers;
    this.bores = [];
    for (const e of graph.edges) {
      if (!e.tunnel) continue;
      const pad = e.width / 2 + 8;
      const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const s of e.samples) {
        box.minX = Math.min(box.minX, s.x - pad);
        box.maxX = Math.max(box.maxX, s.x + pad);
        box.minZ = Math.min(box.minZ, s.z - pad);
        box.maxZ = Math.max(box.maxZ, s.z + pad);
      }
      this.bores.push(box);
    }
    for (const river of rivers) {
      river.samples.forEach((s, i) => {
        // Register in every cell the bed can reach.
        const reach = Math.ceil((river.width * 0.5 + 40) / this.RC);
        const cx = Math.floor(s.x / this.RC);
        const cz = Math.floor(s.z / this.RC);
        for (let a = -reach; a <= reach; a++) {
          for (let b = -reach; b <= reach; b++) {
            const key = packCell(cx + a, cz + b);
            let list = this.riverCells.get(key);
            if (!list) this.riverCells.set(key, (list = []));
            list.push({ river, i });
          }
        }
      });
    }
  }

  /** x of the shoreline at a given z. */
  coastX(z: number): number {
    const c = this.src.coast;
    if (c.length === 0) return WORLD_BOUNDS.maxX + 500;
    if (z <= c[0][0]) return c[0][1];
    for (let i = 0; i < c.length - 1; i++) {
      if (z <= c[i + 1][0]) {
        const t = (z - c[i][0]) / (c[i + 1][0] - c[i][0] || 1);
        // Smooth interpolation so the coast curves rather than kinks.
        return lerp(c[i][1], c[i + 1][1], t * t * (3 - 2 * t));
      }
    }
    return c[c.length - 1][1];
  }

  /** Landform before rivers and roads. */
  natural(x: number, z: number): number {
    const src = this.src;
    // Plains: almost flat, rising gently towards the foothills in the west.
    let h = 7 + fbm(x * 0.0011 + 3, z * 0.0011 + 7, 3) * 5 + Math.max(0, -x) * 0.004;
    h += smooth(-2300, -3072, x) * (30 + ridged(x * 0.0015, z * 0.0015, 4) * 160);

    for (const f of src.flats) {
      const w = smooth(f.r * 1.35, f.r * 0.8, Math.hypot(x - f.x, z - f.z));
      if (w > 0) h = lerp(h, f.height, w);
    }
    for (const d of src.downs) {
      const w = smooth(d.r, d.r * 0.45, Math.hypot(x - d.x, z - d.z));
      if (w > 0) {
        const wl = d.wavelength ?? 420;
        h += w * d.amp * (fbm(x / wl + 11, z / wl + 5, 4) * 1.6 - 0.35);
      }
    }
    for (const r of src.ridges) {
      const d = distToPolyline(x, z, r.pts);
      if (d < r.width) {
        const p = smooth(r.width, 0, d);
        const rough = r.rough ?? 0.35;
        h += r.height * Math.pow(p, 1.35) * (1 - rough + rough * 2 * ridged(x * 0.004 + 9, z * 0.004 + 2, 4));
      }
    }

    // Sea: east of the coastline, plus inlets cut into the land.
    const seaward = x - this.coastX(z) + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 24;
    const open = smooth(-28, 38, seaward);
    let sea = open;
    let harbour = 0;
    for (const inlet of src.inlets) {
      const e = ellipse(x, z, inlet);
      if (e > -0.4) {
        const w = smooth(-0.12, 0.3, e);
        harbour = Math.max(harbour, w);
        sea = Math.max(sea, w);
      }
    }
    const seaOpen = sea;
    let built = 0;
    let top = 0;
    for (const mole of src.moles) {
      const e = ellipse(x, z, mole);
      if (e > -0.3) {
        const w = smooth(-0.05, 0.25, e);
        if (w > built) top = mole.height;
        built = Math.max(built, w);
        sea = Math.min(sea, 1 - w);
        h = lerp(h, mole.height, w);
      }
    }
    if (sea <= 0) return h;
    // Where built land stands in what would be water it ends in a quay: the apron runs level to the
    // wall line (see `quay`), and the bottom is dredged to working depth right up to it.
    const walled = built > 0.3 ? smooth(0.45, 0.75, seaOpen) : 0;
    // Harbours and reclaimed land: the ground eases to the waterline, then drops away to working depth.
    const quay = lerp(h, lerp(1.2, -14, smooth(0.3, 1, sea)), smooth(0, 0.55, sea));
    // The open coast is a proper strand instead: bank, dry sand, swash, and a shelf you can wade out on.
    const beach = smooth(0, 0.12, open - harbour) * (1 - smooth(0, 0.2, built));
    const shore = beach <= 0 ? quay : lerp(quay, strand(seaward, h), beach);
    if (walled <= 0) return shore;
    const stand = smooth(QUAY_LINE, QUAY_LINE + 0.1, built);
    return lerp(shore, lerp(Math.min(shore, -6.5), top, stand), walled);
  }

  /**
   * Quays. Positive on the apron of a mole, wharf or reclamation, negative in the water off it; the quay
   * wall stands along zero. `top` is the height of the apron. Null away from any built land, or where
   * that land meets the natural shore rather than the water.
   */
  quay(x: number, z: number): { edge: number; top: number } | null {
    let built = 0;
    let top = 0;
    for (const mole of this.src.moles) {
      const e = ellipse(x, z, mole);
      if (e <= -0.3) continue;
      const w = smooth(-0.05, 0.25, e);
      if (w > built) {
        built = w;
        top = mole.height;
      }
    }
    return built > 0.05 ? { edge: built - QUAY_LINE, top } : null;
  }

  private riverAt(x: number, z: number): RiverHit | null {
    const list = this.riverCells.get(packCell(Math.floor(x / this.RC), Math.floor(z / this.RC)));
    if (!list) return null;
    let best: RiverHit | null = null;
    for (const { river, i } of list) {
      const a = river.samples[i];
      const b = river.samples[Math.min(river.samples.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < river.width * 0.5 + 30 && (!best || d - river.width * 0.5 < best.d - best.river.width * 0.5)) {
        const lateral = (x - px) * a.tz - (z - pz) * a.tx;
        best = { river, d, s: lerp(a.s, b.s, t), y: lerp(a.y, b.y, t), lateral };
      }
    }
    return best;
  }

  /** Height after carving rivers (no roads), plus river info for surfaces / water. */
  private carved(x: number, z: number): { h: number; bed: number; water: number } {
    const h = this.natural(x, z);
    const r = this.riverAt(x, z);
    if (!r) return { h, bed: 0, water: -Infinity };
    const half = r.river.width * 0.5;
    const bed = smooth(half + 14, half - 4, r.d);
    if (bed <= 0) return { h, bed: 0, water: -Infinity };
    const waterY = r.y - r.river.depth;
    let floor: number;
    if (r.river.braided) {
      // Shingle bed a little above the water, with meandering channels cut below it.
      const n = fbm(r.s * 0.004 + r.lateral * 0.03, r.lateral * 0.012 - r.s * 0.0015, 3);
      const channel = smooth(0.1, 0.02, Math.abs(n - 0.5)) * smooth(half, half * 0.75, r.d);
      floor = waterY + 0.45 - channel * 1.5;
    } else {
      floor = waterY - 1.1 * smooth(half, half * 0.3, r.d) - 0.2;
    }
    return { h: lerp(h, Math.min(h, floor), bed), bed, water: waterY };
  }

  private roadBlend(hit: RoadHit): number {
    const e = hit.edge;
    const half = e.width / 2 + (e.footpaths ? 3.2 : 1.2);
    const margin = e.tunnel ? 5 : e.footpaths ? 7 : e.cls === 'highway' ? 16 : 11;
    return smooth(half + margin, half, hit.distance);
  }

  /** Final ground height. */
  height(x: number, z: number): number {
    const c = this.carved(x, z);
    if (!this.graph) return c.h;
    const hit = this.graph.nearest(x, z, 40, (e) => !e.bridge);
    if (!hit) return c.h;
    const w = this.roadBlend(hit);
    const h = w <= 0 ? c.h : lerp(c.h, hit.y, w);
    if (hit.edge.tunnel) return h;
    // A road crossing high over a tunnel (Summit Road over the Lyttelton bore) runs on the cover
    // (`TerrainModel.cover`); the cutting under it stays open instead of filling back up to that road.
    const bore = this.boreBelow(x, z, h);
    return bore ? lerp(h, bore.y, this.roadBlend(bore)) : h;
  }

  /** The tunnel whose cutting runs well below `top` here, if any. */
  private boreBelow(x: number, z: number, top: number): RoadHit | null {
    if (!this.graph || !this.bores.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return null;
    const bore = this.graph.nearest(x, z, 20, (e) => e.tunnel);
    return bore && top - bore.y > 7 && this.roadBlend(bore) > 0 ? bore : null;
  }

  /**
   * The surface over a tunnel's covered cutting: the hill, and any road crossing it, as they would be with
   * no tunnel underneath. Where there is no tunnel this is just `height`.
   */
  cover(x: number, z: number): number {
    const c = this.carved(x, z);
    if (!this.graph) return c.h;
    const hit = this.graph.nearest(x, z, 40, (e) => !e.bridge && !e.tunnel);
    if (!hit) return c.h;
    const w = this.roadBlend(hit);
    return w <= 0 ? c.h : lerp(c.h, hit.y, w);
  }

  /** Water surface height at a point, or -Infinity if there is none. Sea, harbour and rivers. */
  waterSurface(x: number, z: number): number {
    const c = this.carved(x, z);
    return Math.max(c.bed > 0.5 ? c.water : -Infinity, c.h < SEA_LEVEL ? SEA_LEVEL : -Infinity);
  }

  waterDepth(x: number, z: number): number {
    const ground = this.height(x, z);
    const c = this.carved(x, z);
    const surface = Math.max(c.bed > 0.5 ? c.water : -Infinity, SEA_LEVEL);
    return Math.max(0, surface - ground);
  }

  surface(x: number, z: number): GroundSurface {
    if (this.graph) {
      const hit = this.graph.nearest(x, z, 24);
      if (hit) {
        const half = hit.edge.width / 2;
        if (hit.distance <= half) return hit.edge.cls === 'gravel' ? 'gravel' : hit.edge.cls === 'pedestrian' ? 'paving' : 'road';
        if (hit.edge.footpaths && hit.distance <= half + 3) return 'footpath';
      }
    }
    const c = this.carved(x, z);
    if (c.h < SEA_LEVEL - 0.05) return 'water';
    if (c.bed > 0.5) return c.h < c.water ? 'water' : 'shingle';
    if (c.h < 2.3) return 'sand';
    return 'grass';
  }
}
