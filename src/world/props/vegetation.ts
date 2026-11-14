import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import type { Materials } from '../../render/materials';
import { registerTexturePreload } from '../../render/phototextures';
import { FOLIAGE_ALPHA_TEST, foliageCell, foliageTexture, loadFoliage, type FoliageCell } from './foliage';
import type { PropDef, PropFactory } from './index';

/**
 * Trees and plants. Every kind is a `PropDef` (base at y = 0, scale 1) of at most three parts:
 *
 *  - wood: trunk and limbs as tapered tubes that actually branch, in the photographic `bark` surface;
 *  - leaves: flat cards carrying pictures from the foliage atlas (./foliage.ts), set in clumps on the limb
 *    ends. Cards are alpha-tested (no blending, nothing to sort) and cast alpha-tested shadows.
 *
 * Two things keep the cards from reading as flat planes. Their normals are bent away from the middle of
 * the crown, so a tree shades like one rounded mass rather than a heap of facets; and every card is
 * indexed twice, once per winding, in a single-sided material: both faces draw, but the back face keeps
 * the same bent normal instead of the flipped one a double-sided material would give it (which would
 * light half the cards on the sunny side as if they faced away). One of each pair is always culled, so
 * the doubling costs index entries, not fill.
 *
 * Vertex colours carry the species tint, a little card-to-card variation and a darkening towards the
 * inside of the crown; the per-instance tint from `ChunkBuilder.instance` multiplies on top.
 *
 * Shapes are grown from fixed seeds, so a kind is the same tree every time; variety between neighbours
 * comes from the instance heading, scale and tint, which is why every tree here is lopsided on purpose.
 */

type V3 = [number, number, number];

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const UP: V3 = [0, 1, 0];
/** Unit vector at `az` round the y axis, raised `el` above the horizontal. */
const polar = (az: number, el = 0): V3 => [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface Rng {
  (): number;
  range(lo: number, hi: number): number;
  unit(): V3;
}

function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (lo: number, hi: number) => lo + (hi - lo) * next();
  const unit = (): V3 => {
    const y = range(-1, 1);
    const az = range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    return [Math.cos(az) * r, y, Math.sin(az) * r];
  };
  return Object.assign(next, { range, unit });
}

// ───────────────────────────── Wood ─────────────────────────────

/** Trunks start a little below y = 0, so on a slope the downhill side still meets the ground. */
const SUNK = -0.35;

/** Metres one repeat of the bark texture covers (see the texture manifest). */
const BARK_TILE = 2.15;

