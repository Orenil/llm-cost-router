export interface RollingWindow {
  requests: number;
  costCents: number;
  escalations: number;
}

/**
 * Pluggable per-tenant budget/counter store. Two implementations ship here:
 * InMemoryBudgetStore (Map-based, what the test suite exercises) and
 * RedisBudgetStore (real ioredis code for production — see README for why
 * it isn't exercised by tests in this environment). Both implement rolling
 * (not fixed-bucket) windows: getRollingWindow(tenantId, windowMs) always
 * reflects exactly the last windowMs of traffic as of `now`.
 */
export interface BudgetStore {
  record(tenantId: string, costCents: number, escalated: boolean, now?: number): Promise<void>;
  getRollingWindow(tenantId: string, windowMs: number, now?: number): Promise<RollingWindow>;
}
