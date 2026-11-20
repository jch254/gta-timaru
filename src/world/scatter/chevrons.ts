import * as THREE from 'three';
import { angleDiff } from '../../core/math';
import type { MaterialLibrary, RoadEdge, RoadGraph, Scatterer, WorldApi } from '../../core/types';
import { inLandmark } from '../clearance';
import { painted } from '../landmarks/paint';
import { registerProp } from '../props/index';
import { SCATTERERS } from './registry';
import { DRESSING_OFF, edgesIn, Keep, leaving } from './util';

/**
 * Curve warning signs and chevron boards on the bends of the open road (MOTSAM Part 1 section 6, see
 * docs/research/11-timaru-landmarks.md section 11):
 *
 * - well ahead of each bend, on the left verge, a yellow diamond with a curved arrow over an advisory speed plate;
 * - round the outside of the bend, single PW-67 chevrons on posts, at least three per direction of travel, the
 *   first where the approach line meets the outside verge and the last at the tangent point where the curve ends;
 * - on the severe ones (advisory 35 km/h or less) a PW-66 board with four chevrons takes the first chevron's place.
 *
 * Open road means no kerbs and 70 km/h or more, plus the hill roads mapped at 50 km/h where they run through the
 * country (the Port Hills), whose advisories are still measured against their own limit. Bends are found per road
 * edge from the curvature of its samples, so a bend split by a node is signed as two shorter bends (or not at all
 * if neither half turns enough); only the warning sign looks past a node, back along the road leading in.
 * Everything is a pure function of the edge and the world, planned once per edge, and each sign is put down by
 * the chunk holding its post.
 */

// ───────────── Finding the bends ─────────────

/** Samples either side of a point that its curvature is measured over (±12 m at 4 m spacing). */
const SMOOTH = 3;
/** Same-hand curves this close together are one bend (a compound curve). */
const MERGE = 20;
/** A bend is signed when its advisory speed is at least this far below the limit (km/h)... */
const MIN_DROP = 15;
/** ...and it turns at least this much. */
const MIN_TURN = (20 * Math.PI) / 180;

// The speed a curve is comfortable at: v² = 127 r (e + f), v in km/h, r in metres, with 5% superelevation and a
// side friction drivers accept that falls with speed, f = 0.35 − 0.0019 v (0.26 at 50 km/h, 0.16 at 100 km/h,
// about the Austroads desirable values). A 60 m curve comes out at 48 km/h, a 200 m curve at 80 km/h.
const SUPER = 0.05;
const F0 = 0.35;
const F1 = 0.0019;

/** Speed (km/h) a car takes a curve of radius `r` metres at. */
export function curveSpeed(r: number): number {
  const b = 127 * r * F1;
  const c = 127 * r * (SUPER + F0);
  return (-b + Math.sqrt(b * b + 4 * c)) / 2;
}

/** Radius (m) of the curve that is comfortable at `v` km/h. */
export function radiusFor(v: number): number {
  return (v * v) / (127 * (SUPER + F0 - F1 * v));
}

/** The advisory speed posted for a curve: its comfortable speed rounded down to a number ending in 5, 15 at least. */
export function advisoryFor(r: number): number {
  return Math.max(15, Math.floor((curveSpeed(r) - 5) / 10) * 10 + 5);
}

export interface Bend {
  /** Where the curve proper begins and ends (the tangent points), metres from node a. */
  start: number;
  end: number;
  /** Which way the road turns for traffic travelling a → b. */
  direction: 'left' | 'right';
  /** Tightest radius (m), as measured over 24 m of road. */
  radius: number;
  /** Total change of heading (radians). */
  turn: number;
  /** Advisory speed for the plate (km/h). */
  advisory: number;
}

/** Slowest limit (km/h) of the open road proper. */
export const OPEN_LIMIT = 70;
/**
 * Slowest limit counted as open road where it runs through the country: the Port Hills roads are mapped at
 * 50 km/h, and their hairpins were signed all the same.
 */
