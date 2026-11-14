import * as THREE from 'three';
import { damp } from '../core/math';
import { CollisionGroup, type Actor, type CombatApi, type CrimeType, type DamageInfo, type GameContext, type RayHit, type System, type Vehicle, type WeaponSpec } from '../core/types';
import { createEffects, type Effects } from '../fx';
import { damageAtRange, explosionFalloff, explosionShake, spreadDirection } from './ballistics';
import { Inventory } from './inventory';
import { HAND_FIT, WeaponModels } from './models';
import { Pickups } from './pickups';
import { feelOf, isLongGun, isRanged, TUNING, WEAPON_ORDER, WEAPONS } from './weapons';

const isVehicle = (owner: Actor | Vehicle): owner is Vehicle => 'spec' in owner;

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
/** Melee rays fan out across the arc, centre first. */
const MELEE_FAN = [0, 1 / 3, -1 / 3, 2 / 3, -2 / 3, 1, -1];
/** Heights above the feet for the two rows of melee rays (chest, then thigh). */
const MELEE_ROWS = [1.15, 0.6];

// Scratch vectors. Nothing here is kept across a call that can re-enter this module.
const _aim = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shot = new THREE.Vector3();
const _pellet = new THREE.Vector3();
const _end = new THREE.Vector3();
const _start = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

interface HeldModel {
  root: THREE.Group;
  inner: THREE.Object3D;
  /** How the weapon sits in the hand when it is not being aimed. */
  carry: THREE.Quaternion;
  ranged: boolean;
}

/**
 * Weapons, damage, pickups and the player's loadout. Hit-scan through `ctx.physics.raycast`; every
 * visual goes through src/fx.
 */
class Combat implements CombatApi, System {
  readonly name = 'combat';
  readonly weapons = new Map<string, WeaponSpec>(WEAPONS.map((w) => [w.id, w]));
  current: WeaponSpec;

  /** Random source for spread (replaceable for tests). */
  random: () => number = Math.random;

  private inv: Inventory;
  private fx: Effects;
  private models: WeaponModels;
  private pickups: Pickups;

  // Player handling.
  private fireQueued = 0;
  private meleeCooldown = 0;
  private swinging = false;
  private swingTime = 0;
  private swingDamage = 0;
  private swingReach = 0;
  private stance = 0;
  /** View kick still to spring back (radians). */
  private kickPitch = 0;
  private kickYaw = 0;
  private heldId: string | null | undefined = undefined;
  private held: HeldModel | null = null;
  private align = 0;
  private playerModels = new Map<string, HeldModel | null>();

  // Crime reporting.
  private lastGunfire = -Infinity;
  private lastVehicleCrime = -Infinity;
  private reportedDead = new WeakSet<Actor>();

  // One damage call per target per trigger pull: pellets are summed here first.
  private hitOwners: (Actor | Vehicle)[] = [];
  private hitDamage: number[] = [];
  private hitPoints: THREE.Vector3[] = [];
  private hitCount = 0;
  private rayOptions: { mask?: number; excludeBody?: Vehicle['body'] | null; excludeOwner?: Actor | Vehicle | null } = {};

  constructor(private ctx: GameContext) {
    this.inv = new Inventory(this.weapons, WEAPON_ORDER, (id) => feelOf(id).maxReserve);
    this.current = this.inv.current;
    this.inv.onReload = (phase) => {
      // (The player does not exist yet while the systems are being constructed.)
      if (phase === 'start') ctx.audio.play('reload', ctx.player ? { at: ctx.player.position } : undefined);
    };
    this.models = new WeaponModels(ctx.gfx.materials);
    this.fx = createEffects(ctx);
    this.pickups = new Pickups(ctx, this.models, {
      weapons: this.weapons,
      give: (id, ammo) => this.give(id, ammo),
      full: (id) => this.inv.full(id),
    });

    ctx.save.register(
      'combat',
      () => this.serialize(),
      (data) => this.deserialize(data),
    );
    ctx.events.on('playerBusted', () => this.disarm());
    ctx.events.on('playerRespawned', ({ reason }) => {
      if (reason === 'died') this.inv.halveReserve();
      else if (reason === 'busted') this.disarm();
      this.fireQueued = 0;
      this.swinging = false;
      this.kickPitch = this.kickYaw = 0;
    });
    // Deaths the victim's own system reports a moment after the hit still count against the player.
    ctx.events.on('actorDied', ({ actor, info }) => {
      if (info.source === ctx.player && (info.kind === 'bullet' || info.kind === 'melee' || info.kind === 'explosion')) this.reportKill(actor);
    });
  }

