import { decodeTexture, surfaceUrl } from '../render/textureAssets';
import { onPhone } from '../render/quality';
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/math';
import { mix3, type V3 } from '../core/vec3';
import { packCell } from './mapsource';
import { fbm } from '../core/rng';
import type { District, Environment, GfxApi } from '../core/types';
import { patchable } from '../render/materials';
import { groundNoiseTexture, waterNormalTexture } from '../render/textures';
import { SEA_LEVEL, WORLD_BOUNDS, type RiverPath } from './height';
import type { CompiledMap } from './map';

/**
 * How the land and the water look: what every patch of ground is made of (`Ground.shade`), the terrain
 * materials that turn that into pasture, tussock, shingle, sand and rock, and the sea and river surfaces.
 *
 * The terrain carries, per vertex, two colours (one for whatever grows there, one for bare mineral ground)
 * and the weights of seven photographic layers. A vertex colour is the *average albedo* wanted: each
 * layer is divided by its own average in the shader, so only the variation inside the photograph is
 * used and the distant terrain (no textures) matches the near terrain exactly. The paddock patchwork of
 * the plains is worked out per pixel from world position, so fence lines stay crisp at any distance and
 * agree with the fences and stock that scatter/rural.ts places on the same 190 x 150 m grid.
 */


/** Albedo as an sRGB hex colour (what a grey card beside it would read, not how bright it looks in the sun). */
const tone = (hex: number): V3 => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const glsl = (c: V3) => `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;

// A dry nor'west summer: irrigated green only where someone is paying for water.
const C = {
  lawn: tone(0x5c683a),
  lawnDry: tone(0x78744a),
  park: tone(0x566038),
  bank: tone(0x505a36),
  tussock: tone(0x8a764a),
  tussockShade: tone(0x766a40),
  rough: tone(0x827c56),
  marram: tone(0x8c8a64),
  scrub: tone(0x545e3c),
  rock: tone(0x5e5850),
  scree: tone(0x625e58),
  shingle: tone(0x777773),
  shingleWet: tone(0x4c4e4e),
  riverBed: tone(0x5c625c),
  streamBed: tone(0x383e2a),
  sand: tone(0xa2967a),
  sandWet: tone(0x685e4c),
  gravelBeach: tone(0x76746e),
  shoreRock: tone(0x524e48),
  seabed: tone(0x504e40),
  shoulder: tone(0x746e64),
  yard: tone(0x706658),
  ballast: tone(0x64605a),
  hard: tone(0x7c7a74),
  hardDark: tone(0x545456),
  hardPale: tone(0x8c867c),
  // Paddocks (used by the shader).
  pGreen: tone(0x64723e),
  pDry: tone(0x888468),
  pIrrigated: tone(0x566a3a),
  pHay: tone(0x8f8a6c),
  pWheat: tone(0x968760),
  pStubble: tone(0x9c9478),
  pPloughed: tone(0x5c4c3c),
  pLucerne: tone(0x3e5c32),
  pBrassica: tone(0x4c6854),
  pFence: tone(0x7c7852),
  crag: tone(0x5a5046),
};

/** Mown grass beside the footpath, as material colours for the neutral grass photograph (roadmesh.ts). */
export function bermColour(park: boolean): THREE.Color {
  const c = park ? mix3(C.park, C.lawn, 0.3) : mix3(C.lawn, C.lawnDry, 0.35);
  // The photograph's own average is 0.565 (linear).
  return new THREE.Color(c[0] / 0.565, c[1] / 0.565, c[2] / 0.565);
}

/** Deep-water body colours (what the water scatters back; the sky reflection is added by the lighting). */
const WATER = {
  sea: tone(0x283e44),
  harbour: tone(0x1c3a30),
  milky: tone(0x6c8a8c),
  stream: tone(0x2e3a28),
};

// ───────────────────────────── Photographic layers ─────────────────────────────

interface LayerDef {
  col: string;
  nor: string;
  rgh?: string;
  /** Metres per repeat, roughness when there is no roughness map, normal strength. */
  tile: number;
  rough: number;
  bump: number;
  /** How much of the photograph's own colour variation is kept (default all of it). */
  keep?: number;
}

/** Order is fixed: the shader refers to layers by index. */
const LAYERS: LayerDef[] = [
  { col: 'grass_col', nor: 'grass_nor', rgh: 'grass_rgh', tile: 2, rough: 0.92, bump: 0.8 }, // 0 mown / grazed grass
  { col: 'ground/dry_col', nor: 'ground/dry_nor', tile: 2.4, rough: 0.95, bump: 0.9 }, // 1 long dry grass
  { col: 'ground/soil_col', nor: 'ground/soil_nor', tile: 2.2, rough: 0.97, bump: 1.0 }, // 2 soil
  { col: 'shingle_col', nor: 'shingle_nor', rgh: 'shingle_rgh', tile: 1.9, rough: 0.9, bump: 1.1, keep: 0.5 }, // 3 river shingle
  { col: 'sand_col', nor: 'sand_nor', rgh: 'sand_rgh', tile: 2, rough: 0.96, bump: 0.6 }, // 4 sand
  { col: 'ground/rock_col', nor: 'ground/rock_nor', tile: 3.6, rough: 0.9, bump: 1.4 }, // 5 rock
  { col: 'concrete_col', nor: 'concrete_nor', rgh: 'concrete_rgh', tile: 3, rough: 0.88, bump: 0.5 }, // 6 hardstand
  // The photograph is of fine pea gravel: laid at more than twice its true size it is 20 mm road metal.
  { col: 'gravel_col', nor: 'gravel_nor', rgh: 'gravel_rgh', tile: 4.6, rough: 0.94, bump: 1.0 }, // 7 road metal: shoulders, yards, ballast
];
const L_DRY = 0;
const L_SOIL = 1;
const L_SHINGLE = 2;
const L_SAND = 3;
const L_ROCK = 4;
const L_HARD = 5;
const L_GRAVEL = 6;

async function pixels(name: string, size: number): Promise<Uint8ClampedArray> {
  const url = surfaceUrl(`${name}.jpg`);
  if (!url) throw new Error(`ground layer "${name}" is not in the bundle`);
  return decodeTexture(async () => {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    return g.getImageData(0, 0, size, size).data;
  });
}

function arrayTexture(data: Uint8Array<ArrayBuffer>, size: number, depth: number, srgb: boolean, anisotropy: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, depth);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = size > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = size > 1;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ───────────────────────────── Rivers ─────────────────────────────

interface RiverAt {
  river: RiverPath;
  /** Distance from the centreline, distance along it, signed offset across it, bank height there. */
  d: number;
  s: number;
  lateral: number;
  y: number;
  tx: number;
  tz: number;
}

/** Nearest river to a point (same choice as the terrain model makes when it carves the bed). */
class RiverField {
  private cells = new Map<number, { river: RiverPath; i: number }[]>();
  private readonly RC = 128;
  private hit: RiverAt = { river: null as unknown as RiverPath, d: 0, s: 0, lateral: 0, y: 0, tx: 1, tz: 0 };

  constructor(rivers: RiverPath[]) {
    for (const river of rivers) {
      river.samples.forEach((s, i) => {
        const reach = Math.ceil((river.width * 0.5 + 40) / this.RC);
        const cx = Math.floor(s.x / this.RC);
        const cz = Math.floor(s.z / this.RC);
        for (let a = -reach; a <= reach; a++) {
          for (let b = -reach; b <= reach; b++) {
            const key = packCell(cx + a, cz + b);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push({ river, i });
          }
        }
      });
    }
  }

  /** The result object is reused: read it before the next call. */
  at(x: number, z: number): RiverAt | null {
    const list = this.cells.get(packCell(Math.floor(x / this.RC), Math.floor(z / this.RC)));
    if (!list) return null;
    let found = false;
    let bestScore = Infinity;
    const hit = this.hit;
    for (const { river, i } of list) {
      const a = river.samples[i];
      const b = river.samples[Math.min(river.samples.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      const half = river.width * 0.5;
      if (d < half + 30 && d - half < bestScore) {
        bestScore = d - half;
        found = true;
        hit.river = river;
        hit.d = d;
        hit.s = lerp(a.s, b.s, t);
        hit.lateral = (x - px) * a.tz - (z - pz) * a.tx;
        hit.y = lerp(a.y, b.y, t);
        hit.tx = a.tx;
        hit.tz = a.tz;
      }
    }
    return found ? hit : null;
  }
}

// ───────────────────────────── Per-vertex ground description ─────────────────────────────

/** Vertex attributes the terrain materials read. */
export class GroundAttributes {
  /** Colour of what grows (premultiplied by its weight), colour of bare ground (premultiplied likewise). */
  readonly color: Float32Array;
  readonly mineral: Float32Array;
  /** Layer weights: [dry grass, soil, shingle, sand], [rock, hardstand, paddock, wet], [relief, road metal, -, -]. */
  readonly a: Uint8Array;
  readonly b: Uint8Array;
  readonly c: Uint8Array;

  constructor(readonly count: number) {
    this.color = new Float32Array(count * 3);
    this.mineral = new Float32Array(count * 3);
    this.a = new Uint8Array(count * 4);
    this.b = new Uint8Array(count * 4);
    this.c = new Uint8Array(count * 4);
  }

  copy(from: number, to: number) {
    for (let i = 0; i < 3; i++) {
      this.color[to * 3 + i] = this.color[from * 3 + i];
      this.mineral[to * 3 + i] = this.mineral[from * 3 + i];
    }
    for (let i = 0; i < 4; i++) {
      this.a[to * 4 + i] = this.a[from * 4 + i];
      this.b[to * 4 + i] = this.b[from * 4 + i];
      this.c[to * 4 + i] = this.c[from * 4 + i];
    }
  }

  /** Buffer attributes (share them between the levels of detail of one chunk). */
  attributes(): Record<string, THREE.BufferAttribute> {
    return {
      color: new THREE.BufferAttribute(this.color, 3),
      gmin: new THREE.BufferAttribute(this.mineral, 3),
      gndA: new THREE.BufferAttribute(this.a, 4, true),
      gndB: new THREE.BufferAttribute(this.b, 4, true),
      gndC: new THREE.BufferAttribute(this.c, 4, true),
    };
  }
}

/** Running blend while one vertex is worked out: everything stays a weighted sum that adds up to one. */
class Blend {
  vr = 0;
  vg = 0;
  vb = 0;
  mr = 0;
  mg = 0;
  mb = 0;
  /** Weight left to the paddock pattern (the shader fills it in). */
  pad = 0;
  /** dry, soil, shingle, sand, rock, hard, road metal. */
  w = [0, 0, 0, 0, 0, 0, 0];
  wet = 0;
  relief = 0;

  reset(pad: number) {
    this.vr = this.vg = this.vb = this.mr = this.mg = this.mb = 0;
    this.pad = pad;
    this.w.fill(0);
    this.wet = 0;
    this.relief = 0;
  }

  private fade(k: number) {
    this.vr *= k;
    this.vg *= k;
    this.vb *= k;
    this.mr *= k;
    this.mg *= k;
    this.mb *= k;
    this.pad *= k;
    for (let i = 0; i < this.w.length; i++) this.w[i] *= k;
  }

  /** Lay vegetation over what is there: `dry` is how much of it is long dry grass rather than turf. */
  veg(t: number, c: V3, dry: number, shade = 1) {
    if (t <= 0) return;
    if (t > 1) t = 1;
    this.fade(1 - t);
    this.vr += c[0] * t * shade;
    this.vg += c[1] * t * shade;
    this.vb += c[2] * t * shade;
    this.w[L_DRY] += t * dry;
  }

  /** Lay bare ground over what is there, as one layer or a mix of two. */
  bare(t: number, c: V3, layer: number, shade = 1, second = -1, share = 0) {
    if (t <= 0) return;
    if (t > 1) t = 1;
    this.fade(1 - t);
    this.mr += c[0] * t * shade;
    this.mg += c[1] * t * shade;
    this.mb += c[2] * t * shade;
    this.w[layer] += t * (1 - share);
    if (second >= 0) this.w[second] += t * share;
  }
}

// ───────────────────────────── Shaders ─────────────────────────────

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec3 gmin;
attribute vec4 gndA;
attribute vec4 gndB;
attribute vec4 gndC;
varying vec3 vGndW;
varying vec3 vGndN;
varying vec3 vGndMin;
varying vec4 vGndA;
varying vec4 vGndB;
varying vec4 vGndC;`;

