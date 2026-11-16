import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ChunkBuilder, District, LandmarkPlacement, MaterialLibrary, RailLine, RoadGraph, WorldApi } from '../../../core/types';
import { LANDMARKS, runLandmark } from '../registry';
import './index';

/** Clear radius per kind, from docs/CONTRACT.md. */
const RADII: Record<string, number> = {
  'chch-cathedral': 40,
  'cathedral-square': 75,
  'arts-centre': 70,
  'canterbury-museum': 40,
  'bridge-of-remembrance': 22,
  'town-hall': 55,
  'victoria-square': 60,
  'old-railway-station': 50,
  'addington-station': 40,
  'lancaster-park': 110,
  'antigua-boatsheds': 30,
  'tram-stop': 14,
  'chch-hospital': 70,
  'chch-police': 40,
  'new-brighton-mall': 60,
  'sign-of-the-takahe': 30,
  'sign-of-the-kiwi': 25,
  'sugarloaf-tower': 20,
  'gondola-base': 30,
  'gondola-summit': 30,
  'tunnel-portal': 25,
  'lyttelton-port': 120,
  'timeball-station': 22,
};

/** Primitive-call budget: 400 for the large landmarks, 120 for the small ones. */
const budget = (kind: string) => (RADII[kind] >= 40 ? 400 : 120);
/** Triangle ceiling, so merged custom geometry cannot hide a heavy landmark behind a low call count. */
const triangleBudget = (kind: string) => (RADII[kind] >= 40 ? 16000 : 7000);
/** Night lights per landmark. Round 2: the Square is one of the places that should glow, so it gets four. */
const lightBudget = (kind: string) => (kind === 'cathedral-square' ? 4 : 2);

interface Prim {
  type: 'box' | 'gable' | 'cylinder' | 'quad' | 'geometry';
  /** World centre. */
  x: number;
  y: number;
  z: number;
  /** World-space points bounding the primitive in plan (corners, or every vertex for custom geometry). */
  outline: number[];
  triangles: number;
}

interface RecordedCollider {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  heading: number;
}

const _v = new THREE.Vector3();

/** Fake material library: plain objects, cached by arguments like the real one so identical requests are identical. */
function fakeMaterials(): MaterialLibrary {
  const cache = new Map<string, unknown>();
  const make = (key: string) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = { key }));
    return m as THREE.MeshStandardMaterial;
  };
  return {
    get: (surface, options) => make(`get|${surface}|${JSON.stringify(options ?? {})}`),
    windows: (kind) => make(`windows|${kind ?? 'house'}`),
    emitter: (color, mode) => make(`emitter|${color}|${mode}`),
    sign: (text, options) => make(`sign|${text}|${JSON.stringify(options ?? {})}`),
    register: (material) => material,
    release: () => undefined,
  };
}

const CITY: District = { id: 'central', name: 'Central City', city: 'christchurch', type: 'cbd' };

function fakeWorld(overrides: Partial<WorldApi> = {}): WorldApi {
  const graph = {
    nodes: [],
    edges: [],
    nearest: () => null,
    pointAt: () => ({ x: 0, y: 0, z: 0, tx: 1, tz: 0, s: 0 }),
  } as unknown as RoadGraph;
  const world = {
    bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
    seaLevel: 0,
    graph,
    places: [],
    landmarks: [],
    railways: [],
    heightAt: () => 6,
    groundAt: () => 6,
    waterDepthAt: () => 0,
    surfaceAt: () => 'grass',
    districtAt: () => CITY,
    ...overrides,
  };
  return world as unknown as WorldApi;
}

/** Records everything a builder emits, with world-space positions. */
class Recorder implements ChunkBuilder {
  readonly lod = 0 as const;
  prims: Prim[] = [];
  colliders: RecordedCollider[] = [];
  instances: { kind: string; x: number; y: number; z: number }[] = [];
  lights: { x: number; y: number; z: number }[] = [];
  problems: string[] = [];

  constructor(
    readonly materials: MaterialLibrary,
    readonly world: WorldApi,
  ) {}

