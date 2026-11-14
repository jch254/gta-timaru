import { describe, expect, it } from 'vitest';
import { curveLimit, drivableDegree, edgeCurvature, junctionRadius, laneOffset, lanePointInto, legPointInto, makePoint, projectOnEdge, projection, sampleEdge } from './lanes';
import { buildGraph, crossroads } from './testgraph';

const p = makePoint();

describe('edge sampling', () => {
  const graph = buildGraph([{ pts: [[0, 0], [60, 0], [60, 80]] }]);
  const edge = graph.edges[0];

  it('matches the graph for any distance, including out of range', () => {
    for (const s of [-5, 0, 3.3, 41, 59.9, 61, 100, 139.5, 200]) {
      const ref = graph.pointAt(edge, s);
      sampleEdge(edge, s, p);
      expect(p.x).toBeCloseTo(ref.x, 6);
      expect(p.z).toBeCloseTo(ref.z, 6);
      expect(p.tx).toBeCloseTo(ref.tx, 6);
      expect(p.tz).toBeCloseTo(ref.tz, 6);
    }
  });

  it('projects a point back onto the edge with a signed offset (+ = left of a → b)', () => {
    // First leg runs +x; its left (tz, −tx) is −z.
    expect(projectOnEdge(edge, 20, -3)).toBeCloseTo(20);
    expect(projection.offset).toBeCloseTo(3);
    expect(projection.distance).toBeCloseTo(3);
    projectOnEdge(edge, 20, 2);
    expect(projection.offset).toBeCloseTo(-2);
    // Second leg runs +z; its left is +x.
    expect(projectOnEdge(edge, 64, 50)).toBeCloseTo(110);
    expect(projection.offset).toBeCloseTo(4);
  });

  it('searches only near the hint when given one', () => {
    // The true nearest point is on the second leg, but the hint keeps the search on the first.
    const s = projectOnEdge(edge, 58, 70, 10, 3);
    expect(s).toBeLessThan(30);
    expect(projectOnEdge(edge, 58, 70, 125, 3)).toBeCloseTo(130);
  });
});

describe('lanes', () => {
  const graph = buildGraph([
    { name: 'Street', pts: [[0, 0], [0, 100]] },
    { name: 'Avenue', cls: 'arterial', pts: [[50, 0], [50, 100]] },
    { name: 'One Way', pts: [[100, 0], [100, 100]], oneway: true, lanes: 2, width: 8 },
  ]);
  const [street, avenue, oneway] = graph.edges;

  it('keeps left: lanes sit left of the direction of travel, lane 0 nearest the kerb', () => {
    expect(laneOffset(street, 0)).toBeCloseTo(street.width / 4);
    expect(laneOffset(avenue, 0)).toBeGreaterThan(laneOffset(avenue, 1));
    expect(laneOffset(avenue, 1)).toBeGreaterThan(0);
    expect(laneOffset(avenue, 0)).toBeLessThan(avenue.width / 2);
    // Out-of-range lanes clamp to the innermost.
    expect(laneOffset(avenue, 5)).toBe(laneOffset(avenue, 1));
  });

  it('puts southbound traffic on the east side and northbound on the west', () => {
    // The street runs +z (south); left of that is +x (east).
    lanePointInto(street, 40, 1, 0, 0, p);
    expect(p.x).toBeGreaterThan(0);
    expect(p.tz).toBeCloseTo(1);
    lanePointInto(street, 40, -1, 0, 0, p);
    expect(p.x).toBeLessThan(0);
    expect(p.tz).toBeCloseTo(-1);
  });

  it('agrees with RoadGraph.lanePoint on two-way roads', () => {
    for (const edge of [street, avenue]) {
      for (const dir of [1, -1] as const) {
        for (let lane = 0; lane < edge.lanes; lane++) {
          const ref = graph.lanePoint(edge, 37, dir, lane);
          lanePointInto(edge, 37, dir, lane, 0, p);
          expect(p.x).toBeCloseTo(ref.x, 6);
          expect(p.z).toBeCloseTo(ref.z, 6);
          expect(Math.atan2(p.tx, p.tz)).toBeCloseTo(ref.heading, 6);
        }
      }
    }
  });

  it('centres one-way lanes on the carriageway', () => {
    expect(laneOffset(oneway, 0)).toBeCloseTo(2);
    expect(laneOffset(oneway, 1)).toBeCloseTo(-2);
    const single = buildGraph([{ pts: [[0, 0], [0, 50]], oneway: true }]).edges[0];
    expect(laneOffset(single, 0)).toBeCloseTo(0);
  });

  it('shifts to the right (towards the centre line) to pass things at the kerb', () => {
    lanePointInto(street, 40, 1, 0, 0, p);
    const x = p.x;
    lanePointInto(street, 40, 1, 0, 1.5, p);
    expect(p.x).toBeCloseTo(x - 1.5);
  });

  it('addresses a leg by distance travelled, whichever way it runs', () => {
    legPointInto(street, 1, 30, 0, 0, p);
    expect(p.z).toBeCloseTo(30);
    legPointInto(street, -1, 30, 0, 0, p);
    expect(p.z).toBeCloseTo(70);
  });
});

