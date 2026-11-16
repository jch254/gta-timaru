/** Turns the declarative `Spot`s in mission data into world positions, using only the WorldApi. */
import { FOOTPATH_OFFSET } from '../core/lanes';
import { clamp } from '../core/math';
import type { LandmarkPlacement, Place, RoadEdge, RoadGraph, RoadHit, RoadNode, WorldApi } from '../core/types';
import type { RoadName, Spot, SpotObject } from './types';

export interface Resolved {
  /** False when the spot could not be placed (unknown place, entity not there yet). */
  ok: boolean;
  x: number;
  z: number;
  heading: number;
  /** Set when the spot was snapped to a road. `s` is the distance from the edge's node a; `dir` the facing direction. */
  edge: RoadEdge | null;
  s: number;
  dir: 1 | -1;
}

export function newResolved(): Resolved {
  return { ok: false, x: 0, z: 0, heading: 0, edge: null, s: 0, dir: 1 };
}

export function copyResolved(from: Resolved, to: Resolved): Resolved {
  to.ok = from.ok;
  to.x = from.x;
  to.z = from.z;
  to.heading = from.heading;
  to.edge = from.edge;
  to.s = from.s;
  to.dir = from.dir;
  return to;
}

/** Fills `out` with the current position of a spawned entity; false if there is no such thing yet. */
export type EntityLookup = (name: string, out: Resolved) => boolean;

export type Route = { edge: RoadEdge; dir: 1 | -1 }[];

const EMPTY: SpotObject = {};
const MAX_SNAP = 60;
/** Parked against the kerb: half a car's width plus a hand's breadth, measured from the kerb to the car's centre. */
const KERB_INSET = 1.15;
const SCRATCH = [newResolved(), newResolved(), newResolved()];
const drivable = (e: RoadEdge) => e.drivable;

export function findPlace(world: WorldApi, id: string): Place | null {
  try {
    return world.place(id);
  } catch {
    return null;
  }
}