class Wood {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  /** A tapered tube through `path` (centre and radius at each point), `sides` round. Open at both ends. */
  tube(path: { p: V3; r: number }[], sides: number) {
    const repeats = Math.max(1, Math.round((2 * Math.PI * path[0].r) / BARK_TILE));
    let ref: V3 = Math.abs(path[1].p[1] - path[0].p[1]) > 0.9 * len(sub(path[1].p, path[0].p)) ? [1, 0, 0] : UP;
    let v = 0;
    for (let i = 0; i < path.length; i++) {
      const tangent = norm(sub(path[Math.min(path.length - 1, i + 1)].p, path[Math.max(0, i - 1)].p));
      ref = norm(sub(ref, mul(tangent, dot(ref, tangent))));
      const bin = cross(tangent, ref);
      if (i > 0) v += len(sub(path[i].p, path[i - 1].p));
      const base = this.pos.length / 3;
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const d = add(mul(ref, Math.cos(a)), bin, Math.sin(a));
        const p = add(path[i].p, d, path[i].r);
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(d[0], d[1], d[2]);
        this.uv.push((k / sides) * repeats * BARK_TILE, v);
      }
      if (i === 0) continue;
      const below = base - (sides + 1);
      for (let k = 0; k < sides; k++) this.idx.push(below + k, below + k + 1, base + k + 1, below + k, base + k + 1, base + k);
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// ───────────────────────────── Leaf cards ─────────────────────────────

type Tint = [number, number, number];

class Leaves {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private swy: number[] = [];
  /** How far normals lean away from `centre` (0 = the card's own flat normal, 1 = fully radial). */
  bend = 0.8;
  /** Brightness at the middle of the crown, rising to 1 at `radius` from `centre`. */
  core = 0.5;
  /** Extra pull of the normals towards straight up (grasses and low plants shade like the ground). */
  upward = 0;
  /** Card-to-card swing between yellower and bluer green (±). */
  hue = 0.04;
  /** Lowest a card may reach. */
  floor = 0.04;
  /** How freely the cards move in the wind (1 = a leafy bough; stiff plants less, hanging shoots more). */
  sway = 1;

  constructor(
    private centre: V3,
    private radius: number,
    private r: Rng,
    /** Species colour, as a multiplier on the atlas (linear). */
    private tint: Tint = [1, 1, 1],
    /** Card-to-card brightness variation (±). */
    private vary = 0.1,
  ) {}

  private vertex(p: V3, face: V3, u: number, v: number, tint: Tint, sway: number) {
    const out = sub(p, this.centre);
    const d = len(out);
    const n = norm(add(add(mul(face, 1 - this.bend), out, this.bend / (d || 1)), UP, this.upward));
    const t = Math.min(1, d / this.radius);
    const shade = this.core + (1 - this.core) * t * t * (3 - 2 * t);
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
    this.swy.push(sway * this.sway);
  }

  private cardTint(scale = 1): Tint {
    const b = (1 + this.r.range(-this.vary, this.vary)) * scale;
    const hue = this.r.range(-this.hue, this.hue);
    return [this.tint[0] * b * (1 + hue), this.tint[1] * b, this.tint[2] * b * (1 - hue)];
  }

  /** The card's flat normal, turned to face away from the crown centre. */
  private facing(right: V3, up: V3, at: V3): V3 {
    const n = norm(cross(right, up));
    return dot(n, sub(at, this.centre)) < 0 ? mul(n, -1) : n;
  }

  /**
   * One flat card. `at` is where the picture's anchor (its stem end, see `FoliageCell.anchor`) goes;
   * `up` and `right` are the picture's axes in the world; `h` is its height in metres (width follows from
   * the cell's shape times `stretch`).
   */
  card(cell: FoliageCell, at: V3, right: V3, up: V3, h: number, o: { stretch?: number; shade?: number; mirror?: boolean } = {}) {
    const w = h * cell.aspect * (o.stretch ?? 1);
    // Rectangle in picture space relative to the anchor: x right, y up.
    let x0 = -w / 2;
    let y0 = 0;
    if (cell.anchor === 'top') y0 = -h;
    else if (cell.anchor === 'centre') y0 = -h / 2;
    else if (cell.anchor === 'left') {
      x0 = 0;
      y0 = -h / 2;
    }
    // Nothing goes underground: a card that would is lifted clear.
    const lowest = at[1] + Math.min(x0 * right[1], (x0 + w) * right[1]) + Math.min(y0 * up[1], (y0 + h) * up[1]);
    if (lowest < this.floor) at = [at[0], at[1] + this.floor - lowest, at[2]];
    const corner = (x: number, y: number) => add(add(at, right, x), up, y);
    const face = this.facing(right, up, corner(x0 + w / 2, y0 + h / 2));
    const tint = this.cardTint(o.shade);
    const mirror = o.mirror ?? this.r() < 0.5;
    const ua = mirror ? cell.u1 : cell.u0;
    const ub = mirror ? cell.u0 : cell.u1;
    const base = this.pos.length / 3;
    // Wind moves the far edge of the picture, not the edge it is attached by.
    const [bl, br, tr, tl] = cell.anchor === 'bottom' ? [0, 0, 1, 1] : cell.anchor === 'top' ? [1, 1, 0, 0] : cell.anchor === 'left' ? [0, 1, 1, 0] : [0.3, 0.3, 0.3, 0.3];
    this.vertex(corner(x0, y0), face, ua, cell.v1, tint, bl);
    this.vertex(corner(x0 + w, y0), face, ub, cell.v1, tint, br);
    this.vertex(corner(x0 + w, y0 + h), face, ub, cell.v0, tint, tr);
    this.vertex(corner(x0, y0 + h), face, ua, cell.v0, tint, tl);
    this.quad(base, base + 1, base + 2, base + 3);
  }

  /**
   * A card bent along its length: a ribbon through `spine`, `width` across, flat along `across` at each point.
   * The picture runs along the spine from its anchor edge (left for fronds, top for hanging curtains).
   */
  ribbon(cell: FoliageCell, spine: { p: V3; across: V3; width: number }[], o: { shade?: number; mirror?: boolean } = {}) {
    const tint = this.cardTint(o.shade);
    const mirror = o.mirror ?? this.r() < 0.5;
    let total = 0;
    for (let i = 1; i < spine.length; i++) total += len(sub(spine[i].p, spine[i - 1].p));
    let run = 0;
    const base = this.pos.length / 3;
    for (let i = 0; i < spine.length; i++) {
      if (i > 0) run += len(sub(spine[i].p, spine[i - 1].p));
      const t = run / total;
      const along = norm(sub(spine[Math.min(spine.length - 1, i + 1)].p, spine[Math.max(0, i - 1)].p));
      const s = spine[i];
      const face = this.facing(s.across, along, s.p);
      const a = add(s.p, s.across, -s.width / 2);
      const b = add(s.p, s.across, s.width / 2);
      if (cell.anchor === 'left') {
        // Along u; across is the picture's vertical.
        const u = cell.u0 + (cell.u1 - cell.u0) * t;
        this.vertex(a, face, u, mirror ? cell.v0 : cell.v1, tint, t);
        this.vertex(b, face, u, mirror ? cell.v1 : cell.v0, tint, t);
      } else {
        // Hanging from the top edge: along v, downwards.
        const v = cell.v0 + (cell.v1 - cell.v0) * t;
        this.vertex(a, face, mirror ? cell.u1 : cell.u0, v, tint, t);
        this.vertex(b, face, mirror ? cell.u0 : cell.u1, v, tint, t);
      }
      if (i > 0) this.quad(base + i * 2 - 2, base + i * 2 - 1, base + i * 2 + 1, base + i * 2);
    }
  }

  /** Both windings, so the card shows from either side with the same (bent) normals. */
  private quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d, a, c, b, a, d, c);
  }

