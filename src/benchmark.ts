import { LogisticClassifier } from './classifier/logisticClassifier';
import { CheapProvider } from './providers/cheapProvider';
import { ExpensiveProvider } from './providers/expensiveProvider';
import { InMemoryBudgetStore } from './budget/inMemoryBudgetStore';
import { CostRouter } from './router/router';
import { generateQueries, isCheapWrong, SyntheticQuery } from './util/dataset';
import { extractFeatures, featureVector } from './util/expression';

const TENANTS = ['tenant-a', 'tenant-b', 'tenant-c'];
const EPSILON = 1e-9;

export interface StrategyResult {
  strategy: string;
  totalCostCents: number;
  accuracy: number;
  escalationRate: number | null;
}

export interface BenchmarkResult {
  trainSize: number;
  testSize: number;
  results: StrategyResult[];
}

function trainClassifierOnHistoricalLog(seed: number, n: number): LogisticClassifier {
  const historical = generateQueries(n, seed, TENANTS);
  const dataset = historical.map((q) => ({
    features: featureVector(extractFeatures(q.expression)),
    label: isCheapWrong(q) ? 1 : 0,
  }));
  const classifier = new LogisticClassifier(dataset[0].features.length);
  classifier.train(dataset);
  return classifier;
}

function alwaysCheap(queries: SyntheticQuery[]): StrategyResult {
  const cheap = new CheapProvider();
  let correct = 0;
  for (const q of queries) {
    const { value } = cheap.answer(q.expression);
    if (Math.abs(value - q.trueAnswer) <= EPSILON) correct++;
  }
  return {
    strategy: 'always-cheap',
    totalCostCents: cheap.costCentsPerQuery * queries.length,
    accuracy: correct / queries.length,
    escalationRate: null,
  };
}

function alwaysExpensive(queries: SyntheticQuery[]): StrategyResult {
  const expensive = new ExpensiveProvider();
  let correct = 0;
  for (const q of queries) {
    const { value } = expensive.answer(q.expression);
    if (Math.abs(value - q.trueAnswer) <= EPSILON) correct++;
  }
  return {
    strategy: 'always-expensive',
    totalCostCents: expensive.costCentsPerQuery * queries.length,
    accuracy: correct / queries.length,
    escalationRate: null,
  };
}

async function costRouterStrategy(
  queries: SyntheticQuery[],
  classifier: LogisticClassifier,
  label = 'cost-router',
): Promise<StrategyResult> {
  const router = new CostRouter(classifier, new CheapProvider(), new ExpensiveProvider(), new InMemoryBudgetStore());
  let correct = 0;
  let totalCostCents = 0;
  let escalations = 0;
  for (const q of queries) {
    const res = await router.route({ tenantId: q.tenantId, query: q.expression });
    if (Math.abs(res.answer - q.trueAnswer) <= EPSILON) correct++;
    totalCostCents += res.costCents;
    if (res.escalated) escalations++;
  }
  return {
    strategy: label,
    totalCostCents,
    accuracy: correct / queries.length,
    escalationRate: escalations / queries.length,
  };
}

/** Offline replay: trains on one seeded query log, evaluates cost/accuracy on a disjoint seeded test set. */
export async function runBenchmark(trainSize = 1500, testSize = 1000): Promise<BenchmarkResult> {
  const classifier = trainClassifierOnHistoricalLog(7, trainSize);
  const testQueries = generateQueries(testSize, 99, TENANTS);

  const results = [alwaysCheap(testQueries), alwaysExpensive(testQueries), await costRouterStrategy(testQueries, classifier)];

  return { trainSize, testSize, results };
}

function printReport(result: BenchmarkResult): void {
  const baseline = result.results.find((r) => r.strategy === 'always-expensive')!;
  // eslint-disable-next-line no-console
  console.log(`\nOffline replay: trained on ${result.trainSize} historical queries, evaluated on ${result.testSize} held-out queries\n`);
  // eslint-disable-next-line no-console
  console.log(
    ['strategy', 'total cost (cents)', 'accuracy', 'vs always-expensive cost', 'escalation rate']
      .map((h) => h.padEnd(26))
      .join(''),
  );
  for (const r of result.results) {
    const costDelta = ((r.totalCostCents - baseline.totalCostCents) / baseline.totalCostCents) * 100;
    const row = [
      r.strategy,
      r.totalCostCents.toFixed(2),
      `${(r.accuracy * 100).toFixed(2)}%`,
      `${costDelta >= 0 ? '+' : ''}${costDelta.toFixed(1)}%`,
      r.escalationRate === null ? 'n/a' : `${(r.escalationRate * 100).toFixed(1)}%`,
    ];
    // eslint-disable-next-line no-console
    console.log(row.map((c) => String(c).padEnd(26)).join(''));
  }
  // eslint-disable-next-line no-console
  console.log('');
}

if (require.main === module) {
  runBenchmark().then(printReport);
}
