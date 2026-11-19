import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { add3, cross3, dot3, len3, sub3, type V3 } from '../../core/vec3';
import type { MaterialLibrary } from '../../core/types';
import { METALLIC } from './paints';

/**
 * Building kit for the procedural vehicle models.
 *
 * A model is described as triangles queued against a handful of surfaces, and `finish()` turns each
 * surface into ONE indexed mesh with smoothed normals:
 *
 *   paint   the vehicle's own clear-coated body colour (returned as `bodyMaterial`)
 *   glass   see-through tinted glazing and clear lamp lenses (per-vertex tint and opacity)
 *   trim    everything else that is opaque: one vertex-coloured material whose finish (matte plastic,
 *           rubber, chrome, alloy…) is picked per part through a tiny roughness / metalness lookup
 *   head, tail   the emissive lamp materials the game drives
 *
 * plus any library material handed over directly (number plates, signwriting, timber). A car is therefore
 * about six meshes and four wheels however much detail it carries.
 *
 * Geometry that does not change between vehicles of a kind is built once (`cached`) and replayed as typed
 * arrays, so spawning traffic costs almost nothing.
 *
 * Conventions: the model faces +z, origin on the ground under the centre, +x is the vehicle's left and
 * the driver sits at x < 0.
 */

export { add3, cross3, dot3, len3, mix3, norm3, sub3, type V3 } from '../../core/vec3';
export type Pt = readonly [a: number, b: number];
export type Fn = (t: number) => number;

/** Dice for optional details (a dog on the tray, signwriting, plates). Deterministic per session. */
export const dice = new Rng(0x1995);

// ───────────────────────────── Surfaces ─────────────────────────────

/**
 * Finishes of the shared trim material: [roughness, metalness]. Each is a row of a small atlas, so a
 * finish can also carry a relief pattern (tyre tread, sidewall ribs, the flutes of a wheel cover):
 * geometry that wants the pattern supplies its own texture coordinates through `Tint.at`.
 */
const FINISHES = {
  matte: [0.86, 0],
  rubber: [0.93, 0],
  cloth: [1, 0],
  satin: [0.55, 0],
  gloss: [0.16, 0],
  chrome: [0.07, 1],
  // Bright plating that is not a mirror: its sun glint is broad instead of a point that blooms like a lit lamp.
  polished: [0.17, 1],
  alloy: [0.3, 1],
  steel: [0.5, 0.75],
  // Patterned rows.
  tread: [0.97, 0],
  wall: [0.86, 0],
  fins: [0.14, 1],
  mesh: [0.62, 0.35],
  weave: [1, 0],
} as const;
export type Finish = keyof typeof FINISHES;
const FINISH_NAMES = Object.keys(FINISHES) as Finish[];
/** Rows in the finish atlas (a power of two, so rows fall on texel boundaries at every mip level that matters). */
const ROWS = 16;
const ROW_PX = 32;
const ATLAS_W = 256;

/** A colour and finish of the shared trim material. */
export class Tint {
  /** Linear RGB, as vertex colours want it. */
  readonly rgb: readonly number[];
  /** Atlas row of the finish (texture v at the middle of the row). */
  readonly v: number;
  private row: number;
  constructor(
    readonly hex: number,
    readonly finish: Finish,
  ) {
    const c = new THREE.Color(hex);
    this.rgb = [c.r, c.g, c.b];
    this.row = FINISH_NAMES.indexOf(finish);
    this.v = (this.row + 0.5) / ROWS;
  }
  /** Texture coordinate inside this finish's pattern: `u` tiles along the row, `t` runs 0…1 across it. */
  at(u: number, t: number): [number, number] {
    return [u, (this.row + 0.06 + 0.88 * (t < 0 ? 0 : t > 1 ? 1 : t)) / ROWS];
  }
}

/** Glazing: `reflect` is how mirror-like it is (0.04 = plain glass), `shade` how much it darkens what is behind. */
export class Glaze {
  readonly rgba: readonly number[];
  constructor(reflect: number, shade: number, hex = 0xffffff) {
    const c = new THREE.Color(hex);
    this.rgba = [c.r * reflect, c.g * reflect, c.b * reflect, shade];
  }
}

const tints = new Map<string, Tint>();
export function tint(hex: number, finish: Finish = 'matte'): Tint {
  const key = hex + finish;
  let t = tints.get(key);
  if (!t) tints.set(key, (t = new Tint(hex, finish)));
  return t;
}

/** Named surfaces every kit knows. */
export const PAINT = 'paint';
export const HEAD = 'head';
export const TAIL = 'tail';
export type Surface = string | Tint | Glaze | THREE.Material;

export const DARK = tint(0x0d0e10, 'matte');
export const BLACK = tint(0x0a0a0b, 'gloss');
export const PLASTIC = tint(0x24262a, 'matte');
export const GREY = tint(0x45484c, 'matte');
export const RUBBER = tint(0x121212, 'rubber');
export const CHROME = tint(0xf0f0f0, 'chrome');
export const BRIGHT = tint(0xf0f0f0, 'polished');
export const ALLOY = tint(0xc9ccd0, 'alloy');
export const STEEL = tint(0x9fa4a8, 'steel');
export const RED_LENS = tint(0x8f1611, 'gloss');
export const AMBER = tint(0xe58a16, 'gloss');
export const CLEAR_LENS = tint(0xe8ecee, 'gloss');
/** Side and screen glass: a green-grey factory tint. */
export const WINDOW = new Glaze(0.13, 0.34, 0xd6ece2);
/** Darker glass (rear screens of the sporty cars, bus windows). */
export const SMOKED = new Glaze(0.13, 0.55, 0xd6ece2);
/** The shade band along the top of a windscreen. */
export const SHADE_BAND = new Glaze(0.05, 0.42, 0x9fd8c0);
/**
 * Lamp lenses. The lit elements behind them are the game's shared emitter materials, whose base colour is
 * the colour of the light: bare, they look switched on in sunshine. A lens with some shade takes them down
 * to glass in daylight and still lets the night-time glow through.
 */
export const LENS = new Glaze(0.3, 0.3);
/** The prisms moulded into a lens: a little more mirror, a little more shade. */
export const FLUTE = new Glaze(0.22, 0.1);
export const TAIL_LENS = new Glaze(0.22, 0.3, 0xff9c8c);
export const AMBER_LENS = new Glaze(0.22, 0.25, 0xffc070);
/** Deep red glass over a lit tail lamp: dark by day, and it keeps the lamp red at night instead of washing out to orange. */
export const RED_GLASS = new Glaze(0.12, 0.74, 0xff6a5a);
/**
 * Window glass on the distant version. Up close a window is dark because of what is behind it (seats, door
 * cards, the far side of the cabin in shade); the distant version has no cabin, so the same pane showed the
 * street through both sides of the car and read as white, and a car crossing `LOD_RANGE` flashed its windows
 * from pale to dark. Out there the glass does the darkening itself.
 */
const FAR_GLAZE = new Map<Glaze, Glaze>([
  [WINDOW, new Glaze(0.13, 0.8, 0xd6ece2)],
  [SMOKED, new Glaze(0.13, 0.84, 0xd6ece2)],
  [SHADE_BAND, new Glaze(0.05, 0.86, 0x9fd8c0)],
]);

/** How weathered one vehicle is: all 0…1. `dirt` is road film, `dust` pale farm dust, `fade` sun-bleached lacquer. */
export interface Wear {
  dirt: number;
  dust: number;
  fade: number;
  rust: number;
}
/** Where a vehicle's wheels are, so the film can gather behind them. */
export interface Stance {
  /** Half the wheelbase, wheel radius, half the width, half the length. */
  axle: number;
  radius: number;
  half: number;
  tail: number;
}
export const CLEAN: Wear = { dirt: 0, dust: 0, fade: 0, rust: 0 };

interface Shared {
  glass: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  /** The trim material again for road wheels, which gather dust all round rather than from the sills up. */
  wheel: THREE.MeshStandardMaterial;
  baked: Map<string, Map<Surface, Chunk>>;
}
const shared = new WeakMap<MaterialLibrary, Shared>();

