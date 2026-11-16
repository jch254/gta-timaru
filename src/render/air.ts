import * as THREE from 'three';
import * as csmShader from 'three/addons/csm/CSMShader.js';

// The typings declare only an interface here; the module exports the object.
const CSMShader = (csmShader as unknown as { CSMShader: { lights_fragment_begin: string; lights_pars_begin: string } }).CSMShader;

/**
 * The air between the camera and the world: distance haze that is thicker low down and takes its colour
 * from the sky and the sun, and the shadows of the clouds drifting over the ground.
 *
 * Both are done once, for every material in the library, by replacing three's fog and light shader chunks
 * (the cascaded-shadow addon replaces the same light chunks, so this builds on its version). A material
 * takes part when it carries the `USE_AIR` define, which the library sets on everything registered with it;
 * anything else (effect sprites, tracers) compiles three's stock fog exactly as before.
 */

/** Metres of ground per unit of cloud-field coordinate, and how many units one tile of the noise covers. */
export const CLOUD_SCALE = 1200;
export const CLOUD_TILE = 5;
/** Height of the cloud base above the plains, for slanting the shadows towards the sun. */
export const CLOUD_BASE = 1500;

/**
 * Uniforms shared by every library material. One object each, so setting `.value` once a frame reaches all
 * of them. Other lanes' shader patches may read any of these simply by declaring the uniform: the library
 * has already put them on the shader by the time a `registerPatched` patch runs.
 */
export const AIR = {
  /** Unit vector towards the sun by day, the moon by night (world space). */
  uSunDirection: { value: new THREE.Vector3(0.4, 0.8, -0.4).normalize() },
  /** Colour times intensity of that light, before shadows. */
  uSunLight: { value: new THREE.Color(1, 1, 1) },
  /** 0 full day .. 1 dead of night. */
  uNightness: { value: 0 },
  /** Road wetness 0..1 (lags the rain) and rain intensity 0..1. */
  uWetness: { value: 0 },
  uRainfall: { value: 0 },
  /** Seconds since the game started, wrapped every hour, for anything that animates. */
  uWorldTime: { value: 0 },
  /** The sky at the horizon and overhead (linear HDR): what a wet road or a window should mirror. */
  uSkyHorizon: { value: new THREE.Color(0.5, 0.65, 0.9) },
  uSkyZenith: { value: new THREE.Color(0.05, 0.16, 0.5) },

  /** Extra haze colour looking towards the sun. */
  uAirGlow: { value: new THREE.Color(0, 0, 0) },
  /** Ground haze: x density at the base height (1/m), y falloff with height (1/m), z base height (m), w extra haze on backdrops 0..1. */
  uAirLayer: { value: new THREE.Vector4(1 / 9000, 1 / 140, 0, 0) },
  /** Cloud field: xy offset, z scale from world metres to texture coordinates, w coverage threshold. */
  uCloudField: { value: new THREE.Vector4(0, 0, 1 / (CLOUD_SCALE * CLOUD_TILE), 0.7) },
  /** x how much of the sun a cloud takes away (0 = no cloud shadows), y softness of the shadow edge. */
  uCloudShade: { value: new THREE.Vector2(0, 0.12) },
  uCloudMap: { value: null as THREE.Texture | null },
};

const stock = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment,
};

/** GLSL: the haze between the camera and this fragment. Sets `airFactor` (0..1) and `airColor`. */
export const AIR_HAZE = /* glsl */ `
	float airDist = length( vAirRay );
	vec3 airDir = vAirRay / max( airDist, 1e-3 );
	// The limit of sight in this weather: clear close in, a wall of murk at the visibility distance.
	float airTau = fogDensity * fogDensity * airDist * airDist;
	// Dust and moisture lying on the plains, thinning with height: what makes distance read as distance.
	float airRise = clamp( uAirLayer.y * vAirRay.y, -24.0, 24.0 );
	float airBase = uAirLayer.x * exp( - uAirLayer.y * max( cameraPosition.y - uAirLayer.z, -60.0 ) );
	airTau += airBase * airDist * ( abs( airRise ) > 1e-3 ? ( 1.0 - exp( - airRise ) ) / airRise : 1.0 );
	float airFactor = 1.0 - exp( - airTau );
	#ifdef AIR_SUN
		float airSun = max( dot( airDir, uSunDirection ), 0.0 );
		vec3 airColor = fogColor + uAirGlow * ( airSun * airSun * airSun * airSun );
	#else
		vec3 airColor = fogColor;
	#endif
`;

