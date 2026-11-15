import { TAU } from '../../core/math';
import { hashInts, Rng } from '../../core/rng';
import type { LandmarkPlacement, RailLine, RoadEdge, RoadGraph, Scatterer } from '../../core/types';
import { Geo } from '../landmarks/rural/kit';
import { GATE_HALF, POLE_WIRES, PROP } from '../landmarks/rural/props';
import { SCATTERERS } from './registry';
import { DRESSING_OFF, ROUND3_OFF } from './util';

/**
 * Dresses the Canterbury Plains: post-and-wire fences along roads and paddock edges, mobs of sheep, a few
 * cattle, hay bales, shelter belts, water races, farm gates with letterboxes and SH1's power poles.
 *
 * Paddocks follow the terrain's patchwork tint: block ix = floor((x + 5000) / 190), iz = floor((z + 9000) / 150).
 * Everything is placed from world coordinates (fence posts on an 8 m grid, trees on a 6 m grid, mobs from
 * their paddock's hash), so neighbouring chunks agree at their shared edge without knowing about each other.
 *
 * Cost: the area is surveyed once on a 32 m lattice (district, surface, water, height: at most 324 queries);
 * after that things stand on interpolated heights. Exact height or surface queries are spent only near
 * roads, on rolling ground and beside water, and the whole area stops at QUERY_BUDGET.
 */

const BLOCK_X = 190;
const BLOCK_Z = 150;
const ORIGIN_X = 5000;
const ORIGIN_Z = 9000;
const CELLS = 8;
const QUERY_BUDGET = 1200;
/** Nothing stands closer to a road centreline than this (8 m, plus slack for the 4 m sample spacing). */
const ROAD_CLEAR = 8.4;
const RAIL_CLEAR = 7;
const POST_GAP = 8;
const WIRE_HEIGHTS = [0.4, 0.75, 1.08];
const LETTERBOX_TINTS = [0xc8322a, 0xf2efe6, 0x2f6a4a, 0xa9adb0, 0x2f4a8a, 0xe2b53a];
const FLEECE = [0xffffff, 0xf4eede, 0xe6dfcc, 0xdad2bc];
const HIDES = [0x2a2623, 0x7a4a2a, 0xb08a5a, 0x5a3a26];
/** Roadside rank grass: summer-dry seed heads through to green cocksfoot. */
const ROADSIDE = [0xb9a868, 0xa9a05c, 0x8f9a52, 0xc4b377, 0x7f9048];

interface RoadPoint {
  x: number;
  z: number;
  edge: RoadEdge;
}

const GRID = 64;
const gridKey = (x: number, z: number) => (Math.floor(x / GRID) + 4096) * 8192 + Math.floor(z / GRID) + 4096;

const roadGrids = new WeakMap<RoadGraph, Map<number, RoadPoint[]>>();
function roadGrid(graph: RoadGraph): Map<number, RoadPoint[]> {
  let grid = roadGrids.get(graph);
  if (!grid) {
    grid = new Map();
    for (const edge of graph.edges) {
      for (const s of edge.samples) {
        const key = gridKey(s.x, s.z);
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push({ x: s.x, z: s.z, edge });
      }
    }
    roadGrids.set(graph, grid);
  }
  return grid;
}

const railGrids = new WeakMap<RailLine[], Map<number, { x: number; z: number }[]>>();
function railGrid(lines: RailLine[]): Map<number, { x: number; z: number }[]> {
  let grid = railGrids.get(lines);
  if (!grid) {
    grid = new Map();
    for (const line of lines) {
      for (const pt of line.points) {
        const key = gridKey(pt.x, pt.z);
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(pt);
      }
    }
    railGrids.set(lines, grid);
  }
  return grid;
}

function gather<T>(grid: Map<number, T[]>, minX: number, minZ: number, maxX: number, maxZ: number): T[] {
  const found: T[] = [];
  for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
    for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) {
      const list = grid.get((gx + 4096) * 8192 + gz + 4096);
      if (list) for (const item of list) found.push(item);
    }
  }
  return found;
}