/** Relief of a patterned finish at (u, t), each 0…1: height 0…1 and how much it darkens the colour. */
type Relief = (u: number, t: number) => [height: number, shade: number];
const step = (edge0: number, edge1: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
};
const fract = (x: number) => x - Math.floor(x);
const hash1 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const RELIEF: Partial<Record<Finish, Relief>> = {
  // Tyre tread, eight pitches to the tile: three circumferential grooves, staggered shoulder slots, sipes.
  tread(u, t) {
    let h = 1;
    for (const g of [0.27, 0.5, 0.73]) h = Math.min(h, step(0.022, 0.05, Math.abs(t - g)));
    const pitch = fract(u * 8 + (t > 0.5 ? 0.5 : 0));
    if (t < 0.21 || t > 0.79) h = Math.min(h, step(0.07, 0.16, Math.min(pitch, 1 - pitch)));
    else {
      const sipe = fract(u * 8 + t * 2.2 + 0.25);
      h = Math.min(h, 0.45 + 0.55 * step(0.03, 0.09, Math.min(sipe, 1 - sipe)));
    }
    return [h, 0.42 + 0.58 * h];
  },
  // Sidewall from the bead (t = 0) to the shoulder: a rim-protector rib, two fine rings, a band of raised
  // marks where the lettering would be, serrations on the shoulder.
  wall(u, t) {
    let h = 0.35;
    h += 0.5 * Math.exp(-(((t - 0.1) / 0.05) ** 2));
    h += 0.25 * Math.exp(-(((t - 0.3) / 0.018) ** 2)) + 0.25 * Math.exp(-(((t - 0.76) / 0.018) ** 2));
    const arc = fract(u * 2);
    if (t > 0.42 && t < 0.64 && arc > 0.12 && arc < 0.7) {
      const cell = Math.floor(u * 72);
      const inCell = fract(u * 72);
      if (hash1(cell) > 0.3 && inCell > 0.16 && inCell < 0.84) h += 0.4 * step(0.42, 0.45, t) * step(0.64, 0.61, t);
    }
    if (t > 0.86) h += 0.3 * step(0.2, 0.3, fract(u * 32)) * step(0.8, 0.7, fract(u * 32));
    return [h, 1];
  },
  // Radial flutes of a pressed wheel cover.
  fins(u) {
    const f = fract(u * 12);
    const h = f < 0.7 ? f / 0.7 : (1 - f) / 0.3;
    return [h, 0.86 + 0.14 * h];
  },
  // Expanded-metal grille: bright wires over dark holes.
  mesh(u, t) {
    const a = fract(u * 16 + t * 2);
    const b = fract(u * 16 - t * 2);
    const wire = Math.max(step(0.3, 0.16, Math.min(a, 1 - a)), step(0.3, 0.16, Math.min(b, 1 - b)));
    return [wire, 0.1 + 0.9 * wire];
  },
  // Seat cloth: a fine two-way rib.
  weave(u, t) {
    const h = 0.5 + 0.25 * Math.sin(u * Math.PI * 2 * 24) + 0.25 * Math.sin(t * Math.PI * 2 * 6);
    return [h, 0.9 + 0.1 * h];
  },
};

/** The trim atlas: colour (white outside the patterns), normal map, and the finish lookup down its rows. */
function atlas(): { map: THREE.DataTexture; normal: THREE.DataTexture; lut: THREE.DataTexture } {
  const H = ROWS * ROW_PX;
  const color = new Uint8Array(ATLAS_W * H * 4).fill(255);
  const normal = new Uint8Array(ATLAS_W * H * 4);
  for (let i = 0; i < ATLAS_W * H; i++) normal.set([128, 128, 255, 255], i * 4);
  const lut = new Uint8Array(ROWS * 4);
  FINISH_NAMES.forEach((name, row) => {
    lut.set([0, Math.round(FINISHES[name][0] * 255), Math.round(FINISHES[name][1] * 255), 255], row * 4);
    const relief = RELIEF[name];
    if (!relief) return;
    // The pattern fills the middle 88 % of the row (what `Tint.at` addresses); the margins repeat its edges.
    const at = (x: number, y: number) => relief(fract(x / ATLAS_W), Math.min(1, Math.max(0, (y / ROW_PX - 0.06) / 0.88)));
    const strength = name === 'tread' ? 5 : name === 'wall' ? 3.2 : name === 'weave' ? 1.2 : 2.4;
    for (let y = 0; y < ROW_PX; y++) {
      for (let x = 0; x < ATLAS_W; x++) {
        const [, shade] = at(x + 0.5, y + 0.5);
        const dx = (at(x + 1.5, y + 0.5)[0] - at(x - 0.5, y + 0.5)[0]) * strength;
        const dy = (at(x + 0.5, y + 1.5)[0] - at(x + 0.5, y - 0.5)[0]) * strength;
        const l = Math.hypot(dx, dy, 1);
        const o = ((row * ROW_PX + y) * ATLAS_W + x) * 4;
        const c = Math.round(Math.pow(shade, 1 / 2.2) * 255);
        color.set([c, c, c, 255], o);
        normal.set([Math.round((-dx / l) * 127.5 + 127.5), Math.round((-dy / l) * 127.5 + 127.5), Math.round((1 / l) * 127.5 + 127.5), 255], o);
      }
    }
  });
  const texture = (data: Uint8Array, w: number, h: number, smooth: boolean) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = smooth;
    if (smooth) t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const map = texture(color, ATLAS_W, H, true);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal: texture(normal, ATLAS_W, H, true), lut: texture(lut, 1, ROWS, false) };
}

// Weathering shared by the paint and trim shaders: value noise over the vehicle's own coordinates.
const WEAR_VERTEX_PARS = /* glsl */ `
varying vec3 vCarPos;
varying vec3 vCarN;`;
const WEAR_FRAGMENT_PARS = /* glsl */ `
varying vec3 vCarPos;
varying vec3 vCarN;
uniform vec4 uWear;
uniform vec4 uCar;
float carHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float carNoise( vec3 x ) {
	vec3 i = floor( x );
	vec3 f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( mix( carHash( i ), carHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( carHash( i + vec3( 0, 1, 0 ) ), carHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( carHash( i + vec3( 0, 0, 1 ) ), carHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( carHash( i + vec3( 0, 1, 1 ) ), carHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
		f.z );
}
const vec3 CAR_FILM = vec3( 0.105, 0.09, 0.072 );
const vec3 CAR_DUST = vec3( 0.4, 0.32, 0.215 );`;

/**
 * Paint weathering. `uWear` is (road film, dust, sun fade, rust) for this vehicle and `uCar` (half
 * wheelbase, wheel radius, half width, a seed). Film climbs from the sills and fans out behind each wheel;
 * dust lies on everything that faces up and runs in streaks down the flanks; lacquer goes chalky on the
 * bonnet, roof and boot; rust starts at the arch lips and the bottoms of the doors.
 */
const PAINT_WEAR = /* glsl */ `
{
	vec3 q = vCarPos + uCar.w;
	float nBig = carNoise( q * 2.3 );
	float nMid = carNoise( q * 9.0 );
	float nFine = carNoise( q * 43.0 );
	float h = vCarPos.y;
	float up = smoothstep( 0.45, 0.92, normalize( vCarN ).y );
	float r = uCar.y;
	float dF = uCar.x - vCarPos.z;
	float dR = - uCar.x - vCarPos.z;
	float film = 1.0 - smoothstep( 0.14, 0.58 + 0.34 * nBig, h );
	float fan = max( smoothstep( r * 0.7, r * 1.3, dF ) * ( 1.0 - smoothstep( r * 1.6, r * 4.4, dF ) ), smoothstep( r * 0.7, r * 1.3, dR ) * ( 1.0 - smoothstep( r * 1.6, r * 4.4, dR ) ) );
	float spray = fan * ( 1.0 - smoothstep( r * 0.9, r * 2.8, h ) ) * smoothstep( uCar.z * 0.7, uCar.z * 0.9, abs( vCarPos.x ) );
	float grime = clamp( ( film * 0.85 + spray * 0.8 ) * ( 0.62 + 0.3 * nBig + 0.25 * nMid ) * ( 0.85 + 0.3 * nFine ) * uWear.x * 1.5, 0.0, 1.0 );
	float streak = carNoise( vec3( vCarPos.z * 23.0, vCarPos.y * 1.4, vCarPos.x * 23.0 ) + uCar.w );
	float dust = uWear.y * clamp( 0.22 + 0.6 * film + 0.4 * up + 0.5 * spray, 0.0, 1.0 ) * ( 0.5 + 0.7 * nBig ) * mix( 0.35 + 1.0 * streak, 1.0, up );
	dust = clamp( dust, 0.0, 1.0 );
	float fade = clamp( uWear.z * up * ( 0.45 + 0.8 * nBig ), 0.0, 1.0 );
	float lip = min( abs( length( vec2( dF, h - r ) ) - ( r + 0.06 ) ), abs( length( vec2( dR, h - r ) ) - ( r + 0.06 ) ) );
	float prone = max( ( 1.0 - smoothstep( 0.16, 0.34, h ) ) * 0.7, ( 1.0 - smoothstep( 0.0, 0.055, lip ) ) * step( r * 0.8, h ) );
	float rustField = nMid * 0.5 + carNoise( q * 31.0 ) * 0.5 + prone * 0.5 * uWear.w;
	float rust = smoothstep( 0.86, 0.9, rustField ) * smoothstep( 0.0, 0.25, prone ) * step( 0.01, uWear.w );
	// The lacquer lifts and stains a little way out from each scab.
	float stain = smoothstep( 0.78, 0.9, rustField ) * smoothstep( 0.0, 0.25, prone ) * step( 0.01, uWear.w );
	vec3 base = diffuseColor.rgb;
	float lum = dot( base, vec3( 0.2126, 0.7152, 0.0722 ) );
	base = mix( base, mix( base, vec3( lum ), 0.45 ) * 1.2 + 0.04, fade );
	base = mix( base, base * vec3( 0.62, 0.5, 0.42 ), stain * 0.6 );
	base = mix( base, mix( vec3( 0.13, 0.052, 0.022 ), vec3( 0.045, 0.022, 0.014 ), nFine ), rust );
	base = mix( base, CAR_FILM * ( 0.85 + 0.3 * nFine ), grime * 0.8 );
	base = mix( base, CAR_DUST, dust * 0.78 );
	diffuseColor.rgb = base;
	float dull = clamp( max( max( grime, dust ), max( rust, fade * 0.75 ) ), 0.0, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.93, dull );
	metalnessFactor *= 1.0 - max( max( grime, dust ), rust );
	carCoat = 1.0 - dull;
}`;

