import * as THREE from 'three';
import type { SurfaceKind } from '../core/types';

/**
 * Procedural PBR texture sets. Every surface is generated at load from tileable noise:
 * an albedo map and a normal map derived from a height function. No image assets.
 */

function hash(ix: number, iy: number, seed: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise: u,v in 0..1, `period` lattice cells across the tile. */
function tnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(ix), w(iy), seed);
  const b = hash(w(ix + 1), w(iy), seed);
  const c = hash(w(ix), w(iy + 1), seed);
  const d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tfbm(u: number, v: number, period: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tnoise(u, v, p, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const fract = (x: number) => x - Math.floor(x);
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Texel {
  /** Height 0..1 (drives the normal map). */
  h: number;
  r: number;
  g: number;
  b: number;
}

interface SurfaceDef {
  /**
   * Set when a true-colour photograph replaces the procedural map: the colour and roughness the surface
   * was designed around, so explicit colours / roughness passed by callers can be applied as relative tints.
   */
  designColor?: number;
  designRoughness?: number;
  /** Metres covered by one repeat (u, v). 0 = untextured. */
  tile: [number, number];
  size?: number;
  normalStrength?: number;
  color: number;
  roughness: number;
  metalness: number;
  texel?: (u: number, v: number) => Texel;
}

const grey = (h: number, l: number): Texel => ({ h, r: l, g: l, b: l });

/** Masonry: rows of blocks with staggered joints. Returns block id + distance to the nearest joint. */
function blocks(u: number, v: number, rows: number, cols: number, seed: number, jitter = 0) {
  const row = Math.floor(v * rows);
  const fy = fract(v * rows);
  const shift = (row % 2) * 0.5 + (jitter ? hash(row, 7, seed) * jitter : 0);
  const x = u * cols + shift;
  const col = Math.floor(x);
  const fx = fract(x);
  const edge = Math.min(fx * (rows / cols), (1 - fx) * (rows / cols), fy, 1 - fy);
  return { id: hash(((col % cols) + cols) % cols, row, seed), edge };
}

export const SURFACES: Record<SurfaceKind, SurfaceDef> = {
  asphalt: {
    tile: [4, 4],
    color: 0x4a4b4e,
    roughness: 0.93,
    metalness: 0,
    normalStrength: 0.3,
    texel: (u, v) => {
      // Chip seal: grain at the texel scale so low sun does not turn the road into ripples.
      const fine = tnoise(u, v, 128, 1);
      const chip = tnoise(u, v, 256, 2);
      const patch = tfbm(u, v, 4, 3, 3);
      return grey(fine * 0.5 + chip * 0.5, 0.74 + fine * 0.14 + patch * 0.14 - (chip > 0.86 ? 0.1 : 0));
    },
  },
  concrete: {
    tile: [4, 4],
    color: 0xb7b3a8,
    roughness: 0.88,
    metalness: 0,
    normalStrength: 0.7,
    texel: (u, v) => {
      const n = tfbm(u, v, 8, 11);
      return grey(n * 0.5 + tnoise(u, v, 64, 12) * 0.2, 0.82 + n * 0.2);
    },
  },
  footpath: {
    tile: [2.4, 2.4],
    color: 0xb9b5aa,
    roughness: 0.9,
    metalness: 0,
    normalStrength: 1.2,
    texel: (u, v) => {
      const joint = Math.min(fract(u * 2), 1 - fract(u * 2), fract(v * 2), 1 - fract(v * 2));
      const groove = sstep(0, 0.02, joint);
      const n = tfbm(u, v, 12, 21);
      return grey(groove * 0.8 + n * 0.2, (0.8 + n * 0.22) * (0.75 + groove * 0.25));
    },
  },
  gravel: {
    tile: [3, 3],
    color: 0xa39a88,
    roughness: 0.97,
    metalness: 0,
    normalStrength: 2.2,
    texel: (u, v) => {
      const a = tnoise(u, v, 40, 31);
      const b = tnoise(u, v, 80, 32);
      const h = Math.max(a, b * 0.9);
      return grey(h, 0.6 + h * 0.45);
    },
  },
  shingle: {
    tile: [5, 5],
    color: 0x9c9a94,
    roughness: 0.95,
    metalness: 0,
    normalStrength: 2.4,
    texel: (u, v) => {
      const a = tnoise(u, v, 28, 41);
      const b = tnoise(u, v, 56, 42);
      const h = Math.max(a, b);
      return grey(h, 0.55 + h * 0.5);
    },
  },
  weatherboard: {
    tile: [2.4, 1.2],
    color: 0xf1ead8,
    roughness: 0.72,
    metalness: 0,
    normalStrength: 2.6,
    texel: (u, v) => {
      const f = fract(v * 8);
      const lap = sstep(0.0, 0.1, f);
      const grain = tnoise(u, v, 64, 51) * 0.04;
      return grey(1 - f * 0.9, (0.78 + lap * 0.22) * (0.96 + grain));
    },
  },
  brick: {
    tile: [0.96, 0.69],
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    normalStrength: 2.2,
    texel: (u, v) => {
      const b = blocks(u, v, 8, 4, 61);
      const mortar = 1 - sstep(0.04, 0.09, b.edge);
      const n = tnoise(u, v, 64, 62);
      const l = 0.75 + b.id * 0.3 + n * 0.08;
      return {
        h: (1 - mortar) * (0.8 + n * 0.2),
        r: mortar ? 0.72 * mortar + 0.62 * l * (1 - mortar) : 0.62 * l,
        g: mortar ? 0.69 * mortar + 0.3 * l * (1 - mortar) : 0.3 * l,
        b: mortar ? 0.63 * mortar + 0.24 * l * (1 - mortar) : 0.24 * l,
      };
    },
  },
  bluestone: {
    tile: [2.4, 1.6],
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    normalStrength: 2.4,
    texel: (u, v) => {
      const b = blocks(u, v, 5, 4, 71, 0.35);
      const mortar = 1 - sstep(0.03, 0.07, b.edge);
      const n = tfbm(u, v, 24, 72, 3);
      const l = 0.75 + b.id * 0.4 + n * 0.25;
      return {
        h: (1 - mortar) * (0.6 + n * 0.4),
        r: 0.6 * mortar + 0.27 * l * (1 - mortar),
        g: 0.6 * mortar + 0.3 * l * (1 - mortar),
        b: 0.58 * mortar + 0.35 * l * (1 - mortar),
      };
    },
  },
  limestone: {
    tile: [2.4, 1.8],
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0,
    normalStrength: 1.4,
    texel: (u, v) => {
      const b = blocks(u, v, 4, 3, 81);
      const joint = 1 - sstep(0.015, 0.04, b.edge);
      const n = tfbm(u, v, 16, 82, 3);
      const l = 0.9 + b.id * 0.12 + n * 0.1 - joint * 0.3;
      return { h: (1 - joint) * (0.8 + n * 0.2), r: 0.9 * l, g: 0.85 * l, b: 0.72 * l };
    },
  },
  plaster: {
    tile: [3, 3],
    color: 0xe8e0cf,
    roughness: 0.85,
    metalness: 0,
    normalStrength: 0.6,
    texel: (u, v) => {
      const n = tfbm(u, v, 24, 91);
      return grey(n, 0.9 + n * 0.12);
    },
  },
  corrugated: {
    tile: [1.2, 2.4],
    color: 0x9aa0a4,
    roughness: 0.5,
    metalness: 0.55,
    normalStrength: 3,
    texel: (u, v) => {
      const s = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
      const stain = tfbm(u, v, 6, 101, 3);
      return grey(s, 0.8 + s * 0.14 + stain * 0.1);
    },
  },
  rooftile: {
    tile: [1.8, 1.8],
    color: 0x9a4a32,
    roughness: 0.8,
    metalness: 0,
    normalStrength: 2.6,
    texel: (u, v) => {
      const row = fract(v * 6);
      const col = Math.sin(u * Math.PI * 2 * 6) * 0.5 + 0.5;
      const n = tnoise(u, v, 48, 111);
      return grey(row * 0.6 + col * 0.4, 0.72 + row * 0.2 + n * 0.14);
    },
  },
  slate: {
    tile: [1.8, 1.8],
    color: 0x565c66,
    roughness: 0.6,
    metalness: 0.05,
    normalStrength: 1.8,
    texel: (u, v) => {
      const b = blocks(u, v, 9, 6, 121);
      const f = fract(v * 9);
      return grey(f * 0.7 + (1 - sstep(0.02, 0.06, b.edge)) * -0.3 + 0.3, 0.75 + b.id * 0.3);
    },
  },
  timber: {
    tile: [1.6, 1.6],
    color: 0x8a6a48,
    roughness: 0.8,
    metalness: 0,
    normalStrength: 1.6,
    texel: (u, v) => {
      const plank = Math.floor(u * 8);
      const edge = Math.min(fract(u * 8), 1 - fract(u * 8));
      const grain = tnoise(u * 8, v * 0.5 + hash(plank, 3, 131), 16, 132);
      return grey(sstep(0, 0.06, edge), (0.75 + hash(plank, 1, 133) * 0.25) * (0.88 + grain * 0.2) * (0.7 + sstep(0, 0.05, edge) * 0.3));
    },
  },
  grass: {
    tile: [6, 6],
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    normalStrength: 1.4,
    texel: (u, v) => {
      const blades = tnoise(u, v, 128, 141);
      const clump = tfbm(u, v, 8, 142, 3);
      return grey(blades * 0.5 + clump * 0.5, 0.74 + blades * 0.22 + clump * 0.16);
    },
  },
  sand: {
    tile: [4, 4],
    color: 0xd9c9a0,
    roughness: 0.96,
    metalness: 0,
    normalStrength: 1,
    texel: (u, v) => {
      const ripple = Math.sin((v + tnoise(u, v, 6, 151) * 0.12) * Math.PI * 2 * 14) * 0.5 + 0.5;
      const n = tnoise(u, v, 96, 152);
      return grey(ripple * 0.6 + n * 0.3, 0.86 + n * 0.14);
    },
  },
  foliage: {
    tile: [3, 3],
    color: 0x4c7a3a,
    roughness: 0.9,
    metalness: 0,
    normalStrength: 2,
    texel: (u, v) => {
      const leaf = Math.max(tnoise(u, v, 20, 161), tnoise(u, v, 40, 162));
      return grey(leaf, 0.55 + leaf * 0.6);
    },
  },
  bark: {
    tile: [1, 2],
    color: 0x5c4a3a,
    roughness: 0.95,
    metalness: 0,
    normalStrength: 2.4,
    texel: (u, v) => {
      const n = tnoise(u * 2, v * 0.3, 24, 171);
      return grey(n, 0.6 + n * 0.5);
    },
  },
  cloth: {
    tile: [0.5, 0.5],
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    normalStrength: 0.8,
    size: 128,
    texel: (u, v) => {
      const weave = (Math.sin(u * Math.PI * 2 * 24) * Math.sin(v * Math.PI * 2 * 24)) * 0.5 + 0.5;
      return grey(weave, 0.9 + weave * 0.1);
    },
  },
  glass: { tile: [0, 0], color: 0x223038, roughness: 0.08, metalness: 0.4 },
  metal: { tile: [0, 0], color: 0x8a8d90, roughness: 0.45, metalness: 0.9 },
  paintedMetal: { tile: [0, 0], color: 0xd8d8d4, roughness: 0.5, metalness: 0.3 },
  skin: { tile: [0, 0], color: 0xd9a988, roughness: 0.7, metalness: 0 },
  rubber: { tile: [0, 0], color: 0x161616, roughness: 0.9, metalness: 0 },
  chrome: { tile: [0, 0], color: 0xe2e4e6, roughness: 0.14, metalness: 1 },
  carpaint: { tile: [0, 0], color: 0xaa2222, roughness: 0.32, metalness: 0.55 },
  plain: { tile: [0, 0], color: 0xffffff, roughness: 0.8, metalness: 0 },
};

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
}

/** Replace a surface's procedural maps with loaded ones (photo textures). Call before materials are made. */
export function installSurfaceMaps(kind: SurfaceKind, maps: SurfaceMaps, tile: [number, number], naturalColour: boolean) {
  const def = SURFACES[kind];
  if (!def) return;
  def.tile = tile;
  // True-colour photographs carry their own colour, and their own roughness when a map is supplied.
  if (naturalColour) {
    def.designColor = def.color;
    def.color = 0xffffff;
  }
  if (maps.roughnessMap) {
    def.designRoughness = def.roughness;
    def.roughness = 1;
  }
  cache.set(kind, maps);
}

const cache = new Map<SurfaceKind, SurfaceMaps | null>();

export function surfaceMaps(kind: SurfaceKind, anisotropy: number): SurfaceMaps | null {
  if (cache.has(kind)) return cache.get(kind)!;
  const def = SURFACES[kind];
  if (!def.texel) {
    cache.set(kind, null);
    return null;
  }
  const size = def.size ?? 256;
  const heights = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = def.texel((x + 0.5) / size, (y + 0.5) / size);
      const i = y * size + x;
      heights[i] = t.h;
      albedo[i * 4] = t.r * 255;
      albedo[i * 4 + 1] = t.g * 255;
      albedo[i * 4 + 2] = t.b * 255;
      albedo[i * 4 + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const strength = (def.normalStrength ?? 1) * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = heights[y * size + ((x + size - 1) % size)];
      const r = heights[y * size + ((x + 1) % size)];
      const u = heights[((y + size - 1) % size) * size + x];
      const d = heights[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      normal[i] = (nx * inv * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      normal[i + 2] = (inv * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const toTexture = (data: Uint8ClampedArray, srgb: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / def.tile[0], 1 / def.tile[1]);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = anisotropy;
    return tex;
  };
  const maps = { map: toTexture(albedo, true), normalMap: toTexture(normal, false) };
  cache.set(kind, maps);
  return maps;
}

/** A square RGBA byte DataTexture with the house settings: repeat wrap, trilinear mipmaps, no colour space. */
export function dataTexture(data: Uint8Array<ArrayBuffer>, size: number, anisotropy = 1): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable landform noise for the terrain shaders (world/ground.ts), sampled at several scales:
 *   RG  slope of a "spurs and gullies" height field (smooth tops, V-shaped creases), as a normal offset
 *   B   that height (0 in the gully floors)
 *   A   independent blotchy noise for colour mottling and for breaking up blends
 */
export function groundNoiseTexture(anisotropy = 4): THREE.DataTexture {
  const size = 256;
  const height = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let h = 0;
      let amp = 0.5;
      let period = 3;
      for (let o = 0; o < 4; o++) {
        h += amp * Math.abs(tnoise(u, v, period, 301 + o * 13) * 2 - 1);
        amp *= 0.5;
        period *= 2;
      }
      height[y * size + x] = Math.min(1, h * 1.9);
      data[(y * size + x) * 4 + 3] = Math.min(255, Math.max(0, (tfbm(u, v, 5, 337, 4) - 0.5) * 1.9 + 0.5) * 255);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (i: number, j: number) => height[((j + size) % size) * size + ((i + size) % size)];
      const i = (y * size + x) * 4;
      // Slope per texel × 14 keeps the steepest creases inside the 0..1 range.
      data[i] = Math.min(255, Math.max(0, 127.5 - (at(x + 1, y) - at(x - 1, y)) * 14 * 127.5));
      data[i + 1] = Math.min(255, Math.max(0, 127.5 - (at(x, y + 1) - at(x, y - 1)) * 14 * 127.5));
      data[i + 2] = height[y * size + x] * 255;
    }
  }
  return dataTexture(data, size, anisotropy);
}

/**
 * Tileable water surface for the water shader: RG = surface slope, B = height, A = a foam / sparkle noise.
 * A sum of travelling-wave trains with whole-number wave vectors, so the tile repeats without a seam.
 */
export function waterNormalTexture(anisotropy = 4): THREE.DataTexture {
  const size = 256;
  const waves: { kx: number; ky: number; amp: number; phase: number; sharp: number }[] = [];
  let seed = 7;
  const rnd = () => hash(seed++, 91, 5);
  for (let i = 0; i < 26; i++) {
    // Mostly one way (the wind), spread ±60°, wavelengths from the whole tile down to a twentieth of it.
    const k = 1 + Math.floor(Math.pow(rnd(), 1.6) * 19);
    const angle = (rnd() - 0.5) * 2.1;
    const kx = Math.round(Math.cos(angle) * k);
    const ky = Math.round(Math.sin(angle) * k);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, amp: 1 / Math.pow(Math.hypot(kx, ky), 1.15), phase: rnd() * Math.PI * 2, sharp: rnd() });
  }
  const height = new Float32Array(size * size);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      let h = 0;
      for (const w of waves) {
        const s = Math.sin(w.kx * u + w.ky * v + w.phase);
        // Peaked crests, flat troughs.
        h += w.amp * (w.sharp > 0.5 ? 1 - Math.abs(s) * 2 : s);
      }
      height[y * size + x] = h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const data = new Uint8Array(size * size * 4);
  const scale = 1 / (hi - lo);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (i: number, j: number) => (height[((j + size) % size) * size + ((i + size) % size)] - lo) * scale;
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, Math.max(0, 127.5 - (at(x + 1, y) - at(x - 1, y)) * 9 * 127.5));
      data[i + 1] = Math.min(255, Math.max(0, 127.5 - (at(x, y + 1) - at(x, y - 1)) * 9 * 127.5));
      data[i + 2] = at(x, y) * 255;
      data[i + 3] = tfbm((x + 0.5) / size, (y + 0.5) / size, 12, 353, 3) * 255;
    }
  }
  return dataTexture(data, size, anisotropy);
}

