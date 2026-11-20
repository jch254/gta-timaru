import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../core/rng';
import type { Actor, GameContext, GameEvents, Humanoid, PedHandle, VehicleSpec } from '../core/types';
import { Vehicles } from '../vehicles';
import { PedsSystem } from './peds';
import { buildGraph, crossroads } from './testgraph';
import { makeSpec, makeTestWorld, type FakeVehicle, type TestWorld } from './testworld';
import { TrafficSystem } from './traffic';
import { PEDS, TRAFFIC } from './tuning';

// The real rig needs a canvas; a stub with the same interface is all these tests need.
const poses = new Map<Humanoid, string>();
vi.mock('../actors/humanoid', () => ({
  createHumanoid: (): Humanoid => {
    const h: Humanoid = {
      group: new THREE.Group(),
      setPose(pose) {
        poses.set(h, pose);
      },
      update() {},
      setHeld() {},
      handPosition: (target) => target,
      dispose() {
        h.group.removeFromParent();
      },
    };
    return h;
  },
}));

const STEP = 1 / 30;

function setup(graph = crossroads(), specs = [makeSpec('statesman')]) {
  const world = makeTestWorld(graph, specs);
  const peds = new PedsSystem(world.ctx);
  const traffic = new TrafficSystem(world.ctx);
  (world.ctx as { peds: unknown }).peds = peds;
  (world.ctx as { traffic: unknown }).traffic = traffic;
  peds.init();
  traffic.init();
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += STEP) {
      peds.update(STEP);
      traffic.update(STEP);
      world.tick(STEP);
      each?.();
    }
  };
  return { world, peds, traffic, run };
}

function record<K extends keyof GameEvents>(world: TestWorld, type: K): GameEvents[K][] {
  const seen: GameEvents[K][] = [];
  world.events.on(type, (e) => seen.push(e));
  return seen;
}