export const HILL_LIMIT = 50;

/** Open road: no kerbs, on the ground, for traffic, and at least `minLimit` km/h. */
export function openRoad(e: RoadEdge, minLimit = OPEN_LIMIT): boolean {
  return e.drivable && e.cls !== 'pedestrian' && !e.footpaths && !e.bridge && !e.tunnel && e.speedLimit * 3.6 >= minLimit - 0.5;
}

/**
 * The bends on an edge that want a curve warning and chevrons, in order along it. Roads slower than `minLimit`
 * km/h are not open road. The advisory is always measured against the edge's own limit, so on a 50 km/h road
 * only curves of 35 km/h and under count.
 */
export function findBends(edge: RoadEdge, minLimit = OPEN_LIMIT): Bend[] {
  const p = edge.samples;
  const n = p.length;
  if (!openRoad(edge, minLimit) || n < 4) return [];
  // Heading unwrapped along the edge, so a hairpin's turn adds up past π.
  const th = new Float64Array(n);
  th[0] = Math.atan2(p[0].tx, p[0].tz);
  for (let i = 1; i < n; i++) th[i] = th[i - 1] + angleDiff(Math.atan2(p[i].tx, p[i].tz), th[i - 1]);
  // Signed curvature (+ turns left), averaged over the window: a kink in an unsmoothed polyline reads as the
  // curve a driver would steer through it.
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - SMOOTH);
    const hi = Math.min(n - 1, i + SMOOTH);
    k[i] = (th[hi] - th[lo]) / Math.max(1e-6, p[hi].s - p[lo].s);
  }
  const limit = edge.speedLimit * 3.6;
  // Anything tighter than a curve comfortable at the limit is part of a bend.
  const floor = 1 / radiusFor(limit);
  const runs: [number, number, number][] = [];
  for (let i = 0; i < n; ) {
    const sign = Math.abs(k[i]) >= floor ? Math.sign(k[i]) : 0;
    if (!sign) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && Math.sign(k[j + 1]) === sign && Math.abs(k[j + 1]) >= floor) j++;
    const last = runs[runs.length - 1];
    if (last && last[2] === sign && p[i].s - p[last[1]].s < MERGE) last[1] = j;
    else runs.push([i, j, sign]);
    i = j + 1;
  }
  const bends: Bend[] = [];
  for (const [i0, i1, sign] of runs) {
    let peak = 0;
    for (let i = i0; i <= i1; i++) peak = Math.max(peak, Math.abs(k[i]));
    const turn = Math.abs(th[i1] - th[i0]);
    const radius = 1 / peak;
    const advisory = advisoryFor(radius);
    if (advisory > limit - MIN_DROP || turn < MIN_TURN) continue;
    // The curve proper: where it is at least 40% as tight as its tightest (the window blurs its ends).
    const cut = Math.max(floor, peak * 0.4);
    let j0 = i0;
    while (Math.abs(k[j0]) < cut) j0++;
    let j1 = i1;
    while (Math.abs(k[j1]) < cut) j1--;
    bends.push({ start: p[j0].s, end: p[j1].s, direction: sign > 0 ? 'left' : 'right', radius, turn, advisory });
  }
  return bends;
}

// ───────────── Planning the signs ─────────────

export type CurveSignRole = 'warning' | 'pw66' | 'pw67';

export interface CurveSign {
  kind: string;
  role: CurveSignRole;
  x: number;
  z: number;
  /** Height of the seal beside the post: the plates hang at a set height above it. */
  road: number;
  heading: number;
  /** The edge and distance along it the post is set out from (a warning may stand on the edge before the bend's). */
  edge: number;
  s: number;
  /** Direction of travel on the bend's edge the sign is for (1 = a → b). */
  dir: 1 | -1;
}

