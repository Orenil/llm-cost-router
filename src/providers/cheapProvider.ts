import { evaluateCheap } from '../util/expression';
import { Provider, ModelAnswer } from './types';

/**
 * Deterministic stand-in for a cheap/fast model tier (e.g. gpt-4o-mini,
 * claude-haiku). Real cost ratios between "mini" and flagship tiers from the
 * major providers run roughly 15-30x; 0.08 vs 2.5 cents/query below mirrors
 * that order of magnitude. See README for how to swap this for a real
 * API-calling provider.
 */
export class CheapProvider implements Provider {
  readonly name = 'cheap';
  readonly costCentsPerQuery = 0.08;

  answer(expression: string): ModelAnswer {
    const value = evaluateCheap(expression);
    return { value, raw: `cheap-model result: ${value}` };
  }
}
