import { describe, expect, it } from 'vitest';
import type { EdgeSample, RoadEdge, RoadGraph, RoadNode } from '../core/types';
import { CALL_SIGNS, VAN_CALL_SIGN, levelEvent, radioLine, radioLines, whereText, type RadioEvent } from './radio';
import { AIM, MAX_ON_FOOT, MAX_POLICE_VEHICLES, MAX_ROADBLOCKS, aimError, responseFor, sprayCost } from './response';
import { exitsFrom, straightest, walkAhead } from './roadwalk';

describe('response by level', () => {
  it('nothing at level 0, one car to look at level 1, two in pursuit at level 2', () => {
    expect(responseFor(0).cars).toBe(0);
    expect(responseFor(1).cars).toBe(1);
    expect(responseFor(2).cars).toBe(2);
    expect(responseFor(1).shoot).toBe(false);
    expect(responseFor(2).shoot).toBe(false);
  });

  it('level 3 brings three or four cars, gunfire and roadblocks', () => {
    expect(responseFor(3, 0).cars).toBe(3);
    expect(responseFor(3, 0.9).cars).toBe(4);
    expect(responseFor(3).shoot).toBe(true);
    expect(responseFor(3).shotguns).toBe(false);
    expect(responseFor(3).roadblocks).toBeGreaterThan(0);
    expect(responseFor(2).roadblocks).toBe(0);
  });

  it('level 4 adds shotguns and ramming; level 5 adds the armed-response van', () => {
    expect(responseFor(4).shotguns).toBe(true);
    expect(responseFor(4).ram).toBe(true);
    expect(responseFor(3).ram).toBe(false);
    expect(responseFor(4).van).toBe(false);
    expect(responseFor(5).van).toBe(true);
  });

  it('escalates monotonically and respects the caps', () => {
    for (let l = 1; l <= 5; l++) {
      const now = responseFor(l);
      const before = responseFor(l - 1);
      expect(now.cars).toBeGreaterThan(before.cars);
      expect(now.cruise).toBeGreaterThan(before.cruise);
      expect(now.aggression).toBeGreaterThan(before.aggression);
      expect(now.cars).toBeLessThanOrEqual(MAX_POLICE_VEHICLES);
      expect(now.roadblocks).toBeLessThanOrEqual(MAX_ROADBLOCKS);
    }
    expect(MAX_POLICE_VEHICLES).toBe(6);
    expect(MAX_ON_FOOT).toBe(8);
    expect(MAX_ROADBLOCKS).toBe(2);
  });

  it('tolerates out-of-range levels', () => {
    expect(responseFor(-2)).toBe(responseFor(0));
    expect(responseFor(99)).toBe(responseFor(5));
    expect(responseFor(2.7)).toBe(responseFor(2));
  });
});

describe('marksmanship', () => {
  it('is worse at range and at a fast-moving target', () => {
    for (const weapon of ['pistol', 'shotgun'] as const) {
      expect(aimError(weapon, 30, 0)).toBeGreaterThan(aimError(weapon, 5, 0));
      expect(aimError(weapon, 10, 7)).toBeGreaterThan(aimError(weapon, 10, 0));
      expect(aimError(weapon, 0, 0)).toBe(AIM[weapon].base);
      // Never absurd: even a car flat out at long range is aimed at, not away from.
      expect(aimError(weapon, AIM[weapon].range, 60)).toBeLessThan(0.7);
    }
  });

  it('human-ish cadence: a reaction time, and well under machine-gun rates', () => {
    for (const weapon of ['pistol', 'shotgun'] as const) {
      const a = AIM[weapon];
      expect(a.reaction[0]).toBeGreaterThanOrEqual(0.5);
      expect(a.shotGap[0]).toBeGreaterThanOrEqual(0.3);
      expect(a.pause[0]).toBeGreaterThan(a.shotGap[0]);
      expect(a.hold).toBeLessThan(1);
    }
    expect(AIM.shotgun.range).toBeLessThan(AIM.pistol.range);
  });
});

describe('respray price', () => {
  it('scales with the level', () => {
    expect(sprayCost(1)).toBe(250);
    expect(sprayCost(5)).toBe(850);
    for (let l = 2; l <= 5; l++) expect(sprayCost(l)).toBeGreaterThan(sprayCost(l - 1));
    expect(sprayCost(0)).toBe(sprayCost(1));
  });
});

describe('radio', () => {
  const events: RadioEvent[] = ['level1', 'level2', 'level3', 'level4', 'level5', 'lost', 'spotted', 'stepDown', 'allClear', 'roadblock', 'officerDown', 'carStolen', 'gunDrawn'];

  it('has lines for every event and fills in every placeholder', () => {
    for (const event of events) {
      const lines = radioLines(event);
      expect(lines.length, event).toBeGreaterThan(0);
      for (let i = 0; i < lines.length; i++) {
        const line = radioLine(event, 'Tussock One', 'on Colombo St', () => i);
        expect(line).not.toMatch(/[{}]/);
        expect(line.length).toBeLessThan(110); // fits a subtitle
      }
    }
  });

  it('names the unit and the place', () => {
    expect(radioLine('level1', 'Kea Two', 'on Stafford St', () => 0)).toContain('Kea Two');
    expect(radioLine('level1', 'Kea Two', 'on Stafford St', () => 0)).toContain('on Stafford St');
  });

  it('survives a bad pick', () => {
    expect(radioLine('lost', 'a', 'b', () => 99)).toBeTruthy();
    expect(radioLine('lost', 'a', 'b', () => -5)).toBeTruthy();
  });

  it('streets are "on", suburbs are "around"', () => {
    expect(whereText('Moorhouse Ave', 'Sydenham')).toBe('on Moorhouse Ave');
    expect(whereText('Sydenham', 'Sydenham')).toBe('around Sydenham');
  });

  it('maps levels to announcements', () => {
    expect(levelEvent(1)).toBe('level1');
    expect(levelEvent(3)).toBe('level3');
    expect(levelEvent(5)).toBe('level5');
    expect(levelEvent(12)).toBe('level5');
  });

  it('call signs are distinct', () => {
    expect(new Set([...CALL_SIGNS, VAN_CALL_SIGN]).size).toBe(CALL_SIGNS.length + 1);
  });
});

