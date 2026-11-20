import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Actor, CityId, District, DistrictType, GameContext, Vehicle, VehicleClass, VehicleSpec } from '../core/types';
import { VEHICLE_SPECS } from '../vehicles/specs';
import { footprintsOverlap, STAND_IN_KINDS, STAND_INS, standInSpec, StandIns, type StandIn } from './standins';

/**
 * The scenery cars of car parks against a stand-in game: a player position, a vehicle list that spawns and
 * removes plain objects, a district, and instanced meshes with nothing to draw them. No physics: the collider
 * hook only records what it is asked.
 */

const spec = (id: string, cls: VehicleClass, spawn: Partial<Record<DistrictType, number>> = { shops: 1 }, extra: Partial<VehicleSpec> = {}): VehicleSpec =>
  ({ id, name: id, cls, model: cls, length: 4.5, width: 1.7, height: 1.4, health: 100, colors: [0x111111, 0x222222, 0x333333], traffic: true, spawn, ...extra }) as unknown as VehicleSpec;

const ROSTER = [
  spec('saloon', 'sedan'),
  spec('fastback', 'coupe'),
  spec('runabout', 'hatch'),
  spec('estate', 'wagon', { rural: 1 }),
  spec('panel', 'van', { industrial: 1 }),
  spec('taxi', 'sedan', { shops: 3 }),
  spec('patrol', 'police', {}, { traffic: false }),
  spec('coach', 'bus', { shops: 1 }),
  spec('lorry', 'truck', { shops: 1 }),
  spec('trail', 'bike', { shops: 1 }),
  spec('tray', 'ute', { shops: 1 }),
];

interface Game {
  ctx: GameContext;
  standIns: StandIns;
  vehicles: Vehicle[];
  player: { position: THREE.Vector3; vehicle: Vehicle | null };
  district: District;
  /** Ground height, whether the ground is loaded, and whether a spawn succeeds. */
  world: { ground: number; loaded: boolean; spawns: boolean };
  mesh: THREE.InstancedMesh;
  /** A scenery car registered with chunk 1 (or another), in the next free slot of the mesh. */
  car(x: number, z: number, options?: Partial<Pick<StandIn, 'kind' | 'heading' | 'tint' | 'y' | 'scale'>> & { chunk?: number }): StandIn;
  /** Run this many ticks. */
  run(ticks?: number): void;
  visible(s: StandIn): boolean;
  real(): StandIn[];
}

/** The same weighting as Vehicles.pickSpec (vehicles/index.ts). */
function pickSpec(specs: VehicleSpec[], district: DistrictType, rng: { next(): number }, city?: CityId | null): string {
  const weight = (s: VehicleSpec) => (s.traffic ? (s.spawn[district] ?? 0) * (s.spawnBy?.[city ?? 'country'] ?? 1) : 0);
  let total = 0;
  for (const s of specs) total += weight(s);
  if (total <= 0) return specs[0].id;
  let r = rng.next() * total;
  let last = specs[0].id;
  for (const s of specs) {
    const w = weight(s);
    if (w <= 0) continue;
    last = s.id;
    r -= w;
    if (r <= 0) return s.id;
  }
  return last;
}

