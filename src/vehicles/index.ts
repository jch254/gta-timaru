import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Actor, DistrictType, GameContext, System, Vehicle, VehicleSpec, VehiclesApi } from '../core/types';
import { VEHICLE_MODELS } from './models';
import { VEHICLE_SPECS } from './specs';
import { VehicleImpl } from './vehicle';

/** Owns every vehicle: spawning, stepping, seating and the player's headlights. */
export class Vehicles implements VehiclesApi, System {
  readonly name = 'vehicles';
  specs = new Map<string, VehicleSpec>(VEHICLE_SPECS.map((s) => [s.id, s]));
  all: Vehicle[] = [];
  private nextId = 1;
  private rng = new Rng(4242);
  private lamps = new THREE.SpotLight(0xfff0cc, 0, 70, 0.6, 0.55, 1.4);

  constructor(private ctx: GameContext) {
    this.lamps.castShadow = false;
    ctx.scene.add(this.lamps, this.lamps.target);
  }

  spawn(specId: string, x: number, z: number, heading: number, options: { color?: number; controller?: Vehicle['controller']; tags?: string[] } = {}): Vehicle | null {
    const spec = this.specs.get(specId);
    if (!spec) throw new Error(`Unknown vehicle spec "${specId}"`);
    if (!this.ctx.world.isLoaded(x, z)) return null;
    const color = options.color ?? this.rng.pick(spec.colors);
    const build = VEHICLE_MODELS[spec.model] ?? VEHICLE_MODELS.sedan;
    const model = build(spec, color, this.ctx.gfx.materials);
    const v = new VehicleImpl(this.nextId++, spec, model, color, this.ctx, x, this.ctx.world.groundAt(x, z), z, heading);
    v.controller = options.controller ?? 'none';
    for (const t of options.tags ?? []) v.tags.add(t);
    this.all.push(v);
    return v;
  }

  remove(vehicle: Vehicle) {
    const i = this.all.indexOf(vehicle);
    if (i < 0) return;
    this.all.splice(i, 1);
    if (vehicle.driver) vehicle.driver.vehicle = null;
    for (const p of vehicle.passengers) p.vehicle = null;
    (vehicle as VehicleImpl).dispose();
  }

  nearest(x: number, z: number, maxDistance: number, filter?: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = maxDistance;
    for (const v of this.all) {
      const d = Math.hypot(v.position.x - x, v.position.z - z);
      if (d < bestD && (!filter || filter(v))) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  pickSpec(district: DistrictType, rng: { next(): number } = this.rng): string {
    const options = VEHICLE_SPECS.filter((s) => s.traffic && (s.spawn[district] ?? 0) > 0);
    if (!options.length) return VEHICLE_SPECS[0].id;
    let total = 0;
    for (const s of options) total += s.spawn[district]!;
    let r = rng.next() * total;
    for (const s of options) {
      r -= s.spawn[district]!;
      if (r <= 0) return s.id;
    }
    return options[0].id;
  }

  enter(actor: Actor, vehicle: Vehicle, seat = 0) {
    if (actor.vehicle) this.exit(actor);
    let ejected: Actor | null = null;
    const hadOwner = vehicle.driver !== null || !vehicle.tags.has('owned');
    if (seat === 0) {
      ejected = vehicle.driver;
      if (ejected) {
        ejected.vehicle = null;
        this.ctx.events.emit('vehicleExited', { actor: ejected, vehicle });
      }
      vehicle.driver = actor;
    } else {
      vehicle.passengers.push(actor);
    }
    actor.vehicle = vehicle;
    const stolen = actor.kind === 'player' && seat === 0 && hadOwner;
    if (actor.kind === 'player' && seat === 0) {
      vehicle.controller = 'player';
      vehicle.tags.add('owned');
    }
    this.ctx.events.emit('vehicleEntered', { actor, vehicle, stolen, ejected });
  }

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
    } else {
      vehicle.passengers = vehicle.passengers.filter((p) => p !== actor);
    }
    actor.vehicle = null;
    this.ctx.events.emit('vehicleExited', { actor, vehicle });
  }

  fixedUpdate(dt: number) {
    for (const v of this.all) (v as VehicleImpl).fixedUpdate(dt);
  }

  update(dt: number) {
    for (const v of this.all) (v as VehicleImpl).update(dt);
    // Real headlight beam for the player's car only; everyone else just glows.
    const mine = this.ctx.player.vehicle;
    const on = mine && this.ctx.env.night > 0.3 && !mine.destroyed;
    this.lamps.intensity = on ? 900 * this.ctx.env.night : 0;
    if (mine && on) {
      const f = new THREE.Vector3(Math.sin(mine.heading), 0, Math.cos(mine.heading));
      this.lamps.position.copy(mine.position).addScaledVector(f, mine.spec.length / 2).setY(mine.position.y + 0.2);
      this.lamps.target.position.copy(mine.position).addScaledVector(f, 40).setY(mine.position.y - 1.5);
    }
  }
}
