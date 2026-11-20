import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { AutopilotImpl } from '../ai/autopilot';
import { JunctionBook } from '../ai/junction';
import { laneOffset, lanePointInto, makePoint, projectOnEdge, projection } from '../ai/lanes';
import { buildGraph } from '../ai/testgraph';
import { Rng } from '../core/rng';
import { CollisionGroup, type GameContext, type GroundSurface, type VehicleModel } from '../core/types';
import { VEHICLE_SPECS } from './specs';
import { VehicleImpl } from './vehicle';

const dt = 1 / 60;
const graph = buildGraph([{ pts: Array.from({ length: 61 }, (_, i): [number, number] => [100 * (1 - Math.cos(i / 30)), 100 * Math.sin(i / 30)]) }]);
const edge = graph.edges[0];
const sedan = VEHICLE_SPECS.find(s => s.id === 'corolla')!;
const worlds: R.World[] = [];
beforeAll(async () => { await R.init(); });
afterEach(() => { for (const world of worlds.splice(0)) world.free(); });

function setup(wetness: number, surface: GroundSurface = 'road', grip = sedan.grip) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  const groups = (a: number, b: number) => (a << 16) | b;
  world.createCollider(R.ColliderDesc.cuboid(250, 1, 250).setTranslation(0, -1, 0).setCollisionGroups(groups(CollisionGroup.World, CollisionGroup.Vehicle)));
  const clock = { elapsed: 0 };
  const ctx = {
    clock, scene: new THREE.Scene(), vehicles: { all: [] }, env: { wetness }, events: { emit() {} },
    world: { graph, groundAt: () => 0, surfaceAt: () => surface, waterDepthAt: () => 0 },
    physics: { world, rapier: R, groups, setOwner() {}, ownerOf: () => null },
  } as unknown as GameContext;
  const p = makePoint();
  lanePointInto(edge, 8, 1, 0, 0, p);
  const model = { group: new THREE.Group(), wheels: [], seats: [] } as unknown as VehicleModel;
  const car = new VehicleImpl(1, { ...sedan, grip }, model, 0, ctx, p.x, 0, p.z, Math.atan2(p.tx, p.tz));
  const step = () => { car.fixedUpdate(dt); world.step(); car.update(dt); clock.elapsed += dt; };
  for (let i = 0; i < 60; i++) step();
  expect(car.wheelsOnGround).toBe(4);
  const pilot = new AutopilotImpl(car, { ctx, book: new JunctionBook(), rng: new Rng(21), walkers: [] });
  pilot.setRoute([{ edge, dir: 1 }], 8);
  return { car, pilot, step };
}

it('keeps parking lock and reduces moving lock with speed, wetness, loose surface and weaker tyres', () => {
  function lock(speed: number, wetness: number, surface: GroundSurface = 'road', grip = sedan.grip) {
    const { car } = setup(wetness, surface, grip);
    car.body.setLinvel({ x: speed * Math.sin(car.heading), y: 0, z: speed * Math.cos(car.heading) }, true);
    car.fixedUpdate(dt);
    return car.steeringLimit;
  }
  expect(lock(0, 1, 'gravel')).toBe(sedan.steerLock);
  const dry = lock(18, 0);
  expect(dry).toBeLessThan(lock(10, 0));
  expect(lock(-18, 0)).toBeCloseTo(dry);
  expect(lock(18, 1)).toBeLessThan(dry);
  expect(lock(18, 0, 'gravel')).toBeLessThan(dry);
  expect(lock(18, 0, 'road', sedan.grip * 0.8)).toBeLessThan(dry);
});

it.each([0, 1])('tracks a 100 m radius lane with the real rig at wetness %i', wetness => {
  const { car, pilot, step } = setup(wetness);
  let worst = 0;
  let samples = 0;
  let squared = 0;
  for (let i = 0; i < 60 * 14 && pilot.s < 150; i++) {
    pilot.update(dt);
    step();
    if (car.speed < 10) continue;
    projectOnEdge(edge, car.position.x, car.position.z, pilot.s);
    const error = Math.abs(projection.offset - laneOffset(edge, 0));
    worst = Math.max(worst, error);
    squared += error * error;
    samples++;
  }

  expect(pilot.s).toBeGreaterThanOrEqual(150);
  expect(samples).toBeGreaterThan(300);
  expect(Math.sqrt(squared / samples)).toBeLessThan(0.25);
  expect(worst).toBeLessThan(0.5);
});
