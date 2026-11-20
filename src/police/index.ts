import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Actor, CrimeType, DamageInfo, GameContext, GameEvents, PoliceApi, RoadEdge, System, Vehicle } from '../core/types';
import { Force } from './force';
import { COP_SIGHT_SCALE, CRIME_RULES, HeatModel, judgeWitnesses, type CrimeRule, type Witness, type WitnessCandidate } from './heat';
import { Intel } from './intel';
import type { Officer } from './officer';
import { levelEvent, radioLine, whereText, type RadioEvent } from './radio';
import { Respray } from './respray';
import { responseFor } from './response';
import { TUNING } from './tuning';

/**
 * The law. An escalating wanted system ("heat"):
 *
 *   crime (witnessed) → HeatModel (heat.ts) → level 0..5 → Force (force.ts) puts cars, officers and
 *   roadblocks on the street → officers arrest or shoot (officer.ts) → heat is lost by staying out of
 *   sight, swapping cars, or a respray (respray.ts).
 *
 * This file is the wiring: events in, sight tracking, the busted check, radio chatter, the PoliceApi.
 */

interface Bystander extends WitnessCandidate {
  actor: Actor;
}

const drivable = (e: RoadEdge) => e.drivable;
const byDistance = (a: Bystander, b: Bystander) => a.distance - b.distance;
const _eye = new THREE.Vector3();
const _point = new THREE.Vector3();
const _aim = new THREE.Vector3();
const LONG_AGO = -1e9;

class Police implements PoliceApi, System {
  readonly name = 'police';

  private model = new HeatModel();
  private intel = new Intel();
  private rng = new Rng(0x1995c0b);
  private force: Force;
  private respray: Respray;
  private offs: (() => void)[] = [];

  /** Seconds of unpaused play (our own clock, for cooldowns and sight memory). */
  private now = 0;
  private readonly playerPoint = new THREE.Vector3();
  // Sight.
  private sightCursor = 0;
  private lastSeenAt = LONG_AGO;
  private seenNearAt = LONG_AGO;
  private wasSeen = false;
  private seenFor = 0;
  private unseenFor = 0;
  private roadClock = 0;
  /** The vehicle (id) the police last saw or heard the player described in; −1 = on foot. */
  private describedVehicle = -1;
  private swapped = false;
  // Arrest.
  private busting = false;
  private bustClock = 0;
  private bustTime = 0;
  private threatTime = 0;
  // Crimes.
  private bystanders: Bystander[] = [];
  private countedKills = new WeakSet<Actor>();
  private pendingKills: { officer: Officer; time: number }[] = [];
  private anonymousKillAt = LONG_AGO;
  private drivingClock = 0;
  // Radio.
  private radioAt = LONG_AGO;
  /** True while the heat model is ticking: level drops in here are the player's own evasion. */
  private ticking = false;

  constructor(private ctx: GameContext) {
    this.force = new Force(ctx, this.intel, this.rng, {
      radio: (event, callSign, x, z) => this.radio(event, callSign, false, x, z),
      copHurt: (officer, info) => this.copHurt(officer, info),
      copDied: (officer, info) => this.copDied(officer, info),
    });
    this.respray = new Respray(ctx, this.rng, () => this.clear());
    this.model.onLevelChanged = (level, previous) => this.levelChanged(level, previous);

    const e = ctx.events;
    this.offs.push(
      e.on('crime', (c) => this.onCrime(c)),
      e.on('playerDied', () => this.clear()),
      e.on('playerRespawned', () => this.reset()),
      e.on('vehicleEntered', (v) => this.onVehicleEntered(v)),
      e.on('vehicleCrash', (c) => this.onVehicleCrash(c)),
      e.on('vehicleDestroyed', (d) => this.force.onVehicleDestroyed(d.vehicle, d.source ?? null)),
    );
    // Nothing about a pursuit survives a save: loading always starts clean.
    ctx.save.register(
      'police',
      () => ({ level: 0 }),
      () => this.reset(),
    );
  }