/** The landmark of a kind nearest a place (or the first one when no place is given / known). */
export function findLandmark(world: WorldApi, kind: string, near?: string): LandmarkPlacement | null {
  const anchor = near !== undefined ? findPlace(world, near) : null;
  let best: LandmarkPlacement | null = null;
  let bestD = Infinity;
  const list = world.landmarks;
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (l.kind !== kind) continue;
    if (!anchor) return l;
    const d = Math.hypot(l.x - anchor.x, l.z - anchor.z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * Marae are places of respect: nothing hostile is staged on one. Returns the marae whose cleared ground
 * (plus `margin`) contains the point, if any.
 */
export function maraeAt(world: WorldApi, x: number, z: number, margin = 0): LandmarkPlacement | null {
  const list = world.landmarks;
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (l.kind !== 'marae') continue;
    const r = l.clearRadius + margin;
    const dx = l.x - x;
    const dz = l.z - z;
    if (dx * dx + dz * dz < r * r) return l;
  }
  return null;
}

function nameMatches(name: string, want: RoadName): boolean {
  const n = name.toLowerCase();
  if (typeof want === 'string') return n.includes(want.toLowerCase());
  for (const w of want) if (n.includes(w.toLowerCase())) return true;
  return false;
}

function nearestRoad(graph: RoadGraph, x: number, z: number, road: RoadName | undefined): RoadHit | null {
  let hit: RoadHit | null = null;
  if (road !== undefined) hit = graph.nearest(x, z, MAX_SNAP, (e) => e.drivable && nameMatches(e.name, road));
  return hit ?? graph.nearest(x, z, MAX_SNAP, drivable);
}

const _walk: { edge: RoadEdge; s: number; dir: 1 | -1; left: number } = { edge: null as unknown as RoadEdge, s: 0, dir: 1, left: 0 };

/** Spots keep this far back from the ends of an edge, so nothing is parked or stood in an intersection. */
const JUNCTION_PAD = 12;
const padOf = (edge: RoadEdge) => Math.max(0, Math.min(JUNCTION_PAD, edge.length / 2 - 0.5));

/**
 * Travel `distance` metres along the road from (edge, s) in direction `dir`, carrying on through junctions.
 * Junction areas do not count towards the distance (and are never stopped in), so spots a few metres apart
 * stay a few metres apart either side of a corner. At a junction the walk takes the road that continues
 * straightest, or, given an aim point, the one that heads for it (`away`: the one that heads away from it).
 * Stops at a dead end; `left` is the distance not covered. The result is written to the shared `_walk` record.
 */
function walkAlong(graph: RoadGraph, edge: RoadEdge, s: number, dir: 1 | -1, distance: number, aim: Resolved | null = null, away = false) {
  let pad = padOf(edge);
  s = clamp(s, pad, edge.length - pad);
  let remaining = distance;
  for (let hops = 0; hops < 8 && remaining > 0; hops++) {
    const end = dir === 1 ? edge.length - pad : pad;
    const room = Math.abs(end - s);
    if (remaining <= room) {
      s += dir * remaining;
      remaining = 0;
      break;
    }
    remaining -= room;
    s = end;
    const node = graph.endNode(edge, dir);
    const tip = graph.pointAt(edge, dir === 1 ? edge.length : 0);
    let wantX = tip.tx * dir;
    let wantZ = tip.tz * dir;
    if (aim) {
      const dx = aim.x - node.x;
      const dz = aim.z - node.z;
      const len = Math.hypot(dx, dz);
      if (len > 1) {
        const k = away ? -1 : 1;
        wantX = wantX * 0.25 + (dx / len) * k;
        wantZ = wantZ * 0.25 + (dz / len) * k;
      }
    }
    let next: RoadEdge | null = null;
    let nextDir: 1 | -1 = 1;
    let best = -Infinity;
    for (const index of node.edges) {
      const candidate = graph.edges[index];
      if (!candidate || candidate === edge || !candidate.drivable) continue;
      const cDir: 1 | -1 = candidate.a === node.index ? 1 : -1;
      const first = graph.pointAt(candidate, cDir === 1 ? 0 : candidate.length);
      const score = first.tx * cDir * wantX + first.tz * cDir * wantZ;
      if (score > best) {
        best = score;
        next = candidate;
        nextDir = cDir;
      }
    }
    if (!next) break;
    edge = next;
    dir = nextDir;
    pad = padOf(edge);
    s = dir === 1 ? pad : edge.length - pad;
  }
  _walk.edge = edge;
  _walk.s = s;
  _walk.dir = dir;
  _walk.left = remaining;
}

function routeLength(graph: RoadGraph, from: number, to: number): number {
  if (from === to) return 0;
  const route = graph.route(from, to);
  if (!route) return Infinity;
  let d = 0;
  for (const leg of route) d += leg.edge.length;
  return d;
}

/**
 * Which way along an edge leads to a point: by the shorter drive when the graph can route it, otherwise as
 * the crow flies.
 */
function directionTo(graph: RoadGraph, hit: RoadHit, x: number, z: number): 1 | -1 {
  const here = graph.pointAt(hit.edge, hit.s);
  const crow: 1 | -1 = here.tx * (x - here.x) + here.tz * (z - here.z) >= 0 ? 1 : -1;
  try {
    const target = graph.nearestNode(x, z);
    const viaA = hit.s + routeLength(graph, hit.edge.a, target.index);
    const viaB = hit.edge.length - hit.s + routeLength(graph, hit.edge.b, target.index);
    if (viaA === viaB || (!Number.isFinite(viaA) && !Number.isFinite(viaB))) return crow;
    return viaB < viaA ? 1 : -1;
  } catch {
    return crow;
  }
}

/**
 * Travel `distance` metres along the road from (edge, s) in direction `dir`, through junctions if need be.
 * Writes where that ends up into `out` (`out.dir` is the direction of travel there) and returns the distance
 * that could not be covered (a dead end).
 */
export function walkRoad(graph: RoadGraph, edge: RoadEdge, s: number, dir: 1 | -1, distance: number, out: Resolved): number {
  walkAlong(graph, edge, s, dir, distance);
  out.edge = _walk.edge;
  out.s = _walk.s;
  out.dir = _walk.dir;
  return _walk.left;
}

const junctionCache = new WeakMap<RoadGraph, Map<string, RoadNode | null>>();

/**
 * The node where a road matching `a` meets one matching `b`. With several candidates (dual carriageways,
 * a road that crosses twice) the one nearest the hint wins. If the two roads never share a node, the closest
 * pair of their nodes within 90 m counts.
 */
export function findJunction(graph: RoadGraph, a: RoadName, b: RoadName, hintX = NaN, hintZ = NaN): RoadNode | null {
  const key = `${String(a)}|${String(b)}`;
  let cache = junctionCache.get(graph);
  if (!cache) junctionCache.set(graph, (cache = new Map()));
  const known = cache.get(key);
  if (known !== undefined) return known;

  const hinted = Number.isFinite(hintX) && Number.isFinite(hintZ);
  let best: RoadNode | null = null;
  let bestD = Infinity;
  const onA: RoadNode[] = [];
  const onB: RoadNode[] = [];
  for (const node of graph.nodes) {
    let hasA = false;
    let hasB = false;
    for (const index of node.edges) {
      const edge = graph.edges[index];
      if (!edge || !edge.drivable) continue;
      if (nameMatches(edge.name, a)) hasA = true;
      if (nameMatches(edge.name, b)) hasB = true;
    }
    if (hasA) onA.push(node);
    if (hasB) onB.push(node);
    if (hasA && hasB) {
      const d = hinted ? Math.hypot(node.x - hintX, node.z - hintZ) : 0;
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
  }
  if (!best) {
    let gap = 90;
    for (const p of onA) {
      for (const q of onB) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < gap) {
          gap = d;
          best = p;
        }
      }
    }
  }
  cache.set(key, best);
  return best;
}

