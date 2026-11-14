import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { clamp } from '../core/math';
import { CollisionGroup, type GameContext, type PhysicsApi, type Vehicle } from '../core/types';
import type { PropDef } from './props';
import type { PropPhysics } from './props/physics';

/** One prop instance a vehicle can knock over. */
export interface Breakable {
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  tint?: number;
  /** Footprint half-extents along the prop's own x and z, and its height. */
  hx: number;
  hz: number;
  height: number;
  rule: PropPhysics;
  def: PropDef;
  /** The instanced meshes it is drawn by (one per part) and its slot in them. */
  meshes: THREE.InstancedMesh[];
  index: number;
  collider: RAPIER.Collider | null;
  broken: boolean;
}

interface Debris {
  body: RAPIER.RigidBody;
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  life: number;
}

const CELL = 32;
const MAX_DEBRIS = 18;
const DEBRIS_SECONDS = 22;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/**
 * Street furniture, poles and fences that give way to a fast vehicle. Until then they are ordinary static
 * colliders. A vehicle about to hit one at or above its break speed has the prop swapped for a tumbling
 * piece of debris a moment before contact, and pays for it with some of its speed.
 */
export class Breakables {
  private cells = new Map<number, Breakable[]>();
  private byChunk = new Map<number, Breakable[]>();
  private debris: Debris[] = [];
  private ctx: GameContext | null = null;

  constructor(
    private root: THREE.Object3D,
    private physics: PhysicsApi,
    /** The prop's static collider has been removed from the physics world (so its chunk can forget it). */
    private onBroken: (b: Breakable, chunk: number) => void,
  ) {}

  attach(ctx: GameContext) {
    this.ctx = ctx;
  }

  add(chunk: number, b: Breakable) {
    const key = cellKey(b.x, b.z);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(b);
    let list = this.byChunk.get(chunk);
    if (!list) this.byChunk.set(chunk, (list = []));
    list.push(b);
  }

