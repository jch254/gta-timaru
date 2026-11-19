import * as THREE from 'three';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { NIGHT_HEADLIGHTS, type Actor, type Autopilot, type DamageInfo, type District, type GameContext, type PedHandle, type RoadEdge, type System, type TrafficApi, type Vehicle } from '../core/types';
import { AutopilotImpl, type PilotWorld } from './autopilot';
import { JunctionBook } from './junction';
import { lanePointInto, makePoint, sampleEdge } from './lanes';
import { barkLine } from './looks';
import { legEnd, legStart, type Leg } from './route';
import { parkedTimeFactor, pickRingPoint, racerCount, racersOut, spawnAllowed, trafficTimeFactor, type RingPoint } from './spawn';
import { DRIVE, PEDS, TRAFFIC } from './tuning';

const DRIVABLE = (e: RoadEdge) => e.drivable;
const _pt = makePoint();
const _ring: RingPoint = { x: 0, z: 0, radius: 0 };
const _door = new THREE.Vector3();

/**
 * The person behind the wheel of an ambient car. Not rendered (cabs have dark glass) and not in
 * `ctx.actors.all`; it exists so `vehicle.driver` is set, the hijack flow works and drive-by damage has
 * somebody to land on.
 */
class Driver implements Actor {
  readonly kind = 'ped' as const;
  readonly group = new THREE.Object3D();
  readonly position = this.group.position;
  readonly velocity = new THREE.Vector3();
  heading = 0;
  health = PEDS.health;
  maxHealth = PEDS.health;
  armour = 0;
  alive = true;
  vehicle: Vehicle | null;
  car: Car | null = null;

  constructor(
    readonly id: number,
    vehicle: Vehicle,
    private hurt: (driver: Driver, info: DamageInfo) => void,
  ) {
    this.vehicle = vehicle;
    this.position.copy(vehicle.position);
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive) return;
    this.health -= info.amount;
    this.hurt(this, info);
  }
}

interface Car {
  vehicle: Vehicle;
  /** 'driving' = ours to steer; 'parked' = at the kerb; 'loose' = abandoned, taken or wrecked (kept so it gets tidied away). */
  state: 'driving' | 'parked' | 'loose';
  pilot: AutopilotImpl | null;
  driver: Driver | null;
  persistent: boolean;
  racer: boolean;
  bus: boolean;
  baseAggression: number;
  baseCruise: number;
  /** Seconds left of speeding away from trouble. */
  panic: number;
  /** Pulling up so the driver can run for it. */
  bailing: boolean;
  honkAt: number;
  honked: boolean;
  wreckTime: number;
  slot: number;
}

/**
 * Ambient traffic: keeps a population of driven and parked vehicles around the player, runs their
 * autopilots, and makes drivers react to horns, gunfire, ramming and hijacking.
 */
export class TrafficSystem implements TrafficApi, System {
  readonly name = 'traffic';
  density = 1;

  private cars: Car[] = [];
  private byVehicle = new Map<Vehicle, Car>();
  private rng = new Rng(0x7a11c);
  private book = new JunctionBook();
  private pilotWorld: PilotWorld;
  private driving = 0;
  private parked = 0;
  private racers = 0;
  private hasBus = false;
  private movingTimer = 0;
  private parkedTimer = 0;
  private slowTimer = 0;
  private seed: number = TRAFFIC.seedSeconds;
  private frame = 0;
  private movingTarget = 0;
  private parkedTarget = 0;
  private lap: Leg[] | null | undefined;
  private collectWalker = (a: Actor) => {
    if (a.alive && !a.vehicle) this.pilotWorld.walkers.push(a);
  };
  private onDriverHurt = (driver: Driver, info: DamageInfo) => this.driverHurt(driver, info);

  constructor(private ctx: GameContext) {
    this.pilotWorld = { ctx, book: this.book, rng: this.rng, walkers: [] };
  }

