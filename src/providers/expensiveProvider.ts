import { evaluateCorrect } from '../util/expression';
import { Provider, ModelAnswer } from './types';

/** Deterministic stand-in for a frontier model tier. Always correct, ~31x cost. */
export class ExpensiveProvider implements Provider {
  readonly name = 'expensive';
  readonly costCentsPerQuery = 2.5;

  answer(expression: string): ModelAnswer {
    const value = evaluateCorrect(expression);
    return { value, raw: `expensive-model result: ${value}` };
  }
}
