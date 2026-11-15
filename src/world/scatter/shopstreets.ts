import type * as THREE from 'three';
import { hashInts } from '../../core/rng';
import type { DistrictType, RoadEdge, Scatterer } from '../../core/types';
import { Geo } from '../landmarks/rural/kit';
import type { CompiledMap } from '../map';
import { newsBillboardParts, shopCratesParts } from '../props/extra';
import { edgeFurniture } from '../roadmesh';
import { SCATTERERS } from './registry';
import { beside, junctionReach } from './streets';
import { bladeName, bladeSign, DRESSING_OFF, edgesIn, Keep, nodesIn, ROUND3_OFF, sideTrim, unshadowed } from './util';

/**
 * The shopping street, and what the paint on the road promises (see `edgeFurniture` in ../roadmesh.ts):
 *
 * - a coin meter at the head of every second marked parking bay, and cars standing in the bays along the
 *   right-hand kerb of the one-way streets (the traffic system parks its own cars along the left-hand kerb only,
 *   so the two never meet);
 * - a banded pole with an orange globe each side of every zebra crossing;
 * - benches, litter bins and sandwich boards along the kerb of the shopping streets, the day's newspaper poster
 *   and the greengrocer's boxes against the shop fronts (those two merged into the chunk: no draw call);
 * - at junctions in town, a post carrying the names of the streets that meet there.
 *
 * Across a shop footpath (kerb = edge of the seal; the fronts are 3.2 m out; people walk 0.95 to 2.45 m out):
 *   kerb + 0.35 … 0.55   meters, poles, bins, boards, seats
 *   kerb + 2.8 … 3.05    posters and stands, against the wall
 * Everything is a pure function of the edge and a distance along it, and belongs to the chunk it stands in.
 */

const SHOPS: ReadonlySet<DistrictType> = new Set<DistrictType>(['cbd', 'shops', 'township']);
/** Paint, as the cars of 1995 wore it: a lot of white, grey and faded red. */
const CAR_TINTS = [0xe8e6df, 0xd9d6cc, 0x8f959a, 0x9a1f1c, 0x1f3f7a, 0x2d5a44, 0xc9b78a, 0x6f3a2c, 0x1d1e21, 0x7d8a92, 0xb5a23a, 0x5b6f86, 0xa8452e, 0xe8e6df];
const BOARD_TINTS = [0xf2efe6, 0xf0d24a, 0xcfe0ea, 0xf2efe6, 0x2a2c2e, 0xe9c9b0, 0xd7e6c4];
const SLOT = 9;
let CRATES: [THREE.BufferGeometry, number][] | null = null;
let POSTER: [THREE.BufferGeometry, number][] | null = null;

