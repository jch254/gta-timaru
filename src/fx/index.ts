import * as THREE from 'three';
import { damp } from '../core/math';
import { CollisionGroup, type Actor, type DamageInfo, type GameContext, type Vehicle } from '../core/types';
import { Decals } from './decals';
import { FlashLights } from './lights';
import { ParticlePool } from './particles';
import {
  burstCrush,
  burstExplosion,
  burstFlesh,
  burstGore,
  burstMuzzle,
  burstSecondary,
  burstSplash,
  burstVehicle,
  burstWorld,
  DECAL_BLOOD_CAR,
  DECAL_BLOOD_DROP,
  DECAL_BLOOD_POOL,
  DECAL_BLOOD_SMEAR,
  DECAL_BLOOD_SPATTER,
  DECAL_BLOOD_WALL,
  DECAL_CAPACITY,
  DECAL_HOLE,
  DECAL_POCK,
  DECAL_SCORCH,
  DECAL_SCUFF,
  FIRE_STREAK,
  FLAME,
  PUFF_WORLD,
  SMOKE_BLACK,
  SMOKE_COLUMN,
  SMOKE_TRAIL,
  SPARK,
  WATER_DROP,
} from './styles';
import { TracerPool } from './tracers';
import { VehicleFx } from './vehicles';

/** Particle budgets. A full pool recycles its oldest particle, so these are hard caps. */
const SMOKE_CAPACITY = 2000;
const GLOW_CAPACITY = 1000;
const TRACER_CAPACITY = 72;
/** Impacts further than this from the camera are not drawn. */
const IMPACT_RANGE = 160;
/** Fires left where something exploded: the main one under its smoke column, and spilt fuel round it. */
const FIRES = 16;
const COLUMN_SECONDS = 8;
/** Burning scraps a blast throws out, each trailing smoke as it flies (most alive at once). */
const FLYERS = 10;
/** Delayed bursts (a fuel tank going up a beat after the blast). */
const PENDING = 6;
/** Seconds between a fire's light flickers. */
const FLICKER = 0.07;
/** Seconds between blood spatters on the ground (a shotgun blast should not lay eight), and on walls. */
const SPATTER_INTERVAL = 0.07;
const WALL_INTERVAL = 0.05;
/** How far behind someone shot a wall or car can be and still catch what comes out of them (m). */
const WALL_REACH = 3;
/** Blood drawn by a hit at or above this lands on the ground; above WALL_BLOOD, on a wall behind. */
const SPATTER_BLOOD = 0.25;
const WALL_BLOOD = 0.5;
/** A hit this far above the ground on someone standing is a head shot: more of it. */
const HEAD_HEIGHT = 1.45;
const HEAD_SCALE = 1.5;
/** Blast damage below this draws no blood. */
const BLAST_BLOOD = 15;
/** Crashes slower than this (closing speed, m/s) throw no sparks; seconds between spark bursts. */
const CRASH_SPEED = 3.5;
const CRASH_INTERVAL = 0.12;
/** A body thrown faster than this (m/s) gets its pool where it comes to rest, waiting at most POOL_WAIT seconds. */
const THROWN_SPEED = 2.5;
const POOL_WAIT = 5;
/** Someone hit faster than this (m/s) leaves blood on the car, and smears the road as they slide for SLIDE_SECONDS. */
const SPLASH_SPEED = 7;
const SLIDE_SECONDS = 2.5;
/** Metres a sliding body covers between smears. */
const SMEAR_STEP = 0.5;
/** Torn apart: blast damage (at death) above this, struck faster than this (m/s), or a shot drawing this much blood. */
const GORE_BLAST = 55;
const GORE_SPEED = 13;
const GORE_SHOT = 1.8;
/** Seconds between gore bursts (wheels report a body under them every frame they touch it). */
const GORE_INTERVAL = 0.3;
/** Hurt this badly (fraction of health gone), someone bleeds as they go, for this long. */
const BLEED_HURT = 0.2;
const BLEED_SECONDS = 25;
const BLEEDERS = 10;
/** Too light a blow to open anyone up (a punch). */
const BLEED_MELEE = 20;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _g = new THREE.Vector3();
const _h = new THREE.Vector3();
const _m = new THREE.Vector3();
const rnd = () => Math.random() * 2 - 1;

/** Someone wounded, dripping as they go. */
interface Bleeder {
  actor: Actor;
  left: number;
  /** Where the last drop fell (NaN = start afresh), and how far to go, or how long to stand, before the next. */
  x: number;
  z: number;
  step: number;
  wait: number;
  /** How badly, 0..1: more drops, closer together. */
  rate: number;
}

/** A body sliding along the ground, leaving a smear. */
interface Slide {
  actor: Actor;
  left: number;
  /** Where the last smear ended (NaN = not on the ground yet). */
  x: number;
  z: number;
  /** How much blood is left to smear, 0..1.5; each smear takes some. */
  amount: number;
}

/**
 * Every transient visual in the game: tracers, muzzle flashes, impact bursts, blood, decals,
 * explosions and what vehicles throw off. Four draw calls in total (decals, smoke, glows, tracers),
 * two pooled lights, and no allocation per particle while running.
 */
