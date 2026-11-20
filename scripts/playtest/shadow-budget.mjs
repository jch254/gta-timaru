import assert from 'node:assert/strict';

// Run on a loaded, stationary production game. Render between switches: Three only allocates
// shadow maps when first used, so an unrendered quality toggle cannot detect this leak.
export async function checkShadowBudget(page) {
  const counts = await page.evaluate(async () => {
    const { gfx, clock } = window.dev.ctx;
    const paused = clock.paused, quality = gfx.quality;
    clock.paused = true;
    const samples = [];
    try {
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const tier of ['high', 'low']) {
          gfx.setQuality(tier);
          for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
        }
        samples.push(gfx.renderer.info.memory.textures);
      }
    } finally {
      gfx.setQuality(quality);
      clock.paused = paused;
    }
    return samples;
  });
  console.log('Low-tier texture counts after High/Low cycles:', counts);
  // Allow the first cycle to warm passes, then require a stable low-tier baseline.
  assert.deepEqual(counts.slice(2), [counts[1], counts[1]]);
}
