import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DRY_ROAD_MU, steeringLimit } from '../vehicles/steering';
import { Rng } from '../core/rng';
import type { Actor, GameContext, RoadGraph, Vehicle } from '../core/types';
import { AutopilotImpl, type PilotWorld } from './autopilot';
import { JunctionBook } from './junction';
import { laneOffset, lanePointInto, makePoint, projectOnEdge, projection } from './lanes';
import { buildGraph, crossroads } from './testgraph';
import { DRIVE, PURSUIT } from './tuning';

/**
 * Closed-loop checks of the autopilot against a simple stand-in for the vehicle model (a kinematic bicycle
 * with the real model's pedal conventions: brake reverses below 1.2 m/s, speed-sensitive steering lock).
 * No rendering or physics engine involved.
 */

const SPEC = { width: 1.84, length: 4.85, wheelbase: 2.8, steerLock: 0.58, topSpeed: 50 };
const STEP = 1 / 60;
const p = makePoint();

interface Car {
  vehicle: Vehicle;
  step(dt: number): void;
}

function makeCar(id: number, x: number, z: number, heading: number, spec = SPEC): Car {
  let steerAngle = 0;
  const v = {
    id,
    spec,
    position: new THREE.Vector3(x, 0.6, z),
    velocity: new THREE.Vector3(),
    heading,
    speed: 0,
    get steeringLimit() { return steeringLimit(spec, this.speed, DRY_ROAD_MU); },
    controls: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    driver: {} as Actor,
    controller: 'none',
    destroyed: false,
    burning: false,
  };
  return {
    vehicle: v as unknown as Vehicle,
    step(dt: number) {
      const c = v.controls;
      let accel = 0;
      if (c.throttle > 0) accel = v.speed < -1.5 ? 9 * c.throttle : 5.2 * c.throttle * (1 - Math.pow(Math.max(0, v.speed) / spec.topSpeed, 3));
      else if (c.brake > 0) accel = v.speed > 1.2 ? -9 * c.brake : v.speed > -10 ? -3.2 * c.brake : 0;
      else accel = -0.35 * Math.sign(v.speed);
      if (c.handbrake) {
        const stop = 7 * dt;
        v.speed = Math.abs(v.speed) <= stop ? 0 : v.speed - Math.sign(v.speed) * stop;
      } else v.speed += accel * dt;
      const lock = v.steeringLimit;
      const want = Math.max(-1, Math.min(1, c.steer)) * lock;
      const rate = 2 * dt * (0.6 + lock);
      steerAngle += Math.max(-rate, Math.min(rate, want - steerAngle));
      v.heading += ((v.speed * Math.tan(steerAngle)) / spec.wheelbase) * dt;
      const sin = Math.sin(v.heading);
      const cos = Math.cos(v.heading);
      v.position.x += sin * v.speed * dt;
      v.position.z += cos * v.speed * dt;
      v.velocity.set(sin * v.speed, 0, cos * v.speed);
    },
  };
}

/** Something stationary on the road. */
function makeObstacle(id: number, x: number, z: number, heading: number, driver = false): Vehicle {
  return {
    id,
    spec: SPEC,
    position: new THREE.Vector3(x, 0.6, z),
    velocity: new THREE.Vector3(),
    heading,
    speed: 0,
    driver: driver ? ({} as Actor) : null,
    controller: 'none',
    destroyed: false,
    burning: false,
  } as unknown as Vehicle;
}

function makeWorld(graph: RoadGraph, clearLine = true) {
  const clock = { elapsed: 0 };
  const vehicles: Vehicle[] = [];
  const ctx = {
    world: { graph, groundAt: () => 0 },
    clock,
    vehicles: { all: vehicles },
    physics: { lineOfSight: () => clearLine },
  } as unknown as GameContext;
  const world: PilotWorld = { ctx, book: new JunctionBook(), rng: new Rng(21), walkers: [] };
  return { world, clock, vehicles };
}

