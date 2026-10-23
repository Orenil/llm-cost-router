import express from 'express';
import { LogisticClassifier } from './classifier/logisticClassifier';
import { CheapProvider } from './providers/cheapProvider';
import { ExpensiveProvider } from './providers/expensiveProvider';
import { InMemoryBudgetStore } from './budget/inMemoryBudgetStore';
import { BudgetStore } from './budget/types';
import { CostRouter } from './router/router';
import { generateQueries, isCheapWrong } from './util/dataset';
import { extractFeatures, featureVector } from './util/expression';

const TENANTS = ['tenant-a', 'tenant-b', 'tenant-c'];

/** Trains on a synthetic replay log standing in for a real query/outcome warehouse table — see README. */
function trainClassifier(): LogisticClassifier {
  const historical = generateQueries(1500, 7, TENANTS);
  const dataset = historical.map((q) => ({
    features: featureVector(extractFeatures(q.expression)),
    label: isCheapWrong(q) ? 1 : 0,
  }));
  const classifier = new LogisticClassifier(dataset[0].features.length);
  classifier.train(dataset);
  return classifier;
}

/** REDIS_URL selects the production budget-store backend; unset falls back to the in-process store. */
function buildBudgetStore(): BudgetStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return new InMemoryBudgetStore();
  // Deferred require so `ioredis` is only touched when actually configured.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis');
  const { RedisBudgetStore } = require('./budget/redisBudgetStore');
  const redis = new Redis(redisUrl);
  return new RedisBudgetStore(redis);
}

export function buildApp() {
  const app = express();
  app.use(express.json());

  const classifier = trainClassifier();
  const cheapProvider = new CheapProvider();
  const expensiveProvider = new ExpensiveProvider();
  const budgetStore = buildBudgetStore();
  const router = new CostRouter(classifier, cheapProvider, expensiveProvider, budgetStore);

  app.post('/route', async (req, res) => {
    const { tenantId, query } = req.body ?? {};
    if (typeof tenantId !== 'string' || typeof query !== 'string' || tenantId.length === 0 || query.length === 0) {
      res.status(400).json({ error: 'body must be { tenantId: string, query: string }' });
      return;
    }
    try {
      const result = await router.route({ tenantId, query });
      res.json(result);
    } catch (err) {
      res.status(422).json({ error: err instanceof Error ? err.message : 'could not evaluate query' });
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  return app;
}

if (require.main === module) {
  const app = buildApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`llm-cost-router listening on :${port}`);
  });
}
