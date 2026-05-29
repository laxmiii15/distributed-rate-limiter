import { SetMetadata } from '@nestjs/common';

export type RateLimitStrategy = 'sliding-window' | 'token-bucket';

export interface RateLimitOptions {
  /** Max requests allowed within the window (also the bucket capacity). */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Defaults to 'sliding-window'. */
  strategy?: RateLimitStrategy;
}

export const RATE_LIMIT_KEY = 'rate_limit:options';

/**
 * Attach a per-route limit:
 *
 *   @RateLimit({ limit: 100, windowMs: 60_000 })                       // 100/min, smooth
 *   @RateLimit({ limit: 20, windowMs: 1_000, strategy: 'token-bucket' }) // 20 burst, refill
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
