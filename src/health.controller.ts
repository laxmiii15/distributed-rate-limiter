import { Controller, Get, Inject } from '@nestjs/common';
import { REDIS, RateLimitRedis } from './redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS) private readonly redis: RateLimitRedis) {}

  @Get()
  async check(): Promise<{ status: string; redis: boolean }> {
    const pong = await this.redis.ping();
    return { status: 'ok', redis: pong === 'PONG' };
  }
}
