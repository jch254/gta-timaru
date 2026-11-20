import * as THREE from 'three';
import type { Vehicle } from '../core/types';
import { FOG_FACTOR_GLSL } from './glsl';

/**
 * Flat stains on the world: blood, bullet holes, scorch marks, tyre marks, and pocks that ride on
 * vehicles. All of them are instanced quads in ONE draw call, blended multiplicatively: a decal
 * only tints what is underneath, so it picks up the scene's lighting, shadows and wetness for free
 * and decals can overlap in any order. Shapes are procedural (no textures): a ragged blot, a tyre
 * strip, a spray of droplets thrown along the decal's first axis, or a splash with runs down it.
 */
const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iU;   // half-extent along the decal's first axis
attribute vec3 iV;   // half-extent along the second
attribute vec4 iColor; // tint rgb, strength
attribute vec4 iShape; // seed, edge softness, edge irregularity, speckle (negative = tyre-mark strip)
attribute float iPattern; // DecalPattern
varying vec4 vColor;
varying vec4 vShape;
varying float vPattern;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vColor = iColor;
  vShape = iShape;
  vPattern = iPattern;
  vUv = position.xy * 2.0;
  vec3 world = iPos + iU * vUv.x + iV * vUv.y;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec4 vColor;
varying vec4 vShape;
varying float vPattern;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A ragged outline: the edge radius wanders with the angle around the centre.
float blot(vec2 p, float seed) {
  float r = length(p);
  vec2 around = p / max(r, 1e-4);
  float n = noise(around * 2.3 + seed);
  float edge = 0.98 - vShape.z * (1.0 - n);
  return 1.0 - smoothstep(edge - vShape.y, edge, r);
}
// Droplets scattered over a grid of cells. thrown = 1: thrown along +x (thinning out and drawn out
// further along); thrown = 0: flung out all round the centre.
float droplets(vec2 uv, float seed, float thrown) {
  vec2 cells = vec2(5.0, 4.0);
  vec2 g = (uv + 1.0) * cells;
  vec2 base = floor(g);
  float a = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(float(i), float(j));
      vec2 centre = (c + 0.2 + 0.6 * vec2(hash(c + seed), hash(c + seed * 1.37 + 5.1))) / cells - 1.0;
      float far = mix(length(centre), centre.x * 0.5 + 0.5, thrown);
      float side = mix(0.0, abs(centre.y), thrown);
      float chance = (1.0 - side * side) * (0.95 - 0.6 * far);
      if (hash(c + seed * 2.1 + 9.3) > chance) continue;
      float rad = (0.045 + 0.085 * hash(c + seed + 3.7)) * (1.15 - 0.7 * far);
      vec2 dv = uv - centre;
      // Drawn out the way it was going.
      dv.x *= mix(1.0, 0.5, thrown);
      if (thrown < 0.5) dv = dv - centre * dot(dv, centre) * 0.6 / max(dot(centre, centre), 0.01);
      a = max(a, 1.0 - smoothstep(0.7, 1.0, length(dv) / max(rad, 1e-3)));
    }
  }
  return a;
}
void main() {
  float seed = vShape.x;
  float a;
  if (vShape.w < 0.0) {
    // Tyre mark: soft across, continuous along, streaky.
    float across = 1.0 - smoothstep(0.5, 1.0, abs(vUv.y));
    float ends = 1.0 - smoothstep(0.92, 1.0, abs(vUv.x));
    float grain = 0.6 + 0.4 * noise(vec2(vUv.x * 2.0 + seed, vUv.y * 9.0 + seed));
    a = across * ends * grain;
  } else if (vPattern > 0.5 && vPattern < 1.5) {
    // Spray: a splash where it first landed and droplets thrown on along +x, sparser and longer as they go.
    a = blot((vUv - vec2(-0.42, 0.0)) / vec2(0.56, 0.72), seed);
    a = max(a, droplets(vUv, seed, 1.0));
    a = max(a, vShape.w * step(0.78, noise(vUv * 9.0 + seed * 1.7)) * (1.0 - smoothstep(0.2, 0.9, length(vUv * vec2(0.8, 1.3)))));
    a *= 1.0 - smoothstep(0.9, 1.0, max(abs(vUv.x), abs(vUv.y)));
  } else if (vPattern > 1.5) {
    // Splashed on a wall: a splat, droplets flung round it, and runs down +x (the decal is laid with x downhill).
    a = blot(vUv / 0.58, seed);
    a = max(a, droplets(vUv, seed, 0.0));
    float width = 0.15;
    float k = floor((vUv.y + 1.0) / width);
    float lane = (k + 0.5) * width - 1.0;
    if (hash(vec2(k, seed)) < 0.55 && abs(lane) < 0.5) {
      float half_ = 0.014 + 0.022 * hash(vec2(k, seed + 1.0));
      float reach = 0.4 + 0.52 * hash(vec2(k, seed + 2.0));
      float down = clamp(vUv.x / reach, 0.0, 1.0);
      float w = half_ * (1.0 - 0.45 * down);
      float run = step(0.0, vUv.x) * (1.0 - smoothstep(reach - 0.02, reach, vUv.x)) * (1.0 - smoothstep(w * 0.6, w, abs(vUv.y - lane)));
      float bead = 1.0 - smoothstep(half_ * 1.1, half_ * 1.6, length(vec2(vUv.x - reach, vUv.y - lane)));
      a = max(a, max(run, bead));
    }
    a *= 1.0 - smoothstep(0.9, 1.0, max(abs(vUv.x), abs(vUv.y)));
  } else {
    float r = length(vUv);
    if (r > 1.0) discard;
    a = blot(vUv, seed);
    // Satellite droplets / flecks.
    float fleck = step(0.72, noise(vUv * 7.0 + seed * 1.7)) * (1.0 - smoothstep(0.5, 0.97, r));
    a = max(a, vShape.w * fleck);
  }
  a *= vColor.a;
  #ifdef USE_FOG${FOG_FACTOR_GLSL}
    a *= 1.0 - fogFactor;
  #endif
  // Multiplied into the framebuffer: white leaves the surface untouched.
  gl_FragColor = vec4(mix(vec3(1.0), vColor.rgb, a), 1.0);
}
`;

/** How one kind of decal looks and ages. Shared constant objects. */
export interface DecalStyle {
  /** Which recycling ring the decal lives in (index into the capacities given to `Decals`). */
  readonly ring: number;
  /** What the surface colour is multiplied by at full strength. */
  readonly tint: readonly [number, number, number];
  /** Strength 0..1. */
  readonly alpha: number;
  /** Seconds at full strength, then seconds to fade away. */
  readonly life: number;
  readonly fade: number;
  /** Seconds to grow from `growFrom` × size to full size (0 = full size at once). */
  readonly grow: number;
  readonly growFrom: number;
  /** Edge softness and raggedness, 0..1. */
  readonly soft: number;
  readonly irregular: number;
  /** Strength of scattered flecks around the main shape; negative draws a tyre-mark strip instead. */
  readonly speckle: number;
  /** Metres the quad floats off the surface. */
  readonly lift: number;
  /** Shape (see `DecalPattern`); default the ragged blot. */
  readonly pattern?: number;
}

/**
 * Decal shapes. Blot: a ragged patch (pools, holes, scorches). Spray: a splash with droplets thrown
 * on along the decal's first axis. Drip: a splash with runs down the first axis (lay it downhill).
 */
export const DecalPattern = { Blot: 0, Spray: 1, Drip: 2 } as const;

const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Pooled decals. Each ring recycles its oldest decal when full, so the totals can never grow.
 * `now` is a clock in seconds that only moves while the game runs (GameClock.elapsed).
 */
export class Decals {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  /** Decals alive right now. */
  active = 0;
  private readonly ringStart: number[] = [];
  private readonly ringSize: number[] = [];
  private readonly ringCursor: number[] = [];
  // Per decal. Centre and axes are world space, or vehicle-local when attached.
  private readonly centre: Float32Array;
  private readonly axisU: Float32Array;
  private readonly axisV: Float32Array;
  private readonly half: Float32Array;
  /** Birth times. Doubles: a float32 copy of the clock can round above it, which reads as a negative age. */
  private readonly born: Float64Array;
  private readonly strength: Float32Array;
  private readonly live: Uint8Array;
  private readonly styles: (DecalStyle | null)[];
  private readonly riders: (Vehicle | null)[];
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aU: THREE.InstancedBufferAttribute;
  private readonly aV: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aShape: THREE.InstancedBufferAttribute;
  private readonly aPattern: THREE.InstancedBufferAttribute;

  /** @param capacities size of each recycling ring; `DecalStyle.ring` indexes into this list */
  constructor(capacities: readonly number[]) {
    let total = 0;
    for (const size of capacities) {
      this.ringStart.push(total);
      this.ringSize.push(size);
      this.ringCursor.push(0);
      total += size;
    }
    this.capacity = total;
    this.centre = new Float32Array(total * 3);
    this.axisU = new Float32Array(total * 3);
    this.axisV = new Float32Array(total * 3);
    this.half = new Float32Array(total * 2);
    this.born = new Float64Array(total);
    this.strength = new Float32Array(total);
    this.live = new Uint8Array(total);
    this.styles = new Array<DecalStyle | null>(total).fill(null);
    this.riders = new Array<Vehicle | null>(total).fill(null);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(total * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aPos = attribute(3);
    this.aU = attribute(3);
    this.aV = attribute(3);
    this.aColor = attribute(4);
    this.aShape = attribute(4);
    this.aPattern = attribute(1);
    geometry.setAttribute('iPattern', this.aPattern);
    geometry.setAttribute('iPos', this.aPos);
    geometry.setAttribute('iU', this.aU);
    geometry.setAttribute('iV', this.aV);
    geometry.setAttribute('iColor', this.aColor);
    geometry.setAttribute('iShape', this.aShape);
    geometry.instanceCount = total;

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      // result = decal colour × what is already there; destination alpha untouched.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    // After opaque geometry and the world's own transparents, before smoke and glows.
    this.mesh.renderOrder = 5;
  }

  /**
   * Lay a decal on a surface.
   * @param p        point on the surface
   * @param normal   unit surface normal
   * @param along    direction the decal's first axis should follow (projected onto the surface); pass
   *                 null for a random rotation
   * @param halfU    half-length along that axis, metres
   * @param halfV    half-width across it
   * @param strength 0..1, default the style's alpha
   * @returns the slot, for `attach`
   */
  add(style: DecalStyle, now: number, p: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3 | null, halfU: number, halfV: number, strength = style.alpha): number {
    const ring = style.ring;
    const i = this.ringStart[ring] + this.ringCursor[ring];
    this.ringCursor[ring] = (this.ringCursor[ring] + 1) % this.ringSize[ring];
    if (!this.live[i]) {
      this.live[i] = 1;
      this.active++;
    }
    // Basis on the surface.
    _n.copy(normal);
    if (along) _u.copy(along).addScaledVector(_n, -along.dot(_n));
    if (!along || _u.lengthSq() < 1e-6) {
      if (Math.abs(_n.y) < 0.9) _u.set(_n.z, 0, -_n.x);
      else _u.set(0, -_n.z, _n.y);
      _u.normalize();
      _v.crossVectors(_n, _u);
      const angle = Math.random() * Math.PI * 2;
      _u.multiplyScalar(Math.cos(angle)).addScaledVector(_v, Math.sin(angle));
    }
    _u.normalize();
    _v.crossVectors(_n, _u);

    const i3 = i * 3;
    this.centre[i3] = p.x + _n.x * style.lift;
    this.centre[i3 + 1] = p.y + _n.y * style.lift;
    this.centre[i3 + 2] = p.z + _n.z * style.lift;
    this.axisU[i3] = _u.x;
    this.axisU[i3 + 1] = _u.y;
    this.axisU[i3 + 2] = _u.z;
    this.axisV[i3] = _v.x;
    this.axisV[i3 + 1] = _v.y;
    this.axisV[i3 + 2] = _v.z;
    this.half[i * 2] = halfU;
    this.half[i * 2 + 1] = halfV;
    this.born[i] = now;
    this.strength[i] = strength;
    this.styles[i] = style;
    this.riders[i] = null;

    const i4 = i * 4;
    const color = this.aColor.array as Float32Array;
    color[i4] = style.tint[0];
    color[i4 + 1] = style.tint[1];
    color[i4 + 2] = style.tint[2];
    const shape = this.aShape.array as Float32Array;
    shape[i4] = Math.random() * 37;
    shape[i4 + 1] = style.soft;
    shape[i4 + 2] = style.irregular;
    shape[i4 + 3] = style.speckle;
    this.aShape.needsUpdate = true;
    (this.aPattern.array as Float32Array)[i] = style.pattern ?? DecalPattern.Blot;
    this.aPattern.needsUpdate = true;
    this.write(i, now);
    this.flush();
    return i;
  }

  /** Make decal `slot` ride on a vehicle (bullet pocks). It is dropped when the vehicle is removed. */
  attach(slot: number, vehicle: Vehicle) {
    if (!this.live[slot]) return;
    _q.copy(vehicle.group.quaternion).invert();
    const i3 = slot * 3;
    _p.set(this.centre[i3] - vehicle.position.x, this.centre[i3 + 1] - vehicle.position.y, this.centre[i3 + 2] - vehicle.position.z).applyQuaternion(_q);
    this.centre[i3] = _p.x;
    this.centre[i3 + 1] = _p.y;
    this.centre[i3 + 2] = _p.z;
    _u.set(this.axisU[i3], this.axisU[i3 + 1], this.axisU[i3 + 2]).applyQuaternion(_q);
    this.axisU[i3] = _u.x;
    this.axisU[i3 + 1] = _u.y;
    this.axisU[i3 + 2] = _u.z;
    _v.set(this.axisV[i3], this.axisV[i3 + 1], this.axisV[i3 + 2]).applyQuaternion(_q);
    this.axisV[i3] = _v.x;
    this.axisV[i3 + 1] = _v.y;
    this.axisV[i3 + 2] = _v.z;
    this.riders[slot] = vehicle;
  }

  /** Age, grow, fade and follow. Call once per frame. */
  update(now: number) {
    if (this.active === 0) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < this.capacity; i++) {
      if (this.live[i]) this.write(i, now);
    }
    this.flush();
  }

  private write(i: number, now: number) {
    const style = this.styles[i]!;
    const age = now - this.born[i];
    const rider = this.riders[i];
    const i3 = i * 3;
    const i4 = i * 4;
    const pos = this.aPos.array as Float32Array;
    const au = this.aU.array as Float32Array;
    const av = this.aV.array as Float32Array;
    const color = this.aColor.array as Float32Array;
    // A negative age means the clock went backwards (a new game in the same session): drop it.
    if (age < 0 || age >= style.life + style.fade || (rider !== null && rider.group.parent === null)) {
      this.live[i] = 0;
      this.active--;
      this.riders[i] = null;
      color[i4 + 3] = 0;
      au[i3] = au[i3 + 1] = au[i3 + 2] = 0;
      av[i3] = av[i3 + 1] = av[i3 + 2] = 0;
      return;
    }
    let size = 1;
    if (style.grow > 0 && age < style.grow) {
      const t = 1 - age / style.grow;
      size = style.growFrom + (1 - style.growFrom) * (1 - t * t);
    }
    const hu = this.half[i * 2] * size;
    const hv = this.half[i * 2 + 1] * size;
    color[i4 + 3] = this.strength[i] * (age < style.life ? 1 : 1 - (age - style.life) / style.fade);
    if (rider) {
      const q = rider.group.quaternion;
      _p.set(this.centre[i3], this.centre[i3 + 1], this.centre[i3 + 2]).applyQuaternion(q).add(rider.position);
      _u.set(this.axisU[i3], this.axisU[i3 + 1], this.axisU[i3 + 2]).applyQuaternion(q);
      _v.set(this.axisV[i3], this.axisV[i3 + 1], this.axisV[i3 + 2]).applyQuaternion(q);
      pos[i3] = _p.x;
      pos[i3 + 1] = _p.y;
      pos[i3 + 2] = _p.z;
      au[i3] = _u.x * hu;
      au[i3 + 1] = _u.y * hu;
      au[i3 + 2] = _u.z * hu;
      av[i3] = _v.x * hv;
      av[i3 + 1] = _v.y * hv;
      av[i3 + 2] = _v.z * hv;
    } else {
      pos[i3] = this.centre[i3];
      pos[i3 + 1] = this.centre[i3 + 1];
      pos[i3 + 2] = this.centre[i3 + 2];
      au[i3] = this.axisU[i3] * hu;
      au[i3 + 1] = this.axisU[i3 + 1] * hu;
      au[i3 + 2] = this.axisU[i3 + 2] * hu;
      av[i3] = this.axisV[i3] * hv;
      av[i3 + 1] = this.axisV[i3 + 1] * hv;
      av[i3 + 2] = this.axisV[i3 + 2] * hv;
    }
  }

  private flush() {
    this.aPos.needsUpdate = true;
    this.aU.needsUpdate = true;
    this.aV.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.mesh.visible = this.active > 0;
  }

  /** Remove every decal (new game). */
  clear() {
    this.live.fill(0);
    this.riders.fill(null);
    this.active = 0;
    (this.aColor.array as Float32Array).fill(0);
    (this.aU.array as Float32Array).fill(0);
    (this.aV.array as Float32Array).fill(0);
    this.flush();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
