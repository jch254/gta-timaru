import * as THREE from 'three';
import type { ChunkBuilder, District, GroundSurface, LandmarkPlacement, MaterialLibrary, RailLine, RoadEdge, RoadGraph, RoadHit, RoadNode, WorldApi } from '../../../core/types';

/**
 * Test doubles for the landmark builders and the rural scatterer: a material library of plain objects,
 * a tiny world with countable queries, and a ChunkBuilder that records what it is asked to add.
 * Only imported by `*.test.ts`.
 */

export interface FakeMaterial {
  kind: 'surface' | 'windows' | 'emitter' | 'sign' | 'registered';
  key: string;
  color?: number;
  text?: string;
}

export function fakeMaterials(): MaterialLibrary {
  const cache = new Map<string, FakeMaterial>();
  const make = (key: string, value: Omit<FakeMaterial, 'key'>) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = { key, ...value }));
    return m as unknown as THREE.MeshStandardMaterial;
  };
  return {
    get: (surface, options = {}) => make(`${surface}|${JSON.stringify(options)}`, { kind: 'surface', color: options.color }),
    windows: (kind = 'house') => make(`windows|${kind}`, { kind: 'windows' }),
    emitter: (color, mode) => make(`emitter|${color}|${mode}`, { kind: 'emitter', color }),
    sign: (text, options = {}) => make(`sign|${text}|${JSON.stringify(options)}`, { kind: 'sign', text }),
    register: (material) => material,
    release: () => undefined,
  };
}

export interface FakeWorldOptions {
  ground?: (x: number, z: number) => number;
  water?: (x: number, z: number) => number;
  surface?: (x: number, z: number) => GroundSurface;
  district?: (x: number, z: number) => District['type'];
  /** Straight roads as [x0, z0, x1, z1, class]. */
  roads?: [number, number, number, number, RoadEdge['cls']][];
  landmarks?: LandmarkPlacement[];
  railways?: RailLine[];
}

export interface FakeWorld extends WorldApi {
  /** Number of terrain / district / road queries made so far. */
  queries: number;
}

function straightEdge(index: number, x0: number, z0: number, x1: number, z1: number, cls: RoadEdge['cls'], y: (x: number, z: number) => number): RoadEdge {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const tx = (x1 - x0) / length;
  const tz = (z1 - z0) / length;
  const n = Math.max(1, Math.round(length / 4));
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const s = (length * i) / n;
    const x = x0 + tx * s;
    const z = z0 + tz * s;
    samples.push({ x, y: y(x, z), z, tx, tz, s });
  }
  const highway = cls === 'highway';
  return { index, name: highway ? 'State Highway 1' : 'Test Road', cls, a: index * 2, b: index * 2 + 1, samples, length, width: highway ? 8 : 6, lanes: 1, speedLimit: highway ? 27.8 : 22, oneway: false, bridge: false, tunnel: false, footpaths: false, drivable: true };
}