/** Do the two cars' bodies overlap? (Oriented boxes, slightly shrunk so a brush of mirrors is forgiven.) */
function overlapping(a: Vehicle, b: Vehicle): boolean {
  const corners = (v: Vehicle) => {
    const hw = v.spec.width / 2 - 0.1;
    const hl = v.spec.length / 2 - 0.1;
    const sin = Math.sin(v.heading);
    const cos = Math.cos(v.heading);
    return [
      [hl, hw],
      [hl, -hw],
      [-hl, -hw],
      [-hl, hw],
    ].map(([f, l]) => [v.position.x + sin * f + cos * l, v.position.z + cos * f - sin * l]);
  };
  const ca = corners(a);
  const cb = corners(b);
  const axes = [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2];
  for (const h of axes) {
    const ax = Math.sin(h);
    const az = Math.cos(h);
    const pa = ca.map(([x, z]) => x * ax + z * az);
    const pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

describe('autopilot: roads', () => {
  it('wanders the network on the left, at about the limit, without leaving the road', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(graph.edges[2], 100, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.atan2(p.tx, p.tz));
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    const visited = new Set<string>();
    let worst = 0;
    let laneError = 0;
    let laneSamples = 0;
    let travelled = 0;
    let fastest = 0;
    for (let i = 0; i < 60 * 240; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      const v = car.vehicle;
      travelled += Math.abs(v.speed) * STEP;
      fastest = Math.max(fastest, v.speed);
      const hit = graph.nearest(v.position.x, v.position.z, 60)!;
      worst = Math.max(worst, hit.distance - hit.edge.width / 2);
      const edge = pilot.edge!;
      visited.add(edge.name);
      // Well away from junctions and bends, the car should sit in the left-hand lane.
      const s = pilot.s;
      const midEdge = edge.name.endsWith('Road') && s > 30 && s < edge.length - 30;
      if (midEdge) {
        projectOnEdge(edge, v.position.x, v.position.z, s);
        laneError = Math.max(laneError, Math.abs(projection.offset * pilot.dir - laneOffset(edge, 0)));
        laneSamples++;
      }
    }
    expect(pilot.stuckCount).toBe(0);
    expect(visited.size).toBeGreaterThanOrEqual(5);
    // Never more than a tyre's width over the edge of the seal, even cutting corners.
    expect(worst).toBeLessThan(0.6);
    expect(laneSamples).toBeGreaterThan(500);
    expect(laneError).toBeLessThan(0.5);
    // 50 km/h streets: a good average despite the junctions, and no speeding.
    expect(travelled / 240).toBeGreaterThan(6);
    expect(fastest).toBeLessThan(50 / 3.6 + 1);
    expect(pilot.arrived).toBe(false);
  });

  it('finds the road by itself and joins it the way it is facing', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph);
    // Sitting on West Road pointing east (towards the centre).
    const car = makeCar(1, -80, 1.5, Math.PI / 2);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    for (let i = 0; i < 60 * 3; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(pilot.edge!.name).toBe('West Road');
    expect(pilot.dir).toBe(-1);
    expect(car.vehicle.speed).toBeGreaterThan(3);
    expect(car.vehicle.position.x).toBeGreaterThan(-80);
  });

  it('drives a route to its end, stops there and says so', () => {
    const graph = crossroads();
    const [north, , south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 110, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
    let t = 0;
    while (!pilot.arrived && t < 60) {
      t += STEP;
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(pilot.arrived).toBe(true);
    expect(t).toBeLessThan(40);
    for (let i = 0; i < 120; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(Math.abs(car.vehicle.speed)).toBeLessThan(0.3);
    expect(car.vehicle.position.z).toBeLessThan(-110);
    expect(car.vehicle.position.z).toBeGreaterThan(-122);
  });

  it('takes a right-angle turn slowly and stays on the seal', () => {
    const graph = crossroads();
    const [, east, south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 80, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge: south, dir: -1 }, { edge: east, dir: 1 }]);
    let turning = 0;
    let turnSpeed = 0;
    let worst = 0;
    for (let i = 0; i < 60 * 40 && !pilot.arrived; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      const v = car.vehicle;
      const hit = graph.nearest(v.position.x, v.position.z, 60, (e) => e === south || e === east)!;
      worst = Math.max(worst, hit.distance - hit.edge.width / 2);
      if (Math.abs(v.position.x) < 5 && Math.abs(v.position.z) < 5) {
        turning++;
        turnSpeed = Math.max(turnSpeed, v.speed);
      }
    }
    expect(pilot.arrived).toBe(true);
    expect(turning).toBeGreaterThan(20);
    expect(turnSpeed).toBeLessThan(8);
    expect(worst).toBeLessThan(0.5);
    // Ends up eastbound on the north side of East Road.
    expect(car.vehicle.position.x).toBeGreaterThan(100);
    expect(car.vehicle.position.z).toBeLessThan(0);
  });

  it('laps a looping route', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph);
    const lap = [4, 5, 6, 7].map((i) => ({ edge: graph.edges[i], dir: 1 as const }));
    lanePointInto(graph.edges[4], 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.atan2(p.tx, p.tz));
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.loop = true;
    pilot.aggression = 1.7;
    pilot.setRoute(lap, 20);
    const order: string[] = [];
    for (let i = 0; i < 60 * 200; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      const name = pilot.edge!.name;
      if (order[order.length - 1] !== name) order.push(name);
    }
    expect(pilot.arrived).toBe(false);
    expect(pilot.stuckCount).toBe(0);
    // The ring is about 960 m: a racer at 1.7 × 50 km/h, slowing for eight right-angle corners.
    expect(order.length).toBeGreaterThanOrEqual(9);
    expect(order.slice(0, 5)).toEqual(['Ring NE', 'Ring SE', 'Ring SW', 'Ring NW', 'Ring NE']);
  });
});