const AIR_PARS_FRAGMENT = /* glsl */ `
#if defined( USE_FOG ) && defined( USE_AIR )
	#ifndef AIR_PARS
	#define AIR_PARS
	varying vec3 vAirRay;
	uniform vec3 uSunDirection;
	uniform vec3 uAirGlow;
	uniform vec4 uAirLayer;
	#ifdef AIR_CLOUDS
		uniform sampler2D uCloudMap;
		uniform vec4 uCloudField;
		uniform vec2 uCloudShade;
		float airCloudShade = 1.0;
	#endif
	#endif
#endif
`;

/** Replace three's fog and light chunks. Call after every `new CSM(...)`, which resets the light chunks. */
export function installAir() {
  const chunk = THREE.ShaderChunk as Record<string, string>;
  chunk.fog_pars_vertex = /* glsl */ `${stock.fog_pars_vertex}
#if defined( USE_FOG ) && defined( USE_AIR )
	varying vec3 vAirRay;
#endif
`;
  // World-space vector from the camera to the vertex. It is linear in position, so it interpolates exactly
  // and the haze can be worked out per pixel however large the triangle.
  chunk.fog_vertex = /* glsl */ `${stock.fog_vertex}
#if defined( USE_FOG ) && defined( USE_AIR )
	vAirRay = mvPosition.xyz * mat3( viewMatrix );
#endif
`;
  chunk.fog_pars_fragment = stock.fog_pars_fragment + AIR_PARS_FRAGMENT;
  chunk.fog_fragment = /* glsl */ `
#if defined( USE_FOG ) && defined( USE_AIR ) && defined( FOG_EXP2 )
	${AIR_HAZE}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, airColor, airFactor );
#else
	${stock.fog_fragment}
#endif
`;

  // Cloud shadows: the sun (and only the sun) is dimmed where the cloud field above the fragment, slanted
  // towards the sun, is thick enough to be a cloud. One texture read per pixel.
  chunk.lights_pars_begin =
    AIR_PARS_FRAGMENT +
    CSMShader.lights_pars_begin.replace(
      'light.color = directionalLight.color;',
      /* glsl */ `light.color = directionalLight.color;
		#if defined( USE_FOG ) && defined( USE_AIR ) && defined( AIR_CLOUDS )
			light.color *= airCloudShade;
		#endif`,
    );
  chunk.lights_fragment_begin = /* glsl */ `
#if defined( USE_FOG ) && defined( USE_AIR ) && defined( AIR_CLOUDS )
	airCloudShade = 1.0 - uCloudShade.x * smoothstep( uCloudField.w - uCloudShade.y, uCloudField.w + uCloudShade.y, texture2D( uCloudMap, ( vAirRay.xz + cameraPosition.xz ) * uCloudField.z + uCloudField.xy ).a );
#endif
${CSMShader.lights_fragment_begin}`;
}

// ───────────────────────────── The cloud field ─────────────────────────────

const hash2 = (x: number, y: number, seed: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise that repeats every `period` cells. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, period, seed + o * 17);
    norm += amp;
    x *= 2;
    y *= 2;
    period *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Distance to the nearest of one random point per cell, repeating every `period` cells: 0 at a point, about 1 between. */
function worley(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 101);
      best = Math.min(best, (px - x) * (px - x) + (py - y) * (py - y));
    }
  }
  return Math.min(1, Math.sqrt(best));
}

