// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoadEdge } from '../../core/types';
import { WORLD_BOUNDS } from '../height';
import { generateLots } from '../lots';
import { compileMap, type CompiledMap } from '../map';
import type { MapSource } from '../mapsource';
import { buildMap } from './index';
import { renderPreview } from './preview';

/** Place ids and tags from docs/CONTRACT.md. */
const PLACES: Record<string, string[]> = {
  'timaru-spawn': ['spawn'],
  'timaru-chipshop': ['safehouse', 'mission'],
  'smithfield-carpark': ['mission'],
  'timaru-port-lockup': ['mission'],
  'timaru-hospital': ['hospital'],
  'timaru-police': ['police'],
  'timaru-gunshop': ['gunshop'],
  'timaru-panelbeater': ['spray'],
  'caroline-bay': ['mission'],
  'washdyke-saleyards': ['mission'],
  'temuka-pub': ['mission'],
  'rangitata-layby': ['mission'],
  'hinds-woolshed': ['mission'],
  'ashburton-stock-agent': ['mission'],
  'ashburton-police': ['police'],
  'ashburton-panelbeater': ['spray'],
  'rakaia-salmon': ['mission'],
  'chch-garage': ['safehouse', 'mission'],
  'four-aves-start': ['mission'],
  'cathedral-square': ['mission'],
  'arts-centre': ['mission'],
  'antigua-boatsheds': ['mission'],
  'chch-hospital': ['hospital'],
  'chch-police': ['police'],
  'chch-gunshop': ['gunshop'],
  'chch-panelbeater': ['spray'],
  'lancaster-park': ['mission'],
  'new-brighton-beach': ['mission'],
  'sign-of-the-kiwi': ['mission'],
  'lyttelton-wharf': ['mission'],
};

/** Landmark kinds and clear radii from docs/CONTRACT.md (including the addendum's marae). */
const LANDMARKS: Record<string, number> = {
  'chch-cathedral': 40,
  'cathedral-square': 75,
  'arts-centre': 70,
  'canterbury-museum': 40,
  'bridge-of-remembrance': 22,
  'town-hall': 55,
  'victoria-square': 60,
  'old-railway-station': 50,
  'addington-station': 40,
  'lancaster-park': 110,
  'antigua-boatsheds': 30,
  'tram-stop': 14,
  'chch-hospital': 70,
  'chch-police': 40,
  'new-brighton-mall': 60,
  'sign-of-the-takahe': 30,
  'sign-of-the-kiwi': 25,
  'sugarloaf-tower': 20,
  'gondola-base': 30,
  'gondola-summit': 30,
  'tunnel-portal': 25,
  'lyttelton-port': 120,
  'timeball-station': 22,
  'timaru-basilica': 45,
  'caroline-bay-soundshell': 40,
  'caroline-bay-carnival': 70,
  'caroline-bay-tearooms': 25,
  'timaru-port': 130,
  'timaru-lighthouse': 14,
  'landing-service-building': 30,
  'timaru-station': 40,
  'timaru-hospital': 60,
  'timaru-police': 35,
  'smithfield-works': 110,
  'washdyke-saleyards': 70,
  'phar-lap-raceway': 150,
  'ashburton-clock-tower': 14,
  'rakaia-salmon': 14,
  woolshed: 30,
  'grain-silo': 25,
  'service-station': 30,
  'country-pub': 25,
  'country-church': 25,
  'war-memorial': 12,
  school: 80,
  'rugby-field': 70,
  'rail-station-small': 30,
  marae: 50,
};
const SKYLINE = ['chch-cathedral', 'sugarloaf-tower', 'gondola-summit', 'lyttelton-port', 'timaru-basilica', 'timaru-port', 'smithfield-works'];
/** Kinds that stand on a road by nature. */
const ON_ROAD = ['bridge-of-remembrance', 'tunnel-portal', 'tram-stop'];
/** Paved precincts: their own pedestrian paving runs through them. */
const PAVED = ['cathedral-square', 'new-brighton-mall'];
const GENERIC: Record<string, number> = { woolshed: 8, 'grain-silo': 3, 'service-station': 3, 'country-pub': 3, 'country-church': 3, 'war-memorial': 3, school: 3, 'rugby-field': 3, 'rail-station-small': 3 };

let src: MapSource;
let map: CompiledMap;

const nodeNear = (id: string) => {
  const p = src.places.find((q) => q.id === id)!;
  return map.graph.nearestNode(p.x, p.z).index;
};
const routeLength = (from: number, to: number) => {
  const route = map.graph.route(from, to);
  return route ? route.reduce((sum, leg) => sum + leg.edge.length, 0) : NaN;
};

