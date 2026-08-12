import { InMemoryBudgetStore } from '../src/budget/inMemoryBudgetStore';

describe('budget/InMemoryBudgetStore', () => {
  it('accumulates requests, cost, and escalations for a tenant', async () => {
    const store = new InMemoryBudgetStore();
    const now = 1_000_000;
    await store.record('t1', 0.08, false, now);
    await store.record('t1', 0.08, false, now + 10);
    await store.record('t1', 2.58, true, now + 20);

    const window = await store.getRollingWindow('t1', 60_000, now + 30);
    expect(window.requests).toBe(3);
    expect(window.costCents).toBeCloseTo(2.74);
    expect(window.escalations).toBe(1);
  });

  it('keeps tenants isolated', async () => {
    const store = new InMemoryBudgetStore();
    const now = 1_000_000;
    await store.record('t1', 1, false, now);
    await store.record('t2', 5, true, now);

    const w1 = await store.getRollingWindow('t1', 60_000, now);
    const w2 = await store.getRollingWindow('t2', 60_000, now);
    expect(w1.requests).toBe(1);
    expect(w1.costCents).toBe(1);
    expect(w2.requests).toBe(1);
    expect(w2.costCents).toBe(5);
  });

  it('rolling window excludes events older than windowMs', async () => {
    const store = new InMemoryBudgetStore();
    const now = 1_000_000;
    await store.record('t1', 1, false, now - 120_000); // 2 minutes ago
    await store.record('t1', 1, false, now - 10_000); // 10 seconds ago

    const window = await store.getRollingWindow('t1', 60_000, now); // 1 minute window
    expect(window.requests).toBe(1);
    expect(window.costCents).toBe(1);
  });

  it('an unknown tenant has an empty window, not an error', async () => {
    const store = new InMemoryBudgetStore();
    const window = await store.getRollingWindow('ghost', 60_000);
    expect(window).toEqual({ requests: 0, costCents: 0, escalations: 0 });
  });

  it('querying a short window does not corrupt results for a subsequent larger window on the same tenant', async () => {
    // Regression guard: pruning must be keyed off a fixed retention horizon, not off
    // whatever windowMs a particular read happens to request — otherwise a spike-detector
    // querying a 5min window before a 60min baseline window would blow away data the
    // baseline query still needed.
    const store = new InMemoryBudgetStore();
    const now = 1_000_000;
    await store.record('t1', 1, false, now - 50 * 60_000); // 50 minutes ago
    await store.record('t1', 1, false, now - 60_000); // 1 minute ago

    const short = await store.getRollingWindow('t1', 5 * 60_000, now); // queried first, smaller window
    expect(short.requests).toBe(1);

    const longer = await store.getRollingWindow('t1', 60 * 60_000, now); // queried second, larger window
    expect(longer.requests).toBe(2);
  });

  it('prunes events beyond the configured retention horizon, independent of query window size', async () => {
    const store = new InMemoryBudgetStore(60 * 60_000); // 1 hour retention
    const now = 1_000_000;
    await store.record('t1', 1, false, now - 2 * 60 * 60_000); // 2 hours ago: beyond retention
    await store.record('t1', 1, false, now - 60_000); // 1 minute ago: within retention

    const window = await store.getRollingWindow('t1', 24 * 60 * 60_000, now); // huge query window
    expect(window.requests).toBe(1); // the 2-hour-old event is gone regardless of the wide query window
  });
});