export class Effects {
  /** Lit, alpha-blended particles: smoke, dust, water, blood, debris. */
  readonly smoke = new ParticlePool(SMOKE_CAPACITY, false, 0);
  /** Additive particles: flashes, sparks, flame. */
  readonly glow = new ParticlePool(GLOW_CAPACITY, true, 0);
  readonly tracers = new TracerPool(TRACER_CAPACITY);
  readonly decals = new Decals(DECAL_CAPACITY);
  readonly lights: FlashLights;
  private vehicles: VehicleFx;
  private off: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];

  // What the shot that caused the next 'impact' event looked like (set by combat around the emit).
  private hinted = false;
  private hintOrigin = new THREE.Vector3();
  private hintDirection = new THREE.Vector3();
  private hintVehicle: Vehicle | null = null;
  private hintBlood = 0;
  private hintMelee = false;

  private lastSpatter = -1;
  private lastWall = -1;
  private lastCrash = -1;
  /** Bodies still flying or skidding: their pools wait until they stop. */
  private landing: { actor: Actor; info: DamageInfo; wait: number }[] = [];
  private slides: Slide[] = [];
  private bleeders: Bleeder[] = [];
  private lastGore = -1;
  // Fires: x, y, z, seconds left, seconds in all, scale, emission accumulator, 1 = the main fire under a column.
  private fires = new Float32Array(FIRES * 8);
  private fireCursor = 0;
  private flicker = 0;
  // Flying scraps: x, y, z, vx, vy, vz, seconds left, seconds in all, trail accumulator, floor.
  private flyers = new Float32Array(FLYERS * 10);
  private flyerCursor = 0;
  // Delayed bursts: x, y, z, seconds to wait, scale (0 = free).
  private pending = new Float32Array(PENDING * 5);
  private pendingCursor = 0;
  // Player wading state.
  private playerWet: boolean | null = null;
  private playerSample = 0;
  private wade = 0;
  private dull = 1;

  constructor(private ctx: GameContext) {
    this.lights = new FlashLights(ctx.scene, 2);
    ctx.scene.add(this.decals.mesh, this.smoke.mesh, this.glow.mesh, this.tracers.mesh);
    this.vehicles = new VehicleFx(ctx, this.smoke, this.glow, this.decals, (p, size) => this.splash(p, size));
    this.off.push(
      ctx.events.on('impact', ({ position, normal, surface }) => this.impact(position, normal, surface)),
      ctx.events.on('actorDamaged', ({ actor, info }) => this.damaged(actor, info)),
      ctx.events.on('actorDied', ({ actor, info }) => this.died(actor, info)),
      ctx.events.on('vehicleHitActor', ({ actor, vehicle, speed, under }) => (under ? this.runOver(actor, vehicle, speed) : this.struck(actor, vehicle, speed))),
      ctx.events.on('vehicleCrash', ({ vehicle, speed }) => this.crash(vehicle, speed)),
    );
  }

  /** Burst sizes: thinned at Low quality. */
  private get detail(): number {
    return this.ctx.gfx.quality === 'low' ? 0.5 : 1;
  }

  // ───────────── Called by combat ─────────────

  /**
   * Describe the shot behind the 'impact' event about to be emitted, so the burst can be aimed:
   * where it came from, which way it was going, the vehicle it hit (if any), how much blood a hit on
   * a person should draw (0 = none) and whether it was a melee swing. Call `clearHint()` after the emit.
   */
  hint(origin: THREE.Vector3, direction: THREE.Vector3, vehicle: Vehicle | null, blood: number, melee: boolean) {
    this.hinted = true;
    this.hintOrigin.copy(origin);
    this.hintDirection.copy(direction);
    this.hintVehicle = vehicle;
    this.hintBlood = blood;
    this.hintMelee = melee;
  }

  clearHint() {
    this.hinted = false;
    this.hintVehicle = null;
  }

  /** A bullet's streak from muzzle to where it stopped. `heavy` = rifle round: longer, brighter. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, heavy = false) {
    if (heavy) this.tracers.spawn(from, to, 9, 7.2, 3.6, 0.045, 14);
    else this.tracers.spawn(from, to, 7, 5.2, 2.4, 0.032, 9);
  }

  /** Flash, light and smoke at a muzzle. `velocity` is the shooter's, so the flash keeps up with a car. */
  muzzleFlash(position: THREE.Vector3, direction: THREE.Vector3, size: number, velocity?: THREE.Vector3) {
    if (size <= 0) return;
    burstMuzzle(this.smoke, this.glow, position, direction, size, velocity ? velocity.x : 0, velocity ? velocity.y : 0, velocity ? velocity.z : 0);
    // Dimmer after dark, when a little light goes a long way.
    const level = 1 - 0.6 * this.ctx.env.night;
    this.lights.flash(position.x + direction.x * 0.3, position.y + direction.y * 0.3 + 0.1, position.z + direction.z * 0.3, 0xffc27a, 55 * size * level, 14, 0.075);
  }

  /**
   * An explosion of `radius` metres: flash and fireball, smoke boiling up, sparks, scraps and glass,
   * burning pieces thrown out trailing smoke, a second burst a beat later, a scorch on the ground,
   * spilt fuel burning round it and the main fire left going under a column of smoke, its light
   * flickering on everything near.
   */
  explosion(position: THREE.Vector3, radius: number) {
    const { ctx } = this;
    const detail = this.detail;
    const k = radius / 9;
    const ground = ctx.world.groundAt(position.x, position.z);
    const depth = ctx.world.waterDepthAt(position.x, position.z);
    const wet = depth >= 0.1;
    const floor = wet ? Math.max(ground, ctx.world.heightAt(position.x, position.z) + depth) : ground;
    burstExplosion(this.smoke, this.glow, position, radius, floor, detail);
    const level = 1 - 0.55 * ctx.env.night;
    this.lights.flash(position.x, position.y + 1.2, position.z, 0xffb060, 1300 * k * level, radius * 6, 0.6);
    const low = position.y - floor < 3.5;
    if (low && !wet) {
      _a.set(position.x, ground, position.z);
      this.decals.add(DECAL_SCORCH, ctx.clock.elapsed, _a, this.groundNormal(_a.x, _a.z, ground, _n), null, radius * 0.5, radius * 0.5);
    }
    // Left burning, with spilt fuel alight round it.
    this.addFire(position.x, low ? floor : position.y, position.z, COLUMN_SECONDS, k, true);
    if (low && !wet) {
      const puddles = Math.round(4 * detail);
      for (let i = 0; i < puddles; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = (1.2 + Math.random() * 2.6) * k;
        const x = position.x + Math.cos(a) * r;
        const z = position.z + Math.sin(a) * r;
        this.addFire(x, ctx.world.groundAt(x, z), z, 2.5 + Math.random() * 3.5, (0.55 + Math.random() * 0.45) * k, false);
      }
    }
    const flyers = Math.round(8 * detail);
    for (let i = 0; i < flyers; i++) this.launch(position, floor, k);
    // The tank, a beat later.
    for (let i = 0; i < 2; i++) this.later(position.x + rnd() * 1.4 * k, position.y + 0.4 + Math.random() * 0.8, position.z + rnd() * 1.4 * k, 0.12 + Math.random() * 0.3, k);
  }

  /** Something hitting water at `position` (on the surface). */
  splash(position: THREE.Vector3, size: number) {
    burstSplash(this.smoke, position, size);
  }

  // ───────────── Events ─────────────

  private impact(position: THREE.Vector3, normal: THREE.Vector3, surface: 'world' | 'vehicle' | 'flesh') {
    const { ctx } = this;
    if (position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    const hinted = this.hinted;
    const melee = hinted && this.hintMelee;
    // Without a hint, assume the shot came straight in against the surface.
    const direction = hinted ? this.hintDirection : _d.copy(normal).negate();
    const ground = ctx.world.groundAt(position.x, position.z);
    if (surface === 'world') {
      burstWorld(this.smoke, this.glow, position, normal, melee, ground);
      if (!melee) {
        const flat = normal.y > 0.7;
        const size = flat ? 0.07 + Math.random() * 0.04 : 0.035 + Math.random() * 0.02;
        this.decals.add(flat ? DECAL_SCUFF : DECAL_HOLE, ctx.clock.elapsed, position, normal, null, size, size);
      }
    } else if (surface === 'vehicle') {
      let p = position;
      let n = normal;
      const vehicle = hinted ? this.hintVehicle : null;
      // Physics hits a box; find the bodywork itself so sparks and the pock sit on the panel.
      if (vehicle && !melee && this.bodywork(vehicle, this.hintOrigin, direction, position)) {
        p = _a;
        n = _b;
        const size = 0.028 + Math.random() * 0.02;
        this.decals.attach(this.decals.add(DECAL_POCK, ctx.clock.elapsed, p, n, null, size, size), vehicle);
      }
      burstVehicle(this.smoke, this.glow, p, n, melee, ground);
    } else {
      let blood = hinted ? this.hintBlood : 0.6;
      if (!melee && position.y - ground > HEAD_HEIGHT) blood *= HEAD_SCALE;
      burstFlesh(this.smoke, position, normal, direction, blood, ground);
      if (blood >= SPATTER_BLOOD) this.spatter(position, direction, blood);
      if (blood >= WALL_BLOOD && !melee) this.wall(position, direction, blood);
      if (blood >= GORE_SHOT && !melee) this.gore(position, direction, 0.45);
    }
  }

  /** Blood landing on the ground beyond someone who was hit: a splash and droplets thrown on along the blow. */
  private spatter(position: THREE.Vector3, direction: THREE.Vector3, amount: number) {
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (now - this.lastSpatter < SPATTER_INTERVAL) return;
    // Thrown on past the victim, along the shot.
    const flat = Math.hypot(direction.x, direction.z);
    const reach = 0.5 + Math.random() * 1.3;
    const x = position.x + (flat > 0.05 ? (direction.x / flat) * reach : rnd() * 0.5);
    const z = position.z + (flat > 0.05 ? (direction.z / flat) * reach : rnd() * 0.5);
    const ground = ctx.world.groundAt(x, z);
    if (position.y - ground > 2.4 || position.y - ground < -0.5) return;
    if (ctx.world.waterDepthAt(x, z) > 0.1) return;
    this.lastSpatter = now;
    _a.set(x, ground, z);
    const length = (0.45 + Math.random() * 0.35) * (0.55 + 0.45 * Math.min(1.6, amount));
    this.decals.add(DECAL_BLOOD_SPATTER, now, _a, this.groundNormal(x, z, ground, _n), flat > 0.05 ? direction : null, length, length * (0.5 + Math.random() * 0.2));
  }

  /** What comes out of the far side of someone shot, on the wall or car behind them: a splash that runs. */
  private wall(position: THREE.Vector3, direction: THREE.Vector3, amount: number) {
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (now - this.lastWall < WALL_INTERVAL) return;
    // From just beyond the body, through anything that is not a person.
    _f.copy(position).addScaledVector(direction, 0.35);
    const hit = ctx.physics.raycast(_f, direction, WALL_REACH, { mask: CollisionGroup.World | CollisionGroup.Vehicle });
    if (!hit) return;
    const owner = hit.owner;
    const vehicle = owner && 'spec' in owner ? owner : null;
    if (owner && !vehicle) return;
    // The ground already has the spatter.
    if (!vehicle && Math.abs(hit.normal.y) > 0.55) return;
    this.lastWall = now;
    const near = 1 - hit.distance / (WALL_REACH + 0.6);
    const size = (0.24 + 0.18 * Math.min(1.8, amount)) * (0.6 + 0.4 * near) * (0.85 + Math.random() * 0.3);
    const slot = this.decals.add(DECAL_BLOOD_WALL, now, hit.point, hit.normal, DOWN, size, size, DECAL_BLOOD_WALL.alpha * (0.55 + 0.45 * near));
    if (vehicle) this.decals.attach(slot, vehicle);
  }

  /** Blown about by a blast: blood out of them, the way the blast threw them. */
  private damaged(actor: Actor, info: DamageInfo) {
    const { ctx } = this;
    this.wound(actor, info);
    if (info.kind !== 'explosion' || info.amount < BLAST_BLOOD || actor.vehicle || actor.invulnerable) return;
    if (actor.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    const amount = Math.min(1.8, info.amount / 45);
    _e.copy(info.direction ?? UP);
    _e.y = Math.max(_e.y, 0.25);
    _e.normalize();
    _n.copy(_e).negate();
    _c.set(actor.position.x, actor.position.y + 1.1, actor.position.z);
    const ground = ctx.world.groundAt(_c.x, _c.z);
    burstFlesh(this.smoke, _c, _n, _e, amount, ground);
    this.spatter(_c, _e, amount);
  }

  /** A body down: pooled at once, or once it lands if something threw it (smearing the road as it slides). */
  private died(actor: Actor, info: DamageInfo) {
    const v = actor.velocity;
    // Caught close by a blast: in pieces.
    if (info.kind === 'explosion' && info.amount >= GORE_BLAST && !actor.vehicle && !actor.invulnerable) {
      _g.set(actor.position.x, actor.position.y + 0.9, actor.position.z);
      this.gore(_g, info.direction ?? UP, Math.min(2, info.amount / 60));
    }
    if (!actor.vehicle && v.x * v.x + v.z * v.z > THROWN_SPEED * THROWN_SPEED) {
      this.landing.push({ actor, info, wait: POOL_WAIT });
      if (info.kind !== 'drown' && info.kind !== 'fire') this.slide(actor, POOL_WAIT, 1.2);
    } else this.bloodPool(actor, info);
  }

  /** Someone hit by a vehicle: blood thrown on ahead of it, onto the road, and across the panel that hit them. */
  private struck(actor: Actor, vehicle: Vehicle, speed: number) {
    const { ctx } = this;
    if (actor.invulnerable || actor.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    const amount = Math.min(1.6, Math.max(0.45, (speed - 3) / 8));
    // Thrown on along the car's travel, a little upward.
    this.travel(vehicle, _e);
    _e.y = 0.35;
    _e.normalize();
    _c.set(actor.position.x, actor.position.y + 1, actor.position.z);
    _n.copy(_e).negate();
    burstFlesh(this.smoke, _c, _n, _e, amount, ctx.world.groundAt(_c.x, _c.z));
    this.spatter(_c, _e, amount);
    // Hit fast enough to tear them open.
    if (speed >= GORE_SPEED) this.gore(_g.copy(_c), _h.copy(_e), Math.min(1.6, 0.5 + (speed - GORE_SPEED) / 10));
    if (speed < SPLASH_SPEED) return;
    this.slide(actor, SLIDE_SECONDS, amount);
    // Find the bonnet or bumper: look back at the car from just in front of them, a little downward.
    _c.addScaledVector(_e, 0.6);
    _d.set(-_e.x, -0.45, -_e.z).normalize();
    if (!this.bodywork(vehicle, _c, _d, _c)) return;
    const size = (0.18 + Math.random() * 0.12) * (0.7 + 0.3 * amount);
    this.decals.attach(this.decals.add(DECAL_BLOOD_CAR, ctx.clock.elapsed, _a, _b, DOWN, size, size * (0.75 + Math.random() * 0.25)), vehicle);
  }

  /**
   * Rolled over where they lay: blood squeezed out either side of the tyre, a smear along the road,
   * a splash thrown off to the side, and the tyres printing it on down the road.
   */
  private runOver(actor: Actor, vehicle: Vehicle, speed: number) {
    const { ctx } = this;
    if (actor.invulnerable || actor.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    this.travel(vehicle, _d);
    // The body lies back from where the feet are.
    const x = actor.position.x - Math.sin(actor.heading) * 0.6;
    const z = actor.position.z - Math.cos(actor.heading) * 0.6;
    const ground = ctx.world.groundAt(x, z);
    if (Math.abs(actor.position.y - ground) > 1.5) return;
    const amount = Math.min(1.5, 0.6 + speed / 12);
    _c.set(x, ground + 0.12, z);
    burstCrush(this.smoke, _c, _d, amount, ground);
    this.gore(_g.copy(_c), _h.copy(_d), Math.min(1, 0.3 + speed / 15));
    if (ctx.world.waterDepthAt(x, z) > 0.1) return;
    this.vehicles.bloody(vehicle);
    _a.set(x, ground, z);
    const length = 0.5 + Math.min(0.8, speed * 0.06);
    this.decals.add(DECAL_BLOOD_SMEAR, ctx.clock.elapsed, _a, this.groundNormal(x, z, ground, _n), _d, length, 0.2 + Math.random() * 0.12);
    const side = Math.random() < 0.5 ? -1 : 1;
    _e.set(_d.z * side, 0, -_d.x * side);
    this.spatter(_c, _e, amount);
  }

  /** Unit direction a vehicle is travelling along the ground (its heading when it is barely moving). */
  private travel(vehicle: Vehicle, out: THREE.Vector3): THREE.Vector3 {
    out.set(vehicle.velocity.x, 0, vehicle.velocity.z);
    if (out.lengthSq() < 0.01) out.set(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
    return out.normalize();
  }

  /** A pool spreading slowly under a body. */
  private bloodPool(actor: Actor, info: DamageInfo) {
    const { ctx } = this;
    if (actor.vehicle || info.kind === 'drown' || info.kind === 'fire') return;
    if (actor.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    // The body falls back from where it stood.
    const x = actor.position.x - Math.sin(actor.heading) * 0.4;
    const z = actor.position.z - Math.cos(actor.heading) * 0.4;
    if (ctx.world.waterDepthAt(x, z) > 0.1) return;
    const ground = ctx.world.groundAt(x, z);
    if (Math.abs(actor.position.y - ground) > 1.5) return; // died on a roof or mid-air
    _a.set(x, ground, z);
    // Hit by a car or a blast: more of it.
    const heavy = info.kind === 'vehicle' || info.kind === 'explosion' ? 1.3 : 1;
    const size = (0.6 + Math.random() * 0.3) * heavy;
    this.decals.add(DECAL_BLOOD_POOL, ctx.clock.elapsed, _a, this.groundNormal(x, z, ground, _n), null, size, size * (0.75 + Math.random() * 0.25));
  }

  /** Smear the road under `actor` while they slide, for `seconds`. */
  private slide(actor: Actor, seconds: number, amount: number) {
    for (const s of this.slides) {
      if (s.actor !== actor) continue;
      s.left = Math.max(s.left, seconds);
      s.amount = Math.max(s.amount, amount);
      return;
    }
    this.slides.push({ actor, left: seconds, x: NaN, z: NaN, amount });
  }

  /**
   * Someone torn open at `p`: pieces and thick blood thrown out, mostly along `d`, and splats on the ground round
   * them where it lands. `amount` 0..2.
   */
  private gore(p: THREE.Vector3, d: THREE.Vector3, amount: number) {
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (now - this.lastGore < GORE_INTERVAL) return;
    if (p.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    this.lastGore = now;
    const ground = ctx.world.groundAt(p.x, p.z);
    burstGore(this.smoke, p, d, amount, ground, this.detail);
    if (p.y - ground > 2.6 || p.y - ground < -0.5 || ctx.world.waterDepthAt(p.x, p.z) > 0.1) return;
    const flat = Math.hypot(d.x, d.z);
    const fx = flat > 0.05 ? d.x / flat : 0;
    const fz = flat > 0.05 ? d.z / flat : 0;
    const splats = Math.max(2, Math.round((3 + 5 * amount) * this.detail));
    for (let i = 0; i < splats; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * (0.9 + 1.4 * amount);
      // Every other one carried on along the blow.
      const on = i % 2 ? r * 0.8 : 0;
      const x = p.x + Math.cos(a) * r * 0.6 + fx * on;
      const z = p.z + Math.sin(a) * r * 0.6 + fz * on;
      const g = ctx.world.groundAt(x, z);
      if (Math.abs(g - ground) > 0.6 || ctx.world.waterDepthAt(x, z) > 0.1) continue;
      const size = (0.07 + Math.random() * 0.13) * (0.75 + 0.25 * amount);
      _f.set(x, g, z);
      this.decals.add(DECAL_BLOOD_DROP, now, _f, this.groundNormal(x, z, g, _m), null, size, size * (0.65 + Math.random() * 0.35));
    }
  }

  /** Hurt badly enough by something that cuts or tears: they bleed for a while, wherever they go. */
  private wound(actor: Actor, info: DamageInfo) {
    if (!actor.alive || actor.invulnerable || actor.maxHealth <= 0) return;
    if (info.kind === 'fall' || info.kind === 'fire' || info.kind === 'drown') return;
    if (info.kind === 'melee' && info.amount < BLEED_MELEE) return;
    const hurt = 1 - actor.health / actor.maxHealth;
    if (hurt < BLEED_HURT) return;
    const rate = Math.min(1, hurt);
    for (const b of this.bleeders) {
      if (b.actor !== actor) continue;
      b.left = BLEED_SECONDS;
      b.rate = Math.max(b.rate, rate);
      return;
    }
    if (this.bleeders.length >= BLEEDERS) return;
    this.bleeders.push({ actor, left: BLEED_SECONDS, x: NaN, z: NaN, step: 0, wait: 0, rate });
  }

  /** Drops off the wounded: every metre or so as they go, now and then where they stand. */
  private bleed(dt: number) {
    const { ctx } = this;
    const bleeders = this.bleeders;
    for (let i = bleeders.length - 1; i >= 0; i--) {
      const b = bleeders[i];
      const actor = b.actor;
      b.left -= dt;
      // The dead have their pool; the healed have stopped.
      if (b.left <= 0 || !actor.alive || actor.health >= actor.maxHealth * (1 - BLEED_HURT)) {
        bleeders[i] = bleeders[bleeders.length - 1];
        bleeders.pop();
        continue;
      }
      const x = actor.position.x;
      const z = actor.position.z;
      if (actor.vehicle || Number.isNaN(b.x)) {
        b.x = actor.vehicle ? NaN : x;
        b.z = z;
        b.step = 0.4 + Math.random() * 0.6;
        b.wait = 0.3 + Math.random();
        continue;
      }
      b.wait -= dt;
      const dx = x - b.x;
      const dz = z - b.z;
      const moved = dx * dx + dz * dz;
      // Fades as it goes on: the heaviest bleeding is just after the wound.
      const flow = b.rate * (0.35 + 0.65 * (b.left / BLEED_SECONDS));
      if (moved < b.step * b.step && b.wait > 0) continue;
      b.x = x;
      b.z = z;
      b.step = (0.6 + Math.random() * 1.4) / (0.4 + flow);
      b.wait = (1.2 + Math.random() * 1.8) / (0.4 + flow);
      if (moved > 36) continue; // teleported
      if (actor.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) continue;
      // Off the hand or the hem: beside them a little, never quite under the feet.
      const px = x + rnd() * 0.3;
      const pz = z + rnd() * 0.3;
      const ground = ctx.world.groundAt(px, pz);
      if (Math.abs(actor.position.y - ground) > 0.6 || ctx.world.waterDepthAt(px, pz) > 0.1) continue;
      const size = (0.035 + Math.random() * 0.05) * (0.7 + 0.6 * flow);
      _f.set(px, ground, pz);
      const along = moved > 0.01 ? _h.set(dx, 0, dz) : null;
      this.decals.add(DECAL_BLOOD_DROP, ctx.clock.elapsed, _f, this.groundNormal(px, pz, ground, _m), along, along ? size * 1.4 : size, size, DECAL_BLOOD_DROP.alpha * (0.6 + 0.4 * flow));
    }
  }

  /** Metal on something solid: sparks and grit off the end of the vehicle that hit. */
  private crash(vehicle: Vehicle, speed: number) {
    const { ctx } = this;
    const now = ctx.clock.elapsed;
    if (speed < CRASH_SPEED || now - this.lastCrash < CRASH_INTERVAL) return;
    if (vehicle.position.distanceToSquared(ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) return;
    this.lastCrash = now;
    _b.set(0, 0, 1).applyQuaternion(vehicle.group.quaternion);
    const end = vehicle.speed < -0.5 ? -1 : 1;
    _a.copy(vehicle.position).addScaledVector(_b, end * vehicle.spec.length * 0.48);
    const half = vehicle.spec.width * 0.5;
    const floor = ctx.world.groundAt(_a.x, _a.z);
    // Left of the vehicle, for spreading the burst across the bumper.
    _n.set(1, 0, 0).applyQuaternion(vehicle.group.quaternion);
    const sparks = Math.min(18, Math.round(4 + speed * 1.1));
    for (let i = 0; i < sparks; i++) {
      const across = rnd() * half;
      const s = 1.5 + Math.random() * 3.5;
      this.glow.emit(SPARK, _a.x + _n.x * across, _a.y - 0.15 + rnd() * 0.25, _a.z + _n.z * across, -_b.x * end * s + rnd() * 3, 1 + Math.random() * 3, -_b.z * end * s + rnd() * 3, 1, floor);
    }
    for (let i = 0; i < 3; i++) this.smoke.emit(PUFF_WORLD, _a.x + rnd() * half, _a.y - 0.2, _a.z + rnd() * half, rnd() * 1.2, 0.6 + Math.random(), rnd() * 1.2, 1.6);
  }

  /** Terrain normal, or straight up on a bridge deck (where the terrain below is not the surface). */
  private groundNormal(x: number, z: number, ground: number, out: THREE.Vector3): THREE.Vector3 {
    if (Math.abs(ground - this.ctx.world.heightAt(x, z)) > 0.25) return out.copy(UP);
    return this.ctx.world.normalAt(x, z, out);
  }

  /**
   * Ray-cast a vehicle's visible meshes for the true surface point near a physics hit. Writes the
   * point to _a and the outward normal to _b; false if the bodywork was missed.
   */
  private bodywork(vehicle: Vehicle, origin: THREE.Vector3, direction: THREE.Vector3, near: THREE.Vector3): boolean {
    const ray = this.raycaster;
    ray.set(origin, direction);
    ray.near = Math.max(0, origin.distanceTo(near) - 1.2);
    ray.far = ray.near + 3;
    this.hits.length = 0;
    this.castInto(vehicle.group);
    let best: THREE.Intersection | null = null;
    for (const hit of this.hits) if (hit.face && (!best || hit.distance < best.distance)) best = hit;
    this.hits.length = 0;
    if (!best || !best.face) return false;
    _a.copy(best.point);
    _b.copy(best.face.normal).transformDirection(best.object.matrixWorld);
    if (_b.dot(direction) > 0) _b.negate();
    return true;
  }

  /** Intersect plain, visible meshes under `object` (skinned occupants and hidden groups are skipped). */
  private castInto(object: THREE.Object3D) {
    if (!object.visible) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) return;
      this.raycaster.intersectObject(object, false, this.hits);
    }
    const children = object.children;
    for (let i = 0; i < children.length; i++) this.castInto(children[i]);
  }

  // ───────────── Explosion pieces ─────────────

  private addFire(x: number, y: number, z: number, seconds: number, scale: number, main: boolean) {
    const o = this.fireCursor * 8;
    this.fireCursor = (this.fireCursor + 1) % FIRES;
    const f = this.fires;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = z;
    f[o + 3] = seconds;
    f[o + 4] = seconds;
    f[o + 5] = scale;
    f[o + 6] = 0;
    f[o + 7] = main ? 1 : 0;
  }

  /** Throw a burning scrap out of a blast. */
  private launch(p: THREE.Vector3, floor: number, k: number) {
    const o = this.flyerCursor * 10;
    this.flyerCursor = (this.flyerCursor + 1) % FLYERS;
    const a = Math.random() * Math.PI * 2;
    const up = 0.35 + Math.random() * 0.6;
    const flat = Math.sqrt(1 - up * up);
    const s = (6 + Math.random() * 8) * Math.sqrt(k);
    const seconds = 2.2 + Math.random() * 2;
    const f = this.flyers;
    f[o] = p.x;
    f[o + 1] = Math.max(p.y, floor) + 0.5;
    f[o + 2] = p.z;
    f[o + 3] = Math.cos(a) * flat * s;
    f[o + 4] = up * s;
    f[o + 5] = Math.sin(a) * flat * s;
    f[o + 6] = seconds;
    f[o + 7] = seconds;
    f[o + 8] = 0;
    f[o + 9] = floor;
  }

  private later(x: number, y: number, z: number, seconds: number, k: number) {
    const o = this.pendingCursor * 5;
    this.pendingCursor = (this.pendingCursor + 1) % PENDING;
    const q = this.pending;
    q[o] = x;
    q[o + 1] = y;
    q[o + 2] = z;
    q[o + 3] = seconds;
    q[o + 4] = k;
  }

  // ───────────── Frame ─────────────

  /** Pool the thrown bodies that have come to rest. */
  private land(dt: number) {
    const landing = this.landing;
    for (let i = landing.length - 1; i >= 0; i--) {
      const body = landing[i];
      const v = body.actor.velocity;
      body.wait -= dt;
      if (v.x * v.x + v.z * v.z > 0.25 && body.wait > 0) continue;
      landing[i] = landing[landing.length - 1];
      landing.pop();
      this.bloodPool(body.actor, body.info);
    }
  }

  /** Smears under bodies sliding along the road. */
  private smear(dt: number) {
    const { ctx } = this;
    const slides = this.slides;
    for (let i = slides.length - 1; i >= 0; i--) {
      const s = slides[i];
      s.left -= dt;
      if (s.left <= 0 || s.amount < 0.12) {
        slides[i] = slides[slides.length - 1];
        slides.pop();
        continue;
      }
      const actor = s.actor;
      // Still in the air (the figure is drawn above where the body is): nothing touches the road yet.
      if (actor.group.position.y - actor.position.y > 0.3) {
        s.x = NaN;
        continue;
      }
      const x = actor.position.x;
      const z = actor.position.z;
      if (Number.isNaN(s.x)) {
        s.x = x;
        s.z = z;
        continue;
      }
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < SMEAR_STEP * SMEAR_STEP) continue;
      const from = s.x;
      const fromZ = s.z;
      s.x = x;
      s.z = z;
      if (d2 > 16) continue; // moved by something other than sliding
      const mx = from + dx * 0.5;
      const mz = fromZ + dz * 0.5;
      const ground = ctx.world.groundAt(mx, mz);
      if (Math.abs(actor.position.y - ground) > 1 || ctx.world.waterDepthAt(mx, mz) > 0.1) continue;
      const length = Math.sqrt(d2);
      _a.set(mx, ground, mz);
      _d.set(dx, 0, dz);
      const strength = DECAL_BLOOD_SMEAR.alpha * Math.min(1, 0.4 + 0.5 * s.amount);
      this.decals.add(DECAL_BLOOD_SMEAR, ctx.clock.elapsed, _a, this.groundNormal(mx, mz, ground, _n), _d, length / 2 + 0.12, 0.15 + 0.08 * Math.min(1, s.amount), strength);
      s.amount *= 0.84;
    }
  }

  update(dt: number) {
    const { ctx } = this;
    const env = ctx.env;

    // Smoke and dust are unlit sprites: follow the daylight by hand.
    const overcast = env.weather === 'southerly' || env.weather === 'fog' || env.weather === 'overcast';
    this.dull = damp(this.dull, overcast ? 0.72 : 1, 0.5, dt);
    const day = 1.1 * this.dull;
    const n = env.night;
    this.smoke.light.setRGB(day + (0.24 - day) * n, day + (0.28 - day) * n, day + (0.38 - day) * n);

    this.vehicles.update(dt);
    this.wading(dt);
    this.secondaries(dt);
    this.fly(dt);
    this.burn(dt);
    this.land(dt);
    this.smear(dt);
    this.bleed(dt);

    // Wind in m/s; smoke leans with it.
    const wx = env.wind.x * 0.6;
    const wz = env.wind.z * 0.6;
    this.smoke.update(dt, wx, wz);
    this.glow.update(dt, wx, wz);
    this.tracers.setViewport(ctx.camera.fov, ctx.gfx.renderer.domElement.height);
    this.tracers.update(dt);
    this.lights.update(dt);
    this.decals.update(ctx.clock.elapsed);
  }

  /** Delayed bursts whose moment has come. */
  private secondaries(dt: number) {
    const q = this.pending;
    for (let i = 0; i < PENDING; i++) {
      const o = i * 5;
      if (q[o + 4] <= 0) continue;
      q[o + 3] -= dt;
      if (q[o + 3] > 0) continue;
      const k = q[o + 4];
      q[o + 4] = 0;
      _c.set(q[o], q[o + 1], q[o + 2]);
      if (_c.distanceToSquared(this.ctx.camera.position) > IMPACT_RANGE * IMPACT_RANGE) continue;
      burstSecondary(this.smoke, this.glow, _c, k, this.ctx.world.groundAt(_c.x, _c.z), this.detail);
      const level = 1 - 0.55 * this.ctx.env.night;
      this.lights.flash(_c.x, _c.y + 0.8, _c.z, 0xffa040, 500 * k * level, 30 * k, 0.3);
    }
  }

  /** Burning scraps in flight: they arc, bounce and lie smouldering, trailing smoke. */
  private fly(dt: number) {
    const f = this.flyers;
    for (let i = 0; i < FLYERS; i++) {
      const o = i * 10;
      if (f[o + 6] <= 0) continue;
      f[o + 6] -= dt;
      const drag = 1 / (1 + 0.15 * dt);
      let vx = f[o + 3] * drag;
      let vy = (f[o + 4] - 9.8 * dt) * drag;
      let vz = f[o + 5] * drag;
      const x = f[o] + vx * dt;
      let y = f[o + 1] + vy * dt;
      const z = f[o + 2] + vz * dt;
      const floor = f[o + 9];
      if (y < floor) {
        y = floor;
        vy = vy < -2 ? -vy * 0.3 : 0;
        vx *= 0.45;
        vz *= 0.45;
      }
      const moved = Math.hypot(x - f[o], y - f[o + 1], z - f[o + 2]);
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = z;
      f[o + 3] = vx;
      f[o + 4] = vy;
      f[o + 5] = vz;
      // A puff every 20 cm in flight, a few a second once it has stopped.
      f[o + 8] += moved / 0.2 + 5 * dt;
      const burning = f[o + 6] > f[o + 7] * 0.35;
      for (let n = 0; f[o + 8] >= 1 && n < 8; n++) {
        f[o + 8] -= 1;
        // Spread the puffs back along the path travelled this frame.
        const back = Math.random();
        const px = x - vx * dt * back;
        const py = y - vy * dt * back;
        const pz = z - vz * dt * back;
        this.smoke.emit(SMOKE_TRAIL, px + rnd() * 0.08, py + 0.1, pz + rnd() * 0.08, vx * 0.08 + rnd() * 0.3, 0.4 + Math.random() * 0.5, vz * 0.08 + rnd() * 0.3, burning ? 1 : 0.75);
      }
      if (f[o + 8] > 8) f[o + 8] = 8;
      // The burning scrap itself: a streak of flame along its flight, a guttering flame once it lies still.
      if (burning) {
        if (moved > 0.02) this.glow.emit(FIRE_STREAK, x, y, z, vx, vy, vz, 1);
        else if (Math.random() < 12 * dt) this.glow.emit(FLAME, x, y + 0.05, z, rnd() * 0.2, 0.8, rnd() * 0.2, 0.45);
      }
    }
  }

  /** Fires where explosions happened: the main one under its smoke column, spilt fuel round it; the light flickers. */
  private burn(dt: number) {
    const { ctx } = this;
    const f = this.fires;
    const cam = ctx.camera.position;
    let lit = -1;
    let litLevel = 0;
    for (let i = 0; i < FIRES; i++) {
      const o = i * 8;
      if (f[o + 3] <= 0) continue;
      f[o + 3] -= dt;
      const k = Math.max(0, f[o + 3] / f[o + 4]);
      const scale = f[o + 5];
      const main = f[o + 7] > 0;
      f[o + 6] += (main ? 4 + 14 * k : 8 + 10 * k) * dt;
      while (f[o + 6] >= 1) {
        f[o + 6] -= 1;
        if (main) {
          const x = f[o] + rnd() * 1.2 * scale;
          const z = f[o + 2] + rnd() * 1.2 * scale;
          this.smoke.emit(SMOKE_COLUMN, x, f[o + 1] + 0.5 + Math.random() * 0.8, z, rnd() * 0.5, 2 + Math.random() * 1.5, rnd() * 0.5, scale * (0.8 + 0.4 * k));
          if (k > 0.35) this.glow.emit(FLAME, x, f[o + 1] + 0.3, z, rnd() * 0.6, 1.5 + Math.random(), rnd() * 0.6, 1.5 * scale);
        } else {
          const x = f[o] + rnd() * 0.45 * scale;
          const z = f[o + 2] + rnd() * 0.45 * scale;
          this.glow.emit(FLAME, x, f[o + 1] + 0.1, z, rnd() * 0.3, 0.8 + Math.random(), rnd() * 0.3, scale * (0.6 + 0.6 * k));
          if (Math.random() < 0.3) this.smoke.emit(SMOKE_BLACK, x, f[o + 1] + 0.7, z, rnd() * 0.3, 1.2 + Math.random(), rnd() * 0.3, 0.4 * scale);
        }
      }
      if (main && k > 0.2) {
        const dx = f[o] - cam.x;
        const dz = f[o + 2] - cam.z;
        const level = (k * scale) / (1 + (dx * dx + dz * dz) / 900);
        if (level > litLevel) {
          litLevel = level;
          lit = o;
        }
      }
    }
    // Firelight: the nearest big fire flickers on its surroundings (on whichever light is free).
    this.flicker -= dt;
    if (lit >= 0 && this.flicker <= 0) {
      this.flicker = FLICKER;
      const k = Math.max(0, f[lit + 3] / f[lit + 4]);
      const scale = f[lit + 5];
      const level = 1 - 0.4 * ctx.env.night;
      this.lights.flash(f[lit] + rnd() * 0.3, f[lit + 1] + 1.4, f[lit + 2] + rnd() * 0.3, 0xff8a3c, (40 + 45 * Math.random()) * scale * Math.min(1, k * 1.6) * level, 22 * scale, FLICKER * 1.7);
    }
  }

  /** The player on foot: a splash going into water, drops kicked up while wading. */
  private wading(dt: number) {
    const { ctx } = this;
    const player = ctx.player;
    if (player.vehicle || !player.alive) {
      this.playerWet = null;
      return;
    }
    this.playerSample -= dt;
    if (this.playerSample > 0) return;
    const step = 0.1;
    this.playerSample = step;
    const p = player.position;
    const depth = ctx.world.waterDepthAt(p.x, p.z);
    const surface = depth > 0 ? ctx.world.heightAt(p.x, p.z) + depth : -1e9;
    const wet = depth > 0.25 && p.y < surface - 0.1;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (wet && this.playerWet === false) {
      _a.set(p.x, surface, p.z);
      this.splash(_a, 0.55);
      ctx.audio.play('splash', { at: _a });
    } else if (wet && speed > 1) {
      this.wade += speed * 1.6 * step;
      while (this.wade >= 1) {
        this.wade -= 1;
        this.smoke.emit(WATER_DROP, p.x + rnd() * 0.3, surface + 0.05, p.z + rnd() * 0.3, player.velocity.x * 0.4 + rnd() * 0.8, 1.4 + Math.random() * 1.2, player.velocity.z * 0.4 + rnd() * 0.8);
      }
    }
    this.playerWet = wet;
  }

  dispose() {
    for (const off of this.off) off();
    this.landing.length = 0;
    this.slides.length = 0;
    this.bleeders.length = 0;
    this.smoke.dispose();
    this.glow.dispose();
    this.tracers.dispose();
    this.decals.dispose();
    this.lights.dispose();
  }
}

export function createEffects(ctx: GameContext): Effects {
  return new Effects(ctx);
}