/**
 * Trim weathering: the same film on bumpers, sill strips and mud flaps (`uWear.x` = 0), or dust and brake
 * dust all round a road wheel (`uWear.x` = 1). Furnishings inside the cabin are marked through `u` and
 * stay clean.
 */
const TRIM_WEAR = /* glsl */ `
{
	float row = vRoughnessMapUv.y * ${ROWS.toFixed(1)};
	float exposed = row >= ${FINISH_NAMES.indexOf('weave').toFixed(1)} ? 0.0 : ( row >= ${FINISH_NAMES.indexOf('tread').toFixed(1)} ? 1.0 : step( 0.4, vRoughnessMapUv.x ) );
	vec3 q = vCarPos;
	float nMid = carNoise( q * 9.0 );
	float nFine = carNoise( q * 43.0 );
	float film = mix( ( 1.0 - smoothstep( 0.12, 0.62, vCarPos.y ) ) * 0.62, 0.34, uWear.x ) * ( 0.45 + 0.85 * nMid ) * ( 0.75 + 0.5 * nFine );
	film = clamp( film * uWear.y, 0.0, 1.0 ) * exposed;
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( CAR_FILM, CAR_DUST, uWear.z ) * ( 0.8 + 0.4 * nFine ), film * 0.8 );
	roughnessFactor = mix( roughnessFactor, 0.94, film );
	metalnessFactor *= 1.0 - film;
}`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + WEAR_VERTEX_PARS)
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvCarN = objectNormal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCarPos = transformed;');
}

function sharedFor(m: MaterialLibrary): Shared {
  let s = shared.get(m);
  if (s) return s;
  const { map, normal, lut } = atlas();
  // Opaque trim: colour per vertex, finish through the lookup (roughness in G, metalness in B).
  const makeTrim = (wheel: boolean) => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut, map, normalMap: normal, envMapIntensity: 1.1 });
    if (!m.registerPatched) return m.register(material);
    // (wheel?, amount, dustiness, –)
    const wear = new THREE.Vector4(wheel ? 1 : 0, wheel ? 1 : 0.85, wheel ? 0.5 : 0.25, 0);
    return m.registerPatched(material, 'vehicle-trim-2', (shader) => {
      shader.uniforms.uWear = { value: wear };
      shader.uniforms.uCar = { value: new THREE.Vector4() };
      patchVertex(shader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + WEAR_FRAGMENT_PARS).replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + TRIM_WEAR);
    });
  };
  // Glass: only reflects (metalness 1, so no diffuse term) and its alpha is how much it shades what is
  // behind. Blended "one, one-minus-alpha" so reflections keep full strength on a nearly clear pane.
  const glass = m.register(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.03,
      metalness: 1,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      envMapIntensity: 1.5,
    }),
  );
  s = { glass, trim: makeTrim(false), wheel: makeTrim(true), baked: new Map() };
  shared.set(m, s);
  return s;
}

let paintSeed = 0;

/**
 * Clear-coated car paint. The vehicle system recolours it through `color` and, when the car is wrecked,
 * sets `roughness` to 0.95: that also burns the lacquer off here, so a wreck is not left glossy.
 */
function makePaint(m: MaterialLibrary, color: number, wear: Wear, stance: Stance | null): THREE.MeshPhysicalMaterial {
  const flake = METALLIC.has(color);
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: flake ? 0.42 : 0.5,
    metalness: flake ? 0.62 : 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.04 + 0.1 * wear.fade,
    envMapIntensity: 1.15,
    // An open shell: let both faces throw the shadow so the roof and far flank count.
    shadowSide: THREE.DoubleSide,
  });
  let roughness = paint.roughness;
  Object.defineProperty(paint, 'roughness', {
    get: () => roughness,
    set: (value: number) => {
      roughness = value;
      if (value >= 0.9) {
        paint.clearcoat = 0;
        paint.metalness = 0.1;
      }
    },
    enumerable: true,
    configurable: true,
  });
  if (!m.registerPatched || !stance) return m.register(paint);
  const uWear = new THREE.Vector4(wear.dirt, wear.dust, wear.fade, wear.rust);
  const uCar = new THREE.Vector4(stance.axle, stance.radius, stance.half, (paintSeed = (paintSeed + 7.31) % 97));
  return m.registerPatched(paint, 'vehicle-paint-2', (shader) => {
    shader.uniforms.uWear = { value: uWear };
    shader.uniforms.uCar = { value: uCar };
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + WEAR_FRAGMENT_PARS)
      .replace('void main() {', 'void main() {\n\tfloat carCoat = 1.0;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + PAINT_WEAR)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n\tmaterial.clearcoat *= carCoat;\n#endif');
  });
}

// ───────────────────────────── Curves ─────────────────────────────

/** Smooth function through knots [t, value] (monotone cubic: no overshoot). Clamped outside the knots. */
export function curve(knots: Pt[]): Fn {
  const n = knots.length;
  if (n === 1) return () => knots[0][1];
  const x = knots.map((k) => k[0]);
  const y = knots.map((k) => k[1]);
  const d: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) s.push((y[i + 1] - y[i]) / (x[i + 1] - x[i] || 1e-9));
  for (let i = 0; i < n; i++) {
    if (i === 0) d.push(s[0]);
    else if (i === n - 1) d.push(s[n - 2]);
    else if (s[i - 1] * s[i] <= 0) d.push(0);
    else {
      const w1 = 2 * (x[i + 1] - x[i]) + (x[i] - x[i - 1]);
      const w2 = x[i + 1] - x[i] + 2 * (x[i] - x[i - 1]);
      d.push((w1 + w2) / (w1 / s[i - 1] + w2 / s[i]));
    }
  }
  return (t: number) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (t > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const u = (t - x[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * h * d[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * h * d[i + 1];
  };
}

/** Straight-line function through knots. */
export function line(knots: Pt[]): Fn {
  return (t: number) => {
    if (t <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      if (t <= knots[i][0]) {
        const [a, b] = [knots[i - 1], knots[i]];
        return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1e-9);
      }
    }
    return knots[knots.length - 1][1];
  };
}

export { clamp01, lerp as mix, smooth } from '../../core/math';

// ───────────────────────────── Baking ─────────────────────────────

interface Part {
  /** Triangle soup: nine numbers per triangle. */
  pos: number[];
  /** Two numbers per corner, or null for a constant. */
  uv: number[] | null;
  tint: Tint | Glaze | null;
  /** Corners smooth only with others of the same group; negative = always faceted. */
  group: number;
  /** Cabin furnishing: takes no road film. */
  inside: boolean;
}

/** A finished, indexed piece of one surface. Shared between vehicles; never mutated. */
interface Chunk {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array | null;
  colSize: number;
  idx: Uint32Array | Uint16Array;
  cast: boolean;
}

const CREASE = Math.cos((48 * Math.PI) / 180);

function bake(parts: Part[], colSize: number, cast: boolean): Chunk {
  let corners = 0;
  for (const p of parts) corners += p.pos.length / 3;
  const P = new Float32Array(corners * 3);
  const UV = new Float32Array(corners * 2);
  const COL = colSize ? new Float32Array(corners * colSize) : null;
  const G = new Int32Array(corners);
  let at = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    P.set(p.pos, at * 3);
    if (p.uv) UV.set(p.uv, at * 2);
    else if (p.tint instanceof Tint) for (let i = 0; i < n; i++) (UV[(at + i) * 2] = p.inside ? 0.25 : 0.5), (UV[(at + i) * 2 + 1] = p.tint.v);
    if (COL) {
      const c = p.tint instanceof Tint ? p.tint.rgb : p.tint instanceof Glaze ? p.tint.rgba : [1, 1, 1, 1];
      for (let i = 0; i < n; i++) for (let j = 0; j < colSize; j++) COL[(at + i) * colSize + j] = c[j];
    }
    G.fill(p.group, at, at + n);
    at += n;
  }
  // Face normals: FA area-weighted, FU unit.
  const tris = corners / 3;
  const FA = new Float32Array(tris * 3);
  const FU = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const ux = P[o + 3] - P[o];
    const uy = P[o + 4] - P[o + 1];
    const uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o];
    const vy = P[o + 7] - P[o + 1];
    const vz = P[o + 8] - P[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    FA.set([nx, ny, nz], t * 3);
    FU.set([nx / l, ny / l, nz / l], t * 3);
  }
  // Corners that share a position, as linked lists.
  const first = new Map<number, number>();
  const next = new Int32Array(corners).fill(-1);
  for (let c = 0; c < corners; c++) {
    const key = ((Math.round(P[c * 3] * 4000) + 32768) * 65536 + Math.round(P[c * 3 + 1] * 4000) + 32768) * 65536 + Math.round(P[c * 3 + 2] * 4000) + 32768;
    const head = first.get(key);
    if (head !== undefined) next[c] = head;
    first.set(key, c);
  }
  const N = new Float32Array(corners * 3);
  const id = new Int32Array(corners).fill(-1);
  const cluster: number[] = [];
  let verts = 0;
  for (const head of first.values()) {
    cluster.length = 0;
    for (let c = head; c >= 0; c = next[c]) cluster.push(c);
    for (const a of cluster) {
      const fa = Math.floor(a / 3) * 3;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (G[a] < 0) {
        nx = FU[fa];
        ny = FU[fa + 1];
        nz = FU[fa + 2];
      } else {
        for (const b of cluster) {
          if (G[b] !== G[a]) continue;
          const fb = Math.floor(b / 3) * 3;
          if (FU[fa] * FU[fb] + FU[fa + 1] * FU[fb + 1] + FU[fa + 2] * FU[fb + 2] < CREASE) continue;
          nx += FA[fb];
          ny += FA[fb + 1];
          nz += FA[fb + 2];
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
      }
      N[a * 3] = nx;
      N[a * 3 + 1] = ny;
      N[a * 3 + 2] = nz;
    }
    // Weld corners of the cluster that ended up identical.
    for (let i = 0; i < cluster.length; i++) {
      const a = cluster[i];
      for (let j = 0; j < i; j++) {
        const b = cluster[j];
        if (Math.abs(N[a * 3] - N[b * 3]) + Math.abs(N[a * 3 + 1] - N[b * 3 + 1]) + Math.abs(N[a * 3 + 2] - N[b * 3 + 2]) > 0.004) continue;
        if (UV[a * 2] !== UV[b * 2] || UV[a * 2 + 1] !== UV[b * 2 + 1]) continue;
        if (COL) {
          let same = true;
          for (let k = 0; k < colSize; k++) if (COL[a * colSize + k] !== COL[b * colSize + k]) same = false;
          if (!same) continue;
        }
        id[a] = id[b];
        break;
      }
      if (id[a] < 0) id[a] = verts++;
    }
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = COL ? new Float32Array(verts * colSize) : null;
  const idx = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const v = id[c];
    idx[c] = v;
    pos[v * 3] = P[c * 3];
    pos[v * 3 + 1] = P[c * 3 + 1];
    pos[v * 3 + 2] = P[c * 3 + 2];
    nor[v * 3] = N[c * 3];
    nor[v * 3 + 1] = N[c * 3 + 1];
    nor[v * 3 + 2] = N[c * 3 + 2];
    uv[v * 2] = UV[c * 2];
    uv[v * 2 + 1] = UV[c * 2 + 1];
    if (col && COL) for (let k = 0; k < colSize; k++) col[v * colSize + k] = COL[c * colSize + k];
  }
  return { pos, nor, uv, col, colSize, idx: verts > 65535 ? idx : new Uint16Array(idx), cast };
}

