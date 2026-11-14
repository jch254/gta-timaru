import type { RoadEdge, RoadGraph } from '../core/types';

/**
 * Walking the road graph: "where is the road 200 m ahead of here?". Used to place patrol cars and
 * roadblocks ahead of the player and to send idle cars wandering.
 * Pure logic over the RoadGraph interface (no Three, no Rapier) so it can be unit-tested.
 */

export interface TurnOption {
  edge: RoadEdge;
  /** Direction of travel along `edge` when leaving the junction. */
  dir: 1 | -1;
  /** Cosine of the turn: 1 = straight on, 0 = right angle, −1 = back the way we came. */
  straightness: number;
}

/** Chooses one of the ways out of a junction; returns an index into `options`. */
export type TurnPicker = (options: readonly TurnOption[]) => number;

export interface WalkPoint {
  edge: RoadEdge;
  /** Distance along `edge` from its node a. */
  s: number;
  /** Direction of travel on `edge` at that point. */
  dir: 1 | -1;
}

/** Take the straightest way through every junction. */
export const straightest: TurnPicker = (options) => {
  let best = 0;
  for (let i = 1; i < options.length; i++) if (options[i].straightness > options[best].straightness) best = i;
  return best;
};

/**
 * The drivable ways out of the junction at the end of `edge` (travelling `dir`), never back along `edge`
 * itself and never the wrong way up a one-way street. Fills and returns `out`.
 */
export function exitsFrom(graph: RoadGraph, edge: RoadEdge, dir: 1 | -1, out: TurnOption[] = []): TurnOption[] {
  out.length = 0;
  const node = graph.endNode(edge, dir);
  const last = dir === 1 ? edge.samples[edge.samples.length - 1] : edge.samples[0];
  const inX = last.tx * dir;
  const inZ = last.tz * dir;
  for (const index of node.edges) {
    const next = graph.edges[index];
    if (!next || next === edge || !next.drivable) continue;
    const nextDir: 1 | -1 = next.a === node.index ? 1 : -1;
    if (next.oneway && nextDir === -1) continue;
    const first = nextDir === 1 ? next.samples[0] : next.samples[next.samples.length - 1];
    out.push({ edge: next, dir: nextDir, straightness: first.tx * nextDir * inX + first.tz * nextDir * inZ });
  }
  return out;
}

const scratch: TurnOption[] = [];

/**
 * Follow the road for `distance` metres from (`edge`, `s`) travelling `dir`, choosing a way through each
 * junction with `pick`. Returns where that ends up, or null at a dead end.
 */
export function walkAhead(graph: RoadGraph, edge: RoadEdge, s: number, dir: 1 | -1, distance: number, pick: TurnPicker = straightest): WalkPoint | null {
  let e = edge;
  let d = dir;
  let at = Math.min(e.length, Math.max(0, s));
  let remaining = Math.max(0, distance);
  // Bounded: a walk never needs more junctions than this, and a degenerate graph cannot spin forever.
  for (let hops = 0; hops < 96; hops++) {
    const room = d === 1 ? e.length - at : at;
    if (remaining <= room) return { edge: e, s: at + d * remaining, dir: d };
    remaining -= room;
    const options = exitsFrom(graph, e, d, scratch);
    if (!options.length) return null;
    const choice = options[pick(options)] ?? options[0];
    e = choice.edge;
    d = choice.dir;
    at = d === 1 ? 0 : e.length;
  }
  return null;
}
