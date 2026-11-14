import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import type { ChunkBuilder, CityId, DistrictType, Lot, MaterialLibrary, RoadEdge, WorldApi } from '../../core/types';
import { getProp } from '../props';
import '../props/extra';
import { LOT_BUILDERS, buildLot } from './index';
import type { Archetype } from './kit';

/**
 * Runs every archetype over a few hundred random plots against a ChunkBuilder that only records what it
 * is asked to draw, and checks the contract's rules: no exceptions, a collider per building, the
 * triangle budget, everything inside the plot (verandahs may reach 3 m forward), walls that meet the
 * ground, lights only on shopfronts, deterministic output, and invented names only.
 */

const RUNS = 200;
/** Triangles per lot: a house at most 1,500, anything else (a central-city block at worst) at most 4,000. */
const TRIANGLE_BUDGET = 4000;
const HOUSE_TRIANGLE_BUDGET = 1500;
const VERANDAH = 3;
const SLACK = 0.25;
/** Float noise allowance for things placed exactly on a boundary. */
const EPS = 0.001;

/** Plot sizes per district, as laid out by world/lots.ts. */
const PLOTS: Record<string, { frontage: [number, number]; depth: [number, number] }> = {
  cbd: { frontage: [16, 30], depth: [20, 28] },
  shops: { frontage: [7, 13], depth: [14, 20] },
  township: { frontage: [9, 15], depth: [14, 20] },
  villa: { frontage: [15, 19], depth: [24, 28] },
  statehouse: { frontage: [16, 20], depth: [24, 28] },
  industrial: { frontage: [28, 46], depth: [30, 40] },
  port: { frontage: [30, 50], depth: [30, 44] },
  rural: { frontage: [34, 44], depth: [34, 44] },
};
const PLACES: [string, CityId | null][] = [
  ['Christchurch Central', 'christchurch'],
  ['Merivale', 'christchurch'],
  ['Sydenham', 'christchurch'],
  ['Timaru Central', 'timaru'],
  ['The Bay Hill', 'timaru'],
  ['Temuka', 'temuka'],
  ['Ashburton', 'ashburton'],
  ['Lyttelton', 'lyttelton'],
  ['Canterbury Plains', null],
];

interface Primitive {
  type: 'box' | 'gable' | 'cylinder' | 'quad' | 'geometry';
  frame: THREE.Matrix4;
  /** Centre in the primitive's frame and its half extents there. */
  c: [number, number, number];
  half: [number, number, number];
  material: unknown;
  triangles: number;
}

interface Recording {
  primitives: Primitive[];
  colliders: { frame: THREE.Matrix4; c: [number, number, number]; size: [number, number, number] }[];
  instances: { kind: string; x: number; y: number; z: number; heading: number; scale: number; tint?: number }[];
  lights: number[][];
}

/** Material library that hands back plain tagged objects and remembers what was asked for. */
function fakeMaterials(log: { signs: Set<string>; surfaces: Set<string>; odd: string[] }): MaterialLibrary {
  const cache = new Map<string, unknown>();
  const make = (key: string, value: object) => {
    let m = cache.get(key);
    if (!m) cache.set(key, (m = { key, ...value }));
    return m as THREE.MeshStandardMaterial;
  };
  return {
    get(surface, options = {}) {
      log.surfaces.add(surface);
      for (const k of Object.keys(options)) if (k !== 'color') log.odd.push(`${surface}.${k}`);
      return make(`get|${surface}|${JSON.stringify(options)}`, { surface });
    },
    windows: ((kind: string = 'house', spec?: object) => make(`windows|${kind}|${JSON.stringify(spec ?? {})}`, { windows: kind })) as MaterialLibrary['windows'],
    emitter: (color, mode) => make(`emitter|${color}|${mode}`, { emitter: color }),
    sign(text, options = {}) {
      log.signs.add(text);
      return make(`sign|${text}|${JSON.stringify(options)}`, { sign: text });
    },
    register: (material) => material,
    release: () => undefined,
  };
}