function makeGame(roster: VehicleSpec[] = ROSTER): Game {
  const vehicles: Vehicle[] = [];
  const player = { position: new THREE.Vector3(), vehicle: null as Vehicle | null };
  const district: District = { id: 'test', name: 'Testville', city: 'christchurch', type: 'shops' };
  const world = { ground: 0, loaded: true, spawns: true };
  const specs = new Map(roster.map((s) => [s.id, s]));
  let nextId = 1;
  const ctx = {
    player,
    world: { groundAt: () => world.ground, districtAt: () => district, isLoaded: () => world.loaded },
    vehicles: {
      specs,
      all: vehicles,
      spawn(id: string, x: number, z: number, heading: number, options: { color?: number; controller?: Vehicle['controller']; tags?: string[] } = {}) {
        const s = specs.get(id);
        if (!s) throw new Error(`Unknown vehicle spec "${id}"`);
        if (!world.spawns) return null;
        const v = { id: nextId++, spec: s, position: new THREE.Vector3(x, world.ground + 0.6, z), heading, driver: null, passengers: [], health: s.health, destroyed: false, burning: false, color: options.color, controller: options.controller ?? 'none', tags: new Set(options.tags ?? []), controls: { throttle: 0, brake: 0, steer: 0, handbrake: false } } as unknown as Vehicle;
        vehicles.push(v);
        return v;
      },
      remove(v: Vehicle) {
        const i = vehicles.indexOf(v);
        if (i >= 0) vehicles.splice(i, 1);
      },
      pickSpec: (type: DistrictType, rng: { next(): number }, city?: CityId | null) => pickSpec(roster, type, rng, city),
    },
  } as unknown as GameContext;

  let handle = 1;
  const standIns = new StandIns((s, solid) => {
    s.collider = solid ? (s.collider ?? ({ handle: handle++ } as unknown as StandIn['collider'])) : null;
  });
  standIns.attach(ctx);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 64);
  let slot = 0;
  const m = new THREE.Matrix4();
  return {
    ctx,
    standIns,
    vehicles,
    player,
    district,
    world,
    mesh,
    car(x, z, options = {}) {
      const { chunk = 1, kind = 'car-parked', heading = 0, tint = 0xb5261e, y = 0, scale = 1 } = options;
      const index = slot++;
      mesh.setMatrixAt(index, m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(scale, scale, scale)));
      const box = { x, y: y + 0.7, z, hx: 0.84, hy: 0.7, hz: 2.1, heading };
      const s: StandIn = { kind, x, y, z, heading, scale, tint: 'tint' in options ? options.tint : tint, meshes: [mesh], index, box, collider: { handle: handle++ } as unknown as StandIn['collider'], chunk, state: 'prop', vehicle: null, spec: null, wait: 0 };
      standIns.add(chunk, s);
      return s;
    },
    run(ticks = 1) {
      for (let i = 0; i < ticks; i++) standIns.update(STAND_INS.tick);
    },
    visible(s) {
      mesh.getMatrixAt(s.index, m);
      return m.determinant() !== 0;
    },
    real: () => (standIns as unknown as { live: StandIn[] }).live,
  };
}

