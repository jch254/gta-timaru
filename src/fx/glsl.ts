/** The fogFactor three.js computes in <fog_fragment>, for fx fragment shaders that blend fog their own way.
 *  Interpolated directly inside an `#ifdef USE_FOG` block; the text must stay identical in every shader. */
export const FOG_FACTOR_GLSL = `
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif`;
