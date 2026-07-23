import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/**
 * V5.5 — the API has always had TWO error shapes (see ADR-0004): every
 * intentional `HttpException` keeps Nest's own `{statusCode, message, error}`
 * body untouched (V5.2's `AllExceptionsFilter` deliberately passes it through),
 * while an UNHANDLED error is normalized by that same filter into
 * `{statusCode, message, timestamp, path}` — no `error` field, but a
 * timestamp and route for correlation. Both are documented here, faithfully,
 * rather than pretending the API has one envelope it does not.
 */
export class HttpErrorResponseDto {
  @ApiProperty({ example: 400, description: 'Repeats the HTTP status code.' })
  statusCode: number;

  @ApiProperty({
    description: 'A human-readable message, or one string per failed validation rule.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Resource not found.',
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request', description: "Nest's standard reason phrase for the status code." })
  error: string;
}

/** The shape of an UNHANDLED (unexpected) error — see {@link HttpErrorResponseDto} for why it differs. */
export class InternalErrorResponseDto {
  @ApiProperty({ example: 500 })
  statusCode: number;

  @ApiProperty({ example: 'Internal server error', description: 'Always this literal string — never the real cause.' })
  message: string;

  @ApiProperty({ example: '2026-07-22T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/vision/scans', description: 'The route that failed, for log correlation.' })
  path: string;
}

/** Every JWT-protected route: 401 when the token is missing/invalid/expired, 500 on an unexpected failure. */
export function ApiAuthErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Missing, malformed or expired JWT.', type: HttpErrorResponseDto }),
    ApiInternalServerErrorResponse({ description: 'Unexpected server error.', type: InternalErrorResponseDto }),
  );
}

/** Operator-only routes (JwtAuthGuard + AdminGuard): adds 403 for an authenticated caller off the ADMIN_EMAILS allowlist. */
export function ApiAdminErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Missing, malformed or expired JWT.', type: HttpErrorResponseDto }),
    ApiForbiddenResponse({
      description: 'Authenticated, but the identity is not on the ADMIN_EMAILS allowlist.',
      type: HttpErrorResponseDto,
    }),
    ApiInternalServerErrorResponse({ description: 'Unexpected server error.', type: InternalErrorResponseDto }),
  );
}

/** Unauthenticated routes (health probes, register, login): only the 500 applies. */
export function ApiPublicErrors() {
  return applyDecorators(
    ApiInternalServerErrorResponse({ description: 'Unexpected server error.', type: InternalErrorResponseDto }),
  );
}

/**
 * Layers the 403 onto a route inside a MIXED controller that already carries
 * class-level `ApiAuthErrors()` — e.g. LearningController, where 8 of 10
 * routes additionally require AdminGuard. Method-level `@ApiResponse`
 * decorators ADD to class-level ones in Swagger; they do not replace them.
 */
export function ApiAdminOnly() {
  return applyDecorators(
    ApiForbiddenResponse({
      description: 'Authenticated, but the identity is not on the ADMIN_EMAILS allowlist.',
      type: HttpErrorResponseDto,
    }),
  );
}

/** DTO / query validation failure (class-validator, via the global ValidationPipe). This API uses 400, not 422 — see ADR-0004. */
export function ApiValidationError() {
  return applyDecorators(
    ApiBadRequestResponse({ description: 'DTO or query parameter failed validation.', type: HttpErrorResponseDto }),
  );
}

/** The path id does not exist, or exists but is owned by a different user (ownership never leaks via a 403). */
export function ApiNotFoundError(resource: string) {
  return applyDecorators(
    ApiNotFoundResponse({
      description: `${resource} not found, or not owned by the authenticated caller.`,
      type: HttpErrorResponseDto,
    }),
  );
}

export function ApiConflictError(reason: string) {
  return applyDecorators(ApiConflictResponse({ description: reason, type: HttpErrorResponseDto }));
}

/** Routes tagged with @RateLimit(...) in a tighter bucket than DEFAULT. */
export function ApiRateLimited() {
  return applyDecorators(
    ApiTooManyRequestsResponse({
      description: 'Rate limit exceeded for this bucket. See Retry-After header.',
      type: HttpErrorResponseDto,
    }),
  );
}