  init() {
    this.respray.init();
    this.intel.lastKnown.copy(this.ctx.player.position);
  }

  // ───────────── PoliceApi ─────────────

  get level(): number {
    return this.model.level;
  }
  set level(value: number) {
    this.setLevel(value);
  }

  get heat(): number {
    return this.model.heat;
  }
  set heat(value: number) {
    this.model.heat = Math.min(this.model.level >= 5 ? 1 : 0.999, Math.max(0, value));
  }

  get evading(): number {
    return this.model.evading;
  }
  set evading(_value: number) {
    // Read-only in practice: the countdown belongs to the heat model.
  }

  get enabled(): boolean {
    return this.model.enabled;
  }
  set enabled(value: boolean) {
    if (value === this.model.enabled) return;
    this.model.enabled = value;
    // Suspending the law also drops whatever heat there was; units stand down and drive off.
    if (!value) this.clear();
  }

  setLevel(level: number) {
    if (level > this.model.level && !this.intel.seen) this.intel.lastKnown.copy(this.ctx.player.position);
    this.model.setLevel(level);
  }

  addHeat(amount: number) {
    if (amount > 0 && !this.intel.seen) this.intel.lastKnown.copy(this.ctx.player.position);
    this.model.addHeat(amount);
  }

  clear() {
    this.model.clear();
    this.bustTime = 0;
    this.threatTime = 0;
  }

  flush() {
    this.reset();
  }

  private reportClock = 0;
  /** Its own stream, so that who phones what in never changes how the rest of the response plays out. */
  private reportRng = new Rng(0x7e1e9);
  private reportedAt = -1e9;

  // ───────────── Frame ─────────────

