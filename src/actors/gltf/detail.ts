import * as THREE from 'three';
import type { HumanoidLook } from '../../core/types';
import type { HeadMetrics } from './assets';
import type { Fit } from './tailor';

/**
 * Detail painted in the shader from where a fragment sits on the body in the bind pose (standing, arms out):
 * on skin, a hairline, stubble, colour in the cheeks and nose, age, and hands and knees a shade redder than a
 * forehead; on tops, a collar, cuffs, a button placket, sun-fade across the shoulders and the weave of the
 * cloth. No textures and no extra draw calls: a few lines of arithmetic per fragment, on the
 * materials of levels 0 to 2 only (the far level has its own plain material).
 */

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Development aid, for telling the patch's work from the base texture's: 1 = skin made without the face patch, 2 = and without the deeper normal map. Applies to skins made after it is set. */
export const detailDebug = { plain: 0 };

const BIND_VERTEX = (shader: Shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
};

// ───────────────────────────── faces ─────────────────────────────

export interface Traits {
  /** 0 clean-shaven … 1 a few days' growth. */
  stubble: number;
  /** Colour in the cheeks and nose (weather, sun, drink). */
  flush: number;
  /** 0 young … 1 old: greyer, more uneven skin. */
  age: number;
  /** How much the scalp under the hair takes the hair's colour (1 = a head of hair, low = shaved). */
  scalp: number;
  /** Head a little wider or narrower, longer or shorter than the base (multipliers). */
  wide: number;
  long: number;
}

/** A stable set of features for a look: the same look always gets the same face, and cameos keep theirs. */
export function traitsOf(look: HumanoidLook): Traits {
  let h = (look.skin * 31 + look.hair * 17 + look.top * 13 + look.legs * 7 + look.shoes * 3 + Math.round((look.height ?? 1) * 997) + Math.round((look.bulk ?? 1) * 577)) >>> 0;
  const next = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  const hair = new THREE.Color(look.hair);
  const hsl = { h: 0, s: 0, l: 0 };
  hair.getHSL(hsl);
  const grey = hsl.s < 0.14 && hsl.l > 0.4;
  const skin = new THREE.Color(look.skin);
  const fair = THREE.MathUtils.clamp((skin.r + skin.g + skin.b - 1.2) / 0.9, 0, 1);
  const roll = next();
  const bald = look.hairStyle === 'bald';
  return {
    stubble: look.female ? 0 : grey ? 0.25 * next() : roll < 0.45 ? 0 : roll < 0.8 ? 0.4 : 0.8,
    flush: (0.15 + 0.5 * next()) * (0.5 + 0.5 * fair),
    age: grey ? 0.6 + 0.4 * next() : 0.25 * next(),
    scalp: bald ? (grey ? 0.06 : 0.2) : 1,
    wide: 0.965 + 0.07 * next(),
    long: 0.97 + 0.06 * next(),
  };
}

const SKIN_FRAGMENT = /* glsl */ `
{
  float y = vBind.y - uHead.x;
  float front = smoothstep(uHead.y - 0.085, uHead.y - 0.04, vBind.z);
  // The hairline runs from the top of the forehead down behind the ears to the nape; above it the scalp
  // shows the hair's colour, so a thin or short hairpiece never leaves a bare patch.
  float line = mix(-0.07, 0.052, smoothstep(uHead.z + 0.03, uHead.y - 0.03, vBind.z));
  float scalp = smoothstep(line, line + 0.014, y) * (1.0 - smoothstep(uHead.w + 0.002, uHead.w + 0.008, abs(vBind.x))) * uFace.w;
  float lips = (1.0 - smoothstep(0.016, 0.03, abs(vBind.x))) * (1.0 - smoothstep(0.007, 0.014, abs(y + 0.072)));
  float jaw = smoothstep(-0.03, -0.05, y) * smoothstep(-0.15, -0.125, y) * front * (1.0 - lips);
  vec2 cheek = vec2(abs(vBind.x) - 0.042, y + 0.035);
  float flush = clamp(exp(-dot(cheek, cheek) / 0.0006) + 0.35 * exp(-(vBind.x * vBind.x + (y + 0.03) * (y + 0.03)) / 0.0003), 0.0, 1.0) * front * step(-0.2, y);
  vec3 skin = diffuseColor.rgb;
  float grey = dot(skin, vec3(0.3, 0.5, 0.2));
  skin = mix(skin, skin * vec3(1.13, 0.9, 0.87), flush * uFace.y);
  skin = mix(skin, mix(skin, vec3(grey), 0.45) * 0.8 + uHair * 0.05, jaw * uFace.x * 0.6);
  skin = mix(skin, uHair * 0.9 + skin * 0.1, scalp * 0.85);
  skin = mix(skin, vec3(grey) * vec3(1.05, 0.98, 0.94), uFace.z * 0.24);
  // Hands, knees and elbows: redder and a touch darker than a forehead. Then a faint unevenness all over.
  float worked = max(smoothstep(0.68, 0.76, abs(vBind.x)) * 0.6, (1.0 - smoothstep(0.03, 0.08, abs(vBind.y - 0.5))) * smoothstep(-0.02, 0.03, vBind.z) * 0.5);
  skin = mix(skin, skin * vec3(1.06, 0.88, 0.84), worked);
  skin *= 1.0 + (0.03 + 0.05 * uFace.z) * sin(vBind.x * 93.0 + 1.7) * sin(vBind.y * 71.0) * sin(vBind.z * 113.0 + 0.6);
  diffuseColor.rgb = skin;
}`;

