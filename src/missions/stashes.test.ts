// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Lot, Place } from '../core/types';
import { generateLots } from '../world/lots';
import { compileMap } from '../world/map';
import { buildMap } from '../world/mapdata';
import { findStashes, inLot, reachable, STASH, STASH_REGIONS, type Stash, type StashWorld } from './stashes';

/** The real map, without a browser: the same roads, plots, places and landmarks the game streams in. */
const map = compileMap(buildMap());
const lots: Lot[] = [...generateLots(map).values()].flat();
const world: StashWorld = {
  graph: map.graph,
  places: map.places,
  place(id: string): Place {
    const place = map.places.find((p) => p.id === id);
    if (!place) throw new Error(`no place ${id}`);
    return place;
  },
  landmarks: map.landmarks,
  railways: map.rails.map((r) => ({ name: r.source.name, kind: r.source.kind, points: r.samples.map((p) => ({ x: p.x, y: 0, z: p.z })), length: r.samples[r.samples.length - 1].s })),
  waterDepthAt: (x, z) => map.terrain.waterDepth(x, z),
  lotsNear: (x, z, radius) => lots.filter((lot) => Math.hypot(lot.x - x, lot.z - z) <= radius + Math.hypot(lot.width, lot.depth) / 2),
};

const started = performance.now();
const stashes = findStashes(world);
const took = performance.now() - started;
const count = (test: (s: Stash) => boolean) => stashes.filter(test).length;

describe('stashes on the real map', () => {
  // `STASHES=1 pnpm exec vitest run src/missions/stashes.test.ts` prints where they all are.
  it('lists them on request', () => {
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.STASHES) {
      console.log('\n' + stashes.map((s) => `${s.id.padEnd(22)} ${s.kind.padEnd(8)} ${s.x.toFixed(0).padStart(6)}, ${s.z.toFixed(0).padStart(6)}  ${map.districtAt(s.x, s.z).type}`).join('\n') + `\n${took.toFixed(0)} ms`);
    }
    expect(stashes.length).toBeGreaterThan(0);
  });

  it('fills every region: thirty in all, the same every time', () => {
    for (const region of STASH_REGIONS) expect(count((s) => s.region === region.id), region.id).toBe(region.kinds.length);
    expect(stashes.length).toBe(30);
    expect(new Set(stashes.map((s) => s.id)).size).toBe(stashes.length);
    expect(findStashes(world)).toEqual(stashes);
    // Worked out once, when the game starts: it must not hold the loading screen up.
    expect(took).toBeLessThan(1500);
  });

  it('has exactly two katanas, one in Christchurch and one at the port in Timaru', () => {
    expect(stashes.filter((s) => s.kind === 'katana').map((s) => s.region)).toEqual(['chch-cbd', 'timaru-port']);
    // Mostly blades and pistols; the long guns are at the ports and in the country.
    expect(count((s) => s.kind === 'knife' || s.kind === 'pistol')).toBeGreaterThan(15);
    for (const s of stashes) if (s.kind === 'rifle' || s.kind === 'shotgun') expect(['sydenham', 'lyttelton', 'timaru-port', 'washdyke', 'temuka', 'rakaia', 'rangitata', 'hinds'], s.id).toContain(s.region);
  });

  it('lie on open dry ground round the back: off the roads and rails, outside every plot, landmark and marae', () => {
    for (const s of stashes) {
      expect(world.waterDepthAt(s.x, s.z), s.id).toBe(0);
      expect(lots.filter((lot) => inLot(lot, s.x, s.z, 0.4)).length, `${s.id} in a plot`).toBe(0);
      const hit = map.graph.nearest(s.x, s.z, 80);
      if (hit) expect(hit.distance, `${s.id} on ${hit.edge.name}`).toBeGreaterThanOrEqual(hit.edge.width / 2 + STASH.roadClear);
      expect(map.landmarks.filter((l) => Math.hypot(l.x - s.x, l.z - s.z) <= l.clearRadius).map((l) => l.kind), `${s.id} in a landmark`).toEqual([]);
      expect(map.rails.some((rail) => rail.samples.some((p) => Math.hypot(p.x - s.x, p.z - s.z) <= 3)), `${s.id} on the rails`).toBe(false);
      // Hidden means behind something: a building plot stands within a few metres.
      expect(lots.some((lot) => inLot(lot, s.x, s.z, STASH.behind + 0.5)), `${s.id} behind a plot`).toBe(true);
    }
  });

  it('can be walked to from a road, and a spot walled in on every side cannot', () => {
    for (const s of stashes) expect(reachable(world, s.x, s.z), s.id).toBe(true);
    // The middle of a building plot far bigger than the fill can cross: boxed in.
    const lot = lots.find((l) => l.width > 12 && l.depth > 12)!;
    expect(reachable({ ...world, lotsNear: () => [{ ...lot, width: 200, depth: 200 }] }, lot.x, lot.z)).toBe(false);
  });

  it('keep clear of each other, of mission places, and of the start of the story', () => {
    const start = world.place(STASH.earlyPlace);
    for (const s of stashes) {
      const crowd = stashes.filter((other) => other !== s && Math.hypot(other.x - s.x, other.z - s.z) < STASH.spacing).map((other) => other.id);
      expect(crowd, `too near ${s.id}`).toEqual([]);
      expect(map.places.filter((p) => Math.hypot(p.x - s.x, p.z - s.z) < STASH.placeClear).map((p) => p.id), `${s.id} by a place`).toEqual([]);
      // The first job is done with a cricket bat: no gun and no katana within reach of the Bay Hill.
      if (Math.hypot(start.x - s.x, start.z - s.z) < STASH.earlyRadius) expect(['knife', 'bat'], s.id).toContain(s.kind);
    }
  });
});