  /**
   * The foliage on the end of a limb: `count` boughs springing from `at`, where the crown's surface faces
   * `out`. Most lie against that surface like shingles (so from outside they are seen face on, not as
   * streaks); `fins` of them (0..1) stand any way up, which is what gives the crown a leafy outline when
   * the shingles are edge on. Boughs grow towards `lean` (plus a random direction, plus a little outwards).
   */
  clump(cells: FoliageCell[], at: V3, out: V3, count: number, size: [number, number], o: { lean?: V3; fins?: number; flare?: number } = {}) {
    // Each limb's foliage is a shade of its own, so the crown is patchy at the scale of its boughs.
    const shade = 1 + this.r.range(-this.vary, this.vary) * 0.8;
    for (let k = 0; k < count; k++) {
      const fin = this.r() < (o.fins ?? 0.3);
      const n = norm(add(out, this.r.unit(), fin ? 2.2 : this.r.range(0.25, 0.75)));
      const grow = add(add(this.r.unit(), o.lean ?? UP, 0.7), out, o.flare ?? 0.35);
      const up = norm(sub(grow, mul(n, dot(grow, n))));
      const right = cross(up, n);
      const h = this.r.range(size[0], size[1]);
      this.card(cells[k % cells.length], add(at, up, -h * 0.1), right, up, h, { shade });
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.swy, 1));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Wind on the leaf cards. `strength` is how far (metres) the free edge of a bough is pushed at the height of
 * a gust; `direction` is where the wind blows to (world x, z). The game may set both from the weather; by
 * default it is a light nor'wester. Wood does not move, and neither do shadows (the sway is small).
 */
export const foliageWind = { strength: 0.09, direction: new THREE.Vector2(0.8, 0.6) };

const windUniforms = { uWindTime: { value: 0 }, uWind: { value: new THREE.Vector3() } };

/** Share of full sunlight every leaf gets regardless of facing and shadow (see `leafPatch`). */
const LEAF_THROUGH = 0.16;

/** Shader patch for the leaf material: cards lean and flutter by their `aSway` weight, and pass a little light. */
function leafPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uWindTime = windUniforms.uWindTime;
  shader.uniforms.uWind = windUniforms.uWind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uWindTime;\nuniform vec3 uWind;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swayAt = instanceMatrix[3].xyz;
        // World wind into the instance's own frame (its matrix is a rotation times a uniform scale).
        vec3 swayWind = (vec4(uWind, 0.0) * instanceMatrix).xyz / dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
      #else
        vec3 swayAt = vec3(0.0);
        vec3 swayWind = uWind;
      #endif
      float swayPhase = dot(swayAt.xz, vec2(0.37, 0.23)) + dot(position, vec3(0.9, 0.7, 1.1));
      // Gusts roll across the country; each bough answers in its own time.
      float swayGust = 0.5 + 0.5 * sin(uWindTime * 0.7 - dot(swayAt.xz, vec2(0.045, 0.03)));
      float swayFlutter = sin(uWindTime * 2.3 + swayPhase) + 0.5 * sin(uWindTime * 5.3 + swayPhase * 1.7);
      transformed += aSway * (swayWind * (0.3 + 0.7 * swayGust) * (0.65 + 0.35 * swayFlutter) + vec3(0.0, 0.3 * swayFlutter * length(swayWind), 0.0));`,
    );
  // Leaves let light through, and a crown scatters it about: a share of the sun reaches every leaf whichever
  // way it faces and whether or not the shadow map says it is shaded. Without this the far side of a tree
  // has only skylight, and goes black under a hard sun. (The cascades are one light each, hence the mean.)
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
      vec3 leafThrough = vec3(0.0);
      for (int i = 0; i < NUM_DIR_LIGHTS; i++) leafThrough += directionalLights[i].color;
      reflectedLight.directDiffuse += leafThrough / float(NUM_DIR_LIGHTS) * BRDF_Lambert(material.diffuseColor) * ${LEAF_THROUGH.toFixed(3)};
    #endif`,
  );
}

type Patchable = MaterialLibrary & { registerPatched?: Materials['registerPatched'] };

const leafMaterials = new WeakMap<MaterialLibrary, THREE.MeshStandardMaterial>();

/** The one material every leaf card uses. */
function leafMaterial(m: MaterialLibrary): THREE.MeshStandardMaterial {
  let material = leafMaterials.get(m);
  if (!material) {
    // Normally already loaded by the texture preload; this covers anyone building props without it.
    void loadFoliage();
    // Physical only for `specularIntensity`: with normals bent round the crown, a standard material's grazing
    // highlight washes whole cards out to white on the side towards the sun.
    material = new THREE.MeshPhysicalMaterial({
      map: foliageTexture,
      alphaTest: FOLIAGE_ALPHA_TEST,
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
      specularIntensity: 0.22,
    });
    // The renderer's material library can chain a shader patch after the shadow system's own; where it can,
    // leaves move in the wind. Anywhere else (tests, tools) they are simply still.
    const library = m as Patchable;
    if (typeof library.registerPatched === 'function') {
      library.registerPatched(material, 'foliage', leafPatch);
      material.onBeforeRender = () => {
        windUniforms.uWindTime.value = performance.now() / 1000;
        windUniforms.uWind.value.set(foliageWind.direction.x, 0, foliageWind.direction.y).multiplyScalar(foliageWind.strength / (foliageWind.direction.length() || 1));
      };
    } else {
      m.register(material);
    }
    leafMaterials.set(m, material);
  }
  return material;
}

const cells = (...names: string[]) => names.map(foliageCell);

function plant(m: MaterialLibrary, wood: Wood | null, bark: number | undefined, leaves: Leaves, rest: Omit<PropDef, 'parts'> = {}): PropDef {
  const parts: PropDef['parts'] = [];
  if (wood) parts.push({ geometry: wood.geometry(), material: m.get('bark', bark === undefined ? {} : { color: bark }) });
  parts.push({ geometry: leaves.geometry(), material: leafMaterial(m) });
  return { parts, ...rest };
}

// ───────────────────────────── Broad crowns ─────────────────────────────

interface CrownSpec {
  seed: number;
  /** Trunk path up to the fork. */
  trunk: { p: V3; r: number }[];
  trunkSides: number;
  /** Middle and radii (horizontal, vertical) of the shell the limb ends reach. */
  centre: V3;
  rx: number;
  ry: number;
  /** Limb ends, spread over the shell from `low` to the top (sine of elevation, -1..1). */
  ends: number;
  low: number;
  sectors: number;
  /** Radius of a main limb where it leaves the trunk. */
  limb: number;
  /** Sides of a main limb (default 5). */
  limbSides?: number;
  /** Twigs from the main limbs to the limb ends: bent (default), straight, or left out where foliage hides them. */
  twigs?: 'bent' | 'straight' | 'none';
  /** One side of the crown is fuller: shell radius × (1 ± lopsided) round the compass. */
  lopsided: number;
  cells: FoliageCell[];
  cardsPerEnd: number;
  cardSize: [number, number];
  /** Share of the cards that stand any way up rather than lying against the crown's surface. */
  fins?: number;
  /** How strongly boughs reach outwards past the limb ends. */
  flare?: number;
  /** Cards on the main limbs, inside the crown, so there is no clear view through the middle. */
  inner: number;
}

/**
 * A spreading crown: main limbs leave the top of the trunk for the sectors of the compass, fork to
 * limb ends spread over a lumpy shell, and each end carries a clump of cards. Returns the limb ends.
 */
