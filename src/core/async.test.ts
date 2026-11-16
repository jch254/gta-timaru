import { describe, expect, it, vi } from 'vitest';
import { settle } from './async';

describe('settle', () => {
  it('resolves when the promise resolves', async () => {
    await expect(settle(Promise.resolve('x'), 10_000)).resolves.toBeUndefined();
  });

  it('resolves when the promise rejects instead of throwing', async () => {
    await expect(settle(Promise.reject(new Error('dropped')), 10_000)).resolves.toBeUndefined();
  });

  it('resolves after the timeout when the promise never settles', async () => {
    vi.useFakeTimers();
    let done = false;
    void settle(new Promise(() => undefined), 500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
