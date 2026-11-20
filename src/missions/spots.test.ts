import { describe, expect, it, vi } from 'vitest';
import { compileMap } from '../world/map';
import { buildMap } from '../world/mapdata';
import { MapBuilder } from '../world/mapsource';
import { findJunction } from './spots';

describe('findJunction', () => {
  it.each(['a', 'b'] as const)('resolves both tunnel portals starting at end %s without rescanning', (start) => {
    const { graph } = compileMap(buildMap());
    const tunnel = graph.edges.find((edge) => edge.name === 'Lyttelton Road Tunnel')!;
    const first = graph.nodes[tunnel[start]];
    const other = graph.nodes[tunnel[start === 'a' ? 'b' : 'a']];
    const defaultEnd = first.index < other.index ? first : other;
    const lookup = (x?: number, z?: number) => findJunction(graph, 'Tunnel Road', tunnel.name, x, z);

    expect(lookup(first.x, first.z)).toBe(first);
    const scan = vi.spyOn(graph.nodes, Symbol.iterator);
    try {
      expect(lookup(other.x, other.z)).toBe(other);
      expect(lookup()).toBe(defaultEnd);
      expect(lookup(other.x, NaN)).toBe(defaultEnd);
      expect(lookup(first.x + 1, first.z)).toBe(first);
      expect(scan).not.toHaveBeenCalled();
    } finally {
      scan.mockRestore();
    }
  });

  it('falls back to the first road’s closest node regardless of hint, only for gaps under 90 m', () => {
    const b = new MapBuilder();
    b.road('First', 'street', [[0, 0], [200, 0]]);
    b.road('Second', 'street', [[0, 20], [200, 10]]);
    b.road('Third', 'street', [[0, -90], [200, -90]]);
    const { graph } = compileMap(b.source);

    expect(findJunction(graph, 'First', 'Second', 0, 0)).toMatchObject({ x: 200, z: 0 });
    expect(findJunction(graph, 'Second', 'First', 0, 0)).toBe(graph.nearestNode(200, 10));
    expect(findJunction(graph, 'First', 'Third')).toBeNull();
  });
});