export function fakeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const ground = options.ground ?? (() => 10);
  const edges = (options.roads ?? []).map((r, i) => straightEdge(i, r[0], r[1], r[2], r[3], r[4], ground));
  const nodes: RoadNode[] = [];
  for (const e of edges) {
    const a = e.samples[0];
    const b = e.samples[e.samples.length - 1];
    nodes.push({ index: e.a, x: a.x, y: a.y, z: a.z, edges: [e.index] }, { index: e.b, x: b.x, y: b.y, z: b.z, edges: [e.index] });
  }
  const world = { queries: 0 } as FakeWorld;
  const graph: RoadGraph = {
    nodes,
    edges,
    nearest(x, z, maxDistance = 60, filter) {
      world.queries++;
      let best: RoadHit | null = null;
      for (const e of edges) {
        if (filter && !filter(e)) continue;
        const a = e.samples[0];
        const s = Math.min(e.length, Math.max(0, (x - a.x) * a.tx + (z - a.z) * a.tz));
        const px = a.x + a.tx * s;
        const pz = a.z + a.tz * s;
        const distance = Math.hypot(x - px, z - pz);
        if (distance > maxDistance || (best && best.distance <= distance)) continue;
        best = { edge: e, s, distance, offset: (x - px) * a.tz - (z - pz) * a.tx, x: px, y: ground(px, pz), z: pz };
      }
      return best;
    },
    pointAt(edge, s) {
      const a = edge.samples[0];
      const t = Math.min(edge.length, Math.max(0, s));
      return { x: a.x + a.tx * t, y: a.y, z: a.z + a.tz * t, tx: a.tx, tz: a.tz, s: t };
    },
    lanePoint(edge, s, dir) {
      const q = this.pointAt(edge, s);
      return { x: q.x, y: q.y, z: q.z, heading: Math.atan2(q.tx * dir, q.tz * dir) };
    },
    footpathPoint(edge, s) {
      const q = this.pointAt(edge, s);
      return { x: q.x, y: q.y, z: q.z };
    },
    endNode: (edge, dir) => nodes[dir === 1 ? edge.b : edge.a],
    route: () => null,
    nearestNode: () => nodes[0],
  };
  const district = (x: number, z: number): District => ({ id: 'test', name: 'Test Plains', city: null, type: options.district ? options.district(x, z) : 'rural' });
  Object.assign(world, {
    bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
    seaLevel: 0,
    graph,
    places: [],
    landmarks: options.landmarks ?? [],
    railways: options.railways ?? [],
    heightAt: (x: number, z: number) => (world.queries++, ground(x, z)),
    groundAt: (x: number, z: number) => (world.queries++, ground(x, z)),
    normalAt: (_x: number, _z: number, target = new THREE.Vector3()) => target.set(0, 1, 0),
    waterDepthAt: (x: number, z: number) => (world.queries++, options.water ? options.water(x, z) : 0),
    surfaceAt: (x: number, z: number) => (world.queries++, options.surface ? options.surface(x, z) : 'grass'),
    districtAt: (x: number, z: number) => (world.queries++, district(x, z)),
    locationName: () => 'Test Plains',
    place: (id: string) => {
      throw new Error(`Unknown place "${id}"`);
    },
    placesTagged: () => [],
    nearestPlace: () => null,
    isLoaded: () => true,
    addFocus: () => () => undefined,
    whenLoaded: () => Promise.resolve(),
  } satisfies Omit<WorldApi, never>);
  return world;
}

export type RecordedOp = 'box' | 'gable' | 'cylinder' | 'quad' | 'geometry' | 'collider' | 'instance' | 'light';

export interface Recorded {
  op: RecordedOp;
  /** World-space centre. */
  x: number;
  y: number;
  z: number;
  material?: FakeMaterial;
  kind?: string;
  triangles: number;
  /** World-space vertices of custom geometry (x, y, z triples). */
  vertices?: Float32Array;
}

const _v = new THREE.Vector3();

/** ChunkBuilder that records every call instead of building meshes. */
export class RecordingBuilder implements ChunkBuilder {
  readonly records: Recorded[] = [];
  /** Problems found in custom geometry (missing attributes, NaNs…). */
  readonly problems: string[] = [];
  readonly lod: 0 | 1 = 0;

  constructor(
    readonly materials: MaterialLibrary,
    readonly world: WorldApi,
  ) {}

  private centre(frame: THREE.Matrix4 | undefined, x: number, y: number, z: number): [number, number, number] {
    _v.set(x, y, z);
    if (frame) _v.applyMatrix4(frame);
    return [_v.x, _v.y, _v.z];
  }

  private push(op: RecordedOp, frame: THREE.Matrix4 | undefined, x: number, y: number, z: number, triangles: number, extra: Partial<Recorded> = {}) {
    const [wx, wy, wz] = this.centre(frame, x, y, z);
    if (!Number.isFinite(wx + wy + wz)) this.problems.push(`${op}: non-finite position`);
    this.records.push({ op, x: wx, y: wy, z: wz, triangles, ...extra });
  }

