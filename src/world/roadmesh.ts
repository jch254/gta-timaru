import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/math';
import { hashInts } from '../core/rng';
import type { DistrictType, EdgeSample, GfxApi, RoadClass, RoadEdge } from '../core/types';
import { setBatchHint, type Materials } from '../render/materials';
import { roadAtlasCells, roadMarkingAtlas, type AtlasCell } from '../render/textures';
import type { ChunkBuilderImpl } from './chunkbuilder';
import { bermColour } from './ground';
import { CHUNK, chunkOf } from './lots';
import type { CompiledMap, RailPath } from './map';

export interface RoadMaterials {
  /** Sealed carriageway: town asphalt, or chip seal on the highway (chosen per strip, see `surfaceCode`). */
  asphalt: THREE.Material;
  gravel: THREE.Material;
  /** Mall and square pavers. */
  paving: THREE.Material;
  /** Footpaths: pavers in the middle of town, plain concrete in the suburbs, with a mown berm. */
  footpath: THREE.Material;
  path: THREE.Material;
  berm: THREE.Material;
  bermPark: THREE.Material;
  kerb: THREE.Material;
  /** Flat paint on the seal: the concrete channel, white and yellow lines. */
  gutter: THREE.Material;
  line: THREE.Material;
  lineYellow: THREE.Material;
  /** Cast iron let into the road (drawn from the marking atlas) and reflective studs. */
  iron: THREE.Material;
  stud: THREE.Material;
  studYellow: THREE.Material;
  deck: THREE.Material;
  rail: THREE.Material;
  /** Plate girders of the railway bridges. */
  girder: THREE.Material;
  ballast: THREE.Material;
  sleeper: THREE.Material;
  /** Tunnel lining, the turf laid back over the top, and the strip lights inside. */
  tunnel: THREE.Material;
  lid: THREE.Material;
  tunnelLight: THREE.Material;
  /** Quay deck and wall (weathered to the grey of the hardstand behind), and the fender piles against it. */
  quay: THREE.Material;
  pile: THREE.Material;
}

/** Uniforms the road shaders share with the terrain (world/ground.ts). */
export interface RoadShared {
  noise: THREE.IUniform<THREE.Texture>;
  wet: THREE.IUniform<number>;
  /** Darkness 0..1, for the studs that answer headlights. */
  night?: THREE.IUniform<number>;
}

// ───────────────────────────── Materials ─────────────────────────────

const ROAD_VERT_PARS = /* glsl */ `
varying vec3 vRoad;
varying vec3 vRoadW;
varying vec2 vRoadS;`;

/** The surface photographs are laid by world position, which frees the UV attribute to carry road data. */
const ROAD_VERT_UV = /* glsl */ `
{
  vec2 rUvW = (modelMatrix * vec4(position, 1.0)).xz;
  #ifdef USE_MAP
    vMapUv = (mapTransform * vec3(rUvW, 1.0)).xy;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = (normalMapTransform * vec3(rUvW, 1.0)).xy;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = (roughnessMapTransform * vec3(rUvW, 1.0)).xy;
  #endif
  vRoadS = uv;
}`;

const ROAD_FRAG_PARS = /* glsl */ `
uniform sampler2D uGndNoise;
uniform float uGndWet;
varying vec3 vRoad;
varying vec3 vRoadW;
varying vec2 vRoadS;
float roadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// A reinstated service trench or a patch of newer seal, laid out along the road in 16 m cells:
// x = 1 inside one, y = metres in from its edge, z = how old it is (0 fresh and black, 1 bleached).
vec3 roadPatch(float s, float lat, float half_, float seed, float cell, float density) {
  float c = floor(s / cell);
  float f = s - c * cell;
  vec2 id = vec2(c, seed * 1.37 + 0.5);
  float kind = roadHash(id) / density;
  float a = roadHash(id + 0.37);
  float b = roadHash(id + 0.71);
  float g = roadHash(id + 1.93);
  float d = -1.0;
  if (kind < 0.15) {
    // Across the road: kerb to kerb, or from one side to somewhere short of the other.
    float w = 0.45 + 0.6 * b;
    float s0 = 1.0 + a * max(cell - 2.0 - w, 0.0);
    float side = fract(g * 13.0) < 0.5 ? 1.0 : -1.0;
    float reach = fract(g * 7.0) < 0.45 ? 99.0 : half_ * (0.1 + 0.6 * fract(g * 29.0));
    d = min(min(f - s0, s0 + w - f), reach - lat * side);
  } else if (kind < 0.28) {
    // Along it: a main laid down one lane.
    float w = 0.5 + 0.45 * b;
    float l0 = (a * 2.0 - 1.0) * max(half_ - w - 0.5, 0.0);
    d = min(min(lat - l0, l0 + w - lat), min(f - 0.5, cell - 0.5 - f));
  } else if (kind < 0.5) {
    float len = 1.6 + 4.5 * b;
    float w = 1.2 + 2.2 * fract(b * 9.0);
    float s0 = 0.8 + a * max(cell - 1.6 - len, 0.0);
    float l0 = (fract(a * 5.0) * 2.0 - 1.0) * max(half_ - w * 0.5 - 0.3, 0.0) - w * 0.5;
    d = min(min(f - s0, s0 + len - f), min(lat - l0, l0 + w - lat));
  }
  return vec3(step(0.0, d), d, g);
}`;

/**
 * What a road surface has that a texture alone does not: polished wheel paths with the oil line between
 * them, darker still on the run up to a limit line; trenches and patches of a different age with tar
 * round their edges; crack-sealing "snakes" and the cracks that have not been sealed yet; the dirt that
 * gathers along a kerb; the broken edge of an unkerbed seal; bitumen flushed up through the chip and the
 * sparkle of the chip itself on the highway; wheel-packed tracks on gravel; and when it rains, a dark
 * sheen with standing water in the ruts and along the channel.
 *
 * Each strip says where a fragment sits through its (otherwise constant) normal and its UV:
 *   normal.x  metres left of the centreline
 *   normal.y  1 on the open road falling to 0 at junctions (where strips overlap, so everything tied to
 *             the lane must fade out)
 *   normal.z  kerbed·256 + kind·16 + lanes, plus (as its fraction) 0 near either end of the edge rising
 *             to 1 clear of them: features laid out along the road keep clear of the ends
 *   uv.x      distance along the edge, stretched a little so that 16 m cells fit it exactly
 *   uv.y      seed·32 + half the sealed width
 */
