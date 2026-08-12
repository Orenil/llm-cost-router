# llm-cost-router

A request router that classifies query difficulty and routes to the cheapest model capable of answering correctly, escalating to a stronger model when a lightweight verifier flags low confidence in the cheap model's answer.

## The problem

Teams default to routing every request to their most expensive model tier "to be safe," and LLM spend becomes the largest infra line item even though most queries don't need frontier capability. A router that can tell easy from hard queries — and, critically, recover when it gets that call wrong — can cut spend materially without eating a wrong-answer regression.

## Why arithmetic expressions, not a real LLM

This router needs a genuinely different-accuracy-and-cost pair of "models" to route between, and a mechanically checkable ground truth to build a provable cost/accuracy benchmark against — without calling a real paid API (out of scope here) or faking accuracy numbers with mock data (against the brief).

So the "query" domain is arithmetic expressions, e.g. `"3 + 4 * (2 - 1)"`, and the two model tiers are two real evaluators over the same grammar (`src/util/expression.ts`):

- **expensive model** — a correct recursive-descent evaluator: standard operator precedence, respects parenthesized grouping. Never wrong.
- **cheap model** — respects grouping but evaluates each group strictly left-to-right, ignoring `*`/`/` precedence over `+`/`-`. A classic "naive calculator" bug. It's wrong exactly when some grouping level mixes an additive operator with a multiplicative one, because that's precisely when evaluation order changes the result.

This gives a systematic, deterministic, provable accuracy gap between the two tiers (measured directly in `tests/providers.test.ts` and the offline replay benchmark below) that a difficulty classifier can learn to predict from surface features, and that a verifier can catch after the fact by inspecting grouping structure — without ever needing the ground-truth answer. Everything downstream (classifier, verifier, router, budget tracking, escalation) is real production-shaped logic; only the "model" itself is a stand-in.

**Plugging in a real LLM provider:** swap `CheapProvider`/`ExpensiveProvider` (`src/providers/`) for implementations of the same `Provider` interface (`answer(query): { value, raw }`, `costCentsPerQuery`) that call OpenAI/Anthropic/etc. over HTTP, with API keys read from env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ...) the same way `REDIS_URL` is read for the budget store. Nothing in the classifier, verifier, router, or budget layer needs to change — they only depend on the `Provider` interface.

## Architecture

```
POST /route { tenantId, query }
        │
        ▼
  extract features (src/util/expression.ts)
        │
        ▼
  classifier.predictProba(features)  ──► difficulty score
        │
   ┌────┴─────┐
   │           │
 hard        easy/uncertain
   │           │
   ▼           ▼
expensive   cheap model
provider    provider
   │           │
   │        verifier.score(query) ──► confidence
   │           │
   │      ┌────┴────┐
   │    low conf   high conf
   │      │           │
   │      ▼           │
   │  expensive        │
   │  provider         │
   │  (escalate)        │
   │      │           │
   └──────┴─────┬─────┘
                ▼
        budgetStore.record(tenant, cost, escalated)
                │
                ▼
        detect escalation-rate spike vs. baseline
                │
                ▼
   { answer, modelUsed, escalated, difficultyScore,
     confidence, costCents, alert }
```

### Design decisions

**Classifier is a hand-rolled logistic regression, not a generic complexity heuristic.** `src/classifier/logisticClassifier.ts` trains via plain gradient descent on `(query features, cheap-model-was-wrong)` pairs — a stand-in for a team's historical query/outcome log (`src/util/dataset.ts` generates the synthetic version; `src/server.ts`/`src/benchmark.ts` show how it's trained on startup). The features fed to it (expression length, operator count, paren depth, decimal presence, max digit count) are deliberately generic surface features — they do **not** include the exact structural signal that determines correctness (see verifier, below). This mirrors reality: a real classifier only sees request metadata, and has to learn a noisy proxy for difficulty, not an oracle.

