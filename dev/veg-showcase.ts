import * as THREE from 'three';
import { getProp } from '../src/world/props';

/**
 * Development aid for the vegetation props: stands one of each kind in a row in front of the player, in
 * the running game (so lighting, shadows and post are the real thing). Used from the screenshot tool:
 *
 *   node scripts/shot.mjs --at -1318,-1300 --heading 3.14 --time 15 \
 *     --eval "const m = await import('/dev/veg-showcase.ts'); m.show(dev, ['tree-oak', 'tree-willow'], { dist: 22, gap: 14 })"
 */
export function show(dev: any, kinds: string[], o: { dist?: number; gap?: number; scale?: number; rows?: number; turn?: number } = {}) {
  const ctx = dev.ctx;
  const p = ctx.player.position;
  const h = ctx.player.heading;
  const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const dist = o.dist ?? 20;
  const gap = o.gap ?? 12;
  const dummy = new THREE.Object3D();
  const report: Record<string, { parts: number; triangles: number }> = {};
  kinds.forEach((kind, i) => {
    const def = getProp(kind, ctx.gfx.materials);
    if (!def) return;
    let triangles = 0;
    for (let row = 0; row < (o.rows ?? 1); row++) {
      const x = p.x + fwd.x * (dist + row * gap) + side.x * (i - (kinds.length - 1) / 2) * gap;
      const z = p.z + fwd.z * (dist + row * gap) + side.z * (i - (kinds.length - 1) / 2) * gap;
      dummy.position.set(x, ctx.world.groundAt(x, z), z);
      dummy.rotation.set(0, (o.turn ?? 0) + row * 2.1, 0);
      dummy.scale.setScalar(o.scale ?? 1);
      dummy.updateMatrix();
      for (const part of def.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
        mesh.setMatrixAt(0, dummy.matrix);
        mesh.castShadow = def.castShadow !== false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        ctx.scene.add(mesh);
        if (row === 0) triangles += (part.geometry.getIndex()?.count ?? part.geometry.getAttribute('position').count) / 3;
      }
    }
    report[kind] = { parts: def.parts.length, triangles };
  });
  return report;
}

const KINDS = ['tree-oak', 'tree-willow', 'tree-cabbage', 'tree-pine', 'tree-poplar', 'bush', 'flax', 'hedge', 'tree-norfolk-pine', 'tree-phoenix-palm', 'tree-macrocarpa', 'toetoe', 'grass-tuft', 'tussock', 'gorse', 'lupin'];
/** Triangles of the round-1 props these kinds replaced, for before / after sums. */
const OLD_TRIANGLES: Record<string, number> = { 'tree-oak': 348, 'tree-willow': 348, 'tree-cabbage': 88, 'tree-pine': 60, 'tree-poplar': 108, bush: 40, flax: 12, hedge: 16, 'tree-norfolk-pine': 168, 'tree-phoenix-palm': 222 };
const OLD_PARTS: Record<string, number> = { bush: 1, flax: 1, hedge: 1 };

/**
 * What the vegetation in the loaded chunks costs: instances, instanced meshes (one draw call each per pass)
 * and triangles (instances × the kind's triangles, before shadow passes), with the same sums for the props
 * they replaced.
 */
export function census(dev: any) {
  const ctx = dev.ctx;
  const owner = new Map<THREE.BufferGeometry, { kind: string; triangles: number; first: boolean }>();
  for (const kind of KINDS) {
    const def = getProp(kind, ctx.gfx.materials);
    if (!def) continue;
    def.parts.forEach((part, i) => owner.set(part.geometry, { kind, triangles: (part.geometry.getIndex()?.count ?? part.geometry.getAttribute('position').count) / 3, first: i === 0 }));
  }
  const kinds: Record<string, { instances: number; meshes: number; triangles: number }> = {};
  const total = { instances: 0, meshes: 0, triangles: 0, oldMeshes: 0, oldTriangles: 0 };
  ctx.scene.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const info = owner.get(mesh.geometry);
    if (!info) return;
    const k = (kinds[info.kind] ??= { instances: 0, meshes: 0, triangles: 0 });
    k.meshes++;
    k.triangles += mesh.count * info.triangles;
    total.meshes++;
    total.triangles += mesh.count * info.triangles;
    if (info.first) {
      k.instances += mesh.count;
      total.instances += mesh.count;
      if (OLD_TRIANGLES[info.kind] !== undefined) {
        total.oldMeshes += OLD_PARTS[info.kind] ?? 2;
        total.oldTriangles += mesh.count * OLD_TRIANGLES[info.kind];
      }
    }
  });
  return { kinds, total };
}

/** Position of the instance of `kind` nearest the player, for pointing a camera at one. */
export function nearest(dev: any, kind: string) {
  const ctx = dev.ctx;
  const def = getProp(kind, ctx.gfx.materials);
  if (!def) return null;
  const p = ctx.player.position;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let best: { x: number; z: number; d: number } | null = null;
  ctx.scene.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.geometry !== def.parts[0].geometry) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (!best || d < best.d) best = { x: Math.round(v.x), z: Math.round(v.z), d: Math.round(d) };
    }
  });
  return best;
}
