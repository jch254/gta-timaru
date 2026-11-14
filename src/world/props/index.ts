import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import { VEGETATION } from './vegetation';

/**
 * Instanced props (trees, lamps, street furniture). `ChunkBuilder.instance(kind, …)` places them;
 * each kind is drawn with one InstancedMesh per part per chunk.
 *
 * Geometry is authored with its base at y = 0, facing +z, at scale 1.
 */
export interface PropDef {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  /** Solid trunk / post: a box collider of this half-width and height. */
  collider?: { radius: number; height: number };
  castShadow?: boolean;
  /** Skipped at reduced detail (chunk LOD 1 / low prop density). */
  minor?: boolean;
}

export type PropFactory = (materials: MaterialLibrary) => PropDef;

const factories = new Map<string, PropFactory>();
const built = new Map<string, PropDef>();

export function registerProp(kind: string, factory: PropFactory) {
  factories.set(kind, factory);
}

export function getProp(kind: string, materials: MaterialLibrary): PropDef | null {
  let def = built.get(kind);
  if (def) return def;
  const factory = factories.get(kind);
  if (!factory) return null;
  def = factory(materials);
  built.set(kind, def);
  return def;
}

/** Merge several geometries (already positioned) into one. */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const source of geometries) {
    const g = source.index ? source.toNonIndexed() : source;
    const base = positions.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      indices.push(base + i);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}

/** Lumpy canopy made of a few displaced icosahedra. */
export function canopy(blobs: [x: number, y: number, z: number, r: number, squash?: number][], detail = 1): THREE.BufferGeometry {
  return mergeGeometries(
    blobs.map(([x, y, z, r, squash = 0.8]) => {
      const g = new THREE.IcosahedronGeometry(r, detail);
      g.scale(1, squash, 1);
      g.translate(x, y, z);
      return g;
    }),
  );
}

// ── Core vegetation and street furniture. More kinds are registered in ./extra.ts ──

// Trees and plants are built in ./vegetation.ts (limbs that branch, photographic leaf cards). That file
// also defines kinds beyond the contract ones named here (`tree-macrocarpa`, `toetoe`, `grass-tuft`,
// `gorse`, `lupin`): every entry of VEGETATION is registered under its own name.
for (const [kind, factory] of Object.entries(VEGETATION)) registerProp(kind, factory);

registerProp('lamp', (m) => ({
  // Timber power pole with a street light arm.
  parts: [
    {
      geometry: mergeGeometries([
        new THREE.CylinderGeometry(0.11, 0.14, 8.5, 7).translate(0, 4.25, 0),
        new THREE.BoxGeometry(2.2, 0.1, 0.1).translate(0, 7.9, 0),
        new THREE.BoxGeometry(0.07, 0.07, 2.2).translate(0, 7.3, 1.1),
      ]),
      material: m.get('timber', { color: 0x5e4d3c }),
    },
    { geometry: new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, 7.24, 2.2), material: m.emitter(0xffd9a0, 'night') },
  ],
  collider: { radius: 0.16, height: 8 },
}));
