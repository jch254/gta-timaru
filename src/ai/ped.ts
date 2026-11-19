import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createHumanoid } from '../actors/humanoid';
import { angleDiff, clamp, damp, dampAngle } from '../core/math';
import { CollisionGroup, type Actor, type ActorKind, type DamageInfo, type GameContext, type Humanoid, type HumanoidLook, type HumanoidPose, type PedHandle, type RoadEdge, type Vehicle, type WeaponSpec } from '../core/types';
import { makePoint, sampleEdge } from './lanes';
import type { BarkKind } from './looks';
import { PEDS } from './tuning';
import { choosePedMove, footpathInto, makeMove, walkTrim, walkable, type PedMove } from './walk';

export type Behaviour = 'wander' | 'stand' | 'flee' | 'attack' | 'follow';

/** What the pedestrian system provides to each pedestrian. */
export interface PedWorld {
  ctx: GameContext;
  rng: { next(): number; range(lo: number, hi: number): number; chance(p: number): boolean };
  /** Everyone, for keeping a little personal space. */
  peds: Ped[];
  frame: number;
  /** Say a line as a subtitle, at most one every few seconds across the whole population. */
  bark(ped: Ped, kind: BarkKind): boolean;
  /** A frightened shout (audio), rationed like the barks. */
  scream(ped: Ped): void;
  /** Is this point inside a marae's grounds (no fights or panics are started there)? */
  inMarae(x: number, z: number): boolean;
}

export interface PedSetup {
  x: number;
  z: number;
  heading: number;
  look: HumanoidLook;
  kind: ActorKind;
  name: string;
  health: number;
  behaviour: Behaviour;
  weaponId?: string;
  persistent: boolean;
  /** Part of the ambient population (spawned and despawned automatically). */
  ambient: boolean;
  /** A cameo: cannot be hurt, killed or knocked flat. What would have hurt them is passed to `onHit`. */
  invulnerable?: boolean;
  onHit?: (info: DamageInfo) => void;
  /** Start on this footpath rather than looking for one. */
  edge?: RoadEdge;
  side?: 1 | -1;
  s?: number;
  jitter?: number;
}

const FEET = PEDS.radius + PEDS.halfHeight;
/** A dead ped's weapon lies by the body this long (like a cash drop) before it fades. */
const GUN_DROP_SECONDS = 45;
const WALKABLE = (e: RoadEdge) => walkable(e);
const STREET = (e: RoadEdge) => e.drivable && e.footpaths;
const WALLS = { mask: CollisionGroup.World as number };
const _fp = makePoint();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = { x: 0, y: 0, z: 0 };
const _pose = { speed: 0, aimPitch: 0 };

/**
 * One pedestrian: an Actor with a kinematic capsule that is moved cheaply (no character controller).
 * Ambient ones stroll the footpaths; scripted ones stand, follow, flee, fight or run errands.
 */
export class Ped implements PedHandle {
  readonly group = new THREE.Group();
  /** World position of the feet (the vehicle's position while riding in one). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading: number;
  health: number;
  maxHealth: number;
  armour = 0;
  alive = true;
  vehicle: Vehicle | null = null;
  name?: string;
  readonly kind: ActorKind;

  // Read by the pedestrian system.
  readonly persistent: boolean;
  readonly ambient: boolean;
  removed = false;
  /** Seconds until a body is cleared away. */
  corpseTimer = 0;
  /** Stagger slot for the expensive, occasional checks. */
  readonly slot: number;
  /** Far from the camera: animate at a third of the rate. */
  far = false;
  hitCooldown = 0;
  lingerTime = 0;
  /** Seconds before this pedestrian has anything more to say to the player. */
  talkCooldown = 0;
  seatedIn: Vehicle | null = null;
  readonly female: boolean;
  /** A cameo character: nothing hurts them (see `takeDamage` and `struck`). */
  readonly invulnerable: boolean;

  private humanoid: Humanoid;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private groupsUp: number;
  private groupsDown: number;
  private behaviour: Behaviour;
  private targetActor: Actor | null = null;
  private targetPoint = false;
  private targetX = 0;
  private targetZ = 0;
  /** Ambient-style nerves; scripted characters keep to their script. */
  private reactive: boolean;
  private nerve: 'flee' | 'cower' | 'staunch';
  private react: 'none' | 'flee' | 'cower' | 'watch' | 'dodge' | 'down' = 'none';
  private reactTimer = 0;
  private threatActor: Actor | null = null;
  private threatX = 0;
  private threatZ = 0;
  private dodgeX = 0;
  private dodgeZ = 0;
  private resumeFlee = false;
  private frozenUntil = 0;
  private retaliating = 0;
  private walkSpeed: number;
  private runSpeed: number;
  // Footpath walking.
  private fpEdge: RoadEdge | null = null;
  private fpSide: 1 | -1 = 1;
  private fpDir: 1 | -1 = 1;
  private fpS = 0;
  private fpEnd = 0;
  private jitter: number;
  private step: 'walk' | 'pause' | 'shop' | 'wait' | 'cross' = 'walk';
  private stepTimer = 0;
  private strollTimer: number;
  private checkTimer = 0;
  private faceHeading = 0;
  private move: PedMove = makeMove();
  private noPathTimer = 0;
  private homeX: number;
  private homeZ: number;
  private roamX: number;
  private roamZ: number;
  private roamPause = 0;
  // Errands.
  private task: 'none' | 'goto' | 'enter' = 'none';
  private taskX = 0;
  private taskZ = 0;
  private taskRun = false;
  private taskTimer = 0;
  private taskResolve: ((ok: boolean) => void) | null = null;
  private taskVehicle: Vehicle | null = null;
  private taskSeat = 0;
  private pathBias = 0;
  private biasTimer = 0;
  private biasX = 0;
  private biasZ = 0;
  private seat = 0;
  private wantOut = false;
  // Fighting.
  private weaponId: string | null = null;
  private weapon: WeaponSpec | null = null;
  private fireTimer = 0.6;
  private punchTimer = 0.3;
  private losTimer = 0;
  private hasLos = false;
  private aimPitch = 0;
  private actionPose: HumanoidPose = 'idle';
  private actionTimer = 0;
  // Movement bookkeeping.
  private moved = 0;
  private onPath = false;
  private groundY: number;
  private groundTimer = 0;
  private lodTime = 0;
  private veer = 0;
  private whiskerTimer = 0;
  private sepX = 0;
  private sepZ = 0;
  private syncX = NaN;
  private syncY = NaN;
  private syncZ = NaN;
  private hitAndRunReported = false;
  private onHit: ((info: DamageInfo) => void) | null;
  /** Bundled aside by a vehicle: cars pass through the capsule until the sidestep is over. */
  private shoved = false;