describe('scenery cars near the player', () => {
  it('become real vehicles nearest first, one a tick, in the same spot, facing the same way, the same colour', () => {
    const g = makeGame();
    const far = g.car(30, 0, { heading: 1.2, tint: 0x1f3f7a });
    const near = g.car(10, 0, { heading: -0.4, tint: 0xd9c23a });
    const out = g.car(60, 0);

    g.run();
    expect(g.vehicles).toHaveLength(1);
    expect(near.state).toBe('live');
    expect(far.state).toBe('prop');
    const v = g.vehicles[0];
    expect([v.position.x, v.position.z, v.heading, v.color]).toEqual([10, 0, -0.4, 0xd9c23a]);
    expect([...v.tags]).toEqual(['parked']);
    expect(v.controller).toBe('none');
    expect(v.controls.handbrake).toBe(true);
    // The scenery it replaces is hidden and no longer solid.
    expect(g.visible(near)).toBe(false);
    expect(near.collider).toBeNull();
    expect(g.visible(far)).toBe(true);

    g.run();
    expect(g.vehicles).toHaveLength(2);
    expect(far.vehicle).toBe(g.vehicles[1]);

    // Beyond the radius: left as scenery however long the player stands there.
    g.run(20);
    expect(g.vehicles).toHaveLength(2);
    expect(out.state).toBe('prop');
    expect(out.collider).not.toBeNull();
  });

  it('does nothing between ticks, and nothing until the ground under the car is loaded', () => {
    const g = makeGame();
    const s = g.car(10, 0);
    g.standIns.update(STAND_INS.tick * 0.4);
    expect(g.vehicles).toHaveLength(0);
    g.world.loaded = false;
    g.run(3);
    expect(s.state).toBe('prop');
    g.world.loaded = true;
    g.run();
    expect(s.state).toBe('live');
  });

  it('keeps to the cap, and swaps the farthest for a nearer one that is waiting', () => {
    const g = makeGame();
    // A row of twelve, 2.8 m apart, the player at its west end.
    const row = Array.from({ length: 12 }, (_, i) => g.car(3 + i * 2.8, 5));
    g.run(30);
    expect(g.vehicles).toHaveLength(STAND_INS.cap);
    expect(row.map((s) => s.state === 'live')).toEqual(row.map((_, i) => i < STAND_INS.cap));

    // Walk to the east end: the cars there become real and the ones left behind go back to scenery.
    g.player.position.set(3 + 11 * 2.8, 0, 0);
    g.run(30);
    expect(g.vehicles).toHaveLength(STAND_INS.cap);
    expect(row.map((s) => s.state === 'live')).toEqual(row.map((_, i) => i >= 12 - STAND_INS.cap));
    for (const s of row) {
      expect(g.visible(s)).toBe(s.state === 'prop');
      expect(s.collider === null).toBe(s.state === 'live');
    }
    // Standing still, nothing more changes hands.
    const before = g.vehicles.slice();
    g.run(30);
    expect(g.vehicles).toEqual(before);
  });

  it('does not swap for a stand-in that is barely nearer', () => {
    const g = makeGame();
    // A row across the player's front, the end cars the farthest.
    for (let i = 0; i < STAND_INS.cap; i++) g.car((i - (STAND_INS.cap - 1) / 2) * 2.8, 10);
    g.run(STAND_INS.cap);
    expect(g.vehicles).toHaveLength(STAND_INS.cap);
    const before = g.vehicles.slice();
    const farthest = Math.hypot(((STAND_INS.cap - 1) / 2) * 2.8, 10);
    g.car(0, -(farthest - STAND_INS.swapMargin + 0.5));
    g.run(10);
    expect(g.vehicles).toEqual(before);
    const reach = farthest - STAND_INS.swapMargin - 0.5;
    const nearer = g.car(3, -Math.sqrt(reach * reach - 9));
    g.run(10);
    expect(g.vehicles).toHaveLength(STAND_INS.cap);
    expect(nearer.state).toBe('live');
  });

  it('turns an untouched one back into scenery only well beyond where it was promoted', () => {
    const g = makeGame();
    const s = g.car(0, 0, { heading: 0.7 });
    const original = new THREE.Matrix4();
    g.mesh.getMatrixAt(s.index, original);
    g.player.position.set(STAND_INS.promote + 1, 0, 0);
    g.run(5);
    expect(s.state).toBe('prop');
    g.player.position.set(STAND_INS.promote - 1, 0, 0);
    g.run();
    expect(s.state).toBe('live');
    const first = g.vehicles[0];

    // Between the two radii it stays real.
    g.player.position.set(STAND_INS.demote - 1, 0, 0);
    g.run(20);
    expect(g.vehicles).toEqual([first]);

    // Past the outer one: the vehicle goes, the instance is back exactly where it was and solid again.
    g.player.position.set(STAND_INS.demote + 1, 0, 0);
    g.run();
    expect(g.vehicles).toHaveLength(0);
    expect(s.state).toBe('prop');
    expect(s.vehicle).toBeNull();
    expect(s.collider).not.toBeNull();
    const restored = new THREE.Matrix4();
    g.mesh.getMatrixAt(s.index, restored);
    restored.elements.forEach((e, i) => expect(e).toBeCloseTo(original.elements[i], 5));

    // Coming back in to the same distance does not bring it back; coming inside the inner radius does, as the same car.
    g.player.position.set(STAND_INS.demote - 1, 0, 0);
    g.run(20);
    expect(g.vehicles).toHaveLength(0);
    g.player.position.set(5, 0, 0);
    g.run();
    expect(g.vehicles).toHaveLength(1);
    expect(g.vehicles[0]).not.toBe(first);
    expect(g.vehicles[0].spec.id).toBe(first.spec.id);
    expect(g.vehicles[0].color).toBe(first.color);
    expect(STAND_INS.demote - STAND_INS.promote).toBeGreaterThanOrEqual(10);
  });

  const TOUCHES: [string, (v: Vehicle, g: Game) => void][] = [
    ['entered', (v) => (v.driver = { kind: 'player' } as unknown as Actor)],
    ['carrying a passenger', (v) => v.passengers.push({ kind: 'ped' } as unknown as Actor)],
    ['driven by something', (v) => (v.controller = 'mission')],
    ['shunted half a metre', (v) => (v.position.x += 0.5)],
    ['turned on the spot', (v) => (v.heading += 0.15)],
    ['damaged', (v) => (v.health -= 1)],
    ['on fire', (v) => (v.burning = true)],
    ['destroyed', (v) => (v.destroyed = true)],
    ['claimed by a mission', (v) => v.tags.add('mission')],
    ['owned by the player', (v) => v.tags.add('owned')],
  ];
  for (const [what, touch] of TOUCHES) {
    it(`lets go of one that has been ${what}: it stays when the player leaves and its bay stays empty`, () => {
      const g = makeGame();
      const s = g.car(5, 0);
      g.run();
      const v = g.vehicles[0];
      touch(v, g);
      g.run();
      expect(s.state).toBe('gone');
      expect(v.tags.has('parked')).toBe(false);
      g.player.position.set(80, 0, 0);
      g.run(20);
      expect(g.vehicles).toEqual([v]);
      expect(g.visible(s)).toBe(false);
      expect(s.collider).toBeNull();
      // Back beside the bay: no second car appears in it.
      g.player.position.set(0, 0, 0);
      g.run(20);
      expect(g.vehicles).toEqual([v]);
      // A touched one no longer counts towards the cap.
      expect(g.real()).toHaveLength(0);
    });
  }

  it('settling on its springs is not a touch', () => {
    const g = makeGame();
    const s = g.car(5, 0, { heading: 3 });
    g.run();
    const v = g.vehicles[0];
    v.position.x += 0.2;
    v.position.y -= 0.15;
    // The same heading, read back the other way round the circle.
    v.heading = 3 + 0.05 - Math.PI * 2;
    g.run(5);
    expect(s.state).toBe('live');
  });

  it('tidies an abandoned one away as traffic would: far off, on unloaded ground, or a wreck after a minute', () => {
    const g = makeGame();
    g.car(5, 0);
    g.car(5, 6);
    g.car(5, 12);
    g.run(3);
    const [taken, wreck, mission] = g.vehicles;
    taken.position.x += 2;
    wreck.destroyed = true;
    mission.tags.add('mission');
    g.run();

    // A wreck goes a minute after it was destroyed, once the player is far enough off.
    g.player.position.set(STAND_INS.wreckDistance + 10, 0, 0);
    g.run(Math.round(STAND_INS.wreckSeconds / STAND_INS.tick) - 20);
    expect(g.vehicles).toContain(wreck);
    g.run(40);
    expect(g.vehicles).not.toContain(wreck);
    expect(g.vehicles).toContain(taken);

    // The rest when the player is a long way off, but never a mission's car.
    g.player.position.set(STAND_INS.despawn - 10, 0, 0);
    g.run(5);
    expect(g.vehicles).toContain(taken);
    g.player.position.set(STAND_INS.despawn + 10, 0, 0);
    g.run();
    expect(g.vehicles).toEqual([mission]);
    mission.tags.delete('mission');
    g.run();
    expect(g.vehicles).toHaveLength(0);
  });

  it('never tidies away the car the player is in, or one with somebody else at the wheel', () => {
    const g = makeGame();
    g.car(5, 0);
    g.car(5, 6);
    g.car(5, 12);
    g.run(3);
    const [mine, police, ridden] = g.vehicles;
    mine.driver = { kind: 'player' } as unknown as Actor;
    mine.controller = 'player';
    g.player.vehicle = mine;
    police.controller = 'police';
    ridden.passengers.push({ kind: 'ped' } as unknown as Actor);
    g.run();
    g.world.loaded = false;
    g.player.position.set(1000, 0, 0);
    g.run(20);
    expect(g.vehicles).toEqual([mine, police, ridden]);

    // Left where the ground has since unloaded: gone.
    g.player.vehicle = null;
    mine.driver = null;
    mine.controller = 'none';
    g.player.position.set(mine.position.x + 20, 0, 0);
    g.run();
    expect(g.vehicles).toEqual([police, ridden]);
  });

  it('forgets one that something else removed, and leaves the spot clear', () => {
    const g = makeGame();
    const s = g.car(5, 0);
    g.run();
    g.ctx.vehicles.remove(g.vehicles[0]);
    g.run(20);
    expect(g.vehicles).toHaveLength(0);
    expect(s.state).toBe('gone');
    expect(g.visible(s)).toBe(false);
    expect(s.collider).toBeNull();
  });

  it('takes untouched vehicles with their chunk when it unloads, and leaves touched ones to be tidied', () => {
    const g = makeGame();
    g.car(5, 0, { chunk: 7 });
    g.car(5, 6, { chunk: 7 });
    const other = g.car(5, 12, { chunk: 8 });
    g.car(45, 0, { chunk: 7 });
    g.run(3);
    const [untouched, taken, elsewhere] = g.vehicles;
    taken.position.z += 3;

    g.standIns.dropChunk(7);
    expect(g.vehicles).toEqual([taken, elsewhere]);
    expect(untouched.tags.has('parked')).toBe(true);
    expect(other.state).toBe('live');
    // Nothing of the dropped chunk is promoted again.
    g.player.position.set(30, 0, 0);
    g.run(10);
    expect(g.vehicles).toEqual([taken, elsewhere]);
    // The touched one is still ours to clear away.
    g.player.position.set(STAND_INS.despawn + 50, 0, 0);
    g.run();
    expect(g.vehicles).toHaveLength(0);
    g.standIns.dropChunk(7);
  });

  it('puts the scenery back if the vehicle cannot be spawned, and tries again later', () => {
    const g = makeGame();
    const s = g.car(5, 0);
    g.world.spawns = false;
    g.run();
    expect(s.state).toBe('prop');
    expect(g.visible(s)).toBe(true);
    expect(s.collider).not.toBeNull();
    g.world.spawns = true;
    g.run(Math.ceil(STAND_INS.retry / STAND_INS.tick) + 1);
    expect(s.state).toBe('live');
  });

  it('leaves a car standing on a built surface, or a scaled one, as scenery', () => {
    const g = makeGame();
    const deck = g.car(5, 0, { y: 1.2 });
    const toy = g.car(5, 6, { scale: 0.5 });
    const kerb = g.car(5, 12, { y: 0.2 });
    g.run(10);
    expect(deck.state).toBe('fixed');
    expect(toy.state).toBe('fixed');
    expect(kerb.state).toBe('live');
    expect(g.vehicles).toHaveLength(1);
    expect(g.visible(deck)).toBe(true);
    expect(deck.collider).not.toBeNull();
  });

  it('waits while another vehicle is hard up against the spot, without holding up the next one', () => {
    const g = makeGame();
    const blocked = g.car(5, 0);
    const next = g.car(5, 12);
    // Nose to tail with the scenery car's box, where the longer real car would reach.
    const parked = g.ctx.vehicles.spawn('saloon', 5, 4.45, 0)!;
    g.run(3);
    expect(blocked.state).toBe('prop');
    expect(next.state).toBe('live');
    parked.position.z = 9;
    g.run(Math.ceil(STAND_INS.retry / STAND_INS.tick) + 1);
    expect(blocked.state).toBe('live');
  });
});

