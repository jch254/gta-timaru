import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createHumanoid } from '../actors/humanoid';
import { TAU, angleDiff, clamp, damp, dampAngle } from '../core/math';
import type { Rng } from '../core/rng';
import { CollisionGroup, type Actor, type DamageInfo, type GameContext, type Humanoid, type HumanoidLook, type HumanoidPose, type Vehicle } from '../core/types';
import type { Intel } from './intel';
import { AIM, aimError, type CopWeapon } from './response';
import { TUNING } from './tuning';

const RADIUS = 0.3;
const HALF = 0.56; // capsule half-height (cylinder part)
const FEET = RADIUS + HALF;
const PROBE_MASK = CollisionGroup.World | CollisionGroup.Vehicle;
/** How far ahead an officer feels for obstacles. */
const PROBE_REACH = 2.2;
/** Obstacle probes run every this many frames per officer (staggered). */
const PROBE_EVERY = 3;
/** Headings tried, in order, when the way ahead is blocked (radians off the wanted heading). */
const DODGE = [0.7, 1.4];
/** A fallen officer's gun lies by the body this long (like a cash drop) before it fades. */
const GUN_DROP_SECONDS = 45;

const UNIFORM = { topStyle: 'uniform', top: 0x8fb0d8, legs: 0x1b2438, shoes: 0x101014, hat: 'police', hatColor: 0x1b2438 } as const;
const LOOKS: HumanoidLook[] = [
  { ...UNIFORM, skin: 0xd9ab8c, hair: 0x4a3524 },
  { ...UNIFORM, skin: 0xb98562, hair: 0x1c1410, bulk: 1.08 },
  { ...UNIFORM, skin: 0xe3b79a, hair: 0x8a5a2c, female: true, hairStyle: 'bob' },
  { ...UNIFORM, skin: 0x9a6a48, hair: 0x15110e, height: 1.04 },
  // Armed Response Section: dark overalls and a helmet.
  { skin: 0xd0a080, hair: 0x2a2018, topStyle: 'uniform', top: 0x1a2130, legs: 0x1a2130, shoes: 0x0c0c0e, hat: 'helmet', hatColor: 0x141a26, bulk: 1.1 },
];
/** Looks 0..PATROL_LOOKS−1 are ordinary constables; ARMED_LOOK is the van crew. */
export const PATROL_LOOKS = 4;
export const ARMED_LOOK = 4;

const _door = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _t = { x: 0, y: 0, z: 0 };

/** Building a skinned figure is the expensive part of an officer, so the rigs are recycled. */
export class RigPool {
  private free: Humanoid[][] = LOOKS.map(() => []);

  constructor(private ctx: GameContext) {}

  take(look: number): Humanoid {
    return this.free[look].pop() ?? createHumanoid(LOOKS[look], this.ctx.gfx.materials);
  }

  give(look: number, rig: Humanoid) {
    rig.setHeld(null);
    rig.group.removeFromParent();
    this.free[look].push(rig);
  }

  dispose() {
    for (const list of this.free) {
      for (const rig of list) rig.dispose();
      list.length = 0;
    }
  }
}

/** What an officer needs from the force it belongs to. */
export interface OfficerHost {
  readonly ctx: GameContext;
  readonly intel: Intel;
  readonly rng: Rng;
  readonly rigs: RigPool;
  readonly officers: readonly Officer[];
  /** Weapon models are recycled too; null when the combat system has none to give. */
  borrowWeapon(id: CopWeapon): THREE.Object3D | null;
  returnWeapon(id: CopWeapon, model: THREE.Object3D): void;
  copHurt(officer: Officer, info: DamageInfo): void;
  copDied(officer: Officer, info: DamageInfo): void;
}

/**
 * - seated: riding in a car (hidden, no collider; position follows the car)
 * - pursue: after the suspect on foot: collar them at low heat, shoot at high heat, search when unsighted
 * - guard:  holding a post behind a roadblock
 * - return: running back to the car
 * - leave:  wandering off until nobody is looking
 * - dead
 */
export type OfficerMode = 'seated' | 'pursue' | 'guard' | 'return' | 'leave' | 'dead';