/** Features of one paddock boundary, from its hash: every chunk that touches the edge reads the same. */
function edgeTraits(a: number, b: number, vertical: boolean) {
  const h = hashInts(a, b, vertical ? 1 : 2);
  const belt = (h & 0xff) / 255;
  return {
    fenced: ((h >>> 17) & 0xff) / 255 > 0.06,
    belt: belt < 0.25 ? 'tree-pine' : belt < 0.33 ? 'tree-poplar' : belt < 0.45 ? 'hedge-shelter' : null,
    race: ((h >>> 8) & 0xff) / 255 < 0.1,
    side: (h >>> 16) & 1 ? 1 : -1,
  };
}

export const ruralScatterer: Scatterer = (area, out) => {
  const world = out.world;
  const { minX, minZ, size } = area;
  const maxX = minX + size;
  const maxZ = minZ + size;
  const step = size / CELLS;
  const N = CELLS + 1;
  let queries = 0;
  const spend = () => queries++ < QUERY_BUDGET;

  // ── Survey the area on a lattice ──
  const rural = new Int8Array(N * N).fill(-1);
  const isRural = (i: number, j: number) => {
    const k = j * N + i;
    if (rural[k] < 0) {
      queries++;
      rural[k] = world.districtAt(minX + i * step, minZ + j * step).type === 'rural' ? 1 : 0;
    }
    return rural[k] === 1;
  };
  let any = false;
  for (const i of [0, CELLS / 2, CELLS]) for (const j of [0, CELLS / 2, CELLS]) any = isRural(i, j) || any;
  if (!any) return;

  const ok = new Uint8Array(N * N);
  const height = new Float32Array(N * N);
  let wet = false;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!isRural(i, j)) continue;
      const x = minX + i * step;
      const z = minZ + j * step;
      queries += 2;
      // A lattice point that lands on a road still counts as farmland (the road is avoided point by point
      // below); otherwise a highway running along a lattice line loses its fences and poles for the whole chunk.
      const surface = world.surfaceAt(x, z);
      const sealed = surface === 'road' || surface === 'gravel' || surface === 'footpath';
      if ((surface !== 'grass' && !sealed) || world.waterDepthAt(x, z) > 0) {
        wet = true;
        continue;
      }
      queries++;
      height[j * N + i] = world.heightAt(x, z);
      ok[j * N + i] = 1;
    }
  }
  // Per cell: usable (all corners on dry rural grass, not hill country), and smooth enough to interpolate.
  const usable = new Uint8Array(CELLS * CELLS);
  const smoothCell = new Uint8Array(CELLS * CELLS);
  const bend = (i: number, j: number): number => {
    const h = (a: number, b: number) => (a < 0 || b < 0 || a >= N || b >= N || !ok[b * N + a] ? NaN : height[b * N + a]);
    const c = h(i, j);
    let worst = 0;
    for (const [da, db] of [[1, 0], [0, 1]] as const) {
      const p = h(i - da, j - db);
      const q = h(i + da, j + db);
      if (!Number.isNaN(p) && !Number.isNaN(q)) worst = Math.max(worst, Math.abs(p + q - 2 * c));
    }
    return worst;
  };
  let anyUsable = false;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const corners = [j * N + i, j * N + i + 1, (j + 1) * N + i, (j + 1) * N + i + 1];
      if (!corners.every((k) => ok[k])) continue;
      const hs = corners.map((k) => height[k]);
      const lo = Math.min(...hs);
      const hi = Math.max(...hs);
      if (hi - lo > 6 || hi > 80) continue;
      usable[j * CELLS + i] = 1;
      anyUsable = true;
      const twist = Math.abs(hs[0] + hs[3] - hs[1] - hs[2]);
      if (twist < 0.4 && Math.max(bend(i, j), bend(i + 1, j), bend(i, j + 1), bend(i + 1, j + 1)) < 0.4) smoothCell[j * CELLS + i] = 1;
    }
  }
  const cellOf = (x: number, z: number) => {
    const i = Math.min(CELLS - 1, Math.max(0, Math.floor((x - minX) / step)));
    const j = Math.min(CELLS - 1, Math.max(0, Math.floor((z - minZ) / step)));
    return j * CELLS + i;
  };
  const interpolate = (x: number, z: number): number => {
    const fx = Math.min(CELLS, Math.max(0, (x - minX) / step));
    const fz = Math.min(CELLS, Math.max(0, (z - minZ) / step));
    const i = Math.min(CELLS - 1, Math.floor(fx));
    const j = Math.min(CELLS - 1, Math.floor(fz));
    const u = fx - i;
    const v = fz - j;
    const k = j * N + i;
    return height[k] * (1 - u) * (1 - v) + height[k + 1] * u * (1 - v) + height[k + N] * (1 - u) * v + height[k + N + 1] * u * v;
  };

  // ── What to keep clear of: roads, rails, landmarks ──
  const graph = world.graph;
  const indexed = graph.edges.length > 0;
  const roads = indexed ? gather(roadGrid(graph), minX - 48, minZ - 48, maxX + 48, maxZ + 48) : [];
  // Nothing to fence and nothing to stand stock on.
  if (!anyUsable && roads.length === 0) return;
  const rails = world.railways.length > 0 ? gather(railGrid(world.railways), minX - 24, minZ - 24, maxX + 24, maxZ + 24) : [];
  const landmarks = world.landmarks.filter((l: LandmarkPlacement) => {
    const dx = Math.max(minX - l.x, 0, l.x - maxX);
    const dz = Math.max(minZ - l.z, 0, l.z - maxZ);
    return Math.hypot(dx, dz) < l.clearRadius + 12;
  });
  /** Distance to the nearest road sample (capped at 60). */
  const roadDistance = (x: number, z: number): number => {
    if (!indexed) {
      if (!spend()) return 0;
      const hit = graph.nearest(x, z, 40);
      return hit ? hit.distance : 60;
    }
    let best = 3600;
    for (const r of roads) {
      const dx = r.x - x;
      const dz = r.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const nearRail = (x: number, z: number, r: number): boolean => {
    for (const q of rails) if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < r * r) return true;
    return false;
  };
  const markers = world.places.filter((q) => q.x > minX - 20 && q.x < maxX + 20 && q.z > minZ - 20 && q.z < maxZ + 20);
  const inLandmark = (x: number, z: number, pad: number): boolean => {
    for (const l of landmarks) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + pad) return true;
    // Mission markers get the same berth as a landmark of radius 12: no fence across a lay-by or a forecourt.
    for (const q of markers) if (Math.hypot(q.x - x, q.z - z) < 12 + pad) return true;
    return false;
  };

  /**
   * Height to stand something at (x, z), or null if it may not go there: `roadGap` metres clear of road
   * centrelines, `pad` metres outside landmark radii, off the rails, on dry grass.
   */
  const place = (x: number, z: number, roadGap: number, pad: number): number | null => {
    const cell = cellOf(x, z);
    if (!usable[cell] || inLandmark(x, z, pad) || nearRail(x, z, Math.max(RAIL_CLEAR, roadGap - 2))) return null;
    const d = roadDistance(x, z);
    if (d < roadGap) return null;
    if (wet) {
      if (!spend()) return null;
      if (world.surfaceAt(x, z) !== 'grass') return null;
    }
    // Near a road the ground is graded to the carriageway, and rolling ground curves between lattice points.
    if (smoothCell[cell] && d > 26) return interpolate(x, z);
    return spend() ? world.heightAt(x, z) : null;
  };

  /**
   * Farmland right here? The 32 m lattice says so for whole cells; beside the railway reserve, a township or a
   * riverbank its cells are mixed, so there the spot itself is asked (SH1 has the main line 32 m away for most
   * of its length: without this it would have no fences, poles or marker posts at all).
   */
  const farmland = (x: number, z: number): boolean => {
    if (usable[cellOf(x, z)]) return true;
    if (DRESSING_OFF || queries + 3 > QUERY_BUDGET) return false;
    queries += 3;
    return world.districtAt(x, z).type === 'rural' && world.surfaceAt(x, z) === 'grass' && world.waterDepthAt(x, z) <= 0;
  };

  const wires = new Geo();
  const strand = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, t = 0.03) => {
    wires.poly([[ax, ay - t / 2, az], [bx, by - t / 2, bz], [bx, by + t / 2, bz], [ax, ay + t / 2, az]], true);
  };
  const span = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    for (const h of out.lod === 0 ? WIRE_HEIGHTS : [WIRE_HEIGHTS[2]]) strand(ax, ay + h, az, bx, by + h, bz);
  };
  const inArea = (x: number, z: number) => x >= minX && x < maxX && z >= minZ && z < maxZ;

  // ── Road-boundary fences, gates with letterboxes, and SH1's power poles ──
  const edges = new Set<RoadEdge>();
  let tussocks = 0;
  let rank = 0;
  for (const r of roads) edges.add(r.edge);
  for (const edge of [...edges].sort((a, b) => a.index - b.index)) {
    if (edge.bridge || edge.tunnel || edge.footpaths || edge.cls === 'pedestrian') continue;
    const highway = edge.cls === 'highway';
    const n = edge.samples.length;
    const offset = highway ? Math.max(10, edge.width / 2 + 5.6) : Math.max(8.6, edge.width / 2 + 4.6);
    for (const side of [1, -1]) {
      // Ground beside the road follows its profile, so measure the difference every 32 m and interpolate.
      const anchors = new Map<number, number>();
      const at = (i: number): [number, number] => {
        const s = edge.samples[i];
        return [s.x + s.tz * side * offset, s.z - s.tx * side * offset];
      };
      const anchor = (i: number): number => {
        const k = Math.min(n - 1, i);
        let delta = anchors.get(k);
        if (delta === undefined) {
          const [x, z] = at(k);
          delta = spend() ? world.heightAt(x, z) - edge.samples[k].y : 0;
          anchors.set(k, delta);
        }
        return delta;
      };
      const post = (i: number): [number, number, number] | null => {
        const [x, z] = at(i);
        if (inLandmark(x, z, 1.5) || nearRail(x, z, RAIL_CLEAR) || roadDistance(x, z) < ROAD_CLEAR || !farmland(x, z)) return null;
        const a = Math.floor(i / 8) * 8;
        const t = (i - a) / 8;
        return [x, edge.samples[i].y + anchor(a) * (1 - t) + anchor(a + 8) * t, z];
      };
      for (let i = 2; i < n - 2; i += 2) {
        const [px, pz] = at(i);
        if (!inArea(px, pz)) continue;
        const p = post(i);
        if (!p) continue;
        const s = edge.samples[i];
        out.instance(PROP.post, p[0], p[1], p[2], Math.atan2(s.tx, s.tz));
        // Rank grass along the fence line, on the road side where the mower and the stock cannot reach.
        const g = hashInts(edge.index, i, side + 40);
        if (out.lod === 0 && !DRESSING_OFF && g % 20 < 15 && tussocks < 190) {
          const inset = 0.5 + ((g >>> 5) % 100) / 60;
          const along = ((g >>> 12) % 100) / 100 - 0.5;
          const gx = p[0] - s.tz * side * inset + s.tx * along * 7;
          const gz = p[2] + s.tx * side * inset + s.tz * along * 7;
          // Off every seal and shoulder (a side road may join just here).
          if (roadDistance(gx, gz) >= 6.2) {
            out.instance('tussock', gx, p[1] - 0.04, gz, (g % 628) / 100, 0.75 + ((g >>> 9) % 100) / 160, ROADSIDE[(g >>> 3) % ROADSIDE.length]);
            tussocks++;
            // A second clump a pace away thickens the line without another roll of the dice.
            if (g % 3 !== 0) out.instance('tussock', gx + s.tx * 1.1 + s.tz * 0.4, p[1] - 0.04, gz + s.tz * 1.1 - s.tx * 0.4, (g % 314) / 50, 0.6 + ((g >>> 14) % 100) / 220, ROADSIDE[(g >>> 6) % ROADSIDE.length]);
          }
        }
        const q = i + 2 < n - 2 ? post(i + 2) : null;
        // Long grass under the wire, where neither the mower nor the stock can get at it.
        if (out.lod === 0 && !DRESSING_OFF && !ROUND3_OFF && rank < 280 && g % 7 !== 0) {
          const turn = Math.atan2(-s.tz, s.tx);
          out.instance('grass-long', p[0], p[1] - 0.03, p[2], turn, 0.9 + ((g >>> 20) % 100) / 300);
          if (q) {
            const [hx, hz] = at(i + 1);
            if (roadDistance(hx, hz) >= ROAD_CLEAR) out.instance('grass-long', hx, (p[1] + q[1]) / 2 - 0.03, hz, turn + Math.PI, 0.85 + ((g >>> 24) % 100) / 280);
          }
          rank += 2;
        }
        if (!q) continue;
        const dx = q[0] - p[0];
        const dz = q[2] - p[2];
        const len = Math.hypot(dx, dz);
        const gate = len > GATE_HALF * 2 + 0.6 && len < 12 && hashInts(edge.index, i, side) % 23 === 0;
        if (!gate) {
          span(p[0], p[1], p[2], q[0], q[1], q[2]);
          continue;
        }
        // A farm gate in the middle of the span, and (always on gravel roads) the letterbox beside it.
        const ux = dx / len;
        const uz = dz / len;
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        const mz = (p[2] + q[2]) / 2;
        out.instance(PROP.gate, mx, my, mz, Math.atan2(-uz, ux));
        span(p[0], p[1], p[2], mx - ux * GATE_HALF, my, mz - uz * GATE_HALF);
        span(mx + ux * GATE_HALF, my, mz + uz * GATE_HALF, q[0], q[1], q[2]);
        if (out.lod === 0 && (edge.cls === 'gravel' || hashInts(edge.index, i, 9) % 2 === 0)) {
          const inX = -s.tz * side;
          const inZ = s.tx * side;
          const lx = mx + ux * (GATE_HALF + 0.7) + inX * 0.5;
          const lz = mz + uz * (GATE_HALF + 0.7) + inZ * 0.5;
          out.instance(PROP.letterbox, lx, my, lz, Math.atan2(inX, inZ), 1, LETTERBOX_TINTS[hashInts(edge.index, i, 5) % LETTERBOX_TINTS.length]);
        }
      }
    }
    if (!highway) continue;
    // Edge marker posts both sides of the highway, 48 m apart, reflectors facing the oncoming driver.
    for (let i = 6; i < n - 2 && !DRESSING_OFF; i += 12) {
      const s = edge.samples[i];
      for (const side of [1, -1]) {
        const off = side * (edge.width / 2 + 1.25);
        const x = s.x + s.tz * off;
        const z = s.z - s.tx * off;
        if (!inArea(x, z) || inLandmark(x, z, 1) || nearRail(x, z, RAIL_CLEAR) || roadDistance(x, z) < edge.width / 2 + 0.9 || !farmland(x, z)) continue;
        out.instance('marker-post', x, s.y - 0.05, z, Math.atan2(-s.tx * side, -s.tz * side));
      }
    }
    // Power poles down the left of the highway, inside the fence, 48 m apart, with three sagging conductors.
    const poleOffset = offset - 1.6;
    const poles = new Map<number, [number, number, number] | null>();
    const poleAt = (i: number): [number, number, number] | null => {
      let pole = poles.get(i);
      if (pole === undefined) {
        const s = edge.samples[i];
        const x = s.x + s.tz * poleOffset;
        const z = s.z - s.tx * poleOffset;
        const blocked = inLandmark(x, z, 2) || nearRail(x, z, RAIL_CLEAR) || roadDistance(x, z) < 8.2 || !farmland(x, z);
        pole = blocked ? null : [x, spend() ? world.heightAt(x, z) : s.y, z];
        poles.set(i, pole);
      }
      return pole;
    };
    for (let i = 0; i < n; i += 12) {
      const s = edge.samples[i];
      if (!inArea(s.x + s.tz * poleOffset, s.z - s.tx * poleOffset)) continue;
      const a = poleAt(i);
      if (!a) continue;
      out.instance(PROP.pole, a[0], a[1], a[2], Math.atan2(s.tx, s.tz));
      if (i + 12 >= n) continue;
      const b = poleAt(i + 12);
      if (!b) continue;
      const e = edge.samples[i + 12];
      for (const off of POLE_WIRES.offsets) {
        let px = a[0] + s.tz * off;
        let py = a[1] + POLE_WIRES.height;
        let pz = a[2] - s.tx * off;
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          const qx = a[0] + s.tz * off + (b[0] + e.tz * off - a[0] - s.tz * off) * t;
          const qz = a[2] - s.tx * off + (b[2] - e.tx * off - a[2] + s.tx * off) * t;
          const qy = a[1] + (b[1] - a[1]) * t + POLE_WIRES.height - 4 * t * (1 - t) * 0.9;
          strand(px, py, pz, qx, qy, qz, 0.04);
          px = qx;
          py = qy;
          pz = qz;
        }
      }
    }
  }

  // ── Paddock boundaries: fences, shelter belts, water races ──
  const water = new Geo();
  const banks = new Geo();
  let trees = 0;
  let hedges = 0;
  const boundary = (fixed: number, vertical: boolean, line: number) => {
    const lo = vertical ? minZ : minX;
    const hi = lo + size;
    const point = (t: number, across = 0): [number, number] => (vertical ? [fixed + across, t] : [t, fixed + across]);
    const traits = (t: number) => (vertical ? edgeTraits(line, Math.floor((t + ORIGIN_Z) / BLOCK_Z), true) : edgeTraits(Math.floor((t + ORIGIN_X) / BLOCK_X), line, false));
    // Fence posts on the 8 m grid; each post strings wire to the next one along.
    const post = (t: number): [number, number, number] | null => {
      if (!traits(t).fenced) return null;
      const [x, z] = point(t);
      const y = place(x, z, ROAD_CLEAR, 1.5);
      return y === null ? null : [x, y, z];
    };
    let next = post(Math.ceil(lo / POST_GAP) * POST_GAP);
    for (let t = Math.ceil(lo / POST_GAP) * POST_GAP; t < hi; t += POST_GAP) {
      const p = next;
      next = post(t + POST_GAP);
      if (!p) continue;
      out.instance(PROP.post, p[0], p[1], p[2], vertical ? 0 : Math.PI / 2);
      if (!next) continue;
      const [mx, mz] = point(t + POST_GAP / 2);
      if (roadDistance(mx, mz) >= ROAD_CLEAR) span(p[0], p[1], p[2], next[0], next[1], next[2]);
    }
    // Shelter belt: a straight row a few metres inside one paddock.
    for (let t = Math.ceil(lo / 6) * 6; t < hi; t += 6) {
      const tr = traits(t);
      if (!tr.belt || tr.belt === 'hedge-shelter' || trees >= 150) continue;
      const h = hashInts(Math.round(fixed), t, 31);
      if (h % 19 === 0) continue;
      const [x, z] = point(t, tr.side * (3.4 + ((h >>> 8) % 100) / 125));
      const y = place(x, z, 13, 4);
      if (y === null) continue;
      const pine = tr.belt === 'tree-pine';
      out.instance(tr.belt, x, y, z, (h % 628) / 100, (pine ? 1.0 : 0.9) + ((h >>> 16) % 100) / (pine ? 280 : 300));
      trees++;
    }
    // Shelter hedge: clipped macrocarpa in 4 m lengths laid end to end just inside the fence, with the odd gap.
    for (let t = Math.ceil(lo / 4) * 4; t < hi; t += 4) {
      const tr = traits(t + 2);
      if (tr.belt !== 'hedge-shelter' || hedges >= 130 || DRESSING_OFF || ROUND3_OFF) continue;
      if (hashInts(Math.round(fixed), Math.floor(t / 4), 37) % 29 === 0) continue;
      const [x, z] = point(t + 2, tr.side * 2.6);
      const y = place(x, z, 14, 4);
      if (y === null) continue;
      out.instance('hedge-shelter', x, y - 0.06, z, vertical ? Math.PI / 2 : 0);
      hedges++;
    }
    // Water race: a narrow channel between low banks on the other side of the fence.
    for (let t = Math.floor(lo / 16) * 16; t < hi; t += 16) {
      if (t < lo) continue;
      const tr = traits(t + 8);
      if (!tr.race) continue;
      const a = point(t, -tr.side * 3);
      const b = point(t + 16, -tr.side * 3);
      const mid = point(t + 8, -tr.side * 3);
      const ya = place(a[0], a[1], 10.5, 3);
      const yb = place(b[0], b[1], 10.5, 3);
      if (ya === null || yb === null || place(mid[0], mid[1], 10.5, 3) === null) continue;
      const nx = vertical ? 1 : 0;
      const nz = vertical ? 0 : 1;
      const at = (q: [number, number], y: number, across: number, lift: number): [number, number, number] => [q[0] + nx * across, y + lift, q[1] + nz * across];
      const profile: [number, number][] = [[-1.3, -0.12], [-0.8, 0.26], [-0.5, 0.1], [0.5, 0.1], [0.8, 0.26], [1.3, -0.12]];
      for (let k = 0; k < profile.length - 1; k++) {
        const [o0, l0] = profile[k];
        const [o1, l1] = profile[k + 1];
        (k === 2 ? water : banks).polyUp([at(a, ya, o0, l0), at(a, ya, o1, l1), at(b, yb, o1, l1), at(b, yb, o0, l0)]);
      }
    }
  };
  for (let k = Math.ceil((minX + ORIGIN_X) / BLOCK_X); k * BLOCK_X - ORIGIN_X < maxX; k++) boundary(k * BLOCK_X - ORIGIN_X, true, k);
  for (let k = Math.ceil((minZ + ORIGIN_Z) / BLOCK_Z); k * BLOCK_Z - ORIGIN_Z < maxZ; k++) boundary(k * BLOCK_Z - ORIGIN_Z, false, k);

  // ── What is in each paddock: sheep, cattle, hay, or nothing much ──
  let stock = 0;
  let bales = 0;
  for (let ix = Math.floor((minX + ORIGIN_X) / BLOCK_X); ix * BLOCK_X - ORIGIN_X < maxX; ix++) {
    for (let iz = Math.floor((minZ + ORIGIN_Z) / BLOCK_Z); iz * BLOCK_Z - ORIGIN_Z < maxZ; iz++) {
      const x0 = ix * BLOCK_X - ORIGIN_X;
      const z0 = iz * BLOCK_Z - ORIGIN_Z;
      const rng = new Rng(hashInts(ix, iz, 7919));
      const use = rng.next();
      const inside = (x: number, z: number) => x > x0 + 6 && x < x0 + BLOCK_X - 6 && z > z0 + 6 && z < z0 + BLOCK_Z - 6 && inArea(x, z);
      if (use < 0.52) {
        // Sheep (most paddocks) or cattle: one or two loose mobs, and a trough.
        const sheep = use < 0.44;
        const dairy = rng.chance(0.5);
        const hide = rng.pick(HIDES);
        const mobs = sheep && rng.chance(0.35) ? 2 : 1;
        for (let mob = 0; mob < mobs; mob++) {
          const cx = x0 + rng.range(36, BLOCK_X - 36);
          const cz = z0 + rng.range(32, BLOCK_Z - 32);
          const count = sheep ? rng.int(9, 26) : rng.int(5, 11);
          const spread = sheep ? rng.range(10, 26) : rng.range(16, 30);
          for (let k = 0; k < count; k++) {
            const a = rng.range(0, TAU);
            const r = spread * Math.sqrt(rng.next());
            const x = cx + Math.cos(a) * r * 1.3;
            const z = cz + Math.sin(a) * r;
            const heading = rng.range(0, TAU);
            const scale = rng.range(0.9, 1.08);
            const tint = rng.pick(FLEECE);
            if (!inside(x, z) || stock >= 96) continue;
            const y = place(x, z, 15, 2);
            if (y === null) continue;
            if (sheep) out.instance(PROP.sheep, x, y, z, heading, scale, tint);
            else if (dairy) out.instance(PROP.friesian, x, y, z, heading, scale);
            else out.instance(PROP.cow, x, y, z, heading, scale, hide);
            stock++;
          }
          const troughTurn = rng.range(0, TAU);
          if (mob === 0 && out.lod === 0 && inside(cx + 4, cz - 3)) {
            const y = place(cx + 4, cz - 3, 15, 2);
            if (y !== null) out.instance(PROP.trough, cx + 4, y, cz - 3, troughTurn);
          }
        }
      } else if (use < 0.64) {
        // Hay: round bales left in rough rows where the baler dropped them.
        const turn = rng.chance(0.5) ? 0 : Math.PI / 2;
        for (let gx = x0 + 18; gx < x0 + BLOCK_X - 14; gx += 24) {
          for (let gz = z0 + 16; gz < z0 + BLOCK_Z - 12; gz += 20) {
            const keep = rng.chance(0.62);
            const x = gx + rng.range(-4, 4);
            const z = gz + rng.range(-4, 4);
            const heading = turn + rng.range(-0.25, 0.25);
            const scale = rng.range(0.92, 1.05);
            if (!keep || !inside(x, z) || bales >= 60) continue;
            const y = place(x, z, 13, 2);
            if (y === null) continue;
            out.instance(PROP.bale, x, y, z, heading, scale);
            bales++;
          }
        }
      }
    }
  }

  wires.flush(out, out.materials.get('metal', { color: 0x8f9290, roughness: 0.6 }));
  banks.flush(out, out.materials.get('grass', { color: 0x5f7a3a }));
  water.flush(out, out.materials.get('glass', { color: 0x3a7f86 }));
};

SCATTERERS.push(ruralScatterer);
