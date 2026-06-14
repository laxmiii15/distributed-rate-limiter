import { Controller, Get } from '@nestjs/common';
import { RateLimit } from './rate-limit/rate-limit.decorator';

@Controller()
export class DemoController {
  /** 5 requests / 10s, smooth. Exceed it → 429. */
  @Get('sliding')
  @RateLimit({ limit: 5, windowMs: 10_000, strategy: 'sliding-window' })
  sliding(): { ok: true; strategy: string } {
    return { ok: true, strategy: 'sliding-window' };
  }

  /** 10-token bucket refilling over 10s — tolerates a burst, then throttles. */
  @Get('bucket')
  @RateLimit({ limit: 10, windowMs: 10_000, strategy: 'token-bucket' })
  bucket(): { ok: true; strategy: string } {
    return { ok: true, strategy: 'token-bucket' };
  }

  /** No decorator → no limit. */
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}
