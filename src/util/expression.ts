/**
 * Query domain: arithmetic expressions ("3 + 4 * (2 - 1)") stand in for LLM
 * queries — see README "Why arithmetic" for the full rationale. Two
 * evaluators over the same grammar play the two model tiers: the correct
 * one (expensive, never wrong) and a naive left-to-right one (cheap, wrong
 * exactly when a grouping level mixes +/- with * /).
 */

export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const raw = expr.slice(i, j);
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`Invalid number literal: "${raw}"`);
      tokens.push({ kind: 'num', value });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character "${c}" at position ${i} in "${expr}"`);
  }
  return tokens;
}

class Cursor {
  constructor(
    public tokens: Token[],
    public pos = 0,
  ) {}
  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('Unexpected end of expression');
    this.pos++;
    return t;
  }
}

/** Correct evaluator: standard precedence, respects grouping. Never wrong. */
export function evaluateCorrect(expr: string): number {
  const c = new Cursor(tokenize(expr));
  const result = parseAdditive(c);
  if (c.pos !== c.tokens.length) throw new Error(`Unconsumed input in "${expr}"`);
  return result;
}

function isAdditiveOp(t: Token | undefined): t is { kind: 'op'; value: '+' | '-' } {
  return t?.kind === 'op' && (t.value === '+' || t.value === '-');
}

function isMultiplicativeOp(t: Token | undefined): t is { kind: 'op'; value: '*' | '/' } {
  return t?.kind === 'op' && (t.value === '*' || t.value === '/');
}

function parseAdditive(c: Cursor): number {
  let value = parseMultiplicative(c);
  while (isAdditiveOp(c.peek())) {
    const op = (c.next() as { kind: 'op'; value: '+' | '-' }).value;
    const rhs = parseMultiplicative(c);
    value = op === '+' ? value + rhs : value - rhs;
  }
  return value;
}

function parseMultiplicative(c: Cursor): number {
  let value = parseAtom(c);
  while (isMultiplicativeOp(c.peek())) {
    const op = (c.next() as { kind: 'op'; value: '*' | '/' }).value;
    const rhs = parseAtom(c);
    value = op === '*' ? value * rhs : value / rhs;
  }
  return value;
}

function parseAtom(c: Cursor): number {
  const t = c.next();
  if (t.kind === 'num') return t.value;
  if (t.kind === 'lparen') {
    const value = parseAdditive(c);
    const close = c.next();
    if (close.kind !== 'rparen') throw new Error('Expected closing paren');
    return value;
  }
  throw new Error(`Unexpected token ${JSON.stringify(t)}`);
}

/** Cheap evaluator: respects grouping but applies operators left-to-right within each group (no * / precedence). */
export function evaluateCheap(expr: string): number {
  const c = new Cursor(tokenize(expr));
  const result = parseFlatGroup(c);
  if (c.pos !== c.tokens.length) throw new Error(`Unconsumed input in "${expr}"`);
  return result;
}

function parseFlatGroup(c: Cursor): number {
  let value = parseFlatAtom(c);
  while (c.peek()?.kind === 'op') {
    const op = (c.next() as { kind: 'op'; value: '+' | '-' | '*' | '/' }).value;
    const rhs = parseFlatAtom(c);
    switch (op) {
      case '+':
        value = value + rhs;
        break;
      case '-':
        value = value - rhs;
        break;
      case '*':
        value = value * rhs;
        break;
      case '/':
        value = value / rhs;
        break;
    }
  }
  return value;
}

function parseFlatAtom(c: Cursor): number {
  const t = c.next();
  if (t.kind === 'num') return t.value;
  if (t.kind === 'lparen') {
    const value = parseFlatGroup(c);
    const close = c.next();
    if (close.kind !== 'rparen') throw new Error('Expected closing paren');
    return value;
  }
  throw new Error(`Unexpected token ${JSON.stringify(t)}`);
}

/**
 * Does any grouping level mix +/- with * /? A necessary (not sufficient)
 * condition for evaluateCheap to diverge from evaluateCorrect — see
 * verifier/verifier.ts and README "Why the verifier is safe" for the proof.
 */
export function hasMixedPrecedence(expr: string): boolean {
  const tokens = tokenize(expr);
  let pos = 0;
  function scanGroup(): boolean {
    let sawAdditive = false;
    let sawMultiplicative = false;
    let mixed = false;
    // consume first atom
    pos = consumeAtom(pos);
    while (pos < tokens.length && tokens[pos].kind === 'op') {
      const opToken = tokens[pos] as { kind: 'op'; value: '+' | '-' | '*' | '/' };
      if (opToken.value === '+' || opToken.value === '-') sawAdditive = true;
      else sawMultiplicative = true;
      pos++;
      pos = consumeAtom(pos);
    }
    if (sawAdditive && sawMultiplicative) mixed = true;
    return mixed;
  }
  function consumeAtom(p: number): number {
    const t = tokens[p];
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'num') return p + 1;
    if (t.kind === 'lparen') {
      pos = p + 1;
      const innerMixed = scanGroup();
      if (innerMixed) anyMixed = true;
      const close = tokens[pos];
      if (!close || close.kind !== 'rparen') throw new Error('Expected closing paren');
      return pos + 1;
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }
  let anyMixed = false;
  const topMixed = scanGroup();
  return topMixed || anyMixed;
}

export interface ExpressionFeatures {
  length: number;
  numOperators: number;
  maxParenDepth: number;
  hasDecimal: boolean;
  maxDigits: number;
  numOperands: number;
}

/** Surface features for the classifier. Deliberately excludes hasMixedPrecedence — see README. */
export function extractFeatures(expr: string): ExpressionFeatures {
  const tokens = tokenize(expr);
  let depth = 0;
  let maxDepth = 0;
  let numOperators = 0;
  let hasDecimal = false;
  let maxDigits = 0;
  let numOperands = 0;
  for (const t of tokens) {
    if (t.kind === 'lparen') {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (t.kind === 'rparen') {
      depth--;
    } else if (t.kind === 'op') {
      numOperators++;
    } else if (t.kind === 'num') {
      numOperands++;
      if (!Number.isInteger(t.value)) hasDecimal = true;
      const digits = t.value.toString().replace(/[.-]/g, '').length;
      maxDigits = Math.max(maxDigits, digits);
    }
  }
  return {
    length: expr.length,
    numOperators,
    maxParenDepth: maxDepth,
    hasDecimal,
    maxDigits,
    numOperands,
  };
}

/** Fixed feature ordering used everywhere a plain number[] vector is needed. */
export function featureVector(f: ExpressionFeatures): number[] {
  return [
    f.length / 40,
    f.numOperators / 8,
    f.maxParenDepth / 3,
    f.hasDecimal ? 1 : 0,
    f.maxDigits / 4,
    f.numOperands / 8,
  ];
}
