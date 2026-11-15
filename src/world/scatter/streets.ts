import { hashInts } from '../../core/rng';
import type { DistrictType, RoadClass, RoadEdge, RoadGraph, Scatterer, WorldApi } from '../../core/types';
// Registers junction-sign, rubbish-bag, picnic-table…
import '../landmarks/christchurch/props';
import { Geo } from '../landmarks/rural/kit';
import { SCATTERERS } from './registry';
import { approachControl, DRESSING_OFF, edgesIn, hashName, junctionRadius, Keep, nodesIn, ROUND3_OFF, unshadowed } from './util';

/**
 * The public strip of every town street, between the kerb and the front fences: street trees on the avenues and
 * in the older suburbs, an avenue of big trees wherever a road runs beside a park, power poles strung with wire
 * down one side of the suburban streets, give-way signs with street-name blades at the minor arm of each
 * junction (not in the signal-controlled central city), bus shelters on the main roads, a posting box at the odd
 * corner and rubbish bags at the kerb where it is collection day.
 *
 * Where things stand across the footpath (kerb = edge of the carriageway; people walk 1.7 m outside it, give or
 * take 0.75 m; the front boundaries are 3.2 m out):
 *   kerb + 0.45 … 0.55   posts, poles, tree trunks, bags (the lead's street lamps are at kerb + 0.7)
 *   kerb + 2.5           bus shelters, backs to the fences
 *   kerb + 4.6           avenue trees, on the grass beside a park road
 * Everything is a pure function of the edge and a position along it, so chunks agree where they meet and a pole
 * knows whether its neighbour in the next chunk exists. Shop streets get no kerbside trees or poles: their
 * verandahs reach the kerb (the buildings owner dresses those footpaths).
 */

/** District types whose frontages stand back from the footpath, leaving the kerb strip open to the sky. */
const OPEN: ReadonlySet<DistrictType> = new Set<DistrictType>(['villa', 'statehouse', 'park', 'industrial', 'beach', 'port']);
const WIRED: ReadonlySet<DistrictType> = new Set<DistrictType>(['villa', 'statehouse', 'industrial']);
const HOMES: ReadonlySet<DistrictType> = new Set<DistrictType>(['villa', 'statehouse']);
const RANK: Record<RoadClass, number> = { highway: 5, arterial: 4, street: 3, lane: 2, gravel: 1, pedestrian: 0 };

/** Streets known for a particular tree. */
const SPECIMEN: Record<string, string> = {
  'The Bay Hill': 'tree-phoenix-palm',
  'Marine Parade': 'tree-norfolk-pine',
  'Seaview Road': 'tree-norfolk-pine',
};

/** Park roads planted with something other than oaks or poplars. */
const AVENUE: Record<string, string> = {
  'Virtue Avenue': 'tree-norfolk-pine',
  'Riccarton Avenue': 'tree-plane',
  'Hagley Avenue': 'tree-plane',
  'Deans Avenue': 'tree-plane',
  'Rolleston Avenue': 'tree-lime',
  'Park Terrace': 'tree-lime',
};

/** Christchurch's avenues, each planted with one kind of tree from end to end (kerbside, wherever the kerb strip is open). */
const PLANTED: Record<string, string> = {
  'Bealey Avenue': 'tree-lime',
  'Fitzgerald Avenue': 'tree-plane',
  'Moorhouse Avenue': 'tree-plane',
  'Deans Avenue': 'tree-plane',
  'Rolleston Avenue': 'tree-lime',
  'Park Terrace': 'tree-lime',
  'Memorial Avenue': 'tree-lime',
  'Linwood Avenue': 'tree-lime',
  'Fendalton Road': 'tree-plane',
  'Papanui Road': 'tree-plane',
  'Cambridge Terrace': 'tree-lime',
  'Oxford Terrace': 'tree-lime',
  'Worcester Boulevard': 'tree-plane',
};

const POLE_STEP = 44;
const POLE_START = 40;
const TREE_STEP = 22;
/** Conductors on a `power-pole`: sideways offset and height. */
const CONDUCTORS: readonly (readonly [number, number])[] = [[-1.05, 9.5], [1.05, 9.5], [-0.75, 8.7], [0.75, 8.7]];

/** How far from a node the junction reaches along `edge` (the footpath and the building line stop there). */
export function junctionReach(graph: RoadGraph, edge: RoadEdge, node: number): number {
  let r = 0;
  for (const ei of graph.nodes[node].edges) {
    const other = graph.edges[ei];
    if (other !== edge) r = Math.max(r, other.width / 2 + (other.footpaths ? 3.4 : 1.6));
  }
  return r;
}