**Escalation is confidence-based, not just difficulty-based.** `src/verifier/verifier.ts` self-scores a cheap-model response by checking whether any grouping level in the query mixes an additive and a multiplicative operator (`hasMixedPrecedence` in `src/util/expression.ts`) — the exact structural condition the cheap evaluator is known to mishandle. Crucially, this check is **one-directional and provably safe**: if no grouping level mixes operator types, the cheap evaluator is *guaranteed* correct (both evaluators reduce to identical left-associative same-precedence chains); if some level does mix types, the cheap evaluator *might* be wrong (it can coincidentally still land on the right answer, e.g. `"2 * 3 + 4"`, where the multiplicative op already comes first). So the verifier can over-flag (wasting an escalation on a query the cheap model actually got right) but can never under-flag a real miss — zero false negatives, proven in `tests/verifier.test.ts` and exploited directly by the chaos test. A verifier over real LLM text would use an analogous but softer signal — self-consistency across resampled completions, output-schema checks, or a small trained "does this answer look right" classifier — behind the same answer-agnostic interface (`verifyCheapAnswer(query, features) -> { confidence, reason }`), so swapping it in doesn't touch the router.

**Budget tracking is a genuinely pluggable backend, not a mock.** `src/budget/types.ts` defines a small `BudgetStore` interface (`record`, `getRollingWindow`). Two implementations ship:
  - `InMemoryBudgetStore` — Map-based, exact rolling windows via timestamp filtering. This is what the test suite runs against.
  - `RedisBudgetStore` — real `ioredis` code using one sorted set per tenant (score = timestamp), so a rolling window read is a single `ZRANGEBYSCORE`. Wire-correct, but not exercised by the test suite in this environment (no Redis server here) — `REDIS_URL` selects it in `src/server.ts` when set, otherwise the in-memory store is used.

  Escalation-rate spike detection (`CostRouter.detectEscalationSpike`) compares a short rolling window's escalation rate against a longer baseline window per tenant; a spike surfaces as `alert` in the response metadata rather than blocking traffic — a shift in a tenant's query difficulty distribution should be visible to an operator, not silently absorbed as extra spend.

**The classifier/verifier/router all run in one Node process, not split into a Node gateway + Python sidecar.** The spec's target architecture is a TypeScript gateway on the request hot path plus a Python (scikit-learn/onnx) sidecar for the classifier. Given this project's ~300–800 line scope, that split was collapsed: the classifier here is small enough (6 features, gradient descent, no matrix libraries) that hand-rolling it in TypeScript avoids a second process, a serialization boundary, and an RPC hop on the hot path, at the cost of losing Python's ML ecosystem (real sklearn model classes, proper cross-validation tooling, etc.). **How a production version would split it back out:** train offline in Python against the real query/outcome warehouse table, export the fitted weight vector as JSON (this classifier's `toJSON()`/`fromJSON()` already round-trip that shape) or as ONNX if the model grows past what a hand-rolled linear model can express, and either (a) load the weights into this same in-process TS predictor (cheap, keeps the hot path in one process, works as long as the model stays linear/small) or (b) call an ONNX Runtime sidecar over gRPC for a heavier model, with the Node gateway keeping its own fallback (e.g. always-cheap) if the sidecar call times out.

**Rejected: fixed-bucket rolling windows.** Considered bucketing budget counters into fixed time buckets (e.g. per-minute) instead of raw event lists, which is the standard way to bound memory in a real counter store. Went with exact per-event filtering instead for `InMemoryBudgetStore` since it's simpler to reason about correctness for (no bucket-boundary edge cases) at the request volumes a single test suite or single-instance gateway handles; `RedisBudgetStore`'s sorted-set approach gets the same exactness with Redis handling the memory bound via `maxRetentionMs` + `ZREMRANGEBYSCORE`.

**Rejected: routing based on difficulty score alone, no verifier.** Would be simpler, but the whole point of the spec is that misclassification shouldn't cost an org a wrong answer — a bad classifier day (chaos test) would silently ship wrong answers instead of just costing more. Confidence-based escalation trades a bounded amount of extra spend for a bound on wrong answers slipping through classifier error.

## Setup

```bash
git clone <this-repo>
cd llm-cost-router
npm install
npm test          # unit tests + integration + chaos test + benchmark assertion
npm run benchmark # prints the offline replay cost/accuracy table
npm run build      # compile to dist/
npm run dev        # runs the /route API on :3000 (ts-node)
```

No Redis or Docker required for any of the above — `RedisBudgetStore` is real code but only instantiated if `REDIS_URL` is set.

## Usage

Start the server (`npm run dev`), then:

