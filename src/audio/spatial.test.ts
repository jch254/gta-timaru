import { describe, expect, it } from 'vitest';
import { Bank } from './bank';
import { MAX_DISTANCE, airCutoff, allocateVoice, attenuation, panFor, spatialize, type Listener, type VoiceSlot } from './spatial';

const here: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };

describe('distance and pan', () => {
  it('is full level inside the reference distance and silent at the cull distance', () => {
    expect(attenuation(0, 10)).toBe(1);
    expect(attenuation(10, 10)).toBe(1);
    expect(attenuation(20, 10)).toBeCloseTo(0.5, 5);
    expect(attenuation(MAX_DISTANCE, 10)).toBe(0);
    expect(attenuation(MAX_DISTANCE + 50, 10)).toBe(0);
  });

  it('falls monotonically and reaches zero smoothly', () => {
    let prev = 1;
    for (let d = 0; d <= MAX_DISTANCE; d += 0.5) {
      const g = attenuation(d, 8);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
    expect(attenuation(MAX_DISTANCE - 0.5, 8)).toBeLessThan(0.001);
  });

  it('pans towards the side the sound is on, relative to the camera', () => {
    expect(panFor(here, 20, 0)).toBeGreaterThan(0.8);
    expect(panFor(here, -20, 0)).toBeLessThan(-0.8);
    expect(panFor(here, 0, -20)).toBeCloseTo(0, 5);
    // Camera turned to face east: its right is now south (+z).
    const east: Listener = { x: 0, y: 0, z: 0, rx: 0, rz: 1 };
    expect(panFor(east, 0, 20)).toBeGreaterThan(0.8);
    expect(panFor(east, 20, 0)).toBeCloseTo(0, 5);
    // Right on top of the listener: centred, never NaN.
    expect(panFor(here, 0, 0)).toBe(0);
    expect(Math.abs(panFor(here, 0.5, 0))).toBeLessThan(0.2);
    for (const x of [-500, -3, 3, 500]) expect(Math.abs(panFor(here, x, 1))).toBeLessThanOrEqual(0.85);
  });

  it('dulls and delays distant sounds', () => {
    expect(airCutoff(0)).toBeGreaterThan(20000);
    expect(airCutoff(100)).toBeLessThan(5000);
    expect(airCutoff(1000)).toBe(1400);
    const near = spatialize(here, 5, 0, 0, 10);
    const far = spatialize(here, 140, 0, 0, 10, 300);
    expect(near.delay).toBe(0);
    expect(far.delay).toBeCloseTo(140 / 343, 3);
    expect(far.gain).toBeLessThan(near.gain);
    expect(spatialize(here, 0, 0, 200, 10).gain).toBe(0);
  });
});

describe('voice allocation', () => {
  const slot = (until: number, priority: number, level = 0.3, id = 'x', started = 0): VoiceSlot => ({ until, priority, level, id, started });

  it('uses a free voice when there is one', () => {
    const slots = [slot(5, 9), slot(0.5, 1), slot(5, 9)];
    expect(allocateVoice(slots, 1, 'new', 1, 0.1)).toBe(1);
  });

  it('steals the least important voice when all are busy', () => {
    const slots = [slot(5, 7), slot(5, 2), slot(5, 5), slot(5, 2, 0.05)];
    expect(allocateVoice(slots, 1, 'new', 6, 0.3)).toBe(3);
  });

  it('prefers to steal a voice that has nearly finished', () => {
    const slots = [slot(5, 3, 0.3), slot(1.05, 3, 0.3), slot(5, 3, 0.3)];
    expect(allocateVoice(slots, 1, 'new', 4, 0.3)).toBe(1);
  });

  it('drops the newcomer rather than cut off something more important', () => {
    const slots = [slot(5, 9), slot(5, 8), slot(5, 10)];
    expect(allocateVoice(slots, 1, 'footstep', 2, 0.2)).toBe(-1);
    // Equal priority: a quiet newcomer does not displace a loud voice…
    expect(allocateVoice([slot(5, 5, 0.4)], 1, 'new', 5, 0.05)).toBe(-1);
    // …but a louder one does.
    expect(allocateVoice([slot(5, 5, 0.1)], 1, 'new', 5, 0.4)).toBe(0);
  });

  it('caps how many copies of one sound overlap by recycling the oldest', () => {
    const slots = [slot(5, 2, 0.2, 'step', 0.1), slot(5, 2, 0.2, 'step', 0.3), slot(5, 2, 0.2, 'step', 0.2), slot(0, 0)];
    expect(allocateVoice(slots, 1, 'step', 2, 0.2, 3)).toBe(0);
    expect(allocateVoice(slots, 1, 'step', 2, 0.2, 4)).toBe(3);
  });

  it('never exceeds the pool under a flood of requests', () => {
    const slots: VoiceSlot[] = Array.from({ length: 24 }, () => slot(0, 0));
    let dropped = 0;
    for (let i = 0; i < 500; i++) {
      const now = i * 0.01;
      const priority = i % 7;
      const idx = allocateVoice(slots, now, `s${i % 9}`, priority, 0.2);
      if (idx < 0) {
        dropped++;
        continue;
      }
      expect(idx).toBeLessThan(24);
      slots[idx] = slot(now + 1.5, priority, 0.2, `s${i % 9}`, now);
    }
    expect(slots.filter((s) => s.until > 5).length).toBeLessThanOrEqual(24);
    expect(dropped).toBeGreaterThan(0);
  });
});

describe('render bank', () => {
  it('pre-renders within a time budget and hands each sound over once', () => {
    const bank = new Bank();
    let renders = 0;
    const job = (v: number) => () => {
      renders++;
      return new Float32Array([v]);
    };
    for (let i = 0; i < 10; i++) bank.queue(`k${i}`, job(i));
    let t = 0;
    const clock = (): number => (t += 2); // every look at the clock costs 2 ms
    expect(bank.work(5, clock)).toBe(false);
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(10);
    // A sound needed before the queue reaches it is rendered on the spot, and not again later.
    expect(bank.take('k9', job(9))[0]).toBe(9);
    const before = renders;
    while (!bank.work(5, clock));
    expect(renders).toBe(before + 10 - before);
    expect(renders).toBe(10);
    expect(bank.take('k3', job(99))[0]).toBe(3);
    expect(renders).toBe(10);
    expect(bank.pending).toBe(0);
  });
});