/** One police officer: an Actor the police module owns, on foot or in a car. */
export class Officer implements Actor {
  readonly id: number;
  readonly kind = 'cop' as const;
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly velocity = new THREE.Vector3();
  heading = 0;
  health: number;
  maxHealth: number;
  armour = 0;
  alive = true;
  vehicle: Vehicle | null = null;
  name = 'Constable';

  mode: OfficerMode = 'seated';
  weaponId: CopWeapon;
  /** The car this officer came in and goes back to. */
  home: Vehicle | null = null;
  /** Seat taken in the current car (0 = driver). */
  seat = 0;
  /** Line of sight to the player, refreshed by the sight scheduler. */
  sees = false;
  /** Roadblock post. */
  readonly post = new THREE.Vector3();
  postHeading = 0;
  /** Seconds since death. */
  corpseTime = 0;
  /** Gone from the world; drop every reference. */
  removed = false;
  /** Asked to be removed at the next opportunity. */
  expired = false;
  /** Has a minimap blip. */
  blip = false;

  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private rig: Humanoid;
  private weaponModel: THREE.Object3D | null = null;
  private drawn = false;
  // Reused every frame (no garbage in the hot path).
  private readonly probeOptions: { mask: number; excludeBody: RAPIER.RigidBody };
  private readonly poseOptions = { speed: 0, aimPitch: 0 };
  private readonly muzzle = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3();
  private readonly searchGoal = new THREE.Vector3();
  private searching = false;
  private searchTime = 0;
  private engaged = false;
  private fireTimer = 0;
  private burst = 1;
  private hitCooldown = 0;
  // Where this officer likes to stand in a gunfight: an offset from the suspect, and how close to get.
  private fanX = 0;
  private fanZ = 0;
  private holdScale = 1;
  // Steering.
  private dodge = 0;
  private dodgeSide = 0;
  private clear = 0;
  private rise = 0;
  private stale = true;
  private detour = 0;
  private detourSide = 1;
  private stuckClock = 0;
  private stuckX = 0;
  private stuckZ = 0;

  constructor(
    private host: OfficerHost,
    private look: number,
    weaponId: CopWeapon,
    health: number,
  ) {
    const { ctx } = host;
    this.id = ctx.actors.nextId();
    this.weaponId = weaponId;
    this.health = this.maxHealth = health;
    const fan = host.rng.range(0, TAU);
    const reach = host.rng.range(4, 9);
    this.fanX = Math.sin(fan) * reach;
    this.fanZ = Math.cos(fan) * reach;
    this.holdScale = host.rng.range(0.7, 1.25);
    this.rig = host.rigs.take(look);
    this.group.add(this.rig.group);
    this.group.visible = false;
    ctx.scene.add(this.group);

    const R = ctx.physics.rapier;
    this.body = ctx.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
    // Vehicles are left out of the filter on purpose: a kinematic capsule would stop a car dead like a bollard.
    // Being run over is handled in `vehicleContact` instead. Bullets and probes still find the capsule, and the
    // player on foot is stopped by it.
    this.collider = ctx.physics.world.createCollider(
      R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(ctx.physics.groups(CollisionGroup.Character, CollisionGroup.World | CollisionGroup.Character | CollisionGroup.Debris)),
      this.body,
    );
    this.collider.setEnabled(false);
    this.probeOptions = { mask: PROBE_MASK, excludeBody: this.body };
    ctx.physics.setOwner(this.collider, this);
    ctx.actors.all.add(this);
  }

  // ───────────── Getting about ─────────────

  /** Take a seat. Only call with seat 0 when the driver's seat is empty. */
  board(vehicle: Vehicle, seat: number) {
    this.seat = seat;
    this.host.ctx.vehicles.enter(this, vehicle, seat);
    this.mode = 'seated';
    this.group.visible = false;
    this.collider.setEnabled(false);
    this.velocity.set(0, 0, 0);
    this.setDrawn(false);
    this.searching = false;
    this.engaged = false;
    this.position.copy(vehicle.position);
  }