/** Plates' posts stand this far off the edge of the seal. */
const CHEVRON_OFFSET = 1.5;
const WARNING_OFFSET = 1.8;
/** Turned this far off square to the driver's line of sight, so the plate does not throw the headlights back. */
const SKEW = (8 * Math.PI) / 180;
/** Nothing closer to a node than this (the junction's own signs and the crossing carriageway are there). */
const END_CLEAR = 12;
/** A curve warning closer to the curve than this is no warning. */
const MIN_LEAD = 25;
/** Half the width of each sign along the verge. */
const WARNING_REACH = 0.55;
const PW67_REACH = 0.32;
const PW66_REACH = 0.98;
const MISSION_CLEAR = 30;
/** Chevrons per direction, at most. */
const MAX_CHEVRONS = 10;
export const ADVISORIES = [15, 25, 35, 45, 55, 65, 75, 85] as const;

/** Spacing of the chevrons by advisory speed: tight bends need them closer for two to be in view. */
const spacingFor = (advisory: number) => (advisory <= 25 ? 12 : advisory <= 45 ? 20 : advisory <= 65 ? 30 : 40);

interface Spot {
  x: number;
  z: number;
  y: number;
  /** Unit tangent a → b. */
  tx: number;
  tz: number;
}

/** Point `lateral` metres left of the a → b centreline at `s` (negative: right). */
function verge(graph: RoadGraph, e: RoadEdge, s: number, lateral: number): Spot {
  const p = graph.pointAt(e, s);
  const len = Math.hypot(p.tx, p.tz) || 1;
  const tx = p.tx / len;
  const tz = p.tz / len;
  return { x: p.x + tz * lateral, z: p.z - tx * lateral, y: p.y, tx, tz };
}

/**
 * Where a post may stand: off every carriageway, out of landmarks and markers, on dry land. Missions stand people
 * and cars along the road for some way either side of their marker, so signs keep well back from those.
 */
function free(world: WorldApi, e: RoadEdge, x: number, z: number): boolean {
  for (const l of world.landmarks) if (inLandmark(l, x, z, 2)) return false;
  for (const p of world.places) if (Math.hypot(p.x - x, p.z - z) < (p.tags.includes('mission') ? MISSION_CLEAR : 6)) return false;
  if (world.waterDepthAt(x, z) > 0) return false;
  const other = world.graph.nearest(x, z, 30, (o) => o !== e);
  if (other && other.distance < other.edge.width / 2 + 1) return false;
  // The other leg of a hairpin.
  const own = world.graph.nearest(x, z, 30, (o) => o === e);
  return !own || own.distance >= e.width / 2 + 0.8;
}

/**
 * Where the approach line meets the outside verge: travelling `dir` from the start of the curve at `s0`, the line
 * straight on from `lateral` metres left of the centre (0 for a left-hand curve, the left edge of the seal for a
 * right-hand one), against the verge `off` metres left of travel. The first chevron goes there.
 */
function prolongation(graph: RoadGraph, e: RoadEdge, dir: 1 | -1, s0: number, s1: number, lateral: number, off: number): number {
  const a = verge(graph, e, s0, lateral * dir);
  const dx = a.tx * dir;
  const dz = a.tz * dir;
  const across = (s: number) => {
    const q = verge(graph, e, s, off * dir);
    return dx * (q.z - a.z) - dz * (q.x - a.x);
  };
  const f0 = Math.sign(across(s0));
  const span = Math.abs(s1 - s0);
  for (let t = 1; t <= span; t++) if (Math.sign(across(s0 + dir * t)) !== f0) return s0 + dir * t;
  return s0;
}

