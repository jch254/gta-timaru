import { describe, expect, it } from 'vitest';
import { bloodPatch, bloodUniforms, WOUNDS } from './blood';

const shader = () => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n}',
});

describe('blood on clothes', () => {
  it('reads the figure’s own wounds and soot, and paints them before the roughness is used', () => {
    const uniforms = bloodUniforms();
    expect(uniforms.uWounds.value).toHaveLength(WOUNDS * 4);
    const s = shader();
    bloodPatch(uniforms, true)(s as never);
    expect(s.uniforms.uWounds).toBe(uniforms.uWounds);
    expect(s.uniforms.uSoot).toBe(uniforms.uSoot);
    expect(s.vertexShader).toContain('vBind = position;');
    expect(s.fragmentShader).toContain(`uniform vec4 uWounds[${WOUNDS}]`);
    // Wet where it is soaked: after the stain is worked out, before the roughness is read.
    const stain = s.fragmentShader.indexOf('bloodMask = max');
    const rough = s.fragmentShader.indexOf('roughnessFactor = mix');
    expect(stain).toBeGreaterThan(s.fragmentShader.indexOf('#include <color_fragment>'));
    expect(rough).toBeGreaterThan(stain);
  });

  it('leaves the bind-pose varying to a material whose own patch already sets it', () => {
    const s = shader();
    bloodPatch(bloodUniforms(), false)(s as never);
    expect(s.vertexShader).not.toContain('vBind');
    expect(s.fragmentShader).not.toContain('varying vec3 vBind');
    expect(s.fragmentShader).toContain('vBind');
  });
});