  /** AI-driven vehicles alive. */
  get count(): number {
    return this.driving;
  }

  init() {
    const { ctx } = this;
    ctx.events.on('vehicleEntered', ({ actor, vehicle, ejected }) => {
      const car = this.byVehicle.get(vehicle);
      if (!car) return;
      if (ejected && ejected === car.driver) this.hijacked(car);
      else if (vehicle.driver === actor && car.state === 'parked') this.cutLoose(car);
    });
    ctx.events.on('gunshot', ({ position }) => {
      const r2 = TRAFFIC.gunshotRadius * TRAFFIC.gunshotRadius;
      for (const car of this.cars) {
        if (car.state !== 'driving') continue;
        const p = car.vehicle.position;
        if ((p.x - position.x) * (p.x - position.x) + (p.z - position.z) * (p.z - position.z) < r2) this.panic(car);
      }
    });
    ctx.events.on('vehicleCrash', ({ vehicle, speed, other }) => {
      const car = this.byVehicle.get(vehicle);
      if (!car || car.state !== 'driving' || speed < TRAFFIC.ramSpeed) return;
      // The crash event does not always say who hit us: blame the player if their car is right here.
      const mine = ctx.player.vehicle;
      const rammed = (mine && other === mine) || other === ctx.player || (mine && mine !== vehicle && mine.position.distanceTo(vehicle.position) < TRAFFIC.ramRadius + mine.spec.length / 2);
      if (rammed) this.panic(car);
    });
    ctx.events.on('vehicleDestroyed', ({ vehicle, source }) => {
      const car = this.byVehicle.get(vehicle);
      if (!car) return;
      const driver = car.driver;
      if (driver && driver.alive && driver.vehicle === vehicle) {
        const info: DamageInfo = { amount: 999, kind: 'explosion', source: source ?? null };
        driver.health = 0;
        driver.alive = false;
        ctx.events.emit('actorDied', { actor: driver, info });
      }
      this.cutLoose(car);
    });
    ctx.events.on('playerRespawned', () => {
      this.seed = TRAFFIC.seedSeconds;
    });
  }

  // ───────────── TrafficApi ─────────────

  spawnDriver(specId: string, x: number, z: number, options: { aggression?: number; tags?: string[]; persistent?: boolean } = {}): Vehicle | null {
    const { ctx } = this;
    const hit = ctx.world.graph.nearest(x, z, 60, DRIVABLE);
    if (!hit) return null;
    const id = ctx.vehicles.specs.has(specId) ? specId : this.pickSpec(ctx.world.districtAt(x, z), true);
    if (!id) return null;
    // Keep left: a point left of a → b belongs to traffic heading a → b.
    const dir = hit.edge.oneway || hit.offset >= 0 ? 1 : -1;
    const car = this.addDriver(id, hit.edge, dir, hit.s, 0, options.aggression ?? 1, options.tags ?? [], options.persistent ?? false, 0);
    return car ? car.vehicle : null;
  }

  createAutopilot(vehicle: Vehicle): Autopilot {
    // One autopilot per vehicle: a car we already drive hands over its own.
    return this.byVehicle.get(vehicle)?.pilot ?? new AutopilotImpl(vehicle, this.pilotWorld);
  }

  // ───────────── Frame ─────────────