  /** Get out beside the car. */
  dismount(mode: OfficerMode = 'pursue') {
    const v = this.vehicle;
    if (!v || this.mode !== 'seated') return;
    const { ctx } = this.host;
    v.doorPosition(_door, this.seat);
    // Door jammed against a wall: climb out the other side.
    _o.copy(v.position);
    _d.subVectors(_door, _o).setY(0);
    const len = _d.length();
    if (len > 0.01 && ctx.physics.raycast(_o, _d.multiplyScalar(1 / len), len + 0.3, { mask: CollisionGroup.World })) v.doorPosition(_door, this.seat === 0 ? 1 : 0);
    const heading = v.heading;
    ctx.vehicles.exit(this);
    this.standAt(_door.x, _door.z, heading, mode);
  }

  /** The car was taken from under this officer (hijacked, or removed by another system). */
  thrownOut(from: Vehicle | null) {
    if (this.mode !== 'seated' || !this.alive) return;
    this.vehicle = null;
    if (from) {
      from.doorPosition(_door, 1);
      this.standAt(_door.x, _door.z, from.heading, 'pursue');
    } else this.standAt(this.position.x, this.position.z, this.heading, 'pursue');
  }

  /** Appear on foot at a spot (roadblock crews start this way). */
  standAt(x: number, z: number, heading: number, mode: OfficerMode) {
    const y = this.host.ctx.world.groundAt(x, z);
    this.position.set(x, y, z);
    this.heading = heading;
    this.group.rotation.y = heading;
    _t.x = x;
    _t.y = y + FEET;
    _t.z = z;
    this.body.setTranslation(_t, true);
    this.group.visible = true;
    this.collider.setEnabled(true);
    this.mode = mode;
    this.velocity.set(0, 0, 0);
    this.dodge = 0;
    this.dodgeSide = 0;
    this.clear = 0;
    this.stale = true;
    this.detour = 0;
    this.stuckClock = 0;
    this.stuckX = x;
    this.stuckZ = z;
    this.searching = false;
    this.engaged = false;
    this.sees = false;
  }

  // ───────────── Actor ─────────────

  takeDamage(info: DamageInfo) {
    if (!this.alive || this.removed) return;
    this.health -= info.amount;
    this.host.ctx.events.emit('actorDamaged', { actor: this, info });
    if (this.health <= 0) this.die(info);
    else {
      this.fireTimer += 0.35; // flinch
      this.host.copHurt(this, info);
    }
  }

  private die(info: DamageInfo) {
    const { ctx } = this.host;
    this.health = 0;
    this.alive = false;
    const v = this.vehicle;
    if (v) {
      // Slumps out beside the car.
      v.doorPosition(_door, this.seat);
      const heading = v.heading;
      ctx.vehicles.exit(this);
      this.standAt(_door.x, _door.z, heading, 'dead');
    }
    this.mode = 'dead';
    this.corpseTime = 0;
    this.velocity.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.group.visible = true;
    this.setDrawn(false);
    this.rig.setPose('dead');
    ctx.actors.all.delete(this);
    this.dropWeapon();
    ctx.events.emit('actorDied', { actor: this, info });
    this.host.copDied(this, info);
  }

  /**
   * The officer's gun is left by the body for anyone game enough to take it. A fresh pickup model by
   * weapon id, nothing to do with the borrowed held model (that goes back through `returnWeapon`).
   */
  private dropWeapon() {
    const { ctx, rng } = this.host;
    const x = this.position.x + rng.range(-0.45, 0.45);
    const z = this.position.z + rng.range(-0.45, 0.45);
    if (ctx.world.waterDepthAt(x, z) > 0.2) return;
    const ammo = this.weaponId === 'shotgun' ? rng.int(3, 5) : rng.int(6, 10);
    try {
      ctx.combat.spawnPickup(this.weaponId, x, z, ammo, 0, { ttl: GUN_DROP_SECONDS, drop: true });
    } catch {
      // Combat unavailable (stub): nothing is left behind.
    }
  }