const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('ambient traffic', () => {
  it('fills the streets around the player with driven and parked cars, within budget', () => {
    const { world, traffic, run } = setup();
    world.player.position.set(0, 0, 60);
    run(40);
    const driven = world.vehicles.filter((v) => v.controller === 'traffic');
    const parked = world.vehicles.filter((v) => v.tags.has('parked'));
    expect(traffic.count).toBe(driven.length);
    expect(driven.length).toBeGreaterThanOrEqual(4);
    expect(driven.length).toBeLessThanOrEqual(TRAFFIC.movingPerDensity);
    expect(parked.length).toBeGreaterThanOrEqual(2);
    expect(parked.length).toBeLessThanOrEqual(TRAFFIC.parkedPerDensity);
    expect(world.vehicles.length).toBeLessThanOrEqual(TRAFFIC.vehicleBudget);
    for (const v of driven) {
      expect(v.driver).not.toBeNull();
      expect(v.driver!.vehicle).toBe(v);
      expect(finite(v.position)).toBe(true);
      // Drivers are not street actors.
      expect(world.ctx.actors.all.has(v.driver!)).toBe(false);
    }
    for (const v of parked) {
      expect(v.driver).toBeNull();
      expect(v.controller).toBe('none');
      expect(v.controls.handbrake).toBe(true);
      expect(Math.abs(v.speed)).toBeLessThan(0.01);
      // At the kerb: just inside the edge of the seal.
      const hit = world.ctx.world.graph.nearest(v.position.x, v.position.z, 30)!;
      expect(hit.distance).toBeGreaterThan(hit.edge.width / 2 - v.spec.width / 2 - 0.5);
      expect(hit.distance).toBeLessThan(hit.edge.width / 2);
    }
    // Traffic is actually moving, on the road.
    const moving = driven.filter((v) => v.speed > 3);
    expect(moving.length).toBeGreaterThanOrEqual(driven.length / 2);
    for (const v of driven) {
      const hit = world.ctx.world.graph.nearest(v.position.x, v.position.z, 60)!;
      expect(hit.distance).toBeLessThan(hit.edge.width / 2 + 1);
    }
  });

  it('spawns nothing close to the player or in front of the camera once settled', () => {
    const { world, run } = setup();
    world.player.position.set(0, 0, 0);
    world.player.cameraHeading = 0.4;
    run(TRAFFIC.seedSeconds + 2);
    const before = new Set(world.vehicles);
    const fresh: { d: number; ahead: number }[] = [];
    run(60, () => {
      for (const v of world.vehicles) {
        if (before.has(v)) continue;
        before.add(v);
        const d = Math.hypot(v.position.x, v.position.z);
        fresh.push({ d, ahead: (v.position.x * Math.sin(0.4) + v.position.z * Math.cos(0.4)) / d });
      }
    });
    for (const f of fresh) {
      expect(f.d).toBeGreaterThan(TRAFFIC.spawnMin - 25);
      if (f.d < TRAFFIC.coneFarDistance) expect(f.ahead).toBeLessThan(Math.cos(TRAFFIC.coneHalfAngle) + 0.02);
    }
  });

  it('scales with density and thins out at night', () => {
    const day = setup();
    day.world.player.position.set(0, 0, 60);
    day.run(40);
    const night = setup();
    night.world.player.position.set(0, 0, 60);
    night.world.ctx.clock.hour = 3.5;
    night.run(40);
    expect(night.traffic.count).toBeLessThan(day.traffic.count);
    const none = setup();
    none.traffic.density = 0;
    none.run(20);
    expect(none.world.vehicles.length).toBe(0);
  });

  it('removes cars left far behind, but never persistent ones or the player’s', () => {
    const { world, traffic, run } = setup();
    world.player.position.set(0, 0, 60);
    run(30);
    const kept = traffic.spawnDriver('statesman', 0, 40, { persistent: true, tags: ['mission'] })!;
    expect(kept).not.toBeNull();
    const mine = world.vehicles.find((v) => v.tags.has('parked'))!;
    world.ctx.vehicles.enter(world.player, mine, 0);
    expect(mine.tags.has('parked')).toBe(false);
    // Drive off a long way (the test world is "loaded" everywhere).
    mine.position.set(3000, 0.6, 3000);
    traffic.density = 0;
    run(3);
    expect(world.vehicles).toContain(mine);
    expect(world.vehicles).toContain(kept);
    expect(world.vehicles.filter((v) => v !== mine && v !== kept).length).toBe(0);
    expect(traffic.count).toBe(1);
    // Having got out and wandered off, the stolen car is tidied away too.
    world.ctx.vehicles.exit(world.player);
    world.player.position.set(0, 0, 0);
    run(2);
    expect(world.vehicles).not.toContain(mine);
    expect(world.vehicles).toContain(kept);
  });

  it('falls back to a spec that exists', () => {
    const { world, traffic } = setup();
    const v = traffic.spawnDriver('no-such-car', 2, 50)!;
    expect(v).not.toBeNull();
    expect(v.spec.id).toBe('statesman');
    expect(v.controller).toBe('traffic');
    // Keep left: spawned on the side of the road the point was on, heading the right way for it.
    expect(Math.cos(v.heading)).toBeGreaterThan(0.9);
    expect(traffic.spawnDriver('statesman', 5000, 5000)).toBeNull();
    expect(world.vehicles.length).toBe(1);
  });

  it('hands out one autopilot per vehicle', () => {
    const { world, traffic } = setup();
    const v = traffic.spawnDriver('statesman', 2, 50)!;
    const a = traffic.createAutopilot(v);
    expect(traffic.createAutopilot(v)).toBe(a);
    const other = world.ctx.vehicles.spawn('statesman', 30, 2, 0)!;
    const b = traffic.createAutopilot(other);
    expect(b).not.toBe(a);
    expect(b.vehicle).toBe(other);
  });

  it('puts a hijacked driver back on the street, running or fighting', () => {
    const { world, peds, traffic, run } = setup();
    world.player.position.set(0, 0, 60);
    traffic.density = 0;
    peds.density = 0;
    const v = traffic.spawnDriver('statesman', 2, 50)!;
    run(1);
    const driver = v.driver!;
    const before = peds.count;
    world.ctx.vehicles.enter(world.player, v, 0);
    expect(v.driver).toBe(world.player);
    expect(driver.vehicle).toBeNull();
    expect(peds.count).toBe(before + 1);
    expect(traffic.count).toBe(0);
    // The player now has the controls: traffic must not touch them.
    v.controls.throttle = 0.123;
    run(1);
    expect(v.controls.throttle).toBe(0.123);
    const onFoot = [...world.ctx.actors.all].filter((a) => a.kind === 'ped');
    expect(onFoot.length).toBe(1);
    expect(onFoot[0].position.distanceTo(v.position)).toBeLessThan(12);
  });

  it('drivers react to gunfire: most speed off, some bail out and run', () => {
    const { world, peds, traffic, run } = setup();
    world.player.position.set(0, 0, 0);
    traffic.density = 0;
    peds.density = 0;
    const cars = [];
    for (let i = 0; i < 12; i++) cars.push(traffic.spawnDriver('statesman', i % 2 ? 2 : -2, 40 + i * 5)!);
    // spawnDriver makes persistent-false cars here; they are ordinary drivers.
    run(0.5);
    world.events.emit('gunshot', { shooter: world.player, weaponId: 'pistol', position: new THREE.Vector3(0, 0, 60), direction: new THREE.Vector3(0, 0, 1) });
    run(6);
    const abandoned = cars.filter((v) => v.driver === null);
    const fleeing = cars.filter((v) => v.driver !== null);
    expect(abandoned.length).toBeGreaterThan(0);
    expect(fleeing.length).toBeGreaterThan(abandoned.length);
    expect(peds.count).toBe(abandoned.length);
    for (const v of abandoned) {
      expect(v.controller).toBe('none');
      expect(v.controls.handbrake).toBe(true);
    }
    // The rest have their foot down.
    for (const v of fleeing) expect(traffic.createAutopilot(v).aggression).toBeGreaterThanOrEqual(TRAFFIC.fleeAggression);
    expect(Math.max(...fleeing.map((v) => v.speed))).toBeGreaterThan(8);
    expect(world.sounds).toContain('doorOpen');
  });

  it('honks when stuck behind something', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 400]] }]);
    const { world, peds, traffic, run } = setup(graph);
    world.player.position.set(0, 0, 120);
    traffic.density = 0;
    peds.density = 0;
    const v = traffic.spawnDriver('statesman', 2, 20)!;
    // Somebody has left a car right across the road.
    const wreck = world.ctx.vehicles.spawn('statesman', 0.5, 110, Math.PI / 2)!;
    wreck.driver = {} as Actor;
    run(30);
    expect(world.vehicles).toContain(v);
    expect(v.position.z).toBeGreaterThan(90);
    expect(v.position.z).toBeLessThan(110 - 3);
    expect((v as unknown as { horns: number }).horns).toBeGreaterThanOrEqual(2);
    expect((v as unknown as { horns: number }).horns).toBeLessThan(10);
  });
});

