import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { REDIS, RateLimitRedis } from '../redis/redis.module';
import { clientId } from './client-id';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  // Per-process counter to keep sliding-window members unique within a ms.
  private seq = 0;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: RateLimitRedis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No @RateLimit on this route → not our concern.
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const strategy = opts.strategy ?? 'sliding-window';

    // Scope the key by strategy + route + caller so different routes don't
    // share a bucket.
    const route = req.route?.path ?? req.path;
    const key = `rl:${strategy}:${route}:${clientId(req)}`;
    const now = Date.now();

    let allowed: number;
    let remaining: number;
    let resetMs: number;

    if (strategy === 'token-bucket') {
      const refillRate = opts.limit / opts.windowMs; // tokens per ms
      [allowed, remaining, resetMs] = await this.redis.tokenBucket(
        key,
        now,
        opts.limit,
        refillRate,
        1,
        opts.windowMs * 2, // keep the bucket around long enough to refill fully
      );
    } else {
      const member = `${now}-${process.pid}-${this.seq++}`;
      [allowed, remaining, resetMs] = await this.redis.slidingWindow(
        key,
        now,
        opts.windowMs,
        opts.limit,
        member,
      );
    }

    // Standard, client-readable rate-limit headers.
    res.setHeader('X-RateLimit-Limit', opts.limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetMs / 1000));

    if (!allowed) {
      const retryAfter = Math.max(1, Math.ceil((resetMs - now) / 1000));
      res.setHeader('Retry-After', retryAfter);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Retry after ${retryAfter}s.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