  update(dt: number) {
    const { ctx, intel, model } = this;
    const T = TUNING;
    const player = ctx.player;
    this.now += dt;
    if (this.busting && (this.bustClock -= dt) <= 0) this.busting = false; // in case the respawn never comes
    intel.suspended = !model.enabled || !player.alive || this.busting;

    // ── The player, as the police see them ──
    const pv = player.vehicle;
    const pp = player.position;
    intel.playerOnFoot = pv === null;
    intel.playerVelocity.copy(player.velocity);
    intel.playerSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    this.playerPoint.set(pp.x, pp.y + (pv ? 0.4 : 1.2), pp.z);
    intel.aimPoint.set(pp.x, pp.y + (pv ? 0.3 : 1.15), pp.z);

    // (The last known position only moves on an actual sighting, not during the moment of sight memory.)
    if (this.scanSight()) {
      intel.lastKnown.copy(pp);
      this.describedVehicle = pv ? pv.id : -1;
      this.swapped = false;
    }
    const seen = !intel.suspended && this.now - this.lastSeenAt < T.seenMemory;
    intel.seen = seen;
    // Members of the public phone it in. Once wanted for something serious, a suspect noticed by bystanders,
    // or tearing along a road, is reported every few seconds even with no patrol car in sight. It does not
    // count as being seen (heat can still cool), but it gives the pursuit somewhere to go.
    this.reportClock -= dt;
    if (!seen && !intel.suspended && model.level >= 2 && this.reportClock <= 0) {
      this.reportClock = model.level >= 3 ? 2.5 : 4;
      // Tearing through a town gets phoned in from somebody's front window. Out on the plains it takes another
      // road user to see it, which is why the open highway is where a fast car can shake a pursuit.
      const type = ctx.world.districtAt(pp.x, pp.z).type;
      const builtUp = type !== 'rural' && type !== 'park' && type !== 'beach';
      const speeding =
        pv !== null &&
        intel.playerSpeed > 20 &&
        (builtUp || ctx.vehicles.all.some((v) => v !== pv && v.driver !== null && !v.destroyed && v.spec.cls !== 'police' && v.position.distanceToSquared(pp) < 70 * 70));
      // People recognise the car the police last described, or (three stars and up) the suspect on foot.
      // Slowing down in a car nobody has seen you take, or walking away quietly, is how the trail goes cold.
      const known = pv ? pv.id === this.describedVehicle && !this.swapped : model.level >= 3;
      const noticed = known && this.reportRng.next() < 0.6 && ctx.actors.near(pp.x, pp.z, pv ? 45 : 22, (a) => a.kind === 'ped' && a.alive).length > 0;
      if (speeding || noticed) {
        // Second-hand and a few seconds old: somewhere to head for, not a fix.
        const angle = this.reportRng.next() * Math.PI * 2;
        const off = speeding ? 10 : 28;
        intel.lastKnown.set(pp.x + Math.cos(angle) * off, pp.y, pp.z + Math.sin(angle) * off);
        this.reportedAt = this.now;
      }
    }
    intel.target.copy(seen ? pp : intel.lastKnown);
    if (pv && Math.abs(pv.speed) < T.suspectStoppedSpeed) pv.doorPosition(intel.arrestPoint, 0);
    else intel.arrestPoint.copy(pp);

    this.roadClock -= dt;
    if (this.roadClock <= 0) {
      this.roadClock = 0.3;
      const road = ctx.world.graph.nearest(intel.target.x, intel.target.z, 50, drivable);
      intel.targetRoad = road;
      intel.playerOffRoad = !road || road.distance > T.offRoadDistance;
    }

    // ── Heat ──
    const hot = model.level > 0;
    this.ticking = true;
    // While the calls keep coming in the trail is not going cold, though nobody is close enough to make
    // matters worse. To shake the police you have to stop drawing attention, not just get round a corner.
    const tracked = hot && !intel.suspended && this.now - this.reportedAt < 5;
    model.update(dt, (seen && hot) || tracked, seen && hot && intel.playerSpeed > 3);
    this.ticking = false;
    intel.level = model.level;
    intel.response = responseFor(model.level, model.heat);
    intel.shoot = intel.response.shoot && ctx.combat.weapons.has('pistol');

    if (model.level > 0 && !intel.suspended) {
      if (seen) {
        if (!this.wasSeen && this.unseenFor > 6) this.radio('spotted');
        this.seenFor += dt;
        this.unseenFor = 0;
      } else {
        if (this.wasSeen && this.seenFor > 3) this.radio('lost');
        this.unseenFor += dt;
        this.seenFor = 0;
      }
    } else {
      this.seenFor = 0;
      this.unseenFor = 0;
    }
    this.wasSeen = seen;

    // Officers killed by the player that nobody else has reported.
    for (let i = this.pendingKills.length - 1; i >= 0; i--) {
      const k = this.pendingKills[i];
      if ((k.time -= dt) > 0) continue;
      this.pendingKills.splice(i, 1);
      if (this.countedKills.has(k.officer)) continue;
      this.countedKills.add(k.officer);
      this.reportDirect('copKilled');
    }

    this.force.update(dt);
    this.checkBust(dt);
    this.checkDriving(dt);
    this.respray.update(model.level, seen);
  }

