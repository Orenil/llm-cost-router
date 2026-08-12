import { CheapProvider } from '../src/providers/cheapProvider';
import { ExpensiveProvider } from '../src/providers/expensiveProvider';
import { generateQueries, isCheapWrong } from '../src/util/dataset';

describe('providers: genuinely different accuracy/cost profiles', () => {
  const cheap = new CheapProvider();
  const expensive = new ExpensiveProvider();

  it('expensive is strictly more costly than cheap', () => {
    expect(expensive.costCentsPerQuery).toBeGreaterThan(cheap.costCentsPerQuery);
  });

  it('expensive provider is always correct on a synthetic labeled benchmark', () => {
    const queries = generateQueries(500, 123, ['t1']);
    for (const q of queries) {
      const { value } = expensive.answer(q.expression);
      expect(value).toBeCloseTo(q.trueAnswer, 9);
    }
  });

  it('cheap provider is measurably less accurate than expensive, and the gap is provable', () => {
    const queries = generateQueries(1000, 123, ['t1']);
    let cheapCorrect = 0;
    for (const q of queries) {
      const { value } = cheap.answer(q.expression);
      if (Math.abs(value - q.trueAnswer) < 1e-9) cheapCorrect++;
    }
    const cheapAccuracy = cheapCorrect / queries.length;
    expect(cheapAccuracy).toBeLessThan(1);
    expect(cheapAccuracy).toBeGreaterThan(0.5); // still fine on the (majority) non-mixed-precedence cases
  });

  it('isCheapWrong agrees with directly comparing cheap provider output to ground truth', () => {
    const queries = generateQueries(200, 55, ['t1']);
    for (const q of queries) {
      const { value } = cheap.answer(q.expression);
      const directlyWrong = Math.abs(value - q.trueAnswer) > 1e-9;
      expect(isCheapWrong(q)).toBe(directlyWrong);
    }
  });
});
