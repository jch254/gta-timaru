// @vitest-environment node
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary, VehicleModel, VehicleSpec } from '../../core/types';
import { VEHICLE_SPECS } from '../specs';
import { VEHICLE_MODELS } from './index';
import { METALLIC } from './paints';

/** The original eleven ids, which missions, saves, dev tools and playtests have used since the first build. */
const ORIGINAL_IDS = ['statesman', 'v8sedan', 'coupe', 'hatch', 'wagon', 'ute', 'farmtruck', 'van', 'bike', 'police', 'bus'];
/** The nineteen added when the roster became specific 1995 cars. With the eleven, the ids fixed by docs/CONTRACT.md. */
const ADDED_IDS = [
  'trafficcar', 'taxi', 'kingswood', 'valiant', 'cortina', 'mini', 'triumph', 'corolla', 'corona', 'sigma',
  'accord', 'datsun', 'leone', 'hothatch', 'import', 'lada', 'landrover', 'stocktruck', 'farmbike',
];
/**
 * The twelve quick cars and old classics added after that: five in specs-sports.ts, five in
 * specs-classics.ts, and the 1995 V8 Commodore and Falcon beside their older selves in specs.ts.
 */
const SPORTS_IDS = ['gtr', 'rx7', 'ae86', 'crx', 'legacy', 'commodore', 'falcon'];
const CLASSIC_IDS = ['escort', 'monaro', 'charger', 'morrie', 'm325'];
const CONTRACT_IDS = [...ORIGINAL_IDS, ...ADDED_IDS, ...SPORTS_IDS, ...CLASSIC_IDS];

/** Real marques and model names that must never appear in a vehicle name. */
const REAL_NAMES = [
  'holden', 'ford', 'falcon', 'commodore', 'kingswood', 'statesman', 'monaro', 'torana', 'fairlane', 'fairmont', 'cortina', 'escort', 'laser', 'telstar', 'transit', 'courier',
  'toyota', 'corolla', 'corona', 'camry', 'celica', 'supra', 'starlet', 'cressida', 'hilux', 'hiace', 'landcruiser',
  'nissan', 'datsun', 'skyline', 'silvia', 'bluebird', 'pulsar', 'sunny', 'navara', 'patrol', 'cefiro', 'laurel',
  'honda', 'civic', 'accord', 'prelude', 'integra', 'mazda', 'familia', 'capella', 'savanna', 'bongo',
  'mitsubishi', 'lancer', 'galant', 'mirage', 'sigma', 'subaru', 'legacy', 'impreza', 'leone', 'brumby',
  'suzuki', 'swift', 'isuzu', 'daihatsu', 'charade', 'yamaha', 'kawasaki', 'ducati', 'triumph', 'norton', 'bsa', 'harley',
  'bedford', 'leyland', 'austin', 'morris', 'mini', 'hillman', 'vauxhall', 'rover', 'jaguar', 'commer', 'bristol', 'hino', 'fuso', 'volvo', 'scania', 'man', 'mack',
  // Added with the 1995 roster: every marque and model the research turned up (docs/RESEARCH.md, docs/research/).
  'belmont', 'premier', 'berlina', 'calais', 'royale', 'barina', 'gemini', 'rodeo', 'jackaroo', 'camira', 'sunbird', 'chevette', 'viva', 'victor', 'cresta', 'velox',
  'ltd', 'zephyr', 'zodiac', 'anglia', 'prefect', 'consul', 'capri', 'sierra', 'econovan', 'fiesta', 'granada', 'xr6', 'xr8',
  'crown', 'cressida', 'mark', 'chaser', 'tercel', 'sprinter', 'levin', 'trueno', 'liteace', 'townace', 'surf', 'mr2', 'carina', 'soarer', 'tiara', 'toyopet',
  'sentra', 'micra', 'march', 'vanette', 'urvan', 'homy', 'stanza', 'violet', 'maxima', 'gloria', 'cedric', 'prince', 'fairlady', 'terrano', 'safari',
  'city', 'legend', 'crx', 'ballade', 'quint', 'concerto', 'luce', 'cosmo', 'astina', 'eunos', 'titan', 'proceed',
  'colt', 'eterna', 'chariot', 'starion', 'pajero', 'delica', 'canter', 'verada', 'magna', 'tredia', 'cordia', 'v3000', 'geneva', 'diamante',
  'omega', 'brat', 'justy', 'rex', 'sambar', 'alto', 'carry', 'cultus', 'vitara', 'jimny', 'samurai', 'mira', 'rocky', 'bighorn', 'forward', 'elf',
  'hunter', 'avenger', 'imp', 'minx', 'humber', 'sunbeam', 'singer', 'rootes', 'talbot', 'marina', 'allegro', 'minor', 'oxford', 'cambridge', 'princess', 'metro', 'maestro', 'montego',
  'wolseley', 'riley', 'mg', 'standard', 'vanguard', 'herald', 'dolomite', 'stag', 'daimler', 'sovereign', 'bentley', 'reliant', 'lotus', 'landrover', 'defender', 'range',
  'beetle', 'golf', 'passat', 'opel', 'kadett', 'simca', 'trabant', 'volga', 'moskvich', 'niva', 'riva', 'zhiguli', 'zastava', 'yugo', 'alfa', 'lancia', 'ferrari',
  'acco', 'international', 'kenworth', 'freightliner', 'ud', 'erf', 'foden', 'thames', 'karrier', 'aec', 'daf', 'iveco', 'hess', 'designline', 'ritchies', 'intercity', 'newmans',
  'vincent', 'velocette', 'matchless', 'ariel', 'enfield', 'bonneville', 'commando', 'sportster', 'katana', 'ninja', 'goldwing', 'vespa', 'lambretta', 'bultaco', 'husqvarna', 'ktm',
  'massey', 'ferguson', 'fordson', 'deere', 'case', 'fiat', 'zetor', 'kubota', 'nuffield', 'steyr', 'studebaker', 'rambler', 'plymouth', 'buick', 'cadillac', 'mercury', 'lincoln', 'jeep', 'amc',
  'chrysler', 'valiant', 'dodge', 'chevrolet', 'pontiac', 'bmw', 'mercedes', 'audi', 'volkswagen', 'vw', 'kombi', 'porsche', 'fiat', 'peugeot', 'renault', 'citroen', 'saab', 'lada', 'skoda',
  // Added with the quick cars and the classics.
  'charger', 'pacer', 'regal', 'ranger', 'sandman', 'liberty', 'rx7', 'ae86', 'gtr', 'm325i', 'm3', 'mexico', 'rs2000',
];