  /** Remove from the world for good. Safe to call twice. */
  retire() {
    if (this.removed) return;
    this.removed = true;
    const { ctx } = this.host;
    if (this.vehicle) ctx.vehicles.exit(this);
    this.vehicle = null;
    this.home = null;
    this.alive = false;
    this.mode = 'dead';
    ctx.actors.all.delete(this);
    this.setDrawn(false);
    ctx.physics.setOwner(this.collider, null);
    ctx.physics.world.removeRigidBody(this.body);
    this.host.rigs.give(this.look, this.rig);
    this.group.removeFromParent();
  }

  // ───────────── Simulation ─────────────

  /** `slot` staggers the obstacle probes between officers; `frame` is the force's frame counter. */
  update(dt: number, slot: number, frame: number) {
    if (this.removed) return;
    if (!this.alive) {
      this.corpseTime += dt;
      if (this.corpseTime < 2.5) this.rig.update(dt); // let the fall play out, then leave the rig alone
      return;
    }
    if (this.mode === 'seated') {
      const v = this.vehicle;
      if (v) {
        this.position.copy(v.position);
        this.velocity.copy(v.velocity);
        this.heading = v.heading;
      } else this.thrownOut(null);
      return;
    }
    this.onFoot(dt, slot, frame);
  }

  private onFoot(dt: number, slot: number, frame: number) {
    const { ctx, intel, rng } = this.host;
    const T = TUNING;
    const p = this.position;
    const tx = intel.target.x;
    const tz = intel.target.z;
    const toPlayer = Math.hypot(tx - p.x, tz - p.z);
    const aim = AIM[this.weaponId];
    const armed = intel.shoot && !intel.suspended;
    const active = intel.level > 0 && !intel.suspended;

    let gx = p.x;
    let gz = p.z;
    let stop = 0.6;
    let run = true;
    let hold = false;
    let shoot = false;
    let faceTarget = false;

    if (this.mode === 'pursue' && !active) this.mode = this.homeUsable() ? 'return' : 'leave';
    else if (this.mode === 'leave' && active && intel.seen && toPlayer < 60) this.mode = 'pursue';

    switch (this.mode) {
      case 'guard': {
        gx = this.post.x;
        gz = this.post.z;
        run = false;
        stop = 0.5;
        shoot = armed && this.sees && toPlayer < aim.range;
        faceTarget = active && intel.seen && toPlayer < 90;
        break;
      }
      case 'return': {
        const home = this.home;
        if (!home || !this.homeUsable()) {
          this.home = null;
          this.mode = active ? 'pursue' : 'leave';
          hold = true;
          break;
        }
        // In by whichever door is nearer (and across to the wheel if nobody is at it).
        const seat = home.driver === null ? 0 : 1;
        home.doorPosition(_door, 0);
        gx = _door.x;
        gz = _door.z;
        home.doorPosition(_door, 1);
        if (Math.hypot(_door.x - p.x, _door.z - p.z) < Math.hypot(gx - p.x, gz - p.z)) {
          gx = _door.x;
          gz = _door.z;
        }
        stop = 0.7;
        if (Math.hypot(gx - p.x, gz - p.z) < 1.5 && Math.abs(home.speed) < 3) {
          if (seat === 0 || home.passengers.length < home.spec.seats - 1) {
            this.board(home, seat);
            return;
          }
          this.home = null; // no room: stay on foot
        }
        break;
      }
      case 'leave': {
        // Walk away from the player until out of sight (the force removes us then).
        const ax = p.x - ctx.player.position.x;
        const az = p.z - ctx.player.position.z;
        const al = Math.hypot(ax, az) || 1;
        gx = p.x + (ax / al) * 12;
        gz = p.z + (az / al) * 12;
        run = false;
        stop = 0.5;
        break;
      }
      default: {
        if (!intel.seen) {
          // Nobody has eyes on the suspect: make for where they were last seen, then poke about.
          gx = intel.lastKnown.x;
          gz = intel.lastKnown.z;
          stop = 2;
          if (this.searching || Math.hypot(gx - p.x, gz - p.z) < 7) {
            this.searching = true;
            this.searchTime -= dt;
            if (this.searchTime <= 0) {
              this.searchTime = rng.range(2.5, 5);
              const a = rng.range(0, TAU);
              const r = rng.range(5, 18);
              this.searchGoal.set(intel.lastKnown.x + Math.sin(a) * r, 0, intel.lastKnown.z + Math.cos(a) * r);
            }
            gx = this.searchGoal.x;
            gz = this.searchGoal.z;
            run = false;
            stop = 1;
          }
        } else {
          this.searching = false;
          if (armed) {
            // With a clear view, each officer makes for their own spot near the suspect and stops at their
            // own distance, so a firing line forms instead of a huddle. Without one, straight for the suspect.
            gx = this.sees ? tx + this.fanX : tx;
            gz = this.sees ? tz + this.fanZ : tz;
            stop = 2.5;
            if (this.sees && toPlayer < aim.range) {
              shoot = true;
              faceTarget = true;
              if (toPlayer < aim.range * aim.hold * this.holdScale) hold = true;
              else run = false; // close in at a walk while firing
            }
          } else {
            // Go for the collar.
            gx = intel.arrestPoint.x;
            gz = intel.arrestPoint.z;
            stop = 0.9;
            faceTarget = toPlayer < 4;
          }
        }
      }
    }

    // ── Move ──
    const dx = gx - p.x;
    const dz = gz - p.z;
    const dGoal = Math.hypot(dx, dz);
    let speed = 0;
    let moveHeading = this.heading;
    if (!hold && dGoal > stop) {
      speed = run ? T.runSpeed : T.walkSpeed;
      if (dGoal - stop < 1.5) speed = Math.min(speed, 1.5 + (dGoal - stop) * 3);
      const want = Math.atan2(dx, dz);
      if (this.detour > 0) {
        // Wedged: try somewhere else entirely for a moment.
        this.detour -= dt;
        moveHeading = want + this.detourSide * 1.9;
        this.rise = 0;
        this.clear = this.probe(moveHeading, PROBE_REACH);
        this.stale = true;
      } else {
        if (this.stale || this.clear <= 0 || (frame + slot) % PROBE_EVERY === 0) {
          this.dodge = this.steer(want, Math.min(PROBE_REACH, Math.max(0.9, dGoal)));
          this.stale = false;
        }
        moveHeading = want + this.dodge;
      }
      // Never step further than the last probe saw to be clear.
      let step = speed * dt;
      const room = this.clear - RADIUS - 0.12;
      if (step > room) step = Math.max(0, room);
      this.clear -= step;
      const nx = p.x + Math.sin(moveHeading) * step;
      const nz = p.z + Math.cos(moveHeading) * step;
      if (step > 0 && dt > 0 && ctx.world.waterDepthAt(nx, nz) < 0.7) {
        p.x = nx;
        p.z = nz;
        speed = step / dt;
      } else speed = 0;
    }
    this.velocity.set(Math.sin(moveHeading) * speed, 0, Math.cos(moveHeading) * speed);

    // Give colleagues elbow room.
    for (const other of this.host.officers) {
      if (other === this || !other.alive || other.mode === 'seated') continue;
      const ox = p.x - other.position.x;
      const oz = p.z - other.position.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 0.64 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (0.8 - d) * 0.5;
        p.x += (ox / d) * push;
        p.z += (oz / d) * push;
      }
    }

