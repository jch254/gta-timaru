import { describe, expect, it } from 'vitest';
import { presetFor, QUALITY } from './quality';

describe('quality presets', () => {
  it('leaves every level alone off a phone', () => {
    for (const level of ['low', 'medium', 'high', 'ultra'] as const) expect(presetFor(level, false)).toBe(QUALITY[level]);
  });

  it("makes a phone's Low sharper and lighter than a desktop's", () => {
    const desk = QUALITY.low;
    const phone = presetFor('low', true);
    // Sharper: a 3x screen is not drawn at one pixel per CSS pixel, and dynamic resolution has room to drop.
    expect(phone.pixelRatio).toBeGreaterThanOrEqual(1.5);
    expect(phone.pixelRatio).toBeLessThanOrEqual(2);
    expect(phone.pixelRatio * phone.minScale).toBeGreaterThanOrEqual(1);
    // Lighter everywhere else, and nothing a phone cannot afford switched on.
    expect(phone.cascades).toBe(1);
    expect(phone.shadowFar).toBeLessThan(desk.shadowFar);
    expect(phone.shadowFilter).toBe('plain');
    expect(phone.ao).toBe('off');
    expect(phone.bloom).toBe(false);
    expect(phone.smaa).toBe(false);
    expect(phone.chunkRadius).toBeLessThan(desk.chunkRadius);
    expect(phone.detailRange).toBeLessThan(1);
    expect(phone.crowd).toBeLessThan(1);
    expect(phone.anisotropy).toBeLessThanOrEqual(2);
  });

  it('only sharpens the other levels on a phone', () => {
    for (const level of ['medium', 'high', 'ultra'] as const) {
      const phone = presetFor(level, true);
      expect(phone.pixelRatio).toBeGreaterThanOrEqual(1.5);
      expect(phone.cascades).toBe(QUALITY[level].cascades);
      expect(phone.chunkRadius).toBe(QUALITY[level].chunkRadius);
      expect(phone.crowd).toBe(1);
    }
  });

  it('hands back the same object each time (it is asked for every frame)', () => {
    expect(presetFor('low', true)).toBe(presetFor('low', true));
  });
});
