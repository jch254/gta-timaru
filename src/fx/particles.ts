import * as THREE from 'three';

/**
 * Camera-facing quads drawn in one instanced draw call. World-space positions, sizes in metres.
 * Soft round sprites are shaded procedurally (no textures); fog is applied by hand so additive
 * sprites fade out with distance instead of glowing fog-coloured.
 */
const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSize; // x: diameter in metres, y: rotation
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vColor = iColor;
  vUv = position.xy * 2.0;
  float c = cos(iSize.y);
  float s = sin(iSize.y);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize.x;
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSoft;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float d = dot(vUv, vUv);
  if (d > 1.0) discard;
  float a = vColor.a * (1.0 - smoothstep(uSoft, 1.0, d));
  vec3 rgb = vColor.rgb * uLight;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef FX_ADDITIVE
      a *= 1.0 - fogFactor;
    #else
      rgb = mix(rgb, fogColor, fogFactor);
    #endif
  #endif
  gl_FragColor = vec4(rgb, a);
}
`;

/** A fixed-capacity batch of billboards. Write sprites with `set`, then `commit` once per frame. */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  /** Multiplied into every sprite's colour: the scene light level for smoke, white for glows. */
  readonly light: THREE.Color;
  protected readonly pos: Float32Array;
  protected readonly col: Float32Array;
  protected readonly siz: Float32Array;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aSiz: THREE.InstancedBufferAttribute;

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
    const g = this.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSiz = new THREE.InstancedBufferAttribute(this.siz, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iSize', this.aSiz);
    g.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: new THREE.Color(1, 1, 1) }, uSoft: { value: softness } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
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

  /** Write sprite `i`. Colour is linear RGB (may exceed 1 for glows) with opacity `a`. */
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
}

export function particleStyle(style: Partial<ParticleStyle> & Pick<ParticleStyle, 'lifeMin' | 'lifeMax' | 'size0' | 'size1' | 'color0'>): ParticleStyle {
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
    ...style,
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
  private readonly styles: (ParticleStyle | null)[];

  constructor(capacity: number, additive: boolean, softness = 0) {
    super(capacity, additive, softness);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.styles = new Array<ParticleStyle | null>(capacity).fill(null);
  }

  /** Spawn one particle at (x, y, z) with velocity (vx, vy, vz). `scale` multiplies the style's sizes. */
  emit(style: ParticleStyle, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1) {
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
    const i3 = i * 3;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
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
    const { pos, col, siz, vel, age, life, scale, rot, spin, styles } = this;
    const n = this.high;
    for (let i = 0; i < n; i++) {
      const total = life[i];
      if (total <= 0) continue;
      const i2 = i * 2;
      const i4 = i * 4;
      const t = (age[i] += dt) / total;
      if (t >= 1) {
        life[i] = 0;
        siz[i2] = 0;
        col[i4 + 3] = 0;
        this.alive--;
        continue;
      }
      const st = styles[i]!;
      const i3 = i * 3;
      const k = 1 / (1 + st.drag * dt);
      let vx = vel[i3] * k;
      const vy = (vel[i3 + 1] - st.gravity * dt) * k;
      let vz = vel[i3 + 2] * k;
      if (st.wind > 0) {
        const w = Math.min(1, st.wind * dt);
        vx += (windX - vx) * w;
        vz += (windZ - vz) * w;
      }
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      pos[i3] += vx * dt;
      pos[i3 + 1] += vy * dt;
      pos[i3 + 2] += vz * dt;

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
    }
    this.commit(n);
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