/**
 * Resolve a spot. Never throws: `out.ok` is false when it cannot be placed. Allocation-free for plain place
 * ids and entity spots, so it is safe to call every frame for a moving target.
 */
export function resolveSpot(world: WorldApi, spot: Spot, out: Resolved, lookup?: EntityLookup | null, depth = 0): Resolved {
  const o = typeof spot === 'string' ? EMPTY : spot;
  const placeId = typeof spot === 'string' ? spot : spot.place;
  out.ok = false;
  out.x = 0;
  out.z = 0;
  out.heading = 0;
  out.edge = null;
  out.s = 0;
  out.dir = 1;

  // 1. Base point: entity, junction, landmark, place or absolute.
  let based = false;
  let haveHeading = false;
  if (o.entity !== undefined && lookup && lookup(o.entity, out)) {
    based = true;
    haveHeading = true;
  }
  if (!based) {
    let px = 0;
    let pz = 0;
    let ph = 0;
    let havePoint = false;
    if (o.landmark !== undefined) {
      const landmark = findLandmark(world, o.landmark, o.near);
      if (landmark) {
        const reach = landmark.clearRadius * (o.edge ?? 0);
        px = landmark.x + Math.sin(landmark.heading) * reach;
        pz = landmark.z + Math.cos(landmark.heading) * reach;
        ph = landmark.heading;
        havePoint = true;
        haveHeading = true;
      }
    } else if (placeId !== undefined) {
      const place = findPlace(world, placeId);
      if (place) {
        px = place.x;
        pz = place.z;
        ph = place.heading;
        havePoint = true;
        haveHeading = true;
      }
    } else if (o.x !== undefined && o.z !== undefined) {
      px = o.x;
      pz = o.z;
      havePoint = true;
    }
    if (havePoint) {
      px += o.dx ?? 0;
      pz += o.dz ?? 0;
    }
    if (o.junction) {
      const node = findJunction(world.graph, o.junction[0], o.junction[1], havePoint ? px : NaN, havePoint ? pz : NaN);
      if (node) {
        out.x = node.x;
        out.z = node.z;
        haveHeading = false;
        based = true;
      }
    }
    if (!based) {
      if (!havePoint) return out;
      out.x = px;
      out.z = pz;
      out.heading = ph;
    }
  }

  // 2. Snap to the road network.
  let forward = o.forward ?? 0;
  let left = o.left ?? 0;
  if (o.snap === 'node') {
    const node = world.graph.nearestNode(out.x, out.z);
    if (node) {
      out.x = node.x;
      out.z = node.z;
    }
  } else if (o.snap) {
    const hit = nearestRoad(world.graph, out.x, out.z, o.road);
    if (hit) {
      const here = world.graph.pointAt(hit.edge, hit.s);
      let dir: 1 | -1 = 1;
      let aim: Resolved | null = null;
      if (o.toward !== undefined && depth < SCRATCH.length) {
        const t = resolveSpot(world, o.toward, SCRATCH[depth], lookup, depth + 1);
        if (t.ok) {
          aim = t;
          dir = directionTo(world.graph, hit, t.x, t.z);
        }
      } else if (o.snap === 'lane') {
        // Parked "outside the door": travel in the direction whose kerb-side lane is on the base point's side
        // of the road (traffic keeps left, so that is the side to the left of travel).
        dir = hit.offset >= 0 ? 1 : -1;
      } else if (haveHeading) {
        dir = here.tx * Math.sin(out.heading) + here.tz * Math.cos(out.heading) >= 0 ? 1 : -1;
      }
      // Which side of the road the base point was on, relative to the facing direction.
      const nearSide = hit.offset * dir >= 0 ? 1 : -1;
      let edge = hit.edge;
      let s = hit.s;
      const along = o.along ?? 0;
      if (along !== 0) {
        // Negative = behind: walk the other way, and keep facing the original way.
        const back = along < 0;
        const travel = (back ? -dir : dir) as 1 | -1;
        walkAlong(world.graph, hit.edge, hit.s, travel, Math.abs(along), aim, back);
        let flip = back;
        if (_walk.left > 0) {
          // Dead end: the same distance the other way from where we started will do.
          walkAlong(world.graph, hit.edge, hit.s, -travel as 1 | -1, Math.abs(along), aim, !back);
          flip = !back;
        }
        if (_walk.left > 0) {
          // A stub of road with no way out either end: stay put and step off it in a straight line.
          forward += along;
        } else {
          edge = _walk.edge;
          s = _walk.s;
          dir = (flip ? -_walk.dir : _walk.dir) as 1 | -1;
        }
      }
      // Never in an intersection.
      const pad = padOf(edge);
      s = clamp(s, pad, edge.length - pad);
      if (edge.oneway && o.snap === 'lane') dir = 1;
      if (o.snap === 'lane') {
        const p = world.graph.lanePoint(edge, s, dir, 0);
        out.x = p.x;
        out.z = p.z;
        out.heading = p.heading;
        // Pull in towards the kerb (the left, in a country that keeps left).
        if (o.kerb) {
          const laneWidth = edge.width / ((edge.oneway ? 1 : 2) * Math.max(1, edge.lanes));
          left += Math.max(0, laneWidth / 2 - KERB_INSET);
        }
        left += o.out ?? 0;
      } else {
        const p = world.graph.pointAt(edge, s);
        out.x = p.x;
        out.z = p.z;
        out.heading = Math.atan2(p.tx * dir, p.tz * dir);
        if (o.snap === 'verge') left += (o.side ?? nearSide) * (edge.width / 2 + (o.out ?? FOOTPATH_OFFSET));
      }
      out.edge = edge;
      out.s = s;
      out.dir = dir;
    } else {
      // No road within reach: keep the spread the definition asked for around the base point.
      forward += o.along ?? 0;
      if (o.snap === 'verge') left += (o.side ?? 1) * 3;
    }
  }

  // 3. Offsets in the resolved frame: forward = (sin h, cos h), left = (cos h, -sin h).
  if (forward !== 0 || left !== 0) {
    const sin = Math.sin(out.heading);
    const cos = Math.cos(out.heading);
    out.x += sin * forward + cos * left;
    out.z += cos * forward - sin * left;
  }
  out.heading += o.turn ?? 0;
  out.ok = true;
  return out;
}

