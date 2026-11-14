import { CELL_M, CELL_VALUES, ROAD_ORDER, T_BEACH, T_INDUSTRY, T_LAND, T_PARK, T_SUBURB, T_TOWN, T_WATER, TERRAIN_KINDS, terrainOf, TILE_M, WATER_FULL, waterOf, type MapData, type MapRail, type MapRoad } from './mapdata';

/**
 * Canvas rendering shared by the minimap and the island map: colour schemes, the land-use raster, and the
 * cache of pre-rendered road tiles.
 */

export interface RoadStyle {
  color: string;
  /** Drawn width in metres. */
  width: number;
  /** Never thinner than this many pixels on the island map. */
  minPx: number;
  /** Dash pattern in metres (unbroken if absent). */
  dash?: number[];
}

export interface MapPalette {
  /** RGB per T_* land-use code. */
  terrain: [number, number, number][];
  casing: string;
  /** Indexed like ROAD_ORDER. */
  roads: RoadStyle[];
  railBed: string;
  railTie: string;
  tram: string;
}

function terrainTable(colors: Record<number, [number, number, number]>): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < TERRAIN_KINDS; i++) out.push(colors[i] ?? colors[T_LAND]);
  return out;
}

function roadTable(styles: Record<string, RoadStyle>): RoadStyle[] {
  return ROAD_ORDER.map((cls) => styles[cls]);
}

/** Motorway-sign colours for the minimap: white roads on green, the highway in fingerpost yellow. */
export const SIGN_PALETTE: MapPalette = {
  terrain: terrainTable({
    [T_LAND]: [21, 107, 67],
    [T_WATER]: [20, 54, 92],
    [T_PARK]: [62, 146, 74],
    [T_BEACH]: [178, 162, 104],
    [T_TOWN]: [30, 88, 68],
    [T_SUBURB]: [25, 99, 66],
    [T_INDUSTRY]: [36, 86, 76],
  }),
  casing: '#083a27',
  roads: roadTable({
    pedestrian: { color: '#a6dcc2', width: 7, minPx: 1 },
    gravel: { color: '#dccb96', width: 6, minPx: 1, dash: [11, 8] },
    lane: { color: '#cfe4d9', width: 5.5, minPx: 1 },
    street: { color: '#f3f7f4', width: 9, minPx: 1.2 },
    arterial: { color: '#ffffff', width: 15, minPx: 2.2 },
    highway: { color: '#f4c417', width: 14, minPx: 3 },
  }),
  railBed: '#062a1c',
  railTie: '#e9efe9',
  tram: '#ffe9a8',
};

/** Road-atlas colours for the island map: cream paper, red highways, orange main roads. */
export const ATLAS_PALETTE: MapPalette = {
  terrain: terrainTable({
    [T_LAND]: [236, 227, 200],
    [T_WATER]: [166, 204, 224],
    [T_PARK]: [188, 214, 160],
    [T_BEACH]: [242, 226, 172],
    [T_TOWN]: [224, 202, 168],
    [T_SUBURB]: [232, 215, 186],
    [T_INDUSTRY]: [214, 205, 190],
  }),
  casing: '#6f6753',
  roads: roadTable({
    pedestrian: { color: '#d7c7a6', width: 6, minPx: 0.8, dash: [3, 5] },
    gravel: { color: '#b3956a', width: 5, minPx: 0.8, dash: [11, 8] },
    lane: { color: '#ffffff', width: 5, minPx: 0.8 },
    street: { color: '#ffffff', width: 9, minPx: 1.1 },
    arterial: { color: '#f0b040', width: 15, minPx: 2.2 },
    highway: { color: '#c8402f', width: 14, minPx: 3 },
  }),
  railBed: '#2a2d33',
  railTie: '#f4eedd',
  tram: '#7a5a3a',
};

export function landColor(palette: MapPalette): string {
  const [r, g, b] = palette.terrain[T_LAND];
  return `rgb(${r},${g},${b})`;
}

/** The land-use grid as an image, one pixel per cell, kept up to date as the survey proceeds. */
export class MapRaster {
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private lut: Uint8Array;

  constructor(
    private data: MapData,
    palette: MapPalette,
  ) {
    this.canvas.width = data.cols;
    this.canvas.height = data.rows;
    this.g = this.canvas.getContext('2d');
    // One colour per possible cell value: the land-use colour mixed towards water by the cell's water share.
    this.lut = new Uint8Array(CELL_VALUES * 3);
    const water = palette.terrain[T_WATER];
    for (let cell = 0; cell < CELL_VALUES; cell++) {
      const base = palette.terrain[Math.min(TERRAIN_KINDS - 1, terrainOf(cell))];
      const t = Math.min(1, waterOf(cell) / WATER_FULL);
      for (let k = 0; k < 3; k++) this.lut[cell * 3 + k] = Math.round(base[k] + (water[k] - base[k]) * t);
    }
    if (this.g) {
      this.image = this.g.createImageData(data.cols, data.rows);
      this.paint(0, 0, data.cols, data.rows);
    }
  }

