/** Structural interface so the router doesn't care whether it's driving a real or chaos-test classifier. */
export interface DifficultyClassifier {
  predictProba(features: number[]): number;
}

export interface RouteRequest {
  tenantId: string;
  /** Arithmetic expression standing in for a natural-language query — see util/expression.ts. */
  query: string;
}

export interface RouteResponse {
  answer: number;
  raw: string;
  modelUsed: 'cheap' | 'expensive';
  escalated: boolean;
  difficultyScore: number;
  confidence: number | null;
  costCents: number;
  alert: BudgetAlert | null;
}

export interface BudgetAlert {
  tenantId: string;
  kind: 'escalation_rate_spike';
  message: string;
  shortTermRate: number;
  baselineRate: number;
}

export interface RouterConfig {
  /** Classifier P(hard) at/above this routes straight to the expensive model. */
  difficultyThreshold: number;
  /** Verifier confidence below this on a cheap answer triggers escalation. */
  confidenceThreshold: number;
  /** Rolling window used for spike detection, in ms. */
  shortWindowMs: number;
  baselineWindowMs: number;
  /** Short-term escalation rate must exceed baseline by this multiple, with a minimum sample size, to alert. */
  spikeMultiplier: number;
  minSampleForSpike: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  difficultyThreshold: 0.5,
  confidenceThreshold: 0.5,
  shortWindowMs: 5 * 60 * 1000,
  baselineWindowMs: 60 * 60 * 1000,
  spikeMultiplier: 2.5,
  minSampleForSpike: 10,
};