/** The road that carries on from `e` through `node`: the only other one, else the most nearly straight on (the same road by preference). */
function carryOn(graph: RoadGraph, e: RoadEdge, node: number): RoadEdge | null {
  const arms = graph.nodes[node].edges.map((i) => graph.edges[i]).filter((o) => o !== e && o.drivable && o.cls !== 'pedestrian');
  if (graph.nodes[node].edges.length === 2) return arms[0] ?? null;
  const [ax, az] = leaving(e, node);
  let best: RoadEdge | null = null;
  let score = 0.7;
  for (const o of arms) {
    const [bx, bz] = leaving(o, node);
    const inLine = -(ax * bx + az * bz);
    if (inLine < 0.7) continue;
    const s = inLine + (o.name === e.name ? 0.5 : 0);
    if (s > score) [best, score] = [o, s];
  }
  return best;
}

/**
 * The spot `beyond` metres back from `node` along the road that carries on behind `e` (across a bridge or two if
 * need be), with the direction of travel there that heads for `e`. Null where the road ends first, or the spot is
 * on a bridge, in a tunnel or in a junction.
 */
function behind(graph: RoadGraph, e: RoadEdge, node: number, beyond: number): { edge: RoadEdge; s: number; d: 1 | -1 } | null {
  let cur = e;
  let at = node;
  let left = beyond;
  for (let hop = 0; hop < 4; hop++) {
    const o = carryOn(graph, cur, at);
    if (!o) return null;
    if (left <= o.length) {
      if (o.bridge || o.tunnel || left < END_CLEAR || left > o.length - END_CLEAR) return null;
      const d: 1 | -1 = o.b === at ? 1 : -1;
      return { edge: o, s: d === 1 ? o.length - left : left, d };
    }
    left -= o.length;
    at = o.a === at ? o.b : o.a;
    cur = o;
  }
  return null;
}

/** The bends of an edge that get signs: on the open road, or on a hill road where it runs through the country. */
export function signedBends(world: WorldApi, e: RoadEdge): Bend[] {
  const open = e.speedLimit * 3.6 >= OPEN_LIMIT - 0.5;
  return findBends(e, HILL_LIMIT).filter((b) => {
    if (open) return true;
    const mid = world.graph.pointAt(e, (b.start + b.end) / 2);
    return world.districtAt(mid.x, mid.z).type === 'rural';
  });
}

const plans = new WeakMap<WorldApi, Map<number, CurveSign[]>>();

/** Every curve sign belonging to the bends of one edge, for both directions of travel. Cached per world. */
export function curveSigns(world: WorldApi, e: RoadEdge): CurveSign[] {
  let byEdge = plans.get(world);
  if (!byEdge) plans.set(world, (byEdge = new Map()));
  let plan = byEdge.get(e.index);
  if (!plan) byEdge.set(e.index, (plan = planEdge(world, e)));
  return plan;
}