/** Concatenate chunks of one surface. */
function merge(chunks: Chunk[], cast: boolean): Chunk {
  if (chunks.length === 1) return chunks[0].cast === cast ? chunks[0] : { ...chunks[0], cast };
  let verts = 0;
  let indices = 0;
  for (const k of chunks) {
    verts += k.pos.length / 3;
    indices += k.idx.length;
  }
  const colSize = chunks[0].colSize;
  const out: Chunk = { pos: new Float32Array(verts * 3), nor: new Float32Array(verts * 3), uv: new Float32Array(verts * 2), col: colSize ? new Float32Array(verts * colSize) : null, colSize, idx: verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), cast };
  let v = 0;
  let i = 0;
  for (const k of chunks) {
    out.pos.set(k.pos, v * 3);
    out.nor.set(k.nor, v * 3);
    out.uv.set(k.uv, v * 2);
    if (out.col && k.col) out.col.set(k.col, v * colSize);
    for (let j = 0; j < k.idx.length; j++) out.idx[i + j] = k.idx[j] + v;
    v += k.pos.length / 3;
    i += k.idx.length;
  }
  return out;
}

/** A fresh geometry over a chunk (the arrays are shared, not copied: chunks are never mutated). */
function toGeometry(c: Chunk): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
  if (c.col) geo.setAttribute('color', new THREE.BufferAttribute(c.col, c.colSize));
  geo.setIndex(new THREE.BufferAttribute(c.idx, 1));
  return geo;
}

// ───────────────────────────── The kit ─────────────────────────────

interface Batch {
  parts: Part[];
  chunks: Chunk[];
  cast: boolean;
}

export interface PartOptions {
  /** Smooth together with other parts of the same name (default: each part on its own). */
  group?: string;
  /** Never smooth: every triangle faceted. */
  flat?: boolean;
  cast?: boolean;
  uv?: number[];
}

export interface GridOptions extends PartOptions {
  /** A point the surface faces away from (decides the winding). */
  out: V3;
  /** Face towards `out` instead. */
  inward?: boolean;
  /** Also emit the copy mirrored in x. */
  mirror?: boolean;
}

const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Beyond this distance (metres from the camera) a vehicle is drawn from its cheap version. */
export const LOD_RANGE = 60;

const _eye = new THREE.Vector3();
const _spot = new THREE.Vector3();

/**
 * Swaps a vehicle between its detailed and its distant meshes. The renderer calls `update` on anything
 * that says it is a LOD, once per camera, before it looks at the siblings that follow: this is the
 * vehicle group's first child.
 */
export class Detail extends THREE.LOD {
  /** Multiplier on every vehicle's switch distance (the quality setting's `detailRange`: under 1 on a phone). */
  static reach = 1;
  private distant = false;
  constructor(
    readonly near: THREE.Object3D[],
    readonly far: THREE.Object3D[],
    readonly range = LOD_RANGE,
  ) {
    super();
    for (const o of near) o.userData.near = true;
    for (const o of far) {
      o.userData.far = true;
      o.visible = false;
    }
  }

  override update(camera: THREE.Camera): void {
    _eye.setFromMatrixPosition(camera.matrixWorld);
    _spot.setFromMatrixPosition(this.matrixWorld);
    const zoom = (camera as THREE.PerspectiveCamera).zoom || 1;
    // A little slack so a car pacing the boundary does not flicker between its two versions.
    const distant = _eye.distanceTo(_spot) / zoom > this.range * Detail.reach * (this.distant ? 0.94 : 1);
    if (distant === this.distant) return;
    this.distant = distant;
    for (const o of this.near) o.visible = !distant;
    for (const o of this.far) o.visible = distant;
  }
}

/** Too small to matter on the distant version: under 30 cm long, or a sliver. */
const slight = (a: number, b: number, c: number) => {
  const d = [Math.abs(a), Math.abs(b), Math.abs(c)].sort((p, q) => q - p);
  return d[0] < 0.3 || d[0] * d[1] < 0.035;
};

export class Kit {
  readonly group = new THREE.Group();
  /** The one body-paint material of this vehicle (returned as `bodyMaterial`). */
  readonly paint: THREE.MeshStandardMaterial;
  readonly headlights: THREE.MeshStandardMaterial;
  readonly taillights: THREE.MeshStandardMaterial;
  /** Parts queued while this is set are cabin furnishings: they take no road film. */
  inside = false;
  /** Things in `group` that only the detailed version shows (road wheels, a steering assembly). */
  readonly nearOnly: THREE.Object3D[] = [];
  private lib: Shared;
  private roles = new Map<string, THREE.Material>();
  private always = new Set<string>();
  private batches = new Map<Surface, Batch>();
  private groups = new Map<string, number>();
  private nextGroup = 1;

  /**
   * Pass `paint` to build a second group (a steering assembly, the distant version) in the same body
   * colour. A `lo` kit is the distant version: it quietly drops whatever is too small to see from 60 m.
   */
  constructor(
    readonly m: MaterialLibrary,
    readonly color: number,
    paint?: THREE.MeshStandardMaterial,
    readonly lo = false,
    wear: Wear = CLEAN,
    stance: Stance | null = null,
  ) {
    this.lib = sharedFor(m);
    this.paint = paint ?? makePaint(m, color, wear, stance);
    this.headlights = m.emitter(0xfff3cf, 'night');
    this.taillights = m.emitter(0xff2a1a, 'night');
    this.roles.set(PAINT, this.paint);
    this.roles.set(HEAD, this.headlights);
    this.roles.set(TAIL, this.taillights);
  }

  /**
   * Name a per-vehicle material so cached geometry can refer to it (police beacons). `always` surfaces
   * are drawn at every distance from the detailed kit's geometry; the distant kit's copy is dropped.
   */
  role(name: string, material: THREE.Material, always = false) {
    this.roles.set(name, material);
    if (always) this.always.add(name);
  }

