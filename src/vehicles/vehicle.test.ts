import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CollisionGroup, type Actor, type GameContext, type VehicleModel } from '../core/types';
import { VEHICLE_SPECS } from './specs';
import { VehicleImpl } from './vehicle';

beforeAll(async () => { await R.init(); });
const worlds: R.World[] = [];
afterEach(() => { for (const w of worlds.splice(0)) w.free(); });

function setup() {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  const groups = (a: number, b: number) => (a << 16) | b;
  world.createCollider(R.ColliderDesc.cuboid(25, 1, 25).setTranslation(0, -1, 0).setCollisionGroups(groups(CollisionGroup.World, CollisionGroup.Vehicle)));
  const loaded = vi.fn((x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < 25);
  const ctx = {
    scene: new THREE.Scene(), env: { wetness: 0 }, events: { emit: vi.fn() }, vehicles: { all: [] },
    world: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, isLoaded: loaded,
      heightAt: () => 0, groundAt: () => 0, surfaceAt: () => 'road', waterDepthAt: () => 0 },
    physics: { world, rapier: R, groups, setOwner: vi.fn() },
  } as unknown as GameContext;
  const model = { group: new THREE.Group(), wheels: [] } as unknown as VehicleModel;
  const car = new VehicleImpl(1, VEHICLE_SPECS.find(s => s.wheelCount !== 2)!, model, 0, ctx, 3, 0, 5, 0.7);
  const tick = () => car.fixedUpdate(1 / 60);
  return { car, loaded, tick, settle: () => {
    for (let i = 0; i < 90; i++) { tick(); world.step(); }
    expect(car.wheelsOnGround).toBeGreaterThanOrEqual(2);
  } };
}

it.each(['edge', 'missing terrain'])('restores a passenger-occupied car at the %s without affecting normal motion', reason => {
  const { car, settle, tick } = setup();
  car.passengers.push({} as Actor);
  car.controls.throttle = 0.3;
  settle();
  const safe = car.body.translation();
  expect(Math.hypot(safe.x - 3, safe.z - 5)).toBeGreaterThan(1);
  // Airborne over unstreamed ground is not a failure and must not replace the checkpoint.
  car.body.setTranslation({ x: 80, y: 6, z: 0 }, true);
  tick();
  expect(car.body.translation().x).toBe(80);
  car.body.setTranslation({ x: reason === 'edge' ? 101 : 80, y: reason === 'edge' ? 6 : -4, z: 0 }, true);
  car.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  tick();
  expect(car.position.distanceTo(new THREE.Vector3().copy(safe))).toBeLessThan(0.5);
  expect(car.heading).toBeCloseTo(0.7, 1);
  expect(car.body.linvel()).toMatchObject({ x: 0, y: 0, z: 0 });
  expect(car.body.angvel()).toMatchObject({ x: 0, y: 0, z: 0 });
  expect(car.passengers).toHaveLength(1);
});

it('leaves an empty car alone; before first contact, clamps inside and waits for terrain', () => {
  const { car, tick, loaded } = setup();
  car.teleport(-110, 0, 150, 0);
  tick();
  expect(car.body.translation().x).toBe(-110);
  car.driver = {} as Actor;
  tick();
  expect(car.position).toMatchObject({ x: -92, z: 92 });
  tick();
  expect(car.body.isSleeping()).toBe(true);
  loaded.mockReturnValue(true);
  tick();
  expect(car.body.isSleeping()).toBe(false);
});
