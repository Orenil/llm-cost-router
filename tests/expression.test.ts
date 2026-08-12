import {
  evaluateCorrect,
  evaluateCheap,
  hasMixedPrecedence,
  extractFeatures,
  featureVector,
  tokenize,
} from '../src/util/expression';

describe('util/expression: correct evaluator', () => {
  it('respects standard operator precedence', () => {
    expect(evaluateCorrect('2 + 3 * 4')).toBe(14);
    expect(evaluateCorrect('10 - 2 * 3')).toBe(4);
  });

  it('respects parenthesized grouping', () => {
    expect(evaluateCorrect('(2 + 3) * 4')).toBe(20);
    expect(evaluateCorrect('((1 + 2) * (3 + 4))')).toBe(21);
  });

  it('handles decimals', () => {
    expect(evaluateCorrect('1.5 + 2.5')).toBeCloseTo(4);
  });

  it('throws on malformed input', () => {
    expect(() => evaluateCorrect('2 + ')).toThrow();
    expect(() => evaluateCorrect('(2 + 3')).toThrow();
    expect(() => evaluateCorrect('2 $ 3')).toThrow();
  });
});

describe('util/expression: cheap evaluator (deliberate left-to-right bug)', () => {
  it('matches the correct evaluator when there is no mixed precedence', () => {
    expect(evaluateCheap('2 + 3 + 4')).toBe(evaluateCorrect('2 + 3 + 4'));
    expect(evaluateCheap('2 * 3 * 4')).toBe(evaluateCorrect('2 * 3 * 4'));
    expect(evaluateCheap('(2 + 3) * 4')).toBe(evaluateCorrect('(2 + 3) * 4'));
  });

  it('diverges from the correct evaluator exactly when precedence is mixed', () => {
    expect(evaluateCheap('2 + 3 * 4')).toBe(20); // (2+3)*4 left-to-right
    expect(evaluateCorrect('2 + 3 * 4')).toBe(14);
    expect(evaluateCheap('2 + 3 * 4')).not.toBe(evaluateCorrect('2 + 3 * 4'));
  });

  it('still respects grouping, so nested parens alone are not the failure mode', () => {
    // grouping is honored; only the flat left-to-right op application differs
    expect(evaluateCheap('((2 + 3))')).toBe(evaluateCorrect('((2 + 3))'));
  });
});

describe('util/expression: hasMixedPrecedence', () => {
  it('is false for single-operator-type expressions', () => {
    expect(hasMixedPrecedence('2 + 3 + 4')).toBe(false);
    expect(hasMixedPrecedence('2 * 3 / 4')).toBe(false);
  });

  it('is true when a grouping level mixes + - with * /', () => {
    expect(hasMixedPrecedence('2 + 3 * 4')).toBe(true);
    expect(hasMixedPrecedence('(2 + 3 * 4)')).toBe(true);
  });

  it('detects mixing nested inside parens even if top level is pure', () => {
    expect(hasMixedPrecedence('(2 + 3 * 4) + 5')).toBe(true);
  });

  it('has no false negatives: whenever cheap actually diverges from correct, it is flagged', () => {
    // hasMixedPrecedence can over-flag (e.g. "2 * 3 + 4" happens to evaluate the same
    // left-to-right as it does with correct precedence, since the multiplicative op
    // already comes first) but must never under-flag a real divergence — that
    // one-directional guarantee is what lets the verifier safely gate escalation.
    const cases = ['2 + 3 * 4', '2 * 3 + 4', '(1 + 2) * (3 - 4)', '5 - 2 / 2', '5 + 5', '5 * 5 * 5', '(5 + 5) - 3'];
    for (const expr of cases) {
      const diverges = evaluateCheap(expr) !== evaluateCorrect(expr);
      if (diverges) expect(hasMixedPrecedence(expr)).toBe(true);
    }
    // and confirm the battery actually exercises both a divergent and a non-divergent mixed case
    expect(evaluateCheap('2 + 3 * 4')).not.toBe(evaluateCorrect('2 + 3 * 4'));
    expect(evaluateCheap('2 * 3 + 4')).toBe(evaluateCorrect('2 * 3 + 4'));
  });
});

describe('util/expression: features', () => {
  it('extracts sensible feature counts', () => {
    const f = extractFeatures('(1.5 + 22) * 333');
    expect(f.numOperators).toBe(2);
    expect(f.maxParenDepth).toBe(1);
    expect(f.hasDecimal).toBe(true);
    expect(f.numOperands).toBe(3);
    expect(f.maxDigits).toBe(3); // "333"
  });

  it('featureVector produces a fixed-length numeric vector', () => {
    const v = featureVector(extractFeatures('1 + 2'));
    expect(v).toHaveLength(6);
    for (const x of v) expect(typeof x).toBe('number');
  });

  it('tokenize rejects unknown characters', () => {
    expect(() => tokenize('2 & 3')).toThrow();
  });
});
