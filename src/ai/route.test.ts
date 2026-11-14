import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { RoadGraph } from '../core/types';
import { makePoint } from './lanes';
import { RouteFollower, chooseExit, exitDir, legEnd, legStart, turnAngle, type Leg } from './route';
import { buildGraph, crossroads } from './testgraph';
import { DRIVE } from './tuning';

const p = makePoint();
const leg: Leg = { edge: null as never, dir: 1 };

/**
 * Move a point along the follower's own path the way the autopilot does: aim a little ahead, reaching
 * further where the lane line folds back on the inside of a sharp bend.
 */
function advance(graph: RoadGraph, f: RouteFollower, rng: Rng, at: { x: number; z: number }): boolean {
  let reach = 1.5;
  f.pathPoint(reach, 0, p);
  while (Math.hypot(p.x - at.x, p.z - at.z) < 1 && reach < 30) {
    reach += 1;
    f.pathPoint(reach, 0, p);
  }
  at.x = p.x;
  at.z = p.z;
  return f.track(graph, at.x, at.z, rng);
}

/** Drive a point along the route and report every leg it moves on to. */
function drive(graph: RoadGraph, f: RouteFollower, rng: Rng, maxSteps: number): string[] {
  const visited: string[] = [];
  f.pathPoint(0, 0, p);
  const at = { x: p.x, z: p.z };
  for (let i = 0; i < maxSteps && !f.finished && f.edge; i++) {
    if (advance(graph, f, rng, at)) visited.push(`${f.edge!.name}${f.dir === 1 ? '+' : '-'}`);
  }
  return visited;
}

describe('turn angles', () => {
  const g = crossroads();
  const [north, east, south, west] = g.edges;

  it('is positive for a left turn and negative for a right turn', () => {
    // Driving north up South Road (towards the centre), then…
    expect(turnAngle(south, -1, north, 1)).toBeCloseTo(0);
    expect(turnAngle(south, -1, west, 1)).toBeCloseTo(Math.PI / 2);
    expect(turnAngle(south, -1, east, 1)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(turnAngle(south, -1, south, 1))).toBeCloseTo(Math.PI);
  });
});