  /** Repaints a cell rectangle [c0, c1) × [r0, r1) from the survey data. */
  paint(c0: number, r0: number, c1: number, r1: number) {
    const { g, image, lut } = this;
    if (!g || !image || c1 <= c0 || r1 <= r0) return;
    const { cols, cells } = this.data;
    const px = image.data;
    for (let r = r0; r < r1; r++) {
      let i = r * cols + c0;
      let o = i * 4;
      for (let c = c0; c < c1; c++, i++, o += 4) {
        const k = cells[i] * 3;
        px[o] = lut[k];
        px[o + 1] = lut[k + 1];
        px[o + 2] = lut[k + 2];
        px[o + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0, c0, r0, c1 - c0, r1 - r0);
  }

  /**
   * Draws the part of the raster covering a world rectangle. The context's transform must already map
   * world metres to pixels.
   */
  draw(g: CanvasRenderingContext2D, minX: number, minZ: number, maxX: number, maxZ: number) {
    const d = this.data;
    const c0 = Math.max(0, Math.floor((minX - d.minX) / CELL_M) - 1);
    const r0 = Math.max(0, Math.floor((minZ - d.minZ) / CELL_M) - 1);
    const c1 = Math.min(d.cols, Math.ceil((maxX - d.minX) / CELL_M) + 1);
    const r1 = Math.min(d.rows, Math.ceil((maxZ - d.minZ) / CELL_M) + 1);
    if (c1 <= c0 || r1 <= r0) return;
    g.drawImage(this.canvas, c0, r0, c1 - c0, r1 - r0, d.minX + c0 * CELL_M, d.minZ + r0 * CELL_M, (c1 - c0) * CELL_M, (r1 - r0) * CELL_M);
  }
}

function trace(g: CanvasRenderingContext2D | Path2D, pts: Float32Array) {
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
}

/** Metres of overlap drawn round each tile so neighbouring tiles meet without a seam. */
export const TILE_PAD = 6;
const CASING_M = 3.2;

interface Tile {
  canvas: HTMLCanvasElement;
  used: number;
}

/**
 * Road and rail tiles pre-rendered at a fixed scale. The minimap blits whichever tiles are under its window;
 * a tile is drawn the first time it is needed (well under a millisecond each) and kept in a small LRU cache.
 */
export class RoadTiles {
  /** Pixels per metre. */
  scale = 1;
  private tiles = new Map<number, Tile>();
  private spare: HTMLCanvasElement[] = [];
  private px = 0;

  constructor(
    private data: MapData,
    private palette: MapPalette,
    private maxTiles = 14,
  ) {
    this.setScale(1);
  }

  /** Changes the tile resolution, dropping everything rendered so far. */
  setScale(scale: number) {
    const px = Math.ceil((TILE_M + TILE_PAD * 2) * scale);
    if (px === this.px) return;
    this.px = px;
    this.scale = px / (TILE_M + TILE_PAD * 2);
    this.tiles.clear();
    this.spare.length = 0;
  }

  /** The tile's canvas, null if the tile is empty, or undefined if it has not been rendered yet. */
  get(tx: number, tz: number, frame: number): HTMLCanvasElement | null | undefined {
    const tile = this.tiles.get(this.data.tileKey(tx, tz));
    if (tile) {
      tile.used = frame;
      return tile.canvas;
    }
    // Tiles with nothing in them are never cached: they would only push real tiles out of the cache.
    if (!this.data.roadsInTile(tx, tz) && !this.data.railsInTile(tx, tz)) return null;
    return undefined;
  }

  /** Renders one tile into the cache and returns its canvas (null if it is empty). */
  build(tx: number, tz: number, frame: number): HTMLCanvasElement | null {
    const { data } = this;
    const key = data.tileKey(tx, tz);
    const roads = data.roadsInTile(tx, tz);
    const rails = data.railsInTile(tx, tz);
    if (!roads && !rails) return null;
    if (this.tiles.size >= this.maxTiles) this.evict();
    const canvas = this.spare.pop() ?? document.createElement('canvas');
    if (canvas.width !== this.px) canvas.width = canvas.height = this.px;
    const g = canvas.getContext('2d');
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.px, this.px);
      const s = this.scale;
      g.setTransform(s, 0, 0, s, -(data.minX + tx * TILE_M - TILE_PAD) * s, -(data.minZ + tz * TILE_M - TILE_PAD) * s);
      if (rails) strokeRails(g, this.palette, data.rails, rails, 1 / s);
      if (roads) strokeRoads(g, this.palette, data.roads, roads, 1 / s, true);
    }
    this.tiles.set(key, { canvas, used: frame });
    return canvas;
  }