const ROAD_FRAG_MAIN = /* glsl */ `
vec2 rXZ = vRoadW.xz;
float rDist = length(vViewPosition);
float rI = floor(vRoad.z);
float rEnd = step(0.999, clamp((vRoad.z - rI - 0.02) / 0.96, 0.0, 1.0));
float rKerb = step(255.5, rI);
rI -= rKerb * 256.0;
float rKind = floor(rI / 16.0 + 0.01);
float rLanes = mod(rI, 16.0);
float rFeat = clamp(vRoad.y, 0.0, 1.0);
float rSeed = floor(vRoadS.y / 32.0 + 0.01);
float rHalf = vRoadS.y - rSeed * 32.0;
float rS = vRoadS.x;
float rLat = vRoad.x;
float rEdge = rHalf - abs(rLat);
float rLw = max(2.0 * rHalf / max(rLanes, 1.0), 2.0);
float rLaned = step(0.5, rLanes) * rFeat;
vec4 rN1 = texture2D(uGndNoise, rXZ / 37.0);
vec4 rN2 = texture2D(uGndNoise, rXZ / 5.3 + 0.41);
vec4 rN3 = texture2D(uGndNoise, rXZ / 1.07 + 0.17);
float rM = (fract(rLat / rLw + 0.5 * mod(rLanes, 2.0)) - 0.5) * rLw;
// Wheel paths wander a little: nobody drives a ruled line.
float rTrack = exp(-pow((abs(rM + (rN1.r - 0.5) * 0.3) - 0.82) / 0.36, 2.0)) * rLaned;
float rOil = exp(-pow(rM / 0.27, 2.0)) * rLaned;
// The last few metres before a junction, where everything stops and drips.
float rStop = rFeat * (1.0 - rFeat) * 4.0;
vec3 rCol = diffuseColor.rgb;
vec3 rCoarse = texture2D(map, vMapUv * 0.37).rgb;
float rTone = 0.88 + 0.22 * rN1.a + 0.14 * (rN2.a - 0.5);
// Tar poured into the cracks: thin dark contour lines, in some stretches only.
float rSw = fwidth(rN1.b);
float rSeam = (1.0 - smoothstep(0.0025, 0.004 + rSw, abs(rN1.b - 0.33))) * clamp(0.006 / (0.006 + rSw), 0.0, 1.0);
rSeam *= smoothstep(0.5, 0.62, texture2D(uGndNoise, rXZ / 149.0 + 0.2).a);
// Cracks nobody has sealed: a finer net, in patches.
float rCw = fwidth(rN2.b);
float rCrack = (1.0 - smoothstep(0.004, 0.009 + rCw, abs(rN2.b - 0.3))) * clamp(0.03 / (0.03 + rCw), 0.0, 1.0);
rCrack *= smoothstep(0.55, 0.68, texture2D(uGndNoise, rXZ / 61.0 + 0.7).a);
float rGloss = 0.0;
float rGlintOn = 0.0;
// Trenches and patches.
float rDense = rKind < 0.5 ? 1.0 : rKind < 1.5 ? 0.55 : rKind > 4.5 ? 1.5 : 0.0;
vec3 rP = rDense > 0.0 ? roadPatch(rS, rLat, rHalf, rSeed, rKind > 4.5 ? 8.0 : 16.0, rDense) : vec3(0.0, 1.0, 0.0);
float rPin = rP.x * rEnd;
float rPtar = rPin * (1.0 - smoothstep(0.02, 0.075, rP.y + (rN3.a - 0.5) * 0.03));
// How far the sealed edge is eaten back, and the dust and loose chip beside it.
float rSide = smoothstep(0.0, 0.3, rFeat);
if (rKind < 0.5) {
  // Town asphalt: aggregate polished pale where the wheels run, an oil strip between them.
  rCol *= rTone * (1.0 - 0.1 * (1.0 - rFeat) * (0.6 + 0.8 * rN2.a));
  rCol *= 1.0 + 0.13 * rTrack - (0.24 + 0.3 * rStop) * rOil * (0.5 + rN2.a);
  rCol *= 1.0 - 0.34 * max(rSeam, rCrack * 0.7);
  rCol *= mix(1.0, mix(0.66, 1.17, rP.z), rPin) * (1.0 - 0.5 * rPtar);
  rGloss = 0.1 * rTrack + 0.1 * rOil + 0.1 * rPin * (1.0 - rP.z);
} else if (rKind < 1.5) {
  // Chip seal: coarser, paler stone; bitumen bleeds up dark and smooth where the wheels run.
  rCol = mix(rCol, rCoarse * (rCol / max(sampledDiffuseColor.rgb, vec3(0.02))), 0.55);
  rCol *= vec3(1.14, 1.1, 1.03) * (0.88 + 0.22 * rN1.a) * (1.0 - 0.08 * (1.0 - rFeat));
  float rFlush = rTrack * (0.3 + 0.7 * smoothstep(0.3, 0.7, rN1.a + (rN2.a - 0.5) * 0.5));
  rCol *= 1.0 - 0.36 * rFlush - 0.3 * rSeam - 0.2 * rCrack - 0.1 * rStop * rOil;
  rCol *= mix(1.0, mix(0.7, 1.12, rP.z), rPin) * (1.0 - 0.4 * rPtar);
  rGloss = 0.14 * rFlush;
  rGlintOn = 1.0 - rFlush;
} else if (rKind < 2.5) {
  // Gravel road. The photograph is fine pea gravel, so most of the colour comes from it laid coarser:
  // 20 mm road metal. Pale where the wheels have packed it and the clay fines show, loose darker metal
  // heaped along the crown and the edges, the odd pothole in the wheel tracks, corrugations.
  rCol = mix(rCol, rCoarse * (rCol / max(sampledDiffuseColor.rgb, vec3(0.02))), 0.7);
  float rLoose = max(rOil, smoothstep(1.5, 2.4, abs(rM)) * rFeat);
  float rHole = smoothstep(0.74, 0.8, rN2.a) * rTrack;
  rCol *= (0.76 + 0.34 * rN1.a + 0.12 * (rN2.a - 0.5)) * (1.0 + 0.3 * rTrack * (1.0 - rLoose) - 0.3 * rLoose * (0.5 + rN2.a));
  rCol *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), rTrack) * (1.0 - 0.34 * rHole);
  rCol *= 1.0 + 0.07 * sin(rS * 8.4 + rN2.a * 4.0) * rTrack * smoothstep(0.45, 0.7, rN1.a);
  rGlintOn = 0.4;
} else if (rKind < 3.5) {
  rCol *= rTone * (1.0 - 0.3 * rSeam);
} else if (rKind < 4.5) {
  // Metalled shoulder: darker, dirtier gravel than a graded road, ragged along its outer edge.
  if (rLat > 0.62 + rN3.a * 0.42 + rN2.a * 0.2) discard;
  rCol *= 0.6 * (0.86 + 0.28 * rN1.a) * (0.9 + 0.2 * rN3.a);
  rGlintOn = 0.4;
} else {
  // Asphalt footpath: fine mix gone grey, trenched for every service in the street, moss along its edges.
  rCol *= vec3(1.42, 1.4, 1.34) * (0.86 + 0.2 * rN1.a + 0.16 * (rN2.a - 0.5));
  rCol *= 1.0 - 0.3 * max(rSeam, rCrack);
  rCol *= mix(1.0, mix(0.6, 1.14, rP.z), rPin) * (1.0 - 0.45 * rPtar);
  float rMoss = (1.0 - smoothstep(0.0, 0.16, rEdge - rN3.a * 0.14)) * 0.75;
  rCol = mix(rCol, vec3(0.085, 0.09, 0.05) * (0.7 + 0.6 * rN3.a), rMoss);
}
if (rKind < 1.5) {
  if (rKerb > 0.5) {
    // Along a kerb: dust and grit nobody drives on, and what parked cars leave behind.
    float rGrime = (1.0 - smoothstep(0.25, 1.7, rEdge)) * rSide;
    rCol *= 1.0 - rGrime * (0.1 + 0.16 * rN2.a);
    rCol *= 1.0 - 0.3 * smoothstep(0.7, 0.78, rN3.a * 0.7 + rN2.a * 0.3) * smoothstep(0.5, 0.9, rEdge) * (1.0 - smoothstep(1.7, 2.3, rEdge)) * rSide;
  } else {
    // No kerb: the edge of the seal breaks away, with dust and loose chip along it.
    float rRag = (rN3.a * 0.24 + rN2.a * 0.16) * (rKind > 0.5 ? 0.62 : 1.0) * rSide;
    if (rEdge < rRag) discard;
    float rDust = (1.0 - smoothstep(0.0, 0.75, rEdge - rRag)) * rSide;
    rCol = mix(rCol, rCol * 1.3 + 0.012, rDust * (0.25 + 0.5 * rN3.a));
  }
}
float rRut = (rKind < 1.5 ? rTrack : 0.0);
float rLow = rN1.a * 0.72 + rN2.a * 0.14 + rRut * 0.2;
// Water also stands along the channel side of a cambered street.
rLow += rKerb * (1.0 - smoothstep(0.15, 1.3, rEdge)) * 0.2 * rSide;
float rPuddle = smoothstep(0.5, 0.64, rLow) * smoothstep(0.3, 0.85, uGndWet);
rCol *= 1.0 - uGndWet * (0.36 + 0.24 * rPuddle);
diffuseColor.rgb = rCol;
`;

const ROAD_FRAG_ROUGH = /* glsl */ `
roughnessFactor *= 1.0 - rGloss;
// Chip-seal sparkle: the odd stone face that happens to catch the sun.
vec2 rG = floor(rXZ * 46.0);
float rGlint = 0.0;
if (rGlintOn > 0.0 && rDist < 70.0) {
  float rGw = min(length(dFdx(rXZ)), length(dFdy(rXZ))) * 46.0;
  rGlint = step(0.972, roadHash(rG)) * rGlintOn * clamp(1.4 / max(rGw, 0.01), 0.0, 1.0) * (1.0 - smoothstep(35.0, 70.0, rDist)) * (1.0 - uGndWet);
  roughnessFactor = mix(roughnessFactor, 0.3, rGlint);
}
roughnessFactor = mix(roughnessFactor * (1.0 - 0.62 * uGndWet), 0.05, rPuddle);`;

const ROAD_FRAG_NORMAL = /* glsl */ `
normal = normalize(normal + rGlint * (vec3(roadHash(rG + 3.1), roadHash(rG + 7.3), 0.5) - 0.5) * 0.8);
normal = normalize(mix(normal, nonPerturbedNormal, rPuddle));`;

const MARK_VERT_PARS = /* glsl */ `
varying vec3 vRoadW;
varying vec3 vMark;
varying vec2 vMarkUv;`;

const MARK_FRAG_PARS = /* glsl */ `
uniform sampler2D uGndNoise;
uniform sampler2D uMarkAtlas;
uniform float uGndWet;
uniform float uGndNight;
varying vec3 vRoadW;
varying vec3 vMark;
varying vec2 vMarkUv;`;

/**
 * Everything that lies on the seal in one batch, told apart by the (otherwise constant) normal:
 *   x  0 paint · 1 paint through a stencil from the atlas · 2 the concrete channel · 3 cast iron from the
 *      atlas · 4 a reflective stud · 5 the kerb
 *   y  how worn the paint is (0 fresh … 1 nearly gone)
 * Channel and kerb carry (distance along the road, position across) in their UVs.
 */
const MARKING_FRAG = /* glsl */ `
float mGloss = 0.0;
float mGlow = 0.0;
{
  float mMode = floor(vMark.x + 0.5);
  vec2 mXZ = vRoadW.xz;
  float mA = texture2D(uGndNoise, mXZ / 2.3).a;
  float mB = texture2D(uGndNoise, mXZ / 0.41 + 0.3).a;
  if (mMode < 1.5) {
    if (mMode > 0.5 && texture2D(uMarkAtlas, vMarkUv).a < 0.5) discard;
    // Paint wears through where the tyres scrub it, in patches rather than evenly.
    float mC = texture2D(uGndNoise, mXZ / 17.0 + 0.6).a;
    if (mA * 0.35 + mB * 0.65 + (mC - 0.5) * 0.36 < 0.2 + 0.32 * vMark.y) discard;
    diffuseColor.rgb *= (0.76 + 0.34 * mA) * (1.0 - 0.22 * vMark.y);
    diffuseColor.rgb *= 1.0 - 0.3 * uGndWet;
    mGloss = 0.4 * uGndWet;
  } else if (mMode < 2.5) {
    // The channel: silt and tyre dust along the invert, leaves and rubbish caught in drifts, running water in the rain.
    float mAcross = vMarkUv.y;
    float mSilt = smoothstep(0.25, 0.9, mAcross) * (0.45 + 0.55 * mA);
    float mDrift = smoothstep(0.52, 0.7, texture2D(uGndNoise, vec2(vMarkUv.x / 23.0, 0.37)).a + (mA - 0.5) * 0.3);
    float mLeaf = mDrift * smoothstep(0.42, 0.6, mB) * smoothstep(0.15, 0.5, mAcross);
    vec3 mLeafCol = mix(vec3(0.06, 0.045, 0.025), vec3(0.19, 0.14, 0.06), fract(mB * 17.0));
    diffuseColor.rgb *= (0.8 + 0.3 * mA) * (1.0 - 0.42 * mSilt);
    diffuseColor.rgb = mix(diffuseColor.rgb, mLeafCol, mLeaf * 0.85);
    diffuseColor.rgb *= 1.0 - 0.45 * uGndWet;
    mGloss = uGndWet * (0.55 + 0.4 * smoothstep(0.2, 0.7, mAcross));
  } else if (mMode < 3.5) {
    vec4 mT = texture2D(uMarkAtlas, vMarkUv);
    if (mT.a < 0.5) discard;
    diffuseColor.rgb = mT.rgb * (0.8 + 0.4 * mA) * (1.0 - 0.3 * uGndWet);
    mGloss = 0.25 + 0.4 * uGndWet;
  } else if (mMode < 4.5) {
    // A stud's reflector answers headlights: brightest at night, close to.
    mGlow = uGndNight * (1.0 - smoothstep(30.0, 110.0, length(vViewPosition)));
    mGloss = 0.5;
  } else {
    // The kerb: cast in lengths, scuffed black by tyres along its face, stained where the channel overtops.
    float mAcross = vMarkUv.y;
    float mJoint = 1.0 - smoothstep(0.0, 0.012, abs(fract(vMarkUv.x / 3.2) - 0.5) * 3.2 - 1.588);
    float mPour = fract(sin(floor(vMarkUv.x / 3.2 + 0.5) * 91.7) * 43758.5453);
    float mScuff = (1.0 - smoothstep(0.0, 0.5, mAcross)) * smoothstep(0.35, 0.6, mB * 0.6 + mA * 0.4);
    diffuseColor.rgb *= (0.78 + 0.3 * mA) * (0.92 + 0.14 * mPour) * (1.0 - 0.45 * mScuff) * (1.0 - 0.4 * mJoint);
    diffuseColor.rgb *= 1.0 - 0.32 * uGndWet;
    mGloss = 0.35 * uGndWet;
  }
}`;