  frameAt(x: number, y: number, z: number, heading: number): THREE.Matrix4 {
    return new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z);
  }

  private push(type: Prim['type'], frame: THREE.Matrix4, cx: number, cy: number, cz: number, local: [number, number][], triangles: number, material: THREE.Material) {
    if (!material) this.problems.push(`${type} without a material`);
    const c = _v.set(cx, cy, cz).applyMatrix4(frame).clone();
    const outline: number[] = [];
    for (const [lx, lz] of local) {
      _v.set(lx, cy, lz).applyMatrix4(frame);
      outline.push(_v.x, _v.z);
    }
    if (![c.x, c.y, c.z, ...outline].every(Number.isFinite)) this.problems.push(`${type} has a non-finite position`);
    this.prims.push({ type, x: c.x, y: c.y, z: c.z, outline, triangles });
  }

  box(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number, material: THREE.Material) {
    if (!(w > 0 && h > 0 && d > 0)) this.problems.push(`box with a non-positive size ${w} × ${h} × ${d}`);
    this.push('box', frame, cx, cy, cz, [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]], 12, material);
  }

  gable(frame: THREE.Matrix4, cx: number, y: number, cz: number, w: number, d: number, rise: number, material: THREE.Material) {
    if (!(w > 0 && d > 0 && rise > 0)) this.problems.push('gable with a non-positive size');
    this.push('gable', frame, cx, y, cz, [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]], 6, material);
  }

  cylinder(frame: THREE.Matrix4, cx: number, cy: number, cz: number, radiusTop: number, radiusBottom: number, h: number, material: THREE.Material, segments = 12) {
    const r = Math.max(radiusTop, radiusBottom);
    if (!(r > 0 && h > 0)) this.problems.push('cylinder with a non-positive size');
    this.push('cylinder', frame, cx, cy, cz, [[cx - r, cz], [cx + r, cz], [cx, cz - r], [cx, cz + r]], segments * 4, material);
  }

  quad(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, material: THREE.Material, yaw = 0) {
    if (!(w > 0 && h > 0)) this.problems.push('quad with a non-positive size');
    const dx = (Math.cos(yaw) * w) / 2;
    const dz = (-Math.sin(yaw) * w) / 2;
    this.push('quad', frame, cx, cy, cz, [[cx - dx, cz - dz], [cx + dx, cz + dz]], 2, material);
  }

  addGeometry(geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4) {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    if (!pos || !nor || !uv) {
      this.problems.push('custom geometry is missing position, normal or uv');
      return;
    }
    if (nor.count !== pos.count || uv.count !== pos.count) this.problems.push('custom geometry attributes differ in length');
    if (!material) this.problems.push('geometry without a material');
    const box = new THREE.Box3();
    const outline: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (matrix) _v.applyMatrix4(matrix);
      if (!Number.isFinite(_v.x + _v.y + _v.z)) this.problems.push('custom geometry has a non-finite vertex');
      const n = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (!(n > 0.5 && n < 1.5)) this.problems.push(`custom geometry has a bad normal (length ${n})`);
      if (!Number.isFinite(uv.getX(i) + uv.getY(i))) this.problems.push('custom geometry has a non-finite uv');
      box.expandByPoint(_v);
      outline.push(_v.x, _v.z);
    }
    const c = box.getCenter(new THREE.Vector3());
    const index = geometry.getIndex();
    this.prims.push({ type: 'geometry', x: c.x, y: c.y, z: c.z, outline, triangles: (index ? index.count : pos.count) / 3 });
  }

  collider(frame: THREE.Matrix4, cx: number, cy: number, cz: number, w: number, h: number, d: number) {
    const c = _v.set(cx, cy, cz).applyMatrix4(frame);
    if (!(w > 0 && h > 0 && d > 0)) this.problems.push('collider with a non-positive size');
    this.colliders.push({ x: c.x, y: c.y, z: c.z, hx: w / 2, hy: h / 2, hz: d / 2, heading: Math.atan2(frame.elements[8], frame.elements[0]) });
  }

  instance(kind: string, x: number, y: number, z: number) {
    if (!Number.isFinite(x + y + z)) this.problems.push(`instance ${kind} has a non-finite position`);
    this.instances.push({ kind, x, y, z });
  }

  light(x: number, y: number, z: number) {
    this.lights.push({ x, y, z });
  }

  get calls(): number {
    return this.prims.length;
  }

  get triangles(): number {
    return this.prims.reduce((sum, p) => sum + p.triangles, 0);
  }

  /** Furthest any primitive centre, and any primitive extent, lies from a point (in plan). */
  reach(x: number, z: number): { centre: number; extent: number } {
    let centre = 0;
    let extent = 0;
    for (const p of this.prims) {
      centre = Math.max(centre, Math.hypot(p.x - x, p.z - z));
      for (let i = 0; i < p.outline.length; i += 2) extent = Math.max(extent, Math.hypot(p.outline[i] - x, p.outline[i + 1] - z));
    }
    for (const c of this.colliders) centre = Math.max(centre, Math.hypot(c.x - x, c.z - z));
    for (const c of this.instances) centre = Math.max(centre, Math.hypot(c.x - x, c.z - z));
    for (const c of this.lights) centre = Math.max(centre, Math.hypot(c.x - x, c.z - z));
    return { centre, extent: Math.max(centre, extent) };
  }

  /** Stable digest for determinism checks. */
  digest(): string {
    const r = (v: number) => Math.round(v * 1000);
    return [
      ...this.prims.map((p) => `${p.type}:${r(p.x)},${r(p.y)},${r(p.z)}:${p.triangles}`),
      ...this.colliders.map((c) => `c:${r(c.x)},${r(c.y)},${r(c.z)},${r(c.hx)},${r(c.hz)}`),
      ...this.instances.map((c) => `i:${c.kind}:${r(c.x)},${r(c.y)},${r(c.z)}`),
    ].join('|');
  }
}