  private evict() {
    let oldestKey = -1;
    let oldest = Infinity;
    for (const [key, tile] of this.tiles) {
      if (tile.used < oldest) {
        oldest = tile.used;
        oldestKey = key;
      }
    }
    if (oldestKey < 0) return;
    const tile = this.tiles.get(oldestKey);
    if (tile) this.spare.push(tile.canvas);
    this.tiles.delete(oldestKey);
  }
}

/**
 * Strokes a set of roads (indices into `all`) with the context transformed to world metres. `pxM` is the size
 * of one pixel in metres, used to keep thin roads visible. Casings go down first so junctions merge cleanly.
 */
export function strokeRoads(g: CanvasRenderingContext2D, palette: MapPalette, all: readonly MapRoad[], indices: readonly number[], pxM: number, casing: boolean) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.setLineDash([]);
  const classes = ROAD_ORDER.length;
  // Tunnels: a faint dashed line under everything else.
  let any = false;
  g.beginPath();
  for (let k = 0; k < indices.length; k++) {
    const road = all[indices[k]];
    if (!road.tunnel) continue;
    trace(g, road.pts);
    any = true;
  }
  if (any) {
    g.globalAlpha = 0.55;
    g.strokeStyle = palette.roads[classes - 3].color;
    g.lineWidth = Math.max(7, 2 * pxM);
    g.setLineDash([14, 12]);
    g.lineCap = 'butt';
    g.stroke();
    g.setLineDash([]);
    g.lineCap = 'round';
    g.globalAlpha = 1;
  }
  for (let pass = casing ? 0 : 1; pass < 2; pass++) {
    for (let cls = 0; cls < classes; cls++) {
      const style = palette.roads[cls];
      any = false;
      g.beginPath();
      for (let k = 0; k < indices.length; k++) {
        const road = all[indices[k]];
        if (road.cls !== cls || road.tunnel) continue;
        trace(g, road.pts);
        any = true;
      }
      if (!any) continue;
      const width = Math.max(style.width, style.minPx * pxM);
      if (pass === 0) {
        g.strokeStyle = palette.casing;
        g.lineWidth = width + Math.max(CASING_M, 2 * pxM);
        g.stroke();
      } else {
        g.strokeStyle = style.color;
        g.lineWidth = width;
        if (style.dash) {
          g.setLineDash(style.dash);
          g.lineCap = 'butt';
        }
        g.stroke();
        if (style.dash) {
          g.setLineDash([]);
          g.lineCap = 'round';
        }
      }
    }
  }
}

/** Railways: a dark bed with pale sleeper dashes; tram lines as a thin single line. */
export function strokeRails(g: CanvasRenderingContext2D, palette: MapPalette, all: readonly MapRail[], indices: readonly number[], pxM: number) {
  g.lineJoin = 'round';
  g.lineCap = 'butt';
  let heavy = false;
  let tram = false;
  g.beginPath();
  for (let k = 0; k < indices.length; k++) {
    const rail = all[indices[k]];
    if (rail.kind === 'tram') {
      tram = true;
      continue;
    }
    trace(g, rail.pts);
    heavy = true;
  }
  if (heavy) {
    const width = Math.max(5, 2.4 * pxM);
    g.setLineDash([]);
    g.strokeStyle = palette.railBed;
    g.lineWidth = width;
    g.stroke();
    g.strokeStyle = palette.railTie;
    g.lineWidth = width * 0.5;
    g.setLineDash([9, 9]);
    g.stroke();
    g.setLineDash([]);
  }
  if (tram) {
    g.beginPath();
    for (let k = 0; k < indices.length; k++) {
      const rail = all[indices[k]];
      if (rail.kind === 'tram') trace(g, rail.pts);
    }
    g.strokeStyle = palette.tram;
    g.lineWidth = Math.max(2, 1.2 * pxM);
    g.stroke();
  }
}

/** Every road of the island as one Path2D per class (plus tunnels), for the island map. */
export interface NetworkPaths {
  roads: Path2D[];
  tunnels: Path2D;
  rails: Path2D;
  trams: Path2D;
}

export function buildNetworkPaths(data: MapData): NetworkPaths {
  const roads = ROAD_ORDER.map(() => new Path2D());
  const tunnels = new Path2D();
  const rails = new Path2D();
  const trams = new Path2D();
  for (const road of data.roads) trace(road.tunnel ? tunnels : roads[road.cls], road.pts);
  for (const rail of data.rails) trace(rail.kind === 'tram' ? trams : rails, rail.pts);
  return { roads, tunnels, rails, trams };
}
