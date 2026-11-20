import { describe, expect, it } from 'vitest';
import type { RoadEdge, WorldApi } from '../../core/types';
import { buildGraph } from '../../ai/testgraph';
import { fakeMaterials, RecordingBuilder } from '../landmarks/rural/fakes';
import { compileMap } from '../map';
import { buildMap } from '../mapdata';
import { getProp } from '../props';
import '../props/extra';
import { PROP_PHYSICS } from '../props/physics';
import { chevronBoards, chevrons } from './chevrons';

/** A quarter circle of radius `r` turning left (heading increasing) from heading 0, with straights either side. */
function bend(r: number, left: boolean, options: { footpaths?: boolean; speed?: number } = {}): RoadEdge {
  const pts: [number, number][] = [[0, -200]];
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * (Math.PI / 2);
    // Starts at the origin heading +z; a left turn bends towards +x.
    const x = (left ? 1 : -1) * (r - r * Math.cos(a));
    pts.push([x, r * Math.sin(a)]);
  }
  const end = pts[pts.length - 1];
  pts.push([end[0] + (left ? 200 : -200), end[1]]);
  return buildGraph([{ cls: 'highway', pts, footpaths: options.footpaths, speed: options.speed ?? 100 }]).edges[0];
}

/** Where the bend's centre is, for each test road. */
const centre = (r: number, left: boolean) => ({ x: left ? r : -r, z: 0 });

describe('curve chevron boards', () => {
  it('line the outside of a sharp bend, a few metres off the seal, and point into it from both directions', () => {
    for (const left of [true, false]) {
      const r = 120;
      const e = bend(r, left);
      const boards = chevronBoards(e);
      expect(boards.length).toBeGreaterThanOrEqual(8);
      const c = centre(r, left);
      for (const b of boards) {
        // Outside: further from the bend's centre than the road is.
        const p = e.samples[b.i];
        expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThan(Math.hypot(p.x - c.x, p.z - c.z) + e.width / 2);
        expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeCloseTo(e.width / 2 + 1.9, 1);
        // The chevron (the board's local +x) points across the road towards the inside of the curve, which is
        // where the road goes for drivers coming either way.
        const px = Math.cos(b.yaw);
        const pz = -Math.sin(b.yaw);
        expect(px * (c.x - b.x) + pz * (c.z - b.z)).toBeGreaterThan(0);
        // And the board is square to the road, so it faces the traffic.
        expect(Math.abs(Math.sin(b.yaw) * p.tz - Math.cos(b.yaw) * p.tx)).toBeLessThan(0.35);
      }
      // A run from before the bend to after it, a dozen metres apart.
      const along = boards.map((b) => e.samples[b.i].s);
      for (let k = 1; k < along.length; k++) expect(along[k] - along[k - 1]).toBeGreaterThan(9);
      const arcStart = 200;
      const arcEnd = 200 + (r * Math.PI) / 2;
      expect(along[0]).toBeLessThan(arcStart + 10);
      expect(along[along.length - 1]).toBeGreaterThan(arcEnd - 10);
    }
  });

  it('leave gentle curves, town streets and slow roads alone', () => {
    // A 100 km/h road can take a 500 m radius without a second thought.
    expect(chevronBoards(bend(500, true))).toHaveLength(0);
    // Kerbs and footpaths: a town corner, not the open road.
    expect(chevronBoards(bend(40, true, { footpaths: true }))).toHaveLength(0);
    // The same tight corner at 30 km/h.
    expect(chevronBoards(bend(30, true, { speed: 30 }))).toHaveLength(0);
    // But at 50 km/h it is signed.
    expect(chevronBoards(bend(30, true, { speed: 50 })).length).toBeGreaterThanOrEqual(3);
    const straight = buildGraph([{ cls: 'highway', pts: [[0, 0], [0, 600]] }]).edges[0];
    expect(chevronBoards(straight)).toHaveLength(0);
  });

  it('is a breakable, shadowless, single-draw prop', () => {
    const def = getProp('chevron-board', fakeMaterials())!;
    expect(def.parts).toHaveLength(1);
    expect(def.castShadow).toBe(false);
    expect(PROP_PHYSICS['chevron-board']).toMatchObject({ solidTo: 'vehicles' });
    expect(PROP_PHYSICS['chevron-board'].breakSpeed).toBeLessThan(4);
  });

  it('turn up on the real map’s hill roads and highway bends, never on a carriageway', () => {
    const map = compileMap(buildMap());
    const world = {
      graph: map.graph,
      places: map.places,
      landmarks: map.landmarks,
      railways: [],
      heightAt: (x: number, z: number) => map.terrain.height(x, z),
      waterDepthAt: (x: number, z: number) => map.terrain.waterDepth(x, z),
      surfaceAt: (x: number, z: number) => map.terrain.surface(x, z),
      districtAt: (x: number, z: number) => map.districtAt(x, z),
    } as unknown as WorldApi;
    const roads = new Map<string, number>();
    let placed = 0;
    const cells = new Set<string>();
    for (const e of map.graph.edges) {
      for (const b of chevronBoards(e)) {
        roads.set(e.name, (roads.get(e.name) ?? 0) + 1);
        cells.add(`${Math.floor(b.x / 256)},${Math.floor(b.z / 256)}`);
      }
    }
    expect([...roads.keys()]).toEqual(expect.arrayContaining(['Dyers Pass Road', 'State Highway 1']));
    for (const key of cells) {
      const [cx, cz] = key.split(',').map(Number);
      const out = new RecordingBuilder(fakeMaterials(), world);
      chevrons({ minX: cx * 256, minZ: cz * 256, size: 256, seed: 0 }, out);
      for (const r of out.records) {
        if (r.kind !== 'chevron-board') continue;
        placed++;
        const hit = map.graph.nearest(r.x, r.z, 30);
        expect(hit && hit.distance > hit.edge.width / 2 + 1, `board on ${hit?.edge.name} at ${r.x.toFixed(0)}, ${r.z.toFixed(0)}`).toBe(true);
      }
    }
    // A few rows on the bends that need them: cheap, and nowhere near every corner.
    expect(placed).toBeGreaterThan(20);
    expect(placed).toBeLessThan(400);
  });
});
