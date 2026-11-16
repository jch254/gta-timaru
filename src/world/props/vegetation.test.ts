import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MaterialLibrary } from '../../core/types';
import { getProp } from './index';
import './extra';
import { plantField, plantVariation, type PlantModel } from './foliage';
import { PLANTER_SOIL, VEGETATION, plantModel } from './vegetation';

/**
 * Triangle budgets for a kind's shapes (the plant in full, drawn only near the camera) and for its stand-in
 * (everything further off). Leaf cards are indexed twice, once per winding, and that is what is counted here.
 */
const BUDGET: Record<string, [shape: number, standIn: number]> = {
  // Hero trees: parks, avenues, the river, the Bay.
  'tree-oak': [1500, 110],
  'tree-english-oak': [1500, 110],
  'tree-lime': [1500, 110],
  'tree-plane': [1500, 110],
  'tree-willow': [1500, 130],
  'tree-norfolk-pine': [1500, 110],
  'tree-phoenix-palm': [700, 70],
  // Planted by the hundred in belts and rows.
  'tree-pine': [500, 80],
  'tree-poplar': [500, 70],
  'tree-macrocarpa': [500, 110],
  'tree-cabbage': [500, 80],
  // Shrubs and hedges.
  bush: [160, 14],
  'shrub-hydrangea': [160, 14],
  'shrub-rhododendron': [160, 14],
  gorse: [160, 14],
  broom: [160, 14],
  'rose-bush': [160, 14],
  hedge: [160, 30],
  'hedge-shelter': [230, 30],
  // Bedding and tubs.
  'flower-bed': [150, 14],
  'planter-plants': [150, 10],
  // Fans and tufts.
  flax: [150, 14],
  toetoe: [150, 10],
  'grass-tuft': [150, 10],
  tussock: [150, 10],
  lupin: [150, 10],
  'grass-long': [60, 0],
};

/** Kinds that do not stand on the ground: they grow from the soil of a tub. */
const RAISED: Record<string, number> = { 'planter-plants': PLANTER_SOIL };

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

