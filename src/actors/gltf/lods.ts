import * as THREE from 'three';
import { SKIP, Simplifier, weld, type SimplifyLevel } from './simplify';

/**
 * Distant versions of a body, made once when the models load.
 *
 *   level 0  the model as shipped (17,000 to 21,000 triangles on screen, depending on the look)
 *   level 1  about a quarter                      same vertex buffers, same materials
 *   level 2  about a tenth                        same vertex buffers, same materials; also what casts the shadow
 *   level 3  a few hundred triangles              its own small vertex buffer, one flat-coloured material
 *
 * Levels 1 and 2 only re-index the full mesh (see simplify.ts), so they cost a few kilobytes each. Level 3
 * is drawn in a single call: its texture coordinates point into an eight-texel palette (skin, top, legs,
 * hair, crown, shoes, socks, sole) that each look paints for itself.
 */

export type Parts = Record<string, [start: number, count: number]>;

export interface LodMesh {
  /** Triangle list for every part, in the same order as the full mesh's. */
  index: Uint16Array | Uint32Array;
  parts: Parts;
}

export interface FarMesh extends LodMesh {
  attributes: Record<string, THREE.BufferAttribute>;
}

export interface BodyLods {
  levels: [LodMesh, LodMesh];
  far: FarMesh;
}

/** Palette cells of the far level, left to right. */
export const FAR_CELLS = { skin: 0, top: 1, legs: 2, hair: 3, crown: 4, shoes: 5, socks: 6, sole: 7 } as const;
export const FAR_CELL_COUNT = 8;

/**
 * Kinds of surface, each with its own budget. "Lips" are the dark rims that close the gap between a hem
 * and the skin under it (the build marks them with a grey vertex colour); nobody sees those from a distance.
 */
const enum C {
  head,
  hands,
  limbs,
  top,
  lips,
  legs,
  shoes,
  socks,
  face,
  hair,
  count,
}

/** Share of each class's triangles kept at levels 1, 2 and 3 (0 = left out altogether). */
const KEEP: number[][] = [
  /* head  */ [0.42, 0.16, 0.05],
  /* hands */ [0.1, 0.035, 0.012],
  /* limbs */ [0.25, 0.1, 0.04],
  /* top   */ [0.26, 0.1, 0.035],
  /* lips  */ [0, 0, 0],
  /* legs  */ [0.26, 0.1, 0.035],
  /* shoes */ [0.22, 0.09, 0.035],
  /* socks */ [0.2, 0.08, 0.03],
  /* face  */ [0.5, 0.25, 0],
  /* hair  */ [0.28, 0.11, 0.035],
];

const HAND = /^(hand|thumb|index|middle|ring|pinky)_/;

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** An attribute's values as one plain array (the loader hands back interleaved, quantised buffers). */
function flat(attribute: Attribute, integer = false): Float32Array | Uint16Array {
  const size = attribute.itemSize;
  const out = integer ? new Uint16Array(attribute.count * size) : new Float32Array(attribute.count * size);
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attribute.getComponent(i, k);
  return out;
}

export interface Budgets {
  /** Budget of each triangle: one per part and kind, so no hairstyle is thinned to pay for another. */
  budget: Uint16Array;
  /** Kind (a row of KEEP) of each budget. */
  kinds: number[];
  /** Part each vertex belongs to (index into the part table's order). */
  vertexPart: Uint16Array;
}

/** Sort triangles into budgets: by part, by the bone they hang off, and (shoes, socks, eyes) by atlas cell. */
export function classify(geometry: THREE.BufferGeometry, parts: Parts, boneNames: string[]): Budgets {
  const index = geometry.index!;
  const uv = geometry.getAttribute('uv');
  const color = geometry.getAttribute('color');
  const joints = geometry.getAttribute('skinIndex');
  const weights = geometry.getAttribute('skinWeight');
  const hand = boneNames.map((name) => HAND.test(name));
  const budget = new Uint16Array(index.count / 3);
  const vertexPart = new Uint16Array(uv.count);
  const kinds: number[] = [];
  const ids = new Map<number, number>();
  const onHand = (vertex: number) => {
    let best = 0;
    let bone = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights.getComponent(vertex, k);
      if (w > best) {
        best = w;
        bone = joints.getComponent(vertex, k);
      }
    }
    return hand[bone];
  };
  Object.entries(parts).forEach(([name, [start, count]], part) => {
    for (let i = start; i < start + count; i += 3) {
      const vertex = index.getX(i);
      let kind: C;
      if (name.startsWith('skin')) kind = onHand(vertex) ? C.hands : name === 'skinHead' ? C.head : C.limbs;
      else if (name.endsWith('Lips') || ((name.startsWith('top') || name.startsWith('legs')) && color.getX(vertex) < 0.9)) kind = C.lips;
      else if (name.startsWith('top')) kind = C.top;
      else if (name.startsWith('legs')) kind = C.legs;
      else if (name.startsWith('hair')) kind = C.hair;
      else {
        const u = uv.getX(vertex);
        const v = uv.getY(vertex);
        // The painted atlas: eyes on the left half; hair (brows) and shoes above socks and soles on the right.
        kind = u < 0.5 || (u < 0.75 && v < 0.5) ? C.face : u < 0.75 ? C.socks : C.shoes;
      }
      let id = ids.get(part * C.count + kind);
      if (id === undefined) {
        ids.set(part * C.count + kind, (id = kinds.length));
        kinds.push(kind);
      }
      budget[i / 3] = KEEP[kind][0] > 0 ? id : SKIP;
      for (let k = 0; k < 3; k++) vertexPart[index.getX(i + k)] = part;
    }
  });
  return { budget, kinds, vertexPart };
}

