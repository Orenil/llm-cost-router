/**
 * Provider interface a real deployment would implement against OpenAI,
 * Anthropic, etc. — see README "Provider interface" section for how an
 * env-var-configured HTTP-calling implementation would plug in here without
 * touching router/classifier/verifier code.
 */
export interface ModelAnswer {
  value: number;
  raw: string;
}

export interface Provider {
  readonly name: string;
  readonly costCentsPerQuery: number;
  answer(expression: string): ModelAnswer;
}
