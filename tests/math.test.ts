import { dot, sigmoid, clamp, mean } from '../src/math/linalg';

describe('math/linalg', () => {
  it('dot computes the inner product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(dot([], [])).toBe(0);
  });

  it('dot rejects mismatched lengths', () => {
    expect(() => dot([1, 2], [1])).toThrow();
  });

  it('sigmoid is bounded in (0,1) and monotonic', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
    // +-20 is extreme enough to test the numerically-stable branches without rounding
    // to an exact 0 or 1 in double precision, which +-1000 (or even +-40) would.
    expect(sigmoid(-20)).toBeGreaterThan(0);
    expect(sigmoid(-20)).toBeLessThan(1e-6);
    expect(sigmoid(20)).toBeLessThan(1);
    expect(sigmoid(20)).toBeGreaterThan(1 - 1e-6);
    expect(sigmoid(2)).toBeGreaterThan(sigmoid(1));
  });

  it('clamp bounds values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('mean handles empty arrays without NaN', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });
});
