import type * as THREE from 'three';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { NIGHT_HEADLIGHTS, type Actor, type Autopilot, type DamageInfo, type GameContext, type RoadEdge, type RoadHit, type RoadNode, type Vehicle } from '../core/types';
import type { Intel } from './intel';
import { ARMED_LOOK, Officer, PATROL_LOOKS, RigPool, type OfficerHost } from './officer';
import { SimplePilot, holdStill } from './pilot';
import { CALL_SIGNS, VAN_CALL_SIGN, type RadioEvent } from './radio';
import { MAX_ON_FOOT, MAX_POLICE_VEHICLES, MAX_ROADBLOCKS, type CopWeapon } from './response';
import { exitsFrom, straightest, walkAhead, type TurnOption, type TurnPicker } from './roadwalk';
import { TUNING } from './tuning';
import { View } from './view';

type Leg = { edge: RoadEdge; dir: 1 | -1 };

/**
 * - patrol:  ambient presence at level 0, cruising with the siren off
 * - pursuit: after the player (or searching where they were last seen)
 * - leaving: stood down; drives off and disappears once nobody is looking
 */
type Role = 'patrol' | 'pursuit' | 'leaving';

/** A police vehicle and the officers who arrived in it. */
interface Unit {
  vehicle: Vehicle;
  pilot: Autopilot;
  crew: Officer[];
  callSign: string;
  role: Role;
  van: boolean;
  /** Crew are out on foot (or the driver is gone): the car waits with the brakes on. */
  parked: boolean;
  blip: boolean;
  /** Cruising the area where the player was last seen. */
  searching: boolean;
  /** Crew on foot have been called back to the car. */
  recalled: boolean;
  /** Metres to one side of the suspect this car aims for when closing in, so a pack does not queue nose to tail. */
  flank: number;
  // Timers (seconds).
  replan: number;
  aim: number;
  check: number;
  stopTime: number;
  unstick: number;
  unstickSteer: number;
  unstickCooldown: number;
  stuck: number;
  unseenAfoot: number;
  recallTime: number;
  farTime: number;
  vanish: number;
}

interface Roadblock {
  cars: Vehicle[];
  guards: Officer[];
  callSign: string;
  x: number;
  y: number;
  z: number;
  age: number;
  check: number;
  /** The player has been right up to it (so driving away means it was run or dodged). */
  reached: boolean;
}

export interface ForceHooks {
  /** Radio chatter; (x, z) is where it is about (defaults to the player's last known position). */
  radio(event: RadioEvent, callSign?: string, x?: number, z?: number): void;
  copHurt(officer: Officer, info: DamageInfo): void;
  copDied(officer: Officer, info: DamageInfo): void;
}

const drivable = (e: RoadEdge) => e.drivable;
const WHITE = 0xf2f2ee;
const NAVY = 0x1a2130;

/** Everything the police put on the street: patrol cars, their crews, roadblocks. Owns and cleans up all of it. */
export class Force implements OfficerHost {
  readonly units: Unit[] = [];
  readonly officers: Officer[] = [];
  readonly roadblocks: Roadblock[] = [];
  readonly rigs: RigPool;

  /** Police vehicles we spawned that are no longer units (stolen, wrecked, abandoned), awaiting cleanup. */
  private orphans: Vehicle[] = [];
  private weapons = new Map<CopWeapon, THREE.Object3D[]>();
  private view: View;
  private exits: TurnOption[] = [];
  private frame = 0;
  private spawnTimer = 0;
  private spawnFails = 0;
  private ambientQuota = 0;
  private ambientClock = 0;
  private roadblockTimer = 0;
  private sweep = 0;
  private signs = 0;
  private warned = false;
  private randomTurn: TurnPicker = (options) => this.rng.int(0, options.length - 1);

  constructor(
    readonly ctx: GameContext,
    readonly intel: Intel,
    readonly rng: Rng,
    private hooks: ForceHooks,
  ) {
    this.rigs = new RigPool(ctx);
    this.view = new View(ctx);
  }

  // ───────────── OfficerHost ─────────────

  borrowWeapon(id: CopWeapon): THREE.Object3D | null {
    const spare = this.weapons.get(id)?.pop();
    if (spare) return spare;
    try {
      return this.ctx.combat.createWeaponModel(id);
    } catch {
      return null;
    }
  }

  returnWeapon(id: CopWeapon, model: THREE.Object3D) {
    model.removeFromParent();
    let list = this.weapons.get(id);
    if (!list) this.weapons.set(id, (list = []));
    list.push(model);
  }

  copHurt(officer: Officer, info: DamageInfo) {
    this.hooks.copHurt(officer, info);
  }

  copDied(officer: Officer, info: DamageInfo) {
    this.setOfficerBlip(officer, false);
    this.hooks.copDied(officer, info);
  }

  // ───────────── Queries ─────────────

  /** Is this one of ours (an officer, or any vehicle in police livery)? */
  isPolice(thing: Actor | Vehicle): boolean {
    if (thing instanceof Officer) return true;
    return 'tags' in thing && thing.tags.has('police');
  }

  /** Is this one of our crewed or roadblock vehicles? */
  ownsVehicle(thing: Actor | Vehicle | null): boolean {
    return !!thing && (this.units.some(u => u.vehicle === thing) || this.roadblocks.some(rb => rb.cars.some(v => v === thing)));
  }

  /** Call sign of the pursuing unit nearest the player (for radio chatter). */
  nearestCallSign(): string {
    return (this.pickUnit('pursuit', true) ?? this.pickUnit('patrol', true))?.callSign ?? CALL_SIGNS[0];
  }

  /** Hold off dispatching for a moment (the call has to come in first). */
  delayDispatch(seconds: number) {
    this.spawnTimer = Math.max(this.spawnTimer, seconds);
  }

  // ───────────── Frame ─────────────

