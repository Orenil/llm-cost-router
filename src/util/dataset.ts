import { mulberry32, randInt, pick } from './prng';
import { evaluateCorrect, evaluateCheap } from './expression';

export interface SyntheticQuery {
  id: string;
  tenantId: string;
  expression: string;
  trueAnswer: number;
}

const OPERATORS = ['+', '-', '*', '/'] as const;

function genNumber(rng: () => number): string {
  const digits = randInt(rng, 1, 3);
  const magnitude = 10 ** digits;
  const value = randInt(rng, 1, magnitude - 1);
  if (rng() < 0.15) {
    const tenths = randInt(rng, 1, 9);
    return `${value}.${tenths}`;
  }
  return String(value);
}

function genOperand(rng: () => number, depth: number): string {
  if (depth <= 0 || rng() < 0.55) return genNumber(rng);
  return `(${genChain(rng, depth - 1)})`;
}

function genChain(rng: () => number, depth: number): string {
  const numOperands = randInt(rng, 2, 3);
  const parts: string[] = [genOperand(rng, depth)];
  for (let k = 1; k < numOperands; k++) {
    parts.push(pick(rng, OPERATORS));
    parts.push(genOperand(rng, depth));
  }
  return parts.join(' ');
}

/**
 * Generates a reproducible synthetic query set, seeded, standing in for
 * historical production traffic across a handful of tenants. maxDepth is
 * drawn per-query so the set spans a realistic mix of trivial and gnarly
 * expressions.
 */
export function generateQueries(count: number, seed: number, tenantIds: readonly string[]): SyntheticQuery[] {
  const rng = mulberry32(seed);
  const queries: SyntheticQuery[] = [];
  let attempts = 0;
  while (queries.length < count && attempts < count * 50) {
    attempts++;
    const maxDepth = randInt(rng, 0, 3);
    const expression = genChain(rng, maxDepth);
    let trueAnswer: number;
    try {
      trueAnswer = evaluateCorrect(expression);
    } catch {
      continue;
    }
    if (!Number.isFinite(trueAnswer)) continue;
    const tenantId = pick(rng, tenantIds);
    queries.push({ id: `q-${queries.length}`, tenantId, expression, trueAnswer });
  }
  if (queries.length < count) {
    throw new Error(`generateQueries: only produced ${queries.length}/${count} valid queries`);
  }
  return queries;
}

const EPSILON = 1e-9;

/** Whether the cheap evaluator's answer to this query disagrees with ground truth. */
export function isCheapWrong(query: SyntheticQuery): boolean {
  try {
    const cheapAnswer = evaluateCheap(query.expression);
    return Math.abs(cheapAnswer - query.trueAnswer) > EPSILON;
  } catch {
    return true;
  }
}
