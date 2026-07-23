import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { collectEnvProblems } from './config/env.validation';
import { resolveAdminEmails, resolveCors } from './config/production-config';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { ApiPublicErrors } from './common/swagger/error-responses';

/** A DB probe must never hang a health check — the orchestrator has its own deadline. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * V5.2 hardening — `/health` used to return a hard-coded `{ status: 'ok' }`.
 * It could not fail. With Postgres unreachable it still answered 200, so an
 * orchestrator or uptime monitor would happily keep routing traffic to an
 * instance that could not serve a single real request. A health check that
 * cannot report ill-health is decoration, not observability.
 *
 * It now probes the database on a short leash and answers 503 when degraded.
 * BACKWARD COMPATIBLE: the original `status` / `timestamp` / `service` fields
 * are unchanged and `status` is still `'ok'` on the happy path — existing
 * consumers see exactly what they saw before, plus a `database` block.
 */
@ApiTags('platform')
@ApiPublicErrors()
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary: 'Liveness + database probe. No auth required — orchestrators and uptime monitors call this.',
  })
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const startedAt = Date.now();
    let databaseOk = false;
    let error: string | null = null;

    try {
      await withTimeout(this.prisma.ping(), PROBE_TIMEOUT_MS);
      databaseOk = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'unknown error';
    }

    if (!databaseOk) res.status(503);

    return {
      status: databaseOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'fitness-ai-backend',
      database: { ok: databaseOk, latencyMs: Date.now() - startedAt, error },
    };
  }

  /**
   * Liveness: is the PROCESS up? Deliberately dependency-free — a restart loop
   * caused by a database outage would be worse than the outage itself.
   */
  @Get('health/live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /**
   * READINESS (V5.3) — deliberately distinct from `/health`.
   *
   * Liveness asks "is the process alive?" (restart me if not). Readiness asks
   * "should this instance receive traffic?" — which is a broader question:
   * a booted process with an unreachable database, a missing operator
   * allowlist or an unconfigured provider is alive but not ready. Conflating
   * the two is how a deploy either flaps (restarted for a dependency outage)
   * or silently serves broken traffic.
   *
   * Reports every check even when one fails, so a failed deploy is diagnosed
   * in one look rather than one restart per problem.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: ReadinessCheck[] = [];

    const dbStart = Date.now();
    try {
      await withTimeout(this.prisma.ping(), PROBE_TIMEOUT_MS);
      checks.push({ name: 'database', ok: true, detail: `respondió en ${Date.now() - dbStart}ms` });
    } catch (err) {
      checks.push({ name: 'database', ok: false, detail: err instanceof Error ? err.message : 'unknown error' });
    }

    // Configuration: re-run the same validator the boot used. It cannot fail
    // here (the app would not have booted) — this proves it, and surfaces the
    // non-blocking warnings an operator should still see.
    const { errors, warnings } = collectEnvProblems(process.env as unknown as Record<string, unknown>);
    checks.push({
      name: 'configuration',
      ok: errors.length === 0,
      detail:
        errors.length === 0
          ? `válida${warnings.length ? ` (${warnings.length} advertencia(s))` : ''}`
          : errors.join('; '),
    });

    const isProduction = String(process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    const cors = resolveCors(process.env as unknown as Record<string, unknown>);
    checks.push({
      name: 'cors',
      // A wildcard is only acceptable outside production.
      ok: !(isProduction && cors.isWildcard),
      detail: cors.reason,
    });

    const adminEmails = resolveAdminEmails(process.env as unknown as Record<string, unknown>);
    checks.push({
      name: 'operator-access',
      ok: true, // never blocks readiness — failing closed is a valid posture
      detail:
        adminEmails.length > 0
          ? `${adminEmails.length} operador(es) configurado(s)`
          : 'sin operadores — endpoints de gobernanza cerrados a todos',
    });

    checks.push({
      name: 'vision-providers',
      ok: true, // the fixture provider always exists; this reports posture
      detail: `vision=${process.env.VISION_PROVIDER ?? 'fixture'} ocr=${process.env.OCR_PROVIDER ?? 'fixture'} barcode=${process.env.BARCODE_LOOKUP_PROVIDER ?? 'openfoodfacts'} menu=${process.env.RESTAURANT_MENU_PROVIDER ?? 'none'}${process.env.ANTHROPIC_API_KEY ? '' : ' (sin ANTHROPIC_API_KEY — degradación determinista)'}`,
    });

    checks.push({
      name: 'rate-limiting',
      ok: String(process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false',
      detail:
        String(process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() === 'false'
          ? 'DESHABILITADO'
          : `activo (${RateLimitGuard.tracked} cliente(s) en ventana)`,
    });

    const ready = checks.every((c) => c.ok);
    if (!ready) res.status(503);

    return { status: ready ? 'ready' : 'not_ready', timestamp: new Date().toISOString(), checks, warnings };
  }
}

interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('HEALTH_PROBE_TIMEOUT')), ms)),
  ]);
}
