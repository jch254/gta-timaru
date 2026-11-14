import * as THREE from 'three';
import { clamp01, lerp, smooth } from '../core/math';
import { Rng } from '../core/rng';
import type { Environment, GameClock, WeatherKind } from '../core/types';

interface WeatherParams {
  /** Cloud cover 0..1. */
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
}

// Headings: 0 = +z (south), π/2 = +x (east), π = north, -π/2 = west.
const WEATHER: Record<WeatherKind, WeatherParams> = {
  // Fine day with the usual Canterbury nor'easterly sea breeze.
  clear: { cover: 0.28, arch: 0, visibility: 14000, rain: 0, wind: 4, windTo: -Math.PI * 0.25, grey: 0, warmth: 0 },
  // Hot, dry, gusty foehn wind off the Alps with the arch of high cloud.
  norwester: { cover: 0.12, arch: 1, visibility: 9000, rain: 0, wind: 15, windTo: Math.PI * 0.25, grey: 0.12, warmth: 0.5 },
  overcast: { cover: 0.9, arch: 0, visibility: 9000, rain: 0, wind: 5, windTo: -Math.PI * 0.25, grey: 0.6, warmth: -0.1 },
  // Cold front from the south: rain, low cloud.
  southerly: { cover: 1, arch: 0, visibility: 2600, rain: 0.85, wind: 11, windTo: Math.PI, grey: 0.9, warmth: -0.4 },
  fog: { cover: 0.6, arch: 0, visibility: 260, rain: 0, wind: 0.5, windTo: 0, grey: 0.95, warmth: -0.1 },
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

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudDark;
uniform float uTime, uCover, uArch, uNight, uSunVis;
uniform vec2 uWind;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return s;
}
// Cloud density at a point on the cloud plane: big soft masses, broken up at the edges.
float cloud(vec2 uv, vec2 warp) {
  return fbm(uv + warp) * 0.76 + fbm(uv * 3.7 + warp * 2.3 + 40.0) * 0.24;
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);
  // Clear air: deep overhead, paler low down, with a band of haze sitting on the horizon. The sky is a
  // shade deeper looking away from the sun.
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.4));
  col *= 1.0 - 0.16 * (1.0 - sd) * (1.0 - h);
  col = mix(col, uHorizon * 1.12 + 0.02, exp(-h * 16.0) * 0.8);
  col += uSunColor * (pow(sd, 6.0) * 0.06 + pow(sd, 48.0) * 0.25 + pow(sd, 400.0) * 1.2) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 30.0 * uSunVis;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 300.0) * 0.12) * uNight;
  if (uNight > 0.05 && d.y > 0.0) {
    vec2 sp = d.xz / (d.y + 0.25) * 110.0;
    float s = hash(floor(sp));
    vec2 c = fract(sp) - 0.5;
    float star = step(0.993, s) * smoothstep(0.35, 0.0, length(c));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, d.y) * (1.0 - uCover) * (0.6 + s);
  }
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.14) * 1.25 + uWind * uTime;
    vec2 warp = vec2(fbm(uv * 0.6 + 3.1), fbm(uv * 0.6 + 7.7)) * 0.9;
    float n = cloud(uv, warp);
    float thresh = 1.0 - uCover;
    float c = smoothstep(thresh - 0.04, thresh + 0.17, n);
    // Lit from the sun's side: compare with the density a step towards the sun, so each mass gets a bright
    // shoulder and a shaded base instead of being one flat tone.
    vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.11;
    float ahead = cloud(uv + toSun, warp);
    float shade = clamp(0.55 + (n - ahead) * 3.4, 0.0, 1.0);
    // Nor'west arch: a sheet of high cloud with a clean curved edge above the western horizon.
    float west = clamp(-d.x / max(length(d.xz), 1e-3), 0.0, 1.0);
    float edge = mix(1.25, 0.2, west * west);
    float sheet = smoothstep(edge - 0.02, edge + 0.12, d.y) * uArch;
    c = max(c, sheet * (0.7 + 0.3 * n));
    c *= smoothstep(0.0, 0.1, d.y);
    // Thick middles are darker underneath; thin edges glow where the sun is behind them.
    float thick = smoothstep(thresh + 0.05, thresh + 0.4, n);
    float lit = clamp(shade * (1.0 - thick * 0.45) + (1.0 - c) * 0.35, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc *= 0.82 + 0.75 * pow(sd, 5.0) * (1.0 - thick * 0.7) * uSunVis;
    // Clouds near the horizon sink into the haze.
    cc = mix(cc, uHorizon * 1.05, exp(-h * 9.0) * 0.7);
    col = mix(col, cc, c);
  } else {
    col = mix(uHorizon, uGround, smoothstep(0.0, -0.2, d.y));
  }
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

/** Sky dome, sun / moon, weather, fog and image-based lighting. Owns the Environment state. */
export class Atmosphere implements Environment {
  weather: WeatherKind = 'clear';
  night = 0;
  sunDir = new THREE.Vector3(0.4, 0.8, -0.4).normalize();
  rain = 0;
  wetness = 0;
  wind = { x: 0, z: 0 };
  visibility = 14000;

  /** Directional light colour / intensity for the shadow system. */
  lightColor = new THREE.Color(1, 1, 1);
  lightIntensity = 4;
  horizon = new THREE.Color();
  /** Fires when the weather kind changes. */
  onWeather: (kind: WeatherKind) => void = () => undefined;