/**
 * Meshes per vehicle up close, wheels included. Ten is the rule: paint, glass, trim, head lamps, tail
 * lamps, number plates and four wheels. Signwriting, beacons, the truck's timber, the bus's blind and the
 * diced bumper sticker beside the rear plate are extra.
 */
const MESH_BUDGET: Record<string, number> = { police: 14, van: 12, farmtruck: 12, bus: 13, trafficcar: 14, taxi: 13, stocktruck: 13, landrover: 12, import: 12 };
/**
 * And beyond `LOD_RANGE`, where the wheels are part of the body: paint, glass, trim, head lamps, tail
 * lamps. The patrol car keeps its two beacons, the van its signwriting, the truck its timber, the bus its
 * blind and name.
 */
const FAR_MESH_BUDGET: Record<string, number> = { police: 7, van: 6, farmtruck: 6, bus: 7, trafficcar: 7, taxi: 6, stocktruck: 7, landrover: 6, import: 6 };

/** A model's meshes as drawn up close, or from beyond the level-of-detail range. */
const drawn = (model: VehicleModel, distant: boolean) =>
  meshes(model).filter((mesh) => {
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (distant ? o.userData.near : o.userData.far) return false;
    return true;
  });

/** Material library stand-in: caches like the real one so merged batches (draw calls) are realistic. */
function stubMaterials(): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const cached = (key: string) => {
    let material = cache.get(key);
    if (!material) cache.set(key, (material = new THREE.MeshStandardMaterial()));
    return material;
  };
  return {
    get: (surface, options) => cached(`get|${surface}|${JSON.stringify(options ?? {})}`),
    windows: (kind) => cached(`windows|${kind}`),
    emitter: (color, mode) => cached(`emitter|${color}|${mode}`),
    sign: (text, options) => cached(`sign|${text}|${JSON.stringify(options ?? {})}`),
    register: (material) => material,
    release: () => undefined,
  };
}