  update(dt: number) {
    const { intel } = this;
    this.frame++;
    let onFoot = 0;
    for (const o of this.officers) if (o.alive && o.mode !== 'seated') onFoot++;
    intel.onFoot = onFoot;

    this.dispatch(dt);
    for (let i = this.units.length - 1; i >= 0; i--) this.updateUnit(this.units[i], dt);
    this.updateRoadblocks(dt);

    const blips = intel.level > 0 && !intel.suspended;
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      o.update(dt, i, this.frame);
      this.setOfficerBlip(o, blips && o.alive && !o.expired && (o.mode === 'pursue' || o.mode === 'guard'));
      if (this.officerDone(o, i)) {
        this.setOfficerBlip(o, false);
        o.retire();
        this.officers.splice(i, 1);
      }
    }

    this.sweep -= dt;
    if (this.sweep <= 0) {
      this.sweep = 1;
      this.sweepOrphans();
    }
  }

  private officerDone(o: Officer, slot: number): boolean {
    if (o.removed || o.expired) return true;
    if (!o.alive) return o.corpseTime > TUNING.corpseSeconds;
    if (o.mode === 'seated' || o.mode === 'guard') return false;
    if ((this.frame + slot) % 20 !== 0) return false;
    const pp = this.ctx.player.position;
    const d = Math.hypot(o.position.x - pp.x, o.position.z - pp.z);
    if (o.mode === 'leave') return this.view.canVanish(o.position, 45);
    // On foot with no car to go back to and left a long way behind.
    return o.home === null && d > 260;
  }

  // ───────────── Dispatch ─────────────

  private dispatch(dt: number) {
    const { ctx, intel, rng } = this;
    this.spawnTimer -= dt;
    let pursuit = 0;
    let patrol = 0;
    for (const u of this.units) {
      if (u.role === 'pursuit') pursuit++;
      else if (u.role === 'patrol') patrol++;
    }

    if (intel.level > 0 && !intel.suspended) {
      const want = Math.min(intel.response.cars, MAX_POLICE_VEHICLES);
      // The nearest car already on the street responds first.
      while (pursuit < want) {
        const u = this.pickUnit('patrol', true) ?? this.pickUnit('leaving', true);
        if (!u) break;
        this.setRole(u, 'pursuit');
        pursuit++;
      }
      if (pursuit > want) {
        const u = this.pickUnit('pursuit', false);
        if (u) this.setRole(u, 'leaving');
      } else if (pursuit < want && this.units.length < MAX_POLICE_VEHICLES && this.spawnTimer <= 0) {
        let van = intel.response.van && ctx.vehicles.specs.has('van');
        for (const u of this.units) if (u.van) van = false; // one is plenty
        this.spawnTimer = this.spawnUnit('pursuit', van) ? intel.response.spawnInterval : 0.6;
      }
      return;
    }

    // Nothing to chase: keep a patrol car or two about in town, send the rest home.
    this.ambientClock -= dt;
    if (this.ambientClock <= 0) {
      this.ambientClock = 2;
      const pp = ctx.player.position;
      const city = ctx.world.districtAt(pp.x, pp.z).city;
      this.ambientQuota = intel.suspended || city === null ? 0 : city === 'christchurch' ? TUNING.ambientChristchurch : TUNING.ambientTown;
    }
    for (const u of this.units) {
      if (u.role !== 'pursuit') continue;
      if (patrol < this.ambientQuota && !u.van) {
        this.setRole(u, 'patrol');
        patrol++;
      } else this.setRole(u, 'leaving');
    }
    if (patrol > this.ambientQuota) {
      const u = this.pickUnit('patrol', false);
      if (u) this.setRole(u, 'leaving');
    } else if (patrol < this.ambientQuota && this.units.length < MAX_POLICE_VEHICLES && this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnUnit('patrol', false) ? rng.range(6, 14) : 2;
    }
  }

  private setRole(u: Unit, role: Role) {
    u.role = role;
    u.replan = 0;
    u.aim = 0;
    u.searching = false;
    u.stopTime = 0;
    u.farTime = 0;
    u.vanish = 0;
  }

  /** The unit with this role nearest to (or farthest from) the player. */
  private pickUnit(role: Role, nearest: boolean): Unit | null {
    const pp = this.ctx.player.position;
    let best: Unit | null = null;
    let bestD = nearest ? Infinity : -1;
    for (const u of this.units) {
      if (u.role !== role) continue;
      const d = Math.hypot(u.vehicle.position.x - pp.x, u.vehicle.position.z - pp.z);
      if (nearest ? d < bestD : d > bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  /**
   * The patrol spec. In town it is the white town car; out on the open road (no town, or a rural
   * district) about half the units are the black and white ex-traffic car, when that spec exists.
   */
  private policeSpec(x?: number, z?: number): string | null {
    const specs = this.ctx.vehicles.specs;
    if (!specs.has('police')) return specs.has('trafficcar') ? 'trafficcar' : specs.has('statesman') ? 'statesman' : null;
    if (x !== undefined && z !== undefined && specs.has('trafficcar')) {
      const district = this.ctx.world.districtAt(x, z);
      if ((district.city === null || district.type === 'rural') && this.rng.chance(0.5)) return 'trafficcar';
    }
    return 'police';
  }

  /** Spec-appropriate livery: patrol cars keep their own paint; a borrowed sedan is painted white. */
  private liveryOf(specId: string): number | undefined {
    return this.ctx.vehicles.specs.get(specId)?.cls === 'police' ? undefined : WHITE;
  }

  private weaponFor(seat: number, van: boolean): CopWeapon {
    return (van || (this.intel.response.shotguns && seat > 0)) && this.ctx.combat.weapons.has('shotgun') ? 'shotgun' : 'pistol';
  }

  private makePilot(vehicle: Vehicle): Autopilot {
    try {
      return this.ctx.traffic.createAutopilot(vehicle);
    } catch {
      if (!this.warned) {
        this.warned = true;
        console.warn('[police] traffic autopilot unavailable; patrol cars are using the fallback driver');
      }
      return new SimplePilot(vehicle, this.ctx.world.graph);
    }
  }

  private spawnUnit(role: Role, van: boolean): boolean {
    const { ctx, rng } = this;
    if (!van && !this.policeSpec()) return false;
    const spot = this.findSpawn();
    if (!spot) {
      this.spawnFails++;
      return false;
    }
    // The spec is picked where the car appears, so open-road units differ from town ones.
    const specId = van ? 'van' : this.policeSpec(spot.x, spot.z);
    if (!specId || !ctx.vehicles.specs.has(specId)) return false;
    let vehicle: Vehicle | null = null;
    try {
      vehicle = ctx.vehicles.spawn(specId, spot.x, spot.z, spot.heading, {
        controller: 'police',
        tags: van ? ['police', 'armed-response'] : ['police'],
        color: van ? NAVY : this.liveryOf(specId),
      });
    } catch {
      vehicle = null;
    }
    if (!vehicle) {
      this.spawnFails++;
      return false;
    }
    this.spawnFails = 0;
    const seats = Math.max(1, Math.min(van ? 4 : 2, vehicle.spec.seats));
    const crew: Officer[] = [];
    for (let i = 0; i < seats; i++) {
      const o = new Officer(this, van ? ARMED_LOOK : rng.int(0, PATROL_LOOKS - 1), this.weaponFor(i, van), van ? TUNING.armedHealth : TUNING.copHealth);
      o.home = vehicle;
      o.board(vehicle, i);
      crew.push(o);
      this.officers.push(o);
    }
    this.units.push({
      vehicle,
      pilot: this.makePilot(vehicle),
      crew,
      callSign: van ? VAN_CALL_SIGN : CALL_SIGNS[this.signs++ % CALL_SIGNS.length],
      role,
      van,
      parked: false,
      blip: false,
      searching: false,
      recalled: false,
      flank: rng.range(-3.2, 3.2),
      replan: 0,
      aim: 0,
      check: 1,
      stopTime: 0,
      unstick: 0,
      unstickSteer: 1,
      unstickCooldown: 0,
      stuck: 0,
      unseenAfoot: 0,
      recallTime: 0,
      farTime: 0,
      vanish: 0,
    });
    return true;
  }

  /** A lane position on a drivable road 150–250 m away, out of the player's view, facing towards them. */
  private findSpawn(): { x: number; y: number; z: number; heading: number } | null {
    const { ctx, intel, rng } = this;
    const T = TUNING;
    const g = ctx.world.graph;
    const pp = ctx.player.position;
    // After a run of failures (open plains, nowhere to hide) accept a distant spot in view.
    const lenient = this.spawnFails >= 4;

    // From the station when there is one close by.
    if (rng.chance(0.4)) {
      const station = ctx.world.nearestPlace(pp.x, pp.z, 'police');
      if (station) {
        const d = Math.hypot(station.x - pp.x, station.z - pp.z);
        const hit = d > T.spawnNearest && d < T.stationRange ? g.nearest(station.x, station.z, 60, drivable) : null;
        if (hit) {
          const t = g.pointAt(hit.edge, hit.s);
          const dir: 1 | -1 = hit.edge.oneway || (pp.x - hit.x) * t.tx + (pp.z - hit.z) * t.tz >= 0 ? 1 : -1;
          const spot = g.lanePoint(hit.edge, hit.s, dir, 0);
          if (this.spotOk(spot, lenient)) return spot;
        }
      }
    }

    const road = g.nearest(pp.x, pp.z, 60, drivable);
    if (road) {
      // Ahead on the player's road first (twice), then behind.
      const t = g.pointAt(road.edge, road.s);
      const moving = intel.playerSpeed > 2;
      const fx = moving ? intel.playerVelocity.x : Math.sin(ctx.player.heading);
      const fz = moving ? intel.playerVelocity.z : Math.cos(ctx.player.heading);
      const ahead: 1 | -1 = fx * t.tx + fz * t.tz >= 0 ? 1 : -1;
      for (let attempt = 0; attempt < 3; attempt++) {
        const dir: 1 | -1 = attempt < 2 ? ahead : ahead === 1 ? -1 : 1;
        const w = walkAhead(g, road.edge, road.s, dir, rng.range(T.spawnMin, T.spawnMax), attempt === 0 ? straightest : this.randomTurn);
        if (!w) continue;
        // Face back the way we walked: towards the player.
        const spot = g.lanePoint(w.edge, w.s, w.edge.oneway || w.dir === -1 ? 1 : -1, 0);
        if (this.spotOk(spot, lenient)) return spot;
      }
      return null;
    }

    // The player is out in the paddocks (or the middle of a mall): work outwards from the nearest junction.
    const node = this.nearestDrivableNode(pp.x, pp.z);
    for (const index of node.edges) {
      const e = g.edges[index];
      if (!e.drivable) continue;
      const dir: 1 | -1 = e.a === node.index ? 1 : -1;
      if (e.oneway && dir === -1) continue;
      const w = walkAhead(g, e, dir === 1 ? 0 : e.length, dir, rng.range(60, 180), this.randomTurn);
      if (!w) continue;
      const spot = g.lanePoint(w.edge, w.s, w.edge.oneway || w.dir === -1 ? 1 : -1, 0);
      if (this.spotOk(spot, lenient)) return spot;
    }
    return null;
  }

  private spotOk(spot: { x: number; y: number; z: number }, lenient: boolean): boolean {
    const { ctx } = this;
    const T = TUNING;
    const pp = ctx.player.position;
    const d = Math.hypot(spot.x - pp.x, spot.z - pp.z);
    if (d < T.spawnNearest || d > T.spawnFarthest) return false;
    if (!ctx.world.isLoaded(spot.x, spot.z)) return false;
    if (ctx.world.waterDepthAt(spot.x, spot.z) > 0) return false;
    if (ctx.vehicles.nearest(spot.x, spot.z, 9)) return false;
    if (this.view.visible(spot.x, spot.y + 1, spot.z)) return lenient && d > 200;
    return true;
  }

  // ───────────── Units ─────────────

  private updateUnit(u: Unit, dt: number) {
    const { ctx, intel, rng } = this;
    const T = TUNING;
    const v = u.vehicle;
    u.check -= dt;
    if (u.check <= 0) {
      u.check = 1;
      if (!ctx.vehicles.all.includes(v)) return this.dropUnit(u, false); // another system removed the car
    }
    if (v.controller !== 'police') return this.releaseUnit(u); // somebody else has the wheel
    if (v.destroyed) return this.wreckUnit(u);

    const pp = ctx.player.position;
    const dPlayer = Math.hypot(v.position.x - pp.x, v.position.z - pp.z);
    const pursuing = u.role === 'pursuit';
    this.setUnitBlip(u, pursuing);
    v.siren = pursuing;
    v.headlightsOn = ctx.env.night > NIGHT_HEADLIGHTS;

    let alive = 0;
    let seated = 0;
    let afoot = 0;
    let spare: Officer | null = null;
    for (const o of u.crew) {
      if (!o.alive || o.home !== v) continue;
      alive++;
      if (o.mode === 'seated' && o.vehicle === v) {
        seated++;
        if (o !== v.driver) spare = o;
      } else afoot++;
    }
    if (alive === 0) return this.abandonUnit(u);
    if (v.burning) {
      // Everybody out before it goes up.
      if (seated > 0) this.dismountCrew(u, true);
      holdStill(v);
      return;
    }

    // ── Crew on foot: call them back when the chase has moved on ──
    if (afoot > 0) {
      u.unseenAfoot = intel.seen ? 0 : u.unseenAfoot + dt;
      const away = intel.playerOnFoot ? dPlayer > T.remountOnFoot : dPlayer > T.remountDistance;
      const near = intel.playerOnFoot ? dPlayer < T.remountOnFoot - 25 : dPlayer < T.remountDistance - 15;
      if (!pursuing || intel.suspended || away || u.unseenAfoot > T.footSearch) u.recalled = true;
      else if (intel.seen && near) u.recalled = false;
      for (const o of u.crew) {
        if (!o.alive || o.home !== v || o.mode === 'seated') continue;
        if (u.recalled && o.mode === 'pursue') o.mode = 'return';
        else if (!u.recalled && o.mode === 'return') o.mode = 'pursue';
      }
    }

    const driver = v.driver;
    const crewed = driver !== null && driver.kind === 'cop' && driver.alive;
    if (!crewed && spare && v.driver === null && afoot === 0) {
      // Lost the driver: whoever is left in the car slides across.
      ctx.vehicles.exit(spare);
      spare.board(v, 0);
      holdStill(v);
      return;
    }
    if (!crewed) u.parked = true;

    if (u.parked) {
      holdStill(v);
      if (afoot === 0 && crewed) {
        // Everyone is back aboard.
        u.parked = false;
        u.recalled = false;
        u.recallTime = 0;
        u.replan = 0;
        u.aim = 0;
        u.searching = false;
        v.controls.handbrake = false;
      } else if (u.recalled) {
        u.recallTime += dt;
        if (u.recallTime > 16 && crewed) {
          // Cannot wait any longer: the stragglers are on their own.
          for (const o of u.crew) if (o.alive && o.home === v && o.mode !== 'seated') o.home = null;
        } else if (u.recallTime > 25 && !pursuing) {
          // Stood down and nobody is coming back for it: take it away once nobody is looking.
          u.vanish -= dt;
          if (u.vanish <= 0) {
            u.vanish = 0.5;
            if (this.view.canVanish(v.position)) return this.dropUnit(u, true);
          }
        }
      } else {
        u.recallTime = 0;
        if (seated > 0 && pursuing && intel.seen && dPlayer < T.dismountRangeArmed) this.dismountCrew(u, false);
      }
      return;
    }

    // ── Wedged: back out with the wheel hard over, then plan again ──
    u.unstickCooldown -= dt;
    if (u.unstick > 0) {
      u.unstick -= dt;
      const c = v.controls;
      c.throttle = 0;
      c.brake = 1;
      c.steer = u.unstickSteer;
      c.handbrake = false;
      if (u.unstick <= 0) {
        u.replan = 0;
        u.aim = 0;
        u.unstickCooldown = 3;
      }
      return;
    }
    if (u.pilot.stuckTime > (pursuing ? 3 : 8) && u.unstickCooldown <= 0) {
      u.stuck++;
      // Hopeless: start again somewhere else, if nobody is watching.
      if (u.stuck >= 3 && this.view.canVanish(v.position)) return this.dropUnit(u, true);
      u.unstick = 1.4;
      u.unstickSteer = rng.chance(0.5) ? 1 : -1;
      return;
    }

    if (pursuing) this.drivePursuit(u, dt);
    else this.driveIdle(u, dt, dPlayer);
  }

  private drivePursuit(u: Unit, dt: number) {
    const { intel, rng } = this;
    const T = TUNING;
    const R = intel.response;
    const v = u.vehicle;
    const pilot = u.pilot;
    const tx = intel.target.x;
    const tz = intel.target.z;
    const d = Math.hypot(v.position.x - tx, v.position.z - tz);

    // Left far behind: make way for a unit that can actually get there.
    if (d > T.outrunDistance) {
      u.farTime += dt;
      if (u.farTime > 3) {
        u.farTime = 2.5; // look again in half a second
        if (this.view.canVanish(v.position, 200)) return this.dropUnit(u, true);
      }
    } else u.farTime = 0;

    if (intel.seen || (u.searching && d > 90)) {
      // Seen again, or a fresh report has put the suspect somewhere else: back on the chase.
      if (u.searching) u.replan = 0;
      u.searching = false;
    } else if (!u.searching && d < 28) {
      u.searching = true;
      u.replan = 0;
    }

    let hold = false;
    if (u.searching) {
      // Lost them: cruise the neighbourhood, drifting away.
      pilot.cruiseSpeed = T.searchSpeed;
      pilot.aggression = 1.3;
      pilot.avoidObstacles = true;
      u.replan -= dt;
      if (u.replan <= 0 || pilot.arrived) {
        u.replan = 14;
        this.wander(u, false);
      }
    } else {
      const stopped = intel.playerOnFoot || intel.playerSpeed < T.suspectStoppedSpeed;
      const ring = intel.shoot ? T.dismountRangeArmed : T.dismountRange;
      // Coming up on a suspect who is on foot or has stopped: shed speed so as to pull up short of them
      // rather than on top of them (a comfortable 5 m/s² down to a few m/s faster than they are moving at
      // the ring where the crew get out).
      pilot.cruiseSpeed = intel.seen && stopped ? Math.min(R.cruise, intel.playerSpeed + 4 + Math.sqrt(10 * Math.max(0, d - ring))) : R.cruise;
      pilot.aggression = R.aggression;
      if (d < T.directRange || (intel.playerOffRoad && d < T.offRoadChase)) {
        // Close in: straight at them, or at a point just ahead of their car when the gloves are off.
        const ramming = R.ram && intel.seen && !stopped;
        // Not out to ram (yet): sit on the suspect's tail at their pace. The autopilot does not brake for its
        // quarry, so without this a patrol car would plough into the back of them at full chat.
        if (intel.seen && !stopped && !ramming) pilot.cruiseSpeed = Math.min(R.cruise, Math.max(3, intel.playerSpeed + clamp((d - T.tailGap) * 0.8, -3, 12)));
        u.aim -= dt;
        if (u.aim <= 0) {
          u.aim = 0.15;
          const lead = ramming ? T.ramLead : 0;
          // Alongside rather than up the exhaust pipe: each car favours its own side of a moving suspect.
          const side = !stopped && intel.playerSpeed > 1 ? u.flank / intel.playerSpeed : 0;
          pilot.setTarget(tx + intel.playerVelocity.x * lead + intel.playerVelocity.z * side, tz + intel.playerVelocity.z * lead - intel.playerVelocity.x * side);
        }
        pilot.avoidObstacles = !ramming;
        u.replan = 0;
        // Pull up by a suspect who is on foot or has stopped, and get out. Once the car has started to pull
        // up it carries on even if a runner opens the gap a little, or it would tail them for ever.
        if (intel.seen && stopped && d < ring + (u.stopTime > 0 ? 8 : 0)) {
          hold = true;
          u.stopTime += dt;
          if (u.stopTime > 0.35) {
            if (intel.playerOnFoot && intel.playerSpeed > T.runnerSpeed) {
              // A runner: the passenger gives chase on foot while the driver keeps up in the car.
              if (Math.abs(v.speed) < 9) this.dismountCrew(u, false, true);
            } else if (Math.abs(v.speed) < T.dismountSpeed && this.dismountCrew(u, false)) return;
          }
        } else u.stopTime = 0;
      } else {
        pilot.avoidObstacles = true;
        u.aim = 0;
        u.replan -= dt;
        if (u.replan <= 0) {
          u.replan = T.replan + rng.range(0, 0.4);
          this.planRoute(u, tx, tz);
        }
      }
    }
    if (hold) holdStill(v);
    else pilot.update(dt);
  }

  private driveIdle(u: Unit, dt: number, dPlayer: number) {
    const T = TUNING;
    const v = u.vehicle;
    const pilot = u.pilot;
    const leaving = u.role === 'leaving';
    if (leaving || dPlayer > T.ambientDespawn) {
      u.vanish -= dt;
      if (u.vanish <= 0) {
        u.vanish = 0.5;
        if (dPlayer > T.ambientDespawn + 120 || this.view.canVanish(v.position, leaving ? 110 : 200)) return this.dropUnit(u, true);
      }
    }
    pilot.cruiseSpeed = T.patrolSpeed;
    pilot.aggression = 1;
    pilot.avoidObstacles = true;
    u.replan -= dt;
    if (u.replan <= 0 || pilot.arrived) {
      u.replan = 45;
      this.wander(u, leaving);
    }
    pilot.update(dt);
  }

  /** Nearest junction a car can actually drive to (`graph.nearestNode` may return one on a pedestrian mall). */
  private nearestDrivableNode(x: number, z: number): RoadNode {
    const g = this.ctx.world.graph;
    let best: RoadNode | null = null;
    let bestD = Infinity;
    for (const n of g.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d >= bestD) continue;
      for (const index of n.edges) {
        if (g.edges[index].drivable) {
          bestD = d;
          best = n;
          break;
        }
      }
    }
    return best ?? g.nearestNode(x, z);
  }

  /** Which way along `hit.edge` the vehicle is pointing. */
  private travelDir(v: Vehicle, hit: RoadHit): 1 | -1 {
    if (hit.edge.oneway) return 1;
    const t = this.ctx.world.graph.pointAt(hit.edge, hit.s);
    return Math.sin(v.heading) * t.tx + Math.cos(v.heading) * t.tz >= 0 ? 1 : -1;
  }

  /** Send a car off along a rambling route: mostly straight on, or steadily away from the player. */
  private wander(u: Unit, away: boolean) {
    const { ctx, rng } = this;
    const g = ctx.world.graph;
    const v = u.vehicle;
    const hit = g.nearest(v.position.x, v.position.z, 45, drivable);
    if (!hit) {
      const n = this.nearestDrivableNode(v.position.x, v.position.z);
      u.pilot.setTarget(n.x, n.z);
      return;
    }
    const pp = ctx.player.position;
    let edge = hit.edge;
    let dir = this.travelDir(v, hit);
    const route: Leg[] = [{ edge, dir }];
    let length = dir === 1 ? edge.length - hit.s : hit.s;
    for (let i = 0; i < 12 && length < 600; i++) {
      const options = exitsFrom(g, edge, dir, this.exits);
      if (!options.length) {
        // Dead end: come back the way we went.
        if (!edge.oneway) route.push({ edge, dir: dir === 1 ? -1 : 1 });
        break;
      }
      let choice = options[straightest(options)];
      if (away) {
        let far = -1;
        for (const o of options) {
          const end = g.endNode(o.edge, o.dir);
          const d = Math.hypot(end.x - pp.x, end.z - pp.z);
          if (d > far) {
            far = d;
            choice = o;
          }
        }
      } else if (rng.chance(0.4)) choice = rng.pick(options);
      edge = choice.edge;
      dir = choice.dir;
      route.push({ edge, dir });
      length += edge.length;
    }
    u.pilot.setRoute(route, hit.s);
  }

  /** Lane route from the car to the road the player is on (or was last seen on). */
  private planRoute(u: Unit, tx: number, tz: number) {
    const { ctx, intel } = this;
    const g = ctx.world.graph;
    const v = u.vehicle;
    const pilot = u.pilot;
    const hit = g.nearest(v.position.x, v.position.z, 45, drivable);
    if (!hit) {
      pilot.setTarget(tx, tz); // off the road ourselves: cut straight across
      return;
    }
    const edge = hit.edge;
    let dir: 1 | -1 = edge.oneway ? 1 : pilot.edge === edge ? pilot.dir : this.travelDir(v, hit);
    const goal = intel.targetRoad;

    // Same stretch of road as the suspect: just drive along it.
    if (goal && goal.edge === edge) {
      const want: 1 | -1 = goal.s >= hit.s ? 1 : -1;
      if (!edge.oneway || want === 1) {
        pilot.setRoute([{ edge, dir: want }], hit.s);
        return;
      }
    }

    // Make for the nearer end of the suspect's road (a one-way road is entered at its start), then along it.
    let to = this.nearestDrivableNode(tx, tz);
    let last: Leg | null = null;
    if (goal) {
      const a = g.nodes[goal.edge.a];
      const b = g.nodes[goal.edge.b];
      const viaA = goal.edge.oneway || Math.hypot(a.x - v.position.x, a.z - v.position.z) <= Math.hypot(b.x - v.position.x, b.z - v.position.z);
      to = viaA ? a : b;
      last = { edge: goal.edge, dir: viaA ? 1 : -1 };
    }
    let legs = g.route(g.endNode(edge, dir).index, to.index);
    if (legs === null && !edge.oneway) {
      dir = dir === 1 ? -1 : 1;
      legs = g.route(g.endNode(edge, dir).index, to.index);
    }
    if (legs === null) {
      pilot.setTarget(tx, tz);
      return;
    }
    const route: Leg[] = [];
    // If the best way there doubles straight back along this road, turn round now rather than at the next junction.
    if (!(legs.length && legs[0].edge === edge && !edge.oneway)) route.push({ edge, dir });
    for (const leg of legs) route.push(leg);
    if (last && route[route.length - 1].edge !== last.edge) route.push(last);
    pilot.setRoute(route, hit.s);
  }

  /**
   * Crew out of the car (passengers first), as far as the on-foot cap allows; `force` ignores the cap.
   * With `keepDriver` only the passengers go, and they are on their own from then on: the car drives on
   * without waiting for them. Returns true if anyone got out.
   */
  private dismountCrew(u: Unit, force: boolean, keepDriver = false): boolean {
    const { intel } = this;
    let out = false;
    for (let i = u.crew.length - 1; i >= 0; i--) {
      const o = u.crew[i];
      if (!o.alive || o.mode !== 'seated' || o.vehicle !== u.vehicle) continue;
      if (keepDriver && o === u.vehicle.driver) continue;
      if (!force && intel.onFoot >= MAX_ON_FOOT) break;
      o.rearm(this.weaponFor(o.seat, u.van));
      o.dismount('pursue');
      if (keepDriver) o.home = null;
      intel.onFoot++;
      out = true;
    }
    if (out && !keepDriver) {
      u.parked = true;
      u.recalled = false;
      u.recallTime = 0;
      u.unseenAfoot = 0;
      u.stopTime = 0;
      u.pilot.stop();
      holdStill(u.vehicle);
    }
    return out;
  }

  private detach(u: Unit) {
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    this.setUnitBlip(u, false);
    // Let the autopilot give up whatever it was holding (junction claims), unless the car is someone else's now.
    if (u.vehicle.controller === 'police') u.pilot.stop();
  }

  /** Take a unit off the board. With `removeVehicle` the car and anyone sitting in it disappear. */
  private dropUnit(u: Unit, removeVehicle: boolean) {
    const { ctx } = this;
    const v = u.vehicle;
    this.detach(u);
    for (const o of u.crew) {
      if (o.removed) continue;
      if (o.alive && o.mode === 'seated') o.expired = true;
      if (o.home === v) o.home = null;
    }
    if (removeVehicle && ctx.vehicles.all.includes(v)) ctx.vehicles.remove(v);
  }

  /** The car is a wreck: anyone still inside is lost with it; the wreck is cleaned up later. */
  private wreckUnit(u: Unit) {
    const v = u.vehicle;
    this.detach(u);
    for (const o of u.crew) {
      if (o.removed) continue;
      if (o.alive && o.vehicle === v) o.takeDamage({ amount: 9999, kind: 'explosion' });
      if (o.home === v) o.home = null;
    }
    v.siren = false;
    this.orphans.push(v);
  }

  /** No crew left alive: the car sits where it stopped. */
  private abandonUnit(u: Unit) {
    const v = u.vehicle;
    this.detach(u);
    v.siren = false;
    v.controller = 'none';
    holdStill(v);
    this.orphans.push(v);
  }

  /** Somebody else took control of the car (the player stole it, a mission claimed it). */
  private releaseUnit(u: Unit) {
    const v = u.vehicle;
    this.detach(u);
    for (const o of u.crew) {
      if (o.removed) continue;
      if (o.home === v) o.home = null;
      if (o.alive && o.mode === 'seated' && o.vehicle === v) o.dismount('pursue');
    }
    v.siren = false;
    this.orphans.push(v);
  }

  /** Clean up police vehicles nobody is using once the player is well away or not looking. */
  private sweepOrphans() {
    const { ctx } = this;
    const pp = ctx.player.position;
    for (let i = this.orphans.length - 1; i >= 0; i--) {
      const v = this.orphans[i];
      if (!ctx.vehicles.all.includes(v)) {
        this.orphans.splice(i, 1);
        continue;
      }
      if (ctx.player.vehicle === v || v.driver !== null || v.passengers.length > 0) continue;
      if (v.controller !== 'none' && v.controller !== 'police') continue; // a mission has it
      const d = Math.hypot(v.position.x - pp.x, v.position.z - pp.z);
      if (d > 260 || (d > (v.destroyed ? 90 : 150) && !this.view.visible(v.position.x, v.position.y + 1, v.position.z))) {
        ctx.vehicles.remove(v);
        this.orphans.splice(i, 1);
      }
    }
  }

  // ───────────── Roadblocks ─────────────

  private updateRoadblocks(dt: number) {
    const { ctx, intel } = this;
    const T = TUNING;
    const pp = ctx.player.position;
    const idle = intel.level === 0 || intel.suspended;
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      rb.age += dt;
      const d = Math.hypot(rb.x - pp.x, rb.z - pp.z);
      if (d < 60) rb.reached = true;
      let remove = d > T.roadblockRemove;
      rb.check -= dt;
      if (!remove && rb.check <= 0) {
        rb.check = 0.5;
        for (let k = rb.cars.length - 1; k >= 0; k--) {
          const v = rb.cars[k];
          if (!ctx.vehicles.all.includes(v)) rb.cars.splice(k, 1);
          else if (v.controller !== 'none') {
            // Driven off by somebody.
            rb.cars.splice(k, 1);
            v.siren = false;
            this.orphans.push(v);
          } else {
            v.siren = !idle && !v.destroyed;
            v.controls.handbrake = true;
          }
        }
        // Heat lost, run, dodged or never reached: take it down once nobody is looking.
        // (Promptly once passed: the cars chasing the player have to get through here too.)
        if (idle || rb.cars.length === 0 || (rb.reached && d > 80) || (rb.age > 40 && d > 220)) remove = d > 60 && !this.view.visible(rb.x, rb.y + 1, rb.z);
      }
      if (remove) {
        this.removeRoadblock(rb);
        this.roadblocks.splice(i, 1);
      }
    }

    this.roadblockTimer -= dt;
    if (this.roadblockTimer <= 0 && intel.level >= 3 && !intel.suspended && this.roadblocks.length < Math.min(MAX_ROADBLOCKS, intel.response.roadblocks)) {
      this.roadblockTimer = this.placeRoadblock() ? T.roadblockCooldown : 2;
    }
  }

  /** Two cars nose to tail across the road 180–300 m ahead of the player, with officers behind them. */
  private placeRoadblock(): boolean {
    const { ctx, intel, rng } = this;
    const T = TUNING;
    if (intel.playerOnFoot || !intel.seen || intel.playerSpeed < T.roadblockMinSpeed) return false;
    const road = intel.targetRoad;
    if (!road || road.distance > road.edge.width / 2 + 3) return false;
    if (!this.policeSpec()) return false;
    const guards = Math.min(2, MAX_ON_FOOT - intel.onFoot);
    if (guards < 1) return false;

    const g = ctx.world.graph;
    const here = g.pointAt(road.edge, road.s);
    const dir: 1 | -1 = intel.playerVelocity.x * here.tx + intel.playerVelocity.z * here.tz >= 0 ? 1 : -1;
    const w = walkAhead(g, road.edge, road.s, dir, rng.range(T.roadblockMin, T.roadblockMax));
    if (!w) return false;
    const e = w.edge;
    if (e.bridge || e.tunnel || e.width < T.roadblockMinWidth || e.length < 36) return false;
    // Keep clear of the junctions at either end.
    const c = g.pointAt(e, Math.min(e.length - 14, Math.max(14, w.s)));
    const pp = ctx.player.position;
    const d = Math.hypot(c.x - pp.x, c.z - pp.z);
    if (d < 140 || d > T.roadblockRemove - 40) return false;
    // Each car's spec is picked where the block stands, so an open-road block may mix both patrol cars.
    const specIdA = this.policeSpec(c.x, c.z);
    const specIdB = this.policeSpec(c.x, c.z);
    const specA = specIdA ? ctx.vehicles.specs.get(specIdA) : undefined;
    const specB = specIdB ? ctx.vehicles.specs.get(specIdB) : undefined;
    if (!specIdA || !specA || !specIdB || !specB) return false;
    const spec = specA.length >= specB.length ? specA : specB;

    // (ax, az): the way the player will be travelling; (lx, lz): across the road, to the left of that.
    const ax = c.tx * w.dir;
    const az = c.tz * w.dir;
    const lx = az;
    const lz = -ax;
    const half = spec.length / 2 + 0.25;
    const x1 = c.x + lx * half;
    const z1 = c.z + lz * half;
    const x2 = c.x - lx * half;
    const z2 = c.z - lz * half;
    if (!ctx.world.isLoaded(x1, z1) || !ctx.world.isLoaded(x2, z2)) return false;
    if (ctx.world.waterDepthAt(c.x, c.z) > 0) return false;
    if (ctx.vehicles.nearest(c.x, c.z, spec.length + 5)) return false; // traffic in the way; try again shortly
    if (d < 230 && this.view.visible(c.x, c.y + 1, c.z)) return false; // do not pop into view up close

    const heading = Math.atan2(lx, lz);
    const first = this.spawnBlockCar(specIdA, x1, z1, heading);
    if (!first) return false;
    const second = this.spawnBlockCar(specIdB, x2, z2, heading);
    if (!second) {
      ctx.vehicles.remove(first);
      return false;
    }
    const callSign = CALL_SIGNS[this.signs++ % CALL_SIGNS.length];
    const rb: Roadblock = { cars: [first, second], guards: [], callSign, x: c.x, y: c.y, z: c.z, age: 0, check: 0.5, reached: false };
    const behind = spec.width / 2 + 1.1;
    for (let i = 0; i < guards; i++) {
      const side = i === 0 ? 1 : -1;
      const gx = c.x + lx * half * 0.9 * side + ax * behind;
      const gz = c.z + lz * half * 0.9 * side + az * behind;
      const o = new Officer(this, rng.int(0, PATROL_LOOKS - 1), this.weaponFor(i, false), T.copHealth);
      o.post.set(gx, 0, gz);
      o.postHeading = Math.atan2(-ax, -az);
      o.standAt(gx, gz, o.postHeading, 'guard');
      rb.guards.push(o);
      this.officers.push(o);
      intel.onFoot++;
    }
    this.roadblocks.push(rb);
    this.hooks.radio('roadblock', callSign, c.x, c.z);
    return true;
  }

  private spawnBlockCar(specId: string, x: number, z: number, heading: number): Vehicle | null {
    let v: Vehicle | null = null;
    try {
      v = this.ctx.vehicles.spawn(specId, x, z, heading, { controller: 'none', tags: ['police', 'roadblock'], color: this.liveryOf(specId) });
    } catch {
      v = null;
    }
    if (v) {
      v.siren = true;
      v.headlightsOn = this.ctx.env.night > NIGHT_HEADLIGHTS;
      v.controls.handbrake = true;
    }
    return v;
  }

  private removeRoadblock(rb: Roadblock) {
    const { ctx } = this;
    for (const v of rb.cars) {
      if (!ctx.vehicles.all.includes(v)) continue;
      if (ctx.player.vehicle === v || v.controller !== 'none') {
        v.siren = false;
        this.orphans.push(v);
      } else ctx.vehicles.remove(v);
    }
    rb.cars.length = 0;
    for (const o of rb.guards) if (o.alive) o.expired = true; // the fallen are cleared on their own timer
    rb.guards.length = 0;
  }

  // ───────────── Events ─────────────

  /**
   * The player got into a vehicle. If it is one of ours, its crew are turfed out and the car is no longer a
   * unit. Returns true if it was a police vehicle in service.
   */
  onPlayerEntered(vehicle: Vehicle, ejected: Actor | null): boolean {
    let ours = false;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.vehicle !== vehicle) continue;
      ours = true;
      for (const o of u.crew) {
        if (o.removed) continue;
        o.home = null;
        if (!o.alive || o.mode !== 'seated') continue;
        if (o === ejected || o.vehicle !== vehicle) o.thrownOut(vehicle);
        else o.dismount('pursue');
      }
      this.detach(u);
      vehicle.siren = false;
      this.orphans.push(vehicle);
      this.hooks.radio('carStolen', u.callSign);
    }
    for (const rb of this.roadblocks) {
      const k = rb.cars.indexOf(vehicle);
      if (k < 0) continue;
      ours = true;
      rb.cars.splice(k, 1);
      vehicle.siren = false;
      this.orphans.push(vehicle);
    }
    return ours;
  }

  /** One of the cars went up: anyone still inside goes with it. */
  onVehicleDestroyed(vehicle: Vehicle, source: Actor | null) {
    for (const o of this.officers) if (o.alive && o.vehicle === vehicle) o.takeDamage({ amount: 9999, kind: 'explosion', source });
  }

  // ───────────── Blips ─────────────

  private setUnitBlip(u: Unit, on: boolean) {
    if (u.blip === on) return;
    u.blip = on;
    const id = `police-car-${u.vehicle.id}`;
    if (on) this.ctx.ui.setBlip({ id, kind: 'police', x: u.vehicle.position.x, z: u.vehicle.position.z, label: u.callSign, follow: u.vehicle });
    else this.ctx.ui.removeBlip(id);
  }

  private setOfficerBlip(o: Officer, on: boolean) {
    if (o.blip === on) return;
    o.blip = on;
    const id = `police-cop-${o.id}`;
    if (on) this.ctx.ui.setBlip({ id, kind: 'police', x: o.position.x, z: o.position.z, follow: o });
    else this.ctx.ui.removeBlip(id);
  }

  // ───────────── Cleanup ─────────────

  /** Remove every unit, officer, roadblock and stray police vehicle at once (the screen is black, or the game is ending). */
  hardClear() {
    const { ctx } = this;
    const scrap = (v: Vehicle) => {
      v.siren = false;
      if (ctx.player.vehicle !== v && ctx.vehicles.all.includes(v)) ctx.vehicles.remove(v);
    };
    for (const u of this.units) {
      this.setUnitBlip(u, false);
      scrap(u.vehicle);
    }
    this.units.length = 0;
    for (const rb of this.roadblocks) for (const v of rb.cars) scrap(v);
    this.roadblocks.length = 0;
    for (const v of this.orphans) scrap(v);
    this.orphans.length = 0;
    for (const o of this.officers) {
      this.setOfficerBlip(o, false);
      o.retire();
    }
    this.officers.length = 0;
    this.intel.onFoot = 0;
    this.spawnTimer = 0;
    this.spawnFails = 0;
    this.roadblockTimer = 0;
  }

  dispose() {
    this.hardClear();
    this.rigs.dispose();
    this.weapons.clear();
  }
}
