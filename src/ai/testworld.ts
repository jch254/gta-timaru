import * as THREE from 'three';
import { EventBus } from '../core/events';
import type { Actor, District, DistrictType, GameContext, GameEvents, RoadGraph, Vehicle, VehicleSpec, WeaponSpec } from '../core/types';

/**
 * A stand-in game for unit tests (not used by the game itself): a road graph, a clock, an event bus, and
 * vehicles that follow their controls with a simple bicycle model. No renderer, no physics engine.
 * The humanoid rig is mocked by the tests that use this.
 */

const BASE_SPEC = {
  cls: 'sedan',
  model: 'sedan',
  length: 4.85,
  width: 1.84,
  height: 1.42,
  wheelbase: 2.8,
  steerLock: 0.58,
  topSpeed: 50,
  traffic: true,
  spawn: { cbd: 1, shops: 1, villa: 1 },
} as const;

export function makeSpec(id: string, extra: Partial<VehicleSpec> = {}): VehicleSpec {
  return { ...BASE_SPEC, id, name: id, ...extra } as unknown as VehicleSpec;
}

export interface FakeVehicle extends Vehicle {
  step(dt: number): void;
  horns: number;
}

function makeVehicle(id: number, spec: VehicleSpec, x: number, z: number, heading: number, events: EventBus<GameEvents>): FakeVehicle {
  let steerAngle = 0;
  const v = {
    id,
    spec,
    group: new THREE.Group(),
    position: new THREE.Vector3(x, 0.6, z),
    velocity: new THREE.Vector3(),
    heading,
    speed: 0,
    controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    driver: null as Actor | null,
    passengers: [] as Actor[],
    health: 100,
    destroyed: false,
    burning: false,
    color: 0,
    wheelsOnGround: 4,
    slip: 0,
    siren: false,
    headlightsOn: false,
    controller: 'none' as Vehicle['controller'],
    tags: new Set<string>(),
    horns: 0,
    body: {
      setLinvel(lv: { x: number; y: number; z: number }) {
        v.speed = lv.x * Math.sin(v.heading) + lv.z * Math.cos(v.heading);
      },
    },
    applyDamage() {},
    doorPosition(target: THREE.Vector3, seat = 0) {
      const side = seat % 2 === 0 ? -1 : 1;
      return target.set(v.position.x + Math.cos(v.heading) * side * 1.7, 0, v.position.z - Math.sin(v.heading) * side * 1.7);
    },
    seatPosition(target: THREE.Vector3) {
      return target.copy(v.position);
    },
    teleport() {},
    recover() {},
    horn() {
      v.horns++;
      events.emit('horn', { vehicle: v as unknown as Vehicle });
    },
    step(dt: number) {
      const c = v.controls;
      let accel = 0;
      if (c.throttle > 0) accel = v.speed < -1.5 ? 9 * c.throttle : 5.2 * c.throttle * (1 - Math.pow(Math.max(0, v.speed) / spec.topSpeed, 3));
      else if (c.brake > 0) accel = v.speed > 1.2 ? -9 * c.brake : v.speed > -10 ? -3.2 * c.brake : 0;
      else accel = -0.35 * Math.sign(v.speed);
      if (c.handbrake) {
        const stop = 7 * dt;
        v.speed = Math.abs(v.speed) <= stop ? 0 : v.speed - Math.sign(v.speed) * stop;
      } else v.speed += accel * dt;
      const lock = spec.steerLock / (1 + Math.abs(v.speed) * 0.052);
      const want = Math.max(-1, Math.min(1, c.steer)) * lock;
      const rate = 2 * dt * (0.6 + lock);
      steerAngle += Math.max(-rate, Math.min(rate, want - steerAngle));
      v.heading += ((v.speed * Math.tan(steerAngle)) / spec.wheelbase) * dt;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      v.position.x += sin * v.speed * dt;
      v.position.z += cos * v.speed * dt;
      v.velocity.set(sin * v.speed, 0, cos * v.speed);
      v.group.position.copy(v.position);
      v.group.rotation.y = v.heading;
    },
  };
  return v as unknown as FakeVehicle;
}

