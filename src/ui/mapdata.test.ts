import { describe, expect, it } from 'vitest';
import type { District, EdgeSample, RailLine, RoadEdge } from '../core/types';
import { CELL_M, MapData, ROAD_ORDER, T_LAND, T_PARK, T_SUBURB, T_TOWN, T_WATER, terrainOf, TILE_M, WATER_FULL, waterOf, type MapWorld } from './mapdata';

const PLAINS: District = { id: 'plains', name: 'Canterbury Plains', city: null, type: 'rural' };
const CENTRAL: District = { id: 'cbd', name: 'Central City', city: 'christchurch', type: 'cbd' };
const HAGLEY: District = { id: 'hagley', name: 'Hagley Park', city: 'christchurch', type: 'park' };
const INNER: District = { id: 'inner', name: 'Christchurch', city: 'christchurch', type: 'villa' };

function edge(index: number, cls: RoadEdge['cls'], pts: [number, number][], extra: Partial<RoadEdge> = {}): RoadEdge {
  // Resample every 4 m like the real graph does.
  const samples: EdgeSample[] = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 4));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      samples.push({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len, s: s + len * t });
    }
    s += len;
  }
  return { index, name: 'Test Road', cls, a: 0, b: 1, samples, length: s, width: 9, lanes: 1, speedLimit: 14, oneway: false, bridge: false, tunnel: false, footpaths: true, drivable: true, ...extra };
}

function fakeWorld(): MapWorld & { calls: number } {
  const rail: RailLine = { name: 'Main South Line', kind: 'main', length: 1000, points: Array.from({ length: 101 }, (_, i) => ({ x: -500 + i * 10, y: 0, z: 100 })) };
  const world = {
    calls: 0,
    bounds: { minX: -1024, maxX: 1024, minZ: -1024, maxZ: 1024 },
    graph: {
      edges: [
        edge(0, 'street', [[-400, 0], [400, 0]]),
        edge(1, 'highway', [[0, -900], [0, 900]]),
        edge(2, 'lane', [[600, 600], [700, 600], [700, 700]], { tunnel: true }),
      ],
    },
    railways: [rail],
    // Sea east of x = 800.
    waterDepthAt(x: number, _z: number) {
      world.calls++;
      return x > 800 ? 5 : 0;
    },
    districtAt(x: number, z: number): District {
      if (Math.abs(x) < 100 && Math.abs(z) < 100) return CENTRAL;
      if (x < -300 && x > -500 && Math.abs(z) < 300) return HAGLEY;
      if (Math.abs(x) < 600 && Math.abs(z) < 600) return INNER;
      return PLAINS;
    },
  };
  return world;
}

function rawCell(data: MapData, x: number, z: number): number {
  const c = Math.floor((x - data.minX) / CELL_M);
  const r = Math.floor((z - data.minZ) / CELL_M);
  return data.cells[r * data.cols + c];
}

/** Land-use code of the cell containing a point. */
function cellAt(data: MapData, x: number, z: number): number {
  return terrainOf(rawCell(data, x, z));
}

describe('MapData network', () => {
  it('simplifies roads and keeps their class', () => {
    const data = new MapData(fakeWorld());
    data.buildNetwork();
    expect(data.roads).toHaveLength(3);
    expect(Array.from(data.roads[0].pts)).toEqual([-400, 0, 400, 0]);
    expect(ROAD_ORDER[data.roads[0].cls]).toBe('street');
    expect(ROAD_ORDER[data.roads[1].cls]).toBe('highway');
    expect(Array.from(data.roads[2].pts)).toEqual([600, 600, 700, 600, 700, 700]);
    expect(data.roads[2].tunnel).toBe(true);
    expect(data.rails).toHaveLength(1);
    expect(Array.from(data.rails[0].pts)).toEqual([-500, 100, 500, 100]);
  });

  it('bins roads into the tiles they cross', () => {
    const data = new MapData(fakeWorld());
    data.buildNetwork();
    expect(data.tilesX).toBe(2048 / TILE_M);
    // The east–west street runs along z = 0, the boundary between tile rows 1 and 2 (margin puts it in both).
    for (const tz of [1, 2]) {
      for (const tx of [1, 2]) expect(data.roadsInTile(tx, tz)).toContain(0);
    }
    expect(data.roadsInTile(0, 0)).toBeUndefined();
    // The highway runs the length of the map along x = 0.
    for (let tz = 0; tz < data.tilesZ; tz++) expect(data.roadsInTile(1, tz)).toContain(1);
    expect(data.roadsInTile(3, 3)).toEqual([2]);
    expect(data.railsInTile(1, 2)).toEqual([0]);
    expect(data.railsInTile(1, 0)).toBeUndefined();
  });

  it('is safe to build twice', () => {
    const data = new MapData(fakeWorld());
    data.buildNetwork();
    data.buildNetwork();
    expect(data.roads).toHaveLength(3);
  });
});