  // ───────────── Loadout ─────────────

  ammo(weaponId?: string): { clip: number; reserve: number } {
    return this.inv.ammo(weaponId);
  }

  give(weaponId: string, ammo: number): void {
    if (this.inv.give(weaponId, ammo) === 'unknown') console.warn(`combat: unknown weapon "${weaponId}"`);
    this.syncCurrent();
  }

  has(weaponId: string): boolean {
    return this.inv.has(weaponId);
  }

  select(weaponId: string): void {
    this.inv.select(weaponId);
    this.syncCurrent();
  }

  disarm(): void {
    this.inv.disarm();
    this.syncCurrent();
  }

  serialize(): unknown {
    return this.inv.serialize();
  }

  deserialize(data: unknown): void {
    this.inv.deserialize(data);
    this.syncCurrent(true);
  }

  private cycle(direction: 1 | -1) {
    this.inv.cycle(direction);
    this.syncCurrent();
  }

  /** Publish a change of weapon. */
  private syncCurrent(force = false) {
    const now = this.inv.current;
    if (now === this.current && !force) return;
    this.current = now;
    this.fireQueued = 0;
    this.ctx.events.emit('weaponChanged', { weaponId: now.id });
  }

  // ───────────── Shooting ─────────────

  fire(shooter: Actor, weaponId: string, origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    const spec = this.weapons.get(weaponId);
    if (!spec || !shooter.alive) return false;
    if (!isRanged(spec)) {
      this.melee(shooter, spec.damage, spec.range);
      return true;
    }
    if (direction.lengthSq() < 1e-8) return false;
    this.shoot(shooter, spec, origin, _shot.copy(direction).normalize(), 1);
    return true;
  }

  /** One trigger pull: every pellet, the tracers, the damage, the noise. `direction` must be unit length. */
  private shoot(shooter: Actor, spec: WeaponSpec, from: THREE.Vector3, direction: THREE.Vector3, spreadScale: number) {
    const { ctx, fx } = this;
    const feel = feelOf(spec.id);
    // Copies: listeners called below may fire again and reuse the scratch vectors passed in.
    const origin = from.clone();
    const aim = direction.clone();
    const spread = spec.spread * spreadScale;
    const heavy = spec.kind === 'rifle';
    const options = this.rayOptions;
    const base = this.hitCount;

    for (let i = 0; i < spec.pellets; i++) {
      spreadDirection(aim, spread, this.random(), this.random(), _pellet);
      options.excludeOwner = shooter;
      options.excludeBody = shooter.vehicle ? shooter.vehicle.body : null;
      const hit = ctx.physics.raycast(origin, _pellet, spec.range, options);
      if (!hit) {
        fx.tracer(origin, _end.copy(origin).addScaledVector(_pellet, spec.range), heavy);
        continue;
      }
      fx.tracer(origin, hit.point, heavy);
      const owner = hit.owner;
      const vehicle = owner && isVehicle(owner) ? owner : null;
      if (owner) this.addHit(owner, damageAtRange(spec.damage, hit.distance, spec.range, feel.falloffStart, feel.falloffMin), hit.point);
      fx.hint(origin, _pellet, vehicle, feel.blood, false);
      ctx.events.emit('impact', { position: hit.point, normal: hit.normal, surface: !owner ? 'world' : vehicle ? 'vehicle' : 'flesh' });
      fx.clearHint();
    }

    ctx.events.emit('gunshot', { shooter, weaponId: spec.id, position: origin.clone(), direction: aim.clone() });
    fx.muzzleFlash(origin, aim, feel.flash, shooter.vehicle ? shooter.vehicle.velocity : shooter.velocity);
    if (shooter === ctx.player && ctx.clock.elapsed - this.lastGunfire >= TUNING.gunfireCrimeInterval) {
      this.lastGunfire = ctx.clock.elapsed;
      ctx.events.emit('crime', { type: 'gunfire', position: origin.clone(), offender: shooter });
    }

    // Damage last: a death can set off anything.
    const end = this.hitCount;
    for (let i = base; i < end; i++) {
      const owner = this.hitOwners[i];
      const amount = this.hitDamage[i];
      if (isVehicle(owner)) this.damageVehicle(owner, amount * feel.vehicleScale, shooter, this.hitPoints[i]);
      else {
        if (owner.alive && owner !== ctx.player) owner.velocity.addScaledVector(aim, Math.min(TUNING.bulletKnockMax, amount * TUNING.bulletKnock));
        this.damageActor(owner, { amount, kind: 'bullet', source: shooter, point: this.hitPoints[i].clone(), direction: aim.clone() });
      }
    }
    this.hitOwners.length = base;
    this.hitCount = base;
  }

