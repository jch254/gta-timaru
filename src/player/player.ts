import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createHumanoid } from '../actors/humanoid';
import { clamp, damp, dampAngle } from '../core/math';
import { CollisionGroup, type DamageInfo, type GameContext, type Humanoid, type HumanoidPose, type PlayerApi, type System, type Vehicle } from '../core/types';
import type { VehicleImpl } from '../vehicles/vehicle';
import { ChaseCamera } from './camera';
import { TUNING } from './tuning';

const RADIUS = 0.3;
const HALF = 0.56; // capsule half-height (cylinder part)
const FEET = RADIUS + HALF;
const _v = new THREE.Vector3();
const _door = new THREE.Vector3();

/** The player on foot and behind the wheel. */
export class Player implements PlayerApi, System {
  readonly name = 'player';
  readonly id: number;
  readonly kind = 'player' as const;
  readonly group = new THREE.Group();
  /** World position of the feet (the vehicle's position while driving). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = Math.PI;
  health = TUNING.maxHealth;
  maxHealth = TUNING.maxHealth;
  armour = 0;
  alive = true;
  vehicle: Vehicle | null = null;
  money = 0;
  controlsEnabled = true;
  aiming = false;
  sprinting = false;
  cameraHeading = Math.PI;
  humanoid: Humanoid;
  get figure(): Humanoid {
    return this.humanoid;
  }

  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private mover: RAPIER.KinematicCharacterController;
  private camera: ChaseCamera;
  private wish = new THREE.Vector3();
  private vy = 0;
  private grounded = true;
  private airTime = 0;
  private jumpQueued = false;
  private action: { pose: HumanoidPose; time: number } | null = null;
  private deathTimer = 0;
  private respawning = false;
  private zoneTimer = 0;
  private zone = '';

  constructor(private ctx: GameContext) {
    this.id = ctx.actors.nextId();
    const R = ctx.physics.rapier;
    const world = ctx.physics.world;
    this.humanoid = createHumanoid(
      { skin: 0xd8a888, hair: 0x3a2a1c, top: 0xb3261e, topStyle: 'bushShirt', legs: 0x2c3a5c, shorts: true, shoes: 0x1a1a1c, bulk: 1.02 },
      ctx.gfx.materials,
    );
    this.group.add(this.humanoid.group);
    ctx.scene.add(this.group);

    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 50, 0));
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(
        ctx.physics.groups(CollisionGroup.Character, CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris),
      ),
      this.body,
    );
    ctx.physics.setOwner(this.collider, this);
    this.mover = world.createCharacterController(0.03);
    this.mover.enableAutostep(0.4, 0.25, true);
    this.mover.enableSnapToGround(0.4);
    this.mover.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.mover.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.mover.setApplyImpulsesToDynamicBodies(true);
    this.mover.setCharacterMass(85);

    this.camera = new ChaseCamera(ctx);
    ctx.actors.all.add(this);

    ctx.events.on('playerBusted', () => {
      if (this.alive && !this.respawning) void this.respawn('busted');
    });
    ctx.events.on('vehicleCrash', ({ vehicle, speed }) => {
      if (vehicle === this.vehicle && speed > 9) this.takeDamage({ amount: (speed - 8) * 2.2, kind: 'vehicle' });
    });
    ctx.events.on('vehicleDestroyed', ({ vehicle }) => {
      if (vehicle === this.vehicle) this.takeDamage({ amount: 999, kind: 'explosion' });
    });
    ctx.save.register(
      'player',
      () => ({ money: this.money, x: this.position.x, z: this.position.z, heading: this.heading, health: this.health, armour: this.armour }),
      (data) => {
        // Only finite numbers may come back in: NaN coordinates would put the player nowhere without a sound.
        const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
        const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
        this.money = num(d.money, 0);
        this.health = clamp(num(d.health, TUNING.maxHealth), 20, this.maxHealth);
        this.armour = num(d.armour, 0);
        const x = num(d.x, NaN);
        const z = num(d.z, NaN);
        if (Number.isFinite(x) && Number.isFinite(z)) this.teleport(x, z, num(d.heading, 0));
        ctx.events.emit('moneyChanged', { money: this.money, delta: 0 });
      },
    );
  }

  // ───────────── PlayerApi ─────────────

  addMoney(delta: number) {
    this.money = Math.max(0, Math.round(this.money + delta));
    this.ctx.events.emit('moneyChanged', { money: this.money, delta });
  }

  heal(amount: number) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addArmour(amount: number) {
    this.armour = Math.min(100, this.armour + amount);
  }

  aimDirection(target: THREE.Vector3): THREE.Vector3 {
    return this.ctx.camera.getWorldDirection(target);
  }

  playAction(pose: HumanoidPose, seconds: number) {
    this.action = { pose, time: seconds };
  }

  shakeCamera(amount: number) {
    this.camera.addShake(amount);
  }

  teleport(x: number, z: number, heading = this.heading) {
    if (this.vehicle) this.leaveVehicle(true);
    const y = this.ctx.world.groundAt(x, z);
    this.body.setTranslation({ x, y: y + FEET + 0.05, z }, true);
    this.position.set(x, y, z);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, heading, 0);
    this.heading = heading;
    this.camera.yaw = heading;
    this.vy = 0;
    this.velocity.set(0, 0, 0);
  }

  warpIntoVehicle(vehicle: Vehicle) {
    this.enterVehicle(vehicle);
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive || this.respawning) return;
    let amount = info.amount * (info.kind === 'bullet' ? TUNING.bulletTaken : info.kind === 'melee' ? TUNING.meleeTaken : 1);
    if (this.armour > 0 && info.kind !== 'fall' && info.kind !== 'drown') {
      const absorbed = Math.min(this.armour, amount * TUNING.armourShare);
      this.armour -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.ctx.events.emit('actorDamaged', { actor: this, info });
    this.ctx.gfx.flash(0xa01010, clamp(amount / 40, 0.15, 0.6), 0.35);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathTimer = TUNING.deathSeconds;
      if (this.vehicle) this.leaveVehicle(true);
      this.ctx.events.emit('actorDied', { actor: this, info });
      this.ctx.events.emit('playerDied', { info });
    }
  }

  async respawn(reason: 'died' | 'busted' | 'load' | 'new', at?: { x: number; z: number; heading?: number }) {
    const { ctx } = this;
    this.respawning = true;
    this.controlsEnabled = false;
    if (reason === 'died' || reason === 'busted') await ctx.ui.fade(true, 1.2);
    let spot = at;
    if (!spot) {
      const place = ctx.world.nearestPlace(this.position.x, this.position.z, reason === 'busted' ? 'police' : reason === 'died' ? 'hospital' : 'spawn') ?? ctx.world.placesTagged('spawn')[0];
      spot = place ? { x: place.x, z: place.z, heading: place.heading } : { x: 0, z: 0 };
    }
    await ctx.world.whenLoaded(spot.x, spot.z);
    this.alive = true;
    this.health = this.maxHealth;
    // Patched up and in clean clothes.
    this.humanoid.clean?.();
    if (reason === 'died' || reason === 'busted') {
      this.armour = 0;
      // Hospital bill / bail.
      this.addMoney(-Math.min(this.money, Math.max(TUNING.feeFlat, Math.round(this.money * TUNING.feeShare))));
      ctx.clock.advanceHours(reason === 'died' ? TUNING.hospitalHours : TUNING.custodyHours);
    }
    this.teleport(spot.x, spot.z, spot.heading ?? 0);
    this.respawning = false;
    this.controlsEnabled = true;
    ctx.events.emit('playerRespawned', { reason });
    if (reason === 'died' || reason === 'busted') await ctx.ui.fade(false, 1.2);
  }

  // ───────────── Vehicles ─────────────

  private enterVehicle(vehicle: Vehicle) {
    this.ctx.vehicles.enter(this, vehicle, 0);
    this.collider.setEnabled(false);
    (vehicle as VehicleImpl).mount.add(this.group);
    this.group.position.copy((vehicle as VehicleImpl).seatLocal(0));
    this.group.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    // The glass is clear: the player is seen at the wheel.
    this.group.visible = true;
    this.ctx.audio.play('doorClose', { at: vehicle.position });
  }

  private leaveVehicle(force = false) {
    const vehicle = this.vehicle;
    if (!vehicle) return;
    if (!force && Math.abs(vehicle.speed) > 7) return;
    // Driver's door first (right-hand side), then the passenger side if that is blocked.
    let spot = vehicle.doorPosition(_door, 0);
    for (const seat of [0, 1]) {
      spot = vehicle.doorPosition(_door, seat);
      const from = _v.copy(vehicle.position).setY(vehicle.position.y + 0.6);
      const dir = new THREE.Vector3().subVectors(spot, from).setY(0);
      const len = dir.length();
      if (!this.ctx.physics.raycast(from, dir.normalize(), len + 0.3, { mask: CollisionGroup.World, excludeBody: vehicle.body })) break;
    }
    const heading = vehicle.heading;
    this.ctx.vehicles.exit(this);
    this.ctx.scene.add(this.group);
    this.group.visible = true;
    this.collider.setEnabled(true);
    const y = this.ctx.world.groundAt(spot.x, spot.z);
    this.body.setTranslation({ x: spot.x, y: Math.max(y, spot.y - 0.2) + FEET + 0.05, z: spot.z }, true);
    this.position.set(spot.x, Math.max(y, spot.y - 0.2), spot.z);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, heading, 0);
    this.heading = heading;
    this.vy = 0;
    this.ctx.audio.play('doorOpen', { at: this.position });
  }

  // ───────────── Simulation ─────────────

  fixedUpdate(dt: number) {
    if (this.vehicle || !this.alive) return;
    const t = this.body.translation();
    // Horizontal velocity eases towards the wish; gravity and jumping are explicit.
    const rate = this.grounded ? 14 : 2.5;
    this.velocity.x = damp(this.velocity.x, this.wish.x, rate, dt);
    this.velocity.z = damp(this.velocity.z, this.wish.z, rate, dt);
    if (this.grounded) {
      this.vy = Math.max(this.vy, -2);
      if (this.jumpQueued) {
        this.vy = TUNING.jumpSpeed;
        this.grounded = false;
      }
    }
    this.jumpQueued = false;
    this.vy -= TUNING.gravity * dt;
    this.mover.computeColliderMovement(
      this.collider,
      { x: this.velocity.x * dt, y: this.vy * dt, z: this.velocity.z * dt },
      undefined,
      // People on their feet are solid too (a knocked-down pedestrian drops out of the Character filter and is stepped over).
      this.ctx.physics.groups(CollisionGroup.Character, CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character),
    );
    const move = this.mover.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.mover.computedGrounded();
    if (!wasGrounded && this.grounded && this.vy < -TUNING.fallHurts) this.takeDamage({ amount: (-this.vy - TUNING.fallGrace) * TUNING.fallScale, kind: 'fall' });
    if (this.grounded) this.airTime = 0;
    else this.airTime += dt;
    let ny = t.y + move.y;
    // Never fall through the world while a chunk is still streaming in.
    const floor = this.ctx.world.groundAt(t.x + move.x, t.z + move.z) + FEET - 0.3;
    if (ny < floor) {
      ny = floor + 0.3;
      this.vy = 0;
      this.grounded = true;
    }
    const b = this.ctx.world.bounds;
    this.body.setNextKinematicTranslation({ x: clamp(t.x + move.x, b.minX + 8, b.maxX - 8), y: ny, z: clamp(t.z + move.z, b.minZ + 8, b.maxZ - 8) });
  }

  update(dt: number) {
    const { ctx } = this;
    const input = ctx.input;
    const free = this.controlsEnabled && this.alive && !ctx.ui.menuOpen;
    this.cameraHeading = this.camera.yaw;

    if (!this.alive) {
      this.humanoid.setPose('dead');
      this.humanoid.update(dt);
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && !this.respawning) void this.respawn('died');
      return;
    }

    const vehicle = this.vehicle;
    if (vehicle) {
      // Something else (a mission cutscene, the test autopilot) may be driving while the player sits in the seat.
      if (vehicle.controller === 'player') {
        const c = vehicle.controls;
        c.throttle = free ? input.throttle : 0;
        c.brake = free ? input.brake : 0;
        c.steer = free ? input.moveX : 0;
        c.handbrake = free ? input.held('handbrake') : true;
      }
      if (free && input.pressed('horn')) vehicle.horn();
      if (free && input.pressed('interact')) this.leaveVehicle();
      else if (Math.abs(vehicle.speed) < 1.5 && free) ctx.ui.prompt(`${input.label('interact')}  Get out`);
      this.humanoid.setPose(vehicle.spec.cls === 'bike' ? 'ride' : 'drive');
      this.humanoid.update(dt);
      this.velocity.copy(vehicle.velocity);
      this.position.copy(vehicle.position);
      this.heading = vehicle.heading;
      // Gone into the water with the car: once the cabin is under, the driver drowns as they would on foot.
      const seat = vehicle.seatPosition(_v, 0);
      if (this.underwater(seat.x, seat.y + TUNING.seatedHead, seat.z) > 0) this.takeDamage({ amount: TUNING.drownPerSecond * dt, kind: 'drown' });
    } else {
      const t = this.body.translation();
      this.position.set(t.x, t.y - FEET, t.z);
      this.group.position.copy(this.position);
      const sin = Math.sin(this.camera.yaw);
      const cos = Math.cos(this.camera.yaw);
      const mx = free ? input.moveX : 0;
      const mz = free ? input.moveZ : 0;
      const len = Math.hypot(mx, mz);
      this.sprinting = free && input.held('sprint') && len > 0.1 && !this.aiming;
      const top = this.aiming ? TUNING.aimSpeed : this.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
      // Water over the feet: standing on a wharf or a bridge above it is not wading.
      const depth = this.underwater(this.position.x, this.position.y, this.position.z);
      const wade = depth > TUNING.wadeDepth ? TUNING.wadeFactor : 1;
      if (len > 0.05) {
        const k = (Math.min(1, len) * top * wade) / len;
        // forward = (sin, cos), left = (cos, -sin).
        this.wish.set((sin * mz + cos * mx) * k, 0, (cos * mz - sin * mx) * k);
      } else this.wish.set(0, 0, 0);
      if (free && input.pressed('jump') && this.grounded) this.jumpQueued = true;
      if (depth > TUNING.drownDepth) this.takeDamage({ amount: TUNING.drownPerSecond * dt, kind: 'drown' });

      const moving = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.aiming) this.heading = dampAngle(this.heading, this.camera.yaw, 22, dt);
      else if (moving > 0.4 && len > 0.05) this.heading = dampAngle(this.heading, Math.atan2(this.wish.x, this.wish.z), 12, dt);
      this.group.rotation.y = this.heading;

      let pose: HumanoidPose;
      if (this.action) {
        pose = this.action.pose;
        this.action.time -= dt;
        if (this.action.time <= 0) this.action = null;
      } else if (this.aiming) pose = ctx.combat.current.kind === 'rifle' || ctx.combat.current.kind === 'shotgun' || ctx.combat.current.kind === 'smg' ? 'aimRifle' : 'aim';
      else if (!this.grounded && this.airTime > 0.15) pose = this.vy > 0 ? 'jump' : 'fall';
      else if (moving > 4.6) pose = 'run';
      else if (moving > 0.3) pose = 'walk';
      else pose = 'idle';
      this.humanoid.setPose(pose, { speed: moving, aimPitch: clamp(-Math.asin(clamp(ctx.camera.getWorldDirection(_v).y, -1, 1)), -0.9, 0.9) });
      this.humanoid.update(dt);

      // Getting into / stealing vehicles.
      const near = ctx.vehicles.nearest(this.position.x, this.position.z, TUNING.enterRadius, (v) => !v.destroyed && v.position.distanceTo(this.position) < v.spec.length * 0.5 + TUNING.enterReach);
      if (near && free) {
        const occupied = near.driver !== null;
        ctx.ui.prompt(`${input.label('interact')}  ${occupied ? 'Hijack' : near.tags.has('owned') ? 'Get in' : 'Nick'} the ${near.spec.name}`);
        if (input.pressed('interact')) {
          const stolen = !near.tags.has('owned');
          this.enterVehicle(near);
          if (occupied) ctx.events.emit('crime', { type: 'carjacking', position: this.position.clone(), offender: this, victim: near });
          else if (stolen) ctx.events.emit('crime', { type: 'carTheft', position: this.position.clone(), offender: this, victim: near });
        }
      }
    }

    // Location changes for the HUD.
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 0.5;
      const p = this.vehicle ? this.vehicle.position : this.position;
      const name = ctx.world.locationName(p.x, p.z);
      if (name !== this.zone) {
        this.zone = name;
        ctx.events.emit('zoneChanged', { name, city: ctx.world.districtAt(p.x, p.z).city });
      }
    }
  }

  lateUpdate(dt: number) {
    this.camera.update(dt);
  }

  /** How far below the water surface a point is (0 if it is above it or there is no water). */
  private underwater(x: number, y: number, z: number): number {
    const world = this.ctx.world;
    const depth = world.waterDepthAt(x, z);
    return depth > 0 ? Math.max(0, world.heightAt(x, z) + depth - y) : 0;
  }

}
