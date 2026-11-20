import { expect, it, vi } from 'vitest';
import { FrameClock } from './frame-clock';

it('drops excess stall time, bounding fixed steps and streaming only once per render', () => {
  const clock = new FrameClock();
  const fixed = vi.fn(), slice = vi.fn(), stream = vi.fn();
  clock.elapsed(0);
  clock.simulate(clock.elapsed(5000), fixed, slice, stream);
  expect(fixed).toHaveBeenCalledTimes(6);
  expect(slice).toHaveBeenCalledTimes(3);
  expect(stream.mock.calls).toEqual([[0.1]]);
  clock.simulate(clock.elapsed(5008), fixed, slice, stream);
  expect(fixed).toHaveBeenCalledTimes(6);
  expect(stream).toHaveBeenCalledTimes(2);
});

it('visibility reset discards both wall time and fractional physics backlog', () => {
  const clock = new FrameClock();
  const fixed = vi.fn();
  const frame = (now: number) => clock.simulate(clock.elapsed(now), fixed, vi.fn(), vi.fn());
  frame(0);
  frame(12);
  clock.reset();
  expect(clock.elapsed(60000)).toBe(0);
  frame(60008);
  expect(fixed).not.toHaveBeenCalled();
  frame(60018);
  expect(fixed).toHaveBeenCalledOnce();
});