/** Replace each value by its rank, 0..1: afterwards a threshold of t leaves exactly the fraction 1 − t above it. */
function equalise(field: Float32Array) {
  const n = field.length;
  const sorted = Float32Array.from(field).sort();
  for (let k = 0; k < n; k++) {
    let lo = 0;
    let hi = n - 1;
    const value = field[k];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    field[k] = lo / (n - 1);
  }
}

/** Wrap-around box blur, run three times: near enough a Gaussian. */
function blurred(field: Float32Array, size: number, radius: number): Float32Array {
  let src = Float32Array.from(field);
  let dst = new Float32Array(field.length);
  const w = 2 * radius + 1;
  for (let pass = 0; pass < 6; pass++) {
    const horizontal = pass % 2 === 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) {
          const x = horizontal ? (i + d + size) % size : i;
          const y = horizontal ? j : (j + d + size) % size;
          sum += src[y * size + x];
        }
        dst[j * size + i] = sum / w;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/**
 * The raw cloud field as floats, `size` square, tiling: `shape` the clouds themselves, `detail` what frets
 * their edges, `streak` the banding of high cloud, `shadow` the shape smoothed for the ground. Exported for tests.
 */
export function bakeCloudField(size: number): { shape: Float32Array; detail: Float32Array; streak: Float32Array; shadow: Float32Array } {
  const n = size * size;
  const shape = new Float32Array(n);
  const detail = new Float32Array(n);
  const streak = new Float32Array(n);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const k = j * size + i;
      // Big soft masses, bent a little so they do not sit on a grid, with rounded cells cut into them:
      // the cauliflower outline of fair-weather cumulus.
      const wx = fbm(u * 4 + 11.3, v * 4 + 2.9, 4, 3, 7) - 0.5;
      const wy = fbm(u * 4 + 5.1, v * 4 + 8.7, 4, 3, 23) - 0.5;
      const x = u + wx * 0.07;
      const y = v + wy * 0.07;
      const mass = fbm(x * 8, y * 8, 8, 4, 1);
      const billow = 1 - worley(x * 16, y * 16, 16, 3) * 0.65 - worley(x * 32, y * 32, 32, 5) * 0.35;
      shape[k] = mass * 0.68 + billow * 0.32;
      detail[k] = (1 - worley(u * 24, v * 24, 24, 41)) * 0.55 + fbm(u * 32, v * 32, 32, 3, 61) * 0.45;
      streak[k] = fbm(u * 6, v * 28, 6, 4, 77) * 0.7 + fbm(u * 3 + wx * 0.5, v * 3, 3, 3, 91) * 0.3;
    }
  }
  // A cloud's shadow has no hard outline, and a texel here is twenty-odd metres of ground: smooth the shape
  // before it is thresholded, or the texels show.
  const shadow = blurred(shape, size, Math.max(1, Math.round(size / 128)));
  // Flatten the histograms: a value of 0.7 then means "denser than 70 % of the sky", so a coverage
  // threshold is literally the fraction of sky under cloud, and the shadow on the ground agrees with it.
  equalise(shape);
  equalise(shadow);
  // Detail and streaks are stretched to fill 0..1 around a mean of one half.
  for (const field of [detail, streak]) {
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < n; k++) {
      min = Math.min(min, field[k]);
      max = Math.max(max, field[k]);
    }
    for (let k = 0; k < n; k++) field[k] = (field[k] - min) / (max - min);
  }
  return { shape, detail, streak, shadow };
}

/** The cloud field as a small repeating texture, shared by the sky and by the cloud shadows on the ground. */
export function cloudFieldTexture(size = 256): THREE.DataTexture {
  const { shape, detail, streak, shadow } = bakeCloudField(size);
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    data[k * 4] = Math.round(shape[k] * 255);
    data[k * 4 + 1] = Math.round(detail[k] * 255);
    data[k * 4 + 2] = Math.round(streak[k] * 255);
    data[k * 4 + 3] = Math.round(shadow[k] * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
