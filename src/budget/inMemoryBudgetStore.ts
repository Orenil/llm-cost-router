import { BudgetStore, RollingWindow } from './types';

interface BudgetEvent {
  ts: number;
  costCents: number;
  escalated: boolean;
}

/**
 * Map-based in-process BudgetStore: exact rolling windows via timestamp
 * filtering, O(events) per read. Pruning is keyed off a fixed
 * maxRetentionMs, not off whatever windowMs a given read asks for — the
 * router queries this with several window sizes (short + baseline), and
 * pruning to the smallest one would corrupt larger windows queried after.
 */
export class InMemoryBudgetStore implements BudgetStore {
  private events = new Map<string, BudgetEvent[]>();

  constructor(private readonly maxRetentionMs = 24 * 60 * 60 * 1000) {}

  async record(tenantId: string, costCents: number, escalated: boolean, now = Date.now()): Promise<void> {
    const arr = this.events.get(tenantId) ?? [];
    arr.push({ ts: now, costCents, escalated });
    this.events.set(tenantId, this.prune(arr, now));
  }

  async getRollingWindow(tenantId: string, windowMs: number, now = Date.now()): Promise<RollingWindow> {
    const arr = this.events.get(tenantId) ?? [];
    const cutoff = now - windowMs;
    const relevant = arr.filter((e) => e.ts >= cutoff);
    return relevant.reduce<RollingWindow>(
      (acc, e) => ({
        requests: acc.requests + 1,
        costCents: acc.costCents + e.costCents,
        escalations: acc.escalations + (e.escalated ? 1 : 0),
      }),
      { requests: 0, costCents: 0, escalations: 0 },
    );
  }

  private prune(arr: BudgetEvent[], now: number): BudgetEvent[] {
    const cutoff = now - this.maxRetentionMs;
    return arr.filter((e) => e.ts >= cutoff);
  }

  /** Test/debug helper — not part of the BudgetStore interface. */
  clear(): void {
    this.events.clear();
  }
}