  private batch(surface: Surface): Batch {
    const key = surface instanceof Tint ? 'trim' : surface instanceof Glaze ? 'glass' : surface;
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { parts: [], chunks: [], cast: false }));
    return b;
  }

  private groupId(o?: PartOptions): number {
    if (o?.flat) return -1;
    if (!o?.group) return this.nextGroup++;
    let id = this.groups.get(o.group);
    if (!id) this.groups.set(o.group, (id = this.nextGroup++));
    return id;
  }

  /** Queue raw triangles (nine numbers each). */
  tris(surface: Surface, pos: number[], o?: PartOptions): void {
    if (!pos.length) return;
    const b = this.batch(surface);
    if (this.lo && surface instanceof Glaze) surface = FAR_GLAZE.get(surface) ?? surface;
    b.parts.push({ pos, uv: o?.uv ?? null, tint: surface instanceof Tint || surface instanceof Glaze ? surface : null, group: this.groupId(o), inside: this.inside });
    b.cast ||= o?.cast ?? false;
  }

  /** Queue a three.js geometry that is already in model space. */
  geo(surface: Surface, g: THREE.BufferGeometry, o?: PartOptions): void {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    const index = g.index;
    const count = index ? index.count : p.count;
    const pos: number[] = new Array(count * 3);
    const uv: number[] | undefined = u && !(surface instanceof Tint || surface instanceof Glaze) ? new Array(count * 2) : undefined;
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      pos[i * 3] = p.getX(v);
      pos[i * 3 + 1] = p.getY(v);
      pos[i * 3 + 2] = p.getZ(v);
      if (uv) {
        uv[i * 2] = u.getX(v);
        uv[i * 2 + 1] = u.getY(v);
      }
    }
    this.tris(surface, pos, uv ? { ...o, uv } : o);
  }

  /**
   * Surface through a lattice of points: `rows[i][j]`, every row the same length. Zero-area cells are
   * dropped, so rows may pinch together.
   */
  grid(surface: Surface, rows: V3[][], o: GridOptions): void {
    const pos: number[] = [];
    let facing = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < rows[i].length - 1; j++) {
        const a = rows[i][j];
        const b = rows[i][j + 1];
        const c = rows[i + 1][j + 1];
        const d = rows[i + 1][j];
        const n = cross3(sub3(c, a), sub3(d, b));
        facing += n[0] * ((a[0] + c[0]) / 2 - o.out[0]) + n[1] * ((a[1] + c[1]) / 2 - o.out[1]) + n[2] * ((a[2] + c[2]) / 2 - o.out[2]);
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      }
    }
    const flip = facing < 0 !== (o.inward ?? false);
    this.tris(surface, wound(pos, flip, o.mirror ?? false), o);
  }

  /** One flat polygon (fan) facing away from `out`. */
  poly(surface: Surface, points: V3[], out: V3, o?: PartOptions & { mirror?: boolean; inward?: boolean }): void {
    if (this.lo) {
      const lo3 = [Infinity, Infinity, Infinity];
      const hi3 = [-Infinity, -Infinity, -Infinity];
      for (const p of points) for (let i = 0; i < 3; i++) (lo3[i] = Math.min(lo3[i], p[i])), (hi3[i] = Math.max(hi3[i], p[i]));
      if (slight(hi3[0] - lo3[0], hi3[1] - lo3[1], hi3[2] - lo3[2])) return;
    }
    const pos: number[] = [];
    for (let i = 1; i < points.length - 1; i++) pos.push(...points[0], ...points[i], ...points[i + 1]);
    const n = cross3(sub3(points[1], points[0]), sub3(points[points.length - 1], points[0]));
    const flip = dot3(n, sub3(points[0], out)) < 0 !== (o?.inward ?? false);
    this.tris(surface, wound(pos, flip, o?.mirror ?? false), { flat: true, ...o });
  }

  /** Axis-aligned (or rotated) box centred on x, y, z. */
  box(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3, cast = false): void {
    if (this.lo && slight(w, h, d)) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rot) geo.applyMatrix4(_m.makeRotationFromEuler(_e.set(rot[0], rot[1], rot[2])));
    this.geo(surface, geo.translate(x, y, z), { flat: true, cast });
  }

  /** The same box on both sides of the vehicle (x and −x). */
  boxes(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3, cast = false): void {
    this.box(surface, w, h, d, x, y, z, rot, cast);
    this.box(surface, w, h, d, -x, y, z, rot ? [rot[0], -rot[1], -rot[2]] : undefined, cast);
  }

  /** Box with softened edges (`r`), smooth-shaded so it reads as a moulding or a cushion. */
  pad(surface: Surface, w: number, h: number, d: number, x: number, y: number, z: number, r: number, rot?: V3, cast = false): void {
    if (this.lo) return this.box(surface, w, h, d, x, y, z, rot, cast);
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const rr = Math.min(r, hx, hy, hz) * 0.999;
    const pos: number[] = [];
    // Each face is a quad inset by r; edges and corners close the gaps.
    const P = (sx: number, sy: number, sz: number, ax: number): V3 => [sx * (hx - (ax === 0 ? 0 : rr)), sy * (hy - (ax === 1 ? 0 : rr)), sz * (hz - (ax === 2 ? 0 : rr))];
    const quad = (a: V3, b: V3, c: V3, d2: V3) => {
      const n = cross3(sub3(c, a), sub3(d2, b));
      const out = dot3(n, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]) >= 0;
      if (out) pos.push(...a, ...b, ...c, ...a, ...c, ...d2);
      else pos.push(...a, ...c, ...b, ...a, ...d2, ...c);
    };
    for (const s of [1, -1]) {
      quad(P(s, -1, -1, 0), P(s, 1, -1, 0), P(s, 1, 1, 0), P(s, -1, 1, 0));
      quad(P(-1, s, -1, 1), P(1, s, -1, 1), P(1, s, 1, 1), P(-1, s, 1, 1));
      quad(P(-1, -1, s, 2), P(1, -1, s, 2), P(1, 1, s, 2), P(-1, 1, s, 2));
      for (const t of [1, -1]) {
        quad(P(s, t, -1, 0), P(s, t, 1, 0), P(s, t, 1, 1), P(s, t, -1, 1));
        quad(P(s, -1, t, 0), P(s, 1, t, 0), P(s, 1, t, 2), P(s, -1, t, 2));
        quad(P(-1, s, t, 1), P(1, s, t, 1), P(1, s, t, 2), P(-1, s, t, 2));
        for (const u of [1, -1]) {
          const a = P(s, t, u, 0);
          const b = P(s, t, u, 1);
          const c = P(s, t, u, 2);
          const n = cross3(sub3(b, a), sub3(c, a));
          if (dot3(n, a) >= 0) pos.push(...a, ...b, ...c);
          else pos.push(...a, ...c, ...b);
        }
      }
    }
    if (rot) _m.makeRotationFromEuler(_e.set(rot[0], rot[1], rot[2]));
    for (let i = 0; i < pos.length; i += 3) {
      if (rot) {
        _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(_m);
        pos[i] = _v.x;
        pos[i + 1] = _v.y;
        pos[i + 2] = _v.z;
      }
      pos[i] += x;
      pos[i + 1] += y;
      pos[i + 2] += z;
    }
    this.tris(surface, pos, { cast });
  }

  private span(geo: THREE.BufferGeometry, a: V3, b: V3): THREE.BufferGeometry {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    geo.applyQuaternion(_q.setFromUnitVectors(_up, _v));
    return geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }

  /** Rectangular bar from a to b. */
  beam(surface: Surface, a: V3, b: V3, w: number, d: number, cast = false): void {
    if (this.lo && slight(len3(sub3(b, a)), w, d)) return;
    this.geo(surface, this.span(new THREE.BoxGeometry(w, len3(sub3(b, a)), d), a, b), { flat: true, cast });
  }

  /** Round tube from a to b (`radiusB` at b for a taper). */
  tube(surface: Surface, a: V3, b: V3, radius: number, segments = 6, cast = false, radiusB = radius, open = false): void {
    if (this.lo) {
      if (slight(len3(sub3(b, a)), radius * 2, radius * 2)) return;
      segments = Math.min(segments, 5);
    }
    this.geo(surface, this.span(new THREE.CylinderGeometry(radiusB, radius, len3(sub3(b, a)), segments, 1, open), a, b), { cast });
  }

  /** Tube through several points, mitred at the bends. */
  pipe(surface: Surface, points: V3[], radius: number, segments = 6, cast = false): void {
    for (let i = 0; i < points.length - 1; i++) this.tube(surface, points[i], points[i + 1], radius, segments, cast, radius, true);
    if (this.lo) return;
    for (let i = 1; i < points.length - 1; i++) this.geo(surface, new THREE.SphereGeometry(radius, segments, 3).translate(points[i][0], points[i][1], points[i][2]), {});
  }

  /** Cylinder with its axis along x, y or z. */
  drum(surface: Surface, radius: number, length: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', segments = 10, cast = false): void {
    if (this.lo) {
      if (slight(length, radius * 2, radius * 2)) return;
      segments = Math.min(segments, 8);
    }
    const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    else if (axis === 'z') geo.rotateX(Math.PI / 2);
    this.geo(surface, geo.translate(x, y, z), { cast });
  }

  /** Ball (a helmet, a lamp bowl): `sy` and `sz` squash it. */
  ball(surface: Surface, radius: number, x: number, y: number, z: number, sy = 1, sz = 1, segments = 8): void {
    if (this.lo) {
      if (slight(radius * 2, radius * 2 * sy, radius * 2 * sz)) return;
      segments = 6;
    }
    this.geo(surface, new THREE.SphereGeometry(radius, segments, Math.max(4, Math.round(segments * 0.6))).scale(1, sy, sz).translate(x, y, z), {});
  }

  /**
   * Section swept along a path. `frames[i]` is [origin, side, up]: the section's [a, b] points land at
   * origin + side·a + up·b. An open section is a strip; `closed` joins its ends.
   */
  sweep(surface: Surface, frames: [V3, V3, V3][], section: Pt[], o: GridOptions & { closed?: boolean; caps?: 'start' | 'both' }): void {
    if (this.lo && section.length > 4) {
      // Keep the ends and every other point between: the silhouette survives, the facets do not matter.
      section = section.filter((_, i) => i === 0 || i === section.length - 1 || i % 2 === 0);
      let across = 0;
      for (const [a, b] of section) across = Math.max(across, Math.abs(a), Math.abs(b));
      if (across < 0.05) return;
    }
    const rows = frames.map(([p, s, u]) => {
      const row = section.map(([a, b]): V3 => [p[0] + s[0] * a + u[0] * b, p[1] + s[1] * a + u[1] * b, p[2] + s[2] * a + u[2] * b]);
      if (o.closed) row.push(row[0]);
      return row;
    });
    this.grid(surface, rows, o);
    if (o.caps) {
      const ends = [[rows[0], rows[1]]];
      if (o.caps === 'both') ends.push([rows[rows.length - 1], rows[rows.length - 2]]);
      for (const [row, other] of ends) {
        this.poly(surface, o.closed ? row.slice(0, -1) : row, other[0], { mirror: o.mirror, cast: o.cast });
      }
    }
  }

  /**
   * Thin ribbon lying on a surface: through `points`, `width` wide across `across` (a direction, or one
   * per point), centred on the points.
   */
  ribbon(surface: Surface, points: V3[], across: V3 | V3[], width: number, out: V3, mirror = false): void {
    if (this.lo) return;
    const rows = points.map((p, i) => {
      const w = (Array.isArray(across[0]) ? (across as V3[])[i] : (across as V3)) as V3;
      return [add3(p, w, -width / 2), add3(p, w, width / 2)];
    });
    this.grid(surface, rows, { out, mirror, flat: true });
  }

  /** Flat board carrying a `materials.sign` texture. `yaw` 0 faces +z, π/2 faces +x (the left flank). */
  board(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    // Each sign is a draw call of its own: from a distance only the big ones are worth one.
    if (this.lo && w * h < 0.4) return;
    const geo = new THREE.PlaneGeometry(w, h);
    if (pitch) geo.rotateX(pitch);
    if (yaw) geo.rotateY(yaw);
    this.geo(mat, geo.translate(x, y, z), { flat: true });
  }

  /** Front and rear number plates (one shared sign material per registration). A NaN `frontZ` skips the front. */
  plates(frontZ: number, frontY: number, rearZ: number, rearY: number, era: 'old' | 'new' | 'any' = 'any', scale = 1, tilt = 0): void {
    if (this.lo) return;
    const old = era === 'old' || (era === 'any' && dice.chance(0.35));
    // Plates issued before 1987 are black with silver characters; later ones white with black.
    const text = dice.pick(old ? OLD_PLATES : NEW_PLATES);
    const mat = this.m.sign(text, old ? { bg: '#0d0d0d', fg: '#d6d6cf', style: 'block', aspect: 3.1 } : { bg: '#f3f2ea', fg: '#111111', style: 'block', aspect: 3.1 });
    if (Number.isFinite(frontZ)) this.board(mat, 0.36 * scale, 0.116 * scale, 0, frontY, frontZ);
    this.board(mat, 0.36 * scale, 0.116 * scale, 0, rearY, rearZ, Math.PI, tilt);
    // One vehicle in six wears a sticker beside the rear plate (not the bike: nowhere to put it).
    if (scale >= 1 && dice.chance(0.17)) {
      const s = dice.pick(STICKERS);
      const m = this.m.sign(s.text, { bg: s.bg, fg: s.fg, style: 'block', aspect: 3.4, border: false });
      this.board(m, 0.21 * scale, 0.062 * scale, -0.31 * scale, rearY + 0.01, rearZ, Math.PI, tilt);
    }
  }

  /**
   * Geometry that is the same for every vehicle built with `key`: `build` runs once per material library
   * and its baked result is replayed afterwards. `build` must only draw on the kit it is given.
   */
  cached(key: string, build: (k: Kit) => void): void {
    if (this.lo) key += '|lo';
    let baked = this.lib.baked.get(key);
    if (!baked) {
      const sub = new Kit(this.m, 0, this.paint, this.lo);
      build(sub);
      baked = sub.bakeAll();
      this.lib.baked.set(key, baked);
    }
    for (const [surface, chunk] of baked) {
      const b = this.batch(surface);
      b.chunks.push(chunk);
      b.cast ||= chunk.cast;
    }
  }

  private bakeAll(): Map<Surface, Chunk> {
    const out = new Map<Surface, Chunk>();
    for (const [surface, b] of this.batches) {
      const chunks = [...b.chunks];
      if (b.parts.length) chunks.push(bake(b.parts, surface === 'trim' ? 3 : surface === 'glass' ? 4 : 0, b.cast));
      if (chunks.length) out.set(surface, merge(chunks, b.cast));
    }
    this.batches.clear();
    return out;
  }

  /** One mesh for a cached piece on its own (a road wheel): shown by the detailed version only. */
  mesh(key: string, build: (k: Kit) => void, cast = true): THREE.Mesh {
    let baked = this.lib.baked.get(key);
    if (!baked) {
      const sub = new Kit(this.m, 0, this.paint);
      build(sub);
      baked = sub.bakeAll();
      this.lib.baked.set(key, baked);
    }
    const chunk = baked.get('trim')!;
    const mesh = new THREE.Mesh(toGeometry(chunk), this.lib.wheel);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.nearOnly.push(mesh);
    return mesh;
  }

  private meshes(): [Surface, THREE.Mesh][] {
    const out: [Surface, THREE.Mesh][] = [];
    for (const [surface, chunk] of this.bakeAll()) {
      const material = surface === 'trim' ? this.lib.trim : surface === 'glass' ? this.lib.glass : typeof surface === 'string' ? this.roles.get(surface) : (surface as THREE.Material);
      if (!material) throw new Error(`No material for surface "${String(surface)}"`);
      const mesh = new THREE.Mesh(toGeometry(chunk), material);
      mesh.castShadow = surface === PAINT || (surface !== 'glass' && chunk.cast);
      mesh.receiveShadow = surface !== 'glass';
      // Glass draws after anything else see-through nearby (rain, smoke stay behind the pane they are behind).
      if (surface === 'glass') mesh.renderOrder = 2;
      out.push([surface, mesh]);
    }
    return out;
  }

  /**
   * Merge every queued piece into one mesh per surface. Call once, last. Given the distant kit of the
   * same vehicle, its meshes join the group too and a `Detail` switches between the two sets.
   */
  finish(far?: Kit): THREE.Group {
    const near: THREE.Object3D[] = [...this.nearOnly];
    for (const [surface, mesh] of this.meshes()) {
      this.group.add(mesh);
      if (!(typeof surface === 'string' && this.always.has(surface))) near.push(mesh);
    }
    if (far) {
      const distant: THREE.Object3D[] = [];
      for (const [surface, mesh] of far.meshes()) {
        // What the detailed kit draws at every distance (beacons) is not drawn twice.
        if (typeof surface === 'string' && this.always.has(surface)) continue;
        this.group.add(mesh);
        distant.push(mesh);
      }
      const detail = new Detail(near, distant);
      this.group.add(detail);
      // First in line, so it has switched the versions before the renderer reaches them.
      this.group.children.unshift(this.group.children.pop()!);
    }
    return this.group;
  }

  // ── Timber (the `timber` library surface: a 1.6 m tile of eight planks, grain along v) ──

  /** Timber board: its own plank shade, grain along its length. */
  plank(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): void {
    this.geo(mat, timberGeometry(w, h, d, dice.int(0, 7)).translate(x, y, z), { flat: true, cast: true });
  }

  /** Planked timber slab (a truck deck): the texture runs in metres across it. */
  slab(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): void {
    this.geo(mat, timberGeometry(w, h, d, -1).translate(x, y, z), { flat: true, cast: true });
  }

  /** Timber board from a to b (a diagonal brace). */
  brace(mat: THREE.Material, a: V3, b: V3, w: number, d: number): void {
    this.geo(mat, this.span(timberGeometry(w, len3(sub3(b, a)), d, dice.int(0, 7)), a, b), { flat: true, cast: true });
  }
}

