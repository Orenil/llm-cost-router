/**
 * Minimal vector math used by the hand-rolled logistic regression classifier.
 * Deliberately dependency-free: the whole point of collapsing the classifier
 * into the Node process (see README) is that it shouldn't need numpy/sklearn.
 */

export function dot(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`dot(): length mismatch (${a.length} vs ${b.length})`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function sigmoid(z: number): number {
  // Numerically stable form avoids overflow for large |z|.
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