// ───────────── A toy road graph ─────────────
//
//            n3 (0,-200)
//             |  e2 (north)
//   n0 ─e0─ n1 ─e1─ n2 ─e4→ n5      e4 is one-way n2 → n5
// (-200,0) (0,0) (200,0)  (400,0)
//             |  e3            |  e5
//            n4 (0,200)       n6 (400,200)
//        (e3 is not drivable)

function edge(index: number, nodes: RoadNode[], a: number, b: number, extra: Partial<RoadEdge> = {}): RoadEdge {
  const na = nodes[a];
  const nb = nodes[b];
  const length = Math.hypot(nb.x - na.x, nb.z - na.z);
  const tx = (nb.x - na.x) / length;
  const tz = (nb.z - na.z) / length;
  const count = Math.round(length / 4);
  const samples: EdgeSample[] = [];
  for (let i = 0; i <= count; i++) samples.push({ x: na.x + tx * ((i / count) * length), y: 0, z: na.z + tz * ((i / count) * length), tx, tz, s: (i / count) * length });
  const e: RoadEdge = { index, name: `e${index}`, cls: 'street', a, b, samples, length, width: 9.5, lanes: 1, speedLimit: 13.9, oneway: false, bridge: false, tunnel: false, footpaths: true, drivable: true, ...extra };
  na.edges.push(index);
  nb.edges.push(index);
  return e;
}

function toyGraph(): RoadGraph {
  const at = (index: number, x: number, z: number): RoadNode => ({ index, x, y: 0, z, edges: [] });
  const nodes = [at(0, -200, 0), at(1, 0, 0), at(2, 200, 0), at(3, 0, -200), at(4, 0, 200), at(5, 400, 0), at(6, 400, 200)];
  const edges = [
    edge(0, nodes, 0, 1),
    edge(1, nodes, 1, 2),
    edge(2, nodes, 1, 3),
    edge(3, nodes, 1, 4, { drivable: false }),
    edge(4, nodes, 2, 5, { oneway: true }),
    edge(5, nodes, 5, 6),
  ];
  const unused = () => {
    throw new Error('not needed by roadwalk');
  };
  return { nodes, edges, endNode: (e, dir) => nodes[dir === 1 ? e.b : e.a], nearest: unused, pointAt: unused, lanePoint: unused, footpathPoint: unused, route: unused, nearestNode: unused };
}

describe('walking the road graph', () => {
  const g = toyGraph();
  const [e0, e1, e2, , e4, e5] = g.edges;

  it('stays on the same edge when there is room', () => {
    expect(walkAhead(g, e0, 50, 1, 100)).toMatchObject({ edge: e0, s: 150, dir: 1 });
    expect(walkAhead(g, e0, 150, -1, 100)).toMatchObject({ edge: e0, s: 50, dir: -1 });
  });

  it('goes straight on through a junction', () => {
    // 100 m left on e0, then 80 m into e1 (straight on) rather than turning up e2.
    expect(walkAhead(g, e0, 100, 1, 180)).toMatchObject({ edge: e1, s: 80, dir: 1 });
  });

  it('reports which way it is travelling on the new edge', () => {
    // From e2 heading south into the junction: the only ways on are e0 (towards its node a) and e1.
    const w = walkAhead(g, e2, 100, -1, 150, () => 0);
    expect(w).not.toBeNull();
    expect(w!.edge).toBe(e0);
    expect(w!.dir).toBe(-1);
    expect(w!.s).toBe(150);
  });

  it('never turns onto an undrivable road or back the way it came', () => {
    const exits = exitsFrom(g, e0, 1);
    expect(exits.map((o) => o.edge.index).sort()).toEqual([1, 2]);
    expect(exits.find((o) => o.edge === e1)!.straightness).toBeCloseTo(1, 5);
    expect(exits.find((o) => o.edge === e2)!.straightness).toBeCloseTo(0, 5);
    expect(exits[straightest(exits)].edge).toBe(e1);
  });

  it('respects one-way streets', () => {
    // Along e1 and on into the one-way e4 the right way, then round the corner onto e5.
    expect(walkAhead(g, e1, 0, 1, 300)).toMatchObject({ edge: e4, s: 100, dir: 1 });
    expect(walkAhead(g, e1, 0, 1, 450)).toMatchObject({ edge: e5, s: 50, dir: 1 });
    expect(exitsFrom(g, e1, 1).map((o) => o.edge.index)).toEqual([4]);
    // Coming up e5 to the far end of e4, the wrong way down it is not on offer: a dead end.
    expect(exitsFrom(g, e5, -1)).toEqual([]);
    expect(walkAhead(g, e5, 100, -1, 150)).toBeNull();
  });

  it('gives up at a dead end', () => {
    expect(walkAhead(g, e0, 100, -1, 500)).toBeNull();
    expect(walkAhead(g, e2, 0, 1, 250)).toBeNull();
  });

  it('clamps a start position off the end of the edge', () => {
    expect(walkAhead(g, e0, -20, 1, 10)).toMatchObject({ edge: e0, s: 10 });
    expect(walkAhead(g, e0, 999, -1, 10)).toMatchObject({ edge: e0, s: 190 });
  });
});