/** Apply winding (and the x-mirror) to a triangle soup, dropping triangles with no area. */
function wound(p: number[], flip: boolean, mirror: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i];
    const uy = p[i + 4] - p[i + 1];
    const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i];
    const vy = p[i + 7] - p[i + 1];
    const vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) continue;
    if (flip) out.push(p[i], p[i + 1], p[i + 2], p[i + 6], p[i + 7], p[i + 8], p[i + 3], p[i + 4], p[i + 5]);
    else out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]);
    if (mirror) {
      if (flip) out.push(-p[i], p[i + 1], p[i + 2], -p[i + 3], p[i + 4], p[i + 5], -p[i + 6], p[i + 7], p[i + 8]);
      else out.push(-p[i], p[i + 1], p[i + 2], -p[i + 6], p[i + 7], p[i + 8], -p[i + 3], p[i + 4], p[i + 5]);
    }
  }
  return out;
}

function timberGeometry(w: number, h: number, d: number, tone: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const size = [w, h, d];
  const long = w >= h && w >= d ? 0 : h >= d ? 1 : 2;
  const p = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const u0 = (tone % 8) * 0.2 + 0.1;
  for (let i = 0; i < p.count; i++) {
    const pos = [p.getX(i), p.getY(i), p.getZ(i)];
    const facing = Math.abs(nrm.getX(i)) > 0.5 ? 0 : Math.abs(nrm.getY(i)) > 0.5 ? 1 : 2;
    const across = facing === long ? (long + 1) % 3 : 3 - long - facing;
    const along = facing === long ? (long + 2) % 3 : long;
    if (tone < 0) uv.setXY(i, pos[across], pos[along]);
    else uv.setXY(i, u0 + (pos[across] / (size[across] || 1)) * 0.14, pos[along] + tone * 0.37);
  }
  return geo;
}

