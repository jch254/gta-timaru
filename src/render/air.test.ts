import { describe, expect, it } from 'vitest';
import { bakeCloudField } from './air';

describe('cloud field', () => {
  const size = 64;
  const field = bakeCloudField(size);

  it('keeps every channel inside 0..1', () => {
    for (const channel of [field.shape, field.detail, field.streak, field.shadow]) {
      expect(channel.length).toBe(size * size);
      for (const v of channel) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('makes a coverage threshold mean a fraction of the sky', () => {
    for (const channel of [field.shape, field.shadow]) {
      for (const cover of [0.1, 0.3, 0.9]) {
        const above = channel.reduce((n, v) => n + (v > 1 - cover ? 1 : 0), 0) / channel.length;
        expect(Math.abs(above - cover)).toBeLessThan(0.02);
      }
    }
  });

  it('tiles: the seam is no rougher than the middle', () => {
    const step = (channel: Float32Array, x0: number, x1: number) => {
      let sum = 0;
      for (let j = 0; j < size; j++) sum += Math.abs(channel[j * size + x0] - channel[j * size + x1]);
      return sum / size;
    };
    for (const channel of [field.shape, field.detail, field.shadow]) {
      let inside = 0;
      for (let i = 0; i < size - 1; i++) inside += step(channel, i, i + 1);
      inside /= size - 1;
      expect(step(channel, size - 1, 0)).toBeLessThan(inside * 1.8);
      // Top and bottom rows meet as well.
      let seam = 0;
      for (let i = 0; i < size; i++) seam += Math.abs(channel[i] - channel[(size - 1) * size + i]);
      expect(seam / size).toBeLessThan(inside * 2.2);
    }
  });

  it('gives the ground a smoother field than the sky', () => {
    const rough = (channel: Float32Array) => {
      let sum = 0;
      for (let k = 0; k < channel.length - 1; k++) sum += Math.abs(channel[k + 1] - channel[k]);
      return sum;
    };
    expect(rough(field.shadow)).toBeLessThan(rough(field.shape));
  });
});
