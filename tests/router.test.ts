import { CostRouter } from '../src/router/router';
import { CheapProvider } from '../src/providers/cheapProvider';
import { ExpensiveProvider } from '../src/providers/expensiveProvider';
import { InMemoryBudgetStore } from '../src/budget/inMemoryBudgetStore';
import { DifficultyClassifier, DEFAULT_ROUTER_CONFIG } from '../src/router/types';
import { evaluateCorrect } from '../src/util/expression';

const alwaysHard: DifficultyClassifier = { predictProba: () => 0.95 };
const alwaysEasy: DifficultyClassifier = { predictProba: () => 0.05 };

function buildRouter(classifier: DifficultyClassifier, store = new InMemoryBudgetStore()) {
  return new CostRouter(classifier, new CheapProvider(), new ExpensiveProvider(), store);
}

describe('router/CostRouter', () => {
  it('routes to the expensive model directly when the classifier is confident it is hard', async () => {
    const router = buildRouter(alwaysHard);
    const res = await router.route({ tenantId: 't1', query: '2 + 3 * 4' });
    expect(res.modelUsed).toBe('expensive');
    expect(res.escalated).toBe(false);
    expect(res.answer).toBe(evaluateCorrect('2 + 3 * 4'));
    expect(res.costCents).toBeCloseTo(new ExpensiveProvider().costCentsPerQuery);
  });

  it('routes to the cheap model when the classifier is confident it is easy and the query is actually easy', async () => {
    const router = buildRouter(alwaysEasy);
    const res = await router.route({ tenantId: 't1', query: '2 + 3 + 4' });
    expect(res.modelUsed).toBe('cheap');
    expect(res.escalated).toBe(false);
    expect(res.answer).toBe(evaluateCorrect('2 + 3 + 4'));
    expect(res.costCents).toBeCloseTo(new CheapProvider().costCentsPerQuery);
  });

  it('escalates to the expensive model when the verifier catches a misclassified-as-easy hard query', async () => {
    const router = buildRouter(alwaysEasy);
    // mixed precedence: cheap model will get this wrong, but the classifier said "easy".
    const res = await router.route({ tenantId: 't1', query: '2 + 3 * 4' });
    expect(res.escalated).toBe(true);
    expect(res.modelUsed).toBe('expensive');
    // final answer is still correct, thanks to escalation
    expect(res.answer).toBe(evaluateCorrect('2 + 3 * 4'));
    // paid for both the cheap attempt and the expensive escalation
    expect(res.costCents).toBeCloseTo(new CheapProvider().costCentsPerQuery + new ExpensiveProvider().costCentsPerQuery);
  });

  it('records cost and escalation outcomes to the budget store', async () => {
    const store = new InMemoryBudgetStore();
    const router = buildRouter(alwaysEasy, store);
    await router.route({ tenantId: 't1', query: '2 + 3 + 4' }); // cheap, no escalation
    await router.route({ tenantId: 't1', query: '2 + 3 * 4' }); // escalated

    const window = await store.getRollingWindow('t1', 60_000);
    expect(window.requests).toBe(2);
    expect(window.escalations).toBe(1);
  });

  it('getTrainingLog reflects escalation outcomes as retraining labels', async () => {
    const router = buildRouter(alwaysEasy);
    await router.route({ tenantId: 't1', query: '2 + 3 + 4' });
    await router.route({ tenantId: 't1', query: '2 + 3 * 4' });

    const log = router.getTrainingLog();
    expect(log).toHaveLength(2);
    expect(log[0].label).toBe(0);
    expect(log[1].label).toBe(1);
  });

  it('raises a budget alert when a tenant escalation rate spikes above its recent baseline', async () => {
    const store = new InMemoryBudgetStore();
    const now = Date.now();
    // Baseline: 30 clean requests ~50 minutes ago (inside the 60min baseline window, outside the 5min short window).
    for (let i = 0; i < 30; i++) {
      await store.record('t1', 0.08, false, now - 50 * 60_000 - i);
    }
    // Recent spike: 15 escalated requests ~1 minute ago (inside the short window).
    for (let i = 0; i < 15; i++) {
      await store.record('t1', 2.58, true, now - 60_000 - i);
    }

    const router = buildRouter(alwaysEasy, store);
    const res = await router.route({ tenantId: 't1', query: '2 + 3 + 4' });

    expect(res.alert).not.toBeNull();
    expect(res.alert?.kind).toBe('escalation_rate_spike');
    expect(res.alert?.shortTermRate).toBeGreaterThan(res.alert?.baselineRate ?? 0);
  });

  it('does not alert when there are too few recent requests to judge a spike', async () => {
    const store = new InMemoryBudgetStore();
    const router = buildRouter(alwaysEasy, store);
    for (let i = 0; i < DEFAULT_ROUTER_CONFIG.minSampleForSpike - 2; i++) {
      await router.route({ tenantId: 't1', query: '2 + 3 * 4' }); // all escalate
    }
    const res = await router.route({ tenantId: 't1', query: '2 + 3 * 4' });
    expect(res.alert).toBeNull();
  });

  it('does not alert when escalation rate is stable, not spiking', async () => {
    const store = new InMemoryBudgetStore();
    const router = buildRouter(alwaysEasy, store);
    let lastAlert = null;
    for (let i = 0; i < 20; i++) {
      // alternate easy/hard so escalation rate stays roughly constant across the whole run
      const query = i % 2 === 0 ? '2 + 3 + 4' : '2 + 3 * 4';
      const res = await router.route({ tenantId: 't1', query });
      lastAlert = res.alert;
    }
    expect(lastAlert).toBeNull();
  });
});