  constructor(
    private world: PedWorld,
    readonly id: number,
    setup: PedSetup,
  ) {
    const { ctx, rng } = world;
    this.kind = setup.kind;
    this.female = !!setup.look.female;
    this.invulnerable = !!setup.invulnerable;
    this.onHit = setup.onHit ?? null;
    this.name = setup.name;
    this.health = this.maxHealth = setup.health;
    this.heading = setup.heading;
    this.persistent = setup.persistent;
    this.ambient = setup.ambient;
    this.behaviour = setup.behaviour;
    this.reactive = setup.ambient || (setup.kind === 'ped' && !setup.persistent);
    const nerve = rng.next();
    this.nerve = nerve < PEDS.staunchShare ? 'staunch' : nerve < PEDS.staunchShare + PEDS.cowerShare ? 'cower' : 'flee';
    const build = (setup.look.height ?? 1) * (setup.look.bulk && setup.look.bulk > 1.15 ? 0.92 : 1);
    this.walkSpeed = rng.range(PEDS.walk[0], PEDS.walk[1]) * clamp(build, 0.85, 1.05);
    this.runSpeed = rng.range(PEDS.run[0], PEDS.run[1]) * clamp(build, 0.85, 1.05);
    this.jitter = setup.jitter ?? rng.range(-1, 1);
    this.strollTimer = rng.range(PEDS.strollSeconds[0], PEDS.strollSeconds[1]) * rng.next();
    this.slot = Math.floor(rng.next() * 60);

    this.humanoid = createHumanoid(setup.look, ctx.gfx.materials);
    this.group.add(this.humanoid.group);
    ctx.scene.add(this.group);

    const y = ctx.world.groundAt(setup.x, setup.z);
    this.groundY = y;
    this.position.set(setup.x, y, setup.z);
    this.homeX = this.roamX = setup.x;
    this.homeZ = this.roamZ = setup.z;
    const R = ctx.physics.rapier;
    this.body = ctx.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(setup.x, y + FEET, setup.z));
    this.groupsUp = ctx.physics.groups(CollisionGroup.Character, CollisionGroup.World | CollisionGroup.Vehicle);
    this.groupsDown = ctx.physics.groups(CollisionGroup.Character, CollisionGroup.World);
    this.collider = ctx.physics.world.createCollider(R.ColliderDesc.capsule(PEDS.halfHeight, PEDS.radius).setCollisionGroups(this.groupsUp), this.body);
    ctx.physics.setOwner(this.collider, this);
    ctx.actors.all.add(this);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;