describe('autopilot: other road users', () => {
  it('stops behind something blocking the whole lane, without touching it', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 400]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    // A car broadside across the road.
    const wreck = makeObstacle(2, 0.5, 150, Math.PI / 2, true);
    vehicles.push(car.vehicle, wreck);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge, dir: 1 }], 20);
    let peak = 0;
    for (let i = 0; i < 60 * 25; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      peak = Math.max(peak, car.vehicle.speed);
      expect(overlapping(car.vehicle, wreck)).toBe(false);
    }
    expect(peak).toBeGreaterThan(10);
    const gap = 150 - SPEC.width / 2 - (car.vehicle.position.z + SPEC.length / 2);
    expect(gap).toBeGreaterThan(1);
    expect(gap).toBeLessThan(DRIVE.standoff + 3);
    expect(pilot.blockedTime).toBeGreaterThan(3);
    expect(pilot.arrived).toBe(false);
  });

  it('eases out round a car parked at the kerb and carries on', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 400]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    // Southbound traffic keeps to the east side; the kerb there is at x = +4.75.
    const parked = makeObstacle(2, edge.width / 2 - SPEC.width / 2 - 0.22, 150, 0);
    vehicles.push(car.vehicle, parked);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge, dir: 1 }], 20);
    let slowest = Infinity;
    let rightmost = Infinity;
    for (let i = 0; i < 60 * 40 && car.vehicle.position.z < 260; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      expect(overlapping(car.vehicle, parked)).toBe(false);
      if (car.vehicle.position.z > 60) slowest = Math.min(slowest, car.vehicle.speed);
      rightmost = Math.min(rightmost, car.vehicle.position.x);
    }
    expect(car.vehicle.position.z).toBeGreaterThanOrEqual(260);
    // Kept moving, moved over, but stayed on its own side of the centre line (give or take a mirror).
    expect(slowest).toBeGreaterThan(2);
    expect(rightmost).toBeLessThan(1.8);
    expect(rightmost - SPEC.width / 2).toBeGreaterThan(-0.9);
    // And back to the lane afterwards.
    expect(Math.abs(car.vehicle.position.x - laneOffset(edge, 0))).toBeLessThan(0.5);
  });

  it('waits for oncoming traffic before pulling out round a parked car on a narrow road', () => {
    const graph = buildGraph([{ name: 'Back Lane', cls: 'lane', pts: [[0, 0], [0, 400]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    const parked = makeObstacle(2, edge.width / 2 - SPEC.width / 2 - 0.22, 150, 0);
    lanePointInto(edge, 330, -1, 0, 0, p);
    const other = makeCar(3, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle, parked, other.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge, dir: 1 }], 20);
    const oncoming = new AutopilotImpl(other.vehicle, world);
    oncoming.setRoute([{ edge, dir: -1 }], 330);
    let waited = 0;
    let passedAt = Infinity;
    for (let t = 0; t < 70 && car.vehicle.position.z < 230; t += STEP) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      oncoming.update(STEP);
      car.step(STEP);
      other.step(STEP);
      expect(overlapping(car.vehicle, parked)).toBe(false);
      expect(overlapping(car.vehicle, other.vehicle)).toBe(false);
      expect(overlapping(other.vehicle, parked)).toBe(false);
      const meeting = other.vehicle.position.z > car.vehicle.position.z;
      if (meeting && Math.abs(car.vehicle.speed) < 0.3 && car.vehicle.position.z > 120) waited += STEP;
      // While the other car is still coming, stay on our own side.
      if (meeting && other.vehicle.position.z - car.vehicle.position.z < 30) expect(car.vehicle.position.x - SPEC.width / 2).toBeGreaterThan(-0.35);
      if (!meeting) passedAt = Math.min(passedAt, t);
    }
    expect(waited).toBeGreaterThan(2);
    expect(passedAt).toBeLessThan(40);
    expect(car.vehicle.position.z).toBeGreaterThanOrEqual(230);
    // The oncoming car was not held up.
    expect(other.vehicle.position.z).toBeLessThan(130);
  });

  it('queues patiently behind traffic waiting at a junction instead of pulling round it', () => {
    const graph = crossroads();
    const [north, , south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 22, -1, 0, 0, p);
    const front = makeCar(1, p.x, p.z, Math.PI);
    lanePointInto(south, 34, -1, 0, 0, p);
    const back = makeCar(2, p.x, p.z, Math.PI);
    (front.vehicle as { controller: string }).controller = 'traffic';
    (back.vehicle as { controller: string }).controller = 'traffic';
    vehicles.push(front.vehicle, back.vehicle);
    const pilots = [front, back].map((c) => {
      const pilot = new AutopilotImpl(c.vehicle, world);
      pilot.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
      return pilot;
    });
    const lane = front.vehicle.position.x;
    for (let t = 0; t < 10.5; t += STEP) {
      clock.elapsed += STEP;
      world.book.request(0, 99, 30, clock.elapsed, -5.25, -2.375, 5.25, -2.375);
      for (const pilot of pilots) pilot.update(STEP);
      front.step(STEP);
      back.step(STEP);
      expect(overlapping(front.vehicle, back.vehicle)).toBe(false);
      expect(Math.abs(back.vehicle.position.x - lane)).toBeLessThan(0.4);
    }
    expect(pilots[0].yielding).toBe(true);
    expect(pilots[1].blockedByTraffic).toBe(true);
    expect(pilots[1].blockedTime).toBeGreaterThan(5);
    // Tucked in behind, a sensible gap apart.
    const gap = back.vehicle.position.z - front.vehicle.position.z - SPEC.length;
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(4);
    world.book.release(99);
    for (let t = 0; t < 14; t += STEP) {
      clock.elapsed += STEP;
      for (const pilot of pilots) pilot.update(STEP);
      front.step(STEP);
      back.step(STEP);
      expect(overlapping(front.vehicle, back.vehicle)).toBe(false);
    }
    expect(front.vehicle.position.z).toBeLessThan(-40);
    expect(back.vehicle.position.z).toBeLessThan(-20);
  });

  it('follows a slower vehicle at a safe distance', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 600]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    const lead = makeCar(2, p.x, p.z + 30, 0);
    vehicles.push(car.vehicle, lead.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge, dir: 1 }], 20);
    const slow = new AutopilotImpl(lead.vehicle, world);
    slow.cruiseSpeed = 6;
    slow.setRoute([{ edge, dir: 1 }], 50);
    let closest = Infinity;
    for (let i = 0; i < 60 * 40; i++) {
      clock.elapsed += STEP;
      slow.update(STEP);
      pilot.update(STEP);
      lead.step(STEP);
      car.step(STEP);
      closest = Math.min(closest, lead.vehicle.position.z - car.vehicle.position.z - SPEC.length);
    }
    expect(closest).toBeGreaterThan(1.2);
    expect(car.vehicle.speed).toBeGreaterThan(5);
    expect(car.vehicle.speed).toBeLessThan(7);
    expect(lead.vehicle.position.z - car.vehicle.position.z - SPEC.length).toBeLessThan(12);
  });

  it('stops for a person standing in the road', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 400]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    vehicles.push(car.vehicle);
    const person = { position: new THREE.Vector3(p.x - 0.3, 0, 120), velocity: new THREE.Vector3(), alive: true, vehicle: null } as unknown as Actor;
    world.walkers.push(person);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge, dir: 1 }], 20);
    for (let i = 0; i < 60 * 12; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(Math.abs(car.vehicle.speed)).toBeLessThan(0.2);
    const gap = 120 - (car.vehicle.position.z + SPEC.length / 2);
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(6);
    expect(pilot.blockedByPerson).toBe(true);
    // They step off the road: away we go.
    world.walkers.length = 0;
    for (let i = 0; i < 60 * 5; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(car.vehicle.speed).toBeGreaterThan(5);
  });

  it('ignores obstacles when told to', () => {
    const graph = buildGraph([{ name: 'Long Road', pts: [[0, 0], [0, 400]] }]);
    const edge = graph.edges[0];
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(edge, 20, 1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, 0);
    const wreck = makeObstacle(2, p.x, 150, 0);
    vehicles.push(car.vehicle, wreck);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.avoidObstacles = false;
    pilot.setRoute([{ edge, dir: 1 }], 20);
    for (let i = 0; i < 60 * 14; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(car.vehicle.position.z).toBeGreaterThan(150);
  });
});

