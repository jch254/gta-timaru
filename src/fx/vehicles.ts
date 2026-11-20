import * as THREE from 'three';
import type { GameContext, GroundSurface, Vehicle } from '../core/types';
import type { Decals } from './decals';
import type { ParticlePool, ParticleStyle } from './particles';
import { DECAL_BLOOD_TYRE, DECAL_BURN, DECAL_SKID, DUST_GRASS, DUST_GRAVEL, DUST_SAND, FLAME, SMOKE_BLACK, SMOKE_DARK, SMOKE_GREY, SMOKE_TYRE, WATER_SPRAY } from './styles';

/** Vehicles further than this from the camera get no effects; beyond HALF they emit at half rate. */
const RANGE = 130;
const HALF = 65;
/** Seconds between ground-surface / water samples per vehicle. */
const SAMPLE = 0.2;
/** Seconds a wreck keeps smoking after it is destroyed. */
const WRECK_SMOKE = 28;
/** Engine smoke starts below this fraction of full health. */
const SMOKE_BELOW = 0.35;
/** Tyre smoke and skid marks start above this lateral slip. */
const SLIP = 0.5;
/** Tyre-smoke particles a second from a car doing a burnout flat out (see `Vehicle.wheelspin`). */
const BURNOUT_SMOKE = 70;
/** Metres a sliding wheel travels between tyre-mark segments. */
const SKID_STEP = 0.75;
/** Most particles one effect may emit for one vehicle in one frame. */
const BURST = 4;
/** Metres of road a tyre that went through blood keeps printing it, fading all the way. */
const BLOOD_TRACK = 24;

/** Height of the chassis centre above the bottom of the tyres (the vehicle rig uses wheel radius + 0.28). */
const rideHeight = (v: Vehicle) => v.spec.wheelRadius + 0.28;

interface State {
  smoke: number;
  flame: number;
  tyre: number;
  dust: number;
  spray: number;
  sample: number;
  surface: GroundSurface;
  depth: number;
  waterY: number;
  /** In the water at the last sample; null until first sampled. */
  wet: boolean | null;
  /** Seconds since first seen destroyed. */
  wreck: number;
  scorched: boolean;
  side: number;
  skidding: boolean;
  /** Metres of red tyre print left in the tread. */
  blood: number;
  /** Last tyre-mark points for the rear-left and rear-right wheels. */
  marks: Float32Array;
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const rnd = () => Math.random() * 2 - 1;

/**
 * Everything vehicles throw off: engine smoke as they are damaged, flames and black smoke when
 * burning, a scorch under the fire, tyre smoke and tyre marks in a slide, dust on loose surfaces,
 * spray and a splash in water. Driven from `ctx.vehicles.all` every frame; state lives in a WeakMap
 * so removed vehicles need no clean-up.
 */
export class VehicleFx {
  private states = new WeakMap<Vehicle, State>();

  constructor(
    private ctx: GameContext,
    private smoke: ParticlePool,
    private glow: ParticlePool,
    private decals: Decals,
    private splash: (position: THREE.Vector3, size: number) => void,
  ) {}

  /** The vehicle's tyres went through blood: they print it on the road for a while. */
  bloody(vehicle: Vehicle, metres = BLOOD_TRACK) {
    const s = this.state(vehicle);
    s.blood = Math.max(s.blood, metres);
  }

  private state(v: Vehicle): State {
    let s = this.states.get(v);
    if (!s) {
      s = { smoke: 0, flame: 0, tyre: 0, dust: 0, spray: 0, sample: Math.random() * SAMPLE, surface: 'road', depth: 0, waterY: -1e9, wet: null, wreck: 0, scorched: false, side: 1, skidding: false, blood: 0, marks: new Float32Array(6) };
      this.states.set(v, s);
    }
    return s;
  }

  update(dt: number) {
    const { ctx } = this;
    const cam = ctx.camera.position;
    const list = ctx.vehicles.all;
    const wetness = ctx.env.wetness;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const dx = v.position.x - cam.x;
      const dz = v.position.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > RANGE * RANGE) continue;
      const s = this.state(v);
      const lod = d2 > HALF * HALF ? 0.5 : 1;
      const vel = v.velocity;
      const moving = Math.hypot(vel.x, vel.z);
      const ride = rideHeight(v);
      const q = v.group.quaternion;
      _fwd.set(0, 0, 1).applyQuaternion(q);
      _up.set(0, 1, 0).applyQuaternion(q);
      _left.set(1, 0, 0).applyQuaternion(q);

      // What is under the wheels (sampled a few times a second: these lookups search the road graph).
      s.sample -= dt;
      if (s.sample <= 0 && (moving > 1 || s.wet === null)) {
        s.sample = SAMPLE;
        const x = v.position.x;
        const z = v.position.z;
        s.surface = ctx.world.surfaceAt(x, z);
        s.depth = ctx.world.waterDepthAt(x, z);
        let wet = false;
        if (s.depth > 0.12) {
          s.waterY = ctx.world.heightAt(x, z) + s.depth;
          wet = v.position.y - ride < s.waterY;
        }
        if (wet && s.wet === false && moving > 2) {
          _p.set(x, s.waterY, z);
          this.splash(_p, Math.min(2.2, 0.7 + moving / 10));
          ctx.audio.play('splash', { at: _p });
        }
        s.wet = wet;
      }
      const wet = s.wet === true;

