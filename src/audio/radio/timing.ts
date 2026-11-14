/**
 * Look-ahead scheduling maths, shared by every station. A 25 ms timer asks "which sixteenth-note steps fall
 * inside the next ~100 ms of audio clock?" and schedules exactly those, sample-accurately, on the audio thread.
 * If the main thread stalls the timer fires late: steps already in the past are skipped (never played late in a
 * burst) and the horizon stretches while the stutter lasts, so the music does not gap.
 */

export const STEPS_PER_BAR = 16;
/** Timer period, seconds. */
export const TICK = 0.025;
/** Normal look-ahead, seconds. */
export const LOOKAHEAD = 0.1;
/** Longest look-ahead used while the tab is stuttering. */
export const MAX_LOOKAHEAD = 0.5;
/** A step must be at least this far in the future to be scheduled. */
export const MIN_LEAD = 0.005;

/**
 * Where a step really falls, in steps, relative to its grid position.
 * `shuffle` (0..1) drags the off-beat eighth towards the triplet; `swing` (0..1) does the same to the
 * off-beat sixteenths. Both 0 = straight time.
 */
export function stepOffset(step: number, shuffle: number, swing: number): number {
  const s = ((step % 4) + 4) % 4;
  if (s === 0) return 0;
  const mid = 2 + shuffle * (2 / 3);
  if (s === 2) return mid - 2;
  const lean = 0.5 * (1 + swing / 3);
  return s === 1 ? mid * lean - 1 : mid + (4 - mid) * lean - 3;
}

export interface Timeline {
  /** Audio-clock time of step 0. */
  start: number;
  /** Seconds per sixteenth. */
  stepDur: number;
  shuffle: number;
  swing: number;
}

export const stepDuration = (bpm: number): number => 60 / bpm / 4;

export function stepTime(tl: Timeline, step: number): number {
  return tl.start + (step + stepOffset(step, tl.shuffle, tl.swing)) * tl.stepDur;
}

/** First step whose time is at or after `t`. */
export function firstStepAt(tl: Timeline, t: number): number {
  let s = Math.max(0, Math.floor((t - tl.start) / tl.stepDur) - 1);
  while (stepTime(tl, s) < t) s++;
  return s;
}

/**
 * The steps to act on this tick: [from, to) are scheduled; steps in [next, from) are already in the past
 * and are skipped silently.
 */
export function planTick(tl: Timeline, next: number, now: number, horizon: number): { from: number; to: number } {
  let from = next;
  if (stepTime(tl, from) < now + MIN_LEAD) from = Math.max(from, firstStepAt(tl, now + MIN_LEAD));
  let to = from;
  const end = now + horizon;
  while (stepTime(tl, to) < end) to++;
  return { from, to };
}

/** Tracks how late the timer has been running lately and widens the look-ahead to cover it. */
export class Lookahead {
  /** Decaying estimate of the worst recent lateness, seconds. */
  late = 0;
  private last = -1;

  /** Call once per tick with the audio clock; returns the horizon to schedule to. */
  horizon(now: number): number {
    if (this.last >= 0) {
      const lateness = Math.max(0, now - this.last - TICK);
      this.late = Math.max(lateness, this.late * 0.97);
    }
    this.last = now;
    return Math.min(MAX_LOOKAHEAD, LOOKAHEAD + 2 * this.late);
  }

  reset(): void {
    this.late = 0;
    this.last = -1;
  }
}
