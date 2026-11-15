import { describe, expect, it } from 'vitest';
import type { Lot, WorldApi } from '../../core/types';
import { MISSIONS } from '../../missions/defs';
import { CAMEOS } from '../../missions/defs/cameos';
import { newResolved, resolveSpot, type Resolved } from '../../missions/spots';
import type { Spot } from '../../missions/types';
import { LANDMARKS } from '../landmarks';
import { fakeMaterials, RecordingBuilder } from '../landmarks/rural/fakes';
import { generateLots } from '../lots';
import { compileMap } from '../map';
import { buildMap } from '../mapdata';
import { getProp } from '../props';
import '../props/extra';
import { PROP_PHYSICS } from '../props/physics';
import { edgeFurniture } from '../roadmesh';
import { SCATTERERS } from './index';
import { approachControl } from './util';

/**
 * The real map, dressed: nothing solid that the scatterers or the landmarks put down may stand where a mission
 * or a cameo needs the ground (a marker, a spawned car, a character's spot), and the street furniture has to
 * agree with what the road painter draws.
 */

const CHUNK = 256;
const map = compileMap(buildMap());
const lots: Lot[] = [...generateLots(map).values()].flat();
const world = {
  bounds: { minX: -3072, maxX: 3072, minZ: -6144, maxZ: 6144 },
  seaLevel: 0,
  graph: map.graph,
  places: map.places,
  landmarks: map.landmarks,
  railways: map.rails.map((r) => ({ points: r.samples.map((q) => ({ x: q.x, y: map.terrain.height(q.x, q.z), z: q.z })) })),
  heightAt: (x: number, z: number) => map.terrain.height(x, z),
  groundAt: (x: number, z: number) => map.terrain.height(x, z),
  waterDepthAt: (x: number, z: number) => map.terrain.waterDepth(x, z),
  surfaceAt: (x: number, z: number) => map.terrain.surface(x, z),
  districtAt: (x: number, z: number) => map.districtAt(x, z),
  lotsNear: (x: number, z: number, radius: number) => lots.filter((lot) => Math.hypot(lot.x - x, lot.z - z) <= radius + Math.hypot(lot.width, lot.depth) / 2),
  place(id: string) {
    const found = map.places.find((q) => q.id === id);
    if (!found) throw new Error(`Unknown place "${id}"`);
    return found;
  },
} as unknown as WorldApi;

const built = new Map<number, RecordingBuilder>();
/** Everything the scatterers and the landmarks put in one chunk. */
function chunk(cx: number, cz: number): RecordingBuilder {
  const key = cx * 4096 + cz;
  let out = built.get(key);
  if (!out) {
    out = new RecordingBuilder(fakeMaterials(), world);
    for (const l of map.landmarks) if (Math.floor(l.x / CHUNK) === cx && Math.floor(l.z / CHUNK) === cz) LANDMARKS[l.kind]?.(l, out);
    for (const scatterer of SCATTERERS) scatterer({ minX: cx * CHUNK, minZ: cz * CHUNK, size: CHUNK, seed: key }, out);
    built.set(key, out);
  }
  return out;
}

/** Half the footprint of a solid prop, or 0 when the kind is not solid. */
function solid(kind: string): number {
  const rule = PROP_PHYSICS[kind];
  const def = getProp(kind, fakeMaterials());
  if (rule?.box) return Math.max(rule.box.hx, rule.box.hz);
  return def?.collider ? def.collider.radius : 0;
}

interface Need {
  what: string;
  x: number;
  z: number;
  /** Clear ground wanted round the point. */
  r: number;
}

