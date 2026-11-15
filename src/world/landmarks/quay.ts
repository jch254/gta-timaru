import type { ChunkBuilder, LandmarkPlacement } from '../../core/types';
import type { CompiledMap } from '../map';
import { quaySegments } from '../roadmesh';

const CHUNK = 256;
/** As the road builder's own quays (`buildQuays` in ../roadmesh.ts): width of the deck strip, depth of the wall's foot. */
const DECK = 7.6;
const FOOT = -3.6;

/**
 * The quay wall along a port landmark's own frontage. The road builder walls every edge of the built land
 * except within a port landmark's clear radius (plus 6 m), which it leaves to the landmark; this fills that
 * stretch in with the same wall on the same line (the terrain's quay contour): a deck strip, a coping, the
 * wall face and timber fender piles, with something to stand on and a kerb to stop a car rolling in.
 * `covered` says where the landmark's own wharf already stands over the edge.
 *
 * Does nothing where the world has no terrain model to ask (the landmark tests' stand-in worlds).
 */
export function quayFrontage(p: LandmarkPlacement, out: ChunkBuilder, covered: (x: number, z: number) => boolean): void {
  const terrain = (out.world as unknown as { terrain?: CompiledMap['terrain'] }).terrain;
  if (!terrain || typeof (terrain as { quay?: unknown }).quay !== 'function') return;
  const map = { terrain, landmarks: [] } as unknown as CompiledMap;
  const reach = p.clearRadius + 6;
  const m = out.materials;
  const deck = m.get('concrete', { color: 0xa9a59a });
  const coping = m.get('concrete', { color: 0x7c7a72 });
  const pile = m.get('timber', { color: 0x3d342c });
  for (let cx = Math.floor((p.x - reach) / CHUNK); cx <= Math.floor((p.x + reach) / CHUNK); cx++) {
    for (let cz = Math.floor((p.z - reach) / CHUNK); cz <= Math.floor((p.z + reach) / CHUNK); cz++) {
      for (const q of quaySegments(cx, cz, map)) {
        if (Math.hypot(p.x - (q.ax + q.bx) / 2, p.z - (q.az + q.bz) / 2) >= reach || covered((q.ax + q.bx) / 2, (q.az + q.bz) / 2)) continue;
        // The wall stands a little seaward of the contour, clear of the top of the batter.
        const ax = q.ax - q.nx * 0.8;
        const az = q.az - q.nz * 0.8;
        const bx = q.bx - q.nx * 0.8;
        const bz = q.bz - q.nz * 0.8;
        const len = Math.hypot(bx - ax, bz - az);
        const heading = Math.atan2(bx - ax, bz - az);
        const frame = out.frameAt((ax + bx) / 2, 0, (az + bz) / 2, heading);
        // Which way the water lies along the frame's own x.
        const sea = Math.cos(heading) * -q.nx - Math.sin(heading) * -q.nz > 0 ? 1 : -1;
        out.box(frame, -sea * (DECK / 2), q.top - 0.07, 0, DECK, 0.2, len + 0.3, deck);
        out.box(frame, sea * -0.2, (q.top + FOOT) / 2, 0, 0.4, q.top - FOOT, len + 0.3, deck);
        out.box(frame, sea * -0.18, q.top + 0.17, 0, 0.36, 0.28, len + 0.3, coping);
        for (let d = 1.3; d < len; d += 2.7) out.cylinder(frame, sea * 0.2, (q.top + 0.4 + FOOT) / 2, d - len / 2, 0.17, 0.19, q.top + 0.4 - FOOT, pile, 7);
        out.collider(frame, -sea * (DECK / 2), q.top - 0.24, 0, DECK, 0.5, len + 0.2);
        out.collider(frame, -sea * 0.18, q.top + 0.15, 0, 0.36, 0.32, len + 0.2);
      }
    }
  }
}