export const shopStreets: Scatterer = (area, out) => {
  const world = out.world;
  const graph = world.graph;
  const edges = edgesIn(graph, area);
  if (!edges.length || DRESSING_OFF || ROUND3_OFF) return;
  const keep = new Keep(world, area, 30);
  const map = world as unknown as CompiledMap;
  /** Nothing else's carriageway under a kerbside object (a side road joining mid-block, a skewed corner). */
  const kerbClear = (x: number, z: number, self: RoadEdge): boolean => {
    const hit = graph.nearest(x, z, 16, (o) => o !== self);
    return !hit || hit.distance >= hit.edge.width / 2 + 0.3;
  };
  /** A shop (or any building plot) fronts the footpath here: something to lean a poster against. */
  const fronted = (x: number, z: number): boolean => {
    if (!world.lotsNear) return false;
    for (const lot of world.lotsNear(x, z, 4)) {
      const dx = x - lot.x;
      const dz = z - lot.z;
      const sin = Math.sin(lot.heading);
      const cos = Math.cos(lot.heading);
      const across = dx * cos - dz * sin;
      const out2 = dx * sin + dz * cos;
      if (SHOPS.has(lot.district.type) && Math.abs(across) < lot.width / 2 - 0.9 && out2 > lot.depth / 2 - 1.5 && out2 < lot.depth / 2 + 1.2) return true;
    }
    return false;
  };

  for (const e of edges) {
    if (e.bridge || e.tunnel || e.cls === 'pedestrian' || e.cls === 'gravel' || !e.footpaths) continue;
    const plan = edgeFurniture(map, e);
    const half = e.width / 2;
    const taken = (s: number, side: number, pad = 0) => (plan.zebra !== null && Math.abs(s - plan.zebra) < 10 + pad) || plan.busStops.some((b) => b.side === side && Math.abs(s - b.s) < 10.5 + pad);
    /** The lead's street lamps: every 44 m from 18 m, on alternate sides, 0.7 m behind the kerb. */
    const lampAt = (s: number, side: number) => {
      const k = Math.round((s - 18) / 44);
      return Math.abs(s - (18 + k * 44)) < 1.6 && (k % 2 === 0 ? 1 : -1) === side;
    };
    const marks: number[][] = [[], []];

    for (const side of [1, -1]) {
      // ── Marked bays: meters at the kerb, and cars in the bays the traffic system never uses ──
      if (plan.parking) {
        const a = sideTrim(graph, e.a, e, side) + 13.5;
        const b = e.length - sideTrim(graph, e.b, e, side) - 13.5;
        for (let k = 0, s = a; s + 6 <= b + 0.01; k++, s += 6) {
          if (taken(s, side) || taken(s + 6, side)) continue;
          marks[side === 1 ? 0 : 1].push(s);
          if (k % 2 === 0) {
            const q = beside(world, e, s, side, half + 0.36);
            if (keep.inArea(q.x, q.z) && SHOPS.has(q.type) && !keep.inLandmark(q.x, q.z, 1) && !keep.nearPlace(q.x, q.z, 2.5) && kerbClear(q.x, q.z, e)) {
              out.instance('parking-meter', q.x, q.y + 0.12, q.z, Math.atan2(q.tz * side, -q.tx * side));
            }
          }
          const h = hashInts(e.index, k, 911);
          if (side !== -1 || !e.oneway || h % 100 >= 33) continue;
          const along = s + 3 + (((h >>> 7) % 9) - 4) * 0.1;
          const c = beside(world, e, along, side, half - 1.3 - ((h >>> 11) % 3) * 0.05);
          if (!keep.inArea(c.x, c.z) || keep.inLandmark(c.x, c.z, 3) || keep.nearPlace(c.x, c.z, 9) || !kerbClear(c.x, c.z, e)) continue;
          // One shape to a chunk (a kind is a draw call per chunk and per shadow cascade): saloons here, wagons there.
          out.instance(hashInts(Math.floor(area.minX / area.size), Math.floor(area.minZ / area.size), 77) % 5 < 3 ? 'car-parked' : 'car-parked-wagon', c.x, c.y, c.z, Math.atan2(c.tx, c.tz) + (((h >>> 18) % 7) - 3) * 0.008, 1, CAR_TINTS[(h >>> 22) % CAR_TINTS.length]);
        }
      }
      // ── The kerb and the shop fronts, a slot of footpath at a time ──
      const from = junctionReach(graph, e, e.a) + 3;
      const to = e.length - junctionReach(graph, e, e.b) - 3;
      const bays = marks[side === 1 ? 0 : 1];
      // Not on the streets with marked bays: their kerbs have the meters and the cars, and a chunk can only afford
      // so many kinds of thing (each is a draw call) before the view costs more than the art pass was allowed.
      for (let k = 0, s0 = 4; s0 < to && !plan.parking; k++, s0 += SLOT) {
        const h = hashInts(e.index, k, side + 50);
        let s = s0 + ((h >>> 3) % 50) / 10;
        if (s < from || s > to) continue;
        const roll = (h >>> 9) % 100;
        // Against the wall: the newspaper's poster, or a greengrocer's stand.
        if (roll >= 60 && roll < 74) {
          const stand = roll >= 70;
          const w = beside(world, e, s, side, half + (stand ? 2.7 : 3.0));
          if (keep.inArea(w.x, w.z) && SHOPS.has(w.type) && fronted(w.x, w.z) && !keep.inLandmark(w.x, w.z, 1) && !keep.nearPlace(w.x, w.z, 3.5)) {
            // Merged into the chunk's own geometry (the plain batch, by colour): against the wall nothing runs into them.
            const frame = out.frameAt(w.x, w.y + 0.05, w.z, Math.atan2(-w.tz * side, w.tx * side) + (((h >>> 20) % 9) - 4) * 0.02);
            for (const [geometry, color] of stand ? (CRATES ??= shopCratesParts()) : (POSTER ??= newsBillboardParts())) out.addGeometry(geometry, out.materials.get('plain', { color }), frame);
          }
          continue;
        }
        if (roll >= 27) continue;
        // At the kerb: keep off the crossing and the bus stop, and step aside for a lamp or a meter.
        if (taken(s, side, -5)) continue;
        if (lampAt(s, side)) s += 2.2;
        if (bays.some((b) => Math.abs(b - s) < 0.9)) s += 1.5;
        const q = beside(world, e, s, side, half + 0.5);
        if (!keep.inArea(q.x, q.z) || !SHOPS.has(q.type) || keep.inLandmark(q.x, q.z, 1.5) || keep.nearPlace(q.x, q.z, 3.5) || !kerbClear(q.x, q.z, e)) continue;
        const y = q.y + 0.1;
        /** Facing the shops, back to the traffic. */
        const inward = Math.atan2(q.tz * side, -q.tx * side);
        const alongStreet = Math.atan2(q.tx, q.tz);
        if (roll < 7) {
          out.instance('bench', q.x, y, q.z, inward);
          const b = beside(world, e, s + 1.45, side, half + 0.42);
          out.instance('bin', b.x, y, b.z, inward);
        } else if (roll < 12) out.instance('bin', q.x, y, q.z, inward);
        else out.instance('sandwich-board', q.x, y, q.z, alongStreet + (((h >>> 20) % 9) - 4) * 0.05, 1, BOARD_TINTS[(h >>> 24) % BOARD_TINTS.length]);
      }
    }

    // ── A banded pole on the approach side of each kerb at a zebra crossing ──
    if (plan.zebra !== null) {
      for (const side of [1, -1]) {
        const q = beside(world, e, plan.zebra - side * 1.95, side, half + 0.42);
        if (keep.inArea(q.x, q.z) && !keep.inLandmark(q.x, q.z, 0.5) && !keep.nearPlace(q.x, q.z, 1.5) && kerbClear(q.x, q.z, e)) out.instance('zebra-pole', q.x, q.y + 0.1, q.z, 0);
      }
    }
  }
  // ── Street names: a post at one corner of each junction in town, a blade along each of two streets ──
  // (A slender post with nothing to run into: a blade cannot be knocked over with its post, so neither is solid.)
  const posts = new Geo();
  const RANK = { highway: 5, arterial: 4, street: 3, lane: 2, gravel: 1, pedestrian: 0 } as const;
  for (const node of nodesIn(graph, area)) {
    const arms = node.edges.map((i) => graph.edges[i]).filter((e) => e.drivable && !e.bridge && !e.tunnel);
    const host = arms.filter((e) => e.footpaths).sort((a, b) => a.index - b.index)[0];
    if (arms.length < 3 || !host) continue;
    const cross = arms.filter((e) => e.name !== host.name).sort((a, b) => RANK[b.cls] - RANK[a.cls] || a.index - b.index)[0];
    const atB = host.b === node.index;
    const reach = junctionReach(graph, host, node.index) + 0.9;
    if (!cross || host.length < reach + 6) continue;
    // The corner across the road from where the give-way sign stands (the approaching driver's left).
    const dir = atB ? 1 : -1;
    const q = beside(world, host, atB ? host.length - reach : reach, -dir, host.width / 2 + 0.55);
    if (!keep.inArea(q.x, q.z) || keep.inLandmark(q.x, q.z, 1) || !keep.offRoad(q.x, q.z, 0.25)) continue;
    const y = q.y + 0.08;
    posts.tube([q.x, y - 0.3, q.z], [q.x, y + 3.06, q.z], 0.032, 0.032, 6);
    const city = world.districtAt(node.x, node.z).city === 'christchurch';
    const blade = (name: string, dx: number, dz: number, height: number) => {
      const text = bladeName(name);
      const w = Math.min(1.5, 0.24 + text.length * 0.088);
      const sign = out.materials.sign(text, { bg: city ? '#1f3f7a' : '#f4f2ea', fg: city ? '#f4f2ea' : '#16181c', style: 'block', aspect: Math.round((w / 0.17) * 2) / 2, border: false });
      const m = bladeSign(out.materials, sign);
      const f = out.frameAt(q.x + dx * (w / 2 + 0.05), y + height, q.z + dz * (w / 2 + 0.05), Math.atan2(-dz, dx));
      out.quad(f, 0, 0, 0.011, w, 0.17, m);
      out.quad(f, 0, 0, -0.011, w, 0.17, m, Math.PI);
      posts.with(f, () => posts.box(0, 0, 0, w, 0.17, 0.016));
    };
    blade(host.name, -q.tx * dir, -q.tz * dir, 2.94);
    const d = cross.a === node.index ? cross.samples[Math.min(2, cross.samples.length - 1)] : cross.samples[Math.max(0, cross.samples.length - 3)];
    const len = Math.hypot(d.x - node.x, d.z - node.z) || 1;
    blade(cross.name, (d.x - node.x) / len, (d.z - node.z) / len, 2.74);
  }
  posts.flush(out, unshadowed(out.materials));
};

SCATTERERS.push(shopStreets);