function crown(spec: CrownSpec, wood: Wood, leaves: Leaves, r: Rng): { p: V3; out: V3 }[] {
  const fork = spec.trunk[spec.trunk.length - 1];
  // The trunk closes over in a shoulder where the limbs leave it.
  wood.tube([...spec.trunk, { p: add(fork.p, UP, fork.r * 0.7), r: fork.r * 0.72 }, { p: add(fork.p, UP, fork.r * 1.25), r: fork.r * 0.2 }], spec.trunkSides);
  const heavy = r.range(0, Math.PI * 2);
  const ends: { p: V3; out: V3; az: number; top: boolean }[] = [];
  for (let i = 0; i < spec.ends; i++) {
    const sinEl = spec.low + (0.98 - spec.low) * ((i + 0.5) / spec.ends);
    const az = i * GOLDEN + r.range(-0.25, 0.25);
    const flat = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const k = r.range(0.86, 1.12) * (1 + spec.lopsided * Math.cos(az - heavy));
    const p: V3 = [spec.centre[0] + Math.cos(az) * flat * spec.rx * k, spec.centre[1] + sinEl * spec.ry * k, spec.centre[2] + Math.sin(az) * flat * spec.rx * k];
    ends.push({ p, out: norm(sub(p, spec.centre)), az: ((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), top: sinEl > 0.78 });
  }
  const groups: (typeof ends)[] = Array.from({ length: spec.sectors + 1 }, () => []);
  for (const e of ends) groups[e.top ? spec.sectors : Math.floor((e.az / (Math.PI * 2)) * spec.sectors) % spec.sectors].push(e);
  for (const group of groups) {
    if (!group.length) continue;
    let mean: V3 = [0, 0, 0];
    for (const e of group) mean = add(mean, e.p, 1 / group.length);
    // The limb rises steeply out of the fork, then leans out towards its ends.
    const elbow = add(mix(fork.p, mean, 0.55), UP, 0.35);
    const knee = add(mix(fork.p, elbow, 0.45), UP, len(sub(elbow, fork.p)) * 0.16);
    const root = add(fork.p, UP, -fork.r * 0.8);
    wood.tube([{ p: root, r: spec.limb * 1.15 }, { p: mix(root, knee, 0.45), r: spec.limb }, { p: knee, r: spec.limb * 0.8 }, { p: elbow, r: spec.limb * 0.55 }], spec.limbSides ?? 5);
    for (const e of group) {
      const tip = mix(elbow, e.p, 0.85);
      const sag = add(mix(elbow, tip, 0.5), r.unit(), 0.22);
      if (spec.twigs !== 'none') wood.tube(spec.twigs === 'straight' ? [{ p: elbow, r: spec.limb * 0.42 }, { p: tip, r: spec.limb * 0.12 }] : [{ p: elbow, r: spec.limb * 0.42 }, { p: sag, r: spec.limb * 0.28 }, { p: tip, r: spec.limb * 0.12 }], 3);
      // Boughs on the underside of the crown hang; the rest reach up and out.
      const lean: V3 = e.out[1] < 0.1 ? [e.out[0] * 0.8, -0.5, e.out[2] * 0.8] : UP;
      leaves.clump(spec.cells, tip, e.out, spec.cardsPerEnd, spec.cardSize, { lean, fins: spec.fins, flare: spec.flare });
    }
    if (spec.inner) leaves.clump(spec.cells, elbow, norm(add(sub(elbow, spec.centre), UP, 0.6)), spec.inner, spec.cardSize, { fins: 0.6 });
  }
  return ends;
}

/** English oak, standing in for every broad park and avenue tree (oak, elm, lime). */
const oak: PropFactory = (m) => {
  const r = rng(101);
  const wood = new Wood();
  // Midsummer oak: a deep, slightly dusty green, well below the lawn in brightness, and patchy from bough to bough.
  const leaves = new Leaves([0.2, 5.6, 0], 5.6, r, [0.7, 0.58, 0.84], 0.17);
  leaves.hue = 0.1;
  leaves.upward = 0.35;
  crown(
    {
      seed: 101,
      trunk: [{ p: [0, SUNK, 0], r: 0.68 }, { p: [0.02, 0.45, 0], r: 0.5 }, { p: [0.1, 1.7, -0.04], r: 0.44 }, { p: [0.18, 3, 0.05], r: 0.4 }],
      trunkSides: 8,
      centre: [0.2, 6.5, 0],
      rx: 3.5,
      ry: 3.3,
      ends: 26,
      low: -0.25,
      sectors: 5,
      limb: 0.24,
      lopsided: 0.12,
      cells: cells('oak-a', 'oak-b'),
      cardsPerEnd: 5,
      cardSize: [2.2, 2.9],
      fins: 0.22,
      inner: 3,
    },
    wood,
    leaves,
    r,
  );
  return plant(m, wood, undefined, leaves, { collider: { radius: 0.45, height: 4 } });
};

/** Weeping willow: a low dome on wide limbs, hung with curtains that trail almost to the ground. */
const willow: PropFactory = (m) => {
  const r = rng(202);
  const wood = new Wood();
  const centre: V3 = [0.3, 5.2, 0.1];
  const leaves = new Leaves([0.3, 4.4, 0.1], 5.4, r, [0.84, 0.76, 0.9], 0.14);
  leaves.core = 0.6;
  leaves.upward = 0.3;
  crown(
    {
      seed: 202,
      trunk: [{ p: [0, SUNK, 0], r: 0.72 }, { p: [0.04, 0.5, 0], r: 0.55 }, { p: [0.24, 1.6, 0.1], r: 0.5 }, { p: [0.4, 2.5, 0.12], r: 0.46 }],
      trunkSides: 8,
      centre,
      rx: 3.2,
      ry: 2.8,
      ends: 13,
      low: 0.3,
      sectors: 5,
      limb: 0.25,
      lopsided: 0.1,
      cells: cells('willow-bough'),
      cardsPerEnd: 3,
      cardSize: [2.3, 2.9],
      inner: 0,
    },
    wood,
    leaves,
    r,
  );
  const curtain = foliageCell('willow-curtain');
  const rings: [radius: number, count: number, foot: [number, number]][] = [
    [1.9, 6, [2.2, 3.4]],
    [3.1, 10, [0.9, 2.2]],
    [4.2, 15, [0.4, 1.5]],
  ];
  for (const [radius, count, foot] of rings) {
    for (let i = 0; i < count; i++) {
      const az = ((i + r.range(0.15, 0.85)) / count) * Math.PI * 2;
      const rho = radius * r.range(0.9, 1.1);
      const top = centre[1] + 2.8 * Math.sqrt(Math.max(0.04, 1 - (rho / 4.75) ** 2));
      const drop = top - r.range(foot[0], foot[1]);
      const out: V3 = [Math.cos(az), 0, Math.sin(az)];
      // The hanging plane is turned a little off square to the trunk so the rings do not read as cylinders.
      const across = polar(az + Math.PI / 2 + r.range(-0.55, 0.55));
      const width = drop * curtain.aspect * r.range(0.95, 1.25);
      const at = (along: number, sag: number): V3 => [centre[0] + out[0] * (rho + along), top - drop * sag, centre[2] + out[2] * (rho + along)];
      leaves.ribbon(curtain, [
        { p: add(at(-0.7, 0), UP, 0.3), across, width },
        { p: at(0, 0.14), across, width },
        { p: at(0.28, 0.55), across, width },
        { p: at(0.2, 1), across, width },
      ]);
    }
  }
  return plant(m, wood, undefined, leaves, { collider: { radius: 0.5, height: 3 } });
};

/** Old macrocarpa: several heavy stems, a broad flat-topped crown of dark plates, one side wind-pruned. */
const macrocarpa: PropFactory = (m) => {
  const r = rng(303);
  const wood = new Wood();
  const leaves = new Leaves([0.3, 4.6, 0], 6.4, r, [1, 1, 1]);
  leaves.core = 0.5;
  leaves.upward = 0.4;
  crown(
    {
      seed: 303,
      trunk: [{ p: [0, SUNK, 0], r: 0.95 }, { p: [0.04, 0.5, 0], r: 0.72 }, { p: [0.14, 1.5, 0.05], r: 0.66 }],
      trunkSides: 5,
      centre: [0.5, 5.9, 0],
      rx: 4.4,
      ry: 3.4,
      ends: 21,
      low: -0.42,
      sectors: 4,
      limb: 0.34,
      limbSides: 4,
      twigs: 'none',
      lopsided: 0.3,
      cells: cells('macrocarpa'),
      cardsPerEnd: 4,
      cardSize: [2.6, 3.4],
      inner: 0,
    },
    wood,
    leaves,
    r,
  );
  return plant(m, wood, 0x57483a, leaves, { collider: { radius: 0.7, height: 3 } });
};

// ───────────────────────────── Columns and spires ─────────────────────────────

/** Lombardy poplar: a tall narrow column of steeply rising branches. */
const poplar: PropFactory = (m) => {
  const r = rng(404);
  const wood = new Wood();
  const height = 16.5;
  wood.tube([{ p: [0, SUNK, 0], r: 0.42 }, { p: [0, 0.5, 0], r: 0.32 }, { p: [0.06, 5, 0.03], r: 0.24 }, { p: [0.02, 10.5, -0.04], r: 0.15 }, { p: [0, height - 1, 0], r: 0.04 }], 6);
  const leaves = new Leaves([0, 8.5, 0], 8.5, r, [0.74, 0.64, 0.86], 0.15);
  leaves.bend = 0.7;
  leaves.core = 0.62;
  leaves.upward = 0.3;
  const cell = foliageCell('poplar');
  const count = 84;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = 1.1 + t * (height - 4.3);
    const az = i * GOLDEN;
    // Fattest a third of the way up, drawn in to a point at the top and a little at the foot.
    const girth = Math.min(1, 0.55 + t * 2.2) * (1 - Math.max(0, t - 0.45) ** 1.6 * 1.25);
    const out = polar(az);
    const up = norm(add(UP, out, r.range(0.16, 0.4) * girth));
    const right = norm(cross(up, add(out, r.unit(), 0.9)));
    leaves.card(cell, [out[0] * 0.25 * girth, y, out[2] * 0.25 * girth], right, up, r.range(3, 3.8) * (0.62 + 0.38 * girth), { stretch: 0.8 + 0.3 * girth });
  }
  return plant(m, wood, 0x6a655a, leaves, { collider: { radius: 0.35, height: 3 } });
};

