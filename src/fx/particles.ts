import * as THREE from 'three';
import { FOG_FACTOR_GLSL } from './glsl';

/**
 * Camera-facing quads drawn in one instanced draw call. World-space positions, sizes in metres.
 * Each sprite is one of three shapes: a soft round glow, a billow (a lumpy puff from a small atlas
 * generated at start-up, which breaks up as it ages) or a hard-edged drop. Any of them can be drawn
 * stretched along its motion. Fog is applied by hand so additive sprites fade out with distance
 * instead of glowing fog-coloured.
 */
const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSize;   // x: diameter in metres, y: rotation
attribute vec3 iStreak; // world-space vector the sprite trails back along (0 = round)
attribute vec4 iShape;  // x: shape * 4 + atlas cell, y: age 0..1, z: erosion, w: self-glow
varying vec4 vColor;
varying vec4 vShape;
varying vec2 vUv;
varying float vUp;
#include <fog_pars_vertex>
void main() {
  vColor = iColor;
  vShape = iShape;
  vUv = position.xy * 2.0;
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  vec2 streak = (viewMatrix * vec4(iStreak, 0.0)).xy;
  float len = length(streak);
  vec2 corner;
  if (len > 0.002) {
    // Head at the particle, tail trailing back along where it came from.
    vec2 ax = streak / len;
    vec2 ay = vec2(-ax.y, ax.x);
    corner = ax * (position.x * (iSize.x + len) - 0.5 * len) + ay * (position.y * iSize.x);
  } else {
    float c = cos(iSize.y);
    float s = sin(iSize.y);
    corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize.x;
  }
  // How far up the sprite this corner is on screen, -1..1 (for shading billows lit from above).
  vUp = clamp(corner.y / max(iSize.x, 1e-4) * 2.0, -1.0, 1.0);
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSoft;
uniform sampler2D uPuff;
varying vec4 vColor;
varying vec4 vShape;
varying vec2 vUv;
varying float vUp;
#include <fog_pars_fragment>
void main() {
  float d = dot(vUv, vUv);
  if (d > 1.0) discard;
  float kind = floor(vShape.x * 0.25 + 0.01);
  float cell = vShape.x - kind * 4.0;
  vec3 rgb = vColor.rgb;
  float a;
  float density = 0.5;
  if (kind < 0.5) {
    a = 1.0 - smoothstep(uSoft, 1.0, d);
  } else if (kind < 1.5) {
    vec2 offset = vec2(mod(cell, 2.0), floor(cell * 0.5 + 0.01));
    density = texture2D(uPuff, (vUv * 0.5 + 0.5 + offset) * 0.5).r;
    // Erosion: as it ages only the dense lumps are left, so a puff breaks into wisps instead of fading as a disc.
    float cut = vShape.z * vShape.y;
    a = smoothstep(cut, min(1.0, cut + 0.55), density);
    #ifdef FX_ADDITIVE
      rgb *= 0.3 + 1.25 * density;
    #else
      // Lit from above, darker where it is thick.
      rgb *= (0.8 + 0.28 * vUp) * (1.12 - 0.34 * density);
    #endif
  } else {
    a = 1.0 - smoothstep(0.45, 1.0, d);
    rgb *= 0.7 + 0.45 * (1.0 - d);
  }
  a *= vColor.a;
  rgb *= uLight;
  #ifndef FX_ADDITIVE
    // Smoke lit from inside by the fire that made it: glows whatever the daylight.
    rgb += vec3(1.0, 0.36, 0.08) * vShape.w * (0.35 + density);
  #endif
  #ifdef USE_FOG${FOG_FACTOR_GLSL}
    #ifdef FX_ADDITIVE
      a *= 1.0 - fogFactor;
    #else
      rgb = mix(rgb, fogColor, fogFactor);
    #endif
  #endif
  gl_FragColor = vec4(rgb, a);
}
`;

/** Sprite shapes (ParticleStyle.shape). */
export const Shape = { Soft: 0, Billow: 1, Drop: 2 } as const;
/** What a particle does when it reaches the floor it was given (ParticleStyle.land). */
export const Land = { None: 0, Die: 1, Bounce: 2 } as const;

/** Cells in the billow atlas (2 × 2). */
const PUFF_CELLS = 4;
const PUFF_SIZE = 256;
let puffTexture: THREE.DataTexture | null = null;

/**
 * Four lumpy puffs in a 2 × 2 atlas: a cluster of overlapping lobes (the cauliflower of real smoke)
 * roughened with value noise, falling to nothing before the cell edge. Red channel = density.
 * Deterministic, made once and shared by every pool.
 */
export function puffAtlas(): THREE.DataTexture {
  if (puffTexture) return puffTexture;
  const size = PUFF_SIZE;
  const half = size / 2;
  const data = new Uint8Array(size * size * 4);
  let seed = 0x2f6b1d;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lattice = new Float32Array(64 * 64);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const value = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => lattice[(((j & 63) * 64) + (i & 63))];
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const fbm = (x: number, y: number) => value(x, y) * 0.5 + value(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + value(x * 4.3 + 1, y * 4.3 + 9) * 0.14 + value(x * 8.7 + 5, y * 8.7 + 2) * 0.08;
  for (let cell = 0; cell < PUFF_CELLS; cell++) {
    const ox = (cell % 2) * half;
    const oy = Math.floor(cell / 2) * half;
    // Lobes: one big middle, a ring of smaller ones round it.
    const lobes: number[] = [0, 0, 0.52];
    const ring = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < ring; i++) {
      const angle = (i / ring) * Math.PI * 2 + rand() * 0.6;
      const r = 0.34 + rand() * 0.16;
      lobes.push(Math.cos(angle) * r, Math.sin(angle) * r, 0.24 + rand() * 0.14);
    }
    const shift = cell * 17.3;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const u0 = ((x + 0.5) / half) * 2 - 1;
        const v0 = ((y + 0.5) / half) * 2 - 1;
        // Warp the lobes with noise so no outline is a circle.
        const u = u0 + (fbm(u0 * 1.7 + shift + 3.1, v0 * 1.7 - shift) - 0.5) * 0.5;
        const v = v0 + (fbm(u0 * 1.7 - shift, v0 * 1.7 + shift + 5.3) - 0.5) * 0.5;
        // Soft union of the lobes for the outline, and the tallest dome for lumps inside it.
        let clear = 1;
        let dome = 0;
        for (let i = 0; i < lobes.length; i += 3) {
          const dx = (u - lobes[i]) / lobes[i + 2];
          const dy = (v - lobes[i + 1]) / lobes[i + 2];
          const h = Math.max(0, 1 - (dx * dx + dy * dy));
          clear *= 1 - h;
          dome = Math.max(dome, Math.sqrt(h));
        }
        const body = 1 - clear;
        const n = fbm(u0 * 3.4 + shift, v0 * 3.4 - shift);
        let density = body * 0.62 + dome * 0.3 + (n - 0.5) * 0.9 + 0.02;
        // Nothing reaches the cell edge (no seams, and the sprite's disc clip never shows).
        const r = Math.sqrt(u0 * u0 + v0 * v0);
        density *= 1 - smoothstep(0.7, 0.98, r);
        const i4 = ((oy + y) * size + ox + x) * 4;
        const byte = Math.max(0, Math.min(255, Math.round(density * 255)));
        data[i4] = data[i4 + 1] = data[i4 + 2] = byte;
        data[i4 + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  puffTexture = tex;
  return tex;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A fixed-capacity batch of billboards. Write sprites with `set`, then `commit` once per frame. */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  /** Multiplied into every sprite's colour: the scene light level for smoke, white for glows. */
  readonly light: THREE.Color;
  protected readonly pos: Float32Array;
  protected readonly col: Float32Array;
  protected readonly siz: Float32Array;
  /** Per sprite: the streak vector (0 = round). */
  protected readonly str: Float32Array;
  /** Per sprite: shape and atlas cell, age, erosion, self-glow. */
  protected readonly shp: Float32Array;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aSiz: THREE.InstancedBufferAttribute;
  private readonly aStr: THREE.InstancedBufferAttribute;
  private readonly aShp: THREE.InstancedBufferAttribute;

  /**
   * @param capacity most sprites alive at once
   * @param additive glow (true) or lit, alpha-blended smoke (false)
   * @param softness 0 = soft all the way from the centre, towards 1 = hard-edged disc
   */
  constructor(
    readonly capacity: number,
    additive: boolean,
    softness = 0,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.siz = new Float32Array(capacity * 2);
    this.str = new Float32Array(capacity * 3);
    this.shp = new Float32Array(capacity * 4);
    const g = this.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSiz = new THREE.InstancedBufferAttribute(this.siz, 2).setUsage(THREE.DynamicDrawUsage);
    this.aStr = new THREE.InstancedBufferAttribute(this.str, 3).setUsage(THREE.DynamicDrawUsage);
    this.aShp = new THREE.InstancedBufferAttribute(this.shp, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iSize', this.aSiz);
    g.setAttribute('iStreak', this.aStr);
    g.setAttribute('iShape', this.aShp);
    g.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: new THREE.Color(1, 1, 1) }, uSoft: { value: softness }, uPuff: { value: null } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // (Set after the merge: UniformsUtils clones textures it finds.)
    material.uniforms.uPuff.value = puffAtlas();
    if (additive) material.defines = { FX_ADDITIVE: '' };
    this.light = material.uniforms.uLight.value as THREE.Color;

    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; // sprites live anywhere in the world
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    // After the world's own transparent surfaces (glass, water).
    this.mesh.renderOrder = additive ? 21 : 20;
  }

  /** Write sprite `i` (a soft round sprite). Colour is linear RGB (may exceed 1 for glows) with opacity `a`. */
  set(i: number, x: number, y: number, z: number, size: number, rotation: number, r: number, g: number, b: number, a: number) {
    const i3 = i * 3;
    const i4 = i * 4;
    const i2 = i * 2;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.col[i4] = r;
    this.col[i4 + 1] = g;
    this.col[i4 + 2] = b;
    this.col[i4 + 3] = a;
    this.siz[i2] = size;
    this.siz[i2 + 1] = rotation;
  }

  /** Upload and draw the first `count` sprites. */
  commit(count: number) {
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count <= 0) return;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSiz.needsUpdate = true;
    this.aStr.needsUpdate = true;
    this.aShp.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** How one kind of particle looks and moves. Shared constant objects: nothing is allocated per particle. */
export interface ParticleStyle {
  /** Lifetime range in seconds. */
  readonly lifeMin: number;
  readonly lifeMax: number;
  /** Diameter in metres at birth and at death (eases out). */
  readonly size0: number;
  readonly size1: number;
  /** Random size variation, ± fraction. */
  readonly jitter: number;
  /** Linear RGB at birth and at death. */
  readonly color0: readonly [number, number, number];
  readonly color1: readonly [number, number, number];
  /** Peak opacity. */
  readonly alpha: number;
  /** Fraction of the life spent fading in. */
  readonly fadeIn: number;
  /** Fade-out curve: 1 = linear, higher = fades early, lower = holds then drops. */
  readonly fadePower: number;
  /** Velocity damping per second. */
  readonly drag: number;
  /** Downward acceleration in m/s² (negative rises). */
  readonly gravity: number;
  /** How quickly the particle picks up the wind (1/s). */
  readonly wind: number;
  /** Largest spin in rad/s. */
  readonly spin: number;
  /** Shape (see `Shape`). */
  readonly shape: number;
  /** Drawn stretched back along this many seconds of its motion (0 = round). */
  readonly stretch: number;
  /** Billows only: how far it has broken up into wisps by the end of its life, 0..1. */
  readonly erode: number;
  /** Lit sprites only: glow from the fire inside it at birth, gone `1 / cool` of the way through its life. */
  readonly heat: number;
  readonly cool: number;
  /** At the floor it was emitted with (see `Land`); `bounce` is the restitution when it bounces. */
  readonly land: number;
  readonly bounce: number;
}

type StyleInput = Partial<Omit<ParticleStyle, 'shape' | 'land'>> &
  Pick<ParticleStyle, 'lifeMin' | 'lifeMax' | 'size0' | 'size1' | 'color0'> & {
    shape?: keyof typeof Shape | number;
    land?: keyof typeof Land | number;
  };

export function particleStyle(style: StyleInput): ParticleStyle {
  const shape = typeof style.shape === 'string' ? Shape[style.shape] : (style.shape ?? Shape.Soft);
  const land = typeof style.land === 'string' ? Land[style.land] : (style.land ?? Land.None);
  return {
    jitter: 0.25,
    color1: style.color0,
    alpha: 1,
    fadeIn: 0,
    fadePower: 1,
    drag: 0,
    gravity: 0,
    wind: 0,
    spin: 0,
    stretch: 0,
    erode: 0,
    heat: 0,
    cool: 6,
    bounce: 0.3,
    ...style,
    shape,
    land,
  };
}

/**
 * CPU-simulated particles on a SpriteBatch. A ring buffer: when full, the oldest particle is
 * recycled, so the count can never exceed the capacity and nothing is allocated after construction.
 */
export class ParticlePool extends SpriteBatch {
  /** Live particles right now. */
  alive = 0;
  private cursor = 0;
  /** One past the highest slot in use. */
  private high = 0;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly scale: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly floor: Float32Array;
  private readonly styles: (ParticleStyle | null)[];

  constructor(capacity: number, additive: boolean, softness = 0) {
    super(capacity, additive, softness);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    this.styles = new Array<ParticleStyle | null>(capacity).fill(null);
  }

  /**
   * Spawn one particle at (x, y, z) with velocity (vx, vy, vz). `scale` multiplies the style's sizes.
   * `floor` is the height of the ground under it, for styles that land (default: no floor).
   */
  emit(style: ParticleStyle, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1, floor = -Infinity) {
    const i = this.cursor;
    this.cursor = i + 1 === this.capacity ? 0 : i + 1;
    if (i >= this.high) this.high = i + 1;
    if (this.life[i] <= 0) this.alive++;
    this.life[i] = style.lifeMin + (style.lifeMax - style.lifeMin) * Math.random();
    this.age[i] = 0;
    this.styles[i] = style;
    const s = scale * (1 + (Math.random() * 2 - 1) * style.jitter);
    this.scale[i] = s;
    const rot = Math.random() * 6.2832;
    this.rot[i] = rot;
    this.spin[i] = (Math.random() * 2 - 1) * style.spin;
    this.floor[i] = floor;
    const i3 = i * 3;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const k = style.stretch;
    this.str[i3] = vx * k;
    this.str[i3 + 1] = vy * k;
    this.str[i3 + 2] = vz * k;
    const i4 = i * 4;
    this.shp[i4] = style.shape * 4 + Math.floor(Math.random() * PUFF_CELLS);
    this.shp[i4 + 1] = 0;
    this.shp[i4 + 2] = style.erode;
    this.shp[i4 + 3] = style.heat;
    const c = style.color0;
    this.set(i, x, y, z, style.size0 * s, rot, c[0], c[1], c[2], style.fadeIn > 0 ? 0 : style.alpha);
  }

  /** Integrate, age and upload. `windX`/`windZ` is the wind in m/s. */
  update(dt: number, windX = 0, windZ = 0) {
    if (this.alive === 0) {
      if (this.high > 0) {
        this.high = 0;
        this.cursor = 0;
        this.commit(0);
      }
      return;
    }
    const { pos, col, siz, vel, age, life, scale, rot, spin, styles, floor, str, shp } = this;
    const n = this.high;
    for (let i = 0; i < n; i++) {
      const total = life[i];
      if (total <= 0) continue;
      const i2 = i * 2;
      const i4 = i * 4;
      const t = (age[i] += dt) / total;
      if (t >= 1) {
        this.kill(i);
        continue;
      }
      const st = styles[i]!;
      const i3 = i * 3;
      const k = 1 / (1 + st.drag * dt);
      let vx = vel[i3] * k;
      let vy = (vel[i3 + 1] - st.gravity * dt) * k;
      let vz = vel[i3 + 2] * k;
      if (st.wind > 0) {
        const w = Math.min(1, st.wind * dt);
        vx += (windX - vx) * w;
        vz += (windZ - vz) * w;
      }
      let y = pos[i3 + 1] + vy * dt;
      if (st.land !== Land.None && y < floor[i]) {
        if (st.land === Land.Die) {
          this.kill(i);
          continue;
        }
        // Bounce, losing most of it to the ground; once it is barely hopping it lies where it is.
        y = floor[i];
        vy = vy < -1.2 ? -vy * st.bounce : 0;
        const rub = vy === 0 ? 0.15 : 0.6;
        vx *= rub;
        vz *= rub;
        spin[i] *= 0.5;
      }
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      pos[i3] += vx * dt;
      pos[i3 + 1] = y;
      pos[i3 + 2] += vz * dt;
      if (st.stretch > 0) {
        str[i3] = vx * st.stretch;
        str[i3 + 1] = vy * st.stretch;
        str[i3 + 2] = vz * st.stretch;
      }

      const grow = 1 - (1 - t) * (1 - t);
      siz[i2] = (st.size0 + (st.size1 - st.size0) * grow) * scale[i];
      siz[i2 + 1] = rot[i] += spin[i] * dt;
      const c0 = st.color0;
      const c1 = st.color1;
      col[i4] = c0[0] + (c1[0] - c0[0]) * t;
      col[i4 + 1] = c0[1] + (c1[1] - c0[1]) * t;
      col[i4 + 2] = c0[2] + (c1[2] - c0[2]) * t;
      const out = st.fadePower === 1 ? 1 - t : Math.pow(1 - t, st.fadePower);
      col[i4 + 3] = st.alpha * (t < st.fadeIn ? t / st.fadeIn : 1) * out;
      shp[i4 + 1] = t;
      if (st.heat > 0) {
        const cool = Math.max(0, 1 - t * st.cool);
        shp[i4 + 3] = st.heat * cool * cool;
      }
    }
    this.commit(n);
  }

  private kill(i: number) {
    this.life[i] = 0;
    this.siz[i * 2] = 0;
    this.col[i * 4 + 3] = 0;
    this.alive--;
  }

  /** Kill everything. */
  clear() {
    this.life.fill(0);
    this.alive = 0;
    this.high = 0;
    this.cursor = 0;
    this.commit(0);
  }
}