export interface TestWorld {
  ctx: GameContext;
  events: EventBus<GameEvents>;
  vehicles: FakeVehicle[];
  player: Actor & { vehicle: Vehicle | null; cameraHeading: number; damage: number };
  subtitles: { text: string; speaker?: string }[];
  sounds: string[];
  shots: { shooter: Actor; weaponId: string }[];
  punches: Actor[];
  pickups: { kind: string; x: number; z: number; amount?: number; respawn?: number; options?: { ttl?: number; drop?: boolean } }[];
  /** Advance the clock and every vehicle by one frame. Systems are updated by the caller. */
  tick(dt: number): void;
  setDistrict(type: DistrictType): void;
  /** Whether `physics.lineOfSight` reports a clear view. */
  clear: boolean;
}

export function makeTestWorld(graph: RoadGraph, specs: VehicleSpec[] = [makeSpec('statesman')]): TestWorld {
  const events = new EventBus<GameEvents>();
  const vehicles: FakeVehicle[] = [];
  const actors = new Set<Actor>();
  let nextActor = 1;
  let nextVehicle = 1;
  let handle = 1;
  const district: District = { id: 'test', name: 'Testville', city: 'christchurch', type: 'shops' };
  const subtitles: TestWorld['subtitles'] = [];
  const sounds: string[] = [];
  const shots: TestWorld['shots'] = [];
  const punches: Actor[] = [];
  const pickups: TestWorld['pickups'] = [];
  const specMap = new Map(specs.map((s) => [s.id, s]));

  const player = {
    id: nextActor++,
    kind: 'player' as const,
    group: new THREE.Group(),
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: 0,
    health: 100,
    maxHealth: 100,
    armour: 0,
    alive: true,
    vehicle: null as Vehicle | null,
    cameraHeading: 0,
    damage: 0,
    takeDamage(info: { amount: number }) {
      player.damage += info.amount;
    },
  };
  actors.add(player as unknown as Actor);

  const desc = () => {
    const d = { setTranslation: () => d, setCollisionGroups: () => d };
    return d;
  };
  const world: TestWorld = {
    ctx: null as unknown as GameContext,
    events,
    vehicles,
    player: player as unknown as TestWorld['player'],
    subtitles,
    sounds,
    shots,
    punches,
    pickups,
    clear: true,
    tick(dt: number) {
      ctx.clock.elapsed += dt;
      for (const v of vehicles) v.step(dt);
      if (player.vehicle) {
        player.position.copy(player.vehicle.position);
        player.velocity.copy(player.vehicle.velocity);
      }
    },
    setDistrict(type: DistrictType) {
      district.type = type;
    },
  };

  const ctx = {
    scene: new THREE.Scene(),
    camera: { position: new THREE.Vector3() },
    events,
    clock: { hour: 12, day: 1, elapsed: 0, secondsPerHour: 60, paused: false },
    env: { weather: 'clear', night: 0, rain: 0, wetness: 0 },
    gfx: { materials: {} },
    physics: {
      rapier: { RigidBodyDesc: { kinematicPositionBased: desc }, ColliderDesc: { capsule: desc } },
      world: {
        createRigidBody: () => ({ setNextKinematicTranslation() {}, setTranslation() {} }),
        createCollider: () => ({ handle: handle++, setCollisionGroups() {}, setEnabled() {} }),
        removeRigidBody() {},
      },
      groups: (m: number, f: number) => (m << 16) | f,
      setOwner() {},
      ownerOf: () => null,
      raycast: () => null,
      lineOfSight: () => world.clear,
    },
    world: {
      graph,
      bounds: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
      landmarks: [] as { kind: string; x: number; z: number; clearRadius: number }[],
      groundAt: () => 0,
      heightAt: () => 0,
      waterDepthAt: () => 0,
      districtAt: () => district,
      isLoaded: () => true,
    },
    player,
    actors: {
      all: actors,
      nextId: () => nextActor++,
      near: () => [],
    },
    vehicles: {
      specs: specMap,
      all: vehicles as Vehicle[],
      spawn(specId: string, x: number, z: number, heading: number, options: { controller?: Vehicle['controller']; tags?: string[] } = {}) {
        const spec = specMap.get(specId);
        if (!spec) throw new Error(`Unknown vehicle spec "${specId}"`);
        const v = makeVehicle(nextVehicle++, spec, x, z, heading, events);
        v.controller = options.controller ?? 'none';
        for (const t of options.tags ?? []) v.tags.add(t);
        vehicles.push(v);
        return v;
      },
      remove(vehicle: Vehicle) {
        const i = vehicles.indexOf(vehicle as FakeVehicle);
        if (i < 0) return;
        vehicles.splice(i, 1);
        if (vehicle.driver) vehicle.driver.vehicle = null;
        for (const p of vehicle.passengers) p.vehicle = null;
        vehicle.group.removeFromParent();
      },
      nearest(x: number, z: number, maxDistance: number, filter?: (v: Vehicle) => boolean) {
        let best: Vehicle | null = null;
        let bestD = maxDistance;
        for (const v of vehicles) {
          const d = Math.hypot(v.position.x - x, v.position.z - z);
          if (d < bestD && (!filter || filter(v))) {
            bestD = d;
            best = v;
          }
        }
        return best;
      },
      pickSpec: () => specs[0].id,
      enter(actor: Actor, vehicle: Vehicle, seat = 0) {
        if (actor.vehicle) ctx.vehicles.exit(actor);
        let ejected: Actor | null = null;
        if (seat === 0) {
          ejected = vehicle.driver;
          if (ejected) {
            ejected.vehicle = null;
            events.emit('vehicleExited', { actor: ejected, vehicle });
          }
          vehicle.driver = actor;
        } else vehicle.passengers.push(actor);
        actor.vehicle = vehicle;
        if (actor.kind === 'player' && seat === 0) {
          vehicle.controller = 'player';
          vehicle.tags.add('owned');
        }
        events.emit('vehicleEntered', { actor, vehicle, stolen: actor.kind === 'player', ejected });
      },
      exit(actor: Actor) {
        const vehicle = actor.vehicle;
        if (!vehicle) return;
        if (vehicle.driver === actor) {
          vehicle.driver = null;
          vehicle.controls.throttle = 0;
          vehicle.controls.brake = 0;
          vehicle.controls.steer = 0;
          vehicle.controls.handbrake = true;
          if (vehicle.controller === 'player') vehicle.controller = 'none';
        } else vehicle.passengers = vehicle.passengers.filter((p) => p !== actor);
        actor.vehicle = null;
        events.emit('vehicleExited', { actor, vehicle });
      },
    },
    combat: {
      weapons: new Map<string, WeaponSpec>([
        ['fists', { id: 'fists', kind: 'fists', damage: 12, rate: 2, range: 1.6 } as WeaponSpec],
        ['pistol', { id: 'pistol', kind: 'pistol', damage: 20, rate: 3, range: 45 } as WeaponSpec],
        ['rifle', { id: 'rifle', kind: 'rifle', damage: 40, rate: 1, range: 120 } as WeaponSpec],
      ]),
      fire(shooter: Actor, weaponId: string) {
        shots.push({ shooter, weaponId });
        return true;
      },
      melee(attacker: Actor) {
        punches.push(attacker);
        return null;
      },
      createWeaponModel: (id: string) => (id === 'fists' ? null : new THREE.Object3D()),
      spawnPickup(kind: string, x: number, z: number, amount?: number, respawn?: number, options?: { ttl?: number; drop?: boolean }) {
        pickups.push({ kind, x, z, amount, respawn, options });
        return () => undefined;
      },
    },
    ui: {
      subtitle(text: string, _seconds?: number, speaker?: string) {
        subtitles.push({ text, speaker });
      },
    },
    audio: {
      play(id: string) {
        sounds.push(id);
      },
    },
  } as unknown as GameContext;
  world.ctx = ctx;
  return world;
}
