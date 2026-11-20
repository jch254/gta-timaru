import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import { decodeTexture } from '../../render/textureAssets';
import { onPhone } from '../../render/quality';
import { hash2 } from '../../core/rng';
import type { Materials } from '../../render/materials';

/**
 * How plants are drawn. Three things live here:
 *
 *  1. The foliage atlas: one RGBA texture of photographic boughs, fronds, fans and flowers (CC0 sources, see
 *     ASSETS.md "Vegetation"). Every plant's leaf cards map onto one of its cells, so all foliage in the
 *     game shares a single alpha-tested picture. It ships with pre-baked mips; phones start one level down.
 *  2. The leaf materials: one for plants near the camera (cards turn to face the viewer rather than show
 *     edge on, sway in the wind and let the sun through), one for their cheap stand-ins further away.
 *  3. The plant field, which decides what is drawn for every plant in the loaded world: which of its
 *     kind's shapes a plant is, and whether it shows in full or as its stand-in. See `PlantModel`.
 */

// ───────────────────────────── The atlas ─────────────────────────────

/** Where a cell's picture attaches to its branch: the bottom middle, top middle, left middle or centre. */
export type CellAnchor = 'bottom' | 'top' | 'left' | 'centre';

export interface FoliageCell {
  /** UV rectangle. v0 is the TOP of the picture (the texture is not flipped). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Width / height of the picture. */
  aspect: number;
  anchor: CellAnchor;
  /** Mean colour of the picture's leaves, linear RGB. */
  mean: [number, number, number];
}

interface CellInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: CellAnchor;
  mean?: [number, number, number];
}

interface AtlasInfo {
  size: number;
  file: string;
  cells: Record<string, CellInfo>;
}

/** The strip of extra cells: `height` rows that go under the main sheet. Cell positions are within the strip. */
interface ExtraInfo {
  file: string;
  height: number;
  cells: Record<string, CellInfo>;
}

const infos = import.meta.glob('../../assets/foliage/atlas.json', { eager: true, import: 'default' }) as Record<string, AtlasInfo>;
const extras = import.meta.glob('../../assets/foliage/extra.json', { eager: true, import: 'default' }) as Record<string, ExtraInfo>;
const urls = import.meta.glob('../../assets/foliage/mips/*.webp', { eager: true, query: '?url&no-inline', import: 'default' }) as Record<string, string>;
const info: AtlasInfo | undefined = Object.values(infos)[0];
const extra: ExtraInfo | undefined = info ? Object.values(extras)[0] : undefined;

const WIDTH = info?.size ?? 1;
const HEIGHT = (info?.size ?? 1) + (extra?.height ?? 0);
/** Every cell, in pixels of the joined texture. */
const CELLS: Record<string, CellInfo> = { ...(info?.cells ?? {}) };
if (info && extra) for (const [name, c] of Object.entries(extra.cells)) CELLS[name] = { ...c, y: c.y + info.size };

/** The alpha threshold foliage materials test against; mip levels are built to keep their coverage at it. */
export const FOLIAGE_ALPHA_TEST = 0.5;

export const foliageTexture = new THREE.Texture();
foliageTexture.colorSpace = THREE.SRGBColorSpace;
foliageTexture.magFilter = THREE.LinearFilter;
foliageTexture.minFilter = THREE.LinearMipmapLinearFilter;
foliageTexture.generateMipmaps = false;
foliageTexture.flipY = false;

const fallback: FoliageCell = { u0: 0, v0: 0, u1: 1, v1: 1, aspect: 1, anchor: 'bottom', mean: [0.1, 0.16, 0.04] };
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Whether the atlas has a cell of this name. */
export const hasFoliageCell = (name: string) => CELLS[name] !== undefined;

/**
 * UV rectangle of a named cell. A missing cell falls back to the first of `instead` that exists, and
 * failing those to the whole texture (so a plant built before its pictures exist still has leaves).
 */
export function foliageCell(name: string, ...instead: string[]): FoliageCell {
  const c = CELLS[name] ?? instead.map((n) => CELLS[n]).find((cell) => cell !== undefined);
  if (!c) return fallback;
  const mean = c.mean ? (c.mean.map(toLinear) as [number, number, number]) : fallback.mean;
  return { u0: c.x / WIDTH, v0: c.y / HEIGHT, u1: (c.x + c.w) / WIDTH, v1: (c.y + c.h) / HEIGHT, aspect: c.w / c.h, anchor: c.anchor, mean };
}

let loading: Promise<void> | null = null;

