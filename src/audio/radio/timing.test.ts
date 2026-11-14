import { describe, expect, it } from 'vitest';
import { LOOKAHEAD, Lookahead, MAX_LOOKAHEAD, MIN_LEAD, TICK, firstStepAt, planTick, stepDuration, stepOffset, stepTime, type Timeline } from './timing';

const straight: Timeline = { start: 10, stepDur: stepDuration(120), shuffle: 0, swing: 0 };

describe('step timing', () => {
  it('a sixteenth at 120 bpm is an eighth of a second', () => {
    expect(stepDuration(120)).toBeCloseTo(0.125, 9);
    expect(stepDuration(60)).toBeCloseTo(0.25, 9);
    expect(stepTime(straight, 0)).toBe(10);
    expect(stepTime(straight, 16)).toBeCloseTo(12, 9);
  });

  it('straight time has no offsets; beats never move', () => {
    for (let s = 0; s < 32; s++) expect(stepOffset(s, 0, 0)).toBe(0);
    for (const shuffle of [0, 0.5, 1]) for (const swing of [0, 0.5, 1]) for (const s of [0, 4, 8, 12, 16]) expect(stepOffset(s, shuffle, swing)).toBe(0);
  });

  it('full shuffle puts the off-beat eighth on the triplet', () => {
    expect(2 + stepOffset(2, 1, 0)).toBeCloseTo(4 * (2 / 3), 9);
    expect(1 + stepOffset(1, 0, 1)).toBeCloseTo(4 / 3, 9);
  });

  it('steps stay in order for any amount of swing', () => {
    for (let shuffle = 0; shuffle <= 1.001; shuffle += 0.1) {
      for (let swing = 0; swing <= 1.001; swing += 0.1) {
        const tl: Timeline = { start: 0, stepDur: 0.1, shuffle, swing };
        for (let s = 1; s < 40; s++) expect(stepTime(tl, s)).toBeGreaterThan(stepTime(tl, s - 1) + 0.02);
      }
    }
  });

  it('finds the first step at or after a time', () => {
    expect(firstStepAt(straight, 0)).toBe(0);
    expect(firstStepAt(straight, 10)).toBe(0);
    expect(firstStepAt(straight, 10.0001)).toBe(1);
    expect(firstStepAt(straight, 10.125)).toBe(1);
    expect(firstStepAt(straight, 12.3)).toBe(19);
    const swung: Timeline = { start: 0, stepDur: 0.1, shuffle: 0.9, swing: 0.4 };
    for (let t = 0; t < 5; t += 0.013) {
      const s = firstStepAt(swung, t);
      expect(stepTime(swung, s)).toBeGreaterThanOrEqual(t);
      if (s > 0) expect(stepTime(swung, s - 1)).toBeLessThan(t);
    }
  });
});

describe('look-ahead scheduler', () => {
  /** Runs the scheduler against a list of timer callback times; returns when each step was scheduled. */
  function run(tl: Timeline, ticks: number[]): { scheduled: Map<number, number>; skipped: number[] } {
    const look = new Lookahead();
    const scheduled = new Map<number, number>();
    const skipped: number[] = [];
    // As when tuning in: start with the first step far enough ahead to be schedulable.
    let next = firstStepAt(tl, ticks[0] + MIN_LEAD);
    for (const now of ticks) {
      const { from, to } = planTick(tl, next, now, look.horizon(now));
      for (let s = next; s < from; s++) skipped.push(s);
      for (let s = from; s < to; s++) {
        expect(scheduled.has(s), `step ${s} scheduled twice`).toBe(false);
        // Never asks the audio thread for something in the past.
        expect(stepTime(tl, s)).toBeGreaterThanOrEqual(now + MIN_LEAD - 1e-9);
        scheduled.set(s, now);
      }
      next = Math.max(from, to);
    }
    return { scheduled, skipped };
  }

  it('schedules every step exactly once on a steady timer', () => {
    const tl: Timeline = { start: 0.37, stepDur: stepDuration(132), shuffle: 0.6, swing: 0.3 };
    const ticks: number[] = [];
    for (let t = 1; t < 21; t += TICK) ticks.push(t);
    const { scheduled, skipped } = run(tl, ticks);
    expect(skipped).toEqual([]);
    const first = firstStepAt(tl, 1 + MIN_LEAD);
    const last = firstStepAt(tl, 20.9) - 1;
    for (let s = first; s <= last; s++) expect(scheduled.has(s), `step ${s} missing`).toBe(true);
    // Each step was queued roughly one look-ahead before it sounds.
    for (const [s, when] of scheduled) {
      const lead = stepTime(tl, s) - when;
      expect(lead).toBeGreaterThan(LOOKAHEAD - TICK - 1e-6);
      expect(lead).toBeLessThanOrEqual(LOOKAHEAD + 1e-6);
    }
  });

  it('survives a jittery timer without dropping or doubling a step', () => {
    const tl: Timeline = { start: 0, stepDur: stepDuration(140), shuffle: 0, swing: 0 };
    const ticks: number[] = [];
    let t = 0.5;
    let seed = 7;
    while (t < 30) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      t += TICK + (seed / 0x7fffffff) * 0.05; // up to 50 ms late, every time
      ticks.push(t);
    }
    const { skipped } = run(tl, ticks);
    expect(skipped).toEqual([]);
  });

  it('skips what it missed after a long stall instead of playing it late in a burst', () => {
    const tl: Timeline = { start: 0, stepDur: 0.1, shuffle: 0, swing: 0 };
    const ticks: number[] = [];
    for (let t = 1; t < 2; t += TICK) ticks.push(t);
    for (let t = 2.8; t < 4; t += TICK) ticks.push(t); // the tab froze for 0.8 s
    const { scheduled, skipped } = run(tl, ticks);
    expect(skipped.length).toBeGreaterThan(3);
    expect(skipped.length).toBeLessThanOrEqual(8);
    for (const s of skipped) {
      expect(stepTime(tl, s)).toBeGreaterThan(2);
      expect(stepTime(tl, s)).toBeLessThan(2.81);
    }
    // Playback picks up on the grid straight afterwards: every later step is there.
    for (let s = 29; s < 39; s++) expect(scheduled.has(s), `step ${s}`).toBe(true);
  });

  it('widens the horizon while the timer is running late, then relaxes', () => {
    const look = new Lookahead();
    let now = 0;
    for (let i = 0; i < 20; i++) expect(look.horizon((now += TICK))).toBeCloseTo(LOOKAHEAD, 6);
    const stretched = look.horizon((now += 0.2));
    expect(stretched).toBeGreaterThan(LOOKAHEAD + 0.3);
    expect(stretched).toBeLessThanOrEqual(MAX_LOOKAHEAD);
    let h = stretched;
    for (let i = 0; i < 400; i++) h = look.horizon((now += TICK));
    expect(h).toBeLessThan(LOOKAHEAD + 0.005);
    // A long freeze cannot push the horizon past its ceiling.
    expect(look.horizon(now + 30)).toBe(MAX_LOOKAHEAD);
    look.reset();
    expect(look.horizon(now + 100)).toBeCloseTo(LOOKAHEAD, 6);
  });
});
