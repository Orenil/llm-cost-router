import { ExpressionFeatures, hasMixedPrecedence } from '../util/expression';

export interface VerifierResult {
  confidence: number;
  reason: string;
}

/**
 * Self-scores a cheap-model response without ever seeing the ground-truth
 * answer, by inspecting grouping structure for the condition under which
 * the cheap evaluator is known to diverge (see util/expression.ts). See
 * README "The verifier" for how a real-LLM verifier would generalize this.
 */
export function verifyCheapAnswer(expression: string, _features: ExpressionFeatures): VerifierResult {
  if (hasMixedPrecedence(expression)) {
    return {
      confidence: 0.15,
      reason: 'grouping mixes additive and multiplicative operators at some level; cheap evaluator order-of-operations is unreliable here',
    };
  }
  return { confidence: 0.95, reason: 'no mixed-precedence grouping detected; cheap evaluator is reliable here' };
}
