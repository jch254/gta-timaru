import type { CityId, DistrictType, LandmarkPlacement, Place, RoadClass } from '../core/types';

/**
 * Authoring format for the map. `world/mapdata/*` fills a MapBuilder; `world/map.ts` compiles it
 * into the road graph, districts and terrain features used at runtime.
 *
 * Coordinates: metres, +x east, -z north. Points are [x, z].
 */
export type Pt = [x: number, z: number];

export interface RoadOptions {
  /** Traffic flows only in the direction the points are listed. */
  oneway?: boolean;
  /** Elevated deck: terrain is NOT flattened underneath (rivers flow under). End points must sit on the banks. */
  bridge?: boolean;
  /** Bored through a hill: a covered cutting. */
  tunnel?: boolean;
  /** Override the class default (urban classes have footpaths). */
  footpaths?: boolean;
  /** Speed limit in km/h. */
  speed?: number;
  /** Lanes per direction. */
  lanes?: number;
  /** Carriageway width in metres. */
  width?: number;
  /** Fit a smooth curve through the points (use for winding rural / hill roads). Default false = straight segments. */
  smooth?: boolean;
}

export interface RoadSource extends RoadOptions {
  name: string;
  cls: RoadClass;
  pts: Pt[];
}

export interface RailSource {
  name: string;
  pts: Pt[];
  /** 'main' = Main South Line (ballast, sleepers), 'tram' = street tram track set into the road. */
  kind: 'main' | 'tram' | 'siding';
  bridge?: boolean;
}

export interface RiverSource {
  name: string;
  pts: Pt[];
  /** Full bed width in metres. */
  width: number;
  /** Braided shingle bed with several channels (Rakaia, Rangitata) rather than one stream (Avon). */
  braided?: boolean;
  /** How far the water surface sits below the banks. */
  depth?: number;
}

export type Shape =
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'poly'; pts: Pt[] };

export interface DistrictSource {
  id: string;
  name: string;
  city: CityId | null;
  type: DistrictType;
  shape: Shape;
  /** Higher wins where districts overlap (default 0). */
  priority?: number;
  /** Te reo Māori name where one is well attested. */
  teReo?: string;
}

export interface TerrainSource {
  /**
   * East coast as [z, x] pairs sorted by z (north → south): the x of the shoreline at each z.
   * Everything east of it is sea.
   */
  coast: [z: number, x: number][];
  /** Sea cut into the land (harbours, bays): rotated ellipses. */
  inlets: { name: string; x: number; z: number; rx: number; rz: number; rot?: number }[];
  /** Land pushed out into the sea (reclamation, breakwaters, spits): rotated ellipses with a height. */
  moles: { name: string; x: number; z: number; rx: number; rz: number; rot?: number; height: number }[];
  /** Hill ridges along a polyline: `height` at the crest falling to zero `width` metres either side. */
  ridges: { name: string; pts: Pt[]; height: number; width: number; rough?: number }[];
  /** Rolling downs: noise hills of `amp` metres inside a radius. */
  downs: { name: string; x: number; z: number; r: number; amp: number; wavelength?: number }[];
  /** Areas forced (nearly) flat at a given height, e.g. a city on a plain. */
  flats: { name: string; x: number; z: number; r: number; height: number }[];
}

export interface MapSource {
  roads: RoadSource[];
  rails: RailSource[];
  rivers: RiverSource[];
  districts: DistrictSource[];
  places: Place[];
  landmarks: LandmarkPlacement[];
  terrain: TerrainSource;
}

export class MapBuilder {
  readonly source: MapSource = {
    roads: [],
    rails: [],
    rivers: [],
    districts: [],
    places: [],
    landmarks: [],
    terrain: { coast: [], inlets: [], moles: [], ridges: [], downs: [], flats: [] },
  };

  /** Add a road as a polyline. Roads that cross or touch are joined automatically at compile time. */
  road(name: string, cls: RoadClass, pts: Pt[], options: RoadOptions = {}): this {
    this.source.roads.push({ name, cls, pts, ...options });
    return this;
  }

  /**
   * A rectangular street grid. `xs` are the x positions of north–south streets, `zs` the z positions of
   * east–west streets; names are parallel arrays. Classes default to 'street'.
   */
  grid(spec: {
    xs: number[];
    zs: number[];
    nsNames: string[];
    ewNames: string[];
    nsClass?: (RoadClass | undefined)[];
    ewClass?: (RoadClass | undefined)[];
    /** Optional rotation (radians) about (originX, originZ) for grids that are not north-aligned. */
    rotate?: number;
    originX?: number;
    originZ?: number;
  }): this {
    const rot = spec.rotate ?? 0;
    const ox = spec.originX ?? 0;
    const oz = spec.originZ ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tf = (x: number, z: number): Pt => [ox + (x - ox) * cos + (z - oz) * sin, oz - (x - ox) * sin + (z - oz) * cos];
    const minX = Math.min(...spec.xs);
    const maxX = Math.max(...spec.xs);
    const minZ = Math.min(...spec.zs);
    const maxZ = Math.max(...spec.zs);
    spec.xs.forEach((x, i) => this.road(spec.nsNames[i], spec.nsClass?.[i] ?? 'street', [tf(x, minZ), tf(x, maxZ)]));
    spec.zs.forEach((z, i) => this.road(spec.ewNames[i], spec.ewClass?.[i] ?? 'street', [tf(minX, z), tf(maxX, z)]));
    return this;
  }

  rail(name: string, pts: Pt[], kind: RailSource['kind'] = 'main', bridge = false): this {
    this.source.rails.push({ name, pts, kind, bridge });
    return this;
  }

  river(name: string, pts: Pt[], width: number, options: { braided?: boolean; depth?: number } = {}): this {
    this.source.rivers.push({ name, pts, width, ...options });
    return this;
  }

  district(id: string, name: string, city: CityId | null, type: DistrictType, shape: Shape, priority = 0, teReo?: string): this {
    this.source.districts.push({ id, name, city, type, shape, priority, teReo });
    return this;
  }

  place(id: string, name: string, x: number, z: number, heading = 0, city: CityId | null = null, tags: string[] = [], teReo?: string): this {
    this.source.places.push({ id, name, x, z, heading, city, tags, teReo });
    return this;
  }

  landmark(kind: string, name: string, x: number, z: number, heading = 0, clearRadius = 30, extra: Partial<LandmarkPlacement> = {}): this {
    this.source.landmarks.push({ kind, name, x, z, heading, clearRadius, ...extra });
    return this;
  }

  get terrain(): TerrainSource {
    return this.source.terrain;
  }
}

/** Is (x, z) inside the shape (rect, circle, or ray-cast polygon). */
export function inShape(shape: Shape, x: number, z: number): boolean {
  if (shape.kind === 'rect') return x >= shape.minX && x <= shape.maxX && z >= shape.minZ && z <= shape.maxZ;
  if (shape.kind === 'circle') return Math.hypot(x - shape.x, z - shape.z) <= shape.r;
  let inside = false;
  const p = shape.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
}

/** Where segment (x1,z1)-(x2,z2) crosses (x3,z3)-(x4,z4): the fraction along each, or null when near-parallel.
 *  Callers apply their own acceptance windows to `ua`/`ub`; `den` is the cross product of the two directions. */
export function segSegIntersect(
  x1: number, z1: number, x2: number, z2: number,
  x3: number, z3: number, x4: number, z4: number,
  eps: number,
): { ua: number; ub: number; den: number } | null {
  const den = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3);
  if (Math.abs(den) < eps) return null;
  return {
    den,
    ua: ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / den,
    ub: ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / den,
  };
}