/** A cell of the road-marking atlas: [u0, v0, u1, v1], v up (v1 is the top of the picture). */
export type AtlasCell = readonly [number, number, number, number];

export interface RoadAtlas {
  texture: THREE.Texture;
  cells: Record<'stop' | 'give' | 'way' | 'bus' | 'school' | 'manhole' | 'sump' | 'toby' | 'pit', AtlasCell>;
}

const ATLAS_W = 1024;
const ATLAS_H = 512;
/** Pixel rectangles [x, y, w, h] of the atlas cells (y down), shared by the drawing code and the UVs. */
const ATLAS_RECTS = {
  stop: [4, 4, 300, 150],
  give: [312, 4, 300, 150],
  way: [620, 4, 240, 150],
  bus: [4, 162, 240, 150],
  school: [252, 162, 460, 150],
  manhole: [4, 320, 184, 184],
  sump: [196, 320, 124, 184],
  toby: [328, 320, 72, 72],
  pit: [408, 320, 200, 136],
} as const;

/** UV rectangles of the road-marking atlas (no canvas needed, so the road mesher can be tested headless). */
export function roadAtlasCells(): RoadAtlas['cells'] {
  const cells = {} as Record<keyof typeof ATLAS_RECTS, AtlasCell>;
  for (const [name, [x, y, w, h]] of Object.entries(ATLAS_RECTS) as [keyof typeof ATLAS_RECTS, readonly [number, number, number, number]][]) {
    // Half a texel in from the edge, so a neighbouring cell never bleeds in.
    cells[name] = [(x + 1) / ATLAS_W, 1 - (y + h - 1) / ATLAS_H, (x + w - 1) / ATLAS_W, 1 - (y + 1) / ATLAS_H];
  }
  return cells;
}

