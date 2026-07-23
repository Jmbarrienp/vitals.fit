import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { configureApp } from './bootstrap/configure-app';
import { buildOpenApiDocument } from './bootstrap/openapi-document';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  configureApp(app);

  // V5.2 — without this Nest never runs onModuleDestroy, so PrismaService's
  // pool drain would never fire on SIGTERM and every redeploy would leak
  // database connections.
  app.enableShutdownHooks();

  // V5.4 — OpenAPI. Documentation ONLY: it introspects the routes and DTOs that
  // already exist and changes no behavior. Disabled in production by default
  // (SWAGGER_ENABLED=true to opt in) because the API surface includes operator
  // endpoints whose shape need not be public.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
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
