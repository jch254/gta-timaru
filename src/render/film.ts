import { BlendFunction, type BloomEffect, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

/**
 * How the picture should be printed right now. Written by the atmosphere from the weather and the time of
 * day, read by the grade. Every field is a plain number so the two can be blended and tested.
 */
export interface FilmLook {
  /** White balance: + warm (nor'wester dust, late sun), − cold (southerly). About −1..1. */
  temperature: number;
  /** Overall colour saturation, 1 = as rendered. */
  saturation: number;
  /** Strength of the S-shaped print curve, 0 = straight line. */
  contrast: number;
  /** How far black sits above zero (0..0.06). */
  lift: number;
  /** Split toning: cool shadows and warm highlights, 0 = none, 1 = the daylight amount. */
  split: number;
  /** 0 by day, 1 at night: highlights lean sodium-orange, shadows blue. */
  night: number;
  /** Corner darkening, 0 = none. */
  vignette: number;
  /** Grain amplitude in display units (about 0.02). */
  grain: number;
  /** Red-orange skirt on the brightest highlights (see `filmBloom`). */
  halation: number;
}

export const NEUTRAL_LOOK: FilmLook = { temperature: 0, saturation: 1, contrast: 0, lift: 0, split: 0, night: 0, vignette: 0, grain: 0, halation: 0 };

/**
 * The look for a moment of weather. `warmth` −1..1 and `grey` 0..1 come from the weather, `night` and `dusk`
 * 0..1 from the sun, `murk` 0..1 is how close in the visibility has come (fog, heavy rain).
 */
export function lookFor(warmth: number, grey: number, night: number, dusk: number, murk: number, out: FilmLook = { ...NEUTRAL_LOOK }): FilmLook {
  const day = 1 - night;
  // Daylight film leans a touch warm; the weather pushes it either way and low sun adds to it.
  out.temperature = 0.14 * day + warmth * 0.75 + dusk * 0.25 - night * 0.12;
  // Colour comes down from the digital saturation the textures arrive with; flat light takes more out.
  out.saturation = 1.04 * (1 - grey * 0.14) * (1 - murk * 0.12) * (1 - night * 0.06);
  // Hard light takes a firm curve, flat light a gentle one, and fog is nearly straight.
  out.contrast = (0.38 - grey * 0.14) * (1 - murk * 0.7) + night * 0.06;
  out.lift = 0.012 + murk * 0.02 - night * 0.003;
  out.split = (1 - grey * 0.45) * (1 - murk * 0.5) + dusk * 0.5;
  out.night = night;
  out.vignette = 0.085 + night * 0.035;
  // Fast stock after dark: a little more grain.
  out.grain = 0.017 + night * 0.007;
  out.halation = 1;
  return out;
}

const GRADE_FRAG = /* glsl */ `
uniform vec3 balance;
uniform vec3 shadowTint;
uniform vec3 highTint;
uniform vec4 tone;
uniform vec3 lens;

float grainHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Display-referred, gamma-encoded colour: the grade works where the eye does.
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0) * balance;

  // Saturation, with the two colours a renderer overdoes pulled back further: the lime of lit grass and
  // the pure red of brick and paint. Green also leans a little towards olive, as print stock renders it.
  float l = luminance(c);
  float green = c.g - max(c.r, c.b);
  float red = c.r - max(c.g, c.b);
  float sat = tone.z * (1.0 - 0.24 * smoothstep(0.0, 0.2, green) - 0.13 * smoothstep(0.04, 0.4, red));
  c = l + (c - l) * sat;
  float olive = max(green, 0.0) * 0.18;
  c.r += olive;
  c.g -= olive * 0.35;
  c = clamp(c, 0.0, 1.0);

  // The print curve: steeper through the middle, rolling off into the toe and the shoulder.
  c = mix(c, c * c * (3.0 - 2.0 * c), tone.x);

  // Split toning: shadows go cool, highlights warm.
  l = luminance(c);
  c += shadowTint * (1.0 - smoothstep(0.0, 0.42, l)) + highTint * smoothstep(0.45, 1.0, l);

  // Black sits a little above zero, as it does on a print.
  c = tone.y + c * (1.0 - tone.y);

  // Lens falloff towards the corners.
  vec2 q = (uv - 0.5) * vec2(mix(1.0, aspect, 0.6), 1.0);
  float fall = 1.0 + dot(q, q) * lens.x;
  c /= fall * fall;

  // Grain: finest in the mid-tones, fading out of the highlights, new every frame.
  vec2 px = floor(uv * resolution) + fract(time * vec2(7.31, 3.17)) * vec2(613.0, 977.0);
  float n = grainHash(px) + grainHash(px + 71.7) - 1.0;
  float amount = lens.y * (1.0 - 0.6 * smoothstep(0.55, 1.0, l)) * (0.5 + 0.5 * smoothstep(0.0, 0.18, l));
  #ifdef GRADE_FULL
    vec3 chroma = vec3(grainHash(px + 19.3), grainHash(px + 43.1), grainHash(px + 5.9)) - 0.5;
    c += amount * (n + chroma * 0.4);
  #else
    c += amount * n;
  #endif

  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`;

/**
 * The film grade: white balance, saturation, print curve, split toning, lifted blacks, lens falloff and
 * grain in one shader. It is merged into the final full-screen pass, so it adds no pass of its own.
 */
export class FilmGradeEffect extends Effect {
  private balance: THREE.Vector3;
  private shadowTint: THREE.Vector3;
  private highTint: THREE.Vector3;
  private tone: THREE.Vector4;
  private lens: THREE.Vector3;

  /** `full` adds colour to the grain; without it the grade is at its cheapest. */
  constructor(full: boolean) {
    super('FilmGradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['balance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3())],
        ['highTint', new THREE.Uniform(new THREE.Vector3())],
        ['tone', new THREE.Uniform(new THREE.Vector4(0, 0, 1, 0))],
        ['lens', new THREE.Uniform(new THREE.Vector3())],
      ]),
      defines: new Map<string, string>(full ? [['GRADE_FULL', '1']] : []),
    });
    this.inputColorSpace = THREE.SRGBColorSpace;
    this.balance = this.uniforms.get('balance')!.value;
    this.shadowTint = this.uniforms.get('shadowTint')!.value;
    this.highTint = this.uniforms.get('highTint')!.value;
    this.tone = this.uniforms.get('tone')!.value;
    this.lens = this.uniforms.get('lens')!.value;
  }

  setLook(look: FilmLook) {
    const t = look.temperature;
    // Warm = more red, less blue, with green held so brightness does not move.
    this.balance.set(1 + 0.045 * t, 1 + 0.004 * t, 1 - 0.07 * t);
    const s = look.split;
    const n = look.night;
    // Zero-luminance tints (they change colour, not brightness). After dark the warm end is sodium orange
    // and the cool end a deeper blue.
    this.shadowTint.set(-0.012 - 0.006 * n, 0.001, 0.02 + 0.014 * n).multiplyScalar(s);
    this.highTint.set(0.02 + 0.02 * n, 0.004 - 0.002 * n, -0.03 - 0.03 * n).multiplyScalar(s);
    this.tone.set(look.contrast, look.lift, look.saturation, 0);
    this.lens.set(look.vignette * 1.3, look.grain, 0);
  }
}