describe('what a scenery car becomes', () => {
  const pick = (g: Game, kind: string, x: number, z: number) => g.ctx.vehicles.specs.get(standInSpec(g.ctx, kind, x, z)!)!;

  it('is the same every time for one spot, and varies from spot to spot', () => {
    const g = makeGame();
    const ids = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const x = 100 + i * 2.6;
      const id = standInSpec(g.ctx, 'car-parked', x, -40);
      expect(standInSpec(g.ctx, 'car-parked', x, -40)).toBe(id);
      ids.add(id!);
    }
    expect([...ids].sort()).toEqual(['fastback', 'runabout', 'saloon']);
  });

  it('keeps the class to the shape: saloons, coupes and hatches; wagons; vans', () => {
    const g = makeGame();
    for (const type of ['shops', 'rural', 'industrial'] as const) {
      g.district.type = type;
      for (let i = 0; i < 40; i++) {
        expect(['sedan', 'coupe', 'hatch']).toContain(pick(g, 'car-parked', i * 3, 7).cls);
        expect(pick(g, 'car-parked', i * 3, 7).id).not.toBe('taxi');
        // The only van and the only wagon in the roster, whether or not they drive in this district.
        expect(pick(g, 'van-parked', i * 3, 7).id).toBe('panel');
        if (type !== 'shops') expect(pick(g, 'car-parked-wagon', i * 3, 7).id).toBe('estate');
      }
    }
  });

  it('falls back from wagon to hatch to saloon by what drives in the district, and to nothing when no shape fits', () => {
    // Wagons drive only in the country: in town a wagon-shaped car is a hatch, or a saloon where there are no hatches.
    const town = [spec('saloon', 'sedan', { villa: 1 }), spec('runabout', 'hatch', { villa: 1 }), spec('estate', 'wagon', { rural: 1 }), spec('lorry', 'truck', { villa: 1 })];
    const g = makeGame(town);
    const noHatch = makeGame(town.filter((s) => s.cls !== 'hatch'));
    for (let i = 0; i < 40; i++) {
      g.district.type = noHatch.district.type = 'villa';
      expect(pick(g, 'car-parked-wagon', i * 3, 7).id).toBe('runabout');
      expect(pick(noHatch, 'car-parked-wagon', i * 3, 7).id).toBe('saloon');
      g.district.type = 'rural';
      expect(pick(g, 'car-parked-wagon', i * 3, 7).id).toBe('estate');
    }
    const noVan = makeGame(ROSTER.filter((s) => s.cls !== 'van'));
    expect(standInSpec(noVan.ctx, 'van-parked', 4, 4)).toBeNull();
    expect(standInSpec(noVan.ctx, 'skip-bin', 4, 4)).toBeNull();
    // With nothing to become, it stays scenery.
    const s = noVan.car(5, 0, { kind: 'van-parked' });
    noVan.run(5);
    expect(s.state).toBe('fixed');
    expect(noVan.vehicles).toHaveLength(0);
  });

  it('gives an untinted car a paint of its own spec, the same one each time', () => {
    const g = makeGame();
    const s = g.car(5, 0, { tint: undefined });
    g.run();
    const first = g.vehicles[0].color;
    expect(g.vehicles[0].spec.colors).toContain(first);
    g.player.position.set(100, 0, 0);
    g.run();
    g.player.position.set(0, 0, 0);
    g.run();
    expect(s.state).toBe('live');
    expect(g.vehicles[0].color).toBe(first);
  });

  it('suits every district of the real roster: only ordinary traffic cars of the right class, never a taxi', () => {
    const g = makeGame(VEHICLE_SPECS);
    const types: DistrictType[] = ['cbd', 'shops', 'villa', 'statehouse', 'industrial', 'port', 'township', 'park', 'rural', 'beach'];
    const cities: (CityId | null)[] = ['christchurch', 'timaru', 'lyttelton', 'temuka', null];
    const seen = new Set<string>();
    for (const type of types) {
      for (const city of cities) {
        g.district.type = type;
        g.district.city = city;
        for (const kind of Object.keys(STAND_IN_KINDS)) {
          const allowed = STAND_IN_KINDS[kind].flat();
          for (let i = 0; i < 25; i++) {
            const chosen = pick(g, kind, i * 2.9 - 30, i * 11);
            expect(chosen, `${kind} in ${type}`).toBeDefined();
            expect(allowed, `${chosen.id} for ${kind} in ${type}`).toContain(chosen.cls);
            expect(chosen.traffic).toBe(true);
            expect(chosen.id).not.toBe('taxi');
            if (kind === 'van-parked') expect(chosen.cls).toBe('van');
            seen.add(chosen.id);
          }
        }
      }
    }
    // Every shape the roster has turns up, and nothing but ordinary cars that drive somewhere.
    const all = STAND_IN_KINDS['car-parked'][0].concat(['wagon', 'van']);
    const eligible = VEHICLE_SPECS.filter((s) => s.traffic && s.id !== 'taxi' && all.includes(s.cls));
    for (const id of seen) expect(eligible.map((s) => s.id)).toContain(id);
    const classes = (ids: Iterable<string>) => [...new Set([...ids].map((id) => g.ctx.vehicles.specs.get(id)!.cls))].sort();
    expect(classes(seen)).toEqual(classes(eligible.map((s) => s.id)));
    expect(seen.size).toBeGreaterThan(eligible.length / 2);
  });
});