describe('wandering exit choice', () => {
  it('takes any legal exit but never doubles back at a junction', () => {
    const g = crossroads();
    const south = g.edges[2];
    const rng = new Rng(7);
    const seen = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      expect(chooseExit(g, south, -1, rng, leg)).toBe(true);
      expect(leg.edge).not.toBe(south);
      expect(legStart(leg.edge, leg.dir)).toBe(legEnd(south, -1));
      seen.set(leg.edge.name, (seen.get(leg.edge.name) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual(['East Road', 'North Road', 'West Road']);
    // Straight on is favoured.
    expect(seen.get('North Road')!).toBeGreaterThan(seen.get('East Road')!);
    expect(seen.get('North Road')!).toBeGreaterThan(seen.get('West Road')!);
  });

  it('respects one-way streets and roads closed to traffic', () => {
    const g = buildGraph([
      { name: 'In', pts: [[0, 100], [0, 0]] },
      { name: 'Wrong Way', pts: [[100, 0], [0, 0]], oneway: true },
      { name: 'Right Way', pts: [[0, 0], [-100, 0]], oneway: true },
      { name: 'Mall', pts: [[0, 0], [0, -100]], cls: 'pedestrian' },
    ]);
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) {
      expect(chooseExit(g, g.edges[0], 1, rng, leg)).toBe(true);
      expect(leg.edge.name).toBe('Right Way');
      expect(leg.dir).toBe(1);
    }
    // The junction is node 1 (the first road runs towards it).
    expect(exitDir(g.edges[1], 1)).toBe(0);
    expect(exitDir(g.edges[2], 1)).toBe(1);
    expect(exitDir(g.edges[3], 1)).toBe(0);
  });

  it('turns round only at a dead end, and not at all on a one-way', () => {
    const g = buildGraph([{ name: 'Cul-de-sac', pts: [[0, 0], [0, 80]] }]);
    expect(chooseExit(g, g.edges[0], 1, new Rng(1), leg)).toBe(true);
    expect(leg.edge).toBe(g.edges[0]);
    expect(leg.dir).toBe(-1);
    const oneway = buildGraph([{ pts: [[0, 0], [0, 80]], oneway: true }]);
    expect(chooseExit(oneway, oneway.edges[0], 1, new Rng(1), leg)).toBe(false);
  });
});

describe('route following', () => {
  const g = crossroads();
  const [north, east, south, , , ringSE] = g.edges;
  const rng = new Rng(11);

  it('tracks progress along an edge in either direction', () => {
    const f = new RouteFollower();
    f.startRoute(g, [{ edge: south, dir: -1 }, { edge: north, dir: 1 }], undefined, 0, 100, rng);
    expect(f.edge).toBe(south);
    expect(f.dir).toBe(-1);
    // Travelling b → a: 20 m travelled, 100 m from node a.
    expect(f.u).toBeCloseTo(20);
    expect(f.s).toBeCloseTo(100);
    f.track(g, -2, 80, rng);
    expect(f.u).toBeCloseTo(40);
    expect(f.s).toBeCloseTo(80);
    expect(f.remaining).toBeCloseTo(120 - 40 - f.trimEnd);
  });

  it('moves through the legs in order and finishes at the end', () => {
    const f = new RouteFollower();
    const legs: Leg[] = [
      { edge: south, dir: -1 },
      { edge: east, dir: 1 },
      { edge: ringSE, dir: 1 },
    ];
    f.startRoute(g, legs, 110, 0, 110, rng);
    expect(f.nextEdge).toBe(east);
    const visited = drive(g, f, rng, 2000);
    expect(visited).toEqual(['East Road+', 'Ring SE+']);
    expect(f.finished).toBe(true);
    expect(f.edge).toBe(ringSE);
    expect(f.nextEdge).toBeNull();
  });

  it('an empty route is finished at once', () => {
    const f = new RouteFollower();
    f.startRoute(g, [], undefined, 0, 0, rng);
    expect(f.finished).toBe(true);
    expect(f.edge).toBeNull();
  });

  it('laps a looping route without ever finishing', () => {
    const f = new RouteFollower();
    const lap: Leg[] = [4, 5, 6, 7].map((i) => ({ edge: g.edges[i], dir: 1 as const }));
    f.startRoute(g, lap, 10, 10, -120, rng, true);
    const visited = drive(g, f, rng, 2200);
    expect(f.finished).toBe(false);
    expect(visited.slice(0, 5)).toEqual(['Ring SE+', 'Ring SW+', 'Ring NW+', 'Ring NE+', 'Ring SE+']);
    expect(visited.length).toBeGreaterThan(7);
  });

  it('knows the junction it is approaching', () => {
    const f = new RouteFollower();
    f.startRoute(g, [{ edge: south, dir: -1 }, { edge: east, dir: 1 }], 60, 0, 60, rng);
    expect(f.node).toBe(0);
    expect(f.junction).toBe(true);
    expect(f.turn).toBeCloseTo(-Math.PI / 2);
    expect(f.trimEnd).toBeCloseTo(4.75 + DRIVE.junctionPad);
    expect(f.nextTrimStart).toBeCloseTo(4.75 + DRIVE.junctionPad);
    // Entering from the south on the west side of the road, leaving east on the north side.
    expect(f.inX).toBeLessThan(0);
    expect(f.inZ).toBeCloseTo(f.trimEnd);
    expect(f.outX).toBeCloseTo(f.nextTrimStart);
    expect(f.outZ).toBeLessThan(0);
    expect(f.chord).toBeGreaterThan(8);
    expect(f.connLength).toBeGreaterThanOrEqual(f.chord);
  });

  it('treats a plain bend between two roads as a turn but not a junction', () => {
    const bend = buildGraph([
      { name: 'A', pts: [[0, 100], [0, 0]] },
      { name: 'B', pts: [[0, 0], [100, 0]] },
    ]);
    const f = new RouteFollower();
    f.startRoute(bend, [{ edge: bend.edges[0], dir: 1 }, { edge: bend.edges[1], dir: 1 }], 20, 0, 80, rng);
    expect(f.junction).toBe(false);
    expect(Math.abs(f.turn)).toBeCloseTo(Math.PI / 2);
    expect(f.trimEnd).toBeGreaterThan(4);
    const straight = buildGraph([
      { name: 'A', pts: [[0, 100], [0, 0]] },
      { name: 'B', pts: [[0, 0], [0, -100]] },
    ]);
    f.startRoute(straight, [{ edge: straight.edges[0], dir: 1 }, { edge: straight.edges[1], dir: 1 }], 20, 0, 80, rng);
    expect(f.junction).toBe(false);
    expect(f.trimEnd).toBe(0);
    expect(f.connLength).toBeLessThan(0.01);
  });

  it('gives a continuous path that keeps left through a junction', () => {
    const f = new RouteFollower();
    f.startRoute(g, [{ edge: south, dir: -1 }, { edge: east, dir: 1 }, { edge: ringSE, dir: 1 }], 30, 0, 30, rng);
    let px = NaN;
    let pz = NaN;
    for (let d = 0; d <= 60; d += 0.5) {
      f.pathPoint(d, 0, p);
      if (!Number.isNaN(px)) expect(Math.hypot(p.x - px, p.z - pz)).toBeLessThan(1.2);
      px = p.x;
      pz = p.z;
      // Northbound on the west side, then eastbound on the north side; never across the far kerbs.
      expect(p.x).toBeGreaterThan(-4.75);
      expect(p.z).toBeGreaterThan(-4.75);
    }
    f.pathPoint(5, 0, p);
    expect(p.x).toBeCloseTo(-south.width / 4);
    expect(p.tz).toBeCloseTo(-1);
    f.pathPoint(60, 0, p);
    expect(p.z).toBeCloseTo(-east.width / 4);
    expect(p.tx).toBeCloseTo(1);
  });

  it('clamps the path at the end of the road when there is nowhere further to go', () => {
    const f = new RouteFollower();
    f.startRoute(g, [{ edge: north, dir: 1 }], 100, 0, -100, rng);
    f.pathPoint(80, 0, p);
    expect(p.z).toBeCloseTo(-120);
  });
});

describe('wandering', () => {
  it('keeps going for ever through legal, connected legs', () => {
    const g = crossroads();
    const rng = new Rng(5);
    const f = new RouteFollower();
    f.startWander(g, g.edges[2], -1, 100, rng);
    const names = new Set<string>();
    let previousEnd = legEnd(f.edge!, f.dir);
    f.pathPoint(0, 0, p);
    const at = { x: p.x, z: p.z };
    for (let i = 0; i < 20000; i++) {
      if (advance(g, f, rng, at)) {
        expect(legStart(f.edge!, f.dir)).toBe(previousEnd);
        previousEnd = legEnd(f.edge!, f.dir);
        names.add(f.edge!.name);
      }
      expect(f.nextEdge).not.toBeNull();
    }
    expect(f.finished).toBe(false);
    expect(names.size).toBeGreaterThanOrEqual(6);
  });

  it('turns round at a dead end and flags it', () => {
    const g = buildGraph([{ name: 'Cul-de-sac', pts: [[0, 0], [0, 80]] }]);
    const rng = new Rng(2);
    const f = new RouteFollower();
    f.startWander(g, g.edges[0], 1, 10, rng);
    expect(f.deadEnd).toBe(true);
    expect(f.nextEdge).toBe(g.edges[0]);
    expect(f.nextDir).toBe(-1);
    const visited = drive(g, f, rng, 400);
    expect(visited[0]).toBe('Cul-de-sac-');
  });
});
