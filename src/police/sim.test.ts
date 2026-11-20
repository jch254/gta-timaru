/**
 * Headless smoke test of the whole police system against a toy town: real Rapier physics and Three objects,
 * everything else faked through the contract's interfaces (flat ground, a grid of streets with blocks of
 * buildings, kinematic stand-in vehicles, the fallback autopilot because `createAutopilot` throws).
 * It cannot say whether a pursuit is fun, but it does prove the pieces run end to end, respect their caps
 * and clean up after themselves.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import {
  CollisionGroup,
  type Actor,
  type Blip,
  type DamageInfo,
  type District,
  type EdgeSample,
  type GameContext,
  type GameEvents,
  type PhysicsApi,
  type Place,
  type PoliceApi,
  type RayHit,
  type RoadEdge,
  type RoadGraph,
  type RoadHit,
  type RoadNode,
  type System,
  type Vehicle,
  type VehicleSpec,
  type WeaponSpec,
} from '../core/types';
import { createPolice } from './index';
import { MAX_ON_FOOT, MAX_POLICE_VEHICLES, MAX_ROADBLOCKS, sprayCost } from './response';
import { TUNING } from './tuning';

const STEP = 1 / 60;
const BLOCK = 200;
const GRID = 3; // nodes at -3..3 on each axis

// ───────────── Physics (the same queries the real wrapper offers) ─────────────

const ALL = CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris;

function makePhysics(): PhysicsApi {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const owners = new Map<number, Actor | Vehicle>();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const tmp = new THREE.Vector3();
  const groups = (m: number, f: number) => ((m & 0xffff) << 16) | (f & 0xffff);
  return {
    rapier: RAPIER,
    world,
    groups,
    setOwner(c, o) {
      if (o) owners.set(c.handle, o);
      else owners.delete(c.handle);
    },
    ownerOf: (c) => owners.get(c.handle) ?? null,
    raycast(origin, direction, maxDistance, options = {}): RayHit | null {
      ray.origin = origin;
      ray.dir = direction;
      const exclude = options.excludeOwner;
      const hit = world.castRayAndGetNormal(
        ray,
        maxDistance,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        groups(ALL, options.mask ?? CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character),
        undefined,
        options.excludeBody ?? undefined,
        exclude ? (c) => owners.get(c.handle) !== exclude : undefined,
      );
      if (!hit) return null;
      return {
        point: new THREE.Vector3().copy(origin).addScaledVector(direction, hit.timeOfImpact),
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        distance: hit.timeOfImpact,
        collider: hit.collider,
        owner: owners.get(hit.collider.handle) ?? null,
      };
    },
    lineOfSight(a, b) {
      const dir = tmp.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-3) return true;
      dir.multiplyScalar(1 / len);
      ray.origin = a;
      ray.dir = dir;
      return !world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(ALL, CollisionGroup.World));
    },
    addStaticBox(center, half) {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setCollisionGroups(groups(CollisionGroup.World, ALL)));
      return () => world.removeCollider(c, false);
    },
  };
}

// ───────────── A grid of streets ─────────────

function makeGraph(): RoadGraph {
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const side = GRID * 2 + 1;
  const at = (i: number, j: number) => (i + GRID) * side + (j + GRID);
  for (let i = -GRID; i <= GRID; i++) for (let j = -GRID; j <= GRID; j++) nodes[at(i, j)] = { index: at(i, j), x: i * BLOCK, y: 0, z: j * BLOCK, edges: [] };
  const add = (a: number, b: number) => {
    const na = nodes[a];
    const nb = nodes[b];
    const length = Math.hypot(nb.x - na.x, nb.z - na.z);
    const tx = (nb.x - na.x) / length;
    const tz = (nb.z - na.z) / length;
    const count = Math.round(length / 4);
    const samples: EdgeSample[] = [];
    for (let k = 0; k <= count; k++) samples.push({ x: na.x + (tx * k * length) / count, y: 0, z: na.z + (tz * k * length) / count, tx, tz, s: (k * length) / count });
    const index = edges.length;
    edges.push({ index, name: tx !== 0 ? `Row ${na.z / BLOCK} St` : `Column ${na.x / BLOCK} Ave`, cls: 'street', a, b, samples, length, width: 9.5, lanes: 1, speedLimit: 13.9, oneway: false, bridge: false, tunnel: false, footpaths: true, drivable: true });
    na.edges.push(index);
    nb.edges.push(index);
  };
  for (let i = -GRID; i <= GRID; i++) {
    for (let j = -GRID; j <= GRID; j++) {
      if (i < GRID) add(at(i, j), at(i + 1, j));
      if (j < GRID) add(at(i, j), at(i, j + 1));
    }
  }
  const pointAt = (edge: RoadEdge, s: number): EdgeSample => {
    const a = edge.samples[0];
    const c = Math.min(edge.length, Math.max(0, s));
    return { x: a.x + a.tx * c, y: 0, z: a.z + a.tz * c, tx: a.tx, tz: a.tz, s: c };
  };
  const graph: RoadGraph = {
    nodes,
    edges,
    nearest(x, z, maxDistance = 60, filter) {
      let best: RoadHit | null = null;
      for (const edge of edges) {
        if (filter && !filter(edge)) continue;
        const a = edge.samples[0];
        const s = Math.min(edge.length, Math.max(0, (x - a.x) * a.tx + (z - a.z) * a.tz));
        const px = a.x + a.tx * s;
        const pz = a.z + a.tz * s;
        const distance = Math.hypot(x - px, z - pz);
        if (distance <= maxDistance && (!best || distance < best.distance)) best = { edge, s, distance, offset: (x - px) * a.tz - (z - pz) * a.tx, x: px, y: 0, z: pz };
      }
      return best;
    },
    pointAt,
    lanePoint(edge, s, dir, lane = 0) {
      const p = pointAt(edge, s);
      const tx = p.tx * dir;
      const tz = p.tz * dir;
      const offset = (edge.lanes - 0.5 - lane) * (edge.width / (edge.lanes * 2));
      return { x: p.x + tz * offset, y: 0, z: p.z - tx * offset, heading: Math.atan2(tx, tz) };
    },
    footpathPoint(edge, s, sideOf) {
      const p = pointAt(edge, s);
      const offset = (edge.width / 2 + 1.7) * sideOf;
      return { x: p.x + p.tz * offset, y: 0, z: p.z - p.tx * offset };
    },
    endNode: (edge, dir) => nodes[dir === 1 ? edge.b : edge.a],
    route(from, to) {
      const cost = new Array<number>(nodes.length).fill(Infinity);
      const via = new Array<number>(nodes.length).fill(-1);
      const done = new Array<boolean>(nodes.length).fill(false);
      cost[from] = 0;
      for (;;) {
        let u = -1;
        for (let k = 0; k < nodes.length; k++) if (!done[k] && cost[k] < Infinity && (u < 0 || cost[k] < cost[u])) u = k;
        if (u < 0 || u === to) break;
        done[u] = true;
        for (const ei of nodes[u].edges) {
          const e = edges[ei];
          const v = e.a === u ? e.b : e.a;
          if (cost[u] + e.length < cost[v]) {
            cost[v] = cost[u] + e.length;
            via[v] = ei;
          }
        }
      }
      if (from === to) return [];
      if (via[to] < 0) return null;
      const out: { edge: RoadEdge; dir: 1 | -1 }[] = [];
      for (let n = to; n !== from; ) {
        const e = edges[via[n]];
        const dir: 1 | -1 = e.b === n ? 1 : -1;
        out.push({ edge: e, dir });
        n = dir === 1 ? e.a : e.b;
      }
      return out.reverse();
    },
    nearestNode(x, z) {
      let best = nodes[0];
      for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < Math.hypot(best.x - x, best.z - z)) best = n;
      return best;
    },
  };
  return graph;
}

// ───────────── Stand-in vehicles ─────────────

const SPEC = (id: string, seats: number): VehicleSpec => ({ id, name: id, cls: id === 'police' || id === 'trafficcar' ? 'police' : id === 'van' ? 'van' : 'sedan', model: 'sedan', length: 4.85, width: 1.84, height: 1.42, mass: 1450, wheelRadius: 0.33, wheelWidth: 0.22, wheelbase: 2.8, track: 1.54, wheelCount: 4, engineForce: 7800, topSpeed: 50, reverseSpeed: 12, drive: 'rwd', brakeForce: 1, steerLock: 0.58, grip: 1, rearGripBias: 0.9, suspensionStiffness: 28, suspensionDamping: 1, suspensionTravel: 0.22, comDrop: 0.35, seats, health: 100, colors: [0x111111, 0x222222, 0x333333], value: 1000, spawn: {}, engineSound: 'six', traffic: true });

class ToyVehicle implements Vehicle {
  readonly group = new THREE.Group();
  readonly body = null as never;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  speed = 0;
  readonly steeringLimit = 0.5;
  controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  driver: Actor | null = null;
  passengers: Actor[] = [];
  health = 100;
  destroyed = false;
  burning = false;
  color: number;
  wheelsOnGround = 4;
  slip = 0;
  siren = false;
  headlightsOn = false;
  controller: Vehicle['controller'] = 'none';
  tags = new Set<string>();
  constructor(
    readonly id: number,
    readonly spec: VehicleSpec,
  ) {
    this.color = spec.colors[0];
  }
  applyDamage() {}
  doorPosition(target: THREE.Vector3, seat = 0) {
    const across = (seat === 0 ? -1 : 1) * (this.spec.width / 2 + 0.75); // driver on the right (local −x)
    return target.set(this.position.x + Math.cos(this.heading) * across, this.position.y - 0.5, this.position.z - Math.sin(this.heading) * across);
  }
  seatPosition(target: THREE.Vector3) {
    return target.copy(this.position);
  }
  teleport(x: number, y: number, z: number, heading: number) {
    this.position.set(x, y + 0.6, z);
    this.heading = heading;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
  }
  recover() {}
  horn() {}
  /** Crude kinematic car: enough for an autopilot to drive. */
  step(dt: number) {
    const c = this.controls;
    let accel = 0;
    if (c.throttle > 0) accel = 7 * c.throttle * (1 - Math.max(0, this.speed) / this.spec.topSpeed);
    if (c.brake > 0) {
      if (this.speed > 1.2) accel -= 12 * c.brake;
      else if (c.throttle === 0) accel = -4 * c.brake * (1 - Math.abs(this.speed) / this.spec.reverseSpeed);
    }
    this.speed += accel * dt;
    this.speed -= this.speed * (c.handbrake ? 4 : 0.05) * dt;
    this.heading += ((this.speed * Math.tan(c.steer * this.steeringLimit)) / this.spec.wheelbase) * dt;
    this.velocity.set(Math.sin(this.heading) * this.speed, 0, Math.cos(this.heading) * this.speed);
    this.position.addScaledVector(this.velocity, dt);
    this.group.position.copy(this.position);
  }
}

