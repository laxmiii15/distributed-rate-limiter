import {
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { SLIDING_WINDOW_LUA, TOKEN_BUCKET_LUA } from './lua';

export const REDIS = Symbol('REDIS');

/** ioredis with our two Lua scripts registered as custom atomic commands. */
export interface RateLimitRedis extends Redis {
  slidingWindow(
    key: string,
    now: number,
    window: number,
    limit: number,
    member: string,
  ): Promise<[number, number, number]>;
  tokenBucket(
    key: string,
    now: number,
    capacity: number,
    refillRate: number,
    cost: number,
    ttl: number,
  ): Promise<[number, number, number]>;
}

const redisProvider: Provider = {
  provide: REDIS,
  useFactory: (): RateLimitRedis => {
    const client = new Redis(
      process.env.REDIS_URL ?? 'redis://localhost:6380',
      { maxRetriesPerRequest: 2 },
    ) as RateLimitRedis;

    // defineCommand ships the script once and calls it by SHA thereafter
    // (EVALSHA), so each rate-limit check is a single round-trip.
    client.defineCommand('slidingWindow', {
      numberOfKeys: 1,
      lua: SLIDING_WINDOW_LUA,
    });
    client.defineCommand('tokenBucket', {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_LUA,
    });

    return client;
  },
};

@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: RateLimitRedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