function recorder(materials: MaterialLibrary, world: WorldApi, lod: 0 | 1): ChunkBuilder & { rec: Recording } {
  const rec: Recording = { primitives: [], colliders: [], instances: [], lights: [] };
  const numbers = (...values: number[]) => {
    for (const v of values) if (!Number.isFinite(v)) throw new Error(`non-finite number passed to the chunk builder: ${values.join(', ')}`);
  };
  const positive = (what: string, ...values: number[]) => {
    for (const v of values) if (!(v > 0)) throw new Error(`${what} with a non-positive size: ${values.join(' × ')}`);
  };
  return {
    rec,
    materials,
    world,
    lod,
    frameAt: (x, y, z, heading) => new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z),
    addGeometry(geometry, material, matrix) {
      const pos = geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) numbers(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (matrix) numbers(...matrix.elements);
      rec.primitives.push({ type: 'geometry', frame: (matrix ?? new THREE.Matrix4()).clone(), c: [0, 0, 0], half: [0, 0, 0], material, triangles: (geometry.getIndex()?.count ?? pos.count) / 3 });
    },
    box(frame, cx, cy, cz, w, h, d, material) {
      numbers(cx, cy, cz, w, h, d);
      positive('box', w, h, d);
      rec.primitives.push({ type: 'box', frame: frame.clone(), c: [cx, cy, cz], half: [w / 2, h / 2, d / 2], material, triangles: 12 });
    },
    gable(frame, cx, y, cz, w, d, rise, material, hip = 0) {
      numbers(cx, y, cz, w, d, rise, hip);
      positive('gable', w, d, rise);
      if (hip < 0 || hip > w / 2) throw new Error(`gable hip ${hip} does not fit a ridge of ${w}`);
      rec.primitives.push({ type: 'gable', frame: frame.clone(), c: [cx, y + rise / 2, cz], half: [w / 2, rise / 2, d / 2], material, triangles: 6 });
    },
    cylinder(frame, cx, cy, cz, radiusTop, radiusBottom, h, material, segments = 12) {
      numbers(cx, cy, cz, radiusTop, radiusBottom, h);
      positive('cylinder', h, Math.max(radiusTop, radiusBottom));
      const r = Math.max(radiusTop, radiusBottom);
      rec.primitives.push({ type: 'cylinder', frame: frame.clone(), c: [cx, cy, cz], half: [r, h / 2, r], material, triangles: segments * (radiusTop > 0 && radiusBottom > 0 ? 4 : 3) });
    },
    quad(frame, cx, cy, cz, w, h, material, yaw = 0) {
      numbers(cx, cy, cz, w, h, yaw);
      positive('quad', w, h);
      rec.primitives.push({ type: 'quad', frame: frame.clone(), c: [cx, cy, cz], half: [0, 0, 0], material, triangles: 2 });
    },
    collider(frame, cx, cy, cz, w, h, d) {
      numbers(cx, cy, cz, w, h, d);
      positive('collider', w, h, d);
      rec.colliders.push({ frame: frame.clone(), c: [cx, cy, cz], size: [w, h, d] });
    },
    instance(kind, x, y, z, heading = 0, scale = 1, tint) {
      numbers(x, y, z, heading, scale);
      rec.instances.push({ kind, x, y, z, heading, scale, tint });
    },
    light(x, y, z, color, intensity, range) {
      numbers(x, y, z, color, intensity, range);
      rec.lights.push([x, y, z, color, intensity, range]);
    },
  };
}

interface Case {
  lot: Lot;
  world: WorldApi;
}

/**
 * A random plot on sloping, slightly lumpy ground (up to ~2.5 m of fall across it). `odd` stretches the
 * plot well outside the sizes world/lots.ts lays out today.
 */