function planEdge(world: WorldApi, e: RoadEdge): CurveSign[] {
  const graph = world.graph;
  const out: CurveSign[] = [];
  const half = e.width / 2;
  const limit = e.speedLimit * 3.6;
  // The curve warning stands further back the faster the road.
  const lead = Math.min(120, Math.max(60, limit * 1.1));
  // Half the width of each sign along the road, so plates for the two directions never cut through each other.
  const reach: number[] = [];
  const crowded = (x: number, z: number, r: number) => out.some((o, i) => Math.hypot(o.x - x, o.z - z) < reach[i] + r + 0.3);
  const put = (sign: CurveSign, r: number) => {
    out.push(sign);
    reach.push(r);
  };

  /** The warning sign for travel `dir` approaching a curve that starts at `s0`: on the left verge, `lead` back. */
  const warningSpot = (dir: 1 | -1, s0: number): Omit<CurveSign, 'kind' | 'role' | 'dir'> | null => {
    const node = dir === 1 ? e.a : e.b;
    const toNode = dir === 1 ? s0 : e.length - s0;
    // As far back as wanted, else nearer; on a fast road on past a bridge or the bend before; else just past the junction.
    const far: number[] = [];
    for (let b = lead + 45; b <= lead * 2.4; b += 15) far.push(b);
    for (const back of [lead, lead - 15, lead + 15, lead - 30, lead + 30, 45, ...far, toNode - END_CLEAR, MIN_LEAD]) {
      if (back < MIN_LEAD) continue;
      const at = back <= toNode - END_CLEAR ? { edge: e, s: s0 - dir * back, d: dir } : behind(graph, e, node, back - toNode);
      if (!at || amongChevrons(at.edge, at.s, at.d)) continue;
      const q = verge(graph, at.edge, at.s, at.d * (at.edge.width / 2 + WARNING_OFFSET));
      if (!free(world, at.edge, q.x, q.z) || crowded(q.x, q.z, WARNING_REACH)) continue;
      return { x: q.x, z: q.z, road: q.y, heading: Math.atan2(-q.tx * at.d, -q.tz * at.d), edge: at.edge.index, s: at.s };
    }
    return null;
  };

  for (const bend of signedBends(world, e)) {
    const advisory = Math.min(bend.advisory, ADVISORIES[ADVISORIES.length - 1]);
    const spacing = spacingFor(advisory);
    for (const dir of e.oneway ? ([1] as const) : ([1, -1] as const)) {
      const left = (bend.direction === 'left') === (dir === 1);
      const turn = left ? 'left' : 'right';
      const s0 = dir === 1 ? bend.start : bend.end;
      const s1 = dir === 1 ? bend.end : bend.start;
      // No chevrons without the warning ahead of them.
      const warning = warningSpot(dir, s0);
      if (!warning) continue;
      put({ kind: `curve-warning-${turn}-${advisory}`, role: 'warning', dir, ...warning }, WARNING_REACH);

      // The outside of the curve, as a lateral offset left of travel.
      const off = (left ? -1 : 1) * (half + CHEVRON_OFFSET);
      let first = prolongation(graph, e, dir, s0, s1, left ? 0 : half, off);
      // Never bunched tighter than 6 m apart.
      const want = Math.min(Math.abs(s1 - s0), 12);
      if (Math.abs(s1 - first) < want) first = s1 - dir * want;
      const span = Math.abs(s1 - first);
      const count = Math.min(MAX_CHEVRONS, Math.max(3, Math.round(span / spacing) + 1));
      const sight = Math.min(60, Math.max(30, spacing * 2));
      for (let j = 0; j < count; j++) {
        const board = j === 0 && advisory <= 35;
        const r = board ? PW66_REACH : PW67_REACH;
        // Where the other direction's plate is in the way, the post moves along a little.
        const at = first + ((s1 - first) * j) / (count - 1);
        let s = at;
        let q: Spot | null = null;
        for (const nudge of [0, 1.5, -1.5, 3, -3]) {
          const c = verge(graph, e, Math.min(e.length, Math.max(0, at + nudge)), off * dir);
          if (!crowded(c.x, c.z, r)) {
            [s, q] = [Math.min(e.length, Math.max(0, at + nudge)), c];
            break;
          }
        }
        if (!q || !free(world, e, q.x, q.z)) continue;
        // Square to a driver in the left lane `sight` metres back, then turned off square towards the outside.
        const v = verge(graph, e, Math.min(e.length, Math.max(0, s - dir * sight)), (dir * half) / 2);
        const base = Math.atan2(v.x - q.x, v.z - q.z);
        const outward = (h: number) => (Math.sin(h) * q.tz - Math.cos(h) * q.tx) * off * dir;
        const heading = outward(base + SKEW) >= outward(base - SKEW) ? base + SKEW : base - SKEW;
        put({ kind: board ? `chevron-pw66-${turn}-${advisory}` : `chevron-pw67-${turn}`, role: board ? 'pw66' : 'pw67', x: q.x, z: q.z, road: q.y, heading, edge: e.index, s, dir }, r);
      }
    }
  }
  return out;
}