describe('boy racers', () => {
  const avenues = () =>
    buildGraph([
      { name: 'Bealey Avenue', cls: 'arterial', pts: [[-300, -300], [300, -300]] },
      { name: 'Fitzgerald Avenue', cls: 'arterial', pts: [[300, -300], [300, 300]] },
      { name: 'Moorhouse Avenue', cls: 'arterial', pts: [[300, 300], [-300, 300]] },
      { name: 'Deans Avenue', cls: 'arterial', pts: [[-300, 300], [-300, -300]] },
      { name: 'Colombo Street', pts: [[0, -300], [0, 300]] },
    ]);

  it('lap the four avenues at night in fast cars', () => {
    const { world, traffic, run } = setup(avenues(), [makeSpec('statesman'), makeSpec('v8sedan', { topSpeed: 58 }), makeSpec('coupe', { topSpeed: 60 })]);
    world.player.position.set(-150, 0, 150);
    world.player.cameraHeading = Math.PI;
    world.ctx.clock.hour = 23;
    traffic.density = 1;
    run(3);
    const racers = world.vehicles.filter((v) => v.tags.has('racer'));
    expect(racers.length).toBeGreaterThanOrEqual(2);
    expect(racers.length).toBeLessThanOrEqual(4);
    for (const v of racers) {
      expect(['v8sedan', 'coupe']).toContain(v.spec.id);
      expect(v.controller).toBe('traffic');
    }
    // They stay on the avenues and go well over the 60 km/h limit.
    let fastest = 0;
    const names = new Set<string>();
    run(45, () => {
      for (const v of racers) {
        if (!world.vehicles.includes(v)) continue;
        fastest = Math.max(fastest, v.speed);
        const hit = world.ctx.world.graph.nearest(v.position.x, v.position.z, 40)!;
        expect(hit.distance).toBeLessThan(hit.edge.width / 2 + 1.5);
        names.add(hit.edge.name);
      }
    });
    expect(fastest).toBeGreaterThan((60 / 3.6) * 1.4);
    expect(names.has('Colombo Street')).toBe(false);
    expect(names.size).toBeGreaterThanOrEqual(2);
  });

  it('stay home by day, and when the avenues are not on the map', () => {
    const day = setup(avenues(), [makeSpec('statesman'), makeSpec('v8sedan')]);
    day.world.player.position.set(0, 0, 150);
    day.world.ctx.clock.hour = 14;
    day.run(20);
    expect(day.world.vehicles.some((v) => v.tags.has('racer'))).toBe(false);
    const elsewhere = setup(crossroads(), [makeSpec('statesman'), makeSpec('v8sedan')]);
    elsewhere.world.ctx.clock.hour = 23;
    elsewhere.run(20);
    expect(elsewhere.world.vehicles.some((v) => v.tags.has('racer'))).toBe(false);
  });

  it('make do with whatever cars exist', () => {
    const { world, run } = setup(avenues());
    world.player.position.set(0, 0, 150);
    world.player.cameraHeading = Math.PI;
    world.ctx.clock.hour = 23;
    run(20);
    const racers = world.vehicles.filter((v) => v.tags.has('racer'));
    expect(racers.length).toBeGreaterThanOrEqual(2);
    expect(racers[0].spec.id).toBe('statesman');
  });
});