describe('autopilot: junctions', () => {
  function crossing(aggressionB = 1) {
    const graph = crossroads();
    const [north, east, south, west] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 70, -1, 0, 0, p);
    const a = makeCar(1, p.x, p.z, Math.PI);
    lanePointInto(west, 70, -1, 0, 0, p);
    const b = makeCar(2, p.x, p.z, Math.PI / 2);
    vehicles.push(a.vehicle, b.vehicle);
    const pa = new AutopilotImpl(a.vehicle, world);
    pa.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
    const pb = new AutopilotImpl(b.vehicle, world);
    pb.aggression = aggressionB;
    pb.setRoute([{ edge: west, dir: -1 }, { edge: east, dir: 1 }]);
    return { world, clock, a, b, pa, pb };
  }

  it('two cars on crossing paths never meet in the middle, and both get through', () => {
    const { clock, a, b, pa, pb } = crossing();
    let t = 0;
    let yielded = false;
    let closest = Infinity;
    while (t < 60 && !(pa.arrived && pb.arrived)) {
      t += STEP;
      clock.elapsed += STEP;
      pa.update(STEP);
      pb.update(STEP);
      a.step(STEP);
      b.step(STEP);
      yielded ||= pa.yielding || pb.yielding;
      closest = Math.min(closest, a.vehicle.position.distanceTo(b.vehicle.position));
      expect(overlapping(a.vehicle, b.vehicle)).toBe(false);
      const inBox = (v: Vehicle) => Math.abs(v.position.x) < 3.5 && Math.abs(v.position.z) < 3.5;
      expect(inBox(a.vehicle) && inBox(b.vehicle)).toBe(false);
    }
    expect(pa.arrived && pb.arrived).toBe(true);
    expect(yielded).toBe(true);
    expect(closest).toBeGreaterThan(3);
    expect(t).toBeLessThan(45);
  });

  it('waits at the line while another movement holds the junction, then goes', () => {
    const graph = crossroads();
    const [north, , south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 80, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
    // Somebody else (id 99) is crossing east–west; they keep the junction for eight seconds.
    const hold = () => world.book.request(0, 99, 30, clock.elapsed, -5.25, -2.375, 5.25, -2.375);
    hold();
    let t = 0;
    for (; t < 8; t += STEP) {
      clock.elapsed += STEP;
      hold();
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(pilot.yielding).toBe(true);
    expect(Math.abs(car.vehicle.speed)).toBeLessThan(0.2);
    // Nose behind the junction box (which starts 5.25 m from the centre).
    const nose = car.vehicle.position.z - SPEC.length / 2;
    expect(nose).toBeGreaterThan(5.25);
    expect(nose).toBeLessThan(5.25 + 4);
    world.book.release(99);
    for (; t < 16; t += STEP) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(car.vehicle.position.z).toBeLessThan(-10);
    // Having cleared it, the claim is given back.
    expect(world.book.holds(1)).toBe(false);
  });

  it('a pursuit driver does not give way', () => {
    const graph = crossroads();
    const [north, , south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 80, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.aggression = PURSUIT.aggression + 0.1;
    pilot.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
    let slowest = Infinity;
    for (let t = 0; t < 8; t += STEP) {
      clock.elapsed += STEP;
      world.book.request(0, 99, 30, clock.elapsed, -5.25, -2.375, 5.25, -2.375);
      pilot.update(STEP);
      car.step(STEP);
      if (t > 2 && car.vehicle.position.z > -20) slowest = Math.min(slowest, car.vehicle.speed);
    }
    expect(pilot.yielding).toBe(false);
    expect(car.vehicle.position.z).toBeLessThan(-20);
    expect(slowest).toBeGreaterThan(8);
  });

  it('slows for a look when joining a bigger road', () => {
    const graph = crossroads({ ewClass: 'arterial' });
    const [north, , south] = graph.edges;
    const { world, clock, vehicles } = makeWorld(graph);
    lanePointInto(south, 100, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.setRoute([{ edge: south, dir: -1 }, { edge: north, dir: 1 }]);
    let atLine = Infinity;
    for (let t = 0; t < 30 && car.vehicle.position.z > -30; t += STEP) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      const z = car.vehicle.position.z;
      if (z < 12 && z > 9) atLine = Math.min(atLine, car.vehicle.speed);
    }
    expect(atLine).toBeLessThan(DRIVE.giveWaySpeed + 1.5);
    expect(car.vehicle.position.z).toBeLessThanOrEqual(-30);
  });
});

describe('autopilot: pursuit', () => {
  const open = buildGraph([{ name: 'Far Away', pts: [[5000, 5000], [5000, 5100]] }]);

  it('drives straight at a point off-road and reports arriving', () => {
    const { world, clock, vehicles } = makeWorld(open);
    const car = makeCar(1, 0, 0, 0);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.cruiseSpeed = 20;
    pilot.setTarget(60, 90);
    let t = 0;
    while (!pilot.arrived && t < 30) {
      t += STEP;
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(pilot.arrived).toBe(true);
    expect(Math.hypot(car.vehicle.position.x - 60, car.vehicle.position.z - 90)).toBeLessThan(PURSUIT.arriveRadius + 0.5);
    expect(t).toBeLessThan(15);
    expect(pilot.edge).toBeNull();
  });

  it('chases a moving target at speed', () => {
    const { world, clock, vehicles } = makeWorld(open);
    const car = makeCar(1, 0, 0, 0);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.aggression = 2.2;
    pilot.cruiseSpeed = 38;
    // The quarry does 22 m/s round a wide arc.
    let qx = 40;
    let qz = 60;
    let qh = 0.3;
    let best = Infinity;
    let top = 0;
    for (let t = 0; t < 25; t += STEP) {
      qh += 0.06 * STEP;
      qx += Math.sin(qh) * 22 * STEP;
      qz += Math.cos(qh) * 22 * STEP;
      clock.elapsed += STEP;
      pilot.setTarget(qx, qz);
      pilot.update(STEP);
      car.step(STEP);
      top = Math.max(top, car.vehicle.speed);
      if (t > 12) best = Math.min(best, Math.hypot(car.vehicle.position.x - qx, car.vehicle.position.z - qz));
    }
    expect(top).toBeGreaterThan(28);
    expect(best).toBeLessThan(12);
  });

  it('turns round for a target behind it', () => {
    const { world, clock, vehicles } = makeWorld(open);
    const car = makeCar(1, 0, 0, 0);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.aggression = 2;
    pilot.cruiseSpeed = 25;
    pilot.setTarget(3, -60);
    let t = 0;
    let reversed = false;
    while (!pilot.arrived && t < 30) {
      t += STEP;
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      reversed ||= car.vehicle.speed < -0.5;
    }
    expect(pilot.arrived).toBe(true);
    expect(t).toBeLessThan(20);
    expect(reversed).toBe(false);
  });

  it('backs up and swings round when the target is close behind', () => {
    const { world, clock, vehicles } = makeWorld(open);
    const car = makeCar(1, 0, 0, 0);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.aggression = 2;
    pilot.cruiseSpeed = 25;
    pilot.setTarget(2, -11);
    let t = 0;
    let reversed = false;
    while (!pilot.arrived && t < 30) {
      t += STEP;
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      reversed ||= car.vehicle.speed < -0.5;
    }
    expect(reversed).toBe(true);
    expect(pilot.arrived).toBe(true);
    expect(t).toBeLessThan(15);
  });

  it('reverses out when wedged against something, sooner in pursuit', () => {
    const { world, clock, vehicles } = makeWorld(open);
    const timeToReverse = (aggression: number) => {
      const car = makeCar(1, 0, 0, 0);
      vehicles.length = 0;
      vehicles.push(car.vehicle);
      const pilot = new AutopilotImpl(car.vehicle, world);
      pilot.aggression = aggression;
      pilot.setTarget(0, 200);
      for (let t = 0; t < 10; t += STEP) {
        clock.elapsed += STEP;
        pilot.update(STEP);
        // A wall: the car cannot move forwards, whatever the pedals say.
        if (car.vehicle.controls.brake > 0 && car.vehicle.controls.throttle === 0) return { t, count: pilot.stuckCount, steer: car.vehicle.controls.steer };
      }
      return { t: Infinity, count: 0, steer: 0 };
    };
    const calm = timeToReverse(1);
    const keen = timeToReverse(2.2);
    expect(calm.t).toBeGreaterThan(DRIVE.stuckAfter);
    expect(calm.t).toBeLessThan(DRIVE.stuckAfter + 0.5);
    expect(keen.t).toBeGreaterThan(PURSUIT.stuckAfter);
    expect(keen.t).toBeLessThan(PURSUIT.stuckAfter + 0.5);
    expect(keen.count).toBe(1);
    expect(Math.abs(keen.steer)).toBeGreaterThan(0.5);
  });

  it('takes to the roads when buildings block the straight line', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph, false);
    lanePointInto(graph.edges[2], 100, -1, 0, 0, p);
    const car = makeCar(1, p.x, p.z, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    pilot.aggression = 2.1;
    pilot.cruiseSpeed = 30;
    // The target is on East Road; the corner block between is "solid".
    pilot.setTarget(100, -2);
    let t = 0;
    let worst = 0;
    const roads = new Set<string>();
    while (!pilot.arrived && t < 40) {
      t += STEP;
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
      const hit = graph.nearest(car.vehicle.position.x, car.vehicle.position.z, 80)!;
      worst = Math.max(worst, hit.distance - hit.edge.width / 2);
      if (pilot.edge) roads.add(pilot.edge.name);
    }
    expect(pilot.arrived).toBe(true);
    expect(t).toBeLessThan(25);
    // Went round by South Road and East Road rather than across the block.
    expect(worst).toBeLessThan(2.5);
    expect(roads.has('South Road')).toBe(true);
    expect(roads.has('East Road')).toBe(true);
  });

  it('holds still once stopped', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph);
    const car = makeCar(1, 2, 60, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    for (let i = 0; i < 300; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(car.vehicle.speed).toBeGreaterThan(5);
    pilot.stop();
    for (let i = 0; i < 300; i++) {
      clock.elapsed += STEP;
      pilot.update(STEP);
      car.step(STEP);
    }
    expect(Math.abs(car.vehicle.speed)).toBeLessThan(0.05);
    expect(car.vehicle.controls.handbrake).toBe(true);
    expect(car.vehicle.controls.brake).toBe(0);
    expect(pilot.edge).toBeNull();
  });

  it('drives only once per frame even if two systems update it', () => {
    const graph = crossroads();
    const { world, clock, vehicles } = makeWorld(graph);
    const car = makeCar(1, 2, 60, Math.PI);
    vehicles.push(car.vehicle);
    const pilot = new AutopilotImpl(car.vehicle, world);
    clock.elapsed = 1;
    pilot.update(STEP);
    car.vehicle.controls.throttle = -123;
    pilot.update(STEP);
    expect(car.vehicle.controls.throttle).toBe(-123);
    clock.elapsed = 1.016;
    pilot.update(STEP);
    expect(car.vehicle.controls.throttle).not.toBe(-123);
  });
});