/** Is a spot on the verge (left of travel `d`) where some bend of `edge` has its chevrons? */
function amongChevrons(edge: RoadEdge, s: number, d: 1 | -1): boolean {
  for (const b of findBends(edge, HILL_LIMIT)) {
    const outside = b.direction === 'left' ? -1 : 1;
    if (outside === d && s > b.start - 6 && s < b.end + 6) return true;
  }
  return false;
}

/**
 * Base height of a post: the plates are set out above the seal, so the base sits at road level and the post runs
 * on down into the verge where it falls away (up to `POST_FOOT`); where the verge is cut higher than the road, the
 * post stands on it.
 */
const POST_FOOT = 1.2;
function postBase(world: WorldApi, sign: CurveSign): number {
  const ground = world.heightAt(sign.x, sign.z);
  return Math.min(Math.max(sign.road, ground), ground + POST_FOOT - 0.05);
}

export const chevronScatterer: Scatterer = (area, out) => {
  if (DRESSING_OFF) return;
  const world = out.world;
  const keep = new Keep(world, area);
  // A warning can stand on the edge before the bend's, so look at the roads of the neighbouring areas too.
  const near = new Set<RoadEdge>();
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const e of edgesIn(world.graph, { ...area, minX: area.minX + i * area.size, minZ: area.minZ + j * area.size })) near.add(e);
  const edges = [...near].filter((e) => openRoad(e, HILL_LIMIT)).sort((a, b) => a.index - b.index);
  for (const e of edges) {
    for (const sign of curveSigns(world, e)) {
      if (keep.inArea(sign.x, sign.z)) out.instance(sign.kind, sign.x, postBase(world, sign), sign.z, sign.heading);
    }
  }
};

SCATTERERS.push(chevronScatterer);

// ───────────── The signs ─────────────
// Flat artwork in vertex colours over a grey steel plate on one shared material (the street signs' own, see
// ../props/extra.ts): every kind is a single part, so one draw call per chunk it appears in, and none in the
// shadow passes. The backs are the plain grey of the plate. Not `minor`: thinning would leave a bend with two
// chevrons, or chevrons with no warning before them; being under 5 m they are only drawn near the camera anyway.

const YELLOW = 0xf2c018;
const BLACK = 0x151515;
/** Aircraft grey, for the backs. */
const GREY = 0xa3a7a4;
const STEEL = 0x8d9194;
/** Layers of the artwork stand this far apart, out from the face of the plate. */
const LAYER = 0.005;

type P2 = readonly [number, number];
type Art = [THREE.BufferGeometry, number][];

/** Flat triangles (x, y pairs, three to a triangle) in the plane z, facing +z whatever their winding. */
function flat(tris: number[], z: number, ox = 0, oy = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 5 < tris.length; i += 6) {
    const [ax, ay] = [tris[i], tris[i + 1]];
    let [bx, by, cx, cy] = [tris[i + 2], tris[i + 3], tris[i + 4], tris[i + 5]];
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) [bx, by, cx, cy] = [cx, cy, bx, by];
    pos.push(ax + ox, ay + oy, z, bx + ox, by + oy, z, cx + ox, cy + oy, z);
  }
  const normals = new Float32Array(pos.length);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

const quad = (a: P2, b: P2, c: P2, d: P2): number[] => [...a, ...b, ...c, ...a, ...c, ...d];
const rect = (cx: number, cy: number, w: number, h: number) => quad([cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]);
const diamond = (r: number) => quad([0, -r], [r, 0], [0, r], [-r, 0]);