/** Shader patch for a skin material. `key` goes to the program cache: every skin shares one program. */
export const SKIN_PATCH = 'chr-skin-6';
export function skinPatch(head: HeadMetrics, traits: Traits, hair: number): (shader: Shader) => void {
  const face = new THREE.Vector4(traits.stubble, traits.flush, traits.age, traits.scalp);
  const where = new THREE.Vector4(head.eyeY, head.z1, head.skullZ0, head.rx);
  const colour = new THREE.Color(hair);
  return (shader) => {
    shader.uniforms.uFace = { value: face };
    shader.uniforms.uHead = { value: where };
    shader.uniforms.uHair = { value: colour };
    BIND_VERTEX(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nuniform vec4 uFace;\nuniform vec4 uHead;\nuniform vec3 uHair;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SKIN_FRAGMENT}`);
  };
}

// ───────────────────────────── tops ─────────────────────────────

type TopStyle = NonNullable<HumanoidLook['topStyle']>;

/** Trim of each style: collar width (m), collar shade, how white the collar is, placket; cuff width, cuff shade. */
const TRIM: Record<TopStyle, [collar: number, shade: number, white: number, placket: number, cuff: number, cuffShade: number]> = {
  tee: [0.008, 0.8, 0, 0, 0.02, 0.88],
  singlet: [0.006, 0.78, 0, 0, 0, 1],
  jersey: [0.02, 1, 0.9, 0, 0.05, 0.84],
  bushShirt: [0.016, 0.62, 0, 0.5, 0.04, 0.7],
  jacket: [0.02, 0.76, 0, 0.6, 0.045, 0.74],
  uniform: [0.018, 1.1, 0, 1, 0.05, 1.08],
  hiVis: [0.014, 0.55, 0, 0.6, 0.04, 0.6],
};

const TOP_FRAGMENT = /* glsl */ `
{
  float ax = abs(vBind.x);
  float sleeve = smoothstep(uFit.x - 0.01, uFit.x + 0.03, ax);
  float body = 1.0 - sleeve;
  // Cuff, or the hem of a short sleeve.
  float cuff = uCuff.x > 0.0 ? smoothstep(uFit.y - uCuff.x - 0.005, uFit.y - uCuff.x, ax) : 0.0;
  // Collar: a band round the neck opening (a sphere through its edge).
  float neck = length(vBind - vec3(0.0, uNeck.x, uNeck.y)) - uNeck.z;
  float collar = body * step(uFit.z + 0.3, vBind.y) * (1.0 - smoothstep(uCollar.x, uCollar.x + 0.005, neck));
  // Placket down the front with buttons, on the styles that button or zip.
  float centre = body * step(0.03, vBind.z) * (1.0 - collar);
  float placket = centre * (1.0 - smoothstep(0.011, 0.013, ax)) * uCollar.w;
  float button = centre * (1.0 - smoothstep(0.005, 0.007, length(vec2(vBind.x, mod(vBind.y, 0.085) - 0.0425)))) * step(0.9, uCollar.w);
  vec3 cloth = diffuseColor.rgb;
  // Years of sun across the shoulders and the tops of the sleeves.
  float sun = smoothstep(uFit.w - 0.17, uFit.w - 0.03, vBind.y) * 0.4;
  cloth = mix(cloth, cloth * 0.86 + vec3(0.075), sun);
  // The weave, where the camera is close enough to resolve it.
  float thread = sin(vBind.x * 1900.0) * sin(vBind.y * 1900.0) + 0.6 * sin((vBind.y + vBind.z) * 1300.0);
  cloth *= 1.0 + 0.05 * thread * (1.0 - smoothstep(0.5, 1.4, fwidth(vBind.y) * 1900.0));
  cloth *= 1.0 - 0.1 * placket;
  cloth = mix(cloth, cloth * uCuff.y, cuff);
  cloth = mix(cloth, mix(cloth * uCollar.y, vec3(0.86, 0.85, 0.8), uCollar.z), collar);
  cloth = mix(cloth, cloth * 0.35 + vec3(0.25), button);
  diffuseColor.rgb = cloth;
}`;

export const TOP_PATCH = 'chr-top-3';
export function topPatch(fit: Fit, style: TopStyle): (shader: Shader) => void {
  const trim = TRIM[style];
  const sleeveEnd = style === 'tee' ? fit.shortX : fit.cuffX;
  const where = new THREE.Vector4(fit.armholeX, sleeveEnd, fit.hemY, fit.collarY);
  const neck = new THREE.Vector3(fit.neck[0], fit.neck[1], fit.neck[2]);
  const collar = new THREE.Vector4(trim[0], trim[1], trim[2], trim[3]);
  const cuff = new THREE.Vector2(trim[4], trim[5]);
  return (shader) => {
    shader.uniforms.uFit = { value: where };
    shader.uniforms.uNeck = { value: neck };
    shader.uniforms.uCollar = { value: collar };
    shader.uniforms.uCuff = { value: cuff };
    BIND_VERTEX(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nuniform vec4 uFit;\nuniform vec3 uNeck;\nuniform vec4 uCollar;\nuniform vec2 uCuff;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TOP_FRAGMENT}`);
  };
}