/**
 * What is painted on, or let into, a road: the stretched block capitals of road lettering (white in the
 * alpha channel, coloured by the mesh), and the cast iron in the carriageway: manhole lid, sump grating,
 * a water toby, a telephone pit lid (true colour).
 */
export function roadMarkingAtlas(anisotropy = 8): RoadAtlas {
  const texture = canvasTexture(ATLAS_W, ATLAS_H, (g) => {
    g.clearRect(0, 0, ATLAS_W, ATLAS_H);
    const word = (text: string, rect: readonly [number, number, number, number]) => {
      const [x, y, w, h] = rect;
      g.save();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.font = '900 100px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      const m = g.measureText(text);
      const tw = m.width;
      const th = m.actualBoundingBoxAscent || 72;
      // Letters fill the cell: road lettering is drawn tall so it reads from a driver's low angle.
      g.translate(x + w / 2, y + h - 6);
      g.scale((w - 14) / tw, (h - 12) / th);
      g.fillText(text, 0, 0);
      g.restore();
    };
    word('STOP', ATLAS_RECTS.stop);
    word('GIVE', ATLAS_RECTS.give);
    word('WAY', ATLAS_RECTS.way);
    word('BUS', ATLAS_RECTS.bus);
    word('SCHOOL', ATLAS_RECTS.school);

    // Cast iron: dark, a little rusty, polished on the raised pattern where tyres run over it.
    const iron = (x: number, y: number, w: number, h: number, seed: number) => {
      const img = g.getImageData(x, y, w, h);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const k = (j * w + i) * 4;
          if (img.data[k + 3] === 0) continue;
          const n = tnoise(i / w, j / h, 6, seed) * 0.6 + hash(i, j, seed) * 0.4;
          const rust = sstep(0.45, 0.75, tnoise(i / w, j / h, 3, seed + 5));
          const l = img.data[k] / 255;
          img.data[k] = 255 * l * (0.8 + n * 0.3) * (1 + rust * 0.22);
          img.data[k + 1] = 255 * l * (0.8 + n * 0.3) * (1 - rust * 0.04);
          img.data[k + 2] = 255 * l * (0.8 + n * 0.3) * (1 - rust * 0.2);
        }
      }
      g.putImageData(img, x, y);
    };
    {
      // Manhole: frame, lid, a ring of raised lozenges, two lifting slots.
      const [x, y, w] = ATLAS_RECTS.manhole;
      const cx = x + w / 2;
      const cy = y + w / 2;
      const r = w / 2 - 2;
      g.fillStyle = '#4a4744';
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1c1a19';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#5c5955';
      for (let ring = 1; ring <= 3; ring++) {
        const rr = r * 0.22 * ring;
        const count = ring * 8;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + ring * 0.3;
          g.save();
          g.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          g.rotate(a);
          g.fillRect(-r * 0.045, -r * 0.075, r * 0.09, r * 0.15);
          g.restore();
        }
      }
      g.fillStyle = '#141312';
      g.fillRect(cx - r * 0.72, cy - 4, r * 0.16, 8);
      g.fillRect(cx + r * 0.56, cy - 4, r * 0.16, 8);
      iron(x, y, w, w, 411);
    }
    {
      // Sump grating in the channel: a frame and bars across the flow, black between them.
      const [x, y, w, h] = ATLAS_RECTS.sump;
      g.fillStyle = '#44413e';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#0c0b0a';
      const bars = 9;
      const pitch = (h - 16) / bars;
      for (let i = 0; i < bars; i++) g.fillRect(x + 10, y + 8 + i * pitch + pitch * 0.22, w - 20, pitch * 0.56);
      g.fillStyle = '#44413e';
      g.fillRect(x + w / 2 - 4, y + 6, 8, h - 12);
      iron(x, y, w, h, 421);
    }
    {
      // Water toby: a small square lid.
      const [x, y, w, h] = ATLAS_RECTS.toby;
      g.fillStyle = '#4c4a47';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#1a1918';
      g.lineWidth = 4;
      g.strokeRect(x + 8, y + 8, w - 16, h - 16);
      g.fillStyle = '#625f5a';
      g.fillRect(x + 24, y + 30, w - 48, 12);
      iron(x, y, w, h, 431);
    }
    {
      // Telephone pit: two concrete lids in a steel frame.
      const [x, y, w, h] = ATLAS_RECTS.pit;
      g.fillStyle = '#5a5651';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#a39e94';
      g.fillRect(x + 7, y + 7, w / 2 - 10, h - 14);
      g.fillRect(x + w / 2 + 3, y + 7, w / 2 - 10, h - 14);
      g.fillStyle = '#2a2826';
      for (const px of [x + w * 0.25, x + w * 0.75]) g.fillRect(px - 9, y + h / 2 - 3, 18, 6);
      iron(x, y, w, h, 441);
    }
  });
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, cells: roadAtlasCells() };
}

/** Small canvas helper for bespoke textures (windows, signs, decals). */
export function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}
