import { describe, expect, it } from 'vitest';
import { add3, cross3, dot3, len3, mix3, norm3, sub3, type V3 } from './vec3';

// These replaced byte-identical local copies in the vehicle, vegetation and ground builders;
// exact outputs keep every generated mesh bit-identical.
describe('vec3 tuple helpers', () => {
  const a: V3 = [1, 2, 3];
  const b: V3 = [4, -5, 6];

  it('add3 with the optional scale', () => {
    expect(add3(a, b)).toEqual([5, -3, 9]);
    expect(add3(a, b, 2)).toEqual([9, -8, 15]);
  });

  it('sub3, dot3 and cross3', () => {
    expect(sub3(a, b)).toEqual([-3, 7, -3]);
    expect(dot3(a, b)).toBe(12);
    expect(cross3(a, b)).toEqual([27, 6, -13]);
  });

  it('len3 and norm3, including the zero-vector guard', () => {
    expect(len3([3, 4, 0])).toBe(5);
    expect(norm3([3, 4, 0])).toEqual([0.6, 0.8, 0]);
    expect(norm3([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('mix3 interpolates per component', () => {
    expect(mix3(a, b, 0.5)).toEqual([2.5, -1.5, 4.5]);
    expect(mix3(a, b, 0)).toEqual([1, 2, 3]);
  });
});
