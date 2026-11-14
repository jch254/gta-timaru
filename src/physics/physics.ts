// The standalone build keeps the WebAssembly as its own file (about a third of the download of the
// base64 'compat' bundle). The API is identical, so the public types still come from the compat package.
import * as RAPIER_RUNTIME from '@dimforge/rapier3d';
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CollisionGroup, type Actor, type PhysicsApi, type RayHit, type Vehicle } from '../core/types';

const R = RAPIER_RUNTIME as unknown as typeof RAPIER;

const ALL = CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character | CollisionGroup.Debris;

export class Physics implements PhysicsApi {
  rapier = R;
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  private owners = new Map<number, Actor | Vehicle>();
  private ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private tmp = new THREE.Vector3();

  static async create(): Promise<Physics> {
    const p = new Physics();
    p.world = new R.World({ x: 0, y: -9.81, z: 0 });
    p.world.timestep = 1 / 60;
    p.events = new R.EventQueue(true);
    return p;
  }

  groups(memberships: number, filter: number): number {
    return ((memberships & 0xffff) << 16) | (filter & 0xffff);
  }

  setOwner(collider: RAPIER.Collider, owner: Actor | Vehicle | null) {
    if (owner) this.owners.set(collider.handle, owner);
    else this.owners.delete(collider.handle);
  }

  ownerOf(collider: RAPIER.Collider): Actor | Vehicle | null {
    return this.owners.get(collider.handle) ?? null;
  }

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    options: { mask?: number; excludeBody?: RAPIER.RigidBody | null; excludeOwner?: Actor | Vehicle | null } = {},
  ): RayHit | null {
    const mask = options.mask ?? CollisionGroup.World | CollisionGroup.Vehicle | CollisionGroup.Character;
    this.ray.origin = origin;
    this.ray.dir = direction;
    const exclude = options.excludeOwner;
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      R.QueryFilterFlags.EXCLUDE_SENSORS,
      this.groups(ALL, mask),
      undefined,
      options.excludeBody ?? undefined,
      exclude ? (c: RAPIER.Collider) => this.owners.get(c.handle) !== exclude : undefined,
    );
    if (!hit) return null;
    return {
      point: new THREE.Vector3().copy(origin).addScaledVector(direction, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: hit.timeOfImpact,
      collider: hit.collider,
      owner: this.ownerOf(hit.collider),
    };
  }

  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = this.tmp.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-3) return true;
    dir.multiplyScalar(1 / len);
    this.ray.origin = a;
    this.ray.dir = dir;
    return !this.world.castRay(this.ray, len, true, R.QueryFilterFlags.EXCLUDE_SENSORS, this.groups(ALL, CollisionGroup.World));
  }

  addStaticBox(center: THREE.Vector3, halfExtents: THREE.Vector3, heading: number): () => void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    const desc = R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation(q)
      .setCollisionGroups(this.groups(CollisionGroup.World, ALL));
    const collider = this.world.createCollider(desc);
    return () => this.world.removeCollider(collider, false);
  }

  step() {
    this.world.step(this.events);
  }
}
