/**
 * Both algorithms run as Lua scripts *inside* Redis. That is the whole point:
 * the read-decide-write is one atomic step on the server, so two requests
 * landing in the same millisecond — on the same instance or on different
 * instances behind a load balancer — can never both read "4 used" and both
 * decide they're allowed. No round-trip race, no Redis transaction dance.
 */

/**
 * SLIDING WINDOW LOG — exact, smooth, no bursty edge at window boundaries.
 *
 * Each request is a member in a sorted set scored by its timestamp. We drop
 * everything older than the window, count what's left, and admit only if under
 * the limit. Cost: O(log n) per call; memory: one entry per in-window request.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = now (ms)   ARGV[2] = window (ms)
 * ARGV[3] = limit      ARGV[4] = unique member id
 * returns { allowed (0|1), remaining, resetMs }
 */
export const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  allowed = 1
  count = count + 1
end

local remaining = limit - count
if remaining < 0 then remaining = 0 end

-- reset = when the oldest in-window request ages out
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetMs = now + window
if oldest[2] then resetMs = tonumber(oldest[2]) + window end

return { allowed, remaining, resetMs }
`;

/**
 * TOKEN BUCKET — allows controlled bursts, refills continuously.
 *
 * A bucket holds up to `capacity` tokens and refills at `refillRate` tokens/ms.
 * Each request spends one token; empty bucket → rejected. Stored as a tiny hash
 * { tokens, ts }; we lazily refill based on elapsed time on each call, so there
 * is no background timer. Great for APIs that should tolerate short spikes.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = now (ms)        ARGV[2] = capacity
 * ARGV[3] = refillRate (tokens/ms)   ARGV[4] = cost   ARGV[5] = ttl (ms)
 * returns { allowed (0|1), remaining, resetMs }
 */
export const TOKEN_BUCKET_LUA = `
local key        = KEYS[1]
local now        = tonumber(ARGV[1])
local capacity   = tonumber(ARGV[2])
local refillRate = tonumber(ARGV[3])
local cost       = tonumber(ARGV[4])
local ttl        = tonumber(ARGV[5])

local data   = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed > 0 then
  tokens = math.min(capacity, tokens + elapsed * refillRate)
  ts = now
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, ttl)

-- reset = time until the next token is available
local resetMs = now
if tokens < cost then
  resetMs = now + math.ceil((cost - tokens) / refillRate)
end

return { allowed, math.floor(tokens), resetMs }
`;