function disk(cx: number, cy: number, r: number, segments = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    out.push(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
  return out;
}

/** A pen stroke of width `w` along a polyline, rounded at the joints. */
function stroke(points: readonly P2[], w: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / len) * (w / 2);
    const ny = ((x1 - x0) / len) * (w / 2);
    out.push(...quad([x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]));
    if (i > 0) out.push(...disk(x0, y0, w / 2, 6));
  }
  return out;
}

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const TAU = Math.PI * 2;
/** Numerals as pen strokes in a 0.6 by 1 box, y up. */
const SIX: P2[][] = [arc(0.32, 0.5, 0.28, 0.5, 1.2, 3.4, 8), arc(0.3, 0.3, 0.29, 0.3, 0, TAU, 14)];
const DIGITS: Record<string, P2[][]> = {
  '0': [arc(0.3, 0.5, 0.3, 0.5, 0, TAU, 18)],
  '1': [[[0.1, 0.8], [0.34, 1], [0.34, 0]]],
  '2': [[...arc(0.3, 0.72, 0.28, 0.28, 2.8, -0.6, 8), [0, 0], [0.62, 0]]],
  '3': [arc(0.3, 0.75, 0.26, 0.25, 2.6, -Math.PI / 2, 8), arc(0.3, 0.26, 0.3, 0.26, Math.PI / 2, -2.6, 9)],
  '4': [[[0.46, 0], [0.46, 1], [0, 0.32], [0.64, 0.32]]],
  '5': [[[0.58, 1], [0.08, 1], [0.04, 0.55], ...arc(0.3, 0.33, 0.3, 0.33, 2.2, -2.5, 10)]],
  '6': SIX,
  '7': [[[0, 1], [0.62, 1], [0.2, 0]]],
  '8': [arc(0.3, 0.76, 0.24, 0.23, 0, TAU, 14), arc(0.3, 0.27, 0.29, 0.27, 0, TAU, 14)],
  '9': SIX.map((line) => line.map(([x, y]): P2 => [0.6 - x, 1 - y])),
};

/** A number in black, `h` tall, centred on (cx, cy). */
function numerals(text: string, cx: number, cy: number, h: number): number[] {
  const advance = 0.82 * h;
  const width = advance * text.length - 0.22 * h;
  const out: number[] = [];
  [...text].forEach((ch, i) => {
    const x0 = cx - width / 2 + i * advance;
    for (const line of DIGITS[ch] ?? []) out.push(...stroke(line.map(([x, y]): P2 => [x0 + x * h, cy - h / 2 + y * h]), 0.15 * h));
  });
  return out;
}

/** One chevron, `h` tall, pointing left (sx = 1) or right (sx = −1) as you face it. */
function chevron(cx: number, cy: number, h: number, sx: number): number[] {
  const t = h / 2;
  const P = (x: number, y: number): P2 => [cx + sx * x * t, cy + y * t];
  return [...quad(P(-0.55, 0), P(0.15, 1), P(0.55, 1), P(-0.15, 0)), ...quad(P(-0.55, 0), P(-0.15, 0), P(0.55, -1), P(0.15, -1))];
}

/** The curved arrow of a curve warning, bending left (sx = 1) or right (sx = −1), on the diamond's centre. */
function curveArrow(sx: number): number[] {
  const end = (80 * Math.PI) / 180;
  const line: P2[] = [[0.08, -0.32], [0.08, -0.04], ...arc(-0.12, -0.04, 0.2, 0.2, 0, end, 8).slice(1)];
  const [ex, ey] = line[line.length - 1];
  const tx = -Math.sin(end);
  const ty = Math.cos(end);
  const head = [ex + tx * 0.14, ey + ty * 0.14, ex - ty * 0.11 - tx * 0.01, ey + tx * 0.11 - ty * 0.01, ex + ty * 0.11 - tx * 0.01, ey - tx * 0.11 - ty * 0.01];
  const tris = [...stroke(line, 0.085), ...head];
  for (let i = 0; i < tris.length; i += 2) tris[i] *= sx;
  return tris;
}

const post = (x: number, top: number): [THREE.BufferGeometry, number] => [new THREE.CylinderGeometry(0.03, 0.03, top + POST_FOOT, 6).translate(x, (top - POST_FOOT) / 2, -0.04), STEEL];
/** A plate's grey body; its face is at z = 0. */
const plate = (w: number, h: number, cy: number, cx = 0): [THREE.BufferGeometry, number] => [new THREE.BoxGeometry(w, h, 0.02).translate(cx, cy, -0.01), GREY];