describe('bends', () => {
  it('finds no curvature on a straight and plenty at a corner', () => {
    const straight = buildGraph([{ pts: [[0, 0], [0, 200]] }]).edges[0];
    expect(Math.max(...edgeCurvature(straight))).toBeLessThan(1e-6);
    expect(curveLimit(straight, 1, 0, 0, 150, 3.4, 3.6)).toBe(Infinity);
    const corner = buildGraph([{ pts: [[0, 0], [0, 100], [100, 100]] }]).edges[0];
    expect(Math.max(...edgeCurvature(corner))).toBeGreaterThan(0.1);
  });

  it('allows more speed the further away the bend is, in either direction', () => {
    const corner = buildGraph([{ pts: [[0, 0], [0, 100], [100, 100]] }]).edges[0];
    const far = curveLimit(corner, 1, 10, 0, 150, 3.4, 3.6);
    const near = curveLimit(corner, 1, 80, 0, 150, 3.4, 3.6);
    const at = curveLimit(corner, 1, 99, 0, 150, 3.4, 3.6);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(at);
    expect(at).toBeLessThan(7);
    expect(at).toBeGreaterThan(2);
    // Past the bend there is nothing left to slow for.
    expect(curveLimit(corner, 1, 120, 0, 60, 3.4, 3.6)).toBe(Infinity);
    // Coming the other way the bend is 100 m into the leg as well.
    expect(curveLimit(corner, -1, 80, 0, 150, 3.4, 3.6)).toBeCloseTo(near, 0);
    // A bend beyond the look distance is ignored.
    expect(curveLimit(corner, 1, 10, 0, 40, 3.4, 3.6)).toBe(Infinity);
    // `lead` pushes the whole leg further away.
    expect(curveLimit(corner, 1, 80, 30, 150, 3.4, 3.6)).toBeGreaterThan(near);
  });

  it('gentle curves allow open-road speed', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) pts.push([400 * Math.sin((i / 40) * 0.8), 400 * (1 - Math.cos((i / 40) * 0.8))]);
    const sweep = buildGraph([{ pts, cls: 'highway' }]).edges[0];
    const limit = curveLimit(sweep, 1, 50, 0, 150, 3.4, 3.6);
    // v = sqrt(a·r) ≈ sqrt(3.4 × 400) ≈ 37 m/s.
    expect(limit).toBeGreaterThan(30);
    expect(limit).toBeLessThan(45);
  });
});

describe('junction size', () => {
  it('counts drivable roads and takes the widest', () => {
    const graph = crossroads({ ewClass: 'arterial' });
    expect(drivableDegree(graph, 0)).toBe(4);
    expect(junctionRadius(graph, 0)).toBeCloseTo(7.5);
    const mall = buildGraph([
      { pts: [[0, 0], [0, 50]] },
      { pts: [[0, 0], [0, -50]] },
      { pts: [[0, 0], [50, 0]], cls: 'pedestrian', width: 20 },
    ]);
    expect(drivableDegree(mall, 0)).toBe(2);
    expect(junctionRadius(mall, 0)).toBeCloseTo(4.75);
  });
});