describe('pedestrians', () => {
  it('populate the footpaths of a busy district, within budget', () => {
    const { world, peds, run } = setup();
    world.player.position.set(0, 0, 30);
    (world.ctx as unknown as { traffic: { density: number } }).traffic.density = 0;
    run(30);
    expect(peds.count).toBeGreaterThanOrEqual(15);
    expect(peds.count).toBeLessThanOrEqual(PEDS.budget);
    const walkers = [...world.ctx.actors.all].filter((a) => a.kind === 'ped');
    expect(walkers.length).toBe(peds.count);
    let onFootpath = 0;
    let walking = 0;
    for (const a of walkers) {
      expect(finite(a.position)).toBe(true);
      expect(a.alive).toBe(true);
      const hit = world.ctx.world.graph.nearest(a.position.x, a.position.z, 40)!;
      if (hit.distance > hit.edge.width / 2 && hit.distance < hit.edge.width / 2 + 3.3) onFootpath++;
      if (a.velocity.length() > 0.8) walking++;
      expect(a.velocity.length()).toBeLessThan(2.2);
    }
    // Nearly everyone is on a footpath (a few are crossing or rounding a corner); most are on the move.
    expect(onFootpath / walkers.length).toBeGreaterThan(0.75);
    expect(walking / walkers.length).toBeGreaterThan(0.4);
  });

  it('are scarce in the country and at night', () => {
    const rural = setup();
    rural.world.setDistrict('rural');
    rural.world.player.position.set(0, 0, 30);
    rural.run(30);
    expect(rural.peds.count).toBeLessThanOrEqual(3);
    const night = setup();
    night.world.ctx.clock.hour = 2;
    night.world.player.position.set(0, 0, 30);
    night.run(30);
    expect(night.peds.count).toBeLessThanOrEqual(7);
    const empty = setup();
    empty.peds.density = 0;
    empty.run(15);
    expect(empty.peds.count).toBe(0);
  });

  it('despawn when left behind, except persistent ones', () => {
    const { world, peds, run } = setup();
    world.player.position.set(0, 0, 30);
    run(20);
    const keeper = peds.spawn({ x: 8, z: 40, behaviour: 'stand', persistent: true, name: 'Keeper' });
    expect(peds.count).toBeGreaterThan(5);
    world.player.position.set(2000, 0, 2000);
    peds.density = 0;
    run(2);
    expect(peds.count).toBe(1);
    expect(world.ctx.actors.all.has(keeper)).toBe(true);
    keeper.remove();
    run(0.2);
    expect(peds.count).toBe(0);
    expect(world.ctx.actors.all.has(keeper)).toBe(false);
  });

  it('run or cower when shots are fired nearby, and calm down afterwards', () => {
    const { world, peds, run } = setup();
    world.player.position.set(0, 0, 30);
    run(25);
    const walkers = [...world.ctx.actors.all].filter((a) => a.kind === 'ped');
    world.events.emit('gunshot', { shooter: world.player, weaponId: 'pistol', position: new THREE.Vector3(0, 0, 30), direction: new THREE.Vector3(0, 0, 1) });
    peds.density = 0;
    run(2);
    const near = walkers.filter((a) => a.alive && Math.hypot(a.position.x, a.position.z - 30) < 70);
    const running = near.filter((a) => a.velocity.length() > 3.5);
    expect(running.length).toBeGreaterThan(near.length * 0.4);
    // Runners are getting further from the shot.
    const before = running.map((a) => Math.hypot(a.position.x, a.position.z - 30));
    run(2);
    let further = 0;
    running.forEach((a, i) => {
      if (Math.hypot(a.position.x, a.position.z - 30) > before[i]) further++;
    });
    expect(further / running.length).toBeGreaterThan(0.7);
    expect(world.subtitles.length).toBeGreaterThan(0);
  });

  it('are knocked down by a fast car; the player is blamed once', () => {
    const { world, peds, traffic, run } = setup();
    const crimes = record(world, 'crime');
    const damaged = record(world, 'actorDamaged');
    const died = record(world, 'actorDied');
    peds.density = 0;
    traffic.density = 0;
    // This one does not see it coming.
    const dodgeChance = PEDS.dodgeChance;
    PEDS.dodgeChance = 0;
    const victim = peds.spawn({ x: 2.4, z: 60, behaviour: 'stand', persistent: true });
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 40, 0)!;
    world.ctx.vehicles.enter(world.player, car, 0);
    car.controls.throttle = 0;
    (car as unknown as { speed: number }).speed = 9;
    // The driver stops dead the moment they hit someone.
    run(3, () => {
      if (damaged.length) (car as unknown as { speed: number }).speed = 0;
    });
    expect(damaged.length).toBeGreaterThanOrEqual(1);
    expect(damaged[0].actor).toBe(victim);
    expect(damaged[0].info.kind).toBe('vehicle');
    expect(damaged[0].info.source).toBe(world.player);
    expect(crimes.filter((c) => c.type === 'hitAndRun').length).toBe(1);
    expect(crimes[0].victim).toBe(victim);
    expect(world.sounds).toContain('bodyHit');
    // 9 m/s is survivable if the car stops: they get up again.
    expect(victim.alive).toBe(true);
    expect(victim.health).toBeLessThan(100);
    expect(died.length).toBe(0);
    run(7);
    expect(victim.alive).toBe(true);
    // Run them down properly this time.
    car.position.set(victim.position.x, 0.6, victim.position.z - 25);
    car.heading = 0;
    (car as unknown as { speed: number }).speed = 24;
    run(2);
    expect(victim.alive).toBe(false);
    expect(victim.health).toBe(0);
    expect(died.length).toBe(1);
    expect(crimes.filter((c) => c.type === 'hitAndRun').length).toBe(1);
    expect(world.ctx.actors.all.has(victim)).toBe(false);
    expect(peds.count).toBe(0);
    // The body lies there for a while, then is cleared away.
    run(PEDS.corpseSeconds - 5);
    expect(victim.group.parent).not.toBeNull();
    run(8);
    expect(victim.group.parent).toBeNull();
    PEDS.dodgeChance = dodgeChance;
  });

  it('a car that keeps going runs over whoever it knocked flat: they do not get up', () => {
    const { world, peds, traffic, run } = setup();
    const crimes = record(world, 'crime');
    const died = record(world, 'actorDied');
    const hits = record(world, 'vehicleHitActor');
    peds.density = 0;
    traffic.density = 0;
    const dodgeChance = PEDS.dodgeChance;
    PEDS.dodgeChance = 0;
    try {
      const victim = peds.spawn({ x: 2.4, z: 60, behaviour: 'stand', persistent: true });
      const car = world.ctx.vehicles.spawn('statesman', 2.4, 40, 0)! as FakeVehicle;
      world.ctx.vehicles.enter(world.player, car, 0);
      run(4, () => ((car as unknown as { speed: number }).speed = 9));
      // Struck first, then the wheels went over them.
      expect(hits[0]).toMatchObject({ actor: victim, vehicle: car, under: false });
      expect(hits.filter((h) => h.under && h.actor === victim).length).toBeGreaterThanOrEqual(1);
      expect(victim.alive).toBe(false);
      expect(died.length).toBe(1);
      expect(died[0].info.kind).toBe('vehicle');
      expect(died[0].info.source).toBe(world.player);
      // One report for the lot.
      expect(crimes.filter((c) => c.type === 'hitAndRun').length).toBe(1);
      // The car felt it, and so did the driver.
      expect(car.impulses.some((i) => i.z < 0)).toBe(true); // the hit, against its travel
      expect(car.impulses.some((i) => i.y > 0)).toBe(true); // the bump going over
      expect(world.player.shakes.length).toBeGreaterThanOrEqual(2);
    } finally {
      PEDS.dodgeChance = dodgeChance;
    }
  });

  it('a hard hit throws the body up and on down the road, where it comes to rest', () => {
    const { world, peds, traffic, run } = setup();
    peds.density = 0;
    traffic.density = 0;
    const dodgeChance = PEDS.dodgeChance;
    PEDS.dodgeChance = 0;
    try {
      const victim = peds.spawn({ x: 2.4, z: 60, behaviour: 'stand', persistent: true });
      const car = world.ctx.vehicles.spawn('statesman', 2.4, 30, 0)!;
      car.driver = world.player;
      let highest = 0;
      let stopped = false;
      run(6, () => {
        // Brakes hard once they have killed someone, and stays stopped.
        if (!victim.alive) stopped = true;
        (car as unknown as { speed: number }).speed = stopped ? 0 : 22;
        highest = Math.max(highest, victim.group.position.y - victim.position.y);
      });
      expect(victim.alive).toBe(false);
      expect(highest).toBeGreaterThan(0.5); // through the air
      expect(victim.position.z).toBeGreaterThan(70); // well down the road from where they stood
      expect(victim.velocity.length()).toBe(0); // and still now
      expect(victim.group.position.y).toBeCloseTo(victim.position.y, 5); // lying on the ground
      const at = victim.position.clone();
      run(2);
      expect(victim.position.distanceTo(at)).toBe(0);
    } finally {
      PEDS.dodgeChance = dodgeChance;
    }
  });

  it('traffic rolls over a body lying in the road: a thump and a jolt, but the dead stay dead', () => {
    const { world, peds, traffic, run } = setup();
    const damaged = record(world, 'actorDamaged');
    const crimes = record(world, 'crime');
    const hits = record(world, 'vehicleHitActor');
    peds.density = 0;
    traffic.density = 0;
    const body = peds.spawn({ x: 2.4, z: 60, heading: 0, behaviour: 'stand', persistent: true });
    body.takeDamage({ amount: 999, kind: 'bullet', source: null });
    expect(body.alive).toBe(false);
    const before = damaged.length;
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 45, 0)! as FakeVehicle;
    car.driver = world.player;
    run(3, () => ((car as unknown as { speed: number }).speed = 8));
    const under = hits.filter((h) => h.actor === body && h.under);
    expect(under.length).toBeGreaterThanOrEqual(1);
    expect(under.length).toBeLessThanOrEqual(3); // front wheels and back, not every frame
    expect(car.impulses.some((i) => i.y > 0)).toBe(true);
    expect(damaged.length).toBe(before);
    expect(crimes.length).toBe(0);
    // Too slow to count: creeping along on top of them.
    const slow = world.ctx.vehicles.spawn('statesman', 2.4, 59, 0)!;
    const count = hits.length;
    run(2, () => ((slow as unknown as { speed: number }).speed = 1));
    expect(hits.length).toBe(count);
  });

  it('most jump clear of a car bearing down on them', () => {
    const { world, peds, traffic, run } = setup();
    const damaged = record(world, 'actorDamaged');
    peds.density = 0;
    traffic.density = 0;
    const row: PedHandle[] = [];
    for (let i = 0; i < 20; i++) row.push(peds.spawn({ x: 2.4, z: 60 + i * 30, behaviour: 'stand', persistent: true }));
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 20, 0)!;
    car.driver = world.player;
    for (let t = 0; t < 60; t += STEP) {
      (car as unknown as { speed: number }).speed = 12;
      run(STEP);
    }
    const hit = new Set(damaged.map((d) => d.actor)).size;
    expect(hit).toBeGreaterThanOrEqual(2);
    expect(hit).toBeLessThanOrEqual(12);
    // The ones who jumped ended up off the car's line.
    const clear = row.filter((p) => p.alive && Math.abs(p.position.x - 2.4) > 1.2).length;
    expect(clear).toBeGreaterThanOrEqual(8);
  });

  it('a slow nudge from a car does no harm', () => {
    const { world, peds, traffic, run } = setup();
    const damaged = record(world, 'actorDamaged');
    peds.density = 0;
    traffic.density = 0;
    const bystander = peds.spawn({ x: 2.4, z: 60, behaviour: 'stand', persistent: true });
    const car = world.ctx.vehicles.spawn('statesman', 2.4, 50, 0)!;
    car.driver = world.player;
    (car as unknown as { speed: number }).speed = 3;
    run(3);
    expect(damaged.length).toBe(0);
    expect(bystander.health).toBe(100);
  });

  it('take damage, die at zero health and report it', () => {
    const { world, peds } = setup();
    const damaged = record(world, 'actorDamaged');
    const died = record(world, 'actorDied');
    const ped = peds.spawn({ x: 8, z: 40, health: 60, behaviour: 'stand' });
    ped.takeDamage({ amount: 25, kind: 'bullet', source: world.player });
    expect(ped.health).toBe(35);
    expect(ped.alive).toBe(true);
    ped.takeDamage({ amount: 50, kind: 'bullet', source: world.player });
    expect(ped.health).toBe(0);
    expect(ped.alive).toBe(false);
    ped.takeDamage({ amount: 50, kind: 'bullet', source: world.player });
    expect(damaged.length).toBe(2);
    expect(died.length).toBe(1);
    expect(died[0].actor).toBe(ped);
  });
});