// ───────────── The toy town ─────────────

interface Town {
  ctx: GameContext;
  police: PoliceApi & System;
  events: EventBus<GameEvents>;
  player: Actor & { money: number; aiming: boolean; controlsEnabled: boolean; warps: number };
  vehicles: ToyVehicle[];
  blips: Map<string, Blip>;
  subtitles: string[];
  banners: string[];
  prompts: string[];
  shots: { shooter: Actor; weaponId: string; origin: THREE.Vector3; direction: THREE.Vector3; from: THREE.Vector3 }[];
  heard: { type: keyof GameEvents; payload: unknown }[];
  pressed: Set<string>;
  pickups: { kind: string; x: number; z: number; amount?: number; respawn?: number; options?: { ttl?: number; drop?: boolean } }[];
  saveSlices: Map<string, { serialize: () => unknown; deserialize: (d: unknown) => void }>;
  /** Scripted player motion, called every step. */
  script: ((dt: number) => void) | null;
  baseline: { children: number; colliders: number; bodies: number };
  step(seconds: number, each?: () => void): void;
  spawnCar(x: number, z: number, heading?: number): ToyVehicle;
  drive(vehicle: ToyVehicle): void;
  cops(): Actor[];
  policeCars(): ToyVehicle[];
  addPed(x: number, z: number): Actor;
}

const CITY: District = { id: 'test', name: 'Testville', city: 'christchurch', type: 'cbd' };
const RURAL: District = { id: 'plains', name: 'Canterbury Plains', city: null, type: 'rural' };

