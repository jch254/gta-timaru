import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createOccupant } from './occupant';
import { TUNING } from './tuning';
import { clamp, damp, moveToward } from '../core/math';
import { CollisionGroup, type Actor, type GameContext, type Vehicle, type VehicleControls, type VehicleModel, type VehicleSpec } from '../core/types';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Peak tyre friction coefficient for a spec with grip 1 on dry seal. */
const MU = 1.12;

/**
 * One drivable vehicle: a Rapier ray-cast vehicle (dynamic chassis + four suspension rays) with
 * arcade-leaning tuning. Whoever owns `controller` writes `controls`; this class does the rest.
 */
export class VehicleImpl implements Vehicle {
  readonly group = new THREE.Group();
  /** Parent for anything riding along (a seated humanoid): model space, origin on the ground under the centre. */
  readonly mount = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  speed = 0;
  controls: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  driver: Actor | null = null;
  passengers: Actor[] = [];
  health: number;
  destroyed = false;
  burning = false;
  wheelsOnGround = 0;
  slip = 0;
  wheelspin = 0;
  siren = false;
  headlightsOn = false;
  controller: Vehicle['controller'] = 'none';
  tags = new Set<string>();

  private rig: RAPIER.DynamicRayCastVehicleController;
  private collider: RAPIER.Collider;
  private steer = 0;
  private originY: number;
  private restY: number[] = [];
  private prevVel = new THREE.Vector3();
  private burnTimer = 0;
  private upsideDown = 0;
  private spawnGrace = 0.6;
  private wheelSpin = 0;
  private squirm = 0;
  /** Extra turn of the driven wheels while they spin on the spot. */
  private drivenSpin = 0;
  private lean = 0;
  private beaconTime = 0;
  private bike: boolean;

