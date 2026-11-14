import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { makePoint } from './lanes';
import { buildGraph, crossroads } from './testgraph';
import { PEDS } from './tuning';
import { choosePedMove, crossingCount, footpathInto, makeMove, walkOffset, walkTrim, walkable } from './walk';

const p = makePoint();
const move = makeMove();

describe('footpaths', () => {
  const g = crossroads();
  const [north, , south] = g.edges;

  it('match RoadGraph.footpathPoint when there is no jitter', () => {
    for (const side of [1, -1] as const) {
      for (const s of [0, 12.5, 77, 120]) {
        const ref = g.footpathPoint(south, s, side);
        footpathInto(south, s, side, 0, p);
        expect(p.x).toBeCloseTo(ref.x, 6);
        expect(p.z).toBeCloseTo(ref.z, 6);
      }
    }
  });

  it('jitter keeps walkers on the footpath strip', () => {
    for (const j of [-1, -0.3, 0.4, 1]) {
      const off = walkOffset(south, 1, j);
      expect(off).toBeGreaterThan(south.width / 2 + 0.3);
      expect(off).toBeLessThan(south.width / 2 + 3);
      expect(walkOffset(south, -1, j)).toBeCloseTo(-off);
    }
  });

  it('malls are walked down the paving itself', () => {
    const mall = buildGraph([{ pts: [[0, 0], [0, 80]], cls: 'pedestrian', width: 12 }]).edges[0];
    expect(walkable(mall)).toBe(true);
    for (const j of [-1, 0, 0.5, 1]) expect(Math.abs(walkOffset(mall, 1, j))).toBeLessThan(mall.width / 2);
    const highway = buildGraph([{ pts: [[0, 0], [0, 80]], cls: 'highway' }]).edges[0];
    expect(walkable(highway)).toBe(false);
  });

  it('stop short of the junction, as the road mesh does', () => {
    // Other roads at the centre are 9.5 m wide: footpaths are trimmed 4.75 + 0.4 m back.
    expect(walkTrim(g, north, 0)).toBeGreaterThan(4.75 + 0.4);
    expect(walkTrim(g, north, 0)).toBeLessThan(8);
    const stub = buildGraph([{ pts: [[0, 0], [0, 6]] }, { pts: [[0, 0], [50, 0]] }]).edges[0];
    expect(walkTrim(buildGraph([{ pts: [[0, 0], [0, 6]] }, { pts: [[0, 0], [50, 0]] }]), stub, 0)).toBeLessThanOrEqual(6 * 0.45);
  });
});

describe('crossing roads at a corner', () => {
  const g = crossroads();
  // Corner points of the central crossroads (footpath ends), named by compass corner.
  const NW_on_west_arm: [number, number] = [-6, -6.45];
  const NW_on_north_arm: [number, number] = [-6.45, -6];
  const NE_on_north_arm: [number, number] = [6.45, -6];
  const NE_on_east_arm: [number, number] = [6, -6.45];
  const SE_on_east_arm: [number, number] = [6, 6.45];
  const SW_on_west_arm: [number, number] = [-6, 6.45];
  const count = (a: [number, number], b: [number, number]) => crossingCount(g, 0, a[0], a[1], b[0], b[1]);

  it('counts no road when going round the corner', () => {
    expect(count(NW_on_west_arm, NW_on_north_arm)).toBe(0);
    expect(count(NE_on_north_arm, NE_on_east_arm)).toBe(0);
  });

  it('counts one road when crossing straight over', () => {
    expect(count(NW_on_north_arm, NE_on_north_arm)).toBe(1);
    expect(count(NW_on_west_arm, NE_on_east_arm)).toBe(1);
    expect(count(NW_on_west_arm, SW_on_west_arm)).toBe(1);
  });

  it('counts a diagonal as more than one', () => {
    expect(count(NW_on_west_arm, SE_on_east_arm)).toBeGreaterThan(1);
    expect(count(NW_on_north_arm, SE_on_east_arm)).toBeGreaterThan(1);
  });

  it('ignores paving that traffic cannot use', () => {
    const mall = buildGraph([
      { pts: [[0, 0], [0, -80]], cls: 'pedestrian' },
      { pts: [[0, 0], [0, 80]], cls: 'pedestrian' },
    ]);
    expect(crossingCount(mall, 0, -4, -7, 4, -7)).toBe(0);
  });
});