const BLOOM_FRAG = /* glsl */ `
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D map;
#else
uniform lowp sampler2D map;
#endif
uniform float intensity;
uniform float halation;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 glow = texture2D(map, uv);
  // Halation: the faint outer skirt of a bright highlight goes red-orange, as light scattered back through
  // the film base does. The hot core of the glow stays its own colour.
  float level = max(glow.r, max(glow.g, glow.b));
  vec3 skirt = mix(vec3(1.5, 0.62, 0.3), vec3(1.0), smoothstep(0.0, 0.55, level));
  outputColor = vec4(glow.rgb * mix(vec3(1.0), skirt, halation) * intensity, glow.a);
}`;

/** Turn a stock bloom into bloom with halation. Costs nothing: it re-tints the glow the bloom already has. */
export function filmBloom(bloom: BloomEffect): THREE.Uniform<number> {
  const halation = new THREE.Uniform(1);
  bloom.uniforms.set('halation', halation);
  // (Protected in the typings, public in the library: this is how an effect's shader is swapped.)
  (bloom as unknown as { setFragmentShader(shader: string): void }).setFragmentShader(BLOOM_FRAG);
  return halation;
}

const SHARPEN_FRAG = /* glsl */ `
uniform float amount;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  // Contrast-adaptive: soft texture is sharpened, an edge that already has contrast is left alone, so
  // nothing rings and anti-aliased edges stay smooth.
  vec3 room = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, vec3(1e-3)), 0.0, 1.0));
  vec3 k = room * (-amount / 5.0);
  outputColor = vec4(clamp((c + (n + s + e + w) * k) / (1.0 + 4.0 * k), 0.0, 1.0), inputColor.a);
}`;

/**
 * A light sharpening of the anti-aliased picture, to win back the crispness lost to texture filtering and to
 * rendering below the screen's own resolution. Five texture reads; it shares a pass with the grade.
 */
export class SharpenEffect extends Effect {
  readonly amount: THREE.Uniform<number>;
  constructor(amount: number) {
    const uniform = new THREE.Uniform(amount);
    super('SharpenEffect', SHARPEN_FRAG, { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map<string, THREE.Uniform>([['amount', uniform]]) });
    this.amount = uniform;
  }
}