      // ── Damage: engine smoke, fire, wreck ──
      const health = v.health / v.spec.health;
      let smokeRate = 0;
      let flameRate = 0;
      let smokeStyle: ParticleStyle = SMOKE_GREY;
      const sunk = wet && s.depth > 0.9;
      if (v.destroyed) {
        s.wreck += dt;
        if (!sunk && s.wreck < WRECK_SMOKE) {
          smokeRate = 10 * (1 - s.wreck / WRECK_SMOKE);
          smokeStyle = SMOKE_BLACK;
          if (s.wreck < 7) flameRate = 14 * (1 - s.wreck / 7);
        }
      } else if (v.burning) {
        smokeRate = 22;
        flameRate = 30;
        smokeStyle = SMOKE_BLACK;
        if (!s.scorched && !wet) {
          // The fire blackens the ground under the engine.
          s.scorched = true;
          _p.copy(v.position).addScaledVector(_up, -ride);
          this.decals.add(DECAL_BURN, ctx.clock.elapsed, _p, _up, null, v.spec.length * 0.55, v.spec.length * 0.55);
        }
      } else if (health < SMOKE_BELOW) {
        const k = 1 - Math.max(0, health) / SMOKE_BELOW;
        smokeRate = 5 + 11 * k;
        smokeStyle = k > 0.55 ? SMOKE_DARK : SMOKE_GREY;
      }
      if (smokeRate > 0 || flameRate > 0) {
        this.enginePoint(v, ride);
        const x = _p.x;
        const y = _p.y;
        const z = _p.z;
        s.smoke += smokeRate * lod * dt;
        for (let n = 0; s.smoke >= 1 && n < BURST; n++) {
          s.smoke -= 1;
          this.smoke.emit(smokeStyle, x + rnd() * 0.25, y + Math.random() * 0.2, z + rnd() * 0.25, vel.x * 0.25 + rnd() * 0.35, vel.y * 0.25 + 1 + Math.random() * 0.8, vel.z * 0.25 + rnd() * 0.35);
        }
        s.flame += flameRate * lod * dt;
        for (let n = 0; s.flame >= 1 && n < BURST; n++) {
          s.flame -= 1;
          this.glow.emit(FLAME, x + rnd() * 0.4, y - 0.1 + Math.random() * 0.2, z + rnd() * 0.4, vel.x * 0.6 + rnd() * 0.4, vel.y * 0.6 + 1.2 + Math.random(), vel.z * 0.6 + rnd() * 0.4);
        }
        if (s.smoke > BURST) s.smoke = BURST;
        if (s.flame > BURST) s.flame = BURST;
      }

