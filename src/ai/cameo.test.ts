import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { DamageInfo, GameEvents, Humanoid } from '../core/types';
import type { Ped } from './ped';
import { PedsSystem } from './peds';
import { crossroads } from './testgraph';
import { makeSpec, makeTestWorld, type TestWorld } from './testworld';
import { TrafficSystem } from './traffic';
import { PEDS } from './tuning';

// The real rig needs a canvas; a stub that remembers every pose it was asked for is all these tests need.
const posed = new Map<Humanoid, Set<string>>();
vi.mock('../actors/humanoid', () => ({
  createHumanoid: (): Humanoid => {
    const seen = new Set<string>();
    const h: Humanoid = {
      group: new THREE.Group(),
      setPose(pose) {
        seen.add(pose);
      },
      update() {},
      setHeld() {},
      handPosition: (target) => target,
      dispose() {
        h.group.removeFromParent();
      },
    };
    posed.set(h, seen);
    return h;
  },
}));

const STEP = 1 / 30;

function setup() {
  const world = makeTestWorld(crossroads(), [makeSpec('statesman')]);
  const peds = new PedsSystem(world.ctx);
  const traffic = new TrafficSystem(world.ctx);
  (world.ctx as { peds: unknown }).peds = peds;
  (world.ctx as { traffic: unknown }).traffic = traffic;
  peds.init();
  traffic.init();
  peds.density = 0;
  traffic.density = 0;
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += STEP) {
      peds.update(STEP);
      traffic.update(STEP);
      world.tick(STEP);
      each?.();
    }
  };
  return { world, peds, run };
}

function record<K extends keyof GameEvents>(world: TestWorld, type: K): GameEvents[K][] {
  const seen: GameEvents[K][] = [];
  world.events.on(type, (e) => seen.push(e));
  return seen;
}

/** A cameo as the missions module spawns one: scripted, standing, persistent, invulnerable. */
function cameo(peds: PedsSystem, x: number, z: number, hits: DamageInfo[] = []) {
  return peds.spawn({ x, z, heading: 0, kind: 'scripted', behaviour: 'stand', persistent: true, name: 'The Warlock of the Square', invulnerable: true, onHit: (info) => hits.push(info) });
}

const posesOf = (ped: unknown) => posed.get((ped as { humanoid: Humanoid }).humanoid)!;

