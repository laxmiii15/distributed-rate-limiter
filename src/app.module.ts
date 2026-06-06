import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DemoController } from './demo.controller';
import { HealthController } from './health.controller';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RedisModule],
  controllers: [DemoController, HealthController],
  providers: [
    // Registered globally; it only acts on routes carrying @RateLimit.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
