import type { CityId, District, DistrictType, RailLine, RoadClass, RoadEdge } from '../core/types';
import { cityName, cityTeReo, featureTeReo } from './format';
import { simplifyPolyline } from './mapmath';

/**
 * Everything the minimap and the island map draw from, gathered once from the world:
 *  - the road and rail network as simplified polylines, binned into square tiles;
 *  - a coarse "land use" grid (water, parks, built-up areas), surveyed lazily in time-sliced chunks;
 *  - label positions for towns and suburbs, found from the same survey.
 * No DOM in here (rendering lives in maprender.ts), so the survey is unit-testable.
 */

/** Size of one land-use cell in metres. */
export const CELL_M = 16;
/** The first pass samples every COARSE-th cell so the whole island has rough colour within a second or two. */
const COARSE = 8;
/** The second pass refines square blocks of this many cells, nearest to the player first. */
const BLOCK = 32;
/** Road tiles are this many metres square. */
export const TILE_M = 512;

export const T_LAND = 0;
export const T_WATER = 1;
export const T_PARK = 2;
export const T_BEACH = 3;
export const T_TOWN = 4;
export const T_SUBURB = 5;
export const T_INDUSTRY = 6;
export const TERRAIN_KINDS = 7;

/**
 * A grid cell packs its land-use code (low three bits) with how much of the cell is water, in quarters
 * (0..4, next three bits). Narrow rivers cover only part of a cell; drawing that as a tint keeps them a
 * continuous ribbon instead of a row of dashes.
 */
export const WATER_FULL = 4;
export const CELL_VALUES = (WATER_FULL << 3) + TERRAIN_KINDS;
export const terrainOf = (cell: number) => cell & 7;
export const waterOf = (cell: number) => cell >> 3;
const ALL_WATER = T_WATER | (WATER_FULL << 3);

/** Draw order: minor roads first so main roads sit on top. A road's `cls` is an index into this. */
export const ROAD_ORDER: readonly RoadClass[] = ['pedestrian', 'gravel', 'lane', 'street', 'arterial', 'highway'];

const TERRAIN_OF: Record<DistrictType, number> = {
  cbd: T_TOWN,
  shops: T_TOWN,
  township: T_TOWN,
  villa: T_SUBURB,
  statehouse: T_SUBURB,
  industrial: T_INDUSTRY,
  port: T_INDUSTRY,
  park: T_PARK,
  beach: T_BEACH,
  rural: T_LAND,
};

export interface MapRoad {
  /** Index into ROAD_ORDER. */
  cls: number;
  tunnel: boolean;
  /** Flat [x0, z0, x1, z1, …]. */
  pts: Float32Array;
}

export interface MapRail {
  kind: RailLine['kind'];
  pts: Float32Array;
}

export interface MapLabel {
  name: string;
  /** Te reo Māori name shown with it ('' if none). */
  teReo: string;
  x: number;
  z: number;
  /** Rough extent in metres (square root of the area), used to decide when the label is worth showing. */
  size: number;
  kind: 'city' | 'district';
  rural: boolean;
}

/** The slice of WorldApi the map needs (so tests can pass a fake). */
export interface MapWorld {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  graph: { edges: RoadEdge[] };
  railways: RailLine[];
  waterDepthAt(x: number, z: number): number;
  districtAt(x: number, z: number): District;
}

interface Tally {
  name: string;
  teReo: string;
  city: CityId | null;
  rural: boolean;
  sx: number;
  sz: number;
  n: number;
}

const WATER_DEPTH = 0.12;

export class MapData {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** Land-use grid, row-major by z, one byte per cell (see `terrainOf` / `waterOf`). */
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;
  readonly tilesX: number;
  readonly tilesZ: number;

  roads: MapRoad[] = [];
  rails: MapRail[] = [];
  labels: MapLabel[] = [];
  /** Bumps whenever `labels` is rebuilt. */
  labelVersion = 0;
  /** Bumps whenever any cell changes. */
  cellVersion = 0;
  /** Survey progress, 0..1. */
  progress = 0;
  done = false;
  /** Called with a cell rectangle [c0, c1) × [r0, r1) whenever part of the grid has new values. */
  onCells: ((c0: number, r0: number, c1: number, r1: number) => void) | null = null;

