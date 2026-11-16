/** Analysis helpers for the unit tests (not used at runtime). */

/** Fundamental frequency by autocorrelation with parabolic refinement. */
export function pitchOf(b: Float32Array, sr: number, lo: number, hi: number, from = 0, len = 4096): number {
  const minLag = Math.floor(sr / hi);
  const maxLag = Math.ceil(sr / lo);
  const corr = (lag: number): number => {
    let c = 0;
    for (let i = from; i < from + len; i++) c += b[i] * b[i + lag];
    return c;
  };
  let best = minLag;
  let bestC = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const c = corr(lag);
    if (c > bestC) {
      bestC = c;
      best = lag;
    }
  }
  const a = corr(best - 1);
  const c = corr(best + 1);
  const shift = (a - c) / (2 * (a - 2 * bestC + c) || 1);
  return sr / (best + shift);
}

/** Share of a signal's energy below roughly `hz` (one-pole split). */
export function lowShare(b: Float32Array, sr: number, hz: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sr);
  let lp = 0;
  let low = 0;
  let all = 0;
  for (let i = 0; i < b.length; i++) {
    lp += a * (b[i] - lp);
    low += lp * lp;
    all += b[i] * b[i];
  }
  return all > 0 ? low / all : 0;
}