/** Radiata pine as it grows in a shelter belt: a dark, dense spire, heavier on one side, dead stubs below. */
const pine: PropFactory = (m) => {
  const r = rng(505);
  const wood = new Wood();
  const height = 14.5;
  const lean: V3 = [0.5, 0, 0.15];
  const spine = (y: number): V3 => [lean[0] * (y / height) ** 2, y, lean[2] * (y / height) ** 2];
  wood.tube([{ p: [0, SUNK, 0], r: 0.56 }, { p: spine(0.5), r: 0.42 }, { p: spine(4), r: 0.33 }, { p: spine(9), r: 0.2 }, { p: spine(height - 1), r: 0.05 }], 6);
  for (const [y, az] of [[1.5, 0.6], [2.1, 2.9], [2.6, 4.7]] as const) {
    const out = polar(az, 0.15);
    wood.tube([{ p: spine(y), r: 0.07 }, { p: add(spine(y), out, r.range(0.9, 1.5)), r: 0.03 }], 3);
  }
  const leaves = new Leaves([0.2, 6.5, 0], 7.6, r, [1, 1, 1]);
  leaves.core = 0.5;
  leaves.upward = 0.4;
  const cell = foliageCell('pine-a');
  const boughs = 34;
  for (let i = 0; i < boughs; i++) {
    const t = i / (boughs - 1);
    const y = 2.4 + t * (height - 3.6);
    const az = i * GOLDEN + r.range(-0.2, 0.2);
    // A cone, widest at the foot and fuller to leeward; the lowest boughs sag, the top ones reach up.
    const reach = (0.45 + 2.75 * (1 - t) ** 0.75) * (1 + 0.2 * Math.cos(az - 0.3));
    const out = polar(az);
    const dir = polar(az, -0.12 + t * 0.85 + r.range(-0.08, 0.12));
    const h = Math.min(3.5, 1.3 + reach * 0.8);
    leaves.clump([cell], add(spine(y), dir, reach * 0.5), norm(add(out, UP, 0.2 + t * 1.1)), 3, [h * 0.9, h * 1.1], { lean: dir, fins: 0.34, flare: 0.6 });
  }
  return plant(m, wood, 0x5a4636, leaves, { collider: { radius: 0.4, height: 3 } });
};

