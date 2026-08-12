import { verifyCheapAnswer } from '../src/verifier/verifier';
import { extractFeatures, evaluateCheap, evaluateCorrect } from '../src/util/expression';
import { generateQueries } from '../src/util/dataset';

describe('verifier/verifyCheapAnswer', () => {
  it('gives high confidence when there is no mixed precedence (cheap model is actually right)', () => {
    const expr = '2 + 3 + 4';
    const result = verifyCheapAnswer(expr, extractFeatures(expr));
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('gives low confidence when precedence is mixed (cheap model is actually wrong)', () => {
    const expr = '2 + 3 * 4';
    const result = verifyCheapAnswer(expr, extractFeatures(expr));
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('never needs the ground-truth answer to compute a verdict', () => {
    // type-level guarantee: verifyCheapAnswer's signature takes no trueAnswer parameter.
    expect(verifyCheapAnswer.length).toBe(2);
  });

  it('has zero false negatives across a random sample: every actually-wrong cheap answer is flagged low-confidence', () => {
    // This is the load-bearing guarantee, not raw precision: hasMixedPrecedence can
    // over-flag queries where the cheap answer happened to be fine anyway (wasting an
    // escalation), but by construction (see util/expression.ts) it can never miss a
    // real divergence, which is what makes escalation a safe backstop rather than a
    // best-effort one.
    const queries = generateQueries(300, 321, ['t1']);
    let wrongCount = 0;
    let wrongAndFlagged = 0;
    let flaggedTotal = 0;
    for (const q of queries) {
      const verdict = verifyCheapAnswer(q.expression, extractFeatures(q.expression));
      const wrong = Math.abs(evaluateCheap(q.expression) - evaluateCorrect(q.expression)) > 1e-9;
      const flagged = verdict.confidence < 0.5;
      if (flagged) flaggedTotal++;
      if (wrong) {
        wrongCount++;
        if (flagged) wrongAndFlagged++;
      }
    }
    expect(wrongCount).toBeGreaterThan(0); // sanity: sample actually contains wrong cheap answers
    expect(flaggedTotal).toBeGreaterThanOrEqual(wrongCount); // over-flagging is fine, under-flagging is not
    expect(wrongAndFlagged).toBe(wrongCount); // zero false negatives
  });
});