  private addHit(owner: Actor | Vehicle, damage: number, point: THREE.Vector3) {
    for (let i = this.hitCount - 1; i >= 0; i--) {
      if (this.hitOwners[i] === owner) {
        this.hitDamage[i] += damage;
        return;
      }
    }
    const i = this.hitCount++;
    this.hitOwners[i] = owner;
    this.hitDamage[i] = damage;
    if (i < this.hitPoints.length) this.hitPoints[i].copy(point);
    else this.hitPoints.push(point.clone());
  }

  /** Hurt someone and, when the player did it, tell the police. */
  private damageActor(victim: Actor, info: DamageInfo) {
    if (!victim.alive) return;
    victim.takeDamage(info);
    const player = this.ctx.player;
    if (info.source !== player || victim === player) return;
    if (!victim.alive) this.reportKill(victim);
    else this.ctx.events.emit('crime', { type: victim.kind === 'cop' ? 'copAssault' : 'assault', position: victim.position.clone(), offender: player, victim });
  }

  private reportKill(victim: Actor) {
    const player = this.ctx.player;
    if (victim === player || this.reportedDead.has(victim)) return;
    this.reportedDead.add(victim);
    const type: CrimeType = victim.kind === 'cop' ? 'copKilled' : 'murder';
    this.ctx.events.emit('crime', { type, position: victim.position.clone(), offender: player, victim });
  }

  private damageVehicle(vehicle: Vehicle, amount: number, source: Actor | null, point: THREE.Vector3) {
    if (vehicle.destroyed || amount <= 0) return;
    vehicle.applyDamage(amount, source, point);
    const { ctx } = this;
    if (source !== ctx.player || vehicle === ctx.player.vehicle) return;
    if (ctx.clock.elapsed - this.lastVehicleCrime < TUNING.vehicleCrimeInterval) return;
    this.lastVehicleCrime = ctx.clock.elapsed;
    ctx.events.emit('crime', { type: 'vehicleDamage', position: vehicle.position.clone(), offender: ctx.player, victim: vehicle });
  }

  // ───────────── Melee ─────────────

  melee(attacker: Actor, damage: number, reach: number = TUNING.meleeReach): Actor | Vehicle | null {
    if (!attacker.alive || attacker.vehicle) return null;
    const { ctx } = this;
    const heading = attacker.heading;
    const options = this.rayOptions;
    let best: RayHit | null = null;
    let bestRank = 3;
    for (const row of MELEE_ROWS) {
      _a.set(attacker.position.x, attacker.position.y + row, attacker.position.z);
      for (const k of MELEE_FAN) {
        const angle = heading + k * TUNING.meleeArc;
        _b.set(Math.sin(angle), 0, Math.cos(angle));
        options.excludeOwner = attacker;
        options.excludeBody = null;
        const hit = ctx.physics.raycast(_a, _b, reach, options);
        if (!hit) continue;
        // People first, then vehicles, then walls; nearest within a rank.
        const rank = !hit.owner ? 2 : isVehicle(hit.owner) ? 1 : hit.owner.alive ? 0 : 2;
        if (rank < bestRank || (rank === bestRank && best !== null && hit.distance < best.distance)) {
          best = hit;
          bestRank = rank;
        }
      }
      if (bestRank < 2) break;
    }
    if (!best) return null;

    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const owner = best.owner;
    const target = bestRank === 0 || bestRank === 1 ? owner : null;
    const heavy = damage >= TUNING.meleeBloodDamage;
    _a.set(attacker.position.x, attacker.position.y + MELEE_ROWS[0], attacker.position.z);
    this.fx.hint(_a, forward, null, heavy ? feelOf('bat').blood : 0, true);
    ctx.events.emit('impact', { position: best.point, normal: best.normal, surface: !owner ? 'world' : isVehicle(owner) ? 'vehicle' : 'flesh' });
    this.fx.clearHint();
    if (!target) return null;

    if (isVehicle(target)) {
      // A dent, not a wreck: fists barely mark a car.
      target.body.applyImpulse({ x: forward.x * damage * 6, y: 0, z: forward.z * damage * 6 }, true);
      this.damageVehicle(target, Math.max(0, damage - TUNING.meleeVehicleFloor) * TUNING.meleeVehicleScale, attacker, best.point);
      return target;
    }
    ctx.audio.play('punch', { at: best.point });
    const knock = Math.min(TUNING.meleeKnockMax, Math.max(TUNING.meleeKnockMin, damage * TUNING.meleeKnock));
    target.velocity.addScaledVector(forward, knock);
    this.damageActor(target, { amount: damage, kind: 'melee', source: attacker, point: best.point, direction: forward });
    return target;
  }