describe('MapData survey', () => {
  it('classifies land use and finishes', () => {
    const data = new MapData(fakeWorld());
    let guard = 0;
    while (data.survey(50, 0, 0) && guard++ < 10000);
    expect(data.done).toBe(true);
    expect(data.progress).toBe(1);
    expect(cellAt(data, 0, 0)).toBe(T_TOWN);
    expect(cellAt(data, -400, 0)).toBe(T_PARK);
    expect(cellAt(data, 300, 300)).toBe(T_SUBURB);
    expect(cellAt(data, -900, -900)).toBe(T_LAND);
    expect(cellAt(data, 900, 0)).toBe(T_WATER);
    // Finished: further calls do nothing.
    expect(data.survey(50, 0, 0)).toBe(false);
  });

  it('records how much of each cell is water, so narrow rivers stay continuous', () => {
    const world = fakeWorld();
    // A 9 m wide stream running east–west along z = 404 (narrower than a 16 m cell, and off the cell centres).
    world.waterDepthAt = (x: number, z: number) => (x > 800 ? 5 : Math.abs(z - 404) < 4.5 ? 1 : 0);
    const data = new MapData(world);
    while (data.survey(50, 0, 0));
    for (let x = -700; x < 700; x += CELL_M) {
      const cell = rawCell(data, x, 404);
      expect(waterOf(cell)).toBeGreaterThan(0);
      expect(waterOf(cell)).toBeLessThan(WATER_FULL);
      // Still counted as land for colour and labels.
      expect(terrainOf(cell)).not.toBe(T_WATER);
    }
    expect(waterOf(rawCell(data, 0, 300))).toBe(0);
    expect(waterOf(rawCell(data, 900, 0))).toBe(WATER_FULL);
    expect(terrainOf(rawCell(data, 900, 0))).toBe(T_WATER);
  });

  it('gives the whole map rough colour before refining', () => {
    const data = new MapData(fakeWorld());
    const rects: number[][] = [];
    data.onCells = (c0, r0, c1, r1) => rects.push([c0, r0, c1, r1]);
    // One generous call completes the coarse pass.
    data.survey(1000, 0, 0);
    expect(cellAt(data, 950, 950)).toBe(T_WATER);
    expect(cellAt(data, 30, 30)).toBe(T_TOWN);
    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0][0]).toBe(0);
    expect(rects[0][2]).toBe(data.cols);
    expect(data.done).toBe(false);
    expect(data.labels.length).toBeGreaterThan(0);
  });

  it('refines the blocks nearest the focus first', () => {
    const data = new MapData(fakeWorld());
    data.survey(1000, 0, 0); // coarse pass
    const rects: number[][] = [];
    data.onCells = (c0, r0, c1, r1) => rects.push([c0, r0, c1, r1]);
    let guard = 0;
    while (rects.length === 0 && guard++ < 1000) data.survey(0.01, 900, -900);
    // Focus is in the north-east corner: the first refined block is the top-right one.
    expect(rects[0][2]).toBe(data.cols);
    expect(rects[0][1]).toBe(0);
  });

  it('respects a tiny budget by spreading the work over many calls', () => {
    const world = fakeWorld();
    const data = new MapData(world);
    let calls = 0;
    while (data.survey(0, 0, 0) && calls++ < 1e6);
    expect(data.done).toBe(true);
    expect(calls).toBeGreaterThan(50);
  });

  it('finds label positions for towns and suburbs', () => {
    const data = new MapData(fakeWorld());
    while (data.survey(50, 0, 0));
    const city = data.labels.find((l) => l.kind === 'city');
    expect(city?.name).toBe('Christchurch');
    expect(Math.abs(city!.x)).toBeLessThan(40);
    expect(Math.abs(city!.z)).toBeLessThan(40);
    const park = data.labels.find((l) => l.name === 'Hagley Park');
    expect(park?.kind).toBe('district');
    expect(park!.x).toBeGreaterThan(-420);
    expect(park!.x).toBeLessThan(-380);
    expect(park!.size).toBeGreaterThan(300);
    // The suburb that shares the town's name is not labelled twice.
    expect(data.labels.filter((l) => l.name === 'Christchurch')).toHaveLength(1);
    // Towns sort ahead of suburbs.
    expect(data.labels[0].kind).toBe('city');
    expect(data.labels.find((l) => l.name === 'Canterbury Plains')?.rural).toBe(true);
  });

  it('carries te reo names on labels', () => {
    const world = fakeWorld();
    const base = world.districtAt;
    const hagley: District = { ...HAGLEY, teReo: 'Test Reo' };
    world.districtAt = (x, z) => (base(x, z) === HAGLEY ? hagley : base(x, z));
    const data = new MapData(world);
    while (data.survey(50, 0, 0));
    expect(data.labels.find((l) => l.kind === 'city')?.teReo).toBe('Ōtautahi');
    expect(data.labels.find((l) => l.name === 'Hagley Park')?.teReo).toBe('Test Reo');
    expect(data.labels.find((l) => l.name === 'Canterbury Plains')?.teReo).toBe('Kā Pākihi-whakatekateka-a-Waitaha');
    expect(data.labels.find((l) => l.name === 'Central City')?.teReo).toBe('');
  });
});