describe('scripted pedestrians', () => {
  it('stand where they are put, with the look they were given', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    const ped = peds.spawn({ x: 30, z: 30, heading: 1, behaviour: 'stand', persistent: true, kind: 'scripted', name: 'Aunty Rena', health: 250, look: { female: true } });
    run(5);
    expect(ped.kind).toBe('scripted');
    expect(ped.name).toBe('Aunty Rena');
    expect(ped.maxHealth).toBe(250);
    expect(ped.position.x).toBeCloseTo(30);
    expect(ped.position.z).toBeCloseTo(30);
    expect(ped.heading).toBe(1);
    // Mission characters do not panic at gunfire.
    world.events.emit('gunshot', { shooter: world.player, weaponId: 'pistol', position: new THREE.Vector3(28, 0, 30), direction: new THREE.Vector3(0, 0, 1) });
    run(3);
    expect(ped.position.x).toBeCloseTo(30);
    ped.say('Kia ora, Mack.');
    expect(world.subtitles[world.subtitles.length - 1]).toEqual({ text: 'Kia ora, Mack.', speaker: 'Aunty Rena' });
  });

  it('walk to a point and report arriving; give up on a timeout or on death', async () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    const ped = peds.spawn({ x: 30, z: 30, behaviour: 'stand', persistent: true });
    let arrived: boolean | null = null;
    void ped.goTo(45, 38).then((ok) => (arrived = ok));
    run(20);
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(Math.hypot(ped.position.x - 45, ped.position.z - 38)).toBeLessThan(1);
    // Running is quicker.
    let ran: boolean | null = null;
    void ped.goTo(30, 30, true).then((ok) => (ran = ok));
    run(5);
    await Promise.resolve();
    expect(ran).toBe(true);
    // A new errand cancels the old one.
    let first: boolean | null = null;
    let second: boolean | null = null;
    void ped.goTo(200, 200).then((ok) => (first = ok));
    void ped.goTo(32, 30).then((ok) => (second = ok));
    run(5);
    await Promise.resolve();
    expect(first).toBe(false);
    expect(second).toBe(true);
    // Dying on the way.
    let last: boolean | null = null;
    void ped.goTo(100, 100).then((ok) => (last = ok));
    run(1);
    ped.takeDamage({ amount: 999, kind: 'bullet', source: world.player });
    await Promise.resolve();
    expect(last).toBe(false);
  });

  it('walk round the player on foot instead of through them', async () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    world.player.position.set(38, 0, 30);
    const ped = peds.spawn({ x: 30, z: 30, behaviour: 'stand', persistent: true });
    let arrived: boolean | null = null;
    void ped.goTo(46, 30).then((ok) => (arrived = ok));
    let closest = Infinity;
    run(15, () => (closest = Math.min(closest, Math.hypot(ped.position.x - 38, ped.position.z - 30))));
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(closest).toBeGreaterThanOrEqual(PEDS.radius * 2);
  });

  it('get into a vehicle, ride in it, and get out when told to do something else', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    const entered = record(world, 'vehicleEntered');
    const car = world.ctx.vehicles.spawn('statesman', 40, 30, 0)!;
    const ped = peds.spawn({ x: 30, z: 30, behaviour: 'stand', persistent: true });
    ped.enterVehicle(car, 1);
    run(8);
    expect(ped.vehicle).toBe(car);
    expect(car.passengers).toContain(ped);
    expect(entered.length).toBe(1);
    expect(ped.group.parent).toBe(car.group);
    // Seen through the glass, sitting in the car.
    expect(ped.group.visible).toBe(true);
    // Rides along with it.
    car.position.set(80, 0.6, 70);
    run(0.5);
    expect(ped.position.distanceTo(car.position)).toBeLessThan(0.01);
    ped.setBehaviour('follow');
    run(1);
    expect(ped.vehicle).toBeNull();
    expect(car.passengers).not.toContain(ped);
    expect(ped.group.parent).toBe(world.ctx.scene);
    expect(ped.group.visible).toBe(true);
    expect(ped.position.distanceTo(car.position)).toBeLessThan(6);
  });

  it('are put back on the street when the player takes their car', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    const car = world.ctx.vehicles.spawn('statesman', 40, 30, 0)!;
    const ped = peds.spawn({ x: 38, z: 30, behaviour: 'stand', persistent: true });
    ped.enterVehicle(car, 0);
    run(4);
    expect(car.driver).toBe(ped);
    world.ctx.vehicles.enter(world.player, car, 0);
    run(0.5);
    expect(ped.vehicle).toBeNull();
    expect(ped.group.parent).toBe(world.ctx.scene);
    expect(car.driver).toBe(world.player);
    expect(ped.alive).toBe(true);
  });

  it('follow the player', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    world.player.position.set(0, 0, 60);
    const ped = peds.spawn({ x: 6, z: 60, behaviour: 'follow', persistent: true });
    run(1);
    for (let i = 0; i < 300; i++) {
      world.player.position.x += 0.1;
      run(STEP);
    }
    expect(ped.position.distanceTo(world.player.position)).toBeLessThan(6);
    expect(ped.position.x).toBeGreaterThan(20);
  });

  it('flee from the player', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    world.player.position.set(0, 0, 60);
    const ped = peds.spawn({ x: 6, z: 62, behaviour: 'flee', persistent: true });
    run(6);
    expect(ped.position.distanceTo(world.player.position)).toBeGreaterThan(25);
    expect(ped.velocity.length()).toBeGreaterThan(4);
  });

  it('attack with a gun from range, at a human rate, only with a clear line of sight', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    world.player.position.set(0, 0, 60);
    const ped = peds.spawn({ x: 0, z: 110, behaviour: 'attack', weaponId: 'pistol', persistent: true, kind: 'gang' });
    world.clear = false;
    run(6);
    // No line of sight: keeps closing in, holds fire.
    expect(world.shots.length).toBe(0);
    expect(ped.position.z).toBeLessThan(100);
    world.clear = true;
    run(10);
    expect(world.shots.length).toBeGreaterThanOrEqual(3);
    expect(world.shots.length).toBeLessThanOrEqual(25);
    expect(world.shots[0].shooter).toBe(ped);
    expect(world.shots[0].weaponId).toBe('pistol');
    // Stopped at range rather than walking up to the muzzle.
    const d = ped.position.distanceTo(world.player.position);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(PEDS.engageRange + 2);
    // Facing the target.
    const face = Math.atan2(world.player.position.x - ped.position.x, world.player.position.z - ped.position.z);
    expect(Math.abs(Math.atan2(Math.sin(face - ped.heading), Math.cos(face - ped.heading)))).toBeLessThan(0.3);
  });

  it('attack with fists up close when unarmed', () => {
    const { world, peds, run } = setup();
    peds.density = 0;
    world.player.position.set(0, 0, 60);
    const ped = peds.spawn({ x: 0, z: 75, behaviour: 'attack', persistent: true });
    run(8);
    expect(world.shots.length).toBe(0);
    expect(world.punches.length).toBeGreaterThanOrEqual(2);
    expect(world.punches.length).toBeLessThanOrEqual(8);
    expect(ped.position.distanceTo(world.player.position)).toBeLessThan(1.6);
    // The target dies: stand down.
    world.player.alive = false;
    const before = world.punches.length;
    run(3);
    expect(world.punches.length).toBe(before);
  });

  it('never start a fight or a panic inside a marae’s grounds', () => {
    const { world, peds, traffic, run } = setup();
    (world.ctx.world.landmarks as unknown[]).push({ kind: 'marae', name: 'Marae', x: 0, z: 60, heading: 0, clearRadius: 50 });
    peds.density = 0;
    traffic.density = 0;
    world.player.position.set(0, 0, 60);
    for (let i = 0; i < 12; i++) {
      const v = traffic.spawnDriver('statesman', 2, 50 + i)!;
      world.ctx.vehicles.enter(world.player, v, 0);
      world.ctx.vehicles.exit(world.player);
    }
    run(4);
    expect(peds.count).toBe(12);
    expect(world.punches.length).toBe(0);
    for (const a of world.ctx.actors.all) if (a.kind === 'ped') expect(a.velocity.length()).toBeLessThan(2.2);
  });

  it('count tracks live pedestrians of every kind', () => {
    const { peds, run } = setup();
    peds.density = 0;
    const handles: PedHandle[] = [];
    for (let i = 0; i < 5; i++) handles.push(peds.spawn({ x: 20 + i * 2, z: 30, behaviour: 'stand', persistent: i % 2 === 0 }));
    expect(peds.count).toBe(5);
    handles[0].remove();
    handles[1].takeDamage({ amount: 999, kind: 'explosion' });
    run(0.2);
    expect(peds.count).toBe(3);
  });
});