/** Norfolk Island pine: a dead-straight trunk with flat, evenly spaced tiers of fronds, tips turned up. */
const norfolkPine: PropFactory = (m) => {
  const r = rng(606);
  const wood = new Wood();
  const height = 20;
  wood.tube([{ p: [0, SUNK, 0], r: 0.52 }, { p: [0, 0.6, 0], r: 0.4 }, { p: [0, 7, 0], r: 0.28 }, { p: [0, 14, 0], r: 0.15 }, { p: [0, height, 0], r: 0.03 }], 7);
  const leaves = new Leaves([0, 9, 0], 10, r, [1, 1, 1]);
  leaves.bend = 0.55;
  leaves.upward = 0.5;
  leaves.core = 0.55;
  leaves.sway = 0.5;
  const cell = foliageCell('norfolk');
  const tiers = 13;
  let y = 3.4;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / (tiers - 1);
    const reach = 0.7 + 4.7 * (1 - t) ** 0.8;
    const branches = tier > 9 ? 5 : 6;
    for (let b = 0; b < branches; b++) {
      const az = ((b + (tier % 2) * 0.5) / branches) * Math.PI * 2 + r.range(-0.12, 0.12);
      const out = polar(az);
      const roll = r.range(-0.4, 0.4);
      const flat = polar(az + Math.PI / 2);
      const across = norm(add(mul(flat, Math.cos(roll)), UP, Math.sin(roll)));
      const width = reach * 0.66 + 0.25;
      const droop = 0.1 + 0.06 * (1 - t);
      leaves.ribbon(cell, [
        { p: [out[0] * 0.1, y, out[2] * 0.1], across, width: width * 0.9 },
        { p: [out[0] * reach * 0.55, y - reach * droop, out[2] * reach * 0.55], across, width },
        { p: [out[0] * reach, y + reach * 0.06, out[2] * reach], across, width: width * 0.9 },
      ]);
    }
    y += 1.6 - t * 0.75;
  }
  // The leader.
  for (const az of [0.3, 1.87]) leaves.card(foliageCell('macrocarpa'), [0, height - 2.2, 0], polar(az), UP, 2.6, { stretch: 0.5 });
  return plant(m, wood, 0x5e5044, leaves, { collider: { radius: 0.4, height: 4 } });
};

// ───────────────────────────── Tufts and fountains ─────────────────────────────

/** Tī kōuka, the cabbage tree: a bare corky trunk forking near the top into a few spiky heads. */
const cabbageTree: PropFactory = (m) => {
  const r = rng(707);
  const wood = new Wood();
  const fork: V3 = [0.22, 4.5, 0.06];
  wood.tube([{ p: [0, SUNK, 0], r: 0.3 }, { p: [0.01, 0.4, 0], r: 0.22 }, { p: [0.12, 2.4, 0.05], r: 0.19 }, { p: fork, r: 0.17 }], 6);
  const heads: V3[] = [];
  const arm = (from: V3, az: number, el: number, length: number, radius: number): V3 => {
    const dir = polar(az, el);
    const mid = add(add(from, dir, length * 0.5), UP, length * 0.12);
    const end = add(add(from, dir, length), UP, length * 0.3);
    wood.tube([{ p: from, r: radius }, { p: mid, r: radius * 0.85 }, { p: end, r: radius * 0.7 }], 5);
    return end;
  };
  const a = arm(fork, 0.4, 0.75, 1.5, 0.13);
  const b = arm(fork, 2.6, 0.55, 1.3, 0.12);
  const c = arm(fork, 4.5, 0.85, 1.0, 0.12);
  heads.push(arm(a, 1.3, 0.6, 0.8, 0.09), arm(a, 5.8, 0.7, 0.9, 0.09), b, arm(c, 3.6, 0.6, 0.7, 0.09), arm(c, 5.2, 0.9, 0.9, 0.09));
  const leaves = new Leaves([0.3, 5.6, 0], 2.6, r, [1, 1, 1], 0.08);
  leaves.bend = 0.5;
  leaves.core = 0.75;
  const cell = foliageCell('cabbage');
  for (const head of heads) {
    const size = r.range(1.75, 2.15);
    const turn = r.range(0, Math.PI);
    for (let k = 0; k < 3; k++) leaves.card(cell, add(head, UP, 0.1), polar(turn + (k * Math.PI) / 3), UP, size, { mirror: k === 1 });
    // One more across the top, so the tuft is full from above and below.
    const tilt = norm(add(UP, r.unit(), 0.35));
    const flat = norm(cross(tilt, polar(turn)));
    leaves.card(cell, add(head, UP, 0.25), flat, norm(cross(flat, tilt)), size * 0.9);
  }
  return plant(m, wood, 0x9a8c78, leaves, { collider: { radius: 0.25, height: 5 } });
};