  /**
   * Which officers can see the player. Line-of-sight ray casts are rationed (`losPerFrame`) and handed
   * round the force in turn; with the cap on units everyone is refreshed several times a second.
   * Returns true if somebody saw the player this frame.
   */
  private scanSight(): boolean {
    const { ctx, intel } = this;
    const T = TUNING;
    const list = this.force.officers;
    const n = list.length;
    if (n === 0 || intel.suspended) return false;
    let sighted = false;
    let range = T.sightRange * (1 - (1 - T.sightNightScale) * Math.min(1, Math.max(0, ctx.env.night)));
    const visibility = ctx.env.visibility;
    if (visibility > 0 && visibility < range) range = visibility;
    const inCar = ctx.player.vehicle !== null;
    const pursuitRange = Math.max(range, Math.min(visibility > 0 ? visibility : Infinity, T.pursuitSightRange * (range / T.sightRange)));
    const target = this.playerPoint;
    let checks = 0;
    for (let visited = 0; visited < n && checks < T.losPerFrame; visited++) {
      this.sightCursor = (this.sightCursor + 1) % n;
      const o = list[this.sightCursor];
      const seated = o.mode === 'seated';
      // The driver keeps the lookout for the whole car.
      if (!o.alive || (seated && o.seat !== 0)) {
        o.sees = false;
        continue;
      }
      const d = Math.hypot(o.position.x - target.x, o.position.z - target.z);
      // Once a patrol car has a fleeing car in view it can hold it by eye from much further back than anyone
      // could pick it out in the first place.
      if (d > (seated && inCar && o.sees ? pursuitRange : range)) {
        o.sees = false;
        continue;
      }
      checks++;
      o.sees = ctx.physics.lineOfSight(_eye.set(o.position.x, o.position.y + (seated ? 0.5 : 1.6), o.position.z), target);
      if (o.sees) {
        sighted = true;
        this.lastSeenAt = this.now;
        if (d < T.nearSightRange) this.seenNearAt = this.now;
      }
    }
    return sighted;
  }

  // ───────────── Crimes ─────────────

  private onCrime(e: GameEvents['crime']) {
    const { ctx, model, intel } = this;
    if (!model.enabled || e.offender !== ctx.player) return;
    const victim = e.victim ?? null;
    let type: CrimeType = e.type;
    // Crimes against the police themselves are their own category and never go unnoticed.
    if (victim && this.force.isPolice(victim)) {
      if (type === 'murder') type = 'copKilled';
      else if (type !== 'copKilled' && type !== 'gunfire' && type !== 'recklessDriving') type = 'copAssault';
    }
    if (type === 'copKilled') {
      if (victim && 'kind' in victim) {
        if (this.countedKills.has(victim)) return;
        this.countedKills.add(victim);
      } else {
        // Reported without saying who: pair it with a death we have just seen (or are about to see)
        // so that one killing is not counted twice.
        const pending = this.pendingKills.shift();
        if (pending) this.countedKills.add(pending.officer);
        else this.anonymousKillAt = this.now;
      }
    }
    if (!model.ready(type)) return;
    const rule = CRIME_RULES[type];
    // The dead tell no tales: a murder victim is not a witness to it.
    const witness = rule.always ? 'cop' : this.findWitness(rule, e.position, type === 'murder' ? victim : null);
    if (witness === 'none') return;
    if (!model.report(type, witness)) return;
    // Whoever reported it also said where, and what the offender was driving.
    if (!intel.seen) {
      intel.lastKnown.copy(e.position);
      this.describedVehicle = ctx.player.vehicle ? ctx.player.vehicle.id : -1;
      this.swapped = false;
    }
  }

  /** Did a live constable or member of the public notice a crime at `at`? */
  private findWitness(rule: CrimeRule, at: THREE.Vector3, exclude: Actor | Vehicle | null): Witness {
    const list = this.bystanders;
    list.length = 0;
    const reach = Math.max(rule.hearRadius, rule.sightRadius * COP_SIGHT_SCALE);
    for (const a of this.ctx.actors.all) {
      if (!a.alive || a === exclude || (a.kind !== 'cop' && a.kind !== 'ped')) continue;
      const distance = Math.hypot(a.position.x - at.x, a.position.z - at.z);
      if (distance <= reach) list.push({ kind: a.kind, distance, actor: a });
    }
    if (!list.length) return 'none';
    list.sort(byDistance);
    _point.set(at.x, at.y + 1, at.z);
    const witness = judgeWitnesses(rule, list, this.hasSight);
    list.length = 0;
    return witness;
  }

  private hasSight = (b: Bystander): boolean => {
    const p = b.actor.position;
    return this.ctx.physics.lineOfSight(_eye.set(p.x, p.y + (b.actor.vehicle ? 0.6 : 1.5), p.z), _point);
  };

  /** A crime the police saw for themselves (or suffered). */
  private reportDirect(type: CrimeType) {
    if (this.model.report(type, 'cop') && !this.intel.seen) this.intel.lastKnown.copy(this.ctx.player.position);
  }

