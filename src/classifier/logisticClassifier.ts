import { dot, sigmoid, clamp } from '../math/linalg';
import { TrainingExample, TrainOptions } from './types';

/**
 * Hand-rolled logistic regression: predicts P(cheap model will get this
 * query wrong) from surface query features. Weights include a bias term
 * at index 0. See README "Why collapse the classifier into this process".
 */
export class LogisticClassifier {
  weights: number[];

  constructor(numFeatures: number, initialWeights?: number[]) {
    this.weights = initialWeights ? [...initialWeights] : new Array(numFeatures + 1).fill(0);
  }

  predictProba(features: number[]): number {
    const z = this.weights[0] + dot(this.weights.slice(1), features);
    return sigmoid(z);
  }

  /** Full-batch gradient descent with L2 regularization — see CostRouter.getTrainingLog for the retraining feedback loop. */
  train(dataset: TrainingExample[], opts: TrainOptions = {}): void {
    if (dataset.length === 0) throw new Error('train(): empty dataset');
    const epochs = opts.epochs ?? 300;
    const lr = opts.learningRate ?? 0.5;
    const l2 = opts.l2 ?? 0.01;
    const n = dataset.length;
    const numFeatures = dataset[0].features.length;
    if (this.weights.length !== numFeatures + 1) {
      this.weights = new Array(numFeatures + 1).fill(0);
    }

    for (let epoch = 0; epoch < epochs; epoch++) {
      const grad = new Array(this.weights.length).fill(0);
      for (const { features, label } of dataset) {
        const pred = this.predictProba(features);
        const error = pred - label;
        grad[0] += error;
        for (let i = 0; i < features.length; i++) {
          grad[i + 1] += error * features[i];
        }
      }
      this.weights[0] -= lr * (grad[0] / n);
      for (let i = 1; i < this.weights.length; i++) {
        const reg = l2 * this.weights[i];
        this.weights[i] -= lr * (grad[i] / n + reg);
      }
    }
  }

  /** Clamp-guarded predict for callers that want a hard 0/1 difficulty label. */
  predictHard(features: number[], threshold = 0.5): 0 | 1 {
    return this.predictProba(features) >= threshold ? 1 : 0;
  }

  toJSON(): { weights: number[] } {
    return { weights: this.weights };
  }

  static fromJSON(json: { weights: number[] }): LogisticClassifier {
    return new LogisticClassifier(json.weights.length - 1, json.weights);
  }
}

/** Deliberately miscalibrated classifier for the chaos test: always confident "easy". */
export class AlwaysEasyClassifier extends LogisticClassifier {
  constructor() {
    super(1);
  }
  predictProba(_features: number[]): number {
    return clamp(0.01, 0, 1);
  }
  train(): void {
    // intentionally inert — this classifier never learns, by design.
  }
}
