import * as THREE from 'three';

/** Metres per second a tracer streak travels. */
const SPEED = 380;
/** Floats of state per tracer: origin (3), direction (3), length, distance travelled, streak length. */
const STRIDE = 9;

const VERT = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec4 iColor; // rgb, a = width in metres
uniform float uPixel;  // world size of one pixel at distance 1
varying vec3 vColor;
varying vec2 vUv;
void main() {
  vec3 a = (viewMatrix * vec4(iStart, 1.0)).xyz;
  vec3 b = (viewMatrix * vec4(iEnd, 1.0)).xyz;
  float t = position.x + 0.5;
  vec3 p = mix(a, b, t);
  // Widen the ribbon at right angles to both the streak and the line of sight.
  vec3 side = cross(b - a, p);
  float len = length(side);
  side = len > 1e-6 ? side / len : vec3(0.0, 1.0, 0.0);
  // Never thinner than a couple of pixels, so distant tracers still read in daylight.
  float width = max(iColor.a, uPixel * 2.0 * max(0.0, -p.z));
  p += side * width * position.y;
  vUv = vec2(t, position.y * 2.0);
  vColor = iColor.rgb;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.y);
  // Dark tail, bright head, white-hot core.
  float body = across * across * vUv.x;
  float core = pow(across, 6.0) * vUv.x * vUv.x;
  gl_FragColor = vec4(vColor * body + vec3(2.5) * core, 1.0);
}
`;

/**
 * Bullet tracers: a fixed pool of additive, camera-facing ribbons that streak from muzzle to hit
 * point and are gone a few frames later. One instanced draw call; nothing allocated after
 * construction.
 */
export class TracerPool {
  readonly mesh: THREE.Mesh;
  /** Tracers in flight. */
  active = 0;
  private readonly starts: Float32Array;
  private readonly ends: Float32Array;
  private readonly colors: Float32Array;
  private readonly data: Float32Array;
  private readonly live: Uint8Array;
  private readonly aStart: THREE.InstancedBufferAttribute;
  private readonly aEnd: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly pixel: THREE.IUniform<number>;
  private cursor = 0;

  constructor(readonly capacity = 72) {
    this.starts = new Float32Array(capacity * 3);
    this.ends = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.data = new Float32Array(capacity * STRIDE);
    this.live = new Uint8Array(capacity);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.aStart = new THREE.InstancedBufferAttribute(this.starts, 3).setUsage(THREE.DynamicDrawUsage);
    this.aEnd = new THREE.InstancedBufferAttribute(this.ends, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iStart', this.aStart);
    geometry.setAttribute('iEnd', this.aEnd);
    geometry.setAttribute('iColor', this.aColor);
    geometry.instanceCount = capacity;
    this.pixel = { value: 0.001 };
    const material = new THREE.ShaderMaterial({
      uniforms: { uPixel: this.pixel },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 22;
  }

  /** Tell the shader how big a pixel is (camera vertical field of view in degrees, viewport height in pixels). */
  setViewport(fovDegrees: number, heightPixels: number) {
    this.pixel.value = (2 * Math.tan((fovDegrees * Math.PI) / 360)) / Math.max(1, heightPixels);
  }

  /**
   * Launch a tracer from `from` to `to`. Colour is linear RGB (well above 1 so it blooms),
   * `width` in metres, `streak` the length of the visible streak in metres.
   */
  spawn(from: THREE.Vector3, to: THREE.Vector3, r: number, g: number, b: number, width = 0.035, streak = 9) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.5) return;
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (!this.live[i]) {
      this.live[i] = 1;
      this.active++;
    }
    const d = this.data;
    const o = i * STRIDE;
    d[o] = from.x;
    d[o + 1] = from.y;
    d[o + 2] = from.z;
    d[o + 3] = dx / length;
    d[o + 4] = dy / length;
    d[o + 5] = dz / length;
    d[o + 6] = length;
    // Start part-way out so the very first frame already shows a streak.
    d[o + 7] = Math.min(length, streak * 0.6);
    d[o + 8] = streak;
    const c = i * 4;
    this.colors[c] = r;
    this.colors[c + 1] = g;
    this.colors[c + 2] = b;
    this.colors[c + 3] = width;
    this.aColor.needsUpdate = true;
    this.write(i);
    this.flush();
  }

  update(dt: number) {
    if (this.active === 0) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.live[i]) continue;
      const o = i * STRIDE;
      d[o + 7] += SPEED * dt;
      if (d[o + 7] - d[o + 8] >= d[o + 6]) {
        this.live[i] = 0;
        this.active--;
        // Collapse to a point: a zero-area ribbon draws nothing.
        const p = i * 3;
        this.ends[p] = this.starts[p];
        this.ends[p + 1] = this.starts[p + 1];
        this.ends[p + 2] = this.starts[p + 2];
        continue;
      }
      this.write(i);
    }
    this.flush();
  }

  private write(i: number) {
    const d = this.data;
    const o = i * STRIDE;
    const head = Math.min(d[o + 6], d[o + 7]);
    const tail = Math.max(0, d[o + 7] - d[o + 8]);
    const p = i * 3;
    this.starts[p] = d[o] + d[o + 3] * tail;
    this.starts[p + 1] = d[o + 1] + d[o + 4] * tail;
    this.starts[p + 2] = d[o + 2] + d[o + 5] * tail;
    this.ends[p] = d[o] + d[o + 3] * head;
    this.ends[p + 1] = d[o + 1] + d[o + 4] * head;
    this.ends[p + 2] = d[o + 2] + d[o + 5] * head;
  }

  private flush() {
    this.aStart.needsUpdate = true;
    this.aEnd.needsUpdate = true;
    this.mesh.visible = this.active > 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