    this.hitCooldown -= dt;
    this.vehicleContact();
    if (!this.alive) return;

    const ground = ctx.world.groundAt(p.x, p.z);
    p.y = Math.abs(ground - p.y) > 1.5 ? ground : damp(p.y, ground, 16, dt);

    // Wedged against something the probes cannot solve: note it and try a detour.
    this.stuckClock += dt;
    if (this.stuckClock >= 1) {
      const moved = Math.hypot(p.x - this.stuckX, p.z - this.stuckZ);
      if (!hold && dGoal > stop + 0.5 && moved < (run ? 0.5 : 0.2)) {
        this.detour = rng.range(0.7, 1.3);
        this.detourSide = rng.chance(0.5) ? 1 : -1;
      }
      this.stuckX = p.x;
      this.stuckZ = p.z;
      this.stuckClock = 0;
    }

    // ── Face, pose, weapon ──
    const face = faceTarget || shoot ? Math.atan2(tx - p.x, tz - p.z) : speed > 0.2 ? moveHeading : this.mode === 'guard' ? this.postHeading : this.heading;
    this.heading = dampAngle(this.heading, face, shoot ? 7 : 10, dt);
    this.group.rotation.y = this.heading;

    const draw = armed && (this.mode === 'pursue' || this.mode === 'guard');
    if (draw !== this.drawn) this.setDrawn(draw);

