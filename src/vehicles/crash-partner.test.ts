import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { CollisionGroup, type Actor, type GameContext, type GameEvents, type Vehicle, type VehicleModel } from '../core/types';
import { createPolice } from '../police';
import { HeatModel } from '../police/heat';
import { VEHICLE_SPECS } from './specs';
import { VehicleImpl } from './vehicle';

beforeAll(async () => { await R.init(); });
afterEach(() => vi.restoreAllMocks());

it.each([
  { hitPatrol: true, witnessed: false, charge: 'vehicleDamage' },
  { hitPatrol: false, witnessed: false, charge: null },
  { hitPatrol: false, witnessed: true, charge: 'recklessDriving' },
])('attributes a simulated impact: hitPatrol=$hitPatrol, witnessed=$witnessed', ({ hitPatrol, witnessed, charge }) => {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  try {
    const owners = new Map<number, Vehicle | Actor>();
    const groups = (a: number, b: number) => (a << 16) | b;
    const solid = groups(CollisionGroup.World, CollisionGroup.Vehicle);
    world.createCollider(R.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, -1, 0).setCollisionGroups(solid));
    const events = new EventBus<GameEvents>();
    const cars: VehicleImpl[] = [];
    const player = { vehicle: null as Vehicle | null, position: new THREE.Vector3() };
    const ctx = {
      scene: new THREE.Scene(), env: { wetness: 0 }, events, vehicles: { all: cars }, player, save: { register() {} },
      world: { surfaceAt: () => 'road', waterDepthAt: () => 0 },
      physics: { world, rapier: R, groups, setOwner: (c: R.Collider, owner: Vehicle) => owners.set(c.handle, owner),
        ownerOf: (c: R.Collider) => owners.get(c.handle) ?? null },
    } as unknown as GameContext;
    const spec = VEHICLE_SPECS.find(s => s.wheelCount === 4)!;
    function spawn(x: number, z: number) {
      const model = { group: new THREE.Group(), wheels: [], seats: [] } as unknown as VehicleModel;
      const car = new VehicleImpl(cars.length, spec, model, 0, ctx, x, 0, z, 0);
      cars.push(car);
      return car;
    }
    const mine = spawn(0, -25);
    const patrol = spawn(hitPatrol ? 0 : spec.width + 0.5, 0);
    if (!hitPatrol) world.createCollider(R.ColliderDesc.cuboid(1, 2, 0.5).setTranslation(0, 1, 0).setCollisionGroups(solid));
    player.vehicle = mine;
    // Isolate the collision response from unit dispatch, sight timers and heat side effects.
    const police = createPolice(ctx) as unknown as { force: { units: { vehicle: Vehicle }[] }; seenNearAt: number };
    police.force.units.push({ vehicle: patrol });
    if (witnessed) police.seenNearAt = 0;
    const report = vi.spyOn(HeatModel.prototype, 'report').mockReturnValue(false);
    const impacts: GameEvents['vehicleCrash'][] = [];
    events.on('vehicleCrash', e => impacts.push(e));
    mine.body.setLinvel({ x: 0, y: 0, z: 22 }, true);
    for (let i = 0; i < 150 && !impacts.length; i++) {
      for (const car of cars) car.fixedUpdate(1 / 60);
      world.step();
      for (const car of cars) car.update(1 / 60);
    }
    const crash = impacts.find(e => e.vehicle === mine);
    expect(crash?.speed).toBeGreaterThan(4);
    expect(crash?.other).toBe(hitPatrol ? patrol : null);
    if (hitPatrol) expect(impacts.find(e => e.vehicle === patrol)?.other).toBe(mine);
    else expect(mine.position.distanceTo(patrol.position)).toBeLessThan(spec.length / 2 + 3.4);
    expect([...new Set(report.mock.calls.map(([crime]) => crime))]).toEqual(charge ? [charge] : []);
  } finally {
    world.free();
  }
});