function meshes(model: VehicleModel): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  model.group.traverse((o) => {
    if (o instanceof THREE.Mesh) list.push(o);
  });
  return list;
}

const triangles = (mesh: THREE.Mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;

/** Several builds per spec, so the optional details (dog, signwriting, sheep, bull bar…) are all exercised. */
function builds(spec: VehicleSpec, count = 14): VehicleModel[] {
  const materials = stubMaterials();
  return Array.from({ length: count }, (_, i) => VEHICLE_MODELS[spec.model](spec, spec.colors[i % spec.colors.length], materials));
}

describe('vehicle roster', () => {
  // `VEHICLE_COUNTS=1 pnpm exec vitest run src/vehicles/models/roster.test.ts` prints the table.
  it('reports mesh and triangle counts on request', () => {
    const rows = VEHICLE_SPECS.map((spec) => {
      const models = builds(spec, 12);
      const column = (distant: boolean) => {
        const lists = models.map((model) => drawn(model, distant));
        const most = (count: (list: THREE.Mesh[]) => number) => Math.max(...lists.map(count));
        const tris = most((list) => list.reduce((sum, mesh) => sum + triangles(mesh), 0));
        return `meshes ${String(most((list) => list.length)).padStart(2)}  shadow casters ${most((list) => list.filter((mesh) => mesh.castShadow).length)}  triangles ${String(tris).padStart(5)}`;
      };
      return `${spec.id.padEnd(10)} near: ${column(false)}   far: ${column(true)}`;
    });
    expect(rows.length).toBe(VEHICLE_SPECS.length);
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VEHICLE_COUNTS) console.log('\n' + rows.join('\n'));
  });

  it('has exactly the forty-two contract ids, once each, the original eleven among them', () => {
    for (const id of ORIGINAL_IDS) expect(VEHICLE_SPECS.some((s) => s.id === id), id).toBe(true);
    expect(VEHICLE_SPECS.map((s) => s.id).sort()).toEqual([...CONTRACT_IDS].sort());
  });

  it('uses invented names only', () => {
    for (const spec of VEHICLE_SPECS) {
      for (const real of REAL_NAMES) expect(spec.name, `${spec.id} is called "${spec.name}"`).not.toMatch(new RegExp(`\\b${real}\\b`, 'i'));
    }
    expect(new Set(VEHICLE_SPECS.map((s) => s.name)).size).toBe(VEHICLE_SPECS.length);
  });

  it('lists as metallic only colours that are in the roster', () => {
    const all = new Set(VEHICLE_SPECS.flatMap((s) => s.colors));
    for (const color of METALLIC) expect(all.has(color), `0x${color.toString(16)}`).toBe(true);
  });

  it('keeps the spec data sane', () => {
    for (const spec of VEHICLE_SPECS) {
      const label = spec.id;
      expect(spec.colors.length, label).toBeGreaterThan(0);
      expect(spec.mass, label).toBeGreaterThan(100);
      expect(spec.health, label).toBeGreaterThan(0);
      expect(spec.topSpeed, label).toBeGreaterThan(spec.reverseSpeed);
      expect(spec.wheelbase, label).toBeLessThan(spec.length - spec.wheelRadius * 2 + 0.01);
      // Tyres stay inside the bodywork and the suspension can carry the weight within its travel.
      if (spec.wheelCount !== 2) expect(spec.track + spec.wheelWidth, label).toBeLessThanOrEqual(spec.width);
      expect(9.81 / (4 * spec.suspensionStiffness), label).toBeLessThan(spec.suspensionTravel);
      for (const weight of Object.values(spec.spawn)) expect(weight, label).toBeGreaterThan(0);
      // Patrol cars (the white town car and the black and white ex-traffic car) are never ambient traffic.
      expect(spec.traffic, label).toBe(spec.cls !== 'police');
      for (const weight of Object.values(spec.spawnBy ?? {})) expect(weight, label).toBeGreaterThanOrEqual(0);
      if (spec.traffic) expect(Object.keys(spec.spawn).length, label).toBeGreaterThan(0);
    }
    const by = new Map(VEHICLE_SPECS.map((s) => [s.id, s]));
    expect(by.get('v8sedan')!.rearGripBias).toBeLessThan(0.85);
    expect(by.get('hatch')!.drive).toBe('fwd');
    expect(by.get('bike')!.wheelCount).toBe(2);
    expect(Object.keys(by.get('police')!.spawn)).toEqual([]);
    expect(by.get('trafficcar')!.cls).toBe('police');
    expect(Object.keys(by.get('trafficcar')!.spawn)).toEqual([]);
    expect(Object.keys(by.get('bus')!.spawn).sort()).toEqual(['cbd', 'shops']);
    expect(by.get('bike')!.health).toBeLessThan(by.get('hatch')!.health);
    expect(by.get('bus')!.mass).toBeGreaterThan(by.get('farmtruck')!.mass);
  });

  for (const spec of VEHICLE_SPECS) {
    describe(`${spec.id} (${spec.name})`, () => {
      it('has a model builder', () => {
        expect(VEHICLE_MODELS[spec.model], `builder "${spec.model}"`).toBeTypeOf('function');
      });

      const models = VEHICLE_MODELS[spec.model] ? builds(spec) : [];

      it('returns the right wheels and seats', () => {
        for (const model of models) {
          expect(model.wheels.length).toBe(spec.wheelCount);
          for (const wheel of model.wheels) expect(wheel.parent, 'wheel pivots hang directly off the model group').toBe(model.group);
          expect(model.seats.length).toBe(spec.seats);
          // Right-hand drive: the driver sits on the right, which is local −x.
          expect(model.seats[0].x).toBeLessThan(0);
          for (const seat of model.seats) {
            expect(Math.abs(seat.x)).toBeLessThan(spec.width / 2);
            expect(Math.abs(seat.z)).toBeLessThan(spec.length / 2);
            // The seat position is under the seated figure's hips; its head is 1.05 m above it.
            expect(seat.y).toBeGreaterThan(0.1);
            if (spec.wheelCount !== 2) expect(seat.y + 1.05, 'head under the roof').toBeLessThan(spec.height - 0.04);
            expect(seat.y).toBeLessThan(spec.height);
          }
          const [a, b, c, d] = model.wheels.map((w) => w.position);
          if (spec.wheelCount === 2) {
            // Bikes: [front, rear] on the centreline, with a steering pivot.
            expect(a.z).toBeCloseTo(spec.wheelbase / 2, 5);
            expect(b.z).toBeCloseTo(-spec.wheelbase / 2, 5);
            expect(a.x).toBe(0);
            expect(model.steerPivot).toBeInstanceOf(THREE.Object3D);
          } else {
            // FL, FR, RL, RR with "left" at +x; extra wheels belong to the rear axle.
            expect([Math.sign(a.x), Math.sign(b.x), Math.sign(c.x), Math.sign(d.x)]).toEqual([1, -1, 1, -1]);
            expect(a.x).toBeCloseTo(spec.track / 2, 5);
            for (const p of [a, b]) expect(p.z).toBeCloseTo(spec.wheelbase / 2, 5);
            for (const w of model.wheels.slice(2)) expect(w.position.z).toBeCloseTo(-spec.wheelbase / 2, 5);
          }
          for (const w of model.wheels) expect(w.position.y).toBeCloseTo(spec.wheelRadius, 5);
        }
      });

      it('matches the spec size and sits on the ground', () => {
        for (const model of models) {
          const box = new THREE.Box3().setFromObject(model.group, true);
          const size = box.getSize(new THREE.Vector3());
          expect(Math.abs(size.z / spec.length - 1), `length ${size.z.toFixed(2)} vs ${spec.length}`).toBeLessThan(0.15);
          expect(Math.abs(size.x / spec.width - 1), `width ${size.x.toFixed(2)} vs ${spec.width}`).toBeLessThan(0.15);
          expect(Math.abs(size.y / spec.height - 1), `height ${size.y.toFixed(2)} vs ${spec.height}`).toBeLessThan(0.15);
          expect(Math.abs(box.min.y), `lowest point ${box.min.y.toFixed(3)}`).toBeLessThan(0.02);
          // Centred on the origin, so the physics box (which is) lines up with what you see.
          expect(Math.abs(box.min.x + box.max.x) / 2).toBeLessThan(0.03);
          expect(Math.abs(box.min.z + box.max.z) / 2).toBeLessThan(0.12);
        }
      });

      it('stays inside the render budget', () => {
        const heavy = spec.id === 'bus' || spec.id === 'farmtruck' || spec.id === 'stocktruck';
        for (const model of models) {
          const near = drawn(model, false);
          const far = drawn(model, true);
          const count = (list: THREE.Mesh[]) => list.reduce((sum, mesh) => sum + triangles(mesh), 0);
          // Draw calls matter more than triangles: every mesh is drawn again in each shadow pass.
          expect(near.length, 'meshes up close').toBeLessThanOrEqual(MESH_BUDGET[spec.id] ?? 11);
          expect(count(near), 'triangles up close').toBeLessThanOrEqual(heavy ? 18000 : 15000);
          // The distant version is what a street of traffic is made of: half the draw calls of the
          // round-2 models and under a third of their triangles.
          expect(far.length, 'meshes from a distance').toBeLessThanOrEqual(FAR_MESH_BUDGET[spec.id] ?? 5);
          expect(count(far), 'triangles from a distance').toBeLessThanOrEqual(heavy ? 2600 : 2200);
          expect(far.length, 'a distant version').toBeLessThan(near.length);
          for (const list of [near, far]) {
            expect(list.some((mesh) => mesh.castShadow), 'something casts a shadow').toBe(true);
            expect(list.filter((mesh) => mesh.castShadow).length, 'shadow casters').toBeLessThanOrEqual(7);
          }
          // Only the detailed version shows until the renderer has asked the switch which to draw.
          const list = meshes(model);
          for (const mesh of list) expect(mesh.visible, 'distant meshes start hidden').toBe(!mesh.userData.far);
          for (const mesh of list) if ((mesh.material as THREE.Material).transparent) expect(mesh.castShadow, 'glass casts no shadow').toBe(false);
          for (const mesh of list) {
            const position = mesh.geometry.getAttribute('position');
            expect(position.count).toBeGreaterThan(0);
            expect(mesh.geometry.getAttribute('normal').count).toBe(position.count);
            expect(mesh.geometry.getAttribute('uv').count).toBe(position.count);
            expect((position.array as Float32Array).every(Number.isFinite), 'finite vertices').toBe(true);
          }
        }
      });

      it('returns the materials the vehicle system drives', () => {
        const paints = new Set<THREE.Material>();
        const geometries = new Set<THREE.BufferGeometry>();
        for (const model of models) {
          const list = meshes(model);
          const used = new Set(list.map((mesh) => mesh.material));
          expect(model.bodyMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
          expect(used.has(model.bodyMaterial!), 'paint is on the body').toBe(true);
          expect(used.has(model.headlights!), 'headlights').toBe(true);
          expect(used.has(model.taillights!), 'tail lights').toBe(true);
          // Paint (darkened when wrecked) and geometry (disposed with the vehicle) are never shared.
          expect(paints.has(model.bodyMaterial!)).toBe(false);
          paints.add(model.bodyMaterial!);
          for (const mesh of list) {
            expect(geometries.has(mesh.geometry)).toBe(false);
            geometries.add(mesh.geometry);
          }
          // Clear-coated paint, and a wreck (the vehicle system sets roughness 0.95) loses its lacquer.
          const paint = model.bodyMaterial as THREE.MeshPhysicalMaterial;
          expect(paint.clearcoat).toBe(1);
          if (model === models[models.length - 1]) {
            paint.roughness = 0.95;
            expect(paint.roughness).toBe(0.95);
            expect(paint.clearcoat).toBe(0);
          }
          if (spec.cls === 'police') {
            expect(model.beacons?.length).toBe(2);
            expect(model.beacons![0]).not.toBe(model.beacons![1]);
            for (const beacon of model.beacons!) {
              expect(used.has(beacon)).toBe(true);
              expect(beacon.emissiveIntensity).toBe(0);
              expect(beacon.emissive.getHex()).toBe(beacon.color.getHex());
            }
          } else {
            expect(model.beacons).toBeUndefined();
          }
        }
      });
    });
  }
});