  private params: WeatherParams = { ...WEATHER.clear };
  private target: WeatherParams = WEATHER.clear;
  private transition = 40;
  private nextChangeHour = 5;
  private rng = new Rng(Date.now() & 0xffff);
  private dome: THREE.Mesh;
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

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private clock: GameClock,
    rainDrops: number,
  ) {
    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uGround: { value: new THREE.Color(0.2, 0.19, 0.15) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uCloudDark: { value: new THREE.Color(0.5, 0.55, 0.62) },
      uTime: { value: 0 },
      uCover: { value: 0.3 },
      uArch: { value: 0 },
      uNight: { value: 0 },
      uSunVis: { value: 1 },
      uWind: { value: new THREE.Vector2(0.004, 0.002) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
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
    const sun = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), -Math.sin(a) * Math.cos(el) * 0.85 - 0.15).normalize();
    this.moonDir.set(-sun.x * 0.8, Math.max(0.25, -sun.y + 0.2), 0.45).normalize();

    const day = smooth(-0.08, 0.22, sunHeight);
    const dusk = smooth(0.32, 0.0, Math.abs(sunHeight)) * smooth(-0.25, -0.02, sunHeight);
    this.night = 1 - day;

    // Sky colours (linear HDR).
    const grey = p.grey;
    const zen = this.zenith.setRGB(0.045, 0.16, 0.5).lerp(new THREE.Color(0.02, 0.03, 0.09), 1 - day);
    const hor = this.horizon.setRGB(0.46, 0.66, 0.95).lerp(new THREE.Color(0.035, 0.05, 0.1), 1 - day);
    zen.lerp(new THREE.Color(0.2, 0.22, 0.42), dusk * 0.6);
    hor.lerp(new THREE.Color(1.1, 0.5, 0.22), dusk * 0.8);
    const greyLevel = lerp(0.03, 0.62, day);
    zen.lerp(new THREE.Color(greyLevel * 0.8, greyLevel * 0.84, greyLevel * 0.9), grey);
    hor.lerp(new THREE.Color(greyLevel, greyLevel * 1.02, greyLevel * 1.05), grey);
    if (p.warmth > 0) hor.lerp(new THREE.Color(0.95, 0.82, 0.62).multiplyScalar(lerp(0.05, 1, day)), p.warmth * 0.45);
    // The lower hemisphere stands in for sunlit ground: its bounce is what keeps shade from going blue.
    (this.uniforms.uGround.value as THREE.Color).setRGB(0.36, 0.32, 0.25).multiplyScalar(lerp(0.02, 1, day) * lerp(1, 0.5, grey));
    const sunVis = 1 - grey * 0.95;

    const isDay = sunHeight > -0.04;
    this.sunDir.copy(isDay ? sun : this.moonDir);
    if (isDay) {
      const low = smooth(0.35, 0.0, sunHeight);
      this.lightColor.setRGB(1, lerp(0.96, 0.62, low), lerp(0.9, 0.36, low));
      // Clear-sky sun to sky fill is about five to one: hard Canterbury light, shade that is properly dark.
      this.lightIntensity = 4.6 * smooth(-0.04, 0.2, sunHeight) * lerp(1, 0.12, grey);
    } else {
      this.lightColor.setRGB(0.55, 0.66, 1);
      this.lightIntensity = 0.5 * (1 - grey * 0.7) * smooth(-0.04, -0.2, sunHeight);
    }
    this.ambient.intensity = lerp(0.12, 0.8, this.night);
    // Warm fill by day, cool moonlit blue at night.
    this.ambient.color.setRGB(lerp(1, 0.42, this.night), lerp(0.95, 0.56, this.night), lerp(0.86, 1, this.night));

    const u = this.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sun);
    (u.uSunColor.value as THREE.Color).copy(isDay ? this.lightColor : new THREE.Color(0, 0, 0));
    u.uCover.value = p.cover;
    u.uArch.value = p.arch;
    u.uNight.value = this.night;
    u.uSunVis.value = sunVis * (isDay ? 1 : 0);
    u.uTime.value = this.time;
    const cloudBright = lerp(0.06, 1.15, day);
    (u.uCloudLit.value as THREE.Color).setRGB(cloudBright, cloudBright * lerp(1, 0.8, dusk), cloudBright * lerp(1, 0.62, dusk)).lerp(new THREE.Color(greyLevel * 1.1, greyLevel * 1.1, greyLevel * 1.12), grey * 0.7);
    (u.uCloudDark.value as THREE.Color).setRGB(cloudBright * 0.5, cloudBright * 0.54, cloudBright * 0.62).lerp(new THREE.Color(greyLevel * 0.55, greyLevel * 0.57, greyLevel * 0.6), grey);

    // Wind: world vector plus cloud drift.
    this.wind.x = Math.sin(p.windTo) * p.wind;
    this.wind.z = Math.cos(p.windTo) * p.wind;
    (u.uWind.value as THREE.Vector2).set(this.wind.x * 0.0012, this.wind.z * 0.0012);

    // Haze.
    this.visibility = p.visibility;
    this.fog.density = 1.95 / p.visibility;
    this.fog.color.copy(hor).lerp(zen, 0.15);

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
      const keepZenith = zen.clone();
      const keepHorizon = hor.clone();
      const grey = (c: THREE.Color, amount: number) => {
        const l = c.r * 0.3 + c.g * 0.5 + c.b * 0.2;
        c.lerp(new THREE.Color(l, l, l * 1.06), amount);
      };
      grey(zen, 0.76);
      grey(hor, 0.5);
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
      zen.copy(keepZenith);
      hor.copy(keepHorizon);
      this.scene.environment = this.envTarget.texture;
      previous?.dispose();
    }
    // Overcast skies light the world almost entirely by the sky, so the fill comes up as the sun goes in.
    this.scene.environmentIntensity = lerp(lerp(0.9, 0.98, p.grey), 0.6, this.night);
    void this.renderer;
  }
}
