import * as THREE from 'three';
import { SETTINGS_KEY } from '../../core/storage';
import type { MaterialLibrary, SurfaceKind } from '../../core/types';
import { batchHint, setBatchHint } from '../../render/materials';
import { dataTexture } from '../../render/textures';

/**
 * Weathering for everything the building kit makes.
 *
 * The shared library's surfaces are clean: one texture from kerb to parapet. Buildings instead draw with
 * a patched copy of each surface (one per surface, so a chunk's walls are still one draw call each) whose
 * fragment shader ages it from what it knows about the fragment:
 *
 *  - where it is above the ground the building stands on: splash-back and grime at the foot of the wall;
 *  - how far it is below the top of its wall: dirt washed off a parapet runs down in streaks;
 *  - which way it faces: lichen and damp on the south side (+z), chalked and bleached paint on the north;
 *  - what it is made of: rust runs from the laps of corrugated iron, lichen on tiles, soot on stone,
 *    flaking paint on weatherboards;
 *  - which building it belongs to: each has its own shade, its own share of dirt, its own noise offset.
 *
 * All of that rides in the vertex colour (three floats, exact to 24 bits each), written by the chunk builder
 * from the batch hint of a bare material handle, exactly as the facade-detail panes do. No extra geometry,
 * no extra draw calls beyond one per surface, two fetches of a small noise texture per fragment.
 *
 * Painted signs get the same treatment over the sign atlas: chalky, streaked, flaking.
 */

export interface Wear {
  /** World height of the ground the building stands on. */
  ground: number;
  /** 0..63, the same for every part of one building. */
  seed: number;
  /** 0 (kept up) … 7 (derelict). */
  age: number;
  /** Height of the top of this wall above `ground`, when rain runs down it from there (a parapet wall). */
  top?: number;
  /** A newer piece: a replaced sheet, a patch of fresh render. Weathers a third as much. */
  fresh?: boolean;
}

type WearClass = 'brick' | 'bluestone' | 'limestone' | 'paint' | 'boards' | 'iron' | 'tile' | 'timber' | 'concrete' | 'trim';

/** Which surfaces weather, and how. Anything not listed is handed out as the library makes it. */
const CLASS: Partial<Record<SurfaceKind, WearClass>> = {
  brick: 'brick',
  bluestone: 'bluestone',
  limestone: 'limestone',
  plaster: 'paint',
  weatherboard: 'boards',
  corrugated: 'iron',
  rooftile: 'tile',
  slate: 'tile',
  timber: 'timber',
  concrete: 'concrete',
  plain: 'trim',
};

type Patchable = MaterialLibrary & { registerPatched: NonNullable<MaterialLibrary['registerPatched']> };
/** `?wx=0` on the address turns weathering off, for before-and-after comparisons of look and cost. */
const OFF = typeof location !== 'undefined' && /[?&]wx=0\b/.test(location.search);
const patchable = (lib: MaterialLibrary): lib is Patchable => !OFF && typeof lib.registerPatched === 'function';

// ───────────────────────────── Noise ─────────────────────────────

let noise: THREE.DataTexture | null = null;

/**
 * A small tiling noise texture: R and A are two unrelated sets of broad blotches, G is finer (stretched into
 * streaks by how it is sampled), B is speckle.
 */
function noiseTexture(): THREE.DataTexture {
  if (noise) return noise;
  const N = 256;
  const hash = (x: number, y: number, s: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  /** Value noise that repeats every `period` cells across the texture. */
  const layer = (x: number, y: number, period: number, seed: number) => {
    const fx = (x / N) * period;
    const fy = (y / N) * period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const a = hash(ix % period, iy % period, seed);
    const b = hash((ix + 1) % period, iy % period, seed);
    const c = hash(ix % period, (iy + 1) % period, seed);
    const d = hash((ix + 1) % period, (iy + 1) % period, seed);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const fbm = (x: number, y: number, periods: readonly number[], seed: number) => {
    let sum = 0;
    let weight = 0;
    let amp = 1;
    for (let i = 0; i < periods.length; i++) {
      sum += layer(x, y, periods[i], seed + i * 17) * amp;
      weight += amp;
      amp *= 0.55;
    }
    // Value noise bunches round the middle: stretch it out to use the whole range.
    return Math.max(0, Math.min(1, (sum / weight - 0.5) * 2.1 + 0.5));
  };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = fbm(x, y, [4, 8, 16, 32], 1) * 255;
      data[i + 1] = fbm(x, y, [24, 48, 96], 2) * 255;
      data[i + 2] = fbm(x, y, [32, 64, 128], 3) * 255;
      data[i + 3] = fbm(x, y, [3, 6, 12, 24], 4) * 255;
    }
  }
  noise = dataTexture(data, N);
  return noise;
}