beforeAll(() => {
  src = buildMap();
  map = compileMap(src);
});

describe('authored map', () => {
  it('has every contract place, tagged, on dry land beside a drivable road', () => {
    for (const [id, tags] of Object.entries(PLACES)) {
      const matches = src.places.filter((p) => p.id === id);
      expect(matches.length, `place ${id}`).toBe(1);
      const p = matches[0];
      for (const tag of tags) expect(p.tags, `place ${id} tags`).toContain(tag);
      expect(map.terrain.natural(p.x, p.z), `place ${id} height above sea`).toBeGreaterThanOrEqual(2);
      expect(map.terrain.waterDepth(p.x, p.z), `place ${id} water`).toBe(0);
      const hit = map.graph.nearest(p.x, p.z, 30, (e) => e.drivable);
      expect(hit, `place ${id} within 30 m of a drivable edge`).not.toBeNull();
      // Faces the road it stands beside.
      const toRoadX = hit!.x - p.x;
      const toRoadZ = hit!.z - p.z;
      const d = Math.hypot(toRoadX, toRoadZ);
      if (d > 2) expect((Math.sin(p.heading) * toRoadX + Math.cos(p.heading) * toRoadZ) / d, `place ${id} faces the road`).toBeGreaterThan(0.5);
      // Anything routing to the place by its nearest node must be able to drive there.
      const node = map.graph.nearestNode(p.x, p.z);
      expect(node.edges.some((ei) => map.graph.edges[ei].drivable), `place ${id} nearest node is drivable`).toBe(true);
    }
    expect(src.places.filter((p) => p.tags.includes('spawn')).map((p) => p.id)).toEqual(['timaru-spawn']);
  });

  it('places every contract landmark kind with its clear radius', () => {
    for (const [kind, radius] of Object.entries(LANDMARKS)) {
      const placed = src.landmarks.filter((l) => l.kind === kind);
      expect(placed.length, `landmark ${kind}`).toBeGreaterThanOrEqual(1);
      for (const l of placed) {
        expect(l.clearRadius, `landmark ${kind} clear radius`).toBe(radius);
        expect(!!l.skyline, `landmark ${kind} skyline`).toBe(SKYLINE.includes(kind));
        expect(l.name.length, `landmark ${kind} name`).toBeGreaterThan(0);
        expect(map.terrain.natural(l.x, l.z), `landmark ${l.name} on dry land`).toBeGreaterThan(1.5);
      }
    }
    for (const l of src.landmarks) expect(LANDMARKS[l.kind], `unknown landmark kind ${l.kind}`).toBeDefined();
    for (const [kind, count] of Object.entries(GENERIC)) expect(src.landmarks.filter((l) => l.kind === kind).length, `${kind} count`).toBeGreaterThanOrEqual(count);
    expect(src.landmarks.filter((l) => l.kind === 'tunnel-portal').length).toBe(2);
    expect(src.landmarks.filter((l) => l.kind === 'marae').map((l) => l.name).sort()).toEqual(['Arowhenua Marae', 'Ngā Hau e Whā', 'Rehua Marae']);
  });

  it('keeps roads out of landmark clear radii', () => {
    const problems: string[] = [];
    for (const l of src.landmarks) {
      if (ON_ROAD.includes(l.kind)) continue;
      const worst = new Map<string, number>();
      for (const e of map.graph.edges) {
        if (e.cls === 'pedestrian' && PAVED.includes(l.kind)) continue;
        for (const s of e.samples) {
          const d = Math.hypot(s.x - l.x, s.z - l.z) - e.width / 2;
          if (d < l.clearRadius) worst.set(e.name, Math.min(worst.get(e.name) ?? Infinity, d));
        }
      }
      for (const [name, d] of worst) problems.push(`${l.kind} "${l.name}" (r ${l.clearRadius}): ${name} comes within ${d.toFixed(1)} m`);
    }
    expect(problems).toEqual([]);
    // The on-road kinds really are on a road.
    for (const l of src.landmarks) if (ON_ROAD.includes(l.kind)) expect(map.graph.nearest(l.x, l.z, 12), `${l.kind} on a road`).not.toBeNull();
  });

  it('keeps landmarks from overlapping one another (the cathedral stands in its Square by design)', () => {
    const problems: string[] = [];
    for (let i = 0; i < src.landmarks.length; i++) {
      for (let j = i + 1; j < src.landmarks.length; j++) {
        const a = src.landmarks[i];
        const b = src.landmarks[j];
        const kinds = [a.kind, b.kind].sort().join('+');
        if (kinds === 'cathedral-square+chch-cathedral') continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.clearRadius + b.clearRadius) problems.push(`${a.name} overlaps ${b.name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps marae clear of missions, police, gun shops and spray shops', () => {
    for (const m of src.landmarks.filter((l) => l.kind === 'marae')) {
      for (const p of src.places) {
        if (!p.tags.some((t) => ['mission', 'police', 'gunshop', 'spray', 'spawn', 'safehouse'].includes(t))) continue;
        expect(Math.hypot(p.x - m.x, p.z - m.z), `${p.id} vs ${m.name}`).toBeGreaterThan(m.clearRadius + 30);
      }
    }
  });

  it('stays inside the world', () => {
    for (const n of map.graph.nodes) {
      expect(n.x, 'node x').toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + 100);
      expect(n.x, 'node x').toBeLessThanOrEqual(WORLD_BOUNDS.maxX - 100);
      expect(n.z, 'node z').toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ + 100);
      expect(n.z, 'node z').toBeLessThanOrEqual(WORLD_BOUNDS.maxZ - 100);
    }
    let out = 0;
    for (const e of map.graph.edges) for (const s of e.samples) if (s.x < WORLD_BOUNDS.minX + 150 || s.x > WORLD_BOUNDS.maxX - 150 || s.z < WORLD_BOUNDS.minZ + 150 || s.z > WORLD_BOUNDS.maxZ - 150) out++;
    expect(out, 'road samples within 150 m of the world edge').toBe(0);
    for (const p of src.places) expect(Math.abs(p.x) < 2922 && Math.abs(p.z) < 5994, `place ${p.id} inside`).toBe(true);
    for (const l of src.landmarks) expect(Math.abs(l.x) + l.clearRadius < 3052 && Math.abs(l.z) + l.clearRadius < 6124, `landmark ${l.name} inside`).toBe(true);
  });

  it('is one connected drivable network', () => {
    const spawn = nodeNear('timaru-spawn');
    for (const id of ['cathedral-square', 'lyttelton-wharf', 'new-brighton-beach', 'sign-of-the-kiwi', 'hinds-woolshed']) {
      expect(map.graph.route(spawn, nodeNear(id)), `route timaru-spawn → ${id}`).not.toBeNull();
      expect(map.graph.route(nodeNear(id), spawn), `route ${id} → timaru-spawn`).not.toBeNull();
    }
    for (const id of Object.keys(PLACES)) expect(map.graph.route(spawn, nodeNear(id)), `route timaru-spawn → ${id}`).not.toBeNull();

    // Every drivable edge can be reached from the spawn and can get back to it, one-way streets included.
    const reach = (forward: boolean) => {
      const seen = new Set<number>([spawn]);
      const queue = [spawn];
      while (queue.length) {
        const u = queue.pop()!;
        for (const ei of map.graph.nodes[u].edges) {
          const e = map.graph.edges[ei];
          if (!e.drivable) continue;
          const v = e.a === u ? e.b : e.a;
          const along = e.a === u; // travelling a → b
          if (e.oneway && along !== forward) continue;
          if (!seen.has(v)) {
            seen.add(v);
            queue.push(v);
          }
        }
      }
      return seen;
    };
    const out = reach(true);
    const back = reach(false);
    const stranded = map.graph.edges.filter((e) => e.drivable && !(out.has(e.a) && out.has(e.b) && back.has(e.a) && back.has(e.b))).map((e) => `${e.name} @ ${Math.round(map.graph.nodes[e.a].x)},${Math.round(map.graph.nodes[e.a].z)}`);
    expect(stranded).toEqual([]);
  });

  it('puts Timaru and Christchurch the right distance apart', () => {
    const drive = routeLength(nodeNear('timaru-spawn'), nodeNear('cathedral-square'));
    expect(drive, 'timaru-spawn → cathedral-square').toBeGreaterThanOrEqual(8500);
    expect(drive, 'timaru-spawn → cathedral-square').toBeLessThanOrEqual(13000);
    // SH1 proper: Moorhouse / Deans corner to the top of Theodosia Street.
    const sh1 = routeLength(map.graph.nearestNode(-740, -3600).index, map.graph.nearestNode(300, 4790).index);
    expect(sh1, 'SH1 Christchurch → Timaru').toBeGreaterThanOrEqual(8500);
    expect(sh1, 'SH1 Christchurch → Timaru').toBeLessThanOrEqual(11000);
  });

  it('lands every bridge on dry banks and keeps roads out of the sea', () => {
    const bridges = map.graph.edges.filter((e) => e.bridge);
    expect(bridges.length).toBeGreaterThan(10);
    for (const e of bridges) {
      for (const ni of [e.a, e.b]) {
        const n = map.graph.nodes[ni];
        expect(map.terrain.waterDepth(n.x, n.z), `${e.name} end at ${Math.round(n.x)},${Math.round(n.z)}`).toBe(0);
      }
    }
    const wet: string[] = [];
    for (const e of map.graph.edges) {
      if (e.bridge || e.tunnel || !e.drivable) continue;
      for (const s of e.samples) {
        if (map.terrain.natural(s.x, s.z) < 0.5) {
          wet.push(`${e.name} @ ${Math.round(s.x)},${Math.round(s.z)}`);
          break;
        }
      }
    }
    expect(wet).toEqual([]);
    // Rakaia: long and narrow.
    const rakaia = bridges.filter((e) => e.name === 'Rakaia Bridge');
    expect(rakaia.length).toBe(1);
    expect(rakaia[0].width).toBe(7);
    expect(rakaia[0].length).toBeGreaterThan(400);
    expect(map.graph.edges.filter((e) => e.tunnel).length).toBe(1);
  });

  it('joins what it means to join: no stray dead ends beside another road, no slivers', () => {
    const g = map.graph;
    const near: string[] = [];
    for (const n of g.nodes) {
      if (n.edges.length !== 1) continue;
      const own = g.edges[n.edges[0]];
      const hit = g.nearest(n.x, n.z, 12, (e: RoadEdge) => e.index !== own.index && !e.bridge && !e.tunnel);
      if (hit && hit.distance < 12) near.push(`${own.name} ends ${hit.distance.toFixed(1)} m from ${hit.edge.name} at ${Math.round(n.x)},${Math.round(n.z)}`);
    }
    expect(near).toEqual([]);
    expect(g.edges.filter((e) => e.length < 8).map((e) => `${e.name} ${e.length.toFixed(1)} m`)).toEqual([]);
  });

  it('stays within the scale budget', () => {
    let total = 0;
    for (const e of map.graph.edges) total += e.length;
    expect(src.roads.length).toBeGreaterThanOrEqual(300);
    expect(src.roads.length).toBeLessThanOrEqual(520);
    expect(total).toBeLessThan(230_000);
    for (const e of map.graph.edges) expect(e.samples.length, `${e.name} samples`).toBeLessThan(4096); // graph index packs the sample number in 12 bits
  });

  it('keeps hill roads drivable', () => {
    // Worst gradient over any 12 m of a drivable road (the Port Hills roads are laid out at about 1 in 8).
    const steep: string[] = [];
    for (const e of map.graph.edges) {
      if (e.bridge || e.tunnel || !e.drivable) continue;
      for (let i = 3; i < e.samples.length; i++) {
        const grade = Math.abs(e.samples[i].y - e.samples[i - 3].y) / 12;
        if (grade > 0.22) {
          steep.push(`${e.name} ${(grade * 100).toFixed(0)}% @ ${Math.round(e.samples[i].x)},${Math.round(e.samples[i].z)}`);
          break;
        }
      }
    }
    expect(steep).toEqual([]);
  });

  it('lays no building plot across a railway', () => {
    const lots = [...generateLots(map).values()].flat();
    expect(lots.length).toBeGreaterThan(3000);
    const onRail: string[] = [];
    for (const l of lots) {
      const c = Math.cos(l.heading);
      const sn = Math.sin(l.heading);
      let hit = false;
      for (const r of map.rails) {
        if (r.source.kind === 'tram') continue;
        for (const p of r.samples) {
          const dx = p.x - l.x;
          const dz = p.z - l.z;
          if (Math.abs(dx) > 60 || Math.abs(dz) > 60) continue;
          // Lot frame: depth runs along the facing direction (sin h, cos h), width across it.
          if (Math.abs(dx * sn + dz * c) < l.depth / 2 + 2 && Math.abs(dx * c - dz * sn) < l.width / 2 + 2) hit = true;
        }
      }
      if (hit) onRail.push(`${l.district.name} (${l.district.type}) @ ${Math.round(l.x)},${Math.round(l.z)} on ${l.edge.name}`);
    }
    expect(onRail).toEqual([]);
  });

  it('writes the preview', async () => {
    // Node's fs, loaded indirectly: the project's tsconfig has no node types.
    const moduleName: string = 'node:fs';
    const fs = (await import(/* @vite-ignore */ moduleName)) as { writeFileSync(file: URL, data: string): void };
    const svg = renderPreview(src, map);
    fs.writeFileSync(new URL('../../../docs/map-preview.svg', import.meta.url), svg);
    expect(svg.length).toBeGreaterThan(10_000);
  });
});
