# distributed-rate-limiter

**Distributed, atomic rate limiting for NestJS.** Two strategies — token bucket and sliding window — enforced *inside Redis* with Lua, so the limit holds exactly even under burst concurrency and even across many app instances behind a load balancer. Ships with a demo that proves it.

The rate limiter every tutorial writes keeps a counter in process memory. It works on your laptop and silently breaks the moment you run two replicas: each instance has its own counter, so a "100/min" limit becomes "100/min × number of pods." This repo does it the way production does — one shared limit in Redis, decided atomically.

> **Verified by `npm run demo`** against real Redis + two app instances:
> - **Atomicity:** 20 simultaneous requests against a 5/10s limit → **exactly 5 allowed, 15 rejected.** No race lets a 6th through.
> - **Distributed:** the same 5-request limit enforced **across two instances** sharing one Redis — 5 allowed total, not 5 per instance.
> - **Token bucket refill:** burst of 10 drains the bucket; 3s later, ~3 tokens have refilled.

---

## Why it has to be atomic, and why in Redis

A rate-limit check is read-decide-write: *read the current count, decide if under the limit, write the increment.* If those are three separate steps, two concurrent requests can both read "4 used", both decide "allowed", and both write — now you've served 6 against a limit of 5. Classic race.

The fix is to make read-decide-write a **single atomic operation on the server**. Both algorithms here are Lua scripts that Redis runs to completion without interleaving. Combined with Redis being the *single shared source of truth*, the limit is correct no matter how many app instances or how much concurrency you throw at it.

```
   instance A ─┐
   instance B ─┼──▶  Redis  ──▶  one atomic Lua check  ──▶  allow / 429
   instance C ─┘                 (shared counter)
```

## Two strategies, pick per route

```ts
@Get('search')
@RateLimit({ limit: 100, windowMs: 60_000 })                          // sliding window (default)
search() { … }

@Get('upload')
@RateLimit({ limit: 20, windowMs: 1_000, strategy: 'token-bucket' })  // allow bursts
upload() { … }
```

| | Sliding window (log) | Token bucket |
|---|---|---|
| Shape | smooth, exact count over the trailing window | allows bursts up to capacity, then steady drip |
| Edge behavior | no boundary spikes | tolerates short spikes by design |
| Storage | sorted set, one entry per in-window request | tiny hash `{ tokens, ts }` |
| Best for | "exactly N per minute" fairness | APIs that should absorb bursts (uploads, webhooks) |

Both live in [`src/redis/lua.ts`](src/redis/lua.ts), heavily commented. Registered once with ioredis `defineCommand`, so each check is a single `EVALSHA` round-trip.

## Standard response headers

Every limited route returns the headers clients expect:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4
X-RateLimit-Reset: 1782615951      # unix seconds
```

On rejection, a `429` with `Retry-After` (seconds) and a JSON body:

```jsonc
// HTTP 429
{ "statusCode": 429, "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry after 7s.", "retryAfter": 7 }
```

---

## Quickstart

Requires Docker + Node 18+.

```bash
cp .env.example .env          # optional — defaults already point at the compose Redis
npm install

make up                       # start Redis on :6380
npm run start:prod            # API on :3000

# in another terminal — proves atomicity, refill, and (if a 2nd instance is up) distribution
npm run demo
```

To see the **distributed** check pass, start a second instance against the same Redis first:

```bash
PORT=3001 npm run start:prod  # second terminal
npm run demo                  # now test 3 runs instead of skipping
```

Example demo output:

```
1) Atomicity — 20 simultaneous requests, limit is 5/10s
  ✅ PASS  sliding-window — 5 allowed (expected 5), 15 rejected with 429
2) Token bucket — capacity 10, refills 1 token/sec
  ✅ PASS  initial burst — 10 allowed (expected 10 — full bucket), 5 rejected
  ✅ PASS  after refill — 3 allowed (expected ~3 refilled tokens)
3) Distributed — one limit across TWO instances
  ✅ PASS  shared bucket — 5 allowed across both instances (expected 5)
```

### Try it by hand

```bash
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code} " localhost:3000/sliding -H 'x-api-key: me'
done
# → 200 200 200 200 200 429 429 429
```

---

## How it's built

```
src/
├── main.ts                          # bootstrap; sets `trust proxy` so req.ip is the real client
├── redis/
│   ├── lua.ts                       # the two algorithms, as commented Lua
│   └── redis.module.ts              # ioredis client + defineCommand registration, graceful quit
├── rate-limit/
│   ├── rate-limit.decorator.ts      # @RateLimit({ limit, windowMs, strategy })
│   ├── rate-limit.guard.ts          # global guard: builds the key, runs the script, sets headers, 429s
│   └── client-id.ts                 # bucket by API key, else IP
├── demo.controller.ts               # /sliding, /bucket, /open
└── health.controller.ts
scripts/demo.ts                      # the verification harness above
```

- **Global guard, opt-in per route.** `RateLimitGuard` is registered via `APP_GUARD` but only acts on handlers carrying `@RateLimit`. Undecorated routes (`/open`, `/health`) are untouched.
- **Keying.** Buckets are scoped `rl:<strategy>:<route>:<caller>` so each route has its own limit and an API key is limited independently from an IP. See [`client-id.ts`](src/rate-limit/client-id.ts).
- **`trust proxy`.** Behind a load balancer the real client IP is in `X-Forwarded-For`; the wrong setting would rate-limit the *proxy*, not the user. Tune it to your hop count.

## Production notes

- **Set `trust proxy` to your real topology** — it decides whose IP gets limited. This is the single most common rate-limiter misconfiguration.
- **Fail open vs. fail closed.** This guard throws if Redis is unreachable (fail closed). For non-critical endpoints you may prefer to allow on Redis error — a one-line change in the guard, made explicit on purpose.
- **Per-plan limits:** pass different `{ limit, windowMs }` per route, or extend the decorator to resolve limits from the authenticated user's plan.
- **Memory:** sliding-window cost is one sorted-set entry per in-window request; for very high-throughput routes prefer token bucket (constant size per key).

## Part of a series — production scaling patterns in NestJS

- [million-row-pagination](https://github.com/laxmiii15/million-row-pagination) — keyset vs offset pagination over 1M Postgres rows
- [distributed-rate-limiter](https://github.com/laxmiii15/distributed-rate-limiter) — atomic rate limiting across instances via Redis Lua
- [million-row-ingestion](https://github.com/laxmiii15/million-row-ingestion) — memory-safe bulk ingestion (streaming COPY + idempotent upsert)
- [scalable-job-queue](https://github.com/laxmiii15/scalable-job-queue) — BullMQ retries, dead-letter queue, horizontal worker scaling

## License

MIT