/**
 * Vertices that differ only in name: same place, same part, texture coordinates within a few millimetres
 * of cloth. (The shells were unwrapped corner by corner, which left near-duplicates all over them.)
 */
export function wedges(geometry: THREE.BufferGeometry, vertexPart: Uint16Array, tolerance = 0.004): Uint32Array {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const { of, points } = weld(flat(position), position.count);
  const heads: number[][] = Array.from({ length: points }, () => []);
  const out = new Uint32Array(position.count);
  for (let v = 0; v < position.count; v++) {
    const list = heads[of[v]];
    let found = -1;
    for (const w of list) {
      if (vertexPart[w] === vertexPart[v] && Math.abs(uv.getX(w) - uv.getX(v)) < tolerance && Math.abs(uv.getY(w) - uv.getY(v)) < tolerance) {
        found = w;
        break;
      }
    }
    if (found < 0) list.push((found = v));
    out[v] = found;
  }
  return out;
}

function assemble(level: SimplifyLevel, parts: Parts, budgets: Budgets, which: number, vertices: number): LodMesh {
  const list: number[] = [];
  const out: Parts = {};
  for (const [name, [start, count]] of Object.entries(parts)) {
    const from = list.length;
    for (let t = start / 3; t < (start + count) / 3; t++) {
      if (!level.alive[t] || budgets.budget[t] === SKIP || KEEP[budgets.kinds[budgets.budget[t]]][which] <= 0) continue;
      list.push(level.corners[t * 3], level.corners[t * 3 + 1], level.corners[t * 3 + 2]);
    }
    out[name] = [from, list.length - from];
  }
  return { index: vertices < 65536 ? Uint16Array.from(list) : Uint32Array.from(list), parts: out };
}

/** The far level gets a compact vertex buffer of its own, with palette coordinates in place of the texture's. */
function compactFar(mesh: LodMesh, geometry: THREE.BufferGeometry): FarMesh {
  const remap = new Map<number, number>();
  const cells: number[] = [];
  const uv = geometry.getAttribute('uv');
  const index = new Uint16Array(mesh.index.length);
  for (const [name, [start, count]] of Object.entries(mesh.parts)) {
    for (let i = start; i < start + count; i++) {
      const vertex = mesh.index[i];
      let to = remap.get(vertex);
      if (to === undefined) {
        remap.set(vertex, (to = remap.size));
        let cell: number = FAR_CELLS.skin;
        if (name.startsWith('top')) cell = FAR_CELLS.top;
        else if (name.startsWith('legs')) cell = FAR_CELLS.legs;
        else if (name.startsWith('hair')) cell = name.endsWith('_high') ? FAR_CELLS.crown : FAR_CELLS.hair;
        else if (name === 'misc') cell = uv.getX(vertex) < 0.75 ? FAR_CELLS.socks : uv.getY(vertex) < 0.5 ? FAR_CELLS.shoes : FAR_CELLS.sole;
        cells.push(cell);
      }
      index[i] = to;
    }
  }
  const attributes: Record<string, THREE.BufferAttribute> = {};
  for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
    const source = geometry.getAttribute(name);
    const size = source.itemSize;
    const array = name === 'skinIndex' ? new Uint16Array(remap.size * size) : new Float32Array(remap.size * size);
    for (const [from, to] of remap) for (let k = 0; k < size; k++) array[to * size + k] = source.getComponent(from, k);
    attributes[name] = new THREE.BufferAttribute(array, size);
  }
  const coords = new Float32Array(remap.size * 2);
  cells.forEach((cell, i) => {
    coords[i * 2] = (cell + 0.5) / FAR_CELL_COUNT;
    coords[i * 2 + 1] = 0.5;
  });
  attributes.uv = new THREE.BufferAttribute(coords, 2);
  return { index, parts: mesh.parts, attributes };
}

export function buildLods(geometry: THREE.BufferGeometry, parts: Parts, boneNames: string[]): BodyLods {
  const budgets = classify(geometry, parts, boneNames);
  const position = geometry.getAttribute('position');
  const simplifier = new Simplifier({
    positions: flat(position),
    index: geometry.index!.array,
    triClass: budgets.budget,
    skinIndex: flat(geometry.getAttribute('skinIndex'), true),
    skinWeight: flat(geometry.getAttribute('skinWeight')),
    wedgeOf: wedges(geometry, budgets.vertexPart),
  });
  const level = (which: number) => assemble(simplifier.run(budgets.kinds.map((kind) => KEEP[kind][which])), parts, budgets, which, position.count);
  const one = level(0);
  const two = level(1);
  return { levels: [one, two], far: compactFar(level(2), geometry) };
}

/** Triangles a list of part spans adds up to (for reports and tests). */
export function spanTriangles(parts: Parts, spans: [from: string, to: string][]): number {
  let total = 0;
  for (const [from, to] of spans) {
    const a = parts[from];
    const b = parts[to];
    if (a && b) total += Math.max(0, b[0] + b[1] - a[0]) / 3;
  }
  return total;
}