/** Low quality fetches the noise once instead of three times. */
function cheap(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as { quality?: string }).quality === 'low';
  } catch {
    return false;
  }
}

// ───────────────────────────── Shader ─────────────────────────────

const VERTEX_PARS = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxNrm;
varying vec2 vWxUv;
flat varying vec3 vWxData;
`;

const VERTEX_MAIN = /* glsl */ `
vWxUv = uv;
#ifdef USE_COLOR
  vWxData = color;
#else
  vWxData = vec3(255.0);
#endif
vWxPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWxNrm = mat3(modelMatrix) * objectNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vWxPos;
varying vec3 vWxNrm;
varying vec2 vWxUv;
flat varying vec3 vWxData;
uniform sampler2D uWxNoise;
`;

/** Unpacks the vertex colour and samples the noise: shared by walls and signs. */
const DECODE = /* glsl */ `
float wxD0 = floor(vWxData.x + 0.5);
float wxD1 = floor(vWxData.y + 0.5);
float wxD2 = floor(vWxData.z + 0.5);
float wxGround = floor(wxD0 / 256.0) * 0.125 - 32.0;
float wxSeed = mod(floor(wxD1 / 256.0), 64.0);
float wxAge = mod(floor(wxD1 / 16384.0), 8.0) / 7.0;
float wxFlags = floor(wxD1 / 131072.0);
float wxTop = mod(floor(wxD2 / 256.0), 256.0) * 0.25;
if (mod(wxFlags, 2.0) > 0.5) wxAge *= 0.3;
vec3 wxN = normalize(vWxNrm);
float wxWall = 1.0 - smoothstep(0.35, 0.6, abs(wxN.y));
float wxRoof = smoothstep(0.3, 0.55, wxN.y);
// Along the wall and up it for anything upright; the mesh's own metre UVs (v runs up the slope) for a roof.
vec2 wxQ = mix(vWxUv, vec2(vWxPos.x * wxN.z - vWxPos.z * wxN.x, vWxPos.y), step(0.5, wxWall));
float wxH = vWxPos.y - wxGround;
vec2 wxOff = vec2(wxSeed * 0.173, wxSeed * 0.311);
vec4 wxA = texture2D(uWxNoise, wxQ * 0.043 + wxOff);
#ifdef WX_CHEAP
  vec4 wxB = wxA.gbar;
  vec4 wxC = wxA.barg;
#else
  vec4 wxB = texture2D(uWxNoise, vec2(wxQ.x * 0.31, wxQ.y * 0.021) + wxOff.yx);
  vec4 wxC = texture2D(uWxNoise, wxQ * 0.41 + wxOff.yx);