  update(dt: number) {
    const { ctx } = this;
    this.frame++;
    const walkers = this.pilotWorld.walkers;
    walkers.length = 0;
    ctx.actors.all.forEach(this.collectWalker);
    if (this.frame % 240 === 0) this.book.prune(ctx.clock.elapsed);
    if (this.seed > 0) this.seed -= dt;

    const p = ctx.player.position;
    let driving = 0;
    let parked = 0;
    let racers = 0;
    let bus = false;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const v = car.vehicle;
      const check = (this.frame + car.slot) % 30 === 0;
      // Removed behind our back (mission clean-up, another system).
      if (check && ctx.vehicles.all.indexOf(v) < 0) {
        this.forget(i);
        continue;
      }
      if (car.state === 'driving') {
        if (v.controller !== 'traffic' || v.driver !== car.driver) this.cutLoose(car);
        else this.drive(car, dt);
      } else if (car.state === 'parked' && (v.driver || v.controller !== 'none' || v.destroyed)) this.cutLoose(car);
      if (v.destroyed) car.wreckTime += dt;

      const dx = v.position.x - p.x;
      const dz = v.position.z - p.z;
      if (this.shouldRemove(car, dx * dx + dz * dz, check)) {
        this.remove(i);
        continue;
      }
      if (car.state === 'driving') {
        driving++;
        if (car.racer) racers++;
        if (car.bus) bus = true;
      } else if (car.state === 'parked') parked++;
    }
    this.driving = driving;
    this.parked = parked;
    this.racers = racers;
    this.hasBus = bus;

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 1;
      this.retarget();
      this.spawnRacers();
    }
    this.movingTimer -= dt;
    if (this.movingTimer <= 0) {
      this.movingTimer = TRAFFIC.movingInterval;
      // Fill quickly after a (re)spawn, then trickle.
      for (let k = this.seed > 0 ? 4 : 1; k > 0 && ctx.vehicles.all.length < TRAFFIC.vehicleBudget && this.driving < this.movingTarget; k--) this.spawnMoving();
    }
    this.parkedTimer -= dt;
    if (this.parkedTimer <= 0) {
      this.parkedTimer = TRAFFIC.parkedInterval;
      for (let k = this.seed > 0 ? 4 : 1; k > 0 && ctx.vehicles.all.length < TRAFFIC.vehicleBudget && this.parked < this.parkedTarget; k--) this.spawnParked();
    }
  }

  private retarget() {
    const { ctx } = this;
    const p = ctx.player.position;
    const type = ctx.world.districtAt(p.x, p.z).type;
    this.movingTarget = Math.round(TRAFFIC.movingPerDensity * this.density * trafficTimeFactor(ctx.clock.hour) * (TRAFFIC.areaFactor[type] ?? 1));
    this.parkedTarget = Math.round(TRAFFIC.parkedPerDensity * this.density * clamp((TRAFFIC.parkDistrict[type] ?? 0.5) * 1.3, 0.1, 1));
  }

  private drive(car: Car, dt: number) {
    const { ctx, rng } = this;
    const v = car.vehicle;
    const pilot = car.pilot!;
    const driver = car.driver!;
    driver.position.copy(v.position);
    driver.velocity.copy(v.velocity);
    driver.heading = v.heading;
    if (v.destroyed) {
      this.cutLoose(car);
      return;
    }
    // Out before it goes up.
    if (v.burning) {
      this.bail(car);
      return;
    }
    if (car.panic > 0) {
      car.panic -= dt;
      if (car.panic <= 0) {
        pilot.aggression = car.baseAggression;
        pilot.cruiseSpeed = car.baseCruise;
      }
    }
    pilot.update(dt);
    if (car.bailing && Math.abs(v.speed) < TRAFFIC.bailSpeed) {
      this.bail(car);
      return;
    }
    v.headlightsOn = ctx.env.night > NIGHT_HEADLIGHTS;
    // Leaning on the horn when held up.
    if (pilot.blockedTime <= 0) {
      if (car.honked) {
        car.honked = false;
        car.honkAt = rng.range(TRAFFIC.honkAfter[0], TRAFFIC.honkAfter[1]);
      }
    } else if (pilot.blockedTime > car.honkAt * (pilot.blockedByTraffic ? DRIVE.queuePatience : 1)) {
      v.horn();
      car.honked = true;
      car.honkAt = (pilot.blockedTime + rng.range(TRAFFIC.honkRepeat[0], TRAFFIC.honkRepeat[1])) / (pilot.blockedByTraffic ? DRIVE.queuePatience : 1);
    }
  }

  private shouldRemove(car: Car, d2: number, check: boolean): boolean {
    const { ctx } = this;
    const v = car.vehicle;
    if (car.persistent || v === ctx.player.vehicle || v.tags.has('mission')) return false;
    // Somebody else's now (player, police, a mission, a scripted pedestrian).
    if (v.controller === 'player' || v.controller === 'police' || v.controller === 'mission') return false;
    if ((v.driver && v.driver !== car.driver) || v.passengers.length > 0) return false;
    if (d2 > TRAFFIC.despawn * TRAFFIC.despawn) return true;
    if (!check) return false;
    if (!ctx.world.isLoaded(v.position.x, v.position.z)) return true;
    if (v.destroyed) return car.wreckTime > TRAFFIC.wreckSeconds && d2 > TRAFFIC.wreckDistance * TRAFFIC.wreckDistance;
    if (car.state === 'driving' && car.pilot) {
      // Off the edge of the map, or hopelessly stuck: slip away when nobody is near.
      if (car.pilot.deadEnd && d2 > TRAFFIC.deadEndDespawn * TRAFFIC.deadEndDespawn) return true;
      if (car.pilot.stuckCount >= TRAFFIC.stuckStrikes && d2 > 60 * 60) return true;
    }
    return false;
  }

  private remove(index: number) {
    const car = this.cars[index];
    this.forget(index);
    this.ctx.vehicles.remove(car.vehicle);
  }

  /** Drop our record of a car (the vehicle itself is gone or about to be). */
  private forget(index: number) {
    const car = this.cars[index];
    this.dropPilot(car);
    if (car.driver) {
      if (car.vehicle.driver === car.driver) car.vehicle.driver = null;
      car.driver.vehicle = null;
      car.driver.car = null;
      car.driver = null;
    }
    this.byVehicle.delete(car.vehicle);
    this.cars[index] = this.cars[this.cars.length - 1];
    this.cars.pop();
  }

  private dropPilot(car: Car) {
    if (!car.pilot) return;
    car.pilot.dispose();
    car.pilot = null;
  }

  /** The car is no longer ours to drive or to count: it stays in the world until it can be tidied away. */
  private cutLoose(car: Car) {
    if (car.state === 'loose') return;
    if (car.state === 'driving') this.driving--;
    else this.parked--;
    this.dropPilot(car);
    car.state = 'loose';
    car.vehicle.tags.delete('parked');
    car.bailing = false;
    car.panic = 0;
  }

  // ───────────── Drivers ─────────────

  /** Most drivers put their foot down; some pull up and run. */
  private panic(car: Car) {
    if (car.state !== 'driving' || !car.pilot || car.persistent || car.panic > 0 || car.bailing) return;
    if (!car.bus && !car.racer && this.rng.chance(TRAFFIC.bailChance)) {
      car.bailing = true;
      car.pilot.stop();
      return;
    }
    car.panic = TRAFFIC.fleeSeconds;
    car.pilot.aggression = Math.max(car.pilot.aggression, TRAFFIC.fleeAggression);
    car.pilot.cruiseSpeed = Math.max(car.pilot.cruiseSpeed, 40);
    // No patience for dawdling around a stopped route: get moving again.
    if (!car.pilot.wandering && !car.racer) car.pilot.wander();
  }

  /** The driver gets out and legs it; the car is left where it stopped. */
  private bail(car: Car) {
    const { ctx } = this;
    const v = car.vehicle;
    const driver = car.driver;
    v.doorPosition(_door, 0);
    const heading = v.heading;
    this.cutLoose(car);
    if (driver) {
      car.driver = null;
      driver.car = null;
      if (driver.vehicle === v) ctx.vehicles.exit(driver);
      driver.vehicle = null;
    }
    if (v.controller === 'traffic') v.controller = 'none';
    v.controls.throttle = 0;
    v.controls.brake = 0;
    v.controls.steer = 0;
    v.controls.handbrake = true;
    ctx.audio.play('doorOpen', { at: v.position });
    this.putOnFoot(_door.x, _door.z, heading, 'flee');
  }

  /** The player pulled the driver out. They run, or now and then have a go. */
  private hijacked(car: Car) {
    const v = car.vehicle;
    const driver = car.driver;
    if (driver) {
      driver.car = null;
      driver.vehicle = null;
      car.driver = null;
    }
    this.cutLoose(car);
    v.doorPosition(_door, 0);
    const fight = this.rng.chance(TRAFFIC.fightChance);
    const ped = this.putOnFoot(_door.x, _door.z, v.heading + Math.PI / 2, fight ? 'attack' : 'flee');
    if (ped && this.rng.chance(TRAFFIC.barkChance)) ped.say(barkLine(this.rng, fight ? 'fight' : 'hijacked'));
  }

  private driverHurt(driver: Driver, info: DamageInfo) {
    const { ctx } = this;
    ctx.events.emit('actorDamaged', { actor: driver, info });
    const car = driver.car;
    if (driver.health > 0) {
      if (car) this.panic(car);
      return;
    }
    driver.health = 0;
    driver.alive = false;
    ctx.events.emit('actorDied', { actor: driver, info });
    if (!car) return;
    // Slumped at the wheel: the car rolls to a stop.
    const v = car.vehicle;
    this.cutLoose(car);
    car.driver = null;
    driver.car = null;
    if (driver.vehicle === v) ctx.vehicles.exit(driver);
    driver.vehicle = null;
    if (v.controller === 'traffic') v.controller = 'none';
  }

  /** A former driver, now a pedestrian. Calm inside a marae's grounds, whatever just happened. */
  private putOnFoot(x: number, z: number, heading: number, mood: 'flee' | 'attack'): PedHandle | null {
    const { ctx } = this;
    if (!ctx.world.isLoaded(x, z)) return null;
    try {
      return ctx.peds.spawn({ x, z, heading, behaviour: this.inMarae(x, z) ? 'wander' : mood });
    } catch {
      // Pedestrians unavailable (stub): the driver simply vanishes.
      return null;
    }
  }

  private inMarae(x: number, z: number): boolean {
    for (const l of this.ctx.world.landmarks) {
      if (l.kind === 'marae' && (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z) < l.clearRadius * l.clearRadius) return true;
    }
    return false;
  }

  // ───────────── Spawning ─────────────

  /**
   * A traffic spec for the district that really exists; '' if the roster has nothing suitable.
   * `driven` leaves out what cannot pass as ordinary driven traffic: motorbikes (the driver is not modelled,
   * so they would ride themselves), buses (rationed separately) and service vehicles. Buses are not left
   * parked at the kerb either.
   */
  private pickSpec(district: District, driven = false): string {
    const specs = this.ctx.vehicles.specs;
    const ok = (id: string) => {
      const spec = specs.get(id);
      if (!spec) return false;
      if (spec.cls === 'bus' || spec.cls === 'tram' || spec.cls === 'police') return false;
      return !(driven && spec.cls === 'bike');
    };
    for (let k = 0; k < 5; k++) {
      const id = this.ctx.vehicles.pickSpec(district.type, this.rng, district.city);
      if (ok(id)) return id;
    }
    for (const [key, spec] of specs) if (spec.traffic && ok(key)) return key;
    for (const key of specs.keys()) if (ok(key)) return key;
    return '';
  }

  private addDriver(specId: string, edge: RoadEdge, dir: 1 | -1, s: number, lane: number, aggression: number, tags: string[], persistent: boolean, rolling: number): Car | null {
    const { ctx } = this;
    lanePointInto(edge, s, dir, lane, 0, _pt);
    const v = ctx.vehicles.spawn(specId, _pt.x, _pt.z, Math.atan2(_pt.tx, _pt.tz), { controller: 'traffic', tags });
    if (!v) return null;
    const driver = new Driver(ctx.actors.nextId(), v, this.onDriverHurt);
    v.driver = driver;
    const pilot = new AutopilotImpl(v, this.pilotWorld);
    pilot.aggression = aggression;
    pilot.lane = lane;
    pilot.cruiseSpeed = v.spec.topSpeed * TRAFFIC.cruiseShare;
    pilot.startOn(edge, dir, s);
    if (rolling > 0) {
      // Already up to speed, so cars do not appear parked in the middle of the open road.
      const speed = Math.min(edge.speedLimit * aggression, pilot.cruiseSpeed) * rolling;
      v.body.setLinvel({ x: _pt.tx * speed, y: 0, z: _pt.tz * speed }, true);
    }
    const car: Car = {
      vehicle: v,
      state: 'driving',
      pilot,
      driver,
      persistent,
      racer: false,
      bus: false,
      baseAggression: aggression,
      baseCruise: pilot.cruiseSpeed,
      panic: 0,
      bailing: false,
      honkAt: this.rng.range(TRAFFIC.honkAfter[0], TRAFFIC.honkAfter[1]),
      honked: false,
      wreckTime: 0,
      slot: this.rng.int(0, 29),
    };
    driver.car = car;
    this.cars.push(car);
    this.byVehicle.set(v, car);
    this.driving++;
    return car;
  }

  private spawnMoving() {
    const { ctx, rng } = this;
    const p = ctx.player.position;
    const cam = ctx.player.cameraHeading;
    const seeding = this.seed > 0;
    const mine = ctx.player.vehicle;
    const fast = mine !== null && Math.abs(mine.speed) > TRAFFIC.aheadSpeed;
    const minR = seeding ? TRAFFIC.seedMovingMin : TRAFFIC.spawnMin;
    pickRingPoint(rng, p.x, p.z, cam, minR, TRAFFIC.spawnMax, TRAFFIC.coneHalfAngle, fast ? TRAFFIC.aheadBias : 0, _ring);
    const hit = ctx.world.graph.nearest(_ring.x, _ring.z, 60, DRIVABLE);
    if (!hit) return;
    const e = hit.edge;
    if (e.tunnel || e.length < TRAFFIC.nodeClearance * 2 + 4 || !rng.chance(TRAFFIC.classWeight[e.cls])) return;
    const s = clamp(hit.s, TRAFFIC.nodeClearance, e.length - TRAFFIC.nodeClearance);
    const dir = e.oneway || rng.chance(0.5) ? 1 : -1;
    const lane = e.lanes > 1 && rng.chance(TRAFFIC.innerLaneChance) ? 1 : 0;
    lanePointInto(e, s, dir, lane, 0, _pt);
    const x = _pt.x;
    const z = _pt.z;
    if (!spawnAllowed(p.x, p.z, cam, x, z, minR, TRAFFIC.spawnMax, 20, TRAFFIC.coneHalfAngle, seeding ? minR : TRAFFIC.coneFarDistance)) return;
    if (!ctx.world.isLoaded(x, z) || ctx.vehicles.nearest(x, z, TRAFFIC.clearMoving)) return;
    const district = ctx.world.districtAt(x, z);
    const hour = ctx.clock.hour;
    const wantBus = !this.hasBus && e.cls === 'arterial' && district.city === 'christchurch' && hour > 6.5 && hour < 19 && ctx.vehicles.specs.has('bus') && rng.chance(TRAFFIC.busChance);
    const specId = wantBus ? 'bus' : this.pickSpec(district, true);
    if (!specId) return;
    const car = this.addDriver(specId, e, dir, s, wantBus ? 0 : lane, wantBus ? TRAFFIC.busAggression : rng.range(0.86, 1.12), ['traffic'], false, seeding ? 0.5 : 0.85);
    if (car && wantBus) {
      car.bus = true;
      this.hasBus = true;
    }
  }

  private spawnParked() {
    const { ctx, rng } = this;
    const p = ctx.player.position;
    const cam = ctx.player.cameraHeading;
    const seeding = this.seed > 0;
    const minR = seeding ? TRAFFIC.seedParkedMin : TRAFFIC.spawnMin;
    pickRingPoint(rng, p.x, p.z, cam, minR, TRAFFIC.spawnMax, TRAFFIC.coneHalfAngle, 0, _ring);
    const hit = ctx.world.graph.nearest(_ring.x, _ring.z, 60, DRIVABLE);
    if (!hit) return;
    const e = hit.edge;
    const classWeight = TRAFFIC.parkClass[e.cls];
    if (classWeight <= 0 || e.bridge || e.tunnel || e.length < TRAFFIC.parkClearance * 2 + 6) return;
    const district = ctx.world.districtAt(hit.x, hit.z);
    const commercial = district.type === 'cbd' || district.type === 'shops' || district.type === 'industrial' || district.type === 'port';
    if (!rng.chance(classWeight * (TRAFFIC.parkDistrict[district.type] ?? 0.5) * parkedTimeFactor(ctx.clock.hour, commercial))) return;
    const specId = this.pickSpec(district);
    const spec = ctx.vehicles.specs.get(specId);
    if (!spec) return;
    const s = clamp(hit.s, TRAFFIC.parkClearance, e.length - TRAFFIC.parkClearance);
    const dir = e.oneway || rng.chance(0.5) ? 1 : -1;
    // At the kerb on the left, facing the way traffic on that side travels. On gravel, half on the verge.
    sampleEdge(e, s, _pt);
    const tx = _pt.tx * dir;
    const tz = _pt.tz * dir;
    const offset = e.width / 2 - spec.width / 2 - TRAFFIC.kerbGap + (e.cls === 'gravel' ? 0.8 : 0);
    const x = _pt.x + tz * offset;
    const z = _pt.z - tx * offset;
    if (!spawnAllowed(p.x, p.z, cam, x, z, minR, TRAFFIC.spawnMax, 20, TRAFFIC.coneHalfAngle, seeding ? minR : TRAFFIC.coneFarDistance)) return;
    if (!ctx.world.isLoaded(x, z) || ctx.vehicles.nearest(x, z, TRAFFIC.clearParked)) return;
    const v = ctx.vehicles.spawn(specId, x, z, Math.atan2(tx, tz), { controller: 'none', tags: ['parked'] });
    if (!v) return;
    v.controls.handbrake = true;
    const car: Car = {
      vehicle: v,
      state: 'parked',
      pilot: null,
      driver: null,
      persistent: false,
      racer: false,
      bus: false,
      baseAggression: 1,
      baseCruise: 0,
      panic: 0,
      bailing: false,
      honkAt: 0,
      honked: false,
      wreckTime: 0,
      slot: rng.int(0, 29),
    };
    this.cars.push(car);
    this.byVehicle.set(v, car);
    this.parked++;
  }

  // ───────────── Boy racers ─────────────

  /** A pack of fast cars lapping the four avenues at night. */
  private spawnRacers() {
    const { ctx, rng } = this;
    if (!racersOut(ctx.clock.hour, ctx.clock.day)) return;
    const want = Math.round(racerCount(ctx.clock.hour, ctx.clock.day) * Math.min(1, this.density));
    if (this.racers >= want || this.racers > 0) return;
    if (this.lap === undefined) this.lap = this.buildLap();
    const lap = this.lap;
    if (!lap || ctx.vehicles.all.length + want > TRAFFIC.vehicleBudget) return;
    const p = ctx.player.position;
    const cam = ctx.player.cameraHeading;
    for (let attempt = 0; attempt < 12; attempt++) {
      const index = rng.int(0, lap.length - 1);
      const leg = lap[index];
      const e = leg.edge;
      const back = (want - 1) * TRAFFIC.racerSpacing;
      if (e.tunnel || e.length < back + 30) continue;
      // Distance travelled along the leg by the lead car; the rest line up behind it.
      const u = rng.range(back + 12, e.length - 14);
      lanePointInto(e, leg.dir === 1 ? u : e.length - u, leg.dir, 0, 0, _pt);
      if (!spawnAllowed(p.x, p.z, cam, _pt.x, _pt.z, TRAFFIC.spawnMin, TRAFFIC.spawnMax, 30, TRAFFIC.coneHalfAngle, TRAFFIC.coneFarDistance)) continue;
      if (!ctx.world.isLoaded(_pt.x, _pt.z)) continue;
      const route = index === 0 ? lap : lap.slice(index).concat(lap.slice(0, index));
      const district = ctx.world.districtAt(_pt.x, _pt.z);
      const fast = TRAFFIC.racerSpecs.filter((id) => ctx.vehicles.specs.has(id));
      for (let k = 0; k < want; k++) {
        const uk = u - k * TRAFFIC.racerSpacing;
        const sk = leg.dir === 1 ? uk : e.length - uk;
        const lane = e.lanes > 1 ? (k + 1) % 2 : 0;
        lanePointInto(e, sk, leg.dir, lane, 0, _pt);
        if (ctx.vehicles.nearest(_pt.x, _pt.z, 7)) continue;
        const specId = fast.length ? rng.pick(fast) : this.pickSpec(district, true);
        if (!specId) return;
        const car = this.addDriver(specId, e, leg.dir, sk, lane, TRAFFIC.racerAggression + rng.range(-0.08, 0.1), ['traffic', 'racer'], false, 0.7);
        if (!car || !car.pilot) continue;
        car.racer = true;
        car.pilot.loop = true;
        car.pilot.cruiseSpeed = car.baseCruise = Math.min(TRAFFIC.racerCruise, car.vehicle.spec.topSpeed * 0.92);
        car.pilot.setRoute(route, sk);
        this.racers++;
      }
      return;
    }
  }

  /**
   * The lap: Bealey → Fitzgerald → Moorhouse → Deans, found by street name. Null if any avenue is missing
   * from the map or they cannot be joined into a circuit.
   */
  private buildLap(): Leg[] | null {
    const graph = this.ctx.world.graph;
    const sets = TRAFFIC.racerAvenues.map((name) => graph.edges.filter((e) => e.drivable && e.name.includes(name)));
    if (sets.some((s) => s.length === 0)) return null;
    const nodesOf = (edges: RoadEdge[]) => [...new Set(edges.flatMap((e) => [e.a, e.b]))];
    // corner[i] joins avenue i to avenue i + 1.
    const corners: number[] = [];
    for (let i = 0; i < sets.length; i++) {
      const here = nodesOf(sets[i]);
      const there = nodesOf(sets[(i + 1) % sets.length]);
      let best = -1;
      let bestD = Infinity;
      for (const a of here) {
        for (const b of there) {
          const d = Math.hypot(graph.nodes[a].x - graph.nodes[b].x, graph.nodes[a].z - graph.nodes[b].z);
          if (d < bestD) {
            bestD = d;
            best = a;
          }
        }
      }
      if (best < 0 || bestD > 250) return null;
      corners.push(best);
    }
    const lap: Leg[] = [];
    for (let i = 0; i < corners.length; i++) {
      // Along avenue i: from the corner shared with the previous avenue to the corner shared with the next.
      const part = graph.route(corners[(i + corners.length - 1) % corners.length], corners[i]);
      if (!part || !part.length) return null;
      for (const leg of part) lap.push(leg);
    }
    for (let i = 0; i < lap.length; i++) {
      const a = lap[i];
      const b = lap[(i + 1) % lap.length];
      if (legEnd(a.edge, a.dir) !== legStart(b.edge, b.dir)) return null;
    }
    return lap;
  }
}
