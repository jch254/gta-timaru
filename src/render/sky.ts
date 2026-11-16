import * as THREE from 'three';
import { clamp01, lerp, smooth } from '../core/math';
import { Rng } from '../core/rng';
import type { Environment, GameClock, WeatherKind } from '../core/types';
import { AIR, CLOUD_BASE, CLOUD_SCALE, CLOUD_TILE, cloudFieldTexture } from './air';
import { type FilmLook, lookFor, NEUTRAL_LOOK } from './film';

interface WeatherParams {
  /** Cloud cover 0..1: the fraction of the sky under cloud. */
  cover: number;
  /** Nor'west arch sheet 0..1. */
  arch: number;
  visibility: number;
  rain: number;
  /** Wind speed m/s and the compass bearing it blows TOWARDS (radians, heading convention). */
  wind: number;
  windTo: number;
  /** 0 = blue sky, 1 = flat grey. */
  grey: number;
  /** Warm (+) / cold (−) tint. */
  warmth: number;
  /** Ground haze: the distance (m) over which it takes out about two thirds of the contrast at ground level… */
  haze: number;
  /** …and the height (m) over which it thins by the same factor. */
  hazeTop: number;
}

// Headings: 0 = +z (south), π/2 = +x (east), π = north, -π/2 = west.
const WEATHER: Record<WeatherKind, WeatherParams> = {
  // Fine day with the usual Canterbury nor'easterly sea breeze and fair-weather cumulus.
  clear: { cover: 0.3, arch: 0, visibility: 14000, rain: 0, wind: 4, windTo: -Math.PI * 0.25, grey: 0, warmth: 0, haze: 7500, hazeTop: 150 },
  // Hot, dry, gusty foehn wind off the Alps with the arch of high cloud, and dust in the air to well above the hills.
  norwester: { cover: 0.1, arch: 1, visibility: 9000, rain: 0, wind: 15, windTo: Math.PI * 0.25, grey: 0.12, warmth: 0.5, haze: 3800, hazeTop: 260 },
  overcast: { cover: 0.92, arch: 0, visibility: 9000, rain: 0, wind: 5, windTo: -Math.PI * 0.25, grey: 0.6, warmth: -0.1, haze: 5500, hazeTop: 200 },
  // Cold front from the south: rain, low cloud.
  southerly: { cover: 1, arch: 0, visibility: 2600, rain: 0.85, wind: 11, windTo: Math.PI, grey: 0.9, warmth: -0.4, haze: 4000, hazeTop: 300 },
  fog: { cover: 0.6, arch: 0, visibility: 260, rain: 0, wind: 0.5, windTo: 0, grey: 0.95, warmth: -0.1, haze: 2500, hazeTop: 80 },
};

const SUNRISE = 6;
const SUNSET = 21; // long summer evenings (NZDT)

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

