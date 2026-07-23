import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * V5.4 introduced this inline in `main.ts`; V5.5 extracts it because the
 * contract snapshot (`scripts/smoke-http-contract.ts`) needs the exact same
 * document `main.ts` serves at `/api/docs` — generating it a second way would
 * make the snapshot describe a DIFFERENT contract than the one clients see.
 * One definition, two consumers: the running server and the test suite.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Vitals Fit API')
    .setDescription(
      'Nutrition platform API. Endpoints under /vision/{rollout,governance,promotion,rollback,canary} ' +
        'and the platform-wide /vision/learning analytics are OPERATOR-only (ADMIN_EMAILS allowlist).',
    )
    .setVersion('5.5')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}