describe('dropped weapons', () => {
  it('an armed ped killed on foot leaves their gun by the body, with a few rounds', () => {
    const { world, peds } = setup();
    peds.density = 0;
    const gangster = peds.spawn({ x: 12, z: 40, behaviour: 'attack', weaponId: 'pistol', persistent: true, kind: 'gang' });
    gangster.takeDamage({ amount: 999, kind: 'bullet', source: world.player });
    expect(gangster.alive).toBe(false);
    expect(world.pickups.length).toBe(1);
    const drop = world.pickups[0];
    expect(drop.kind).toBe('pistol');
    expect(Math.hypot(drop.x - 12, drop.z - 40)).toBeLessThan(1.5);
    expect(drop.amount).toBeGreaterThanOrEqual(6);
    expect(drop.amount).toBeLessThanOrEqual(10);
    expect(drop.respawn).toBe(0);
    expect(drop.options?.drop).toBe(true);
    expect(drop.options?.ttl).toBeGreaterThan(30);
    expect(drop.options?.ttl).toBeLessThan(90);
  });

  it('an unarmed ped drops nothing', () => {
    const { world, peds } = setup();
    peds.density = 0;
    const bystander = peds.spawn({ x: 8, z: 40, behaviour: 'stand' });
    bystander.takeDamage({ amount: 999, kind: 'bullet', source: world.player });
    expect(bystander.alive).toBe(false);
    expect(world.pickups.length).toBe(0);
  });
});