  // ───────────── Explosions ─────────────

  explode(position: THREE.Vector3, radius: number, damage: number, source: Actor | null = null): void {
    const { ctx } = this;
    const centre = position.clone();
    const core = TUNING.explosionCore;
    const eye = new THREE.Vector3(centre.x, centre.y + 0.4, centre.z);

    for (const actor of ctx.actors.all) {
      if (!actor.alive || actor.vehicle) continue;
      _a.set(actor.position.x, actor.position.y + 0.9, actor.position.z);
      const distance = _a.distanceTo(centre);
      let force = explosionFalloff(distance, radius, core);
      if (force <= 0) continue;
      // A wall in the way takes most of it.
      if (!ctx.physics.lineOfSight(eye, _a)) force *= TUNING.explosionCover;
      const away = distance > 0.05 ? _a.clone().sub(centre).multiplyScalar(1 / distance) : new THREE.Vector3(0, 1, 0);
      actor.velocity.addScaledVector(away, TUNING.explosionKnock * force);
      this.damageActor(actor, { amount: damage * force, kind: 'explosion', source, point: _a.clone(), direction: away });
    }

    const vehicles = ctx.vehicles.all;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const vehicle = vehicles[i];
      if (!vehicle) continue;
      _a.subVectors(vehicle.position, centre);
      const distance = _a.length();
      const force = explosionFalloff(Math.max(0, distance - vehicle.spec.length * 0.35), radius, core);
      if (force <= 0) continue;
      // The vehicle that is itself exploding sits at the centre and throws itself.
      if (distance > 0.6) {
        _a.multiplyScalar(1 / distance);
        const push = vehicle.spec.mass * TUNING.explosionPush * force;
        const lift = vehicle.spec.mass * TUNING.explosionLift * force;
        vehicle.body.applyImpulse({ x: _a.x * push, y: Math.max(0, _a.y) * push + lift, z: _a.z * push }, true);
        vehicle.body.applyTorqueImpulse({ x: -_a.z * lift * 0.4, y: 0, z: _a.x * lift * 0.4 }, true);
      }
      this.damageVehicle(vehicle, damage * force * TUNING.explosionVehicleScale, source, centre);
    }