// Invented registrations in the two-letters-four-digits format of the day, plus one personalised plate doing the rounds.
const OLD_PLATES = ['JK4127', 'KD9306', 'LW5571', 'MB2084', 'MX7719', 'LE3662'];
const NEW_PLATES = ['NA1047', 'NT8825', 'PF3390', 'PY6102', 'RH4476', 'SB7251', 'SU2938', 'TD5814', 'QUEST'];

// Rear-window and bumper stickers: the game's own motorway-sign mark, and the stations that give them away.
const STICKERS = [
  { text: '03 QUEST', bg: '#0f6b47', fg: '#ffffff' },
  { text: 'SHINGLE FM 93.4', bg: '#b3261e', fg: '#fff6e0' },
  { text: 'PARTYLINE 1017 AM', bg: '#1d2a44', fg: '#f0c33a' },
] as const;

// ───────────────────────────── Wheels ─────────────────────────────

/**
 * hubcap: steel wheel under a full pressed cover with radial flutes · cap: the plainer full cover with a
 * ring of slots · steel: painted steel wheel, vents, small bright centre cap, nuts showing · dish: painted
 * steel with a chrome dog-dish cap and a bright trim ring · alloy: five broad spokes · mesh: a lattice of
 * fine spokes · truck: deep steel rim with a proud hub and a ring of nuts (front axle of trucks and
 * buses) · dual: dished outer wheel of a twin pair, with the inboard tyre behind it.
 */
export type WheelStyle = 'hubcap' | 'cap' | 'steel' | 'dish' | 'alloy' | 'mesh' | 'truck' | 'dual';

const TYRE = tint(0x141414, 'rubber');
const TREAD = tint(0x2b2b29, 'tread');
const WALL = tint(0x1a1a1a, 'wall');
const WELL = tint(0x08080a, 'matte');
const FINS = tint(0xf0f0f0, 'fins');

interface LatheOptions extends PartOptions {
  /** Lay the surface's pattern on: this many tiles round the circle, `span` across the profile. */
  tiles?: number;
  span?: [number, number];
}

/**
 * Surface of revolution about the x axis from [radius, x] points; `side` flips x so the dressed face
 * points outwards. List the profile so that, drawn with x to the right and radius up, the outside of the
 * solid is on the left of the direction of travel.
 */
function lathe(k: Kit, surface: Surface, points: Pt[], segments: number, side: number, o?: LatheOptions): void {
  const patterned = o?.tiles !== undefined && surface instanceof Tint;
  // Distance along the profile, for the pattern's second coordinate.
  const run: number[] = [0];
  for (let j = 1; j < points.length; j++) run.push(run[j - 1] + Math.hypot(points[j][0] - points[j - 1][0], points[j][1] - points[j - 1][1]));
  const total = run[run.length - 1] || 1;
  const [t0, t1] = o?.span ?? [0, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  const flip = side > 0;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    for (let j = 0; j < points.length - 1; j++) {
      const P = (a: number, i: number): V3 => [side * points[i][1], points[i][0] * Math.cos(a), points[i][0] * Math.sin(a)];
      const U = (sn: number, i: number): [number, number] => (surface as Tint).at((sn / segments) * (o?.tiles ?? 1), t0 + ((t1 - t0) * run[i]) / total);
      const quad: [V3, [number, number] | null][] = [
        [P(a0, j), patterned ? U(s, j) : null],
        [P(a0, j + 1), patterned ? U(s, j + 1) : null],
        [P(a1, j + 1), patterned ? U(s + 1, j + 1) : null],
        [P(a1, j), patterned ? U(s + 1, j) : null],
      ];
      for (const tri of flip ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]]) {
        const [a, b, c] = tri.map((i) => quad[i]);
        // A profile that touches the axis makes slivers of no area there.
        if (len3(cross3(sub3(b[0], a[0]), sub3(c[0], a[0]))) < 1e-9) continue;
        pos.push(...a[0], ...b[0], ...c[0]);
        if (patterned) uv.push(...a[1]!, ...b[1]!, ...c[1]!);
      }
    }
  }
  k.tris(surface, pos, patterned ? { ...o, uv } : o);
}

/** Small flat disc (a vent hole, a wheel nut) on a wheel face at radius `at`, angle `a`. */
function spot(k: Kit, surface: Surface, side: number, x: number, at: number, a: number, r: number, sides = 6): void {
  const pos: number[] = [];
  const cy = at * Math.cos(a);
  const cz = at * Math.sin(a);
  for (let i = 0; i < sides; i++) {
    const t0 = (i / sides) * Math.PI * 2;
    const t1 = ((i + 1) / sides) * Math.PI * 2;
    pos.push(side * x, cy, cz, side * x, cy + r * Math.cos(t0), cz + r * Math.sin(t0), side * x, cy + r * Math.cos(t1), cz + r * Math.sin(t1));
  }
  k.tris(surface, wound(pos, side < 0, false), { flat: true });
}

/** A wheel nut: a short hexagonal stud standing on the wheel face. */
function nut(k: Kit, side: number, x: number, at: number, a: number, r = 0.011, proud = 0.012): void {
  const g = new THREE.CylinderGeometry(r * 0.8, r, proud, 6).rotateZ(Math.PI / 2).translate(side * (x + proud / 2), at * Math.cos(a), at * Math.sin(a));
  k.geo(BRIGHT, g, { flat: true });
}