describe('footprintsOverlap', () => {
  it('tells bays side by side from cars across each other', () => {
    // Two cars 2.6 m apart, parallel: clear. 1.6 m apart: overlapping.
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 2.6, 0, 0, 0.9, 2.3)).toBe(false);
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 1.6, 0, 0, 0.9, 2.3)).toBe(true);
    // Nose to tail.
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 0, 4.7, 0, 0.9, 2.3)).toBe(false);
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 0, 4.5, 0, 0.9, 2.3)).toBe(true);
    // One across the other's nose: the corners miss only if it is far enough ahead.
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 0, 3.1, Math.PI / 2, 0.9, 2.3)).toBe(true);
    expect(footprintsOverlap(0, 0, 0, 0.9, 2.3, 0, 3.3, Math.PI / 2, 0.9, 2.3)).toBe(false);
    // Diagonal neighbours whose bounding circles overlap but whose bodies do not; the same whichever is asked.
    expect(footprintsOverlap(0, 0, 0.6, 0.9, 2.3, 2.4, -1.6, 0.6, 0.9, 2.3)).toBe(false);
    expect(footprintsOverlap(2.4, -1.6, 0.6, 0.9, 2.3, 0, 0, 0.6, 0.9, 2.3)).toBe(false);
    expect(footprintsOverlap(10, 10, 0.6, 0.9, 2.3, 10, 10, 2, 0.5, 0.5)).toBe(true);
  });
});
