import { describe, expect, it } from 'vitest';
import type { GameContext, RoadEdge, RoadNode } from '../core/types';
import { Waypoint } from './waypoint';

/**
 * A toy road: three nodes in a line along x, two 100 m edges between them, samples every 25 m.
 *
 *   n0 (0,0) ──e0── n1 (100,0) ──e1── n2 (200,0)
 */
function makeCtx(routable = true) {
  const nodes: RoadNode[] = [
    { index: 0, x: 0, y: 0, z: 0, edges: [0] },
    { index: 1, x: 100, y: 0, z: 0, edges: [0, 1] },
    { index: 2, x: 200, y: 0, z: 0, edges: [1] },
  ];
  const edge = (index: number, a: number, b: number): RoadEdge =>
    ({
      index,
      a,
      b,
      length: 100,
      samples: [0, 25, 50, 75, 100].map((s) => ({ x: nodes[a].x + s, y: 0, z: 0, tx: 1, tz: 0, s })),
    }) as RoadEdge;
  const edges = [edge(0, 0, 1), edge(1, 1, 2)];
  const player = { position: { x: 1, y: 0, z: 2 } };
  const graph = {
    nodes,
    edges,
    nearestNode(x: number) {
      let best = nodes[0];
      for (const n of nodes) if (Math.abs(n.x - x) < Math.abs(best.x - x)) best = n;
      return best;
    },
    route(from: number, to: number) {
      if (!routable) return null;
      if (from === to) return [];
      const dir = to > from ? 1 : -1;
      const legs = [];
      for (let n = from; n !== to; n += dir) legs.push({ edge: edges[Math.min(n, n + dir)], dir });
      return legs;
    },
  };
  return { ctx: { player, world: { graph } } as unknown as GameContext, player };
}

describe('Waypoint', () => {
  it('plans a pen line from the player along the roads to the X', () => {
    const { ctx } = makeCtx();
    const wp = new Waypoint();
    wp.set(195, 5);
    wp.update(ctx, 0.016);
    const r = wp.route;
    // Starts where the player stands, ends on the X, and runs through the road between.
    expect(r.length).toBeGreaterThanOrEqual(8);
    expect([r[0], r[1]]).toEqual([1, 2]);
    expect([r[r.length - 2], r[r.length - 1]]).toEqual([195, 5]);
    expect(r).toContain(100); // passed through the middle node
    expect(wp.distance).toBeGreaterThan(190);
    expect(wp.version).toBeGreaterThan(0);
  });

  it('walks the samples backwards on a leg travelled b to a', () => {
    const { ctx, player } = makeCtx();
    player.position.x = 200; // player at the far node, X back at the start
    const wp = new Waypoint();
    wp.set(5, 0);
    wp.update(ctx, 0.016);
    const xs = [];
    for (let i = 0; i < wp.route.length; i += 2) xs.push(wp.route[i]);
    // Monotone along the road; the last jog (road out to the X itself) goes wherever the X is.
    for (let i = 1; i < xs.length - 1; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-9);
  });

  it('keeps the X but draws no line when no road joins the two', () => {
    const { ctx } = makeCtx(false);
    const wp = new Waypoint();
    wp.set(195, 5);
    wp.update(ctx, 0.016);
    expect(wp.target).not.toBeNull();
    expect(wp.route).toEqual([]);
    expect(wp.distance).toBe(0);
  });

  it('re-plans only after moving, and no sooner than the throttle allows', () => {
    const { ctx, player } = makeCtx();
    const wp = new Waypoint();
    wp.set(195, 5);
    wp.update(ctx, 0.016);
    const v = wp.version;
    player.position.x = 60; // well past the replan distance…
    wp.update(ctx, 0.5); // …but inside the two-second window since the last plan
    expect(wp.version).toBe(v);
    wp.update(ctx, 2); // window elapsed: the move counts
    expect(wp.version).toBe(v + 1);
    expect(wp.route[0]).toBe(60);
    wp.update(ctx, 50); // standing still: no amount of time re-plans on its own
    expect(wp.version).toBe(v + 1);
  });

  it('wipes itself on arrival and says so once', () => {
    const { ctx, player } = makeCtx();
    let arrived = 0;
    const wp = new Waypoint(() => arrived++);
    wp.set(195, 5);
    wp.update(ctx, 0.016);
    player.position.x = 190;
    player.position.z = 4;
    wp.update(ctx, 0.016);
    expect(wp.target).toBeNull();
    expect(wp.route).toEqual([]);
    expect(arrived).toBe(1);
    wp.update(ctx, 0.016);
    expect(arrived).toBe(1);
  });

  it('toggles: a second mark on the X rubs it out, elsewhere moves it', () => {
    const { ctx } = makeCtx();
    const wp = new Waypoint();
    wp.toggle(100, 0, 20);
    expect(wp.target).toEqual({ x: 100, z: 0 });
    wp.toggle(110, 5, 20); // within the rub-out radius
    expect(wp.target).toBeNull();
    wp.toggle(110, 5, 20);
    wp.toggle(180, 0, 20); // outside it: the X moves
    expect(wp.target).toEqual({ x: 180, z: 0 });
    wp.update(ctx, 0.016);
    expect(wp.route.length).toBeGreaterThan(0);
  });
});
