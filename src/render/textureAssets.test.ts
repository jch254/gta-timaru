import { describe, expect, it } from 'vitest';
import { decodeQueue, surfaceUrl } from './textureAssets';
import manifest from '../assets/textures/manifest.json';

describe('texture startup', () => {
  it('resolves each surface and terrain input in the selected tier without an original fallback', () => {
    const files = Object.values(manifest.surfaces).flatMap(s => [s.map, s.normalMap, s.roughnessMap]);
    for (const layer of ['dry', 'rock', 'soil']) files.push(`ground/${layer}_col.jpg`, `ground/${layer}_nor.jpg`);
    for (const file of files) {
      expect(surfaceUrl(file, true)).toContain(`/phone-textures/${file}`);
      expect(surfaceUrl(file, false)).toContain(`/textures/${file}`);
    }
    expect(surfaceUrl('missing.jpg', true)).toBeUndefined();
  });

  it('bounds concurrent decodes, including after a failure', async () => {
    const queue = decodeQueue(3);
    let active = 0, peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => queue(async () => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      if (!i) throw new Error('bad picture');
    })));
    expect(peak).toBe(3);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(11);
  });
});
