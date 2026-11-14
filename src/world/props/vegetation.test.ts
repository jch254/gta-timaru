import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../core/types';
import { getProp } from './index';
import './extra';
import { VEGETATION } from './vegetation';

/** Triangle budgets. Leaf cards are indexed twice (once per winding), and that is what is counted here. */
const BUDGET: Record<string, number> = {
  // Hero trees: parks, the river, the Bay.
  'tree-oak': 1500,
  'tree-willow': 1500,
  'tree-norfolk-pine': 1500,
  'tree-phoenix-palm': 700,
  // Planted by the hundred in belts and rows.
  'tree-pine': 500,
  'tree-poplar': 500,
  'tree-macrocarpa': 500,
  'tree-cabbage': 500,
  // Small plants.
  bush: 150,
  flax: 150,
  hedge: 150,
  toetoe: 150,
  'grass-tuft': 150,
  tussock: 150,
  gorse: 150,
  lupin: 150,
};

const made: THREE.Material[] = [];
const materials: MaterialLibrary = {
  get: (surface, options = {}) => Object.assign(new THREE.MeshStandardMaterial(), { name: `${surface}|${JSON.stringify(options)}` }),
  windows: () => new THREE.MeshStandardMaterial(),
  emitter: () => new THREE.MeshStandardMaterial(),
  sign: () => new THREE.MeshStandardMaterial(),
  register: (material) => {
    made.push(material);
    return material;
  },
  release: () => undefined,
};

const v = new THREE.Vector3();

describe('vegetation props', () => {
  it('has a budget for every kind', () => {
    expect(Object.keys(VEGETATION).sort()).toEqual(Object.keys(BUDGET).sort());
  });

  for (const kind of Object.keys(BUDGET)) {
    it(`${kind} is registered, well formed and within budget`, () => {
      const def = getProp(kind, materials);
      expect(def).not.toBeNull();
      if (!def) return;
      expect(def.parts.length).toBeGreaterThan(0);
      expect(def.parts.length).toBeLessThanOrEqual(3);
      const box = new THREE.Box3();
      let triangles = 0;
      for (const part of def.parts) {
        const g = part.geometry;
        const pos = g.getAttribute('position');
        const nrm = g.getAttribute('normal');
        const uv = g.getAttribute('uv');
        expect(pos.count).toBeGreaterThan(0);
        expect(nrm.count).toBe(pos.count);
        expect(uv.count).toBe(pos.count);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
          box.expandByPoint(v);
          expect(v.fromBufferAttribute(nrm, i).length()).toBeCloseTo(1, 3);
          expect(Number.isFinite(uv.getX(i) + uv.getY(i))).toBe(true);
        }
        const index = g.getIndex();
        expect(index).not.toBeNull();
        for (let i = 0; i < index!.count; i++) expect(index!.getX(i)).toBeLessThan(pos.count);
        triangles += index!.count / 3;
        const col = g.getAttribute('color');
        if (col) {
          // Leaf cards: vertex colours tint the atlas, and stay inside its cells.
          for (let i = 0; i < col.count; i++) {
            expect(col.getX(i) + col.getY(i) + col.getZ(i)).toBeGreaterThan(0.3);
            expect(Number.isFinite(col.getX(i) + col.getY(i) + col.getZ(i))).toBe(true);
            expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getX(i)).toBeLessThanOrEqual(1);
            expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
            expect(uv.getY(i)).toBeLessThanOrEqual(1);
          }
          const material = part.material as THREE.MeshStandardMaterial;
          expect(material.alphaTest).toBeGreaterThan(0);
          expect(material.transparent).toBe(false);
          expect(made).toContain(material);
        }
      }
      // Stands on the ground: trunks may be sunk a little for slopes, nothing floats.
      expect(box.min.y).toBeGreaterThan(-0.5);
      expect(box.min.y).toBeLessThan(0.1);
      expect(triangles).toBeLessThanOrEqual(BUDGET[kind]);
      if (def.collider) {
        expect(def.collider.radius).toBeLessThan(1);
        expect(def.collider.height).toBeLessThan(box.max.y);
      }
    });
  }

  it('shares one leaf material between every kind', () => {
    const leafy = new Set<THREE.Material>();
    for (const kind of Object.keys(BUDGET)) for (const part of getProp(kind, materials)!.parts) if (part.geometry.getAttribute('color')) leafy.add(part.material);
    expect(leafy.size).toBe(1);
  });
});