function makeCase(type: DistrictType, seed: number, odd = false): Case {
  const rng = new Rng(seed);
  const plot = PLOTS[type];
  const width = rng.range(plot.frontage[0], plot.frontage[1]) * (odd ? rng.range(0.6, 1.45) : 1);
  const depth = rng.range(plot.depth[0], plot.depth[1]) * (odd ? rng.range(0.6, 1.45) : 1);
  const heading = rng.range(0, Math.PI * 2);
  const x = rng.range(-2500, 2500);
  const z = rng.range(-5500, 5500);
  const fall = rng.chance(0.35) ? 0 : rng.range(0, 2.4) / Math.max(width, depth);
  const dir = rng.range(0, Math.PI * 2);
  const bump = rng.range(0, 0.25);
  const heightAt = (px: number, pz: number) => 20 + fall * ((px - x) * Math.cos(dir) + (pz - z) * Math.sin(dir)) + bump * Math.sin(px * 0.23) * Math.cos(pz * 0.19);
  const [name, city] = rng.pick(PLACES);
  const urban = type !== 'rural';
  const footpaths = urban ? rng.chance(0.8) : false;
  const edge = { index: 1, name: 'Test St', cls: footpaths ? 'street' : rng.pick(['highway', 'gravel', 'pedestrian', 'lane'] as const), footpaths, width: 9.5 } as unknown as RoadEdge;
  const lot: Lot = {
    x,
    z,
    y: heightAt(x + Math.sin(heading) * (depth / 2), z + Math.cos(heading) * (depth / 2)),
    heading,
    width,
    depth,
    district: { id: `test-${type}`, name, city, type },
    edge,
    seed: (seed * 2654435761) >>> 0,
    corner: rng.chance(0.25),
  };
  return { lot, world: { heightAt } as unknown as WorldApi };
}

const log = { signs: new Set<string>(), surfaces: new Set<string>(), odd: [] as string[] };
const materials = fakeMaterials(log);
/** Props are instanced, not batched, so they are allowed their own material variants. */
const propMaterials = fakeMaterials({ signs: new Set<string>(), surfaces: new Set<string>(), odd: [] });

function build(archetype: Archetype, c: Case, lod: 0 | 1 = 0): Recording {
  const out = recorder(materials, c.world, lod);
  archetype.build(c.lot, out, new Rng(c.lot.seed));
  return out.rec;
}

const _v = new THREE.Vector3();

/** Corners (or just the centre) of a primitive in the plot's own frame. */
function footprint(p: Primitive, toLot: THREE.Matrix4): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(p.c[0] + sx * p.half[0], p.c[1] + sy * p.half[1], p.c[2] + sz * p.half[2]).applyMatrix4(p.frame).applyMatrix4(toLot));
  return pts;
}

function summary(rec: Recording): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const prims = rec.primitives.map((p) => {
    _v.set(p.c[0], p.c[1], p.c[2]).applyMatrix4(p.frame);
    return `${p.type}:${r(_v.x)},${r(_v.y)},${r(_v.z)}:${p.half.map(r).join(',')}:${(p.material as { key: string }).key}`;
  });
  const inst = rec.instances.map((i) => `${i.kind}:${r(i.x)},${r(i.y)},${r(i.z)},${r(i.heading)},${r(i.scale)},${i.tint}`);
  return [...prims, ...inst, ...rec.colliders.map((c) => `col:${c.c.map(r).join(',')}:${c.size.map(r).join(',')}`), ...rec.lights.map((l) => `light:${l.map(r).join(',')}`)].join('\n');
}

const HOUSES = new Set<DistrictType>(['villa', 'statehouse']);
const triangles = (rec: Recording) => rec.primitives.reduce((sum, p) => sum + p.triangles, 0);
const stats: string[] = [];

