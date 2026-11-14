import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/math';
import type { EdgeSample, GfxApi, RoadClass, RoadEdge } from '../core/types';
import { setBatchHint, type Materials } from '../render/materials';
import type { ChunkBuilderImpl } from './chunkbuilder';
import { bermColour } from './ground';
import { chunkOf } from './lots';
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
}

/** Uniforms the road shaders share with the terrain (world/ground.ts). */
export interface RoadShared {
  noise: THREE.IUniform<THREE.Texture>;
  wet: THREE.IUniform<number>;
}

// ───────────────────────────── Materials ─────────────────────────────

const ROAD_VERT_PARS = /* glsl */ `
varying vec3 vRoad;
varying vec3 vRoadW;`;

const ROAD_FRAG_PARS = /* glsl */ `
uniform sampler2D uGndNoise;
uniform float uGndWet;
varying vec3 vRoad;
varying vec3 vRoadW;
float roadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

/**
 * What a road surface has that a texture alone does not: wheel paths, the oil line between them, reseal
 * patches with their tar borders, crack-sealing "snakes", bitumen flushed up through the chip on the
 * highway, wheel-packed tracks on gravel; and when it rains, a dark sheen with standing water in the ruts.
 *
 * Each strip says where a fragment sits across the road through its (otherwise constant) normal:
 * x = metres left of the centreline, y = 1 on the open road falling to 0 at junctions (where strips
 * overlap, so everything tied to the lane must fade out), z = surface kind and lane width.
 */
const ROAD_FRAG_MAIN = /* glsl */ `
vec2 rXZ = vRoadW.xz;
float rKind = floor(vRoad.z / 32.0 + 0.01);
float rLane = max(mod(vRoad.z, 16.0), 2.0);
float rOdd = step(15.5, mod(vRoad.z, 32.0));
float rFeat = clamp(vRoad.y, 0.0, 1.0);
vec4 rN1 = texture2D(uGndNoise, rXZ / 37.0);
vec4 rN2 = texture2D(uGndNoise, rXZ / 5.3 + 0.41);
float rM = (fract(vRoad.x / rLane + rOdd * 0.5) - 0.5) * rLane;
float rTrack = exp(-pow((abs(rM) - 0.82) / 0.36, 2.0)) * rFeat;
float rOil = exp(-pow(rM / 0.24, 2.0)) * rFeat;
vec3 rCol = diffuseColor.rgb;
vec3 rCoarse = texture2D(map, vMapUv * 0.37).rgb;
float rTone = 0.9 + 0.2 * rN1.a + 0.12 * (rN2.a - 0.5);
// Tar poured into the cracks: thin dark contour lines, in some stretches only.
float rSw = fwidth(rN1.b);
float rSeam = (1.0 - smoothstep(0.0025, 0.004 + rSw, abs(rN1.b - 0.33))) * clamp(0.006 / (0.006 + rSw), 0.0, 1.0);
rSeam *= smoothstep(0.5, 0.62, texture2D(uGndNoise, rXZ / 149.0 + 0.2).a);
if (rKind < 0.5) {
  // Town asphalt, with the odd rectangle of newer seal let into it.
  vec2 rCellSize = vec2(9.0, 13.0);
  vec2 rCell = floor(rXZ / rCellSize);
  vec2 rSize = vec2(0.25 + 0.5 * roadHash(rCell + 3.1), 0.2 + 0.6 * roadHash(rCell + 7.7));
  vec2 rIn = (fract(rXZ / rCellSize) - vec2(roadHash(rCell + 1.3), roadHash(rCell + 5.9)) * (1.0 - rSize)) / rSize;
  vec2 rEdge = min(rIn, 1.0 - rIn) * rSize * rCellSize;
  float rBorder = min(rEdge.x, rEdge.y);
  float rPatch = step(0.87, roadHash(rCell)) * step(0.0, rBorder);
  rCol *= rTone * mix(1.0, 0.76 + 0.2 * roadHash(rCell + 9.2), rPatch);
  rCol *= 1.0 - 0.42 * max(rPatch * (1.0 - smoothstep(0.03, 0.1, rBorder)), rSeam);
  rCol *= 1.0 - 0.15 * rTrack - 0.1 * rOil;
} else if (rKind < 1.5) {
  // Chip seal: coarser, paler stone; bitumen bleeds up dark and smooth where the wheels run.
  rCol = mix(rCol, rCoarse * (rCol / max(sampledDiffuseColor.rgb, vec3(0.02))), 0.55);
  rCol *= vec3(1.14, 1.1, 1.03) * (0.9 + 0.2 * rN1.a);
  rCol *= 1.0 - (0.2 + 0.2 * rN2.a) * rTrack - 0.3 * rSeam;
} else if (rKind < 2.5) {
  // Gravel road. The photograph is fine pea gravel, so most of the colour comes from it laid coarser:
  // 20 mm road metal. Pale where the wheels have packed it and the clay fines show, loose darker metal
  // heaped along the crown and the edges, the odd pothole in the wheel tracks.
  rCol = mix(rCol, rCoarse * (rCol / max(sampledDiffuseColor.rgb, vec3(0.02))), 0.7);
  float rLoose = max(rOil, smoothstep(1.5, 2.4, abs(rM)) * rFeat);
  float rHole = smoothstep(0.74, 0.8, rN2.a) * rTrack;
  rCol *= (0.76 + 0.34 * rN1.a + 0.12 * (rN2.a - 0.5)) * (1.0 + 0.3 * rTrack * (1.0 - rLoose) - 0.3 * rLoose * (0.5 + rN2.a));
  rCol *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), rTrack) * (1.0 - 0.34 * rHole);
} else if (rKind < 3.5) {
  rCol *= rTone * (1.0 - 0.3 * rSeam);
} else {
  // Metalled shoulder: darker, dirtier gravel than a graded road.
  rCol *= 0.6 * (0.86 + 0.28 * rN1.a);
}
float rRut = (rKind < 1.5 ? rTrack : 0.0);
float rPuddle = smoothstep(0.5, 0.64, rN1.a * 0.72 + rN2.a * 0.14 + rRut * 0.2) * smoothstep(0.3, 0.85, uGndWet);
rCol *= 1.0 - uGndWet * (0.36 + 0.24 * rPuddle);
diffuseColor.rgb = rCol;
`;

const ROAD_FRAG_ROUGH = /* glsl */ `
roughnessFactor *= 1.0 - 0.14 * rRut;
roughnessFactor = mix(roughnessFactor * (1.0 - 0.62 * uGndWet), 0.05, rPuddle);`;

/** Paint wears through where the tyres scrub it. */
const MARKING_FRAG = /* glsl */ `
{
  float mA = texture2D(uGndNoise, vRoadW.xz / 2.3).a;
  float mB = texture2D(uGndNoise, vRoadW.xz / 0.41 + 0.3).a;
  if (vColor.r > 0.45 && mA * 0.35 + mB * 0.65 < 0.27) discard;
  diffuseColor.rgb *= 0.8 + 0.34 * mA;
  diffuseColor.rgb *= 1.0 - 0.3 * uGndWet;
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
    lib.registerPatched(offset(base, -1), 'road-surface', (shader) => {
      shader.uniforms.uGndNoise = shared.noise;
      shader.uniforms.uGndWet = shared.wet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${ROAD_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvRoad = objectNormal;\nobjectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${ROAD_FRAG_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>${ROAD_FRAG_MAIN}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${ROAD_FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, rPuddle));');
    });
  // Kerb channel and painted lines share one vertex-coloured batch that sits on top of the seal.
  const marking = lib.registerPatched(offset(mats.get('plain', { vertexColors: true, roughness: 0.78 }), -4), 'road-marking', (shader) => {
    shader.uniforms.uGndNoise = shared.noise;
    shader.uniforms.uGndWet = shared.wet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoadW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoadW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGndNoise;\nuniform float uGndWet;\nvarying vec3 vRoadW;')
      .replace('#include <color_fragment>', `#include <color_fragment>${MARKING_FRAG}`);
  });
  const tinted = (base: THREE.Material, color: THREE.Color) => {
    const key = new THREE.MeshStandardMaterial();
    setBatchHint(key, { base, color });
    return key;
  };
  const paint = (color: number) => tinted(marking, new THREE.Color(color));
  // Mown berms: one vertex-coloured batch of the grass photograph, tinted to the lawns they run beside.
  const bermBase = mats.register(offset(mats.get('grass', { vertexColors: true }), -2));
  return {
    // The photograph leans blue under a blue sky: pull it to a warmer, slightly darker grey.
    asphalt: surface(mats.get('asphalt', { color: 0x474643 })),
    // Greywacke road metal: the photograph is a good deal paler than a Canterbury back road.
    gravel: surface(mats.get('gravel', { color: 0x878071 })),
    paving: mats.register(offset(mats.get('footpath', { color: 0xc8b9a0 }), -1)),
    footpath: mats.register(offset(mats.get('footpath'), -2)),
    path: mats.register(offset(mats.get('concrete', { color: 0xb3aea2 }), -2)),
    berm: tinted(bermBase, bermColour(false)),
    bermPark: tinted(bermBase, bermColour(true)),
    kerb: mats.get('concrete', { color: 0xbcb8ad }),
    gutter: paint(0x86837b),
    line: paint(0xe6e4d8),
    lineYellow: paint(0xd8ad2e),
    deck: mats.get('concrete'),
    rail: mats.register(offset(mats.get('metal', { color: 0x7d7770, roughness: 0.5 }), -4)),
    girder: mats.get('paintedMetal', { color: 0x5d544c, roughness: 0.75, metalness: 0.2 }),
    ballast: mats.register(offset(mats.get('shingle', { color: 0x8a8378 }), -1)),
    sleeper: mats.register(offset(mats.get('timber', { color: 0x4f4338 }), -2)),
    tunnel: mats.get('concrete', { color: 0x9c988e }),
    lid: mats.get('grass', { color: 0x8f8448 }),
    tunnelLight: mats.emitter(0xffe6b8, 'always'),
  };
}

// ───────────────────────────── Geometry helpers ─────────────────────────────

type P3 = [number, number, number];
const UP: P3 = [0, 1, 0];

/** Flat ribbon between two rails of points (left, right), world-space UVs in metres. */
function strip(out: ChunkBuilderImpl, left: P3[], right: P3[], material: THREE.Material, normalLeft?: P3[], normalRight?: P3[]) {
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
    uv.set([left[i][0], left[i][2], right[i][0], right[i][2]], i * 4);
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

/** Packed into a surface strip's normal.z for the road shader: kind (0 asphalt, 1 chip seal, 2 gravel, 3 plain, 4 shoulder), lane parity and width. */
function surfaceCode(e: RoadEdge): number {
  const kind = e.cls === 'gravel' ? 2 : e.cls === 'highway' ? 1 : 0;
  const lanes = e.cls === 'gravel' ? 1 : e.oneway ? e.lanes : e.lanes * 2;
  const laneWidth = clamp(e.width / lanes, 2, 15.5);
  return kind * 32 + (lanes % 2) * 16 + laneWidth;
}
const PLAIN_CODE = 3 * 32 + 4;
const SHOULDER_CODE = 4 * 32 + 4;

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
    const mid = e.samples[n >> 1];
    const district = map.districtAt(mid.x, mid.z).type;
    const suburban = district === 'villa' || district === 'statehouse' || district === 'park' || district === 'rural';
    const code = surfaceCode(e);
    // Paving stops at the edge of any carriageway it runs into; lane detail fades out towards junctions.
    const paveA = e.cls === 'pedestrian' ? junctionRadius(map, e.a, e, 0, true) : 0;
    const paveB = e.length - (e.cls === 'pedestrian' ? junctionRadius(map, e.b, e, 0, true) : 0);
    const fadeA = !straightThrough(map, e.a);
    const fadeB = !straightThrough(map, e.b);
    const feature = (s: number) => (fadeA ? smooth(trimA + 1, trimA + 11, s) : 1) * (fadeB ? smooth(trimB - 1, trimB - 11, s) : 1);

    const at = (i: number, offset: number, lift: number): P3 => beside(e.samples[i], offset, lift);
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
      const band = (o0: number, o1: number, lift: number, material: THREE.Material, keep?: (i: number) => boolean) => {
        let l: P3[] = [];
        let r: P3[] = [];
        for (let i = i0; i <= i1; i++) {
          const ok = !keep || keep(i);
          if (ok) {
            l.push(at(i, o0, lift));
            r.push(at(i, o1, lift));
          }
          if (!ok || i === i1) {
            strip(out, l, r, material);
            l = [];
            r = [];
          }
        }
      };

      // The carriageway. Paving sits a hair under the seal so an overlap can never flicker.
      if (e.cls === 'pedestrian') {
        ribbon(out, section(paveA, paveB), half, 0.034, -half, 0.034, m.paving);
      } else {
        const l: P3[] = [];
        const r: P3[] = [];
        const nl: P3[] = [];
        const nr: P3[] = [];
        for (let i = i0; i <= i1; i++) {
          const f = feature(e.samples[i].s);
          l.push(at(i, half, 0.04));
          r.push(at(i, -half, 0.04));
          nl.push([half, f, code]);
          nr.push([-half, f, code]);
        }
        strip(out, l, r, surfaceOf(e, m), nl, nr);
      }
      // Metalled shoulders on the open highway.
      if (e.cls === 'highway' && !e.bridge && !e.tunnel) {
        const shoulder = (o0: number, o1: number) => {
          const l: P3[] = [];
          const r: P3[] = [];
          const nn: P3[] = [];
          for (let i = i0; i <= i1; i++) {
            l.push(at(i, o0, 0.028));
            r.push(at(i, o1, 0.028));
            nn.push([0, 0, SHOULDER_CODE]);
          }
          strip(out, l, r, m.gravel, nn, nn);
        };
        shoulder(half + 1.15, half - 0.05);
        shoulder(-half + 0.05, -half - 1.15);
      }

      // Kerb and channel, then the footpath: pavers to the building line in town; in the suburbs a
      // concrete path between mown berms.
      if (e.footpaths && !e.bridge) {
        for (const side of [1, -1]) {
          const pts = section(sideTrim(map, e.a, e, side, 0.4), e.length - sideTrim(map, e.b, e, side, 0.4));
          const o = (d: number) => side * (half + d);
          const flip = side === 1;
          const rib = (d0: number, l0: number, d1: number, l1: number, material: THREE.Material, face = false) =>
            flip ? ribbon(out, pts, o(d1), l1, o(d0), l0, material, face) : ribbon(out, pts, o(d0), l0, o(d1), l1, material, face);
          rib(-0.34, 0.058, -0.02, 0.058, m.gutter);
          rib(-0.02, 0.05, 0.02, 0.12, m.kerb, true);
          rib(0.02, 0.12, 0.17, 0.12, m.kerb);
          if (suburban) {
            // The berm takes the colour of the grass it runs beside.
            const beyond = side * (half + 9);
            const berm = map.districtAt(mid.x + mid.tz * beyond, mid.z - mid.tx * beyond).type === 'park' ? m.bermPark : m.berm;
            rib(0.17, 0.12, 0.9, 0.085, berm);
            rib(0.9, 0.085, 2.5, 0.065, m.path);
            rib(2.5, 0.065, 3.2, 0.0, berm);
          } else {
            rib(0.17, 0.12, 0.62, 0.075, m.footpath);
            rib(0.62, 0.075, 3.1, 0.05, m.footpath);
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
        // Forward traffic (a → b) keeps to the +offset side of the centre line.
        const approach = clamp(e.speedLimit * 1.5, 16, 40);
        const noFwd = (i: number) => inner(i) && (hazard(i) || (ctlB !== 'none' && e.samples[i].s > trimB - approach));
        const noBack = (i: number) => inner(i) && (hazard(i) || (ctlA !== 'none' && e.samples[i].s < trimA + approach));
        const centreLine = (solid: boolean) => {
          band(0.21, 0.09, 0.07, m.lineYellow, noFwd);
          band(-0.09, -0.21, 0.07, m.lineYellow, noBack);
          for (let i = i0; i < i1; i++) {
            if (!inner(i) || !inner(i + 1) || (noFwd(i) && noBack(i)) || (noFwd(i + 1) && noBack(i + 1))) continue;
            if (solid || i % 3 === 0) strip(out, [at(i, 0.06, 0.07), at(i + 1, 0.06, 0.07)], [at(i, -0.06, 0.07), at(i + 1, -0.06, 0.07)], m.line);
          }
        };
        // Lane lines run unbroken up to a limit line.
        const laneLine = (offset: number, dir: 1 | -1) => {
          const ctl = dir === 1 ? ctlB : ctlA;
          const solid = (i: number) => ctl !== 'none' && (dir === 1 ? e.samples[i].s > trimB - 22 : e.samples[i].s < trimA + 22);
          for (let i = i0; i < i1; i++) {
            if (!inner(i) || !inner(i + 1) || !(i % 3 === 0 || (solid(i) && solid(i + 1)))) continue;
            strip(out, [at(i, offset + 0.06, 0.07), at(i + 1, offset + 0.06, 0.07)], [at(i, offset - 0.06, 0.07), at(i + 1, offset - 0.06, 0.07)], m.line);
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
          band(half - 0.33, half - 0.45, 0.07, m.line, inner);
          band(-half + 0.45, -half + 0.33, 0.07, m.line, inner);
        } else if (!suburban || e.cls === 'arterial') {
          // Quiet residential streets carry no centre line.
          centreLine(false);
        }

        // Limit lines where this road must yield: white for give-way (with the triangle) and at signals,
        // yellow at a stop.
        for (const end of e.oneway ? [1] : [0, 1]) {
          const node = end === 1 ? e.b : e.a;
          const control = approachControl(map, e, node);
          if (control === 'none') continue;
          // Travelling towards the node: `dir` along the edge, traffic keeps to its left.
          const dir = end === 1 ? 1 : -1;
          const sLine = end === 1 ? trimB - 0.6 : trimA + 0.6;
          const lineAt = graph.pointAt(e, sLine);
          if (!inChunk(lineAt.x, lineAt.z) || sLine < 3 || sLine > e.length - 3) continue;
          const lo = e.oneway ? -half + 0.3 : dir * 0.14;
          const hi = e.oneway ? half - 0.3 : dir * (half - 0.3);
          const p0 = graph.pointAt(e, sLine - 0.16);
          const p1 = graph.pointAt(e, sLine + 0.16);
          strip(out, [beside(p0, Math.max(lo, hi), 0.07), beside(p1, Math.max(lo, hi), 0.07)], [beside(p0, Math.min(lo, hi), 0.07), beside(p1, Math.min(lo, hi), 0.07)], control === 'stop' ? m.lineYellow : m.line);
          if (control !== 'giveway') continue;
          const laneW = e.oneway ? e.width / e.lanes : e.width / (e.lanes * 2);
          for (let k = 0; k < e.lanes; k++) {
            const centre = e.oneway ? -half + (k + 0.5) * laneW : dir * (k + 0.5) * laneW;
            // Hollow triangle, base towards the line, 1.1 m wide and 3 m long.
            const base = sLine - dir * 1.3;
            const tip = base - dir * 3;
            const outer: [number, number][] = [[base, centre - 0.55], [base, centre + 0.55], [tip, centre]];
            const cs = (outer[0][0] + outer[1][0] + outer[2][0]) / 3;
            const inside = outer.map(([s, off]): [number, number] => [cs + (s - cs) * 0.62, centre + (off - centre) * 0.62]);
            const pt = ([s, off]: [number, number]): P3 => beside(graph.pointAt(e, s), off, 0.07);
            for (let q = 0; q < 3; q++) {
              const r = (q + 1) % 3;
              const a: P3[] = [pt(outer[q]), pt(outer[r])];
              const b: P3[] = [pt(inside[q]), pt(inside[r])];
              // Whichever way round faces up.
              const up = (b[0][2] - a[0][2]) * (a[1][0] - a[0][0]) - (b[0][0] - a[0][0]) * (a[1][2] - a[0][2]);
              strip(out, up > 0 ? a : b, up > 0 ? b : a, m.line);
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

    // Broken yellow no-stopping lines along the kerb for the last 12 m into each corner in town.
    if (e.footpaths && !e.bridge && sealed && !suburban && e.length > 60) {
      for (const side of [1, -1]) {
        for (const end of [0, 1]) {
          const trim = sideTrim(map, end === 0 ? e.a : e.b, e, side, 0.4);
          if (trim <= 0) continue;
          const hi = side * (half - 0.46);
          const lo = side * (half - 0.56);
          for (let k = 0; k < 6; k++) {
            const s0 = end === 0 ? trim + 0.8 + k * 2 : e.length - trim - 1.8 - k * 2;
            const p0 = graph.pointAt(e, s0);
            if (!inChunk(p0.x, p0.z)) continue;
            const p1 = graph.pointAt(e, s0 + 1);
            strip(out, [beside(p0, Math.max(lo, hi), 0.07), beside(p1, Math.max(lo, hi), 0.07)], [beside(p0, Math.min(lo, hi), 0.07), beside(p1, Math.min(lo, hi), 0.07)], m.lineYellow);
          }
        }
      }
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
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, pos.getX(i), pos.getZ(i));
        if (paved) continue;
        // Across-the-road position for the road shader (see ROAD_FRAG_MAIN); plain where roads cross.
        if (through) nor.setXYZ(i, (pos.getX(i) - node.x) * dir[1] - (pos.getZ(i) - node.z) * dir[0], 1, surfaceCode(best));
        else nor.setXYZ(i, 0, 0, PLAIN_CODE);
      }
      out.addGeometry(geo, surfaceOf(best, m));
      geo.dispose();
    }
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