function makeTown(options: { specs?: string[]; armed?: boolean; country?: boolean } = {}): Town {
  const physics = makePhysics();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.35, 26000);
  const events = new EventBus<GameEvents>();
  const graph = makeGraph();

  // Ground, and a block of buildings inside every square of streets (so there are corners to hide round).
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 0.5, 4000).setTranslation(0, -0.5, 0).setCollisionGroups(physics.groups(CollisionGroup.World, ALL)));
  for (let i = -GRID; i < GRID; i++) for (let j = -GRID; j < GRID; j++) physics.addStaticBox(new THREE.Vector3(i * BLOCK + 100, 10, j * BLOCK + 100), new THREE.Vector3(70, 10, 70), 0);

  const places: Place[] = [
    { id: 'test-police', name: 'Testville police station', x: -400, z: 10, heading: 0, city: 'christchurch', tags: ['police'] },
    { id: 'test-spray', name: 'Panel & paint', x: 404, z: 400, heading: 0, city: 'christchurch', tags: ['spray'] },
  ];
  // `country` pretends the whole grid is open road (rural, no town), for the patrol-variety tests.
  const inTown = (x: number, z: number) => !options.country && Math.abs(x) <= GRID * BLOCK + 50 && Math.abs(z) <= GRID * BLOCK + 50;

  const all = new Set<Actor>();
  let nextActor = 1;
  let nextVehicle = 1;
  const vehicles: ToyVehicle[] = [];
  const specs = new Map<string, VehicleSpec>();
  for (const id of options.specs ?? ['statesman', 'police', 'van']) specs.set(id, SPEC(id, id === 'van' ? 4 : 4));

  const town = {
    events,
    vehicles,
    blips: new Map<string, Blip>(),
    subtitles: [] as string[],
    banners: [] as string[],
    prompts: [] as string[],
    shots: [] as Town['shots'],
    heard: [] as Town['heard'],
    pressed: new Set<string>(),
    pickups: [] as Town['pickups'],
    saveSlices: new Map(),
    script: null,
  } as unknown as Town;

  for (const type of ['wantedChanged', 'playerBusted', 'actorDied', 'actorDamaged', 'vehicleEntered', 'vehicleExited'] as const) events.on(type, (payload) => town.heard.push({ type, payload }));

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
    money: 0,
    aiming: false,
    sprinting: false,
    controlsEnabled: true,
    cameraHeading: 0,
    warps: 0,
    takeDamage(info: DamageInfo) {
      this.health -= info.amount;
    },
    addMoney(delta: number) {
      this.money += delta;
    },
    aimDirection(target: THREE.Vector3) {
      return target.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    },
    warpIntoVehicle(v: Vehicle) {
      this.warps++;
      ctx.vehicles.enter(this, v, 0);
    },
  };
  all.add(player);
  town.player = player;

  const pistol: WeaponSpec = { id: 'pistol', name: 'Pistol', kind: 'pistol', damage: 25, rate: 3, range: 60, magazine: 12, reloadTime: 1, spread: 0.01, pellets: 1, automatic: false, driveBy: true, price: 300 };
  const fists: WeaponSpec = { ...pistol, id: 'fists', name: 'Fists', kind: 'fists' };
  const weapons = new Map<string, WeaponSpec>([['fists', fists]]);
  if (options.armed !== false) {
    weapons.set('pistol', pistol);
    weapons.set('shotgun', { ...pistol, id: 'shotgun', name: 'Shotgun', kind: 'shotgun', pellets: 8 });
  }

  const ctx = {
    scene,
    camera,
    events,
    input: { held: () => false, pressed: (a: string) => town.pressed.has(a), label: () => 'F', moveX: 0, moveZ: 0, throttle: 0, brake: 0, lookYaw: 0, lookPitch: 0, captured: true, capture() {}, release() {}, gamepadActive: false },
    clock: { hour: 12, day: 1, elapsed: 0, secondsPerHour: 60, paused: false, advanceHours() {} },
    env: { weather: 'clear', night: 0, sunDir: new THREE.Vector3(0, 1, 0), rain: 0, wetness: 0, wind: { x: 0, z: 0 }, visibility: 20000, setWeather() {} },
    gfx: { materials: { register: <T>(m: T) => m } },
    physics,
    world: {
      bounds: { minX: -3000, maxX: 3000, minZ: -3000, maxZ: 3000 },
      seaLevel: -10,
      graph,
      places,
      landmarks: [],
      railways: [],
      heightAt: () => 0,
      groundAt: () => 0,
      normalAt: (_x: number, _z: number, t = new THREE.Vector3()) => t.set(0, 1, 0),
      waterDepthAt: () => 0,
      surfaceAt: () => 'road',
      districtAt: (x: number, z: number) => (inTown(x, z) ? CITY : RURAL),
      locationName: (x: number, z: number) => graph.nearest(x, z, 14)?.edge.name ?? (inTown(x, z) ? CITY.name : RURAL.name),
      place: (id: string) => places.find((p) => p.id === id)!,
      placesTagged: (tag: string) => places.filter((p) => p.tags.includes(tag)),
      nearestPlace(x: number, z: number, tag: string) {
        let best: Place | null = null;
        for (const p of places) if (p.tags.includes(tag) && (!best || Math.hypot(p.x - x, p.z - z) < Math.hypot(best.x - x, best.z - z))) best = p;
        return best;
      },
      isLoaded: () => true,
      addFocus: () => () => undefined,
      whenLoaded: () => Promise.resolve(),
    },
    player,
    actors: {
      all,
      nextId: () => nextActor++,
      near: (x: number, z: number, r: number, f?: (a: Actor) => boolean) => [...all].filter((a) => Math.hypot(a.position.x - x, a.position.z - z) <= r && (!f || f(a))),
    },
    vehicles: {
      specs,
      all: vehicles as Vehicle[],
      spawn(specId: string, x: number, z: number, heading: number, o: { color?: number; controller?: Vehicle['controller']; tags?: string[] } = {}) {
        const spec = specs.get(specId);
        if (!spec) throw new Error(`Unknown vehicle spec "${specId}"`);
        const v = new ToyVehicle(nextVehicle++, spec);
        v.teleport(x, 0, z, heading);
        if (o.color !== undefined) v.color = o.color;
        v.controller = o.controller ?? 'none';
        for (const t of o.tags ?? []) v.tags.add(t);
        vehicles.push(v);
        return v;
      },
      remove(v: Vehicle) {
        const i = vehicles.indexOf(v as ToyVehicle);
        if (i < 0) return;
        vehicles.splice(i, 1);
        if (v.driver) v.driver.vehicle = null;
        for (const p of v.passengers) p.vehicle = null;
      },
      nearest(x: number, z: number, max: number, f?: (v: Vehicle) => boolean) {
        let best: Vehicle | null = null;
        let bestD = max;
        for (const v of vehicles) {
          const d = Math.hypot(v.position.x - x, v.position.z - z);
          if (d < bestD && (!f || f(v))) {
            bestD = d;
            best = v;
          }
        }
        return best;
      },
      pickSpec: () => 'statesman',
      // Same rules as the real Vehicles system.
      enter(actor: Actor, vehicle: Vehicle, seat = 0) {
        if (actor.vehicle) this.exit(actor);
        let ejected: Actor | null = null;
        const hadOwner = vehicle.driver !== null || !vehicle.tags.has('owned');
        if (seat === 0) {
          ejected = vehicle.driver;
          if (ejected) {
            ejected.vehicle = null;
            events.emit('vehicleExited', { actor: ejected, vehicle });
          }
          vehicle.driver = actor;
        } else vehicle.passengers.push(actor);
        actor.vehicle = vehicle;
        const stolen = actor.kind === 'player' && seat === 0 && hadOwner;
        if (actor.kind === 'player' && seat === 0) {
          vehicle.controller = 'player';
          vehicle.tags.add('owned');
        }
        events.emit('vehicleEntered', { actor, vehicle, stolen, ejected });
      },
      exit(actor: Actor) {
        const vehicle = actor.vehicle;
        if (!vehicle) return;
        if (vehicle.driver === actor) {
          vehicle.driver = null;
          Object.assign(vehicle.controls, { throttle: 0, brake: 0, steer: 0, handbrake: true });
          if (vehicle.controller === 'player') vehicle.controller = 'none';
        } else vehicle.passengers = vehicle.passengers.filter((p) => p !== actor);
        actor.vehicle = null;
        events.emit('vehicleExited', { actor, vehicle });
      },
    },
    combat: {
      weapons,
      current: fists,
      fire(shooter: Actor, weaponId: string, origin: THREE.Vector3, direction: THREE.Vector3) {
        town.shots.push({ shooter, weaponId, origin: origin.clone(), direction: direction.clone(), from: shooter.position.clone() });
        return true;
      },
      createWeaponModel: () => new THREE.Object3D(),
      disarm() {},
      spawnPickup(kind: string, x: number, z: number, amount?: number, respawn?: number, options?: { ttl?: number; drop?: boolean }) {
        town.pickups.push({ kind, x, z, amount, respawn, options });
        return () => undefined;
      },
    },
    traffic: {
      density: 1,
      count: 0,
      spawnDriver: () => null,
      createAutopilot() {
        throw new Error('Traffic is not implemented yet');
      },
    },
    ui: {
      menuOpen: false,
      prompt(text: string | null) {
        if (text) town.prompts.push(text);
      },
      subtitle(text: string) {
        town.subtitles.push(text);
      },
      banner(title: string, sub = '') {
        town.banners.push(`${title}|${sub}`);
      },
      toast() {},
      objective() {},
      timer() {},
      setBlip(blip: Blip) {
        town.blips.set(blip.id, blip);
      },
      removeBlip(id: string) {
        town.blips.delete(id);
      },
      fade: () => Promise.resolve(),
      choose: () => Promise.resolve(-1),
    },
    audio: { play() {}, unlock() {} },
    save: {
      exists: () => false,
      save() {},
      load: () => false,
      clear() {},
      register(key: string, serialize: () => unknown, deserialize: (d: unknown) => void) {
        town.saveSlices.set(key, { serialize, deserialize });
      },
    },
  } as unknown as GameContext;

  player.position.set(0, 0, 100); // on Column 0 Ave, mid-block
  scene.add(player.group);
  town.ctx = ctx;
  ctx.police = town.police = createPolice(ctx);
  void town.police.init?.();
  physics.world.step();
  town.baseline = { children: scene.children.length, colliders: physics.world.colliders.len(), bodies: physics.world.bodies.len() };

  const warn = console.warn;
  town.step = (seconds, each) => {
    console.warn = () => undefined; // the fallback-driver notice is expected here
    try {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        town.script?.(STEP);
        if (player.vehicle) {
          player.position.copy(player.vehicle.position);
          player.velocity.copy(player.vehicle.velocity);
          player.heading = player.vehicle.heading;
        }
        // Chase camera behind the player.
        camera.position.set(player.position.x - Math.sin(player.heading) * 6, player.position.y + 3, player.position.z - Math.cos(player.heading) * 6);
        camera.lookAt(player.position.x, player.position.y + 1.2, player.position.z);
        camera.updateMatrixWorld();
        physics.world.step();
        town.police.update!(STEP);
        for (const v of vehicles) v.step(STEP);
        each?.();
      }
    } finally {
      console.warn = warn;
    }
  };
  town.spawnCar = (x, z, heading = 0) => ctx.vehicles.spawn('statesman', x, z, heading) as ToyVehicle;
  town.drive = (vehicle) => {
    ctx.vehicles.enter(player, vehicle, 0);
  };
  town.cops = () => [...all].filter((a) => a.kind === 'cop');
  town.policeCars = () => vehicles.filter((v) => v.tags.has('police'));
  town.addPed = (x, z) => {
    const ped: Actor = { id: nextActor++, kind: 'ped', group: new THREE.Group(), position: new THREE.Vector3(x, 0, z), heading: 0, velocity: new THREE.Vector3(), health: 100, maxHealth: 100, armour: 0, alive: true, vehicle: null, takeDamage() {} };
    all.add(ped);
    return ped;
  };
  return town;
}

