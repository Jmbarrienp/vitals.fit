import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAdmin, resolveAdminEmails } from '../../config/production-config';

/**
 * Operator gate (V5.3). Until this slice, the ~20 governance / rollout /
 * promotion / rollback / canary / learning endpoints were protected by the
 * ordinary user JwtAuthGuard — so ANY authenticated user could read
 * platform-wide analytics, provider scorecards and rollout posture.
 *
 * This guard runs AFTER JwtAuthGuard (which populates `request.user`) and
 * requires the authenticated identity to be on the deploy-configured operator
 * allowlist. It FAILS CLOSED: an unset ADMIN_EMAILS denies everyone.
 *
 * Denials are logged with the attempting identity — an unauthorized attempt to
 * read platform governance is exactly the event an operator wants to see.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { email?: string }; url?: string }>();
    const email = request?.user?.email ?? null;
    const adminEmails = resolveAdminEmails({ ADMIN_EMAILS: this.config.get<string>('ADMIN_EMAILS', '') });

    if (isAdmin(email, adminEmails)) return true;

    this.logger.warn(
      `Operator endpoint denied for ${email ?? 'anonymous'} on ${request?.url ?? 'unknown'}` +
        (adminEmails.length === 0 ? ' (ADMIN_EMAILS is not configured — denying everyone by design)' : ''),
    );
    throw new ForbiddenException('This endpoint is restricted to platform operators.');
  }
}
