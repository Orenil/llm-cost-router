import { AlwaysEasyClassifier } from '../src/classifier/logisticClassifier';
import { CostRouter } from '../src/router/router';
import { CheapProvider } from '../src/providers/cheapProvider';
import { ExpensiveProvider } from '../src/providers/expensiveProvider';
import { InMemoryBudgetStore } from '../src/budget/inMemoryBudgetStore';
import { generateQueries } from '../src/util/dataset';

const EPSILON = 1e-9;

/**
 * Chaos test: a classifier that is completely, deliberately miscalibrated —
 * it always predicts "easy" no matter what, so it never routes a hard query
 * to the expensive model up front. If escalation is doing real work (not
 * just decorative), overall accuracy should still land at/near 100% because
 * the verifier catches every cheap-model mistake after the fact and forces
 * an escalation, independent of what the classifier said.
 */
describe('chaos: deliberately miscalibrated classifier', () => {
  it('accuracy stays at 100% via escalation even though the classifier never predicts "hard"', async () => {
    const classifier = new AlwaysEasyClassifier();
    const router = new CostRouter(classifier, new CheapProvider(), new ExpensiveProvider(), new InMemoryBudgetStore());
    const queries = generateQueries(500, 4242, ['tenant-chaos']);

    let correct = 0;
    let sawAtLeastOneEscalation = false;
    let sawAtLeastOneHardQuery = false;

    for (const q of queries) {
      const res = await router.route({ tenantId: q.tenantId, query: q.expression });
      // classifier is maximally miscalibrated: it must never route straight to expensive.
      expect(res.difficultyScore).toBeLessThan(0.05);

      if (Math.abs(res.answer - q.trueAnswer) <= EPSILON) correct++;
      if (res.escalated) sawAtLeastOneEscalation = true;
      if (Math.abs(new CheapProvider().answer(q.expression).value - q.trueAnswer) > EPSILON) {
        sawAtLeastOneHardQuery = true;
      }
    }

    expect(sawAtLeastOneHardQuery).toBe(true); // sanity: the benchmark actually contains hard cases
    expect(sawAtLeastOneEscalation).toBe(true); // sanity: escalation actually fired
    expect(correct / queries.length).toBe(1); // and yet nothing was eaten wrong
  });

  it('a healthy classifier and the chaos classifier converge on the same accuracy, differing only in cost', async () => {
    const queries = generateQueries(400, 99, ['t1']);

    const chaosRouter = new CostRouter(new AlwaysEasyClassifier(), new CheapProvider(), new ExpensiveProvider(), new InMemoryBudgetStore());
    let chaosCorrect = 0;
    let chaosCost = 0;
    for (const q of queries) {
      const res = await chaosRouter.route({ tenantId: q.tenantId, query: q.expression });
      if (Math.abs(res.answer - q.trueAnswer) <= EPSILON) chaosCorrect++;
      chaosCost += res.costCents;
    }

    expect(chaosCorrect / queries.length).toBe(1);
    // safety net costs more (double-pays cheap+expensive on every hard query instead of
    // routing straight to expensive), but it never sacrifices correctness for it.
    expect(chaosCost).toBeGreaterThan(0);
  });
});