    this.fx.explosion(centre, radius);
    ctx.audio.play('explosion', { at: centre });
    const player = ctx.player;
    const distance = player.position.distanceTo(centre);
    const shake = explosionShake(distance, radius);
    if (shake > 0) player.shakeCamera(shake);
    // White-out for a near miss; when the blast hurt the player their own red flash stands.
    const glare = 1 - distance / (radius * 6);
    if (glare > 0.03 && (distance > radius || player.vehicle)) ctx.gfx.flash(0xfff0c8, 0.55 * glare, 0.3);
  }

  // ───────────── Models and pickups ─────────────

  createWeaponModel(weaponId: string): THREE.Object3D | null {
    return this.models.held(weaponId);
  }

  spawnPickup(kind: string, x: number, z: number, amount?: number, respawnSeconds?: number): () => void {
    return this.pickups.spawn(kind, x, z, amount, respawnSeconds);
  }

  // ───────────── The player ─────────────

  update(dt: number) {
    this.updatePlayer(dt);
    this.pickups.update(dt);
    this.fx.update(dt);
  }

  /**
   * Runs after the chase camera has placed itself for this frame: lay the view kick on top. The
   * camera is rebuilt from scratch every frame, so this never accumulates; the next shot is aimed
   * through the kicked view, which is what muzzle climb is.
   */
  lateUpdate(dt: number) {
    if (this.kickPitch < 1e-4 && Math.abs(this.kickYaw) < 1e-4) {
      this.kickPitch = this.kickYaw = 0;
      return;
    }
    const camera = this.ctx.camera;
    camera.rotateX(this.kickPitch);
    camera.rotateY(this.kickYaw);
    if (this.ctx.clock.paused) return;
    const keep = Math.exp(-TUNING.kickDecay * dt);
    this.kickPitch *= keep;
    this.kickYaw *= keep;
  }

  private updatePlayer(dt: number) {
    const { ctx, inv } = this;
    const player = ctx.player;
    const input = ctx.input;
    inv.update(dt);
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;
    if (this.stance > 0) this.stance -= dt;

    const free = player.alive && player.controlsEnabled && !ctx.ui.menuOpen;
    const vehicle = player.vehicle;

    if (free) {
      if (input.pressed('nextWeapon')) this.cycle(1);
      else if (input.pressed('prevWeapon')) this.cycle(-1);
    }
    const spec = this.current;
    const ranged = isRanged(spec);
    player.aiming = free && ranged && input.held('aim') && (!vehicle || spec.driveBy);

    // A swing already under way lands on time.
    if (this.swinging && (this.swingTime -= dt) <= 0) {
      this.swinging = false;
      if (player.alive && !player.vehicle && this.melee(player, this.swingDamage, this.swingReach)) player.shakeCamera(0.07);
    }

    if (free) {
      if (!vehicle) {
        // In a car the same key changes the radio station, and an empty clip reloads itself.
        if (input.pressed('reload')) inv.startReload();
        if (input.pressed('melee')) this.startSwing(spec.kind === 'melee' ? spec : this.weapons.get('fists')!);
      }
      if (spec.automatic ? input.held('fire') : input.pressed('fire')) {
        if (!ranged) {
          if (!vehicle) this.startSwing(spec);
        } else if (vehicle && !spec.driveBy) {
          // Reach for something that can be fired from the driver's seat.
          const sidearm = WEAPON_ORDER.find((id) => this.weapons.get(id)!.driveBy && inv.has(id));
          if (sidearm) {
            this.select(sidearm);
            this.fireQueued = TUNING.fireBuffer + 0.35;
          }
        } else this.fireQueued = TUNING.fireBuffer;
      }
      if (this.fireQueued > 0) {
        this.fireQueued -= dt;
        const now = this.current;
        if (!isRanged(now) || (vehicle && !now.driveBy)) this.fireQueued = 0;
        else {
          const result = inv.tryFire();
          if (result === 'fired') {
            this.fireQueued = 0;
            this.playerShot(now);
          } else if (result === 'empty') {
            this.fireQueued = 0;
            ctx.audio.play('empty', { at: player.position });
          }
        }
      }
    } else this.fireQueued = 0;

    this.syncHeld(dt);
  }

  private startSwing(spec: WeaponSpec) {
    if (this.meleeCooldown > 0 || this.swinging) return;
    this.meleeCooldown = 1 / spec.rate;
    this.swinging = true;
    this.swingTime = TUNING.meleeHitDelay;
    this.swingDamage = spec.damage;
    this.swingReach = spec.range;
    this.ctx.player.playAction('punch', 0.35);
  }

  /** The player's trigger pull (the round has already left the clip). */
  private playerShot(spec: WeaponSpec) {
    const { ctx } = this;
    const player = ctx.player;
    const feel = feelOf(spec.id);
    const vehicle = player.vehicle;
    player.aimDirection(_aim);
    let spread: number;

    if (vehicle) {
      // Drive-by: out of the window nearest to where the camera looks, level with the car.
      const q = vehicle.group.quaternion;
      _up.set(0, 1, 0).applyQuaternion(q);
      _fwd.set(0, 0, 1).applyQuaternion(q);
      _left.set(1, 0, 0).applyQuaternion(q);
      _dir.copy(_aim).addScaledVector(_up, -_aim.dot(_up));
      if (_dir.lengthSq() < 1e-4) _dir.copy(_fwd);
      else _dir.normalize();
      vehicle.seatPosition(_origin, 0);
      if (vehicle.spec.cls === 'bike') _origin.addScaledVector(_up, 0.6).addScaledVector(_dir, 0.5);
      else {
        // The driver sits on the right: shoot out of that window unless the target is well to the left.
        const side = _dir.dot(_left) > 0.35 ? 1 : -1;
        const seat = _a.subVectors(_origin, vehicle.position).dot(_left);
        _origin
          .addScaledVector(_left, side * (vehicle.spec.width / 2 + 0.18) - seat)
          .addScaledVector(_up, 0.5)
          .addScaledVector(_fwd, 0.25);
      }
      spread = TUNING.driveBySpread;
    } else {
      player.humanoid.handPosition(_origin).addScaledVector(_aim, feel.barrel);
      // A barrel poked through a wall hits the wall.
      _chest.set(player.position.x, player.position.y + 1.35, player.position.z);
      _a.subVectors(_origin, _chest);
      const reach = _a.length();
      if (reach > 0.05) {
        const wall = ctx.physics.raycast(_chest, _a.multiplyScalar(1 / reach), reach, { mask: CollisionGroup.World });
        if (wall) _origin.copy(wall.point).addScaledVector(_a, -0.06);
      }
      // Find what the crosshair is on, starting level with the muzzle so nothing behind the player
      // is picked, then shoot from the muzzle at that point.
      const along = Math.max(0, _a.subVectors(_origin, ctx.camera.position).dot(_aim));
      _start.copy(ctx.camera.position).addScaledVector(_aim, along);
      const seen = ctx.physics.raycast(_start, _aim, spec.range, { excludeOwner: player });
      if (seen) _dir.subVectors(seen.point, _origin);
      else _dir.copy(_start).addScaledVector(_aim, spec.range).sub(_origin);
      const length = _dir.length();
      if (length < 0.75 || _dir.dot(_aim) < 0.3 * length) _dir.copy(_aim);
      else _dir.multiplyScalar(1 / length);
      spread = player.aiming ? TUNING.aimSpread : TUNING.hipSpread;
      if (!player.aiming) {
        // From the hip: swing round to face the shot and bring the gun up for a moment.
        player.heading = Math.atan2(_aim.x, _aim.z);
        player.playAction(isLongGun(spec) ? 'aimRifle' : 'aim', TUNING.hipFireStance);
        this.stance = TUNING.hipFireStance;
      }
    }
    // Recoil: a jolt through the camera rig and a snap upwards that springs back (see lateUpdate).
    const kick = feel.kick * (vehicle ? TUNING.kickDriveBy : 1);
    this.kickPitch += kick;
    this.kickYaw += (Math.random() * 2 - 1) * kick * TUNING.kickYaw;
    player.shakeCamera(feel.recoil);
    this.shoot(player, spec, _origin, _dir, spread);
  }

  /** Keep the right model in the player's hand, pointing down the sights when aiming. */
  private syncHeld(dt: number) {
    const player = this.ctx.player;
    const want = player.vehicle ? null : this.current.id;
    if (want !== this.heldId) {
      this.heldId = want;
      this.held = want ? this.playerModel(want) : null;
      player.humanoid.setHeld(this.held ? this.held.root : null);
      this.align = 0;
    }
    const held = this.held;
    if (!held || !held.ranged) return;
    const raised = player.alive && (player.aiming || this.stance > 0);
    this.align = damp(this.align, raised ? 1 : 0, TUNING.aimAlignRate, dt);
    if (this.align < 0.003) {
      held.inner.quaternion.copy(held.carry);
      return;
    }
    // Whatever the arm is doing, the barrel lies on the aim line: weapon +z along it, +y up.
    player.aimDirection(_aim);
    _qa.setFromRotationMatrix(_m.lookAt(_aim, ZERO, UP));
    held.root.getWorldQuaternion(_qb);
    _qb.invert().multiply(_qa);
    held.inner.quaternion.copy(held.carry).slerp(_qb, this.align);
  }

  private playerModel(id: string): HeldModel | null {
    let model = this.playerModels.get(id);
    if (model === undefined) {
      const root = this.models.held(id);
      if (!root) model = null;
      else {
        const fit = HAND_FIT[id];
        const inner = root.children[0];
        const carry = new THREE.Quaternion().setFromEuler(new THREE.Euler(-((fit?.tilt ?? 0) + feelOf(id).carryTilt), 0, fit?.roll ?? 0));
        inner.quaternion.copy(carry);
        model = { root, inner, carry, ranged: isRanged(this.weapons.get(id)!) };
      }
      this.playerModels.set(id, model);
    }
    return model;
  }

  dispose() {
    this.pickups.dispose();
    this.fx.dispose();
  }
}

export function createCombat(ctx: GameContext): CombatApi & System {
  return new Combat(ctx);
}