      // ── Wheels: tyre smoke and marks, dust, spray ──
      let skidding = false;
      // A burnout smokes (or throws dirt) with the car standing still.
      const spin = v.wheelspin ?? 0;
      if (v.wheelsOnGround >= 2 && !v.destroyed && (moving > 2 || spin > 0.15)) {
        const surface = s.surface;
        const sealed = surface === 'road' || surface === 'footpath' || surface === 'paving';
        let tyreRate = 0;
        let dustRate = 0;
        let sprayRate = 0;
        let dustStyle: ParticleStyle = DUST_GRAVEL;
        if (wet) {
          if (s.depth < 1.4) sprayRate = Math.min(34, moving * 2.4);
        } else if (sealed) {
          if (v.slip > SLIP && moving > 5) {
            tyreRate = 40 * (v.slip - 0.25) * (1 - 0.6 * wetness);
            skidding = true;
          }
          if (spin > 0.15) {
            tyreRate = Math.max(tyreRate, BURNOUT_SMOKE * spin * (1 - 0.6 * wetness));
            skidding = true;
          }
        } else if (surface !== 'water' && (moving > 3 || spin > 0.15)) {
          const loose = surface === 'gravel' ? 1 : surface === 'sand' ? 0.9 : surface === 'shingle' ? 0.7 : 0.35;
          dustStyle = surface === 'sand' ? DUST_SAND : surface === 'gravel' || surface === 'shingle' ? DUST_GRAVEL : DUST_GRASS;
          dustRate = Math.min(30, moving * 1.4 + spin * 24) * loose * (1 - 0.85 * wetness) * (1 + v.slip);
        }
        if (tyreRate > 0 || dustRate > 0 || sprayRate > 0) {
          s.tyre += tyreRate * lod * dt;
          for (let n = 0; s.tyre >= 1 && n < BURST; n++) {
            s.tyre -= 1;
            this.rearWheel(v, ride, (s.side = -s.side));
            this.smoke.emit(SMOKE_TYRE, _p.x, _p.y + 0.15, _p.z, vel.x * 0.15 + rnd() * 0.6, 0.5 + Math.random() * 0.5, vel.z * 0.15 + rnd() * 0.6);
          }
          s.dust += dustRate * lod * dt;
          for (let n = 0; s.dust >= 1 && n < BURST; n++) {
            s.dust -= 1;
            this.rearWheel(v, ride, (s.side = -s.side));
            this.smoke.emit(dustStyle, _p.x, _p.y + 0.2, _p.z, vel.x * 0.22 + rnd() * 0.8, 0.6 + Math.random() * 0.9, vel.z * 0.22 + rnd() * 0.8);
          }
          s.spray += sprayRate * lod * dt;
          for (let n = 0; s.spray >= 1 && n < BURST; n++) {
            s.spray -= 1;
            this.rearWheel(v, ride, (s.side = -s.side));
            this.smoke.emit(WATER_SPRAY, _p.x, s.waterY + 0.05, _p.z, vel.x * 0.3 + rnd() * 1.2, 1.6 + Math.random() * 1.8, vel.z * 0.3 + rnd() * 1.2);
          }
          if (s.tyre > BURST) s.tyre = BURST;
          if (s.dust > BURST) s.dust = BURST;
          if (s.spray > BURST) s.spray = BURST;
        }
      }
      // Bloody tread prints on anything but water, slide or no slide.
      const printing = s.blood > 0 && !wet && !v.destroyed && v.wheelsOnGround >= 2 && moving > 0.5;
      this.tyreMarks(v, s, ride, (skidding && lod === 1) || printing, skidding);
    }
  }

  /** World point where engine smoke rises (into _p). */
  private enginePoint(v: Vehicle, ride: number) {
    const { spec } = v;
    let y = spec.height * 0.62;
    let z = spec.length * 0.36;
    if (spec.cls === 'bike') {
      y = spec.height * 0.5;
      z = spec.length * 0.05;
    } else if (spec.cls === 'bus' || spec.cls === 'van' || spec.cls === 'truck') {
      // Cab-over: smoke from the grille.
      y = spec.height * 0.38;
      z = spec.length * 0.47;
    }
    _p.copy(v.position).addScaledVector(_fwd, z).addScaledVector(_up, y - ride);
  }

  /** World contact point of a rear wheel (into _p). `side` +1 = left, −1 = right. */
  private rearWheel(v: Vehicle, ride: number, side: number) {
    const half = v.spec.wheelCount === 2 ? 0 : v.spec.track / 2;
    _p.copy(v.position)
      .addScaledVector(_fwd, -v.spec.wheelbase / 2)
      .addScaledVector(_left, side * half)
      .addScaledVector(_up, -ride);
  }

  /** Lay tyre marks behind the rear wheels while the vehicle slides on a sealed surface, or prints blood. */
  private tyreMarks(v: Vehicle, s: State, ride: number, marking: boolean, skidding: boolean) {
    if (!marking) {
      s.skidding = false;
      return;
    }
    const wheels = v.spec.wheelCount === 2 ? 1 : 2;
    const marks = s.marks;
    for (let w = 0; w < wheels; w++) {
      this.rearWheel(v, ride, w === 0 ? 1 : -1);
      const o = w * 3;
      if (!s.skidding) {
        marks[o] = _p.x;
        marks[o + 1] = _p.y;
        marks[o + 2] = _p.z;
        continue;
      }
      _a.set(marks[o], marks[o + 1], marks[o + 2]);
      _d.subVectors(_p, _a);
      const length = _d.length();
      if (length < SKID_STEP) continue;
      marks[o] = _p.x;
      marks[o + 1] = _p.y;
      marks[o + 2] = _p.z;
      if (length > 6) continue; // teleported or airborne in between: no mark
      // Centre of the segment, sat on the road and lying in it (not in the plane of a pitching, rolling body).
      _a.addScaledVector(_d, 0.5);
      const ground = this.ctx.world.groundAt(_a.x, _a.z);
      _a.y = ground;
      if (Math.abs(ground - this.ctx.world.heightAt(_a.x, _a.z)) > 0.25) _n.set(0, 1, 0);
      else this.ctx.world.normalAt(_a.x, _a.z, _n);
      const now = this.ctx.clock.elapsed;
      if (skidding) this.decals.add(DECAL_SKID, now, _a, _n, _d, length / 2 + 0.06, v.spec.wheelWidth * 0.5);
      if (s.blood > 0) {
        const left = s.blood / BLOOD_TRACK;
        this.decals.add(DECAL_BLOOD_TYRE, now, _a, _n, _d, length / 2 + 0.06, v.spec.wheelWidth * 0.45, DECAL_BLOOD_TYRE.alpha * Math.min(1, left * 1.4));
        // The tread wears clean as it goes (counted once, off the first wheel).
        if (w === 0) s.blood = Math.max(0, s.blood - length);
      }
    }
    s.skidding = true;
  }
}
