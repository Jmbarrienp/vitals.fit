import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';

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
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

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
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('HEALTH_PROBE_TIMEOUT')), ms)),
  ]);
}
