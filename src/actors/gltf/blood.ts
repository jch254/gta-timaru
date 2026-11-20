import type * as THREE from 'three';

/**
 * Blood soaked into a figure's clothes and skin, painted in the shader from where a fragment sits on the body
 * in the bind pose (so a stain stays put on the shirt however the figure moves). Up to `WOUNDS` stains, each a
 * ragged patch that runs further downward than up, darker and glossier (wet) at the heart; and soot over the
 * whole figure for someone caught by a blast. Only a hurt figure pays for it: it is given its own copies of its
 * materials (see `LookMaterials.bloody`), the rest of the crowd keeps the shared, unpatched ones.
 */

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Stains a figure can carry at once (the oldest is reused). */
export const WOUNDS = 6;

/** Per figure: wounds as (x, y, z in the bind pose, radius), and soot 0..1. Shared by that figure's materials. */
export interface BloodUniforms {
  uWounds: { value: Float32Array };
  uSoot: { value: number };
}

export function bloodUniforms(): BloodUniforms {
  return { uWounds: { value: new Float32Array(WOUNDS * 4) }, uSoot: { value: 0 } };
}

const BLOOD_PARS = /* glsl */ `
uniform vec4 uWounds[${WOUNDS}];
uniform float uSoot;
float bloodHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float bloodNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bloodHash(i), bloodHash(i + vec3(1, 0, 0)), f.x), mix(bloodHash(i + vec3(0, 1, 0)), bloodHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bloodHash(i + vec3(0, 0, 1)), bloodHash(i + vec3(1, 0, 1)), f.x), mix(bloodHash(i + vec3(0, 1, 1)), bloodHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const BLOOD_FRAGMENT = /* glsl */ `
  float bloodN = bloodNoise(vBind * 34.0) * 0.6 + bloodNoise(vBind * 97.0) * 0.4;
  float bloodMask = 0.0;
  float bloodCore = 0.0;
  for (int i = 0; i < ${WOUNDS}; i++) {
    vec4 w = uWounds[i];
    if (w.w <= 0.0) continue;
    vec3 d = vBind - w.xyz;
    // Soaks down the cloth: reaches further below the wound than above or across it.
    d.y *= d.y < 0.0 ? 0.42 : 1.35;
    float r = w.w * (0.7 + 0.6 * bloodN);
    float l = length(d);
    bloodMask = max(bloodMask, 1.0 - smoothstep(r * 0.72, r, l));
    bloodCore = max(bloodCore, 1.0 - smoothstep(0.0, r * 0.6, l));
  }
  if (uSoot > 0.0) {
    float soot = uSoot * smoothstep(0.25, 0.75, bloodNoise(vBind * 13.0) * 0.7 + bloodN * 0.3 + uSoot * 0.35);
    diffuseColor.rgb *= 1.0 - 0.85 * soot;
  }
  // Fresh blood on cloth: a deep red that goes near black where it is thickest.
  vec3 bloodRgb = mix(vec3(0.13, 0.008, 0.007), vec3(0.045, 0.003, 0.003), bloodCore) * (0.8 + 0.4 * bloodN);
  diffuseColor.rgb = mix(diffuseColor.rgb, bloodRgb, bloodMask * 0.94);
`;

/**
 * Add the stains to a figure material's shader. `bind`: the material's own patch has not declared and set
 * `vBind` (the bind-pose position), so this one must.
 */
export function bloodPatch(uniforms: BloodUniforms, bind: boolean): (shader: Shader) => void {
  return (shader) => {
    shader.uniforms.uWounds = uniforms.uWounds;
    shader.uniforms.uSoot = uniforms.uSoot;
    if (bind) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${bind ? 'varying vec3 vBind;\n' : ''}${BLOOD_PARS}`)
      // After the colour and any detail the material's own patch painted; wet where it is soaked.
      .replace('#include <roughnessmap_fragment>', `${BLOOD_FRAGMENT}\n#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, bloodMask * 0.85);`);
  };
}

/** Program cache keys: one program per kind of figure material, whoever's blood it shows. */
export const BLOOD_PATCH = 'chr-blood-1';