describe('choosing where to walk next', () => {
  const g = crossroads();
  const west = g.edges[3];
  // Standing at the end of West Road's north footpath, at the central crossroads.
  // West Road runs from the centre towards −x, so its left (north, −z) side is side −1… check with the helper.
  const trim = walkTrim(g, west, 0);
  const northSide: 1 | -1 = footpathInto(west, trim, 1, 0, p).z < 0 ? 1 : -1;
  footpathInto(west, trim, northSide, 0, p);
  const px = p.x;
  const pz = p.z;

  it('offers only moves that cross at most one road', () => {
    const rng = new Rng(9);
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      expect(choosePedMove(g, west, northSide, 0, px, pz, 0, rng, PEDS.crossChance, PEDS.uTurnChance, 0, 0, move)).toBe(true);
      const crossings = crossingCount(g, 0, px, pz, move.x, move.z);
      expect(crossings).toBeLessThanOrEqual(1);
      expect(move.crossing).toBe(crossings === 1);
      // The walk along the new footpath leads away from the junction.
      expect(move.dir === 1 ? move.edge.a : move.edge.b).toBe(0);
      seen.add(`${move.edge.name}/${move.x > 0 ? 'E' : 'W'}${move.z > 0 ? 'S' : 'N'}/${move.crossing ? 'cross' : 'free'}`);
    }
    // Round the corner onto North Road, back along West Road, or across one road to the NE or SW corners.
    expect(seen.has('North Road/WN/free')).toBe(true);
    expect(seen.has('West Road/WN/free')).toBe(true);
    expect(seen.has('North Road/EN/cross')).toBe(true);
    expect(seen.has('East Road/EN/cross')).toBe(true);
    expect(seen.has('West Road/WS/cross')).toBe(true);
    expect(seen.has('South Road/WS/cross')).toBe(true);
    // Never straight to the far (SE) corner.
    for (const key of seen) expect(key.includes('/ES/')).toBe(false);
  });

  it('never crosses when crossing is switched off', () => {
    const rng = new Rng(10);
    for (let i = 0; i < 200; i++) {
      choosePedMove(g, west, northSide, 0, px, pz, 0, rng, 0, 0, 0, 0, move);
      expect(move.crossing).toBe(false);
      expect(move.edge.name).toBe('North Road');
    }
  });

  it('when fleeing, heads away from the danger', () => {
    const rng = new Rng(12);
    let north = 0;
    // The threat is to the south-east: north and west are the ways out.
    for (let i = 0; i < 300; i++) {
      choosePedMove(g, west, northSide, 0, px, pz, 0, rng, 1, 0.02, px - 30, pz - 30, move);
      if (move.z < 0 && move.x < 0) north++;
    }
    expect(north).toBeGreaterThan(200);
  });

  it('at a dead end, turns back or crosses to the other side', () => {
    const lone = buildGraph([{ name: 'Cul-de-sac', pts: [[0, 0], [0, 80]] }]);
    const e = lone.edges[0];
    const t = walkTrim(lone, e, 1);
    footpathInto(e, 80 - t, 1, 0, p);
    const rng = new Rng(4);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) {
      expect(choosePedMove(lone, e, 1, 1, p.x, p.z, 0, rng, 0.5, 0.5, 0, 0, move)).toBe(true);
      expect(move.edge).toBe(e);
      expect(move.dir).toBe(-1);
      kinds.add(move.side === 1 ? 'back' : 'over');
      expect(move.crossing).toBe(move.side === -1);
    }
    expect(kinds.size).toBe(2);
  });

  it('reports nowhere to go when nothing is walkable', () => {
    const road = buildGraph([{ pts: [[0, 0], [0, 80]], cls: 'highway' }]);
    expect(choosePedMove(road, road.edges[0], 1, 1, 6, 78, 0, new Rng(1), 0.5, 0.5, 0, 0, move)).toBe(false);
  });
});
