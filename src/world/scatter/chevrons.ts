import type { RoadEdge, Scatterer } from '../../core/types';
import { SCATTERERS } from './registry';
import { DRESSING_OFF, edgesIn, Keep } from './util';

/**
 * Curve chevron boards: yellow boards with a black chevron, in a row on the outside of a sharp bend on the open
 * road (no kerbs), pointing the way the road goes. One row serves both directions: each board reads from both
 * faces, and a bend that turns right one way turns left the other with the same outside.
 *
 * A bend is a run of the centreline tighter than a car can take at the limit with a comfortable 3 m/s² of
 * lateral grip (radius under v² / 3, and never above 45 m on slow roads), turning at least BEND_TURN in all.
 * Where the boards go is a pure function of the edge, so neighbouring chunks agree.
 */

/** Centreline samples (about 4 m apart) either side of a point when measuring how sharply the road turns there. */
const WINDOW = 3;
/** Lateral acceleration (m/s²) a bend may ask of a car at the limit before it is signed. */
const COMFORT = 3;
const MIN_RADIUS = 45;
/** Total turn (radians) for a run of tight samples to count as a bend, not a kink. */
const BEND_TURN = 0.3;
/** Roads slower than this (m/s) are not signed (car parks, the Bay's crawl along the front). */
const MIN_LIMIT = 13.5;
/** Samples between boards (about 13 m), and how many boards at least. */
const GAP = 3;
const MIN_BOARDS = 3;
/** From the centreline, past the shoulder and clear of the edge marker posts. */
const SETBACK = 1.9;
/**
 * No boards this close to a named place: missions stage their roadblocks, checkpoints and crews on the verges
 * round them (up to 45 m along the road from the Sign of the Kiwi, for one).
 */
const PLACE_CLEAR = 60;

export interface ChevronBoard {
  /** Sample index the board stands beside. */
  i: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const headingOf = (e: RoadEdge, i: number) => Math.atan2(e.samples[i].tx, e.samples[i].tz);

const cache = new WeakMap<RoadEdge, ChevronBoard[]>();

/** Where the chevron boards along an edge stand (before anything nearby rules a board out). */
export function chevronBoards(e: RoadEdge): ChevronBoard[] {
  let boards = cache.get(e);
  if (boards) return boards;
  boards = [];
  cache.set(e, boards);
  if (e.footpaths || e.bridge || e.tunnel || e.cls === 'pedestrian' || e.speedLimit < MIN_LIMIT) return boards;
  const s = e.samples;
  const n = s.length;
  const limit = Math.max(MIN_RADIUS, (e.speedLimit * e.speedLimit) / COMFORT);
  // Runs of tight samples turning the same way.
  let start = -1;
  let sign = 0;
  const finish = (end: number) => {
    if (start < 0) return;
    const first = start;
    start = -1;
    let turn = 0;
    for (let i = first; i < end; i++) turn += wrap(headingOf(e, i + 1) - headingOf(e, i));
    if (Math.abs(turn) < BEND_TURN) return;
    // Left bend (heading increasing) has its outside on the right of a → b, and the chevrons point left.
    const left = turn > 0;
    const side = left ? -1 : 1;
    // A board before the bend and one after, so the row starts where the driver needs warning.
    const from = Math.max(1, first - GAP);
    const to = Math.min(n - 2, end + GAP);
    const count = Math.max(MIN_BOARDS, Math.floor((to - from) / GAP) + 1);
    const step = (to - from) / Math.max(1, count - 1);
    for (let k = 0; k < count; k++) {
      const i = Math.round(from + k * step);
      const p = s[i];
      const off = side * (e.width / 2 + SETBACK);
      boards!.push({
        i,
        x: p.x + p.tz * off,
        y: p.y - 0.05,
        z: p.z - p.tx * off,
        // The board's +z faces traffic heading a → b on a right-hander, or b → a on a left-hander; its chevron
        // (local +x) then points into the bend for both.
        yaw: left ? Math.atan2(p.tx, p.tz) : Math.atan2(-p.tx, -p.tz),
      });
    }
  };
  for (let i = WINDOW; i < n - WINDOW; i++) {
    const d = wrap(headingOf(e, i + WINDOW) - headingOf(e, i - WINDOW));
    const radius = (s[i + WINDOW].s - s[i - WINDOW].s) / Math.max(1e-6, Math.abs(d));
    if (radius < limit) {
      if (start >= 0 && Math.sign(d) !== sign) finish(i);
      if (start < 0) start = i;
      sign = Math.sign(d);
    } else finish(i);
  }
  finish(n - WINDOW);
  return boards;
}

export const chevrons: Scatterer = (area, out) => {
  if (DRESSING_OFF) return;
  const world = out.world;
  const graph = world.graph;
  const keep = new Keep(world, area, PLACE_CLEAR);
  for (const e of edgesIn(graph, area)) {
    for (const b of chevronBoards(e)) {
      if (!keep.inArea(b.x, b.z) || keep.inLandmark(b.x, b.z, 2) || keep.nearPlace(b.x, b.z, PLACE_CLEAR)) continue;
      // Not across a side road or a gateway coming in at the bend, and not in a river.
      const other = graph.nearest(b.x, b.z, 20, (o) => o !== e);
      if (other && other.distance < other.edge.width / 2 + 2.5) continue;
      if (world.waterDepthAt(b.x, b.z) > 0) continue;
      out.instance('chevron-board', b.x, b.y, b.z, b.yaw);
    }
  }
};

SCATTERERS.push(chevrons);
