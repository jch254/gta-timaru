import type { GameContext } from '../core/types';

/** Within this many metres of the X, the mark has served its purpose and wipes itself. */
const ARRIVE = 30;
/** Replan when the player has moved this far from where the last route was planned. */
const REPLAN_MOVE = 24;
/** …and no more often than this, in seconds. */
const REPLAN_SECONDS = 2;
/** Route points are thinned to roughly this spacing in metres (edge samples come every ~4 m). */
const STEP = 12;

/**
 * The player's own X on the map. Set from the island map, drawn on both maps, and guided to with a route
 * line along the roads that re-plans as the player moves; it wipes itself on arrival or on a second mark
 * in the same spot. Like a chinagraph cross on the perspex, it is not saved: it lasts the session.
 */
export class Waypoint {
  /** Where the X is, or null for none. */
  target: { x: number; z: number } | null = null;
  /** The pen line: flat [x0, z0, x1, z1, …] from the player along the roads to the X. Empty when unroutable. */
  route: number[] = [];
  /** Length of the pen line in metres (0 when there is no line). */
  distance = 0;
  /** Bumped whenever the target or the line changes, so the maps can cache their strokes against it. */
  version = 0;

  private clock = Infinity;
  private fromX = 0;
  private fromZ = 0;

  constructor(private onArrive: (() => void) | null = null) {}

  set(x: number, z: number) {
    this.target = { x, z };
    this.route = [];
    this.distance = 0;
    this.clock = Infinity; // plan on the next update
    this.version++;
  }

  clear() {
    if (!this.target) return;
    this.target = null;
    this.route = [];
    this.distance = 0;
    this.version++;
  }

  /** Set the X — or, within `clearRadius` metres of the one already down, rub it out. */
  toggle(x: number, z: number, clearRadius: number) {
    const t = this.target;
    if (t && Math.hypot(t.x - x, t.z - z) <= clearRadius) this.clear();
    else this.set(x, z);
  }

  /** Call once a frame (paused or live: panning the map wants a fresh line too). */
  update(ctx: GameContext, dt: number) {
    const t = this.target;
    if (!t) return;
    const p = ctx.player.position;
    if (Math.hypot(t.x - p.x, t.z - p.z) <= ARRIVE) {
      this.clear();
      this.onArrive?.();
      return;
    }
    this.clock += dt;
    if (this.clock < REPLAN_SECONDS) return;
    const moved = Math.hypot(p.x - this.fromX, p.z - this.fromZ);
    if (moved < REPLAN_MOVE && this.route.length > 0) return;
    this.clock = 0;
    this.fromX = p.x;
    this.fromZ = p.z;
    this.plan(ctx);
  }

  /** One shortest-path plan: player's nearest node to the X's nearest node, thinned to a pen line. */
  private plan(ctx: GameContext) {
    const t = this.target!;
    const g = ctx.world.graph;
    const p = ctx.player.position;
    const pts: number[] = [p.x, p.z];
    const from = g.nearestNode(p.x, p.z);
    const to = g.nearestNode(t.x, t.z);
    const legs = from.index === to.index ? [] : g.route(from.index, to.index);
    if (legs === null) {
      // No road joins the two (an X in the sea, say): no line, just the mark.
      this.route = [];
      this.distance = 0;
      this.version++;
      return;
    }
    if (legs.length > 0) {
      for (const leg of legs) {
        const samples = leg.edge.samples;
        const n = samples.length;
        const every = Math.max(1, Math.round(STEP / Math.max(1, leg.edge.length / Math.max(1, n - 1))));
        if (leg.dir === 1) {
          for (let i = 0; i < n; i += every) pts.push(samples[i].x, samples[i].z);
          pts.push(samples[n - 1].x, samples[n - 1].z);
        } else {
          for (let i = n - 1; i >= 0; i -= every) pts.push(samples[i].x, samples[i].z);
          pts.push(samples[0].x, samples[0].z);
        }
      }
    } else {
      pts.push(from.x, from.z);
    }
    pts.push(t.x, t.z);
    let d = 0;
    for (let i = 2; i < pts.length; i += 2) d += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    this.route = pts;
    this.distance = d;
    this.version++;
  }
}