const TERRAIN_VERT_MAIN = /* glsl */ `
vGndW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGndN = normalize(mat3(modelMatrix) * objectNormal);
vGndMin = gmin;
vGndA = gndA;
vGndB = gndB;
vGndC = gndC;`;

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform sampler2D uGndNoise;
uniform vec3 uGndNear;
uniform float uGndWet;
varying vec3 vGndW;
varying vec3 vGndN;
varying vec3 vGndMin;
varying vec4 vGndA;
varying vec4 vGndB;
varying vec4 vGndC;

// The same integer hashing as core/rng.ts (hashInts + Rng.next), so a paddock gets the crop here that
// suits what scatter/rural.ts stands in it.
uint gndStir(uint h, uint v) { h ^= v; h *= 16777619u; return h ^ (h >> 15); }
float gndRand(ivec2 c, uint salt) {
  uint h = gndStir(gndStir(gndStir(2166136261u, uint(c.x)), uint(c.y)), salt);
  uint t = h + 1831565813u;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return float(t ^ (t >> 14)) * 2.3283064365386963e-10;
}
// Drill rows, windrows, furrows: fade out before they are finer than a pixel.
float gndRows(float c, float cw, float period) {
  return sin(c * 6.2831853 / period) * (1.0 - smoothstep(0.18, 0.5, cw / period));
}
// Paddock patchwork of the plains: 190 x 150 m blocks.
void gndPaddock(vec2 xz, vec2 fw, out vec3 tint, out float dry, out float soil) {
  vec2 g = (xz + vec2(5000.0, 9000.0)) / vec2(190.0, 150.0);
  vec2 cell = floor(g);
  vec2 f = g - cell;
  ivec2 ic = ivec2(cell);
  float use = gndRand(ic, 7919u);
  float v = gndRand(ic, 4177u);
  float w = fract(v * 61.7);
  bool alongX = fract(v * 7.3) > 0.5;
  float c = alongX ? xz.y : xz.x;
  float cw = alongX ? fw.y : fw.x;
  float rows = 0.0;
  dry = 0.0;
  soil = 0.0;
  if (use < 0.44) {
    // Sheep country: from still-green to browned right off.
    float d = smoothstep(0.08, 0.8, v);
    tint = mix(${glsl(C.pGreen)}, ${glsl(C.pDry)}, d);
    dry = d * 0.85;
  } else if (use < 0.52) {
    // Cattle on irrigated grass: border-dyke strips.
    tint = ${glsl(C.pIrrigated)} * (0.92 + 0.16 * w);
    rows = gndRows(c, cw, 13.0) * 0.07;
  } else if (use < 0.64) {
    // Hay, cut and baled.
    tint = ${glsl(C.pHay)} * (0.95 + 0.1 * w);
    dry = 0.7;
    rows = gndRows(c, cw, 4.6) * 0.06;
  } else if (use < 0.75) {
    // Wheat or barley, ripe.
    tint = ${glsl(C.pWheat)} * (0.94 + 0.12 * w);
    dry = 1.0;
    rows = gndRows(c, cw, 2.2) * 0.04;
  } else if (use < 0.83) {
    // Stubble.
    tint = ${glsl(C.pStubble)} * (0.95 + 0.1 * w);
    dry = 1.0;
    rows = gndRows(c, cw, 1.5) * 0.09;
  } else if (use < 0.9) {
    // Fresh-ploughed.
    tint = ${glsl(C.pPloughed)} * (0.9 + 0.2 * w);
    soil = 1.0;
    rows = gndRows(c, cw, 1.1) * 0.13;
  } else if (use < 0.96) {
    tint = ${glsl(C.pLucerne)} * (0.94 + 0.12 * w);
  } else {
    // Fodder brassica.
    tint = ${glsl(C.pBrassica)};
    rows = gndRows(c, cw, 0.9) * 0.07;
  }
  tint *= 1.0 + rows * 1.7;
  // Rank grass left along the fence lines.
  vec2 e = min(f, 1.0 - f) * vec2(190.0, 150.0);
  float fwm = max(fw.x, fw.y);
  float strip = (1.0 - smoothstep(0.6, 1.8 + fwm, min(e.x, e.y))) * clamp(2.6 / (1.0 + fwm), 0.0, 1.0);
  tint = mix(tint, ${glsl(C.pFence)}, strip);
  dry = mix(dry, 1.0, strip);
  soil *= 1.0 - strip;
}`;

/** Shared start of both terrain fragment shaders: noise, paddocks, the two colours and their split. */
const TERRAIN_FRAG_COMMON = (far: boolean) => /* glsl */ `
vec2 gXZ = vGndW.xz;
${far ? 'if (distance(gXZ, uGndNear.xy) < uGndNear.z) discard;' : ''}
float gDist = length(vViewPosition);
vec2 gDx = dFdx(gXZ);
vec2 gDy = dFdy(gXZ);
vec2 gFw = abs(gDx) + abs(gDy);
vec4 gN1 = texture2D(uGndNoise, gXZ / 380.0);
vec4 gN2 = texture2D(uGndNoise, gXZ / 83.0 + vec2(0.37, 0.11));
${far ? 'float gFine = 0.5;' : 'float gFine = texture2D(uGndNoise, gXZ / 9.0 + vec2(0.71, 0.53)).a;'}
float gPad = vGndB.z;
vec3 gPadTint = vec3(0.0);
float gPadDry = 0.0;
float gPadSoil = 0.0;
if (gPad > 0.003) gndPaddock(gXZ, gFw, gPadTint, gPadDry, gPadSoil);
float gB = vGndA.y + vGndA.z + vGndA.w + vGndB.x + vGndB.y + vGndC.y;
float gA = max(1.0 - gB, 0.0);
vec3 gTintA = (vColor.rgb + gPadTint * gPad) / max(gA, 0.03);
// Pasture is never one colour: it drifts greener and browner in drifts tens of metres across.
gTintA *= mix(vec3(1.1, 1.0, 0.86), vec3(0.88, 1.0, 1.05), smoothstep(0.25, 0.75, gN2.a * 0.6 + gN1.a * 0.4));
vec3 gTintB = vGndMin / max(gB, 0.03);
// Bare ground meets vegetation along a ragged edge rather than a 4 m gradient.
float gCut = 0.16 + 0.68 * clamp(gN2.a * 0.55 + gFine * 0.45, 0.0, 1.0);
float gSB = smoothstep(gCut - 0.13, gCut + 0.13, gB);
float gSA = 1.0 - gSB;
// Hill country seen from a distance: spurs and gullies in the light, scrub in the gully floors,
// rock breaking through on the steeper ground.
float gRelief = vGndC.x;
float gFarK = ${far ? '1.0' : 'smoothstep(70.0, 380.0, gDist)'};
float gGully = gN1.b * 0.62 + gN2.b * 0.38;
float gMottle = gN1.a * 0.45 + gN2.a * 0.55;
float gShade = (0.74 + 0.52 * gMottle) * mix(1.0, 0.7 + 0.52 * gGully, gRelief * gFarK);
// Outcrops: two scales of noise at an angle to each other and a drift by height, so they gather into
// broken bands along a face instead of dotting it evenly. Noise laid out in plan smears into long streaks
// on a face seen side-on, so on steep ground the samples blend over to a side-on projection.
vec3 gNrmC = normalize(vGndN);
float gTilt = 1.0 - gNrmC.y;
float gSideK = smoothstep(0.84, 0.52, gNrmC.y);
vec2 gUpC = abs(gNrmC.x) > abs(gNrmC.z) ? vGndW.zy : vGndW.xy;
float gCragA = gSideK < 0.01 ? gN2.a : mix(gN2.a, texture2D(uGndNoise, gUpC / 83.0 + vec2(0.37, 0.11)).a, gSideK);
float gCragB = texture2D(uGndNoise, (gSideK > 0.5 ? vec2(gUpC.x * 0.8 - gUpC.y * 0.6, gUpC.x * 0.6 + gUpC.y * 0.8) : vec2(gXZ.x * 0.8 - gXZ.y * 0.6, gXZ.x * 0.6 + gXZ.y * 0.8)) / 233.0).a;
float gCragN = gCragA * 0.6 + gCragB * 0.4;
// Broken up at the scale of a single bluff, and gathered on the steeper ground where soil will not hold.
float gCrag21 = gSideK < 0.01 ? texture2D(uGndNoise, gXZ / 21.0 + 0.3).a : mix(texture2D(uGndNoise, gXZ / 21.0 + 0.3).a, texture2D(uGndNoise, gUpC / 21.0 + 0.3).a, gSideK);
gCragN += (gN1.a - 0.5) * 0.3 + (gCrag21 - 0.5) * 0.2 + (gFine - 0.5) * 0.1 + gTilt * 0.55 - 0.06;
float gCrag = smoothstep(0.7, 0.725, gCragN + (gRelief - 1.0) * 0.3) * smoothstep(0.3, 0.7, gRelief);
vec2 gBend = ((gN1.xy - 0.5) * 1.5 + (gN2.xy - 0.5) * 0.9) * gRelief * gFarK;
`;

const TERRAIN_FRAG_NEAR = /* glsl */ `
${TERRAIN_FRAG_COMMON(false)}
float gInvA = gSA / max(gA, 0.03);
float gInvB = gSB / max(gB, 0.03);
float gKeep = 1.0 - gCrag;
float wDry = (vGndA.x + gPad * gPadDry) * gInvA;
float wSoilA = gPad * gPadSoil * gInvA;
float wGrass = max(gSA - wDry - wSoilA, 0.0);
float wSoilB = vGndA.y * gInvB;
float wRock = vGndB.x * gInvB * gKeep;
vec3 gAlb = vec3(0.0);
vec3 gNR = vec3(0.0);
float gNearK = 1.0 - smoothstep(40.0, 85.0, gDist);
gndLayer(0, wGrass * gKeep, gTintA, gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndLayer(1, wDry * gKeep, gTintA, gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndLayer(2, (wSoilA + wSoilB) * gKeep, (gTintA * wSoilA + gTintB * wSoilB) / max(wSoilA + wSoilB, 0.001), gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndLayer(3, vGndA.z * gInvB * gKeep, gTintB, gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndLayer(4, vGndA.w * gInvB * gKeep, gTintB, gXZ, gDx, gDy, gNearK, gAlb, gNR);
float gSteep = smoothstep(0.86, 0.68, normalize(vGndN).y);
vec3 gRockTint = (gTintB * wRock + ${glsl(C.crag)} * gCrag) / max(wRock + gCrag, 0.001);
gndLayer(5, (wRock + gCrag) * (1.0 - gSteep), gRockTint, gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndCliff(5, (wRock + gCrag) * gSteep, gRockTint, vGndW, normalize(vGndN), dFdx(vGndW), dFdy(vGndW), gAlb, gNR);
// Hardstand is laid in slabs: a joint every five metres, no two pours quite the same grey.
float wHard = vGndB.y * gInvB * gKeep;
vec3 gHardTint = gTintB;
if (wHard > 0.01) {
  vec2 gSlab = gXZ / 5.0;
  vec2 gSlabF = fract(gSlab);
  float gPour = fract(sin(dot(floor(gSlab), vec2(12.9898, 78.233))) * 43758.5453);
  float gJoint = min(min(gSlabF.x, 1.0 - gSlabF.x), min(gSlabF.y, 1.0 - gSlabF.y)) * 5.0;
  float gJw = max(gFw.x, gFw.y);
  gHardTint *= (0.94 + 0.12 * gPour) * (1.0 - 0.32 * (1.0 - smoothstep(0.012, 0.03 + gJw, gJoint)) * clamp(0.05 / (0.05 + gJw), 0.0, 1.0));
}
gndLayer(6, wHard, gHardTint, gXZ, gDx, gDy, gNearK, gAlb, gNR);
gndLayer(7, vGndC.y * gInvB * gKeep, gTintB, gXZ, gDx, gDy, gNearK, gAlb, gNR);
// Wet margins (tide line, river edge) and rain: darker and smoother.
float gDamp = smoothstep(0.28, 0.72, vGndB.w + (gFine - 0.5) * 0.22 * step(0.02, vGndB.w));
gAlb *= gShade * mix(1.0, 0.56, gDamp) * (1.0 - 0.2 * uGndWet);
// Sand and shingle the water has just left shine like glass.
gNR.z = mix(gNR.z, 0.16, gDamp * 0.9) * (1.0 - 0.3 * uGndWet);
gBend += gNR.xy * gNearK;
diffuseColor.rgb = gAlb;
`;

const TERRAIN_FRAG_FAR = /* glsl */ `
${TERRAIN_FRAG_COMMON(true)}
vec3 gAlb = mix((gTintA * gSA + gTintB * gSB), ${glsl(C.crag)}, gCrag);
gAlb *= gShade * mix(1.0, 0.6, vGndB.w) * (1.0 - 0.2 * uGndWet);
vec3 gNR = vec3(0.0, 0.0, 1.0);
diffuseColor.rgb = gAlb;
`;

const TERRAIN_LAYER_PARS = /* glsl */ `
uniform sampler2DArray uGndAlbedo;
uniform sampler2DArray uGndNormal;
uniform vec3 uGndInv[${LAYERS.length}];
uniform vec4 uGndPbr[${LAYERS.length}];
void gndLayer(int i, float w, vec3 tint, vec2 xz, vec2 dx, vec2 dy, float nearK, inout vec3 alb, inout vec3 nr) {
  if (w < 0.004) return;
  float s = uGndPbr[i].x;
  float layer = float(i);
  vec3 c = textureGrad(uGndAlbedo, vec3(xz * s, layer), dx * s, dy * s).rgb * uGndInv[i];
  c = mix(vec3(dot(c, vec3(0.3333))), c, uGndPbr[i].w);
  // The same photograph seven times larger and out of focus: blotches that carry on where the fine
  // detail has blurred away, and that hide the repeat.
  float m = s * 0.137;
  vec3 big = textureGrad(uGndAlbedo, vec3(xz * m + 0.5, layer), dx * m * 4.0, dy * m * 4.0).rgb * uGndInv[i];
  alb += w * tint * c * mix(vec3(1.0), big, 0.55);
  if (nearK > 0.0) {
    vec4 n = textureGrad(uGndNormal, vec3(xz * s, layer), dx * s, dy * s);
    nr.xy += w * vec2(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0) * uGndPbr[i].y;
    nr.z += w * mix(uGndPbr[i].z, n.b, nearK);
  } else {
    nr.z += w * uGndPbr[i].z;
  }
}
// A face too steep for a photograph laid flat (cliffs, road cuttings): the rock is projected on from the
// two sides instead, so it does not smear down the slope, and is bedded in rough horizontal courses.
void gndCliff(int i, float w, vec3 tint, vec3 p, vec3 n, vec3 dpx, vec3 dpy, inout vec3 alb, inout vec3 nr) {
  if (w < 0.004) return;
  float s = uGndPbr[i].x * 0.55;
  float layer = float(i);
  vec2 b = pow(abs(n.xz), vec2(4.0));
  b /= max(b.x + b.y, 0.0001);
  vec3 cx = textureGrad(uGndAlbedo, vec3(p.zy * s, layer), dpx.zy * s, dpy.zy * s).rgb;
  vec3 cz = textureGrad(uGndAlbedo, vec3(p.xy * s, layer), dpx.xy * s, dpy.xy * s).rgb;
  vec3 c = (cx * b.x + cz * b.y) * uGndInv[i];
  // Lava flows one on another: courses a few metres thick, each a slightly different stone, a dark
  // weathered joint between them.
  float bed = p.y / 4.6 + texture2D(uGndNoise, p.xz / 140.0).b * 3.4 + texture2D(uGndNoise, p.xz / 17.0).a * 0.5;
  float course = fract(sin(floor(bed) * 78.233) * 43758.5453);
  float joint = 1.0 - smoothstep(0.0, 0.1, abs(fract(bed) - 0.5) * 2.0 - 0.86);
  // Streaks where water runs down the face.
  float run = texture2D(uGndNoise, vec2((p.x + p.z) / 9.0, p.y / 70.0)).a;
  alb += w * tint * c * (0.84 + 0.3 * course) * (1.0 - 0.16 * joint * run) * (0.84 + 0.3 * run);
  nr.z += w * uGndPbr[i].z;
}`;

const TERRAIN_FRAG_NORMAL = /* glsl */ `
normal = normalize(mat3(viewMatrix) * normalize(normalize(vGndN) + vec3(gBend.x, 0.0, gBend.y)));`;

const WATER_VERT_PARS = /* glsl */ `
attribute vec4 wdata;
varying vec3 vWatW;
varying vec4 vWat;`;

const WATER_FRAG_PARS = /* glsl */ `
uniform sampler2D uWatNormal;
uniform float uWatTime;
uniform float uWatRain;
uniform vec2 uWatWind;
uniform vec3 uGndNear;
uniform vec4 uGndBounds;
varying vec3 vWatW;
varying vec4 vWat;`;

/** Surface slope, body colour by depth, and the surf line. */
const WATER_FRAG_MAIN = (far: boolean) => /* glsl */ `
vec2 wXZ = vWatW.xz;
${far ? 'if (distance(wXZ, uGndNear.xy) < uGndNear.z && wXZ.x > uGndBounds.x && wXZ.x < uGndBounds.y && wXZ.y > uGndBounds.z && wXZ.y < uGndBounds.w) discard;' : ''}
float wDist = length(vViewPosition);
float wDepth = vWat.x;
float wSurf = vWat.y;
float wSea = step(0.005, wSurf);
// Rivers carry their ripples downstream; on the sea, chop drifts with the wind over a long swell.
vec2 wMove = vWat.zw * uWatTime;
vec2 wWind = uWatWind * uWatTime * wSea;
vec4 wA = texture2D(uWatNormal, (wXZ - wMove - wWind * 1.1) / 7.3);
vec4 wB = texture2D(uWatNormal, (vec2(wXZ.y, -wXZ.x) - vec2(wMove.y, -wMove.x) * 0.7 - vec2(wWind.y, -wWind.x) * 0.45) / 2.7);
vec2 wSB = wB.xy * 2.0 - 1.0;
vec2 wSlope = (wA.xy * 2.0 - 1.0) * 0.42 + vec2(-wSB.y, wSB.x) * 0.3;
wSlope *= mix(0.5, 1.0, wSurf);
// A spring-fed stream (clear, not the sea, not a braided river) barely ripples: it runs like glass.
float wStream = (1.0 - wSea) * smoothstep(0.25, 0.4, vColor.a);
wSlope *= 1.0 - 0.62 * wStream;
if (wSea > 0.5) {
  // Two swell trains crossing at an angle, so the lines of the wave pattern never read as stripes.
  vec2 wS1 = texture2D(uWatNormal, (wXZ - wWind * 2.6) / 67.0).xy * 2.0 - 1.0;
  vec2 wS2 = texture2D(uWatNormal, (vec2(wXZ.x * 0.8 - wXZ.y * 0.6, wXZ.x * 0.6 + wXZ.y * 0.8) - wWind * 1.9) / 151.0).xy * 2.0 - 1.0;
  wSlope += (wS1 * 0.4 + vec2(wS2.x * 0.8 + wS2.y * 0.6, -wS2.x * 0.6 + wS2.y * 0.8) * 0.4) * wSurf;
}
wSlope /= 1.0 + wDist * 0.0028;
if (uWatRain > 0.01 && wDist < 90.0) wSlope += (texture2D(uWatNormal, wXZ / 0.9 + uWatTime * vec2(0.31, 0.47)).xy * 2.0 - 1.0) * uWatRain * 0.4 * (1.0 - wDist / 90.0);
// Depth: the bed shows through the shallows, and the water takes its own colour as it deepens.
float wClear = max(vColor.a * 4.0, 0.05);
float wT = clamp(wDepth / wClear, 0.0, 1.0);
float wAlpha = (1.0 - (1.0 - wT) * (1.0 - wT)) * 0.96;
vec3 wCol = vColor.rgb * mix(1.6, 1.0, wT);
// A spring-fed stream runs clear over beds of weed that trail and sway in the current, with pale gravel
// showing between them.
float wWeed = 0.0;
if (wStream > 0.01) {
  vec2 wDir = normalize(vWat.zw + vec2(0.0001, 0.0));
  vec2 wSt = vec2(dot(wXZ, vec2(-wDir.y, wDir.x)), dot(wXZ, wDir));
  float wSway = sin(uWatTime * 0.7 + wSt.y * 0.35) * 0.18;
  float wBeds = texture2D(uWatNormal, vec2(wSt.x + wSway, wSt.y * 0.16) / 5.5).a;
  float wStrand = texture2D(uWatNormal, vec2((wSt.x + wSway) * 1.9, wSt.y * 0.07 - uWatTime * 0.004)).a;
  wWeed = smoothstep(0.4, 0.58, wBeds * 0.65 + wStrand * 0.35) * smoothstep(0.12, 0.5, wDepth) * wStream;
  vec3 wGreen = mix(vec3(0.016, 0.034, 0.014), vec3(0.045, 0.085, 0.028), smoothstep(0.35, 0.75, wStrand));
  vec3 wBedCol = vec3(0.1, 0.105, 0.085) * (0.7 + 0.5 * wBeds);
  wCol = mix(mix(wCol, wBedCol, 0.5 * wStream * (1.0 - wT * 0.6)), wGreen, wWeed * 0.8);
  wAlpha = max(wAlpha, wWeed * 0.9);
}
// Surf: a lip of foam that runs up and falls back, and breakers rolling in over the shallows.
float wFoam = 0.0;
if (wSea > 0.5 && wDepth < 3.0) {
  float n = texture2D(uWatNormal, wXZ / 8.0 + vec2(uWatTime * 0.02, 0.0)).a;
  float n2 = texture2D(uWatNormal, wXZ / 31.0 - vec2(0.0, uWatTime * 0.008)).a;
  float lace = texture2D(uWatNormal, wXZ / 1.7 + vec2(uWatTime * 0.05, 0.03)).a;
  float swash = 0.14 + 0.16 * (0.5 + 0.5 * sin(uWatTime * 0.75 + n2 * 9.0 + n * 2.0));
  float lip = (1.0 - smoothstep(0.0, swash, wDepth)) * smoothstep(0.25, 0.6, lace + n * 0.5);
  // Each breaker is a ragged, broken line that fades as it runs up the beach.
  float roll = fract(wDepth * 0.62 + uWatTime * 0.12 + n2 * 1.3 + n * 0.35);
  float crest = smoothstep(0.86, 0.97, roll) + (1.0 - smoothstep(0.0, 0.22, roll)) * 0.5;
  float breaker = crest * smoothstep(2.4, 0.9, wDepth) * smoothstep(0.1, 0.35, wDepth) * smoothstep(0.38, 0.62, lace * 0.6 + n * 0.5 + n2 * 0.2);
  wFoam = clamp(max(lip, breaker), 0.0, 1.0) * wSurf;
}
wCol = mix(wCol, vec3(0.82, 0.86, 0.86), wFoam);
diffuseColor.rgb = wCol;
`;

const WATER_FRAG_NORMAL = /* glsl */ `
normal = normalize(mat3(viewMatrix) * normalize(vec3(wSlope.x * (1.0 - wFoam * 0.7), 1.0, wSlope.y * (1.0 - wFoam * 0.7))));`;

const WATER_FRAG_ALPHA = /* glsl */ `
{
  float wFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
  float wSpec = dot(totalSpecular, vec3(0.3333));
  diffuseColor.a = clamp(max(wAlpha, wFoam * 0.92) + (wFres * 0.85 + wSpec * 0.5) * (1.0 - 0.3 * wStream), 0.0, 1.0) * smoothstep(-0.03, 0.05, wDepth);
  // A small stream mirrors the open sky down its middle and its own dark banks along its edges.
  float wBank = wStream * (1.0 - smoothstep(0.1, 0.8, wDepth));
  // Snow-fed braids carry rock flour: opaque and pale in themselves, so they mirror less of the sky.
  float wMilk = (1.0 - wSea) * (1.0 - wStream);
  outgoingLight -= totalSpecular * min(0.42 * wStream + 0.45 * wBank + 0.4 * wMilk, 0.9);
}
#include <opaque_fragment>`;

// ───────────────────────────── The ground ─────────────────────────────

/** Depth beyond which neighbouring water cells are merged into one large quad. */
const MERGE_SEA = 2.7;
const MERGE_RIVER = 0.3;

export class Ground {
  /** Material for full-detail terrain chunks. */
  readonly terrain: THREE.MeshStandardMaterial;
  /** Material for the 64 m horizon terrain (clipped away inside the full-detail radius). */
  readonly far: THREE.MeshStandardMaterial;
  /** The open sea beyond the full-detail chunks. Add to the scene; `update` keeps it under the camera. */
  readonly sea: THREE.Mesh;
  /** Resolves when the photographic layers are in place (flat colours stand in until then). */
  readonly ready: Promise<void>;

  private water: THREE.MeshStandardMaterial;
  private rivers: RiverField;
  private blend = new Blend();
  private railReserve = new Map<District, boolean>();
  private env: Environment | undefined;
  private time = 0;
  private uniforms: {
    uGndAlbedo: THREE.IUniform<THREE.Texture>;
    uGndNormal: THREE.IUniform<THREE.Texture>;
    uGndNoise: THREE.IUniform<THREE.Texture>;
    uGndInv: THREE.IUniform<THREE.Vector3[]>;
    uGndPbr: THREE.IUniform<THREE.Vector4[]>;
    uGndNear: THREE.IUniform<THREE.Vector3>;
    uGndBounds: THREE.IUniform<THREE.Vector4>;
    uGndWet: THREE.IUniform<number>;
    uGndNight: THREE.IUniform<number>;
    uWatNormal: THREE.IUniform<THREE.Texture>;
    uWatTime: THREE.IUniform<number>;
    uWatRain: THREE.IUniform<number>;
    uWatWind: THREE.IUniform<THREE.Vector2>;
  };

  constructor(
    private gfx: GfxApi,
    private map: CompiledMap,
  ) {
    this.rivers = new RiverField(map.rivers);
    this.env = (gfx as unknown as { atmosphere?: Environment }).atmosphere;
    const anisotropy = Math.min(8, gfx.renderer.capabilities.getMaxAnisotropy());
    const n = LAYERS.length;
    // Until the photographs are decoded every layer is a flat mid-grey: colours are right, detail is missing.
    const flat = new Uint8Array(n * 4);
    const flatNormal = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      flat.set([128, 128, 128, 255], i * 4);
      flatNormal.set([128, 128, 235, 255], i * 4);
    }
    this.uniforms = {
      uGndAlbedo: { value: arrayTexture(flat, 1, n, true, 1) },
      uGndNormal: { value: arrayTexture(flatNormal, 1, n, false, 1) },
      uGndNoise: { value: groundNoiseTexture(anisotropy) },
      uGndInv: { value: LAYERS.map(() => new THREE.Vector3(1, 1, 1).multiplyScalar(1 / 0.2158)) },
      uGndPbr: { value: LAYERS.map((l) => new THREE.Vector4(1 / l.tile, l.bump, l.rough, l.keep ?? 1)) },
      uGndNear: { value: new THREE.Vector3(0, 0, 0) },
      uGndBounds: { value: new THREE.Vector4(WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ) },
      uGndWet: { value: 0 },
      uGndNight: { value: 0 },
      uWatNormal: { value: waterNormalTexture(anisotropy) },
      uWatTime: { value: 0 },
      uWatRain: { value: 0 },
      // The swell runs in from the south-east; the chop follows the day's wind.
      uWatWind: { value: new THREE.Vector2(-0.82, -0.57) },
    };

    const lib = gfx.materials;
    const patched = <T extends THREE.Material>(m: T, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): T =>
      patchable(lib) ? lib.registerPatched(m, key, patch) : lib.register(m);
    const u = this.uniforms;
    const terrain = (far: boolean) => {
      const material = gfx.materials.get('plain', { vertexColors: true, roughness: 1 }).clone();
      material.name = far ? 'ground-far' : 'ground-near';
      return patched(material, material.name, (shader) => {
        Object.assign(shader.uniforms, { uGndNoise: u.uGndNoise, uGndNear: u.uGndNear, uGndWet: u.uGndWet });
        if (!far) Object.assign(shader.uniforms, { uGndAlbedo: u.uGndAlbedo, uGndNormal: u.uGndNormal, uGndInv: u.uGndInv, uGndPbr: u.uGndPbr });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>${TERRAIN_VERT_PARS}`)
          .replace('#include <project_vertex>', `#include <project_vertex>${TERRAIN_VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>${TERRAIN_FRAG_PARS}${far ? '' : TERRAIN_LAYER_PARS}`)
          .replace('#include <map_fragment>', far ? TERRAIN_FRAG_FAR : TERRAIN_FRAG_NEAR)
          .replace('#include <color_fragment>', '')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gNR.z, 0.08, 1.0);')
          .replace('#include <normal_fragment_maps>', TERRAIN_FRAG_NORMAL);
      });
    };
    this.terrain = terrain(false);
    this.far = terrain(true);

    const water = (far: boolean) => {
      const material = gfx.materials.get('plain', { vertexColors: true, roughness: 0.1, transparent: true }).clone();
      material.metalness = 0;
      material.envMapIntensity = 1.15;
      material.name = far ? 'water-far' : 'water-near';
      return patched(material, material.name, (shader) => {
        Object.assign(shader.uniforms, { uWatNormal: u.uWatNormal, uWatTime: u.uWatTime, uWatRain: u.uWatRain, uWatWind: u.uWatWind, uGndNear: u.uGndNear, uGndBounds: u.uGndBounds });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>${WATER_VERT_PARS}`)
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = vec3(0.0, 1.0, 0.0);')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWatW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWat = wdata;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>${WATER_FRAG_PARS}`)
          .replace('#include <map_fragment>', WATER_FRAG_MAIN(far))
          .replace('#include <color_fragment>', '')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.07, 0.3, smoothstep(40.0, 1400.0, wDist)), 0.8, wFoam) + uWatRain * 0.1;')
          .replace('#include <normal_fragment_maps>', WATER_FRAG_NORMAL)
          .replace('#include <opaque_fragment>', WATER_FRAG_ALPHA);
      });
    };
    this.water = water(false);

    // Deep water to the horizon: one quad, a hair below the chunk water that replaces it close in.
    const size = 40000;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    const count = geo.getAttribute('position').count;
    const color = new Float32Array(count * 4);
    const wdata = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      color.set([WATER.sea[0], WATER.sea[1], WATER.sea[2], 2.4 / 4], i * 4);
      wdata.set([30, 1, 0, 0], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(color, 4));
    geo.setAttribute('wdata', new THREE.BufferAttribute(wdata, 4));
    this.sea = new THREE.Mesh(geo, water(true));
    this.sea.position.y = SEA_LEVEL - 0.06;
    this.sea.renderOrder = -1;
    this.sea.receiveShadow = false;
    this.sea.frustumCulled = false;

    // Never hold the game up for long: flat colours stand in for layers that are slow or missing.
    const loading = this.loadLayers(anisotropy).catch((err) => console.warn('Ground textures failed to load; the terrain keeps flat colours.', err));
    this.ready = Promise.race([loading, new Promise<void>((resolve) => setTimeout(resolve, 12000))]);
  }

  private async loadLayers(anisotropy: number) {
    const detailed = !onPhone() && (this.gfx.quality === 'high' || this.gfx.quality === 'ultra');
    const size = detailed ? 1024 : 512;
    const nsize = detailed ? 512 : 256;
    const n = LAYERS.length;
    const albedo = new Uint8Array(size * size * 4 * n);
    const normal = new Uint8Array(nsize * nsize * 4 * n);
    const toLinear = new Float32Array(256);
    for (let i = 0; i < 256; i++) toLinear[i] = i / 255 <= 0.04045 ? i / 255 / 12.92 : Math.pow((i / 255 + 0.055) / 1.055, 2.4);
    const inverse: THREE.Vector3[] = [];
    await Promise.all(
      LAYERS.map(async (layer, li) => {
        const [col, nor, rgh] = await Promise.all([pixels(layer.col, size), pixels(layer.nor, nsize), layer.rgh ? pixels(layer.rgh, nsize) : null]);
        albedo.set(col, li * size * size * 4);
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < col.length; i += 4) {
          r += toLinear[col[i]];
          g += toLinear[col[i + 1]];
          b += toLinear[col[i + 2]];
        }
        const px = col.length / 4;
        inverse[li] = new THREE.Vector3(px / r, px / g, px / b);
        const base = li * nsize * nsize * 4;
        for (let i = 0; i < nor.length; i += 4) {
          normal[base + i] = nor[i];
          normal[base + i + 1] = nor[i + 1];
          normal[base + i + 2] = rgh ? rgh[i] : layer.rough * 255;
          normal[base + i + 3] = 255;
        }
      }),
    );
    const u = this.uniforms;
    const old = [u.uGndAlbedo.value, u.uGndNormal.value];
    u.uGndAlbedo.value = arrayTexture(albedo, size, n, true, anisotropy);
    u.uGndNormal.value = arrayTexture(normal, nsize, n, false, Math.min(4, anisotropy));
    u.uGndInv.value = inverse;
    for (const t of old) t.dispose();
  }

  /** Uniforms the road shaders share: the landform noise and how wet the ground is. */
  get shared(): { noise: THREE.IUniform<THREE.Texture>; wet: THREE.IUniform<number>; night: THREE.IUniform<number> } {
    return { noise: this.uniforms.uGndNoise, wet: this.uniforms.uGndWet, night: this.uniforms.uGndNight };
  }

  /** Per frame: animate the water, follow the weather, tell the distant stand-ins where the detail is. */
  update(dt: number, focusX: number, focusZ: number, nearRadius: number) {
    this.time += dt;
    const u = this.uniforms;
    u.uWatTime.value = this.time % 3600;
    u.uGndNear.value.set(focusX, focusZ, nearRadius);
    u.uGndWet.value = this.env?.wetness ?? 0;
    u.uGndNight.value = this.env?.night ?? 0;
    u.uWatRain.value = this.env?.rain ?? 0;
    this.sea.position.x = focusX;
    this.sea.position.z = focusZ;
  }

  // ───────────── What the ground is made of ─────────────

  /**
   * Describe the ground at one terrain vertex: `h` its height, (`gx`, `gz`) the slope there. `detail`
   * adds what only shows close up (road verges and berms); the horizon mesh leaves it out.
   */
  shade(x: number, z: number, h: number, gx: number, gz: number, detail: boolean, out: GroundAttributes, k: number) {
    const m = this.blend;
    const terrain = this.map.terrain;
    const d = this.map.districtAt(x, z);
    const slope = Math.hypot(gx, gz);
    const blotch = fbm(x * 0.031, z * 0.031, 2); // ~30 m
    const patch = fbm(x * 0.0043 + 9, z * 0.0043 + 4, 2); // ~230 m
    const vary = 0.93 + fbm(x * 0.05, z * 0.05, 2) * 0.14;
    // Railway reserves are authored as 'beach' districts purely to keep buildings and trees off the line.
    let rail = this.railReserve.get(d);
    if (rail === undefined) this.railReserve.set(d, (rail = d.type === 'beach' && /line|rail/i.test(d.name)));

    let open = false; // open country: hills, dunes and verges apply
    let lawn = false; // somebody mows it
    m.reset(0);
    if (rail) {
      m.bare(1, C.ballast, L_GRAVEL, vary, L_SOIL, 0.3);
      m.veg(smooth(0.42, 0.62, blotch) * 0.85, C.rough, 1, vary);
      open = true;
    } else {
      switch (d.type) {
        case 'rural':
          m.reset(1);
          open = true;
          break;
        case 'park':
          m.veg(1, mix3(C.park, C.lawn, smooth(0.4, 0.7, blotch) * 0.6), 0.05, vary);
          lawn = true;
          break;
        case 'villa':
          m.veg(1, mix3(C.lawn, C.lawnDry, smooth(0.35, 0.7, blotch) * 0.6), 0.15 + blotch * 0.2, vary);
          lawn = true;
          break;
        case 'statehouse':
          m.veg(1, mix3(C.lawn, C.lawnDry, 0.25 + smooth(0.3, 0.7, blotch) * 0.6), 0.3 + blotch * 0.3, vary);
          lawn = true;
          break;
        case 'cbd':
          m.bare(1, mix3(C.hard, C.hardDark, smooth(0.45, 0.6, blotch)), L_HARD, vary);
          break;
        case 'shops':
          m.bare(1, mix3(C.hardPale, C.hardDark, smooth(0.5, 0.65, blotch) * 0.8), L_HARD, vary);
          break;
        case 'township':
          m.bare(1, mix3(C.hardPale, C.yard, smooth(0.4, 0.6, blotch)), L_HARD, vary, L_SOIL, smooth(0.4, 0.6, blotch) * 0.8);
          m.veg(smooth(0.62, 0.72, blotch) * 0.7, C.lawnDry, 0.6, vary);
          break;
        case 'industrial':
          // Metalled yards, oil-dark hardstand by the doors, weeds along the fences.
          m.bare(1, mix3(C.yard, C.hardDark, smooth(0.5, 0.62, patch)), L_GRAVEL, vary, L_SOIL, 0.35);
          m.bare(smooth(0.5, 0.62, patch), C.hardDark, L_HARD, vary);
          m.veg(smooth(0.6, 0.72, blotch) * 0.75, C.rough, 1, vary);
          break;
        case 'port':
          m.bare(1, mix3(C.hard, C.hardDark, smooth(0.45, 0.65, blotch) * 0.7), L_HARD, vary);
          m.bare(smooth(0.6, 0.7, patch) * 0.8, C.yard, L_GRAVEL, vary, L_SOIL, 0.3);
          break;
        case 'beach':
          m.bare(1, C.sand, L_SAND, vary);
          open = true;
          break;
        default:
          m.reset(1);
          open = true;
      }
    }

    // Hill country: tussock, gold on the sunny faces and olive on the shady ones. The low rolling downs
    // behind Timaru stay in paddocks.
    let relief = 0;
    if (open && d.type !== 'beach') {
      const hill = smooth(42, 105, h + slope * 70);
      if (hill > 0) {
        // The sun is in the north (−z): a slope that falls towards +z faces away from it.
        const shady = clamp(-gz / Math.max(slope, 0.02), -1, 1) * smooth(0.06, 0.3, slope);
        m.veg(hill, mix3(C.tussock, C.tussockShade, clamp(0.35 + shady * 0.5 + (patch - 0.5) * 0.5, 0, 1)), 1, vary);
        m.veg(hill * smooth(0.6, 0.8, blotch + shady * 0.2) * 0.4, C.scrub, 0.6, vary);
      }
      relief = clamp(hill * 0.8 + smooth(0.12, 0.45, slope) * 0.6, 0, 1);
    }
    // Rock where it is too steep to hold soil, scree on the high tops.
    const steep = smooth(0.55, 0.95, slope);
    if (steep > 0) m.bare(steep, C.rock, L_ROCK, vary);
    const high = smooth(260, 340, h);
    if (high > 0) m.bare(high, C.scree, L_ROCK, vary, L_SHINGLE, 0.4);

    // Rivers.
    const r = this.rivers.at(x, z);
    if (r) {
      const half = r.river.width * 0.5;
      const bed = smooth(half + 14, half - 4, r.d);
      if (bed > 0) {
        const above = h - (r.y - r.river.depth);
        if (r.river.braided) {
          // A bed of greywacke shingle between rough, scrubby banks. Scrub and rank grass also take the
          // higher bars towards the margins.
          m.veg(smooth(0, 0.5, bed) * (1 - smooth(0.55, 0.95, bed)) * 0.9, mix3(C.rough, C.scrub, smooth(0.4, 0.6, blotch)), 0.9, vary);
          const stone = smooth(0.5, 0.95, bed);
          const damp = smooth(0.38, 0.02, above);
          const drowned = smooth(0, -0.9, above);
          // Drifts of silt and sand between the bars of stone.
          const silt = smooth(0.52, 0.7, fbm(r.s * 0.011 + 3, r.lateral * 0.045 + 1, 2));
          const dry = mix3(C.shingle, C.sand, silt * 0.55);
          m.bare(stone, mix3(mix3(dry, C.shingleWet, damp * 0.85), C.riverBed, drowned), L_SHINGLE, 0.9 + blotch * 0.2, L_SAND, clamp(0.1 + silt * 0.6 + drowned * 0.3, 0, 1));
          const margin = smooth(0.3, 0.95, Math.abs(r.lateral) / half);
          const island = fbm(r.s * 0.006 + 7, r.lateral * 0.022 + 3, 2);
          m.veg(stone * smooth(0.56, 0.66, island + margin * 0.2 - 0.06) * smooth(0.3, 0.42, above) * 0.85, mix3(C.scrub, C.rough, smooth(0.35, 0.65, blotch)), 0.85, vary);
          m.wet = Math.max(m.wet, stone * damp * (1 - drowned));
        } else {
          // A spring-fed stream between grassy banks, weed on the bed.
          m.veg(smooth(0, 0.55, bed) * 0.7, C.bank, 0.1, vary);
          m.bare(smooth(0.12, -0.2, above), C.streamBed, L_SOIL, vary, L_SHINGLE, 0.35);
        }
      }
    }

    // The coast. Pegasus Bay (north of the peninsula) and the bays are sand; the long southern beaches
    // are steep banks of greywacke gravel; inside the harbours the shore is rock and mud.
    if (h < 6.5) {
      const inland = terrain.coastX(z) - x;
      const exposed = smooth(300, 140, inland);
      const sandy = d.type === 'beach' && !rail ? 1 : smooth(-2600, -3100, z);
      const shore = smooth(2.9, 2.0, h);
      if (shore > 0) {
        if (exposed > 0.5 || d.type === 'beach') {
          m.bare(shore * (1 - sandy), C.gravelBeach, L_SHINGLE, vary, L_SAND, 0.3);
          m.bare(shore * sandy, C.sand, L_SAND, vary);
        } else {
          m.bare(shore, C.shoreRock, L_ROCK, vary, L_SHINGLE, 0.45);
        }
      }
      // Dunes behind the beach: marram and bare sand.
      if (open && exposed > 0) {
        const dune = smooth(70, 22, inland) * smooth(2.3, 3.2, h) * exposed * sandy;
        if (dune > 0) {
          m.bare(dune * 0.9, C.sand, L_SAND, vary);
          m.veg(dune * smooth(0.36, 0.56, blotch) * 0.9, C.marram, 1, vary);
        }
      }
      // Wet below the tide line, then the sea bed.
      const tide = smooth(0.82, 0.34, h);
      if (tide > 0) {
        m.wet = Math.max(m.wet, tide * (1 - smooth(-0.2, -1.2, h)));
        const under = smooth(0, -3.5, h);
        if (under > 0) m.bare(under, C.seabed, L_SAND, vary, L_SHINGLE, 0.3);
      }
    }

    // Beside the road: a metalled shoulder and long dry grass in the country, a mown berm in town.
    if (detail) {
      const hit = this.map.graph.nearest(x, z, 24);
      const sandy = d.type === 'beach' && !rail;
      if (hit && !sandy && !hit.edge.bridge && !hit.edge.tunnel && hit.edge.cls !== 'pedestrian') {
        const e = hit.edge;
        const off = hit.distance - e.width / 2;
        if (e.footpaths) {
          if (open) m.veg(smooth(5.2, 3.6, off), mix3(C.lawn, C.lawnDry, 0.35), 0.2, vary);
        } else if (h > 1.6) {
          const metal = smooth(2.8, 0.8, off) * (e.cls === 'gravel' ? 0.9 : 0.75);
          m.bare(metal, C.shoulder, L_GRAVEL, vary, L_SOIL, 0.3);
          // Rank dry grass along the fence line, but not across a wharf apron or a factory yard.
          if (!lawn && open) m.veg(smooth(e.cls === 'highway' ? 12 : 8, 3, off) * (1 - metal) * 0.9, mix3(C.rough, C.pDry, blotch), 1, vary);
        }
      }
    }

    out.color[k * 3] = m.vr;
    out.color[k * 3 + 1] = m.vg;
    out.color[k * 3 + 2] = m.vb;
    out.mineral[k * 3] = m.mr;
    out.mineral[k * 3 + 1] = m.mg;
    out.mineral[k * 3 + 2] = m.mb;
    const w = m.w;
    out.a[k * 4] = w[L_DRY] * 255 + 0.5;
    out.a[k * 4 + 1] = w[L_SOIL] * 255 + 0.5;
    out.a[k * 4 + 2] = w[L_SHINGLE] * 255 + 0.5;
    out.a[k * 4 + 3] = w[L_SAND] * 255 + 0.5;
    out.b[k * 4] = w[L_ROCK] * 255 + 0.5;
    out.b[k * 4 + 1] = w[L_HARD] * 255 + 0.5;
    out.b[k * 4 + 2] = m.pad * 255 + 0.5;
    out.b[k * 4 + 3] = clamp(m.wet, 0, 1) * 255 + 0.5;
    out.c[k * 4] = relief * 255 + 0.5;
    out.c[k * 4 + 1] = w[L_GRAVEL] * 255 + 0.5;
  }

  // ───────────── Water ─────────────

  /**
   * The sea and river surface over one terrain chunk, or null if the chunk is dry: a full-resolution
   * mesh and a half-resolution one to pair with the two levels of detail of the ground. `heights` is the
   * chunk's (n+1)² height grid at `cell` metres. Each vertex carries the depth of water under it, so the
   * shader can let the bed show through the shallows and put the surf where the water runs out; deep
   * water is merged into large quads.
   */
  buildWater(x0: number, z0: number, heights: Float32Array, n: number, cell: number): [THREE.Mesh, THREE.Mesh] | null {
    const terrain = this.map.terrain;
    const V = (n + 1) * (n + 1);
    let lowest = Infinity;
    for (let i = 0; i < V; i++) if (heights[i] < lowest) lowest = heights[i];
    const corners = [this.rivers.at(x0, z0), this.rivers.at(x0 + n * cell, z0), this.rivers.at(x0, z0 + n * cell), this.rivers.at(x0 + n * cell, z0 + n * cell), this.rivers.at(x0 + (n * cell) / 2, z0 + (n * cell) / 2)];
    if (lowest > SEA_LEVEL + 0.1 && !corners.some((c) => c)) {
      // No sea here; a river could still cross a chunk without touching its corners or centre.
      let any = false;
      for (let j = 0; j <= n && !any; j += 4) for (let i = 0; i <= n && !any; i += 4) any = !!this.rivers.at(x0 + i * cell, z0 + j * cell);
      if (!any) return null;
    }

    const level = new Float32Array(V);
    const depth = new Float32Array(V);
    const merge = new Float32Array(V);
    const colour = new Float32Array(V * 4);
    const wdata = new Float32Array(V * 4);
    let wetAny = false;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        const h = heights[k];
        const r = this.rivers.at(x, z);
        let y = SEA_LEVEL;
        let river = false;
        let inBed = false;
        if (r) {
          const surface = r.y - r.river.depth;
          const half = r.river.width * 0.5;
          inBed = smooth(half + 14, half - 4, r.d) > 0.5;
          // Where the sea has already flooded the ground beside a river mouth, it is sea.
          if (surface > SEA_LEVEL && (inBed || h >= SEA_LEVEL)) {
            y = surface;
            river = true;
          }
        }
        let dep = y - h;
        let body: V3;
        let clear: number;
        let surf = 0;
        let fx = 0;
        let fz = 0;
        if (river && r) {
          // Outside the bed proper the river's level means nothing: keep such ground dry.
          if (!inBed) dep = Math.min(dep, -0.25);
          body = r.river.braided ? WATER.milky : WATER.stream;
          clear = r.river.braided ? 0.55 : 1.7;
          const speed = r.river.braided ? 1.5 : 0.45;
          fx = r.tx * speed;
          fz = r.tz * speed;
          merge[k] = MERGE_RIVER;
        } else {
          // Harbours and the estuary lie well inside the line of the open coast: darker, greener, calmer.
          const enclosed = smooth(140, 460, terrain.coastX(z) - x);
          body = mix3(WATER.sea, WATER.harbour, enclosed);
          clear = lerp(2.4, 1.6, enclosed);
          surf = lerp(1, 0.22, enclosed);
          merge[k] = MERGE_SEA;
        }
        level[k] = y;
        depth[k] = dep;
        if (dep > -0.05) wetAny = true;
        colour.set([body[0], body[1], body[2], clear / 4], k * 4);
        wdata.set([dep, surf, fx, fz], k * 4);
      }
    }
    if (!wetAny) return null;

    // 0 = dry throughout, 1 = deep throughout, 2 = mixed.
    const survey = (i: number, j: number, s: number): number => {
      let deep = true;
      let dry = true;
      for (let b = j; b <= j + s; b++) {
        for (let a = i; a <= i + s; a++) {
          const k = b * (n + 1) + a;
          if (depth[k] <= merge[k]) deep = false;
          if (depth[k] > -0.05) dry = false;
          if (!deep && !dry) return 2;
        }
      }
      return dry ? 0 : 1;
    };
    /** One mesh whose smallest quads are `finest` cells across. */
    const mesh = (finest: number): THREE.Mesh | null => {
      const slot = new Int32Array(V).fill(-1);
      const pos: number[] = [];
      const col: number[] = [];
      const dat: number[] = [];
      const idx: number[] = [];
      const vertex = (i: number, j: number): number => {
        const k = j * (n + 1) + i;
        if (slot[k] >= 0) return slot[k];
        slot[k] = pos.length / 3;
        pos.push(x0 + i * cell, level[k], z0 + j * cell);
        col.push(colour[k * 4], colour[k * 4 + 1], colour[k * 4 + 2], colour[k * 4 + 3]);
        dat.push(wdata[k * 4], wdata[k * 4 + 1], wdata[k * 4 + 2], wdata[k * 4 + 3]);
        return slot[k];
      };
      const emit = (i: number, j: number, s: number) => {
        const state = survey(i, j, s);
        if (state === 0) return;
        if (state === 1 || s === finest) {
          const a = vertex(i, j);
          const b = vertex(i, j + s);
          const c = vertex(i + s, j + s);
          const e = vertex(i + s, j);
          // Same diagonal as the terrain, so the waterline falls where the ground really meets the water.
          idx.push(a, b, e, b, c, e);
          return;
        }
        const hs = s / 2;
        emit(i, j, hs);
        emit(i + hs, j, hs);
        emit(i, j + hs, hs);
        emit(i + hs, j + hs, hs);
      };
      const top = 16;
      for (let j = 0; j < n; j += top) for (let i = 0; i < n; i += top) emit(i, j, top);
      if (!idx.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      geo.setAttribute('wdata', new THREE.Float32BufferAttribute(dat, 4));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const water = new THREE.Mesh(geo, this.water);
      water.receiveShadow = true;
      water.matrixAutoUpdate = false;
      return water;
    };
    const fine = mesh(1);
    const coarse = mesh(2);
    return fine && coarse ? [fine, coarse] : null;
  }
}