const placementOf = (kind: string, x = 1234, z = -3456, heading = 0.83): LandmarkPlacement => ({ kind, name: kind, x, z, heading, clearRadius: RADII[kind] });

function build(kind: string, world = fakeWorld(), placement = placementOf(kind)): Recorder {
  const out = new Recorder(fakeMaterials(), world);
  runLandmark(LANDMARKS[kind], placement, out);
  return out;
}

/** Collider footprint in the placement's local frame: centre x and half-extent along local x, plus its base height. */
function localSpan(c: RecordedCollider, p: LandmarkPlacement, groundY: number) {
  const dx = c.x - p.x;
  const dz = c.z - p.z;
  const lx = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
  const phi = c.heading - p.heading;
  return { lx, half: Math.abs(c.hx * Math.cos(phi)) + Math.abs(c.hz * Math.sin(phi)), base: c.y - c.hy - groundY };
}

describe('Christchurch landmarks', () => {
  it('registers every kind the contract assigns to this owner', () => {
    for (const kind of Object.keys(RADII)) expect(LANDMARKS[kind], kind).toBeTypeOf('function');
  });

  describe.each(Object.keys(RADII))('%s', (kind) => {
    const p = placementOf(kind);
    const out = build(kind, fakeWorld(), p);

    it('builds without problems', () => {
      expect(out.problems).toEqual([]);
      expect(out.calls).toBeGreaterThan(5);
    });

    it('stays inside its primitive and light budgets', () => {
      expect(out.calls).toBeLessThanOrEqual(budget(kind));
      expect(out.triangles).toBeLessThanOrEqual(triangleBudget(kind));
      expect(out.lights.length).toBeLessThanOrEqual(lightBudget(kind));
      expect(out.colliders.length).toBeGreaterThan(0);
      expect(out.colliders.length).toBeLessThanOrEqual(40);
    });

    it('keeps every primitive inside the clear radius', () => {
      const reach = out.reach(p.x, p.z);
      // Required: centres within the radius + 10 %. Held to the stricter test too: the full extent of every primitive.
      expect(reach.centre).toBeLessThanOrEqual(RADII[kind] * 1.1);
      expect(reach.extent).toBeLessThanOrEqual(RADII[kind] * 1.1);
    });

    it('is deterministic', () => {
      expect(build(kind, fakeWorld(), p).digest()).toBe(out.digest());
    });

    it('copes with sloping ground, water, roads, rails and neighbouring landmarks', () => {
      // A hillside falling towards +x with water beyond 18 m east of the placement, a tram / main line 6 m north,
      // a pedestrian street 5 m west, and both gondola stations on the map.
      const q = placementOf(kind, -700, 2100, -1.9);
      const ground = (x: number, z: number) => 30 - (x - q.x) * 0.12 + (z - q.z) * 0.05;
      const rail = (lineKind: RailLine['kind']): RailLine => {
        const points = [];
        for (let x = q.x - 150; x <= q.x + 150; x += 6) points.push({ x, y: 0, z: q.z - 6 });
        return { name: lineKind, kind: lineKind, points, length: 300 };
      };
      const street = { cls: 'pedestrian', width: 12, tunnel: false, bridge: false };
      const graph = {
        nodes: [],
        edges: [],
        nearest: (x: number, z: number, max = 60, filter?: (e: unknown) => boolean) => {
          const distance = Math.abs(x - (q.x - 5));
          return distance <= max && (!filter || filter(street)) ? { edge: street, s: 0, distance, offset: 0, x: q.x - 5, y: 0, z } : null;
        },
        pointAt: () => ({ x: q.x - 5, y: 0, z: q.z, tx: 0, tz: 1, s: 0 }),
      } as unknown as RoadGraph;
      const other = placementOf(kind === 'gondola-summit' ? 'gondola-base' : 'gondola-summit', q.x + 300, q.z - 400, 0);
      const neighbour = placementOf('chch-cathedral', q.x + 20, q.z + 10, 0);
      const world = fakeWorld({
        graph,
        railways: [rail('tram'), rail('main')],
        landmarks: [q, other, neighbour],
        groundAt: ground,
        heightAt: ground,
        waterDepthAt: (x: number) => (x - q.x > 18 ? 1.5 : 0),
      });
      const rough = build(kind, world, q);
      expect(rough.problems).toEqual([]);
      // The mall may re-centre on the street; everything else must still respect the radius.
      expect(rough.reach(q.x, q.z).extent).toBeLessThanOrEqual(RADII[kind] * 1.1);
      expect(rough.lights.length).toBeLessThanOrEqual(lightBudget(kind));
      expect(build(kind, world, q).digest()).toBe(rough.digest());
    });
  });

  it('reports sizes', () => {
    const rows = Object.keys(RADII).map((kind) => {
      const p = placementOf(kind);
      const out = build(kind, fakeWorld(), p);
      const reach = out.reach(p.x, p.z);
      const top = Math.max(...out.prims.map((q) => q.y)) - 6;
      return `${kind.padEnd(22)} calls ${String(out.calls).padStart(3)}/${budget(kind)}  tris ${String(Math.round(out.triangles)).padStart(5)}  colliders ${String(out.colliders.length).padStart(2)}  props ${String(out.instances.length).padStart(2)}  extent ${reach.extent.toFixed(1).padStart(5)}/${RADII[kind]}  highest centre ${top.toFixed(0)} m`;
    });
    console.log(rows.join('\n'));
    expect(rows.length).toBe(23);
  });

  it('leaves the tunnel mouth clear: no collider within 4.5 m of the centreline below 5.5 m', () => {
    const p = placementOf('tunnel-portal');
    for (const world of [fakeWorld(), fakeWorld({ graph: { nearest: () => ({ edge: { width: 11, cls: 'street' }, distance: 0 }) } as unknown as RoadGraph })]) {
      const out = build('tunnel-portal', world, p);
      for (const c of out.colliders) {
        const s = localSpan(c, p, 6);
        if (s.base < 5.5) expect(Math.abs(s.lx) - s.half, JSON.stringify(c)).toBeGreaterThanOrEqual(4.5);
      }
      // And no geometry hangs into the opening either: every vertex near the centreline is above 5.5 m.
      for (const prim of out.prims) {
        if (prim.type !== 'geometry' && prim.type !== 'box') continue;
        const lx = (prim.x - p.x) * Math.cos(p.heading) - (prim.z - p.z) * Math.sin(p.heading);
        if (prim.type === 'box' && Math.abs(lx) < 4) expect(prim.y - 6).toBeGreaterThan(5.5);
      }
    }
  });

  it('turns the tunnel portal to face out of the hill', () => {
    // Hill rising towards local +z of the authored heading: the builder must flip, putting the headwall uphill.
    const p = placementOf('tunnel-portal', 0, 0, 0);
    const hill = (x: number, z: number) => (Math.abs(x) > 10 ? Math.max(0, z) * 1.5 : 0) + 10;
    const flipped = build('tunnel-portal', fakeWorld({ heightAt: hill, groundAt: () => 10 }), p);
    const plain = build('tunnel-portal', fakeWorld({ heightAt: () => 10, groundAt: () => 10 }), p);
    // The canopy projects towards the open road: −z once flipped, +z on level ground.
    const canopyZ = (r: Recorder) => r.colliders.filter((c) => Math.abs(c.hz - 4.5) < 1e-6).map((c) => c.z);
    expect(canopyZ(plain).every((z) => z > 0)).toBe(true);
    expect(canopyZ(flipped).every((z) => z < 0)).toBe(true);
  });

  it('lets pedestrians through all three arches of the Bridge of Remembrance', () => {
    const p = placementOf('bridge-of-remembrance');
    const out = build('bridge-of-remembrance', fakeWorld(), p);
    const spans = out.colliders.map((c) => localSpan(c, p, 6));
    const blocked = (x: number) => spans.some((s) => Math.abs(x - s.lx) < s.half);
    for (const x of [0, -3.4, 3.4, -8.5, 8.5, -7.4, 9.6]) expect(blocked(x), `x = ${x}`).toBe(false);
    for (const x of [-5.4, 5.4, -11.5, 11.5]) expect(blocked(x), `x = ${x}`).toBe(true);
  });

  it('keeps Cathedral Square furniture out of the cathedral footprint and off the tram line', () => {
    const p = placementOf('cathedral-square');
    const cathedral = placementOf('chch-cathedral', p.x + 12, p.z - 6, p.heading);
    const tram: RailLine = { name: 'Tram', kind: 'tram', points: [], length: 200 };
    for (let i = -100; i <= 100; i += 6) tram.points.push({ x: p.x + i, y: 6, z: p.z + 52 });
    const out = build('cathedral-square', fakeWorld({ landmarks: [p, cathedral], railways: [tram] }), p);
    expect(out.instances.length).toBeGreaterThan(20);
    // Round 2: the Square is dressed right up to the cathedral's walls (the war memorial stands beside the nave),
    // so the test is the building's footprint in its own frame (+z its west front), not its whole clear radius.
    const inFootprint = (x: number, z: number) => {
      const dx = x - cathedral.x;
      const dz = z - cathedral.z;
      const lx = dx * Math.cos(cathedral.heading) - dz * Math.sin(cathedral.heading);
      const lz = dx * Math.sin(cathedral.heading) + dz * Math.cos(cathedral.heading);
      return lx > -20 && lx < 17 && lz > -35 && lz < 30;
    };
    for (const i of out.instances) {
      expect(inFootprint(i.x, i.z), i.kind).toBe(false);
      expect(Math.abs(i.z - (p.z + 52)), i.kind).toBeGreaterThan(1.5);
    }
    for (const c of out.colliders) expect(inFootprint(c.x, c.z)).toBe(false);
  });

  it('puts the tram on the track and the Addington platform beside the main line', () => {
    const p = placementOf('tram-stop', 100, 200, 0.4);
    const line = (kind: RailLine['kind'], z: number): RailLine => {
      const points = [];
      for (let x = -100; x <= 300; x += 6) points.push({ x, y: 6, z });
      return { name: kind, kind, points, length: 400 };
    };
    const tram = build('tram-stop', fakeWorld({ railways: [line('tram', 205)] }), p);
    // The tram's collider is centred on the rails and lies along them.
    const body = tram.colliders.find((c) => c.hx === 5)!;
    expect(body.z).toBeCloseTo(205, 3);
    expect(Math.abs(Math.sin(body.heading))).toBeLessThan(1e-6);
    // The shelter is on the placement's side of the track.
    expect(tram.instances.find((i) => i.kind === 'chch-bench')!.z).toBeLessThan(205);

    const q = placementOf('addington-station', 100, 200, 2.2);
    const station = build('addington-station', fakeWorld({ railways: [line('main', 180)] }), q);
    const platform = station.colliders[0];
    expect(Math.abs(Math.sin(platform.heading))).toBeLessThan(1e-6);
    // Platform edge 1.7 m from the track centreline, on the placement's side.
    expect(platform.z - platform.hz).toBeCloseTo(181.7, 3);
  });

  it('faces the boat sheds and the port towards the water', () => {
    for (const kind of ['antigua-boatsheds', 'lyttelton-port']) {
      const p = placementOf(kind, 0, 0, 0);
      // Water to the north (−z), i.e. behind the authored heading.
      const out = build(kind, fakeWorld({ waterDepthAt: (_x: number, z: number) => (z < -8 ? 2 : 0), groundAt: (_x: number, z: number) => (z < -8 ? 0.5 : 3), seaLevel: 2.5 }), p);
      const boats = out.instances.filter((i) => /punt|canoe|skiff/.test(i.kind) && i.y < 3);
      if (kind === 'antigua-boatsheds') {
        expect(boats.length).toBeGreaterThan(3);
        for (const b of boats) expect(b.z, b.kind).toBeLessThan(-8);
      } else {
        // Ship hull colliders are the ones reaching below the wharf deck.
        const hulls = out.colliders.filter((c) => c.hx > 25 && c.hx < 45 && c.y - c.hy < 2.5);
        expect(hulls.length).toBe(2);
        for (const h of hulls) expect(h.z).toBeLessThan(-8);
      }
    }
  });
});
