import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * V5.2 hardening — the platform had NO exception filter. Nest's default turns
 * an unhandled error into a 500, but the message it derives can carry internal
 * detail (a Prisma error names tables, columns and constraints), and nothing
 * logged the failure with the route that caused it — so a production 500 was
 * both leaky and unattributable.
 *
 * DELIBERATELY CONSERVATIVE, because a hardening slice must not change
 * behavior: every `HttpException` the application throws on purpose — every
 * BadRequest, Unauthorized, NotFound, Forbidden, and every ValidationPipe
 * response — is passed through with its EXACT original status and body. Only
 * UNHANDLED errors (which were already 500s) are normalized, and for those the
 * client now gets a stable, detail-free envelope while the server logs the
 * real cause with its route.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Intentional HTTP errors keep their exact contract — status AND body.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // Anything else was already a 500; make it opaque to the client and
    // attributable in the logs.
    const method = request?.method ?? 'UNKNOWN';
    const url = request?.url ?? 'unknown';
    const detail = exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
    this.logger.error(`Unhandled error on ${method} ${url} — ${detail}`, exception instanceof Error ? exception.stack : undefined);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: url,
    });
  }
}