    let pose: HumanoidPose = 'idle';
    if (shoot) pose = this.weaponId === 'shotgun' ? 'aimRifle' : 'aim';
    else if (speed > 3) pose = 'run';
    else if (speed > 0.2) pose = 'walk';
    else if (!armed && this.mode === 'pursue' && intel.seen && toPlayer < 2.6) pose = 'aim'; // hands out for the collar
    const aimPitch = shoot ? clamp(-Math.atan2(intel.aimPoint.y - (p.y + 1.4), Math.max(1, toPlayer)), -0.6, 0.6) : 0;
    this.poseOptions.speed = speed;
    this.poseOptions.aimPitch = aimPitch;
    this.rig.setPose(pose, this.poseOptions);
    this.rig.update(dt);

    // ── Shoot ──
    if (shoot) {
      if (!this.engaged) {
        this.engaged = true;
        this.burst = rng.int(aim.burst[0], aim.burst[1]);
        this.fireTimer = Math.max(this.fireTimer, rng.range(aim.reaction[0], aim.reaction[1]));
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && Math.abs(angleDiff(face, this.heading)) < 0.3) {
        this.fire(toPlayer);
        if (--this.burst > 0) this.fireTimer = rng.range(aim.shotGap[0], aim.shotGap[1]);
        else {
          this.burst = rng.int(aim.burst[0], aim.burst[1]);
          this.fireTimer = rng.range(aim.pause[0], aim.pause[1]);
        }
      }
    } else {
      this.engaged = false;
      if (this.fireTimer > 0) this.fireTimer -= dt;
    }

