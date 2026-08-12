import { extractFeatures, featureVector } from '../util/expression';
import { Provider } from '../providers/types';
import { verifyCheapAnswer } from '../verifier/verifier';
import { BudgetStore } from '../budget/types';
import {
  BudgetAlert,
  DifficultyClassifier,
  RouteRequest,
  RouteResponse,
  RouterConfig,
  DEFAULT_ROUTER_CONFIG,
} from './types';
import { TrainingExample } from '../classifier/types';

interface OutcomeLogEntry {
  features: number[];
  escalated: boolean;
}

/** Orchestrates classify -> route -> optionally escalate -> track budget. See README "Architecture". */
export class CostRouter {
  private readonly outcomeLog: OutcomeLogEntry[] = [];

  constructor(
    private readonly classifier: DifficultyClassifier,
    private readonly cheapProvider: Provider,
    private readonly expensiveProvider: Provider,
    private readonly budgetStore: BudgetStore,
    private readonly config: RouterConfig = DEFAULT_ROUTER_CONFIG,
  ) {}

  async route(req: RouteRequest): Promise<RouteResponse> {
    const features = extractFeatures(req.query);
    const vector = featureVector(features);
    const difficultyScore = this.classifier.predictProba(vector);

    let modelUsed: 'cheap' | 'expensive';
    let escalated = false;
    let confidence: number | null = null;
    let costCents = 0;
    let value: number;
    let raw: string;

    if (difficultyScore >= this.config.difficultyThreshold) {
      // Classifier is confident this is hard: skip the cheap attempt entirely.
      const result = this.expensiveProvider.answer(req.query);
      value = result.value;
      raw = result.raw;
      modelUsed = 'expensive';
      costCents = this.expensiveProvider.costCentsPerQuery;
    } else {
      const cheapResult = this.cheapProvider.answer(req.query);
      costCents = this.cheapProvider.costCentsPerQuery;
      const verdict = verifyCheapAnswer(req.query, features);
      confidence = verdict.confidence;

      if (confidence < this.config.confidenceThreshold) {
        // Verifier caught what the classifier missed: pay for both calls, escalate.
        const expensiveResult = this.expensiveProvider.answer(req.query);
        value = expensiveResult.value;
        raw = expensiveResult.raw;
        modelUsed = 'expensive';
        escalated = true;
        costCents += this.expensiveProvider.costCentsPerQuery;
      } else {
        value = cheapResult.value;
        raw = cheapResult.raw;
        modelUsed = 'cheap';
      }
    }

    this.outcomeLog.push({ features: vector, escalated });
    await this.budgetStore.record(req.tenantId, costCents, escalated);
    const alert = await this.detectEscalationSpike(req.tenantId);

    return { answer: value, raw, modelUsed, escalated, difficultyScore, confidence, costCents, alert };
  }

  /** Short-window vs. baseline-window escalation rate: a spike signals a difficulty-distribution shift, not a block. */
  private async detectEscalationSpike(tenantId: string): Promise<BudgetAlert | null> {
    const { shortWindowMs, baselineWindowMs, spikeMultiplier, minSampleForSpike } = this.config;
    const [short, baseline] = await Promise.all([
      this.budgetStore.getRollingWindow(tenantId, shortWindowMs),
      this.budgetStore.getRollingWindow(tenantId, baselineWindowMs),
    ]);
    if (short.requests < minSampleForSpike) return null;

    const shortTermRate = short.escalations / short.requests;
    const baselineRate = baseline.requests > 0 ? baseline.escalations / baseline.requests : 0;
    // Floor avoids flagging a "spike" off a near-zero baseline on trivial absolute rates.
    const effectiveBaseline = Math.max(baselineRate, 0.02);

    if (shortTermRate > effectiveBaseline * spikeMultiplier) {
      return {
        tenantId,
        kind: 'escalation_rate_spike',
        message:
          `Escalation rate for ${tenantId} is ${(shortTermRate * 100).toFixed(1)}% over the last ` +
          `${Math.round(shortWindowMs / 60000)}min, vs a ${(baselineRate * 100).toFixed(1)}% baseline — ` +
          `likely a shift in this tenant's query difficulty distribution.`,
        shortTermRate,
        baselineRate,
      };
    }
    return null;
  }

  /** Outcomes so far, shaped for LogisticClassifier.train() — escalation stands in for "cheap would've been wrong". */
  getTrainingLog(): TrainingExample[] {
    return this.outcomeLog.map((e) => ({ features: e.features, label: e.escalated ? 1 : 0 }));
  }
}
