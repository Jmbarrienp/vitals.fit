import { Reflector } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { resolveCors } from '../config/production-config';

const logger = new Logger('Bootstrap');

/**
 * V5.5 — the global wiring `bootstrap()` applied inline (body limit, validation,
 * exception filter, CORS, rate limiting, prefix). Extracted so it is no longer
 * a second, undocumented source of truth: `main.ts` calls this to serve real
 * traffic, and the HTTP contract suite calls the SAME function to boot the
 * SAME pipeline against an embedded Postgres. Before this, no test could
 * reproduce the real request pipeline without re-typing every line here —
 * exactly the "second source of truth" this project's own principles forbid.
 *
 * Deliberately excludes `enableShutdownHooks()` (a process-signal concern, not
 * a request-handling one — registering it once per test-suite boot would leak
 * SIGTERM/SIGINT listeners across many embedded apps in the same process) and
 * the Swagger mount (see `openapi-document.ts`), both of which stay in
 * `main.ts`.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
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

  return app;
}