/** Loads the atlas into `foliageTexture` (once). Resolves when it is ready to draw; never rejects. */
export function loadFoliage(anisotropy = 8): Promise<void> {
  if (loading) return loading;
  if (!info || typeof createImageBitmap === 'undefined') return (loading = Promise.resolve());
  loading = (async () => {
    const mips: ImageBitmap[] = [];
    try {
      // The phone base is already coverage-corrected against the full-resolution cells.
      const last = Math.floor(Math.log2(Math.max(WIDTH, HEIGHT)));
      for (let i = onPhone() ? 1 : 0; i <= last; i++) {
        const url = urls[`../../assets/foliage/mips/leaf-${i}.webp`];
        mips.push(await decodeTexture(async () => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Foliage mip ${i}: HTTP ${response.status}`);
          return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        }));
      }
      foliageTexture.image = mips[0];
      // WebGLTextures accepts TexImageSource levels; @types/three only lists canvas images.
      foliageTexture.mipmaps = mips as unknown as typeof foliageTexture.mipmaps;
      foliageTexture.anisotropy = anisotropy;
      foliageTexture.needsUpdate = true;
    } catch (err) {
      for (const bitmap of mips) bitmap.close();
      console.warn('The foliage atlas failed to load; plants will show bare branches.', err);
    }
  })();
  return loading;
}

// ───────────────────────────── Leaf materials ─────────────────────────────

/**
 * Wind on the leaf cards. `strength` is how far (metres) the free edge of a bough is pushed at the height of
 * a gust; `direction` is where the wind blows to (world x, z). The game sets both from the weather; by
 * default it is a light nor'wester. Wood does not move, and neither do shadows (the sway is small).
 */
export const foliageWind = { strength: 0.09, direction: new THREE.Vector2(0.8, 0.6) };

const windUniforms = { uWindTime: { value: 0 }, uWind: { value: new THREE.Vector3() } };

/** Share of full sunlight every leaf gets regardless of facing and shadow (see `lightPatch`). */
const LEAF_THROUGH = 0.14;
/** Extra sunlight a leaf on the outside of its crown passes when the sun is behind it, as seen from the camera. */
const LEAF_GLOW = 0.55;
/** How far a card that would be seen edge on turns towards the camera (0 = not at all, 1 = squarely). */
const CARD_TURN = 0.8;

/** Metres the camera travels before the field looks again at what is near and what is far. */
const STEP = 6;

const LEAF_VARYING = 'varying float vLeafRim;';

/**
 * The switch between a plant and its stand-in is a dissolve, not a swap. Over the last `fadeBand` metres
 * before the switch distance both are drawn, each through a screen-door pattern the other fills in, so
 * a tree coming up the road turns into itself over a second of driving instead of changing shape in one
 * frame. `aFade` is the plant's switch distance: one value for a whole geometry (an instanced attribute
 * with a divisor no mesh reaches), and absent (zero) on anything that does not fade. The eye is the
 * game camera's, not `cameraPosition`, which is the light's while shadows are drawn.
 */
const fadeUniforms = { uPlantEye: { value: new THREE.Vector3() }, uPlantRange: { value: 1 } };
/** Metres over which a plant with this switch distance dissolves. */
export const fadeBand = (near: number) => Math.min(18, Math.max(6, near * 0.15));
const FADE_VERTEX_PARS = 'attribute float aFade;\nuniform vec3 uPlantEye;\nuniform float uPlantRange;\nvarying float vPlantFade;';
/** `vPlantFade`: how much of the stand-in is drawn here, 0 (the plant alone) to 1 (the stand-in alone). */
const FADE_VERTEX = /* glsl */ `
  #ifdef USE_INSTANCING
    {
      float fadeNear = aFade * uPlantRange;
      float fadeWide = clamp(fadeNear * 0.15, 6.0, 18.0);
      float fadeAway = distance((modelMatrix * instanceMatrix)[3].xz, uPlantEye.xz);
      vPlantFade = aFade > 0.0 ? clamp((fadeAway - (fadeNear - ${STEP.toFixed(1)} - fadeWide)) / fadeWide, 0.0, 1.0) : -1.0;
    }
  #else
    vPlantFade = -1.0;
  #endif`;
const FADE_FRAGMENT_PARS = 'varying float vPlantFade;\nfloat plantDither() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }';
const withFade = (shader: THREE.WebGLProgramParametersWithUniforms, test: string) => {
  shader.uniforms.uPlantEye = fadeUniforms.uPlantEye;
  shader.uniforms.uPlantRange = fadeUniforms.uPlantRange;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${FADE_VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>${FADE_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FADE_FRAGMENT_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${test}`);
};
/** A one-value attribute every instance of a mesh reads: the switch distance its plants fade at. */
const fadeAttribute = (near: number) => new THREE.InstancedBufferAttribute(new Float32Array([near]), 1, false, 1 << 30);

/**
 * Leaves let light through, and a crown scatters it about. A share of the sun reaches every leaf whichever
 * way it faces and whether or not the shadow map says it is shaded: without this the far side of a tree has
 * only skylight, and goes black under a hard sun. On top of that, leaves on the outside of the crown glow
 * yellow-green when the sun is behind them. (The cascades are one light each, hence the mean.)
 */
function lightPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${LEAF_VARYING}`).replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
      vec3 leafSun = vec3(0.0);
      for (int i = 0; i < NUM_DIR_LIGHTS; i++) leafSun += directionalLights[i].color;
      leafSun /= float(NUM_DIR_LIGHTS);
      float leafBack = clamp(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0, 1.0);
      leafBack *= leafBack;
      vec3 leafLit = material.diffuseColor * ${LEAF_THROUGH.toFixed(3)} + material.diffuseColor * vec3(1.3, 1.22, 0.45) * (leafBack * (0.2 + 0.8 * vLeafRim) * ${LEAF_GLOW.toFixed(3)});
      reflectedLight.directDiffuse += leafSun * RECIPROCAL_PI * leafLit;
    #endif`,
  );
}

/**
 * The near material's patch. Cards carry, per vertex: `aLeaf` (how freely it moves in the wind; how far out
 * in the crown it is), `aCard` (the card's width axis and this vertex's distance along it from the stem) and
 * `aStem` (the stem axis). A card whose plane the camera is nearly in swings round its stem to face the
 * viewer, so no card is ever seen as a streak; then it leans and flutters in the wind.
 */
function nearPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uWindTime = windUniforms.uWindTime;
  shader.uniforms.uWind = windUniforms.uWind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec2 aLeaf;\nattribute vec4 aCard;\nattribute vec3 aStem;\nuniform float uWindTime;\nuniform vec3 uWind;\n${LEAF_VARYING}`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vLeafRim = aLeaf.y;
      #ifdef USE_INSTANCING
        mat4 leafModel = modelMatrix * instanceMatrix;
        vec3 swayAt = instanceMatrix[3].xyz;
        // World wind into the instance's own frame (its matrix is a rotation times a near-uniform scale).
        vec3 swayWind = (vec4(uWind, 0.0) * instanceMatrix).xyz / dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
      #else
        mat4 leafModel = modelMatrix;
        vec3 swayAt = vec3(0.0);
        vec3 swayWind = uWind;
      #endif
      if (aCard.w != 0.0) {
        vec3 leafStem = transformed - aCard.xyz * aCard.w;
        vec3 leafEye = (cameraPosition - (leafModel * vec4(leafStem, 1.0)).xyz) * mat3(leafModel);
        float leafFar = max(length(leafEye), 1e-4);
        vec3 leafTurned = cross(aStem, leafEye);
        float leafSide = length(leafTurned) / leafFar;
        float leafFacing = abs(dot(cross(aCard.xyz, aStem), leafEye)) / leafFar;
        float leafTurn = (1.0 - smoothstep(0.2, 0.7, leafFacing)) * smoothstep(0.12, 0.45, leafSide) * ${CARD_TURN.toFixed(2)};
        transformed = leafStem + normalize(mix(aCard.xyz, leafTurned / max(leafSide * leafFar, 1e-5), leafTurn)) * aCard.w;
      }
      float swayPhase = dot(swayAt.xz, vec2(0.37, 0.23)) + dot(position, vec3(0.9, 0.7, 1.1));
      // Gusts roll across the country; each bough answers in its own time.
      float swayGust = 0.5 + 0.5 * sin(uWindTime * 0.7 - dot(swayAt.xz, vec2(0.045, 0.03)));
      float swayFlutter = sin(uWindTime * 2.3 + swayPhase) + 0.5 * sin(uWindTime * 5.3 + swayPhase * 1.7);
      transformed += aLeaf.x * (swayWind * (0.3 + 0.7 * swayGust) * (0.65 + 0.35 * swayFlutter) + vec3(0.0, 0.3 * swayFlutter * length(swayWind), 0.0));`,
    );
  lightPatch(shader);
  // The plant is drawn where the stand-in is not.
  withFade(shader, 'if (vPlantFade > 0.0 && plantDither() < vPlantFade) discard;');
}

/** The stand-in material's patch: still, never turned, lit the same way. */
function farPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec2 aLeaf;\n${LEAF_VARYING}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafRim = aLeaf.y;');
  lightPatch(shader);
  withFade(shader, 'if (vPlantFade >= 0.0 && vPlantFade < 1.0 && plantDither() >= vPlantFade) discard;');
}

type Patchable = MaterialLibrary & { registerPatched?: Materials['registerPatched'] };

const nearMaterials = new WeakMap<MaterialLibrary, THREE.MeshStandardMaterial>();
const farMaterials = new WeakMap<MaterialLibrary, THREE.MeshStandardMaterial>();

function makeLeafMaterial(): THREE.MeshPhysicalMaterial {
  // Normally already loaded by the texture preload; this covers anyone building props without it.
  void loadFoliage();
  // Physical only for `specularIntensity`: with normals bent round the crown, a standard material's grazing
  // highlight washes whole cards out to white on the side towards the sun.
  return new THREE.MeshPhysicalMaterial({ map: foliageTexture, alphaTest: FOLIAGE_ALPHA_TEST, vertexColors: true, roughness: 0.85, metalness: 0, specularIntensity: 0.22 });
}

/** The one material every leaf card near the camera uses. */
export function leafMaterial(m: MaterialLibrary): THREE.MeshStandardMaterial {
  let material = nearMaterials.get(m);
  if (!material) {
    material = makeLeafMaterial();
    // The renderer's material library can chain a shader patch after the shadow system's own; where it can,
    // leaves turn, glow and move in the wind. Anywhere else (tests, tools) they are simply still.
    const library = m as Patchable;
    if (typeof library.registerPatched === 'function') {
      library.registerPatched(material, 'foliage-2', nearPatch);
      material.onBeforeRender = (_renderer, _scene, camera, _geometry, object) => {
        windUniforms.uWindTime.value = performance.now() / 1000;
        windUniforms.uWind.value.set(foliageWind.direction.x, 0, foliageWind.direction.y).multiplyScalar(foliageWind.strength / (foliageWind.direction.length() || 1));
        plantField.seen(object, camera);
      };
    } else {
      m.register(material);
    }
    nearMaterials.set(m, material);
  }
  return material;
}

/** The material of the cheap stand-ins: the same pictures and light, nothing that moves. */
export function farLeafMaterial(m: MaterialLibrary): THREE.MeshStandardMaterial {
  let material = farMaterials.get(m);
  if (!material) {
    material = makeLeafMaterial();
    const library = m as Patchable;
    if (typeof library.registerPatched === 'function') library.registerPatched(material, 'foliage-far-2', farPatch);
    else m.register(material);
    farMaterials.set(m, material);
  }
  return material;
}

const woodMaterials = new WeakMap<MaterialLibrary, Map<string, THREE.MeshStandardMaterial>>();

/**
 * Plant wood: the library's bark surface with the same dissolve as the leaves, so a trunk fades out with
 * its crown when the plant switches to its stand-in. Its own instance per colour, so the bark other props
 * use (logs, posts) stays unpatched.
 */
export function woodMaterial(m: MaterialLibrary, color?: number): THREE.MeshStandardMaterial {
  let cache = woodMaterials.get(m);
  if (!cache) woodMaterials.set(m, (cache = new Map()));
  const key = color === undefined ? 'bark' : `bark|${color}`;
  let material = cache.get(key);
  if (!material) {
    const base = m.get('bark', color === undefined ? {} : { color });
    // Libraries without the patch hook (tests, tools) keep the shared bark: nothing to patch there.
    const library = m as Patchable;
    if (typeof library.registerPatched === 'function') {
      material = base.clone();
      library.registerPatched(material, 'foliage-wood-2', (shader) => withFade(shader, 'if (vPlantFade > 0.0 && plantDither() < vPlantFade) discard;'));
    } else material = base;
    cache.set(key, material);
  }
  return material;
}

// ───────────────────────────── The plant field ─────────────────────────────

export interface PlantPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** One of the forms a kind of plant takes. */
export interface PlantShape {
  parts: PlantPart[];
  /** Width and height of this shape's stand-in, as multiples of the model's `far` geometry (default 1, 1). */
  far?: [number, number];
  /** Colour of this shape's stand-in, as a multiple of the `far` geometry's own (default 1, 1, 1). */
  farTint?: readonly [number, number, number];
}

/**
 * Everything the field needs to draw one kind of plant. The world places a kind as plain instances of its
 * first shape (that is all `ChunkBuilder.instance` knows about); the field takes those instances over and
 * draws each plant as the shape picked for where it stands, grown, leant and toned a little differently from
 * its neighbours, in full within `near` metres of the camera and as the `far` stand-in beyond.
 */
export interface PlantModel {
  shapes: PlantShape[];
  /** Index of the shape for a plant standing at (x, z); `h` is a hash of the position, 0..1. Default: `h` spread evenly. */
  pick?: (x: number, z: number, h: number) => number;
  /** The stand-in, drawn with `farMaterial`; null where the plant simply stops being drawn at `near`. */
  far: THREE.BufferGeometry | null;
  farMaterial: THREE.Material | null;
  /** Metres from the camera within which the full plant is drawn. */
  near: number;
  /** Metres beyond which nothing is drawn (judged for a whole chunk's worth at a time). Default: no limit. */
  reach?: number;
  castShadow: boolean;
  /** Whether the stand-in casts a shadow (default: as `castShadow`). */
  farShadow?: boolean;
  /** Plant-to-plant variation: ± size, ± height against width, lean in radians, ± leaf tone. */
  vary: { size: number; height: number; lean: number; tone: number };
  /** Fine detail (grass): drawn only at High quality and above. */
  fine?: boolean;
}

/** How one plant differs from the model, from where it stands. Pure: the same plant always comes out the same. */
export function plantVariation(model: PlantModel, x: number, z: number) {
  const ix = Math.round(x * 4);
  const iz = Math.round(z * 4);
  const h = hash2(ix, iz);
  const count = model.shapes.length;
  const shape = Math.min(count - 1, Math.max(0, Math.floor(model.pick ? model.pick(x, z, h) : h * count)));
  const v = model.vary;
  const size = 1 + (hash2(ix + 71, iz - 13) * 2 - 1) * v.size;
  const height = 1 + (hash2(ix - 37, iz + 59) * 2 - 1) * v.height;
  const tone = 1 + (hash2(ix + 17, iz + 101) * 2 - 1) * v.tone;
  return {
    shape,
    width: size / Math.sqrt(height),
    height: size * height,
    lean: hash2(ix - 91, iz - 5) * v.lean,
    leanTowards: hash2(ix + 43, iz + 7) * Math.PI * 2,
    // Yellower or bluer as well as lighter or darker.
    tint: [tone * (1 + (hash2(ix + 3, iz - 67) - 0.5) * v.tone), tone, tone * (1 - (hash2(ix + 3, iz - 67) - 0.5) * v.tone * 1.6)] as [number, number, number],
  };
}

interface Patch {
  model: PlantModel;
  count: number;
  /** The instanced meshes the world made for this kind in this chunk; hidden while the field draws for them. */
  originals: THREE.InstancedMesh[];
  /** Per plant: position (3), full-size matrix (16), stand-in matrix (16), colour (3), shape. */
  position: Float32Array;
  nearMatrix: Float32Array;
  farMatrix: Float32Array;
  color: Float32Array;
  shape: Uint8Array;
  far: THREE.InstancedMesh | null;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The stand-in mesh currently leaves out the plants drawn in full. */
  split: boolean;
  onDispose: () => void;
}

/** Everything of one shape near the camera, whichever chunk it stands in: one instanced mesh per part. */
interface Bucket {
  shape: PlantShape;
  castShadow: boolean;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  /** Members this round: patch and index within it. */
  patches: Patch[];
  indices: number[];
}

const IDENTITY = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lean = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _sphere = new THREE.Sphere();


class PlantField {
  /** Models by the geometry of the first part the world instances for them: how a mesh the world made is recognised. */
  private models = new Map<THREE.BufferGeometry, { model: PlantModel; parts: THREE.BufferGeometry[] }>();
  private patches = new Set<Patch>();
  private buckets = new Map<PlantShape, Bucket>();
  private adopted = new WeakSet<THREE.Object3D>();
  private scanned = new WeakSet<THREE.Object3D>();
  /** Parents of the containers plants have been found in: new containers under them are looked through as they appear. */
  private watched = new Set<THREE.Object3D>();
  private group = new THREE.Group();
  private ticker = new THREE.Object3D();
  private camera: THREE.Camera | null = null;
  private centre = new THREE.Vector3(Infinity, 0, 0);
  private dirty = false;
  /** Fine detail is on: set from the number of shadow cascades the renderer runs, or forced (tools). */
  private fine = true;
  forceFine = false;
  /** Turn the field off altogether (tests of the plain props; debugging): plants stay as the world made them. */
  enabled = true;
  /** Multiplier on every kind's `near` (the quality setting's `detailRange`: under 1 on a phone). */
  get range(): number {
    return fadeUniforms.uPlantRange.value;
  }
  set range(value: number) {
    if (value === fadeUniforms.uPlantRange.value) return;
    fadeUniforms.uPlantRange.value = value;
    this.dirty = true;
  }

  constructor() {
    this.group.name = 'plants-near';
    this.group.matrixAutoUpdate = false;
    this.ticker.name = 'plants-ticker';
    // The renderer walks the scene updating matrices before it draws anything: that is the field's cue.
    this.ticker.updateMatrixWorld = () => this.tick();
  }

  /** `parts`: the geometries of the prop the world instances for this model (its `PropDef` parts, in order). */
  register(parts: THREE.BufferGeometry[], model: PlantModel) {
    this.models.set(parts[0], { model, parts });
    // Where each geometry dissolves. A shape several kinds share fades at the furthest of their distances:
    // too far out only means it fades in behind a stand-in that has not started to go yet.
    const mark = (geometry: THREE.BufferGeometry, near: number) => {
      const had = geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute | undefined;
      if (!had) geometry.setAttribute('aFade', fadeAttribute(near));
      else if (had.getX(0) < near) {
        had.setX(0, near);
        had.needsUpdate = true;
      }
    };
    if (model.far) mark(model.far, model.near);
    for (const shape of model.shapes) for (const part of shape.parts) mark(part.geometry, model.near);
  }

  /** Called for every leaf mesh as it is drawn. A mesh the field has not met is taken over (from the next frame). */
  seen(object: THREE.Object3D, camera: THREE.Camera) {
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera && camera.parent?.type !== 'CubeCamera') this.camera = camera;
    if (!this.enabled || object.userData.plantField || this.adopted.has(object) || !object.parent) return;
    this.scan(object.parent);
  }

  /** Looks through a container's children for plants the world has instanced, and takes them over. */
  scan(container: THREE.Object3D) {
    const children = container.children;
    let found = false;
    for (let i = 0; i < children.length; i++) {
      const mesh = children[i] as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || this.adopted.has(mesh) || mesh.userData.plantField) continue;
      const known = this.models.get(mesh.geometry);
      if (known && this.adopt(mesh, known.model, known.parts, container, i)) found = true;
    }
    if (!found) return;
    this.scanned.add(container);
    if (container.parent) this.watched.add(container.parent);
    // Hang the field's own objects off the top of the scene the first time anything is found.
    let top: THREE.Object3D = container;
    while (top.parent) top = top.parent;
    if (this.group.parent !== top) {
      top.add(this.group, this.ticker);
      for (const parent of this.watched) if (!this.inScene(parent, top)) this.watched.delete(parent);
    }
  }

  private inScene(object: THREE.Object3D, top: THREE.Object3D): boolean {
    let o: THREE.Object3D | null = object;
    while (o && o !== top) o = o.parent;
    return o === top;
  }

  private adopt(mesh: THREE.InstancedMesh, model: PlantModel, parts: THREE.BufferGeometry[], container: THREE.Object3D, at: number): boolean {
    const originals = [mesh];
    for (let i = 1; i < parts.length; i++) {
      const sibling = container.children[at + i] as THREE.InstancedMesh | undefined;
      if (!sibling?.isInstancedMesh || sibling.geometry !== parts[i] || sibling.count !== mesh.count) return false;
      originals.push(sibling);
    }
    // Plants are placed in world coordinates; anything else is left as it is.
    container.updateWorldMatrix(true, false);
    if (!container.matrixWorld.equals(IDENTITY) || !mesh.matrix.equals(IDENTITY)) return false;

    const count = mesh.count;
    const patch: Patch = {
      model,
      count,
      originals,
      position: new Float32Array(count * 3),
      nearMatrix: new Float32Array(count * 16),
      farMatrix: new Float32Array(count * 16),
      color: new Float32Array(count * 3),
      shape: new Uint8Array(count),
      far: null,
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
      split: false,
      onDispose: () => this.release(patch),
    };
    let minY = Infinity;
    let maxY = -Infinity;
    let maxScale = 0;
    for (let i = 0; i < count; i++) {
      mesh.getMatrixAt(i, _m);
      const e = _m.elements;
      const x = e[12];
      const y = e[13];
      const z = e[14];
      const scale = Math.hypot(e[0], e[1], e[2]);
      const heading = Math.atan2(e[8], e[10]);
      const v = plantVariation(model, x, z);
      const shape = model.shapes[v.shape];
      patch.shape[i] = v.shape;
      patch.position.set([x, y, z], i * 3);
      _q.setFromAxisAngle(UP, heading);
      if (v.lean > 0) _q.multiply(_lean.setFromAxisAngle(_axis.set(Math.cos(v.leanTowards), 0, Math.sin(v.leanTowards)), v.lean));
      _p.set(x, y, z);
      _m.compose(_p, _q, _s.set(scale * v.width, scale * v.height, scale * v.width)).toArray(patch.nearMatrix, i * 16);
      const far = shape.far ?? [1, 1];
      _m.compose(_p, _q, _s.set(scale * v.width * far[0], scale * v.height * far[1], scale * v.width * far[0])).toArray(patch.farMatrix, i * 16);
      if (mesh.instanceColor) mesh.getColorAt(i, _c);
      else _c.setRGB(1, 1, 1);
      patch.color.set([_c.r * v.tint[0], _c.g * v.tint[1], _c.b * v.tint[2]], i * 3);
      patch.minX = Math.min(patch.minX, x);
      patch.maxX = Math.max(patch.maxX, x);
      patch.minZ = Math.min(patch.minZ, z);
      patch.maxZ = Math.max(patch.maxZ, z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxScale = Math.max(maxScale, scale * Math.max(v.width, v.height) * Math.max(far[0], far[1]));
    }

    if (model.far && model.farMaterial && count > 0) {
      const far = new THREE.InstancedMesh(model.far, model.farMaterial, count);
      far.userData.plantField = true;
      far.instanceMatrix.array.set(patch.farMatrix);
      const tints = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const tint = model.shapes[patch.shape[i]].farTint;
        for (let c = 0; c < 3; c++) tints[i * 3 + c] = patch.color[i * 3 + c] * (tint ? tint[c] : 1);
      }
      far.instanceColor = new THREE.InstancedBufferAttribute(tints, 3);
      far.castShadow = model.farShadow ?? model.castShadow;
      far.receiveShadow = true;
      far.matrixAutoUpdate = false;
      if (!model.far.boundingSphere) model.far.computeBoundingSphere();
      const reach = (model.far.boundingSphere?.radius ?? 10) * maxScale;
      far.boundingSphere = new THREE.Sphere(
        new THREE.Vector3((patch.minX + patch.maxX) / 2, (minY + maxY) / 2, (patch.minZ + patch.maxZ) / 2),
        Math.hypot(patch.maxX - patch.minX, maxY - minY, patch.maxZ - patch.minZ) / 2 + reach + Math.abs(model.far.boundingSphere?.center.y ?? 0) * maxScale,
      );
      patch.far = far;
      container.add(far);
    }
    for (const original of originals) {
      original.visible = false;
      this.adopted.add(original);
    }
    // The world disposes of its meshes when the chunk goes; the field's go with them.
    mesh.addEventListener('dispose', patch.onDispose);
    this.patches.add(patch);
    this.dirty = true;
    return true;
  }

  private release(patch: Patch) {
    if (!this.patches.delete(patch)) return;
    patch.originals[0].removeEventListener('dispose', patch.onDispose);
    if (patch.far) {
      patch.far.removeFromParent();
      patch.far.dispose();
    }
    this.dirty = true;
  }

  /** Once a frame, before anything is drawn. */
  private tick() {
    if (!this.enabled) return;
    // New chunks: containers that have appeared under a parent plants were found in before.
    for (const parent of this.watched) {
      const children = parent.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (this.scanned.has(child) || child === this.group) continue;
        this.scanned.add(child);
        if (child.children.length) this.scan(child);
      }
    }
    const camera = this.camera;
    if (!camera) return;
    if (camera.parent) camera.getWorldPosition(_p);
    else _p.copy(camera.position);
    fadeUniforms.uPlantEye.value.copy(_p);
    if (!this.dirty && Math.hypot(_p.x - this.centre.x, _p.z - this.centre.z) < STEP) return;
    this.update(_p.x, _p.y, _p.z);
  }

  /** Sorts every plant into near (drawn in full) and far (its stand-in) around the point given. */
  update(x: number, y: number, z: number) {
    this.dirty = false;
    this.centre.set(x, y, z);
    const cascades = this.cascades();
    this.fine = this.forceFine || cascades === 0 || cascades >= 3;
    for (const bucket of this.buckets.values()) {
      bucket.patches.length = 0;
      bucket.indices.length = 0;
    }
    for (const patch of this.patches) {
      const model = patch.model;
      const dx = Math.max(patch.minX - x, 0, x - patch.maxX);
      const dz = Math.max(patch.minZ - z, 0, z - patch.maxZ);
      const d = Math.hypot(dx, dz);
      const shown = (this.fine || !model.fine) && d < (model.reach ?? Infinity);
      const far = patch.far;
      if (far) far.visible = shown;
      const near = model.near * this.range;
      if (!shown || d >= near) {
        if (patch.split && far) {
          far.instanceMatrix.array.set(patch.farMatrix);
          this.tintFar(patch, far, null);
          far.count = patch.count;
          far.instanceMatrix.needsUpdate = true;
          patch.split = false;
        }
        continue;
      }
      // Some of this patch is near: those go to the buckets of their shapes, the rest stay with the stand-in.
      // Plants in the dissolve band are in both (see `withFade`); the stand-in keeps them until they are well
      // inside it, since the camera travels up to STEP metres before this is looked at again.
      const near2 = near * near;
      const inner = Math.max(0, near - fadeBand(near) - 2 * STEP);
      const inner2 = inner * inner;
      const matrices = far ? (far.instanceMatrix.array as Float32Array) : null;
      const kept: number[] = [];
      for (let i = 0; i < patch.count; i++) {
        const px = patch.position[i * 3] - x;
        const pz = patch.position[i * 3 + 2] - z;
        const away2 = px * px + pz * pz;
        if (away2 < near2) {
          const bucket = this.bucket(model, model.shapes[patch.shape[i]]);
          bucket.patches.push(patch);
          bucket.indices.push(i);
        }
        if (matrices && away2 >= inner2) {
          for (let k = 0; k < 16; k++) matrices[kept.length * 16 + k] = patch.farMatrix[i * 16 + k];
          kept.push(i);
        }
      }
      if (far) {
        this.tintFar(patch, far, kept);
        far.count = kept.length;
        far.instanceMatrix.needsUpdate = true;
        far.visible = kept.length > 0;
        patch.split = true;
      }
    }
    for (const bucket of this.buckets.values()) this.fill(bucket);
  }

  /** Writes the stand-in mesh's colours for the plants it currently holds (`kept`: their indices; null: all). */
  private tintFar(patch: Patch, far: THREE.InstancedMesh, kept: number[] | null) {
    const colors = far.instanceColor;
    if (!colors) return;
    const out = colors.array as Float32Array;
    const n = kept ? kept.length : patch.count;
    for (let k = 0; k < n; k++) {
      const i = kept ? kept[k] : k;
      const tint = patch.model.shapes[patch.shape[i]].farTint;
      for (let c = 0; c < 3; c++) out[k * 3 + c] = patch.color[i * 3 + c] * (tint ? tint[c] : 1);
    }
    colors.needsUpdate = true;
  }

  private bucket(model: PlantModel, shape: PlantShape): Bucket {
    let bucket = this.buckets.get(shape);
    if (!bucket) {
      bucket = { shape, castShadow: model.castShadow, meshes: [], capacity: 0, patches: [], indices: [] };
      this.buckets.set(shape, bucket);
    }
    return bucket;
  }

  private fill(bucket: Bucket) {
    const n = bucket.indices.length;
    if (n > bucket.capacity) {
      for (const mesh of bucket.meshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      bucket.capacity = Math.max(16, Math.ceil(n * 1.5));
      bucket.meshes = bucket.shape.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, bucket.capacity);
        mesh.userData.plantField = true;
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.capacity * 3), 3);
        mesh.castShadow = bucket.castShadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.boundingSphere = new THREE.Sphere();
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        this.group.add(mesh);
        return mesh;
      });
    }
    if (!bucket.meshes.length) return;
    const first = bucket.meshes[0];
    const matrices = first.instanceMatrix.array as Float32Array;
    const colors = first.instanceColor!.array as Float32Array;
    _sphere.makeEmpty();
    let reach = 0;
    for (let k = 0; k < n; k++) {
      const patch = bucket.patches[k];
      const i = bucket.indices[k];
      for (let e = 0; e < 16; e++) matrices[k * 16 + e] = patch.nearMatrix[i * 16 + e];
      for (let c = 0; c < 3; c++) colors[k * 3 + c] = patch.color[i * 3 + c];
      _sphere.expandByPoint(_p.fromArray(patch.position, i * 3));
      reach = Math.max(reach, Math.hypot(patch.nearMatrix[i * 16 + 4], patch.nearMatrix[i * 16 + 5], patch.nearMatrix[i * 16 + 6]), Math.hypot(patch.nearMatrix[i * 16], patch.nearMatrix[i * 16 + 1], patch.nearMatrix[i * 16 + 2]));
    }
    for (const mesh of bucket.meshes) {
      if (mesh !== first) {
        (mesh.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16));
        (mesh.instanceColor!.array as Float32Array).set(colors.subarray(0, n * 3));
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      const own = mesh.geometry.boundingSphere;
      mesh.boundingSphere!.copy(_sphere);
      mesh.boundingSphere!.radius = Math.max(0, _sphere.radius) + ((own?.radius ?? 10) + (own?.center.length() ?? 0)) * reach;
    }
  }

  /** How many shadow cascades the renderer runs: 1 at Low, 2 at Medium, 3 and 4 at High and Ultra (0: no idea). */
  private cascades(): number {
    const top = this.group.parent;
    if (!top) return 0;
    let n = 0;
    for (const child of top.children) if ((child as THREE.DirectionalLight).isDirectionalLight && child.castShadow) n++;
    return n;
  }

  /**
   * Hands every plant back to the meshes the world made for it (each kind's first shape, in full, at any
   * distance) and stops taking new ones over: what the game looks like and costs without the field.
   */
  suspend() {
    this.enabled = false;
    for (const patch of [...this.patches]) {
      for (const original of patch.originals) original.visible = true;
      this.release(patch);
    }
    for (const bucket of this.buckets.values()) {
      bucket.patches.length = 0;
      bucket.indices.length = 0;
      this.fill(bucket);
    }
  }

  /** Undoes `suspend`: everything is looked through again on the next frame. */
  resume() {
    this.enabled = true;
    this.adopted = new WeakSet();
    this.scanned = new WeakSet();
    this.dirty = true;
  }

  /** What the field is drawing: for tools and tests. */
  census() {
    let plants = 0;
    let near = 0;
    let far = 0;
    for (const patch of this.patches) {
      plants += patch.count;
      if (patch.far?.visible) far += patch.far.count;
    }
    for (const bucket of this.buckets.values()) near += bucket.indices.length;
    return { patches: this.patches.size, plants, near, far, nearMeshes: [...this.buckets.values()].reduce((sum, b) => sum + (b.indices.length ? b.meshes.length : 0), 0) };
  }
}

/** The one plant field: plant models register with it as their props are built. */
export const plantField = new PlantField();
