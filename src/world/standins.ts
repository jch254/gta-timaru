import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { angleDiff } from '../core/math';
import { hashInts, Rng } from '../core/rng';
import type { GameContext, Vehicle, VehicleClass, VehicleSpec } from '../core/types';
import type { ColliderBox } from './chunkbuilder';

/**
 * What each scenery car may turn into: lists of vehicle classes, best fit first. A class from a later list is
 * used only when the district's traffic has nothing from an earlier one. Chosen by class, never by spec id, so
 * a new car in the roster turns up in the car parks by itself.
 */
export const STAND_IN_KINDS: Record<string, readonly (readonly VehicleClass[])[]> = {
  'car-parked': [['sedan', 'coupe', 'hatch']],
  'car-parked-wagon': [['wagon'], ['hatch'], ['sedan']],
  'van-parked': [['van']],
};

export const STAND_INS = {
  /** A stand-in this near the player (m) becomes a real vehicle… */
  promote: 40,
  /** …and one nobody has touched goes back to scenery beyond this. The gap keeps one at the edge from flickering. */
  demote: 55,
  /** Most promoted vehicles nobody has touched, at once. */
  cap: 8,
  /** With the cap reached, a waiting stand-in takes the farthest one's place only when it is this much nearer (m). */
  swapMargin: 3,
  /** Seconds between looks. At most one promotion each, so a car park never spawns several cars in one frame. */
  tick: 0.1,
  /** Untouched means still within this of where it was put (m, rad). */
  moved: 0.4,
  turned: 0.1,
  /** A prop standing this far above or below the ground a vehicle is spawned on (a deck, a slab) stays scenery (m). */
  heightSlack: 0.4,
  /** Draws from the district's traffic mix for each class list before moving on to the next. */
  tries: 12,
  /** Seconds before a stand-in with a vehicle across its spot is looked at again. */
  retry: 1,
  /** Abandoned cars are tidied away as traffic's are: TRAFFIC.despawn, wreckSeconds and wreckDistance in ai/tuning.ts. */
  despawn: 320,
  wreckSeconds: 60,
  wreckDistance: 70,
};

/** One scenery car: an instance of a prop kind in `STAND_IN_KINDS`. */
export interface StandIn {
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  tint?: number;
  /** The instanced meshes it is drawn by (one per part) and its slot in them. */
  meshes: THREE.InstancedMesh[];
  index: number;
  /** Its static collider (null while it is hidden) and the box that collider is made from. */
  box: ColliderBox;
  collider: RAPIER.Collider | null;
  chunk: number;
  /**
   * 'prop': scenery, as built. 'live': hidden, with a real vehicle in its place that nobody has touched yet.
   * 'gone': hidden for good (until its chunk is built again): the vehicle was driven off, hit or taken away.
   * 'fixed': scenery that is never promoted (nothing in the roster suits it, or it stands on a built surface).
   */
  state: 'prop' | 'live' | 'gone' | 'fixed';
  vehicle: Vehicle | null;
  /** The spec it becomes (chosen once: the same every time). */
  spec: string | null;
  /** Clock time before which it is not looked at again. */
  wait: number;
}

/** A promoted car that has been entered, moved, hit or damaged: an ordinary abandoned car, kept only to be tidied away. */
interface Loose {
  vehicle: Vehicle;
  wreckTime: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

const suits = (spec: VehicleSpec | undefined, classes: readonly VehicleClass[]): spec is VehicleSpec => !!spec && spec.traffic && spec.id !== 'taxi' && classes.includes(spec.cls);

/**
 * The spec a scenery car of `kind` at (x, z) becomes, or null if the roster has nothing of the right shape.
 * Drawn from the district's traffic mix as the traffic system draws its own, from a generator seeded by the
 * position alone: the same car in the same place, however often the player comes and goes.
 */
export function standInSpec(ctx: GameContext, kind: string, x: number, z: number): string | null {
  const lists = STAND_IN_KINDS[kind];
  if (!lists) return null;
  const rng = new Rng(hashInts(Math.round(x * 8), Math.round(z * 8), 0x7a6b));
  const district = ctx.world.districtAt(x, z);
  const specs = ctx.vehicles.specs;
  for (const classes of lists) {
    for (let i = 0; i < STAND_INS.tries; i++) {
      const id = ctx.vehicles.pickSpec(district.type, rng, district.city);
      if (suits(specs.get(id), classes)) return id;
    }
  }
  // Nothing of the kind drives in this district: the first of the right shape in the roster.
  for (const classes of lists) for (const spec of specs.values()) if (suits(spec, classes)) return spec.id;
  return null;
}

/** Do two rectangles on the ground overlap? Centre, heading and half width / half length of each. */
export function footprintsOverlap(ax: number, az: number, ah: number, ahw: number, ahl: number, bx: number, bz: number, bh: number, bhw: number, bhl: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const as = Math.sin(ah);
  const ac = Math.cos(ah);
  const bs = Math.sin(bh);
  const bc = Math.cos(bh);
  // |cos| and |sin| of the angle between them: how much of one's length lies along the other's length and width.
  const c = Math.abs(as * bs + ac * bc);
  const s = Math.abs(as * bc - ac * bs);
  // Separated along either one's length or width (headings point along +z, so right is (cos, -sin)).
  if (Math.abs(dx * as + dz * ac) > ahl + bhl * c + bhw * s) return false;
  if (Math.abs(dx * ac - dz * as) > ahw + bhl * s + bhw * c) return false;
  if (Math.abs(dx * bs + dz * bc) > bhl + ahl * c + ahw * s) return false;
  if (Math.abs(dx * bc - dz * bs) > bhw + ahl * s + ahw * c) return false;
  return true;
}

/**
 * The cars that fill car parks, car yards and marked bays are scenery: one instanced prop each, with a static
 * box. A player cannot tell them from the vehicles traffic parks at the kerb, so near the player each becomes
 * one: its instance is hidden, its box removed and a real vehicle of the same shape and colour put on the spot.
 * Left alone it turns back into scenery when the player has gone; entered, moved or hit, it is an ordinary
 * abandoned car and its bay stays empty until the chunk is next built.
 *
 * Promotion does not wait on traffic's vehicle budget: the car in front of the player must open however busy
 * the street is. The cap on untouched ones keeps the total in hand (and they count towards that budget).
 */
export class StandIns {
  private byChunk = new Map<number, StandIn[]>();
  private live: StandIn[] = [];
  private loose: Loose[] = [];
  private ctx: GameContext | null = null;
  private since = 0;
  private clock = 0;