#endif
float wxSouth = clamp(wxN.z, 0.0, 1.0);
float wxNorth = clamp(-wxN.z, 0.0, 1.0);
float wxJ = fract(wxSeed * 0.618034);
float wxJ2 = fract(wxSeed * 0.381966 + 0.37);
`;

interface Recipe {
  /** Fix-ups to the photograph itself, before any tint. */
  pre?: string;
  /** Patchy fading over the whole face. */
  mottle: number;
  /** Grime at the foot of the wall. */
  foot: number;
  /** Streaks of dirt, from the top and at random. */
  run: number;
  /** Sun-bleaching of north faces and of roofs. */
  bleach: number;
  /** Green damp and lichen on south faces. */
  damp: number;
  /** How much each building's shade may differ from the next. */
  vary: number;
  /** Saturation and brightness of the tinted surface (default 1, 1): photographs and palettes that come up too fresh. */
  sat?: number;
  gain?: number;
  /** Extra weathering particular to the material. */
  extra?: string;
  /** Scale applied to the texture coordinates (block size). */
  uvScale?: number;
}

const RECIPES: Record<WearClass, Recipe> = {
  brick: {
    // The photograph is a bright new orange-red; Canterbury's common brick is duller and browner, and dirtier.
    pre: /* glsl */ `
      float wxL = dot(wxCol, vec3(0.3, 0.55, 0.15));
      wxCol = mix(wxCol, vec3(wxL) * vec3(1.2, 0.98, 0.78), 0.56) * 0.85;
    `,
    mottle: 0.24,
    foot: 0.75,
    run: 0.6,
    bleach: 0.1,
    damp: 0.55,
    vary: 0.16,
    // Salts brought out by damp bloom white a metre or so up, and soot settles in the upper courses.
    extra: /* glsl */ `
      float wxSalt = wxWall * smoothstep(0.55, 0.8, wxA.a) * smoothstep(0.1, 0.5, wxH) * (1.0 - smoothstep(0.9, 2.2, wxH)) * wxC.b;
      wxCol = mix(wxCol, vec3(0.5, 0.48, 0.44), wxSalt * 0.38 * (0.4 + wxAge));
      wxCol *= 1.0 - 0.22 * wxAge * smoothstep(0.45, 0.8, wxA.r) * wxWall;
    `,
  },
  bluestone: {
    // Smaller blocks, and the pale mortar pulled down towards the stone so the wall reads as stone, not as a net.
    pre: /* glsl */ `
      float wxL = dot(wxCol, vec3(0.3333));
      float wxMortar = smoothstep(0.075, 0.17, wxL);
      wxCol = mix(wxCol * vec3(1.42, 1.5, 1.66), wxCol * vec3(0.5, 0.5, 0.49), wxMortar);
    `,
    mottle: 0.16,
    foot: 0.35,
    run: 0.3,
    bleach: 0.1,
    damp: 0.5,
    vary: 0.12,
    uvScale: 1.42,
  },
  limestone: {
    mottle: 0.14,
    foot: 0.5,
    run: 0.75,
    bleach: 0.0,
    damp: 0.45,
    vary: 0.1,
    // Oamaru stone goes grey and then black where it stays wet: under ledges and down the weather side.
    extra: /* glsl */ `
      float wxCrust = smoothstep(0.5, 0.85, wxA.a * 0.6 + wxC.b * 0.4 + 0.25 * wxSouth) * (0.3 + 0.7 * wxAge);
      wxCol = mix(wxCol, wxCol * vec3(0.5, 0.5, 0.48), wxCrust * 0.6);
    `,
  },
  paint: {
    mottle: 0.1,
    foot: 0.8,
    run: 0.6,
    bleach: 0.3,
    damp: 0.4,
    vary: 0.12,
    // Hairline cracks filled with dirt, and patches where the render has been made good in a different white.
    extra: /* glsl */ `
      float wxPatch = wxWall * smoothstep(0.7, 0.74, wxA.r) * step(0.55, wxJ);
      wxCol = mix(wxCol, wxCol * vec3(1.07, 1.06, 1.02) + 0.02, wxPatch * 0.6);
    `,
  },
  boards: {
    mottle: 0.14,
    foot: 0.75,
    run: 0.55,
    bleach: 0.34,
    damp: 0.5,
    vary: 0.1,
    // Paint lets go first low down and on the sunny side: grey timber shows through in flakes.
    extra: /* glsl */ `
      float wxLow = 1.0 - smoothstep(0.3, 2.4, wxH);
      float wxFlake = wxWall * smoothstep(0.74 - 0.2 * wxAge * (0.4 + 0.6 * wxLow + 0.5 * wxNorth), 0.8, wxC.b * 0.6 + wxA.a * 0.4);
      wxCol = mix(wxCol, vec3(0.23, 0.2, 0.17) * (0.7 + 0.6 * wxC.r), wxFlake * 0.7 * wxAge);
    `,
  },
  iron: {
    mottle: 0.2,
    foot: 0.35,
    run: 0.4,
    bleach: 0.42,
    damp: 0.15,
    vary: 0.1,
    // Rust starts at the cut ends of the sheets, where they lap, and runs down from there; then blooms in patches.
    extra: /* glsl */ `
      float wxSheet = fract((wxWall > 0.5 ? wxH + 0.15 : vWxUv.y + 0.1) / 2.44);
      float wxBelow = wxSheet * wxSheet * wxSheet;
      float wxRun2 = smoothstep(0.45, 0.8, wxB.g) * wxBelow;
      float wxEdge = wxWall * (1.0 - smoothstep(0.0, 0.3 + 0.5 * wxB.g, wxH));
      float wxBloom = smoothstep(0.74 - 0.16 * wxAge, 0.95, wxA.r * 0.6 + wxC.b * 0.4);
      wxRust = clamp((wxRun2 * 0.7 + wxEdge * 0.7 + wxBloom * 0.9) * (0.15 + 0.85 * wxAge), 0.0, 1.0);
      vec3 wxRustC = mix(vec3(0.24, 0.085, 0.03), vec3(0.09, 0.035, 0.018), wxC.r);
      wxCol = mix(wxCol, wxRustC, wxRust * 0.78);
    `,
  },
  tile: {
    mottle: 0.26,
    foot: 0.2,
    run: 0.55,
    bleach: 0.2,
    damp: 0.4,
    vary: 0.14,
    sat: 0.66,
    gain: 0.8,
    // Lichen: pale grey-green rosettes, some of them the orange kind, thickest on the cold side of the roof.
    extra: /* glsl */ `
      float wxSpots = smoothstep(0.6 - 0.14 * wxAge - 0.12 * wxSouth, 0.78, wxC.b) * smoothstep(0.3, 0.65, wxA.a);
      vec3 wxLichen = mix(vec3(0.3, 0.32, 0.25), vec3(0.36, 0.25, 0.09), step(0.66, wxC.r));
      wxCol = mix(wxCol, wxLichen, wxSpots * 0.5 * wxRoof);
    `,
  },
  timber: {
    mottle: 0.16,
    foot: 0.5,
    run: 0.3,
    bleach: 0.0,
    damp: 0.5,
    vary: 0.14,
    // Bare timber silvers in the weather.
    extra: /* glsl */ `
      float wxGrey = (0.25 + 0.45 * wxAge) * (0.5 + wxA.a);
      wxCol = mix(wxCol, vec3(dot(wxCol, vec3(0.3, 0.55, 0.15))) * vec3(1.02, 1.0, 0.96) * 1.15, clamp(wxGrey, 0.0, 0.8));
    `,
  },
  concrete: {
    mottle: 0.16,
    foot: 0.5,
    run: 0.7,
    bleach: 0.0,
    damp: 0.5,
    vary: 0.08,
  },
  trim: {
    mottle: 0.06,
    foot: 0.5,
    run: 0.25,
    bleach: 0.22,
    damp: 0.2,
    vary: 0.0,
  },
};

const f = (v: number) => v.toFixed(3);

function wallFragment(r: Recipe): string {
  return /* glsl */ `