// The clouds are a slab between a flat base and a ragged top, marched in a few steps along the view ray
// through one small repeating texture (see air.ts), so they have undersides, lit shoulders and sides that
// come into view towards the horizon. CLOUD_STEPS sets the cost: three texture reads for each.
const SKY_FRAG = /* glsl */ `
uniform sampler2D uCloudMap;
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudDark;
uniform float uCover, uArch, uNight, uSunVis, uVeil, uFrame;
uniform vec3 uVeilColor;
uniform vec2 uCloudOrigin;
varying vec3 vDir;
const float INV_TILE = 1.0 / ${CLOUD_TILE.toFixed(1)};
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// How much cloud there is above a point of the cloud plane: the big shapes, fretted at the edges.
// (Explicit gradients: the lookups sit inside branches and a loop, where automatic ones are not defined.)
float field(vec2 uv, vec2 gx, vec2 gy) {
  vec2 p = uv * INV_TILE;
  return textureGrad(uCloudMap, p, gx, gy).r + (textureGrad(uCloudMap, p * 3.0 + 0.37, gx * 3.0, gy * 3.0).g - 0.5) * 0.3;
}
// Density at height s (0 base .. 1 top): only the strong middles of a cloud reach the top.
float density(float f, float s, float thresh) {
  return clamp((f - thresh - 0.36 * s * sqrt(s)) * 5.0, 0.0, 1.0);
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);
  // Where this ray meets the cloud plane, and how fast that moves across the screen.
  vec2 q = d.xz / (h + 0.14) * 1.25;
  vec2 gx = dFdx(q) * INV_TILE;
  vec2 gy = dFdy(q) * INV_TILE;
  // Clear air: deep overhead, paler low down, with a band of haze sitting on the horizon. The sky is a
  // shade deeper looking away from the sun.
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.4));
  col *= 1.0 - 0.16 * (1.0 - sd) * (1.0 - h);
  col = mix(col, uHorizon * 1.12 + 0.02, exp(-h * 16.0) * 0.8);
  col += uSunColor * (pow(sd, 6.0) * 0.06 + pow(sd, 48.0) * 0.25 + pow(sd, 400.0) * 1.2) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 30.0 * uSunVis;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 300.0) * 0.12 + pow(md, 24.0) * 0.012) * uNight;
  if (uNight > 0.05 && d.y > 0.0) {
    vec2 sp = d.xz / (d.y + 0.25) * 110.0;
    float s = hash(floor(sp));
    vec2 c = fract(sp) - 0.5;
    float star = step(0.993, s) * smoothstep(0.35, 0.0, length(c));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, d.y) * (1.0 - uCover) * (0.6 + s);
  }
  if (d.y > 0.0) {
    float low = smoothstep(0.0, 0.1, d.y);

    // Nor'west arch: a sheet of high lenticular cloud lying along the line of the mountains. Its western
    // edge is a straight line in plan, which in the sky is an arch: highest due west, with clear sky under
    // it over the Alps, coming down to the horizon north and south. It thins out past the zenith.
    if (uArch > 0.0) {
      float px = d.x / (d.y + 0.05);
      // (The streak channel is banded along its v axis: lay that across the wind, so the bands run north-south.)
      vec2 stretch = vec2(0.11, 0.3);
      vec2 hq = uCloudOrigin.yx * 0.3 + q.yx * 0.55;
      float bands = smoothstep(0.1, 0.9, textureGrad(uCloudMap, hq * stretch * INV_TILE, gx.yx * 0.55 * stretch, gy.yx * 0.55 * stretch).b);
      float sheet = smoothstep(-2.5, -2.1, px) * (1.0 - smoothstep(-0.9, 1.1, px + (bands - 0.5) * 1.6)) * uArch;
      // Deepest and greyest just behind the leading edge, thin and bright where it frays out; the low sun
      // gets in underneath it and lights the whole underside.
      float body = smoothstep(-2.1, -0.6, px) * (1.0 - smoothstep(-0.6, 1.0, px));
      float under = smoothstep(0.3, 0.02, uSunDir.y) * uSunVis;
      float lit = clamp(0.72 - body * 0.4 + (bands - 0.5) * 0.4 + under * 0.3, 0.0, 1.0);
      vec3 hc = mix(uCloudDark, uCloudLit, lit) * (0.82 + 0.3 * pow(sd, 6.0) * (1.0 - body * 0.6) * uSunVis);
      hc = mix(hc, uHorizon * 1.05, exp(-h * 9.0) * 0.7);
      col = mix(col, hc, sheet * (0.82 + 0.18 * bands) * low);
    }

    float thresh = 1.0 - uCover;
    // Which way the light comes from: a step towards the sun across the field, and up through the slab by
    // day or down through it once the sun is under the horizon (so evening cloud is lit from below).
    vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.085;
    float sunUp = clamp(uSunDir.y * 5.0, -1.0, 1.0);
    float stepTau = 3.6 / float(CLOUD_STEPS * 3) / (d.y * 0.7 + 0.3);
    // A different pattern every frame, and only half a step of it, so what is left of the stepping reads
    // as film grain instead of a fixed screen over the clouds.
    float dither = 0.25 + 0.5 * fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uFrame, vec2(0.06711056, 0.00583715))));
    // The field is read at a few heights up the slab and the density worked out in finer steps between
    // them, so the outline is smooth however few texture reads there are.
    vec2 uv = uCloudOrigin + q;
    float f0 = field(uv, gx, gy);
    float g0 = textureGrad(uCloudMap, (uv + toSun) * INV_TILE, gx, gy).r;
    float through = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 1; i <= CLOUD_STEPS; i++) {
      uv = uCloudOrigin + q * (1.0 + 0.3 * float(i) / float(CLOUD_STEPS));
      float f1 = field(uv, gx, gy);
      float g1 = textureGrad(uCloudMap, (uv + toSun) * INV_TILE, gx, gy).r;
      for (int j = 0; j < 3; j++) {
        float t = (float(j) + dither) / 3.0;
        float s = (float(i - 1) + t) / float(CLOUD_STEPS);
        float f = mix(f0, f1, t);
        float dens = density(f, s, thresh);
        float sunward = density(mix(g0, g1, t), clamp(s + 0.3 * sunUp, 0.0, 1.0), thresh);
        // Sunlight that reaches this point: less of it deep inside and on the side away from the sun.
        float shoulder = mix(1.0 - s, s, 0.5 + 0.5 * sunUp);
        float lit = exp(-sunward * 2.6) * (0.25 + 0.75 * shoulder);
        // Thin cloud lets the light above it through, which is what gives a grey sky its lighter patches.
        lit = max(lit, (1.0 - smoothstep(0.0, 0.6, f - thresh)) * (0.25 + 0.5 * uCover));
        vec3 light = mix(uCloudDark * (0.85 + 0.3 * s), uCloudLit, clamp(lit, 0.0, 1.0));
        float a = 1.0 - exp(-dens * stepTau);
        sum += through * a * light;
        through *= 1.0 - a;
      }
      f0 = f1;
      g0 = g1;
    }
    float c = 1.0 - through;
    vec3 cc = sum / max(c, 1e-3);
    // Edges glow where the sun is behind them.
    cc *= 0.86 + 0.7 * pow(sd, 5.0) * (1.0 - c * 0.7) * uSunVis;
    // Clouds near the horizon sink into the haze.
    cc = mix(cc, uHorizon * 1.05, exp(-h * 9.0) * 0.7);
    col = mix(col, cc, c * low);
  } else {
    col = mix(uHorizon, uGround, smoothstep(0.0, -0.2, d.y));
  }
  // Fog and heavy rain hide the sky as they hide everything else: only the brightest of the sun gets through.
  col = mix(col, uVeilColor, uVeil * (1.0 - 0.55 * smoothstep(0.9975, 0.9998, sd) * uSunVis * 8.0 / (1.0 + uSunVis * 8.0)));
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN_VERT = /* glsl */ `
attribute vec3 seed;
attribute float tip;
uniform float uTime;
uniform vec3 uFall;
uniform vec3 uCam;
uniform float uAmount;
varying float vAlpha;
void main() {
  const float BOX = 44.0;
  vec3 p = seed * BOX + uFall * uTime;
  p = mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5 + uCam;
  p += normalize(uFall) * tip * 0.9;
  // Streaks show best a few metres out: right at the lens they would be long scratches across the picture,
  // and far off a one-pixel line is all aliasing. Light rain draws fewer of them rather than fainter ones.
  float d = length(p - uCam);
  float band = smoothstep(1.2, 4.5, d) * smoothstep(21.0, 8.0, d);
  vAlpha = (1.0 - tip * 0.6) * band * step(fract(seed.x * 91.7 + seed.z * 37.3), uAmount);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(uColor, uOpacity * vAlpha); }`;

// Scratch colours, so a frame allocates nothing.
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
const sun = new THREE.Vector3();

/** Sky dome, sun / moon, weather, haze and image-based lighting. Owns the Environment state. */
export class Atmosphere implements Environment {
  weather: WeatherKind = 'clear';
  night = 0;
  /** 0..1, peaking while the sun is on the horizon. */
  dusk = 0;
  sunDir = new THREE.Vector3(0.4, 0.8, -0.4).normalize();
  rain = 0;
  wetness = 0;
  wind = { x: 0, z: 0 };
  visibility = 14000;

  /** Directional light colour / intensity for the shadow system. */
  lightColor = new THREE.Color(1, 1, 1);
  lightIntensity = 4;
  horizon = new THREE.Color();
  /** How the film grade should print this moment (see film.ts). */
  look: FilmLook = { ...NEUTRAL_LOOK };
  /** Fires when the weather kind changes. */
  onWeather: (kind: WeatherKind) => void = () => undefined;

  private params: WeatherParams = { ...WEATHER.clear };
  private target: WeatherParams = WEATHER.clear;
  private transition = 40;
  private nextChangeHour = 5;
  private rng = new Rng(Date.now() & 0xffff);
  private dome: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;
  private rainMesh: THREE.LineSegments;
  private rainUniforms: Record<string, THREE.IUniform>;
  private ambient = new THREE.AmbientLight(0x8fa4ff, 0);
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private envDirty = true;
  private time = 0;
  private moonDir = new THREE.Vector3();
  private zenith = new THREE.Color();
  private fog: THREE.FogExp2;
  /** How far the wind has carried the cloud field, in cloud-field units. */
  private drift = new THREE.Vector2();

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private clock: GameClock,
    rainDrops: number,
  ) {
    AIR.uCloudMap.value ??= cloudFieldTexture();
    this.uniforms = {
      uCloudMap: AIR.uCloudMap,
      uSunDir: { value: new THREE.Vector3().copy(this.sunDir) },
      uMoonDir: { value: this.moonDir },
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uGround: { value: new THREE.Color(0.2, 0.19, 0.15) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uCloudDark: { value: new THREE.Color(0.5, 0.55, 0.62) },
      uCover: { value: 0.3 },
      uArch: { value: 0 },
      uNight: { value: 0 },
      uSunVis: { value: 1 },
      uVeil: { value: 0 },
      uFrame: { value: 0 },
      uVeilColor: { value: new THREE.Color() },
      uCloudOrigin: { value: new THREE.Vector2() },
    };
    const material = (this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { CLOUD_STEPS: 4 },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }));
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.dome.frustumCulled = false;
    // Drawn after everything solid, at the far plane, so the sky is only shaded where it shows.
    this.dome.renderOrder = 1000;
    scene.add(this.dome, this.ambient);
    this.envScene.add(new THREE.Mesh(this.dome.geometry, material));

    this.fog = new THREE.FogExp2(0xffffff, 0.0002);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // Rain streaks: GPU-animated line segments wrapped in a box around the camera.
    const seeds = new Float32Array(rainDrops * 6);
    const tips = new Float32Array(rainDrops * 2);
    for (let i = 0; i < rainDrops; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      seeds.set([x, y, z, x, y, z], i * 6);
      tips[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rainDrops * 6), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('tip', new THREE.BufferAttribute(tips, 1));
    this.rainUniforms = {
      uTime: { value: 0 },
      uFall: { value: new THREE.Vector3(0, -22, 0) },
      uCam: { value: new THREE.Vector3() },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0.62, 0.67, 0.72) },
      uAmount: { value: 1 },
    };
    this.rainMesh = new THREE.LineSegments(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }),
    );
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);
  }

  /** How many slices the cloud slab is read in: 1 (cheapest) up to about 6. */
  setCloudSteps(steps: number) {
    if (this.skyMaterial.defines.CLOUD_STEPS === steps) return;
    this.skyMaterial.defines.CLOUD_STEPS = steps;
    this.skyMaterial.needsUpdate = true;
    this.envDirty = true;
  }

  setWeather(kind: WeatherKind, transitionSeconds = 40) {
    if (kind !== this.weather) {
      this.weather = kind;
      this.onWeather(kind);
    }
    this.target = WEATHER[kind];
    this.transition = Math.max(0.01, transitionSeconds);
    this.envDirty = true;
    // Weather that has just been set (by a mission, say) holds for a few hours before the schedule moves on.
    this.nextChangeHour = Math.max(this.nextChangeHour, this.clock.day * 24 + this.clock.hour + 4);
  }

  private pickWeather() {
    const h = this.clock.hour;
    const dawn = h > 3 && h < 8;
    const options: [WeatherKind, number][] = [
      ['clear', 42],
      ['norwester', 20],
      ['overcast', 14],
      ['southerly', this.weather === 'norwester' ? 30 : 12], // a southerly change often follows a nor'wester
      ['fog', dawn ? 18 : 2],
    ];
    const choice = this.rng.weighted(
      options.filter(([k]) => k !== this.weather),
      ([, w]) => w,
    )[0];
    this.setWeather(choice, 70);
  }

  update(dt: number, camera: THREE.Camera, envInterval: number) {
    this.time += dt;
    const hour = this.clock.hour;

    // Scheduled weather changes every few in-game hours.
    const absHour = this.clock.day * 24 + hour;
    if (absHour >= this.nextChangeHour) {
      if (this.nextChangeHour > 5) this.pickWeather();
      this.nextChangeHour = absHour + this.rng.range(4, 9);
    }
    const k = 1 - Math.exp(-dt / (this.transition / 3));
    const p = this.params;
    const t = this.target;
    p.cover = lerp(p.cover, t.cover, k);
    p.arch = lerp(p.arch, t.arch, k);
    p.visibility = lerp(p.visibility, t.visibility, k);
    p.rain = lerp(p.rain, t.rain, k);
    p.wind = lerp(p.wind, t.wind, k);
    p.windTo = t.windTo;
    p.grey = lerp(p.grey, t.grey, k);
    p.warmth = lerp(p.warmth, t.warmth, k);
    p.haze = lerp(p.haze, t.haze, k);
    p.hazeTop = lerp(p.hazeTop, t.hazeTop, k);

    // Sun: rises in the east (+x), crosses the NORTHERN sky (−z), sets behind the Alps (−x).
    let sunHeight: number;
    let a: number;
    if (hour >= SUNRISE && hour <= SUNSET) {
      a = (Math.PI * (hour - SUNRISE)) / (SUNSET - SUNRISE);
      sunHeight = Math.sin(a) * 0.9;
    } else {
      const n = (((hour - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE))) * Math.PI;
      a = Math.PI + n;
      sunHeight = -Math.sin(n) * 0.6;
    }
    const el = Math.asin(clamp01(Math.abs(sunHeight))) * Math.sign(sunHeight);
    sun.set(Math.cos(a) * Math.cos(el), Math.sin(el), -Math.sin(a) * Math.cos(el) * 0.85 - 0.15).normalize();
    this.moonDir.set(-sun.x * 0.8, Math.max(0.25, -sun.y + 0.2), 0.45).normalize();

    const day = smooth(-0.08, 0.22, sunHeight);
    const dusk = smooth(0.32, 0.0, Math.abs(sunHeight)) * smooth(-0.25, -0.02, sunHeight);
    this.night = 1 - day;
    this.dusk = dusk;

    // Sky colours (linear HDR).
    const grey = p.grey;
    const zen = this.zenith.setRGB(0.045, 0.16, 0.5).lerp(tmpA.setRGB(0.012, 0.02, 0.06), 1 - day);
    const hor = this.horizon.setRGB(0.46, 0.66, 0.95).lerp(tmpA.setRGB(0.022, 0.034, 0.075), 1 - day);
    zen.lerp(tmpA.setRGB(0.2, 0.22, 0.42), dusk * 0.6);
    hor.lerp(tmpA.setRGB(1.1, 0.5, 0.22), dusk * 0.8);
    const greyLevel = lerp(0.022, 0.62, day);
    // Under cloud at night the sky is not black: the cloud base carries a dull warm glow from the towns below.
    const glow = (1 - day) * 0.022;
    zen.lerp(tmpA.setRGB(greyLevel * 0.8 + glow * 0.5, greyLevel * 0.84 + glow * 0.4, greyLevel * 0.9 + glow * 0.3), grey);
    hor.lerp(tmpA.setRGB(greyLevel + glow * 1.3, greyLevel * 1.02 + glow * 0.9, greyLevel * 1.05 + glow * 0.55), grey);
    if (p.warmth > 0) hor.lerp(tmpA.setRGB(0.95, 0.82, 0.62).multiplyScalar(lerp(0.05, 1, day)), p.warmth * 0.45);
    // The lower hemisphere stands in for sunlit ground: its bounce is what keeps shade from going blue.
    (this.uniforms.uGround.value as THREE.Color).setRGB(0.36, 0.32, 0.25).multiplyScalar(lerp(0.02, 1, day) * lerp(1, 0.5, grey));
    const sunVis = 1 - grey * 0.95;

    const isDay = sunHeight > -0.04;
    this.sunDir.copy(isDay ? sun : this.moonDir);
    const low = smooth(0.35, 0.0, sunHeight);
    if (isDay) {
      this.lightColor.setRGB(1, lerp(0.96, 0.62, low), lerp(0.9, 0.36, low));
      // Clear-sky sun to sky fill is about five to one: hard Canterbury light, shade that is properly dark.
      this.lightIntensity = 4.6 * smooth(-0.04, 0.2, sunHeight) * lerp(1, 0.12, grey);
    } else {
      // Moonlight: cool, low, and direct enough to throw shadows, so the dark has shape instead of being
      // one flat fill.
      this.lightColor.setRGB(0.5, 0.64, 1);
      this.lightIntensity = 0.62 * (1 - grey * 0.75) * smooth(-0.04, -0.2, sunHeight);
    }
    // Warm fill by day; after dark only a little cool fill, so the light pools under the street lamps stand
    // in real darkness but the ground between them can still be read.
    this.ambient.intensity = lerp(0.12, lerp(0.34, 0.58, grey), this.night);
    this.ambient.color.setRGB(lerp(1, 0.36, this.night), lerp(0.95, 0.5, this.night), lerp(0.86, 1, this.night));

    const u = this.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sun);
    const sunColor = u.uSunColor.value as THREE.Color;
    if (isDay) sunColor.copy(this.lightColor);
    else sunColor.setRGB(0, 0, 0);
    u.uCover.value = p.cover;
    u.uArch.value = p.arch;
    u.uNight.value = this.night;
    u.uSunVis.value = sunVis * (isDay ? 1 : 0);
    const cloudBright = lerp(0.045, 1.15, day);
    (u.uCloudLit.value as THREE.Color)
      .setRGB(cloudBright, cloudBright * lerp(1, 0.8, dusk), cloudBright * lerp(1, 0.62, dusk))
      .lerp(tmpA.setRGB(greyLevel * 1.1, greyLevel * 1.1, greyLevel * 1.12), grey * 0.7);
    (u.uCloudDark.value as THREE.Color)
      .setRGB(cloudBright * 0.3, cloudBright * 0.34, cloudBright * 0.42)
      .lerp(tmpA.setRGB(greyLevel * 0.5, greyLevel * 0.53, greyLevel * 0.58), grey);

    // Wind: world vector, and the cloud field carried along by it.
    this.wind.x = Math.sin(p.windTo) * p.wind;
    this.wind.z = Math.cos(p.windTo) * p.wind;
    this.drift.x = (this.drift.x + (this.wind.x * dt) / CLOUD_SCALE + CLOUD_TILE) % CLOUD_TILE;
    this.drift.y = (this.drift.y + (this.wind.z * dt) / CLOUD_SCALE + CLOUD_TILE) % CLOUD_TILE;
    (u.uCloudOrigin.value as THREE.Vector2).set(wrap(camera.position.x / CLOUD_SCALE + this.drift.x), wrap(camera.position.z / CLOUD_SCALE + this.drift.y));

    // Haze. The weather's visibility is the far wall; the ground layer is the air you see through every day.
    this.visibility = p.visibility;
    this.fog.density = 1.95 / p.visibility;
    this.fog.color.copy(hor).lerp(zen, 0.15);
    // Nor'west dust is the colour of the plains it was lifted from.
    if (p.warmth > 0) this.fog.color.lerp(tmpA.setRGB(0.98, 0.83, 0.62).multiplyScalar(lerp(0.04, 0.9, day)), p.warmth * 0.7);
    // (w: how much more the far ranges are hazed than on a clear day; by night they are barely there.)
    AIR.uAirLayer.value.set(1 / p.haze, 1 / p.hazeTop, 0, Math.max(smooth(12000, 2400, p.visibility), this.night * 0.6));
    u.uVeil.value = smooth(4200, 300, p.visibility);
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    (u.uVeilColor.value as THREE.Color).copy(this.fog.color).multiplyScalar(1.06);
    // Looking towards the sun the haze lights up, most of all when the sun is low.
    AIR.uAirGlow.value.copy(this.lightColor).multiplyScalar(isDay ? sunVis * day * lerp(0.22, 0.75, low) * lerp(1, 1.5, clamp01(p.warmth * 2)) : 0.01);

    // Cloud shadows on the ground: only worth having when there is both sun and broken cloud.
    const slant = (CLOUD_BASE * 1.15) / Math.max(this.sunDir.y, 0.25) / CLOUD_SCALE;
    AIR.uCloudField.value.set(
      wrap(this.drift.x + this.sunDir.x * slant) / CLOUD_TILE,
      wrap(this.drift.y + this.sunDir.z * slant) / CLOUD_TILE,
      1 / (CLOUD_SCALE * CLOUD_TILE),
      1 - p.cover + 0.07,
    );
    AIR.uCloudShade.value.set(isDay ? 0.6 * sunVis * smooth(0.97, 0.7, p.cover) : 0.35 * smooth(0.97, 0.7, p.cover), 0.13);

    // Rain and wet roads.
    this.rain = p.rain;
    this.wetness = clamp01(this.wetness + (p.rain > 0.2 ? dt / 20 : -dt / 90));
    this.rainMesh.visible = p.rain > 0.03;
    if (this.rainMesh.visible) {
      const r = this.rainUniforms;
      r.uTime.value = this.time;
      (r.uFall.value as THREE.Vector3).set(this.wind.x * 0.7, -24, this.wind.z * 0.7);
      (r.uCam.value as THREE.Vector3).copy(camera.position);
      r.uOpacity.value = lerp(0.16, 0.4, day);
      r.uAmount.value = clamp01(p.rain * 1.15);
    }

    // What every library material may read (see air.ts).
    AIR.uSunDirection.value.copy(this.sunDir);
    AIR.uSunLight.value.copy(this.lightColor).multiplyScalar(this.lightIntensity);
    AIR.uNightness.value = this.night;
    AIR.uWetness.value = this.wetness;
    AIR.uRainfall.value = this.rain;
    AIR.uWorldTime.value = this.time % 3600;
    AIR.uSkyHorizon.value.copy(hor);
    AIR.uSkyZenith.value.copy(zen);

    lookFor(p.warmth, grey, this.night, dusk, clamp01(1 - (p.visibility - 250) / 1500), this.look);

    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera instanceof THREE.PerspectiveCamera ? camera.far * 0.9 : 9000);

    // Image-based lighting from the sky itself.
    this.envTimer -= dt;
    if (this.envTimer <= 0 || (this.envDirty && this.envTimer < envInterval - 1.5)) {
      this.envTimer = envInterval;
      this.envDirty = false;
      const previous = this.envTarget;
      // Light the world with a less saturated sky than the one on screen: a display-blue zenith makes
      // every shadow navy, where real shade is filled by bounce light as much as by sky.
      tmpA.copy(zen);
      tmpB.copy(hor);
      greyed(zen, 0.76);
      greyed(hor, 0.5);
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
      zen.copy(tmpA);
      hor.copy(tmpB);
      this.scene.environment = this.envTarget.texture;
      previous?.dispose();
    }
    // Overcast skies light the world almost entirely by the sky, so the fill comes up as the sun goes in.
    this.scene.environmentIntensity = lerp(lerp(0.9, 0.98, p.grey), 0.6, this.night);
    void this.renderer;
  }
}

/** Into one tile of the cloud field. */
const wrap = (v: number) => ((v % CLOUD_TILE) + CLOUD_TILE) % CLOUD_TILE;

const greyed = (c: THREE.Color, amount: number) => {
  const l = c.r * 0.3 + c.g * 0.5 + c.b * 0.2;
  c.r = lerp(c.r, l, amount);
  c.g = lerp(c.g, l, amount);
  c.b = lerp(c.b, l * 1.06, amount);
};
