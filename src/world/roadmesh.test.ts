import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RoadEdge } from '../core/types';
import type { ChunkBuilderImpl } from './chunkbuilder';
import { chunkOf } from './lots';
import { compileMap, type CompiledMap } from './map';
import { buildMap } from './mapdata/index';
import { buildChunkRoads, type RoadMaterials } from './roadmesh';

interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  quat?: THREE.Quaternion;
}

/** Just enough of a chunk builder to collect what the road mesher asks for. */
function recorder() {
  const colliders: Box[] = [];
  let strips = 0;
  const out = {
    colliders,
    addGeometry: () => void strips++,
    box: () => undefined,
    cylinder: () => undefined,
    frameAt: (x: number, y: number, z: number, heading: number) => new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z),
  };
  return { out: out as unknown as ChunkBuilderImpl, colliders, strips: () => strips };
}

const materials = new Proxy({} as Record<string, THREE.Material>, {
  get: (target, key: string) => (target[key] ??= new THREE.MeshBasicMaterial({ name: key })),
}) as unknown as RoadMaterials;

/** Distance from a point to an edge's centreline, and the road's height there. */
function distanceTo(e: RoadEdge, x: number, z: number): { d: number; y: number } {
  let d = Infinity;
  let y = 0;
  for (let i = 0; i < e.samples.length - 1; i++) {
    const a = e.samples[i];
    const b = e.samples[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const dd = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (dd < d) {
      d = dd;
      y = a.y + (b.y - a.y) * t;
    }
  }
  return { d, y };
}

/** Everything the mesher builds for one edge, over every chunk the edge passes through. */
function build(map: CompiledMap, e: RoadEdge) {
  const rec = recorder();
  const chunks = new Set(e.samples.map((s) => `${chunkOf(s.x)},${chunkOf(s.z)}`));
  for (const key of chunks) {
    const [cx, cz] = key.split(',').map(Number);
    buildChunkRoads(cx, cz, map, [e.index], rec.out, materials);
  }
  return rec;
}

let map: CompiledMap;
beforeAll(() => {
  map = compileMap(buildMap());
});

describe('bridges', () => {
  it('have parapets over the span, and none standing on another road', () => {
    const { graph } = map;
    const bridges = graph.edges.filter((e) => e.bridge);
    expect(bridges.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const e of bridges) {
      // Parapet colliders are the thin ones; the deck's is as wide as the bridge.
      const rails = build(map, e).colliders.filter((c) => c.hx < 0.2);
      let railed = 0;
      // Roads that meet the bridge's ends, or come anywhere near it.
      const others = graph.edges.filter((o) => {
        if (o.index === e.index || o.tunnel) return false;
        const m = e.samples[e.samples.length >> 1];
        return distanceTo(o, m.x, m.z).d < e.length / 2 + 40;
      });
      for (const c of rails) {
        railed += c.hz * 2;
        const along = new THREE.Vector3(0, 0, 1).applyQuaternion(c.quat ?? new THREE.Quaternion());
        for (const t of [-1, 0, 1]) {
          const x = c.x + along.x * c.hz * t * 0.98;
          const z = c.z + along.z * c.hz * t * 0.98;
          // Clear of the bridge's own nodes: a road that simply carries on shares only that point.
          for (const o of others) {
            const sameRoad = [e.a, e.b].some((n) => {
              if (o.a !== n && o.b !== n) return false;
              const node = graph.nodes[n];
              const far = o.a === n ? o.samples[Math.min(2, o.samples.length - 1)] : o.samples[Math.max(0, o.samples.length - 3)];
              const mine = e.a === n ? e.samples[Math.min(2, e.samples.length - 1)] : e.samples[Math.max(0, e.samples.length - 3)];
              const ux = far.x - node.x;
              const uz = far.z - node.z;
              const vx = mine.x - node.x;
              const vz = mine.z - node.z;
              return (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1) < -0.9;
            });
            if (sameRoad) continue;
            const hit = distanceTo(o, x, z);
            if (Math.abs(hit.y - (c.y - 0.6)) < 1.6 && hit.d < o.width / 2 + (o.footpaths ? 3.1 : 1)) {
              problems.push(`${e.name}: parapet at ${x.toFixed(0)},${z.toFixed(0)} stands on ${o.name}`);
            }
          }
        }
      }
      // Two parapets, each over at least two fifths of the bridge (the rest is the junctions at its ends).
      if (railed < e.length * 0.8) problems.push(`${e.name}: only ${railed.toFixed(0)} m of parapet on a ${e.length.toFixed(0)} m bridge`);
    }
    expect(problems).toEqual([]);
  });
});

describe('road markings', () => {
  it('paint no yellow along a straight, level, open road', () => {
    // The Rakaia straight: a long length of SH1 with no bend, crest, bridge or junction in it.
    const straight = map.graph.edges
      .filter((e) => e.cls === 'highway' && !e.bridge && e.length > 600)
      .find((e) => {
        const a = e.samples[0];
        const b = e.samples[e.samples.length - 1];
        return Math.abs(a.tx * b.tz - a.tz * b.tx) < 0.01 && Math.abs(a.y - b.y) < 2;
      });
    expect(straight).toBeDefined();
    const yellow: unknown[] = [];
    const rec = recorder();
    (rec.out as unknown as { addGeometry(g: THREE.BufferGeometry, m: THREE.Material): void }).addGeometry = (g, m) => {
      if (m === materials.lineYellow) {
        const p = g.getAttribute('position');
        // Away from the two ends, where a limit line may bring a no-overtaking line with it.
        const s = Math.hypot(p.getX(0) - straight!.samples[0].x, p.getZ(0) - straight!.samples[0].z);
        if (s > 60 && s < straight!.length - 60) yellow.push(s);
      }
    };
    for (const key of new Set(straight!.samples.map((s) => `${chunkOf(s.x)},${chunkOf(s.z)}`))) {
      const [cx, cz] = key.split(',').map(Number);
      buildChunkRoads(cx, cz, map, [straight!.index], rec.out, materials);
    }
    expect(yellow).toEqual([]);
  });
});