${DECODE}
vec3 wxTint = vec3(mod(wxD0, 256.0), mod(wxD1, 256.0), mod(wxD2, 256.0)) / 255.0;
wxTint = wxTint * wxTint * 2.0;
vec3 wxCol = diffuseColor.rgb;
float wxRust = 0.0;
${r.pre ?? ''}
// Each building its own shade, a touch warmer or cooler than the next.
wxCol *= wxTint * (1.0 + ${f(r.vary)} * (wxJ * 2.0 - 1.0));
wxCol *= mix(vec3(1.0), mix(vec3(1.035, 1.0, 0.955), vec3(0.965, 1.0, 1.04), wxJ2), ${f(r.vary > 0 ? 1 : 0)});
wxCol = mix(vec3(dot(wxCol, vec3(0.3, 0.55, 0.15))), wxCol, ${f(r.sat ?? 1)}) * ${f(r.gain ?? 1)};
// Patchy fading over the whole face.
wxCol *= 1.0 + (wxA.r - 0.5) * ${f(r.mottle)} * (1.0 + wxAge) * (1.0 + 0.6 * wxRoof);
// The sun takes the colour out of paint on the north side and on any roof.
float wxSun = max(wxNorth * wxWall, wxRoof * 0.8) * ${f(r.bleach)} * (0.45 + 0.75 * wxAge) * (0.6 + 0.8 * wxA.a);
wxCol = mix(wxCol, vec3(dot(wxCol, vec3(0.3, 0.55, 0.15))) * 1.12 + 0.025, clamp(wxSun, 0.0, 0.7));
// Splash-back and grime where the wall meets the ground.
float wxFoot = wxWall * (1.0 - smoothstep(0.02, 0.45 + 1.7 * wxA.a * wxA.a, wxH)) * (0.55 + 0.45 * wxB.g);
wxFoot = max(wxFoot, wxWall * (1.0 - smoothstep(0.0, 0.16, wxH)));
// Dirt washed down from the top of a parapet wall, and the odd streak anywhere.
float wxDrop = wxGround + wxTop - vWxPos.y;
float wxUnder = step(0.1, wxTop) * step(-0.02, wxDrop);
float wxRun = wxUnder * smoothstep(0.42, 0.78, wxB.g) * (1.0 - smoothstep(0.15, 0.7 + 3.2 * wxA.r, wxDrop));
wxRun = max(wxRun, wxUnder * 0.55 * (1.0 - smoothstep(0.0, 0.22, wxDrop)));
wxRun = max(wxRun, 0.55 * smoothstep(0.6, 0.86, wxB.g) * smoothstep(0.5, 0.75, wxA.a));
float wxDirt = clamp(wxFoot * ${f(r.foot)} + (wxRun * wxWall + 0.7 * wxRoof * smoothstep(0.4, 0.85, wxB.g)) * ${f(r.run)}, 0.0, 1.0) * (0.5 + 0.75 * wxAge);
wxCol = mix(wxCol, wxCol * 0.3 + vec3(0.035, 0.03, 0.024), clamp(wxDirt, 0.0, 0.85));
// The south side never dries out: green at the foot, grey-green blotches higher up.
float wxDamp = wxSouth * max(wxWall * (1.0 - smoothstep(0.1, 0.9 + 2.2 * wxA.r, wxH)), smoothstep(0.52, 0.8, wxA.r) * (0.35 + 0.65 * wxC.b)) * ${f(r.damp)} * (0.4 + 0.8 * wxAge);
wxCol = mix(wxCol, mix(wxCol * 0.55, vec3(0.085, 0.105, 0.06), 0.55), clamp(wxDamp, 0.0, 0.8));
${r.extra ?? ''}
diffuseColor.rgb = wxCol;
`;
}

function patchWall(kind: WearClass, low: boolean) {
  const r = RECIPES[kind];
  const scale = r.uvScale ?? 1;
  const uv =
    scale === 1
      ? ''
      : /* glsl */ `