export interface Spot {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  type: DistrictType;
}

/** Point `lateral` metres left (side 1) or right (-1) of the centreline at `s`, with the district that side fronts. */
export function beside(world: WorldApi, edge: RoadEdge, s: number, side: number, lateral: number): Spot {
  const p = world.graph.pointAt(edge, s);
  const probe = edge.width / 2 + 13;
  return {
    x: p.x + p.tz * side * lateral,
    y: p.y,
    z: p.z - p.tx * side * lateral,
    tx: p.tx,
    tz: p.tz,
    type: world.districtAt(p.x + p.tz * side * probe, p.z - p.tx * side * probe).type,
  };
}

export const streetScatter: Scatterer = (area, out) => {
  const world = out.world;
  const graph = world.graph;
  const edges = edgesIn(graph, area);
  if (!edges.length || DRESSING_OFF) return;
  const keep = new Keep(world, area, 30);
  const wires = new Geo();
  const cans = new Geo();

  /** Clear of every landmark and marker in the world (not just this area's), so both chunks at a boundary agree. */
  const freeAnywhere = (x: number, z: number): boolean => {
    for (const l of world.landmarks) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + 1.5) return false;
    for (const p of world.places) if (Math.hypot(p.x - x, p.z - z) < 4) return false;
    return true;
  };
  /** Nothing else's carriageway under a kerbside object (skewed junctions, a side road joining mid-block). */
  const kerbClear = (x: number, z: number): boolean => {
    const hit = graph.nearest(x, z, 16);
    return !hit || hit.distance >= hit.edge.width / 2 + 0.3;
  };

  for (const e of edges) {
    if (e.bridge || e.tunnel || e.cls === 'pedestrian') continue;
    const name = hashName(e.name);
    const from = junctionReach(graph, e, e.a) + 2.5;
    const to = e.length - junctionReach(graph, e, e.b) - 2.5;
    if (to <= from) continue;
    const kerb = e.width / 2;

    // ── Avenue beside a park: big trees on the grass, whatever the road ──
    if (e.cls !== 'lane' && e.cls !== 'gravel') {
      const kind = AVENUE[e.name] ?? PLANTED[e.name] ?? (name % 6 === 0 ? 'tree-poplar' : 'tree-oak');
      const lateral = kerb + (e.footpaths ? 4.7 : 3.8);
      for (const side of [1, -1]) {
        for (let k = 0, s = 5; s < to; k++, s += 22) {
          if (s < from) continue;
          const q = beside(world, e, s, side, lateral);
          if (q.type !== 'park' || !keep.inArea(q.x, q.z) || keep.inLandmark(q.x, q.z, 2) || keep.nearPlace(q.x, q.z, 5)) continue;
          const h = hashInts(e.index, k, side + 7);
          if (h % 6 === 0 || world.waterDepthAt(q.x, q.z) > 0) continue;
          const hit = graph.nearest(q.x, q.z, 14);
          if (hit && hit.distance < hit.edge.width / 2 + 3) continue;
          out.instance(kind, q.x, world.heightAt(q.x, q.z), q.z, (h % 628) / 100, 1.0 + ((h >>> 9) % 100) / 300);
        }
      }
    }
    if (!e.footpaths) continue;

    // ── Kerbside street trees ──
    const specimen = SPECIMEN[e.name];
    for (const side of [1, -1]) {
      for (let k = 0, s = 7; s < to; k++, s += TREE_STEP) {
        if (s < from) continue;
        const q = beside(world, e, s, side, kerb + 0.55);
        if (!keep.inArea(q.x, q.z) || !OPEN.has(q.type) || q.type === 'park') continue;
        const main = e.cls === 'arterial' || e.cls === 'highway';
        const lined = specimen || PLANTED[e.name] ? true : main ? q.type !== 'port' && (q.type !== 'industrial' || name % 2 === 0) : q.type === 'villa' ? name % 100 < 34 : q.type === 'statehouse' ? name % 100 < 10 : false;
        const h = hashInts(e.index, k, side + 3);
        // Side streets are planted more thinly than the avenues.
        if (!lined || h % (main || specimen ? 5 : 2) === 0 || keep.inLandmark(q.x, q.z, 1.5) || keep.nearPlace(q.x, q.z, 4) || !kerbClear(q.x, q.z)) continue;
        out.instance(specimen ?? PLANTED[e.name] ?? 'tree-oak', q.x, q.y, q.z, (h % 628) / 100, specimen ? 0.7 + ((h >>> 9) % 100) / 500 : 0.62 + ((h >>> 9) % 100) / 450);
      }
    }

    // ── Power poles down one side of the suburban streets, with their conductors ──
    if (e.cls === 'street' || e.cls === 'arterial' || e.cls === 'highway') {
      const side = (name >>> 3) & 1 ? 1 : -1;
      const poles = new Map<number, Spot | null>();
      const poleAt = (k: number): Spot | null => {
        let pole = poles.get(k);
        if (pole === undefined) {
          const s = POLE_START + k * POLE_STEP;
          pole = null;
          if (s >= from && s <= to) {
            const q = beside(world, e, s, side, kerb + 0.5);
            if (WIRED.has(q.type) && freeAnywhere(q.x, q.z) && kerbClear(q.x, q.z)) pole = q;
          }
          poles.set(k, pole);
        }
        return pole;
      };
      for (let k = 0; POLE_START + k * POLE_STEP <= to; k++) {
        const a = poleAt(k);
        if (!a || !keep.inArea(a.x, a.z)) continue;
        out.instance('power-pole', a.x, a.y, a.z, Math.atan2(a.tx, a.tz));
        // Every fourth pole or so carries a transformer: the can on a bracket under the lower arm, fuses above it.
        // (Merged into the chunk like the wires, and like them it stays up if a car fells the pole.)
        if (hashInts(e.index, k, 5) % 4 === 1 && !ROUND3_OFF) {
          cans.at(a.x, a.y, a.z, Math.atan2(a.tx, a.tz), () => {
            cans.tube([0, 6.66, 0.5], [0, 7.54, 0.5], 0.3, 0.3, 9).box(0, 6.6, 0.3, 0.5, 0.08, 0.6).box(0, 7.6, 0.5, 0.66, 0.05, 0.66).box(0, 8.05, 0.12, 1.1, 0.08, 0.08);
            for (const x of [-0.42, 0, 0.42]) cans.box(x, 7.7, 0.2, 0.04, 0.34, 0.04);
          });
        }
        // A service line from this pole to each house nearer to it than to the next pole: across the street too.
        for (const lot of ROUND3_OFF ? [] : (world.lotsNear?.(a.x, a.z, 34) ?? [])) {
          if (lot.edge !== e || !HOMES.has(lot.district.type)) continue;
          const at = graph.nearest(lot.x, lot.z, 70, (o) => o === e);
          if (!at || Math.round((at.s - POLE_START) / POLE_STEP) !== k) continue;
          // Aim under the roof, a little forward of the middle of the section.
          const hx = lot.x + Math.sin(lot.heading) * lot.depth * 0.14;
          const hz = lot.z + Math.cos(lot.heading) * lot.depth * 0.14;
          const top: [number, number, number] = [a.x, a.y + 8.22, a.z];
          const eave: [number, number, number] = [hx, lot.y + 3.05, hz];
          const mid: [number, number, number] = [(top[0] + eave[0]) / 2, (top[1] + eave[1]) / 2 - 0.45, (top[2] + eave[2]) / 2];
          for (const [p0, p1] of [[top, mid], [mid, eave]] as const) wires.poly([[p0[0], p0[1] - 0.014, p0[2]], [p1[0], p1[1] - 0.014, p1[2]], [p1[0], p1[1] + 0.014, p1[2]], [p0[0], p0[1] + 0.014, p0[2]]], true);
        }
        const b = poleAt(k + 1);
        if (!b) continue;
        for (const [off, height] of CONDUCTORS) {
          let px = a.x + a.tz * off;
          let py = a.y + height;
          let pz = a.z - a.tx * off;
          for (let i = 1; i <= 4; i++) {
            const t = i / 4;
            const qx = a.x + a.tz * off + (b.x + b.tz * off - a.x - a.tz * off) * t;
            const qz = a.z - a.tx * off + (b.z - b.tx * off - a.z + a.tx * off) * t;
            const qy = a.y + (b.y - a.y) * t + height - 4 * t * (1 - t) * 0.75;
            wires.poly([[px, py - 0.018, pz], [qx, qy - 0.018, qz], [qx, qy + 0.018, qz], [px, py + 0.018, pz]], true);
            px = qx;
            py = qy;
            pz = qz;
          }
        }
      }
    }

    // ── Bus shelters on the main roads, backs to the fences ──
    if ((e.cls === 'arterial' || e.cls === 'highway') && hashInts(e.index, 77) % 3 === 0) {
      for (let k = 0, s = 70; s < to; k++, s += 420) {
        if (s < from) continue;
        const side = (k + name) % 2 === 0 ? 1 : -1;
        const q = beside(world, e, s, side, kerb + 2.5);
        if (!keep.inArea(q.x, q.z) || !OPEN.has(q.type) || q.type === 'port' || keep.inLandmark(q.x, q.z, 3) || keep.nearPlace(q.x, q.z, 5)) continue;
        out.instance('bus-shelter', q.x, q.y, q.z, Math.atan2(-q.tz * side, q.tx * side), 0.9);
      }
    }

    // ── Collection day: rubbish bags at the kerb outside each house on some streets ──
    if (e.cls === 'street' && name % 10 === 1) {
      for (const side of [1, -1]) {
        for (let k = 0, s = 9; s < to; k++, s += 17.5) {
          const h = hashInts(e.index, k, side + 11);
          if (s < from || h % 10 >= 6) continue;
          const q = beside(world, e, s + (h % 5), side, kerb + 0.42);
          if (!keep.inArea(q.x, q.z) || !HOMES.has(q.type) || keep.inLandmark(q.x, q.z, 1) || keep.nearPlace(q.x, q.z, 3) || !kerbClear(q.x, q.z)) continue;
          out.instance('rubbish-bag', q.x, q.y + 0.04, q.z, (h % 628) / 100, 0.85 + ((h >>> 8) % 30) / 100);
        }
      }
    }
  }

  // ── Junctions: a give-way sign, a stop sign or a signal wherever the road painter has drawn that limit line, and the odd posting box ──
  for (const node of nodesIn(graph, area)) {
    const arms = node.edges.map((i) => graph.edges[i]).filter((e) => e.drivable && !e.bridge && !e.tunnel);
    if (arms.length < 3 || keep.inLandmark(node.x, node.z, 4)) continue;
    const top = Math.max(...arms.map((e) => RANK[e.cls]));
    const main = arms.filter((e) => RANK[e.cls] === top);
    // The through road: a name carried by two arms of the highest class (else the widest, lowest-numbered arm).
    const counts = new Map<string, number>();
    for (const e of main) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    const through = main.filter((e) => (counts.get(e.name) ?? 0) >= 2).sort((a, b) => b.width - a.width || hashName(a.name) - hashName(b.name))[0]?.name ?? main.slice().sort((a, b) => b.width - a.width || a.index - b.index)[0].name;
    for (const e of arms) {
      const control = approachControl(graph, e, node.index);
      if (control === 'none' || (ROUND3_OFF && control !== 'giveway')) continue;
      const atB = e.b === node.index;
      // Beside the limit line (0.6 m short of the crossing carriageway), clear of the corner's footpath.
      const line = junctionRadius(graph, node.index, e) + 0.6;
      const reach = Math.max(line + 0.3, junctionReach(graph, e, node.index) + 0.4);
      if (e.length < reach + 5 || line < 3 || line > e.length - 3) continue;
      const dir = atB ? 1 : -1;
      const q = beside(world, e, atB ? e.length - reach : reach, dir, e.width / 2 + (e.footpaths ? 0.5 : 1.3));
      if (!keep.offRoad(q.x, q.z, 0.25)) continue;
      // Signals on crossing roads follow opposite phases of the one cycle: pick by the road's compass axis.
      const signal = Math.abs(q.tx) >= Math.abs(q.tz) ? 'traffic-signal' : 'traffic-signal-cross';
      out.instance(control === 'stop' ? 'stop-sign' : control === 'signal' ? signal : 'junction-sign', q.x, e.footpaths ? q.y + 0.08 : world.heightAt(q.x, q.z), q.z, Math.atan2(-q.tx * dir, -q.tz * dir));
    }
    // A posting box on the through road's footpath, a few metres short of the odd corner.
    const h = hashInts(node.index, 4177);
    const host = arms.find((e) => e.name === through && e.footpaths);
    if (!host || h % 12 !== 0) continue;
    const atB = host.b === node.index;
    const reach = junctionReach(graph, host, node.index) + 2.2;
    if (host.length < reach + 8) continue;
    const side = (h >>> 5) & 1 ? 1 : -1;
    const q = beside(world, host, atB ? host.length - reach : reach, side, host.width / 2 + 0.5);
    if (!HOMES.has(q.type) || keep.inLandmark(q.x, q.z, 2) || !keep.offRoad(q.x, q.z, 0.3)) continue;
    // The slot faces the footpath.
    out.instance('postbox', q.x, q.y, q.z, Math.atan2(q.tz * side, -q.tx * side));
  }

  // A material flagged transparent casts no shadow: 2 cm conductors alias into dotted lines in the shadow map,
  // and real ones throw no shadow you would notice. (One extra mesh per chunk that has poles.)
  wires.flush(out, out.materials.get('plain', { color: 0x2b2d2e, transparent: true, opacity: 0.999 }));
  cans.flush(out, unshadowed(out.materials));
};

SCATTERERS.push(streetScatter);