describe('town-weighted traffic (vehicles.pickSpec)', () => {
  const vehiclesWith = (specs: VehicleSpec[]) => {
    const vehicles = new Vehicles({ scene: new THREE.Scene() } as unknown as GameContext);
    vehicles.specs = new Map(specs.map((s) => [s.id, s]));
    return vehicles;
  };

  it('a spawnBy multiplier of 0 removes the spec in that town, and only there', () => {
    const v = vehiclesWith([makeSpec('cityonly', { spawnBy: { timaru: 0 } }), makeSpec('anywhere')]);
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) expect(v.pickSpec('shops', rng, 'timaru')).toBe('anywhere');
    let seen = 0;
    for (let i = 0; i < 300; i++) if (v.pickSpec('shops', rng, 'christchurch') === 'cityonly') seen++;
    expect(seen).toBeGreaterThan(60); // about half, loose
  });

  it('a multiplier of 2 is picked about twice as often as its unmultiplied twin', () => {
    const v = vehiclesWith([makeSpec('favoured', { spawnBy: { timaru: 2 } }), makeSpec('twin')]);
    const rng = new Rng(12);
    const n = 4000;
    let inTimaru = 0;
    let inCountry = 0;
    for (let i = 0; i < n; i++) {
      if (v.pickSpec('shops', rng, 'timaru') === 'favoured') inTimaru++;
      if (v.pickSpec('shops', rng, null) === 'favoured') inCountry++;
    }
    expect(inTimaru / n).toBeGreaterThan(0.58); // about 2/3, loose bounds
    expect(inTimaru / n).toBeLessThan(0.75);
    expect(inCountry / n).toBeGreaterThan(0.42); // about even without the multiplier
    expect(inCountry / n).toBeLessThan(0.58);
  });

  it('specs that never spawn in the district are not picked, whatever the town says', () => {
    const v = vehiclesWith([makeSpec('urban', { spawn: { cbd: 1 }, spawnBy: { country: 4 } }), makeSpec('rural', { spawn: { rural: 1 } })]);
    const rng = new Rng(13);
    for (let i = 0; i < 100; i++) expect(v.pickSpec('rural', rng, null)).toBe('rural');
  });
});