#ifdef USE_MAP
  vMapUv *= ${f(scale)};
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv *= ${f(scale)};
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv *= ${f(scale)};
#endif
`;
  const body = wallFragment(r);
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uWxNoise = { value: noiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${uv}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${low ? '#define WX_CHEAP\n' : ''}${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', body)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.96, clamp(wxDirt + wxRust, 0.0, 1.0) * 0.7);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - clamp(wxRust * 1.5 + wxDirt, 0.0, 1.0);');
  };
}

// ───────────────────────────── Weathered surfaces ─────────────────────────────

const bases = new WeakMap<MaterialLibrary, Map<SurfaceKind, THREE.Material | null>>();

/** The patched, vertex-coloured copy of a surface that every weathered piece of it merges into. */
function baseFor(lib: Patchable, surface: SurfaceKind): THREE.Material | null {
  let made = bases.get(lib);
  if (!made) bases.set(lib, (made = new Map()));
  let base = made.get(surface);
  if (base !== undefined) return base;
  const kind = CLASS[surface];
  if (!kind) {
    made.set(surface, null);
    return null;
  }
  const source = lib.get(surface);
  const copy = source.clone();
  copy.color.set(0xffffff);
  copy.vertexColors = true;
  copy.name = `weathered-${surface}`;
  const low = cheap();
  base = lib.registerPatched(copy, `bld-wx-${kind}${low ? '-low' : ''}`, patchWall(kind, low));
  made.set(surface, base);
  return base;
}

const q = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
const handles = new Map<string, THREE.Material>();

function handle(base: THREE.Material, r: number, g: number, b: number, uv?: readonly [number, number, number, number]): THREE.Material {
  const key = `${base.id}|${r}|${g}|${b}|${uv ? uv.join(',') : ''}`;
  let m = handles.get(key);
  if (m) return m;
  // Handles are only keys for merging; the hints (held weakly) go when the handle does.
  if (handles.size > 8000) handles.clear();
  m = { isMaterial: true, type: 'WeatheredSurface' } as unknown as THREE.Material;
  const data = new THREE.Color();
  data.r = r;
  data.g = g;
  data.b = b;
  setBatchHint(m, { base, color: data, uv });
  handles.set(key, m);
  return m;
}

const _tint = new THREE.Color();

/**
 * A weathered piece of `surface` in `color` (a handle for the chunk builder, not a material to put on a
 * mesh). Null when the surface does not weather or the library cannot patch shaders (test doubles): use
 * the library's own material then.
 */
export function weathered(lib: MaterialLibrary, surface: SurfaceKind, color: number | undefined, wear: Wear): THREE.Material | null {
  if (!patchable(lib)) return null;
  const base = baseFor(lib, surface);
  if (!base) return null;
  // The library's variant carries the tint as the base surface wants it (relative to a photograph's own colour).
  _tint.copy((color === undefined ? lib.get(surface) : lib.get(surface, { color })).color);
  const c = (v: number) => q(Math.sqrt(Math.max(0, v) / 2) * 255, 255);
  const r = c(_tint.r) + 256 * q((wear.ground + 32) * 8, 8191);
  const g = c(_tint.g) + 256 * q(wear.seed, 63) + 16384 * q(wear.age, 7) + 131072 * (wear.fresh ? 1 : 0);
  const b = c(_tint.b) + 256 * q((wear.top ?? 0) * 4, 255);
  return handle(base, r, g, b);
}

// ───────────────────────────── Painted signs ─────────────────────────────

const SIGN_FRAGMENT = /* glsl */ `
${DECODE}
vec3 wxCol = diffuseColor.rgb;
float wxL = dot(wxCol, vec3(0.3, 0.55, 0.15));
float wxGhost = step(1.5, mod(wxFlags, 4.0));
// Chalking: the binder goes, the pigment turns to powder, and the lettering sinks back into its ground.
float wxFade = (0.16 + 0.5 * wxAge + 0.3 * wxGhost) * (0.75 + 0.5 * wxNorth) * (0.55 + 0.9 * wxA.r);
wxCol = mix(wxCol, mix(vec3(wxL), vec3(0.56, 0.54, 0.49), 0.6), clamp(wxFade, 0.0, 0.88));
// Rain streaks down from the top edge, and the whole board is grubby.
wxCol *= 1.0 - (0.14 + 0.3 * wxAge) * smoothstep(0.45, 0.85, wxB.g) * (0.5 + 0.5 * wxA.a);
wxCol *= 0.9 + 0.14 * wxC.r;
// Flakes gone: on a board, down to the primer or the tin; lettering painted straight on a wall simply
// loses its paint there, and the brick behind the sign shows through the hole.
float wxFlake = smoothstep(0.7 - 0.16 * wxAge - 0.14 * wxGhost, 0.78, wxC.b * 0.65 + wxA.a * 0.35) * (0.25 + 0.75 * wxAge + 0.5 * wxGhost);
if (wxGhost > 0.5 && wxFlake > 0.42) discard;
wxCol = mix(wxCol, mix(vec3(0.3, 0.27, 0.23), vec3(0.19, 0.09, 0.04), step(0.72, wxC.r)) * (0.7 + 0.5 * wxA.r), clamp(wxFlake, 0.0, 0.9) * (1.0 - wxGhost));
diffuseColor.rgb = wxCol;
`;

function patchSign(low: boolean) {
  return (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uWxNoise = { value: noiseTexture() };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${low ? '#define WX_CHEAP\n' : ''}${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', SIGN_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, 0.5 + 0.5 * wxAge);');
  };
}

const signBases = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The same sign gone chalky: a handle onto a weathering copy of the sign's atlas page. `ghost` is lettering
 * painted straight on a wall decades ago, most of it gone. Anything that is not an atlas sign (a neon tube,
 * a test double) comes back as it is.
 */
export function agedSign(lib: MaterialLibrary, sign: THREE.Material, wear: Wear, ghost = false): THREE.Material {
  if (!patchable(lib)) return sign;
  const hint = batchHint(sign);
  const page = hint?.base as THREE.MeshStandardMaterial | undefined;
  if (!hint || !page || !hint.uv || page.emissiveMap) return sign;
  let base = signBases.get(page);
  if (!base) {
    const copy = page.clone();
    copy.vertexColors = true;
    copy.name = 'weathered-sign';
    const low = cheap();
    base = lib.registerPatched(copy, `bld-wx-sign-2${low ? '-low' : ''}`, patchSign(low));
    signBases.set(page, base);
  }
  return handle(base, 255, 255 + 256 * q(wear.seed, 63) + 16384 * q(wear.age, 7) + 131072 * (ghost ? 2 : 0), 255, hint.uv);
}