/** Checks one geometry is sound, grows `box` to hold it, and returns its triangles. */
function check(g: THREE.BufferGeometry, material: THREE.Material, box: THREE.Box3): number {
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
  const col = g.getAttribute('color');
  if (col) {
    // Leaf cards: vertex colours tint the atlas (or are the colour, on plain surfaces), and stay inside its cells.
    const leaf = g.getAttribute('aLeaf');
    const card = g.getAttribute('aCard');
    const stem = g.getAttribute('aStem');
    expect(leaf.count).toBe(pos.count);
    expect(card.count).toBe(pos.count);
    expect(stem.count).toBe(pos.count);
    for (let i = 0; i < col.count; i++) {
      expect(Math.min(col.getX(i), col.getY(i), col.getZ(i))).toBeGreaterThan(0);
      expect(Number.isFinite(col.getX(i) + col.getY(i) + col.getZ(i))).toBe(true);
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
      // What a card turns about is a pair of unit axes at right angles; sway and rim are fractions.
      expect(Math.hypot(card.getX(i), card.getY(i), card.getZ(i))).toBeCloseTo(1, 3);
      expect(Math.hypot(stem.getX(i), stem.getY(i), stem.getZ(i))).toBeCloseTo(1, 3);
      if (card.getW(i) !== 0) expect(Math.abs(card.getX(i) * stem.getX(i) + card.getY(i) * stem.getY(i) + card.getZ(i) * stem.getZ(i))).toBeLessThan(0.02);
      expect(leaf.getX(i)).toBeGreaterThanOrEqual(0);
      expect(leaf.getY(i)).toBeGreaterThanOrEqual(0);
      expect(leaf.getY(i)).toBeLessThanOrEqual(1);
    }
    const m = material as THREE.MeshStandardMaterial;
    expect(m.alphaTest).toBeGreaterThan(0);
    expect(m.transparent).toBe(false);
    expect(made).toContain(m);
  }
  return index!.count / 3;
}

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
      expect(def.parts.length).toBeLessThanOrEqual(2);
      const model = plantModel(kind, materials);
      expect(model).toBeDefined();
      if (!model) return;
      const [budget, standIn] = BUDGET[kind];
      const foot = RAISED[kind] ?? 0;

      // What the world instances is the first shape.
      expect(def.parts.map((part) => part.material)).toEqual(model.shapes[0].parts.map((part) => part.material));
      def.parts.forEach((part, i) => expect(part.geometry.getAttribute('position')).toBe(model.shapes[0].parts[i].geometry.getAttribute('position')));

      const heights: number[] = [];
      for (const shape of model.shapes) {
        const box = new THREE.Box3();
        let triangles = 0;
        for (const part of shape.parts) triangles += check(part.geometry, part.material, box);
        // Stands on the ground: trunks may be sunk a little for slopes, nothing floats.
        expect(box.min.y).toBeGreaterThan(foot - 0.5);
        expect(box.min.y).toBeLessThan(foot + 0.1);
        expect(triangles).toBeLessThanOrEqual(budget);
        heights.push(box.max.y);
        if (def.collider) {
          expect(def.collider.radius).toBeLessThan(1);
          expect(def.collider.height).toBeLessThan(box.max.y);
        }
      }

      if (model.far) {
        expect(model.farMaterial).not.toBeNull();
        const box = new THREE.Box3();
        const triangles = check(model.far, model.farMaterial!, box);
        expect(triangles).toBeLessThanOrEqual(standIn);
        // A fraction of the cost of the plant it stands for.
        expect(triangles).toBeLessThan(budget / 3);
        expect(box.min.y).toBeGreaterThan(foot - 0.5);
        expect(box.min.y).toBeLessThan(foot + 0.1);
        // And about the same height as each shape it stands in for, once stretched to it.
        model.shapes.forEach((shape, i) => {
          const tall = box.max.y * (shape.far?.[1] ?? 1);
          expect(tall).toBeGreaterThan(heights[i] * 0.72);
          expect(tall).toBeLessThan(heights[i] * 1.3);
        });
      } else {
        expect(standIn).toBe(0);
        expect(model.reach).toBeLessThanOrEqual(model.near);
      }
    });
  }

  it('shares one leaf material between every kind, and one stand-in material', () => {
    const leafy = new Set<THREE.Material>();
    const far = new Set<THREE.Material>();
    for (const kind of Object.keys(BUDGET)) {
      getProp(kind, materials);
      const model = plantModel(kind, materials)!;
      for (const shape of model.shapes) for (const part of shape.parts) if (part.geometry.getAttribute('color')) leafy.add(part.material);
      if (model.farMaterial) far.add(model.farMaterial);
    }
    expect(leafy.size).toBe(1);
    expect(far.size).toBe(1);
    expect([...far][0]).not.toBe([...leafy][0]);
  });

  it('gives every tree at least two shapes', () => {
    for (const kind of Object.keys(BUDGET)) {
      if (!kind.startsWith('tree-')) continue;
      getProp(kind, materials);
      expect(plantModel(kind, materials)!.shapes.length, kind).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the plant field', () => {
  /** A chunk's worth of one kind, instanced the way the world does it. */
  function instanced(kind: string, at: [number, number][]) {
    const def = getProp(kind, materials)!;
    const group = new THREE.Group();
    const dummy = new THREE.Object3D();
    const meshes = def.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, at.length);
      at.forEach(([x, z], i) => {
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, 0.7 * i, 0);
        dummy.scale.setScalar(1 + 0.1 * i);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      group.add(mesh);
      return mesh;
    });
    return { group, meshes, model: plantModel(kind, materials) as PlantModel };
  }

  it('varies a plant by where it stands, and always the same way', () => {
    getProp('tree-oak', materials);
    const model = plantModel('tree-oak', materials)!;
    const shapes = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 37.3 - 300;
      const z = Math.floor(i / 20) * 41.9 - 300;
      const a = plantVariation(model, x, z);
      expect(plantVariation(model, x, z)).toEqual(a);
      expect(a.shape).toBeGreaterThanOrEqual(0);
      expect(a.shape).toBeLessThan(model.shapes.length);
      expect(Math.abs(a.height / a.width - 1)).toBeLessThan(0.35);
      expect(a.lean).toBeLessThanOrEqual(model.vary.lean);
      for (const c of a.tint) expect(Math.abs(c - 1)).toBeLessThan(0.3);
      shapes.add(a.shape);
    }
    // Over a few hundred metres every shape of every species turns up.
    expect(shapes.size).toBe(model.shapes.length);
  });

  it('draws plants in full near the camera and as stand-ins beyond, and lets go of them with their chunk', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    scene.add(root);
    const { group, meshes, model } = instanced('tree-oak', [[0, 0], [50, 10], [400, 0]]);
    root.add(group);
    const before = plantField.census();
    plantField.scan(group);
    for (const mesh of meshes) expect(mesh.visible).toBe(false);
    const far = group.children.find((child) => (child as THREE.InstancedMesh).geometry === model.far) as THREE.InstancedMesh;
    expect(far).toBeDefined();
    expect(far.material).toBe(model.farMaterial);

    plantField.update(0, 2, 0);
    expect(plantField.census().plants - before.plants).toBe(3);
    expect(plantField.census().near - before.near).toBe(2);
    expect(far.count).toBe(1);
    expect(far.visible).toBe(true);

    plantField.update(405, 2, 0);
    expect(plantField.census().near - before.near).toBe(1);
    expect(far.count).toBe(2);

    plantField.update(5000, 2, 0);
    expect(plantField.census().near - before.near).toBe(0);
    expect(far.count).toBe(3);

    // The world disposes of its meshes when the chunk unloads.
    root.remove(group);
    for (const mesh of meshes) mesh.dispose();
    expect(plantField.census().plants).toBe(before.plants);
    expect(far.parent).toBeNull();
  });

  it('stops drawing small plants beyond their reach, and hands everything back when suspended', () => {
    const scene = new THREE.Scene();
    const { group, meshes, model } = instanced('grass-long', [[0, 0], [2, 0]]);
    scene.add(group);
    plantField.forceFine = true;
    plantField.scan(group);
    expect(model.far).toBeNull();
    plantField.update(1, 2, 0);
    const near = plantField.census().near;
    expect(near).toBeGreaterThanOrEqual(2);
    plantField.update(1 + model.near + 10, 2, 0);
    expect(plantField.census().near).toBe(near - 2);
    plantField.suspend();
    for (const mesh of meshes) expect(mesh.visible).toBe(true);
    expect(plantField.census().plants).toBe(0);
    plantField.resume();
    plantField.forceFine = false;
  });
});