/** Canary Island date palm: a stout trunk, a pineapple of old leaf bases, a fountain of arching fronds. */
const phoenixPalm: PropFactory = (m) => {
  const r = rng(808);
  const wood = new Wood();
  const top = 5.4;
  wood.tube([{ p: [0, SUNK, 0], r: 0.7 }, { p: [0, 0.5, 0], r: 0.54 }, { p: [0, 3.6, 0], r: 0.5 }, { p: [0, 4.8, 0], r: 0.64 }, { p: [0, top, 0], r: 0.7 }, { p: [0, top + 0.3, 0], r: 0.25 }], 9);
  const leaves = new Leaves([0, top - 1, 0], 5.6, r, [1, 1, 1]);
  leaves.bend = 0.45;
  leaves.upward = 0.5;
  leaves.core = 0.62;
  leaves.sway = 0.6;
  const cell = foliageCell('palm');
  const frond = (az: number, el: number, length: number) => {
    const out = polar(az);
    const roll = r.range(-0.5, 0.5);
    const flat = polar(az + Math.PI / 2);
    const across = norm(add(mul(flat, Math.cos(roll)), UP, Math.sin(roll)));
    const width = length * 0.4;
    // Leaves the crown at `el`, then arcs over under its own weight.
    const spine: { p: V3; across: V3; width: number }[] = [];
    let p: V3 = [out[0] * 0.25, top + 0.05, out[2] * 0.25];
    let angle = el;
    const segments = 3;
    for (let i = 0; i <= segments; i++) {
      spine.push({ p, across, width: width * (i === 0 ? 0.6 : 1) });
      p = add(p, add(mul(out, Math.cos(angle)), UP, Math.sin(angle)), length / segments);
      angle -= 0.36 + (1.2 - el) * 0.14;
    }
    leaves.ribbon(cell, spine);
  };
  for (let i = 0; i < 10; i++) frond(i * GOLDEN, r.range(1, 1.35), r.range(3.8, 4.4));
  for (let i = 0; i < 15; i++) frond(i * GOLDEN + 0.7, r.range(0.5, 0.85), r.range(4.4, 5));
  for (let i = 0; i < 15; i++) frond(i * GOLDEN + 1.9, r.range(-0.05, 0.32), r.range(4.2, 4.8));
  return plant(m, wood, 0x7a6a55, leaves, { collider: { radius: 0.5, height: 5 } });
};

/** Upright cards crossing near one point: `count` of them, turned evenly round the compass. */
function fans(leaves: Leaves, r: Rng, cell: FoliageCell, count: number, height: [number, number], o: { at?: V3; offset?: number; lean?: number; turn?: number; stretch?: number } = {}) {
  const at = o.at ?? [0, 0, 0];
  const turn = o.turn ?? r.range(0, Math.PI);
  for (let i = 0; i < count; i++) {
    const az = turn + (i / count) * Math.PI + r.range(-0.12, 0.12);
    const right = polar(az);
    const side = polar(az + Math.PI / 2);
    const s = i % 2 ? 1 : -1;
    const up = norm(add(UP, side, s * (o.lean ?? 0)));
    leaves.card(cell, add(at, side, s * (o.offset ?? 0) * r.range(0.4, 1)), right, up, r.range(height[0], height[1]), { stretch: o.stretch });
  }
}

/** Harakeke: a clump of stiff sword leaves with kōrari (flower stalks) standing well above them. */
const flax: PropFactory = (m) => {
  const r = rng(909);
  const leaves = new Leaves([0, -0.6, 0], 2.8, r, [1, 1, 1], 0.12);
  leaves.bend = 0.6;
  leaves.upward = 0.3;
  leaves.core = 0.7;
  fans(leaves, r, foliageCell('flax'), 5, [1.9, 2.3], { offset: 0.3, lean: 0.14 });
  fans(leaves, r, foliageCell('flax'), 3, [1.5, 1.8], { offset: 0.55, lean: 0.32 });
  fans(leaves, r, foliageCell('flax-flower'), 2, [3.1, 3.6], { offset: 0.1, lean: 0.06 });
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true };
};

/** A garden shrub: boughs fanning up and out from the ground. */
const bush: PropFactory = (m) => {
  const r = rng(1010);
  const leaves = new Leaves([0, 0.2, 0], 1.5, r, [0.78, 0.7, 0.86], 0.15);
  leaves.core = 0.55;
  leaves.upward = 0.3;
  leaves.sway = 0.5;
  const cell = foliageCell('shrub');
  for (let i = 0; i < 16; i++) {
    const az = i * GOLDEN;
    const flare = 0.15 + ((i * 0.37) % 1) * 1.3;
    const up = norm(add(UP, polar(az), flare));
    const right = norm(cross(up, add(polar(az), r.unit(), 0.8)));
    leaves.card(cell, add([0, 0.02, 0], polar(az), 0.22 * flare), right, up, r.range(1.05, 1.5));
  }
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true };
};

/**
 * 2 m of clipped hedge along x. A dark leafy core keeps it solid; leaf cards stand just proud of every
 * face and overhang the edges, so the outline is leaves rather than a box.
 */