```bash
$ curl -s -X POST localhost:3000/route -H 'content-type: application/json' \
    -d '{"tenantId":"acme","query":"12 + 8 + 5"}'
{"answer":25,"raw":"cheap-model result: 25","modelUsed":"cheap","escalated":false,"difficultyScore":0.1516018201513901,"confidence":0.95,"costCents":0.08,"alert":null}

$ curl -s -X POST localhost:3000/route -H 'content-type: application/json' \
    -d '{"tenantId":"acme","query":"12 + 8 * 5"}'
{"answer":52,"raw":"expensive-model result: 52","modelUsed":"expensive","escalated":true,"difficultyScore":0.1516018201513901,"confidence":0.15,"costCents":2.58,"alert":null}

$ curl -s -X POST localhost:3000/route -H 'content-type: application/json' \
    -d '{"tenantId":"acme","query":"12 + "}'
{"error":"Unexpected end of expression"}
```

The second call shows the safety net working end to end: the classifier scored this query as low-difficulty (0.15, below the 0.5 routing threshold) and tried the cheap model first, but the verifier caught the mixed-precedence structure, drove confidence down to 0.15, and escalated — the returned answer (52) is the mathematically correct one, not the cheap model's naive left-to-right result (100).

### Offline replay benchmark

```
$ npm run benchmark

Offline replay: trained on 1500 historical queries, evaluated on 1000 held-out queries

strategy                  total cost (cents)        accuracy                  vs always-expensive cost  escalation rate
always-cheap              80.00                     75.50%                    -96.8%                    n/a
always-expensive          2500.00                   100.00%                   +0.0%                     n/a
cost-router               1206.06                   100.00%                   -51.8%                    31.2%
```

The router matches always-expensive's accuracy exactly (guaranteed by the verifier's zero-false-negative property, not luck — see "Design decisions" above) while cutting cost by 51.8%. The 31.2% escalation rate is the cost of that safety net: every query the classifier waves through as "easy" still gets checked by the verifier before its answer is trusted.

## Testing

```
$ npm test
Test Suites: 9 passed, 9 total
Tests:       49 passed, 49 total
```

- `tests/math.test.ts`, `tests/expression.test.ts` — the arithmetic evaluators and feature extraction, including the "no false negatives" guarantee `hasMixedPrecedence` relies on.
- `tests/providers.test.ts` — proves the cheap/expensive accuracy and cost gap directly against the synthetic benchmark.
- `tests/classifier.test.ts` — logistic regression training, serialization, and the deliberately-broken `AlwaysEasyClassifier`.
- `tests/verifier.test.ts` — the verifier's zero-false-negative guarantee across a random sample.
- `tests/budget.test.ts` — `InMemoryBudgetStore` rolling windows, tenant isolation, and a regression test for a real bug caught during development (see below).
- `tests/router.test.ts` — routing, escalation, budget recording, and escalation-rate spike alerting end to end.
- `tests/chaos.test.ts` — **the chaos test**: wires `AlwaysEasyClassifier` (a classifier that always predicts "easy", confidence < 0.05, no matter the query) into a full router and confirms accuracy still lands at exactly 100% over 500 queries, purely from verifier-driven escalation, and confirms escalation actually fires rather than trivially passing because no hard queries exist.
- `tests/benchmark.test.ts` — asserts the offline replay produces materially lower cost than always-expensive within a small accuracy delta (not just eyeballing the printed table).

One real bug the test suite caught during development: the first cut of `InMemoryBudgetStore` pruned stale events on every `getRollingWindow` read using that call's own `windowMs` as the cutoff. Since the router queries the same tenant with two different window sizes back to back (a short window for spike detection, then a longer baseline window), querying the short window first silently deleted data the baseline query still needed. Fixed by keying pruning off a fixed retention horizon independent of any single caller's window choice (`tests/budget.test.ts` has a regression test for this).

## Scope notes

- No real LLM API is called anywhere (by design — see "Why arithmetic expressions" above).
- No Redis/Docker in this repo; `RedisBudgetStore` is real, complete `ioredis` code but unrun here.
- Classifier retraining is exposed (`CostRouter.getTrainingLog()` + `LogisticClassifier.train()`) but there's no scheduler wired up to call it periodically — a production deployment would run that on a cron/queue against the persisted outcome log.
- Per-tenant budget *caps* (hard request denial once a tenant exceeds a $ limit) were left out; only tracking + escalation-rate spike alerting is implemented, matching the spec's "alerts instead of silently absorbing cost" rather than a hard cutoff.

## License

MIT — see [LICENSE](./LICENSE).
