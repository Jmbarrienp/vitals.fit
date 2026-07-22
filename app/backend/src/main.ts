import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { resolveCors } from './config/production-config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Vision posts a base64 photo (capped at 5 MB decoded ≈ 6.8 MB encoded); Express
  // defaults to 100 kb, which would reject every real scan with a 413 before the
  // DTO's own size limit could give a useful error. 8 MB leaves headroom for the
  // JSON envelope. Every other endpoint on the API sends far less than this.
  app.useBodyParser('json', { limit: '8mb' });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // V5.2 — intentional HttpExceptions pass through untouched; only unhandled
  // errors are normalized, so no internal detail (Prisma table/column names)
  // reaches a client and every 500 is logged with the route that caused it.
  app.useGlobalFilters(new AllExceptionsFilter());

  // V5.2 — without this Nest never runs onModuleDestroy, so PrismaService's
  // pool drain would never fire on SIGTERM and every redeploy would leak
  // database connections.
  app.enableShutdownHooks();

  // V5.2 shipped `origin: '*'` with Authorization allowed. Harmless for a pure
  // native client, an open door the day a web client exists — so production
  // now requires an explicit allowlist (and boot refuses "*" outright).
  const cors = resolveCors(process.env as unknown as Record<string, unknown>);
  app.enableCors({
    origin: cors.origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  logger.log(`CORS: ${cors.reason}`);

  // Render terminates TLS at its proxy; without this the rate limiter would
  // bucket every request under the proxy's address instead of the client's.
  app.set('trust proxy', 1);

  // V5.3 — global rate limiting. Routes opt into a tighter bucket with
  // @RateLimit('AUTH' | 'VISION' | 'BARCODE'); everything else gets DEFAULT.
  app.useGlobalGuards(new RateLimitGuard(app.get(Reflector), app.get(ConfigService)));

  app.setGlobalPrefix('api');

  // V5.4 — OpenAPI. Documentation ONLY: it introspects the routes and DTOs that
  // already exist and changes no behavior. Disabled in production by default
  // (SWAGGER_ENABLED=true to opt in) because the API surface includes operator
  // endpoints whose shape need not be public.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const openApi = new DocumentBuilder()
      .setTitle('Vitals Fit API')
      .setDescription(
        'Nutrition platform API. Endpoints under /vision/{rollout,governance,promotion,rollback,canary} ' +
          'and the platform-wide /vision/learning analytics are OPERATOR-only (ADMIN_EMAILS allowlist).',
      )
      .setVersion('5.4')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi), {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log('OpenAPI disponible en /api/docs');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Server running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