/** Every material the roads, kerbs, markings, bridges and railway lines are built from. */
export function createRoadMaterials(gfx: GfxApi, shared: RoadShared): RoadMaterials {
  const mats = gfx.materials;
  const lib = mats as unknown as Materials;
  const offset = <T extends THREE.Material>(material: T, factor: number): T => {
    const copy = material.clone() as T;
    copy.polygonOffset = true;
    copy.polygonOffsetFactor = factor;
    copy.polygonOffsetUnits = factor * 2;
    return copy;
  };
  const surface = (base: THREE.MeshStandardMaterial) =>
    lib.registerPatched(offset(base, -1), 'road-surface-3', (shader) => {
      shader.uniforms.uGndNoise = shared.noise;
      shader.uniforms.uGndWet = shared.wet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${ROAD_VERT_PARS}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>${ROAD_VERT_UV}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvRoad = objectNormal;\nobjectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${ROAD_FRAG_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>${ROAD_FRAG_MAIN}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${ROAD_FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${ROAD_FRAG_NORMAL}`);
    });
  // Kerb, channel, painted lines and the ironwork let into the road share one vertex-coloured batch
  // that sits on top of the seal.
  const atlas = roadMarkingAtlas(Math.min(8, gfx.renderer.capabilities.getMaxAnisotropy()));
  const atlasUniform = { value: atlas.texture };
  const marking = lib.registerPatched(offset(mats.get('plain', { vertexColors: true, roughness: 0.78 }), -4), 'road-marking-3', (shader) => {
    shader.uniforms.uGndNoise = shared.noise;
    shader.uniforms.uGndWet = shared.wet;
    shader.uniforms.uGndNight = shared.night ?? { value: 0 };
    shader.uniforms.uMarkAtlas = atlasUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${MARK_VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvMark = objectNormal;\nvMarkUv = uv;\nobjectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${MARK_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${MARKING_FRAG}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 1.0 - mGloss;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * mGlow * 2.2;');
  });
  const tinted = (base: THREE.Material, color: THREE.Color) => {
    const key = new THREE.MeshStandardMaterial();
    setBatchHint(key, { base, color });
    return key;
  };
  const paint = (color: number) => tinted(marking, new THREE.Color(color));
  // Mown berms: one vertex-coloured batch of the grass photograph, tinted to the lawns they run beside.
  const bermBase = mats.register(offset(mats.get('grass', { vertexColors: true }), -2));
  // The photograph leans blue under a blue sky: pull it to a warmer, slightly darker grey.
  const asphalt = surface(mats.get('asphalt', { color: 0x474643 }));
  return {
    asphalt,
    // Greywacke road metal: the photograph is a good deal paler than a Canterbury back road.
    gravel: surface(mats.get('gravel', { color: 0x878071 })),
    paving: mats.register(offset(mats.get('footpath', { color: 0xc8b9a0 }), -1)),
    footpath: mats.register(offset(mats.get('footpath'), -2)),
    // Suburban and small-town footpaths are asphalt: the same batch as the carriageway.
    path: asphalt,
    berm: tinted(bermBase, bermColour(false)),
    bermPark: tinted(bermBase, bermColour(true)),
    kerb: paint(0xb4b0a4),
    gutter: paint(0x8e8b82),
    line: paint(0xe6e4d8),
    lineYellow: paint(0xd8ad2e),
    iron: paint(0xffffff),
    stud: paint(0xf2f0e4),
    studYellow: paint(0xf0c23c),
    deck: mats.get('concrete'),
    rail: mats.register(offset(mats.get('metal', { color: 0x7d7770, roughness: 0.5 }), -4)),
    girder: mats.get('paintedMetal', { color: 0x5d544c, roughness: 0.75, metalness: 0.2 }),
    ballast: mats.register(offset(mats.get('shingle', { color: 0x8a8378 }), -1)),
    sleeper: mats.register(offset(mats.get('timber', { color: 0x4f4338 }), -2)),
    tunnel: mats.get('concrete', { color: 0x9c988e }),
    lid: mats.get('grass', { color: 0x8f8448 }),
    tunnelLight: mats.emitter(0xffe6b8, 'always'),
    quay: mats.get('concrete', { color: 0x8c8980 }),
    pile: mats.get('timber', { color: 0x4a3c30 }),
  };
}

// ───────────────────────────── Geometry helpers ─────────────────────────────

type P3 = [number, number, number];
type P2 = [number, number];
const UP: P3 = [0, 1, 0];

/** Flat ribbon between two rails of points (left, right). UVs are world metres unless given. */
function strip(out: ChunkBuilderImpl, left: P3[], right: P3[], material: THREE.Material, normalLeft?: P3[], normalRight?: P3[], uvLeft?: P2[], uvRight?: P2[]) {
  if (left.length < 2) return;
  const n = left.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    pos.set(left[i], i * 6);
    pos.set(right[i], i * 6 + 3);
    nor.set(normalLeft ? normalLeft[i] : UP, i * 6);
    nor.set(normalRight ? normalRight[i] : UP, i * 6 + 3);
    if (uvLeft && uvRight) uv.set([uvLeft[i][0], uvLeft[i][1], uvRight[i][0], uvRight[i][1]], i * 4);
    else uv.set([left[i][0], left[i][2], right[i][0], right[i][2]], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  out.addGeometry(geo, material);
  geo.dispose();
}

/**
 * One flat quad, corners in order round its edge, wound whichever way faces up. `data` goes in the
 * normal (the marking shader reads it: see MARKING_FRAG).
 */
function flat(out: ChunkBuilderImpl, a: P3, b: P3, c: P3, d: P3, material: THREE.Material, data: P3, uvs?: [P2, P2, P2, P2]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...d]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([...data, ...data, ...data, ...data]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs ? [...uvs[0], ...uvs[1], ...uvs[2], ...uvs[3]] : [a[0], a[2], b[0], b[2], c[0], c[2], d[0], d[2]]), 2));
  const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  geo.setIndex(up > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  out.addGeometry(geo, material);
  geo.dispose();
}

/** A point beside a centreline sample: `offset` metres to the left, `lift` above the road. */
const beside = (s: EdgeSample, offset: number, lift: number): P3 => [s.x + s.tz * offset, s.y + lift, s.z - s.tx * offset];

/**
 * A ribbon along a run of centreline points, between two (offset, lift) rails. `face` gives it the
 * normal of a surface tilted across the road (kerb faces) instead of straight up.
 */
function ribbon(out: ChunkBuilderImpl, pts: EdgeSample[], o0: number, l0: number, o1: number, l1: number, material: THREE.Material, face = false) {
  if (pts.length < 2) return;
  const left = pts.map((p) => beside(p, o0, l0));
  const right = pts.map((p) => beside(p, o1, l1));
  if (!face) {
    strip(out, left, right, material);
    return;
  }
  // Perpendicular to the cross-section, pointing up and away from the higher side.
  const across = o1 - o0;
  const rise = l1 - l0;
  const len = Math.hypot(across, rise) || 1;
  const lean = rise / len;
  const normals = pts.map((p): P3 => [p.tz * lean, Math.abs(across) / len, -p.tx * lean]);
  strip(out, left, right, material, normals, normals);
}

const RANK: Record<RoadClass, number> = { highway: 4, arterial: 3, street: 2, lane: 1, gravel: 0, pedestrian: -1 };
const surfaceOf = (e: RoadEdge, m: RoadMaterials) => (e.cls === 'gravel' ? m.gravel : e.cls === 'pedestrian' ? m.paving : m.asphalt);

/** Surface kinds the road shader knows (see ROAD_FRAG_MAIN). */
const KIND = { asphalt: 0, chip: 1, gravel: 2, plain: 3, shoulder: 4, path: 5 } as const;
const SHOULDER_CODE = KIND.shoulder * 16;
const PATH_CODE = KIND.path * 16;
/** Half-width that switches every edge treatment off (junction pads, shoulders). */
const NO_EDGE = 31;
const CELLS = roadAtlasCells();
/** Marking data: paint of a given wear, paint through an atlas stencil, channel, cast iron, stud, kerb. */
const paintData = (wear: number): P3 => [0, wear, 0];
const stencilData = (wear: number): P3 => [1, wear, 0];
const CHANNEL: P3 = [2, 0, 0];
const IRON: P3 = [3, 0, 0];
const STUD: P3 = [4, 0, 0];
const KERB: P3 = [5, 0, 0];

/** What a road is like along its whole length: worked out once per edge. */
interface EdgeLook {
  district: DistrictType;
  /** Quiet streets, where houses stand back behind berms. */
  suburban: boolean;
  /** Beside the kerb: grass berms and an asphalt path, pavers to the building line, or asphalt right across. */
  footpath: 'berm' | 'pavers' | 'asphalt';
  /** Shops both sides: zebra crossings, marked parking. */
  shopping: boolean;
  kind: number;
  /** Whole part of the surface code (kerbed·256 + kind·16 + lanes). */
  code: number;
  seed: number;
  /** seed·32 + half the sealed width, for the UVs. */
  seedHalf: number;
  /** Along-road distance is stretched by this so 16 m cells fit the edge exactly. */
  stretch: number;
  /** Features laid out along the road keep this far from either end. */
  margin: number;
}

const looks = new WeakMap<RoadEdge, EdgeLook>();

function lookOf(map: CompiledMap, e: RoadEdge): EdgeLook {
  let look = looks.get(e);
  if (look) return look;
  const mid = e.samples[e.samples.length >> 1];
  const district = map.districtAt(mid.x, mid.z).type;
  const suburban = district === 'villa' || district === 'statehouse' || district === 'park' || district === 'rural';
  const centre = district === 'cbd' || district === 'shops';
  // Town centres are hot-mix asphalt; the highway, and the quiet streets of the suburbs, are chip seal.
  const kind = e.cls === 'gravel' ? KIND.gravel : e.cls === 'highway' || (suburban && e.cls !== 'arterial') ? KIND.chip : KIND.asphalt;
  const lanes = Math.min(15, e.cls === 'gravel' ? 1 : e.oneway ? e.lanes : e.lanes * 2);
  const kerbed = e.footpaths || e.bridge || e.tunnel;
  const seed = hashInts(e.index, 5) % 64;
  const cells = Math.max(1, Math.round(e.length / 16));
  look = {
    district,
    suburban,
    footpath: suburban ? 'berm' : centre ? 'pavers' : 'asphalt',
    shopping: centre || district === 'township',
    kind,
    code: (kerbed ? 256 : 0) + kind * 16 + lanes,
    seed,
    seedHalf: seed * 32 + Math.min(e.width / 2, NO_EDGE - 1),
    stretch: e.length > 8 ? (cells * 16) / e.length : 1,
    margin: e.width / 2 + 2,
  };
  looks.set(e, look);
  return look;
}

/** FNV-1a of a road's name: the same hash scatter/streets.ts uses to choose which side a bus shelter stands. */
function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** What is painted on, or let into, one edge besides its lane lines. Worked out once per edge. */
export interface EdgeFurniture {
  /** Distance along the edge of the middle of a zebra crossing, or null. */
  zebra: number | null;
  /** Marked parallel parking along both kerbs. */
  parking: boolean;
  /** Painted bus stops: where, and which side (1 = left of a → b). */
  busStops: { s: number; side: 1 | -1 }[];
  /** Manhole lids: distance along, offset from the centreline. */
  manholes: { s: number; offset: number }[];
  /** Sump gratings in the channel, per side. */
  sumps: { s: number; side: 1 | -1 }[];
}

const furniture = new WeakMap<RoadEdge, EdgeFurniture>();

/** Where an edge's crossing, parking, bus stops and ironwork go: from the graph alone, so it never changes. */
export function edgeFurniture(map: CompiledMap, e: RoadEdge): EdgeFurniture {
  let f = furniture.get(e);
  if (f) return f;
  f = { zebra: null, parking: false, busStops: [], manholes: [], sumps: [] };
  furniture.set(e, f);
  const sealed = e.cls !== 'gravel' && e.cls !== 'pedestrian';
  if (!sealed || !e.footpaths || e.bridge || e.tunnel) return f;
  const look = lookOf(map, e);
  const half = e.width / 2;
  const from = junctionRadius(map, e.a, e, 0.4);
  const to = e.length - junctionRadius(map, e.b, e, 0.4);
  const clear = to - from;
  const h = hashInts(e.index, 311);
  // A zebra crossing mid-block on a two-lane shopping street.
  if (look.shopping && e.lanes === 1 && (e.cls === 'street' || e.cls === 'arterial') && clear >= 44 && h % 10 < (look.district === 'cbd' ? 4 : 6)) {
    f.zebra = (from + to) / 2 + (((h >>> 4) % 9) - 4);
  }
  // Marked bays where there is room for them outside the running lanes.
  const running = e.oneway ? e.width - 4.5 : half - 2.25;
  f.parking = look.shopping && e.cls !== 'lane' && clear >= 40 && running >= e.lanes * 2.9;
  // Bus stops where scatter/streets.ts stands its shelters: every 420 m along one main road in three.
  if ((e.cls === 'arterial' || e.cls === 'highway') && hashInts(e.index, 77) % 3 === 0) {
    const name = hashName(e.name);
    for (let k = 0, s = 70; s < to - 10; k++, s += 420) {
      if (s < from + 10) continue;
      f.busStops.push({ s, side: (k + name) % 2 === 0 ? 1 : -1 });
    }
  }
  // Ironwork: a manhole every 50 m or so, sumps in the channel short of each corner and mid-block.
  if (e.cls !== 'lane' || !look.suburban) {
    for (let k = 0, s = from + 9 + (h % 23); s < to - 6; k++, s += 38 + (hashInts(e.index, k, 17) % 30)) {
      const r = hashInts(e.index, k, 29);
      const spots = [0.35, half * 0.5, -half * 0.5, half - 1.5, -(half - 1.5)];
      f.manholes.push({ s, offset: spots[r % spots.length] + (((r >>> 8) % 7) - 3) * 0.06 });
    }
  }
  for (const side of [1, -1] as const) {
    const cornerA = sideTrim(map, e.a, e, side, 0.4);
    const cornerB = sideTrim(map, e.b, e, side, 0.4);
    const a = cornerA + 2.2;
    const b = e.length - cornerB - 2.2;
    if (b - a < 6) continue;
    if (cornerA > 0) f.sumps.push({ s: a, side });
    if (cornerB > 0) f.sumps.push({ s: b, side });
    for (let s = a + 34 + (h % 17); s < b - 24; s += 62) f.sumps.push({ s, side });
  }
  return f;
}

/** Radius around a node that other edges' carriageways occupy (for trimming markings and footpaths). */
function junctionRadius(map: CompiledMap, node: number, self: RoadEdge, pad: number, vehiclesOnly = false): number {
  let r = 0;
  for (const ei of map.graph.nodes[node].edges) {
    const other = map.graph.edges[ei];
    if (ei === self.index || (vehiclesOnly && other.cls === 'pedestrian')) continue;
    r = Math.max(r, other.width / 2 + pad);
  }
  return r;
}

/**
 * How far from a node the kerb and footpath on one side of `self` must stop to clear whatever road leaves
 * the node on that side (`side`: +1 is the left of a → b). A road that simply carries on, or a side road
 * joining from the other side, does not interrupt them.
 */
function sideTrim(map: CompiledMap, node: number, self: RoadEdge, side: number, pad: number): number {
  const d = leaving(self, node);
  const want = node === self.a ? side : -side;
  let r = 0;
  for (const ei of map.graph.nodes[node].edges) {
    if (ei === self.index) continue;
    const other = map.graph.edges[ei];
    const od = leaving(other, node);
    // Component of the other road's direction towards the left of ours.
    const lateral = od[0] * d[1] - od[1] * d[0];
    if (lateral * want > 0.2) r = Math.max(r, (other.width / 2 + pad) / Math.max(0.5, Math.abs(lateral)));
  }
  return r;
}

/** True where `other` is simply the same road carrying on beyond `node`, in line with `self`. */
function carriesOn(self: RoadEdge, other: RoadEdge, node: number): boolean {
  const d = leaving(self, node);
  const od = leaving(other, node);
  return Math.abs(od[0] * d[1] - od[1] * d[0]) < 0.25 && d[0] * od[0] + d[1] * od[1] < 0;
}

/**
 * How far from its end node a bridge's parapets, kerb beams and piers must stop so that they never stand
 * on the carriageway or footpath of another road that meets the bridge there (`reach`: half the width of
 * the bridge deck). Zero where the road just carries on off the end of the bridge.
 */
function bridgeClear(map: CompiledMap, node: number, self: RoadEdge, reach: number): number {
  const d = leaving(self, node);
  let r = 0;
  for (const ei of map.graph.nodes[node].edges) {
    if (ei === self.index) continue;
    const other = map.graph.edges[ei];
    if (carriesOn(self, other, node)) continue;
    const od = leaving(other, node);
    const lateral = Math.max(0.5, Math.abs(od[0] * d[1] - od[1] * d[0]));
    const along = Math.abs(d[0] * od[0] + d[1] * od[1]);
    // The far edge of the other road's footpath (or shoulder), where the parapet line meets it.
    r = Math.max(r, (other.width / 2 + (other.footpaths ? 3.3 : 1.3) + reach * along) / lateral + 0.3);
  }
  return r;
}

/** Unit direction of an edge as it leaves a node. */
function leaving(o: RoadEdge, node: number): [number, number] {
  const n = o.samples.length;
  const a = o.a === node ? o.samples[0] : o.samples[n - 1];
  const b = o.a === node ? o.samples[Math.min(2, n - 1)] : o.samples[Math.max(0, n - 3)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.x - a.x) / len, (b.z - a.z) / len];
}

/** A node that only joins two lengths of the same road end to end: lanes carry straight on across it. */
function straightThrough(map: CompiledMap, node: number): boolean {
  const list = map.graph.nodes[node].edges;
  if (list.length !== 2) return false;
  const a = map.graph.edges[list[0]];
  const b = map.graph.edges[list[1]];
  if (a.cls !== b.cls || a.width !== b.width || a.lanes !== b.lanes || a.oneway !== b.oneway || a.cls === 'pedestrian') return false;
  const da = leaving(a, node);
  const db = leaving(b, node);
  return da[0] * db[0] + da[1] * db[1] < -0.94;
}

type Control = 'none' | 'giveway' | 'stop' | 'signal';

/** How traffic arriving along `e` at `node` is controlled, from the classes and layout of the roads that meet there. */
function approachControl(map: CompiledMap, e: RoadEdge, node: number): Control {
  const graph = map.graph;
  if (RANK[e.cls] < 1) return 'none';
  const others = graph.nodes[node].edges.filter((i) => i !== e.index).map((i) => graph.edges[i]).filter((o) => RANK[o.cls] >= 1);
  if (others.length < 2) return 'none';
  const rank = RANK[e.cls];
  const top = Math.max(...others.map((o) => RANK[o.cls]));
  if (rank < top) return top - rank >= 2 ? 'stop' : 'giveway';
  const dir = leaving(e, node);
  const through = others.some((o) => {
    const d = leaving(o, node);
    return RANK[o.cls] >= rank && dir[0] * d[0] + dir[1] * d[1] < -0.8;
  });
  if (!through) return 'giveway'; // the stem of a T
  return others.filter((o) => RANK[o.cls] === rank).length >= 3 ? 'signal' : 'none';
}

const _basis = new THREE.Matrix4();
const _left = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Road surfaces, footpaths, markings and bridges for one chunk. */
export function buildChunkRoads(cx: number, cz: number, map: CompiledMap, edges: number[], out: ChunkBuilderImpl, m: RoadMaterials) {
  const { graph, terrain } = map;
  const nodesDone = new Set<number>();
  const inChunk = (x: number, z: number) => chunkOf(x) === cx && chunkOf(z) === cz;

  for (const ei of edges) {
    const e = graph.edges[ei];
    const half = e.width / 2;
    const n = e.samples.length;
    const mine = (i: number) => inChunk(e.samples[i].x, e.samples[i].z);
    const trimA = junctionRadius(map, e.a, e, 0.4);
    const trimB = e.length - junctionRadius(map, e.b, e, 0.4);
    const sealed = e.cls !== 'gravel' && e.cls !== 'pedestrian';
    const look = lookOf(map, e);
    const suburban = look.suburban;
    // Paving stops at the edge of any carriageway it runs into; lane detail fades out towards junctions.
    const paveA = e.cls === 'pedestrian' ? junctionRadius(map, e.a, e, 0, true) : 0;
    const paveB = e.length - (e.cls === 'pedestrian' ? junctionRadius(map, e.b, e, 0, true) : 0);
    const fadeA = !straightThrough(map, e.a);
    const fadeB = !straightThrough(map, e.b);
    const feature = (s: number) => (fadeA ? smooth(trimA + 1, trimA + 11, s) : 1) * (fadeB ? smooth(trimB - 1, trimB - 11, s) : 1);
    // Whole part: what the surface is. Fraction: 0 near either end of the edge, where patches and trenches
    // (laid out by distance along this edge) must not run into the next edge's.
    const codeAt = (base: number, s: number) => base + 0.02 + 0.96 * smooth(0, look.margin, s) * smooth(e.length, e.length - look.margin, s);

    const at = (i: number, offset: number, lift: number): P3 => beside(e.samples[i], offset, lift);
    const pAt = (s: number) => graph.pointAt(e, s);
    /** Is the point `s` along the edge this chunk's to draw? */
    const here = (s: number) => {
      const p = pAt(s);
      return inChunk(p.x, p.z);
    };
    /** Painted quad between two distances along the edge and two offsets from its centreline. */
    const quad = (s0: number, s1: number, o0: number, o1: number, material: THREE.Material, data: P3, lift = 0.07, uvs?: [P2, P2, P2, P2]) => {
      const a = pAt(s0);
      const b = pAt(s1);
      flat(out, beside(a, o0, lift), beside(a, o1, lift), beside(b, o1, lift), beside(b, o0, lift), material, data, uvs);
    };
    /** A painted line along the road from s0 to s1, bent to follow it. */
    const lineAlong = (s0: number, s1: number, o0: number, o1: number, material: THREE.Material, wear: number) => {
      const steps = Math.max(1, Math.ceil((s1 - s0) / 4));
      const l: P3[] = [];
      const r: P3[] = [];
      for (let k = 0; k <= steps; k++) {
        const p = pAt(s0 + ((s1 - s0) * k) / steps);
        l.push(beside(p, Math.max(o0, o1), 0.07));
        r.push(beside(p, Math.min(o0, o1), 0.07));
      }
      const data = l.map(() => paintData(wear));
      strip(out, l, r, material, data, data);
    };
    /**
     * A word from the atlas, laid to be read by a driver travelling in `dir`: it starts `near` metres
     * short of `sRef` and ends `far` metres short of it, `width` wide about the offset `centre`.
     */
    const word = (cell: AtlasCell, sRef: number, dir: number, near: number, far: number, centre: number, width: number, material: THREE.Material, wear: number) => {
      const a = pAt(sRef - dir * near);
      const b = pAt(sRef - dir * far);
      const left = centre + (dir * width) / 2;
      const right = centre - (dir * width) / 2;
      const [u0, v0, u1, v1] = cell;
      flat(out, beside(a, left, 0.07), beside(a, right, 0.07), beside(b, right, 0.07), beside(b, left, 0.07), material, stencilData(wear), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    };
    /** A hollow painted outline through points given as (distance along, offset). */
    const outline = (pts: [number, number][], inner: number, material: THREE.Material, wear: number) => {
      const cs = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
      const co = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
      const inside = pts.map(([s, off]): [number, number] => [cs + (s - cs) * inner, co + (off - co) * inner]);
      const pt = ([s, off]: [number, number]): P3 => beside(pAt(s), off, 0.07);
      for (let q = 0; q < pts.length; q++) {
        const r = (q + 1) % pts.length;
        flat(out, pt(pts[q]), pt(pts[r]), pt(inside[r]), pt(inside[q]), material, paintData(wear));
      }
    };

    const runs: [number, number][] = [];
    let start = -1;
    for (let i = 0; i < n - 1; i++) {
      if (mine(i)) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        runs.push([start, i]);
        start = -1;
      }
    }
    if (start >= 0) runs.push([start, n - 1]);

    for (const [i0, i1] of runs) {
      /** Centreline points of this run between distances s0 and s1 along the edge, with exact ends. */
      const section = (s0: number, s1: number): EdgeSample[] => {
        const a = Math.max(s0, e.samples[i0].s);
        const b = Math.min(s1, e.samples[i1].s);
        if (b - a < 0.05) return [];
        const pts: EdgeSample[] = [graph.pointAt(e, a)];
        for (let i = i0; i <= i1; i++) if (e.samples[i].s > a + 0.2 && e.samples[i].s < b - 0.2) pts.push(e.samples[i]);
        pts.push(graph.pointAt(e, b));
        return pts;
      };
      const band = (o0: number, o1: number, lift: number, material: THREE.Material, wear: number, keep?: (i: number) => boolean) => {
        let l: P3[] = [];
        let r: P3[] = [];
        for (let i = i0; i <= i1; i++) {
          const ok = !keep || keep(i);
          if (ok) {
            l.push(at(i, o0, lift));
            r.push(at(i, o1, lift));
          }
          if (!ok || i === i1) {
            const data = l.map(() => paintData(wear));
            strip(out, l, r, material, data, data);
            l = [];
            r = [];
          }
        }
      };
      /** One 4 m dash of a broken line between samples i and i + 1. */
      const dash = (i: number, offset: number, material: THREE.Material, wear: number) => {
        const data = [paintData(wear), paintData(wear)];
        strip(out, [at(i, offset + 0.06, 0.07), at(i + 1, offset + 0.06, 0.07)], [at(i, offset - 0.06, 0.07), at(i + 1, offset - 0.06, 0.07)], material, data, data);
      };

      // The carriageway. Paving sits a hair under the seal so an overlap can never flicker.
      if (e.cls === 'pedestrian') {
        ribbon(out, section(paveA, paveB), half, 0.034, -half, 0.034, m.paving);
      } else {
        const l: P3[] = [];
        const r: P3[] = [];
        const nl: P3[] = [];
        const nr: P3[] = [];
        const uv: P2[] = [];
        for (let i = i0; i <= i1; i++) {
          const s = e.samples[i].s;
          const f = feature(s);
          const c = codeAt(look.code, s);
          l.push(at(i, half, 0.04));
          r.push(at(i, -half, 0.04));
          nl.push([half, f, c]);
          nr.push([-half, f, c]);
          uv.push([s * look.stretch, look.seedHalf]);
        }
        strip(out, l, r, surfaceOf(e, m), nl, nr, uv, uv);
      }
      // Metalled shoulders on the open highway: their outer edge is left ragged by the shader.
      if (e.cls === 'highway' && !e.bridge && !e.tunnel) {
        const shoulder = (o0: number, o1: number, across0: number, across1: number) => {
          const l: P3[] = [];
          const r: P3[] = [];
          const nl: P3[] = [];
          const nr: P3[] = [];
          const uv: P2[] = [];
          for (let i = i0; i <= i1; i++) {
            l.push(at(i, o0, 0.028));
            r.push(at(i, o1, 0.028));
            nl.push([across0, 0, SHOULDER_CODE]);
            nr.push([across1, 0, SHOULDER_CODE]);
            uv.push([e.samples[i].s, NO_EDGE]);
          }
          strip(out, l, r, m.gravel, nl, nr, uv, uv);
        };
        shoulder(half + 1.15, half - 0.05, 1.2, 0);
        shoulder(-half + 0.05, -half - 1.15, 0, 1.2);
      }

      // Kerb and channel, then the footpath: pavers to the building line in the middle of town; in the
      // suburbs an asphalt path between mown berms; asphalt right across everywhere else.
      if (e.footpaths && !e.bridge) {
        for (const side of [1, -1]) {
          const pts = section(sideTrim(map, e.a, e, side, 0.4), e.length - sideTrim(map, e.b, e, side, 0.4));
          if (pts.length < 2) continue;
          const o = (d: number) => side * (half + d);
          const flip = side === 1;
          const plain = (d0: number, l0: number, d1: number, l1: number, material: THREE.Material) =>
            flip ? ribbon(out, pts, o(d1), l1, o(d0), l0, material) : ribbon(out, pts, o(d0), l0, o(d1), l1, material);
          /** A ribbon from d0 (nearer the road) to d1 whose rails carry shader data: a normal each, and a UV of (distance along, v). */
          const rib = (d0: number, l0: number, d1: number, l1: number, material: THREE.Material, n0: (p: EdgeSample) => P3, n1: (p: EdgeSample) => P3, v0: number, v1: number) => {
            const inner = pts.map((p) => beside(p, o(d0), l0));
            const outer = pts.map((p) => beside(p, o(d1), l1));
            const ni = pts.map(n0);
            const no = pts.map(n1);
            const ui = pts.map((p): P2 => [p.s * look.stretch, v0]);
            const uo = pts.map((p): P2 => [p.s * look.stretch, v1]);
            if (flip) strip(out, outer, inner, material, no, ni, uo, ui);
            else strip(out, inner, outer, material, ni, no, ui, uo);
          };
          const channel = () => CHANNEL;
          const kerb = () => KERB;
          rib(-0.34, 0.058, -0.02, 0.058, m.gutter, channel, channel, 0, 1);
          rib(-0.02, 0.05, 0.02, 0.12, m.kerb, kerb, kerb, 0, 0.5);
          rib(0.02, 0.12, 0.17, 0.12, m.kerb, kerb, kerb, 0.5, 1);
          /** An asphalt footpath `w` wide: the road shader's own kind, with its own trenches and mossy edges. */
          const asphaltPath = (d0: number, l0: number, d1: number, l1: number) => {
            const w = d1 - d0;
            const seedHalf = ((look.seed + (side > 0 ? 7 : 19)) % 64) * 32 + w / 2;
            const data = (lat: number) => (p: EdgeSample): P3 => [lat, 1, codeAt(PATH_CODE, p.s)];
            rib(d0, l0, d1, l1, m.path, data(-w / 2), data(w / 2), seedHalf, seedHalf);
          };
          if (look.footpath === 'berm') {
            // The berm takes the colour of the grass it runs beside.
            const mid = e.samples[n >> 1];
            const beyond = side * (half + 9);
            const berm = map.districtAt(mid.x + mid.tz * beyond, mid.z - mid.tx * beyond).type === 'park' ? m.bermPark : m.berm;
            plain(0.17, 0.12, 1.25, 0.09, berm);
            asphaltPath(1.25, 0.09, 2.65, 0.07);
            plain(2.65, 0.07, 3.2, 0.0, berm);
          } else if (look.footpath === 'asphalt') {
            asphaltPath(0.17, 0.12, 3.1, 0.05);
          } else {
            plain(0.17, 0.12, 0.62, 0.075, m.footpath);
            plain(0.62, 0.075, 3.1, 0.05, m.footpath);
          }
        }
      }

      if (sealed && e.cls !== 'lane') {
        const inner = (i: number) => e.samples[i].s >= trimA + 2 && e.samples[i].s <= trimB - 2;
        // Broken lines: one 4 m segment painted, two blank.
        // The 1995 scheme: the centre line is white, broken where you may overtake. Yellow is only ever a
        // no-overtaking line, laid beside the centre line on the side of the traffic it binds: through
        // bends, over crests, across bridges, and on the last 20 to 40 m (by speed limit) up to a limit line.
        const ctlA = e.oneway ? 'none' : approachControl(map, e, e.a);
        const ctlB = approachControl(map, e, e.b);
        const bendLimit = e.cls === 'highway' ? 0.13 : 0.2;
        const hazard = (i: number) => {
          // A two-lane bridge is no place to overtake.
          if (e.bridge && e.lanes === 1) return true;
          const a = e.samples[Math.max(0, i - 4)];
          const c = e.samples[i];
          const b = e.samples[Math.min(n - 1, i + 4)];
          if (Math.abs(a.tx * b.tz - a.tz * b.tx) > bendLimit) return true;
          const before = c.s - a.s;
          const after = b.s - c.s;
          return before > 1 && after > 1 && (c.y - a.y) / before - (b.y - c.y) / after > 0.055;
        };
        // Paint on the highway is kept up; in town it is as old as the seal.
        const wLine = e.cls === 'highway' ? 0.16 : 0.34;
        // Forward traffic (a → b) keeps to the +offset side of the centre line.
        const approach = clamp(e.speedLimit * 1.5, 16, 40);
        const noFwd = (i: number) => inner(i) && (hazard(i) || (ctlB !== 'none' && e.samples[i].s > trimB - approach));
        const noBack = (i: number) => inner(i) && (hazard(i) || (ctlA !== 'none' && e.samples[i].s < trimA + approach));
        const centreLine = (solid: boolean) => {
          band(0.21, 0.09, 0.07, m.lineYellow, wLine, noFwd);
          band(-0.09, -0.21, 0.07, m.lineYellow, wLine, noBack);
          for (let i = i0; i < i1; i++) {
            if (!inner(i) || !inner(i + 1) || (noFwd(i) && noBack(i)) || (noFwd(i + 1) && noBack(i + 1))) continue;
            if (solid || i % 3 === 0) dash(i, 0, m.line, wLine);
            // Cat's-eyes down the middle of the highway, one in every gap: yellow where overtaking is barred.
            else if (e.cls === 'highway' && i % 3 === 1) {
              const p = pAt((e.samples[i].s + e.samples[i + 1].s) / 2);
              const barred = noFwd(i) || noBack(i);
              flat(out, beside(p, 0.06, 0.085), beside(p, -0.06, 0.085), beside(pAt(p.s + 0.12), -0.06, 0.085), beside(pAt(p.s + 0.12), 0.06, 0.085), barred ? m.studYellow : m.stud, STUD);
            }
          }
        };
        // Lane lines run unbroken up to a limit line.
        const laneLine = (offset: number, dir: 1 | -1) => {
          const ctl = dir === 1 ? ctlB : ctlA;
          const solid = (i: number) => ctl !== 'none' && (dir === 1 ? e.samples[i].s > trimB - 22 : e.samples[i].s < trimA + 22);
          for (let i = i0; i < i1; i++) {
            if (!inner(i) || !inner(i + 1) || !(i % 3 === 0 || (solid(i) && solid(i + 1)))) continue;
            dash(i, offset, m.line, wLine);
          }
        };
        if (e.oneway) {
          const laneW = e.width / e.lanes;
          for (let k = 1; k < e.lanes; k++) laneLine(-half + laneW * k, 1);
        } else if (e.lanes > 1) {
          // Four lanes undivided: an unbroken white centre line (nobody crosses it), broken lane lines.
          const laneW = e.width / (e.lanes * 2);
          centreLine(true);
          for (let k = 1; k < e.lanes; k++) {
            laneLine(laneW * k, 1);
            laneLine(-laneW * k, -1);
          }
        } else if (e.cls === 'highway') {
          centreLine(false);
          band(half - 0.33, half - 0.45, 0.07, m.line, wLine, inner);
          band(-half + 0.45, -half + 0.33, 0.07, m.line, wLine, inner);
        } else if (!suburban || e.cls === 'arterial') {
          // Quiet residential streets carry no centre line.
          centreLine(false);
        }

        // Limit lines where this road must yield: white for give-way (with the triangle and the words)
        // and at signals; yellow, with STOP in yellow capitals, at a stop.
        for (const end of e.oneway ? [1] : [0, 1]) {
          const node = end === 1 ? e.b : e.a;
          const control = approachControl(map, e, node);
          if (control === 'none') continue;
          // Travelling towards the node: `dir` along the edge, traffic keeps to its left.
          const dir = end === 1 ? 1 : -1;
          const sLine = end === 1 ? trimB - 0.6 : trimA + 0.6;
          if (!here(sLine) || sLine < 3 || sLine > e.length - 3) continue;
          const lo = e.oneway ? -half + 0.3 : dir * 0.14;
          const hi = e.oneway ? half - 0.3 : dir * (half - 0.3);
          const wStop = 0.5;
          quad(sLine - 0.16, sLine + 0.16, Math.max(lo, hi), Math.min(lo, hi), control === 'stop' ? m.lineYellow : m.line, paintData(wStop));
          if (control === 'signal') continue;
          const laneW = e.oneway ? e.width / e.lanes : e.width / (e.lanes * 2);
          // Room, back from the line, before the far junction's own markings begin.
          const room = end === 1 ? sLine - trimA : trimB - sLine;
          for (let k = 0; k < e.lanes; k++) {
            const centre = e.oneway ? -half + (k + 0.5) * laneW : dir * (k + 0.5) * laneW;
            const wide = Math.min(laneW - 0.9, 2.5);
            if (control === 'stop') {
              if (wide >= 1.5 && room > 7) word(CELLS.stop, sLine, dir, 4.2, 1.4, centre, wide, m.lineYellow, wStop);
              continue;
            }
            // Hollow triangle, base towards the line, 1.1 m wide and 3 m long.
            const base = sLine - dir * 1.3;
            const tip = base - dir * 3;
            outline([[base, centre - 0.55], [base, centre + 0.55], [tip, centre]], 0.62, m.line, wStop);
            if (wide >= 1.5 && room > 16) {
              word(CELLS.way, sLine, dir, 7.3, 5.3, centre, wide * 0.86, m.line, wStop);
              word(CELLS.give, sLine, dir, 10.5, 8.5, centre, wide, m.line, wStop);
            }
          }
        }
      }

      if (e.tunnel) {
        // A covered cutting: concrete walls and roof wherever the hill stands well above the road,
        // with the natural ground surface laid back over the top.
        const deep = (i: number) => terrain.natural(e.samples[i].x, e.samples[i].z) - e.samples[i].y > 7;
        let lidL: P3[] = [];
        let lidR: P3[] = [];
        for (let i = i0; i <= i1; i++) {
          const a = e.samples[i];
          const covered = deep(i);
          if (covered) {
            const reach = half + 8;
            const lx = a.x + a.tz * reach;
            const lz = a.z - a.tx * reach;
            const rx = a.x - a.tz * reach;
            const rz = a.z + a.tx * reach;
            const top = Math.max(terrain.natural(a.x, a.z), a.y + 7);
            lidL.push([lx, Math.max(terrain.natural(lx, lz), top - 3) + 0.15, lz]);
            lidR.push([rx, Math.max(terrain.natural(rx, rz), top - 3) + 0.15, rz]);
          }
          if (!covered || i === i1) {
            strip(out, lidL, lidR, m.lid);
            lidL = [];
            lidR = [];
          }
          if (covered && i < i1 && deep(i + 1)) {
            const b = e.samples[i + 1];
            _fwd.set(b.x - a.x, b.y - a.y, b.z - a.z);
            const len = _fwd.length();
            _fwd.multiplyScalar(1 / len);
            _left.set(0, 1, 0).cross(_fwd).normalize();
            _up.crossVectors(_fwd, _left);
            _basis.makeBasis(_left, _up, _fwd).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            const q = new THREE.Quaternion().setFromRotationMatrix(_basis);
            const w = e.width + 2.2;
            out.box(_basis, w / 2 + 0.25, 2.9, 0, 0.5, 5.8, len + 0.02, m.tunnel);
            out.box(_basis, -w / 2 - 0.25, 2.9, 0, 0.5, 5.8, len + 0.02, m.tunnel);
            out.box(_basis, 0, 6.05, 0, w + 1, 0.5, len + 0.02, m.tunnel);
            if (i % 3 === 0) out.box(_basis, 0, 5.74, 0, 0.5, 0.12, 1.6, m.tunnelLight);
            // Roof collider keeps the chase camera inside.
            out.colliders.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 6.05, z: (a.z + b.z) / 2, hx: w / 2 + 0.5, hy: 0.25, hz: len / 2 + 0.05, heading: 0, quat: q });
          }
        }
      }

      if (e.bridge) {
        // A concrete beam bridge: a thin deck on longitudinal beams, wall piers with rounded cutwaters
        // under a crosshead every 20 m, and post-and-rail parapets. Colliders are unchanged.
        const deckW = e.width + 1.4;
        // Parapets, kerb beams and piers belong to the span only: they stop clear of any road that
        // meets the bridge at either end, and of any that crosses it at grade in between.
        const railFrom = bridgeClear(map, e.a, e, deckW / 2);
        const railTo = e.length - bridgeClear(map, e.b, e, deckW / 2);
        const sameRoad = new Set<number>([e.index]);
        for (const ni of [e.a, e.b]) for (const k of graph.nodes[ni].edges) if (k !== e.index && carriesOn(e, graph.edges[k], ni)) sameRoad.add(k);
        const crossed = (x: number, y: number, z: number): boolean => {
          const hit = graph.nearest(x, z, 18, (o) => !sameRoad.has(o.index) && !o.tunnel);
          return !!hit && Math.abs(hit.y - y) < 1.6 && hit.distance < hit.edge.width / 2 + (hit.edge.footpaths ? 3.3 : 1.3);
        };
        for (let i = i0; i < i1; i++) {
          const a = e.samples[i];
          const b = e.samples[i + 1];
          _fwd.set(b.x - a.x, b.y - a.y, b.z - a.z);
          const len = _fwd.length();
          _fwd.multiplyScalar(1 / len);
          _left.set(0, 1, 0).cross(_fwd).normalize();
          _up.crossVectors(_fwd, _left);
          _basis.makeBasis(_left, _up, _fwd).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          const q = new THREE.Quaternion().setFromRotationMatrix(_basis);
          out.box(_basis, 0, -0.14, 0, deckW, 0.28, len + 0.02, m.deck);
          for (const bx of [-(deckW / 2 - 0.55), 0, deckW / 2 - 0.55]) out.box(_basis, bx, -0.28 - 0.42, 0, 0.5, 0.84, len + 0.02, m.deck);
          out.colliders.push({ x: (a.x + b.x) / 2 - _up.x * 0.4, y: (a.y + b.y) / 2 - _up.y * 0.4, z: (a.z + b.z) / 2 - _up.z * 0.4, hx: deckW / 2, hy: 0.4, hz: len / 2 + 0.05, heading: 0, quat: q });
          // The piece of this span that carries a parapet, as fractions of it.
          const span = b.s - a.s || 1;
          const t0 = clamp((railFrom - a.s) / span, 0, 1);
          const t1 = clamp((railTo - a.s) / span, 0, 1);
          const railLen = len * (t1 - t0);
          const mz = ((t0 + t1) / 2 - 0.5) * len;
          for (const side of [1, -1]) {
            if (railLen < 0.4) break;
            const rx = side * (deckW / 2 - 0.14);
            let blocked = false;
            for (const t of [t0, (t0 + t1) / 2, t1]) {
              blocked ||= crossed(lerp(a.x, b.x, t) + _left.x * rx, lerp(a.y, b.y, t), lerp(a.z, b.z, t) + _left.z * rx);
            }
            if (blocked) continue;
            out.box(_basis, rx, 0.11, mz, 0.3, 0.22, railLen + 0.02, m.deck);
            out.box(_basis, rx, 0.56, mz, 0.11, 0.12, railLen + 0.02, m.deck);
            out.box(_basis, rx, 0.92, mz, 0.16, 0.14, railLen + 0.02, m.deck);
            out.box(_basis, rx, 0.54, mz, 0.2, 0.66, 0.22, m.deck);
            out.colliders.push({
              x: (a.x + b.x) / 2 + _left.x * rx + _fwd.x * mz,
              y: (a.y + b.y) / 2 + 0.6 + _fwd.y * mz,
              z: (a.z + b.z) / 2 + _left.z * rx + _fwd.z * mz,
              hx: 0.14,
              hy: 0.7,
              hz: railLen / 2 + 0.05,
              heading: 0,
              quat: q,
            });
          }
          if (i % 5 === 2 && a.s > railFrom && a.s < railTo && !crossed(a.x, a.y, a.z)) {
            const ground = terrain.height(a.x, a.z);
            const under = a.y - 1.12;
            const h = under - 0.7 - ground + 1.5;
            const frame = out.frameAt(a.x, 0, a.z, Math.atan2(a.tx, a.tz));
            out.box(frame, 0, under - 0.35, 0, deckW * 0.9, 0.7, 1.3, m.deck);
            if (h > 0.5) {
              const w = deckW * 0.66;
              out.box(frame, 0, under - 0.7 - h / 2, 0, w, h, 0.7, m.deck);
              for (const cx2 of [-w / 2, w / 2]) out.cylinder(frame, cx2, under - 0.7 - h / 2, 0, 0.35, 0.35, h, m.deck, 8);
            }
          }
        }
      }
    }

    // ── What is painted or let into the road at particular spots: each belongs to the chunk it lies in. ──
    const plan = edgeFurniture(map, e);
    const wTown = 0.42;
    /** Broken yellow no-stopping line along one kerb from s0 to s1. */
    const noStopping = (s0: number, s1: number, side: number) => {
      const hi = side * (half - 0.46);
      const lo = side * (half - 0.56);
      for (let s = s0; s + 1 <= s1 + 0.01; s += 2) {
        if (here(s)) quad(s, s + 1, Math.max(lo, hi), Math.min(lo, hi), m.lineYellow, paintData(wTown));
      }
    };
    // Broken yellow no-stopping lines along the kerb for the last 12 m into each corner in town.
    if (e.footpaths && !e.bridge && sealed && !suburban && e.length > 60) {
      for (const side of [1, -1]) {
        for (const end of [0, 1]) {
          const trim = sideTrim(map, end === 0 ? e.a : e.b, e, side, 0.4);
          if (trim <= 0) continue;
          if (end === 0) noStopping(trim + 0.8, trim + 11.8, side);
          else noStopping(e.length - trim - 11.8, e.length - trim - 0.8, side);
        }
      }
    }
    if (plan.zebra !== null) {
      // A zebra crossing: bars 3 m long and half a metre wide from channel to channel, a diamond in each
      // approach lane to warn of it, and no stopping for 6 m either side.
      const z = plan.zebra;
      if (here(z)) {
        for (let o = -half + 0.6; o + 0.5 <= half - 0.55; o += 1) quad(z - 1.5, z + 1.5, o + 0.5, o, m.line, paintData(0.38));
        for (const side of [1, -1]) {
          noStopping(z - 8, z - 2, side);
          noStopping(z + 2.2, z + 8.2, side);
        }
      }
      for (const dir of [1, -1]) {
        const back = Math.min(34, (dir === 1 ? z - trimA : trimB - z) - 6);
        const s = z - dir * back;
        if (back < 12 || !here(s)) continue;
        const centre = (dir * half) / 2;
        outline([[s - 2.4, centre], [s, centre + 0.62], [s + 2.4, centre], [s, centre - 0.62]], 0.72, m.line, wTown);
      }
    }
    /** Is a stretch of kerb taken by the crossing, or by a bus stop on that side? */
    const kerbTaken = (s: number, side: number) => (plan.zebra !== null && Math.abs(s - plan.zebra) < 10) || plan.busStops.some((b) => b.side === side && Math.abs(s - b.s) < 10.5);
    if (plan.parking) {
      // Parallel bays: a T at each end of a 6 m space, 2.2 m out from the kerb.
      for (const side of [1, -1]) {
        const a = sideTrim(map, e.a, e, side, 0.4) + 13.5;
        const b = e.length - sideTrim(map, e.b, e, side, 0.4) - 13.5;
        for (let s = a; s <= b + 0.01; s += 6) {
          if (kerbTaken(s, side) || !here(s)) continue;
          const o0 = side * (half - 0.42);
          const o1 = side * (half - 2.2);
          quad(s - 0.05, s + 0.05, Math.max(o0, o1), Math.min(o0, o1), m.line, paintData(wTown));
          const o2 = side * (half - 2.3);
          quad(s - 0.7, s + 0.7, Math.max(o1, o2), Math.min(o1, o2), m.line, paintData(wTown));
        }
      }
    }
    for (const stop of plan.busStops) {
      // A bus stop: a broken yellow box 14 m long against the kerb, BUS STOP in yellow inside it.
      if (!here(stop.s)) continue;
      const { s, side } = stop;
      const o0 = side * (half - 0.42);
      const o1 = side * (half - 2.6);
      const o2 = side * (half - 2.7);
      for (let k = -7; k < 7; k += 2) lineAlong(s + k, s + k + 1.2, o1, o2, m.lineYellow, wTown);
      for (const end of [-7, 7]) quad(s + end - 0.05, s + end + 0.05, Math.max(o0, o1), Math.min(o0, o1), m.lineYellow, paintData(wTown));
      const centre = side * (half - 1.5);
      word(CELLS.bus, s, side, 2.6, 0.7, centre, 1.7, m.lineYellow, wTown);
      word(CELLS.stop, s, side, -0.5, -2.4, centre, 1.9, m.lineYellow, wTown);
    }
    for (const lid of plan.manholes) {
      if (!here(lid.s)) continue;
      const [u0, v0, u1, v1] = CELLS.manhole;
      quad(lid.s - 0.31, lid.s + 0.31, lid.offset + 0.31, lid.offset - 0.31, m.iron, IRON, 0.062, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    for (const sump of plan.sumps) {
      if (!here(sump.s)) continue;
      const [u0, v0, u1, v1] = CELLS.sump;
      const o0 = sump.side * (half - 0.03);
      const o1 = sump.side * (half - 0.46);
      quad(sump.s - 0.33, sump.s + 0.33, o0, o1, m.iron, IRON, 0.064, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }

    // Junction pads: a disc at each node covers the gap where ribbons meet at an angle. Where a mall
    // or square runs into a street the pad is the street's, no wider than the street.
    for (const ni of [e.a, e.b]) {
      if (nodesDone.has(ni)) continue;
      const node = graph.nodes[ni];
      if (!inChunk(node.x, node.z)) continue;
      nodesDone.add(ni);
      const meeting = node.edges.map((k) => graph.edges[k]);
      const vehicles = meeting.filter((o) => o.cls !== 'pedestrian');
      const group = vehicles.length ? vehicles : meeting;
      let r = 0;
      let best: RoadEdge | null = null;
      for (const other of group) {
        if (other.width / 2 > r) r = other.width / 2;
        if (!best || (best.cls === 'gravel' && other.cls !== 'gravel')) best = other;
      }
      if (!best) continue;
      const paved = best.cls === 'pedestrian';
      const through = straightThrough(map, ni);
      const dir = leaving(best, ni);
      const geo = new THREE.CircleGeometry(r + 0.15, 16).rotateX(-Math.PI / 2).translate(node.x, node.y + (paved ? 0.034 : 0.04), node.z);
      const uv = geo.getAttribute('uv');
      const pos = geo.getAttribute('position');
      const nor = geo.getAttribute('normal');
      const bestLook = lookOf(map, best);
      for (let i = 0; i < uv.count; i++) {
        if (paved) {
          uv.setXY(i, pos.getX(i), pos.getZ(i));
          continue;
        }
        // The same surface as the road, with nothing laid out along it. Where the road simply carries
        // on, its lanes and edges carry on too; where roads cross, there are none.
        if (through) {
          nor.setXYZ(i, (pos.getX(i) - node.x) * dir[1] - (pos.getZ(i) - node.z) * dir[0], 1, bestLook.code);
          uv.setXY(i, 0, bestLook.seedHalf);
        } else {
          nor.setXYZ(i, 0, 0, bestLook.kind * 16);
          uv.setXY(i, 0, NO_EDGE);
        }
      }
      out.addGeometry(geo, surfaceOf(best, m));
      geo.dispose();
    }
  }
}

/**
 * The line of the quay wall through one chunk, as short straight segments with the direction of the land
 * (unit vector) and the height of the apron: the zero contour of the terrain's quay field, kept only
 * where there really is deep water on one side and an apron on the other.
 */
export function quaySegments(cx: number, cz: number, map: CompiledMap): { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; top: number }[] {
  const terrain = map.terrain;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  // Most chunks have no built land in them at all (the narrowest mole is 60 m across).
  let any = false;
  for (let j = 0; j <= 8 && !any; j++) for (let i = 0; i <= 8 && !any; i++) any = !!terrain.quay(x0 + i * 32, z0 + j * 32);
  if (!any) return [];
  const STEP = 8;
  const n = CHUNK / STEP;
  const field = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) field[j * (n + 1) + i] = terrain.quay(x0 + i * STEP, z0 + j * STEP)?.edge ?? -1;
  const segments: ReturnType<typeof quaySegments> = [];
  const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Where the contour crosses the sides of this cell.
      const cross: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const [ai, aj] = corners[k];
        const [bi, bj] = corners[(k + 1) % 4];
        const fa = field[(j + aj) * (n + 1) + i + ai];
        const fb = field[(j + bj) * (n + 1) + i + bi];
        if (fa >= 0 === fb >= 0) continue;
        const t = fa / (fa - fb);
        cross.push([x0 + (i + ai + (bi - ai) * t) * STEP, z0 + (j + aj + (bj - aj) * t) * STEP]);
      }
      if (cross.length !== 2) continue;
      const [[ax, az], [bx, bz]] = cross;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let nx = (bz - az) / len;
      let nz = -(bx - ax) / len;
      const ahead = terrain.quay(mx + nx * 2, mz + nz * 2)?.edge ?? -1;
      if (ahead < 0) {
        nx = -nx;
        nz = -nz;
      }
      const land = terrain.quay(mx + nx * 2, mz + nz * 2);
      // The port landmarks build their own wharves out over the water: leave their frontage to them.
      if (map.landmarks.some((l) => (l.kind === 'lyttelton-port' || l.kind === 'timaru-port') && Math.hypot(l.x - mx, l.z - mz) < l.clearRadius + 6)) continue;
      if (!land || terrain.height(mx - nx * 5, mz - nz * 5) > -2 || terrain.height(mx + nx * 4, mz + nz * 4) < land.top - 1) continue;
      segments.push({ ax, az, bx, bz, nx, nz, top: land.top });
    }
  }
  return segments;
}

/**
 * Quay walls: a concrete deck out to the wall line (over the batter the terrain makes of the drop), a
 * coping along its edge, the wall face down into the water and timber fender piles against it.
 */
function buildQuays(cx: number, cz: number, map: CompiledMap, out: ChunkBuilderImpl, m: RoadMaterials) {
  const DECK = 7.6;
  const FOOT = -3.6;
  for (const q of quaySegments(cx, cz, map)) {
    // The wall stands a little seaward of the contour, clear of the top of the batter.
    const ax = q.ax - q.nx * 0.8;
    const az = q.az - q.nz * 0.8;
    const bx = q.bx - q.nx * 0.8;
    const bz = q.bz - q.nz * 0.8;
    const len = Math.hypot(bx - ax, bz - az);
    const heading = Math.atan2(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const y = q.top + 0.03;
    flat(out, [ax, y, az], [bx, y, bz], [bx + q.nx * DECK, y, bz + q.nz * DECK], [ax + q.nx * DECK, y, az + q.nz * DECK], m.quay, UP);
    const frame = out.frameAt(mx, 0, mz, heading);
    // Which way the water lies in the frame's own x.
    const sea = Math.cos(heading) * -q.nx - Math.sin(heading) * -q.nz > 0 ? 1 : -1;
    out.box(frame, sea * -0.2, (q.top + FOOT) / 2, 0, 0.4, q.top - FOOT, len + 0.3, m.quay);
    out.box(frame, sea * -0.18, q.top + 0.17, 0, 0.36, 0.28, len + 0.3, m.tunnel);
    for (let d = 1.3; d < len; d += 2.7) out.cylinder(frame, sea * 0.2, (q.top + 0.4 + FOOT) / 2, d - len / 2, 0.17, 0.19, q.top + 0.4 - FOOT, m.pile, 7);
    // Something to stand on over the batter, and a kerb that stops a car rolling in.
    out.colliders.push({ x: mx + q.nx * (DECK / 2), y: q.top - 0.24, z: mz + q.nz * (DECK / 2), hx: DECK / 2, hy: 0.25, hz: len / 2 + 0.1, heading });
    out.colliders.push({ x: mx + q.nx * 0.18, y: q.top + 0.15, z: mz + q.nz * 0.18, hx: 0.18, hy: 0.16, hz: len / 2 + 0.1, heading });
  }
}

/** Rail height along a line, memoised per sample: NaN until asked for. */
const railProfiles = new WeakMap<RailPath, { y: Float32Array; bed: Int8Array }>();

/**
 * Where a railway crosses a river bed it is carried level between the banks on a girder bridge (the
 * terrain under it is the carved bed). Returns the rail's base height at sample `i` and whether that
 * sample is on a bridge.
 */
function railHeight(rail: RailPath, i: number, map: CompiledMap, heightAt: (x: number, z: number) => number): { y: number; bridge: boolean } {
  let profile = railProfiles.get(rail);
  if (!profile) railProfiles.set(rail, (profile = { y: new Float32Array(rail.samples.length).fill(NaN), bed: new Int8Array(rail.samples.length).fill(-1) }));
  const { y, bed } = profile;
  const s = rail.samples;
  const inBed = (k: number): boolean => {
    if (k < 0 || k >= s.length) return false;
    if (bed[k] < 0) {
      const surface = map.terrain.surface(s[k].x, s[k].z);
      bed[k] = surface === 'water' || surface === 'shingle' ? 1 : 0;
    }
    return bed[k] === 1;
  };
  if (Number.isNaN(y[i])) {
    if (!inBed(i)) {
      y[i] = heightAt(s[i].x, s[i].z);
    } else {
      let a = i;
      let b = i;
      while (inBed(a - 1)) a--;
      while (inBed(b + 1)) b++;
      // Abutments one sample back from the water's edge on each bank.
      const a0 = Math.max(0, a - 2);
      const b0 = Math.min(s.length - 1, b + 2);
      const ya = heightAt(s[a0].x, s[a0].z);
      const yb = heightAt(s[b0].x, s[b0].z);
      for (let k = a0; k <= b0; k++) y[k] = ya + ((yb - ya) * (s[k].s - s[a0].s)) / (s[b0].s - s[a0].s || 1);
    }
  }
  return { y: y[i], bridge: inBed(i) };
}

/** Railway lines for one chunk (river and sea surfaces are built by ground.ts). */
export function buildChunkLines(cx: number, cz: number, map: CompiledMap, rails: RailPath[], heightAt: (x: number, z: number) => number, out: ChunkBuilderImpl, m: RoadMaterials) {
  buildQuays(cx, cz, map, out, m);
  for (const rail of rails) {
    const s = rail.samples;
    const tram = rail.source.kind === 'tram';
    let l: P3[][] = [[], [], [], [], [], [], [], []];
    const flushBallast = () => {
      if (l[0].length > 1) strip(out, l[0], l[1], m.ballast);
      l[0] = [];
      l[1] = [];
    };
    const flush = () => {
      if (!tram) {
        flushBallast();
        if (l[2].length > 1) strip(out, l[2], l[3], m.sleeper);
      }
      if (l[4].length > 1) {
        for (const [a, b] of [
          [4, 5],
          [6, 7],
        ]) strip(out, l[a], l[b], m.rail);
      }
      l = [[], [], [], [], [], [], [], []];
    };
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      const inside = chunkOf(p.x) === cx && chunkOf(p.z) === cz;
      const prevInside = i > 0 && chunkOf(s[i - 1].x) === cx && chunkOf(s[i - 1].z) === cz;
      if (!inside && !prevInside) {
        flush();
        continue;
      }
      const { y, bridge } = railHeight(rail, i, map, heightAt);
      const pt = (offset: number, lift: number): P3 => [p.x + p.tz * offset, y + lift, p.z - p.tx * offset];
      const base = tram ? 0.075 : 0.3;
      if (bridge) {
        flushBallast();
      } else {
        l[0].push(pt(1.7, 0.16));
        l[1].push(pt(-1.7, 0.16));
      }
      l[2].push(pt(1.05, 0.22));
      l[3].push(pt(-1.05, 0.22));
      // 1,067 mm "Cape gauge".
      l[4].push(pt(0.58, base));
      l[5].push(pt(0.49, base));
      l[6].push(pt(-0.49, base));
      l[7].push(pt(-0.58, base));
      if (bridge && !tram && inside && i + 1 < s.length) {
        // An open-deck plate-girder span to the next sample, on a concrete pier every fourth one.
        const q = s[i + 1];
        const next = railHeight(rail, i + 1, map, heightAt).y;
        _fwd.set(q.x - p.x, next - y, q.z - p.z);
        const len = _fwd.length();
        _fwd.multiplyScalar(1 / len);
        _left.set(0, 1, 0).cross(_fwd).normalize();
        _up.crossVectors(_fwd, _left);
        _basis.makeBasis(_left, _up, _fwd).setPosition((p.x + q.x) / 2, (y + next) / 2, (p.z + q.z) / 2);
        for (const side of [0.85, -0.85]) out.box(_basis, side, -0.42, 0, 0.3, 1.15, len + 0.02, m.girder);
        if (i % 4 === 0) {
          const ground = heightAt(p.x, p.z);
          const h = y - 1.0 - ground + 1.2;
          if (h > 0.4) out.box(out.frameAt(p.x, 0, p.z, Math.atan2(p.tx, p.tz)), 0, y - 1.0 - h / 2, 0, 3.0, h, 0.9, m.deck);
        }
      }
      if (!inside) flush();
    }
    flush();
  }
}
