import { hashInts } from '../../core/rng';
import type { Scatterer } from '../../core/types';
import { HOARDINGS } from '../props/extra';
import { SCATTERERS } from './registry';
import { DRESSING_OFF, edgesIn, Keep } from './util';

/**
 * Hoardings on the open highway: plywood on creosoted posts at the paddock edge, square to the seal and
 * facing the traffic, one every few hundred metres. What they say rotates through ../props/extra.ts's
 * HOARDINGS pool, and which one stands where is a pure function of the edge and the sample, so chunks agree.
 */
export const hoardings: Scatterer = (area, out) => {
  const world = out.world;
  const graph = world.graph;
  if (DRESSING_OFF) return;
  const keep = new Keep(world, area, 30);
  for (const e of edgesIn(graph, area)) {
    if (e.bridge || e.tunnel || e.footpaths || e.cls !== 'highway') continue;
    for (let i = 6; i < e.samples.length - 6; i++) {
      const h = hashInts(e.index, i, 1403);
      if (h % 67 !== 0) continue;
      const s = e.samples[i];
      const side = (h >>> 9) & 1 ? 1 : -1;
      const off = side * (e.width / 2 + 5.5 + ((h >>> 12) % 5) * 0.5);
      const x = s.x + s.tz * off;
      const z = s.z - s.tx * off;
      if (!keep.inArea(x, z) || keep.inLandmark(x, z, 6) || keep.nearPlace(x, z, 10)) continue;
      if (world.districtAt(x, z).type !== 'rural' || world.surfaceAt(x, z) !== 'grass' || world.waterDepthAt(x, z) > 0) continue;
      // Not where a side road or the next chunk's own highway run comes through.
      const near = graph.nearest(x, z, 16, (o) => o !== e);
      if (near && near.distance < near.edge.width / 2 + 3) continue;
      const yaw = Math.atan2(-s.tz * side, s.tx * side);
      out.instance(`hoarding-${(h >>> 16) % HOARDINGS.length}`, x, world.heightAt(x, z), z, yaw);
    }
  }
};

SCATTERERS.push(hoardings);