  private copHurt(_officer: Officer, info: DamageInfo) {
    // The combat system reports this too; the heat model's cooldown counts it once.
    if (info.source === this.ctx.player) this.reportDirect('copAssault');
  }

  private copDied(officer: Officer, info: DamageInfo) {
    if (this.model.level > 0) this.radio('officerDown', undefined, true, officer.position.x, officer.position.z);
    if (info.source !== this.ctx.player) return;
    if (this.now - this.anonymousKillAt < 0.5) {
      // Already reported, a moment ago, without a name.
      this.anonymousKillAt = LONG_AGO;
      this.countedKills.add(officer);
      return;
    }
    // The combat system normally reports the killing. Give it a moment, then count it ourselves if it did not.
    this.pendingKills.push({ officer, time: 0.3 });
  }

  private onVehicleEntered(e: GameEvents['vehicleEntered']) {
    const { ctx, model, intel } = this;
    if (e.actor !== ctx.player) return;
    if (this.force.onPlayerEntered(e.vehicle, e.ejected)) {
      // Helping yourself to a patrol car is an offence against the police, whoever is watching.
      this.reportDirect('copAssault');
      return;
    }
    // New wheels while nobody was looking: the description no longer fits. Once per time out of sight.
    if (model.level > 0 && !intel.seen && !this.swapped && e.vehicle.id !== this.describedVehicle && model.halveEvade()) this.swapped = true;
  }

  private onVehicleCrash(e: GameEvents['vehicleCrash']) {
    const pv = this.ctx.player.vehicle;
    if (!pv || (e.vehicle !== pv && e.other !== pv) || e.speed < 4 || this.intel.suspended) return;
    // Either chassis can register the impact. Other prangs still need a nearby witness.
    const partner = e.vehicle === pv ? e.other : e.vehicle;
    if (this.force.ownsVehicle(partner)) this.reportDirect('vehicleDamage');
    else if (this.now - this.seenNearAt < 1) this.reportDirect('recklessDriving');
  }

  /** Hooning past a patrol car. */
  private checkDriving(dt: number) {
    this.drivingClock -= dt;
    if (this.drivingClock > 0) return;
    this.drivingClock = 0.5;
    const { ctx, intel, model } = this;
    const pv = ctx.player.vehicle;
    if (!pv || intel.suspended || this.now - this.seenNearAt > 1 || !model.ready('recklessDriving')) return;
    const limit = intel.targetRoad ? intel.targetRoad.edge.speedLimit : 14;
    if (Math.abs(pv.speed) > Math.max(limit * 1.5, limit + 8)) this.reportDirect('recklessDriving');
  }

  // ───────────── Level changes ─────────────

  private levelChanged(level: number, previous: number) {
    const { ctx, intel } = this;
    intel.level = level;
    intel.response = responseFor(level, this.model.heat);
    if (previous === 0) {
      if (!intel.seen) intel.lastKnown.copy(ctx.player.position);
      this.force.delayDispatch(TUNING.firstResponseDelay);
      this.seenFor = 0;
      this.unseenFor = 0;
    }
    this.respray.showBlips(level > 0);
    ctx.events.emit('wantedChanged', { level, previous });
    if (level > previous) this.radio(levelEvent(level), undefined, true);
    else if (this.ticking) this.radio(level === 0 ? 'allClear' : 'stepDown', undefined, level === 0);
  }

  // ───────────── Busted ─────────────

