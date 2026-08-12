import type Redis from 'ioredis';
import { BudgetStore, RollingWindow } from './types';

/**
 * Production BudgetStore backed by Redis sorted sets — one ZSET per tenant,
 * scored by timestamp so a rolling window is a single ZRANGEBYSCORE. Real,
 * wire-correct ioredis code, not exercised by the test suite here (no
 * Redis server in this environment — see README). Member encoding packs
 * cost/escalated into the member string so one read reconstructs the window.
 */
export class RedisBudgetStore implements BudgetStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = 'llm-cost-router:budget:',
    /** Safety net: entries older than this are pruned lazily on write so a key can't grow forever. */
    private readonly maxRetentionMs = 24 * 60 * 60 * 1000,
  ) {}

  private key(tenantId: string): string {
    return `${this.keyPrefix}${tenantId}`;
  }

  async record(tenantId: string, costCents: number, escalated: boolean, now = Date.now()): Promise<void> {
    const key = this.key(tenantId);
    const suffix = Math.random().toString(36).slice(2, 8);
    const member = `${now}:${suffix}:${costCents}:${escalated ? 1 : 0}`;
    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, now, member);
    pipeline.zremrangebyscore(key, 0, now - this.maxRetentionMs);
    pipeline.pexpire(key, this.maxRetentionMs);
    await pipeline.exec();
  }

  async getRollingWindow(tenantId: string, windowMs: number, now = Date.now()): Promise<RollingWindow> {
    const key = this.key(tenantId);
    const cutoff = now - windowMs;
    const members: string[] = await this.redis.zrangebyscore(key, cutoff, '+inf');
    const window: RollingWindow = { requests: 0, costCents: 0, escalations: 0 };
    for (const member of members) {
      const parts = member.split(':');
      const costCents = Number(parts[2]);
      const escalated = parts[3] === '1';
      window.requests += 1;
      window.costCents += Number.isFinite(costCents) ? costCents : 0;
      if (escalated) window.escalations += 1;
    }
    return window;
  }
}