  private tileRoads = new Map<number, number[]>();
  private tileRails = new Map<number, number[]>();
  private networkBuilt = false;

  // Survey state.
  private phase: 0 | 1 | 2 = 0;
  private coarseCols: number;
  private coarseRows: number;
  private coarseAt = 0;
  private blockCols: number;
  private blockRows: number;
  private blockDone: Uint8Array;
  private blocksLeft: number;
  private block = -1;
  private blockCell = 0;
  private tallies = new Map<string, Tally>();
  private lastDistrict: District | null = null;
  private lastTally: Tally | null = null;

  constructor(private world: MapWorld) {
    const b = world.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.maxX = b.maxX;
    this.maxZ = b.maxZ;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL_M));
    this.rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL_M));
    this.cells = new Uint8Array(this.cols * this.rows);
    this.tilesX = Math.max(1, Math.ceil((b.maxX - b.minX) / TILE_M));
    this.tilesZ = Math.max(1, Math.ceil((b.maxZ - b.minZ) / TILE_M));
    this.coarseCols = Math.ceil(this.cols / COARSE);
    this.coarseRows = Math.ceil(this.rows / COARSE);
    this.blockCols = Math.ceil(this.cols / BLOCK);
    this.blockRows = Math.ceil(this.rows / BLOCK);
    this.blockDone = new Uint8Array(this.blockCols * this.blockRows);
    this.blocksLeft = this.blockDone.length;
  }

  // ───────────── Roads and rails ─────────────

  /** Simplifies every road and railway and bins them into tiles. A few milliseconds, once. */
  buildNetwork() {
    if (this.networkBuilt) return;
    this.networkBuilt = true;
    let scratch = new Float32Array(1024);
    const flatten = (count: number, read: (i: number, out: Float32Array, o: number) => void) => {
      if (scratch.length < count * 2) scratch = new Float32Array(count * 2 + 256);
      for (let i = 0; i < count; i++) read(i, scratch, i * 2);
      return scratch.subarray(0, count * 2);
    };

    for (const edge of this.world.graph.edges) {
      const samples = edge.samples;
      if (!samples || samples.length < 2) continue;
      const cls = ROAD_ORDER.indexOf(edge.cls);
      const flat = flatten(samples.length, (i, out, o) => {
        out[o] = samples[i].x;
        out[o + 1] = samples[i].z;
      });
      const pts = simplifyPolyline(flat, 0.6);
      this.bin(this.tileRoads, this.roads.length, pts, 16);
      this.roads.push({ cls: cls < 0 ? ROAD_ORDER.indexOf('street') : cls, tunnel: !!edge.tunnel, pts });
    }

    for (const line of this.world.railways) {
      const points = line.points;
      if (!points || points.length < 2) continue;
      const flat = flatten(points.length, (i, out, o) => {
        out[o] = points[i].x;
        out[o + 1] = points[i].z;
      });
      const pts = simplifyPolyline(flat, 0.5);
      this.bin(this.tileRails, this.rails.length, pts, 10);
      this.rails.push({ kind: line.kind, pts });
    }
  }

  private bin(target: Map<number, number[]>, index: number, pts: Float32Array, margin: number) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = Math.min(pts[i], pts[i + 2]) - margin;
      const x1 = Math.max(pts[i], pts[i + 2]) + margin;
      const z0 = Math.min(pts[i + 1], pts[i + 3]) - margin;
      const z1 = Math.max(pts[i + 1], pts[i + 3]) + margin;
      const tx0 = Math.max(0, Math.floor((x0 - this.minX) / TILE_M));
      const tx1 = Math.min(this.tilesX - 1, Math.floor((x1 - this.minX) / TILE_M));
      const tz0 = Math.max(0, Math.floor((z0 - this.minZ) / TILE_M));
      const tz1 = Math.min(this.tilesZ - 1, Math.floor((z1 - this.minZ) / TILE_M));
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = tz * this.tilesX + tx;
          let list = target.get(key);
          if (!list) target.set(key, (list = []));
          if (list[list.length - 1] !== index) list.push(index);
        }
      }
    }
  }

  tileKey(tx: number, tz: number): number {
    return tz * this.tilesX + tx;
  }

  /** Indices into `roads` for everything that touches a tile (undefined if nothing does). */
  roadsInTile(tx: number, tz: number): readonly number[] | undefined {
    return this.tileRoads.get(tz * this.tilesX + tx);
  }

  railsInTile(tx: number, tz: number): readonly number[] | undefined {
    return this.tileRails.get(tz * this.tilesX + tx);
  }

  // ───────────── Land-use survey ─────────────

  /** Land-use code for a dry point; also counts it towards its district's label position. */
  private land(x: number, z: number, weight: number): number {
    const d = this.world.districtAt(x, z);
    let tally = this.lastTally;
    if (d !== this.lastDistrict || !tally) {
      const key = `${d.name}|${d.city ?? ''}`;
      tally = this.tallies.get(key) ?? null;
      if (!tally) {
        tally = { name: d.name, teReo: d.teReo ?? '', city: d.city, rural: d.type === 'rural', sx: 0, sz: 0, n: 0 };
        this.tallies.set(key, tally);
      }
      this.lastDistrict = d;
      this.lastTally = tally;
    }
    tally.sx += x * weight;
    tally.sz += z * weight;
    tally.n += weight;
    return TERRAIN_OF[d.type] ?? T_LAND;
  }

  /**
   * Does up to `budgetMs` of surveying. Pass 1 covers the island coarsely; pass 2 refines block by block,
   * always taking the unfinished block nearest (focusX, focusZ). Returns true while there is more to do.
   */
  survey(budgetMs: number, focusX: number, focusZ: number): boolean {
    if (this.phase === 2) return false;
    const deadline = performance.now() + budgetMs;
    const { cols, rows, cells } = this;

    if (this.phase === 0) {
      const total = this.coarseCols * this.coarseRows;
      const firstRow = Math.floor(this.coarseAt / this.coarseCols);
      let checked = 0;
      while (this.coarseAt < total) {
        const ci = this.coarseAt % this.coarseCols;
        const cj = (this.coarseAt - ci) / this.coarseCols;
        const c0 = ci * COARSE;
        const r0 = cj * COARSE;
        const c1 = Math.min(cols, c0 + COARSE);
        const r1 = Math.min(rows, r0 + COARSE);
        const x = this.minX + (c0 + c1) * 0.5 * CELL_M;
        const z = this.minZ + (r0 + r1) * 0.5 * CELL_M;
        const value = this.world.waterDepthAt(x, z) > WATER_DEPTH ? ALL_WATER : this.land(x, z, COARSE * COARSE);
        for (let r = r0; r < r1; r++) cells.fill(value, r * cols + c0, r * cols + c1);
        this.coarseAt++;
        if ((++checked & 7) === 0 && performance.now() >= deadline) break;
      }
      const lastRow = Math.min(this.coarseRows, Math.ceil(this.coarseAt / this.coarseCols));
      this.cellVersion++;
      this.onCells?.(0, firstRow * COARSE, cols, Math.min(rows, lastRow * COARSE));
      this.progress = (this.coarseAt / total) * 0.1;
      if (this.coarseAt >= total) {
        this.phase = 1;
        this.rebuildLabels();
        this.tallies.clear();
        this.lastDistrict = this.lastTally = null;
      }
      return true;
    }

    const world = this.world;
    const q = CELL_M * 0.25;
    let checked = 0;
    for (;;) {
      if (this.block < 0) {
        this.block = this.nearestBlock(focusX, focusZ);
        this.blockCell = 0;
        if (this.block < 0) {
          this.phase = 2;
          this.done = true;
          this.progress = 1;
          this.rebuildLabels();
          this.tallies.clear();
          this.lastDistrict = this.lastTally = null;
          return false;
        }
      }
      const bi = this.block % this.blockCols;
      const bj = (this.block - bi) / this.blockCols;
      const c0 = bi * BLOCK;
      const r0 = bj * BLOCK;
      const c1 = Math.min(cols, c0 + BLOCK);
      const r1 = Math.min(rows, r0 + BLOCK);
      const w = c1 - c0;
      const count = w * (r1 - r0);
      let out = false;
      while (this.blockCell < count) {
        const c = c0 + (this.blockCell % w);
        const r = r0 + Math.floor(this.blockCell / w);
        const x = this.minX + (c + 0.5) * CELL_M;
        const z = this.minZ + (r + 0.5) * CELL_M;
        // Four samples per cell for water, so a river narrower than a cell still registers.
        let wet = 0;
        if (world.waterDepthAt(x - q, z - q) > WATER_DEPTH) wet++;
        if (world.waterDepthAt(x + q, z - q) > WATER_DEPTH) wet++;
        if (world.waterDepthAt(x - q, z + q) > WATER_DEPTH) wet++;
        if (world.waterDepthAt(x + q, z + q) > WATER_DEPTH) wet++;
        cells[r * cols + c] = wet === WATER_FULL ? ALL_WATER : this.land(x, z, 1) | (wet << 3);
        this.blockCell++;
        if ((++checked & 7) === 0 && performance.now() >= deadline) {
          out = true;
          break;
        }
      }
      if (this.blockCell >= count) {
        this.blockDone[this.block] = 1;
        this.blocksLeft--;
        this.block = -1;
        this.cellVersion++;
        this.progress = 0.1 + 0.9 * (1 - this.blocksLeft / this.blockDone.length);
        this.onCells?.(c0, r0, c1, r1);
      }
      if (out || performance.now() >= deadline) return true;
    }
  }

  private nearestBlock(x: number, z: number): number {
    if (this.blocksLeft <= 0) return -1;
    const fx = (x - this.minX) / (CELL_M * BLOCK) - 0.5;
    const fz = (z - this.minZ) / (CELL_M * BLOCK) - 0.5;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < this.blockRows; j++) {
      for (let i = 0; i < this.blockCols; i++) {
        const k = j * this.blockCols + i;
        if (this.blockDone[k]) continue;
        const d = (i - fx) * (i - fx) + (j - fz) * (j - fz);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    return best;
  }

  private rebuildLabels() {
    const cellArea = CELL_M * CELL_M;
    const labels: MapLabel[] = [];
    const cities = new Map<CityId, Tally>();
    for (const t of this.tallies.values()) {
      if (t.n <= 0) continue;
      if (t.city) {
        let c = cities.get(t.city);
        if (!c) cities.set(t.city, (c = { name: cityName(t.city), teReo: cityTeReo(t.city), city: t.city, rural: false, sx: 0, sz: 0, n: 0 }));
        c.sx += t.sx;
        c.sz += t.sz;
        c.n += t.n;
      }
    }
    const cityNames = new Set<string>();
    for (const c of cities.values()) {
      cityNames.add(c.name);
      labels.push({ name: c.name, teReo: c.teReo, x: c.sx / c.n, z: c.sz / c.n, size: Math.sqrt(c.n * cellArea), kind: 'city', rural: false });
    }
    for (const t of this.tallies.values()) {
      if (t.n <= 0 || !t.name || cityNames.has(t.name)) continue;
      labels.push({ name: t.name, teReo: featureTeReo(t.name, t.teReo), x: t.sx / t.n, z: t.sz / t.n, size: Math.sqrt(t.n * cellArea), kind: 'district', rural: t.rural });
    }
    // Towns first, then the biggest suburbs: this is also the priority order when labels collide.
    labels.sort((a, b) => (a.kind === b.kind ? b.size - a.size : a.kind === 'city' ? -1 : 1));
    this.labels = labels;
    this.labelVersion++;
  }
}
