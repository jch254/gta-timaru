import * as THREE from 'three';
import { damp } from '../core/math';
import type { Actor, DamageInfo, GameContext, Vehicle } from '../core/types';
import { Decals } from './decals';
import { FlashLights } from './lights';
import { ParticlePool } from './particles';
import {
  burstExplosion,
  burstFlesh,
  burstMuzzle,
  burstSplash,
  burstVehicle,
  burstWorld,
  DECAL_BLOOD_POOL,
  DECAL_BLOOD_SPATTER,
  DECAL_CAPACITY,
  DECAL_HOLE,
  DECAL_POCK,
  DECAL_SCORCH,
  DECAL_SCUFF,
  FLAME,
  PUFF_WORLD,
  SMOKE_BLACK,
  SPARK,
  WATER_DROP,
} from './styles';
import { TracerPool } from './tracers';
import { VehicleFx } from './vehicles';

/** Particle budgets. A full pool recycles its oldest particle, so these are hard caps. */
const SMOKE_CAPACITY = 1400;
const GLOW_CAPACITY = 800;
const TRACER_CAPACITY = 72;
/** Impacts further than this from the camera are not drawn. */
const IMPACT_RANGE = 160;
/** Smoke columns left burning where something exploded. */
const COLUMNS = 6;
const COLUMN_SECONDS = 7;
/** Seconds between blood spatters on the ground (a shotgun blast should not lay eight). */
const SPATTER_INTERVAL = 0.07;
/** Crashes slower than this (closing speed, m/s) throw no sparks; seconds between spark bursts. */
const CRASH_SPEED = 3.5;
const CRASH_INTERVAL = 0.12;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const rnd = () => Math.random() * 2 - 1;

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
  private lastCrash = -1;
  // Smoke columns: x, y, z, seconds left, scale, emission accumulator.
  private columns = new Float32Array(COLUMNS * 6);
  private columnCursor = 0;
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
      ctx.events.on('actorDied', ({ actor, info }) => this.bloodPool(actor, info)),
      ctx.events.on('vehicleCrash', ({ vehicle, speed }) => this.crash(vehicle, speed)),
    );
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

  /** Fireball, smoke, debris, light, a scorch on the ground and a smoke column that lingers. */
  explosion(position: THREE.Vector3, radius: number) {
    const { ctx } = this;
    burstExplosion(this.smoke, this.glow, position, radius);
    const level = 1 - 0.55 * ctx.env.night;
    this.lights.flash(position.x, position.y + 1.2, position.z, 0xffb060, 1100 * (radius / 9) * level, radius * 5.5, 0.55);
    const ground = ctx.world.groundAt(position.x, position.z);
    if (position.y - ground < 3.5 && ctx.world.waterDepthAt(position.x, position.z) < 0.1) {
      _a.set(position.x, ground, position.z);
      this.decals.add(DECAL_SCORCH, ctx.clock.elapsed, _a, this.groundNormal(_a.x, _a.z, ground, _n), null, radius * 0.5, radius * 0.5);
    }
    // Leave it burning.
    const o = this.columnCursor * 6;
    this.columnCursor = (this.columnCursor + 1) % COLUMNS;
    const c = this.columns;
    c[o] = position.x;
    c[o + 1] = position.y;
    c[o + 2] = position.z;
    c[o + 3] = COLUMN_SECONDS;
    c[o + 4] = radius / 9;
    c[o + 5] = 0;
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
    if (surface === 'world') {
      burstWorld(this.smoke, this.glow, position, normal, melee);
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
      burstVehicle(this.smoke, this.glow, p, n, melee);
    } else {
      const blood = hinted ? this.hintBlood : 0.6;
      burstFlesh(this.smoke, position, normal, direction, blood);
      if (blood > 0.3) this.spatter(position, direction, blood);
    }
  }

  /** Blood landing on the ground beyond someone who was hit. */
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
    const length = (0.3 + Math.random() * 0.3) * (0.7 + 0.4 * amount);
    this.decals.add(DECAL_BLOOD_SPATTER, now, _a, this.groundNormal(x, z, ground, _n), flat > 0.05 ? direction : null, length, length * (0.5 + Math.random() * 0.25));
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
    const size = 0.55 + Math.random() * 0.3;
    this.decals.add(DECAL_BLOOD_POOL, ctx.clock.elapsed, _a, this.groundNormal(x, z, ground, _n), null, size, size * (0.75 + Math.random() * 0.25));
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
    // Left of the vehicle, for spreading the burst across the bumper.
    _n.set(1, 0, 0).applyQuaternion(vehicle.group.quaternion);
    const sparks = Math.min(18, Math.round(4 + speed * 1.1));
    for (let i = 0; i < sparks; i++) {
      const across = rnd() * half;
      const s = 1.5 + Math.random() * 3.5;
      this.glow.emit(SPARK, _a.x + _n.x * across, _a.y - 0.15 + rnd() * 0.25, _a.z + _n.z * across, -_b.x * end * s + rnd() * 3, 1 + Math.random() * 3, -_b.z * end * s + rnd() * 3);
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

  // ───────────── Frame ─────────────

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
    this.burn(dt);

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

  /** Smoke columns and guttering flames where explosions happened. */
  private burn(dt: number) {
    const c = this.columns;
    for (let i = 0; i < COLUMNS; i++) {
      const o = i * 6;
      if (c[o + 3] <= 0) continue;
      c[o + 3] -= dt;
      const k = Math.max(0, c[o + 3] / COLUMN_SECONDS);
      const scale = c[o + 4];
      c[o + 5] += (4 + 14 * k) * dt;
      while (c[o + 5] >= 1) {
        c[o + 5] -= 1;
        const x = c[o] + rnd() * 1.2 * scale;
        const z = c[o + 2] + rnd() * 1.2 * scale;
        this.smoke.emit(SMOKE_BLACK, x, c[o + 1] + 0.4 + Math.random() * 0.6, z, rnd() * 0.5, 2 + Math.random() * 1.5, rnd() * 0.5, 1.1 * scale);
        if (k > 0.45 && Math.random() < 0.7) this.glow.emit(FLAME, x, c[o + 1] + 0.3, z, rnd() * 0.5, 1.4 + Math.random(), rnd() * 0.5, 1.3 * scale);
      }
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