  constructor(
    /** Take a stand-in's static collider out of the physics world and its chunk's list, or put it back. */
    private setSolid: (s: StandIn, solid: boolean) => void,
  ) {}

  attach(ctx: GameContext) {
    this.ctx = ctx;
  }

  add(chunk: number, s: StandIn) {
    let list = this.byChunk.get(chunk);
    if (!list) this.byChunk.set(chunk, (list = []));
    list.push(s);
  }

  /** The chunk is being unloaded (its colliders and meshes go with it), and with it any vehicle nobody has touched. */
  dropChunk(chunk: number) {
    const list = this.byChunk.get(chunk);
    if (!list) return;
    this.byChunk.delete(chunk);
    for (const s of list) {
      if (s.state !== 'live') continue;
      this.live.splice(this.live.indexOf(s), 1);
      if (s.vehicle && this.untouched(s, s.vehicle)) this.ctx?.vehicles.remove(s.vehicle);
      else if (s.vehicle) this.release(s.vehicle);
      s.vehicle = null;
      s.state = 'gone';
    }
  }

  /** Per frame; the work is done every `STAND_INS.tick` seconds. */
  update(dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.since += dt;
    if (this.since < STAND_INS.tick) return;
    const elapsed = this.since;
    this.since = 0;
    this.clock += elapsed;
    const px = ctx.player.position.x;
    const pz = ctx.player.position.z;
    this.tend(ctx, px, pz);
    this.tidy(ctx, px, pz, elapsed);
    this.promoteNearest(ctx, px, pz);
  }

  /** The promoted ones: let go of any that has been touched, turn back any the player has left behind. */
  private tend(ctx: GameContext, px: number, pz: number) {
    const far = STAND_INS.demote * STAND_INS.demote;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      const v = s.vehicle!;
      const removed = ctx.vehicles.all.indexOf(v) < 0;
      if (removed || !this.untouched(s, v)) {
        // Removed behind our back (a mission clearing the spot), or somebody's car now: the bay stays empty.
        this.live.splice(i, 1);
        s.vehicle = null;
        s.state = 'gone';
        if (!removed) this.release(v);
        continue;
      }
      const dx = s.x - px;
      const dz = s.z - pz;
      if (dx * dx + dz * dz > far || !ctx.world.isLoaded(s.x, s.z)) this.demote(s);
    }
  }