  constructor(
    readonly id: number,
    readonly spec: VehicleSpec,
    private model: VehicleModel,
    private paint: number,
    private ctx: GameContext,
    x: number,
    y: number,
    z: number,
    heading: number,
  ) {
    const R = ctx.physics.rapier;
    const world = ctx.physics.world;
    this.health = spec.health;
    this.bike = spec.wheelCount === 2;
    this.originY = spec.wheelRadius + 0.28;
    // group (follows the chassis) → mount (ground level under the centre; leans on bikes) → model.
    this.mount.position.y = -this.originY;
    this.mount.add(model.group);
    this.group.add(this.mount);
    ctx.scene.add(this.group);

    _q.setFromAxisAngle(_up.set(0, 1, 0), heading);
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y + this.originY + 0.15, z)
        .setRotation(_q)
        .setLinearDamping(0.02)
        .setAngularDamping(0.9)
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    // Chassis box sits above the wheels; the centre of mass is dropped for stability.
    const clearance = spec.wheelRadius * 0.75;
    const hx = spec.width / 2 - 0.04;
    const hy = Math.max(0.2, (spec.height - clearance) / 2 - 0.05);
    const hz = spec.length / 2 - 0.04;
    const cy = clearance + hy - this.originY;
    const m = spec.mass;
    const sx = hx * 2;
    const sy = hy * 2;
    const sz = hz * 2;
    this.collider = world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, cy, 0)
        .setMassProperties(
          m,
          { x: 0, y: -spec.comDrop - cy * 0.5, z: 0 },
          { x: (m / 12) * (sy * sy + sz * sz) * 1.3, y: (m / 12) * (sx * sx + sz * sz), z: (m / 12) * (sx * sx + sy * sy) * (this.bike ? 6 : 1.8) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.35)
        .setRestitution(0.12)
        .setCollisionGroups(ctx.physics.groups(CollisionGroup.Vehicle, CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris)),
      this.body,
    );
    ctx.physics.setOwner(this.collider, this);

    this.rig = world.createVehicleController(this.body);
    this.rig.indexUpAxis = 1;
    this.rig.setIndexForwardAxis = 2;
    const k = spec.suspensionStiffness;
    const rest = spec.suspensionTravel + 0.1;
    const sag = 9.81 / (4 * k);
    const track = this.bike ? 0.34 : spec.track;
    // Order: FL, FR, RL, RR ("left" is local +x).
    for (const [sxn, szn] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const connY = spec.wheelRadius - this.originY + (rest - sag);
      this.rig.addWheel({ x: (sxn * track) / 2, y: connY, z: (szn * spec.wheelbase) / 2 }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, spec.wheelRadius);
      this.restY.push(connY);
    }
    const damping = 2 * Math.sqrt(k) * spec.suspensionDamping;
    for (let i = 0; i < 4; i++) {
      this.rig.setWheelSuspensionStiffness(i, k);
      this.rig.setWheelSuspensionCompression(i, damping * 0.42);
      this.rig.setWheelSuspensionRelaxation(i, damping * 0.6);
      this.rig.setWheelMaxSuspensionTravel(i, spec.suspensionTravel);
      this.rig.setWheelMaxSuspensionForce(i, m * 9.81 * 3);
      this.rig.setWheelSideFrictionStiffness(i, 1);
    }
    this.syncVisual(1);
  }

  get color(): number {
    return this.paint;
  }

  /** Respray. */
  set color(value: number) {
    this.paint = value;
    if (!this.destroyed) this.model.bodyMaterial?.color.set(value);
  }

  /** 60 Hz: turn controls into wheel forces. Runs before the physics step. */
  fixedUpdate(dt: number) {
    const spec = this.spec;
    const c = this.controls;
    const body = this.body;
    const lv = body.linvel();
    this.velocity.set(lv.x, lv.y, lv.z);
    const rot = body.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(-1, 0, 0).applyQuaternion(_q);
    this.speed = this.velocity.dot(_fwd);
    const speed = this.speed;
    const lateral = this.velocity.dot(_right);

    const alive = !this.destroyed && !this.burning;
    let throttle = alive ? clamp(c.throttle, 0, 1) : 0;
    let brake = clamp(c.brake, 0, 1);
    // Brake pedal reverses once the car has stopped.
    let reverse = 0;
    if (brake > 0 && speed < 1.2 && throttle === 0 && alive) {
      reverse = brake;
      brake = 0;
    }
    if (throttle > 0 && speed < -1.5) {
      brake = Math.max(brake, throttle);
      throttle = 0;
    }

    // Drive force tapers towards top speed.
    const env = this.ctx.env;
    let force = 0;
    if (throttle > 0) force = spec.engineForce * throttle * clamp(1 - Math.pow(Math.max(0, speed) / spec.topSpeed, 3), 0, 1) * (speed < 6 ? 1.15 : 1);
    else if (reverse > 0) force = -spec.engineForce * 0.6 * reverse * clamp(1 - Math.abs(speed) / spec.reverseSpeed, 0, 1);

    const surface = this.wheelsOnGround > 0 ? this.ctx.world.surfaceAt(this.position.x, this.position.z) : 'road';
    const offRoad = surface === 'grass' || surface === 'sand' || surface === 'shingle' || surface === 'field';
    const loose = surface === 'gravel' || offRoad;
    // Tyre friction coefficient: about 1.1 g of grip for an ordinary road car on dry seal.
    const mu = MU * spec.grip * (1 - env.wetness * 0.28) * (loose ? 0.72 : 1);
    // Speed-sensitive steering: full lock when parking; at speed, only as much lock as the tyres can use
    // (a little more than the grip limit, so the front can still be pushed into a slide).
    const v2 = Math.max(1, speed * speed);
    const lock = Math.min(spec.steerLock, Math.atan((spec.wheelbase * 1.22 * mu * 9.81) / v2));
    this.steer = moveToward(this.steer, clamp(c.steer, -1, 1) * lock, (Math.abs(c.steer) > 0.01 ? 1.9 : 3.2) * dt * (0.6 + lock));

    // Burnout: throttle and brake held together at a standstill. The brakes hold the undriven wheels, the driven
    // ones spin and smoke, the car squirms on the spot and creeps; steering swings the tail.
    const burning = alive && !this.bike && this.wheelsOnGround >= 3 && c.throttle > 0.5 && c.brake > 0.5 && Math.abs(speed) < TUNING.burnoutBelow;
    this.wheelspin = moveToward(this.wheelspin, burning ? 1 : 0, dt * (burning ? 2.2 : 3.5));
    const spinning = this.wheelspin > 0.05;
    const frontDriven = spec.drive === 'fwd';

    const frontGrip = mu;
    const rearGrip = mu * spec.rearGripBias * (c.handbrake ? 0.45 : 1);
    const brakeImpulse = ((spec.mass * 10.5) / 60 / 4) * spec.brakeForce;
    const frontDrive = spec.drive === 'fwd' ? 0.5 : spec.drive === 'awd' ? 0.25 : 0;
    const rearDrive = spec.drive === 'rwd' ? 0.5 : spec.drive === 'awd' ? 0.25 : 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      this.rig.setWheelSteering(i, front ? this.steer : 0);
      this.rig.setWheelEngineForce(i, force * (front ? frontDrive : rearDrive));
      this.rig.setWheelFrictionSlip(i, front ? frontGrip : rearGrip);
      let b = brake * brakeImpulse * (front ? 1.25 : 0.75);
      if (!front && c.handbrake) b = brakeImpulse * 2.2;
      // Engine braking / rolling resistance when coasting.
      if (throttle === 0 && reverse === 0 && brake === 0) b += brakeImpulse * (offRoad ? 0.1 : 0.035);
      else if (offRoad) b += brakeImpulse * 0.05 * clamp(Math.abs(speed) / 12, 0, 1);
      if (spinning) {
        const driven = frontDriven ? front : !front;
        if (driven) {
          // A spinning tyre has little grip left: it scrabbles the car forward rather than driving it.
          b = 0;
          this.rig.setWheelFrictionSlip(i, (front ? frontGrip : rearGrip) * (1 - 0.7 * this.wheelspin));
          this.rig.setWheelEngineForce(i, Math.abs(speed) < TUNING.burnoutCreep ? spec.engineForce * 0.12 * this.wheelspin : 0);
        } else b = Math.max(b, brakeImpulse * 2.6);
      }
      this.rig.setWheelBrake(i, b);
    }
    this.rig.updateVehicle(dt, undefined, this.ctx.physics.groups(CollisionGroup.Vehicle, CollisionGroup.World));

    let grounded = 0;
    for (let i = 0; i < 4; i++) if (this.rig.wheelIsInContact(i)) grounded++;
    this.wheelsOnGround = grounded;
    this.slip = grounded ? clamp((Math.abs(lateral) - 1.2) / 6, 0, 1) * clamp(Math.abs(speed) / 6 + Math.abs(lateral) / 6, 0, 1) : 0;

    if (grounded >= 2) {
      // A little aerodynamic downforce keeps fast cars planted over crests.
      const down = Math.min(speed * speed * 0.9, spec.mass * 5) * dt;
      body.applyImpulse({ x: -_up.x * down, y: -_up.y * down, z: -_up.z * down }, true);
      // Yaw assist: nudges the car to follow its front wheels so steering stays responsive at speed.
      if (Math.abs(speed) > 2 && !c.handbrake) {
        const want = (speed * Math.tan(this.steer)) / spec.wheelbase;
        const av = body.angvel();
        const yaw = av.x * _up.x + av.y * _up.y + av.z * _up.z;
        // Kept light: enough to sharpen turn-in, not enough to hide a slide.
        const fix = clamp((want - yaw) * 0.07, -0.25, 0.25) * dt * 60;
        const t = fix * spec.mass * 0.9;
        body.applyTorqueImpulse({ x: _up.x * t * dt, y: _up.y * t * dt, z: _up.z * t * dt }, true);
      }
      if (this.wheelspin > 0.05) {
        // The tail squirms as the tyres fight for grip, and swings out with the steering.
        this.squirm += dt;
        const wobble = Math.sin(this.squirm * 5.3) * 0.35 + Math.sin(this.squirm * 2.1) * 0.25;
        const sign = spec.drive === 'fwd' ? -1 : 1;
        const t = (clamp(c.steer, -1, 1) * 1.1 * sign + wobble) * this.wheelspin * spec.mass * TUNING.burnoutSwing * dt;
        body.applyTorqueImpulse({ x: _up.x * t, y: _up.y * t, z: _up.z * t }, true);
      }
    }
    if (this.bike && grounded) {
      // Bikes are held upright rather than balanced.
      const roll = Math.asin(clamp(_right.y, -1, 1));
      const av = body.angvel();
      const rollRate = av.x * _fwd.x + av.y * _fwd.y + av.z * _fwd.z;
      const t = (roll * 60 - rollRate * 8) * spec.mass * 0.4 * dt;
      body.applyTorqueImpulse({ x: _fwd.x * t, y: _fwd.y * t, z: _fwd.z * t }, true);
    }
    if (Math.abs(throttle) + Math.abs(reverse) + Math.abs(c.steer) > 0.01 && body.isSleeping()) body.wakeUp();

    // Crash detection from the change in velocity over one step.
    this.spawnGrace -= dt;
    const dv = _v.subVectors(this.velocity, this.prevVel).length();
    if (dv > TUNING.crashNoticeDv && this.spawnGrace < 0) {
      // Whoever is close enough to have been hit.
      let other: Vehicle | null = null;
      for (const v of this.ctx.vehicles.all) {
        if (v !== this && v.position.distanceToSquared(this.position) < ((v.spec.length + spec.length) * 0.5 + 0.8) ** 2) {
          other = v;
          break;
        }
      }
      this.ctx.events.emit('vehicleCrash', { vehicle: this, speed: dv, other });
      if (dv > TUNING.crashHurtsDv) this.applyDamage((dv - TUNING.crashDamageGrace) * TUNING.crashDamageScale, null);
    }
    this.prevVel.copy(this.velocity);

    // Deep water kills the engine.
    if (!this.destroyed && this.ctx.world.waterDepthAt(this.position.x, this.position.z) > TUNING.drownDepth && this.position.y < this.ctx.world.seaLevel + TUNING.drownAboveSea) {
      this.health = 0;
      this.destroyed = true;
      body.setLinearDamping(1.5);
    }
  }

  /** Per frame: copy physics to the visuals and run timers. */
  update(dt: number) {
    this.syncVisual(dt);
    this.syncOccupants();
    if (this.burning && !this.destroyed) {
      this.burnTimer -= dt;
      if (this.burnTimer <= 0) this.explode();
    }
    // Emergency beacons alternate while the siren is on.
    const beacons = this.model.beacons;
    if (beacons) {
      this.beaconTime += dt;
      const on = this.siren && !this.destroyed;
      beacons.forEach((b, i) => {
        b.emissiveIntensity = on && Math.floor(this.beaconTime * 5 + i) % 2 === 0 ? 6 : 0;
      });
    }
    // Self-righting when left on its roof.
    _up.set(0, 1, 0).applyQuaternion(this.group.quaternion);
    if (_up.y < 0.2 && this.velocity.lengthSq() < 1) {
      this.upsideDown += dt;
      if (this.upsideDown > 2.5 && this.driver) this.recover();
    } else this.upsideDown = 0;
  }

  private occupants: (THREE.Mesh | null)[] = [null, null];

  /**
   * Whoever is in the front seats is seen through the glass. Actors with a figure of their own mounted in the
   * car (the player, mission characters) show as themselves; everyone else gets a simple stand-in.
   */
  private syncOccupants() {
    if (this.bike) return;
    for (let seat = 0; seat < 2 && seat < this.model.seats.length; seat++) {
      const actor = seat === 0 ? this.driver : (this.passengers[0] ?? null);
      const parent = actor ? actor.group.parent : null;
      const own = actor !== null && actor.group.visible && (parent === this.mount || parent === this.group);
      const show = actor !== null && actor.alive && !own && !this.destroyed;
      let mesh = this.occupants[seat];
      if (show && !mesh) {
        mesh = this.occupants[seat] = createOccupant(this.ctx.gfx.materials, this.id * 7 + seat * 3, seat === 0, this.spec.cls === 'police', this.spec.cls === 'bus' || this.spec.cls === 'truck' ? 0.45 : 0.22);
        mesh.position.copy(this.seatLocal(seat));
        this.mount.add(mesh);
      }
      if (mesh) mesh.visible = show;
    }
  }

  private syncVisual(dt: number) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.group.position.copy(this.position);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    this.heading = Math.atan2(_fwd.x, _fwd.z);

    const wheels = this.model.wheels;
    this.wheelSpin += (this.speed / this.spec.wheelRadius) * dt;
    this.drivenSpin += this.wheelspin * 70 * dt;
    const drivenFront = this.spec.drive === 'fwd';
    const susp = (i: number) => this.restY[i] - (this.rig.wheelSuspensionLength(i) ?? this.spec.suspensionTravel) + this.originY;
    if (this.bike) {
      // Two visible wheels driven by the hidden four-wheel rig.
      wheels[0].position.set(0, (susp(0) + susp(1)) / 2, this.spec.wheelbase / 2);
      wheels[1].position.set(0, (susp(2) + susp(3)) / 2, -this.spec.wheelbase / 2);
      wheels[0].rotation.set(this.wheelSpin, this.steer, 0, 'YXZ');
      wheels[1].rotation.set(this.wheelSpin, 0, 0, 'YXZ');
      this.lean = damp(this.lean, clamp(-this.steer * this.speed * 0.12, -0.6, 0.6), 8, dt);
      this.mount.rotation.z = this.lean;
      if (this.model.steerPivot) this.model.steerPivot.rotation.y = this.steer;
    } else {
      for (let i = 0; i < wheels.length; i++) {
        const p = Math.min(i, 3) < 2 ? i : 2 + (i % 2);
        const w = wheels[i];
        w.position.y = susp(p);
        const driven = drivenFront ? p < 2 : p >= 2;
        w.rotation.set(this.wheelSpin + (driven ? this.drivenSpin : 0), i < 2 ? this.steer : 0, 0, 'YXZ');
      }
    }
  }

  applyDamage(amount: number, source: Actor | null = null, _point?: THREE.Vector3) {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    this.ctx.events.emit('vehicleDamaged', { vehicle: this, amount, source });
    if (this.health <= 0 && !this.burning) {
      this.burning = true;
      this.burnTimer = TUNING.burnSeconds;
      this.lastAttacker = source;
    }
  }
  private lastAttacker: Actor | null = null;

  private explode() {
    this.destroyed = true;
    this.burning = false;
    this.model.bodyMaterial?.color.multiplyScalar(0.12);
    if (this.model.bodyMaterial) this.model.bodyMaterial.roughness = 0.95;
    this.body.applyImpulse({ x: 0, y: this.spec.mass * 4.5, z: 0 }, true);
    this.body.applyTorqueImpulse({ x: this.spec.mass * 1.2, y: 0, z: this.spec.mass * 0.6 }, true);
    this.ctx.combat.explode(this.position.clone(), TUNING.explosionRadius, TUNING.explosionDamage, this.lastAttacker);
    this.ctx.events.emit('vehicleDestroyed', { vehicle: this, source: this.lastAttacker });
  }

  doorPosition(target: THREE.Vector3, seat = 0): THREE.Vector3 {
    const s = this.model.seats[Math.min(seat, this.model.seats.length - 1)];
    const side = s.x < 0 ? -1 : 1;
    return target.set(side * (this.spec.width / 2 + 0.75), -this.originY + 0.1, s.z).applyQuaternion(this.group.quaternion).add(this.position);
  }

  seatPosition(target: THREE.Vector3, seat = 0): THREE.Vector3 {
    const s = this.model.seats[Math.min(seat, this.model.seats.length - 1)];
    return target.set(s.x, s.y - this.originY, s.z).applyQuaternion(this.group.quaternion).add(this.position);
  }

  /** Seat position in `mount` space (for parenting a seated humanoid to `mount`). */
  seatLocal(seat = 0): THREE.Vector3 {
    const s = this.model.seats[Math.min(seat, this.model.seats.length - 1)];
    return new THREE.Vector3(s.x, s.y, s.z);
  }

  teleport(x: number, y: number, z: number, heading: number) {
    _q.setFromAxisAngle(_up.set(0, 1, 0), heading);
    this.body.setTranslation({ x, y: y + this.originY + 0.2, z }, true);
    this.body.setRotation(_q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevVel.set(0, 0, 0);
    this.spawnGrace = 0.6;
    this.syncVisual(1);
  }

  recover() {
    const y = this.ctx.world.groundAt(this.position.x, this.position.z);
    this.teleport(this.position.x, y, this.position.z, this.heading);
    this.upsideDown = 0;
  }

  horn() {
    this.ctx.events.emit('horn', { vehicle: this });
  }

  dispose() {
    this.ctx.physics.setOwner(this.collider, null);
    this.ctx.physics.world.removeVehicleController(this.rig);
    this.ctx.physics.world.removeRigidBody(this.body);
    // Anyone still riding along (a seated humanoid) is handed back to the scene, not disposed with the car.
    // Stand-in occupants go with the car (their geometry is shared, so nothing to dispose).
    for (const mesh of this.occupants) if (mesh) this.mount.remove(mesh);
    for (const child of [...this.mount.children]) {
      if (child !== this.model.group) this.ctx.scene.attach(child);
    }
    this.group.removeFromParent();
    this.model.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    // Per-vehicle materials (paint, beacons) would otherwise accumulate as traffic churns.
    const materials = this.ctx.gfx.materials;
    if (this.model.bodyMaterial) materials.release(this.model.bodyMaterial);
    for (const b of this.model.beacons ?? []) materials.release(b);
  }
}