/** Every spot the missions and the cameos name, in the order the missions spawn things (so entity spots resolve). */
function needs(): Need[] {
  const out: Need[] = [];
  for (const def of [...MISSIONS, ...CAMEOS]) {
    const entities = new Map<string, Resolved>();
    const lookup = (name: string, to: Resolved) => {
      const known = entities.get(name);
      if (known) Object.assign(to, known);
      return !!known;
    };
    const visit = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((child, i) => visit(child, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const key of ['at', 'to', 'needs', 'grid']) {
        const spot = o[key] as Spot | undefined;
        if (spot === undefined || (typeof spot !== 'string' && typeof spot !== 'object')) continue;
        const at = resolveSpot(world, spot, newResolved(), lookup);
        if (!at.ok) continue;
        const vehicle = typeof o.kind === 'string' && /vehicle/i.test(o.kind);
        out.push({ what: `${(def as { id: string }).id} ${path}.${key}`, x: at.x, z: at.z, r: vehicle ? 3.2 : 1.2 });
        if (key === 'at' && typeof o.as === 'string') entities.set(o.as, { ...at });
      }
      for (const [key, child] of Object.entries(o)) if (child && typeof child === 'object') visit(child, `${path}.${key}`);
    };
    visit(def, '');
  }
  return out;
}

describe('the dressed map', () => {
  it('leaves every mission and cameo spot clear of solid props', () => {
    const wanted = needs();
    expect(wanted.length).toBeGreaterThan(40);
    for (const n of wanted) {
      for (let cx = Math.floor((n.x - 8) / CHUNK); cx <= Math.floor((n.x + 8) / CHUNK); cx++) {
        for (let cz = Math.floor((n.z - 8) / CHUNK); cz <= Math.floor((n.z + 8) / CHUNK); cz++) {
          for (const r of chunk(cx, cz).records) {
            if (r.op !== 'instance') continue;
            const half = solid(r.kind!);
            if (half > 0) expect(Math.hypot(r.x - n.x, r.z - n.z), `${r.kind} at ${r.x.toFixed(1)}, ${r.z.toFixed(1)} on ${n.what}`).toBeGreaterThan(n.r + half);
          }
        }
      }
    }
  });

  it('stands a stop or give-way sign at the painted limit lines, cars in marked bays and poles at the zebras', () => {
    const counts: Record<string, number> = {};
    const seen = new Set<number>();
    let stops = 0;
    let zebras = 0;
    for (const e of map.graph.edges) {
      const plan = edgeFurniture(map, e);
      if (plan.zebra !== null) zebras++;
      for (const node of [e.a, e.b]) if (e.footpaths && approachControl(map.graph, e, node) === 'stop') stops++;
      if (!plan.parking && plan.zebra === null) continue;
      const mid = e.samples[e.samples.length >> 1];
      const key = Math.floor(mid.x / CHUNK) * 4096 + Math.floor(mid.z / CHUNK);
      if (seen.has(key) || seen.size >= 24) continue;
      seen.add(key);
      for (const r of chunk(Math.floor(mid.x / CHUNK), Math.floor(mid.z / CHUNK)).records) {
        if (r.op !== 'instance') continue;
        counts[r.kind!] = (counts[r.kind!] ?? 0) + 1;
        // A parked car stands in a bay: on a carriageway, hard against its kerb, on a street marked for parking.
        if (!/^(car-parked|car-parked-wagon|van-parked)$/.test(r.kind!)) continue;
        const hit = map.graph.nearest(r.x, r.z, 12);
        if (!hit || hit.distance > hit.edge.width / 2) continue;
        expect(edgeFurniture(map, hit.edge).parking, `${r.kind} in ${hit.edge.name}`).toBe(true);
        expect(hit.edge.oneway && hit.offset < 0, `${r.kind} on the traffic system's side of ${hit.edge.name}`).toBe(true);
        expect(hit.distance).toBeGreaterThan(hit.edge.width / 2 - 2.3);
      }
    }
    expect(zebras).toBeGreaterThan(50);
    expect(stops).toBeGreaterThan(10);
    for (const kind of ['zebra-pole', 'parking-meter', 'car-parked', 'sandwich-board', 'bench', 'bin']) expect(counts[kind] ?? 0, kind).toBeGreaterThan(0);
  });
});