describe('building archetypes', () => {
  const types = Object.keys(LOT_BUILDERS) as DistrictType[];

  it('covers every built district type', () => {
    for (const type of ['cbd', 'shops', 'township', 'villa', 'statehouse', 'industrial', 'port', 'rural'] as const) {
      expect(LOT_BUILDERS[type]?.length, type).toBeGreaterThan(0);
    }
  });

  for (const type of types) {
    for (const archetype of LOT_BUILDERS[type] ?? []) {
      it(`${type} / ${archetype.name}`, () => {
        let runs = 0;
        let most = 0;
        let total = 0;
        for (let attempt = 0; runs < RUNS && attempt < RUNS * 40; attempt++) {
          const c = makeCase(type, attempt * 7919 + type.length * 131 + archetype.name.length);
          if (archetype.fit && archetype.fit(c.lot) <= 0) continue;
          runs++;
          const where = `${archetype.name} seed ${c.lot.seed} (${c.lot.width.toFixed(1)} × ${c.lot.depth.toFixed(1)})`;
          const rec = build(archetype, c);
          const { lot } = c;
          const hw = lot.width / 2;
          const hd = lot.depth / 2;
          const toLot = new THREE.Matrix4().makeRotationY(lot.heading).setPosition(lot.x, lot.y, lot.z).invert();

          // One collider per solid body: at least the building, never a swarm.
          expect(rec.colliders.length, `${where}: colliders`).toBeGreaterThanOrEqual(1);
          expect(rec.colliders.length, `${where}: colliders`).toBeLessThanOrEqual(8);

          // Triangle budget.
          const count = triangles(rec);
          most = Math.max(most, count);
          total += count;
          expect(count, `${where}: triangles`).toBeLessThanOrEqual(HOUSES.has(type) ? HOUSE_TRIANGLE_BUDGET : TRIANGLE_BUDGET);

          // Everything inside the plot, except that verandahs may reach forward over the footpath.
          for (const p of rec.primitives) {
            const centre = _v.set(p.c[0], p.c[1], p.c[2]).applyMatrix4(p.frame).applyMatrix4(toLot);
            const at = `${where}: ${p.type} centre (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}, ${centre.z.toFixed(2)})`;
            expect(Math.abs(centre.x), at).toBeLessThanOrEqual(hw + EPS);
            expect(centre.z, at).toBeGreaterThanOrEqual(-hd - EPS);
            expect(centre.z, at).toBeLessThanOrEqual(hd + VERANDAH);
            expect(centre.y, at).toBeGreaterThan(-8);
            expect(centre.y, at).toBeLessThan(60);
            if (p.type === 'quad' || p.type === 'geometry') continue;
            for (const corner of footprint(p, toLot)) {
              const edge = `${where}: ${p.type} reaches (${corner.x.toFixed(2)}, ${corner.z.toFixed(2)}) outside a plot of ±${hw.toFixed(2)} × ±${hd.toFixed(2)}`;
              expect(Math.abs(corner.x), edge).toBeLessThanOrEqual(hw + SLACK);
              expect(corner.z, edge).toBeGreaterThanOrEqual(-hd - SLACK);
              expect(corner.z, edge).toBeLessThanOrEqual(hd + VERANDAH + 0.05);
            }
          }
          for (const col of rec.colliders) {
            const centre = _v.set(col.c[0], col.c[1], col.c[2]).applyMatrix4(col.frame).applyMatrix4(toLot);
            expect(Math.abs(centre.x), `${where}: collider`).toBeLessThanOrEqual(hw);
            expect(Math.abs(centre.z), `${where}: collider`).toBeLessThanOrEqual(hd);
          }
          for (const i of rec.instances) {
            const local = _v.set(i.x, i.y, i.z).applyMatrix4(toLot);
            const at = `${where}: prop ${i.kind} at (${local.x.toFixed(2)}, ${local.z.toFixed(2)})`;
            expect(Math.abs(local.x), at).toBeLessThanOrEqual(hw + SLACK);
            expect(local.z, at).toBeGreaterThanOrEqual(-hd - SLACK);
            expect(local.z, at).toBeLessThanOrEqual(hd + VERANDAH);
            expect(getProp(i.kind, propMaterials), `${where}: prop kind ${i.kind} is registered`).not.toBeNull();
          }

          // Wall blocks that stand on the ground go down to the lowest ground under them (no daylight on a slope).
          for (const p of rec.primitives) {
            if (p.type !== 'box' || p.half[0] * p.half[2] * 4 < 20 || p.half[1] < 1) continue;
            const corners: THREE.Vector3[] = [];
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(p.c[0] + sx * p.half[0], p.c[1] - p.half[1], p.c[2] + sz * p.half[2]).applyMatrix4(p.frame));
            const gaps = corners.map((k) => k.y - c.world.heightAt(k.x, k.z));
            if (Math.min(...gaps) > 1) continue; // an upper storey, a roof plant room
            expect(Math.max(...gaps), `${where}: a ${(p.half[0] * 2).toFixed(1)} × ${(p.half[2] * 2).toFixed(1)} m wall block floats above the ground`).toBeLessThanOrEqual(0.02);
          }

          // Lights are budgeted: none on houses, at most one per shopfront elsewhere.
          expect(rec.lights.length, `${where}: lights`).toBeLessThanOrEqual(HOUSES.has(type) || type === 'rural' ? 0 : 4);

          if (runs % 10 === 0) {
            // Same seed, same building; and reduced detail keeps the same solid bodies with fewer primitives.
            expect(summary(build(archetype, c)), `${where}: deterministic`).toBe(summary(rec));
            const far = build(archetype, c, 1);
            expect(triangles(far), `${where}: lod 1 triangles`).toBeLessThanOrEqual(count);
            expect(far.colliders.map((k) => k.c.concat(k.size).map((v) => v.toFixed(3)).join()), `${where}: lod 1 colliders`).toEqual(rec.colliders.map((k) => k.c.concat(k.size).map((v) => v.toFixed(3)).join()));
            expect(far.lights.length, `${where}: lod 1 lights`).toBe(0);
          }
        }
        expect(runs, `${archetype.name}: plots it fits`).toBe(RUNS);
        stats.push(`${type.padEnd(11)} ${archetype.name.padEnd(18)} triangles avg ${(total / runs).toFixed(0).padStart(5)}  max ${String(most).padStart(5)}`);
      });
    }
  }

  it('buildLot picks an archetype for any plot in any district', () => {
    for (const type of types) {
      for (let i = 0; i < 300; i++) {
        const c = makeCase(type, 90001 + i * 31 + type.length);
        const out = recorder(materials, c.world, 0);
        buildLot(c.lot, out);
        expect(out.rec.colliders.length, `${type} seed ${c.lot.seed}`).toBeGreaterThanOrEqual(1);
        expect(triangles(out.rec), `${type} seed ${c.lot.seed}`).toBeLessThanOrEqual(TRIANGLE_BUDGET);
      }
    }
    // Districts with no buildings are simply skipped.
    const park = makeCase('villa', 5);
    park.lot.district = { ...park.lot.district, type: 'park' };
    const out = recorder(materials, park.world, 0);
    buildLot(park.lot, out);
    expect(out.rec.primitives.length).toBe(0);
  });

  it('survives plots far smaller or larger than the lot rules produce', () => {
    // The recorder throws on NaN and on zero or negative sizes, so this catches layouts that collapse.
    for (const type of types) {
      for (const archetype of LOT_BUILDERS[type] ?? []) {
        for (let i = 0; i < 120; i++) {
          const c = makeCase(type, 40009 + i * 53 + archetype.name.length, true);
          if (archetype.fit && archetype.fit(c.lot) <= 0) continue;
          expect(() => build(archetype, c), `${archetype.name} on ${c.lot.width.toFixed(1)} × ${c.lot.depth.toFixed(1)}`).not.toThrow();
        }
      }
    }
  });

  it('uses only colour variants of the standard surfaces', () => {
    expect([...new Set(log.odd)]).toEqual([]);
    console.log(`surfaces used: ${[...log.surfaces].sort().join(', ')}`);
  });

  it('puts only invented names on its signs', () => {
    expect(log.signs.size).toBeGreaterThan(150);
    // Each sign takes an atlas cell for the whole session.
    expect(log.signs.size).toBeLessThan(700);
    const real = [
      'FOUR SQUARE', 'NEW WORLD', 'PAK', 'COUNTDOWN', 'WOOLWORTHS', 'FOODTOWN', 'SUPERVALUE', 'THE WAREHOUSE', 'FARMERS', 'BALLANTYNES', 'ARTHUR BARNETT', 'KIRKCALDIE',
      'HALLENSTEIN', 'GLASSONS', 'WHITCOULLS', 'PAPER PLUS', 'NOEL LEEMING', 'SMITHS CITY', 'BRISCOES', 'MITRE 10', 'PLACEMAKERS', 'VIDEO EZY', 'UNITED VIDEO', 'BLOCKBUSTER',
      'CIVIC VIDEO', 'TIP TOP', 'WATTIE', 'EDMONDS', 'MAINLAND', 'ANCHOR', 'FERNLEAF', 'GRIFFIN', 'CADBURY', 'WHITTAKER', 'SPEIGHT', 'STEINLAGER', 'MONTEITH', 'CANTERBURY DRAUGHT',
      'DB', 'LION', 'TUI', 'BNZ', 'ANZ', 'WESTPAC', 'ASB', 'TRUST BANK', 'NATIONAL BANK', 'POSTBANK', 'COUNTRYWIDE', 'NZ POST', 'TELECOM', 'WRIGHTSON', 'PYNE GOULD', 'DALGETY',
      'ELDERS', 'FARMLANDS', 'BP', 'SHELL', 'MOBIL', 'CALTEX', 'EUROPA', 'CHALLENGE', 'GULL', 'KFC', 'MCDONALD', 'PIZZA HUT', 'GEORGIE PIE', 'COBB', 'HOYTS', 'ODEON', 'LOTTO',
      'TOYOTA', 'HOLDEN', 'FORD', 'NISSAN', 'MITSUBISHI', 'HONDA', 'MAZDA', 'SUBARU', 'SEALORD', 'SANFORD', 'TALLEY', 'SKELLERUP', 'FLETCHER', 'CARTER HOLT', 'MAINFREIGHT',
      'FREIGHTWAYS', 'COCA', 'PEPSI', 'RED BAND', 'SWANNDRI', 'UNICHEM', 'AMCAL', 'COUPLANDS', 'KIWIBURGER', 'FRESH N FRUITY', 'COPPER KETTLE', 'NUMBER 8',
    ];
    const offenders: string[] = [];
    for (const text of log.signs) {
      const flat = ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
      for (const brand of real) if (flat.includes(` ${brand} `) || flat.includes(` ${brand}S `)) offenders.push(`${text.replace(/\n/g, ' ')} ~ ${brand}`);
    }
    expect(offenders).toEqual([]);
  });

  it('reports the triangle counts', () => {
    console.log(stats.join('\n'));
    console.log(`${log.signs.size} distinct signs`);
    expect(stats.length).toBeGreaterThan(30);
  });
});