  private checkBust(dt: number) {
    const { ctx, intel, model } = this;
    const T = TUNING;
    const player = ctx.player;
    if (model.level < 1 || intel.suspended) {
      this.bustTime = 0;
      this.threatTime = 0;
      return;
    }
    const pv = player.vehicle;
    // On foot, or sitting in a car that has all but stopped (they are pulled out of it).
    const eligible = !pv || Math.abs(pv.speed) < T.bustMaxVehicleSpeed;
    const weapon = ctx.combat.current.kind;
    const gun = player.aiming && weapon !== 'fists' && weapon !== 'melee';
    if (gun) player.aimDirection(_aim);
    const reach = intel.arrestPoint;
    const pp = player.position;
    let collared = false;
    let threatened = false;
    for (const o of this.force.officers) {
      if (!o.alive || o.mode === 'seated' || o.mode === 'leave') continue;
      const op = o.position;
      if (gun) {
        // Nobody makes a collar while looking down a barrel.
        const dx = op.x - pp.x;
        const dz = op.z - pp.z;
        const d = Math.hypot(dx, dz);
        if (d < 14 && d > 0.01 && (_aim.x * dx + _aim.z * dz) / d > 0.82) {
          threatened = true;
          continue;
        }
      }
      if (eligible && Math.hypot(op.x - reach.x, op.z - reach.z) <= T.bustRange && Math.abs(op.y - pp.y) < 2.5) collared = true;
    }
    this.bustTime = collared ? this.bustTime + dt : Math.max(0, this.bustTime - dt * 1.5);
    if (this.bustTime >= T.bustSeconds) {
      this.bust();
      return;
    }
    // Holding officers at gunpoint is an assault on police: before long they stop asking nicely.
    if (threatened && model.level < 3) {
      this.threatTime += dt;
      if (this.threatTime >= T.aimThreatSeconds) {
        this.threatTime = 0;
        if (model.report('copAssault', 'cop')) this.radio('gunDrawn', undefined, true);
      }
    } else this.threatTime = Math.max(0, this.threatTime - dt);
  }

  private bust() {
    const { ctx } = this;
    const pp = ctx.player.position;
    this.busting = true;
    this.bustClock = 10;
    this.bustTime = 0;
    this.threatTime = 0;
    const station = ctx.world.nearestPlace(pp.x, pp.z, 'police');
    ctx.ui.banner('Nicked', station ? `Down to ${station.name} for a wee chat` : 'Down to the station for a wee chat', 4, 'bad');
    // The others take it from here: the player module fades, respawns them at the nearest station and
    // charges bail; the combat module confiscates the weapons.
    ctx.events.emit('playerBusted', {});
    this.clear();
  }

  // ───────────── Radio ─────────────

  private pickLine = (count: number) => this.rng.int(0, count - 1);

  /** One line of dispatcher chatter, rate-limited. `urgent` lines (level changes) cut in sooner. */
  private radio(event: RadioEvent, callSign?: string, urgent = false, x?: number, z?: number) {
    const { ctx, intel } = this;
    if (this.now - this.radioAt < (urgent ? 1.2 : TUNING.radioGap)) return;
    this.radioAt = this.now;
    const at = intel.seen ? ctx.player.position : intel.lastKnown;
    const px = x ?? at.x;
    const pz = z ?? at.z;
    const where = whereText(ctx.world.locationName(px, pz), ctx.world.districtAt(px, pz).name);
    ctx.ui.subtitle(radioLine(event, callSign ?? this.force.nearestCallSign(), where, this.pickLine), TUNING.radioSeconds, 'Comms');
  }

  // ───────────── Reset & cleanup ─────────────

  /** Back to a clean slate with nothing of ours left in the world (respawn, load). */
  private reset() {
    this.clear();
    this.force.hardClear();
    this.busting = false;
    this.pendingKills.length = 0;
    this.anonymousKillAt = LONG_AGO;
    this.lastSeenAt = LONG_AGO;
    this.seenNearAt = LONG_AGO;
    this.wasSeen = false;
    this.seenFor = 0;
    this.unseenFor = 0;
    this.describedVehicle = -1;
    this.swapped = false;
    this.intel.seen = false;
    this.intel.lastKnown.copy(this.ctx.player.position);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.respray.dispose();
    this.force.dispose();
  }
}

export function createPolice(ctx: GameContext): PoliceApi & System {
  return new Police(ctx);
}