  /** The chunk is being unloaded (its colliders and meshes go with it). */
  dropChunk(chunk: number) {
    const list = this.byChunk.get(chunk);
    if (!list) return;
    this.byChunk.delete(chunk);
    for (const b of list) {
      const key = cellKey(b.x, b.z);
      const cell = this.cells.get(key);
      if (!cell) continue;
      const i = cell.indexOf(b);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) this.cells.delete(key);
    }
  }

  private chunkOf(b: Breakable): number {
    for (const [chunk, list] of this.byChunk) if (list.includes(b)) return chunk;
    return -1;
  }

  /** Before the physics step: anything a fast vehicle is about to hit gives way. */
  fixedUpdate(dt: number) {
    const ctx = this.ctx;
    if (!ctx || !this.cells.size) return;
    for (const v of ctx.vehicles.all) {
      const speed = Math.hypot(v.velocity.x, v.velocity.z);
      if (speed < 2) continue;
      const hw = v.spec.width / 2 + 0.1;
      const hl = v.spec.length / 2 + 0.1;
      const look = dt * 2.5;
      const reach = hl + 2.6 + speed * look;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      // Velocity in the vehicle's own frame (x sideways, z forwards).
      const lvx = v.velocity.x * cos - v.velocity.z * sin;
      const lvz = v.velocity.x * sin + v.velocity.z * cos;
      // Light vehicles bounce off things a truck would flatten.
      const heft = clamp(Math.sqrt(1400 / v.spec.mass), 0.6, 2.2);
      const px = v.position.x;
      const pz = v.position.z;
      const x0 = Math.floor((px - reach) / CELL);
      const x1 = Math.floor((px + reach) / CELL);
      const z0 = Math.floor((pz - reach) / CELL);
      const z1 = Math.floor((pz + reach) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const cell = this.cells.get((cx + 4096) * 8192 + cz + 4096);
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const b = cell[i];
            if (b.broken || b.rule.breakSpeed === undefined || speed < b.rule.breakSpeed * heft) continue;
            const dx = b.x - px;
            const dz = b.z - pz;
            if (Math.abs(dx) > reach + b.hx || Math.abs(dz) > reach + b.hx) continue;
            if (v.position.y < b.y - 2.2 || v.position.y > b.y + b.height + 1.2) continue;
            if (this.touches(b, dx, dz, sin, cos, hw, hl, lvx * look, lvz * look)) this.smash(b, v, speed);
          }
        }
      }
    }
  }

  /** Does the prop's footprint meet the vehicle's box now or within the look-ahead? (All in the vehicle's frame.) */
  private touches(b: Breakable, dx: number, dz: number, sin: number, cos: number, hw: number, hl: number, mx: number, mz: number): boolean {
    const long = b.hx > b.hz * 1.5;
    const count = long ? Math.ceil((2 * b.hx) / 0.8) + 1 : 1;
    const r = long ? b.hz + b.hx / (count - 1) : Math.max(b.hx, b.hz);
    const ax = Math.cos(b.heading) * b.hx;
    const az = -Math.sin(b.heading) * b.hx;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const wx = dx + ax * t;
      const wz = dz + az * t;
      const lx = wx * cos - wz * sin;
      const lz = wx * sin + wz * cos;
      // The prop's position relative to the vehicle now, half-way through and at the end of the look-ahead.
      for (let k = 0; k <= 2; k++) {
        const qx = lx - mx * k * 0.5;
        const qz = lz - mz * k * 0.5;
        if (Math.abs(qx) < hw + r && Math.abs(qz) < hl + r) return true;
      }
    }
    return false;
  }

  private smash(b: Breakable, v: Vehicle, speed: number) {
    const ctx = this.ctx!;
    b.broken = true;
    if (b.collider) {
      this.physics.world.removeCollider(b.collider, false);
      b.collider = null;
    }
    for (const mesh of b.meshes) {
      mesh.setMatrixAt(b.index, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.onBroken(b, this.chunkOf(b));

    // What it costs the vehicle.
    const slow = Math.min(0.6, (b.rule.slow ?? 0.1) * clamp(1400 / v.spec.mass, 0.4, 2.2));
    const lv = v.body.linvel();
    v.body.setLinvel({ x: lv.x * (1 - slow), y: lv.y, z: lv.z * (1 - slow) }, true);
    // A big enough jolt is picked up by the vehicle's own crash detection (sound, damage, camera shake);
    // announce the small ones here so they are still heard.
    if (slow * speed <= 2.6) ctx.events.emit('vehicleCrash', { vehicle: v, speed: 2.8 + slow * speed, other: null });
    this.fling(b, v, speed);
  }

  private fling(b: Breakable, v: Vehicle, speed: number) {
    const R = this.physics.rapier;
    const group = new THREE.Group();
    const meshes: THREE.InstancedMesh[] = [];
    _m.makeScale(b.scale, b.scale, b.scale);
    for (const part of b.def.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
      mesh.setMatrixAt(0, _m);
      if (b.tint !== undefined) mesh.setColorAt(0, _c.set(b.tint));
      mesh.castShadow = b.def.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push(mesh);
    }
    _q.setFromAxisAngle(_up, b.heading);
    group.position.set(b.x, b.y, b.z);
    group.quaternion.copy(_q);
    this.root.add(group);

    const mass = b.rule.mass ?? 60;
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(b.x, b.y + 0.06, b.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0.15)
        .setAngularDamping(0.5),
    );
    this.physics.world.createCollider(
      R.ColliderDesc.cuboid(Math.max(b.hx, 0.07), b.height / 2, Math.max(b.hz, 0.07))
        .setTranslation(0, b.height / 2, 0)
        .setMass(mass)
        .setFriction(0.7)
        .setRestitution(0.15)
        .setCollisionGroups(this.physics.groups(CollisionGroup.Debris, CollisionGroup.World)),
      body,
    );
    // Carried along with the vehicle and tipped over in its direction of travel.
    const carry = clamp(0.62 - mass / 500, 0.12, 0.6);
    const dirX = v.velocity.x / speed;
    const dirZ = v.velocity.z / speed;
    const spin = clamp(speed * 0.22, 1.4, 6);
    // (Deterministic "random": a different tumble for each prop, the same every time.)
    const jitter = (((b.x * 12.9898 + b.z * 78.233) % 1) + 1) % 1;
    body.setLinvel({ x: v.velocity.x * carry, y: 1 + speed * 0.06, z: v.velocity.z * carry }, true);
    body.setAngvel({ x: dirZ * spin, y: (jitter - 0.5) * 3, z: -dirX * spin }, true);

    this.debris.push({ body, group, meshes, life: DEBRIS_SECONDS });
    while (this.debris.length > MAX_DEBRIS) this.remove(this.debris[0]);
  }

  private remove(d: Debris) {
    const i = this.debris.indexOf(d);
    if (i >= 0) this.debris.splice(i, 1);
    this.physics.world.removeRigidBody(d.body);
    this.root.remove(d.group);
    for (const mesh of d.meshes) mesh.dispose();
  }

  /** Per frame: debris follows its body, then is cleared away. */
  update(dt: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      const t = d.body.translation();
      if (d.life <= 0 || t.y < -50) {
        this.remove(d);
        continue;
      }
      const r = d.body.rotation();
      d.group.position.set(t.x, t.y, t.z);
      d.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
