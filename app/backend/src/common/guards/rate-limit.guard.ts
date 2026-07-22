import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimiter, resolveRules } from '../rate-limit/rate-limiter';

export const RATE_LIMIT_KEY = 'rateLimitBucket';
/** Tag a route/controller with the bucket whose rule applies. */
export const RateLimit = (bucket: 'AUTH' | 'VISION' | 'BARCODE' | 'DEFAULT') => SetMetadata(RATE_LIMIT_KEY, bucket);

/**
 * Rate limiting (V5.3). Before this slice there was none: `/auth/login`
 * accepted unlimited attempts (offline-free brute force against password
 * hashes) and the Vision endpoints could be driven without any ceiling, each
 * call costing real vendor money.
 *
 * The limiter is shared process-wide and bounded (see rate-limiter.ts). Keys
 * are per (bucket, identity) where identity is the authenticated user when
 * available and the client IP otherwise — so one abusive client cannot consume
 * another's quota, and an unauthenticated login flood is still bucketed by IP.
 *
 * Standard headers are set on every response so clients can back off correctly
 * instead of hammering blindly.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly limiter = new RateLimiter();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  /** Exposed for the readiness probe (leak visibility) and for tests. */
  static get tracked(): number {
    return RateLimitGuard.limiter.size();
  }
  static resetForTests(): void {
    RateLimitGuard.limiter.reset();
  }

  canActivate(context: ExecutionContext): boolean {
    if (String(this.config.get<string>('RATE_LIMIT_ENABLED', 'true')).toLowerCase() === 'false') return true;

    const bucket =
      this.reflector.getAllAndOverride<'AUTH' | 'VISION' | 'BARCODE' | 'DEFAULT'>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'DEFAULT';

    const rules = resolveRules(process.env as unknown as Record<string, unknown>);
    const rule = rules[bucket] ?? rules.DEFAULT;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: string } }>();
    const response = http.getResponse<Response>();

    const identity = request?.user?.id ?? clientIp(request);
    const verdict = RateLimitGuard.limiter.hit(`${bucket}:${identity}`, rule, Date.now());

    response?.setHeader?.('X-RateLimit-Limit', String(rule.limit));
    response?.setHeader?.('X-RateLimit-Remaining', String(verdict.remaining));

    if (!verdict.allowed) {
      response?.setHeader?.('Retry-After', String(verdict.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Demasiadas peticiones. Intenta de nuevo en ${verdict.retryAfterSeconds} segundo(s).`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Render terminates TLS at its proxy, so the socket address is the proxy —
 * the real client is the FIRST entry of X-Forwarded-For. Falls back to the
 * socket address, and finally to a constant so a missing IP degrades to a
 * shared bucket rather than an unbounded key space.
 */
function clientIp(request: Request | undefined): string {
  const forwarded = request?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(',')[0].trim();
  return request?.ip ?? request?.socket?.remoteAddress ?? 'unknown';
}