const hedge: PropFactory = (m) => {
  const r = rng(1111);
  const core = new THREE.BoxGeometry(1.98, 1.16, 0.62).translate(0, 0.58, 0);
  const uv = core.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.2);
  const leaves = new Leaves([0, 0.2, 0], 1.3, r, [0.66, 0.6, 0.7], 0.1);
  leaves.bend = 0.35;
  leaves.core = 0.8;
  leaves.sway = 0.12;
  const face = foliageCell('hedge');
  const tuft = foliageCell('shrub');
  const X: V3 = [1, 0, 0];
  const Z: V3 = [0, 0, 1];
  // The picture's leaves stop short of its edges (a ragged top, ragged ends), so every card is bigger than the
  // face it covers: the leaves, not the card, end at the corner. In a run the overhang laps onto the next unit.
  // Faces, a touch off vertical so the hedge is narrower at the top, the way they are clipped.
  // They are also turned a hair, so where two units' faces overlap in a run one lies clearly in front.
  for (const s of [1, -1]) leaves.card(face, [0, 0, s * 0.41], norm([s, 0, 0.035]), norm([0, 1, -s * 0.06]), 1.66, { stretch: 2.5 / (1.66 * face.aspect), mirror: false });
  // Top.
  leaves.card(face, [0, 1.19, 0.44], X, [0, 0.02, -1], 1.1, { stretch: 2.5 / (1.1 * face.aspect) });
  // Ends.
  for (const s of [1, -1]) leaves.card(face, [s * 1.02, 0, 0], mul(Z, -s), UP, 1.64, { stretch: 1.05 / (1.64 * face.aspect) });
  // Sprigs standing out of the top and the faces to break the planes.
  for (let i = 0; i < 6; i++) {
    const x = -0.85 + (i / 5) * 1.7 + r.range(-0.1, 0.1);
    const s = i % 2 ? 1 : -1;
    leaves.card(tuft, [x, 0.74, s * 0.2], polar(r.range(-0.5, 0.5)), norm([r.range(-0.2, 0.2), 1, s * 0.35]), r.range(0.6, 0.72));
  }
  return {
    parts: [
      { geometry: core, material: m.get('foliage', { color: 0x1f3a1c }) },
      { geometry: leaves.geometry(), material: leafMaterial(m) },
    ],
  };
};

// ───────────────────────────── New kinds ─────────────────────────────

/** Toetoe: a big arching tussock with tall cream plumes; riverbeds, drains and swampy corners. */
const toetoe: PropFactory = (m) => {
  const r = rng(1212);
  const leaves = new Leaves([0, -1, 0], 3.2, r, [1, 1, 1], 0.1);
  leaves.bend = 0.6;
  leaves.upward = 0.5;
  leaves.core = 0.75;
  fans(leaves, r, foliageCell('toetoe'), 4, [2.5, 3], { offset: 0.2, lean: 0.12 });
  fans(leaves, r, foliageCell('toetoe'), 2, [1.9, 2.3], { offset: 0.5, lean: 0.3 });
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true, castShadow: false };
};

/** A tuft of long seeding grass for road verges, fence lines and anywhere the mower misses. */
const grassTuft: PropFactory = (m) => {
  const r = rng(1313);
  const leaves = new Leaves([0, -2, 0], 3, r, [1, 1, 1], 0.1);
  leaves.bend = 0.7;
  leaves.upward = 1;
  leaves.core = 0.85;
  fans(leaves, r, foliageCell('grass'), 3, [0.75, 0.95], { offset: 0.12, lean: 0.2 });
  fans(leaves, r, foliageCell('grass'), 2, [0.6, 0.75], { offset: 0.45, lean: 0.35 });
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true, castShadow: false };
};

/**
 * The same tuft with its own straw colour cancelled, so the instance tint is its colour (pale tussock on the
 * hills, marram on the dunes, green rank grass by a drain).
 */
const tussock: PropFactory = (m) => {
  const r = rng(1313);
  const cell = foliageCell('grass');
  const k = 0.62;
  const leaves = new Leaves([0, -2, 0], 3, r, [k / cell.mean[0], k / cell.mean[1], k / cell.mean[2]], 0.1);
  leaves.bend = 0.7;
  leaves.upward = 1;
  leaves.core = 0.85;
  fans(leaves, r, cell, 3, [0.75, 0.95], { offset: 0.12, lean: 0.2 });
  fans(leaves, r, cell, 2, [0.6, 0.75], { offset: 0.45, lean: 0.35 });
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true, castShadow: false };
};

/** Gorse in flower: a dense, dark, prickly mound; hillsides, riverbeds and neglected fence lines. */
const gorse: PropFactory = (m) => {
  const r = rng(1414);
  const leaves = new Leaves([0, 0.2, 0], 1.7, r, [1, 1, 1], 0.1);
  leaves.core = 0.55;
  const cell = foliageCell('gorse');
  for (let i = 0; i < 12; i++) {
    const az = i * GOLDEN;
    const flare = 0.2 + ((i * 0.41) % 1) * 1.25;
    const up = norm(add(UP, polar(az), flare));
    const right = norm(cross(up, add(polar(az), r.unit(), 0.8)));
    leaves.card(cell, add([0, 0.02, 0], polar(az), 0.2 * flare), right, up, r.range(1.5, 1.95));
  }
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true };
};

/** Russell lupins: a mound of hand-shaped leaves under purple, blue, pink and white spikes. Braided riverbeds. */
const lupin: PropFactory = (m) => {
  const r = rng(1515);
  const leaves = new Leaves([0, -1.5, 0], 3, r, [1, 1, 1], 0.06);
  leaves.bend = 0.6;
  leaves.upward = 0.8;
  leaves.core = 0.9;
  fans(leaves, r, foliageCell('lupin'), 3, [1.05, 1.25], { offset: 0.15, lean: 0.1 });
  fans(leaves, r, foliageCell('lupin'), 2, [0.85, 1], { offset: 0.5, lean: 0.25 });
  return { parts: [{ geometry: leaves.geometry(), material: leafMaterial(m) }], minor: true, castShadow: false };
};

/**
 * Every plant kind, by the name placement code uses. The first ten are the contract kinds (registered in
 * ./index.ts and ./extra.ts); the rest are new this round.
 */
export const VEGETATION: Record<string, PropFactory> = {
  'tree-oak': oak,
  'tree-willow': willow,
  'tree-cabbage': cabbageTree,
  'tree-pine': pine,
  'tree-poplar': poplar,
  bush,
  flax,
  hedge,
  'tree-norfolk-pine': norfolkPine,
  'tree-phoenix-palm': phoenixPalm,
  'tree-macrocarpa': macrocarpa,
  toetoe,
  'grass-tuft': grassTuft,
  tussock,
  gorse,
  lupin,
};

// The atlas is fetched with the other photographic textures, before the world is built.
registerTexturePreload(loadFoliage);
