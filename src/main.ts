import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the first proxy hop so req.ip reflects X-Forwarded-For. Set this to
  // match your real infra (number of proxies) — it directly affects which IP
  // gets rate-limited.
  app.set('trust proxy', 1);

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`▶ rate-limiter listening on http://localhost:${port}`);
}

void bootstrap();