/** The advisory speed plate: black border, yellow, black numerals. */
function speedPlate(art: Art, value: number, cy: number): void {
  const w = 0.56;
  const h = 0.42;
  art.push(plate(w, h, cy), [flat(rect(0, 0, w, h), LAYER, 0, cy), BLACK], [flat(rect(0, 0, w - 0.05, h - 0.05), LAYER * 2, 0, cy), YELLOW], [flat(numerals(String(value), 0, 0, 0.27), LAYER * 3, 0, cy), BLACK]);
}

/** PW-67: a single chevron on a 0.6 by 0.75 plate, underside 1.1 m up (plate sizes unverified). */
function pw67(sx: number): Art {
  const cy = 1.1 + 0.375;
  return [post(0, cy + 0.3), plate(0.6, 0.75, cy), [flat(rect(0, 0, 0.6, 0.75), LAYER, 0, cy), YELLOW], [flat(chevron(0, 0, 0.62, sx), LAYER * 2, 0, cy), BLACK]];
}

/** PW-66: four chevrons on a 1.9 m board on two posts, with the advisory speed hung under it (layout unverified). */
function pw66(sx: number, value: number): Art {
  const cy = 1.57 + 0.3;
  const art: Art = [post(-0.6, cy + 0.2), post(0.6, cy + 0.2), plate(1.9, 0.6, cy), [flat(rect(0, 0, 1.9, 0.6), LAYER, 0, cy), YELLOW]];
  const marks: number[] = [];
  for (const x of [-0.71, -0.24, 0.24, 0.71]) marks.push(...chevron(x, 0, 0.5, sx));
  art.push([flat(marks, LAYER * 2, 0, cy), BLACK]);
  // Two straps from the board down to the plate.
  for (const x of [-0.18, 0.18]) art.push([new THREE.BoxGeometry(0.04, 0.12, 0.012).translate(x, 1.55, -0.026), GREY]);
  speedPlate(art, value, 1.1 + 0.21);
  return art;
}

/** Curve warning: a yellow diamond (0.75 m sides) with a black border and arrow, the advisory plate below it. */
function curveWarning(sx: number, value: number): Art {
  const cy = 2.2;
  const r = 0.53;
  const art: Art = [post(0, cy + 0.3), [new THREE.BoxGeometry(0.75, 0.75, 0.02).rotateZ(Math.PI / 4).translate(0, cy, -0.01), GREY]];
  art.push([flat(diamond(r), LAYER, 0, cy), BLACK], [flat(diamond(r - 0.045), LAYER * 2, 0, cy), YELLOW], [flat(curveArrow(sx), LAYER * 3, 0, cy), BLACK]);
  speedPlate(art, value, 1.2 + 0.21);
  return art;
}

const signPaint = (m: MaterialLibrary) => m.get('plain', { vertexColors: true, roughness: 0.55 });

/** Every kind this file registers (for the physics overlay and the tests). */
export const CURVE_SIGN_KINDS: string[] = [];
const sign = (kind: string, art: () => Art) => {
  CURVE_SIGN_KINDS.push(kind);
  registerProp(kind, (m) => ({ parts: [{ geometry: painted(art()), material: signPaint(m) }], castShadow: false }));
};

for (const turn of ['left', 'right'] as const) {
  const sx = turn === 'left' ? 1 : -1;
  sign(`chevron-pw67-${turn}`, () => pw67(sx));
  for (const value of ADVISORIES) {
    sign(`curve-warning-${turn}-${value}`, () => curveWarning(sx, value));
    if (value <= 35) sign(`chevron-pw66-${turn}-${value}`, () => pw66(sx, value));
  }
}
