import { LogisticClassifier, AlwaysEasyClassifier } from '../src/classifier/logisticClassifier';
import { generateQueries, isCheapWrong } from '../src/util/dataset';
import { extractFeatures, featureVector } from '../src/util/expression';

function buildDataset(seed: number, n: number) {
  const queries = generateQueries(n, seed, ['t1', 't2']);
  return queries.map((q) => ({
    features: featureVector(extractFeatures(q.expression)),
    label: isCheapWrong(q) ? 1 : 0,
  }));
}

describe('classifier/logisticClassifier', () => {
  it('predictProba returns a probability in [0,1]', () => {
    const c = new LogisticClassifier(6);
    const p = c.predictProba([0, 0, 0, 0, 0, 0]);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('an untrained classifier predicts 0.5 everywhere (all-zero weights)', () => {
    const c = new LogisticClassifier(6);
    expect(c.predictProba([1, 2, 3, 4, 5, 6])).toBeCloseTo(0.5);
  });

  it('training on a separable-ish historical log measurably improves discrimination', () => {
    const train = buildDataset(11, 1200);
    const classifier = new LogisticClassifier(train[0].features.length);
    classifier.train(train);

    const test = buildDataset(22, 400);
    let correct = 0;
    for (const ex of test) {
      const pred = classifier.predictHard(ex.features);
      if (pred === ex.label) correct++;
    }
    const accuracy = correct / test.length;
    // Should meaningfully beat a coin flip / always-predict-majority-class baseline.
    expect(accuracy).toBeGreaterThan(0.6);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const train = buildDataset(11, 300);
    const classifier = new LogisticClassifier(train[0].features.length);
    classifier.train(train, { epochs: 50 });
    const restored = LogisticClassifier.fromJSON(classifier.toJSON());
    for (const ex of train.slice(0, 20)) {
      expect(restored.predictProba(ex.features)).toBeCloseTo(classifier.predictProba(ex.features), 10);
    }
  });

  it('AlwaysEasyClassifier is deliberately miscalibrated toward "easy"', () => {
    const c = new AlwaysEasyClassifier();
    expect(c.predictProba([9, 9, 9, 9, 9, 9])).toBeLessThan(0.05);
    c.train(); // no-op, should not throw
  });
});