  /** Abandoned cars that began as stand-ins are cleared away by the rules traffic clears its own by. */
  private tidy(ctx: GameContext, px: number, pz: number, elapsed: number) {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const car = this.loose[i];
      const v = car.vehicle;
      if (ctx.vehicles.all.indexOf(v) < 0) {
        this.loose.splice(i, 1);
        continue;
      }
      if (v.destroyed) car.wreckTime += elapsed;
      if (v === ctx.player.vehicle || v.tags.has('mission')) continue;
      if (v.controller === 'player' || v.controller === 'police' || v.controller === 'mission') continue;
      if (v.driver || v.passengers.length > 0) continue;
      const dx = v.position.x - px;
      const dz = v.position.z - pz;
      const d2 = dx * dx + dz * dz;
      const gone =
        d2 > STAND_INS.despawn * STAND_INS.despawn ||
        !ctx.world.isLoaded(v.position.x, v.position.z) ||
        (v.destroyed && car.wreckTime > STAND_INS.wreckSeconds && d2 > STAND_INS.wreckDistance * STAND_INS.wreckDistance);
      if (!gone) continue;
      this.loose.splice(i, 1);
      ctx.vehicles.remove(v);
    }
  }

  /** The nearest waiting stand-in within reach becomes a vehicle, in the farthest promoted one's place if the cap is reached. */
  private promoteNearest(ctx: GameContext, px: number, pz: number) {
    let best: StandIn | null = null;
    let bestD = STAND_INS.promote * STAND_INS.promote;
    for (const list of this.byChunk.values()) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.state !== 'prop' || s.wait > this.clock) continue;
        const dx = s.x - px;
        const dz = s.z - pz;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    if (!best || !ctx.world.isLoaded(best.x, best.z)) return;
    if (!this.ready(ctx, best)) return;
    if (this.live.length >= STAND_INS.cap) {
      let farthest: StandIn | null = null;
      let farD = 0;
      for (const s of this.live) {
        const dx = s.x - px;
        const dz = s.z - pz;
        const d = dx * dx + dz * dz;
        if (d > farD) {
          farD = d;
          farthest = s;
        }
      }
      if (!farthest || Math.sqrt(farD) < Math.sqrt(bestD) + STAND_INS.swapMargin) return;
      this.demote(farthest);
    }
    this.promote(ctx, best);
  }

  /** Can this one be promoted now? Settles what it becomes; one that never can is marked 'fixed'. */
  private ready(ctx: GameContext, s: StandIn): boolean {
    if (s.spec === null) {
      s.spec = standInSpec(ctx, s.kind, s.x, s.z);
      // A vehicle is full size and is put on the drivable ground: a scaled prop, or one stood on something
      // else (a deck, a slab), is left as it is.
      if (s.spec === null || Math.abs(s.scale - 1) > 0.1 || Math.abs(ctx.world.groundAt(s.x, s.z) - s.y) > STAND_INS.heightSlack) {
        s.state = 'fixed';
        return false;
      }
    }
    // A vehicle is bigger than the prop's box: not while another is hard up against it.
    const spec = ctx.vehicles.specs.get(s.spec)!;
    for (const v of ctx.vehicles.all) {
      if (Math.abs(v.position.y - s.y) > 4) continue;
      if (!footprintsOverlap(s.x, s.z, s.heading, spec.width / 2 + 0.1, spec.length / 2 + 0.1, v.position.x, v.position.z, v.heading, v.spec.width / 2, v.spec.length / 2)) continue;
      s.wait = this.clock + STAND_INS.retry;
      return false;
    }
    return true;
  }

  private promote(ctx: GameContext, s: StandIn) {
    this.show(s, false);
    const spec = ctx.vehicles.specs.get(s.spec!)!;
    // The colour it was as scenery; an untinted one takes a paint of its own, the same one every time.
    const color = s.tint ?? (spec.colors.length ? spec.colors[hashInts(Math.round(s.x * 8), Math.round(s.z * 8), 0x1c0f) % spec.colors.length] : undefined);
    const v = ctx.vehicles.spawn(spec.id, s.x, s.z, s.heading, { color, controller: 'none', tags: ['parked'] });
    if (!v) {
      this.show(s, true);
      s.wait = this.clock + STAND_INS.retry;
      return;
    }
    v.controls.handbrake = true;
    s.vehicle = v;
    s.state = 'live';
    this.live.push(s);
  }

  /** Back to scenery: the vehicle goes, the instance and its box return. */
  private demote(s: StandIn) {
    const i = this.live.indexOf(s);
    if (i >= 0) this.live.splice(i, 1);
    if (s.vehicle) this.ctx?.vehicles.remove(s.vehicle);
    s.vehicle = null;
    s.state = 'prop';
    this.show(s, true);
  }

  /** Hide or restore the scenery instance and its collider. (Its colour is left alone throughout.) */
  private show(s: StandIn, visible: boolean) {
    if (visible) _m.compose(_p.set(s.x, s.y, s.z), _q.setFromAxisAngle(UP, s.heading), _s.setScalar(s.scale));
    for (const mesh of s.meshes) {
      mesh.setMatrixAt(s.index, visible ? _m : ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.setSolid(s, visible);
  }

  /** Nobody has been in it, moved it, hit it or claimed it since it was put there. */
  private untouched(s: StandIn, v: Vehicle): boolean {
    if (v.driver || v.passengers.length > 0 || v.controller !== 'none') return false;
    if (v.destroyed || v.burning || v.health < v.spec.health) return false;
    if (v.tags.has('mission') || v.tags.has('owned')) return false;
    const dx = v.position.x - s.x;
    const dz = v.position.z - s.z;
    return dx * dx + dz * dz <= STAND_INS.moved * STAND_INS.moved && Math.abs(angleDiff(v.heading, s.heading)) <= STAND_INS.turned;
  }

  /** No longer a stand-in: an abandoned car like any other (as traffic's parked cars are once taken). */
  private release(v: Vehicle) {
    v.tags.delete('parked');
    this.loose.push({ vehicle: v, wreckTime: 0 });
  }
}