/** Does this spot follow something that moves (so it must be resolved again every frame)? */
export function isMovingSpot(spot: Spot): boolean {
  return typeof spot !== 'string' && spot.entity !== undefined;
}

/** Shortest drivable route between the nodes nearest two points; null if there is none (or the graph is a stub). */
export function routeBetween(world: WorldApi, ax: number, az: number, bx: number, bz: number): Route | null {
  try {
    const a = world.graph.nearestNode(ax, az);
    const b = world.graph.nearestNode(bx, bz);
    if (!a || !b || a === b) return null;
    const route = world.graph.route(a.index, b.index);
    return route && route.length ? route : null;
  } catch {
    return null;
  }
}

/**
 * A route for a vehicle at (x, z) facing `heading`: straight on along the road it is on, then the shortest way
 * to the target. Starting with the road ahead means the first thing the driver does is drive, not turn round.
 */
export function routeAhead(world: WorldApi, x: number, z: number, heading: number, tx: number, tz: number): Route | null {
  const graph = world.graph;
  try {
    const hit = graph.nearest(x, z, 30, drivable);
    if (hit) {
      const here = graph.pointAt(hit.edge, hit.s);
      const dir: 1 | -1 = hit.edge.oneway || here.tx * Math.sin(heading) + here.tz * Math.cos(heading) >= 0 ? 1 : -1;
      const ahead = graph.endNode(hit.edge, dir);
      const target = graph.nearestNode(tx, tz);
      const rest = ahead.index === target.index ? [] : graph.route(ahead.index, target.index);
      if (rest) {
        const route: Route = [{ edge: hit.edge, dir }];
        for (const leg of rest) route.push(leg);
        return route;
      }
    }
  } catch {
    // Stub graph: fall through to the plain node-to-node route.
  }
  return routeBetween(world, x, z, tx, tz);
}

/** Driving distance between two points: along the road graph when it can be routed, otherwise a padded straight line. */
export function roadDistance(world: WorldApi, ax: number, az: number, bx: number, bz: number): number {
  const straight = Math.hypot(bx - ax, bz - az);
  const route = routeBetween(world, ax, az, bx, bz);
  if (!route) return straight * 1.3;
  let d = 0;
  for (const leg of route) d += leg.edge.length;
  return Math.max(d, straight);
}
