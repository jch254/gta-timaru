const STEP = 1 / 60;
const MAX_STEPS = 6;

/** A stall slows game time instead of borrowing more work from future frames. */
export class FrameClock {
  private last: number | null = null;
  private remainder = 0;

  reset() {
    this.last = null;
    this.remainder = 0;
  }

  elapsed(now: number) {
    const dt = this.last === null ? 0 : Math.max(0, (now - this.last) / 1000);
    this.last = now;
    return Math.min(dt, MAX_STEPS * STEP);
  }

  simulate(dt: number, fixed: (step: number) => void, update: (slice: number, more: boolean) => void, stream: (elapsed: number) => void) {

    for (let remaining = dt; remaining > 1e-9;) {
      const slice = Math.min(remaining, 2 * STEP);
      remaining -= slice;
      this.remainder += slice;
      while (this.remainder >= STEP) {
        fixed(STEP);
        this.remainder -= STEP;
      }
      update(slice, remaining > 1e-9);
    }
    stream(dt);
  }
}