    if (setup.weaponId) this.arm(setup.weaponId);
    if (setup.edge) this.setFootpath(setup.edge, setup.side ?? 1, rng.chance(0.5) ? 1 : -1, setup.s ?? 0);
  }

  // ───────────── PedHandle ─────────────

  setBehaviour(behaviour: Behaviour, target?: Actor | { x: number; z: number }) {
    this.cancelTask();
    this.behaviour = behaviour;
    this.react = 'none';
    this.retaliating = 0;
    this.targetActor = null;
    this.targetPoint = false;
    if (target) {
      if ('takeDamage' in target) this.targetActor = target;
      else {
        this.targetPoint = true;
        this.targetX = target.x;
        this.targetZ = target.z;
      }
    }
    if (this.seatedIn) this.wantOut = true;
    if (behaviour === 'wander') {
      this.fpEdge = null;
      this.noPathTimer = 0;
      this.homeX = this.roamX = this.position.x;
      this.homeZ = this.roamZ = this.position.z;
    }
    if (behaviour === 'flee') {
      const from = this.targetActor ?? (this.targetPoint ? null : this.world.ctx.player);
      this.faceAway(from ? from.position.x : this.targetX, from ? from.position.z : this.targetZ);
    }
  }

  goTo(x: number, z: number, run = false): Promise<boolean> {
    this.cancelTask();
    if (!this.alive || this.removed) return Promise.resolve(false);
    if (this.seatedIn) this.wantOut = true;
    this.task = 'goto';
    this.taskX = x;
    this.taskZ = z;
    this.taskRun = run;
    const speed = run ? this.runSpeed : this.walkSpeed;
    this.taskTimer = (Math.hypot(x - this.position.x, z - this.position.z) / speed) * PEDS.goToSlack + PEDS.goToGrace;
    this.react = 'none';
    return new Promise<boolean>((resolve) => {
      this.taskResolve = resolve;
    });
  }

  say(text: string) {
    this.world.ctx.ui.subtitle(text, clamp(1.4 + text.length * 0.06, 2.5, 7), this.name);
  }

  enterVehicle(vehicle: Vehicle, seat = 0) {
    this.cancelTask();
    if (!this.alive || this.removed) return;
    if (this.seatedIn === vehicle && this.seat === seat) return;
    if (this.seatedIn) this.leaveVehicle();
    this.task = 'enter';
    this.taskVehicle = vehicle;
    this.taskSeat = seat;
    this.taskTimer = PEDS.enterTimeout;
    this.react = 'none';
  }

  gesture(pose: HumanoidPose, seconds: number, aimPitch = 0) {
    this.actionPose = pose;
    this.actionTimer = seconds;
    this.aimPitch = aimPitch;
  }

  /** Get out of whatever vehicle this pedestrian is riding in. */
  leaveVehicle() {
    if (!this.seatedIn) return;
    this.world.ctx.audio.play('doorOpen', { at: this.position });
    this.unseat(true);
  }

  remove() {
    this.dispose();
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive || this.removed) return;
    if (this.invulnerable) {
      // Nothing lands: no injury, no death, no event for the blood or the police to follow.
      this.onHit?.(info);
      return;
    }
    const { ctx } = this.world;
    let amount = info.amount;
    if (this.armour > 0 && info.kind !== 'fall' && info.kind !== 'drown') {
      const absorbed = Math.min(this.armour, amount * 0.75);
      this.armour -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    ctx.events.emit('actorDamaged', { actor: this, info });
    if (this.health <= 0) {
      this.die(info);
      return;
    }
    if (!this.reactive || this.seatedIn || info.kind === 'vehicle') return;
    const source = info.source;
    if (!source || source === this) return;
    if (info.kind === 'melee' && this.nerve === 'staunch' && !this.world.inMarae(this.position.x, this.position.z)) {
      // Staunch: gives as good as they get.
      if (this.behaviour !== 'attack') this.world.bark(this, 'fight');
      this.cancelTask();
      this.behaviour = 'attack';
      this.targetActor = source;
      this.targetPoint = false;
      this.react = 'none';
      this.retaliating = 25;
    } else if (this.react !== 'down') this.startFlee(source.position.x, source.position.z, source);
  }

  // ───────────── Called by the pedestrian system ─────────────

  /** Something frightening happened at (x, z). */
  alarm(x: number, z: number, source: Actor | null) {
    if (!this.reactive || !this.alive || this.seatedIn || this.react === 'down' || source === this) return;
    if (this.behaviour === 'attack' && this.retaliating <= 0) return;
    const d = Math.hypot(x - this.position.x, z - this.position.z);
    if (this.nerve === 'staunch' && d > PEDS.staunchGunRadius) {
      if (this.react === 'none' && this.behaviour !== 'attack') {
        this.react = 'watch';
        this.reactTimer = 4;
        this.threatX = x;
        this.threatZ = z;
      }
      return;
    }
    if (this.nerve === 'cower' && this.react !== 'flee') {
      if (this.react !== 'cower') this.world.bark(this, 'cower');
      this.react = 'cower';
      this.reactTimer = this.world.rng.range(PEDS.cowerSeconds[0], PEDS.cowerSeconds[1]);
      return;
    }
    this.startFlee(x, z, source);
  }

  /** Jump out of the way of a vehicle bearing down. `side` is which flank of its path we are on (+ = its left). */
  dodge(vehicle: Vehicle, side: number) {
    if (!this.alive || this.seatedIn || this.react === 'down' || this.react === 'dodge' || this.react === 'cower' || this.task === 'enter') return;
    if (this.behaviour === 'attack' && this.retaliating <= 0) return;
    // Not everybody sees it coming: one roll per approaching vehicle. (A cameo always does.)
    const now = this.world.ctx.clock.elapsed;
    if (now < this.frozenUntil) return;
    if (!this.invulnerable && !this.world.rng.chance(PEDS.dodgeChance)) {
      this.frozenUntil = now + 2.5;
      return;
    }
    this.resumeFlee = this.react === 'flee';
    const sin = Math.sin(vehicle.heading);
    const cos = Math.cos(vehicle.heading);
    const s = side !== 0 ? Math.sign(side) : this.slot % 2 === 0 ? 1 : -1;
    // Left of the vehicle's heading is (cos, −sin).
    this.dodgeX = cos * s;
    this.dodgeZ = -sin * s;
    this.react = 'dodge';
    this.reactTimer = 1.1;
  }

  /** Hit by a vehicle closing at `closing` m/s. */
  struck(vehicle: Vehicle, closing: number) {
    const { ctx, rng } = this.world;
    this.hitCooldown = 0.8;
    const driver = vehicle.driver;
    // Thrown along with the car and a little aside.
    const dx = this.position.x - vehicle.position.x;
    const dz = this.position.z - vehicle.position.z;
    const side = dx * Math.cos(vehicle.heading) - dz * Math.sin(vehicle.heading) >= 0 ? 1 : -1;
    if (this.invulnerable) {
      // A cameo is bundled out of the way, unhurt: no knock-down, no injury, nothing for the police.
      this.dodgeX = Math.cos(vehicle.heading) * side;
      this.dodgeZ = -Math.sin(vehicle.heading) * side;
      this.resumeFlee = false;
      this.react = 'dodge';
      this.reactTimer = 0.9;
      this.shoved = true;
      this.collider.setCollisionGroups(this.groupsDown);
      this.onHit?.({ amount: 0, kind: 'vehicle', source: driver ?? null });
      return;
    }
    this.velocity.set(vehicle.velocity.x * 0.55 + Math.cos(vehicle.heading) * side * 1.6, 0, vehicle.velocity.z * 0.55 - Math.sin(vehicle.heading) * side * 1.6);
    this.react = 'down';
    this.reactTimer = rng.range(PEDS.downSeconds[0], PEDS.downSeconds[1]);
    this.threatActor = null;
    this.threatX = vehicle.position.x;
    this.threatZ = vehicle.position.z;
    // Lying down: cars pass over rather than hitting an upright post.
    this.collider.setCollisionGroups(this.groupsDown);
    ctx.audio.play('bodyHit', { at: this.position });
    if (driver && driver === ctx.player && !this.hitAndRunReported) {
      this.hitAndRunReported = true;
      ctx.events.emit('crime', { type: 'hitAndRun', position: this.position.clone(), offender: ctx.player, victim: this });
    }
    this.takeDamage({ amount: (closing - PEDS.hitDamageFrom) * PEDS.hitDamageScale, kind: 'vehicle', source: driver ?? null });
  }

  /** Stop for a moment and look at something (small talk, being bumped). */
  pauseToFace(x: number, z: number, seconds: number) {
    if (this.react !== 'none' || this.task !== 'none' || this.behaviour !== 'wander') return;
    const face = Math.atan2(x - this.position.x, z - this.position.z);
    if (!this.fpEdge) {
      this.roamPause = seconds;
      this.heading = face;
      return;
    }
    if (this.step === 'cross' || this.step === 'wait') return;
    this.step = 'shop';
    this.stepTimer = seconds;
    this.faceHeading = face;
  }

  /** Calm and going about their business (fair game for small talk). */
  get calm(): boolean {
    return this.alive && this.react === 'none' && !this.seatedIn && this.behaviour !== 'attack' && this.behaviour !== 'flee';
  }

  /** An ordinary passer-by with time for a word. */
  get chatty(): boolean {
    return this.reactive && this.calm && this.behaviour === 'wander' && this.task === 'none' && this.talkCooldown <= 0;
  }

  /** On their feet (not knocked flat). */
  get standing(): boolean {
    return this.react !== 'down';
  }

  dispose() {
    if (this.removed) return;
    const { ctx } = this.world;
    this.removed = true;
    this.cancelTask();
    if (this.seatedIn) {
      if (this.vehicle === this.seatedIn) ctx.vehicles.exit(this);
      this.seatedIn = null;
      this.vehicle = null;
    }
    ctx.actors.all.delete(this);
    ctx.physics.setOwner(this.collider, null);
    ctx.physics.world.removeRigidBody(this.body);
    this.humanoid.setHeld(null);
    this.humanoid.dispose();
    this.group.removeFromParent();
  }

  // ───────────── Frame ─────────────

  update(dt: number) {
    if (this.removed) return;
    if (!this.alive) {
      this.corpseTimer -= dt;
      this.animate('dead', dt);
      return;
    }
    if (this.seatedIn) {
      this.updateSeated(dt);
      return;
    }
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    if (this.talkCooldown > 0) this.talkCooldown -= dt;
    this.moved = 0;
    this.onPath = false;
    let pose: HumanoidPose = 'idle';

    if (this.react === 'down') {
      // Sliding to rest after being hit.
      const keep = Math.exp(-3.5 * dt);
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
      this.velocity.x *= keep;
      this.velocity.z *= keep;
      this.reactTimer -= dt;
      pose = 'dead';
      if (this.reactTimer <= 0) this.getUp();
    } else {
      this.velocity.set(0, 0, 0);
      if ((this.world.frame + this.slot) % 8 === 0) this.personalSpace();
      switch (this.react) {
        case 'cower':
          pose = 'cower';
          this.reactTimer -= dt;
          if (this.reactTimer <= 0) this.react = 'none';
          break;
        case 'watch':
          this.heading = dampAngle(this.heading, Math.atan2(this.threatX - this.position.x, this.threatZ - this.position.z), 6, dt);
          this.reactTimer -= dt;
          if (this.reactTimer <= 0) this.react = 'none';
          break;
        case 'dodge':
          // (Someone being shoved aside is already against the car: they step clear of it, not round it.)
          this.stepToward(this.position.x + this.dodgeX * 6, this.position.z + this.dodgeZ * 6, this.runSpeed, dt, true, !this.shoved);
          this.reactTimer -= dt;
          if (this.reactTimer <= 0) {
            if (this.shoved) {
              // Solid again only once clear of the car that did the shoving.
              if (this.carAt(this.position.x, this.position.z, null)) {
                this.reactTimer = 0.3;
                break;
              }
              this.shoved = false;
              this.collider.setCollisionGroups(this.groupsUp);
            }
            this.react = this.resumeFlee ? 'flee' : 'none';
            this.reactTimer = this.resumeFlee ? 8 : 0;
          }
          break;
        case 'flee':
          this.flee(dt);
          this.reactTimer -= dt;
          if (this.reactTimer <= 0 && Math.hypot(this.threatX - this.position.x, this.threatZ - this.position.z) > 28) this.react = 'none';
          break;
        default:
          if (this.task === 'goto') this.runGoTo(dt);
          else if (this.task === 'enter') this.runEnter(dt);
          else if (this.behaviour === 'wander') this.stroll(dt, this.walkSpeed, false);
          else if (this.behaviour === 'attack') pose = this.attack(dt);
          else if (this.behaviour === 'follow') this.follow(dt);
          else if (this.behaviour === 'flee') this.fleeFromTarget(dt);
      }
      if (this.seatedIn) return;
    }

    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      pose = this.actionPose;
    } else if (pose === 'idle') pose = this.moved > 3 ? 'run' : this.moved > 0.25 ? 'walk' : 'idle';
    this.settle(dt);
    this.animate(pose, dt);
  }

  /** Height, visuals and the physics capsule. */
  private settle(dt: number) {
    const { ctx } = this.world;
    const p = this.position;
    if (!this.onPath) {
      this.groundTimer -= dt;
      if (this.groundTimer <= 0) {
        this.groundTimer = this.moved > 3 || this.react === 'down' ? 0.07 : 0.2;
        this.groundY = ctx.world.groundAt(p.x, p.z);
      }
    }
    p.y = Math.abs(this.groundY - p.y) > 1.5 ? this.groundY : damp(p.y, this.groundY, 16, dt);
    const b = ctx.world.bounds;
    p.x = clamp(p.x, b.minX + 6, b.maxX - 6);
    p.z = clamp(p.z, b.minZ + 6, b.maxZ - 6);
    this.group.position.copy(p);
    this.group.rotation.y = this.heading;
    if (Math.abs(p.x - this.syncX) + Math.abs(p.y - this.syncY) + Math.abs(p.z - this.syncZ) > 0.004 || this.syncX !== this.syncX) {
      this.syncX = _t.x = p.x;
      this.syncY = p.y;
      this.syncZ = _t.z = p.z;
      _t.y = p.y + FEET;
      this.body.setNextKinematicTranslation(_t);
    }
  }

  private animate(pose: HumanoidPose, dt: number) {
    _pose.speed = this.moved;
    _pose.aimPitch = this.aimPitch;
    this.humanoid.setPose(pose, _pose);
    if (!this.far) {
      this.humanoid.update(dt);
      return;
    }
    this.lodTime += dt;
    if ((this.world.frame + this.slot) % 3 !== 0) return;
    this.humanoid.update(this.lodTime);
    this.lodTime = 0;
  }

  // ───────────── Moving ─────────────

  /**
   * Walk towards a point at `speed`. `walls` steers round buildings with an occasional feeler ray;
   * `cars` refuses to walk into the side of a vehicle. Returns the distance still to go.
   */
  private stepToward(tx: number, tz: number, speed: number, dt: number, walls: boolean, cars: boolean, ignore: Vehicle | null = null): number {
    const p = this.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return 0;
    let hx = dx / d;
    let hz = dz / d;
    if (walls) {
      this.whiskerTimer -= dt;
      if (this.whiskerTimer <= 0) {
        this.whiskerTimer = 0.22;
        this.veer = this.probe(hx, hz, speed);
      }
      if (this.veer !== 0) {
        const c = Math.cos(this.veer);
        const s = Math.sin(this.veer);
        const rx = hx * c + hz * s;
        hz = hz * c - hx * s;
        hx = rx;
      }
    }
    const stride = Math.min(speed * dt, d);
    let nx = p.x + hx * stride + this.sepX * dt;
    let nz = p.z + hz * stride + this.sepZ * dt;
    if (cars && this.carAt(nx, nz, ignore)) {
      // Slide along rather than through: try a sidestep, else wait.
      const side = this.slot % 2 === 0 ? 1 : -1;
      nx = p.x + hz * stride * side;
      nz = p.z - hx * stride * side;
      if (this.carAt(nx, nz, ignore)) return d;
    }
    p.x = nx;
    p.z = nz;
    this.velocity.set(hx * speed, 0, hz * speed);
    this.heading = dampAngle(this.heading, Math.atan2(hx, hz), 10, dt);
    this.moved = speed;
    return d - stride;
  }

  /** Feel for a wall ahead; returns how far to turn (radians, + = left) to get round it. */
  private probe(hx: number, hz: number, speed: number): number {
    const { ctx } = this.world;
    const reach = 1.3 + speed * 0.3;
    _o.set(this.position.x, this.position.y + 0.7, this.position.z);
    _d.set(hx, 0, hz);
    if (!ctx.physics.raycast(_o, _d, reach, WALLS)) return 0;
    const first = this.slot % 2 === 0 ? 0.95 : -0.95;
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? first : -first;
      _d.set(hx * Math.cos(a) + hz * Math.sin(a), 0, hz * Math.cos(a) - hx * Math.sin(a));
      if (!ctx.physics.raycast(_o, _d, reach, WALLS)) return a;
    }
    return first > 0 ? 2.3 : -2.3;
  }

  /** Would standing at (x, z) be inside a vehicle? */
  private carAt(x: number, z: number, ignore: Vehicle | null): boolean {
    const all = this.world.ctx.vehicles.all;
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      if (v === ignore) continue;
      const dx = x - v.position.x;
      const dz = z - v.position.z;
      const reach = v.spec.length / 2 + 0.6;
      if (dx * dx + dz * dz > reach * reach || Math.abs(v.position.y - this.position.y) > 2.5) continue;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      if (Math.abs(dx * sin + dz * cos) < v.spec.length / 2 + 0.35 && Math.abs(dx * cos - dz * sin) < v.spec.width / 2 + 0.35) return true;
    }
    return false;
  }

  /** A gentle push away from whoever is closest, refreshed now and then. */
  private personalSpace() {
    this.sepX = this.sepZ = 0;
    const p = this.position;
    let best = 0.9 * 0.9;
    let ox = 0;
    let oz = 0;
    const peds = this.world.peds;
    for (let i = 0; i < peds.length; i++) {
      const o = peds[i];
      if (o === this || !o.alive || o.seatedIn) continue;
      const dx = p.x - o.position.x;
      const dz = p.z - o.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best && d2 > 1e-4) {
        best = d2;
        ox = dx;
        oz = dz;
      }
    }
    const player = this.world.ctx.player;
    if (!player.vehicle) {
      const dx = p.x - player.position.x;
      const dz = p.z - player.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best && d2 > 1e-4) {
        best = d2;
        ox = dx;
        oz = dz;
      }
    }
    if (ox !== 0 || oz !== 0) {
      const d = Math.sqrt(best);
      this.sepX = (ox / d) * 0.8;
      this.sepZ = (oz / d) * 0.8;
    }
  }

  // ───────────── Footpaths ─────────────

  private setFootpath(edge: RoadEdge, side: 1 | -1, dir: 1 | -1, s: number) {
    const graph = this.world.ctx.world.graph;
    this.fpEdge = edge;
    this.fpSide = side;
    this.fpDir = dir;
    const trimA = walkTrim(graph, edge, edge.a);
    const trimB = walkTrim(graph, edge, edge.b);
    this.fpS = clamp(s, trimA, edge.length - trimB);
    this.fpEnd = dir === 1 ? edge.length - trimB : trimA;
    this.step = 'walk';
  }

  private findFootpath(): boolean {
    const { ctx, rng } = this.world;
    const hit = ctx.world.graph.nearest(this.position.x, this.position.z, 45, WALKABLE);
    if (!hit) return false;
    this.setFootpath(hit.edge, hit.offset >= 0 ? 1 : -1, rng.chance(0.5) ? 1 : -1, hit.s);
    return true;
  }

  /** Stroll (or run) along the footpath network: walk, pause, window-shop, wait at the kerb, cross. */
  private stroll(dt: number, speed: number, fleeing: boolean) {
    if (!this.fpEdge) {
      this.noPathTimer -= dt;
      if (this.noPathTimer > 0 || !this.findFootpath()) {
        if (this.noPathTimer <= 0) this.noPathTimer = 6;
        this.roam(dt, speed, fleeing);
        return;
      }
    }
    const edge = this.fpEdge!;
    const p = this.position;
    switch (this.step) {
      case 'pause':
      case 'shop':
        this.stepTimer -= dt;
        if (this.step === 'shop') this.heading = dampAngle(this.heading, this.faceHeading, 6, dt);
        if (this.stepTimer <= 0 || fleeing) this.step = 'walk';
        return;
      case 'wait':
        this.heading = dampAngle(this.heading, this.faceHeading, 6, dt);
        this.stepTimer -= dt;
        this.checkTimer -= dt;
        if (fleeing || this.stepTimer <= 0) this.step = 'cross';
        else if (this.checkTimer <= 0) {
          this.checkTimer = 0.3;
          if (this.roadClear()) this.step = 'cross';
        }
        return;
      case 'cross':
        if (this.stepToward(this.move.x, this.move.z, fleeing ? speed : Math.max(PEDS.crossSpeed, speed), dt, false, true) < 0.5) {
          this.setFootpath(this.move.edge, this.move.side, this.move.dir, this.move.s);
        }
        return;
      default: {
        // Follow a carrot that keeps a couple of metres ahead along the footpath.
        footpathInto(edge, this.fpS, this.fpSide, this.jitter, _fp);
        const d = Math.hypot(_fp.x - p.x, _fp.z - p.z);
        const atEnd = this.fpS === this.fpEnd;
        if (!atEnd && d < 2.2) {
          this.fpS += this.fpDir * speed * 1.6 * dt;
          if (this.fpDir === 1 ? this.fpS > this.fpEnd : this.fpS < this.fpEnd) this.fpS = this.fpEnd;
        }
        if (atEnd && d < 0.8) {
          this.atCorner(fleeing);
          return;
        }
        if (d < 3) {
          this.onPath = true;
          this.groundY = _fp.y + 0.05;
        }
        const tx = _fp.tx;
        const tz = _fp.tz;
        this.stepToward(_fp.x, _fp.z, speed, dt, false, false);
        if (!fleeing) {
          this.strollTimer -= dt;
          if (this.strollTimer <= 0) this.takeBreak(tx, tz);
        }
      }
    }
  }

  /** End of this stretch of footpath: round the corner, across a road, or back again. */
  private atCorner(fleeing: boolean) {
    const { ctx, rng } = this.world;
    const edge = this.fpEdge!;
    const p = this.position;
    const node = this.fpDir === 1 ? edge.b : edge.a;
    let ax = 0;
    let az = 0;
    if (fleeing) {
      ax = p.x - this.threatX;
      az = p.z - this.threatZ;
    }
    const found = choosePedMove(ctx.world.graph, edge, this.fpSide, node, p.x, p.z, this.jitter, rng, fleeing ? 1 : PEDS.crossChance, fleeing ? 0.02 : PEDS.uTurnChance, ax, az, this.move);
    if (!found) {
      this.setFootpath(edge, this.fpSide, this.fpDir === 1 ? -1 : 1, this.fpS);
      return;
    }
    const m = this.move;
    if (m.crossing) {
      this.faceHeading = Math.atan2(m.x - p.x, m.z - p.z);
      if (fleeing) this.step = 'cross';
      else {
        this.step = 'wait';
        this.stepTimer = rng.range(PEDS.crossWaitMax[0], PEDS.crossWaitMax[1]);
        this.checkTimer = rng.range(0.2, 0.9);
      }
      return;
    }
    this.setFootpath(m.edge, m.side, m.dir, m.s);
  }

  /** Nothing coming? (No moving vehicle heading for the stretch of road we are about to cross.) */
  private roadClear(): boolean {
    const p = this.position;
    const mx = (p.x + this.move.x) / 2;
    const mz = (p.z + this.move.z) / 2;
    const all = this.world.ctx.vehicles.all;
    const r2 = PEDS.crossClearRadius * PEDS.crossClearRadius;
    for (let i = 0; i < all.length; i++) {
      const v = all[i];
      const speed2 = v.velocity.x * v.velocity.x + v.velocity.z * v.velocity.z;
      if (speed2 < 4) continue;
      const dx = mx - v.position.x;
      const dz = mz - v.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 * Math.max(1, speed2 / 150)) continue;
      if (v.velocity.x * dx + v.velocity.z * dz > 0) return false;
    }
    return true;
  }

  private takeBreak(tx: number, tz: number) {
    const { ctx, rng } = this.world;
    this.strollTimer = rng.range(PEDS.strollSeconds[0], PEDS.strollSeconds[1]);
    const type = ctx.world.districtAt(this.position.x, this.position.z).type;
    if ((type === 'cbd' || type === 'shops' || type === 'township') && rng.chance(0.55)) {
      // Window shopping: turn to the buildings, away from the road.
      this.step = 'shop';
      this.stepTimer = rng.range(PEDS.windowShopSeconds[0], PEDS.windowShopSeconds[1]);
      this.faceHeading = Math.atan2(tz * this.fpSide, -tx * this.fpSide);
    } else {
      this.step = 'pause';
      this.stepTimer = rng.range(PEDS.pauseSeconds[0], PEDS.pauseSeconds[1]);
    }
  }

  /** No footpath in reach: potter about near where we started (or, fleeing, just run). */
  private roam(dt: number, speed: number, fleeing: boolean) {
    const { rng } = this.world;
    if (fleeing) {
      this.runFrom(this.threatX, this.threatZ, speed, dt);
      return;
    }
    if (this.roamPause > 0) {
      this.roamPause -= dt;
      return;
    }
    if (this.stepToward(this.roamX, this.roamZ, speed, dt, true, true) < 0.6 || (this.strollTimer -= dt) <= 0) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(4, 12);
      this.roamX = this.homeX + Math.sin(a) * r;
      this.roamZ = this.homeZ + Math.cos(a) * r;
      this.roamPause = rng.range(PEDS.pauseSeconds[0], PEDS.pauseSeconds[1]);
      this.strollTimer = 14;
    }
  }

  // ───────────── Fear ─────────────

  private startFlee(x: number, z: number, source: Actor | null) {
    const { rng } = this.world;
    const fresh = this.react !== 'flee';
    this.threatX = x;
    this.threatZ = z;
    this.threatActor = source;
    this.react = 'flee';
    this.reactTimer = rng.range(PEDS.fleeSeconds[0], PEDS.fleeSeconds[1]);
    if (this.retaliating > 0) this.standDown();
    if (fresh) {
      if (!this.world.bark(this, 'flee') && rng.chance(0.35)) this.world.scream(this);
      this.faceAway(x, z);
    }
  }

  /** Point ourselves along the footpath in whichever direction leads away from the threat. */
  private faceAway(x: number, z: number) {
    const edge = this.fpEdge;
    if (!edge || this.step === 'cross') return;
    const p = this.position;
    sampleEdge(edge, this.fpS, _fp);
    const dir = _fp.tx * (p.x - x) + _fp.tz * (p.z - z) >= 0 ? 1 : -1;
    this.setFootpath(edge, this.fpSide, dir, this.fpS);
  }

  private flee(dt: number) {
    if (this.threatActor) {
      this.threatX = this.threatActor.position.x;
      this.threatZ = this.threatActor.position.z;
    }
    if (this.fpEdge) this.stroll(dt, this.runSpeed, true);
    else this.runFrom(this.threatX, this.threatZ, this.runSpeed, dt);
  }

  /** Scripted 'flee': keep away from the target (the player by default) until well clear. */
  private fleeFromTarget(dt: number) {
    const target = this.targetActor ?? (this.targetPoint ? null : this.world.ctx.player);
    this.threatActor = target;
    if (!target) {
      this.threatX = this.targetX;
      this.threatZ = this.targetZ;
    } else {
      this.threatX = target.position.x;
      this.threatZ = target.position.z;
    }
    if (Math.hypot(this.threatX - this.position.x, this.threatZ - this.position.z) > 70) {
      // Well clear. Ordinary people calm down and carry on; scripted ones wait for their next instruction.
      if (this.reactive) {
        this.behaviour = 'wander';
        this.fpEdge = null;
        this.noPathTimer = 0;
        this.homeX = this.roamX = this.position.x;
        this.homeZ = this.roamZ = this.position.z;
      }
      return;
    }
    this.flee(dt);
  }

  private runFrom(x: number, z: number, speed: number, dt: number) {
    const p = this.position;
    let ax = p.x - x;
    let az = p.z - z;
    const d = Math.hypot(ax, az);
    if (d < 0.01) {
      ax = Math.sin(this.heading);
      az = Math.cos(this.heading);
    } else {
      ax /= d;
      az /= d;
    }
    this.stepToward(p.x + ax * 8, p.z + az * 8, speed, dt, true, true);
  }

  private getUp() {
    this.react = 'none';
    this.velocity.set(0, 0, 0);
    this.collider.setCollisionGroups(this.groupsUp);
    if (!this.reactive) return;
    this.world.bark(this, 'hit');
    this.startFlee(this.threatX, this.threatZ, null);
  }

  private die(info: DamageInfo) {
    const { ctx } = this.world;
    this.alive = false;
    this.health = 0;
    if (this.seatedIn) this.unseat(true);
    this.cancelTask();
    this.react = 'none';
    this.velocity.set(0, 0, 0);
    this.moved = 0;
    this.collider.setEnabled(false);
    ctx.actors.all.delete(this);
    this.corpseTimer = PEDS.corpseSeconds;
    this.humanoid.setPose('dead');
    this.dropWeapon();
    ctx.events.emit('actorDied', { actor: this, info });
  }

  /** Whatever they were armed with is left by the body for anyone quick enough to take it. */
  private dropWeapon() {
    const weapon = this.weapon;
    if (!weapon || !this.weaponId || weapon.kind === 'fists') return;
    const { ctx, rng } = this.world;
    const x = this.position.x + rng.range(-0.45, 0.45);
    const z = this.position.z + rng.range(-0.45, 0.45);
    if (ctx.world.waterDepthAt(x, z) > 0.2) return;
    // A few rounds left in it; a melee weapon carries none.
    const ammo = weapon.kind === 'melee' ? 0 : weapon.kind === 'shotgun' || weapon.kind === 'rifle' ? Math.floor(rng.range(3, 6)) : Math.floor(rng.range(6, 11));
    try {
      ctx.combat.spawnPickup(this.weaponId, x, z, ammo, 0, { ttl: GUN_DROP_SECONDS, drop: true });
    } catch {
      // Combat unavailable (stub): the weapon vanishes with its owner.
    }
  }

  // ───────────── Errands ─────────────

  private cancelTask() {
    const resolve = this.taskResolve;
    this.task = 'none';
    this.taskResolve = null;
    this.taskVehicle = null;
    if (resolve) resolve(false);
  }

  private runGoTo(dt: number) {
    const { ctx } = this.world;
    const p = this.position;
    const speed = this.taskRun ? this.runSpeed : this.walkSpeed;
    const dx = this.taskX - p.x;
    const dz = this.taskZ - p.z;
    const d = Math.hypot(dx, dz);
    this.taskTimer -= dt;
    if (d < 0.7 || this.taskTimer <= 0) {
      const resolve = this.taskResolve;
      this.task = 'none';
      this.taskResolve = null;
      // Stay put on arrival unless told to tag along or fight.
      if (this.behaviour === 'wander' || this.behaviour === 'flee') this.behaviour = 'stand';
      if (resolve) resolve(d < 0.7);
      return;
    }
    // Footpath preference: when walking along a street's carriageway, drift over to the nearer footpath.
    this.biasTimer -= dt;
    if (this.biasTimer <= 0) {
      this.biasTimer = 1;
      this.pathBias = 0;
      if (d > 12) {
        const hit = ctx.world.graph.nearest(p.x, p.z, 14, STREET);
        if (hit && hit.distance < hit.edge.width / 2 + 0.6) {
          sampleEdge(hit.edge, hit.s, _fp);
          if (Math.abs(_fp.tx * dx + _fp.tz * dz) / d > 0.75) this.pathBias = hit.offset >= 0 ? 1 : -1;
          if (this.pathBias !== 0) {
            // Remember which way "towards that kerb" is in world terms.
            this.biasX = _fp.tz * this.pathBias;
            this.biasZ = -_fp.tx * this.pathBias;
          }
        }
      }
    }
    if (this.pathBias !== 0) this.stepToward(p.x + (dx / d) * 5 + this.biasX * 3.5, p.z + (dz / d) * 5 + this.biasZ * 3.5, speed, dt, true, true);
    else this.stepToward(this.taskX, this.taskZ, speed, dt, true, true);
  }

  private runEnter(dt: number) {
    const { ctx } = this.world;
    const vehicle = this.taskVehicle;
    if (!vehicle || vehicle.destroyed || ctx.vehicles.all.indexOf(vehicle) < 0) {
      this.cancelTask();
      return;
    }
    vehicle.doorPosition(_o, this.taskSeat);
    const d = Math.hypot(_o.x - this.position.x, _o.z - this.position.z);
    this.taskTimer -= dt;
    if (d < 0.85 || (this.taskTimer <= 0 && d < 30)) {
      this.task = 'none';
      this.taskVehicle = null;
      this.sit(vehicle, this.taskSeat);
      return;
    }
    if (this.taskTimer <= 0) {
      this.cancelTask();
      return;
    }
    this.stepToward(_o.x, _o.z, d > 5 ? this.runSpeed : this.walkSpeed * 1.3, dt, d > 4, true, vehicle);
  }

  private sit(vehicle: Vehicle, seat: number) {
    const { ctx } = this.world;
    ctx.vehicles.enter(this, vehicle, seat);
    this.seatedIn = vehicle;
    this.seat = seat;
    this.wantOut = false;
    this.collider.setEnabled(false);
    vehicle.group.updateMatrixWorld();
    vehicle.group.worldToLocal(vehicle.seatPosition(_o, seat));
    vehicle.group.add(this.group);
    this.group.position.copy(_o);
    this.group.rotation.set(0, 0, 0);
    // The glass is clear: whoever is in the car is seen in it.
    this.group.visible = true;
    this.velocity.set(0, 0, 0);
    this.moved = 0;
    ctx.audio.play('doorClose', { at: vehicle.position });
  }

  private updateSeated(dt: number) {
    const vehicle = this.seatedIn!;
    // Thrown out by a hijacker, or the vehicle was removed under us.
    if (this.vehicle !== vehicle) {
      this.unseat(false);
      return;
    }
    this.position.copy(vehicle.position);
    this.velocity.copy(vehicle.velocity);
    this.heading = vehicle.heading;
    if (this.wantOut && Math.abs(vehicle.speed) < 7) {
      this.leaveVehicle();
      return;
    }
    if (!this.group.visible) return;
    this.humanoid.setPose(vehicle.spec.cls === 'bike' ? 'ride' : this.seat === 0 ? 'drive' : 'sit');
    this.humanoid.update(dt);
  }

  /** Back on the street beside the door. */
  private unseat(exit: boolean) {
    const { ctx } = this.world;
    const vehicle = this.seatedIn;
    if (!vehicle) return;
    this.seatedIn = null;
    this.wantOut = false;
    vehicle.doorPosition(_o, this.seat);
    const heading = vehicle.heading;
    if (exit && this.vehicle === vehicle) ctx.vehicles.exit(this);
    this.vehicle = null;
    ctx.scene.add(this.group);
    this.group.visible = true;
    this.collider.setEnabled(this.alive);
    this.groundY = ctx.world.groundAt(_o.x, _o.z);
    this.position.set(_o.x, this.groundY, _o.z);
    this.heading = heading;
    this.group.position.copy(this.position);
    this.group.rotation.set(0, heading, 0);
    this.syncX = NaN;
    this.homeX = this.roamX = _o.x;
    this.homeZ = this.roamZ = _o.z;
    this.fpEdge = null;
    this.noPathTimer = 0;
  }

  // ───────────── Fighting ─────────────

  private arm(weaponId: string) {
    const { ctx } = this.world;
    this.weaponId = weaponId;
    this.weapon = ctx.combat.weapons.get(weaponId) ?? null;
    this.humanoid.setHeld(ctx.combat.createWeaponModel(weaponId));
  }

  private follow(dt: number) {
    const target = this.targetActor ?? (this.targetPoint ? null : this.world.ctx.player);
    const tx = target ? target.position.x : this.targetX;
    const tz = target ? target.position.z : this.targetZ;
    const d = Math.hypot(tx - this.position.x, tz - this.position.z);
    // Keep up: stroll when close, break into a run as the gap opens.
    if (d > 2.6) this.stepToward(tx, tz, clamp(this.walkSpeed + (d - 2.6) * 1.2, this.walkSpeed, this.runSpeed), dt, true, true, target ? target.vehicle : null);
  }

  /** Hostile: close to weapon range with a clear line, then shoot; or wade in with fists. */
  private attack(dt: number): HumanoidPose {
    const { ctx, rng } = this.world;
    const target = this.targetActor ?? ctx.player;
    const p = this.position;
    const tp = target.position;
    const dx = tp.x - p.x;
    const dz = tp.z - p.z;
    const d = Math.hypot(dx, dz);
    if (!target.alive || (this.retaliating > 0 && ((this.retaliating -= dt) <= 0 || d > 45))) {
      this.standDown();
      return 'idle';
    }
    const weapon = this.weapon;
    const face = Math.atan2(dx, dz);
    if (weapon && this.weaponId && weapon.kind !== 'fists' && weapon.kind !== 'melee') {
      const range = Math.min(weapon.range * 0.7, PEDS.engageRange);
      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = 0.3;
        _o.set(p.x, p.y + 1.5, p.z);
        _d.set(tp.x, tp.y + (target.vehicle ? 0.5 : 1.2), tp.z);
        this.hasLos = ctx.physics.lineOfSight(_o, _d);
      }
      if (d > range || !this.hasLos) {
        this.stepToward(tp.x, tp.z, d > range + 8 ? this.runSpeed : this.walkSpeed * 1.4, dt, true, true);
        return 'idle';
      }
      // In range with a clear shot: stand and fire at a human rate.
      this.heading = dampAngle(this.heading, face, 12, dt);
      this.aimPitch = clamp(-Math.atan2(tp.y + (target.vehicle ? 0.4 : 1.1) - (p.y + 1.4), d), -0.6, 0.6);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && Math.abs(angleDiff(face, this.heading)) < 0.3) {
        this.fireTimer = clamp((1 / Math.max(0.2, weapon.rate)) * rng.range(PEDS.fireSlowdown[0], PEDS.fireSlowdown[1]), PEDS.fireMin, PEDS.fireMax);
        this.shoot(target, d);
      }
      return weapon.kind === 'pistol' ? 'aim' : 'aimRifle';
    }
    // Fists (or a bat).
    const reach = weapon && weapon.kind === 'melee' ? Math.max(PEDS.punchReach, weapon.range) : PEDS.punchReach;
    const stand = target.vehicle ? target.vehicle.spec.width / 2 + 0.9 : reach * 0.75;
    if (d > stand) {
      this.stepToward(tp.x, tp.z, d > 3.5 ? this.runSpeed : this.walkSpeed * 1.4, dt, true, true, target.vehicle);
      return 'idle';
    }
    this.heading = dampAngle(this.heading, face, 14, dt);
    this.punchTimer -= dt;
    if (this.punchTimer <= 0) {
      this.punchTimer = rng.range(PEDS.punchCooldown[0], PEDS.punchCooldown[1]);
      this.actionPose = 'punch';
      this.actionTimer = 0.4;
      // The swing lands in front of the attacker, so square up first.
      this.heading = face;
      this.group.rotation.y = face;
      ctx.combat.melee(this, weapon && weapon.kind === 'melee' ? weapon.damage * PEDS.meleeScale : PEDS.punchDamage, reach + (target.vehicle ? 0.8 : 0));
    }
    return 'idle';
  }

  private shoot(target: Actor, distance: number) {
    const { ctx, rng } = this.world;
    const p = this.position;
    const tp = target.position;
    _o.set(p.x + Math.sin(this.heading) * 0.45, p.y + 1.42, p.z + Math.cos(this.heading) * 0.45);
    _d.set(tp.x, tp.y + (target.vehicle ? 0.4 : 1.1), tp.z).sub(_o).normalize();
    // Human aim: worse at range and against a moving target.
    const error = PEDS.aimError + distance * PEDS.aimErrorPerMetre + target.velocity.length() * PEDS.aimErrorPerSpeed;
    const yaw = (rng.next() + rng.next() - 1) * error * 1.4;
    const pitch = (rng.next() + rng.next() - 1) * error * 0.7;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const x = _d.x * c + _d.z * s;
    _d.z = _d.z * c - _d.x * s;
    _d.x = x;
    _d.y += pitch;
    _d.normalize();
    ctx.combat.fire(this, this.weaponId!, _o, _d);
  }

  /** The fight is over: back to ordinary life. */
  private standDown() {
    this.retaliating = 0;
    this.aimPitch = 0;
    if (this.reactive) {
      this.behaviour = 'wander';
      this.fpEdge = null;
      this.noPathTimer = 0;
    } else this.behaviour = 'stand';
  }
}