  frameAt(x: number, y: number, z: number, heading: number): THREE.Matrix4 {
    return new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z);
  }

  addGeometry(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): void {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    if (!pos || !nor || !uv) {
      this.problems.push('geometry: needs position, normal and uv attributes');
      return;
    }
    if (nor.count !== pos.count || uv.count !== pos.count) this.problems.push('geometry: attribute counts differ');
    const vertices = new Float32Array(pos.count * 3);
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (matrix) _v.applyMatrix4(matrix);
      vertices.set([_v.x, _v.y, _v.z], i * 3);
      box.expandByPoint(_v);
      const len = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (!Number.isFinite(_v.x + _v.y + _v.z) || !Number.isFinite(uv.getX(i) + uv.getY(i)) || !(len > 0.5 && len < 1.5)) {
        this.problems.push('geometry: bad vertex data');
        break;
      }
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) if (index.getX(i) >= pos.count) this.problems.push('geometry: index out of range');
    const c = box.getCenter(new THREE.Vector3());
    this.push('geometry', undefined, c.x, c.y, c.z, (index ? index.count : pos.count) / 3, { material: material as unknown as FakeMaterial, vertices });
  }

  box(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: THREE.Material): void {
    if (!(w > 0 && h > 0 && d > 0)) this.problems.push(`box: empty size ${w} × ${h} × ${d}`);
    this.push('box', frame, cx, cy, cz, 12, { material: material as unknown as FakeMaterial });
  }

  gable(frame: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, material: THREE.Material): void {
    if (!(w > 0 && d > 0 && rise > 0)) this.problems.push(`gable: empty size ${w} × ${d} × ${rise}`);
    this.push('gable', frame, cx, y + rise / 2, cz, 6, { material: material as unknown as FakeMaterial });
  }

  cylinder(frame: THREE.Matrix4, cx: number, cy: number, cz: number, radiusTop: number, radiusBottom: number, h: number, material: THREE.Material, segments = 12): void {
    if (!(h > 0 && radiusTop >= 0 && radiusBottom >= 0)) this.problems.push('cylinder: empty size');
    this.push('cylinder', frame, cx, cy, cz, segments * 4, { material: material as unknown as FakeMaterial });
  }

  quad(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, material: THREE.Material): void {
    if (!(w > 0 && h > 0)) this.problems.push(`quad: empty size ${w} × ${h}`);
    this.push('quad', frame, cx, cy, cz, 2, { material: material as unknown as FakeMaterial });
  }

  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
    if (!(w > 0 && h > 0 && d > 0)) this.problems.push(`collider: empty size ${w} × ${h} × ${d}`);
    this.push('collider', frame, cx, cy, cz, 0);
  }

  instance(kind: string, x: number, y: number, z: number): void {
    this.push('instance', undefined, x, y, z, 0, { kind });
  }

  light(x: number, y: number, z: number): void {
    this.push('light', undefined, x, y, z, 0);
  }

  count(...ops: RecordedOp[]): number {
    return this.records.filter((r) => ops.includes(r.op)).length;
  }

  get triangles(): number {
    return this.records.reduce((sum, r) => sum + r.triangles, 0);
  }

  /** Farthest horizontal distance from (x, z) of any primitive centre or custom-geometry vertex. */
  reach(x: number, z: number): { distance: number; record: Recorded | null } {
    let distance = 0;
    let record: Recorded | null = null;
    for (const r of this.records) {
      let d = Math.hypot(r.x - x, r.z - z);
      if (r.vertices) for (let i = 0; i < r.vertices.length; i += 3) d = Math.max(d, Math.hypot(r.vertices[i] - x, r.vertices[i + 2] - z));
      if (d > distance) {
        distance = d;
        record = r;
      }
    }
    return { distance, record };
  }
}

/** Calls that add something to the chunk, for the per-landmark primitive budget. */
export const PRIMITIVE_OPS: RecordedOp[] = ['box', 'gable', 'cylinder', 'quad', 'geometry', 'instance', 'collider'];

/** Real brands that must never appear on a sign (the game's businesses are all invented). */
export const REAL_BRANDS = /\b(BP|(?<!SOUND )SHELL|MOBIL|CALTEX|EUROPA|GULL|CHALLENGE|ALLIANCE|PPCS|AFFCO|WEDDEL|SPEIGHT'?S|STEINLAGER|TIP TOP|COCA|PEPSI|TAB)\b/;

export interface BuiltLandmark {
  out: RecordingBuilder;
  world: FakeWorld;
  placement: LandmarkPlacement;
}

/** Run one landmark builder against the recording builder. */
export function buildLandmark(
  builder: (placement: LandmarkPlacement, out: ChunkBuilder) => void,
  kind: string,
  clearRadius: number,
  at: { x?: number; z?: number; heading?: number; name?: string } = {},
  worldOptions: FakeWorldOptions = {},
): BuiltLandmark {
  const world = fakeWorld(worldOptions);
  const out = new RecordingBuilder(fakeMaterials(), world);
  const placement: LandmarkPlacement = { kind, name: at.name ?? 'Test Place', x: at.x ?? 0, z: at.z ?? 0, heading: at.heading ?? 0, clearRadius };
  builder(placement, out);
  return { out, world, placement };
}

/** What was built and in which materials, ignoring where: tells seeded variants apart. */
export function variantOf(out: RecordingBuilder): string {
  return out.records.map((r) => `${r.op}:${r.kind ?? r.material?.key ?? ''}:${r.triangles}`).join('|');
}

/** Compact signature of everything recorded, for determinism checks. */
export function signature(out: RecordingBuilder): string {
  return out.records.map((r) => `${r.op}:${r.kind ?? ''}:${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)}:${r.triangles}`).join('|');
}