function buildWheel(k: Kit, R: number, width: number, side: number, style: WheelStyle, rim: number, twinGap: number) {
  const w = width / 2;
  // The tyre's outline is what gives a wheel away as a polygon, so it gets the most segments.
  const round = 28;
  const seg = 18;
  const sh = Math.min(0.05, width * 0.24);
  const heavy = style === 'truck' || style === 'dual';
  const rr = R * (style === 'alloy' || style === 'mesh' ? 0.67 : heavy ? 0.58 : 0.62);
  const tiles = Math.max(4, Math.round((2 * Math.PI * R) / 0.3));
  const tyre = (off: number, back: boolean) => {
    const g = { group: 'tyre' + off };
    // Inner sidewall (plain), patterned tread, rounded outer shoulder, sidewall with a bulge and a rim
    // protector, bead.
    lathe(k, TYRE, [[rr - 0.01, off - w + 0.012], [R - sh, off - w], [R, off - w + sh]], round, side, g);
    lathe(k, TREAD, [[R, off - w + sh], [R + 0.003, off], [R, off + w - sh]], round, side, { ...g, tiles });
    lathe(k, WALL, [[R, off + w - sh], [R - sh * 0.32, off + w - sh * 0.28], [R - sh, off + w], [(R + rr) / 2, off + w + 0.007], [rr + 0.02, off + w + 0.004], [rr, off + w - 0.012]], round, side, { ...g, tiles: 2, span: [1, 0] });
    if (back) lathe(k, WELL, [[0, off - w + 0.03], [rr - 0.01, off - w + 0.012]], 12, side, { flat: true });
  };
  tyre(0, true);
  if (style === 'dual') tyre(-twinGap, false);
  const paint = tint(rim, 'satin');
  const face = w - 0.012;
  const ring = (i: number, n: number) => (i / n) * Math.PI * 2;
  if (style === 'hubcap') {
    // Pressed full cover: bright lip, a broad band of radial flutes, a stepped centre with a boss.
    lathe(k, CHROME, [[rr, face], [rr * 0.97, w + 0.004], [rr * 0.92, w + 0.01]], seg, side, { group: 'cover' });
    lathe(k, FINS, [[rr * 0.92, w + 0.01], [rr * 0.58, w + 0.022]], seg, side, { group: 'cover', tiles: 3 });
    lathe(k, CHROME, [[rr * 0.58, w + 0.022], [rr * 0.54, w + 0.012], [rr * 0.4, w + 0.014], [rr * 0.34, w + 0.03], [rr * 0.16, w + 0.04], [0, w + 0.042]], seg, side, { group: 'cover' });
    lathe(k, tint(0x1b1d22, 'gloss'), [[rr * 0.16, w + 0.0405], [0, w + 0.0425]], 10, side, { flat: true });
  } else if (style === 'cap') {
    // Plainer full cover: stepped chrome dish with a ring of dark slots.
    lathe(k, CHROME, [[rr, face], [rr * 0.94, w + 0.004], [rr * 0.66, w + 0.014], [rr * 0.34, w + 0.016], [rr * 0.22, w + 0.032], [0, w + 0.036]], seg, side);
    for (let i = 0; i < 12; i++) {
      const a = ring(i, 12);
      const c = Math.cos(a);
      const n = Math.sin(a);
      const x = side * (w + 0.0105);
      const at = (r: number, t: number): number[] => [x, r * c - t * n, r * n + t * c];
      const h = rr * 0.035;
      k.tris(DARK, wound([...at(rr * 0.74, -h), ...at(rr * 0.88, -h), ...at(rr * 0.88, h), ...at(rr * 0.74, -h), ...at(rr * 0.88, h), ...at(rr * 0.74, h)], side < 0, false), { flat: true });
    }
  } else if (style === 'steel' || style === 'dish') {
    // Painted wheel: rolled rim, dished centre with round vents.
    lathe(k, paint, [[rr, face], [rr * 0.95, face + 0.006], [rr * 0.9, face - 0.016], [rr * 0.82, face - 0.03], [rr * 0.52, face - 0.008], [rr * 0.4, face + 0.01]], seg, side);
    for (let i = 0; i < 8; i++) spot(k, DARK, side, face - 0.0165, rr * 0.68, ring(i + 0.5, 8), rr * 0.08, 8);
    if (style === 'dish') {
      // Bright trim ring on the rim and a domed chrome cap over the nuts.
      lathe(k, BRIGHT, [[rr * 0.985, face + 0.003], [rr * 0.95, face + 0.009], [rr * 0.9, face - 0.012]], seg, side);
      lathe(k, CHROME, [[rr * 0.5, face - 0.006], [rr * 0.47, face + 0.02], [rr * 0.3, face + 0.04], [0, face + 0.046]], seg, side);
    } else {
      lathe(k, paint, [[rr * 0.4, face + 0.01], [rr * 0.24, face + 0.012]], 12, side, { flat: true });
      for (let i = 0; i < 4; i++) nut(k, side, face + 0.011, rr * 0.33, ring(i + 0.5, 4));
      lathe(k, CHROME, [[rr * 0.24, face + 0.012], [rr * 0.2, face + 0.034], [0, face + 0.038]], 12, side);
    }
  } else if (style === 'alloy' || style === 'mesh') {
    // Machined lip, dark barrel, brake disc, spokes and a centre cap.
    const recess = Math.min(0.075, width * 0.32);
    lathe(k, BRIGHT, [[rr, face], [rr * 0.96, face + 0.006], [rr * 0.9, face - 0.012]], seg, side);
    lathe(k, tint(0x3a3c3f, 'alloy'), [[rr * 0.9, face - 0.012], [rr * 0.87, face - recess]], seg, side, { flat: true });
    lathe(k, WELL, [[rr * 0.87, face - recess], [0, face - recess]], 12, side, { flat: true });
    lathe(k, STEEL, [[rr * 0.66, face - recess + 0.014], [rr * 0.24, face - recess + 0.014]], 14, side, { flat: true });
    k.box(tint(0x7a1512, 'satin'), 0.03, rr * 0.34, rr * 0.2, side * (face - recess + 0.03), rr * 0.5, 0);
    if (style === 'alloy') {
      // Five broad spokes, dished: deep at the hub, shallow at the rim, narrower towards it.
      for (let i = 0; i < 5; i++) {
        const g = new THREE.BoxGeometry(0.022, rr * 0.76, rr * 0.31, 1, 2, 1);
        const p = g.getAttribute('position');
        for (let v = 0; v < p.count; v++) {
          const t = p.getY(v) / (rr * 0.76) + 0.5;
          p.setZ(v, p.getZ(v) * (1 - 0.42 * t));
          p.setX(v, p.getX(v) + 0.022 * t * t);
        }
        k.geo(ALLOY, g.translate(side * (face - 0.03), rr * 0.54, 0).rotateX(ring(i, 5)), { group: 'spoke' + i });
      }
      for (let i = 0; i < 5; i++) spot(k, DARK, side, face - 0.008, rr * 0.3, ring(i + 0.5, 5), rr * 0.035, 6);
      lathe(k, ALLOY, [[rr * 0.38, face - 0.03], [rr * 0.34, face - 0.008], [rr * 0.2, face - 0.006]], 10, side);
      lathe(k, BRIGHT, [[rr * 0.2, face - 0.006], [rr * 0.17, face + 0.008], [0, face + 0.01]], 10, side);
    } else {
      // Lattice: fine spokes leaning alternately left and right, crossing on their way to the rim.
      const hubX = face - 0.02;
      const rimX = face - 0.006;
      for (let i = 0; i < 16; i++) {
        const a = ring(i, 16);
        const b = a + (i % 2 ? 0.34 : -0.34);
        k.beam(ALLOY, [side * hubX, rr * 0.2 * Math.cos(a), rr * 0.2 * Math.sin(a)], [side * rimX, rr * 0.9 * Math.cos(b), rr * 0.9 * Math.sin(b)], 0.014, 0.011);
      }
      lathe(k, ALLOY, [[rr * 0.26, face - 0.03], [rr * 0.22, face - 0.004], [rr * 0.14, face]], 10, side);
      lathe(k, BRIGHT, [[rr * 0.14, face], [rr * 0.1, face + 0.012], [0, face + 0.014]], 8, side);
    }
  } else {
    // Truck steel: `truck` stands proud at the hub, `dual` is dished deep with the hub recessed.
    const deep = style === 'dual' ? Math.min(0.16, width * 0.6) : 0.05;
    const hub = style === 'dual' ? face - deep + 0.05 : w + 0.06;
    lathe(k, paint, [[rr, face], [rr * 0.95, face + 0.006], [rr * 0.9, face - 0.015], [rr * 0.8, face - deep], [rr * 0.46, face - deep], [rr * 0.34, hub], [0, hub + 0.004]], seg, side);
    for (let i = 0; i < 8; i++) nut(k, side, face - deep, rr * 0.6, ring(i, 8), 0.016, 0.02);
    lathe(k, tint(0x2a2b2d, 'satin'), [[rr * 0.2, hub + 0.002], [rr * 0.16, hub + 0.02], [0, hub + 0.022]], 8, side);
  }
}

/** One road wheel: a pivot (positioned and spun by the vehicle system) holding a single mesh. */
export function makeRoadWheel(k: Kit, radius: number, width: number, side: 1 | -1, style: WheelStyle, rim = 0xc9ccce, twinGap = 0): THREE.Group {
  const pivot = new THREE.Group();
  const mesh = k.mesh(`wheel|${radius}|${width}|${side}|${style}|${rim}|${twinGap}`, (w) => buildWheel(w, radius, width, side, style, rim, twinGap));
  pivot.add(mesh);
  return pivot;
}

/** A wheel for the distant version: a ten-sided tyre and a flat disc, standing still at rest height. */
function farWheel(k: Kit, x: number, z: number, R: number, width: number, style: WheelStyle, rim: number): void {
  const side = x > 0 ? 1 : -1;
  const heavy = style === 'truck' || style === 'dual';
  const rr = R * (heavy ? 0.58 : 0.63);
  const w = width / 2;
  const inner = style === 'dual' ? -w - width - 0.03 : -w;
  const pos: number[] = [];
  const n = 10;
  const face = style === 'hubcap' || style === 'cap' ? CHROME : style === 'alloy' || style === 'mesh' ? ALLOY : tint(rim, 'satin');
  const P = (i: number, r: number, off: number): V3 => [x + side * off, R + r * Math.cos((i / n) * Math.PI * 2), z + r * Math.sin((i / n) * Math.PI * 2)];
  const quads: [Surface, V3, V3, V3, V3][] = [];
  for (let i = 0; i < n; i++) {
    quads.push([TYRE, P(i, R, inner), P(i, R, w), P(i + 1, R, w), P(i + 1, R, inner)]);
    quads.push([TYRE, P(i, R, w), P(i, rr, w), P(i + 1, rr, w), P(i + 1, R, w)]);
    quads.push([face, P(i, rr, w - 0.01), P(i, 0, w - 0.01), P(i + 1, 0, w - 0.01), P(i + 1, rr, w - 0.01)]);
  }
  for (const surface of [TYRE, face]) {
    pos.length = 0;
    for (const [s, a, b, c, d] of quads) if (s === surface) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    k.tris(surface, wound(pos, side > 0, false), { cast: true });
  }
}

/**
 * Wheel pivots in physics order (FL, FR, RL, RR, then any extra rear pair), added to the kit's group at
 * rest height. `twin` gives the rear axle a second, inboard tyre: it is modelled into the outer wheel's
 * mesh and the extra pivots the physics expects are left empty. Given the distant kit as well, that gets
 * four plain wheels standing still: nobody can tell from 60 m, and it is four draw calls fewer.
 */
export function mountWheels(
  k: Kit,
  o: { radius: number; width: number; wheelbase: number; track: number; rearTrack?: number; front: WheelStyle; rear?: WheelStyle; rim?: number; twin?: boolean },
  far?: Kit,
): THREE.Object3D[] {
  const wheels: THREE.Object3D[] = [];
  const put = (x: number, z: number, style: WheelStyle | null) => {
    const wheel = style ? makeRoadWheel(k, o.radius, o.width, x > 0 ? 1 : -1, style, o.rim, o.width + 0.03) : new THREE.Group();
    wheel.position.set(x, o.radius, z);
    k.group.add(wheel);
    wheels.push(wheel);
  };
  const front = o.track / 2;
  const rear = (o.rearTrack ?? o.track) / 2;
  put(front, o.wheelbase / 2, o.front);
  put(-front, o.wheelbase / 2, o.front);
  put(rear, -o.wheelbase / 2, o.rear ?? o.front);
  put(-rear, -o.wheelbase / 2, o.rear ?? o.front);
  if (o.twin) {
    put(rear - o.width - 0.03, -o.wheelbase / 2, null);
    put(-(rear - o.width - 0.03), -o.wheelbase / 2, null);
  }
  far?.cached(`wheels|${o.radius}|${o.width}|${o.wheelbase}|${o.track}|${o.rearTrack}|${o.front}|${o.rear}|${o.rim}`, (c) => {
    for (const s of [1, -1]) {
      farWheel(c, s * front, o.wheelbase / 2, o.radius, o.width, o.front, o.rim ?? 0xc9ccce);
      farWheel(c, s * rear, -o.wheelbase / 2, o.radius, o.width, o.rear ?? o.front, o.rim ?? 0xc9ccce);
    }
  });
  return wheels;
}