describe('cameos cannot be hurt', () => {
  it('bullets, blows and blasts change nothing: no damage, no death, no event, and the owner is told', () => {
    const { world, peds, run } = setup();
    const damaged = record(world, 'actorDamaged');
    const died = record(world, 'actorDied');
    const hits: DamageInfo[] = [];
    const star = cameo(peds, 8, 40, hits);
    expect(star.invulnerable).toBe(true);
    const blows: DamageInfo[] = [
      { amount: 25, kind: 'bullet', source: world.player },
      { amount: 12, kind: 'melee', source: world.player },
      { amount: 400, kind: 'explosion', source: null },
      { amount: 9999, kind: 'bullet', source: world.player },
      { amount: 50, kind: 'fire' },
      { amount: 50, kind: 'fall' },
    ];
    for (const blow of blows) star.takeDamage(blow);
    run(1);
    expect(star.health).toBe(100);
    expect(star.alive).toBe(true);
    expect(world.ctx.actors.all.has(star)).toBe(true);
    expect(damaged).toHaveLength(0);
    expect(died).toHaveLength(0);
    expect(hits).toEqual(blows);
    // Never laid out, never cowering, never squaring up.
    const poses = posesOf(star);
    expect(poses.has('dead')).toBe(false);
    expect(poses.has('cower')).toBe(false);
    expect(poses.has('punch')).toBe(false);
    expect(world.punches).toHaveLength(0);
  });

  it('the same blows put an ordinary pedestrian on the ground', () => {
    const { world, peds } = setup();
    const died = record(world, 'actorDied');
    const ordinary = peds.spawn({ x: 8, z: 40, behaviour: 'stand', persistent: true });
    expect(ordinary.invulnerable).toBeFalsy();
    ordinary.takeDamage({ amount: 9999, kind: 'bullet', source: world.player });
    expect(ordinary.alive).toBe(false);
    expect(died).toHaveLength(1);
  });

  it('a car at speed cannot run one down: they step clear, unhurt, and nobody is blamed', () => {
    const { world, peds, run } = setup();
    const crimes = record(world, 'crime');
    const damaged = record(world, 'actorDamaged');
    const star = cameo(peds, 2.4, 60);
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 30, 0)!;
    world.ctx.vehicles.enter(world.player, car, 0);
    car.controls.throttle = 0;
    (car as unknown as { speed: number }).speed = 22;
    let overlapped = false;
    run(3, () => {
      const dx = star.position.x - car.position.x;
      const dz = star.position.z - car.position.z;
      if (Math.abs(dx) < car.spec.width / 2 && Math.abs(dz) < car.spec.length / 2) overlapped = true;
    });
    // The car went through where they stood.
    expect(car.position.z).toBeGreaterThan(70);
    expect(overlapped).toBe(false);
    expect(Math.abs(star.position.x - 2.4)).toBeGreaterThan(1);
    expect(star.health).toBe(100);
    expect(star.alive).toBe(true);
    expect(damaged).toHaveLength(0);
    expect(crimes).toHaveLength(0);
    expect(posesOf(star).has('dead')).toBe(false);
  });

  it('even struck square on they are only bundled aside: no knock-down, no injury, no hit-and-run', () => {
    const { world, peds, run } = setup();
    const crimes = record(world, 'crime');
    const damaged = record(world, 'actorDamaged');
    const hits: DamageInfo[] = [];
    const star = cameo(peds, 2.4, 60, hits) as unknown as Ped;
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 57, 0)!;
    world.ctx.vehicles.enter(world.player, car, 0);
    (car as unknown as { speed: number }).speed = 20;
    car.velocity.set(0, 0, 20);
    star.struck(car, 20);
    expect(star.standing).toBe(true);
    expect(hits).toEqual([{ amount: 0, kind: 'vehicle', source: world.player }]);
    run(2.5);
    expect(star.health).toBe(100);
    expect(star.alive).toBe(true);
    expect(star.standing).toBe(true);
    expect(damaged).toHaveLength(0);
    expect(crimes).toHaveLength(0);
    expect(world.sounds).not.toContain('bodyHit');
    expect(posesOf(star).has('dead')).toBe(false);
    // Out of the car's way, and not far.
    expect(Math.abs(star.position.x - 2.4)).toBeGreaterThan(1);
    expect(Math.hypot(star.position.x - 2.4, star.position.z - 60)).toBeLessThan(9);
  });

  it('gunfire and crime next to them start no panic and no fight', () => {
    const { world, peds, run } = setup();
    const star = cameo(peds, 8, 40);
    world.player.position.set(9, 0, 42);
    world.events.emit('gunshot', { shooter: world.player, weaponId: 'pistol', position: new THREE.Vector3(9, 0, 42), direction: new THREE.Vector3(0, 0, 1) });
    world.events.emit('crime', { type: 'assault', position: new THREE.Vector3(8, 0, 40), offender: world.player, victim: star });
    star.takeDamage({ amount: 12, kind: 'melee', source: world.player });
    run(4);
    // Where they were put (the missions module decides whether they walk off), and not a word from the ambient barks.
    expect(Math.hypot(star.position.x - 8, star.position.z - 40)).toBeLessThan(0.01);
    expect(world.subtitles).toHaveLength(0);
    expect(world.punches).toHaveLength(0);
    expect(world.shots).toHaveLength(0);
  });

  it('are never swept up with the ambient crowd, and never chat like a passer-by', () => {
    const { world, peds, run } = setup();
    const star = cameo(peds, 8, 40);
    // The player stands beside them: ambient pedestrians would say gidday after a few seconds.
    world.player.position.set(8.5, 0, 41.5);
    run(PEDS.lingerSeconds + 3);
    expect(world.subtitles).toHaveLength(0);
    // The player leaves: an ambient pedestrian would be despawned.
    world.player.position.set(3000, 0, 3000);
    run(3);
    expect(peds.count).toBe(1);
    expect(world.ctx.actors.all.has(star)).toBe(true);
    star.remove();
    run(0.2);
    expect(peds.count).toBe(0);
  });

  it('hold a gesture for as long as they are asked to', () => {
    const { peds, run } = setup();
    const star = cameo(peds, 8, 40);
    star.gesture!('point', 1);
    run(0.5);
    expect(posesOf(star).has('point')).toBe(true);
    star.gesture!('handsUp', 0.5);
    run(0.3);
    expect(posesOf(star).has('handsUp')).toBe(true);
  });
});