describe('extra props', () => {
  const CONTRACT = ['phone-box', 'bus-shelter', 'bin', 'bench', 'postbox', 'power-pole', 'road-sign', 'rugby-posts', 'fence-post', 'hedge', 'tree-norfolk-pine', 'tree-phoenix-palm'];
  const OWN = ['picket-fence', 'farm-fence', 'chainlink-fence', 'washing-line', 'car-parked', 'bunting', 'drum', 'pallet'];

  for (const kind of [...CONTRACT, ...OWN]) {
    it(`${kind} is registered, stands on y = 0 and stays small`, () => {
      const def = getProp(kind, propMaterials);
      expect(def).not.toBeNull();
      if (!def) return;
      expect(def.parts.length).toBeGreaterThan(0);
      expect(def.parts.length).toBeLessThanOrEqual(3);
      const box = new THREE.Box3();
      let triangles = 0;
      for (const part of def.parts) {
        const pos = part.geometry.getAttribute('position');
        expect(pos.count).toBeGreaterThan(0);
        expect(part.geometry.getAttribute('normal').count).toBe(pos.count);
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
          box.expandByPoint(_v.fromBufferAttribute(pos, i));
        }
        triangles += (part.geometry.getIndex()?.count ?? pos.count) / 3;
        expect(part.material).toBeDefined();
      }
      // The three plant kinds are built in props/vegetation.ts (round 2): trunks are sunk a little for slopes, and
      // the two specimen trees have the hero-tree budget. props/vegetation.test.ts holds their own budgets.
      const plant = kind === 'hedge' || kind.startsWith('tree-');
      expect(box.min.y).toBeGreaterThan(plant ? -0.5 : -0.02);
      expect(box.min.y).toBeLessThan(kind === 'bunting' ? 4 : 0.35);
      expect(triangles).toBeLessThanOrEqual(plant ? 1500 : 420);
    });
  }
});