/** Nothing of ours may be left behind. */
function expectClean(town: Town) {
  expect(town.policeCars()).toEqual([]);
  expect(town.cops()).toEqual([]);
  expect([...town.blips.keys()].filter((id) => id.startsWith('police-'))).toEqual([]);
  expect(town.ctx.scene.children.length).toBe(town.baseline.children);
  expect(town.ctx.physics.world.colliders.len()).toBe(town.baseline.colliders);
  expect(town.ctx.physics.world.bodies.len()).toBe(town.baseline.bodies);
}

function finite(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Invariants that must hold on every frame. */
function expectSane(town: Town) {
  const cars = town.policeCars();
  const roadblock = cars.filter((v) => v.tags.has('roadblock'));
  const pursuit = cars.filter((v) => v.controller === 'police');
  expect(pursuit.length).toBeLessThanOrEqual(MAX_POLICE_VEHICLES);
  expect(roadblock.length).toBeLessThanOrEqual(MAX_ROADBLOCKS * 2);
  const onFoot = town.cops().filter((c) => c.alive && !c.vehicle);
  // Crews bail out of a burning car regardless of the cap; nothing burns in this town.
  expect(onFoot.length).toBeLessThanOrEqual(MAX_ON_FOOT);
  for (const v of cars) expect(finite(v.position) && Number.isFinite(v.heading) && Number.isFinite(v.speed)).toBe(true);
  for (const c of town.cops()) expect(finite(c.position) && Number.isFinite(c.heading)).toBe(true);
}

const levels = (town: Town) => town.heard.filter((h) => h.type === 'wantedChanged').map((h) => (h.payload as GameEvents['wantedChanged']).level);
const count = (town: Town, type: keyof GameEvents) => town.heard.filter((h) => h.type === type).length;

beforeAll(async () => {
  await RAPIER.init();
});

describe('police system, end to end in a toy town', () => {
  it('keeps the save slice clean', () => {
    const town = makeTown();
    const slice = town.saveSlices.get('police')!;
    town.police.setLevel(4);
    expect(slice.serialize()).toEqual({ level: 0 });
    slice.deserialize({ level: 4 });
    expect(town.police.level).toBe(0);
  });

  it('level 0: a patrol car or two cruises about with the siren off, and leaves no trace when cleared', () => {
    const town = makeTown();
    town.step(60, () => expectSane(town));
    const cars = town.policeCars();
    expect(cars.length).toBeGreaterThanOrEqual(1);
    expect(cars.length).toBeLessThanOrEqual(2);
    for (const v of cars) {
      expect(v.siren).toBe(false);
      expect(v.controller).toBe('police');
      expect(v.driver?.kind).toBe('cop');
      // Spawned well away from the player.
      expect(Math.hypot(v.position.x, v.position.z - 100)).toBeGreaterThan(20);
    }
    expect(town.cops().length).toBe(cars.length * 2);
    expect(town.blips.size).toBe(0);
    // They actually drive.
    expect(cars.some((v) => Math.abs(v.speed) > 3)).toBe(true);
    expect(town.police.level).toBe(0);

    town.events.emit('playerRespawned', { reason: 'load' });
    expectClean(town);
  });

  it('an unwitnessed crime is not a crime; a witnessed one brings a car, an arrest and a clean slate', () => {
    const town = makeTown();
    const { player, events } = town;
    town.step(1);
    // Nobody about.
    events.emit('crime', { type: 'carjacking', position: player.position.clone(), offender: player, victim: null });
    expect(town.police.level).toBe(0);
    // A bystander down the street, in plain view.
    town.addPed(3, 120);
    events.emit('crime', { type: 'carjacking', position: player.position.clone(), offender: player, victim: null });
    expect(town.police.level).toBe(1);
    expect(levels(town)).toEqual([1]);
    expect(town.subtitles.length).toBe(1); // the dispatcher has something to say
    expect([...town.blips.keys()]).toContain('spray-test-spray');

    // Stand there like a lemon.
    let sirens = false;
    town.step(90, () => {
      expectSane(town);
      sirens ||= town.policeCars().some((v) => v.siren);
    });
    expect(sirens).toBe(true);
    expect(count(town, 'playerBusted')).toBe(1);
    expect(town.banners[0]).toContain('Nicked');
    expect(town.banners[0]).toContain('Testville police station');
    expect(town.police.level).toBe(0);
    expect(levels(town)).toEqual([1, 0]);
    expect(town.shots.length).toBe(0); // nobody opens fire at level 1
    expect([...town.blips.keys()]).not.toContain('spray-test-spray');

    // The player module respawns them at the station.
    player.position.set(-400, 0, 10);
    events.emit('playerRespawned', { reason: 'busted' });
    expectClean(town);
    // And it does not immediately happen again.
    town.step(5, () => expectSane(town));
    expect(count(town, 'playerBusted')).toBe(1);
  });

  it('a crime in front of a patrol car counts at once', () => {
    const town = makeTown();
    const { player, events } = town;
    town.step(40);
    const car = town.policeCars()[0];
    expect(car).toBeDefined();
    // Put the player round the corner from nobody: next to the patrol car, in its line of sight.
    player.position.set(car.position.x + 6, 0, car.position.z + 2);
    events.emit('crime', { type: 'carTheft', position: player.position.clone(), offender: player, victim: null });
    expect(town.police.level).toBe(1);
  });

  it('level 3: officers get out and shoot, imperfectly, and can be killed', () => {
    const town = makeTown();
    const { player, events } = town;
    town.police.setLevel(3);
    expect(levels(town)).toEqual([3]);
    let maxPursuit = 0;
    town.step(45, () => {
      expectSane(town);
      // Keep it at level 3 for the duration, whatever the sight lines.
      if (town.police.level < 3) town.police.setLevel(3);
      maxPursuit = Math.max(maxPursuit, town.policeCars().filter((v) => v.controller === 'police').length);
    });
    expect(maxPursuit).toBeGreaterThanOrEqual(3);
    expect(town.shots.length).toBeGreaterThan(3);
    expect(town.shots.every((s) => s.weaponId === 'pistol')).toBe(true);
    for (const s of town.shots) {
      expect(s.shooter.kind).toBe('cop');
      expect(s.direction.length()).toBeCloseTo(1, 5);
      expect(finite(s.origin)).toBe(true);
      // Aimed roughly at the player, from somewhere near the shooter.
      const to = new THREE.Vector3(player.position.x, player.position.y + 1.15, player.position.z).sub(s.origin);
      expect(to.length()).toBeLessThan(45);
      expect(s.direction.angleTo(to)).toBeLessThan(0.9);
      // The muzzle is in the shooter's hands: within arm's reach, at about chest height, outside their own capsule.
      const reach = Math.hypot(s.origin.x - s.from.x, s.origin.z - s.from.z);
      expect(reach).toBeGreaterThan(0.3);
      expect(reach).toBeLessThan(1.5);
      expect(s.origin.y - s.from.y).toBeGreaterThan(0.8);
      expect(s.origin.y - s.from.y).toBeLessThan(2);
    }
    // Not every shot is dead on.
    const spread = town.shots.map((s) => s.direction.angleTo(new THREE.Vector3(player.position.x, player.position.y + 1.15, player.position.z).sub(s.origin)));
    expect(Math.max(...spread)).toBeGreaterThan(0.01);
    // Human-ish cadence: nobody fires more than about twice a second.
    const perShooter = new Map<Actor, number>();
    for (const s of town.shots) perShooter.set(s.shooter, (perShooter.get(s.shooter) ?? 0) + 1);
    for (const n of perShooter.values()) expect(n).toBeLessThan(45 * 2);

    // Shoot one of them.
    const victim = town.cops().find((c) => c.alive && !c.vehicle)!;
    expect(victim).toBeDefined();
    const hit: DamageInfo = { amount: 50, kind: 'bullet', source: player };
    victim.takeDamage(hit);
    expect(victim.alive).toBe(true);
    expect(count(town, 'actorDamaged')).toBe(1);
    victim.takeDamage(hit);
    victim.takeDamage(hit);
    expect(victim.alive).toBe(false);
    expect(count(town, 'actorDied')).toBe(1);
    // The fallen officer's sidearm is left by the body as a timed drop.
    expect(town.pickups.length).toBe(1);
    expect(town.pickups[0].kind).toBe('pistol');
    expect(Math.hypot(town.pickups[0].x - victim.position.x, town.pickups[0].z - victim.position.z)).toBeLessThan(1.5);
    expect(town.pickups[0].amount).toBeGreaterThanOrEqual(6);
    expect(town.pickups[0].amount).toBeLessThanOrEqual(10);
    expect(town.pickups[0].respawn).toBe(0);
    expect(town.pickups[0].options?.drop).toBe(true);
    expect(town.ctx.actors.all.has(victim)).toBe(false);
    expect(town.police.level).toBe(3);
    // Nobody else reports the killing, so the police count it themselves a moment later.
    town.step(0.5);
    expect(town.police.level).toBe(4);
    // If the combat system reports it too, it is not counted twice.
    events.emit('crime', { type: 'copKilled', position: victim.position.clone(), offender: player, victim });
    expect(town.police.level).toBe(4);
    // The body stays about 20 seconds.
    const children = town.ctx.scene.children.length;
    town.step(22, () => {
      if (town.police.level < 3) town.police.setLevel(3);
    });
    expect(victim.group.parent).toBeNull();
    expect(town.ctx.scene.children.length).not.toBe(children + 1000);

    events.emit('playerDied', { info: { amount: 999, kind: 'bullet' } });
    expect(town.police.level).toBe(0);
    player.alive = false;
    const shots = town.shots.length;
    town.step(3, () => expectSane(town));
    expect(town.shots.length).toBe(shots); // they stop shooting at a body
    player.alive = true;
    events.emit('playerRespawned', { reason: 'died' });
    expectClean(town);
  });

  it('one killing counts once, however it is reported; running an officer down counts too', () => {
    const town = makeTown();
    const { player, events } = town;
    town.police.setLevel(3);
    let waited = 0;
    while (town.cops().filter((c) => c.alive && !c.vehicle).length < 3 && waited < 60) {
      town.step(0.5, () => {
        if (town.police.level < 3) town.police.setLevel(3);
      });
      waited += 0.5;
    }
    const afoot = () => town.cops().filter((c) => c.alive && !c.vehicle);
    expect(afoot().length).toBeGreaterThanOrEqual(3);
    const fatal: DamageInfo = { amount: 999, kind: 'bullet', source: player };
    const anonymous = () => events.emit('crime', { type: 'copKilled', position: player.position.clone(), offender: player });

    // Reported after the death, with no victim named.
    town.police.setLevel(3);
    afoot()[0].takeDamage(fatal);
    anonymous();
    expect(town.police.level).toBe(4);
    town.step(0.6);
    expect(town.police.level).toBe(4);

    // Reported just before the death, with no victim named.
    town.police.setLevel(3);
    anonymous();
    expect(town.police.level).toBe(4);
    afoot()[0].takeDamage(fatal);
    town.step(0.6);
    expect(town.police.level).toBe(4);

    // Somebody else's doing is not the player's crime.
    town.police.setLevel(3);
    afoot()[0].takeDamage({ amount: 999, kind: 'explosion' });
    town.step(0.6);
    expect(town.police.level).toBe(3);

    // Run one down: the toy cars pass straight through people, so the officer's own contact check has to notice.
    const target = afoot()[0];
    expect(target).toBeDefined();
    const car = town.spawnCar(target.position.x, target.position.z - 12, 0);
    town.drive(car);
    town.script = () => {
      car.speed = 16;
      car.controls.handbrake = false;
    };
    town.step(1.2);
    expect(target.alive).toBe(false);
    const died = town.heard.filter((h) => h.type === 'actorDied').map((h) => h.payload as GameEvents['actorDied']);
    expect(died.at(-1)?.actor).toBe(target);
    expect(died.at(-1)?.info.kind).toBe('vehicle');
    expect(died.at(-1)?.info.source).toBe(player);
    expect(town.police.level).toBe(4);
  });

  it('without a combat system that can fire, level 3 falls back to arrests', () => {
    const town = makeTown({ armed: false });
    town.police.setLevel(3);
    town.step(60, () => {
      expectSane(town);
      if (town.police.level > 0 && town.police.level < 3) town.police.setLevel(3);
    });
    expect(town.shots.length).toBe(0);
    expect(count(town, 'playerBusted')).toBe(1);
  });

  it('level 5 chase: everything turns out, within the caps, with roadblocks ahead', () => {
    const town = makeTown();
    const { player } = town;
    const car = town.spawnCar(4, 100, 0);
    town.drive(car);
    // Lap the middle of town at about 70 km/h, steering along the streets.
    const corners = [
      [0, 400],
      [-400, 400],
      [-400, -400],
      [400, -400],
      [400, 400],
    ];
    let leg = 0;
    town.script = (dt) => {
      const [cx, cz] = corners[leg % corners.length];
      if (Math.hypot(cx - car.position.x, cz - car.position.z) < 12) leg++;
      const want = Math.atan2(cx - car.position.x, cz - car.position.z);
      let turn = want - car.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      car.heading += Math.max(-2 * dt, Math.min(2 * dt, turn));
      car.speed = 19;
      car.controls.throttle = 0;
      car.controls.handbrake = false;
    };
    town.police.setLevel(5);
    let maxPursuit = 0;
    let maxBlocks = 0;
    let sawVan = false;
    let sirens = 0;
    town.step(150, () => {
      expectSane(town);
      if (town.police.level < 5) town.police.setLevel(5);
      const cars = town.policeCars();
      maxPursuit = Math.max(maxPursuit, cars.filter((v) => v.controller === 'police').length);
      maxBlocks = Math.max(maxBlocks, cars.filter((v) => v.tags.has('roadblock')).length / 2);
      sawVan ||= cars.some((v) => v.spec.id === 'van' && v.tags.has('armed-response'));
      sirens = Math.max(sirens, cars.filter((v) => v.siren).length);
    });
    expect(player.vehicle).toBe(car);
    expect(maxPursuit).toBeGreaterThanOrEqual(4);
    expect(maxPursuit).toBeLessThanOrEqual(MAX_POLICE_VEHICLES);
    expect(sawVan).toBe(true);
    expect(maxBlocks).toBeGreaterThanOrEqual(1);
    expect(maxBlocks).toBeLessThanOrEqual(MAX_ROADBLOCKS);
    expect(sirens).toBeGreaterThanOrEqual(4);
    // Pursuing units are on the map.
    expect([...town.blips.values()].filter((b) => b.kind === 'police').length).toBeGreaterThan(0);
    for (const b of town.blips.values()) if (b.kind === 'police') expect(b.follow).toBeDefined();
    // Roadblock cars are parked across the road with nobody driving.
    for (const v of town.policeCars().filter((c) => c.tags.has('roadblock'))) {
      expect(v.controller).toBe('none');
      expect(v.driver).toBeNull();
      expect(v.controls.handbrake).toBe(true);
    }

    town.events.emit('playerRespawned', { reason: 'died' });
    expect(town.policeCars()).toEqual([]);
    expect(town.cops()).toEqual([]);
    expect(town.vehicles).toEqual([car]); // the player's own car is not ours to remove
  });

  it('no van spec, no police spec: still works, in borrowed sedans', () => {
    const town = makeTown({ specs: ['statesman'] });
    town.police.setLevel(5);
    town.step(40, () => {
      expectSane(town);
      if (town.police.level < 5) town.police.setLevel(5);
    });
    const cars = town.policeCars();
    expect(cars.length).toBeGreaterThanOrEqual(3);
    expect(cars.every((v) => v.spec.id === 'statesman')).toBe(true);
    town.events.emit('playerRespawned', { reason: 'died' });
    expectClean(town);
  });

  it('on the open road the black and white ex-traffic car joins the chase; town units stay the white car', () => {
    // The whole grid reads as open country: about half the dispatched cars should be the old traffic car.
    const country = makeTown({ specs: ['statesman', 'police', 'van', 'trafficcar'], country: true });
    country.police.setLevel(4);
    const seen = new Set<string>();
    country.step(50, () => {
      if (country.police.level < 4) country.police.setLevel(4);
      for (const v of country.policeCars()) seen.add(v.spec.id);
      expectSane(country);
    });
    expect(seen.has('trafficcar')).toBe(true);
    expect(seen.has('police')).toBe(true);
    expect(seen.has('statesman')).toBe(false);

    // In town, even with the spec available, every unit is the white patrol car.
    const town = makeTown({ specs: ['statesman', 'police', 'van', 'trafficcar'] });
    town.police.setLevel(4);
    const inTown = new Set<string>();
    town.step(30, () => {
      if (town.police.level < 4) town.police.setLevel(4);
      for (const v of town.policeCars()) inTown.add(v.spec.id);
    });
    expect(inTown.has('police')).toBe(true);
    expect(inTown.has('trafficcar')).toBe(false);
  });

  it('heat is lost out of sight: the level steps down, units drift off and vanish', () => {
    const town = makeTown();
    const { player } = town;
    town.police.setLevel(2);
    town.step(5, () => expectSane(town));
    expect(town.police.level).toBe(2);
    expect(town.policeCars().length).toBeGreaterThanOrEqual(1);
    // Vanish into the countryside, far beyond anyone's sight.
    player.position.set(2400, 0, 2400);
    town.step(1.5);
    expect(town.police.evading).toBeGreaterThan(0);
    const before = town.police.evading;
    town.step(2);
    expect(town.police.evading).toBeLessThan(before);
    town.step(60, () => expectSane(town));
    expect(town.police.level).toBe(0);
    expect(town.police.evading).toBe(0);
    expect(levels(town)).toEqual([2, 1, 0]);
    expect(town.subtitles.some((s) => /[Ss]tand down/.test(s))).toBe(true);
    // Out here there is no patrol quota, and everything left in town is too far away to keep.
    town.step(30, () => expectSane(town));
    expectClean(town);
  });

  it('a suspect who drives off: the crew run back to the car and the chase resumes', () => {
    const town = makeTown();
    const { player } = town;
    town.police.setLevel(2);
    const getaway = town.spawnCar(4, 104, 0);
    // Wait for a crew to get out…
    let waited = 0;
    while (town.cops().filter((c) => c.alive && !c.vehicle).length < 2 && waited < 40) {
      town.step(0.5, () => expectSane(town));
      waited += 0.5;
    }
    const afoot = town.cops().filter((c) => c.alive && !c.vehicle);
    expect(afoot.length).toBe(2);
    expect(count(town, 'playerBusted')).toBe(0);
    const theirs = town.policeCars().find((v) => v.driver === null)!;
    expect(theirs).toBeDefined();
    expect(theirs.controls.handbrake || theirs.controls.brake > 0).toBe(true);
    // …then drive away up the street.
    town.drive(getaway);
    town.script = () => {
      getaway.speed = 14;
      getaway.controls.handbrake = false;
    };
    town.step(12, () => expectSane(town));
    for (const c of afoot) expect(c.vehicle).toBe(theirs); // both back aboard, by whichever door was nearer
    expect(theirs.driver?.kind).toBe('cop');
    town.step(6, () => expectSane(town));
    expect(Math.abs(theirs.speed)).toBeGreaterThan(10); // and after the suspect again
    expect(town.police.level).toBeGreaterThanOrEqual(2);
    expect(player.vehicle).toBe(getaway);
  });

  it('a suspect who runs for it: the passenger gives chase on foot, the driver keeps up in the car', () => {
    const town = makeTown();
    const { player } = town;
    town.police.setLevel(1);
    town.step(2);
    let running = false;
    town.script = (dt) => {
      const cars = town.policeCars();
      running ||= cars.some((v) => v.position.distanceTo(player.position) < 40);
      if (!running) return;
      player.velocity.set(0, 0, 6.8);
      player.position.z += 6.8 * dt;
    };
    town.step(45, () => expectSane(town));
    expect(running).toBe(true);
    expect(count(town, 'playerBusted')).toBe(0); // a sprint outpaces a constable
    const afoot = town.cops().filter((c) => c.alive && !c.vehicle);
    expect(afoot.length).toBe(1);
    const car = town.policeCars().find((v) => v.controller === 'police' && v.driver)!;
    expect(car).toBeDefined();
    // The car is still with them, close behind, never on top of them…
    const gap = car.position.distanceTo(player.position);
    expect(gap).toBeGreaterThan(5);
    expect(gap).toBeLessThan(45);
    // …the runner on foot is dropping back but still coming…
    const lag = afoot[0].position.distanceTo(player.position);
    expect(lag).toBeGreaterThan(10);
    expect(lag).toBeLessThan(80);
    // …and resisting like this makes it worse.
    expect(town.police.heat).toBeGreaterThan(0.3);
    town.step(30, () => expectSane(town));
    expect(town.police.level).toBe(2);
  });

  it('swapping cars out of sight halves the wait', () => {
    const town = makeTown();
    const { player } = town;
    town.police.setLevel(2);
    town.step(4);
    player.position.set(2400, 0, 2400);
    town.step(3);
    expect(town.police.level).toBe(2);
    const left = town.police.evading;
    expect(left).toBeGreaterThan(5);
    const getaway = town.spawnCar(2404, 2400);
    town.drive(getaway);
    expect(town.police.evading).toBeCloseTo(left / 2, 1);
    // Once only, until they see the new car.
    town.ctx.vehicles.exit(player);
    town.drive(town.spawnCar(2408, 2400));
    expect(town.police.evading).toBeCloseTo(left / 2, 1);
  });

  it('respray: needs a car, the cash, and nobody watching', async () => {
    const town = makeTown();
    const { player } = town;
    const car = town.spawnCar(404, 396);
    player.position.set(404, 0, 396);
    town.drive(car);
    const colour = car.color;

    // Clean: nothing on offer.
    town.step(0.2);
    expect(town.prompts.length).toBe(0);

    town.police.setLevel(2);
    town.step(0.2);
    const cost = sprayCost(2, TUNING.sprayBase, TUNING.sprayPerLevel);
    expect(town.prompts.at(-1)).toBe(`F  Respray and new plates — $${cost}`);

    // Skint.
    town.pressed.add('interact');
    town.step(STEP);
    town.pressed.clear();
    await Promise.resolve();
    expect(town.police.level).toBe(2);
    expect(town.subtitles.at(-1)).toContain(`$${cost}`);
    expect(car.color).toBe(colour);

    // Flush. The player's own handler steps out of the car on the same key press; we still act on the car.
    player.money = 1000;
    town.step(0.1);
    town.ctx.vehicles.exit(player);
    town.pressed.add('interact');
    town.step(STEP);
    town.pressed.clear();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(player.money).toBe(1000 - cost);
    expect(town.police.level).toBe(0);
    expect(car.color).not.toBe(colour);
    expect(player.vehicle).toBe(car); // put back behind the wheel
    expect(player.controlsEnabled).toBe(true);
    expect(town.blips.has('spray-test-spray')).toBe(false);

    // Getting into a car parked at the shop is not a sale.
    town.police.setLevel(1);
    town.ctx.vehicles.exit(player);
    town.step(0.1);
    town.drive(car);
    town.pressed.add('interact');
    town.step(STEP);
    town.pressed.clear();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(player.money).toBe(1000 - cost);
    expect(town.police.level).toBe(1);
  });

  it('nicking a patrol car turfs the crew out and makes things worse', () => {
    const town = makeTown();
    const { player } = town;
    town.step(40);
    const car = town.policeCars()[0];
    const crew = town.cops().filter((c) => c.vehicle === car);
    expect(crew.length).toBe(2);
    player.position.copy(car.position);
    town.drive(car);
    expect(car.driver).toBe(player);
    expect(car.controller).toBe('player');
    for (const c of crew) expect(c.vehicle).toBeNull();
    expect(town.police.level).toBeGreaterThanOrEqual(2);
    expect(town.blips.has(`police-car-${car.id}`)).toBe(false);
    // The car is no longer driven by the police…
    car.controls.throttle = 0.123;
    town.step(2, () => expectSane(town));
    expect(car.controls.throttle).toBe(0.123);
    // …and is not whisked away from under the player on respawn.
    town.events.emit('playerRespawned', { reason: 'load' });
    expect(town.vehicles).toContain(car);
    expect(town.cops()).toEqual([]);
  });

  it('suspending the law clears the heat and ignores crimes', () => {
    const town = makeTown();
    const { player, events } = town;
    town.addPed(3, 120);
    town.police.setLevel(3);
    town.step(10);
    town.police.enabled = false;
    expect(town.police.level).toBe(0);
    events.emit('crime', { type: 'murder', position: player.position.clone(), offender: player, victim: null });
    expect(town.police.level).toBe(0);
    const shots = town.shots.length;
    town.step(20, () => expectSane(town));
    expect(town.shots.length).toBe(shots);
    expect(count(town, 'playerBusted')).toBe(0);
    town.police.enabled = true;
    events.emit('crime', { type: 'murder', position: player.position.clone(), offender: player, victim: null });
    expect(town.police.level).toBe(2);
  });

  it('crimes by anyone else are none of our business', () => {
    const town = makeTown();
    const ped = town.addPed(3, 120);
    town.addPed(5, 110);
    town.events.emit('crime', { type: 'murder', position: ped.position.clone(), offender: ped, victim: null });
    expect(town.police.level).toBe(0);
  });

  it('dispose removes everything', () => {
    const town = makeTown();
    town.police.setLevel(4);
    town.step(30, () => {
      if (town.police.level < 4) town.police.setLevel(4);
    });
    expect(town.policeCars().length).toBeGreaterThan(0);
    town.police.dispose!();
    expectClean(town);
    expect(town.blips.size).toBe(0);
    // Deaf to events from here on.
    const level = town.police.level;
    town.events.emit('crime', { type: 'copKilled', position: town.player.position.clone(), offender: town.player, victim: null });
    expect(town.police.level).toBe(level);
  });
});