    _t.x = p.x;
    _t.y = p.y + FEET;
    _t.z = p.z;
    this.body.setNextKinematicTranslation(_t);
  }

  private homeUsable(): boolean {
    const home = this.home;
    return !!home && !home.destroyed && !home.burning && home.controller === 'police';
  }

  // ───────────── Steering ─────────────

  /** Distance to the first wall or vehicle along heading `h` (Infinity if clear to `reach`). */
  private probe(h: number, reach: number): number {
    const p = this.position;
    _o.set(p.x, p.y + 0.55, p.z);
    _d.set(Math.sin(h) * reach, this.rise, Math.cos(h) * reach).normalize();
    const hit = this.host.ctx.physics.raycast(_o, _d, reach, this.probeOptions);
    return hit ? hit.distance : Infinity;
  }

  /** Pick a heading offset that gets round whatever is in the way. Sets `clear` for the chosen heading. */
  private steer(want: number, reach: number): number {
    const { ctx, rng } = this.host;
    const p = this.position;
    // Probe along the slope so rising ground does not read as a wall.
    this.rise = clamp(ctx.world.groundAt(p.x + Math.sin(want) * reach, p.z + Math.cos(want) * reach) - p.y, -1.4, 1.4);
    const ahead = this.probe(want, reach);
    if (ahead >= reach) {
      this.clear = reach;
      this.dodgeSide = 0;
      // Clear ahead: just shave corners.
      const left = this.probe(want + 0.6, 1.1);
      const right = this.probe(want - 0.6, 1.1);
      if (left < 1.1 && right >= 1.1) return -0.3;
      if (right < 1.1 && left >= 1.1) return 0.3;
      return 0;
    }
    const first = this.dodgeSide !== 0 ? this.dodgeSide : rng.chance(0.5) ? 1 : -1;
    let best = 0;
    let bestClear = ahead;
    for (const angle of DODGE) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? first : -first;
        const c = this.probe(want + side * angle, reach);
        if (c >= reach) {
          this.dodgeSide = side;
          this.clear = reach;
          return side * angle;
        }
        if (c > bestClear) {
          bestClear = c;
          best = side * angle;
        }
      }
    }
    this.dodgeSide = best === 0 ? first : Math.sign(best);
    this.clear = bestClear;
    return best;
  }

  /** Vehicles do not collide with officers physically: get shoved out of the way of slow ones and hurt by fast ones. */
  private vehicleContact() {
    const { ctx } = this.host;
    const p = this.position;
    const all = ctx.vehicles.all;
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      const dx = p.x - v.position.x;
      const dz = p.z - v.position.z;
      const reach = v.spec.length * 0.5 + 0.7;
      if (dx * dx + dz * dz > reach * reach || Math.abs(p.y + 0.6 - v.position.y) > 2.2) continue;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      let lx = dx * cos - dz * sin; // across the car (+ = its left)
      let lz = dx * sin + dz * cos; // along the car (+ = its nose)
      const hw = v.spec.width / 2 + RADIUS;
      const hl = v.spec.length / 2 + RADIUS;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) continue;

      const d = Math.hypot(dx, dz) || 1;
      const closing = (v.velocity.x * dx + v.velocity.z * dz) / d;
      // (Colleagues' driving shoves but does not hurt: the pursuit should not mow down its own.)
      if (closing > TUNING.vehicleHitSpeed && this.hitCooldown <= 0 && v.controller !== 'police') {
        this.hitCooldown = 0.6;
        ctx.events.emit('vehicleHitActor', { actor: this, vehicle: v, speed: closing, under: false });
        this.takeDamage({ amount: (closing - 2.5) * TUNING.vehicleHitDamage, kind: 'vehicle', source: v.driver });
      }
      // Out through the nearest side; always sideways from a moving car, or its bumper would carry us along.
      if (Math.abs(v.speed) > 1 || hw - Math.abs(lx) < hl - Math.abs(lz)) lx = lx < 0 ? -hw : hw;
      else lz = lz < 0 ? -hl : hl;
      p.x = v.position.x + lx * cos + lz * sin;
      p.z = v.position.z - lx * sin + lz * cos;
      this.stale = true; // re-probe before the next step
      if (!this.alive) return;
    }
  }

  // ───────────── Weapons ─────────────

  private setDrawn(drawn: boolean) {
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    if (drawn) {
      this.weaponModel = this.host.borrowWeapon(this.weaponId);
      this.rig.setHeld(this.weaponModel);
    } else {
      this.rig.setHeld(null);
      if (this.weaponModel) this.host.returnWeapon(this.weaponId, this.weaponModel);
      this.weaponModel = null;
    }
  }

  /** Swap sidearm for shotgun (or back). Only between engagements. */
  rearm(weaponId: CopWeapon) {
    if (weaponId === this.weaponId) return;
    const drawn = this.drawn;
    this.setDrawn(false);
    this.weaponId = weaponId;
    this.setDrawn(drawn);
  }

  private fire(distance: number) {
    const { ctx, intel, rng } = this.host;
    const p = this.position;
    const m = this.rig.handPosition(this.muzzle);
    // Keep the muzzle believable, and clear of our own capsule.
    if (Math.hypot(m.x - p.x, m.z - p.z) > 1.4 || Math.abs(m.y - p.y - 1.3) > 0.9) m.set(p.x, p.y + 1.4, p.z);
    const dir = this.aimDir.subVectors(intel.aimPoint, m);
    const len = dir.length();
    if (len < 0.6) return;
    dir.multiplyScalar(1 / len);
    if (Math.hypot(m.x - p.x, m.z - p.z) < RADIUS + 0.2) m.addScaledVector(dir, 0.55);
    // Imperfect aim: worse at range and at a fast-moving target. Three uniforms make a passable bell curve.
    const sigma = aimError(this.weaponId, distance, intel.playerSpeed);
    const yaw = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * sigma;
    const pitch = (rng.next() + rng.next() + rng.next() - 1.5) * sigma;
    _r.set(dir.z, 0, -dir.x);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    dir.addScaledVector(_r, Math.tan(yaw));
    dir.y += Math.tan(pitch);
    dir.normalize();
    try {
      ctx.combat.fire(this, this.weaponId, m, dir);
    } catch {
      // The combat system is not ready for us; hold fire.
    }
  }
}
