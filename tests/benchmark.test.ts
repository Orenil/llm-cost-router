import { runBenchmark } from '../src/benchmark';

describe('benchmark: offline replay cost/accuracy tradeoff', () => {
  it('the router is materially cheaper than always-expensive with accuracy within a small delta', async () => {
    const { results } = await runBenchmark(800, 500);
    const cheap = results.find((r) => r.strategy === 'always-cheap')!;
    const expensive = results.find((r) => r.strategy === 'always-expensive')!;
    const router = results.find((r) => r.strategy === 'cost-router')!;

    // cheap is in fact cheaper and less accurate than expensive (sanity check on the harness itself)
    expect(cheap.totalCostCents).toBeLessThan(expensive.totalCostCents);
    expect(cheap.accuracy).toBeLessThan(expensive.accuracy);

    // the router must cost materially less than always-big-model...
    expect(router.totalCostCents).toBeLessThan(expensive.totalCostCents * 0.75);
    // ...while staying within a small accuracy delta of it (verifier-driven escalation
    // should in fact recover full accuracy here, since it deterministically catches
    // every cheap-model mistake in this benchmark's error mode).
    expect(expensive.accuracy - router.accuracy).toBeLessThanOrEqual(0.01);

    expect(router.escalationRate).not.toBeNull();
    expect(router.escalationRate as number).toBeGreaterThan(0);
  });
});
